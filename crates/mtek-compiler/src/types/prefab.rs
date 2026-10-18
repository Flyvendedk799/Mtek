//! Prefabs and their static instances (`spec/scenes.md` section 5, task M5-01, decision 0062).
//!
//! * **The declaration.** A prefab body has the members of an entity body and `param`s. It is
//!   checked once, in its own module, before any scene (so that an instance finds it): its params
//!   (type, default), its fields, constants, `state`, lifecycle functions, handlers and `bind`s,
//!   all against `self`, the one entity it describes. A nested `entity` is `E5040`. A field value
//!   may read the prefab's params, constants and state ([`Checker::prefab_field_value`]): the
//!   prefab's `init` computes it for each instance. A scene name is not in scope (`E2003`, the
//!   resolver's), and a `light` is `E5110` (`types/scene.rs`).
//! * **The summary.** What an instance in any module needs of the declaration is [`PrefabInfo`]:
//!   the params, the state, the params of the material instance and the bound fields.
//! * **The instance.** `entity First: Crate { origin: vec3(0.0, 3.0, 0.0); }` is a named entity of
//!   the scene. Its body sets only params (`E5042` for anything else, with the params listed),
//!   each given once with a value of the param's type that is a constant expression, and every
//!   param without a default is given (`E5041`). The scene reads and writes its fields, state and
//!   material params like those of any entity.

use super::check::Checker;
use super::consteval::Folded;
use super::scene::{CheckedInstance, CheckedParam, FieldOrigin};
use super::ty::TyId;
use super::value::ConstValue;
use super::{
    CpuBody, CpuBodyKind, EntityPhysics, LiteralParam, NonConstant, NonConstantKind, PrefabInfo,
    PrefabKey, PrefabLiteral, PrefabParam,
};
use crate::diagnostics::{Code, Diagnostic};
use crate::project::edit_distance;
use crate::resolve::gate::construct_implemented;
use crate::resolve::{Construct, DefId, DefKind, Res};
use crate::source::Span;
use crate::stdlib::TypeRef;
use crate::syntax::ast::{
    DescField, EntityDecl, EntityMember, Expr, ExprKind, FieldInit, FieldValue, Ident, NodeId,
    PrefabDecl,
};

/// What the scene checks know of the prefab behind one static instance, by the instance's
/// declaration: the facts that make `First.bounces`, `First.material.tint` and the single-writer
/// rule work for an entity whose body the prefab declares.
#[derive(Clone, Debug)]
pub(super) struct InstanceFacts {
    pub(super) prefab_name: String,
    /// The prefab's `state`.
    pub(super) states: Vec<(String, TyId)>,
    /// The params of the prefab's user material instance.
    pub(super) material_params: Option<Vec<(String, TyId)>>,
    /// The entity fields the prefab binds, with the `bind`.
    pub(super) bound_fields: Vec<(String, Span)>,
    /// The material params the prefab binds, with the `bind`.
    pub(super) bound_params: Vec<(String, Span)>,
    /// The result of checking the instance's body.
    pub(super) checked: Option<CheckedInstance>,
}

/// One `name: value;` of an instance body that names a param.
struct GivenParam {
    name: String,
    name_span: Span,
    /// The whole member.
    member: Span,
    /// The value expression.
    node: NodeId,
    /// The folded value, if it is a sound constant.
    value: Option<ConstValue>,
}

pub(super) fn strip_parens(expr: &Expr) -> &Expr {
    let mut expr = expr;
    while let ExprKind::Paren(inner) = &expr.kind {
        expr = inner;
    }
    expr
}

impl<'a> Checker<'a> {
    /// The identity of the prefab declared as `def` in this module.
    fn prefab_key(&self, def: DefId) -> Option<PrefabKey> {
        let declared = self.res.def(def)?;
        Some(PrefabKey {
            file: declared.span.file,
            def,
        })
    }

    // ----- the declaration -------------------------------------------------------------------

    /// Remember the body constants of a prefab, which the dependency order of the constants
    /// needs.
    pub(super) fn collect_prefab_constants(&mut self, decl: &'a PrefabDecl) {
        for member in &decl.members {
            if let EntityMember::Const(constant) = member {
                self.collect_constant(constant);
            }
        }
    }

    /// The params of the prefab `decl` (types, defaults), before any prefab body is checked: a
    /// `spawn` in any body, of this prefab or another, finds them (decision 0064).
    pub(super) fn prefab_signature(&mut self, decl: &PrefabDecl) {
        let (Some(def), true) = (
            self.res.def_of(decl.id),
            construct_implemented(Construct::Prefab),
        ) else {
            return;
        };
        let previous = self.current_prefab.replace(def);
        let params = self.prefab_params(decl);
        self.current_prefab = previous;
        self.prefab_params.insert(def, params);
    }

    /// Check the prefab `decl`: nested entities (`E5040`), params, fields, constants, state,
    /// bindings, lifecycle functions and handlers, then record its [`PrefabInfo`].
    pub(super) fn prefab(&mut self, decl: &PrefabDecl) {
        let (Some(def), true) = (
            self.res.def_of(decl.id),
            construct_implemented(Construct::Prefab),
        ) else {
            return;
        };
        let Some(key) = self.prefab_key(def) else {
            return;
        };
        self.current_prefab = Some(def);
        self.nested_entities(decl);
        let params = self.prefab_params.get(&def).cloned().unwrap_or_default();
        self.declare_prefab_states(decl, def);
        let schema = self.registry.declaration_schemas.entity;
        for member in &decl.members {
            match member {
                EntityMember::Field(field) if construct_implemented(Construct::EntityField) => {
                    self.allow_param_bind = self.is_material_field(&field.name.name)
                        || self.is_light_field(&field.name.name);
                    self.schema_field(schema, field);
                    self.allow_param_bind = false;
                    self.note_entity_material(Some(def), field);
                    self.note_entity_light(Some(def), field);
                    self.note_entity_physics(Some(def), field);
                }
                EntityMember::Const(constant) if construct_implemented(Construct::BodyConst) => {
                    self.const_decl(constant);
                }
                EntityMember::State(state) if construct_implemented(Construct::State) => {
                    self.state_init(state, Some(def));
                }
                // Params are checked above; nested entities were reported; lifecycle functions
                // and handlers come after the bindings.
                _ => {}
            }
        }
        self.note_default_material(Some(def), &decl.members);
        self.prefab_binds(decl);
        self.prefab_bodies(decl, def);
        self.binding_conflicts(Some(def));
        self.current_prefab = None;

        let mut states: Vec<_> = self
            .out
            .states
            .values()
            .filter(|state| state.owner == Some(def))
            .collect();
        states.sort_by_key(|state| state.index);
        let states = states
            .into_iter()
            .map(|state| (state.name.clone(), state.ty))
            .collect();
        let material_params = self
            .out
            .entity_materials
            .get(&def)
            .copied()
            .map(|instance| self.instance_params(instance));
        let mut bound_fields = Vec::new();
        let mut bound_params = Vec::new();
        for binding in self.out.bindings.iter().filter(|b| b.scene == Some(def)) {
            match &binding.target {
                super::BindTarget::Field { field, .. } => {
                    bound_fields.push((field.clone(), binding.span));
                }
                super::BindTarget::MaterialParam { param, .. } => {
                    bound_params.push((param.clone(), binding.span));
                }
                super::BindTarget::LightField { .. } => {}
            }
        }
        self.out.prefabs.insert(
            def,
            PrefabInfo {
                name: decl.name.name.clone(),
                key,
                name_span: decl.name.span,
                span: decl.span,
                params,
                states,
                material_params,
                physics: self.physics_of(def),
                bound_fields,
                bound_params,
            },
        );
    }

    /// `E5040`: a prefab describes one entity, so it contains no `entity`.
    fn nested_entities(&mut self, decl: &PrefabDecl) {
        for member in &decl.members {
            let EntityMember::Entity(child) = member else {
                continue;
            };
            self.report(
                Diagnostic::new(
                    Code::E5040,
                    format!(
                        "The prefab '{}' declares the entity '{}', but a prefab describes exactly one entity.",
                        decl.name.name, child.name.name
                    ),
                )
                .at(child.name.span)
                .related(decl.name.span, "the prefab is declared here")
                .note("prefabs with children are not part of v0.1")
                .help("make the child a prefab of its own and declare both as entities of the scene, or declare the child in the scene"),
            );
        }
    }

    /// The params of `decl`: their types and defaults (constant expressions of the param's type,
    /// `E4031` otherwise).
    fn prefab_params(&mut self, decl: &PrefabDecl) -> Vec<PrefabParam> {
        let mut params = Vec::new();
        let mut declared = Vec::new();
        for member in &decl.members {
            let EntityMember::Param(param) = member else {
                continue;
            };
            let ty = self.annotation(&param.ty);
            let param_def = self.res.def_of(param.id);
            if let Some(param_def) = param_def {
                self.out.locals.insert(param_def, ty);
            }
            params.push(PrefabParam {
                name: param.name.name.clone(),
                def: param_def,
                ty,
                default: None,
                has_default: param.default.is_some(),
                name_span: param.name.span,
                span: param.span,
            });
            declared.push(param);
        }
        // Defaults after every type: a default naming another param is not constant (`E4031`),
        // not unknown.
        for (index, param) in declared.iter().enumerate() {
            let (Some(default), Some(ty)) = (&param.default, params.get(index).map(|p| p.ty))
            else {
                continue;
            };
            let value = self.prefab_param_default(&decl.name.name, &param.name, ty, default);
            if let Some(slot) = params.get_mut(index) {
                slot.default = value;
            }
        }
        params
    }

    /// The default of the param `name` of type `ty`: a constant expression of that type
    /// (`E4031`).
    fn prefab_param_default(
        &mut self,
        prefab: &str,
        name: &Ident,
        ty: TyId,
        default: &Expr,
    ) -> Option<ConstValue> {
        let error = self.out.interner.is_error(ty);
        let actual = self.check(default, (!error).then_some(ty));
        let folded = self.fold(default);
        if let Folded::NotConstant(reason) = &folded {
            self.report(
                Diagnostic::new(
                    Code::E4031,
                    format!(
                        "The default of the param '{}' of prefab {prefab} is not a constant expression: {}.",
                        name.name, reason.reason
                    ),
                )
                .at(reason.span)
                .note("a default may use only literals, constants, operators, conversions, constructors and const-eligible built-in functions"),
            );
            return None;
        }
        if error || self.out.interner.is_error(actual) {
            return None;
        }
        if !self.out.interner.assignable(actual, ty) {
            let (expected, got) = (self.display(ty), self.display(actual));
            self.report(
                Diagnostic::new(
                    Code::E4031,
                    format!(
                        "The default of the param '{}' of prefab {prefab} must have type {expected}, but it has type {got}.",
                        name.name
                    ),
                )
                .at(default.span)
                .expected(expected)
                .actual(got),
            );
            return None;
        }
        match folded {
            Folded::Value(value) => Some(value),
            Folded::NotConstant(_) | Folded::Unknown => None,
        }
    }

    /// Give every `state` of `decl` its type, so that a body can read state declared after it.
    fn declare_prefab_states(&mut self, decl: &PrefabDecl, def: DefId) {
        let mut index = 0;
        for member in &decl.members {
            if let EntityMember::State(state) = member {
                self.declare_state(state, Some(def), index);
                index += 1;
            }
        }
    }

    /// Check every lifecycle function and handler of `decl`.
    fn prefab_bodies(&mut self, decl: &PrefabDecl, def: DefId) {
        let label = format!("prefab '{}'", decl.name.name);
        let mut seen = std::collections::BTreeMap::new();
        for member in &decl.members {
            match member {
                EntityMember::Lifecycle(function) => {
                    self.lifecycle_body(function, Some(def), Some(def), &label, &mut seen);
                }
                EntityMember::Handler(handler) => {
                    self.handler_body(handler, Some(def), Some(def), &label);
                }
                _ => {}
            }
        }
    }

    /// The value of the field `field` of a prefab, typed and folded as a CPU root body: it may
    /// read the prefab's params, constants and state and call functions, so the functions it
    /// calls are reachable CPU code. The `material` of a prefab may have params that are not
    /// constant ([`Checker::fold_descriptor`] records them).
    pub(super) fn prefab_field_value(
        &mut self,
        field: &FieldInit,
        value: &Expr,
        expected: Option<TyId>,
    ) {
        let name = field.name.name.clone();
        self.start_body(
            format!("The initialiser of the field '{name}'"),
            name.clone(),
            TyId::UNIT,
            None,
        );
        if self.is_material_field(&name) {
            self.dynamic_descriptors.insert(strip_parens(value).id);
        }
        self.check(value, expected);
        self.fold_root(value);
        let facts = self.body.take().map(|b| b.facts).unwrap_or_default();
        self.out.cpu_bodies.push(CpuBody {
            kind: CpuBodyKind::FieldInit,
            node: field.id,
            owner: self.current_prefab,
            label: format!("the initialiser of the field '{name}'"),
            span: field.span,
            facts,
        });
    }

    /// The param `name` of the descriptor literal `descriptor` has a value `node` that is not a
    /// constant expression. In the `material` of a prefab that is fine unless it reads a field
    /// of the entity (`E5081`, the scene checks'): the prefab's `init` computes it, and the
    /// descriptor folds with `stand_in` for it. `None` where the value must be constant.
    pub(super) fn dynamic_param(
        &mut self,
        descriptor: NodeId,
        name: &str,
        node: NodeId,
        reason: &NonConstant,
        stand_in: Option<ConstValue>,
    ) -> Option<ConstValue> {
        if reason.kind == NonConstantKind::ObjectField
            || !self.dynamic_descriptors.contains(&descriptor)
        {
            return None;
        }
        let stand_in = stand_in?;
        let params = self.out.init_params.entry(descriptor).or_default();
        if !params.iter().any(|(known, _)| known == name) {
            params.push((name.to_owned(), node));
        }
        Some(stand_in)
    }

    /// `Crate { origin: … }`: a prefab literal builds a dynamic instance and is the argument of
    /// `spawn` (`spec/scenes.md` section 9, decision 0064); a static instance is the declaration
    /// `entity Name: Crate { .. }`. It sets only params (`E5042`), each once (`E5002`) with a
    /// value of the param's type (`E3102`) that may be computed at run time, and every param
    /// without a default (`E5041`). Anywhere but as the argument of `spawn` it is `E3001`.
    pub(super) fn prefab_literal(
        &mut self,
        expr: &Expr,
        name: &Ident,
        id: DefId,
        fields: &[DescField],
    ) -> TyId {
        let Some((key, prefab, params, declared)) = self.literal_prefab(id) else {
            self.literal_values(fields);
            return TyId::ERROR;
        };
        if self.spawn_argument != Some(expr.id) {
            self.literal_values(fields);
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!(
                        "The prefab literal `{prefab} {{ .. }}` is not a value: it can only be the argument of `spawn`."
                    ),
                )
                .at(expr.span)
                .expected("a value")
                .actual("a prefab literal")
                .help(format!("create the instance with `spawn({prefab} {{ .. }})` in a lifecycle function or an event handler, or declare a static instance: `entity Name: {prefab} {{ param: value; }}`")),
            );
            return TyId::ERROR;
        }
        let mut given: Vec<(String, Span, NodeId)> = Vec::new();
        let mut ok = true;
        for field in fields {
            let value = match &field.value {
                FieldValue::Expr(value) => &**value,
                FieldValue::Bind(bind) => {
                    ok = false;
                    self.bind_not_allowed(bind, "as the value of a prefab param");
                    continue;
                }
            };
            let Some(param) = params.iter().find(|p| p.name == field.name.name) else {
                ok = false;
                self.unknown_literal_param(&field.name, &prefab, declared, &params);
                self.check(value, None);
                continue;
            };
            if let Some((_, first, _)) = given.iter().find(|(known, _, _)| *known == param.name) {
                ok = false;
                let first = *first;
                self.report(
                    Diagnostic::new(
                        Code::E5002,
                        format!(
                            "The param '{}' of prefab {prefab} is set twice.",
                            param.name
                        ),
                    )
                    .at(field.name.span)
                    .related(first, format!("'{}' is first set here", param.name))
                    .help("remove one of the two"),
                );
                self.check(value, Some(param.ty));
                continue;
            }
            let actual = self.check(value, Some(param.ty));
            ok &= self.param_value_type(&prefab, param, value, actual);
            given.push((param.name.clone(), field.name.span, value.id));
        }
        for param in &params {
            if !param.has_default && !given.iter().any(|(name, _, _)| *name == param.name) {
                ok = false;
                self.report(
                    Diagnostic::new(
                        Code::E5041,
                        format!(
                            "Missing required parameter '{}' for prefab {prefab}.",
                            param.name
                        ),
                    )
                    .at(name.span)
                    .related(
                        param.name_span,
                        format!("the param '{}' is declared here", param.name),
                    )
                    .note(format!("the param '{}' has no default", param.name))
                    .help(format!("add `{}: …;` to the literal", param.name)),
                );
            }
        }
        if ok {
            let params = params
                .iter()
                .map(|param| LiteralParam {
                    name: param.name.clone(),
                    ty: param.ty,
                    value: given
                        .iter()
                        .find(|(name, _, _)| *name == param.name)
                        .map(|(_, _, node)| *node),
                    default: param.default.clone(),
                })
                .collect();
            self.out.prefab_literals.insert(
                expr.id,
                PrefabLiteral {
                    key,
                    name: prefab,
                    params,
                },
            );
        }
        self.out.interner.from_type_ref(TypeRef::PrefabDescriptor)
    }

    /// The values of a literal that is reported or ignored: still typed, so that their own
    /// mistakes are reported once.
    fn literal_values(&mut self, fields: &[DescField]) {
        for field in fields {
            if let FieldValue::Expr(value) = &field.value {
                self.check(value, None);
            }
        }
    }

    /// The identity, name, params and declaration of the prefab `id` names (declared here or
    /// imported).
    fn literal_prefab(&self, id: DefId) -> Option<(PrefabKey, String, Vec<PrefabParam>, Span)> {
        let def = self.res.def(id)?;
        match def.kind {
            DefKind::Import => self.imported_prefabs.get(&id).map(|info| {
                (
                    info.key,
                    info.name.clone(),
                    info.params.clone(),
                    info.name_span,
                )
            }),
            _ => Some((
                self.prefab_key(id)?,
                def.name.clone(),
                self.prefab_params.get(&id)?.clone(),
                def.span,
            )),
        }
    }

    /// `E5042` for a `name: value;` of a prefab literal that names no param.
    fn unknown_literal_param(
        &mut self,
        name: &Ident,
        prefab: &str,
        declared: Span,
        params: &[PrefabParam],
    ) {
        let names: Vec<&str> = params.iter().map(|p| p.name.as_str()).collect();
        let list = if names.is_empty() {
            "none".to_owned()
        } else {
            names.join(", ")
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5042,
            format!(
                "'{}' is not a param of prefab {prefab}: a prefab literal may set only params.",
                name.name
            ),
        )
        .at(name.span)
        .related(declared, format!("the prefab '{prefab}' is declared here"))
        .note(format!("the params of {prefab} are: {list}"));
        let close: Vec<&str> = names
            .iter()
            .copied()
            .filter(|candidate| (1..=2).contains(&edit_distance(&name.name, candidate)))
            .collect();
        if let [single] = close.as_slice() {
            diagnostic = diagnostic.help(format!("did you mean '{single}'?"));
        }
        self.report(diagnostic);
    }

    /// `E3102` unless the value `value` of type `actual` fits the param. True when it does.
    fn param_value_type(
        &mut self,
        prefab: &str,
        param: &PrefabParam,
        value: &Expr,
        actual: TyId,
    ) -> bool {
        if self.out.interner.assignable(actual, param.ty) {
            return true;
        }
        if !self.out.interner.is_error(actual) {
            let (expected, got) = (self.display(param.ty), self.display(actual));
            let mut diagnostic = Diagnostic::new(
                Code::E3102,
                format!(
                    "Parameter '{}' of prefab {prefab} expects {expected}, but received {got}.",
                    param.name
                ),
            )
            .at(value.span)
            .related(
                param.name_span,
                format!("the param '{}' is declared here", param.name),
            )
            .expected(expected.clone())
            .actual(got.clone());
            let interner = &self.out.interner;
            if let (Some(want), Some(have)) =
                (interner.vector_dim(param.ty), interner.vector_dim(actual))
            {
                diagnostic = diagnostic.note(format!(
                    "a {expected} has {want} components; this value has {have}"
                ));
            }
            self.report(diagnostic);
        }
        false
    }

    /// The call `spawn(args)`: its argument may be a prefab literal.
    pub(super) fn note_spawn_argument(&mut self, args: &[Expr]) {
        self.spawn_argument = args.first().map(|arg| strip_parens(arg).id);
    }

    /// `E5030`: `destroy` of a named entity, whose lifetime is the scene's (`spec/scenes.md`
    /// section 4.5). Only the certain cases are reported: `self` in a prefab may be spawned, and
    /// a reference to a named entity that reaches `destroy` at run time is `E8030`.
    pub(super) fn check_destroy_target(&mut self, args: &[Expr]) {
        let [arg] = args else {
            return;
        };
        let target = strip_parens(arg);
        if !matches!(target.kind, ExprKind::Name(_) | ExprKind::SelfValue) {
            return;
        }
        let Some(Res::Def(id)) = self.res.res(target.id) else {
            return;
        };
        let Some(def) = self.res.def(id).cloned() else {
            return;
        };
        if def.kind != DefKind::Entity {
            return;
        }
        self.report(
            Diagnostic::new(
                Code::E5030,
                format!(
                    "The entity '{}' is declared in the scene and cannot be destroyed: it lives as long as the scene.",
                    def.name
                ),
            )
            .at(arg.span)
            .related(def.span, format!("'{}' is declared here", def.name))
            .note("only an entity created with `spawn` can be destroyed (spec/scenes.md section 4.5)")
            .help("hide it with `visible: false`"),
        );
    }

    /// `E5074`: a field of an `entity_ref`. Through a reference an entity can be compared,
    /// tested with `alive`, destroyed and given body commands; its fields stay out of reach so
    /// that every field access is statically checkable (`spec/scenes.md` section 8.3).
    pub(super) fn entity_ref_field(&mut self, expr: &Expr, name: &Ident) -> TyId {
        self.report(
            Diagnostic::new(
                Code::E5074,
                format!(
                    "'.{}' accesses a field through an entity_ref, but fields cannot be read or written through an entity_ref in v0.1.",
                    name.name
                ),
            )
            .at(expr.span)
            .note("through an entity_ref you may compare it (`==`, `!=`), test `alive(r)`, `destroy(r)` it and issue body commands")
            .help("a named entity's fields are read by its name: `Floor.position`; keep the data you need in state"),
        );
        TyId::ERROR
    }

    // ----- instances -------------------------------------------------------------------------

    /// The prefab `name` of `entity Name: name { .. }`: a prefab of this module (checked
    /// already) or an imported one. Anything else is `E3001`; an unknown name was reported by
    /// the resolver.
    fn instance_prefab(&mut self, name: &Ident) -> Option<PrefabInfo> {
        let Some(Res::Def(id)) = self.res.res(name.id) else {
            return None;
        };
        let def = self.res.def(id)?.clone();
        let kind = match def.kind {
            DefKind::Import => self.res.import_target(id)?.kind,
            kind => kind,
        };
        if kind != DefKind::Prefab {
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!("'{}' is a {}, not a prefab.", name.name, kind.noun()),
                )
                .at(name.span)
                .expected("a prefab")
                .actual(kind.noun())
                .related(def.span, format!("'{}' is declared here", name.name))
                .note("`entity Name: Prefab { .. }` instantiates a prefab"),
            );
            return None;
        }
        match def.kind {
            DefKind::Import => self.imported_prefabs.get(&id).cloned(),
            _ => self.out.prefabs.get(&id).cloned(),
        }
    }

    /// `entity Name: Prefab { param: value; … }`: the body sets only params (`E5042`), each once
    /// (`E5002`) with a constant of the param's type (`E3102`, `E3090`), and every param without
    /// a default (`E5041`).
    pub(super) fn instance(&mut self, entity: &EntityDecl) {
        let (Some(prefab), Some(def)) = (&entity.prefab, self.res.def_of(entity.id)) else {
            return;
        };
        let Some(info) = self.instance_prefab(prefab) else {
            // The values are still typed, so that their own mistakes are reported once.
            for member in &entity.members {
                if let EntityMember::Field(field) = member
                    && let FieldValue::Expr(value) = &field.value
                {
                    self.check(value, None);
                }
            }
            return;
        };
        // An instance owns the body its prefab declares (decision 0065).
        if info.physics != EntityPhysics::default() {
            self.out.entity_physics.insert(def, info.physics);
        }
        let mut given: Vec<GivenParam> = Vec::new();
        let mut ok = true;
        for member in &entity.members {
            match member {
                EntityMember::Field(field) => {
                    ok &= self.instance_param(field, &info, &mut given);
                }
                EntityMember::Error(_) => ok = false,
                other => {
                    ok = false;
                    self.instance_member(other, &info, entity);
                }
            }
        }
        for param in &info.params {
            if !param.has_default && !given.iter().any(|given| given.name == param.name) {
                ok = false;
                self.report(
                    Diagnostic::new(
                        Code::E5041,
                        format!(
                            "Missing required parameter '{}' for prefab {}.",
                            param.name, info.name
                        ),
                    )
                    .at(entity.name.span)
                    .related(
                        param.name_span,
                        format!("the param '{}' is declared here", param.name),
                    )
                    .note(format!("the param '{}' has no default", param.name))
                    .help(format!(
                        "add `{}: …;` to the body of '{}'",
                        param.name, entity.name.name
                    )),
                );
            }
        }
        let checked = if ok {
            self.checked_instance(&info, &given)
        } else {
            None
        };
        self.instances.insert(
            def,
            InstanceFacts {
                prefab_name: info.name.clone(),
                states: info.states.clone(),
                material_params: info.material_params.clone(),
                bound_fields: info.bound_fields.clone(),
                bound_params: info.bound_params.clone(),
                checked,
            },
        );
    }

    /// Every param of `info` with the value the instance gives it or its default; `None` if a
    /// value is missing (an error was reported).
    fn checked_instance(&self, info: &PrefabInfo, given: &[GivenParam]) -> Option<CheckedInstance> {
        let mut params = Vec::with_capacity(info.params.len());
        for param in &info.params {
            let (value, origin) = match given.iter().find(|given| given.name == param.name) {
                Some(given) => (
                    given.value.clone()?,
                    FieldOrigin::Written {
                        span: given.member,
                        value: given.node,
                    },
                ),
                None => (param.default.clone()?, FieldOrigin::Default),
            };
            params.push(CheckedParam {
                name: param.name.clone(),
                ty: self.display(param.ty),
                value,
                origin,
            });
        }
        Some(CheckedInstance {
            prefab: info.key,
            prefab_name: info.name.clone(),
            params,
        })
    }

    /// One `name: value;` of an instance body. True when it is a param given a sound constant of
    /// the right type, recorded in `given` with the member's span.
    fn instance_param(
        &mut self,
        field: &FieldInit,
        info: &PrefabInfo,
        given: &mut Vec<GivenParam>,
    ) -> bool {
        let value = match &field.value {
            FieldValue::Expr(value) => Some(&**value),
            FieldValue::Bind(bind) => {
                self.bind_not_allowed(bind, "as the value of a prefab param");
                None
            }
        };
        let Some(param) = info.param(&field.name.name) else {
            self.unknown_instance_member(&field.name, info);
            if let Some(value) = value {
                self.check(value, None);
            }
            return false;
        };
        if let Some(first) = given.iter().find(|given| given.name == param.name) {
            let first = first.name_span;
            self.report(
                Diagnostic::new(
                    Code::E5002,
                    format!(
                        "The param '{}' of prefab {} is set twice.",
                        param.name, info.name
                    ),
                )
                .at(field.name.span)
                .related(first, format!("'{}' is first set here", param.name))
                .help("remove one of the two"),
            );
            if let Some(value) = value {
                self.check(value, Some(param.ty));
            }
            return false;
        }
        let Some(value) = value else {
            given.push(GivenParam {
                name: param.name.clone(),
                name_span: field.name.span,
                member: field.span,
                node: field.id,
                value: None,
            });
            return false;
        };
        let actual = self.check(value, Some(param.ty));
        let mut sound = self.param_value_type(&info.name, param, value, actual);
        let folded = self.fold(value);
        let constant = match folded {
            Folded::Value(constant) if sound => Some(constant),
            Folded::NotConstant(reason) => {
                sound = false;
                self.report(
                    Diagnostic::new(
                        Code::E3090,
                        format!(
                            "The value of the param '{}' of prefab {} is not a constant expression: {}.",
                            param.name, info.name, reason.reason
                        ),
                    )
                    .at(reason.span)
                    .note("the params of a static instance are construction-only values: literals, constants, operators, conversions, constructors and const-eligible built-in functions"),
                );
                None
            }
            _ => None,
        };
        given.push(GivenParam {
            name: param.name.clone(),
            name_span: field.name.span,
            member: field.span,
            node: value.id,
            value: constant,
        });
        sound
    }

    /// `E5042` for a member of an instance body that is not a `name: value;` of a param.
    fn instance_member(&mut self, member: &EntityMember, info: &PrefabInfo, entity: &EntityDecl) {
        let (span, what) = match member {
            EntityMember::Const(constant) => (constant.span, "a `const`"),
            EntityMember::State(state) => (state.span, "`state`"),
            EntityMember::Param(param) => (param.span, "a `param`"),
            EntityMember::Entity(child) => (child.span, "an `entity`"),
            EntityMember::Lifecycle(function) => (function.span, "a lifecycle function"),
            EntityMember::Handler(handler) => (handler.span, "an event handler"),
            EntityMember::Field(_) | EntityMember::Error(_) => return,
        };
        let params: Vec<&str> = info.params.iter().map(|p| p.name.as_str()).collect();
        let list = if params.is_empty() {
            "none".to_owned()
        } else {
            params.join(", ")
        };
        self.report(
            Diagnostic::new(
                Code::E5042,
                format!(
                    "The entity '{}' is an instance of prefab {} and declares {what}, but an instance may set only the prefab's params.",
                    entity.name.name, info.name
                ),
            )
            .at(span)
            .related(
                info.name_span,
                format!("the prefab '{}' is declared here", info.name),
            )
            .note(format!("the params of {} are: {list}", info.name))
            .help("declare it in the prefab"),
        );
    }

    /// `E5042` for a `name: value;` of an instance body that names no param.
    fn unknown_instance_member(&mut self, name: &Ident, info: &PrefabInfo) {
        let params: Vec<&str> = info.params.iter().map(|p| p.name.as_str()).collect();
        let list = if params.is_empty() {
            "none".to_owned()
        } else {
            params.join(", ")
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5042,
            format!(
                "'{}' is not a param of prefab {}: an instance may set only params.",
                name.name, info.name
            ),
        )
        .at(name.span)
        .related(
            info.name_span,
            format!("the prefab '{}' is declared here", info.name),
        )
        .note(format!("the params of {} are: {list}", info.name));
        let close: Vec<&str> = params
            .iter()
            .copied()
            .filter(|candidate| (1..=2).contains(&edit_distance(&name.name, candidate)))
            .collect();
        let entity_field = self
            .registry
            .schema_field(self.registry.declaration_schemas.entity, &name.name)
            .is_some();
        if let [single] = close.as_slice() {
            diagnostic = diagnostic.help(format!("did you mean '{single}'?"));
        } else if entity_field {
            diagnostic = diagnostic.help(format!(
                "'{}' is a field of the entity: set it in the prefab, where it can use a param",
                name.name
            ));
        }
        self.report(diagnostic);
    }
}
