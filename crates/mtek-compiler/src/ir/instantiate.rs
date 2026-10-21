//! Instantiating prefabs (`spec/scenes.md` section 5, decision 0062): a static instance,
//! `entity First: Crate { origin: vec3(0.0, 3.0, 0.0); }`, is a named entity of its scene, so
//! everything downstream of the IR — the resource plan, the manifest, `init`, the events and
//! bindings tables — sees an ordinary entity.
//!
//! The pass copies the prefab's root and descendants into each static instance:
//!
//! * the fields, the mesh and the material instance, with the params of the instance
//!   substituted for the reads of the params in [`Source::Expr`] values;
//! * the prefab's `state`, owned by the instance and named after it
//!   (`src/main.mtek::Demo.First.bounces`);
//! * its lifecycle functions and handlers, owned by the instance, with entity 0 (`self`)
//!   renamed to the instance's static index and the params substituted;
//! * its bindings, numbered after the scene's own and evaluated before them: they read only the
//!   instance itself, its params, constants and `frame`, while a binding of the scene may read
//!   what they write.
//!
//! The scene's `state` and `behaviors` keep their order of `spec/scenes.md` section 10.1: the
//! scene's, then each entity's in stable instance order.

use std::collections::BTreeMap;

use super::lower::ImperativeMark;
use super::model::{
    Behavior, Binding, BindingDep, BindingTarget, Block, BodyTarget, Branch, Expr, ExprKind, Field,
    Item, MatchArm, MaterialInstanceDesc, Module, NamedExpr, NamedValue, Owner, Param, Place,
    PlaceRoot, PlaceStep, PrefabItem, Scene, Source, State, Stmt, Symbol, UpdateClass, Value,
};

/// Instantiate the prefabs of every static instance of `modules`, then apply `marks`.
pub(super) fn instantiate(modules: &mut [Module], marks: &[ImperativeMark]) -> Result<(), String> {
    let prefabs: BTreeMap<Symbol, PrefabItem> = modules
        .iter()
        .flat_map(|module| module.items.iter())
        .filter_map(|item| match item {
            Item::Prefab(prefab) => Some((prefab.symbol.clone(), prefab.as_ref().clone())),
            _ => None,
        })
        .collect();
    for module in modules.iter_mut() {
        for item in &mut module.items {
            if let Item::Scene(scene) = item {
                instantiate_scene(scene, &prefabs, marks)?;
            }
        }
    }
    Ok(())
}

fn instantiate_scene(
    scene: &mut Scene,
    prefabs: &BTreeMap<Symbol, PrefabItem>,
    marks: &[ImperativeMark],
) -> Result<(), String> {
    if scene.entities.iter().all(|entity| entity.prefab.is_none()) {
        return Ok(());
    }
    let mut next_id = u32::try_from(scene.bindings.len()).map_err(|_| "too many bindings")?;
    let mut instance_bindings: Vec<Binding> = Vec::new();
    // Per instance: the range of its bindings in `instance_bindings`.
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    for index in 0..scene.entities.len() {
        let Some(entity) = scene.entities.get(index) else {
            continue;
        };
        let Some(instance) = entity.prefab.clone() else {
            continue;
        };
        let symbol = entity.symbol.clone();
        let instance_name = entity.name.clone();
        let template = prefabs.get(&instance.prefab).ok_or_else(|| {
            format!(
                "the prefab '{}' of the entity '{symbol}' is not a prefab of the program",
                instance.prefab
            )
        })?;
        let declared: Vec<&str> = template.params.iter().map(|p| p.name.as_str()).collect();
        let given: Vec<&str> = instance.params.iter().map(|p| p.name.as_str()).collect();
        if declared != given {
            return Err(format!(
                "the instance '{symbol}' gives the params {given:?}, but '{}' declares {declared:?}",
                template.symbol
            ));
        }
        let static_index = u32::try_from(index).map_err(|_| "too many entities")?;
        let mut bindings = BTreeMap::new();
        for binding in &template.bindings {
            bindings.insert(binding.id, next_id);
            next_id += 1;
        }
        let mut entity_indices = vec![static_index];
        for offset in 0..template.children.len() {
            entity_indices.push(
                u32::try_from(scene.entities.len() + offset).map_err(|_| "too many entities")?,
            );
        }
        let sub = Substitution {
            entities: &entity_indices,
            params: &instance.params,
            bindings: &bindings,
        };
        let template_entity = &template.entity;
        if let Some(entity) = scene.entities.get_mut(index) {
            entity.position = sub.field(&template_entity.position)?;
            entity.rotation = sub.field(&template_entity.rotation)?;
            entity.scale = sub.field(&template_entity.scale)?;
            entity.visible = sub.field(&template_entity.visible)?;
            entity.mesh = template_entity.mesh.clone();
            entity.material = template_entity
                .material
                .as_ref()
                .map(|material| sub.material(material))
                .transpose()?;
            entity.light = None;
            entity.body = template_entity.body.clone();
            entity.collider = template_entity.collider.clone();
        }
        for child in &template.children {
            let mut copy = sub.entity(child)?;
            copy.symbol = instance_symbol(&child.symbol, &template.symbol, &symbol)?;
            let path = child
                .symbol
                .as_str()
                .strip_prefix(template.symbol.as_str())
                .ok_or("a prefab child has an invalid symbol")?;
            copy.name = format!("{instance_name}{path}");
            scene.entities.push(copy);
        }
        for state in &template.state {
            scene.state.push(State {
                name: state.name.clone(),
                symbol: instance_symbol(&state.symbol, &template.symbol, &symbol)?,
                ty: state.ty.clone(),
                owner: sub.owner(state.owner),
                shared: false,
                persist: None,
                stored_type: None,
                init: sub.expr(&state.init)?,
                span: state.span,
            });
        }
        for behavior in &template.behaviors {
            scene
                .behaviors
                .push(sub.behavior(behavior, &template.symbol, &symbol)?);
        }
        let first = instance_bindings.len();
        for binding in &template.bindings {
            instance_bindings.push(sub.binding(binding, &scene.symbol)?);
        }
        ranges.push(first..instance_bindings.len());
    }
    // The instances' bindings come first in the evaluation order, in the order of their
    // instances and, within an instance, of the prefab.
    let shift = u32::try_from(instance_bindings.len()).map_err(|_| "too many bindings")?;
    let mut order = 0;
    for range in ranges {
        let Some(own) = instance_bindings.get_mut(range) else {
            continue;
        };
        let mut positions: Vec<usize> = (0..own.len()).collect();
        positions.sort_by_key(|&i| own.get(i).map_or(0, |b| b.order));
        for position in positions {
            if let Some(binding) = own.get_mut(position) {
                binding.order = order;
                order += 1;
            }
        }
    }
    for binding in &mut scene.bindings {
        binding.order += shift;
    }
    scene.bindings.extend(instance_bindings);
    // Remap appended assembly parts into depth-first pre-order, including all references in
    // existing scene code. Apply the scene's material writes before indices change.
    for mark in marks.iter().filter(|mark| mark.scene == scene.symbol) {
        let params = scene
            .entities
            .get_mut(mark.entity as usize)
            .and_then(|entity| entity.material.as_mut())
            .map(|material| &mut material.params);
        if let Some(slot) = params.and_then(|p| p.iter_mut().find(|p| p.name == mark.param)) {
            slot.update = UpdateClass::Imperative;
        }
    }
    reorder_entities(scene)?;
    // Stable instance order (`spec/scenes.md` section 10.1): the scene's, then each entity's.
    let key = |owner: Owner| match owner {
        Owner::Scene => 0,
        Owner::Entity { index } => index.saturating_add(1),
    };
    scene.state.sort_by_key(|state| key(state.owner));
    scene.behaviors.sort_by_key(|behavior| key(behavior.owner));
    Ok(())
}

/// A copied member keeps its path beneath the instance, including child entity names.
fn instance_symbol(symbol: &Symbol, prefab: &Symbol, instance: &Symbol) -> Result<Symbol> {
    let suffix = symbol
        .as_str()
        .strip_prefix(prefab.as_str())
        .and_then(|rest| rest.strip_prefix('.'))
        .ok_or_else(|| format!("'{symbol}' is not a member of '{prefab}'"))?;
    Ok(instance.child(suffix))
}

fn reorder_entities(scene: &mut Scene) -> Result<()> {
    let mut children = vec![Vec::new(); scene.entities.len()];
    let mut roots = Vec::new();
    for entity in &scene.entities {
        if let Some(parent) = entity.parent {
            children
                .get_mut(parent as usize)
                .ok_or("invalid entity parent")?
                .push(entity.index);
        } else {
            roots.push(entity.index);
        }
    }
    let mut order = Vec::with_capacity(scene.entities.len());
    let mut stack: Vec<_> = roots.into_iter().rev().collect();
    while let Some(index) = stack.pop() {
        order.push(index);
        stack.extend(children[index as usize].iter().rev().copied());
    }
    let mut indices = vec![0; order.len()];
    for (new, &old) in order.iter().enumerate() {
        indices[old as usize] = u32::try_from(new).map_err(|_| "too many entities")?;
    }
    let bindings = scene.bindings.iter().map(|b| (b.id, b.id)).collect();
    let sub = Substitution {
        entities: &indices,
        params: &[],
        bindings: &bindings,
    };
    scene.entities = order
        .iter()
        .map(|&old| sub.entity(&scene.entities[old as usize]))
        .collect::<Result<_>>()?;
    for state in &mut scene.state {
        state.owner = sub.owner(state.owner);
        state.init = sub.expr(&state.init)?;
    }
    scene.behaviors = scene
        .behaviors
        .iter()
        .map(|b| sub.behavior(b, &scene.symbol, &scene.symbol))
        .collect::<Result<_>>()?;
    scene.bindings = scene
        .bindings
        .iter()
        .map(|b| sub.binding(b, &scene.symbol))
        .collect::<Result<_>>()?;
    Ok(())
}

/// The constant `vec2(..)`, `vec3(..)` or `vec4(..)` that `args` (all constants, since a param was
/// substituted for a read) build, as the checker folds it: the components of the arguments in
/// order, or one `f32` repeated. `None` for any other call, or for arguments that are not
/// constants of `f32` and vectors of `f32`.
fn vector_constant(ty: &str, args: &[Expr]) -> Option<Value> {
    let dimension = match ty {
        "vec2" => 2,
        "vec3" => 3,
        "vec4" => 4,
        _ => return None,
    };
    let mut components: Vec<f32> = Vec::with_capacity(dimension);
    for arg in args {
        let ExprKind::Const { value } = &arg.kind else {
            return None;
        };
        match value {
            Value::F32(x) => components.push(*x),
            Value::Vec2(v) => components.extend(v),
            Value::Vec3(v) => components.extend(v),
            Value::Vec4(v) => components.extend(v),
            _ => return None,
        }
    }
    if let [splat] = components.as_slice() {
        components = vec![*splat; dimension];
    }
    match (dimension, components.as_slice()) {
        (2, &[x, y]) => Some(Value::Vec2([x, y])),
        (3, &[x, y, z]) => Some(Value::Vec3([x, y, z])),
        (4, &[x, y, z, w]) => Some(Value::Vec4([x, y, z, w])),
        _ => None,
    }
}

/// The index and parameter substitution for a copied prefab or a scene reordered after expansion.
struct Substitution<'a> {
    /// Template-local index to scene index, including every assembly part.
    entities: &'a [u32],
    /// The instance's param values, in the prefab's order.
    params: &'a [NamedValue],
    /// The prefab's binding ids and the scene's ids of the instance's copies.
    bindings: &'a BTreeMap<u32, u32>,
}

type Result<T, E = String> = std::result::Result<T, E>;

impl Substitution<'_> {
    fn owner(&self, owner: Owner) -> Owner {
        match owner {
            Owner::Entity { index } => Owner::Entity {
                index: self.index(index),
            },
            other => other,
        }
    }

    /// `entity` of the prefab's IR (0 is `self`) as a static index of the scene.
    fn index(&self, entity: u32) -> u32 {
        self.entities
            .get(entity as usize)
            .copied()
            .unwrap_or(entity)
    }

    fn entity(&self, entity: &super::model::Entity) -> Result<super::model::Entity> {
        let mut copy = entity.clone();
        copy.index = self.index(entity.index);
        copy.parent = entity.parent.map(|parent| self.index(parent));
        copy.position = self.field(&entity.position)?;
        copy.rotation = self.field(&entity.rotation)?;
        copy.scale = self.field(&entity.scale)?;
        copy.visible = self.field(&entity.visible)?;
        copy.material = entity
            .material
            .as_ref()
            .map(|m| self.material(m))
            .transpose()?;
        Ok(copy)
    }

    fn binding_id(&self, id: u32) -> Result<u32> {
        self.bindings
            .get(&id)
            .copied()
            .ok_or_else(|| format!("a prefab field names the binding {id}, which it does not have"))
    }

    fn source(&self, source: &Source) -> Result<Source> {
        Ok(match source {
            Source::Const(value) => Source::Const(value.clone()),
            Source::Bound(id) => Source::Bound(self.binding_id(*id)?),
            // A value that was a param is now the instance's constant, like any entity's.
            Source::Expr(expr) => match self.expr(expr)? {
                Expr {
                    kind: ExprKind::Const { value },
                    ..
                } => Source::Const(value),
                expr => Source::Expr(Box::new(expr)),
            },
        })
    }

    fn field(&self, field: &Field) -> Result<Field> {
        Ok(Field {
            source: self.source(&field.source)?,
            origin: field.origin,
            span: field.span,
        })
    }

    fn material(&self, material: &MaterialInstanceDesc) -> Result<MaterialInstanceDesc> {
        let params = material
            .params
            .iter()
            .map(|param| {
                Ok(Param {
                    name: param.name.clone(),
                    ty: param.ty.clone(),
                    source: self.source(&param.source)?,
                    update: param.update,
                    span: param.span,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(MaterialInstanceDesc {
            material: material.material.clone(),
            params,
            origin: material.origin,
            span: material.span,
        })
    }

    fn behavior(
        &self,
        behavior: &Behavior,
        prefab: &Symbol,
        instance: &Symbol,
    ) -> Result<Behavior> {
        Ok(Behavior {
            kind: behavior.kind.clone(),
            owner: self.owner(behavior.owner),
            symbol: instance_symbol(&behavior.symbol, prefab, instance)?,
            locals: behavior.locals.clone(),
            body: self.block(&behavior.body)?,
            span: behavior.span,
        })
    }

    fn binding(&self, binding: &Binding, scene: &Symbol) -> Result<Binding> {
        let id = self.binding_id(binding.id)?;
        let target = match &binding.target {
            BindingTarget::Transform { entity, field } => BindingTarget::Transform {
                entity: self.index(*entity),
                field: field.clone(),
            },
            BindingTarget::Visible { entity } => BindingTarget::Visible {
                entity: self.index(*entity),
            },
            BindingTarget::Param { entity, name } => BindingTarget::Param {
                entity: self.index(*entity),
                name: name.clone(),
            },
            BindingTarget::Camera { field } => BindingTarget::Camera {
                field: field.clone(),
            },
            BindingTarget::Light { entity, field } => BindingTarget::Light {
                entity: self.index(*entity),
                field: field.clone(),
            },
        };
        let deps = binding
            .deps
            .iter()
            .map(|dep| match dep {
                BindingDep::State { name } => BindingDep::State { name: name.clone() },
                BindingDep::Frame { name } => BindingDep::Frame { name: name.clone() },
                BindingDep::EntityField { entity, field } => BindingDep::EntityField {
                    entity: self.index(*entity),
                    field: field.clone(),
                },
                BindingDep::EntityState { entity, name } => BindingDep::EntityState {
                    entity: self.index(*entity),
                    name: name.clone(),
                },
                BindingDep::Param { entity, name } => BindingDep::Param {
                    entity: self.index(*entity),
                    name: name.clone(),
                },
                BindingDep::Light { entity, field } => BindingDep::Light {
                    entity: self.index(*entity),
                    field: field.clone(),
                },
            })
            .collect();
        Ok(Binding {
            id,
            symbol: scene.child(&format!("bind_{id}")),
            target,
            deps,
            order: binding.order,
            ty: binding.ty.clone(),
            expr: self.expr(&binding.expr)?,
            span: binding.span,
        })
    }

    fn block(&self, block: &Block) -> Result<Block> {
        Ok(Block {
            stmts: block
                .stmts
                .iter()
                .map(|stmt| self.stmt(stmt))
                .collect::<Result<_>>()?,
            span: block.span,
        })
    }

    fn stmt(&self, stmt: &Stmt) -> Result<Stmt> {
        Ok(match stmt {
            Stmt::Let { local, value, span } => Stmt::Let {
                local: *local,
                value: self.expr(value)?,
                span: *span,
            },
            Stmt::Var { local, value, span } => Stmt::Var {
                local: *local,
                value: self.expr(value)?,
                span: *span,
            },
            Stmt::Const {
                name,
                ty,
                value,
                span,
            } => Stmt::Const {
                name: name.clone(),
                ty: ty.clone(),
                value: value.clone(),
                span: *span,
            },
            Stmt::Assign {
                target,
                op,
                value,
                span,
            } => Stmt::Assign {
                target: self.place(target)?,
                op,
                value: self.expr(value)?,
                span: *span,
            },
            Stmt::If {
                branches,
                otherwise,
                span,
            } => Stmt::If {
                branches: branches
                    .iter()
                    .map(|branch| {
                        Ok(Branch {
                            cond: self.expr(&branch.cond)?,
                            body: self.block(&branch.body)?,
                        })
                    })
                    .collect::<Result<_>>()?,
                otherwise: otherwise.as_ref().map(|b| self.block(b)).transpose()?,
                span: *span,
            },
            Stmt::ForRange {
                local,
                start,
                end,
                body,
                span,
            } => Stmt::ForRange {
                local: *local,
                start: self.expr(start)?,
                end: self.expr(end)?,
                body: self.block(body)?,
                span: *span,
            },
            Stmt::ForEach {
                local,
                array,
                body,
                span,
            } => Stmt::ForEach {
                local: *local,
                array: self.expr(array)?,
                body: self.block(body)?,
                span: *span,
            },
            Stmt::While { cond, body, span } => Stmt::While {
                cond: self.expr(cond)?,
                body: self.block(body)?,
                span: *span,
            },
            Stmt::Timer {
                every,
                seconds,
                body,
                span,
            } => Stmt::Timer {
                every: *every,
                seconds: self.expr(seconds)?,
                body: self.block(body)?,
                span: *span,
            },
            Stmt::Return { value, span } => Stmt::Return {
                value: value.as_ref().map(|v| self.expr(v)).transpose()?,
                span: *span,
            },
            Stmt::Break { span } => Stmt::Break { span: *span },
            Stmt::Continue { span } => Stmt::Continue { span: *span },
            Stmt::Block { body } => Stmt::Block {
                body: self.block(body)?,
            },
            Stmt::Expr { expr, span } => Stmt::Expr {
                expr: self.expr(expr)?,
                span: *span,
            },
        })
    }

    fn place(&self, place: &Place) -> Result<Place> {
        let root = match &place.root {
            PlaceRoot::Local {
                local,
                name,
                ty,
                span,
            } => PlaceRoot::Local {
                local: *local,
                name: name.clone(),
                ty: ty.clone(),
                span: *span,
            },
            PlaceRoot::State {
                owner,
                name,
                ty,
                span,
            } => PlaceRoot::State {
                owner: self.owner(*owner),
                name: name.clone(),
                ty: ty.clone(),
                span: *span,
            },
            PlaceRoot::EntityField {
                entity,
                field,
                ty,
                span,
            } => PlaceRoot::EntityField {
                entity: self.index(*entity),
                field: field.clone(),
                ty: ty.clone(),
                span: *span,
            },
            PlaceRoot::CameraField {
                camera,
                field,
                ty,
                span,
            } => PlaceRoot::CameraField {
                camera: camera.clone(),
                field: field.clone(),
                ty: ty.clone(),
                span: *span,
            },
            PlaceRoot::InstanceParam {
                entity,
                param,
                ty,
                span,
            } => PlaceRoot::InstanceParam {
                entity: self.index(*entity),
                param: param.clone(),
                ty: ty.clone(),
                span: *span,
            },
            PlaceRoot::LightField {
                entity,
                field,
                ty,
                span,
            } => PlaceRoot::LightField {
                entity: self.index(*entity),
                field: field.clone(),
                ty: ty.clone(),
                span: *span,
            },
        };
        let steps = place
            .steps
            .iter()
            .map(|step| {
                Ok(match step {
                    PlaceStep::Field {
                        field,
                        index,
                        ty,
                        span,
                    } => PlaceStep::Field {
                        field: field.clone(),
                        index: *index,
                        ty: ty.clone(),
                        span: *span,
                    },
                    PlaceStep::Index { index, ty, span } => PlaceStep::Index {
                        index: self.expr(index)?,
                        ty: ty.clone(),
                        span: *span,
                    },
                    PlaceStep::Component {
                        component,
                        ty,
                        span,
                    } => PlaceStep::Component {
                        component: *component,
                        ty: ty.clone(),
                        span: *span,
                    },
                })
            })
            .collect::<Result<_>>()?;
        Ok(Place {
            root,
            steps,
            ty: place.ty.clone(),
            span: place.span,
        })
    }

    fn named(&self, fields: &[NamedExpr]) -> Result<Vec<NamedExpr>> {
        fields
            .iter()
            .map(|field| {
                Ok(NamedExpr {
                    name: field.name.clone(),
                    value: self.expr(&field.value)?,
                })
            })
            .collect()
    }

    fn exprs(&self, items: &[Expr]) -> Result<Vec<Expr>> {
        items.iter().map(|item| self.expr(item)).collect()
    }

    fn boxed(&self, expr: &Expr) -> Result<Box<Expr>> {
        self.expr(expr).map(Box::new)
    }

    /// The target of a body command or property for the instance.
    fn body_target(&self, target: &BodyTarget) -> Result<BodyTarget> {
        Ok(match target {
            BodyTarget::Entity { entity } => BodyTarget::Entity {
                entity: self.index(*entity),
            },
            BodyTarget::Ref { target } => BodyTarget::Ref {
                target: self.boxed(target)?,
            },
        })
    }

    /// `expr` for the instance: the reads of the prefab's params are the instance's constants and
    /// entity 0 is the instance.
    fn expr(&self, expr: &Expr) -> Result<Expr> {
        let kind = match &expr.kind {
            ExprKind::Param { name, .. } => {
                let given = self
                    .params
                    .iter()
                    .find(|param| param.name == *name)
                    .ok_or_else(|| format!("the instance gives no value for the param '{name}'"))?;
                ExprKind::Const {
                    value: given.value.clone(),
                }
            }
            ExprKind::Const { value } => ExprKind::Const {
                value: value.clone(),
            },
            ExprKind::Local { local, name } => ExprKind::Local {
                local: *local,
                name: name.clone(),
            },
            ExprKind::Unary { op, operand } => ExprKind::Unary {
                op,
                operand: self.boxed(operand)?,
            },
            ExprKind::Binary { op, lhs, rhs } => ExprKind::Binary {
                op,
                lhs: self.boxed(lhs)?,
                rhs: self.boxed(rhs)?,
            },
            ExprKind::Call { function, args } => ExprKind::Call {
                function: function.clone(),
                args: self.exprs(args)?,
            },
            ExprKind::Builtin { function, args } => ExprKind::Builtin {
                function: function.clone(),
                args: self.exprs(args)?,
            },
            ExprKind::Construct { args } => {
                let args = self.exprs(args)?;
                match vector_constant(&expr.ty, &args) {
                    Some(value) => ExprKind::Const { value },
                    None => ExprKind::Construct { args },
                }
            }
            ExprKind::Convert { arg } => ExprKind::Convert {
                arg: self.boxed(arg)?,
            },
            ExprKind::Components { base, components } => ExprKind::Components {
                base: self.boxed(base)?,
                components: components.clone(),
            },
            ExprKind::Field { base, field, index } => ExprKind::Field {
                base: self.boxed(base)?,
                field: field.clone(),
                index: *index,
            },
            ExprKind::Index { base, index } => ExprKind::Index {
                base: self.boxed(base)?,
                index: self.boxed(index)?,
            },
            ExprKind::Array { elements } => ExprKind::Array {
                elements: self.exprs(elements)?,
            },
            ExprKind::Struct { fields } => ExprKind::Struct {
                fields: self.named(fields)?,
            },
            ExprKind::Descriptor { schema, fields } => ExprKind::Descriptor {
                schema: schema.clone(),
                fields: self.named(fields)?,
            },
            ExprKind::Material { material, params } => ExprKind::Material {
                material: material.clone(),
                params: self.named(params)?,
            },
            ExprKind::PrefabLiteral { prefab, params } => ExprKind::PrefabLiteral {
                prefab: prefab.clone(),
                params: self.named(params)?,
            },
            ExprKind::EntityRef { entity } => ExprKind::EntityRef {
                entity: self.index(*entity),
            },
            ExprKind::Match {
                scrutinee,
                arms,
                otherwise,
            } => ExprKind::Match {
                scrutinee: self.boxed(scrutinee)?,
                arms: arms
                    .iter()
                    .map(|arm| {
                        Ok(MatchArm {
                            values: arm.values.clone(),
                            value: self.expr(&arm.value)?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?,
                otherwise: otherwise.as_ref().map(|e| self.boxed(e)).transpose()?,
            },
            ExprKind::State { owner, name } => ExprKind::State {
                owner: self.owner(*owner),
                name: name.clone(),
            },
            ExprKind::EntityField { entity, field } => ExprKind::EntityField {
                entity: self.index(*entity),
                field: field.clone(),
            },
            ExprKind::CameraField { camera, field } => ExprKind::CameraField {
                camera: camera.clone(),
                field: field.clone(),
            },
            ExprKind::InstanceParam { entity, param } => ExprKind::InstanceParam {
                entity: self.index(*entity),
                param: param.clone(),
            },
            ExprKind::LightField { entity, field } => ExprKind::LightField {
                entity: self.index(*entity),
                field: field.clone(),
            },
            ExprKind::BodyCommand {
                target,
                command,
                args,
            } => ExprKind::BodyCommand {
                target: self.body_target(target)?,
                command: command.clone(),
                args: self.exprs(args)?,
            },
            ExprKind::BodyProperty { target, property } => ExprKind::BodyProperty {
                target: self.body_target(target)?,
                property: property.clone(),
            },
            ExprKind::Frame { member } => ExprKind::Frame {
                member: member.clone(),
            },
            ExprKind::EnumMember {
                enumeration,
                member,
                code,
            } => ExprKind::EnumMember {
                enumeration: enumeration.clone(),
                member: member.clone(),
                code: code.clone(),
            },
        };
        Ok(Expr {
            kind,
            ty: expr.ty.clone(),
            span: expr.span,
        })
    }
}
