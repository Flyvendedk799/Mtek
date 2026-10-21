//! Assets: declarations, the static GLB profile, accessors and packaging
//! (`spec/assets.md`, decision 0058).
//!
//! Assets are compile-time dependencies. The type checker calls into an [`AssetHost`] when it
//! meets `asset.glb(..)`, `asset.texture(..)` or `asset.linear_texture(..)`: the host resolves
//! the path against the declaring module, reads the file through [`crate::source::Fs`] (sizes
//! first), validates it against the v0.1 profile and answers with a handle. The accessors of a
//! `glb_asset` (`.mesh(..)`, `.node_position(..)`, …) are then evaluated against the validated
//! [`GlbFile`] ([`access`]). After the program is checked, [`pack`] re-lays out the referenced
//! primitives, copies the referenced images and builds the manifest's `assets` table.
//!
//! The module performs no I/O of its own and never panics on a hostile file: every problem is
//! an [`Issue`] that becomes a diagnostic at the span of the declaring path literal.

pub mod access;
pub(crate) mod attributes;
pub mod audio;
pub mod font;
mod glb;
mod host;
mod image;
pub mod pack;
mod transform;

pub use glb::{
    GlbFile, GlbImage, GlbMaterial, GlbMesh, GlbNode, GlbPrimitive, GlbTexture, ImageFormat,
    IndexKind, IndexSource, LocalTransform, SamplerChoice, Strided, read_glb,
};
pub use host::{
    AssetHandle, AssetHost, AssetKind, AssetLoader, AssetStore, DeclaredFile, FontFile, ImageFile,
    ImageSpace, SoundFile,
};
pub use image::{ImageInfo, sniff_image};
pub use pack::{ImageRef, ImageSource, MeshRef};
pub use transform::{Trs, node_world_trs};

use std::fmt;

use serde::Serialize;

use crate::diagnostics::{Code, Diagnostic};
use crate::project::AssetsSection;
use crate::source::Span;

/// The largest JSON chunk of a GLB (`spec/assets.md` section 3).
pub const MAX_JSON_CHUNK_BYTES: u64 = 16 * 1024 * 1024;

/// The limits of `mtek.toml [assets]` (`spec/assets.md` section 6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AssetLimits {
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_texture_dimension: u32,
    pub max_vertices_per_primitive: u32,
}

impl From<&AssetsSection> for AssetLimits {
    fn from(section: &AssetsSection) -> Self {
        Self {
            max_file_bytes: section.max_file_bytes,
            max_total_bytes: section.max_total_bytes,
            max_texture_dimension: section.max_texture_dimension,
            max_vertices_per_primitive: section.max_vertices_per_primitive,
        }
    }
}

impl Default for AssetLimits {
    fn default() -> Self {
        Self::from(&AssetsSection::default())
    }
}

/// One problem found in an asset file, before it has a source location.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Issue {
    pub code: Code,
    pub message: String,
    pub notes: Vec<String>,
    pub help: Option<String>,
}

impl Issue {
    #[must_use]
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            notes: Vec::new(),
            help: None,
        }
    }

    #[must_use]
    pub fn note(mut self, note: impl Into<String>) -> Self {
        self.notes.push(note.into());
        self
    }

    #[must_use]
    pub fn help(mut self, help: impl Into<String>) -> Self {
        self.help = Some(help.into());
        self
    }

    /// The diagnostic at `span` (the path literal of the declaration).
    #[must_use]
    pub fn at(&self, span: Span) -> Diagnostic {
        self.at_in(span, None)
    }

    /// The diagnostic at `span` for a problem inside the file `file` (a project path). A
    /// message that does not name the file gets the note "the problem is in the file '…'", so
    /// that the file is named in the diagnostic itself and not only by the path literal at
    /// `span` (`spec/diagnostics.md` section 7: name the specific entity).
    #[must_use]
    pub fn at_in(&self, span: Span, file: Option<&str>) -> Diagnostic {
        let mut diagnostic = Diagnostic::new(self.code, self.message.clone()).at(span);
        if let Some(file) = file
            && !self.message.contains(&format!("'{file}'"))
        {
            diagnostic = diagnostic.note(format!("the problem is in the file '{file}'"));
        }
        for note in &self.notes {
            diagnostic = diagnostic.note(note.clone());
        }
        if let Some(help) = &self.help {
            diagnostic = diagnostic.help(help);
        }
        diagnostic
    }
}

/// An image a texture constant stands for: where its bytes are and how it is sampled.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetImage {
    pub source: ImageSource,
    pub space: ImageSpace,
    /// The file's sampler asked for mip-maps, which v0.1 does not generate.
    pub mipmapped: bool,
}

impl fmt::Display for AssetImage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.source {
            ImageSource::File(path) => write!(f, "{}({path:?})", self.constructor()),
            ImageSource::Embedded { glb, image } => {
                write!(f, "image {image} of {glb:?} ({})", self.space.as_str())
            }
        }
    }
}

impl AssetImage {
    fn constructor(&self) -> &'static str {
        match self.space {
            ImageSpace::Srgb => "asset.texture",
            ImageSpace::Linear => "asset.linear_texture",
        }
    }
}
