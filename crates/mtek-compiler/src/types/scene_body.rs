//! `state`, lifecycle functions and event handlers (`spec/scenes.md` sections 2, 4.4, 6, 7, 8
//! and 11; tasks M3-01 and M3-02, decision 0049).
//!
//! The scene walk of [`super::check`] calls three entry points, in this order for each scene:
//!
//! 1. [`Checker::declare_scene_states`]: every `state` of the scene and of its entities gets its
//!    type, so that a body can read a state declared after it (names share the scene scope);
//! 2. [`Checker::state_init`] for each `state`, in declaration order, as a CPU root body: the
//!    initialiser may read constants, earlier scene state and its own earlier state, and call pure
//!    and `cpu` functions, but not read entity or camera fields (`E5081`);
//! 3. [`Checker::scene_bodies`]: every lifecycle function and handler of the scene and of its
//!    entities, once all fields and material instances are typed. Each is a CPU root body whose
//!    assignments are recorded as [`WriteSite`]s for the single-writer analysis.

use std::collections::BTreeMap;

use super::body::BodyState;
use super::check::{Checker, FieldKind};
use super::facts::BodyFacts;
use super::ty::{Ty, TyId};
use super::{CpuBody, CpuBodyKind, StateInfo, WriteSite, WriteTarget};
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::gate::is_implemented;
use crate::resolve::{DefId, DefKind, PreludeItem, Res};
use crate::source::Span;
use crate::stdlib::{EventForm, SchemaCategory};
use crate::syntax::ast::{
    EntityDecl, EntityMember, Expr, ExprKind, FieldInit, FieldValue, Handler, HandlerArg, Ident,
    LifecycleFn, SceneDecl, SceneMember, StateDecl, Stmt,
};

/// What the checker is inside while it checks a scene body or a state initialiser.
#[derive(Clone, Copy, Debug)]
pub(super) struct ScopeCtx {
    /// Entity and camera fields are not readable in any initialiser (`E5081`). State
    /// initialisers additionally restrict which bare state names are already initialised.
    pub(super) initialiser: Option<Initialiser>,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum Initialiser {
    State(DefId),
    /// All state of the current part is initialised before its fields.
    Field,
}

/// The lifecycle functions of v0.1 (`spec/scenes.md` section 6).
const LIFECYCLE_NAMES: [&str; 3] = ["update", "fixed_update", "ui"];

impl Checker<'_> {
    // ----- state -----------------------------------------------------------------------------

    /// Give every `state` of `decl` and of its entities its type.
    pub(super) fn declare_scene_states(&mut self, decl: &SceneDecl) {
        let owner = self.res.def_of(decl.id);
        let mut index = 0;
        for member in &decl.members {
            match member {
                SceneMember::State(state) => {
                    self.declare_state(state, owner, index);
                    index += 1;
                }
                SceneMember::Entity(entity) => self.declare_entity_states(entity),
                _ => {}
            }
        }
    }

    pub(super) fn declare_entity_states(&mut self, entity: &EntityDecl) {
        // An instance has the state of its prefab, not state of its own.
        if entity.prefab.is_some() {
            return;
        }
        let owner = self.res.def_of(entity.id);
        let mut index = 0;
        for member in &entity.members {
            match member {
                EntityMember::State(state) => {
                    self.declare_state(state, owner, index);
                    index += 1;
                }
                EntityMember::Entity(child) => self.declare_entity_states(child),
                _ => {}
            }
        }
    }

    pub(super) fn declare_state(&mut self, state: &StateDecl, owner: Option<DefId>, index: u32) {
        let Some(def) = self.res.def_of(state.id) else {
            return;
        };
        let ty = self.annotation(&state.ty);
        self.out.locals.insert(def, ty);
        self.out.states.insert(
            def,
            StateInfo {
                def,
                name: state.name.name.clone(),
                name_span: state.name.span,
                span: state.span,
                ty,
                owner,
                init: state.value.id,
                index,
            },
        );
    }

    /// Check the initialiser of `state` against its declared type as a CPU root body.
    pub(super) fn state_init(&mut self, state: &StateDecl, entity: Option<DefId>) {
        let Some(def) = self.res.def_of(state.id) else {
            return;
        };
        let Some(declared) = self.out.locals.get(&def).copied() else {
            return;
        };
        let name = state.name.name.clone();
        self.start_body(
            format!("The initialiser of the state '{name}'"),
            name.clone(),
            TyId::UNIT,
            None,
        );
        self.scope = Some(ScopeCtx {
            initialiser: Some(Initialiser::State(def)),
        });
        let actual = self.check(&state.value, Some(declared));
        if actual == TyId::UNIT {
            self.sink.push(
                Diagnostic::new(
                    Code::E3001,
                    "This call gives no value: the function it calls has no result type.",
                )
                .at(state.value.span)
                .expected("a value")
                .actual("()"),
            );
        } else if !self.out.interner.assignable(actual, declared) {
            let (declared_name, actual_name) = (self.display(declared), self.display(actual));
            self.sink.push(
                Diagnostic::new(
                    Code::E3001,
                    format!(
                        "The state '{name}' is declared as {declared_name}, but its value has type {actual_name}."
                    ),
                )
                .at(state.value.span)
                .related(
                    state.ty.span,
                    format!("the state '{name}' is declared as {declared_name} here"),
                )
                .expected(declared_name)
                .actual(actual_name),
            );
        }
        self.fold(&state.value);
        self.scope = None;
        let facts = self.body.take().map(|b| b.facts).unwrap_or_default();
        self.out.cpu_bodies.push(CpuBody {
            kind: CpuBodyKind::StateInit,
            node: state.id,
            owner: entity.or_else(|| self.res.def(def).and_then(|d| d.parent)),
            label: format!("the initialiser of the state '{name}'"),
            span: state.span,
            facts,
        });
    }

    /// Whether the state `state` may be read by the initialiser being checked: only state
    /// declared earlier in the same owner, or scene state declared before the entity's.
    pub(super) fn state_readable_here(&self, state: DefId) -> bool {
        let Some(ScopeCtx {
            initialiser: Some(Initialiser::State(current)),
            ..
        }) = self.scope
        else {
            return true;
        };
        let (Some(read), Some(own)) = (self.out.states.get(&state), self.out.states.get(&current))
        else {
            return true;
        };
        if read.owner == own.owner {
            return read.index < own.index;
        }
        // Scene state read from an entity's initialiser: every scene state is initialised first
        // (`spec/scenes.md` section 11, step 2).
        let owner_is_entity = own
            .owner
            .and_then(|o| self.res.def(o))
            .is_some_and(|d| d.kind == DefKind::Entity);
        let read_is_scene = read
            .owner
            .and_then(|o| self.res.def(o))
            .is_some_and(|d| d.kind == DefKind::Scene);
        owner_is_entity && (read_is_scene || read.owner == self.current_prefab)
    }

    // ----- lifecycle functions and handlers --------------------------------------------------

    /// Check every lifecycle function and handler of `decl` and of its entities.
    pub(super) fn scene_bodies(&mut self, decl: &SceneDecl) {
        let owner = self.res.def_of(decl.id);
        let label = format!("scene '{}'", decl.name.name);
        let mut seen = BTreeMap::new();
        for member in &decl.members {
            match member {
                SceneMember::Lifecycle(function) => {
                    self.lifecycle_body(function, owner, None, &label, &mut seen);
                }
                SceneMember::Handler(handler) => self.handler_body(handler, owner, None, &label),
                SceneMember::Entity(entity) => self.entity_bodies(entity),
                _ => {}
            }
        }
    }

    pub(super) fn entity_bodies(&mut self, entity: &EntityDecl) {
        if entity.prefab.is_some() {
            return;
        }
        let owner = self.res.def_of(entity.id);
        let label = format!("entity '{}'", entity.name.name);
        let mut seen = BTreeMap::new();
        for member in &entity.members {
            match member {
                EntityMember::Lifecycle(function) => {
                    self.lifecycle_body(function, owner, owner, &label, &mut seen);
                }
                EntityMember::Handler(handler) => {
                    self.handler_body(handler, owner, owner, &label);
                }
                EntityMember::Entity(child) => self.entity_bodies(child),
                _ => {}
            }
        }
    }

    pub(super) fn lifecycle_body(
        &mut self,
        function: &LifecycleFn,
        owner: Option<DefId>,
        entity: Option<DefId>,
        holder: &str,
        seen: &mut BTreeMap<&'static str, Span>,
    ) {
        let name = function.name.name.as_str();
        let Some(known) = LIFECYCLE_NAMES.iter().find(|n| **n == name).copied() else {
            self.sink.push(
                Diagnostic::new(
                    Code::E5052,
                    format!("`{name}` is not a lifecycle function."),
                )
                .at(function.name.span)
                .note(
                    "v0.1 lifecycle functions are `update`, `fixed_update` and (in a scene) `ui`",
                ),
            );
            // Its body is still checked, so that names and types in it are reported once.
            self.body_in_scope(
                function.span,
                &function.params,
                &function.body,
                owner,
                entity,
                None,
            );
            return;
        };
        if known == "ui" && entity.is_some() {
            self.sink.push(
                Diagnostic::new(
                    Code::E5052,
                    format!("`ui` belongs to a scene, not to the {holder}."),
                )
                .at(function.name.span)
                .note("`ui(dt)` runs in every frame, also while the game is paused (decision 0175)")
                .help("declare `ui` in the scene"),
            );
        }
        if let Some(first) = seen.insert(known, function.name.span) {
            // Keep the first declaration as the one later duplicates refer to.
            seen.insert(known, first);
            self.sink.push(
                Diagnostic::new(
                    Code::E5051,
                    format!("The {holder} declares `{known}` more than once."),
                )
                .at(function.name.span)
                .related(first, format!("`{known}` is first declared here"))
                .help("remove one of the two"),
            );
        }
        let ok = match function.params.as_slice() {
            [param] => {
                let ty = self.annotation(&param.ty);
                if ty != TyId::F32 && !self.out.interner.is_error(ty) {
                    self.sink.push(
                        Diagnostic::new(
                            Code::E5050,
                            format!(
                                "The parameter of `{known}` must be an f32, but '{}' is {}.",
                                param.name.name,
                                self.display(ty)
                            ),
                        )
                        .at(param.ty.span)
                        .expected("f32")
                        .actual(self.display(ty)),
                    );
                }
                true
            }
            _ => {
                self.sink.push(
                    Diagnostic::new(
                        Code::E5050,
                        format!(
                            "`{known}` takes exactly one parameter, an f32 time step, but {} are declared.",
                            function.params.len()
                        ),
                    )
                    .at(function.name.span)
                    .help(format!("write `{known}(dt: f32) {{ … }}`")),
                );
                false
            }
        };
        let _ = ok;
        self.warn_timers_every_frame(known, &function.body.stmts);
        let body_label = format!("`{known}` of {holder}");
        self.body_in_scope(
            function.span,
            &function.params,
            &function.body,
            owner,
            entity,
            Some((CpuBodyKind::Lifecycle, function.id, body_label)),
        );
    }

    /// `W5301` at every `after` / `every` that `update` or `fixed_update` starts unconditionally
    /// (directly in the body or in a plain block, not under an `if`, `match` or loop): it starts
    /// one more timer every frame (decision 0177). The usual shape guards the start with a state
    /// flag, which is not flagged.
    fn warn_timers_every_frame(&mut self, lifecycle: &str, stmts: &[Stmt]) {
        for stmt in stmts {
            match stmt {
                Stmt::Timer(timer) => {
                    let word = timer.kind.word();
                    self.sink.push(
                        Diagnostic::new(
                            Code::W5301,
                            format!(
                                "`{word}` in `{lifecycle}` starts a new timer every time `{lifecycle}` runs."
                            ),
                        )
                        .at(timer.word)
                        .note(format!(
                            "`{lifecycle}` runs again and again, and a timer cannot be cancelled: they pile up (the runtime stops starting new ones at 4096 and reports W8205)"
                        ))
                        .help("start the timer once: guard it with a `started` state flag, or start it in an `on` handler"),
                    );
                }
                Stmt::Block(block) => self.warn_timers_every_frame(lifecycle, &block.stmts),
                _ => {}
            }
        }
    }

    pub(super) fn handler_body(
        &mut self,
        handler: &Handler,
        owner: Option<DefId>,
        entity: Option<DefId>,
        holder: &str,
    ) {
        let event_name = handler.event.name.as_str();
        let event = self.registry.event(event_name);
        let mut params = Vec::new();
        match event {
            None => {
                let names: Vec<&str> = self.registry.events.iter().map(|e| e.name).collect();
                let mut diagnostic =
                    Diagnostic::new(Code::E5060, format!("Unknown event '{event_name}'."))
                        .at(handler.event.span);
                let near = crate::hints::nearest(event_name, names.iter().copied(), 3);
                if !near.is_empty() {
                    let near: Vec<String> = near.iter().map(|n| format!("`{n}`")).collect();
                    diagnostic = diagnostic.help(format!("did you mean {}?", near.join(" or ")));
                }
                self.sink
                    .push(diagnostic.note(format!("the events of v0.1 are: {}", names.join(", "))));
            }
            Some(event) => {
                self.handler_args(handler, event.form, event_name, &mut params);
                let host = self.host_of(entity);
                self.collision_needs_collider(handler, event, host, entity);
                if !event.hosts.contains(&host) {
                    self.sink.push(
                        Diagnostic::new(
                            Code::E5060,
                            format!(
                                "The event '{event_name}' cannot be handled in {}.",
                                host_noun(host)
                            ),
                        )
                        .at(handler.event.span),
                    );
                }
            }
        }
        let label = format!("the handler `on {event_name}` of {holder}");
        let args: Vec<_> = params.into_iter().collect();
        self.handler_scope(handler, owner, entity, &args, label);
    }

    /// Check the arguments of a handler against the form its event declares: a filter
    /// expression (`Key.Space`, a constant of the event's enum) or one typed parameter.
    fn handler_args(
        &mut self,
        handler: &Handler,
        form: EventForm,
        event: &str,
        params: &mut Vec<usize>,
    ) {
        match form {
            EventForm::Filter(type_ref) => match handler.args.as_slice() {
                [HandlerArg::Filter(filter)] => {
                    let ty = self.check(filter, None);
                    let expected = self.out.interner.from_type_ref(type_ref);
                    let enum_name = self.display(expected);
                    let enum_name = enum_name.as_str();
                    if ty != expected && !self.out.interner.is_error(ty) {
                        self.sink.push(
                            Diagnostic::new(
                                Code::E5061,
                                format!(
                                    "`on {event}` takes a {enum_name} member such as `{enum_name}.Space`, but this is {}.",
                                    self.display(ty)
                                ),
                            )
                            .at(filter.span)
                            .expected(enum_name.to_owned())
                            .actual(self.display(ty)),
                        );
                    } else if !self.out.interner.is_error(ty) && !self.is_constant_expr(filter) {
                        // A filter that is already an error (`Key.Up` is `E2003`, with the nearest
                        // members) is not reported a second time.
                        self.sink.push(
                            Diagnostic::new(
                                Code::E5061,
                                format!("The filter of `on {event}` must be a constant {enum_name} member, written like `{enum_name}.Space`."),
                            )
                            .at(filter.span)
                            .note("a filter is fixed when the program is built, so it cannot be a state, a local or any other value that changes at run time")
                            .help(format!("to react to a key that is only known at run time, test `is_key_down(...)` inside `update`, or handle each key in a handler of its own: `on {event}({enum_name}.Space) {{ ... }}`")),
                        );
                    }
                }
                other => {
                    let expected = self.out.interner.from_type_ref(type_ref);
                    let wanted = format!("one {} member", self.display(expected));
                    self.report_event_arity(handler, event, &wanted, other.len());
                }
            },
            EventForm::Parameter(type_ref) => match handler.args.as_slice() {
                [HandlerArg::Param(param)] => {
                    let ty = self.annotation(&param.ty);
                    let expected = self.out.interner.from_type_ref(type_ref);
                    if ty != expected && !self.out.interner.is_error(ty) {
                        let (expected_name, actual) = (self.display(expected), self.display(ty));
                        self.sink.push(
                            Diagnostic::new(
                                Code::E5061,
                                format!(
                                    "The parameter of `on {event}` must be {expected_name}, but '{}' is {actual}.",
                                    param.name.name
                                ),
                            )
                            .at(param.ty.span)
                            .expected(expected_name)
                            .actual(actual),
                        );
                    }
                    if let Some(def) = self.res.def_of(param.id) {
                        self.out.locals.insert(def, expected);
                    }
                    params.push(0);
                }
                other => self.report_event_arity(handler, event, "one parameter", other.len()),
            },
        }
    }

    fn report_event_arity(&mut self, handler: &Handler, event: &str, wanted: &str, found: usize) {
        self.sink.push(
            Diagnostic::new(
                Code::E5061,
                format!("`on {event}` takes {wanted}, but {found} arguments are written."),
            )
            .at(handler.event.span),
        );
    }

    /// Whether the handler filter `expr` is constant: a member of a registry enum (`Key.Space`)
    /// or any constant expression.
    fn is_constant_expr(&mut self, expr: &Expr) -> bool {
        let mut inner = expr;
        while let ExprKind::Paren(next) = &inner.kind {
            inner = next;
        }
        if let ExprKind::Field { name, .. } = &inner.kind
            && matches!(
                self.res.res(name.id),
                Some(Res::Prelude(PreludeItem::EnumMember { .. }))
            )
        {
            return true;
        }
        matches!(self.fold(expr), super::consteval::Folded::Value(_))
    }

    fn handler_scope(
        &mut self,
        handler: &Handler,
        owner: Option<DefId>,
        _entity: Option<DefId>,
        _args: &[usize],
        label: String,
    ) {
        self.start_body(
            capitalise(&label),
            handler.event.name.clone(),
            TyId::UNIT,
            None,
        );
        self.scope = Some(ScopeCtx { initialiser: None });
        let _ = owner;
        self.end_scope_body(
            &handler.body,
            CpuBodyKind::Handler,
            handler.id,
            owner,
            label,
            handler.span,
        );
    }

    /// Check a lifecycle function's body (or the body of one whose declaration is wrong).
    fn body_in_scope(
        &mut self,
        span: Span,
        params: &[crate::syntax::ast::Param],
        body: &crate::syntax::ast::Block,
        owner: Option<DefId>,
        _entity: Option<DefId>,
        record: Option<(CpuBodyKind, crate::syntax::ast::NodeId, String)>,
    ) {
        let (kind, node, label) = record.unwrap_or((
            CpuBodyKind::Lifecycle,
            body.id,
            "a lifecycle function".to_owned(),
        ));
        self.start_body(capitalise(&label), "lifecycle".to_owned(), TyId::UNIT, None);
        self.scope = Some(ScopeCtx { initialiser: None });
        for param in params {
            let ty = if param.ty.span.is_empty() {
                TyId::F32
            } else {
                self.annotation(&param.ty)
            };
            if let Some(def) = self.res.def_of(param.id) {
                self.out.locals.insert(def, ty);
            }
        }
        self.end_scope_body(body, kind, node, owner, label, span);
    }

    fn end_scope_body(
        &mut self,
        block: &crate::syntax::ast::Block,
        kind: CpuBodyKind,
        node: crate::syntax::ast::NodeId,
        owner: Option<DefId>,
        label: String,
        span: Span,
    ) {
        let state: Option<BodyState> = self.end_body(block, None);
        self.scope = None;
        if let Some(state) = state {
            self.out.cpu_bodies.push(CpuBody {
                kind,
                node,
                owner,
                label,
                span,
                facts: state.facts,
            });
        } else {
            self.out.cpu_bodies.push(CpuBody {
                kind,
                node,
                owner,
                label,
                span,
                facts: BodyFacts::default(),
            });
        }
    }

    /// `Cube.material.phase` and `self.material.phase`: a param of the material instance of a
    /// named entity (`spec/scenes.md` section 8.2). `None` when `expr` is not that form.
    pub(super) fn material_param(
        &mut self,
        expr: &Expr,
        base: &Expr,
        name: &Ident,
    ) -> Option<TyId> {
        let ExprKind::Field {
            base: owner,
            name: material,
        } = &base.kind
        else {
            return None;
        };
        if material.name != "material"
            || !matches!(owner.kind, ExprKind::Name(_) | ExprKind::SelfValue)
        {
            return None;
        }
        let Some(Res::Def(entity)) = self.res.res(owner.id) else {
            return None;
        };
        if !self.names_entity(entity, &owner.kind) {
            return None;
        }
        let entity_name = self
            .res
            .def(entity)
            .map_or_else(String::new, |d| d.name.clone());
        if self.scope.is_some_and(|scope| scope.initialiser.is_some()) {
            self.report_initialiser_read(expr, &entity_name, "entity", "material");
            return Some(TyId::ERROR);
        }
        // The material of a static prefab instance is the prefab's.
        let instance_params = self
            .instances
            .get(&entity)
            .and_then(|facts| facts.material_params.clone());
        let (instance, params) = match (
            self.out.entity_materials.get(&entity).copied(),
            instance_params,
        ) {
            (Some(instance), _) => (instance, self.instance_params(instance)),
            (None, Some(params)) => (TyId::MATERIAL, params),
            (None, None) => {
                self.report(
                    Diagnostic::new(
                        Code::E5001,
                        format!("The entity '{entity_name}' has no material."),
                    )
                    .at(base.span)
                    .note("an entity has a material when it declares `material`, or `mesh` (its material is then `Unlit {}`)"),
                );
                return Some(TyId::ERROR);
            }
        };
        self.set_ty(base.id, instance);
        match params.iter().find(|(param, _)| *param == name.name) {
            Some((param, ty)) => {
                self.fields.insert(
                    expr.id,
                    FieldKind::MaterialParam {
                        entity,
                        param: param.clone(),
                    },
                );
                Some(*ty)
            }
            None => {
                let names = params
                    .iter()
                    .map(|(p, _)| p.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                self.report(
                    Diagnostic::new(
                        Code::E5001,
                        format!(
                            "The material of '{entity_name}' has no param '{}'.",
                            name.name
                        ),
                    )
                    .at(name.span)
                    .note(format!("its params are {names}")),
                );
                Some(TyId::ERROR)
            }
        }
    }

    /// `Sun.light.intensity` and `self.light.color`: a field of the light of a named entity
    /// (`spec/materials.md` section 7, decision 0053). `None` when `expr` is not that form.
    pub(super) fn light_field(&mut self, expr: &Expr, base: &Expr, name: &Ident) -> Option<TyId> {
        let ExprKind::Field {
            base: owner,
            name: light,
        } = &base.kind
        else {
            return None;
        };
        if light.name != "light" || !matches!(owner.kind, ExprKind::Name(_) | ExprKind::SelfValue) {
            return None;
        }
        let Some(Res::Def(entity)) = self.res.res(owner.id) else {
            return None;
        };
        if !self.names_entity(entity, &owner.kind) {
            return None;
        }
        let entity_name = self
            .res
            .def(entity)
            .map_or_else(String::new, |d| d.name.clone());
        if self.scope.is_some_and(|scope| scope.initialiser.is_some()) {
            self.report_initialiser_read(expr, &entity_name, "entity", "light");
            return Some(TyId::ERROR);
        }
        let Some(schema) = self.out.entity_lights.get(&entity).copied() else {
            self.report(
                Diagnostic::new(
                    Code::E5001,
                    format!("The entity '{entity_name}' has no light."),
                )
                .at(base.span),
            );
            return Some(TyId::ERROR);
        };
        let schema_ty = self.out.interner.intern(Ty::Schema(schema));
        self.set_ty(base.id, schema_ty);
        match self.registry.schema_field(schema, &name.name) {
            Some(def) if is_implemented(def.since) => {
                self.fields.insert(
                    expr.id,
                    FieldKind::LightField {
                        entity,
                        field: def.name.to_owned(),
                    },
                );
                Some(self.out.interner.from_type_ref(def.ty))
            }
            _ => {
                let fields: Vec<&str> = self
                    .registry
                    .schema(schema)
                    .map(|s| s.fields.iter().map(|f| f.name).collect())
                    .unwrap_or_default();
                self.report(
                    Diagnostic::new(
                        Code::E5001,
                        format!("The light of '{entity_name}' has no field '{}'.", name.name),
                    )
                    .at(name.span)
                    .note(format!("the fields of {schema} are {}", fields.join(", "))),
                );
                Some(TyId::ERROR)
            }
        }
    }

    /// Whether the base `base` of a field access names the entity `def`: a named entity, or
    /// `self` inside a prefab (the prefab's name is not a value).
    pub(super) fn names_entity(&self, def: DefId, base: &ExprKind) -> bool {
        match self.res.def(def).map(|d| d.kind) {
            Some(DefKind::Entity) => true,
            Some(DefKind::Prefab) => matches!(base, ExprKind::SelfValue),
            _ => false,
        }
    }

    /// Remember the light schema of `light: L { … };` for `Sun.light.field`.
    pub(super) fn note_entity_light(&mut self, entity: Option<DefId>, field: &FieldInit) {
        if field.name.name != "light" {
            return;
        }
        let FieldValue::Expr(value) = &field.value else {
            return;
        };
        let (Some(ty), Some(def)) = (self.ty_of(value.id), entity) else {
            return;
        };
        if let Ty::Schema(name) = self.out.interner.get(ty)
            && self
                .registry
                .schema(name)
                .is_some_and(|schema| schema.category == SchemaCategory::Light)
        {
            self.out.entity_lights.insert(def, name);
        }
    }

    /// Remember the material instance type of `material: M { … };` for `Cube.material.param`: a
    /// user material's instance type, or the registry schema of a built-in material (`Unlit {…}`,
    /// `Pbr {…}`), whose params [`Checker::instance_params`] reads from the schema (decision 0087).
    pub(super) fn note_entity_material(&mut self, entity: Option<DefId>, field: &FieldInit) {
        if field.name.name != "material" {
            return;
        }
        let FieldValue::Expr(value) = &field.value else {
            return;
        };
        let (Some(ty), Some(def)) = (self.ty_of(value.id), entity) else {
            return;
        };
        let instance = match self.out.interner.get(ty) {
            Ty::MaterialInstance(_) => true,
            Ty::Schema(name) => self
                .registry
                .schema(name)
                .is_some_and(|schema| schema.category == SchemaCategory::Material),
            _ => false,
        };
        if instance {
            self.out.entity_materials.insert(def, ty);
        }
    }

    /// The default material of an entity or prefab that declares a `mesh` and no `material`: the
    /// registry's default of the entity schema's `material` field (`Unlit {}`, `spec/scenes.md`
    /// section 4.1), whose params are reached by name like those of a written `Unlit {}`.
    pub(super) fn note_default_material(
        &mut self,
        entity: Option<DefId>,
        members: &[EntityMember],
    ) {
        let Some(def) = entity else {
            return;
        };
        let written = |name: &str| {
            members
                .iter()
                .any(|m| matches!(m, EntityMember::Field(f) if f.name.name == name))
        };
        if self.out.entity_materials.contains_key(&def) || written("material") {
            return;
        }
        let schema = self.registry.declaration_schemas.entity;
        let Some(material) = self.registry.schema_field(schema, "material") else {
            return;
        };
        if material
            .default_when_set
            .is_some_and(|sibling| !written(sibling))
        {
            return;
        }
        let Some(crate::stdlib::ConstValue::EmptyDescriptor(name)) = material.default else {
            return;
        };
        if self
            .registry
            .schema(name)
            .is_some_and(|schema| schema.category == SchemaCategory::Material)
        {
            let ty = self.out.interner.intern(Ty::Schema(name));
            self.out.entity_materials.insert(def, ty);
        }
    }

    // ----- writes ----------------------------------------------------------------------------

    /// Record the assignment `target`: what it writes, for the single-writer analysis, and check
    /// that the field may be written at all (`E5073` for a construction-only field).
    pub(super) fn record_write(&mut self, target: &Expr) -> bool {
        let Some((write, handled)) = self.write_target(target) else {
            return false;
        };
        if let Some(write) = write {
            self.out.writes.push(WriteSite {
                target: write,
                span: target.span,
            });
        }
        handled
    }

    /// What the place `target` writes, if it writes state, an entity or camera field or a
    /// material param. The second value is false when the write was rejected (reported).
    fn write_target(&mut self, target: &Expr) -> Option<(Option<WriteTarget>, bool)> {
        let mut current = target;
        loop {
            match &current.kind {
                ExprKind::Paren(inner) => current = inner,
                ExprKind::Index { base, .. } => current = base,
                ExprKind::Field { base, .. } => match self.fields.get(&current.id).cloned() {
                    Some(FieldKind::Components(_) | FieldKind::StructField(_)) => current = base,
                    Some(FieldKind::EntityState {
                        state,
                        entity,
                        name,
                        ..
                    }) => {
                        let target = match state {
                            Some(state) => WriteTarget::State(state),
                            None => WriteTarget::InstanceState { entity, name },
                        };
                        return Some((Some(target), true));
                    }
                    Some(FieldKind::ObjectField {
                        object_def, field, ..
                    }) => {
                        return Some(self.field_write(current, object_def, &field));
                    }
                    Some(FieldKind::MaterialParam { entity, param }) => {
                        if self
                            .ty_of(current.id)
                            .is_some_and(|ty| self.is_resource(ty))
                        {
                            self.sink.push(
                                Diagnostic::new(
                                    Code::E5073,
                                    format!("The texture or sampler param '{param}' is construction-only and cannot be assigned."),
                                )
                                .at(current.span)
                                .note("resource params are bound when the material instance is created; replacing a texture is planned for v0.2"),
                            );
                            return Some((None, false));
                        }
                        return Some((Some(WriteTarget::MaterialParam { entity, param }), true));
                    }
                    Some(FieldKind::LightField { entity, field }) => {
                        return Some(self.light_write(current, entity, &field));
                    }
                    // A readable body property is read-only: physics owns it (decision 0065).
                    Some(FieldKind::BodyProperty { property, .. }) => {
                        self.report_property_write(current, property);
                        return Some((None, false));
                    }
                    // Reads of these four fields are allowed (decision 0151); writes are not,
                    // because the reference does not name the entity the single-writer rules need.
                    Some(FieldKind::RefField { field }) => {
                        self.sink.push(
                            Diagnostic::new(
                                Code::E5074,
                                format!("'.{field}' cannot be written through an entity_ref."),
                            )
                            .at(current.span)
                            .note("an entity_ref does not name the entity, so a write could not be checked against that entity's body and its bindings")
                            .help("write a named entity's field, or move a spawned body with `r.body.teleport` or `r.body.apply_impulse`"),
                        );
                        return Some((None, false));
                    }
                    _ => return None,
                },
                ExprKind::Name(_) => {
                    return match self.res.res(current.id) {
                        Some(Res::Def(id))
                            if self.res.def(id).is_some_and(|d| d.kind == DefKind::State) =>
                        {
                            Some((Some(WriteTarget::State(id)), true))
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    /// A write of the field `field` of the light of `entity`: `E5073` if its schema marks the
    /// field construction-only (`range`), else a write site.
    fn light_write(
        &mut self,
        expr: &Expr,
        entity: DefId,
        field: &str,
    ) -> (Option<WriteTarget>, bool) {
        let def = self
            .out
            .entity_lights
            .get(&entity)
            .and_then(|schema| self.registry.schema_field(schema, field));
        if let Some(def) = def
            && !def.flags.is_writable()
        {
            let name = self
                .res
                .def(entity)
                .map_or_else(String::new, |d| d.name.clone());
            self.sink.push(
                Diagnostic::new(
                    Code::E5073,
                    format!("The field '{field}' of the light of '{name}' is construction-only and cannot be assigned."),
                )
                .at(expr.span)
                .note("construction-only fields are set where the object is declared"),
            );
            return (None, false);
        }
        (
            Some(WriteTarget::LightField {
                entity,
                field: field.to_owned(),
            }),
            true,
        )
    }

    /// A write of the registry field `field` of the object `object`: `E5073` if the schema marks
    /// the field construction-only (or not writable), else a write site.
    fn field_write(
        &mut self,
        expr: &Expr,
        object: Option<DefId>,
        field: &str,
    ) -> (Option<WriteTarget>, bool) {
        let Some(object) = object else {
            return (None, true);
        };
        if let Some(handled) = self.physics_owned_write(expr, object, field) {
            return (None, handled);
        }
        let schema = match self.res.def(object).map(|d| d.kind) {
            Some(DefKind::Entity | DefKind::Prefab) => {
                Some(self.registry.declaration_schemas.entity)
            }
            Some(DefKind::SceneObject { kind: Some(kind) }) => {
                self.registry.scene_object(kind).map(|k| k.schema)
            }
            _ => None,
        };
        let def = schema.and_then(|s| self.registry.schema_field(s, field));
        if let Some(def) = def
            && !def.flags.is_writable()
        {
            let name = self
                .res
                .def(object)
                .map_or_else(String::new, |d| d.name.clone());
            self.sink.push(
                Diagnostic::new(
                    Code::E5073,
                    format!("The field '{field}' of '{name}' is construction-only and cannot be assigned."),
                )
                .at(expr.span)
                .note("construction-only fields are set where the object is declared"),
            );
            return (None, false);
        }
        (
            Some(WriteTarget::Field {
                object,
                field: field.to_owned(),
            }),
            true,
        )
    }
}

impl Checker<'_> {
    /// What hosts the handler of `entity`: the scene (`None`), a prefab or an entity.
    fn host_of(&self, entity: Option<DefId>) -> crate::stdlib::EventHost {
        match entity.and_then(|def| self.res.def(def)).map(|d| d.kind) {
            Some(DefKind::Prefab) => crate::stdlib::EventHost::Prefab,
            Some(_) => crate::stdlib::EventHost::Entity,
            None => crate::stdlib::EventHost::Scene,
        }
    }
}

fn host_noun(host: crate::stdlib::EventHost) -> &'static str {
    match host {
        crate::stdlib::EventHost::Scene => "a scene",
        crate::stdlib::EventHost::Entity => "an entity",
        crate::stdlib::EventHost::Prefab => "a prefab",
    }
}

fn capitalise(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}
