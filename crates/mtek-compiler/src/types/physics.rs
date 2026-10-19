//! Physics authoring checks (`spec/physics.md` sections 2 and 3, `spec/scenes.md` sections 7.1,
//! 8.2, 8.3 and 12, task M5-03, decision 0065).
//!
//! The field rules between `body` and `collider` (`E5120`, `E5121`) and the ranges of the
//! descriptors come from the registry like every other schema rule; this module holds what the
//! registry cannot say:
//!
//! * **Roots only** (`E5091`): a body on a nested entity, or a static instance of a prefab with a
//!   body nested in an entity. **Scale** (`E5122`): the `scale` of a `Dynamic` or `Kinematic`
//!   body is the constant `vec3(1.0)`.
//! * **One pose authority** (`E5071`, `E5072`): an entity with any `body` has its `position` and
//!   `rotation` written by physics, not by assignment or `bind`; its `scale` is construction-only
//!   (`E5073`, `E5004`).
//! * **Body commands and readable velocities**: `Name.body.apply_impulse(v)`,
//!   `self.body.teleport(..)`, `other.body.apply_force(f)` (through an `entity_ref`) and
//!   `Name.body.linear_velocity`. A command or velocity the body kind of a *named* entity does not
//!   support is `E5123`; through an `entity_ref` the kind is unknown statically (`E8101` at run
//!   time). Commands run only in lifecycle functions and handlers (`E5080`, `E4002`, `E5005`).
//! * **Collision events** (`E5062`): `on collision_enter`/`collision_exit` need a `collider`.

use super::EntityPhysics;
use super::check::{CallKind, Checker, FieldKind};
use super::facts::{BuiltinCall, CallFact, Callee};
use super::scene::{CheckedField, FieldOrigin};
use super::ty::{Ty, TyId};
use super::value::ConstValue;
use crate::diagnostics::{Code, Diagnostic};
use crate::resolve::{DefId, DefKind, Res};
use crate::source::Span;
use crate::stdlib::{BodyCommandDef, BodyKind, Domain, EventDef, EventHost, SigType};
use crate::syntax::ast::{Expr, ExprKind, FieldInit, FieldValue, Handler, Ident};

/// What a body command or velocity read addresses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyTarget {
    /// A named entity, or `self` inside an entity or prefab; its body kind is known statically.
    Entity(DefId),
    /// An `entity_ref` value (the expression before `.body`); its body kind is known at run time.
    Ref,
}

/// How a `.body` access found its owner.
enum Owner {
    Entity {
        def: DefId,
        name: String,
    },
    Ref,
    /// The owner has an error, reported already.
    Error,
}

/// `X` of `X.body`.
fn body_owner(base: &Expr) -> Option<&Expr> {
    match &base.kind {
        ExprKind::Field { base: owner, name } if name.name == "body" => Some(owner),
        _ => None,
    }
}

/// The three kinds as a sentence part: "Dynamic bodies", "Dynamic and Kinematic bodies".
fn kinds_phrase(kinds: &[BodyKind]) -> String {
    let names: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
    format!("{} bodies", names.join(" and "))
}

impl Checker<'_> {
    // ----- what an entity declares ------------------------------------------------------------

    /// Remember the `body` kind and the `collider` of the named entity or prefab `entity` from
    /// its member `field`.
    pub(super) fn note_entity_physics(&mut self, entity: Option<DefId>, field: &FieldInit) {
        let Some(def) = entity else {
            return;
        };
        match field.name.name.as_str() {
            "body" => {
                let kind = match &field.value {
                    FieldValue::Expr(value) => {
                        self.ty_of(value.id)
                            .and_then(|ty| match self.out.interner.get(ty) {
                                Ty::Schema(name) => BodyKind::from_schema(name),
                                _ => None,
                            })
                    }
                    FieldValue::Bind(_) => None,
                };
                let physics = self.out.entity_physics.entry(def).or_default();
                physics.body = kind.map(|kind| (kind, field.span));
                physics.malformed_body = kind.is_none();
            }
            "collider" => {
                self.out.entity_physics.entry(def).or_default().collider = Some(field.span);
            }
            _ => {}
        }
    }

    /// The body and collider of the entity, prefab or static instance `def`.
    pub(super) fn physics_of(&self, def: DefId) -> EntityPhysics {
        self.out
            .entity_physics
            .get(&def)
            .copied()
            .unwrap_or_default()
    }

    /// `E5091` for a body on a nested entity and `E5122` for a scaled dynamic or kinematic body,
    /// after the fields of the entity or prefab `def` were checked. `parent` is the enclosing
    /// entity of a nested entity.
    pub(super) fn physics_declaration(
        &mut self,
        def: Option<DefId>,
        name: &Ident,
        noun: &str,
        fields: &[CheckedField],
        parent: Option<&Ident>,
    ) {
        let Some(def) = def else {
            return;
        };
        let Some((kind, body_span)) = self.physics_of(def).body else {
            return;
        };
        if let Some(parent) = parent {
            self.nested_body(body_span, name, parent, kind, false);
        }
        if kind == BodyKind::Static {
            return;
        }
        let Some(scale) = fields.iter().find(|f| f.name == "scale") else {
            return;
        };
        let FieldOrigin::Written { span, .. } = scale.origin else {
            return;
        };
        let problem = if scale.bound {
            // `E5004`, reported with the bindings.
            return;
        } else if scale.dynamic {
            "is computed from the params of the prefab".to_owned()
        } else {
            match &scale.value {
                Some(ConstValue::Vec3(v)) if v.iter().any(|c| *c != 1.0) => {
                    format!("is {}", ConstValue::Vec3(*v))
                }
                _ => return,
            }
        };
        self.report(
            Diagnostic::new(
                Code::E5122,
                format!(
                    "The scale of the {} body of {noun} '{}' must be the constant vec3(1.0), but it {problem}.",
                    kind.as_str(),
                    name.name
                ),
            )
            .at(span)
            .related(body_span, "the body is declared here")
            .note("a collider is never scaled with the mesh: scaled dynamic and kinematic bodies are not part of v0.1")
            .help("size the mesh and the collider instead (`Box { size: .. }`, `BoxCollider { size: .. }`), or use a `Static` body"),
        );
    }

    /// `E5091` for the static instance `name` of a prefab with a body, nested in `parent`.
    pub(super) fn physics_instance(&mut self, def: Option<DefId>, name: &Ident, parent: &Ident) {
        let Some(def) = def else {
            return;
        };
        if let Some((kind, body_span)) = self.physics_of(def).body {
            self.nested_body(body_span, name, parent, kind, true);
        }
    }

    fn nested_body(
        &mut self,
        body_span: Span,
        name: &Ident,
        parent: &Ident,
        kind: BodyKind,
        instance: bool,
    ) {
        let what = if instance {
            format!("the prefab instance '{}' has", name.name)
        } else {
            format!("the entity '{}' declares", name.name)
        };
        let at = if instance { name.span } else { body_span };
        let mut diagnostic = Diagnostic::new(
            Code::E5091,
            format!(
                "A {} body is allowed only on a root entity, but {what} one and is nested in '{}'.",
                kind.as_str(),
                parent.name
            ),
        )
        .at(at)
        .related(parent.span, format!("'{}' is the parent", parent.name));
        if instance {
            diagnostic = diagnostic.related(body_span, "the body is declared here, in the prefab");
        }
        self.report(
            diagnostic
                .note("physics poses are world poses (`spec/scenes.md` section 12); a body entity may have visual children")
                .help(format!(
                    "declare '{}' in the scene instead of inside '{}', and give '{}' a visual child if it needs one",
                    name.name, parent.name, name.name
                )),
        );
    }

    // ----- one pose authority ----------------------------------------------------------------

    /// `E5071` for an assignment to the `position` or `rotation` of an entity with a body, `E5073`
    /// for one to its `scale`. `None` when the write is not the physics subsystem's business;
    /// otherwise whether the write may proceed (always false: it was reported).
    pub(super) fn physics_owned_write(
        &mut self,
        expr: &Expr,
        object: DefId,
        field: &str,
    ) -> Option<bool> {
        let (kind, body_span) = self.physics_of(object).body?;
        let name = self.object_name(object);
        let subject = self.entity_subject(object);
        match field {
            "position" | "rotation" => {
                let (allowed, help) = ownership_note(kind);
                let mut diagnostic = Diagnostic::new(
                    Code::E5071,
                    format!(
                        "`{name}.{field}` belongs to the physics subsystem, because {subject} has a {} body, so it cannot be assigned.",
                        kind.as_str()
                    ),
                )
                .at(expr.span)
                .related(body_span, "the body is declared here")
                .note(allowed);
                if let Some(help) = help {
                    diagnostic = diagnostic.help(help);
                }
                self.report(diagnostic);
                Some(false)
            }
            "scale" => {
                self.report(
                    Diagnostic::new(
                        Code::E5073,
                        format!(
                            "The field 'scale' of {subject} is construction-only and cannot be assigned, because it has a body."
                        ),
                    )
                    .at(expr.span)
                    .related(body_span, "the body is declared here")
                    .note("the collider is never scaled with the mesh, so the scale of a body is fixed where the entity is declared"),
                );
                Some(false)
            }
            _ => None,
        }
    }

    /// `E5071` for an assignment to a readable body property (`Cube.body.linear_velocity = ..`).
    pub(super) fn report_property_write(&mut self, expr: &Expr, property: &str) {
        let mut diagnostic = Diagnostic::new(
            Code::E5071,
            format!("`body.{property}` belongs to the physics subsystem and is read-only."),
        )
        .at(expr.span);
        diagnostic = match property {
            "linear_velocity" => diagnostic
                .note("a velocity is read as of the last completed tick")
                .help("set it with `set_linear_velocity(v)`, or change it with `apply_impulse(v)`"),
            _ => diagnostic
                .note("the angular velocity is read as of the last completed tick; v0.1 has no command that sets it"),
        };
        self.report(diagnostic);
    }

    /// `E5072` for `position: bind(..)` or `rotation: bind(..)` on an entity or prefab with a
    /// body, and `E5004` for `scale: bind(..)`. True when the binding was rejected.
    pub(super) fn physics_bind(
        &mut self,
        bind_span: Span,
        owner: DefId,
        noun: &str,
        object: &str,
        field: &str,
    ) -> bool {
        let Some((kind, body_span)) = self.physics_of(owner).body else {
            return false;
        };
        match field {
            "position" | "rotation" => {
                let (allowed, help) = ownership_note(kind);
                let mut diagnostic = Diagnostic::new(
                    Code::E5072,
                    format!(
                        "`bind` cannot drive the field '{field}' of {noun} '{object}': it has a {} body, which owns the pose.",
                        kind.as_str()
                    ),
                )
                .at(bind_span)
                .related(body_span, "the body is declared here")
                .note(allowed);
                if let Some(help) = help {
                    diagnostic = diagnostic.help(help);
                }
                self.report(diagnostic);
                true
            }
            "scale" => {
                self.report(
                    Diagnostic::new(
                        Code::E5004,
                        format!(
                            "`bind` cannot be the value of the field 'scale' of {noun} '{object}': the field is not bindable."
                        ),
                    )
                    .at(bind_span)
                    .related(body_span, "the body is declared here")
                    .note("the scale of an entity with a body is construction-only"),
                );
                true
            }
            _ => false,
        }
    }

    /// How a message names the entity or prefab `def`: `'Lamp'`, `the prefab 'Crate'`.
    fn entity_subject(&self, def: DefId) -> String {
        match self.res.def(def) {
            Some(d) if d.kind == DefKind::Prefab => format!("the prefab '{}'", d.name),
            Some(d) => format!("'{}'", d.name),
            None => "the entity".to_owned(),
        }
    }

    /// The name code uses for the entity or prefab `def`: `self` for a prefab.
    fn object_name(&self, def: DefId) -> String {
        match self.res.def(def) {
            Some(d) if d.kind == DefKind::Prefab => "self".to_owned(),
            Some(d) => d.name.clone(),
            None => String::new(),
        }
    }

    // ----- collision events ------------------------------------------------------------------

    /// `E5062`: a collision handler on an entity or prefab that declares no `collider`.
    pub(super) fn collision_needs_collider(
        &mut self,
        handler: &Handler,
        event: &EventDef,
        host: EventHost,
        entity: Option<DefId>,
    ) {
        if !event.requires_collider || host == EventHost::Scene {
            return;
        }
        let Some(def) = entity else {
            return;
        };
        if self.physics_of(def).collider.is_some() {
            return;
        }
        let name = self
            .res
            .def(def)
            .map_or_else(String::new, |d| d.name.clone());
        let noun = if host == EventHost::Prefab {
            "prefab"
        } else {
            "entity"
        };
        self.report(
            Diagnostic::new(
                Code::E5062,
                format!(
                    "`on {}` needs a collider, but the {noun} '{name}' declares none.",
                    event.name
                ),
            )
            .at(handler.event.span)
            .note("collision events are reported for pairs of colliders, after each physics step")
            .help(format!(
                "add `body: Static {{}}` or another body and a `collider: BoxCollider {{ size: .. }}` to the {noun}"
            )),
        );
    }

    // ----- commands and readable properties --------------------------------------------------

    /// Who `owner` (the `X` of `X.body.name`) is. `None` when the access is not one of an entity
    /// or an `entity_ref`: `known` says that the member is a body command or property, which is
    /// what lets an expression of any shape be claimed.
    fn body_owner_of(&mut self, owner: &Expr, known: bool) -> Option<Owner> {
        match &owner.kind {
            ExprKind::Name(_) | ExprKind::SelfValue => {
                let Some(Res::Def(id)) = self.res.res(owner.id) else {
                    return None;
                };
                if self.names_entity(id, &owner.kind) {
                    let name = self.object_name(id);
                    return Some(Owner::Entity { def: id, name });
                }
                let def = self.res.def(id)?;
                let holds_ref = matches!(
                    def.kind,
                    DefKind::Local { .. }
                        | DefKind::FnParam
                        | DefKind::LoopVar
                        | DefKind::Param
                        | DefKind::State
                ) && self.out.locals.get(&id) == Some(&TyId::ENTITY_REF);
                if holds_ref {
                    let ty = self.check(owner, None);
                    return Some(if ty == TyId::ENTITY_REF {
                        Owner::Ref
                    } else {
                        Owner::Error
                    });
                }
                None
            }
            _ if known => {
                let ty = self.check(owner, None);
                if ty == TyId::ENTITY_REF {
                    return Some(Owner::Ref);
                }
                if !self.is_error(ty) {
                    let shown = self.display(ty);
                    self.report(
                        Diagnostic::new(
                            Code::E3001,
                            format!(
                                "`.body` is a member of entities and `entity_ref` values, but this expression has type {shown}."
                            ),
                        )
                        .at(owner.span)
                        .expected("an entity or entity_ref")
                        .actual(shown),
                    );
                }
                Some(Owner::Error)
            }
            _ => None,
        }
    }

    /// The commands that apply to `kind`, as `a, b, c`.
    fn commands_for(&self, kind: BodyKind) -> String {
        let names: Vec<&str> = self
            .registry
            .body_commands
            .iter()
            .filter(|c| c.applies_to.contains(&kind))
            .map(|c| c.name)
            .collect();
        if names.is_empty() {
            "none".to_owned()
        } else {
            names.join(", ")
        }
    }

    /// `E5123` when the named entity `name` cannot take `what` (a command or velocity) that applies
    /// to `applies_to`. True when it can.
    fn body_kind_allows(
        &mut self,
        span: Span,
        def: DefId,
        what: &str,
        applies_to: &[BodyKind],
    ) -> bool {
        let name = self.entity_subject(def);
        let physics = self.physics_of(def);
        let Some((kind, body_span)) = physics.body else {
            // A body that is not a body descriptor was reported where it is written.
            if physics.malformed_body {
                return true;
            }
            self.report(
                Diagnostic::new(
                    Code::E5123,
                    format!("`{what}` is not valid for {name}: it has no body."),
                )
                .at(span)
                .note(format!("`{what}` applies to {}", kinds_phrase(applies_to)))
                .help(format!(
                    "declare `body: {} {{ .. }}` and a collider on {name}",
                    applies_to.first().map_or("Dynamic", |kind| kind.as_str())
                )),
            );
            return false;
        };
        if applies_to.contains(&kind) {
            return true;
        }
        let mut diagnostic = Diagnostic::new(
            Code::E5123,
            format!(
                "`{what}` is not valid for {name}: it applies to {}, but {name} has a {} body.",
                kinds_phrase(applies_to),
                kind.as_str()
            ),
        )
        .at(span)
        .related(body_span, "the body is declared here");
        diagnostic = match kind {
            BodyKind::Static => diagnostic
                .note("static bodies take no commands: their pose is fixed at creation")
                .help("make the body `Kinematic` for something the program moves, or `Dynamic` for something the solver moves"),
            _ => diagnostic.note(format!(
                "commands for a {} body: {}",
                kind.as_str(),
                self.commands_for(kind)
            )),
        };
        self.report(diagnostic);
        false
    }

    fn unknown_body_member(&mut self, owner: &str, name: &Ident) {
        let commands: Vec<&str> = self.registry.body_commands.iter().map(|c| c.name).collect();
        let properties: Vec<&str> = self
            .registry
            .body_properties
            .iter()
            .map(|p| p.name)
            .collect();
        self.report(
            Diagnostic::new(
                Code::E5001,
                format!(
                    "The body of {owner} has no command or property '{}'.",
                    name.name
                ),
            )
            .at(name.span)
            .note(format!("body commands: {}", commands.join(", ")))
            .note(format!(
                "readable body properties: {}",
                properties.join(", ")
            )),
        );
    }

    /// `Name.body.command(args)`: the body command `command` on a named entity or an
    /// `entity_ref` (`spec/physics.md` section 3). `None` when the callee is not that form.
    pub(super) fn body_command_call(
        &mut self,
        expr: &Expr,
        base: &Expr,
        name: &Ident,
        args: &[Expr],
    ) -> Option<TyId> {
        let owner_expr = body_owner(base)?;
        let command = self.registry.body_command(&name.name);
        let property = self.registry.body_property(&name.name);
        let owner = self.body_owner_of(owner_expr, command.is_some() || property.is_some())?;
        let (target, owner_name, def) = match owner {
            Owner::Error => {
                self.synth_args(args);
                return Some(TyId::ERROR);
            }
            Owner::Entity { def, name } => (BodyTarget::Entity(def), name, Some(def)),
            Owner::Ref => (BodyTarget::Ref, "an entity_ref".to_owned(), None),
        };
        if let Some(property) = property {
            self.synth_args(args);
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!("`body.{}` is a value, not a command.", property.name),
                )
                .at(name.span)
                .expected("a command")
                .actual(property.ty.spelling())
                .help(format!(
                    "read it without a call: `{owner_name}.body.{}`",
                    property.name
                )),
            );
            return Some(TyId::ERROR);
        }
        let Some(command) = command else {
            self.synth_args(args);
            let subject = def.map_or_else(|| owner_name.clone(), |def| self.entity_subject(def));
            self.unknown_body_member(&subject, name);
            return Some(TyId::ERROR);
        };
        let allowed = def.is_none_or(|def| {
            self.body_kind_allows(name.span, def, command.name, command.applies_to)
        });
        let args_ok = self.body_command_args(expr, command, args);
        if let Some(body) = &mut self.body {
            body.facts.calls.push(CallFact {
                span: expr.span,
                callee: Callee::Builtin(BuiltinCall {
                    name: format!("body.{}", command.name),
                    domain: Domain::Cpu,
                    handlers_only: true,
                }),
            });
        }
        if allowed && args_ok {
            self.calls.insert(
                expr.id,
                CallKind::BodyCommand {
                    command: command.name,
                    target,
                },
            );
        }
        Some(TyId::UNIT)
    }

    /// The arguments of `command` against its parameters: the arity (`E3002`) and each type
    /// (`E3001`). True when all fit.
    fn body_command_args(&mut self, expr: &Expr, command: &BodyCommandDef, args: &[Expr]) -> bool {
        let params: Vec<String> = command
            .params
            .iter()
            .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
            .collect();
        let text = format!("{}({})", command.name, params.join(", "));
        if args.len() != command.params.len() {
            self.synth_args(args);
            let count = command.params.len();
            let listed = if params.is_empty() {
                String::new()
            } else {
                format!(" ({})", params.join(", "))
            };
            self.report(
                Diagnostic::new(
                    Code::E3002,
                    format!(
                        "`{}` takes {count} argument{}{listed}, but {} {} given.",
                        command.name,
                        if count == 1 { "" } else { "s" },
                        args.len(),
                        if args.len() == 1 { "was" } else { "were" }
                    ),
                )
                .at(expr.span)
                .note(format!("signature: body.{text}"))
                .help(super::check::arity_help(command.name, &params, args.len())),
            );
            return false;
        }
        let mut ok = true;
        for (index, (arg, param)) in args.iter().zip(&command.params).enumerate() {
            let SigType::Exact(param_ty) = param.ty else {
                continue;
            };
            let param_ty = self.out.interner.from_type_ref(param_ty);
            let actual = self.check(arg, Some(param_ty));
            if !self.assignable(actual, param_ty) {
                ok = false;
                self.report_argument(arg.span, index, &format!("body.{text}"), param_ty, actual);
            }
        }
        ok
    }

    /// `Name.body.linear_velocity`: a readable body property (`spec/physics.md` section 3).
    /// `None` when `expr` is not that form.
    pub(super) fn body_property_read(
        &mut self,
        expr: &Expr,
        base: &Expr,
        name: &Ident,
    ) -> Option<TyId> {
        let owner_expr = body_owner(base)?;
        let command = self.registry.body_command(&name.name);
        let property = self.registry.body_property(&name.name);
        let owner = self.body_owner_of(owner_expr, command.is_some() || property.is_some())?;
        let (target, owner_name, def) = match owner {
            Owner::Error => return Some(TyId::ERROR),
            Owner::Entity { def, name } => (BodyTarget::Entity(def), name, Some(def)),
            Owner::Ref => (BodyTarget::Ref, "an entity_ref".to_owned(), None),
        };
        if let Some(command) = command {
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!("`body.{}` is a command, not a value.", command.name),
                )
                .at(name.span)
                .expected("a value")
                .actual("command")
                .help(format!("call it: `{owner_name}.body.{}(..)`", command.name)),
            );
            return Some(TyId::ERROR);
        }
        let Some(property) = property else {
            let subject = def.map_or_else(|| owner_name.clone(), |def| self.entity_subject(def));
            self.unknown_body_member(&subject, name);
            return Some(TyId::ERROR);
        };
        if self.scope.is_some_and(|scope| scope.initialiser.is_some()) {
            self.report_initialiser_read(expr, &owner_name, "entity", "body");
            return Some(TyId::ERROR);
        }
        if let Some(def) = def
            && !self.body_kind_allows(name.span, def, property.name, property.applies_to)
        {
            return Some(TyId::ERROR);
        }
        self.fields.insert(
            expr.id,
            FieldKind::BodyProperty {
                property: property.name,
                target,
            },
        );
        Some(self.out.interner.from_type_ref(property.ty))
    }

    /// `E3001` for the entity's `body` or `collider` read as a value (`Cube.body`).
    pub(super) fn descriptor_field_is_not_a_value(
        &mut self,
        expr: &Expr,
        object: &str,
        field: &str,
    ) {
        self.report(
            Diagnostic::new(
                Code::E3001,
                format!("`{object}.{field}` is a construction-only component, not a value."),
            )
            .at(expr.span)
            .expected("a value")
            .actual(field)
            .help(match field {
                "body" => format!(
                    "read `{object}.body.linear_velocity` or issue a command such as `{object}.body.apply_impulse(..)`"
                ),
                _ => "components are set where the entity is declared".to_owned(),
            }),
        );
    }
}

/// The note and help of an ownership error for an entity whose body is `kind`: what may move it.
fn ownership_note(kind: BodyKind) -> (&'static str, Option<&'static str>) {
    match kind {
        BodyKind::Dynamic => (
            "the solver owns the pose of a dynamic body; move it with `apply_impulse`, `apply_force`, `set_linear_velocity` or `teleport`",
            None,
        ),
        BodyKind::Kinematic => (
            "the pose of a kinematic body is set only with `set_kinematic_target` or `teleport`",
            None,
        ),
        BodyKind::Static => (
            "static bodies cannot move: their pose is fixed at creation",
            Some(
                "make the body `Kinematic` if the program moves it, or `Dynamic` if the solver does",
            ),
        ),
    }
}
