//! The asset host: what the type checker calls when it meets an asset declaration.
//!
//! [`AssetLoader`] resolves the path against the declaring module (`E7901`, `E7021`),
//! checks the file system (`E7023`, `E7020`), the size before the read (`E7002`), reads the
//! file and validates it ([`super::read_glb`], [`super::sniff_image`]). Files are loaded once
//! per project path; a file that failed is reported again at every declaration that names it,
//! so fixing the first does not hide the others. The checker never sees bytes: it holds
//! handles and asks the host for the validated [`GlbFile`].

use std::collections::BTreeMap;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::glb::{GlbFile, read_glb};
use super::image::{ImageInfo, sniff_image};
use super::{AssetLimits, Issue};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::project::path_differing_in_case;
use crate::source::{Fs, FsError, PathError, ProjectPath, Span};

/// Which built-in declared the asset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    /// `asset.glb(..)`.
    Glb,
    /// `asset.texture(..)`.
    Texture,
    /// `asset.linear_texture(..)`.
    LinearTexture,
}

/// The colour space an image is sampled in (`texture` is sRGB, `linear_texture` is linear).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageSpace {
    Srgb,
    Linear,
}

impl ImageSpace {
    /// The manifest's spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            ImageSpace::Srgb => "srgb",
            ImageSpace::Linear => "linear",
        }
    }
}

/// What a successful declaration stands for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssetHandle {
    /// A validated `.glb` at this project path.
    Glb { path: String },
    /// A standalone image at this project path, in a colour space.
    Image { path: String, space: ImageSpace },
}

/// What the checker needs from the asset machinery.
pub trait AssetHost {
    /// Declare the asset named by the string literal `path` of the module `from`, at `span`.
    /// Problems are reported to `sink`; `None` means the asset is unusable.
    fn declare(
        &mut self,
        from: &ProjectPath,
        kind: AssetKind,
        path: &str,
        span: Span,
        sink: &mut Diagnostics,
    ) -> Option<AssetHandle>;

    /// The validated GLB at `path` (a path from an [`AssetHandle::Glb`]).
    fn glb(&self, path: &str) -> Option<&GlbFile>;
}

/// A loaded file with the span of the first declaration that named it.
#[derive(Clone, Debug, PartialEq)]
pub struct DeclaredFile<T> {
    pub file: T,
    pub span: Span,
}

/// A standalone image file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageFile {
    pub path: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub info: ImageInfo,
}

/// Where an asset's bytes come from, for the build identity.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceKey {
    pub path: String,
    pub sha256: String,
}

/// Everything the loader found: the files of a project's asset declarations.
#[derive(Clone, Debug, Default)]
pub struct AssetStore {
    pub limits: AssetLimits,
    glbs: BTreeMap<String, DeclaredFile<GlbFile>>,
    images: BTreeMap<String, DeclaredFile<ImageFile>>,
}

impl AssetStore {
    /// The validated GLB at `path`.
    #[must_use]
    pub fn glb(&self, path: &str) -> Option<&DeclaredFile<GlbFile>> {
        self.glbs.get(path)
    }

    /// The standalone image at `path`.
    #[must_use]
    pub fn image(&self, path: &str) -> Option<&DeclaredFile<ImageFile>> {
        self.images.get(path)
    }

    /// Whether any asset was declared and loaded.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.glbs.is_empty() && self.images.is_empty()
    }
}

enum Slot<T> {
    Loaded(DeclaredFile<T>),
    Failed(Vec<Issue>),
}

/// The [`AssetHost`] of a build: reads through the compiler's file system.
pub struct AssetLoader<'f> {
    fs: &'f dyn Fs,
    limits: AssetLimits,
    glbs: BTreeMap<String, Slot<GlbFile>>,
    images: BTreeMap<String, Slot<ImageFile>>,
}

impl<'f> AssetLoader<'f> {
    #[must_use]
    pub fn new(fs: &'f dyn Fs, limits: AssetLimits) -> Self {
        Self {
            fs,
            limits,
            glbs: BTreeMap::new(),
            images: BTreeMap::new(),
        }
    }

    /// The files that loaded, without the failures.
    #[must_use]
    pub fn into_store(self) -> AssetStore {
        let mut store = AssetStore {
            limits: self.limits,
            ..AssetStore::default()
        };
        for (path, slot) in self.glbs {
            if let Slot::Loaded(file) = slot {
                store.glbs.insert(path, file);
            }
        }
        for (path, slot) in self.images {
            if let Slot::Loaded(file) = slot {
                store.images.insert(path, file);
            }
        }
        store
    }

    /// The project path a literal names, or the diagnostic that says why it does not.
    fn resolve(
        from: &ProjectPath,
        literal: &str,
        span: Span,
    ) -> Result<ProjectPath, Box<Diagnostic>> {
        if let Some(scheme) = url_scheme(literal) {
            return Err(Box::new(
                Diagnostic::new(
                    Code::E7901,
                    format!("The asset path \"{literal}\" is a {scheme}: URL; remote assets are not supported in v0.1."),
                )
                .at(span)
                .help("copy the file into the project and use a path relative to this file"),
            ));
        }
        let malformed = |reason: String| {
            Box::new(
                Diagnostic::new(
                    Code::E7021,
                    format!("The asset path \"{literal}\" is not valid: {reason}."),
                )
                .at(span)
                .note("an asset path is relative to the directory of the declaring file, uses `/`, and stays inside the project"),
            )
        };
        if literal.is_empty() {
            return Err(malformed("it is empty".into()));
        }
        if literal.contains('\\') {
            return Err(malformed("paths are separated by `/`, not by backslashes".into()));
        }
        if literal.starts_with('/') || literal.get(1..2) == Some(":") {
            return Err(malformed("absolute paths are not allowed".into()));
        }
        from.join_relative(literal).map_err(|error| match error {
            PathError::EscapesRoot => Box::new(
                Diagnostic::new(
                    Code::E7021,
                    format!("The asset path \"{literal}\" leaves the project root."),
                )
                .at(span)
                .note("an asset path is relative to the directory of the declaring file and stays inside the project"),
            ),
            other => malformed(other.to_string()),
        })
    }

    /// Check the file system for `path`; the bytes are read by the caller after the size check.
    fn locate(
        &self,
        literal: &str,
        path: &ProjectPath,
        span: Span,
    ) -> Result<u64, Box<Diagnostic>> {
        match self.fs.len(path) {
            Ok(length) => Ok(length),
            Err(FsError::NotFound(_) | FsError::NotADirectory(_)) => {
                if let Some(found) = path_differing_in_case(self.fs, path) {
                    return Err(Box::new(
                        Diagnostic::new(
                            Code::E7023,
                            format!("The asset path \"{literal}\" names '{path}', but the file is spelled '{found}'."),
                        )
                        .at(span)
                        .note("file names in asset paths must match the file system exactly, even where it ignores case, so that the project builds everywhere")
                        .help(format!("use the spelling '{found}'")),
                    ));
                }
                Err(Box::new(
                    Diagnostic::new(
                        Code::E7020,
                        format!("The asset file '{path}' was not found."),
                    )
                    .at(span)
                    .note("an asset path is relative to the directory of the declaring file"),
                ))
            }
            Err(FsError::IsADirectory(_)) => Err(Box::new(
                Diagnostic::new(
                    Code::E7020,
                    format!("The asset path \"{literal}\" names '{path}', which is a directory, not a file."),
                )
                .at(span),
            )),
            Err(FsError::Other { message, .. }) => Err(Box::new(
                Diagnostic::new(
                    Code::E7020,
                    format!("The asset file '{path}' could not be read: {message}."),
                )
                .at(span),
            )),
        }
    }

    fn too_large(&self, path: &ProjectPath, length: u64) -> Option<Issue> {
        (length > self.limits.max_file_bytes).then(|| {
            Issue::new(
                Code::E7002,
                format!(
                    "The asset file '{path}' is {length} bytes, over the limit of {} bytes.",
                    self.limits.max_file_bytes
                ),
            )
            .help("raise `max_file_bytes` in the `[assets]` table of mtek.toml, or reduce the file")
        })
    }

    fn load_glb(&self, path: &ProjectPath, span: Span) -> Slot<GlbFile> {
        let bytes = match self.fs.read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                return Slot::Failed(vec![Issue::new(
                    Code::E7020,
                    format!("The asset file '{path}' could not be read: {error}."),
                )]);
            }
        };
        match read_glb(path.as_str(), &bytes, &self.limits) {
            Ok(file) => Slot::Loaded(DeclaredFile { file, span }),
            Err(issues) => Slot::Failed(issues),
        }
    }

    fn load_image(&self, path: &ProjectPath, span: Span) -> Slot<ImageFile> {
        let bytes = match self.fs.read(path) {
            Ok(bytes) => bytes,
            Err(error) => {
                return Slot::Failed(vec![Issue::new(
                    Code::E7020,
                    format!("The asset file '{path}' could not be read: {error}."),
                )]);
            }
        };
        match sniff_image(&bytes, self.limits.max_texture_dimension) {
            Ok(info) => {
                let sha256 = Sha256::digest(&bytes)
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect();
                Slot::Loaded(DeclaredFile {
                    file: ImageFile {
                        path: path.as_str().to_owned(),
                        bytes,
                        sha256,
                        info,
                    },
                    span,
                })
            }
            Err(issue) => Slot::Failed(vec![Issue {
                message: format!("The image '{path}': {}", issue.message),
                ..issue
            }]),
        }
    }
}

/// `https` for `https://…`, `data` for `data:…`: the scheme of a URL-looking path. A single
/// letter before `:` is a drive letter, not a scheme.
fn url_scheme(literal: &str) -> Option<&str> {
    let (scheme, _) = literal.split_once(':')?;
    let valid = scheme.len() >= 2
        && scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some(scheme)
}

impl AssetHost for AssetLoader<'_> {
    fn declare(
        &mut self,
        from: &ProjectPath,
        kind: AssetKind,
        literal: &str,
        span: Span,
        sink: &mut Diagnostics,
    ) -> Option<AssetHandle> {
        let path = match Self::resolve(from, literal, span) {
            Ok(path) => path,
            Err(diagnostic) => {
                sink.push(*diagnostic);
                return None;
            }
        };
        let key = path.as_str().to_owned();
        let is_glb = kind == AssetKind::Glb;
        if is_glb {
            let extension = key.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if extension != "glb" {
                let what = if extension == "gltf" {
                    format!("'{path}' is a glTF JSON file")
                } else {
                    format!("'{path}' is not a `.glb` file")
                };
                sink.push(
                    Issue::new(
                        Code::E7001,
                        format!("{what}; the v0.1 profile reads binary `.glb` files only."),
                    )
                    .help("export the model as a single binary glTF (`.glb`) with its data and images embedded")
                    .at(span),
                );
                return None;
            }
        }
        let known = if is_glb {
            self.glbs.contains_key(&key)
        } else {
            self.images.contains_key(&key)
        };
        if !known {
            let length = match self.locate(literal, &path, span) {
                Ok(length) => length,
                Err(diagnostic) => {
                    sink.push(*diagnostic);
                    return None;
                }
            };
            let too_large = self.too_large(&path, length);
            if is_glb {
                let slot = match too_large {
                    Some(issue) => Slot::Failed(vec![issue]),
                    None => self.load_glb(&path, span),
                };
                self.glbs.insert(key.clone(), slot);
            } else {
                let slot = match too_large {
                    Some(issue) => Slot::Failed(vec![issue]),
                    None => self.load_image(&path, span),
                };
                self.images.insert(key.clone(), slot);
            }
        }
        let issues = if is_glb {
            match self.glbs.get(&key) {
                Some(Slot::Failed(issues)) => Some(issues),
                _ => None,
            }
        } else {
            match self.images.get(&key) {
                Some(Slot::Failed(issues)) => Some(issues),
                _ => None,
            }
        };
        if let Some(issues) = issues {
            for issue in issues {
                sink.push(issue.at(span));
            }
            return None;
        }
        Some(if is_glb {
            AssetHandle::Glb { path: key }
        } else {
            AssetHandle::Image {
                path: key,
                space: if kind == AssetKind::LinearTexture {
                    ImageSpace::Linear
                } else {
                    ImageSpace::Srgb
                },
            }
        })
    }

    fn glb(&self, path: &str) -> Option<&GlbFile> {
        match self.glbs.get(path) {
            Some(Slot::Loaded(declared)) => Some(&declared.file),
            _ => None,
        }
    }
}
