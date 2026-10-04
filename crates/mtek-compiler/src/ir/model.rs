//! The node types of the typed IR (decision 0028).
//!
//! Every type derives [`Serialize`]; the JSON keys are camelCase and appear in
//! field declaration order, which is therefore part of the format: new fields
//! are added where they belong, never by reordering. Spans serialise as
//! `{ "file": <file id>, "start": <byte>, "end": <byte> }` (half-open byte
//! offsets into the file as stored, the file id of the [`Module`] it belongs
//! to). `f32` values serialise as the shortest decimal that reads back as the
//! same binary32 value (`serde_json`'s `f32` formatting), so the JSON is
//! lossless and identical on every host.

use std::fmt;

use serde::{Serialize, Serializer};

use crate::source::Span;

/// The serialised form of a [`Span`].
#[derive(Serialize)]
struct SpanJson {
    file: u32,
    start: u32,
    end: u32,
}

/// Serialise a [`Span`] as `{ file, start, end }`.
fn span<S: Serializer>(span: &Span, serializer: S) -> Result<S::Ok, S::Error> {
    SpanJson {
        file: span.file.0,
        start: span.start,
        end: span.end,
    }
    .serialize(serializer)
}

/// A symbol: `normalised/module/path.mtek::Qualified.Name`, the identity of a
/// declaration across builds (`spec/runtime-abi.md` sections 5 and 11). The
/// qualified name is the chain of declaration names from the module item
/// down: `src/main.mtek::Demo`, `src/main.mtek::Demo.Main`,
/// `src/main.mtek::Demo.Ground.Fountain`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct Symbol(String);

impl Symbol {
    /// The symbol of the module item `name` declared in the module at `path`.
    #[must_use]
    pub fn item(path: &str, name: &str) -> Symbol {
        Symbol(format!("{path}::{name}"))
    }

    /// The symbol of `name` declared inside the declaration `self`.
    #[must_use]
    pub fn child(&self, name: &str) -> Symbol {
        Symbol(format!("{}.{name}", self.0))
    }

    /// The symbol as text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Symbol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A whole program: every module the build compiles and the entry scene.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    /// The scene that runs (`project.scene`, or the entry module's only
    /// scene): the symbol of one of the [`Scene`] items.
    pub entry_scene: Symbol,
    /// The modules in load order, the entry module first (only the entry
    /// module in M1).
    pub modules: Vec<Module>,
}

impl Program {
    /// The entry scene.
    #[must_use]
    pub fn entry(&self) -> Option<&Scene> {
        self.scenes().find(|scene| scene.symbol == self.entry_scene)
    }

    /// Every scene of every module, in order.
    pub fn scenes(&self) -> impl Iterator<Item = &Scene> {
        self.modules
            .iter()
            .flat_map(|module| module.items.iter())
            .filter_map(|item| match item {
                Item::Scene(scene) => Some(scene),
                Item::Const(_) => None,
            })
    }
}

/// One module (source file).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    /// The normalised project-relative path (`src/main.mtek`), the prefix of
    /// every symbol the module declares.
    pub path: String,
    /// The file id every span of this module refers to (load order).
    pub file: u32,
    /// The whole file.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// The module items, in source order. M1 populates constants and scenes;
    /// functions, structs, materials and prefabs join as their milestones
    /// implement them (decision 0028).
    pub items: Vec<Item>,
}

/// A module item.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Const(Const),
    Scene(Scene),
}

/// A constant declaration (at module level, or in a scene or entity body)
/// with its folded value. Uses of constants are already folded into the
/// values that read them, so code generation never needs these; they are
/// part of the IR so that it is a complete account of the program.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Const {
    pub name: String,
    pub symbol: Symbol,
    /// The constant's type, as Mtek spells it (`f32`, `color`, `Box`).
    #[serde(rename = "type")]
    pub ty: String,
    pub value: Value,
    /// The whole declaration, `const NAME: T = value;`.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A scene: its fields, constants, cameras and entities.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub name: String,
    pub symbol: Symbol,
    /// The whole declaration, `scene Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    pub fields: SceneFields,
    /// The constants declared in the scene body and in the bodies of its
    /// entities, in source order.
    pub constants: Vec<Const>,
    /// The cameras, in declaration order; exactly one is active.
    pub cameras: Vec<Camera>,
    /// Every entity, flat, in stable instance order (depth-first pre-order
    /// over the nesting, `spec/scenes.md` section 10.1): `entities[i].index
    /// == i`, and a child follows its parent.
    pub entities: Vec<Entity>,
}

impl Scene {
    /// The active camera.
    #[must_use]
    pub fn active_camera(&self) -> Option<&Camera> {
        self.cameras.iter().find(|camera| camera.active)
    }
}

/// The scene fields this build implements (`spec/scenes.md` section 2).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFields {
    /// `clear_color`: a linear colour.
    pub clear_color: Field,
}

/// The value of one field of a scene, camera or entity body.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// How the value is obtained (a constant in M1).
    pub source: Source,
    pub origin: Origin,
    /// The written `name: value;` member, or for a registry default the
    /// declaration that holds the field.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// How a field or material parameter gets its initial value. M1 has only
/// constants; initialisers that read scene state (M3, `spec/scenes.md`
/// section 11) and bindings add variants.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// A compile-time constant.
    Const(Value),
}

impl Source {
    /// The constant value, if the source is one.
    #[must_use]
    pub fn as_const(&self) -> Option<&Value> {
        match self {
            Source::Const(value) => Some(value),
        }
    }
}

/// Where a value comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// The source declares it.
    Written,
    /// The registry default (`spec/stdlib.md` section 3).
    Default,
}

/// A camera scene object.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub name: String,
    pub symbol: Symbol,
    /// The whole declaration, `camera Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// Whether this is the scene's active camera.
    pub active: bool,
    /// World-space position.
    pub position: Field,
    /// The point looked at, if declared (the manifest's `hasTarget`).
    pub target: Option<Field>,
    /// Orientation when there is no target.
    pub rotation: Field,
    pub projection: Projection,
}

/// A camera's projection descriptor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub desc: ProjectionDesc,
    pub origin: Origin,
    /// The `projection: …;` member, or the camera for the default.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The projection kinds (`spec/scenes.md` section 3), with every field.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectionDesc {
    Perspective {
        /// Vertical field of view, radians.
        #[serde(rename = "fovY")]
        fov_y: f32,
        near: f32,
        far: f32,
    },
    Orthographic {
        /// Visible height, metres.
        height: f32,
        near: f32,
        far: f32,
    },
}

impl ProjectionDesc {
    /// The kind as the manifest spells it (`perspective`).
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            ProjectionDesc::Perspective { .. } => "perspective",
            ProjectionDesc::Orthographic { .. } => "orthographic",
        }
    }
}

/// An entity.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    /// The static entity index: its position in [`Scene::entities`].
    pub index: u32,
    pub name: String,
    /// `path::Scene.Parent.Name`: the chain of enclosing entities.
    pub symbol: Symbol,
    /// The index of the parent entity; `None` for a root.
    pub parent: Option<u32>,
    /// The whole declaration, `entity Name { … }`.
    #[serde(serialize_with = "span")]
    pub span: Span,
    /// Local position (`vec3`).
    pub position: Field,
    /// Local rotation (`quat`).
    pub rotation: Field,
    /// Local scale (`vec3`, every component finite and positive).
    pub scale: Field,
    /// Whether the mesh is drawn (`bool`).
    pub visible: Field,
    /// The mesh, if the entity draws one.
    pub mesh: Option<Mesh>,
    /// The material instance; present exactly when `mesh` is.
    pub material: Option<MaterialInstanceDesc>,
}

/// An entity's mesh descriptor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    pub desc: MeshDesc,
    pub origin: Origin,
    /// The `mesh: …;` member.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// The built-in mesh shapes (`spec/stdlib.md` section 3), with every field;
/// the same keys as the manifest's `meshes` entries
/// (`spec/runtime-abi.md` section 5).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MeshDesc {
    /// Full extents along X, Y and Z.
    Box { size: [f32; 3] },
    Sphere {
        radius: f32,
        segments: u32,
        rings: u32,
    },
    /// Extent along X and Z.
    Plane { size: [f32; 2] },
}

/// A material instance of an entity.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInstanceDesc {
    /// The material: `std/materials.mtek::Unlit` for a built-in material
    /// (the prelude source that declares it).
    pub material: Symbol,
    /// Every parameter of the material, in declaration order, with its
    /// initial value (written or the material's default).
    pub params: Vec<Param>,
    pub origin: Origin,
    /// The `material: …;` member, or the entity for the default material.
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// One parameter of a material instance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Param {
    pub name: String,
    /// The parameter's type, as Mtek spells it.
    #[serde(rename = "type")]
    pub ty: String,
    pub source: Source,
    /// The material instance's span (decision 0028).
    #[serde(serialize_with = "span")]
    pub span: Span,
}

/// A constant value. Externally tagged by its type in JSON:
/// `{ "vec3": [0.0, 0.5, 0.0] }`, `{ "u32": 24 }`. Colours are linear RGBA;
/// quaternions `(x, y, z, w)`; `mat4` four columns of four rows.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Value {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    Quat([f32; 4]),
    Color([f32; 4]),
    Mat4([[f32; 4]; 4]),
    /// A descriptor or struct value: the schema or struct name and its
    /// fields.
    Struct {
        name: String,
        fields: Vec<NamedValue>,
    },
    Array(Vec<Value>),
}

/// A field of a [`Value::Struct`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct NamedValue {
    pub name: String,
    pub value: Value,
}

impl From<&crate::types::ConstValue> for Value {
    fn from(value: &crate::types::ConstValue) -> Self {
        use crate::types::ConstValue as C;
        match value {
            C::Bool(v) => Value::Bool(*v),
            C::I32(v) => Value::I32(*v),
            C::U32(v) => Value::U32(*v),
            C::F32(v) => Value::F32(*v),
            C::Vec2(v) => Value::Vec2(*v),
            C::Vec3(v) => Value::Vec3(*v),
            C::Vec4(v) => Value::Vec4(*v),
            C::Quat(v) => Value::Quat(*v),
            C::Color(v) => Value::Color(*v),
            C::Mat4(v) => Value::Mat4(*v),
            C::Struct { name, fields } => Value::Struct {
                name: name.clone(),
                fields: fields
                    .iter()
                    .map(|(name, value)| NamedValue {
                        name: name.clone(),
                        value: value.into(),
                    })
                    .collect(),
            },
            C::Array(items) => Value::Array(items.iter().map(Value::from).collect()),
        }
    }
}

impl fmt::Display for Value {
    /// The human form: `vec3(0.0, 0.5, 0.0)`, `Box { size: vec3(1.0, 1.0,
    /// 1.0) }`. Floats are the shortest decimal that reads back as the same
    /// binary32 value.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fn list(f: &mut fmt::Formatter<'_>, name: &str, values: &[f32]) -> fmt::Result {
            write!(f, "{name}(")?;
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    f.write_str(", ")?;
                }
                write!(f, "{value:?}")?;
            }
            f.write_str(")")
        }
        match self {
            Value::Bool(v) => write!(f, "{v}"),
            Value::I32(v) => write!(f, "i32({v})"),
            Value::U32(v) => write!(f, "u32({v})"),
            Value::F32(v) => write!(f, "{v:?}"),
            Value::Vec2(v) => list(f, "vec2", v),
            Value::Vec3(v) => list(f, "vec3", v),
            Value::Vec4(v) => list(f, "vec4", v),
            Value::Quat(v) => list(f, "quat", v),
            Value::Color(v) => list(f, "color", v),
            Value::Mat4(columns) => {
                f.write_str("mat4(")?;
                for (index, column) in columns.iter().enumerate() {
                    if index > 0 {
                        f.write_str(", ")?;
                    }
                    list(f, "", column)?;
                }
                f.write_str(")")
            }
            Value::Struct { name, fields } => {
                write!(f, "{name} {{")?;
                for (index, field) in fields.iter().enumerate() {
                    f.write_str(if index > 0 { ", " } else { " " })?;
                    write!(f, "{}: {}", field.name, field.value)?;
                }
                f.write_str(if fields.is_empty() { "}" } else { " }" })
            }
            Value::Array(items) => {
                f.write_str("[")?;
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{item}")?;
                }
                f.write_str("]")
            }
        }
    }
}
