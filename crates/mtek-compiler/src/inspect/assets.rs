//! `mtek inspect --assets` (`spec/assets.md` section 4, decision 0058): the files `build` writes
//! under `assets/`, the table of the manifest's `assets` with where each was declared, what
//! was recorded as preprocessing, and the meshes of the entry scene that point into them.
//!
//! The view packages the assets exactly as `build` does (same function, same bytes), so what it
//! prints is what ends up in the manifest.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::assets::pack::{ImageSource, pack};
use crate::assets::AssetStore;
use crate::diagnostics::Diagnostic;
use crate::ir::MeshDesc;
use crate::package::asset_references;
use crate::package::manifest::{Asset, AssetKind, MeshPrimitive};
use crate::plan::ResourcePlan;
use crate::source::{SourceMap, Span};

use super::view::{Align, SourceLocation, table, to_json};

/// The view.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetsView {
    /// The entry scene's symbol.
    pub scene: String,
    /// The sum of the packaged files' lengths.
    pub total_bytes: u64,
    /// The manifest's `assets`, in its order.
    pub assets: Vec<AssetRow>,
    /// The asset meshes of the manifest's `meshes`.
    pub meshes: Vec<MeshRow>,
}

/// One packaged file.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    /// `mesh-data` or `image`.
    pub kind: &'static str,
    /// Images: `srgb` or `linear`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_space: Option<String>,
    /// Where the bytes come from: the GLB or image file of the project, and for an image
    /// inside a GLB which one.
    pub sources: Vec<String>,
    /// The `asset.*` call that declared the file first.
    pub declared_at: SourceLocation,
    /// The preprocessing decisions recorded in the manifest.
    pub preprocessing: Vec<String>,
    /// Mesh data: the packaged primitives.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub primitives: Vec<MeshPrimitive>,
}

/// A mesh of the manifest that comes from an asset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshRow {
    pub id: String,
    pub asset: String,
    pub primitive: u32,
    /// `mesh "Seat" primitive 0 of models/chair.glb`.
    pub source: String,
}

fn describe(source: &ImageSource) -> String {
    match source {
        ImageSource::File(path) => path.clone(),
        ImageSource::Embedded { glb, image } => format!("image {image} of {glb}"),
    }
}

/// The view of the assets `plan` references.
///
/// # Errors
/// What packaging reports (`E7026`) or `E9999` for a defect.
pub fn assets_view(
    scene: &str,
    plan: &ResourcePlan,
    store: &AssetStore,
    sources: &SourceMap,
) -> Result<AssetsView, Vec<Diagnostic>> {
    let (mesh_refs, image_refs) = asset_references(plan);
    let mut spans: Vec<Span> = Vec::new();
    let packed = pack(store, &mesh_refs, &image_refs, &mut |span| {
        spans.push(span);
        u32::try_from(spans.len() - 1).ok()
    })?;
    let defect = |text: String| {
        vec![
            Diagnostic::new(
                crate::diagnostics::Code::E9999,
                "The inspection could not be built from the checked program; this is a compiler bug.",
            )
            .note(text)
            .help("please report it with the program that caused it"),
        ]
    };
    // Who asked for each image.
    let mut image_sources: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    for ((source, _space), url) in &packed.images {
        image_sources
            .entry(url.as_str())
            .or_default()
            .push(describe(source));
    }
    let mut rows = Vec::with_capacity(packed.assets.len());
    let mut total = 0_u64;
    for asset in &packed.assets {
        total += asset.bytes;
        rows.push(row(asset, &spans, &image_sources, sources).map_err(defect)?);
    }
    let mut meshes = Vec::new();
    for (index, desc) in plan.meshes.iter().enumerate() {
        let MeshDesc::Asset {
            file,
            mesh,
            primitive,
        } = desc
        else {
            continue;
        };
        let key = crate::assets::MeshRef {
            file: file.clone(),
            mesh: mesh.clone(),
            primitive: *primitive as usize,
        };
        let location = packed
            .meshes
            .get(&key)
            .ok_or_else(|| defect(format!("the mesh '{mesh}' of '{file}' was not packaged")))?;
        meshes.push(MeshRow {
            id: ResourcePlan::mesh_id(u32::try_from(index).unwrap_or(u32::MAX)),
            asset: location.asset.clone(),
            primitive: location.primitive,
            source: format!("mesh \"{mesh}\" primitive {primitive} of {file}"),
        });
    }
    Ok(AssetsView {
        scene: scene.to_owned(),
        total_bytes: total,
        assets: rows,
        meshes,
    })
}

fn row(
    asset: &Asset,
    spans: &[Span],
    image_sources: &BTreeMap<&str, Vec<String>>,
    sources: &SourceMap,
) -> Result<AssetRow, String> {
    let located = |id: u32| -> Result<SourceLocation, String> {
        let span = spans
            .get(id as usize)
            .ok_or_else(|| "an asset has no declaring span".to_owned())?;
        SourceLocation::of(*span, sources)
    };
    Ok(match &asset.kind {
        AssetKind::MeshData {
            primitives,
            preprocessing,
            span,
        } => {
            let mut files: Vec<String> = primitives.iter().map(|p| p.source.file.clone()).collect();
            files.dedup();
            AssetRow {
                url: asset.url.clone(),
                sha256: asset.sha256.clone(),
                bytes: asset.bytes,
                kind: "mesh-data",
                color_space: None,
                sources: files,
                declared_at: located(*span)?,
                preprocessing: preprocessing.clone(),
                primitives: primitives.clone(),
            }
        }
        AssetKind::Image {
            color_space,
            preprocessing,
            span,
        } => AssetRow {
            url: asset.url.clone(),
            sha256: asset.sha256.clone(),
            bytes: asset.bytes,
            kind: "image",
            color_space: Some(color_space.clone()),
            sources: image_sources
                .get(asset.url.as_str())
                .cloned()
                .unwrap_or_default(),
            declared_at: located(*span)?,
            preprocessing: preprocessing.clone(),
            primitives: Vec::new(),
        },
    })
}

impl AssetsView {
    /// Pretty JSON with a final line break.
    #[must_use]
    pub fn to_json(&self) -> String {
        to_json(self)
    }

    /// Tables for people.
    #[must_use]
    pub fn to_human(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "assets of scene {}: {} file{}, {} bytes\n",
            self.scene,
            self.assets.len(),
            if self.assets.len() == 1 { "" } else { "s" },
            self.total_bytes
        ));
        if self.assets.is_empty() {
            out.push_str("  (the scene references no asset files)\n");
            return out;
        }
        for asset in &self.assets {
            out.push('\n');
            let space = asset
                .color_space
                .as_ref()
                .map_or(String::new(), |s| format!(", {s}"));
            out.push_str(&format!(
                "{} {} ({} bytes{space})\n",
                asset.kind, asset.url, asset.bytes
            ));
            out.push_str(&format!("  sha256       {}\n", asset.sha256));
            out.push_str(&format!("  from         {}\n", asset.sources.join(", ")));
            out.push_str(&format!("  declared at  {}\n", asset.declared_at.human()));
            if asset.preprocessing.is_empty() {
                out.push_str("  preprocessing  none\n");
            } else {
                out.push_str("  preprocessing\n");
                for note in &asset.preprocessing {
                    out.push_str(&format!("    {note}\n"));
                }
            }
            if !asset.primitives.is_empty() {
                out.push_str("  primitives\n");
                let rows: Vec<Vec<String>> = asset
                    .primitives
                    .iter()
                    .enumerate()
                    .map(|(index, p)| {
                        let offset = |value: Option<u64>| value.map_or("-".to_owned(), |v| v.to_string());
                        vec![
                            index.to_string(),
                            format!("{} #{}", p.source.mesh, p.source.primitive),
                            p.vertex_count.to_string(),
                            p.index_count.to_string(),
                            p.index_format.clone(),
                            p.attributes.join("+"),
                            p.offsets.position.to_string(),
                            offset(p.offsets.normal),
                            offset(p.offsets.uv),
                            p.offsets.indices.to_string(),
                        ]
                    })
                    .collect();
                table(
                    &mut out,
                    4,
                    &[
                        ("#", Align::Right),
                        ("source", Align::Left),
                        ("vertices", Align::Right),
                        ("indices", Align::Right),
                        ("format", Align::Left),
                        ("attributes", Align::Left),
                        ("position", Align::Right),
                        ("normal", Align::Right),
                        ("uv", Align::Right),
                        ("index data", Align::Right),
                    ],
                    &rows,
                );
            }
        }
        if !self.meshes.is_empty() {
            out.push_str("\nmeshes\n");
            let rows: Vec<Vec<String>> = self
                .meshes
                .iter()
                .map(|m| {
                    vec![
                        m.id.clone(),
                        m.asset.clone(),
                        m.primitive.to_string(),
                        m.source.clone(),
                    ]
                })
                .collect();
            table(
                &mut out,
                2,
                &[
                    ("id", Align::Left),
                    ("asset", Align::Left),
                    ("primitive", Align::Right),
                    ("source", Align::Left),
                ],
                &rows,
            );
        }
        out
    }
}
