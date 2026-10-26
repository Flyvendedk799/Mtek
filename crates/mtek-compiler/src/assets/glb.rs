//! The binary glTF container and the static profile of `spec/assets.md` section 3.
//!
//! [`read_glb`] checks a file in the order of the profile table: the container (header, chunk
//! layout, buffers without URIs), the sizes, the extensions, the primitive modes, attributes
//! and indices, the accessors, the materials, the images, the samplers and finally animations
//! and skins. The `gltf` crate (`gltf::json`) parses and validates the structure; the profile
//! checks are Mtek's own. Sizes are checked before data is read or allocated, and every row
//! reports all of its violations. A file that breaks the container or extension rows is not
//! looked at any further: nothing after them could be interpreted.
//!
//! The result keeps the file's BIN chunk and offsets into it, never copies of the vertex data;
//! [`super::pack`] reads those when the program is built.

use gltf::json::accessor::{ComponentType, GenericComponentType, Type};
use gltf::json::material::AlphaMode;
use gltf::json::mesh::{Mode, Semantic};
use gltf::json::texture::{MagFilter, MinFilter, WrappingMode};
use gltf::json::validation::Checked;
use gltf::json::{self, Root};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::image::{ImageInfo, sniff_image};
use super::{AssetLimits, Issue, MAX_JSON_CHUNK_BYTES};
use crate::diagnostics::Code;

const GLB_MAGIC: u32 = 0x4654_6C67;
const CHUNK_JSON: u32 = 0x4E4F_534A;
const CHUNK_BIN: u32 = 0x004E_4942;

/// Image formats of the profile (`image/png`, `image/jpeg`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
}

impl ImageFormat {
    /// The file extension of a packaged image.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
        }
    }

    /// The MIME type of the format.
    #[must_use]
    pub const fn mime(self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
        }
    }
}

/// `count` elements of `stride` bytes starting at byte `offset` of the BIN chunk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Strided {
    pub offset: usize,
    pub stride: usize,
}

/// The component type of an index accessor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IndexKind {
    U8,
    U16,
    U32,
}

impl IndexKind {
    pub(crate) const fn size(self) -> usize {
        match self {
            IndexKind::U8 => 1,
            IndexKind::U16 => 2,
            IndexKind::U32 => 4,
        }
    }
}

/// An index accessor: tightly packed (a buffer view of indices has no stride).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IndexSource {
    pub offset: usize,
    pub kind: IndexKind,
}

/// One validated primitive.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbPrimitive {
    pub vertex_count: u32,
    pub position: Strided,
    pub normal: Option<Strided>,
    pub uv: Option<Strided>,
    /// `None`: not indexed, sequential indices are generated when packaging.
    pub indices: Option<IndexSource>,
    pub index_count: u32,
    /// The centre and radius of a sphere that encloses every vertex.
    pub bounds_center: [f32; 3],
    pub bounds_radius: f32,
}

/// A validated glTF mesh.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbMesh {
    pub name: Option<String>,
    pub primitives: Vec<GlbPrimitive>,
}

/// How a sampler of the file maps onto a sampler preset (`spec/materials.md` section 5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SamplerChoice {
    /// Minification filter; magnification is independent for imported glTF samplers.
    pub nearest: bool,
    pub nearest_mag: bool,
    pub clamp: bool,
    /// The file asked for a mip-mapped minification filter.
    pub mipmapped: bool,
    pub mip_linear: bool,
}

impl SamplerChoice {
    /// glTF's defaults: filtering is up to the implementation (linear), wrapping repeats.
    pub const DEFAULT: SamplerChoice = SamplerChoice {
        nearest: false,
        nearest_mag: false,
        clamp: false,
        mipmapped: false,
        mip_linear: false,
    };

    /// The sampler preset that expresses the choice.
    #[must_use]
    pub fn builtin(self) -> crate::stdlib::BuiltinSampler {
        use crate::stdlib::BuiltinSampler as S;
        if self.nearest != self.nearest_mag {
            return S::Mixed {
                nearest_mag: self.nearest_mag,
                clamp: self.clamp,
                mip: self.mipmapped.then_some(self.mip_linear),
            };
        }
        match (self.nearest, self.clamp, self.mipmapped, self.mip_linear) {
            (false, false, false, _) => S::LinearRepeatLevel0,
            (false, true, false, _) => S::LinearClampLevel0,
            (true, false, false, _) => S::NearestRepeatLevel0,
            (true, true, false, _) => S::NearestClampLevel0,
            (false, false, true, false) => S::LinearRepeatMipNearest,
            (false, true, true, false) => S::LinearClampMipNearest,
            (true, false, true, true) => S::NearestRepeatMipLinear,
            (true, true, true, true) => S::NearestClampMipLinear,
            (false, false, true, true) => S::LinearRepeat,
            (false, true, true, true) => S::LinearClamp,
            (true, false, true, false) => S::NearestRepeat,
            (true, true, true, false) => S::NearestClamp,
        }
    }
}

/// The base colour texture of a material.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GlbTexture {
    /// Index into [`GlbFile::images`].
    pub image: usize,
    pub sampler: SamplerChoice,
}

/// A validated material (`pbrMetallicRoughness` with an opaque alpha mode).
#[derive(Clone, Debug, PartialEq)]
pub struct GlbMaterial {
    pub name: Option<String>,
    /// `baseColorFactor` (linear; alpha is 1).
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub texture: Option<GlbTexture>,
    pub maps: GlbMaterialMaps,
}

/// Additional core glTF metallic-roughness channels, with their original sampler choices.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbMaterialMaps {
    pub metallic_roughness: Option<GlbTexture>,
    pub normal: Option<GlbTexture>,
    pub normal_scale: f32,
    pub occlusion: Option<GlbTexture>,
    pub occlusion_strength: f32,
    pub emissive: Option<GlbTexture>,
    pub emissive_factor: [f32; 3],
}

/// A validated embedded image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlbImage {
    pub name: Option<String>,
    /// Byte range in the BIN chunk.
    pub start: usize,
    pub len: usize,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}

/// The local transform of a node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LocalTransform {
    /// `matrix`, column-major.
    Matrix([f32; 16]),
    /// Translation, rotation `(x, y, z, w)` and scale; absent members are the identity.
    Trs {
        t: [f32; 3],
        r: [f32; 4],
        s: [f32; 3],
    },
    /// Both `matrix` and a TRS member are written; no transform can be derived (`E7013`).
    Conflict,
}

/// A node of the file's hierarchy.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbNode {
    pub name: Option<String>,
    pub children: Vec<usize>,
    pub local: LocalTransform,
}

/// A validated static GLB.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbFile {
    /// The project path of the file.
    pub path: String,
    /// The length of the file in bytes.
    pub file_bytes: u64,
    /// SHA-256 of the file, 64 lowercase hex digits.
    pub sha256: String,
    /// The BIN chunk (without trailing chunk padding beyond the buffer's declared length).
    pub bin: Vec<u8>,
    pub meshes: Vec<GlbMesh>,
    pub materials: Vec<GlbMaterial>,
    pub images: Vec<GlbImage>,
    pub nodes: Vec<GlbNode>,
    /// The root nodes of each scene.
    pub scenes: Vec<Vec<usize>>,
    /// The default scene: `scene`, or the first scene when the file names none.
    pub default_scene: Option<usize>,
    /// Node TRS clips (decision 0156). Empty when the file has no LINEAR or STEP
    /// translation, rotation or scale channels. Skeletal data is validated separately; an animation with
    /// a morph-weight channel, a cubic spline or another interpolation is not a clip but is
    /// listed in [`Self::unsupported_animations`] (decision 0174).
    pub clips: Vec<GlbClip>,
    pub skins: Vec<super::skin::SkinMesh>,
    /// Animations the profile cannot play. They do not fail the file: a program that never
    /// names one in a `clip` does not notice them (`E7019` at the `clip` that does).
    pub unsupported_animations: Vec<UnsupportedAnimation>,
}

/// A glTF animation the profile cannot play, and why (decision 0174).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnsupportedAnimation {
    pub name: String,
    pub reason: String,
}

/// One glTF animation the profile can play (decision 0156).
#[derive(Clone, Debug, PartialEq)]
pub struct GlbClip {
    pub name: String,
    /// The last keyframe time, in seconds.
    pub duration: f32,
    pub channels: Vec<GlbChannel>,
}

/// One TRS channel of a [`GlbClip`], already limited to one node when [`GlbFile::clip_for`]
/// answers.
#[derive(Clone, Debug, PartialEq)]
pub struct GlbChannel {
    pub node: usize,
    pub node_name: Option<String>,
    /// The glTF mesh name of the node's mesh, when the node has one.
    pub mesh_name: Option<String>,
    pub path: GlbChannelPath,
    pub interpolation: GlbInterpolation,
    /// Keyframe times, strictly increasing.
    pub times: Vec<f32>,
    /// Keyframe values, `path.components()` floats each, in the same order as `times`.
    pub values: Vec<f32>,
}

/// The node property a channel writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlbChannelPath {
    Translation,
    Rotation,
    Scale,
}

impl GlbChannelPath {
    /// The glTF path (`translation`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            GlbChannelPath::Translation => "translation",
            GlbChannelPath::Rotation => "rotation",
            GlbChannelPath::Scale => "scale",
        }
    }

    /// The entity field this path writes (`position` for a translation).
    #[must_use]
    pub fn entity_field(self) -> &'static str {
        match self {
            GlbChannelPath::Translation => "position",
            GlbChannelPath::Rotation => "rotation",
            GlbChannelPath::Scale => "scale",
        }
    }

    /// Floats per keyframe.
    #[must_use]
    pub fn components(self) -> usize {
        match self {
            GlbChannelPath::Translation | GlbChannelPath::Scale => 3,
            GlbChannelPath::Rotation => 4,
        }
    }
}

/// LINEAR or STEP. Cubic spline is rejected.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlbInterpolation {
    Linear,
    Step,
}

impl GlbInterpolation {
    /// The manifest spelling (`linear`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            GlbInterpolation::Linear => "linear",
            GlbInterpolation::Step => "step",
        }
    }
}

impl GlbFile {
    /// The channels of clip `name` that move the node whose mesh or node is called `mesh`.
    /// The duration stays the whole clip's. `None` when the name is missing or no channel
    /// of that clip targets the mesh.
    #[must_use]
    pub fn clip_for(&self, name: &str, mesh: &str) -> Option<GlbClip> {
        let clip = self.clips.iter().find(|clip| clip.name == name)?;
        if self.skins.iter().any(|skin| skin.mesh == mesh) {
            return Some(clip.clone());
        }
        let node = clip.channels.iter().find(|channel| {
            channel.mesh_name.as_deref() == Some(mesh) || channel.node_name.as_deref() == Some(mesh)
        })?;
        let node = node.node;
        let channels: Vec<GlbChannel> = clip
            .channels
            .iter()
            .filter(|channel| channel.node == node)
            .cloned()
            .collect();
        if channels.is_empty() {
            return None;
        }
        Some(GlbClip {
            name: clip.name.clone(),
            duration: clip.duration,
            channels,
        })
    }
}

/// The parts of a container.
struct Chunks<'a> {
    json: &'a [u8],
    bin: Option<&'a [u8]>,
}

fn le_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes(slice.try_into().ok()?))
}

fn le_f32(bytes: &[u8], at: usize) -> Option<f32> {
    le_u32(bytes, at).map(f32::from_bits)
}

fn chunk_name(kind: u32) -> String {
    match kind {
        CHUNK_JSON => "JSON".to_owned(),
        CHUNK_BIN => "BIN".to_owned(),
        other => format!("0x{other:08X}"),
    }
}

/// Header and chunk layout (`E7001`), with the JSON chunk's size checked before it is sliced
/// (`E7002`).
fn parse_container<'a>(bytes: &'a [u8], limits: &AssetLimits) -> Result<Chunks<'a>, Issue> {
    let container = |message: String| Issue::new(Code::E7001, message);
    let length = bytes.len() as u64;
    if length > limits.max_file_bytes {
        return Err(Issue::new(
            Code::E7002,
            format!(
                "The file is {length} bytes, over the limit of {} bytes.",
                limits.max_file_bytes
            ),
        )
        .help("raise `max_file_bytes` in the `[assets]` table of mtek.toml, or reduce the model"));
    }
    let (Some(magic), Some(version), Some(declared)) =
        (le_u32(bytes, 0), le_u32(bytes, 4), le_u32(bytes, 8))
    else {
        return Err(container(format!(
            "The file is {length} bytes; a binary glTF starts with a 12-byte header."
        )));
    };
    if magic != GLB_MAGIC {
        let start: String = bytes
            .iter()
            .take(4)
            .map(|b| {
                if b.is_ascii_graphic() {
                    char::from(*b).to_string()
                } else {
                    format!("\\x{b:02x}")
                }
            })
            .collect();
        let mut issue = container(format!(
            "The file does not start with the glTF magic number 'glTF' (it starts with \"{start}\")."
        ));
        if bytes.first() == Some(&b'{') {
            issue = issue.note("the file looks like glTF JSON; export a binary `.glb` instead");
        }
        return Err(issue);
    }
    if version != 2 {
        return Err(container(format!(
            "The file is binary glTF version {version}; only version 2 is supported."
        )));
    }
    if u64::from(declared) != length {
        return Err(container(format!(
            "The header declares {declared} bytes, but the file has {length}."
        ))
        .note("the file is truncated or has data after the last chunk"));
    }
    let mut offset = 12_usize;
    let mut json = None;
    let mut bin = None;
    let mut index = 0_usize;
    while offset < bytes.len() {
        let (Some(chunk_length), Some(kind)) = (
            le_u32(bytes, offset),
            le_u32(bytes, offset.saturating_add(4)),
        ) else {
            return Err(container(format!(
                "Chunk {index} has a truncated header at byte {offset}."
            )));
        };
        let start = offset + 8;
        if kind == CHUNK_JSON && u64::from(chunk_length) > MAX_JSON_CHUNK_BYTES {
            return Err(Issue::new(
                Code::E7002,
                format!(
                    "The JSON chunk is {chunk_length} bytes, over the limit of {MAX_JSON_CHUNK_BYTES} bytes."
                ),
            ));
        }
        let end = start.saturating_add(chunk_length as usize);
        let Some(data) = bytes.get(start..end) else {
            return Err(container(format!(
                "The {} chunk declares {chunk_length} bytes, but the file ends first.",
                chunk_name(kind)
            )));
        };
        if !chunk_length.is_multiple_of(4) {
            return Err(container(format!(
                "The {} chunk is {chunk_length} bytes; chunk lengths are multiples of 4.",
                chunk_name(kind)
            )));
        }
        match (index, kind) {
            (0, CHUNK_JSON) => json = Some(data),
            (0, other) => {
                return Err(container(format!(
                    "The first chunk is a {} chunk; the JSON chunk must come first.",
                    chunk_name(other)
                )));
            }
            (_, CHUNK_BIN) if bin.is_none() => bin = Some(data),
            (_, CHUNK_BIN) => {
                return Err(container(
                    "The file has more than one BIN chunk; the profile allows at most one.".into(),
                ));
            }
            (_, CHUNK_JSON) => {
                return Err(container(
                    "The file has more than one JSON chunk; the profile allows exactly one.".into(),
                ));
            }
            (_, other) => {
                return Err(container(format!(
                    "Chunk {index} has the unknown type {}; the profile allows one JSON chunk and at most one BIN chunk.",
                    chunk_name(other)
                )));
            }
        }
        offset = end;
        index += 1;
    }
    match json {
        Some(json) => Ok(Chunks { json, bin }),
        None => Err(container("The file has no JSON chunk.".into())),
    }
}

/// The names of the `extensions` objects found anywhere below `value`, with their JSON path.
fn extension_objects(value: &Value, path: &str, out: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                // `extras` is the author's own data: not inspected (spec/assets.md section 3).
                if key == "extras" {
                    continue;
                }
                let here = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                if key == "extensions"
                    && let Value::Object(extensions) = child
                {
                    for name in extensions.keys() {
                        out.push((name.clone(), here.clone()));
                    }
                } else {
                    extension_objects(child, &here, out);
                }
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                extension_objects(child, &format!("{path}[{index}]"), out);
            }
        }
        _ => {}
    }
}

fn list(names: &[String]) -> String {
    names.join(", ")
}

/// The extension row: the profile accepts none (`E7004`, `E7005`).
fn extension_issues(root: &Root, value: &Value, out: &mut Vec<(u8, Issue)>) {
    let required: Vec<String> = sorted_unique(root.extensions_required.clone());
    if !required.is_empty() {
        out.push((
            3,
            Issue::new(
                Code::E7004,
                format!(
                    "The file requires the glTF extensions {}; the v0.1 profile supports none.",
                    list(&required)
                ),
            )
            .help("re-export the model without extensions (for example without Draco or meshopt compression)"),
        ));
    }
    let mut used = root.extensions_used.clone();
    let mut found = Vec::new();
    extension_objects(value, "", &mut found);
    used.extend(found.iter().map(|(name, _)| name.clone()));
    let used: Vec<String> = sorted_unique(used)
        .into_iter()
        .filter(|name| !required.contains(name))
        .collect();
    if !used.is_empty() {
        let mut issue = Issue::new(
            Code::E7005,
            format!(
                "The file uses the glTF extensions {}; the v0.1 profile supports none.",
                list(&used)
            ),
        )
        .help("re-export the model without extensions");
        if let Some((name, path)) = found.iter().find(|(name, _)| used.contains(name)) {
            issue = issue.note(format!("first use: '{name}' at {path}"));
        }
        out.push((3, issue));
    }
}

fn sorted_unique(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names.dedup();
    names
}

/// The container row's buffer checks (`E7003`, `E7001`).
fn buffer_issues(root: &Root, chunks: &Chunks<'_>, out: &mut Vec<(u8, Issue)>) {
    for (index, buffer) in root.buffers.iter().enumerate() {
        match (&buffer.uri, index) {
            (Some(uri), _) => {
                let kind = if uri.starts_with("data:") {
                    "a data URI"
                } else {
                    "an external file"
                };
                out.push((
                    1,
                    Issue::new(
                        Code::E7003,
                        format!("Buffer {index} is {kind}; the profile reads only the BIN chunk of a `.glb`."),
                    )
                    .help("export a single binary `.glb` with the data embedded"),
                ));
            }
            (None, 0) if chunks.bin.is_none() => out.push((
                1,
                Issue::new(
                    Code::E7001,
                    "Buffer 0 has no `uri`, so it is the BIN chunk, but the file has none.",
                ),
            )),
            (None, 0) => {}
            (None, _) => out.push((
                1,
                Issue::new(
                    Code::E7001,
                    format!("Buffer {index} has no `uri`, but only buffer 0 can be the BIN chunk."),
                ),
            )),
        }
    }
}

/// A validation error of the `gltf` crate as an issue.
fn validation_issue(path: &str, error: json::validation::Error) -> Issue {
    use json::validation::Error as E;
    let what = match error {
        E::IndexOutOfBounds => "refers to an object that does not exist",
        E::Invalid => "has an invalid value",
        E::Missing => "is missing",
        E::Oversize => "is too large",
        E::Unsupported => "is not supported",
    };
    let code = if path.starts_with("samplers[") {
        Code::E7018
    } else if path.starts_with("bufferViews[") && path.ends_with(".byteStride") {
        Code::E7025
    } else if path.starts_with("meshes[") && path.ends_with(".mode") {
        Code::E7006
    } else if path.starts_with("meshes[") && path.contains(".attributes") {
        Code::E7009
    } else if path.starts_with("accessors[")
        && (path.ends_with(".componentType") || path.ends_with(".type"))
    {
        Code::E7007
    } else if path.starts_with("materials[") && path.ends_with(".alphaMode") {
        Code::E7015
    } else if path.starts_with("images[") && path.ends_with(".mimeType") {
        Code::E7017
    } else {
        Code::E7001
    };
    // The failures a user can act on, in their own words.
    if error == E::Missing && path.starts_with("accessors[") && path.ends_with(".bufferView") {
        let accessor = path.trim_end_matches(".bufferView");
        return Issue::new(
            Code::E7011,
            format!(
                "The accessor {accessor} has no buffer view; zero-filled accessors are not supported."
            ),
        );
    }
    if error == E::Missing && path.ends_with("attributes[\"POSITION\"]") {
        let primitive = path.trim_end_matches(".attributes[\"POSITION\"]");
        return Issue::new(
            Code::E7010,
            format!("The primitive {primitive} has no POSITION attribute."),
        );
    }
    if error == E::Missing
        && path.contains("attributes[\"POSITION\"].")
        && (path.ends_with(".min") || path.ends_with(".max"))
    {
        let primitive = path.split(".attributes[").next().unwrap_or(path);
        return Issue::new(
            Code::E7001,
            format!(
                "The POSITION accessor of {primitive} has no `min` and `max`, which glTF requires for positions."
            ),
        );
    }
    let shown = if path.is_empty() { "the root" } else { path };
    Issue::new(code, format!("In the glTF JSON, {shown} {what}."))
}

/// The container and the profile. `bytes` is the whole file.
///
/// # Errors
/// Every violation found, in the order of the profile table.
pub fn read_glb(path: &str, bytes: &[u8], limits: &AssetLimits) -> Result<GlbFile, Vec<Issue>> {
    let chunks = parse_container(bytes, limits).map_err(|issue| vec![issue])?;
    let value: Value = serde_json::from_slice(chunks.json).map_err(|error| {
        vec![Issue::new(
            Code::E7001,
            format!("The JSON chunk is not valid JSON: {error}."),
        )]
    })?;
    let root: Root = json::deserialize::from_slice(chunks.json).map_err(|error| {
        vec![Issue::new(
            Code::E7001,
            format!("The JSON chunk is not a glTF 2.0 document: {error}."),
        )]
    })?;
    let mut early = Vec::new();
    version_issues(&root, &mut early);
    buffer_issues(&root, &chunks, &mut early);
    extension_issues(&root, &value, &mut early);
    if !early.is_empty() {
        return Err(finish(early));
    }
    let dangling = dangling_attributes(&root);
    if !dangling.is_empty() {
        return Err(finish(dangling));
    }
    // The `gltf` crate indexes the accessors of a primitive's attributes while validating; a
    // panic inside it (a hostile file it did not foresee) is a malformed file, not a crash.
    let validated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        gltf::Document::from_json(root)
    }));
    let document = match validated {
        Err(_) => {
            return Err(vec![Issue::new(
                Code::E7001,
                "The glTF structure is malformed: the reader could not validate it.",
            )]);
        }
        Ok(Ok(document)) => document,
        Ok(Err(gltf::Error::Validation(errors))) => {
            let mut issues: Vec<(u8, Issue)> = errors
                .into_iter()
                .map(|(path, error)| (1, validation_issue(path.as_str(), error)))
                .collect();
            issues.dedup_by(|a, b| a.1 == b.1);
            return Err(finish(issues));
        }
        Ok(Err(other)) => {
            return Err(vec![Issue::new(
                Code::E7001,
                format!("The glTF document is invalid: {other}."),
            )]);
        }
    };
    let root = document.clone().into_json();
    let bin = chunks.bin.unwrap_or(&[]);
    let mut validator = Validator::new(&root, bin, limits);
    validator.run();
    let Validator {
        issues,
        meshes,
        materials,
        images,
        clips,
        unsupported_animations,
        ..
    } = validator;
    if !issues.is_empty() {
        return Err(finish(issues));
    }
    let skins = super::skin::read(&document, bin, &clips).map_err(|issue| vec![issue])?;
    let effective = effective_len(&root, bin);
    let (nodes, scenes, default_scene) = hierarchy(&root);
    Ok(GlbFile {
        path: path.to_owned(),
        file_bytes: bytes.len() as u64,
        sha256: hex(&Sha256::digest(bytes)),
        bin: bin.get(..effective).unwrap_or(bin).to_vec(),
        meshes,
        materials,
        images,
        nodes,
        scenes,
        default_scene,
        skins,
        clips,
        unsupported_animations,
    })
}

/// Attributes that name an accessor which does not exist. The `gltf` crate would index it
/// before it checks it.
fn dangling_attributes(root: &Root) -> Vec<(u8, Issue)> {
    let mut out = Vec::new();
    for (mesh_index, mesh) in root.meshes.iter().enumerate() {
        for (primitive_index, primitive) in mesh.primitives.iter().enumerate() {
            for (semantic, accessor) in &primitive.attributes {
                if accessor.value() >= root.accessors.len() {
                    let name = match semantic {
                        Checked::Valid(semantic) => semantic_name(semantic),
                        Checked::Invalid => "an unknown attribute".to_owned(),
                    };
                    out.push((
                        1,
                        validation_issue(
                            &format!("meshes[{mesh_index}].primitives[{primitive_index}].attributes[\"{name}\"]"),
                            json::validation::Error::IndexOutOfBounds,
                        ),
                    ));
                }
            }
        }
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// Issues in table order (stable within a row), capped so one broken export stays readable.
fn finish(mut issues: Vec<(u8, Issue)>) -> Vec<Issue> {
    const CAP: usize = 24;
    issues.sort_by_key(|(row, _)| *row);
    let total = issues.len();
    let mut out: Vec<Issue> = issues
        .into_iter()
        .map(|(_, issue)| issue)
        .take(CAP)
        .collect();
    if total > CAP
        && let Some(last) = out.last_mut()
    {
        last.notes.push(format!(
            "{} more problems in this file are not shown",
            total - CAP
        ));
    }
    out
}

fn version_issues(root: &Root, out: &mut Vec<(u8, Issue)>) {
    let version = root.asset.version.as_str();
    if !version.starts_with("2.") {
        out.push((
            1,
            Issue::new(
                Code::E7001,
                format!("The file is glTF version '{version}'; only glTF 2.0 is supported."),
            ),
        ));
    }
    if let Some(minimum) = &root.asset.min_version
        && minimum != "2.0"
    {
        out.push((
            1,
            Issue::new(
                Code::E7001,
                format!("The file needs glTF {minimum} or newer; only glTF 2.0 is supported."),
            ),
        ));
    }
}

/// The usable length of the BIN chunk: the declared length of buffer 0, never more than the
/// chunk (the chunk may carry up to 3 bytes of padding).
fn effective_len(root: &Root, bin: &[u8]) -> usize {
    match root.buffers.first() {
        Some(buffer) => usize::try_from(buffer.byte_length.0)
            .unwrap_or(usize::MAX)
            .min(bin.len()),
        None => 0,
    }
}

/// Nodes, scene roots and the default scene.
fn hierarchy(root: &Root) -> (Vec<GlbNode>, Vec<Vec<usize>>, Option<usize>) {
    let nodes = root
        .nodes
        .iter()
        .map(|node| {
            let has_trs =
                node.translation.is_some() || node.rotation.is_some() || node.scale.is_some();
            let local = match (node.matrix, has_trs) {
                (Some(_), true) => LocalTransform::Conflict,
                (Some(matrix), false) => LocalTransform::Matrix(matrix),
                (None, _) => LocalTransform::Trs {
                    t: node.translation.unwrap_or([0.0; 3]),
                    r: node.rotation.map_or([0.0, 0.0, 0.0, 1.0], |q| q.0),
                    s: node.scale.unwrap_or([1.0; 3]),
                },
            };
            GlbNode {
                name: node.name.clone(),
                children: node
                    .children
                    .iter()
                    .flatten()
                    .map(json::Index::value)
                    .collect(),
                local,
            }
        })
        .collect();
    let scenes = root
        .scenes
        .iter()
        .map(|scene| scene.nodes.iter().map(json::Index::value).collect())
        .collect();
    let default_scene = root
        .scene
        .as_ref()
        .map(json::Index::value)
        .or_else(|| (!root.scenes.is_empty()).then_some(0));
    (nodes, scenes, default_scene)
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/// Why an accessor cannot be read as a block of elements.
enum Problem {
    Sparse,
    NoView,
    Bad(String),
}

/// An accessor resolved to bytes of the BIN chunk.
struct Resolved {
    offset: usize,
    stride: usize,
    count: usize,
}

struct Validator<'a> {
    root: &'a Root,
    bin: &'a [u8],
    /// Usable bytes of buffer 0.
    buffer_len: usize,
    limits: &'a AssetLimits,
    issues: Vec<(u8, Issue)>,
    meshes: Vec<GlbMesh>,
    materials: Vec<GlbMaterial>,
    images: Vec<GlbImage>,
    /// The result of the sampler pass, by sampler index.
    samplers: Vec<Option<SamplerChoice>>,
    /// The result of the image pass, by image index.
    image_ok: Vec<bool>,
    /// Animations that are not clips, found by [`Self::check_animations`].
    unsupported_animations: Vec<UnsupportedAnimation>,
    /// TRS clips extracted by [`Self::check_animations`].
    clips: Vec<GlbClip>,
}

/// `mesh 'Seat' (meshes[2])`, or `mesh at meshes[2]` without a name.
fn label(kind: &str, index: usize, name: Option<&str>) -> String {
    let collection = match kind {
        "mesh" => "meshes",
        "material" => "materials",
        "image" => "images",
        _ => "samplers",
    };
    match name {
        Some(name) => format!("{kind} '{name}' ({collection}[{index}])"),
        None => format!("{kind} at {collection}[{index}]"),
    }
}

fn component_size(kind: ComponentType) -> usize {
    match kind {
        ComponentType::I8 | ComponentType::U8 => 1,
        ComponentType::I16 | ComponentType::U16 => 2,
        ComponentType::U32 | ComponentType::F32 => 4,
    }
}

fn component_name(kind: ComponentType) -> &'static str {
    match kind {
        ComponentType::I8 => "BYTE",
        ComponentType::U8 => "UNSIGNED_BYTE",
        ComponentType::I16 => "SHORT",
        ComponentType::U16 => "UNSIGNED_SHORT",
        ComponentType::U32 => "UNSIGNED_INT",
        ComponentType::F32 => "FLOAT",
    }
}

fn type_name(kind: Type) -> &'static str {
    match kind {
        Type::Scalar => "SCALAR",
        Type::Vec2 => "VEC2",
        Type::Vec3 => "VEC3",
        Type::Vec4 => "VEC4",
        Type::Mat2 => "MAT2",
        Type::Mat3 => "MAT3",
        Type::Mat4 => "MAT4",
    }
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Points => "0 (POINTS)",
        Mode::Lines => "1 (LINES)",
        Mode::LineLoop => "2 (LINE_LOOP)",
        Mode::LineStrip => "3 (LINE_STRIP)",
        Mode::Triangles => "4 (TRIANGLES)",
        Mode::TriangleStrip => "5 (TRIANGLE_STRIP)",
        Mode::TriangleFan => "6 (TRIANGLE_FAN)",
    }
}

impl<'a> Validator<'a> {
    fn new(root: &'a Root, bin: &'a [u8], limits: &'a AssetLimits) -> Self {
        Self {
            root,
            bin,
            buffer_len: effective_len(root, bin),
            limits,
            issues: Vec::new(),
            meshes: Vec::new(),
            materials: Vec::new(),
            images: Vec::new(),
            samplers: Vec::new(),
            image_ok: Vec::new(),
            clips: Vec::new(),
            unsupported_animations: Vec::new(),
        }
    }

    fn report(&mut self, row: u8, issue: Issue) {
        self.issues.push((row, issue));
    }

    fn run(&mut self) {
        self.check_buffer();
        self.check_sparse();
        self.check_meshes();
        self.check_samplers();
        self.check_images();
        self.check_materials();
        self.check_animations();
    }

    // ----- accessors ---------------------------------------------------------

    /// The BIN chunk must hold all the bytes buffer 0 declares (`E7025`).
    fn check_buffer(&mut self) {
        if let Some(buffer) = self.root.buffers.first() {
            let declared = buffer.byte_length.0;
            if declared > self.bin.len() as u64 {
                self.report(
                    7,
                    Issue::new(
                        Code::E7025,
                        format!(
                            "Buffer 0 declares {declared} bytes, but the BIN chunk has {}.",
                            self.bin.len()
                        ),
                    ),
                );
            }
        }
    }

    /// `E7011` for every sparse accessor of the file.
    fn check_sparse(&mut self) {
        for (index, accessor) in self.root.accessors.iter().enumerate() {
            if accessor.sparse.is_some() {
                self.report(
                    7,
                    Issue::new(
                        Code::E7011,
                        format!("The accessor accessors[{index}] is sparse; the profile does not support sparse accessors."),
                    )
                    .help("re-export the model without sparse accessors (for example without morph targets)"),
                );
            }
        }
    }

    /// Where the elements of accessor `index` live, or why they cannot be read.
    fn resolve(&self, index: usize, element: usize, indices: bool) -> Result<Resolved, Problem> {
        let Some(accessor) = self.root.accessors.get(index) else {
            return Err(Problem::Bad(format!("accessors[{index}] does not exist")));
        };
        if accessor.sparse.is_some() {
            return Err(Problem::Sparse);
        }
        let Some(view_index) = &accessor.buffer_view else {
            return Err(Problem::NoView);
        };
        let bad = |text: String| Err(Problem::Bad(format!("accessors[{index}] {text}")));
        let Some(view) = self.root.buffer_views.get(view_index.value()) else {
            return bad("refers to a buffer view that does not exist".into());
        };
        if view.buffer.value() != 0 {
            return bad(format!(
                "reads buffer {}, but only the BIN chunk (buffer 0) is available",
                view.buffer.value()
            ));
        }
        let (view_offset, view_length) = (
            usize::try_from(view.byte_offset.map_or(0, |o| o.0)).unwrap_or(usize::MAX),
            usize::try_from(view.byte_length.0).unwrap_or(usize::MAX),
        );
        if view_offset.saturating_add(view_length) > self.buffer_len {
            return bad(format!(
                "uses a buffer view of {view_length} bytes at offset {view_offset}, which ends after the {} bytes of the BIN buffer",
                self.buffer_len
            ));
        }
        let count = usize::try_from(accessor.count.0).unwrap_or(usize::MAX);
        if count == 0 {
            return bad("has no elements".into());
        }
        let stride = match &view.byte_stride {
            Some(_) if indices => {
                return bad("reads indices from a buffer view with a `byteStride`".into());
            }
            Some(stride) => {
                let stride = stride.0;
                if stride < element || !stride.is_multiple_of(4) {
                    return bad(format!(
                        "has a buffer view `byteStride` of {stride}, which is smaller than its {element}-byte elements or not a multiple of 4"
                    ));
                }
                stride
            }
            None => element,
        };
        let accessor_offset =
            usize::try_from(accessor.byte_offset.map_or(0, |o| o.0)).unwrap_or(usize::MAX);
        let last = (count - 1)
            .checked_mul(stride)
            .and_then(|bytes| bytes.checked_add(element))
            .and_then(|bytes| bytes.checked_add(accessor_offset));
        match last {
            Some(last) if last <= view_length => {}
            _ => {
                return bad(format!(
                    "reads {count} elements of {element} bytes (stride {stride}) from offset {accessor_offset}, past the {view_length} bytes of its buffer view"
                ));
            }
        }
        let component = match accessor.component_type {
            Checked::Valid(GenericComponentType(kind)) => component_size(kind),
            Checked::Invalid => 1,
        };
        let offset = view_offset + accessor_offset;
        if !offset.is_multiple_of(component) {
            return bad(format!(
                "starts at byte {offset}, which is not a multiple of its {component}-byte component size"
            ));
        }
        Ok(Resolved {
            offset,
            stride,
            count,
        })
    }

    fn report_problem(&mut self, what: &str, problem: Problem) {
        match problem {
            Problem::Sparse => {} // reported by `check_sparse`
            Problem::NoView => self.report(
                7,
                Issue::new(
                    Code::E7011,
                    format!("{what} has an accessor without a buffer view; zero-filled accessors are not supported."),
                ),
            ),
            Problem::Bad(text) => self.report(
                7,
                Issue::new(Code::E7025, format!("{what}: {text}.")),
            ),
        }
    }

    // ----- meshes ------------------------------------------------------------

    fn check_meshes(&mut self) {
        let root = self.root;
        for (mesh_index, mesh) in root.meshes.iter().enumerate() {
            let mesh_label = label("mesh", mesh_index, mesh.name.as_deref());
            if mesh.weights.is_some() {
                self.report(
                    5,
                    Issue::new(
                        Code::E7008,
                        format!("The {mesh_label} has default morph target weights; the profile does not support morph targets."),
                    ),
                );
            }
            let mut primitives = Vec::new();
            for (prim_index, primitive) in mesh.primitives.iter().enumerate() {
                let what = format!("The {mesh_label}, primitive {prim_index}");
                if let Some(built) = self.check_primitive(&what, primitive) {
                    primitives.push(built);
                }
            }
            self.meshes.push(GlbMesh {
                name: mesh.name.clone(),
                primitives,
            });
        }
    }

    fn check_primitive(
        &mut self,
        what: &str,
        primitive: &json::mesh::Primitive,
    ) -> Option<GlbPrimitive> {
        let before = self.issues.len();
        // Row 4: the mode.
        match &primitive.mode {
            Checked::Valid(Mode::Triangles) => {}
            Checked::Valid(mode) => self.report(
                4,
                Issue::new(
                    Code::E7006,
                    format!(
                        "{what} has mode {}; the profile supports only mode 4 (TRIANGLES).",
                        mode_name(*mode)
                    ),
                )
                .help("triangulate the mesh when exporting; lines, points, strips and fans are not supported"),
            ),
            Checked::Invalid => {}
        }
        // Row 5: the attributes.
        let mut position = None;
        let mut normal = None;
        let mut uv = None;
        for (semantic, accessor_index) in &primitive.attributes {
            let accessor_index = accessor_index.value();
            let Checked::Valid(semantic) = semantic else {
                continue;
            };
            match semantic {
                Semantic::Positions => {
                    position = self.float_attribute(what, "POSITION", accessor_index, Type::Vec3);
                }
                Semantic::Normals => {
                    normal = self.float_attribute(what, "NORMAL", accessor_index, Type::Vec3);
                }
                Semantic::TexCoords(0) => {
                    uv = self.float_attribute(what, "TEXCOORD_0", accessor_index, Type::Vec2);
                }
                Semantic::Joints(0) | Semantic::Weights(0) if !self.root.skins.is_empty() => {},
                Semantic::Joints(_) | Semantic::Weights(_) => self.report(
                    5,
                    Issue::new(
                        Code::E7008,
                        format!(
                            "{what} has the skinning attribute {}; the profile does not support skinning.",
                            semantic_name(semantic)
                        ),
                    ),
                ),
                other => self.report(
                    5,
                    Issue::new(
                        Code::E7009,
                        format!(
                            "{what} has the attribute {}; the profile supports POSITION, NORMAL and TEXCOORD_0.",
                            semantic_name(other)
                        ),
                    )
                    .help("remove vertex colours, tangents and further UV sets when exporting"),
                ),
            }
        }
        if primitive.targets.as_ref().is_some_and(|t| !t.is_empty()) {
            self.report(
                5,
                Issue::new(
                    Code::E7008,
                    format!("{what} has morph targets; the profile does not support them."),
                ),
            );
        }
        let Some((position_index, _)) = position else {
            if !primitive
                .attributes
                .contains_key(&Checked::Valid(Semantic::Positions))
            {
                self.report(
                    5,
                    Issue::new(Code::E7010, format!("{what} has no POSITION attribute.")),
                );
            }
            return None;
        };
        // The vertex limit, before any data is read (row 2).
        let vertex_count = self
            .root
            .accessors
            .get(position_index)
            .map_or(0, |a| a.count.0);
        if vertex_count > u64::from(self.limits.max_vertices_per_primitive) {
            self.report(
                2,
                Issue::new(
                    Code::E7026,
                    format!(
                        "{what} has {vertex_count} vertices, over the limit of {} per primitive.",
                        self.limits.max_vertices_per_primitive
                    ),
                )
                .help("raise `max_vertices_per_primitive` in the `[assets]` table of mtek.toml, or reduce the model"),
            );
            return None;
        }
        // Rows 6 and 7: indices, bounds, values.
        let vertex_count_u32 = u32::try_from(vertex_count).ok()?;
        let position_data = self.read_floats(what, "POSITION", position_index, 3, vertex_count)?;
        let normal_ok = match normal {
            Some((index, _)) => self.check_attribute_data(what, "NORMAL", index, 3, vertex_count),
            None => None,
        };
        let uv_ok = match uv {
            Some((index, _)) => {
                self.check_attribute_data(what, "TEXCOORD_0", index, 2, vertex_count)
            }
            None => None,
        };
        let (indices, index_count) = self.check_indices(what, primitive, vertex_count);
        if self.issues.len() > before {
            return None;
        }
        let (center, radius) = bounding_sphere(&position_data);
        let position_at = self.resolve(position_index, 12, false).ok()?;
        Some(GlbPrimitive {
            vertex_count: vertex_count_u32,
            position: Strided {
                offset: position_at.offset,
                stride: position_at.stride,
            },
            normal: normal_ok,
            uv: uv_ok,
            indices: indices?,
            index_count,
            bounds_center: center,
            bounds_radius: radius,
        })
    }

    /// An attribute that must be a non-normalised FLOAT accessor of `expected` (`E7007`).
    fn float_attribute(
        &mut self,
        what: &str,
        name: &str,
        index: usize,
        expected: Type,
    ) -> Option<(usize, Type)> {
        let accessor = self.root.accessors.get(index)?;
        let component = match accessor.component_type {
            Checked::Valid(GenericComponentType(kind)) => Some(kind),
            Checked::Invalid => None,
        };
        let kind = match accessor.type_ {
            Checked::Valid(kind) => Some(kind),
            Checked::Invalid => None,
        };
        let normalized = accessor.normalized;
        if component == Some(ComponentType::F32) && kind == Some(expected) && !normalized {
            return Some((index, expected));
        }
        let found = match (component, kind) {
            (Some(c), Some(k)) => format!(
                "{}{} {}",
                if normalized { "normalised " } else { "" },
                component_name(c),
                type_name(k)
            ),
            _ => "an unknown format".to_owned(),
        };
        self.report(
            5,
            Issue::new(
                Code::E7007,
                format!(
                    "{what}: {name} is {found}; the profile requires FLOAT {} without normalisation.",
                    type_name(expected)
                ),
            )
            .help("export vertex data as 32-bit floats (normalised integer formats are not supported)"),
        );
        None
    }

    /// Bounds, count and finite values of a float attribute; its location.
    fn check_attribute_data(
        &mut self,
        what: &str,
        name: &str,
        index: usize,
        components: usize,
        vertex_count: u64,
    ) -> Option<Strided> {
        self.read_floats(what, name, index, components, vertex_count)?;
        let resolved = self.resolve(index, components * 4, false).ok()?;
        Some(Strided {
            offset: resolved.offset,
            stride: resolved.stride,
        })
    }

    /// The values of a float attribute, after the accessor rows' checks (`E7025`, `E7011`).
    fn read_floats(
        &mut self,
        what: &str,
        name: &str,
        index: usize,
        components: usize,
        vertex_count: u64,
    ) -> Option<Vec<f32>> {
        let resolved = match self.resolve(index, components * 4, false) {
            Ok(resolved) => resolved,
            Err(problem) => {
                self.report_problem(&format!("{what}, {name}"), problem);
                return None;
            }
        };
        if resolved.count as u64 != vertex_count {
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!(
                        "{what}: {name} has {} elements, but POSITION has {vertex_count}.",
                        resolved.count
                    ),
                ),
            );
            return None;
        }
        let mut values = Vec::with_capacity(resolved.count.saturating_mul(components));
        for vertex in 0..resolved.count {
            for component in 0..components {
                let at = resolved.offset + vertex * resolved.stride + component * 4;
                let value = le_f32(self.bin, at)?;
                if !value.is_finite() {
                    self.report(
                        7,
                        Issue::new(
                            Code::E7025,
                            format!(
                                "{what}: {name} has a value that is not finite at vertex {vertex}."
                            ),
                        ),
                    );
                    return None;
                }
                values.push(value);
            }
        }
        Some(values)
    }

    /// Row 6. Returns the index source (`Some(None)` for a primitive without indices) and the
    /// number of indices.
    fn check_indices(
        &mut self,
        what: &str,
        primitive: &json::mesh::Primitive,
        vertex_count: u64,
    ) -> (Option<Option<IndexSource>>, u32) {
        let Some(accessor_index) = &primitive.indices else {
            if !vertex_count.is_multiple_of(3) {
                self.report(
                    6,
                    Issue::new(
                        Code::E7014,
                        format!(
                            "{what} is not indexed and has {vertex_count} vertices, which is not a multiple of 3."
                        ),
                    ),
                );
                return (None, 0);
            }
            return (Some(None), u32::try_from(vertex_count).unwrap_or(0));
        };
        let index = accessor_index.value();
        let Some(accessor) = self.root.accessors.get(index) else {
            return (None, 0);
        };
        let kind = match (accessor.component_type, accessor.type_) {
            (
                Checked::Valid(GenericComponentType(ComponentType::U8)),
                Checked::Valid(Type::Scalar),
            ) => Some(IndexKind::U8),
            (
                Checked::Valid(GenericComponentType(ComponentType::U16)),
                Checked::Valid(Type::Scalar),
            ) => Some(IndexKind::U16),
            (
                Checked::Valid(GenericComponentType(ComponentType::U32)),
                Checked::Valid(Type::Scalar),
            ) => Some(IndexKind::U32),
            _ => None,
        };
        let Some(kind) = kind.filter(|_| !accessor.normalized) else {
            self.report(
                6,
                Issue::new(
                    Code::E7007,
                    format!("{what}: the index accessor must be a SCALAR of UNSIGNED_BYTE, UNSIGNED_SHORT or UNSIGNED_INT."),
                ),
            );
            return (None, 0);
        };
        let resolved = match self.resolve(index, kind.size(), true) {
            Ok(resolved) => resolved,
            Err(problem) => {
                self.report_problem(&format!("{what}, indices"), problem);
                return (None, 0);
            }
        };
        let count = resolved.count;
        if !count.is_multiple_of(3) {
            self.report(
                6,
                Issue::new(
                    Code::E7014,
                    format!("{what} has {count} indices, which is not a multiple of 3."),
                ),
            );
        }
        for position in 0..count {
            let at = resolved.offset + position * kind.size();
            let value = match kind {
                IndexKind::U8 => self.bin.get(at).map(|b| u32::from(*b)),
                IndexKind::U16 => self
                    .bin
                    .get(at..at + 2)
                    .and_then(|s| <[u8; 2]>::try_from(s).ok())
                    .map(|b| u32::from(u16::from_le_bytes(b))),
                IndexKind::U32 => le_u32(self.bin, at),
            };
            match value {
                Some(value) if u64::from(value) < vertex_count => {}
                Some(value) => {
                    self.report(
                        6,
                        Issue::new(
                            Code::E7014,
                            format!(
                                "{what} has the index {value} at position {position}, but only {vertex_count} vertices."
                            ),
                        ),
                    );
                    return (None, 0);
                }
                None => return (None, 0),
            }
        }
        let index_count = u32::try_from(count).unwrap_or(u32::MAX);
        (
            Some(Some(IndexSource {
                offset: resolved.offset,
                kind,
            })),
            index_count,
        )
    }

    // ----- samplers, images, materials ----------------------------------------

    fn check_samplers(&mut self) {
        let root = self.root;
        for (index, sampler) in root.samplers.iter().enumerate() {
            let what = label("sampler", index, sampler.name.as_deref());
            let mut ok = true;
            let wrap = |mode: &Checked<WrappingMode>| match mode {
                Checked::Valid(WrappingMode::Repeat) => Some((false, "REPEAT")),
                Checked::Valid(WrappingMode::ClampToEdge) => Some((true, "CLAMP_TO_EDGE")),
                _ => None,
            };
            let (s, t) = (wrap(&sampler.wrap_s), wrap(&sampler.wrap_t));
            if matches!(sampler.wrap_s, Checked::Valid(WrappingMode::MirroredRepeat))
                || matches!(sampler.wrap_t, Checked::Valid(WrappingMode::MirroredRepeat))
            {
                self.report(
                    10,
                    Issue::new(
                        Code::E7018,
                        format!("The {what} uses MIRRORED_REPEAT; the profile supports REPEAT and CLAMP_TO_EDGE."),
                    ),
                );
                ok = false;
            } else if let (Some(s), Some(t)) = (s, t)
                && s.0 != t.0
            {
                self.report(
                    10,
                    Issue::new(
                        Code::E7018,
                        format!(
                            "The {what} wraps S with {} and T with {}; the sampler presets use one address mode for both directions.",
                            s.1, t.1
                        ),
                    ),
                );
                ok = false;
            }
            let mag = match &sampler.mag_filter {
                Some(Checked::Valid(MagFilter::Nearest)) => Some(true),
                Some(Checked::Valid(MagFilter::Linear)) => Some(false),
                _ => None,
            };
            let (min, mipmapped) = match &sampler.min_filter {
                Some(Checked::Valid(MinFilter::Nearest)) => (Some(true), false),
                Some(Checked::Valid(MinFilter::Linear)) => (Some(false), false),
                Some(Checked::Valid(
                    MinFilter::NearestMipmapNearest | MinFilter::NearestMipmapLinear,
                )) => (Some(true), true),
                Some(Checked::Valid(
                    MinFilter::LinearMipmapNearest | MinFilter::LinearMipmapLinear,
                )) => (Some(false), true),
                _ => (None, false),
            };
            let choice = SamplerChoice {
                nearest: min.or(mag).unwrap_or(false),
                nearest_mag: mag.or(min).unwrap_or(false),
                clamp: s.is_some_and(|s| s.0),
                mipmapped,
                mip_linear: matches!(
                    sampler.min_filter,
                    Some(Checked::Valid(
                        MinFilter::NearestMipmapLinear | MinFilter::LinearMipmapLinear
                    ))
                ),
            };
            self.samplers.push(ok.then_some(choice));
        }
    }

    fn check_images(&mut self) {
        let root = self.root;
        for (index, image) in root.images.iter().enumerate() {
            let what = label("image", index, image.name.as_deref());
            let before = self.issues.len();
            let mut built = None;
            if image.uri.is_some() {
                self.report(
                    9,
                    Issue::new(
                        Code::E7003,
                        format!("The {what} is an external file or data URI; the profile reads only images embedded in the BIN chunk."),
                    ),
                );
            } else {
                built = self.check_image(&what, image);
            }
            let ok = built.is_some() && self.issues.len() == before;
            self.image_ok.push(ok);
            self.images.push(built.unwrap_or(GlbImage {
                name: image.name.clone(),
                start: 0,
                len: 0,
                format: ImageFormat::Png,
                width: 0,
                height: 0,
            }));
        }
    }

    fn check_image(&mut self, what: &str, image: &json::image::Image) -> Option<GlbImage> {
        let Some(view_index) = &image.buffer_view else {
            self.report(
                9,
                Issue::new(
                    Code::E7017,
                    format!("The {what} has neither a `uri` nor a buffer view."),
                ),
            );
            return None;
        };
        let mime = image.mime_type.as_ref().map(|m| m.0.as_str());
        let declared = match mime {
            Some("image/png") => ImageFormat::Png,
            Some("image/jpeg") => ImageFormat::Jpeg,
            other => {
                self.report(
                    9,
                    Issue::new(
                        Code::E7017,
                        format!(
                            "The {what} has the MIME type {}; the profile supports image/png and image/jpeg.",
                            other.map_or("(none)".to_owned(), |m| format!("'{m}'"))
                        ),
                    ),
                );
                return None;
            }
        };
        let view = self.root.buffer_views.get(view_index.value())?;
        let (start, len) = (
            usize::try_from(view.byte_offset.map_or(0, |o| o.0)).unwrap_or(usize::MAX),
            usize::try_from(view.byte_length.0).unwrap_or(usize::MAX),
        );
        if view.buffer.value() != 0 || start.saturating_add(len) > self.buffer_len {
            self.report(
                9,
                Issue::new(
                    Code::E7025,
                    format!("The {what} reads {len} bytes at offset {start}, outside the {} bytes of the BIN buffer.", self.buffer_len),
                ),
            );
            return None;
        }
        let data = self.bin.get(start..start + len)?;
        match sniff_image(data, self.limits.max_texture_dimension) {
            Ok(ImageInfo {
                format,
                width,
                height,
            }) => {
                if format != declared {
                    self.report(
                        9,
                        Issue::new(
                            Code::E7017,
                            format!(
                                "The {what} is declared as {}, but its bytes are {}.",
                                declared.mime(),
                                format.mime()
                            ),
                        ),
                    );
                    return None;
                }
                Some(GlbImage {
                    name: image.name.clone(),
                    start,
                    len,
                    format,
                    width,
                    height,
                })
            }
            Err(issue) => {
                self.report(
                    9,
                    Issue::new(Code::E7017, format!("The {what}: {}", issue.message)),
                );
                None
            }
        }
    }

    fn check_materials(&mut self) {
        let root = self.root;
        for (index, material) in root.materials.iter().enumerate() {
            let what = label("material", index, material.name.as_deref());
            let pbr = &material.pbr_metallic_roughness;
            if !matches!(material.alpha_mode, Checked::Valid(AlphaMode::Opaque)) {
                let mode = match material.alpha_mode {
                    Checked::Valid(AlphaMode::Mask) => "MASK",
                    Checked::Valid(AlphaMode::Blend) => "BLEND",
                    _ => "an unknown mode",
                };
                self.report(
                    8,
                    Issue::new(
                        Code::E7015,
                        format!(
                            "The {what} has alphaMode {mode}; the profile supports OPAQUE only."
                        ),
                    )
                    .help("v0.1 has no transparency (`spec/materials.md` section 2)"),
                );
            }
            let alpha = pbr.base_color_factor.0[3];
            if alpha != 1.0 {
                self.report(
                    8,
                    Issue::new(
                        Code::E7015,
                        format!("The {what} has a baseColorFactor alpha of {alpha:?}; the profile requires 1."),
                    ),
                );
            }
            let mut unsupported = Vec::new();
            if material.double_sided {
                unsupported.push("doubleSided");
            }
            if !unsupported.is_empty() {
                self.report(
                    8,
                    Issue::new(
                        Code::E7016,
                        format!(
                            "The {what} uses {}; the profile supports core metallic-roughness channels on single-sided opaque materials.",
                            unsupported.join(", ")
                        ),
                    ),
                );
            }
            let mut texture = None;
            if let Some(info) = &pbr.base_color_texture {
                if info.tex_coord != 0 {
                    self.report(
                        8,
                        Issue::new(
                            Code::E7009,
                            format!(
                                "The {what} reads its base colour texture from TEXCOORD_{}; the profile supports TEXCOORD_0 only.",
                                info.tex_coord
                            ),
                        ),
                    );
                } else {
                    texture = self.texture_of(&what, info.index.value());
                }
            }
            let metallic_roughness = pbr.metallic_roughness_texture.as_ref().and_then(|info| {
                self.material_texture(
                    &what,
                    "metallic-roughness",
                    info.index.value(),
                    info.tex_coord,
                )
            });
            let normal = material.normal_texture.as_ref().and_then(|info| {
                self.material_texture(&what, "normal", info.index.value(), info.tex_coord)
            });
            let occlusion = material.occlusion_texture.as_ref().and_then(|info| {
                self.material_texture(&what, "occlusion", info.index.value(), info.tex_coord)
            });
            let emissive = material.emissive_texture.as_ref().and_then(|info| {
                self.material_texture(&what, "emissive", info.index.value(), info.tex_coord)
            });
            self.materials.push(GlbMaterial {
                name: material.name.clone(),
                base_color: pbr.base_color_factor.0,
                metallic: pbr.metallic_factor.0,
                roughness: pbr.roughness_factor.0,
                texture,
                maps: GlbMaterialMaps {
                    metallic_roughness,
                    normal,
                    normal_scale: material
                        .normal_texture
                        .as_ref()
                        .map_or(0.0, |info| info.scale),
                    occlusion,
                    occlusion_strength: material
                        .occlusion_texture
                        .as_ref()
                        .map_or(1.0, |info| info.strength.0),
                    emissive,
                    emissive_factor: material.emissive_factor.0,
                },
            });
        }
    }

    fn material_texture(
        &mut self,
        what: &str,
        channel: &str,
        index: usize,
        tex_coord: u32,
    ) -> Option<GlbTexture> {
        if tex_coord != 0 {
            self.report(8, Issue::new(Code::E7009, format!("The {what} reads its {channel} texture from TEXCOORD_{tex_coord}; the profile supports TEXCOORD_0 only.")));
            None
        } else {
            self.texture_of(what, index)
        }
    }

    fn texture_of(&mut self, what: &str, texture_index: usize) -> Option<GlbTexture> {
        let texture = self.root.textures.get(texture_index)?;
        let image = texture.source.value();
        let sampler = match &texture.sampler {
            Some(sampler) => self.samplers.get(sampler.value()).copied().flatten(),
            None => Some(SamplerChoice::DEFAULT),
        };
        if !self.image_ok.get(image).copied().unwrap_or(false) {
            // The image row reported why.
            return None;
        }
        let _ = what;
        sampler.map(|sampler| GlbTexture { image, sampler })
    }

    /// Invalid skins use `E7019` (decision 0191). LINEAR and STEP translation, rotation and scale
    /// channels are packaged as [`GlbClip`]s. An animation with a morph-weight channel, a cubic
    /// spline, another interpolation or a keyframe count outside 1 to 4096 is listed as
    /// unsupported instead (decision 0174): it fails only where a `clip` names it.
    fn check_animations(&mut self) {
        let mut names: Vec<String> = Vec::new();
        for (index, animation) in self.root.animations.iter().enumerate() {
            let name = animation
                .name
                .as_deref()
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("animation_{index}"));
            if names.iter().any(|have| have == &name) {
                self.report(
                    12,
                    Issue::new(
                        Code::E7019,
                        format!("The file has two animations named '{name}'."),
                    )
                    .help("give each animation its own name"),
                );
                continue;
            }
            names.push(name.clone());
            let mut channels = Vec::new();
            let mut rejected = false;
            let mut unsupported: Option<String> = None;
            for channel in &animation.channels {
                match self.clip_channel(&name, animation, channel) {
                    ClipChannel::Ready(channel) => channels.push(channel),
                    ClipChannel::Unsupported(reason) => {
                        unsupported.get_or_insert(reason);
                    }
                    ClipChannel::Broken => rejected = true,
                }
            }
            if let Some(reason) = unsupported {
                self.unsupported_animations
                    .push(UnsupportedAnimation { name, reason });
                continue;
            }
            if rejected {
                continue;
            }
            let duration = channels
                .iter()
                .flat_map(|channel| channel.times.last().copied())
                .fold(0.0_f32, f32::max);
            self.clips.push(GlbClip {
                name,
                duration,
                channels,
            });
        }
    }

    /// One channel, or why it cannot be played. `Broken` is a data error already reported
    /// (`E7025` or `E7011`); `Rejected` is `E7019`.
    fn clip_channel(
        &mut self,
        clip: &str,
        animation: &json::animation::Animation,
        channel: &json::animation::Channel,
    ) -> ClipChannel {
        use json::animation::{Interpolation, Property};
        let path = match &channel.target.path {
            Checked::Valid(Property::Translation) => GlbChannelPath::Translation,
            Checked::Valid(Property::Rotation) => GlbChannelPath::Rotation,
            Checked::Valid(Property::Scale) => GlbChannelPath::Scale,
            Checked::Valid(Property::MorphTargetWeights) => {
                return ClipChannel::Unsupported(format!(
                    "The animation '{clip}' animates morph weights; the v0.1 profile plays translation, rotation and scale only."
                ));
            }
            Checked::Invalid => {
                return ClipChannel::Unsupported(format!(
                    "The animation '{clip}' has a channel whose path is not translation, rotation or scale."
                ));
            }
        };
        let interpolation = match &animation
            .samplers
            .get(channel.sampler.value())
            .map(|sampler| &sampler.interpolation)
        {
            Some(Checked::Valid(Interpolation::Linear)) => GlbInterpolation::Linear,
            Some(Checked::Valid(Interpolation::Step)) => GlbInterpolation::Step,
            Some(Checked::Valid(Interpolation::CubicSpline)) => {
                return ClipChannel::Unsupported(format!(
                    "The animation '{clip}' uses cubic-spline interpolation; the v0.1 profile plays LINEAR and STEP only."
                ));
            }
            Some(Checked::Invalid) => {
                return ClipChannel::Unsupported(format!(
                    "The animation '{clip}' uses an interpolation other than LINEAR or STEP."
                ));
            }
            None => {
                self.report(
                    7,
                    Issue::new(
                        Code::E7025,
                        format!("The animation '{clip}' names a sampler that does not exist."),
                    ),
                );
                return ClipChannel::Broken;
            }
        };
        let sampler = &animation.samplers[channel.sampler.value()];
        let node_index = channel.target.node.value();
        let Some(node) = self.root.nodes.get(node_index) else {
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!(
                        "The animation '{clip}' targets node {node_index}, which does not exist."
                    ),
                ),
            );
            return ClipChannel::Broken;
        };
        let what = format!("animation '{clip}'");
        let times = match self.clip_floats(&what, sampler.input.value(), 1, Type::Scalar, false) {
            Some(times) => times,
            None => return ClipChannel::Broken,
        };
        if times.is_empty() || times.len() > MAX_CLIP_KEYS {
            return ClipChannel::Unsupported(format!(
                "The animation '{clip}' has {} keyframes; a clip has between 1 and {MAX_CLIP_KEYS}.",
                times.len()
            ));
        }
        if times.iter().any(|time| !time.is_finite())
            || times.windows(2).any(|pair| pair[1] <= pair[0])
        {
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!(
                        "The animation '{clip}' has keyframe times that are not finite and strictly increasing."
                    ),
                ),
            );
            return ClipChannel::Broken;
        }
        let values = match self.clip_floats(
            &what,
            sampler.output.value(),
            path.components(),
            match path {
                GlbChannelPath::Rotation => Type::Vec4,
                GlbChannelPath::Translation | GlbChannelPath::Scale => Type::Vec3,
            },
            path == GlbChannelPath::Rotation,
        ) {
            Some(values) => values,
            None => return ClipChannel::Broken,
        };
        if values.len() != times.len() * path.components() {
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!(
                        "The animation '{clip}' has {} output values for {} {path} keyframes.",
                        values.len() / path.components().max(1),
                        times.len(),
                        path = path.as_str()
                    ),
                ),
            );
            return ClipChannel::Broken;
        }
        let mesh_name = node.mesh.as_ref().and_then(|mesh| {
            self.root
                .meshes
                .get(mesh.value())
                .and_then(|mesh| mesh.name.clone())
        });
        ClipChannel::Ready(GlbChannel {
            node: node_index,
            node_name: node.name.clone(),
            mesh_name,
            path,
            interpolation,
            times,
            values,
        })
    }

    /// The floats of a clip accessor: `F32` of `kind`, `components` per element. Problems are
    /// reported; `None` means the channel cannot be read.
    fn clip_floats(
        &mut self,
        what: &str,
        index: usize,
        components: usize,
        kind: Type,
        quantised: bool,
    ) -> Option<Vec<f32>> {
        let Some(accessor) = self.root.accessors.get(index) else {
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!("{what}: accessors[{index}] does not exist."),
                ),
            );
            return None;
        };
        // Rotations may be stored as normalised integers (glTF 2.0, animation sampler outputs).
        let stored = match &accessor.component_type {
            Checked::Valid(GenericComponentType(ComponentType::F32)) if !accessor.normalized => {
                Some(ClipComponent::F32)
            }
            Checked::Valid(GenericComponentType(ComponentType::I8))
                if quantised && accessor.normalized =>
            {
                Some(ClipComponent::I8)
            }
            Checked::Valid(GenericComponentType(ComponentType::U8))
                if quantised && accessor.normalized =>
            {
                Some(ClipComponent::U8)
            }
            Checked::Valid(GenericComponentType(ComponentType::I16))
                if quantised && accessor.normalized =>
            {
                Some(ClipComponent::I16)
            }
            Checked::Valid(GenericComponentType(ComponentType::U16))
                if quantised && accessor.normalized =>
            {
                Some(ClipComponent::U16)
            }
            _ => None,
        };
        let type_ok = matches!(&accessor.type_, Checked::Valid(found) if *found == kind);
        let (true, Some(stored)) = (type_ok, stored) else {
            let allowed = if quantised {
                "FLOAT, or normalised BYTE or SHORT,"
            } else {
                "FLOAT"
            };
            self.report(
                7,
                Issue::new(
                    Code::E7025,
                    format!(
                        "{what}: accessors[{index}] must be {allowed} {} with {components} components.",
                        type_name(kind)
                    ),
                ),
            );
            return None;
        };
        let size = stored.size();
        let resolved = match self.resolve(index, components * size, false) {
            Ok(resolved) => resolved,
            Err(problem) => {
                self.report_problem(&format!("{what}, accessors[{index}]"), problem);
                return None;
            }
        };
        let mut values = Vec::with_capacity(resolved.count.saturating_mul(components));
        for element in 0..resolved.count {
            for component in 0..components {
                let at = resolved.offset + element * resolved.stride + component * size;
                let Some(value) = stored.read(self.bin, at) else {
                    self.report(
                        7,
                        Issue::new(
                            Code::E7025,
                            format!("{what}: accessors[{index}] ends before its values do."),
                        ),
                    );
                    return None;
                };
                if !value.is_finite() {
                    self.report(
                        7,
                        Issue::new(
                            Code::E7025,
                            format!("{what}: accessors[{index}] has a value that is not finite."),
                        ),
                    );
                    return None;
                }
                values.push(value);
            }
        }
        Some(values)
    }
}

/// The most keyframes one channel may carry (decision 0156).
const MAX_CLIP_KEYS: usize = 4096;

enum ClipChannel {
    Ready(GlbChannel),
    /// A channel the profile cannot play, with the reason (decision 0174).
    Unsupported(String),
    /// A data error, already reported (`E7025` or `E7011`).
    Broken,
}

/// How the output of a clip accessor is stored (glTF 2.0: rotations may be normalised integers).
#[derive(Clone, Copy)]
enum ClipComponent {
    F32,
    I8,
    U8,
    I16,
    U16,
}

impl ClipComponent {
    fn size(self) -> usize {
        match self {
            ClipComponent::F32 => 4,
            ClipComponent::I8 | ClipComponent::U8 => 1,
            ClipComponent::I16 | ClipComponent::U16 => 2,
        }
    }

    /// The value at byte `at` as a float; integers are dequantised as glTF specifies
    /// (signed `max(c / max, -1)`, unsigned `c / max`).
    fn read(self, bytes: &[u8], at: usize) -> Option<f32> {
        match self {
            ClipComponent::F32 => le_f32(bytes, at),
            ClipComponent::I8 => bytes
                .get(at)
                .map(|byte| (f32::from(*byte as i8) / 127.0).max(-1.0)),
            ClipComponent::U8 => bytes.get(at).map(|byte| f32::from(*byte) / 255.0),
            ClipComponent::I16 => {
                let pair = bytes.get(at..at + 2)?;
                Some((f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32767.0).max(-1.0))
            }
            ClipComponent::U16 => {
                let pair = bytes.get(at..at + 2)?;
                Some(f32::from(u16::from_le_bytes([pair[0], pair[1]])) / 65535.0)
            }
        }
    }
}

fn semantic_name(semantic: &Semantic) -> String {
    match semantic {
        Semantic::Positions => "POSITION".to_owned(),
        Semantic::Normals => "NORMAL".to_owned(),
        Semantic::Tangents => "TANGENT".to_owned(),
        Semantic::Colors(n) => format!("COLOR_{n}"),
        Semantic::TexCoords(n) => format!("TEXCOORD_{n}"),
        Semantic::Joints(n) => format!("JOINTS_{n}"),
        Semantic::Weights(n) => format!("WEIGHTS_{n}"),
        Semantic::Extras(name) => format!("_{}", name.trim_start_matches('_')),
    }
}

/// A sphere that encloses every vertex: centred on the middle of the bounding box, with the
/// radius rounded up to the next `f32` so that no vertex lies outside it.
fn bounding_sphere(positions: &[f32]) -> ([f32; 3], f32) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for vertex in positions.as_chunks::<3>().0 {
        for (axis, value) in vertex.iter().enumerate() {
            let value = f64::from(*value);
            if let (Some(low), Some(high)) = (min.get_mut(axis), max.get_mut(axis)) {
                *low = low.min(value);
                *high = high.max(value);
            }
        }
    }
    let mut center = [0.0_f32; 3];
    for axis in 0..3 {
        if let (Some(c), Some(low), Some(high)) =
            (center.get_mut(axis), min.get(axis), max.get(axis))
        {
            *c = ((low + high) / 2.0) as f32;
        }
    }
    let mut radius = 0.0_f64;
    for vertex in positions.as_chunks::<3>().0 {
        let mut squared = 0.0_f64;
        for (axis, value) in vertex.iter().enumerate() {
            let delta = f64::from(*value) - f64::from(center.get(axis).copied().unwrap_or(0.0));
            squared += delta * delta;
        }
        radius = radius.max(squared.sqrt());
    }
    let mut rounded = radius as f32;
    if f64::from(rounded) < radius {
        rounded = f32::from_bits(rounded.to_bits() + 1);
    }
    (center, rounded)
}

#[cfg(test)]
mod tests;
