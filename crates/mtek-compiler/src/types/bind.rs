//! `bind(expr)` (`spec/scenes.md` sections 8.2 and 8.4, task M3-05, decision 0051).
//!
//! A scene's bindings are collected after the whole scene body is typed, so a bound expression may
//! read any entity, camera, state or material param of the scene, wherever it is declared:
//!
//! * **Where.** `bind` is the whole value of a field the registry marks bindable, or of a param of
//!   the material instance written as the `material` of an entity, or of a bindable field of the
//!   light written as the `light` of an entity (decision 0053); anywhere else it is `E5004`.
//! * **What.** The expression is typed against the field's type exactly (`E3102`) as a CPU root
//!   body, so the functions it calls are reachable CPU code, and it is pure: a call of a `cpu fn` or
//!   of a CPU intrinsic is `E5005`.
//! * **Dependencies.** The state, `frame` values, entity fields, entity state, material params and
//!   light colour and intensity (decision 0067) it reads, in source order, each once. A camera
//!   field or a body property has no dependency kind: reading one is `E5005`.
//! * **Order and cycles.** A binding reads another when it reads what the other writes. Evaluation
//!   order is topological with ties broken by declaration order; a cycle is `E5075`, reported once
//!   with every binding of the cycle as a related span, in order.
//! * **Writers.** An assignment to a bound field or param is `E5070` at the assignment, with the
//!   `bind` as the related span.

use std::collections::{BTreeMap, BTreeSet};

use super::check::{Checker, FieldKind};
use super::facts::{CallFact, Callee};
use super::scene_body::ScopeCtx;
use super::ty::TyId;
use super::{BindDep, BindInfo, BindTarget, CpuBody, CpuBodyKind, WriteTarget};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::gate::is_implemented;
use crate::resolve::{DefId, DefKind, Res};
use crate::source::Span;
use crate::stdlib::{Domain, FieldFlags};
use crate::syntax::ast::{
    Bind, DescField, EntityDecl, EntityMember, Expr, ExprKind, FieldInit, FieldValue, PrefabDecl,
    SceneDecl, SceneMember, SceneObject,
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
                    self.field_bind(
                        scene_schema,
                        None,
                        "scene",
                        &decl.name.name,
                        field,
                        &mut found,
                    );
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
            self.field_bind(
                kind.schema,
                owner,
                kind.keyword,
                &object.name.name,
                field,
                found,
            );
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
                        self.param_binds(
                            entity_def,
                            ("entity", &entity.name.name),
                            &params,
                            fields,
                            found,
                        );
                    }
                    if self.is_light_field(&field.name.name)
                        && let (FieldValue::Expr(value), Some(entity_def)) = (&field.value, owner)
                        && let ExprKind::Descriptor { fields, .. } = &value.kind
                    {
                        self.light_binds(entity_def, &entity.name.name, value, fields, found);
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
        // The pose of an entity with a body belongs to physics (`E5072`, decision 0065).
        if schema == self.registry.declaration_schemas.entity
            && let Some(owner) = owner
            && self.physics_bind(bind.span, owner, noun, object, def.name)
        {
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

    /// Check every `bind` of the prefab `decl` (the fields of its entity and the params of its
    /// material) and record its bindings, numbered per prefab (decision 0062).
    pub(super) fn prefab_binds(&mut self, decl: &PrefabDecl) {
        let Some(owner) = self.res.def_of(decl.id) else {
            return;
        };
        let schema = self.registry.declaration_schemas.entity;
        let mut found: Vec<BindInfo> = Vec::new();
        for member in &decl.members {
            if let EntityMember::Entity(child) = member {
                self.entity_binds(child, &mut found);
            }
            let EntityMember::Field(field) = member else {
                continue;
            };
            self.field_bind(
                schema,
                Some(owner),
                "prefab",
                &decl.name.name,
                field,
                &mut found,
            );
            if self.is_material_field(&field.name.name)
                && let FieldValue::Expr(value) = &field.value
                && let ExprKind::Descriptor { fields, .. } = &value.kind
            {
                let params = self.descriptor_params(value, owner);
                self.param_binds(
                    owner,
                    ("prefab", &decl.name.name),
                    &params,
                    fields,
                    &mut found,
                );
            }
        }
        self.finish_bindings(Some(owner), found);
    }

    /// `param: bind(..)` in the material instance of the entity or prefab `entity`, which
    /// `owner` (`("entity", "Cube")`) names in messages.
    fn param_binds(
        &mut self,
        entity: DefId,
        owner: (&str, &str),
        params: &[(String, TyId)],
        fields: &[DescField],
        found: &mut Vec<BindInfo>,
    ) {
        let (noun, entity_name) = owner;
        for field in fields {
            let FieldValue::Bind(bind) = &field.value else {
                continue;
            };
            // An unknown param was reported (`E5001`).
            let Some((name, ty)) = params.iter().find(|(name, _)| *name == field.name.name) else {
                continue;
            };
            // A bound texture or sampler was reported (`E5004`) where the instance was typed.
            if self.is_resource(*ty) {
                continue;
            }
            let subject = format!("the param '{name}' of the material of {noun} '{entity_name}'");
            let target = BindTarget::MaterialParam {
                entity,
                param: name.clone(),
            };
            self.check_bind(bind, *ty, &subject, target, found);
        }
    }

    /// `field: bind(..)` in the light of the entity `entity`: `color` and `intensity` (a field the
    /// schema does not mark bindable, `range`, is `E5004`).
    fn light_binds(
        &mut self,
        entity: DefId,
        entity_name: &str,
        value: &Expr,
        fields: &[DescField],
        found: &mut Vec<BindInfo>,
    ) {
        let Some(ty) = self.ty_of(value.id) else {
            return;
        };
        let super::ty::Ty::Schema(schema) = self.out.interner.get(ty) else {
            return;
        };
        for field in fields {
            let FieldValue::Bind(bind) = &field.value else {
                continue;
            };
            // An unknown field was reported (`E5001`).
            let Some(def) = self.registry.schema_field(schema, &field.name.name) else {
                continue;
            };
            if !def.flags.contains(FieldFlags::BINDABLE) {
                let bindable: Vec<&str> = self
                    .registry
                    .schema(schema)
                    .map(|s| {
                        s.fields
                            .iter()
                            .filter(|f| f.flags.contains(FieldFlags::BINDABLE))
                            .map(|f| f.name)
                            .collect()
                    })
                    .unwrap_or_default();
                self.report(
                    Diagnostic::new(
                        Code::E5004,
                        format!(
                            "`bind` cannot be the value of the field '{}' of the light of entity '{entity_name}': the field is not bindable.",
                            def.name
                        ),
                    )
                    .at(bind.span)
                    .note(format!("bindable fields of {schema}: {}", bindable.join(", "))),
                );
                continue;
            }
            let expected = self.out.interner.from_type_ref(def.ty);
            let subject = format!(
                "the field '{}' of the light of entity '{entity_name}'",
                def.name
            );
            let target = BindTarget::LightField {
                entity,
                field: def.name.to_owned(),
            };
            self.check_bind(bind, expected, &subject, target, found);
        }
    }

    /// The params and their types of the material instance literal `value` of `entity`: those of a
    /// user material, or the fields of a registry material schema (`Unlit`), as
    /// [`Checker::instance_params`] gives them.
    fn descriptor_params(&mut self, value: &Expr, entity: DefId) -> Vec<(String, TyId)> {
        match self
            .out
            .entity_material(entity)
            .or_else(|| self.ty_of(value.id))
        {
            Some(instance) => self.instance_params(instance),
            None => Vec::new(),
        }
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
            if let Some((what, user_cpu_fn)) = self.impure_call(call) {
                let reason = if user_cpu_fn {
                    "a `cpu fn` may only be called from `update`, `fixed_update` and `on` handlers, because it may change state or read the outside world; a binding may call only `fn` functions and pure built-ins (math, vector, quaternion and colour functions)"
                } else {
                    "a CPU intrinsic (`random`, `print`, `spawn`, `destroy`, a body command) may only be called from `update`, `fixed_update` and `on` handlers; a binding may call only `fn` functions and pure built-ins (math, vector, quaternion and colour functions)"
                };
                let help = if user_cpu_fn {
                    "if the function uses no CPU-only operation, declare it with `fn`; otherwise call it in `update`, assign the result to a `state` and write `bind(that_state)`"
                } else {
                    "call it in `update`, assign the result to a `state` and write `bind(that_state)`; the binding then follows the state every frame"
                };
                self.report(
                    Diagnostic::new(
                        Code::E5005,
                        format!("The binding of {subject} must be pure, but it calls {what}."),
                    )
                    .at(call.span)
                    .note("a binding is re-evaluated every frame; it may read state, entity fields and `frame`, and call pure functions")
                    .note(reason)
                    .help(help),
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
        let (deps, unbindable) = self.dependencies(&bind.source);
        if !unbindable.is_empty() {
            for (span, name) in unbindable {
                self.report(
                    Diagnostic::new(
                        Code::E5005,
                        format!("The binding of {subject} reads {name}, which a binding cannot depend on."),
                    )
                    .at(span)
                    .note("a binding may read constants, state, `frame`, the fields and state of named entities and the colour and intensity of their lights"),
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
    fn impure_call(&self, call: &CallFact) -> Option<(String, bool)> {
        match &call.callee {
            Callee::Function(def) => {
                let cpu = match self.res.def(*def).map(|d| d.kind) {
                    Some(DefKind::Fn) => self.out.functions.get(def).is_some_and(|i| i.sig.cpu),
                    _ => self.imported_fns.get(def).is_some_and(|sig| sig.cpu),
                };
                let name = self
                    .res
                    .def(*def)
                    .map(|d| d.name.clone())
                    .unwrap_or_default();
                cpu.then(|| (format!("the `cpu fn` '{name}'"), true))
            }
            // The easing curves are CPU functions without effects (decision 0135): a binding,
            // which the CPU evaluates, may use them.
            Callee::Builtin(builtin) if builtin.name.starts_with("easing.") => None,
            Callee::Builtin(builtin) => (builtin.domain == Domain::Cpu || builtin.handlers_only)
                .then(|| (format!("the CPU intrinsic `{}`", builtin.name), false)),
            // Direct frame reads are allowed and become dependencies below.
            // Direct body reads are rejected there; reads hidden in a `fn`
            // are rejected by the program-wide effect pass.
            Callee::Read(_) => None,
        }
    }

    /// Whether the field `field` of the light of `entity` can change after construction: the
    /// registry marks it bindable (`color`, `intensity`; not `range`).
    fn light_field_is_dynamic(&self, entity: DefId, field: &str) -> bool {
        self.out
            .entity_lights
            .get(&entity)
            .and_then(|schema| self.registry.schema_field(schema, field))
            .is_some_and(|def| def.flags.contains(FieldFlags::BINDABLE))
    }

    /// The dependencies of the expression `source`, in source order, each once, and the reads
    /// no dependency kind covers (a camera field, a body property), which `E5005` reports.
    fn dependencies(&self, source: &Expr) -> (Vec<BindDep>, Vec<(Span, String)>) {
        let mut ids = Vec::new();
        walk_expr(source, &mut |node, _| ids.push((node.id, node.span)));
        let mut unbindable: Vec<(Span, String)> = Vec::new();
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
                            .is_some_and(|d| matches!(d.kind, DefKind::Entity | DefKind::Prefab));
                        if is_entity {
                            push(BindDep::Field {
                                object: *object,
                                field: field.clone(),
                            });
                        } else {
                            unbindable
                                .push((span, format!("the camera field `{object_name}.{field}`")));
                        }
                    }
                    FieldKind::EntityState { entity, name, .. } => push(BindDep::EntityState {
                        entity: *entity,
                        name: name.clone(),
                    }),
                    FieldKind::MaterialParam { entity, param } => push(BindDep::MaterialParam {
                        entity: *entity,
                        param: param.clone(),
                    }),
                    // `color` and `intensity` are what a binding or a handler can write at run
                    // time, so a read of one is a dependency (decision 0067). The others
                    // (`range`) are fixed at construction: nothing orders a binding against them.
                    FieldKind::LightField { entity, field } => {
                        if self.light_field_is_dynamic(*entity, field) {
                            push(BindDep::LightField {
                                entity: *entity,
                                field: field.clone(),
                            });
                        }
                    }
                    // The manifest has no dependency kind for a body property (decision 0065).
                    FieldKind::BodyProperty { property, .. } => {
                        unbindable.push((span, format!("the body property `body.{property}`")));
                    }
                    // The manifest has no dependency on "whichever entity this reference names".
                    FieldKind::RefField { field } => {
                        unbindable.push((span, format!("the field `.{field}` of an entity_ref")));
                    }
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
                    .is_some_and(|d| matches!(d.kind, DefKind::Entity | DefKind::Prefab));
                match (owner_is_entity, state.owner) {
                    (true, Some(entity)) => push(BindDep::EntityState {
                        entity,
                        name: state.name.clone(),
                    }),
                    _ => push(BindDep::State(def)),
                }
            }
        }
        (deps, unbindable)
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
        let reads = binding_reads(&found);
        let mut readers = vec![Vec::new(); count];
        for (reader, dependencies) in reads.iter().enumerate() {
            for &dependency in dependencies {
                readers[dependency].push(reader);
            }
        }
        let mut waiting: Vec<usize> = reads.iter().map(Vec::len).collect();
        let mut ready: BTreeSet<usize> = (0..count).filter(|&i| waiting[i] == 0).collect();
        let mut order = vec![None; count];
        let mut next = 0u32;
        while let Some(index) = ready.pop_first() {
            order[index] = Some(next);
            next += 1;
            for &other in &readers[index] {
                waiting[other] -= 1;
                if waiting[other] == 0 {
                    ready.insert(other);
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
            self.report(diagnostic.help(
                "break the cycle: bind one of them to something else, or update it from `update`",
            ));
        }
    }

    /// `Cube.position`, `Main.target`, `Cube.material.phase`.
    pub(super) fn describe_target(&self, target: &BindTarget) -> String {
        // Inside a prefab the entity is `self`.
        let name = |def: DefId| match self.res.def(def) {
            Some(d) if d.kind == DefKind::Prefab => "self".to_owned(),
            Some(d) => d.name.clone(),
            None => String::new(),
        };
        match target {
            BindTarget::Field { object, field } => format!("{}.{field}", name(*object)),
            BindTarget::MaterialParam { entity, param } => {
                format!("{}.material.{param}", name(*entity))
            }
            BindTarget::LightField { entity, field } => {
                format!("{}.light.{field}", name(*entity))
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
        let sites: Vec<(WriteTarget, Span)> = self
            .out
            .writes
            .iter()
            .map(|w| (w.target.clone(), w.span))
            .collect();
        self.instance_conflicts(scene, &sites);
        if bindings.is_empty() {
            return;
        }
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
                (
                    WriteTarget::LightField { entity, field },
                    BindTarget::LightField {
                        entity: e,
                        field: f,
                    },
                ) => entity == e && field == f,
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

    /// `E5070` for every assignment, in a lifecycle function or handler of the scene `scene`, to
    /// what the binding of a static prefab instance's prefab writes (`First.position` when the
    /// prefab declares `position: bind(..)`).
    fn instance_conflicts(&mut self, scene: Option<DefId>, sites: &[(WriteTarget, Span)]) {
        for (write, span) in sites {
            let (entity, name, bound, what) = match write {
                WriteTarget::Field { object, field } => (*object, field, false, field.clone()),
                WriteTarget::MaterialParam { entity, param } => {
                    (*entity, param, true, format!("material.{param}"))
                }
                _ => continue,
            };
            if !self.in_scene(entity, scene) {
                continue;
            }
            let Some(facts) = self.instances.get(&entity) else {
                continue;
            };
            let list = if bound {
                &facts.bound_params
            } else {
                &facts.bound_fields
            };
            let Some((_, bind)) = list.iter().find(|(bound_name, _)| bound_name == name) else {
                continue;
            };
            let (bind, prefab) = (*bind, facts.prefab_name.clone());
            let instance = self
                .res
                .def(entity)
                .map(|d| d.name.clone())
                .unwrap_or_default();
            self.report(
                Diagnostic::new(
                    Code::E5070,
                    format!("`{instance}.{what}` is bound by its prefab {prefab}, so it cannot be assigned."),
                )
                .at(*span)
                .related(bind, format!("`{what}` is bound here, in the prefab {prefab}"))
                .help("update the binding's source instead, or declare the field without `bind` in the prefab"),
            );
        }
    }

    /// Whether the entity `entity` is declared in the scene `scene` (at any depth).
    fn in_scene(&self, entity: DefId, scene: Option<DefId>) -> bool {
        let mut current = self.res.def(entity).and_then(|d| d.parent);
        while let Some(parent) = current {
            if Some(parent) == scene {
                return true;
            }
            current = self.res.def(parent).and_then(|d| d.parent);
        }
        false
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

    /// Whether `name` is the field that holds an entity's light.
    pub(super) fn is_light_field(&self, name: &str) -> bool {
        name == "light"
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

/// Borrowed keys encode exactly the three matching cases of `BindDep::reads`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum TargetKey<'a> {
    Field(DefId, &'a str),
    MaterialParam(DefId, &'a str),
    LightField(DefId, &'a str),
}

impl<'a> TargetKey<'a> {
    fn target(target: &'a BindTarget) -> Self {
        match target {
            BindTarget::Field { object, field } => Self::Field(*object, field),
            BindTarget::MaterialParam { entity, param } => Self::MaterialParam(*entity, param),
            BindTarget::LightField { entity, field } => Self::LightField(*entity, field),
        }
    }

    fn dependency(dep: &'a BindDep) -> Option<Self> {
        match dep {
            BindDep::Field { object, field } => Some(Self::Field(*object, field)),
            BindDep::MaterialParam { entity, param } => Some(Self::MaterialParam(*entity, param)),
            BindDep::LightField { entity, field } => Some(Self::LightField(*entity, field)),
            BindDep::State(_) | BindDep::Frame(_) | BindDep::EntityState { .. } => None,
        }
    }
}

fn binding_reads(found: &[BindInfo]) -> Vec<Vec<usize>> {
    let mut targets: BTreeMap<TargetKey<'_>, Vec<usize>> = BTreeMap::new();
    for (index, binding) in found.iter().enumerate() {
        // Retain every writer even for malformed input with duplicate targets.
        targets
            .entry(TargetKey::target(&binding.target))
            .or_default()
            .push(index);
    }
    found
        .iter()
        .map(|binding| {
            let mut reads = Vec::new();
            for dep in &binding.deps {
                if let Some(key) = TargetKey::dependency(dep)
                    && let Some(indices) = targets.get(&key)
                {
                    reads.extend_from_slice(indices);
                }
            }
            // Match the old source-index scan, including cycle traversal and recovery order.
            reads.sort_unstable();
            reads.dedup();
            reads
        })
        .collect()
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

#[cfg(test)]
mod graph_tests {
    use super::*;
    use crate::source::FileId;
    use crate::syntax::ast::NodeId;

    #[test]
    fn indexed_edges_match_reads_for_every_dependency_kind_and_duplicate_writer() {
        let mut found = Vec::new();
        let mut deps = vec![
            BindDep::State(DefId(0)),
            BindDep::Frame("position".into()),
            BindDep::EntityState {
                entity: DefId(0),
                name: "position".into(),
            },
        ];
        for owner in 0..3 {
            for name in ["position", "color", "other"] {
                for target in [
                    BindTarget::Field {
                        object: DefId(owner),
                        field: name.into(),
                    },
                    BindTarget::MaterialParam {
                        entity: DefId(owner),
                        param: name.into(),
                    },
                    BindTarget::LightField {
                        entity: DefId(owner),
                        field: name.into(),
                    },
                ] {
                    let dep = match &target {
                        BindTarget::Field { object, field } => BindDep::Field {
                            object: *object,
                            field: field.clone(),
                        },
                        BindTarget::MaterialParam { entity, param } => BindDep::MaterialParam {
                            entity: *entity,
                            param: param.clone(),
                        },
                        BindTarget::LightField { entity, field } => BindDep::LightField {
                            entity: *entity,
                            field: field.clone(),
                        },
                    };
                    deps.push(dep);
                    found.push(BindInfo {
                        scene: None,
                        node: NodeId(0),
                        span: Span::at(FileId(0), 0),
                        source: NodeId(0),
                        ty: TyId::VEC3,
                        target,
                        deps: Vec::new(),
                        id: 0,
                        order: 0,
                    });
                }
            }
        }
        // Duplicate targets must produce distinct edges; duplicate reads must not.
        found.extend(found.clone());
        deps.extend(deps.clone());
        for (index, binding) in found.iter_mut().enumerate() {
            binding.deps = deps
                .iter()
                .enumerate()
                .filter(|(i, _)| (i + index) % 3 != 0)
                .map(|(_, dep)| dep.clone())
                .rev()
                .collect();
        }
        let expected: Vec<Vec<usize>> = found
            .iter()
            .map(|binding| {
                found
                    .iter()
                    .enumerate()
                    .filter_map(|(index, target)| {
                        binding
                            .deps
                            .iter()
                            .any(|dep| dep.reads(&target.target))
                            .then_some(index)
                    })
                    .collect()
            })
            .collect();
        assert_eq!(binding_reads(&found), expected);
    }
}
