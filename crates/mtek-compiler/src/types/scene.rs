//! Scene and schema checks (`spec/scenes.md` sections 2 to 4, 11 and 12,
//! `spec/stdlib.md` section 3, `spec/materials.md` section 2, decision 0027).
//!
//! The checks run after the type checker has typed every field value and
//! folded every constant, and validate against the registry only: every
//! schema, field, flag, range, default and rule comes from
//! [`crate::stdlib`], so this module names no schema and no field.
//!
//! * **Fields.** Every scene, camera and entity body and every descriptor
//!   literal is checked against its schema: an unknown field is `E5001` (the
//!   message lists the valid fields), a field set twice `E5002`, a missing
//!   required field `E5003`, a value of the wrong type `E3102`, a constant
//!   outside the field's range the field's `range_code` (`E5006`, `E5011`
//!   for projections, `E5090` for scale). Literals that cannot take the
//!   field's type were reported by the type checker (`E3041`) and are not
//!   reported again. Fields gated in this build were reported by the
//!   resolver (`E9010`) and are skipped.
//! * **Constants.** Values of construction-only fields must be constant
//!   expressions (`E3090`); for a descriptor value the rule applies field by
//!   field, so the values of a mesh descriptor must be constant and the
//!   parameters of a material need not be. A field initialiser that reads a
//!   field of an entity or camera is `E5081` (section 11).
//! * **Colours** take any alpha: a material colour below 1 makes the draw
//!   translucent (decision 0138; `E5100` is retired).
//! * **Rules** between fields (`E5020`, `E5010`), the active object of a
//!   scene-object kind (`E5012`, `E5013`), the static entity limit
//!   (`E5092`) and the light rules: at most four per scene (`E5111`), none in
//!   a prefab (`E5110`).
//!
//! The result, [`CheckedScene`], is what the typed IR is built from: every
//! scene with its fields, scene objects and entity tree, each field with its
//! folded value and the registry defaults filled in.

use std::collections::BTreeSet;

use super::bind::placeholder;
use super::check::Checker;
use super::ty::{Ty, TyId};
use super::value::{ConstValue, from_registry};
use super::{NonConstant, NonConstantKind};
use crate::diagnostics::{Code, Diagnostic};
use crate::layout::builtin::MAX_LIGHTS;
use crate::resolve::gate::{
    NON_CONSTANT_INITIAL_VALUES, gate_note, hard_gate_message, is_implemented,
};
use crate::resolve::{Construct, DefId, construct_implemented};
use crate::source::Span;
use crate::stdlib::{
    ActiveObject, FieldDef, FieldRule, Limit, SceneObjectKind, SchemaCategory, SchemaDef, TypeRef,
    ValueRange,
};
use crate::syntax::ast::{
    DescField, EntityDecl, EntityMember, Expr, ExprKind, FieldInit, FieldValue, Ident, ItemKind,
    Module, NodeId, PrefabDecl, SceneDecl, SceneMember, SceneObject, StateDecl,
};

/// The most static entities one scene may declare, nested ones included
/// (`spec/compiler-architecture.md` section 9, `E5092`).
pub const MAX_STATIC_ENTITIES: usize = 16_384;

/// How deep registry defaults may nest descriptors (`Camera.projection`
/// defaults to `Perspective {}`); the registry nests one level.
const MAX_DEFAULT_DEPTH: usize = 8;

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

/// One scene declaration after the scene checks: the input of the typed IR.
///
/// The values are complete only when the check reported no error; with
/// errors, a field whose value was rejected has no value and constructs
/// gated in this build (prefab instances, `state`, handlers) are absent.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedScene {
    /// The scene's declaration.
    pub def: Option<DefId>,
    pub name: String,
    pub name_span: Span,
    /// The whole declaration, `scene Name { … }`.
    pub span: Span,
    /// The scene fields (the registry's scene schema).
    pub fields: Vec<CheckedField>,
    /// Scene state, in declaration order.
    pub state: Vec<CheckedState>,
    /// The scene objects (cameras), in declaration order.
    pub objects: Vec<CheckedObject>,
    /// The root entities, in declaration order; nested entities are their
    /// children.
    pub entities: Vec<CheckedEntity>,
}

impl CheckedScene {
    /// The field `name` of the scene.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<&CheckedField> {
        self.fields.iter().find(|f| f.name == name)
    }

    /// The active object of the scene-object kind `keyword`: the active
    /// camera for `camera`.
    #[must_use]
    pub fn active_object(&self, keyword: &str) -> Option<&CheckedObject> {
        self.objects
            .iter()
            .find(|object| object.kind == keyword && object.active)
    }

    /// Every entity in stable instance order: depth-first pre-order over the
    /// nesting, in declaration order (`spec/scenes.md` section 10.1).
    #[must_use]
    pub fn entities_in_order(&self) -> Vec<&CheckedEntity> {
        let mut out = Vec::new();
        let mut stack: Vec<&CheckedEntity> = self.entities.iter().rev().collect();
        while let Some(entity) = stack.pop() {
            out.push(entity);
            stack.extend(entity.children.iter().rev());
        }
        out
    }
}

/// Scene state after the scene checks (task M3-06).
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedState {
    pub def: Option<DefId>,
    pub name: String,
    pub name_span: Span,
    /// The whole declaration, `state name: T = expr;`.
    pub span: Span,
    /// The Mtek spelling of the type (`f32`, `color`, …).
    pub ty: String,
}

/// A scene object (a camera) after the scene checks.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedObject {
    pub def: Option<DefId>,
    /// The scene-object kind (`camera`).
    pub kind: &'static str,
    pub name: String,
    pub name_span: Span,
    /// The whole declaration, `camera Name { … }`.
    pub span: Span,
    /// Whether this is the active object of its kind (the one camera, or the
    /// one that declares `active: true`).
    pub active: bool,
    /// The fields of the kind's schema.
    pub fields: Vec<CheckedField>,
}

impl CheckedObject {
    /// The field `name` of the object.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<&CheckedField> {
        self.fields.iter().find(|f| f.name == name)
    }
}

/// An entity after the scene checks.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedEntity {
    pub def: Option<DefId>,
    pub name: String,
    pub name_span: Span,
    /// The whole declaration, `entity Name { … }`.
    pub span: Span,
    /// The fields of the registry's entity schema. A static prefab instance has none: its
    /// fields are the prefab's, completed when the IR instantiates the prefab (decision 0062).
    pub fields: Vec<CheckedField>,
    /// The nested entities, in declaration order.
    pub children: Vec<CheckedEntity>,
    /// `entity Name: Prefab { .. }`: the prefab and the values of its params.
    pub instance: Option<CheckedInstance>,
}

impl CheckedEntity {
    /// The field `name` of the entity.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<&CheckedField> {
        self.fields.iter().find(|f| f.name == name)
    }
}

/// A static prefab instance after the scene checks (`spec/scenes.md` section 5).
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedInstance {
    /// The prefab, by its declaration in any module.
    pub prefab: super::PrefabKey,
    /// The prefab's declared name.
    pub prefab_name: String,
    /// Every param of the prefab in declaration order, with the value the instance gives it
    /// or the prefab's default. Empty when a value was rejected (an error was reported).
    pub params: Vec<CheckedParam>,
}

/// The value of one param of a static prefab instance.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedParam {
    pub name: String,
    /// The Mtek spelling of the param's type.
    pub ty: String,
    pub value: ConstValue,
    /// Where the value comes from: the `name: value;` of the instance (at the member's span),
    /// or the prefab's default.
    pub origin: FieldOrigin,
}

/// A prefab after the scene checks: root fields and ordinary descendants, each with its
/// folded value or, for a value the prefab's `init` computes from its params, a stand-in.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedPrefab {
    pub def: Option<DefId>,
    pub name: String,
    pub name_span: Span,
    /// The whole declaration, `prefab Name { … }`.
    pub span: Span,
    /// The fields of the registry's entity schema, as for an entity.
    pub fields: Vec<CheckedField>,
    /// Ordinary child entities, expanded for each static instance.
    pub children: Vec<CheckedEntity>,
}

impl CheckedPrefab {
    /// The field `name` of the prefab's entity.
    #[must_use]
    pub fn field(&self, name: &str) -> Option<&CheckedField> {
        self.fields.iter().find(|f| f.name == name)
    }
}

/// One field of a checked body. Fields appear in the order of their schema;
/// a field that is neither written nor has an applicable default (an
/// optional field such as a camera's `target`, an entity without `mesh`) is
/// absent.
#[derive(Clone, Debug, PartialEq)]
pub struct CheckedField {
    /// The registry name of the field.
    pub name: &'static str,
    /// The registry type of the field.
    pub ty: TypeRef,
    /// The constant value. A descriptor value is a [`ConstValue::Struct`]
    /// with every field of its schema in schema order, the written values and
    /// the registry defaults of the others. `None` only if the value was
    /// rejected (an error was reported).
    pub value: Option<ConstValue>,
    pub origin: FieldOrigin,
    /// The value is `bind(..)`: [`FieldOrigin::Written`]'s `value` is the `bind` node (see
    /// [`crate::types::Typeck::binding_of`]) and `value` above is only a placeholder (the registry
    /// default, or zero) that the run-time evaluation of the binding replaces before the first frame.
    pub bound: bool,
    /// The value is an expression over the params of a prefab (and its constants and state),
    /// which the prefab's `init` evaluates: `value` is only a stand-in of the right type
    /// (decision 0062). Only the fields of a prefab are ever dynamic.
    pub dynamic: bool,
}

/// Where the value of a [`CheckedField`] comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldOrigin {
    /// The body declares the field: `name: value;` at `span`, whose value is
    /// the expression (or `bind`) node `value`.
    Written { span: Span, value: NodeId },
    /// The registry default.
    Default,
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/// What holds a field, for messages.
#[derive(Clone, Copy)]
enum Holder<'n> {
    /// A declaration body: `scene`, `entity` or the scene-object keyword,
    /// and the declared name.
    Body { noun: &'static str, name: &'n str },
    /// A descriptor literal of a registry schema.
    Descriptor { schema: &'static SchemaDef },
}

impl Holder<'_> {
    /// `entity 'Cube'`, `Box`.
    fn subject(self) -> String {
        match self {
            Holder::Body { noun, name } => format!("{noun} '{name}'"),
            Holder::Descriptor { schema } => schema.name.to_owned(),
        }
    }

    /// [`Self::subject`] at the start of a sentence.
    fn subject_capitalised(self) -> String {
        capitalise(&self.subject())
    }

    /// `field 'position' of entity 'Cube'`, `parameter 'color' of material
    /// Unlit`.
    fn field(self, field: &str) -> String {
        match self {
            Holder::Descriptor { schema } if schema.category == SchemaCategory::Material => {
                format!("parameter '{field}' of material {}", schema.name)
            }
            _ => format!("field '{field}' of {}", self.subject()),
        }
    }

    /// [`Self::field`] at the start of a sentence.
    fn field_capitalised(self, field: &str) -> String {
        capitalise(&self.field(field))
    }
}

fn capitalise(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The condition a range states, as a phrase: "between 3 and 256",
/// "greater than 0 and finite".
fn range_phrase(range: &ValueRange) -> String {
    let mut parts = Vec::new();
    match (range.lower, range.upper) {
        (Some(lo), Some(hi)) if lo.inclusive && hi.inclusive => {
            parts.push(format!(
                "between {} and {}",
                Limit::text(lo.limit),
                Limit::text(hi.limit)
            ));
        }
        (lower, upper) => {
            if let Some(lo) = lower {
                let word = if lo.inclusive {
                    "at least"
                } else {
                    "greater than"
                };
                parts.push(format!("{word} {}", lo.limit.text()));
            }
            if let Some(hi) = upper {
                let word = if hi.inclusive { "at most" } else { "less than" };
                parts.push(format!("{word} {}", hi.limit.text()));
            }
        }
    }
    if range.finite {
        parts.push("finite".to_owned());
    }
    parts.join(" and ")
}

/// Whether `value` (a scalar or vector constant) satisfies the bounds of
/// `range` in every component. Values without numeric components pass.
fn in_bounds(range: &ValueRange, value: &ConstValue) -> bool {
    let components: Vec<f64> = match value {
        ConstValue::I32(v) => vec![f64::from(*v)],
        ConstValue::U32(v) => vec![f64::from(*v)],
        ConstValue::F32(v) => vec![f64::from(*v)],
        ConstValue::Vec2(_) | ConstValue::Vec3(_) | ConstValue::Vec4(_) => value
            .components()
            .map(|c| c.iter().map(|x| f64::from(*x)).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    components.into_iter().all(|c| range.contains(c))
}

fn strip_parens(expr: &Expr) -> &Expr {
    let mut expr = expr;
    while let ExprKind::Paren(inner) = &expr.kind {
        expr = inner;
    }
    expr
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/// A field a body or descriptor declares, the first time it declares it.
struct Written<'e> {
    def: &'static FieldDef,
    name: &'e Ident,
    /// The whole `name: value` member.
    span: Span,
    /// The value node: the expression, or the `bind` (gated in this build).
    node: NodeId,
    /// The value expression; `None` for `bind(..)`.
    value: Option<&'e Expr>,
    /// The value is a `bind(..)`.
    bound: bool,
    /// The value passed the per-value checks; `None` until they ran.
    valid: Option<ConstValue>,
    /// The value is computed by a prefab's `init` (`valid` then holds a stand-in).
    dynamic: bool,
}

/// The outcome of the checks of one value against its field.
enum Checked {
    /// The value fits its field; its folded value.
    Valid(ConstValue),
    /// The value was rejected with a diagnostic.
    Rejected,
    /// The value has no constant value or no type (not constant, gated, or an
    /// error reported elsewhere).
    Unknown,
}

/// Counting static entities for `E5092`.
#[derive(Default)]
struct EntityCount {
    count: usize,
    /// The name of the first entity beyond the limit.
    first_over: Option<Span>,
}

impl Checker<'_> {
    /// Run the scene checks over `module` and record a [`CheckedScene`] for
    /// every scene the build checks.
    pub(super) fn scene_checks(&mut self, module: &Module) {
        for item in &module.items {
            match &item.kind {
                ItemKind::Const(decl) if construct_implemented(Construct::ConstItem) => {
                    self.descriptors_in(&decl.value);
                }
                ItemKind::Scene(decl) if construct_implemented(Construct::Scene) => {
                    if let Some(scene) = self.scene_decl(decl) {
                        self.out.scenes.push(scene);
                    }
                }
                ItemKind::Prefab(decl) if construct_implemented(Construct::Prefab) => {
                    self.prefab_decl(decl);
                }
                _ => {}
            }
        }
    }

    /// The implemented fields of an entity that hold a light component.
    fn light_fields(&self) -> Vec<&'static str> {
        self.registry
            .entity_schema()
            .map(|schema| {
                schema
                    .fields
                    .iter()
                    .filter(|f| {
                        is_implemented(f.since)
                            && f.ty == TypeRef::Descriptor(SchemaCategory::Light)
                    })
                    .map(|f| f.name)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `E5110`: a prefab declares a `light`. Lights belong to the named entities of a scene, so
    /// that the light count is static (`spec/materials.md` section 7).
    fn prefab_lights(&mut self, decl: &PrefabDecl) {
        let light_fields = self.light_fields();
        let mut members = vec![decl.members.as_slice()];
        while let Some(body) = members.pop() {
            for member in body {
                if let EntityMember::Entity(child) = member {
                    members.push(&child.members);
                }
                if let EntityMember::Field(field) = member
                    && light_fields.contains(&field.name.name.as_str())
                {
                    self.sink.push(
                    Diagnostic::new(
                        Code::E5110,
                        format!(
                            "The prefab '{}' declares a light, but lights are allowed only on the named entities of a scene.",
                            decl.name.name
                        ),
                    )
                    .at(field.name.span)
                    .note("a prefab can be spawned any number of times, so the number of lights would not be static")
                    .help("declare the light on a named entity of the scene"),
                );
                }
            }
        }
    }

    /// `E5111`: the scene declares more lights than `MtekFrame.lights` holds.
    fn light_limit(&mut self, scene: &str, entities: &[CheckedEntity]) {
        fn collect(entities: &[CheckedEntity], fields: &[&str], out: &mut Vec<(Span, String)>) {
            for entity in entities {
                for field in &entity.fields {
                    if let FieldOrigin::Written { span, .. } = field.origin
                        && fields.contains(&field.name)
                    {
                        out.push((span, entity.name.clone()));
                    }
                }
                collect(&entity.children, fields, out);
            }
        }
        let mut lights = Vec::new();
        collect(entities, &self.light_fields(), &mut lights);
        let limit = MAX_LIGHTS as usize;
        let Some((over, name)) = lights.get(limit) else {
            return;
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5111,
            format!(
                "Scene '{scene}' declares {} lights, but at most {limit} are allowed.",
                lights.len()
            ),
        )
        .at(*over)
        .note(format!(
            "the light of entity '{name}' is the first beyond the limit; the frame block holds {limit} lights"
        ));
        for (span, name) in lights.iter().take(limit) {
            diagnostic = diagnostic.related(*span, format!("the light of entity '{name}'"));
        }
        self.sink.push(diagnostic);
    }

    fn scene_decl(&mut self, decl: &SceneDecl) -> Option<CheckedScene> {
        let schema = self.registry.scene_schema()?;
        let mut inits = Vec::new();
        let mut objects = Vec::new();
        let mut entities = Vec::new();
        let mut count = EntityCount::default();
        let mut state = Vec::new();
        for member in &decl.members {
            match member {
                SceneMember::Field(field) if construct_implemented(Construct::SceneField) => {
                    inits.push(field);
                }
                SceneMember::Const(constant) if construct_implemented(Construct::BodyConst) => {
                    self.descriptors_in(&constant.value);
                }
                SceneMember::State(decl) if construct_implemented(Construct::State) => {
                    if let Some(entry) = self.state_decl(decl) {
                        state.push(entry);
                    }
                }
                SceneMember::Object(object) if construct_implemented(Construct::SceneObject) => {
                    if let Some(object) = self.scene_object_decl(object) {
                        objects.push(object);
                    }
                }
                SceneMember::Entity(entity) if construct_implemented(Construct::Entity) => {
                    if let Some(entity) = self.entity_decl(entity, &mut count, None) {
                        entities.push(entity);
                    }
                }
                // Lifecycle functions and handlers are still gated.
                _ => {}
            }
        }
        let holder = Holder::Body {
            noun: "scene",
            name: &decl.name.name,
        };
        let fields = self.body(schema, holder, &decl.name, &inits);
        for kind in &self.registry.scene_objects {
            if let Some(active) = kind.active
                && is_implemented(kind.since)
            {
                self.select_active(decl, kind, active, &mut objects);
            }
        }
        self.light_limit(&decl.name.name, &entities);
        if let Some(span) = count.first_over {
            self.sink.push(
                Diagnostic::new(
                    Code::E5092,
                    format!(
                        "Scene '{}' declares {} static entities, but at most {MAX_STATIC_ENTITIES} are allowed.",
                        decl.name.name, count.count
                    ),
                )
                .at(span)
                .note("the limit counts nested entities too"),
            );
        }
        Some(CheckedScene {
            def: self.res.def_of(decl.id),
            name: decl.name.name.clone(),
            name_span: decl.name.span,
            span: decl.span,
            fields,
            state,
            objects,
            entities,
        })
    }

    /// Record scene state already typed by the module walk (task M3-06).
    fn state_decl(&mut self, decl: &StateDecl) -> Option<CheckedState> {
        let def = self.res.def_of(decl.id);
        let ty = def
            .and_then(|id| self.out.locals.get(&id).copied())
            .unwrap_or(TyId::ERROR);
        if self.out.interner.is_error(ty) {
            return None;
        }
        if let Some(reason) = self.out.non_constant(decl.value.id).cloned() {
            self.non_constant_initial(&format!("state '{}'", decl.name.name), &reason);
        }
        Some(CheckedState {
            def,
            name: decl.name.name.clone(),
            name_span: decl.name.span,
            span: decl.span,
            ty: self.display(ty),
        })
    }

    fn scene_object_decl(&mut self, object: &SceneObject) -> Option<CheckedObject> {
        // An unknown kind was reported by the resolver (`E5014`).
        let kind = self.registry.scene_object(&object.kind.name)?;
        if !is_implemented(kind.since) {
            return None;
        }
        let schema = self.registry.schema(kind.schema)?;
        let inits: Vec<&FieldInit> = object.fields.iter().collect();
        let holder = Holder::Body {
            noun: kind.keyword,
            name: &object.name.name,
        };
        let fields = self.body(schema, holder, &object.name, &inits);
        Some(CheckedObject {
            def: self.res.def_of(object.id),
            kind: kind.keyword,
            name: object.name.name.clone(),
            name_span: object.name.span,
            span: object.span,
            active: false,
            fields,
        })
    }

    fn entity_decl(
        &mut self,
        entity: &EntityDecl,
        count: &mut EntityCount,
        parent: Option<&Ident>,
    ) -> Option<CheckedEntity> {
        let size = self
            .res
            .def_of(entity.id)
            .and_then(|def| self.instances.get(&def))
            .map_or(1, |instance| instance.entity_count);
        let before = count.count;
        count.count += size;
        if before <= MAX_STATIC_ENTITIES && count.count > MAX_STATIC_ENTITIES {
            count.first_over = Some(entity.name.span);
        }
        if entity.prefab.is_some() {
            if let Some(parent) = parent {
                self.physics_instance(self.res.def_of(entity.id), &entity.name, parent);
            }
            return self.instance_decl(entity);
        }
        let schema = self.registry.entity_schema()?;
        let mut inits = Vec::new();
        let mut children = Vec::new();
        for member in &entity.members {
            match member {
                EntityMember::Field(field) if construct_implemented(Construct::EntityField) => {
                    inits.push(field);
                }
                EntityMember::Const(constant) if construct_implemented(Construct::BodyConst) => {
                    self.descriptors_in(&constant.value);
                }
                EntityMember::Entity(child) => {
                    if let Some(child) = self.entity_decl(child, count, Some(&entity.name)) {
                        children.push(child);
                    }
                }
                // `state`, `param`, lifecycle functions and handlers are gated.
                _ => {}
            }
        }
        let holder = Holder::Body {
            noun: "entity",
            name: &entity.name.name,
        };
        let fields = self.body(schema, holder, &entity.name, &inits);
        self.physics_declaration(
            self.res.def_of(entity.id),
            &entity.name,
            "entity",
            &fields,
            parent,
        );
        Some(CheckedEntity {
            def: self.res.def_of(entity.id),
            name: entity.name.name.clone(),
            name_span: entity.name.span,
            span: entity.span,
            fields,
            children,
            instance: None,
        })
    }

    /// A static prefab instance: a named entity without fields of its own (the prefab's are
    /// completed when the IR instantiates it) and the values of the prefab's params. `None` if
    /// the prefab or a param value was rejected (reported by the typing pass).
    fn instance_decl(&mut self, entity: &EntityDecl) -> Option<CheckedEntity> {
        let def = self.res.def_of(entity.id)?;
        let instance = self.instances.get(&def)?.checked.clone()?;
        Some(CheckedEntity {
            def: Some(def),
            name: entity.name.name.clone(),
            name_span: entity.name.span,
            span: entity.span,
            fields: Vec::new(),
            children: Vec::new(),
            instance: Some(instance),
        })
    }

    /// A prefab after the typing pass: `E5110` for a light (lights belong to the named entities
    /// of a scene, so that their number is static), then the fields of the one entity it
    /// describes checked like those of an entity, with the difference that a value that reads the
    /// prefab's params, constants or state is accepted: the prefab's `init` computes it
    /// (decision 0062).
    fn prefab_decl(&mut self, decl: &PrefabDecl) {
        self.prefab_lights(decl);
        let Some(schema) = self.registry.entity_schema() else {
            return;
        };
        let light_fields = self.light_fields();
        let mut inits = Vec::new();
        for member in &decl.members {
            match member {
                // A light is reported (`E5110`) and not part of the prefab's entity.
                EntityMember::Field(field)
                    if construct_implemented(Construct::EntityField)
                        && !light_fields.contains(&field.name.name.as_str()) =>
                {
                    inits.push(field);
                }
                EntityMember::Const(constant) if construct_implemented(Construct::BodyConst) => {
                    self.descriptors_in(&constant.value);
                }
                // Params, state, lifecycle functions and handlers are the typing pass's; nested
                // entities are checked below.
                _ => {}
            }
        }
        let holder = Holder::Body {
            noun: "prefab",
            name: &decl.name.name,
        };
        self.current_prefab = self.res.def_of(decl.id);
        let fields = self.body(schema, holder, &decl.name, &inits);
        let mut count = EntityCount::default();
        let children = decl
            .members
            .iter()
            .filter_map(|member| match member {
                EntityMember::Entity(child) if child.prefab.is_none() => {
                    self.entity_decl(child, &mut count, Some(&decl.name))
                }
                _ => None,
            })
            .collect();
        self.current_prefab = None;
        self.physics_declaration(
            self.res.def_of(decl.id),
            &decl.name,
            "prefab",
            &fields,
            None,
        );
        self.out.checked_prefabs.push(CheckedPrefab {
            def: self.res.def_of(decl.id),
            name: decl.name.name.clone(),
            name_span: decl.name.span,
            span: decl.span,
            fields,
            children,
        });
    }

    // ----- bodies and descriptors ------------------------------------------

    /// Check the fields `inits` of a body against `schema` and assemble its
    /// checked fields.
    fn body(
        &mut self,
        schema: &'static SchemaDef,
        holder: Holder<'_>,
        owner: &Ident,
        inits: &[&FieldInit],
    ) -> Vec<CheckedField> {
        let entries: Vec<(&Ident, Span, &FieldValue)> = inits
            .iter()
            .map(|init| (&init.name, init.span, &init.value))
            .collect();
        let mut written = self.collect(schema, holder, &entries);
        for field in &mut written {
            if let Some(value) = field.value {
                match self.value_checks(holder, field.def, value) {
                    Checked::Valid(folded) => field.valid = Some(folded),
                    // Not constant (or not typed): perhaps an initialisation
                    // rule. A value of the wrong type was reported already. A prefab's `init`
                    // computes a value that reads its params; a stand-in keeps the field complete.
                    Checked::Unknown => {
                        if self.initialisation(holder, field.def, value)
                            && let Some(stand_in) = placeholder(field.def.ty)
                        {
                            field.valid = Some(stand_in);
                            field.dynamic = true;
                        }
                    }
                    Checked::Rejected => {}
                }
            }
        }
        self.relations(schema, holder, owner.span, &written);
        self.assemble(schema, &written)
    }

    /// Check a descriptor literal of `schema` (its fields, not whether it is
    /// constant: that is its context's business).
    fn descriptor_fields(
        &mut self,
        schema: &'static SchemaDef,
        name: &Ident,
        fields: &[DescField],
    ) {
        let holder = Holder::Descriptor { schema };
        let entries: Vec<(&Ident, Span, &FieldValue)> = fields
            .iter()
            .map(|field| (&field.name, field.span, &field.value))
            .collect();
        let mut written = self.collect(schema, holder, &entries);
        for field in &mut written {
            if let Some(value) = field.value
                && let Checked::Valid(folded) = self.value_checks(holder, field.def, value)
            {
                field.valid = Some(folded);
            }
        }
        self.relations(schema, holder, name.span, &written);
    }

    /// The fields of `schema` that `entries` declare, the first time each:
    /// `E5001` for a field the schema does not have, `E5002` for one declared
    /// again. Every value is searched for descriptor literals.
    fn collect<'e>(
        &mut self,
        schema: &'static SchemaDef,
        holder: Holder<'_>,
        entries: &[(&'e Ident, Span, &'e FieldValue)],
    ) -> Vec<Written<'e>> {
        let mut written: Vec<Written<'e>> = Vec::new();
        for &(name, span, value) in entries {
            let (node, expr) = match value {
                FieldValue::Expr(expr) => (expr.id, Some(&**expr)),
                // `bind(..)` is gated in this build.
                FieldValue::Bind(bind) => (bind.id, None),
            };
            let def = schema.field(&name.name);
            if def.is_some_and(|def| !is_implemented(def.since)) {
                // Reported by the resolver (`E9010`); not typed.
                continue;
            }
            // `model: ASSET` would instance a whole node hierarchy (`E7902`, decision 0058): the
            // value is only a `glb_asset`, which this field cannot take, not a second error.
            let model = def.is_none()
                && name.name == "model"
                && matches!(holder, Holder::Body { noun: "entity", .. });
            if model && let Some(expr) = expr {
                self.asset_state.glb_ok.insert(expr.id);
            }
            if let Some(expr) = expr {
                self.descriptors_in(expr);
            }
            let Some(def) = def else {
                if model {
                    self.model_field(holder, name);
                } else {
                    self.unknown_field(schema, holder, name);
                }
                continue;
            };
            if let Some(first) = written.iter().find(|w| w.def.name == def.name) {
                let first_span = first.name.span;
                self.sink.push(
                    Diagnostic::new(
                        Code::E5002,
                        format!(
                            "The field '{}' is set twice on {}.",
                            def.name,
                            holder.subject()
                        ),
                    )
                    .at(name.span)
                    .related(first_span, format!("'{}' is first set here", def.name))
                    .help("remove one of the two"),
                );
                continue;
            }
            written.push(Written {
                def,
                name,
                span,
                node,
                value: expr,
                bound: matches!(value, FieldValue::Bind(_)),
                valid: None,
                dynamic: false,
            });
        }
        written
    }

    /// `E7902`: an entity field `model`, which would instance a whole GLB node hierarchy.
    fn model_field(&mut self, holder: Holder<'_>, name: &Ident) {
        self.sink.push(
            Diagnostic::new(
                Code::E7902,
                format!(
                    "The field 'model' of {} would instance a whole node hierarchy, which v0.1 does not support.",
                    holder.subject()
                ),
            )
            .at(name.span)
            .note("every drawn object is a named entity that references one mesh")
            .help("write one entity per part: `mesh: MODEL.mesh(\"Name\")`, with `position: MODEL.node_position(\"Name\")` and its rotation and scale"),
        );
    }

    fn unknown_field(&mut self, schema: &'static SchemaDef, holder: Holder<'_>, name: &Ident) {
        let valid: Vec<&str> = schema
            .fields
            .iter()
            .filter(|f| is_implemented(f.since))
            .map(|f| f.name)
            .collect();
        let list = if valid.is_empty() {
            "none".to_owned()
        } else {
            valid.join(", ")
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5001,
            format!(
                "Unknown field '{}' on {}. Valid fields: {list}.",
                name.name,
                holder.subject()
            ),
        )
        .at(name.span);
        // The nearest fields (decision 0113): a typo, the same name in another letter case, or a
        // field that contains the written name (`pos` for `position`).
        let near = crate::hints::nearest(&name.name, valid.iter().copied(), 3);
        match near.as_slice() {
            [] => {}
            [single] => diagnostic = diagnostic.help(format!("did you mean '{single}'?")),
            several => {
                let several: Vec<String> = several.iter().map(|f| format!("'{f}'")).collect();
                diagnostic = diagnostic.help(format!("did you mean {}?", several.join(" or ")));
            }
        }
        self.sink.push(diagnostic);
    }

    /// The checks of one value against its field: the type (`E3102`), the
    /// range (the field's `range_code`).
    fn value_checks(
        &mut self,
        holder: Holder<'_>,
        def: &'static FieldDef,
        value: &Expr,
    ) -> Checked {
        // An untyped value lies in a gated construct; an `Error` one was
        // reported.
        let Some(ty) = self.ty_of(value.id) else {
            return Checked::Unknown;
        };
        if self.out.interner.is_error(ty) {
            return Checked::Unknown;
        }
        let expected = self.out.interner.from_type_ref(def.ty);
        if !self.out.interner.assignable(ty, expected) {
            let (expected_name, actual_name) = (self.display(expected), self.display(ty));
            let mut diagnostic = Diagnostic::new(
                Code::E3102,
                format!(
                    "{} expects {expected_name}, but received {actual_name}.",
                    holder.field_capitalised(def.name)
                ),
            )
            .at(value.span)
            .expected(expected_name.clone())
            .actual(actual_name.clone());
            let interner = &self.out.interner;
            if let (Some(want), Some(got)) =
                (interner.vector_dim(expected), interner.vector_dim(ty))
            {
                diagnostic = diagnostic.note(format!(
                    "a {expected_name} has {want} components; this value has {got}"
                ));
            }
            self.sink.push(diagnostic);
            return Checked::Rejected;
        }
        let Some(folded) = self.out.value(value.id).cloned() else {
            return Checked::Unknown;
        };
        if let Some(range) = &def.range
            && !in_bounds(range, &folded)
        {
            let phrase = range_phrase(range);
            let field = holder.field(def.name);
            let message = if matches!(def.ty, TypeRef::Vec2 | TypeRef::Vec3 | TypeRef::Vec4) {
                format!("Every component of {field} must be {phrase}, but the value is {folded}.")
            } else {
                format!(
                    "{} must be {phrase}, but the value is {folded}.",
                    capitalise(&field)
                )
            };
            self.sink
                .push(Diagnostic::new(def.range_code, message).at(value.span));
            return Checked::Rejected;
        }
        Checked::Valid(folded)
    }

    /// A field value of a body that is not a constant expression: `E5081`
    /// where it reads a field of an entity or camera (`spec/scenes.md`
    /// section 11), otherwise `E3090` where the field requires a constant. A
    /// construction-only field requires one, except that a descriptor value
    /// requires one only in its own construction-only fields (a mesh's size,
    /// not a material's colour); each descriptor field is judged on its own.
    ///
    /// True when the value is accepted although it is not constant: the field of a prefab whose
    /// value its `init` computes (decision 0062).
    fn initialisation(&mut self, holder: Holder<'_>, def: &'static FieldDef, value: &Expr) -> bool {
        let inner = strip_parens(value);
        if let ExprKind::Descriptor { fields, .. } = &inner.kind
            && let Some(schema) = self.schema_of(inner)
        {
            let holder = Holder::Descriptor { schema };
            let mut seen = BTreeSet::new();
            for field in fields {
                let Some(field_def) = schema.field(&field.name.name) else {
                    continue;
                };
                if !is_implemented(field_def.since) || !seen.insert(field_def.name) {
                    continue;
                }
                if let FieldValue::Expr(field_value) = &field.value {
                    self.initialisation(holder, field_def, field_value);
                }
            }
            return false;
        }
        // A user material instance (decision 0039): each param on its own;
        // none is construction-only.
        if let ExprKind::Descriptor { fields, .. } = &inner.kind
            && let Some(Ty::MaterialInstance(_)) =
                self.ty_of(inner.id).map(|t| self.out.interner.get(t))
        {
            let material = self.display(self.ty_of(inner.id).unwrap_or(super::TyId::ERROR));
            for field in fields {
                if let FieldValue::Expr(field_value) = &field.value
                    && let Some(reason) = self.out.non_constant(field_value.id).cloned()
                {
                    let what = format!("parameter '{}' of material {material}", field.name.name);
                    self.non_constant_initial(&what, &reason);
                }
            }
            return false;
        }
        let Some(reason) = self.out.non_constant(value.id).cloned() else {
            return false;
        };
        if reason.kind == NonConstantKind::ObjectField || !def.flags.is_construction_only() {
            return self.non_constant_initial(&holder.field(def.name), &reason);
        }
        self.sink.push(
            Diagnostic::new(
                Code::E3090,
                format!(
                    "The value of {} is not a constant expression: {}.",
                    holder.field(def.name),
                    reason.reason
                ),
            )
            .at(reason.span)
            .note("construction-only values may use only literals, constants, operators, conversions, constructors and const-eligible built-in functions"),
        );
        false
    }

    /// The initial value of `what` ("field 'position' of entity 'Cube'") is
    /// not a constant expression, and need not be: `E5081` where it reads a
    /// field of an entity or camera; otherwise it is valid v0.1 (evaluated
    /// once at construction) that this build does not implement yet, because
    /// it folds every initial value (`E9010`, decision 0039). The exception is a prefab: its
    /// `init` evaluates the expression with the instance's params (decision 0062), which is
    /// what the result `true` says.
    fn non_constant_initial(&mut self, what: &str, reason: &NonConstant) -> bool {
        if reason.kind != NonConstantKind::ObjectField && self.current_prefab.is_some() {
            return true;
        }
        if reason.kind == NonConstantKind::ObjectField {
            self.sink.push(
                Diagnostic::new(
                    Code::E5081,
                    format!(
                        "The value of {what} cannot be computed during initialisation: {}.",
                        reason.reason
                    ),
                )
                .at(reason.span)
                .note(if self.current_prefab.is_some() {
                    "initialisers of a prefab may read constants, params and state, but not the fields of the entity"
                } else {
                    "field initialisers may read constants, scene state and earlier state, but not the fields of entities or cameras"
                }),
            );
            return false;
        }
        self.sink.push(
            Diagnostic::new(Code::E9010, hard_gate_message(&NON_CONSTANT_INITIAL_VALUES))
                .at(reason.span)
                .note(format!(
                    "the value of {what} is not a constant expression: {}",
                    reason.reason
                ))
                .note(gate_note()),
        );
        false
    }

    /// The rules between fields: cross-field ranges, the schema's rules
    /// (`E5020`, `E5010`) and required fields (`E5003`, at `missing_at`).
    fn relations(
        &mut self,
        schema: &'static SchemaDef,
        holder: Holder<'_>,
        missing_at: Span,
        written: &[Written<'_>],
    ) {
        let find = |name: &str| written.iter().find(|w| w.def.name == name);
        for field in written {
            let Some(sibling) = field.def.range.and_then(|r| r.greater_than_field) else {
                continue;
            };
            let Some(sibling_def) = schema.field(sibling) else {
                continue;
            };
            let own = match &field.valid {
                Some(value) => value.as_f32(),
                None => continue,
            };
            let (other, other_written) = match find(sibling) {
                Some(w) => match &w.valid {
                    Some(value) => (value.as_f32(), true),
                    None => continue,
                },
                None => (
                    sibling_def
                        .default
                        .as_ref()
                        .and_then(from_registry)
                        .and_then(|v| v.as_f32()),
                    false,
                ),
            };
            let (Some(own), Some(other)) = (own, other) else {
                continue;
            };
            if own > other {
                continue;
            }
            let Some(value) = field.value else {
                continue;
            };
            let default_note = if other_written { "" } else { ", its default" };
            self.sink.push(
                Diagnostic::new(
                    field.def.range_code,
                    format!(
                        "{} must be greater than '{sibling}' ({other:?}{default_note}), but the value is {own:?}.",
                        holder.field_capitalised(field.def.name),
                    ),
                )
                .at(value.span),
            );
        }
        // A sibling written with a value the default of a field it must stay
        // below cannot exceed (`near: 2000.0` with the default `far`).
        for def in &schema.fields {
            let Some(sibling) = def.range.and_then(|r| r.greater_than_field) else {
                continue;
            };
            if find(def.name).is_some() {
                continue;
            }
            let Some(below) = find(sibling) else {
                continue;
            };
            let (Some(value), Some(own)) = (
                below.value,
                below.valid.as_ref().and_then(ConstValue::as_f32),
            ) else {
                continue;
            };
            let Some(limit) = def
                .default
                .as_ref()
                .and_then(from_registry)
                .and_then(|v| v.as_f32())
            else {
                continue;
            };
            if limit > own {
                continue;
            }
            self.sink.push(
                Diagnostic::new(
                    def.range_code,
                    format!(
                        "{} must be less than '{}' ({limit:?}, its default), but the value is {own:?}.",
                        holder.field_capitalised(sibling),
                        def.name,
                    ),
                )
                .at(value.span),
            );
        }
        for rule in &schema.rules {
            match *rule {
                FieldRule::Requires {
                    field,
                    requires,
                    code,
                    help,
                } => {
                    if let Some(w) = find(field)
                        && find(requires).is_none()
                    {
                        let help = help.map_or_else(
                            || format!("declare '{requires}', or remove '{field}'"),
                            str::to_owned,
                        );
                        self.sink.push(
                            Diagnostic::new(
                                code,
                                format!(
                                    "{} declares '{field}' without '{requires}'.",
                                    holder.subject_capitalised()
                                ),
                            )
                            .at(w.name.span)
                            .note(format!("'{field}' is used only together with '{requires}'"))
                            .help(help),
                        );
                    }
                }
                FieldRule::ExcludedBy {
                    field,
                    excluded_by,
                    code,
                } => {
                    if let (Some(w), Some(other)) = (find(field), find(excluded_by)) {
                        self.sink.push(
                            Diagnostic::new(
                                code,
                                format!(
                                    "{} declares both '{excluded_by}' and '{field}'.",
                                    holder.subject_capitalised()
                                ),
                            )
                            .at(w.name.span)
                            .related(other.name.span, format!("'{excluded_by}' is declared here"))
                            .note(format!(
                                "'{field}' must not be declared together with '{excluded_by}'"
                            )),
                        );
                    }
                }
            }
        }
        for def in &schema.fields {
            if def.flags.is_required() && is_implemented(def.since) && find(def.name).is_none() {
                self.sink.push(
                    Diagnostic::new(
                        Code::E5003,
                        format!(
                            "Missing required field '{}' on {}.",
                            def.name,
                            holder.subject()
                        ),
                    )
                    .at(missing_at)
                    .help(format!("add `{}: …`", def.name)),
                );
            }
        }
    }

    /// The checked fields of a body: every implemented field of `schema`
    /// that is written or has an applicable default, in schema order.
    fn assemble(&self, schema: &'static SchemaDef, written: &[Written<'_>]) -> Vec<CheckedField> {
        let present: BTreeSet<&str> = written.iter().map(|w| w.def.name).collect();
        let mut fields = Vec::new();
        for def in schema.fields.iter().filter(|f| is_implemented(f.since)) {
            if let Some(w) = written.iter().find(|w| w.def.name == def.name) {
                let value = if w.bound {
                    // A binding's value arrives at run time; keep a stand-in of the right type.
                    self.default_of(def, &present, 0)
                        .or_else(|| placeholder(def.ty))
                } else {
                    w.valid.clone().map(|v| self.normalize(v, 0))
                };
                fields.push(CheckedField {
                    name: def.name,
                    ty: def.ty,
                    value,
                    origin: FieldOrigin::Written {
                        span: w.span,
                        value: w.node,
                    },
                    bound: w.bound,
                    dynamic: w.dynamic,
                });
            } else if let Some(value) = self.default_of(def, &present, 0) {
                fields.push(CheckedField {
                    name: def.name,
                    ty: def.ty,
                    value: Some(value),
                    origin: FieldOrigin::Default,
                    bound: false,
                    dynamic: false,
                });
            }
        }
        fields
    }

    /// The default of `def` if it applies, given the written fields
    /// `present` of its body or descriptor.
    fn default_of(
        &self,
        def: &FieldDef,
        present: &BTreeSet<&str>,
        depth: usize,
    ) -> Option<ConstValue> {
        let default = def.default.as_ref()?;
        if let Some(sibling) = def.default_when_set
            && !present.contains(sibling)
        {
            return None;
        }
        Some(self.normalize(from_registry(default)?, depth + 1))
    }

    /// `value` with every descriptor in it completed: the fields of its
    /// schema in schema order, written values first, defaults for the rest.
    fn normalize(&self, value: ConstValue, depth: usize) -> ConstValue {
        let ConstValue::Struct { name, fields } = value else {
            return value;
        };
        let schema = match self.registry.schema(&name) {
            Some(schema) if depth <= MAX_DEFAULT_DEPTH => schema,
            _ => return ConstValue::Struct { name, fields },
        };
        let present: BTreeSet<&str> = fields.iter().map(|(n, _)| n.as_str()).collect();
        let mut out = Vec::new();
        for def in schema.fields.iter().filter(|f| is_implemented(f.since)) {
            if let Some((_, written)) = fields.iter().find(|(n, _)| n == def.name) {
                out.push((
                    def.name.to_owned(),
                    self.normalize(written.clone(), depth + 1),
                ));
            } else if let Some(default) = self.default_of(def, &present, depth) {
                out.push((def.name.to_owned(), default));
            }
        }
        ConstValue::Struct { name, fields: out }
    }

    /// The registry schema of a descriptor literal the checker typed.
    fn schema_of(&self, expr: &Expr) -> Option<&'static SchemaDef> {
        let ty = self.ty_of(expr.id)?;
        match self.out.interner.get(ty) {
            Ty::Schema(name) => self.registry.schema(name),
            _ => None,
        }
    }

    /// Check every descriptor literal in `expr`.
    fn descriptors_in(&mut self, expr: &Expr) {
        match &expr.kind {
            ExprKind::Descriptor { name, fields } => {
                if let Some(schema) = self.schema_of(expr) {
                    self.descriptor_fields(schema, name, fields);
                } else {
                    for field in fields {
                        if let FieldValue::Expr(value) = &field.value {
                            self.descriptors_in(value);
                        }
                    }
                }
            }
            ExprKind::Paren(inner) | ExprKind::Unary { operand: inner, .. } => {
                self.descriptors_in(inner);
            }
            ExprKind::Field { base, .. } => self.descriptors_in(base),
            ExprKind::Binary { lhs, rhs, .. }
            | ExprKind::Index {
                base: lhs,
                index: rhs,
            } => {
                self.descriptors_in(lhs);
                self.descriptors_in(rhs);
            }
            ExprKind::Call { callee, args } => {
                self.descriptors_in(callee);
                for arg in args {
                    self.descriptors_in(arg);
                }
            }
            ExprKind::Array(items) => {
                for item in items {
                    self.descriptors_in(item);
                }
            }
            ExprKind::Match { scrutinee, arms } => {
                self.descriptors_in(scrutinee);
                for arm in arms {
                    if let crate::syntax::ast::ArmBody::Expr(value) = &arm.body {
                        self.descriptors_in(value);
                    }
                }
            }
            ExprKind::Interp { parts } => {
                for part in parts {
                    if let crate::syntax::ast::InterpPart::Expr { expr, .. } = part {
                        self.descriptors_in(expr);
                    }
                }
            }
            ExprKind::Int { .. }
            | ExprKind::Float { .. }
            | ExprKind::Str { .. }
            | ExprKind::Color { .. }
            | ExprKind::Bool(_)
            | ExprKind::SelfValue
            | ExprKind::Name(_)
            | ExprKind::Error => {}
        }
    }

    // ----- active objects --------------------------------------------------

    /// Mark the active object of `kind` among `objects`, or report why there
    /// is none (`active.missing`, `active.ambiguous`).
    fn select_active(
        &mut self,
        scene: &SceneDecl,
        kind: &SceneObjectKind,
        active: ActiveObject,
        objects: &mut [CheckedObject],
    ) {
        let keyword = kind.keyword;
        let indices: Vec<usize> = objects
            .iter()
            .enumerate()
            .filter(|(_, o)| o.kind == keyword)
            .map(|(i, _)| i)
            .collect();
        let scene_name = &scene.name.name;
        // Each object's `active` field: Some(Some(b)) if written with a
        // value, Some(None) if written but rejected, None if absent.
        let marks: Vec<(usize, Option<Option<bool>>, Option<Span>)> = indices
            .iter()
            .filter_map(|&i| objects.get(i).map(|o| (i, o)))
            .map(|(i, object)| {
                let field = object
                    .fields
                    .iter()
                    .find(|f| f.name == active.field && f.origin != FieldOrigin::Default);
                let span = field.and_then(|f| match f.origin {
                    FieldOrigin::Written { span, .. } => Some(span),
                    FieldOrigin::Default => None,
                });
                let mark = field.map(|f| match f.value {
                    Some(ConstValue::Bool(b)) => Some(b),
                    _ => None,
                });
                (i, mark, span)
            })
            .collect();
        match marks.as_slice() {
            [] => {
                self.sink.push(
                    Diagnostic::new(
                        active.missing,
                        format!("Scene '{scene_name}' has no {keyword}."),
                    )
                    .at(scene.name.span)
                    .help(format!(
                        "declare one in the scene: `{keyword} Name {{ … }}`"
                    )),
                );
            }
            [(index, mark, span)] => match (mark, span) {
                (Some(Some(false)), Some(span)) => {
                    let name = objects.get(*index).map_or("", |o| o.name.as_str());
                    self.sink.push(
                        Diagnostic::new(
                            active.ambiguous,
                            format!(
                                "The only {keyword} of scene '{scene_name}', '{name}', declares `{}: false`.",
                                active.field
                            ),
                        )
                        .at(*span)
                        .note(format!("a scene renders through exactly one active {keyword}"))
                        .help(format!(
                            "remove `{}: false`; with one {keyword}, it is the active one",
                            active.field
                        )),
                    );
                }
                (Some(None), _) => {}
                _ => {
                    if let Some(object) = objects.get_mut(*index) {
                        object.active = true;
                    }
                }
            },
            several => {
                if several
                    .iter()
                    .any(|(_, mark, _)| matches!(mark, Some(None)))
                {
                    // A rejected `active` value was reported; counting
                    // without it would be a cascade.
                    return;
                }
                let chosen: Vec<(usize, Option<Span>)> = several
                    .iter()
                    .filter(|(_, mark, _)| matches!(mark, Some(Some(true))))
                    .map(|(i, _, span)| (*i, *span))
                    .collect();
                match chosen.as_slice() {
                    [(index, _)] => {
                        if let Some(object) = objects.get_mut(*index) {
                            object.active = true;
                        }
                    }
                    [] => {
                        let mut diagnostic = Diagnostic::new(
                            active.ambiguous,
                            format!(
                                "Scene '{scene_name}' has {} {keyword}s, but none declares `{}: true`.",
                                several.len(),
                                active.field
                            ),
                        )
                        .at(scene.name.span);
                        for (index, _, _) in several {
                            if let Some(object) = objects.get(*index) {
                                diagnostic = diagnostic.related(
                                    object.name_span,
                                    format!("{keyword} '{}' is declared here", object.name),
                                );
                            }
                        }
                        self.sink.push(diagnostic.help(format!(
                            "mark exactly one {keyword} `{}: true`",
                            active.field
                        )));
                    }
                    [(first, first_span), rest @ ..] => {
                        let Some((_, Some(primary))) = rest.first().copied() else {
                            return;
                        };
                        let mut diagnostic = Diagnostic::new(
                            active.ambiguous,
                            format!(
                                "Scene '{scene_name}' has {} {keyword}s that declare `{}: true`; exactly one may.",
                                chosen.len(),
                                active.field
                            ),
                        )
                        .at(primary);
                        let mut others: Vec<(usize, Option<Span>)> = vec![(*first, *first_span)];
                        others.extend(rest.iter().skip(1).copied());
                        for (index, span) in others {
                            if let (Some(object), Some(span)) = (objects.get(index), span) {
                                diagnostic = diagnostic.related(
                                    span,
                                    format!(
                                        "{keyword} '{}' is also marked active here",
                                        object.name
                                    ),
                                );
                            }
                        }
                        self.sink.push(diagnostic.help(format!(
                            "keep `{}: true` on one {keyword} only",
                            active.field
                        )));
                    }
                }
            }
        }
    }
}
