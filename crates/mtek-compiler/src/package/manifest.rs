//! The manifest model: serde types mirroring `spec/manifest.schema.json` (`spec/runtime-abi.md`
//! section 5), moved here from M1-13.
//!
//! Field order in these declarations is the JSON key order and follows the order of the
//! schema's `properties` exactly, so the printed manifest has a fixed key order
//! (`spec/runtime-abi.md` section 5: "keys in a fixed order"). Where the schema places a
//! discriminator after other keys (a mesh's `id` before its `kind`, an instance parameter's
//! `name` before its `class`), the common keys are struct fields and the variant is a
//! flattened, internally tagged enum, which serde writes after them.
//!
//! Numbers whose schema type is `number` are [`Num`]: a JSON number kept exactly as written
//! (an integer stays `1`, a float stays `1.0`), so every valid example of
//! `tests/abi/manifests/` reads back and prints byte-identically. The compiler writes `f32`
//! values with [`Num::from_f32`], as the shortest decimal that reads back as the same binary32
//! value; `Math.fround` of it in the runtime recovers the compiler's value exactly.
//!
//! The model checks no schema constraint itself (lengths, ranges, patterns): the manifest
//! builder produces valid values by construction and the tests validate every produced
//! manifest against the schema.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::layout::{LayoutNode as RecordNode, LayoutRecord, ScalarKind};

/// Schema version this model describes.
pub const MANIFEST_SCHEMA: u32 = 1;

/// A JSON number, kept exactly as written.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Num(serde_json::Number);

impl Num {
    /// The binary32 value `value` as the shortest decimal that reads back as the same binary32
    /// value (`0.1` for the `f32` nearest 0.1, `1.0`, `1e-7`); `None` if it is not finite.
    #[must_use]
    pub fn from_f32(value: f32) -> Option<Num> {
        if !value.is_finite() {
            return None;
        }
        // `{:?}` of an `f32` is the shortest text that parses back to the same `f32`.
        let text = format!("{value:?}");
        let wide = text.parse::<f64>().ok()?;
        serde_json::Number::from_f64(wide).map(Num)
    }

    /// The binary64 value `value` as its shortest round-trip decimal; `None` if not finite.
    #[must_use]
    pub fn from_f64(value: f64) -> Option<Num> {
        serde_json::Number::from_f64(value).map(Num)
    }

    /// An integer.
    #[must_use]
    pub fn from_u32(value: u32) -> Num {
        Num(serde_json::Number::from(value))
    }

    /// The value as an `f64`.
    #[must_use]
    pub fn as_f64(&self) -> Option<f64> {
        self.0.as_f64()
    }
}

/// `program.manifest.json`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub manifest_schema: u32,
    pub runtime_abi: u32,
    pub language_version: String,
    pub compiler_version: String,
    /// 64 lowercase hex digits (`spec/runtime-abi.md` section 5.3).
    pub build_id: String,
    pub target_profile: String,
    pub required_capabilities: RequiredCapabilities,
    pub subsystems: Subsystems,
    pub runtime_config: RuntimeConfig,
    /// Game-level data (decision 0141): the scenes of a multi-scene program. Absent, byte for
    /// byte, for a single-scene program.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game: Option<Game>,
    /// Present exactly in the manifest of a `--mode preview` build: the runtime then enforces the
    /// loop budget the program was instrumented with and refuses network access outside
    /// `baseUrl` (decision 0075). Absent in every other mode, byte for byte.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<Preview>,
    pub entry_scene: String,
    pub sources: Vec<SourceEntry>,
    pub spans: Vec<SpanEntry>,
    pub symbols: Vec<SymbolEntry>,
    pub layouts: Vec<Layout>,
    pub shaders: Vec<Shader>,
    pub materials: Vec<Material>,
    pub meshes: Vec<Mesh>,
    pub assets: Vec<Asset>,
    /// The prefabs the program spawns (decision 0064); absent when it spawns none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prefabs: Vec<Prefab>,
    pub scene: Scene,
}

/// `game` of the manifest (decision 0141). Every scene manifest of one build has the same one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    /// Every scene of the program, sorted by name; empty (absent) for a single scene.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenes: Vec<GameScene>,
    /// The storage name of saved state and settings (decision 0145): the `localStorage` key is
    /// `mtek.save.<storage>`. Present when a scene has a `saved` or `setting` state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage: Option<String>,
}

/// One scene `go_to` can load: its program module and manifest, relative to the program.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameScene {
    pub name: String,
    pub module: String,
    pub manifest: String,
}

impl Manifest {
    /// The manifest as pretty JSON (two-space indentation, keys in declaration order) with a
    /// final line break: the bytes of `program.manifest.json`.
    #[must_use]
    pub fn to_json(&self) -> String {
        // Serialising plain data with string keys cannot fail.
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }

    /// Parses a manifest.
    ///
    /// # Errors
    /// The parser's error when `text` is not a manifest of this shape.
    pub fn from_json(text: &str) -> Result<Manifest, serde_json::Error> {
        serde_json::from_str(text)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequiredCapabilities {
    pub features: Vec<String>,
    /// Only limits above the WebGPU defaults; sorted by name.
    pub limits: BTreeMap<String, u64>,
    pub wgsl_language_features: Vec<String>,
}

/// The `preview` object of an untrusted-preview manifest (decision 0075).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Iterations of CPU loops the runtime allows per frame (and during `init`); at least 1.
    pub loop_budget: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Subsystems {
    pub physics: bool,
    /// The content-addressed physics bundle (`physics/<h16>.js`), present exactly when `physics`
    /// is true: the runtime cannot derive the hashed name (decision 0066).
    #[serde(
        rename = "physicsModule",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub physics_module: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub fixed_step: Num,
    pub max_catch_up_steps: u32,
    pub max_frame_delta: Num,
    pub max_entities: u32,
    pub pause_when_hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceEntry {
    pub id: u32,
    pub path: String,
    pub sha256: String,
}

/// A source range: half-open bytes plus 1-based lines and columns (decision 0019).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanEntry {
    pub file: u32,
    pub start: u32,
    pub end: u32,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SymbolEntry {
    pub id: String,
    pub kind: SymbolKind,
    pub span: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Scene,
    Camera,
    Entity,
    State,
    Material,
    Param,
    Prefab,
    Function,
}

/// A layout record (`spec/gpu-layout.md` section 5). The root is a struct node without a
/// `name` (the schema omits it on the root of a block).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub id: String,
    pub wgsl_struct: String,
    pub size: u32,
    pub align: u32,
    pub root: LayoutNode,
}

impl Layout {
    /// The manifest form of `record`: identical, except that the root struct node has no
    /// name.
    #[must_use]
    pub fn from_record(record: &LayoutRecord) -> Layout {
        let mut root = LayoutNode::from_record(&record.root);
        if let LayoutNode::Struct { name, .. } = &mut root {
            *name = None;
        }
        Layout {
            id: record.id.clone(),
            wgsl_struct: record.wgsl_struct.clone(),
            size: record.size,
            align: record.align,
            root,
        }
    }
}

/// A node of a layout tree; key order `kind, name, offset, size, align, scalar, components,
/// columns, rows, columnStride, length, stride, padded, element, members`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum LayoutNode {
    Scalar {
        offset: u32,
        size: u32,
        align: u32,
        scalar: ScalarKind,
    },
    Vector {
        offset: u32,
        size: u32,
        align: u32,
        scalar: ScalarKind,
        components: u32,
    },
    Matrix {
        offset: u32,
        size: u32,
        align: u32,
        columns: u32,
        rows: u32,
        column_stride: u32,
    },
    Struct {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        offset: u32,
        size: u32,
        align: u32,
        members: Vec<LayoutMember>,
    },
    Array {
        offset: u32,
        size: u32,
        align: u32,
        length: u32,
        stride: u32,
        padded: bool,
        element: Box<LayoutNode>,
    },
}

impl LayoutNode {
    fn from_record(node: &RecordNode) -> LayoutNode {
        match node {
            RecordNode::Scalar {
                offset,
                size,
                align,
                scalar,
            } => LayoutNode::Scalar {
                offset: *offset,
                size: *size,
                align: *align,
                scalar: *scalar,
            },
            RecordNode::Vector {
                offset,
                size,
                align,
                scalar,
                components,
            } => LayoutNode::Vector {
                offset: *offset,
                size: *size,
                align: *align,
                scalar: *scalar,
                components: *components,
            },
            RecordNode::Matrix {
                offset,
                size,
                align,
                columns,
                rows,
                column_stride,
            } => LayoutNode::Matrix {
                offset: *offset,
                size: *size,
                align: *align,
                columns: *columns,
                rows: *rows,
                column_stride: *column_stride,
            },
            RecordNode::Struct {
                name,
                offset,
                size,
                align,
                members,
            } => LayoutNode::Struct {
                name: Some(name.clone()),
                offset: *offset,
                size: *size,
                align: *align,
                members: members
                    .iter()
                    .map(|member| LayoutMember {
                        name: member.name.clone(),
                        mtek_type: member.mtek_type.clone(),
                        node: LayoutNode::from_record(&member.node),
                    })
                    .collect(),
            },
            RecordNode::Array {
                offset,
                size,
                align,
                length,
                stride,
                padded,
                element,
            } => LayoutNode::Array {
                offset: *offset,
                size: *size,
                align: *align,
                length: *length,
                stride: *stride,
                padded: *padded,
                element: Box::new(LayoutNode::from_record(element)),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutMember {
    pub name: String,
    pub mtek_type: String,
    pub node: LayoutNode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shader {
    pub hash: String,
    pub url: String,
    pub map: String,
    pub material: String,
    pub vertex_entry: String,
    /// `mtek_vs_instanced`; absent in manifests of older compilers (the runtime then draws individually).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instanced_vertex_entry: Option<String>,
    pub fragment_entry: String,
    pub vertex_attributes: Vec<String>,
    pub surface_inputs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    /// `None` (JSON `null`) when the material has no value params.
    pub layout: Option<String>,
    pub shader: String,
    pub resources: Vec<MaterialResource>,
    pub params: Vec<MaterialParam>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialResource {
    pub name: String,
    /// `texture` or `sampler`.
    pub kind: String,
    pub binding: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialParam {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub span: u32,
}

/// An entry of `meshes`: `id`, then the shape with its `kind`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mesh {
    pub id: String,
    #[serde(flatten)]
    pub shape: MeshShape,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MeshShape {
    Box {
        size: Vec<Num>,
    },
    Sphere {
        radius: Num,
        segments: u32,
        rings: u32,
    },
    Plane {
        size: Vec<Num>,
    },
    Asset {
        asset: String,
        primitive: u32,
    },
}

/// An entry of `assets` (M4): `url`, `sha256`, `bytes`, then the kind and its keys.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    #[serde(flatten)]
    pub kind: AssetKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum AssetKind {
    #[serde(rename = "mesh-data")]
    MeshData {
        primitives: Vec<MeshPrimitive>,
        preprocessing: Vec<String>,
        span: u32,
    },
    #[serde(rename = "image")]
    Image {
        color_space: String,
        preprocessing: Vec<String>,
        span: u32,
        /// The author's file (decision 0082): the project path of a standalone image, or
        /// `<glb path>#images[N]` for an embedded one. Optional in the schema; this compiler
        /// always writes it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
    },
    /// A sound file declared with `asset.sound(..)`, copied byte for byte (decision 0130).
    #[serde(rename = "audio")]
    Audio {
        /// `wav`, `ogg` or `mp3`.
        format: String,
        mime: String,
        /// The project path of the declaring `asset.sound(..)`: generated code names the sound
        /// by it.
        source: String,
        span: u32,
    },
    /// A font file of `asset.font(..)` (decision 0139), copied byte for byte.
    #[serde(rename = "font")]
    Font {
        /// `ttf`, `otf`, `woff` or `woff2`.
        format: String,
        mime: String,
        /// The project path of the declaring `asset.font(..)`: generated code names the font by it.
        source: String,
        span: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPrimitive {
    pub source: PrimitiveSource,
    pub vertex_count: u32,
    pub index_count: u32,
    pub index_format: String,
    pub attributes: Vec<String>,
    pub offsets: PrimitiveOffsets,
    pub bounding_sphere: BoundingSphere,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrimitiveSource {
    pub file: String,
    pub mesh: String,
    pub primitive: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrimitiveOffsets {
    pub position: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uv: Option<u64>,
    pub indices: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BoundingSphere {
    pub center: Vec<Num>,
    pub radius: Num,
}

/// The scene structure (`spec/runtime-abi.md` section 5.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub name: String,
    pub symbol: String,
    pub fields: SceneFields,
    pub state: Vec<StateEntry>,
    pub cameras: Vec<Camera>,
    pub entities: Vec<Entity>,
    pub material_instances: Vec<MaterialInstance>,
    pub bindings: Vec<Binding>,
    pub host_inputs: Vec<HostInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub host_outputs: Vec<HostOutput>,
    pub lights: Vec<Light>,
}

/// The constant scene fields; linear colours as `[r, g, b, a]`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneFields {
    pub clear_color: Vec<Num>,
    pub ambient_color: Vec<Num>,
    pub ambient_intensity: Num,
    pub gravity: Vec<Num>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StateEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub symbol: String,
    /// `shared state` of a scene (decision 0141): carried over `go_to`. Written only when true.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub shared: bool,
    /// `saved` or `setting` (decisions 0145, 0146): kept in the browser's storage. Written only
    /// when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist: Option<String>,
    /// With `persist`: the structural description of the type a stored value must have
    /// (decision 0145); a struct spells out its fields, an enum its variants.
    #[serde(
        default,
        rename = "storedType",
        skip_serializing_if = "Option::is_none"
    )]
    pub stored_type: Option<String>,
}

/// A camera: structure only; its values are set by `init(ctx)`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub name: String,
    pub symbol: String,
    /// `perspective` or `orthographic`.
    pub projection: String,
    pub has_target: bool,
    pub active: bool,
    /// The camera's exposure as EV100 (decision 0081); lit materials are scaled by
    /// `1 / (1.2 * 2^exposure)`.
    pub exposure: Num,
}

/// An entity: structure only; its transform and visibility are set by `init(ctx)`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub index: u32,
    pub name: String,
    pub symbol: String,
    pub parent: Option<u32>,
    pub mesh: Option<String>,
    pub material: Option<EntityMaterial>,
    pub light: Option<u32>,
    pub body: Option<Body>,
    pub collider: Option<Collider>,
    pub state: Vec<StateEntry>,
    pub update: bool,
    pub fixed_update: bool,
    /// `tag: "name";` (decision 0150); absent when the entity has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// `particles: Emitter { .. }` (decision 0155); absent when the entity emits none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particles: Option<Particles>,
    /// A glTF clip that moves this entity (decision 0156); absent when it plays none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<Clip>,
}

/// A particle emitter (decision 0155). The runtime keeps at most 64 particles.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Particles {
    pub rate: Num,
    pub lifetime: Num,
    pub speed: Num,
    pub size: Num,
    pub gravity: Num,
}

/// A sampled TRS clip (decision 0156).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub name: String,
    pub duration: Num,
    pub channels: Vec<ClipChannel>,
}

/// One channel of a [`Clip`]. `path` is `translation`, `rotation` or `scale`; `interpolation`
/// is `linear` or `step`. `values` holds `3` floats per key for translation and scale and `4`
/// for rotation, in the same order as `times`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipChannel {
    pub path: String,
    pub interpolation: String,
    pub times: Vec<Num>,
    pub values: Vec<Num>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EntityMaterial {
    pub id: String,
    pub instance: u32,
}

/// A prefab the program spawns (`spec/runtime-abi.md` section 5.6, decision 0064): what the runtime
/// needs to create an instance. In its bindings entity 0 is the instance and material instance 0 is
/// its material.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefab {
    /// The key of the `prefabs` table of `app.js`.
    pub symbol: String,
    pub name: String,
    pub params: Vec<PrefabParam>,
    pub mesh: Option<String>,
    pub material: Option<PrefabMaterial>,
    pub body: Option<Body>,
    pub collider: Option<Collider>,
    pub state: Vec<StateEntry>,
    pub update: bool,
    pub fixed_update: bool,
    pub bindings: Vec<Binding>,
    pub span: u32,
    /// The tag every instance carries (decision 0150); absent when the prefab has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// The emitter every instance starts with (decision 0155); absent when the prefab has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particles: Option<Particles>,
    /// The clip every instance plays (decision 0156); absent when the prefab plays none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<Clip>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrefabParam {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

/// The material instance of a prefab; every instance made from it starts with these classes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrefabMaterial {
    pub id: String,
    pub params: Vec<InstanceParam>,
    pub shareable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum Body {
    Static,
    Dynamic {
        mass: Num,
        linear_damping: Num,
        angular_damping: Num,
    },
    Kinematic,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Collider {
    Box {
        size: Vec<Num>,
        sensor: bool,
        friction: Num,
        restitution: Num,
    },
    Sphere {
        radius: Num,
        sensor: bool,
        friction: Num,
        restitution: Num,
    },
}

/// A light: `index`, `entity`, its kind (M4), then the update classes of its fields.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Light {
    pub index: u32,
    pub entity: u32,
    #[serde(flatten)]
    pub kind: LightKind,
    pub classes: LightClasses,
}

/// The update class of each field of a light that can change at run time (decision 0067): what a
/// hot reload does with it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LightClasses {
    pub color: LightClass,
    pub intensity: LightClass,
}

/// A light field is constant (`initial`: the source's literal is applied on reload), written by a
/// handler (`imperative`: its value is carried over a reload) or the value of a binding
/// (`bound`: evaluated every frame).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LightClass {
    Initial,
    Imperative,
    Bound,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LightKind {
    Directional,
    Point { range: Num },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MaterialInstance {
    pub index: u32,
    pub material: String,
    pub entity: u32,
    pub params: Vec<InstanceParam>,
    pub shareable: bool,
}

/// One parameter of a material instance: `name`, then its update class.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InstanceParam {
    pub name: String,
    #[serde(flatten)]
    pub class: ParamClass,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "class", rename_all = "lowercase")]
pub enum ParamClass {
    Initial,
    Imperative,
    Bound { binding: u32 },
    Resource { value: ResourceValue },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ResourceValue {
    Builtin { name: String },
    Asset { asset: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Binding {
    pub id: u32,
    pub target: BindingTarget,
    pub deps: Vec<BindingDep>,
    pub order: u32,
    pub span: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BindingTarget {
    Transform {
        entity: u32,
        field: String,
    },
    Visible {
        entity: u32,
    },
    Param {
        instance: u32,
        name: String,
    },
    Camera {
        field: String,
        /// The camera the binding writes (decision 0154). Absent on manifests written before
        /// camera switching, which bound the one active camera.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        camera: Option<String>,
    },
    Light {
        entity: u32,
        field: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BindingDep {
    State { name: String },
    Frame { name: String },
    EntityField { entity: u32, field: String },
    EntityState { entity: u32, name: String },
    Param { instance: u32, name: String },
    Light { entity: u32, field: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HostInput {
    pub name: String,
    pub target: HostInputTarget,
    #[serde(rename = "type")]
    pub ty: String,
    pub codec: String,
}

/// A read-only scene-state export. Host values preserve CPU precision, with vector/linear RGBA tuples.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HostOutput {
    pub name: String,
    pub source: HostInputTarget,
    #[serde(rename = "type")]
    pub ty: String,
}

/// Only scene state can be a host input target: `kind` is always `state`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HostInputTarget {
    pub kind: String,
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f32_numbers_are_the_shortest_binary32_text() {
        let text = |v: f32| serde_json::to_string(&Num::from_f32(v).expect("finite")).expect("ok");
        assert_eq!(text(0.1), "0.1");
        assert_eq!(text(1.0), "1.0");
        assert_eq!(text(-9.81), "-9.81");
        assert_eq!(text(0.016_666_668), "0.016666668");
        assert_eq!(text(1e-7), "1e-7");
        assert_eq!(text(0.014_443_844), "0.014443844");
        assert_eq!(Num::from_f32(f32::NAN), None);
        assert_eq!(Num::from_f32(f32::INFINITY), None);
        // Reading the text back as binary64 and rounding to binary32 gives the value.
        for v in [0.1f32, 0.014_443_844, 1e-7, 3.402_823_5e38, 1.175_494_4e-38] {
            let wide = Num::from_f32(v).and_then(|n| n.as_f64()).expect("number");
            assert_eq!((wide as f32).to_bits(), v.to_bits(), "{v}");
        }
    }

    #[test]
    fn numbers_keep_their_written_form() {
        for text in ["1", "1.0", "0.0052", "-9.81", "12", "1e-7"] {
            let n: Num = serde_json::from_str(text).expect("number");
            assert_eq!(serde_json::to_string(&n).expect("ok"), text);
        }
    }

    #[test]
    fn discriminators_follow_the_schema_key_order() {
        let mesh = Mesh {
            id: "mesh:0".to_owned(),
            shape: MeshShape::Sphere {
                radius: Num::from_u32(1),
                segments: 3,
                rings: 2,
            },
        };
        assert_eq!(
            serde_json::to_string(&mesh).expect("ok"),
            r#"{"id":"mesh:0","kind":"sphere","radius":1,"segments":3,"rings":2}"#
        );
        let param = InstanceParam {
            name: "color".to_owned(),
            class: ParamClass::Initial,
        };
        assert_eq!(
            serde_json::to_string(&param).expect("ok"),
            r#"{"name":"color","class":"initial"}"#
        );
        let light = Light {
            index: 0,
            entity: 3,
            kind: LightKind::Directional,
            classes: LightClasses {
                color: LightClass::Initial,
                intensity: LightClass::Bound,
            },
        };
        assert_eq!(
            serde_json::to_string(&light).expect("ok"),
            r#"{"index":0,"entity":3,"kind":"directional","classes":{"color":"initial","intensity":"bound"}}"#
        );
        let point = Light {
            index: 1,
            entity: 4,
            kind: LightKind::Point {
                range: Num::from_u32(5),
            },
            classes: LightClasses {
                color: LightClass::Imperative,
                intensity: LightClass::Initial,
            },
        };
        let text = serde_json::to_string(&point).expect("ok");
        assert_eq!(
            text,
            r#"{"index":1,"entity":4,"kind":"point","range":5,"classes":{"color":"imperative","intensity":"initial"}}"#
        );
        assert_eq!(serde_json::from_str::<Light>(&text).expect("reads"), point);
    }

    #[test]
    fn the_root_of_a_layout_has_no_name_and_nested_structs_keep_theirs() {
        let blocks = crate::layout::builtin_blocks();
        let frame = blocks
            .iter()
            .find(|b| b.id == "builtin:frame")
            .expect("frame");
        let record = crate::layout::compute(&frame.ty, frame.id, frame.wgsl_struct).expect("ok");
        let json = serde_json::to_value(Layout::from_record(&record)).expect("ok");
        assert!(json["root"].get("name").is_none(), "{json}");
        let lights = &json["root"]["members"][5]["node"];
        assert_eq!(lights["element"]["name"], "MtekLight", "{lights}");
        let keys: Vec<&String> = json["root"].as_object().expect("object").keys().collect();
        assert_eq!(keys, ["kind", "offset", "size", "align", "members"]);
    }
}
