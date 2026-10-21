//! Packaging (`spec/assets.md` section 4, decision 0058): one `.bin` per referenced `.glb` with
//! only the referenced primitives re-laid out for the runtime, referenced images copied
//! byte-for-byte, and the manifest's `assets` entries.
//!
//! Layout of a `.bin` (all numbers little-endian, every section starts at a multiple of 4
//! bytes): for each referenced primitive, ordered by glTF mesh index and primitive index,
//! `position` (`f32 × 3` per vertex), `normal` (`f32 × 3`) and `uv` (`f32 × 2`) if the
//! primitive has them, then the indices (`u16`, or `u32` if the vertex count is above 65 535).
//! The manifest gives every section's byte offset.
//!
//! The sizes of everything are computed before any data is copied, and checked against
//! `max_total_bytes` (`E7026`).

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::glb::{GlbFile, GlbPrimitive, IndexKind};
use super::host::{AssetStore, ImageSpace};
use crate::diagnostics::{Code, Diagnostic};
use crate::package::identity::h16;
use crate::package::manifest::{
    Asset, AssetKind, BoundingSphere, MeshPrimitive, Num, PrimitiveOffsets, PrimitiveSource,
};
use crate::source::Span;

/// Where an image's bytes are.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageSource {
    /// A standalone file (`asset.texture`, `asset.linear_texture`), by project path.
    File(String),
    /// An image embedded in a GLB: the GLB's project path and the image index.
    Embedded { glb: String, image: usize },
}

impl ImageSource {
    /// The manifest's `source` of an image entry (decision 0082): the project path, or
    /// `<glb path>#images[N]`.
    #[must_use]
    pub fn display(&self) -> String {
        match self {
            ImageSource::File(path) => path.clone(),
            ImageSource::Embedded { glb, image } => format!("{glb}#images[{image}]"),
        }
    }
}

/// A reference to an image by an entity's material.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageRef {
    pub source: ImageSource,
    pub space: ImageSpace,
    /// The file's sampler asked for mip-maps, which v0.1 does not generate.
    pub mipmapped: bool,
}

/// A reference to a primitive of a GLB mesh by an entity.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct MeshRef {
    pub file: String,
    pub mesh: String,
    pub primitive: usize,
}

/// Where a referenced primitive ended up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshLocation {
    /// The `url` of the mesh-data entry.
    pub asset: String,
    /// The primitive's index in that entry's `primitives`.
    pub primitive: u32,
}

/// The packaged assets of a build.
#[derive(Clone, Debug, Default)]
pub struct Packed {
    /// The files of `dist/`, by path (`assets/<h16>.bin`, `assets/<h16>.png`).
    pub files: BTreeMap<String, Vec<u8>>,
    /// The manifest's `assets`: mesh-data entries by source path, then images by url.
    pub assets: Vec<Asset>,
    pub meshes: BTreeMap<MeshRef, MeshLocation>,
    /// The `url` of every referenced image, by source and colour space.
    pub images: BTreeMap<(ImageSource, ImageSpace), String>,
    /// `(project path, sha256)` of the source files the packaged assets come from.
    pub sources: Vec<(String, String)>,
}

fn align4(value: u64) -> u64 {
    value.div_ceil(4) * 4
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn defect(text: impl Into<String>) -> Vec<Diagnostic> {
    vec![
        Diagnostic::new(
            Code::E9999,
            "The assets could not be packaged; this is a compiler bug.",
        )
        .note(text.into())
        .help("please report it with the program that caused it"),
    ]
}

/// The output index type of a primitive: `u16` up to 65 535 vertices.
fn index_format(vertex_count: u32) -> (&'static str, u64) {
    if vertex_count <= 65_535 {
        ("uint16", 2)
    } else {
        ("uint32", 4)
    }
}

/// The byte size of a primitive's section in the `.bin`, without padding at its end.
fn primitive_size(primitive: &GlbPrimitive) -> u64 {
    let vertices = u64::from(primitive.vertex_count);
    let (_, index_size) = index_format(primitive.vertex_count);
    let mut size = vertices * 12;
    if primitive.normal.is_some() {
        size += vertices * 12;
    }
    if primitive.uv.is_some() {
        size += vertices * 8;
    }
    align4(size + u64::from(primitive.index_count) * index_size)
}

fn read_u32_at(bin: &[u8], at: usize) -> Option<u32> {
    let slice = bin.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes(<[u8; 4]>::try_from(slice).ok()?))
}

/// Append `count` vertices of `components` floats read from `source`.
fn copy_floats(
    bin: &[u8],
    source: super::glb::Strided,
    count: usize,
    components: usize,
    out: &mut Vec<u8>,
) -> Option<()> {
    for vertex in 0..count {
        for component in 0..components {
            let at = source.offset + vertex * source.stride + component * 4;
            out.extend_from_slice(&read_u32_at(bin, at)?.to_le_bytes());
        }
    }
    Some(())
}

/// Append the indices of `primitive` in the output format; the preprocessing note, if any.
fn copy_indices(bin: &[u8], primitive: &GlbPrimitive, out: &mut Vec<u8>) -> Option<Option<String>> {
    let (_, out_size) = index_format(primitive.vertex_count);
    let count = primitive.index_count as usize;
    let emit = |value: u32, out: &mut Vec<u8>| {
        if out_size == 2 {
            out.extend_from_slice(&u16::try_from(value).ok()?.to_le_bytes());
        } else {
            out.extend_from_slice(&value.to_le_bytes());
        }
        Some(())
    };
    let note = match primitive.indices {
        None => {
            for index in 0..count {
                emit(u32::try_from(index).ok()?, out)?;
            }
            return Some(Some("sequential indices generated".to_owned()));
        }
        Some(source) => {
            for position in 0..count {
                let at = source.offset + position * source.kind.size();
                let value = match source.kind {
                    IndexKind::U8 => u32::from(*bin.get(at)?),
                    IndexKind::U16 => u32::from(u16::from_le_bytes(
                        <[u8; 2]>::try_from(bin.get(at..at + 2)?).ok()?,
                    )),
                    IndexKind::U32 => read_u32_at(bin, at)?,
                };
                emit(value, out)?;
            }
            let from = source.kind.size() as u64 * 8;
            let to = out_size * 8;
            match from.cmp(&to) {
                std::cmp::Ordering::Equal => None,
                std::cmp::Ordering::Less => Some(format!("u{from} indices widened to u{to}")),
                std::cmp::Ordering::Greater => Some(format!(
                    "u{from} indices narrowed to u{to} (at most 65535 vertices)"
                )),
            }
        }
    };
    Some(note)
}

fn num(value: f32) -> Option<Num> {
    Num::from_f32(value)
}

/// Package the referenced meshes and images.
///
/// `intern` turns the declaring span of an asset into the manifest's span id.
///
/// # Errors
/// `E7026` when the packaged assets exceed `max_total_bytes`; `E9999` for a defect.
pub fn pack(
    store: &AssetStore,
    meshes: &[MeshRef],
    images: &[ImageRef],
    intern: &mut dyn FnMut(Span) -> Option<u32>,
) -> Result<Packed, Vec<Diagnostic>> {
    let mut packed = Packed::default();
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    let mut total: u64 = 0;
    let limit = store.limits.max_total_bytes;
    let exceeded = |span: Span, total: u64| {
        vec![
            Diagnostic::new(
                Code::E7026,
                format!(
                    "The packaged assets would be {total} bytes, over the limit of {limit} bytes."
                ),
            )
            .at(span)
            .help("raise `max_total_bytes` in the `[assets]` table of mtek.toml, or reduce the assets"),
        ]
    };

    // Meshes: group by GLB, order by glTF mesh and primitive index.
    let mut by_file: BTreeMap<&str, BTreeSet<(usize, usize, &MeshRef)>> = BTreeMap::new();
    for reference in meshes {
        let declared = store
            .glb(&reference.file)
            .ok_or_else(|| defect(format!("the GLB '{}' is not loaded", reference.file)))?;
        let index = declared
            .file
            .meshes
            .iter()
            .position(|m| m.name.as_deref() == Some(reference.mesh.as_str()))
            .ok_or_else(|| {
                defect(format!(
                    "no mesh '{}' in '{}'",
                    reference.mesh, reference.file
                ))
            })?;
        by_file.entry(reference.file.as_str()).or_default().insert((
            index,
            reference.primitive,
            reference,
        ));
    }
    for (path, wanted) in &by_file {
        let declared = store
            .glb(path)
            .ok_or_else(|| defect(format!("the GLB '{path}' is not loaded")))?;
        let file: &GlbFile = &declared.file;
        // Sizes first.
        let mut size: u64 = 0;
        let mut layout: Vec<(&MeshRef, usize, &GlbPrimitive, u64)> = Vec::new();
        for (mesh_index, primitive_index, reference) in wanted {
            let primitive = file
                .meshes
                .get(*mesh_index)
                .and_then(|m| m.primitives.get(*primitive_index))
                .ok_or_else(|| {
                    defect(format!(
                        "no primitive {primitive_index} in mesh '{}'",
                        reference.mesh
                    ))
                })?;
            layout.push((reference, *mesh_index, primitive, size));
            size += primitive_size(primitive);
        }
        total += size;
        if total > limit {
            return Err(exceeded(declared.span, total));
        }
        // Then the bytes.
        let mut blob: Vec<u8> = Vec::with_capacity(usize::try_from(size).unwrap_or(0));
        let mut primitives = Vec::with_capacity(layout.len());
        let mut preprocessing = Vec::new();
        for (slot, (reference, _, primitive, start)) in layout.iter().enumerate() {
            let vertices = primitive.vertex_count as usize;
            if blob.len() as u64 != *start {
                return Err(defect("a primitive does not start where the layout says"));
            }
            let position_offset = blob.len() as u64;
            copy_floats(&file.bin, primitive.position, vertices, 3, &mut blob)
                .ok_or_else(|| defect("a position accessor is out of bounds"))?;
            let normal_offset = match primitive.normal {
                Some(normal) => {
                    let at = blob.len() as u64;
                    copy_floats(&file.bin, normal, vertices, 3, &mut blob)
                        .ok_or_else(|| defect("a normal accessor is out of bounds"))?;
                    Some(at)
                }
                None => None,
            };
            let uv_offset = match primitive.uv {
                Some(uv) => {
                    let at = blob.len() as u64;
                    copy_floats(&file.bin, uv, vertices, 2, &mut blob)
                        .ok_or_else(|| defect("a uv accessor is out of bounds"))?;
                    Some(at)
                }
                None => None,
            };
            let index_offset = blob.len() as u64;
            if let Some(note) = copy_indices(&file.bin, primitive, &mut blob)
                .ok_or_else(|| defect("an index accessor is out of bounds"))?
            {
                preprocessing.push(format!(
                    "mesh '{}' primitive {}: {note}",
                    reference.mesh, reference.primitive
                ));
            }
            while !blob.len().is_multiple_of(4) {
                blob.push(0);
            }
            let (format, _) = index_format(primitive.vertex_count);
            let mut attributes = vec!["position".to_owned()];
            if normal_offset.is_some() {
                attributes.push("normal".to_owned());
            }
            if uv_offset.is_some() {
                attributes.push("uv".to_owned());
            }
            let center = primitive.bounds_center.map(num);
            let (Some(radius), [Some(x), Some(y), Some(z)]) =
                (num(primitive.bounds_radius), center)
            else {
                return Err(defect("a bounding sphere is not finite"));
            };
            primitives.push(MeshPrimitive {
                source: PrimitiveSource {
                    file: (*path).to_owned(),
                    mesh: reference.mesh.clone(),
                    primitive: u32::try_from(reference.primitive)
                        .map_err(|_| defect("primitive index too large"))?,
                },
                vertex_count: primitive.vertex_count,
                index_count: primitive.index_count,
                index_format: format.to_owned(),
                attributes,
                offsets: PrimitiveOffsets {
                    position: position_offset,
                    normal: normal_offset,
                    uv: uv_offset,
                    indices: index_offset,
                },
                bounding_sphere: BoundingSphere {
                    center: vec![x, y, z],
                    radius,
                },
            });
            packed.meshes.insert(
                (*reference).clone(),
                MeshLocation {
                    asset: String::new(),
                    primitive: u32::try_from(slot).map_err(|_| defect("too many primitives"))?,
                },
            );
        }
        let mut stamped = Vec::with_capacity(path.len() + 1 + blob.len());
        stamped.extend_from_slice(path.as_bytes());
        stamped.push(0);
        stamped.extend_from_slice(&blob);
        let url = format!("assets/{}.bin", h16(&stamped));
        for (reference, _, _, _) in &layout {
            if let Some(location) = packed.meshes.get_mut(*reference) {
                location.asset.clone_from(&url);
            }
        }
        let span = intern(declared.span).ok_or_else(|| defect("the declaring span is unknown"))?;
        packed.assets.push(Asset {
            url: url.clone(),
            sha256: sha256_hex(&blob),
            bytes: blob.len() as u64,
            kind: AssetKind::MeshData {
                primitives,
                preprocessing,
                span,
            },
        });
        packed.files.insert(url, blob);
        sources.insert(file.path.clone(), file.sha256.clone());
    }

    // Images: one entry per (colour space, bytes).
    struct Wanted<'a> {
        bytes: &'a [u8],
        extension: &'static str,
        span: Span,
        source_path: &'a str,
        source_sha: &'a str,
        mipmapped: bool,
        keys: BTreeSet<ImageSource>,
    }
    let mut entries: BTreeMap<String, (ImageSpace, Wanted<'_>)> = BTreeMap::new();
    for reference in images {
        let (bytes, extension, span, source_path, source_sha): (&[u8], _, _, &str, &str) =
            match &reference.source {
                ImageSource::File(path) => {
                    let declared = store
                        .image(path)
                        .ok_or_else(|| defect(format!("the image '{path}' is not loaded")))?;
                    let extension = match declared.file.info.format {
                        super::glb::ImageFormat::Png => "png",
                        super::glb::ImageFormat::Jpeg => "jpg",
                    };
                    (
                        &declared.file.bytes,
                        extension,
                        declared.span,
                        &declared.file.path,
                        &declared.file.sha256,
                    )
                }
                ImageSource::Embedded { glb, image } => {
                    let declared = store
                        .glb(glb)
                        .ok_or_else(|| defect(format!("the GLB '{glb}' is not loaded")))?;
                    let embedded = declared
                        .file
                        .images
                        .get(*image)
                        .ok_or_else(|| defect(format!("no image {image} in '{glb}'")))?;
                    let bytes = declared
                        .file
                        .bin
                        .get(embedded.start..embedded.start + embedded.len)
                        .ok_or_else(|| defect("an image is out of bounds"))?;
                    (
                        bytes,
                        embedded.format.extension(),
                        declared.span,
                        &declared.file.path,
                        &declared.file.sha256,
                    )
                }
            };
        let mut stamped = reference.space.as_str().as_bytes().to_vec();
        stamped.push(0);
        stamped.extend_from_slice(bytes);
        let url = format!("assets/{}.{extension}", h16(&stamped));
        let entry = entries.entry(url).or_insert_with(|| {
            (
                reference.space,
                Wanted {
                    bytes,
                    extension,
                    span,
                    source_path,
                    source_sha,
                    mipmapped: false,
                    keys: BTreeSet::new(),
                },
            )
        });
        entry.1.mipmapped |= reference.mipmapped;
        entry.1.keys.insert(reference.source.clone());
    }
    for (url, (space, wanted)) in entries {
        total += wanted.bytes.len() as u64;
        if total > limit {
            return Err(exceeded(wanted.span, total));
        }
        let _ = wanted.extension;
        let span = intern(wanted.span).ok_or_else(|| defect("the declaring span is unknown"))?;
        for key in &wanted.keys {
            packed.images.insert((key.clone(), space), url.clone());
        }
        // The first source in key order names the author's file (decision 0082); identical
        // bytes from several files share the entry.
        let source = wanted.keys.iter().next().map(ImageSource::display);
        packed.assets.push(Asset {
            url: url.clone(),
            sha256: sha256_hex(wanted.bytes),
            bytes: wanted.bytes.len() as u64,
            kind: AssetKind::Image {
                color_space: space.as_str().to_owned(),
                preprocessing: if wanted.mipmapped {
                    vec!["mipmaps not generated".to_owned()]
                } else {
                    Vec::new()
                },
                span,
                source,
            },
        });
        sources.insert(wanted.source_path.to_owned(), wanted.source_sha.to_owned());
        packed.files.insert(url, wanted.bytes.to_vec());
    }
    // Sounds (decision 0130): every declared sound file, byte for byte, one entry per file. The
    // runtime finds an entry by `source`, the project path generated code names the sound by.
    for (path, declared) in store.sounds() {
        let file = &declared.file;
        total += file.bytes.len() as u64;
        if total > limit {
            return Err(exceeded(declared.span, total));
        }
        let mut stamped = b"sound".to_vec();
        stamped.push(0);
        stamped.extend_from_slice(&file.bytes);
        let url = format!("assets/{}.{}", h16(&stamped), file.info.format.extension());
        let span = intern(declared.span).ok_or_else(|| defect("the declaring span is unknown"))?;
        packed.assets.push(Asset {
            url: url.clone(),
            sha256: file.sha256.clone(),
            bytes: file.bytes.len() as u64,
            kind: AssetKind::Audio {
                format: file.info.format.extension().to_owned(),
                mime: file.info.format.mime().to_owned(),
                source: path.clone(),
                span,
            },
        });
        sources.insert(path.clone(), file.sha256.clone());
        packed.files.insert(url, file.bytes.clone());
    }
    // Fonts (decision 0139): every declared font file, byte for byte, found by `source` like sounds.
    for (path, declared) in store.fonts() {
        let file = &declared.file;
        total += file.bytes.len() as u64;
        if total > limit {
            return Err(exceeded(declared.span, total));
        }
        let mut stamped = b"font".to_vec();
        stamped.push(0);
        stamped.extend_from_slice(&file.bytes);
        let url = format!("assets/{}.{}", h16(&stamped), file.info.format.extension());
        let span = intern(declared.span).ok_or_else(|| defect("the declaring span is unknown"))?;
        packed.assets.push(Asset {
            url: url.clone(),
            sha256: file.sha256.clone(),
            bytes: file.bytes.len() as u64,
            kind: AssetKind::Font {
                format: file.info.format.extension().to_owned(),
                mime: file.info.format.mime().to_owned(),
                source: path.clone(),
                span,
            },
        });
        sources.insert(path.clone(), file.sha256.clone());
        packed.files.insert(url, file.bytes.clone());
    }
    packed.sources = sources.into_iter().collect();
    Ok(packed)
}
