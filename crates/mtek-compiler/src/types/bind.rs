//! `bind(expr)` (`spec/scenes.md` sections 8.2 and 8.4, task M3-05, decision 0051).
//!
//! A scene's bindings are collected after the whole scene body is typed, so a bound expression may
//! read any entity, camera, state or material param of the scene, wherever it is declared:
//!
//! * **Where.** `bind` is the whole value of a field the registry marks bindable, or of a param of
//!   the material instance written as the `material` of an entity; anywhere else it is `E5004`.
//! * **What.** The expression is typed against the field's type exactly (`E3102`) as a CPU root
//!   body, so the functions it calls are reachable CPU code, and it is pure: a call of a `cpu fn` or
//!   of a CPU intrinsic is `E5005`.
//! * **Dependencies.** The state, `frame` values, entity and camera fields, entity state and
//!   material params it reads, in source order, each once.
//! * **Order and cycles.** A binding reads another when it reads what the other writes. Evaluation
//!   order is topological with ties broken by declaration order; a cycle is `E5075`, reported once
//!   with every binding of the cycle as a related span, in order.
//! * **Writers.** An assignment to a bound field or param is `E5070` at the assignment, with the
//!   `bind` as the related span.

use std::collections::BTreeSet;

use super::check::{Checker, FieldKind};
use super::facts::{Callee, CallFact};
use super::scene_body::ScopeCtx;
use super::ty::TyId;
use super::{BindDep, BindInfo, BindTarget, CpuBody, CpuBodyKind, WriteTarget};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::gate::is_implemented;
use crate::resolve::{DefId, DefKind, Res};
use crate::source::Span;
use crate::stdlib::{Domain, FieldFlags};
use crate::syntax::ast::{
    Bind, DescField, EntityDecl, EntityMember, Expr, ExprKind, FieldInit, FieldValue, SceneDecl,
    SceneMember, SceneObject,
};
use crate::syntax::walk_expr;

impl Checker<'_> {
    /// Check every `bind` of `decl` and record the scene's bindings with their dependencies and
    /// evaluation order. Runs after the scene's fields are typed and before its bodies.
    pub(super) fn scene_binds(&mut self, decl: &SceneDecl) {
        let scene = self.res.def_of(decl.id);
        let mut found: Vec<BindInfo> = Vec::new();
        let scene_schema = self.registry.declaration_schemas.scene;
        for member in &decl.members {
            match member {
                SceneMember::Field(field) => {
                    self.field_bind(scene_schema, None, "scene", &decl.name.name, field, &mut found);
                }
                SceneMember::Object(object) => self.object_binds(object, &mut found),
                SceneMember::Entity(entity) => self.entity_binds(entity, &mut found),
                _ => {}
            }
        }
        self.finish_bindings(scene, found);
    }

    fn object_binds(&mut self, object: &SceneObject, found: &mut Vec<BindInfo>) {
        let Some(kind) = self.registry.scene_object(&object.kind.name) else {
            return;
        };
        if !is_implemented(kind.since) {
            return;
        }
        let owner = self.res.def_of(object.id);
        for field in &object.fields {
            self.field_bind(kind.schema, owner, kind.keyword, &object.name.name, field, found);
        }
    }

    fn entity_binds(&mut self, entity: &EntityDecl, found: &mut Vec<BindInfo>) {
        if entity.prefab.is_some() {
            return;
        }
        let owner = self.res.def_of(entity.id);
        let schema = self.registry.declaration_schemas.entity;
        for member in &entity.members {
            match member {
                EntityMember::Field(field) => {
                    self.field_bind(schema, owner, "entity", &entity.name.name, field, found);
                    if self.is_material_field(&field.name.name)
                        && let (FieldValue::Expr(value), Some(entity_def)) = (&field.value, owner)
                        && let ExprKind::Descriptor { fields, .. } = &value.kind
                    {
                        let params = self.descriptor_params(value, entity_def);
                        self.param_binds(entity_def, &entity.name.name, &params, fields, found);
                    }
                }
                EntityMember::Entity(child) => self.entity_binds(child, found),
                _ => {}
            }
        }
    }

    /// `name: bind(..);` of a scene, camera or entity body.
    fn field_bind(
        &mut self,
        schema: &str,
        owner: Option<DefId>,
        noun: &str,
        object: &str,
        field: &FieldInit,
        found: &mut Vec<BindInfo>,
    ) {
        let FieldValue::Bind(bind) = &field.value else {
            return;
        };
        // An unknown field was reported (`E5001`), a gated one by the resolver.
        let Some(def) = self.registry.schema_field(schema, &field.name.name) else {
            return;
        };
        if !is_implemented(def.since) {
            return;
        }
        let bindable: Vec<&str> = self
            .registry
            .schema(schema)
            .map(|s| {
                s.fields
                    .iter()
                    .filter(|f| f.flags.contains(FieldFlags::BINDABLE) && is_implemented(f.since))
                    .map(|f| f.name)
                    .collect()
            })
            .unwrap_or_default();
        let target_owner = match owner {
            Some(owner) if def.flags.contains(FieldFlags::BINDABLE) => owner,
            _ => {
                let mut diagnostic = Diagnostic::new(
                    Code::E5004,
                    format!(
                        "`bind` cannot be the value of the field '{}' of {noun} '{object}': the field is not bindable.",
                        def.name
                    ),
                )
                .at(bind.span);
                if bindable.is_empty() {
                    diagnostic = diagnostic.note(format!("no field of a {noun} is bindable"));
                } else {
                    diagnostic =
                        diagnostic.note(format!("bindable fields: {}", bindable.join(", ")));
                }
                self.report(diagnostic);
                return;
            }
        };
        let expected = self.out.interner.from_type_ref(def.ty);
        let subject = format!("the field '{}' of {noun} '{object}'", def.name);
        let target = BindTarget::Field {
            object: target_owner,
            field: def.name.to_owned(),
        };
        self.check_bind(bind, expected, &subject, target, found);
    }

    /// `param: bind(..)` in the material instance of the entity `entity`.
    fn param_binds(
        &mut self,
        entity: DefId,
        entity_name: &str,
        params: &[(String, TyId)],
        fields: &[DescField],
        found: &mut Vec<BindInfo>,
    ) {
        for field in fields {
            let FieldValue::Bind(bind) = &field.value else {
                continue;
            };
            // An unknown param was reported (`E5001`).
            let Some((name, ty)) = params.iter().find(|(name, _)| *name == field.name.name) else {
                continue;
            };
            let subject = format!("the param '{name}' of the material of entity '{entity_name}'");
            let target = BindTarget::MaterialParam {
                entity,
                param: name.clone(),
            };
            self.check_bind(bind, *ty, &subject, target, found);
        }
    }

    /// The params and their types of the material instance literal `value` of `entity`: those of a
    /// user material, or the fields of a registry material schema (`Unlit`).
    fn descriptor_params(&mut self, value: &Expr, entity: DefId) -> Vec<(String, TyId)> {
        if let Some(instance) = self.out.entity_material(entity) {
            return self.instance_params(instance);
        }
        let Some(ty) = self.ty_of(value.id) else {
            return Vec::new();
        };
        let super::ty::Ty::Schema(schema) = self.out.interner.get(ty) else {
            return Vec::new();
        };
        let Some(schema) = self.registry.schema(schema) else {
            return Vec::new();
        };
        let fields: Vec<_> = schema
            .fields
            .iter()
            .filter(|f| is_implemented(f.since))
            .map(|f| (f.name.to_owned(), f.ty))
            .collect();
        fields
            .into_iter()
            .map(|(name, ty)| (name, self.out.interner.from_type_ref(ty)))
            .collect()
    }

    /// Type, purity and dependencies of one binding; pushes it when it is sound.
    fn check_bind(
        &mut self,
        bind: &Bind,
        expected: TyId,
        subject: &str,
        target: BindTarget,
        found: &mut Vec<BindInfo>,
    ) {
        self.start_body(
            format!("The binding of {subject}"),
            "bind".to_owned(),
            TyId::UNIT,
            None,
        );
        self.scope = Some(ScopeCtx { initialiser: None });
        let actual = self.check(&bind.source, Some(expected));
        self.fold(&bind.source);
        self.scope = None;
        let facts = self.body.take().map(|b| b.facts).unwrap_or_default();
        let mut sound = true;
        if actual == TyId::UNIT {
            self.report(
                Diagnostic::new(
                    Code::E3102,
                    "This call gives no value: the function it calls has no result type.",
                )
                .at(bind.source.span)
                .expected(self.display(expected))
                .actual("()"),
            );
            sound = false;
        } else if !self.out.interner.assignable(actual, expected) {
            if !self.out.interner.is_error(actual) {
                let (expected_name, actual_name) = (self.display(expected), self.display(actual));
                self.report(
                    Diagnostic::new(
                        Code::E3102,
                        format!(
                            "The binding of {subject} expects {expected_name}, but its expression has type {actual_name}."
                        ),
                    )
                    .at(bind.source.span)
                    .expected(expected_name)
                    .actual(actual_name),
                );
            }
            sound = false;
        }
        for call in &facts.calls {
            if let Some(what) = self.impure_call(call) {
                self.report(
                    Diagnostic::new(
                        Code::E5005,
                        format!("The binding of {subject} must be pure, but it calls {what}."),
                    )
                    .at(call.span)
                    .note("a binding is re-evaluated every frame; it may read state, entity fields and `frame`, and call pure functions")
                    .help("compute the value in `update` and assign it to a state, then bind the state"),
                );
                sound = false;
            }
        }
        // The body is a CPU root: the functions it calls are CPU-reachable.
        let label = format!("the binding of {subject}");
        self.out.cpu_bodies.push(CpuBody {
            kind: CpuBodyKind::Binding,
            node: bind.id,
            owner: None,
            label,
            span: bind.span,
            facts,
        });
        if !sound {
            return;
        }
        let (deps, camera_reads) = self.dependencies(&bind.source);
        if !camera_reads.is_empty() {
            for (span, name) in camera_reads {
                self.report(
                    Diagnostic::new(
                        Code::E5005,
                        format!("The binding of {subject} reads the camera field `{name}`, which a binding cannot depend on."),
                    )
                    .at(span)
                    .note("a binding may read constants, state, `frame` and the fields and state of named entities"),
                );
            }
            return;
        }
        found.push(BindInfo {
            scene: None,
            node: bind.id,
            span: bind.span,
            source: bind.source.id,
            ty: expected,
            target,
            deps,
            id: 0,
            order: 0,
        });
    }

    /// What makes `call` impure, if it does: a `cpu fn` or a CPU-only built-in.
    fn impure_call(&self, call: &CallFact) -> Option<String> {
        match &call.callee {
            Callee::Function(def) => {
                let cpu = match self.res.def(*def).map(|d| d.kind) {
                    Some(DefKind::Fn) => self.out.functions.get(def).is_some_and(|i| i.sig.cpu),
                    _ => self.imported_fns.get(def).is_some_and(|sig| sig.cpu),
                };
                let name = self.res.def(*def).map(|d| d.name.clone()).unwrap_or_default();
                cpu.then(|| format!("the `cpu fn` '{name}'"))
            }
            Callee::Builtin(builtin) => (builtin.domain == Domain::Cpu || builtin.handlers_only)
                .then(|| format!("the CPU intrinsic `{}`", builtin.name)),
        }
    }

    /// The dependencies of the expression `source`, in source order, each once.
    fn dependencies(&self, source: &Expr) -> (Vec<BindDep>, Vec<(Span, String)>) {
        let mut ids = Vec::new();
        walk_expr(source, &mut |node, _| ids.push((node.id, node.span)));
        let mut camera_reads: Vec<(Span, String)> = Vec::new();
        let mut deps: Vec<BindDep> = Vec::new();
        let mut push = |dep: BindDep| {
            if !deps.contains(&dep) {
                deps.push(dep);
            }
        };
        for (id, span) in ids {
            if let Some(kind) = self.fields.get(&id) {
                match kind {
                    FieldKind::ObjectField {
                        object_def: Some(object),
                        field,
                        object: object_name,
                        ..
                    } => {
                        let is_entity = self
                            .res
                            .def(*object)
                            .is_some_and(|d| d.kind == DefKind::Entity);
                        if is_entity {
                            push(BindDep::Field {
                                object: *object,
                                field: field.clone(),
                            });
                        } else {
                            camera_reads.push((span, format!("{object_name}.{field}")));
                        }
                    }
                    FieldKind::EntityState { entity, state, .. } => push(BindDep::EntityState {
                        entity: *entity,
                        state: *state,
                    }),
                    FieldKind::MaterialParam { entity, param } => push(BindDep::MaterialParam {
                        entity: *entity,
                        param: param.clone(),
                    }),
                    FieldKind::NamespaceValue(name) => {
                        if let Some(member) = name.strip_prefix("frame.") {
                            push(BindDep::Frame(member.to_owned()));
                        }
                    }
                    _ => {}
                }
            } else if let Some(Res::Def(def)) = self.res.res(id)
                && self.res.def(def).is_some_and(|d| d.kind == DefKind::State)
                && let Some(state) = self.out.states.get(&def)
            {
                let owner_is_entity = state
                    .owner
                    .and_then(|o| self.res.def(o))
                    .is_some_and(|d| d.kind == DefKind::Entity);
                match (owner_is_entity, state.owner) {
                    (true, Some(entity)) => push(BindDep::EntityState { entity, state: def }),
                    _ => push(BindDep::State(def)),
                }
            }
        }
        (deps, camera_reads)
    }

    /// Number the bindings, find cycles (`E5075`) and give each its place in the evaluation order.
    fn finish_bindings(&mut self, scene: Option<DefId>, mut found: Vec<BindInfo>) {
        found.sort_by_key(|b| b.span.start);
        for (index, binding) in found.iter_mut().enumerate() {
            binding.id = u32::try_from(index).unwrap_or(u32::MAX);
            binding.scene = scene;
        }
        let count = found.len();
        // `reads[i]`: the bindings whose target binding `i` reads.
        let reads: Vec<Vec<usize>> = (0..count)
            .map(|i| {
                (0..count)
                    .filter(|&j| found[i].deps.iter().any(|dep| dep.reads(&found[j].target)))
                    .collect()
            })
            .collect();
        let mut waiting: Vec<usize> = reads.iter().map(Vec::len).collect();
        let mut ready: BTreeSet<usize> = (0..count).filter(|&i| waiting[i] == 0).collect();
        let mut order = vec![None; count];
        let mut next = 0u32;
        while let Some(index) = ready.pop_first() {
            order[index] = Some(next);
            next += 1;
            for other in 0..count {
                if reads[other].contains(&index) {
                    waiting[other] -= 1;
                    if waiting[other] == 0 {
                        ready.insert(other);
                    }
                }
            }
        }
        let stuck: Vec<usize> = (0..count).filter(|&i| order[i].is_none()).collect();
        if !stuck.is_empty() {
            self.report_cycles(&found, &reads, &stuck);
        }
        for index in stuck {
            order[index] = Some(next);
            next += 1;
        }
        for (binding, order) in found.iter_mut().zip(order) {
            binding.order = order.unwrap_or(0);
        }
        self.out.bindings.extend(found);
    }

    /// One `E5075` per cycle among the `stuck` bindings (those never ready).
    fn report_cycles(&mut self, found: &[BindInfo], reads: &[Vec<usize>], stuck: &[usize]) {
        let mut reported: BTreeSet<usize> = BTreeSet::new();
        for &start in stuck {
            if reported.contains(&start) {
                continue;
            }
            // Follow reads among the stuck bindings until a binding repeats.
            let mut path: Vec<usize> = Vec::new();
            let mut current = start;
            let cycle = loop {
                if let Some(position) = path.iter().position(|&p| p == current) {
                    break path[position..].to_vec();
                }
                path.push(current);
                let Some(&next) = reads[current].iter().find(|n| stuck.contains(n)) else {
                    break Vec::new();
                };
                current = next;
            };
            if cycle.is_empty() || cycle.iter().any(|c| reported.contains(c)) {
                continue;
            }
            reported.extend(cycle.iter().copied());
            // Start the report at the first binding of the cycle in the source.
            let first = cycle.iter().copied().min().unwrap_or(cycle[0]);
            let at = cycle.iter().position(|&c| c == first).unwrap_or(0);
            let ordered: Vec<usize> = cycle[at..].iter().chain(&cycle[..at]).copied().collect();
            let names: Vec<String> = ordered
                .iter()
                .map(|&i| self.describe_target(&found[i].target))
                .collect();
            let mut diagnostic = Diagnostic::new(
                Code::E5075,
                format!("The bindings of {} depend on each other.", names.join(", ")),
            )
            .at(found[first].span);
            for (position, &index) in ordered.iter().enumerate() {
                let next = names[(position + 1) % names.len()].clone();
                diagnostic = diagnostic.related(
                    found[index].span,
                    format!("binds {}, which reads {next}", names[position]),
                );
            }
            self.report(diagnostic.help("break the cycle: bind one of them to something else, or update it from `update`"));
        }
    }

    /// `Cube.position`, `Main.target`, `Cube.material.phase`.
    pub(super) fn describe_target(&self, target: &BindTarget) -> String {
        let name = |def: DefId| {
            self.res
                .def(def)
                .map(|d| d.name.clone())
                .unwrap_or_default()
        };
        match target {
            BindTarget::Field { object, field } => format!("{}.{field}", name(*object)),
            BindTarget::MaterialParam { entity, param } => {
                format!("{}.material.{param}", name(*entity))
            }
        }
    }

    /// `E5070` for every assignment, in a lifecycle function or handler, to what a binding writes.
    pub(super) fn binding_conflicts(&mut self, scene: Option<DefId>) {
        let bindings: Vec<BindInfo> = self
            .out
            .bindings
            .iter()
            .filter(|b| b.scene == scene)
            .cloned()
            .collect();
        if bindings.is_empty() {
            return;
        }
        let sites: Vec<(WriteTarget, Span)> = self
            .out
            .writes
            .iter()
            .map(|w| (w.target.clone(), w.span))
            .collect();
        for (write, span) in sites {
            let hit = bindings.iter().find(|b| match (&write, &b.target) {
                (
                    WriteTarget::Field { object, field },
                    BindTarget::Field {
                        object: o,
                        field: f,
                    },
                ) => object == o && field == f,
                (
                    WriteTarget::MaterialParam { entity, param },
                    BindTarget::MaterialParam {
                        entity: e,
                        param: p,
                    },
                ) => entity == e && param == p,
                _ => false,
            });
            if let Some(binding) = hit {
                let what = self.describe_target(&binding.target);
                self.report(
                    Diagnostic::new(
                        Code::E5070,
                        format!("`{what}` is bound, so it cannot be assigned."),
                    )
                    .at(span)
                    .related(binding.span, format!("`{what}` is bound here"))
                    .help("update the binding's source instead"),
                );
            }
        }
    }

    /// `E5004` for a `bind` where none is allowed: in a struct or descriptor literal other than the
    /// `material` of an entity, or as the value of a field the registry does not mark bindable.
    pub(super) fn bind_not_allowed(&mut self, bind: &Bind, where_: &str) {
        self.report(
            Diagnostic::new(
                Code::E5004,
                format!("`bind` cannot be used {where_}."),
            )
            .at(bind.span)
            .note("`bind(expr)` is the whole value of a bindable field of an entity or camera, or of a param in the `material` of an entity")
            .help("write the expression without `bind`, or move it into a bindable field"),
        );
    }
}

impl Checker<'_> {
    /// Whether `name` is the field that holds an entity's material instance.
    pub(super) fn is_material_field(&self, name: &str) -> bool {
        name == "material"
    }

    /// A stand-in constant of `ty` for a value a binding supplies at run time: zero, the identity
    /// quaternion, an opaque black colour. `None` for a type with no such value.
    pub(super) fn zero_const(&self, ty: TyId) -> Option<super::value::ConstValue> {
        use super::ty::Ty;
        use super::value::ConstValue;
        Some(match self.out.interner.get(ty) {
            Ty::Bool => ConstValue::Bool(false),
            Ty::I32 => ConstValue::I32(0),
            Ty::U32 => ConstValue::U32(0),
            Ty::F32 => ConstValue::F32(0.0),
            Ty::Vec2 => ConstValue::Vec2([0.0; 2]),
            Ty::Vec3 => ConstValue::Vec3([0.0; 3]),
            Ty::Vec4 => ConstValue::Vec4([0.0; 4]),
            Ty::Quat => ConstValue::Quat([0.0, 0.0, 0.0, 1.0]),
            Ty::Color => ConstValue::Color([0.0, 0.0, 0.0, 1.0]),
            _ => return None,
        })
    }
}

/// A stand-in constant for a registry field a binding supplies at run time.
pub(super) fn placeholder(ty: crate::stdlib::TypeRef) -> Option<super::value::ConstValue> {
    use super::value::ConstValue;
    use crate::stdlib::TypeRef;
    Some(match ty {
        TypeRef::Bool => ConstValue::Bool(false),
        TypeRef::I32 => ConstValue::I32(0),
        TypeRef::U32 => ConstValue::U32(0),
        TypeRef::F32 => ConstValue::F32(0.0),
        TypeRef::Vec2 => ConstValue::Vec2([0.0; 2]),
        TypeRef::Vec3 => ConstValue::Vec3([0.0; 3]),
        TypeRef::Vec4 => ConstValue::Vec4([0.0; 4]),
        TypeRef::Quat => ConstValue::Quat([0.0, 0.0, 0.0, 1.0]),
        TypeRef::Color => ConstValue::Color([0.0, 0.0, 0.0, 1.0]),
        _ => return None,
    })
}
