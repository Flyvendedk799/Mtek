//! Lowering prefabs and their static instances (decision 0062).
//!
//! A prefab becomes an [`Item::Prefab`](super::model::Item): a root and optional descendants. Its
//! root is index 0, and every part's `self` is its own index, with the prefab's params as reads
//! `ExprKind::Param`. A field or material param whose value reads the params, constants or
//! state of the prefab is a [`Source::Expr`]. A static instance, `entity Name: Prefab { .. }`, is
//! lowered here only as far as the scene knows it: its place in the scene, its name and the
//! values of the params. Its fields, state, behaviours and bindings are the prefab's, copied in
//! once every prefab is lowered (`super::instantiate`).

use super::lower::{Defect, Lowering, handler_ordinal};
use super::lower_fn::SceneCtx;
use super::model::{
    Entity, Field, NamedValue, Origin, Owner, PrefabInstance, PrefabItem, PrefabParamItem, Source,
    Symbol, UpdateClass, Value,
};
use crate::resolve::DefId;
use crate::syntax::ast::{self, EntityMember, ExprKind as AstExpr, FieldValue};
use crate::types::{CheckedEntity, CheckedInstance, CheckedPrefab, FieldOrigin};
use std::collections::BTreeMap;

/// The value expression of the field `name` written in the prefab `decl`.
fn field_expr<'d>(members: &'d [EntityMember], name: &str) -> Option<&'d ast::Expr> {
    members.iter().find_map(|member| match member {
        EntityMember::Field(field) if field.name.name == name => match &field.value {
            FieldValue::Expr(value) => Some(&**value),
            FieldValue::Bind(_) => None,
        },
        _ => None,
    })
}

fn strip_parens(expr: &ast::Expr) -> &ast::Expr {
    let mut expr = expr;
    while let AstExpr::Paren(inner) = &expr.kind {
        expr = inner;
    }
    expr
}

impl Lowering<'_> {
    /// The prefab `decl` with its template entity, state, behaviours and bindings.
    pub(super) fn prefab(
        &self,
        decl: &ast::PrefabDecl,
        symbol: Symbol,
    ) -> Result<PrefabItem, Defect> {
        let name = decl.name.name.clone();
        let def = self
            .resolution
            .def_of(decl.id)
            .ok_or_else(|| format!("prefab '{name}' has no declaration"))?;
        let info = self
            .types
            .prefab(def)
            .ok_or_else(|| format!("prefab '{name}' was not checked"))?;
        let checked = self
            .types
            .checked_prefab(def)
            .ok_or_else(|| format!("prefab '{name}' has no checked fields"))?;
        let mut ctx = SceneCtx::default();
        ctx.entities.insert(def, 0);
        let mut pending: Vec<_> = checked.children.iter().rev().collect();
        let mut next = 1;
        while let Some(child) = pending.pop() {
            if let Some(def) = child.def {
                ctx.entities.insert(def, next);
            }
            next += 1;
            pending.extend(child.children.iter().rev());
        }
        let mut params = Vec::with_capacity(info.params.len());
        for (index, param) in info.params.iter().enumerate() {
            if param.has_default != param.default.is_some() {
                return Err(format!(
                    "the param '{}' of prefab '{name}' has a default with errors",
                    param.name
                ));
            }
            if let Some(param_def) = param.def {
                ctx.params.insert(
                    param_def,
                    u32::try_from(index).map_err(|_| "too many params".to_owned())?,
                );
            }
            params.push(PrefabParamItem {
                name: param.name.clone(),
                ty: self.type_name(param.ty),
                default: param.default.as_ref().map(Value::from),
                span: param.span,
            });
        }
        let mut constants = Vec::new();
        for member in &decl.members {
            if let EntityMember::Const(constant) = member {
                constants.push(self.constant(constant, symbol.child(&constant.name.name))?);
            } else if let EntityMember::Entity(child) = member {
                self.entity_constants(child, &symbol.child(&child.name.name), &mut constants)?;
            }
        }
        let entity = self.prefab_entity(decl, def, checked, &symbol, &ctx)?;
        let mut all = vec![entity];
        for child in &checked.children {
            self.entity(child, &symbol, Some(0), &mut all)?;
        }
        let mut bodies = vec![decl.members.as_slice()];
        while let Some(members) = bodies.pop() {
            for member in members {
                let EntityMember::Entity(child) = member else {
                    continue;
                };
                let child_def = self
                    .resolution
                    .def_of(child.id)
                    .ok_or("a prefab child has no definition")?;
                let index = *ctx
                    .entities
                    .get(&child_def)
                    .ok_or("a prefab child has no index")? as usize;
                let checked_child = find_child(&checked.children, child_def)
                    .ok_or("a prefab child was not checked")?;
                let entity = all.get_mut(index).ok_or("a prefab child was not lowered")?;
                self.computed_fields(
                    &child.members,
                    child_def,
                    &checked_child.fields,
                    entity,
                    &ctx,
                )?;
                bodies.push(&child.members);
            }
        }
        let entity = all.remove(0);
        let children = all;
        let who = Owner::Entity { index: 0 };
        let mut state = Vec::new();
        let mut behaviors = Vec::new();
        let mut counts = BTreeMap::new();
        for member in &decl.members {
            match member {
                EntityMember::State(declaration) => {
                    state.push(self.state(declaration, who, &symbol, &ctx)?);
                }
                EntityMember::Lifecycle(function) => {
                    behaviors.push(self.lifecycle(function, who, &symbol, &ctx)?);
                }
                EntityMember::Handler(handler) => {
                    let ordinal = handler_ordinal(&mut counts, who, handler);
                    behaviors.push(self.handler(handler, who, &symbol, &ctx, ordinal)?);
                }
                _ => {}
            }
        }
        let mut next = 1;
        for member in &decl.members {
            if let EntityMember::Entity(child) = member {
                self.entity_bodies(
                    child,
                    &symbol,
                    &mut next,
                    &ctx,
                    &mut counts,
                    &mut state,
                    &mut behaviors,
                )?;
            }
        }
        let bindings = self.prefab_bindings(decl, def, &symbol, &ctx)?;
        Ok(PrefabItem {
            name,
            symbol,
            params,
            constants,
            entity,
            children,
            state,
            behaviors,
            bindings,
            span: decl.span,
        })
    }

    /// The entity the prefab describes: its fields like an entity's, except that a value its
    /// `init` computes is an expression, and a material param written by a handler is
    /// `imperative`.
    fn prefab_entity(
        &self,
        decl: &ast::PrefabDecl,
        def: DefId,
        checked: &CheckedPrefab,
        symbol: &Symbol,
        ctx: &SceneCtx,
    ) -> Result<Entity, Defect> {
        let as_entity = CheckedEntity {
            def: Some(def),
            name: checked.name.clone(),
            name_span: checked.name_span,
            span: checked.span,
            fields: checked.fields.clone(),
            children: Vec::new(),
            instance: None,
        };
        let mut entities = Vec::new();
        self.entity(&as_entity, symbol, None, &mut entities)?;
        let mut entity = entities
            .pop()
            .ok_or_else(|| format!("prefab '{}' lowered to no entity", checked.name))?;
        entity.symbol = symbol.clone();
        self.computed_fields(&decl.members, def, &checked.fields, &mut entity, ctx)?;
        Ok(entity)
    }

    fn computed_fields(
        &self,
        members: &[EntityMember],
        def: DefId,
        fields: &[crate::types::CheckedField],
        entity: &mut Entity,
        ctx: &SceneCtx,
    ) -> Result<(), Defect> {
        let what = format!("prefab entity '{}'", entity.name);
        for field in fields.iter().filter(|f| f.dynamic) {
            let FieldOrigin::Written { .. } = field.origin else {
                return Err(format!(
                    "the dynamic field '{}' of {what} is a default",
                    field.name
                ));
            };
            let value = field_expr(members, field.name).ok_or_else(|| {
                format!("the dynamic field '{}' of {what} has no value", field.name)
            })?;
            let expr = self.prefab_expr(value, &format!("{what}.{}", field.name), ctx)?;
            let slot = match field.name {
                "position" => &mut entity.position,
                "rotation" => &mut entity.rotation,
                "scale" => &mut entity.scale,
                "visible" => &mut entity.visible,
                other => {
                    return Err(format!("the field '{other}' of {what} cannot be computed"));
                }
            };
            slot.source = Source::Expr(Box::new(expr));
        }
        if let (Some(material), Some(value)) =
            (&mut entity.material, field_expr(members, "material"))
        {
            let descriptor = strip_parens(value);
            let AstExpr::Descriptor { fields, .. } = &descriptor.kind else {
                return Ok(());
            };
            for (param, node) in self.types.init_params(descriptor.id) {
                let written = fields
                    .iter()
                    .find(|f| f.name.name == *param)
                    .and_then(|f| match &f.value {
                        FieldValue::Expr(value) if value.id == *node => Some(&**value),
                        _ => None,
                    })
                    .ok_or_else(|| {
                        format!("the material param '{param}' of {what} has no value")
                    })?;
                let expr = self.prefab_expr(written, &format!("{what}.material.{param}"), ctx)?;
                let slot = material
                    .params
                    .iter_mut()
                    .find(|p| p.name == *param)
                    .ok_or_else(|| format!("{what} has no material param '{param}'"))?;
                slot.source = Source::Expr(Box::new(expr));
            }
        }
        // A material param some handler of the prefab writes.
        for write in self.types.writes() {
            let crate::types::WriteTarget::MaterialParam {
                entity: target,
                param,
            } = &write.target
            else {
                continue;
            };
            if *target != def {
                continue;
            }
            let params = entity.material.as_mut().map(|m| &mut m.params);
            if let Some(slot) = params.and_then(|p| p.iter_mut().find(|p| p.name == *param)) {
                slot.update = UpdateClass::Imperative;
            }
        }
        Ok(())
    }

    /// The scene's view of a static instance: the entity with its place, its name and the
    /// prefab's params; the fields are completed when the prefab is instantiated.
    pub(super) fn pending_instance(
        &self,
        checked: &CheckedEntity,
        instance: &CheckedInstance,
        index: u32,
        symbol: Symbol,
        parent: Option<u32>,
    ) -> Result<Entity, Defect> {
        let path = self
            .file_paths
            .get(&instance.prefab.file)
            .ok_or("a prefab of a module without a path")?;
        let pending = || Field {
            source: Source::Const(Value::Bool(false)),
            origin: Origin::Default,
            span: checked.span,
        };
        Ok(Entity {
            index,
            name: checked.name.clone(),
            symbol,
            parent,
            span: checked.span,
            position: pending(),
            rotation: pending(),
            scale: pending(),
            visible: pending(),
            mesh: None,
            material: None,
            light: None,
            body: None,
            collider: None,
            tag: None,
            particles: None,
            clip: None,
            prefab: Some(PrefabInstance {
                prefab: Symbol::item(path, &instance.prefab_name),
                params: instance
                    .params
                    .iter()
                    .map(|param| NamedValue {
                        name: param.name.clone(),
                        value: Value::from(&param.value),
                    })
                    .collect(),
            }),
        })
    }
}

fn find_child(children: &[CheckedEntity], def: DefId) -> Option<&CheckedEntity> {
    for child in children {
        if child.def == Some(def) {
            return Some(child);
        }
        if let Some(found) = find_child(&child.children, def) {
            return Some(found);
        }
    }
    None
}
