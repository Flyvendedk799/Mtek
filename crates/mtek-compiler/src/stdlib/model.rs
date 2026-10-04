//! The registry data model (`spec/stdlib.md` section 1.1).
//!
//! Every prelude name is one value of one of these types; the tables that fill them live in
//! `stdlib::data`. The model is plain data: no behaviour beyond small accessors, so that the
//! JSON export, name resolution, the checker and the LSP all read the same facts.

use std::ops::BitOr;

use super::value::{ConstValue, ValueRange};
use crate::diagnostics::Code;

/// The milestone in which the compiler implements an item.
///
/// Items whose milestone has not been reached in the running build are still resolvable but
/// produce `E9010` when used (`spec/stdlib.md` section 1.1), so the registry is complete from
/// M1 while semantics land per milestone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Milestone {
    M1,
    M2,
    M3,
    M4,
    M5,
}

impl Milestone {
    /// The name used in documentation and in `stdlib-schema.json`: `"M1"` ... `"M5"`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Milestone::M1 => "M1",
            Milestone::M2 => "M2",
            Milestone::M3 => "M3",
            Milestone::M4 => "M4",
            Milestone::M5 => "M5",
        }
    }

    /// Whether an item added in `self` is implemented by a build that has reached `current`.
    pub const fn is_reached_by(self, current: Milestone) -> bool {
        (self as u8) <= (current as u8)
    }
}

/// The milestone this compiler build has reached. Items with a later `since` are resolvable
/// but their use is `E9010`.
pub const CURRENT_MILESTONE: Milestone = Milestone::M1;

/// The kind of value a schema describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SchemaCategory {
    Mesh,
    Material,
    Light,
    Body,
    Collider,
    Projection,
    /// `Scene`, `Entity` and `Camera`: the declarations whose fields are written directly.
    Object,
}

impl SchemaCategory {
    /// The lowercase name used in `stdlib-schema.json`.
    pub const fn as_str(self) -> &'static str {
        match self {
            SchemaCategory::Mesh => "mesh",
            SchemaCategory::Material => "material",
            SchemaCategory::Light => "light",
            SchemaCategory::Body => "body",
            SchemaCategory::Collider => "collider",
            SchemaCategory::Projection => "projection",
            SchemaCategory::Object => "object",
        }
    }
}

/// A type as the registry spells it.
///
/// A mesh descriptor (`Box {..}`) is a value of type `mesh` and a material instance
/// (`Unlit {..}`) a value of type `material`; descriptors of the other categories have no
/// handle type and are written [`TypeRef::Descriptor`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TypeRef {
    Bool,
    I32,
    U32,
    F32,
    String,
    Vec2,
    Vec3,
    Vec4,
    Mat4,
    Quat,
    Color,
    Mesh,
    Material,
    Texture,
    Sampler,
    EntityRef,
    /// The opaque compile-time handle of `asset.glb(..)` (`spec/assets.md` section 2).
    GlbAsset,
    /// The result of a function without `->`.
    Unit,
    /// A built-in record type, by name (`SurfaceInput`, `PointerEvent`).
    Record(&'static str),
    /// A registry enum, by name (`Key`).
    Enum(&'static str),
    /// A descriptor literal of a schema of this category (`Perspective {..}`, `Dynamic {..}`).
    Descriptor(SchemaCategory),
    /// The argument of `spawn`: a prefab descriptor `Prefab { params.. }`.
    PrefabDescriptor,
}

impl TypeRef {
    /// The Mtek spelling of the type, as written in `stdlib-schema.json`.
    pub const fn spelling(&self) -> &'static str {
        match self {
            TypeRef::Bool => "bool",
            TypeRef::I32 => "i32",
            TypeRef::U32 => "u32",
            TypeRef::F32 => "f32",
            TypeRef::String => "string",
            TypeRef::Vec2 => "vec2",
            TypeRef::Vec3 => "vec3",
            TypeRef::Vec4 => "vec4",
            TypeRef::Mat4 => "mat4",
            TypeRef::Quat => "quat",
            TypeRef::Color => "color",
            TypeRef::Mesh => "mesh",
            TypeRef::Material => "material",
            TypeRef::Texture => "texture",
            TypeRef::Sampler => "sampler",
            TypeRef::EntityRef => "entity_ref",
            TypeRef::GlbAsset => "glb_asset",
            TypeRef::Unit => "()",
            TypeRef::Record(name) | TypeRef::Enum(name) => name,
            TypeRef::Descriptor(category) => category.as_str(),
            TypeRef::PrefabDescriptor => "prefab descriptor",
        }
    }
}

/// Field flags (`spec/stdlib.md` section 3): **R** required, **W** writable from handlers,
/// **B** bindable, **C** construction-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FieldFlags(u8);

impl FieldFlags {
    pub const NONE: FieldFlags = FieldFlags(0);
    pub const REQUIRED: FieldFlags = FieldFlags(1);
    pub const WRITABLE: FieldFlags = FieldFlags(2);
    pub const BINDABLE: FieldFlags = FieldFlags(4);
    pub const CONSTRUCTION_ONLY: FieldFlags = FieldFlags(8);

    /// The flags set in `self` or in `other` (the `const` form of `|`).
    pub const fn union(self, other: FieldFlags) -> FieldFlags {
        FieldFlags(self.0 | other.0)
    }

    /// Whether every flag of `other` is set in `self`.
    pub const fn contains(self, other: FieldFlags) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn is_required(self) -> bool {
        self.contains(Self::REQUIRED)
    }

    pub const fn is_writable(self) -> bool {
        self.contains(Self::WRITABLE)
    }

    pub const fn is_bindable(self) -> bool {
        self.contains(Self::BINDABLE)
    }

    pub const fn is_construction_only(self) -> bool {
        self.contains(Self::CONSTRUCTION_ONLY)
    }
}

impl BitOr for FieldFlags {
    type Output = FieldFlags;

    fn bitor(self, rhs: FieldFlags) -> FieldFlags {
        self.union(rhs)
    }
}

/// One field of a schema.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldDef {
    pub name: &'static str,
    pub ty: TypeRef,
    /// The default as a constant. Its canonical source text is
    /// [`FieldDef::default_text`].
    pub default: Option<ConstValue>,
    /// When set, the default applies only while the named sibling field is set
    /// (`Entity.material` defaults to `Unlit {}` only when `mesh` is set).
    pub default_when_set: Option<&'static str>,
    pub flags: FieldFlags,
    pub range: Option<ValueRange>,
    /// The diagnostic for a constant outside `range` (decision 0027): `E5006` unless the
    /// specification names a dedicated code (`E5011` for projections, `E5090` for scale).
    pub range_code: Code,
    pub since: Milestone,
    pub doc: &'static str,
}

impl FieldDef {
    /// The canonical source text of the default (`spec/stdlib.md` section 1.2).
    pub fn default_text(&self) -> Option<String> {
        self.default.map(|value| value.canonical_text())
    }

    /// The documentation text of the range, if the field has one.
    pub fn range_text(&self) -> Option<String> {
        self.range.map(|range| range.describe(&self.ty))
    }
}

/// A registry schema: the type of a descriptor literal or of a scene/entity/camera body.
#[derive(Debug, Clone, PartialEq)]
pub struct SchemaDef {
    pub name: &'static str,
    pub category: SchemaCategory,
    pub fields: Vec<FieldDef>,
    /// Rules between fields that every body and descriptor of the schema must satisfy.
    pub rules: Vec<FieldRule>,
    pub since: Milestone,
    pub doc: &'static str,
}

impl SchemaDef {
    /// The field named `name`, if the schema has one.
    pub fn field(&self, name: &str) -> Option<&FieldDef> {
        self.fields.iter().find(|f| f.name == name)
    }
}

/// A rule between two fields of one schema (decision 0027). The checker enforces it on
/// every scene, entity or scene-object body and every descriptor literal of the schema;
/// `code` is the diagnostic the specification names for the violation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldRule {
    /// `field` may be declared only together with `requires` (`Entity.material` needs a
    /// `mesh`, `E5020`).
    Requires {
        field: &'static str,
        requires: &'static str,
        code: Code,
    },
    /// `field` must not be declared together with `excluded_by` (`Camera.rotation` when a
    /// `target` is declared, `E5010`).
    ExcludedBy {
        field: &'static str,
        excluded_by: &'static str,
        code: Code,
    },
}

/// The schemas of the declarations whose fields are written directly in their body: scene
/// fields and entity (and prefab) fields. Camera fields come from the scene-object kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeclarationSchemas {
    /// The fields of `scene Name { .. }`.
    pub scene: &'static str,
    /// The fields of `entity Name { .. }` and `prefab Name { .. }`.
    pub entity: &'static str,
}

/// How a scene selects the one active object of a scene-object kind (decision 0027): a
/// scene must declare at least one object of the kind (`missing`), and with several, exactly
/// one of them must set the `bool` field `field` to `true` (`ambiguous`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveObject {
    pub field: &'static str,
    pub missing: Code,
    pub ambiguous: Code,
}

/// The kind of a registry type (`spec/language.md` section 5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeKind {
    Scalar,
    Text,
    Vector,
    Matrix,
    Rotation,
    Color,
    Handle,
    /// The generic `array<T, N>`.
    Array,
    /// A built-in record with named fields.
    Record,
}

impl TypeKind {
    /// The lowercase name used in `stdlib-schema.json`.
    pub const fn as_str(self) -> &'static str {
        match self {
            TypeKind::Scalar => "scalar",
            TypeKind::Text => "text",
            TypeKind::Vector => "vector",
            TypeKind::Matrix => "matrix",
            TypeKind::Rotation => "rotation",
            TypeKind::Color => "color",
            TypeKind::Handle => "handle",
            TypeKind::Array => "array",
            TypeKind::Record => "record",
        }
    }
}

/// One named, typed member of a built-in record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordField {
    pub name: &'static str,
    pub ty: TypeRef,
}

/// A prelude type.
#[derive(Debug, Clone, PartialEq)]
pub struct TypeDef {
    pub name: &'static str,
    pub kind: TypeKind,
    /// Whether values of the type can exist in GPU code.
    pub gpu: bool,
    /// Fields of a record type (empty otherwise).
    pub fields: Vec<RecordField>,
    /// Accessors of a handle type (`glb_asset`), each a const-eligible compile-time function.
    pub methods: Vec<IntrinsicDef>,
    pub since: Milestone,
    pub doc: &'static str,
}

/// A scene-object kind: the contextual keyword that introduces a scene member
/// (`camera Main { .. }`) and the schema describing its fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SceneObjectKind {
    pub keyword: &'static str,
    pub schema: &'static str,
    /// Whether every scene needs exactly one active object of this kind, and how it is
    /// chosen (`camera`: `E5012`, `E5013`).
    pub active: Option<ActiveObject>,
    pub since: Milestone,
    pub doc: &'static str,
}

/// Where an event handler may be declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventHost {
    Scene,
    Entity,
    Prefab,
}

impl EventHost {
    pub const fn as_str(self) -> &'static str {
        match self {
            EventHost::Scene => "scene",
            EventHost::Entity => "entity",
            EventHost::Prefab => "prefab",
        }
    }
}

/// How an event passes its payload to the handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventForm {
    /// `on key_down(Key.Space)`: a constant of this type the event must match.
    Filter(TypeRef),
    /// `on pointer_down(event: PointerEvent)`: one parameter of this type.
    Parameter(TypeRef),
}

/// An event handlers can subscribe to (`spec/stdlib.md` section 5.1).
#[derive(Debug, Clone, PartialEq)]
pub struct EventDef {
    pub name: &'static str,
    pub form: EventForm,
    pub hosts: &'static [EventHost],
    /// Entities and prefabs that host the handler must declare a `collider` (`E5062`).
    pub requires_collider: bool,
    pub since: Milestone,
    pub doc: &'static str,
}

/// One member of an enum: its Mtek name and the DOM `KeyboardEvent.code` it maps from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnumMember {
    pub name: &'static str,
    pub code: &'static str,
    pub since: Milestone,
}

/// A registry enum (`Key`, `spec/stdlib.md` section 5.2).
#[derive(Debug, Clone, PartialEq)]
pub struct EnumDef {
    pub name: &'static str,
    pub members: Vec<EnumMember>,
    pub since: Milestone,
    pub doc: &'static str,
}

/// The execution domain of an intrinsic (`spec/stdlib.md` section 6, column D).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    Both,
    Cpu,
    Gpu,
}

impl Domain {
    pub const fn as_str(self) -> &'static str {
        match self {
            Domain::Both => "both",
            Domain::Cpu => "cpu",
            Domain::Gpu => "gpu",
        }
    }
}

/// A type class of the signature notation of `spec/stdlib.md` section 6.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeClass {
    /// `T`: `f32`, `vec2`, `vec3`, `vec4` (component-wise).
    Float,
    /// `I`: `i32`, `u32`.
    Int,
    /// `V`: `vec2`, `vec3`, `vec4` (decision 0024 item 1: the specification never defines it).
    Vector,
}

impl TypeClass {
    /// Every class, in the order `stdlib-schema.json` lists them.
    pub const ALL: [TypeClass; 3] = [TypeClass::Int, TypeClass::Float, TypeClass::Vector];

    /// The letter used in signatures.
    pub const fn name(self) -> &'static str {
        match self {
            TypeClass::Float => "T",
            TypeClass::Int => "I",
            TypeClass::Vector => "V",
        }
    }

    /// The concrete types the class ranges over.
    pub const fn members(self) -> &'static [TypeRef] {
        match self {
            TypeClass::Float => &[TypeRef::F32, TypeRef::Vec2, TypeRef::Vec3, TypeRef::Vec4],
            TypeClass::Int => &[TypeRef::I32, TypeRef::U32],
            TypeClass::Vector => &[TypeRef::Vec2, TypeRef::Vec3, TypeRef::Vec4],
        }
    }
}

/// A type position in a signature: one concrete type or a type class. Every position of one
/// class within one signature stands for the same concrete type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SigType {
    Exact(TypeRef),
    Class(TypeClass),
}

impl SigType {
    /// The spelling: the type name or the class letter.
    pub const fn spelling(&self) -> &'static str {
        match self {
            SigType::Exact(ty) => ty.spelling(),
            SigType::Class(class) => class.name(),
        }
    }
}

/// A named parameter of a signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParamDef {
    pub name: &'static str,
    pub ty: SigType,
}

/// One overload of an intrinsic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub params: Vec<ParamDef>,
    pub ret: SigType,
}

impl Signature {
    /// The signature as documentation text: `(x: T, y: T) -> T`.
    pub fn text(&self) -> String {
        let params = self
            .params
            .iter()
            .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
            .collect::<Vec<_>>()
            .join(", ");
        format!("({params}) -> {}", self.ret.spelling())
    }
}

/// A prelude function: a global intrinsic, a namespace function or a type accessor.
#[derive(Debug, Clone, PartialEq)]
pub struct IntrinsicDef {
    pub name: &'static str,
    pub signatures: Vec<Signature>,
    pub domain: Domain,
    /// Usable in constant expressions (column K).
    pub const_eligible: bool,
    /// Allowed only inside lifecycle functions and handlers (`spawn`, `destroy`).
    pub handlers_only: bool,
    /// Notes on the CPU semantics where they differ from the WGSL definition.
    pub cpu_semantics: &'static str,
    pub since: Milestone,
    pub doc: &'static str,
}

/// A non-function member of a namespace (`frame.time`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValueDef {
    pub name: &'static str,
    pub ty: TypeRef,
    pub domain: Domain,
    pub since: Milestone,
    pub doc: &'static str,
}

/// A member of a namespace.
#[derive(Debug, Clone, PartialEq)]
pub enum NamespaceMember {
    Function(IntrinsicDef),
    Value(ValueDef),
}

impl NamespaceMember {
    pub fn name(&self) -> &'static str {
        match self {
            NamespaceMember::Function(f) => f.name,
            NamespaceMember::Value(v) => v.name,
        }
    }

    pub fn since(&self) -> Milestone {
        match self {
            NamespaceMember::Function(f) => f.since,
            NamespaceMember::Value(v) => v.since,
        }
    }
}

/// A namespace: a prelude name whose members are written `name.member`
/// (`quat.identity()`, `frame.time`).
#[derive(Debug, Clone, PartialEq)]
pub struct NamespaceDef {
    pub name: &'static str,
    pub members: Vec<NamespaceMember>,
    pub since: Milestone,
    pub doc: &'static str,
}

impl NamespaceDef {
    /// The member named `name`.
    pub fn member(&self, name: &str) -> Option<&NamespaceMember> {
        self.members.iter().find(|m| m.name() == name)
    }
}

/// The kind of a physics body (`spec/physics.md` section 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyKind {
    Static,
    Dynamic,
    Kinematic,
}

impl BodyKind {
    /// The schema name of the body kind.
    pub const fn as_str(self) -> &'static str {
        match self {
            BodyKind::Static => "Static",
            BodyKind::Dynamic => "Dynamic",
            BodyKind::Kinematic => "Kinematic",
        }
    }
}

/// A body command, `Name.body.<command>(..)` (`spec/physics.md` section 3).
#[derive(Debug, Clone, PartialEq)]
pub struct BodyCommandDef {
    pub name: &'static str,
    pub params: Vec<ParamDef>,
    pub applies_to: &'static [BodyKind],
    pub since: Milestone,
    pub doc: &'static str,
}

/// A readable (not writable) body property, `Name.body.<property>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BodyPropertyDef {
    pub name: &'static str,
    pub ty: TypeRef,
    pub applies_to: &'static [BodyKind],
    pub since: Milestone,
    pub doc: &'static str,
}

/// The standard library registry: every prelude name, defined once.
#[derive(Debug, Clone, PartialEq)]
pub struct Registry {
    pub types: Vec<TypeDef>,
    pub schemas: Vec<SchemaDef>,
    /// Which schemas describe scene and entity bodies.
    pub declaration_schemas: DeclarationSchemas,
    pub scene_objects: Vec<SceneObjectKind>,
    pub events: Vec<EventDef>,
    pub enums: Vec<EnumDef>,
    pub intrinsics: Vec<IntrinsicDef>,
    pub namespaces: Vec<NamespaceDef>,
    pub body_commands: Vec<BodyCommandDef>,
    pub body_properties: Vec<BodyPropertyDef>,
    /// `(path, source text)` of the embedded prelude Mtek sources.
    pub prelude_sources: Vec<(&'static str, &'static str)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn milestones_are_ordered_and_named() {
        assert!(Milestone::M1 < Milestone::M5);
        assert_eq!(Milestone::M3.as_str(), "M3");
        assert!(Milestone::M1.is_reached_by(Milestone::M1));
        assert!(Milestone::M2.is_reached_by(Milestone::M4));
        assert!(!Milestone::M4.is_reached_by(Milestone::M2));
    }

    #[test]
    fn field_flags_combine_and_test() {
        let writable_bindable = FieldFlags::WRITABLE | FieldFlags::BINDABLE;
        assert!(writable_bindable.is_writable());
        assert!(writable_bindable.is_bindable());
        assert!(!writable_bindable.is_required());
        assert!(!writable_bindable.is_construction_only());
        assert!(writable_bindable.contains(FieldFlags::WRITABLE));
        assert!(!FieldFlags::NONE.contains(FieldFlags::WRITABLE));
        assert!(FieldFlags::NONE.contains(FieldFlags::NONE));
        let required_construction = FieldFlags::REQUIRED | FieldFlags::CONSTRUCTION_ONLY;
        assert!(
            required_construction.is_required() && required_construction.is_construction_only()
        );
    }

    #[test]
    fn type_spellings() {
        assert_eq!(TypeRef::EntityRef.spelling(), "entity_ref");
        assert_eq!(TypeRef::Record("PointerEvent").spelling(), "PointerEvent");
        assert_eq!(TypeRef::Enum("Key").spelling(), "Key");
        assert_eq!(
            TypeRef::Descriptor(SchemaCategory::Light).spelling(),
            "light"
        );
        assert_eq!(TypeRef::Unit.spelling(), "()");
    }

    #[test]
    fn signature_text() {
        let sig = Signature {
            params: vec![
                ParamDef {
                    name: "a",
                    ty: SigType::Class(TypeClass::Float),
                },
                ParamDef {
                    name: "t",
                    ty: SigType::Exact(TypeRef::F32),
                },
            ],
            ret: SigType::Class(TypeClass::Float),
        };
        assert_eq!(sig.text(), "(a: T, t: f32) -> T");
    }

    #[test]
    fn type_classes_cover_the_documented_members() {
        assert_eq!(TypeClass::Float.members().len(), 4);
        assert_eq!(TypeClass::Int.members(), &[TypeRef::I32, TypeRef::U32]);
        assert_eq!(TypeClass::Vector.members().len(), 3);
        assert_eq!(TypeClass::ALL.map(TypeClass::name), ["I", "T", "V"]);
    }
}
