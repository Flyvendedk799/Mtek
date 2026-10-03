//! Loading a project: its configuration, the entry module's source and the
//! module graph.
//!
//! Lexing, parsing, `import` gating and scene selection are not part of
//! loading; they follow in M1-09. In M1 the module graph holds the entry
//! module only.

use std::sync::Arc;

use super::config::{PROJECT_FILE, ProjectConfig, constant_path};
use super::graph::ModuleGraph;
use super::parse::parse_config;
use super::root::ProjectRoot;
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::{FileId, Fs, FsError, ProjectPath, SourceMap};

/// A loaded project.
#[derive(Clone, Debug)]
pub struct Project {
    /// The validated `mtek.toml`.
    pub config: ProjectConfig,
    /// The text of `mtek.toml` exactly as stored (the build identifier of
    /// `spec/runtime-abi.md` section 5.3 hashes it).
    pub config_text: Arc<str>,
    /// Every source file of the project, the entry module first.
    pub sources: SourceMap,
    /// The modules and their imports (the entry module only in M1).
    pub modules: ModuleGraph,
}

impl Project {
    /// The file of the entry module.
    #[must_use]
    pub fn entry_file(&self) -> FileId {
        self.modules.entry().file()
    }

    /// Load the project at `root`: read and validate `mtek.toml`, then read
    /// the entry module into the source map.
    ///
    /// Returns `None` if the project cannot be loaded: the configuration is
    /// invalid (`E9001`) or missing (`E9004`), or the entry module cannot be
    /// read (`E9005`, or `E0001`, `E0002`, `E0004` for its text). A
    /// `[host.inputs]` table is kept in the configuration but reported as
    /// `E9010`, and loading continues, so the program's own errors are still
    /// found.
    pub fn load(root: &ProjectRoot, fs: &dyn Fs, diagnostics: &mut Diagnostics) -> Option<Project> {
        let view = root.view(fs);
        let (config, config_text) = load_config(&view, diagnostics)?;

        let entry = config.project.entry.clone();
        let bytes = match view.read(&entry) {
            Ok(bytes) => bytes,
            Err(error) => {
                diagnostics.push(entry_not_readable(&view, &entry, &error));
                return None;
            }
        };
        let mut sources = SourceMap::new();
        let file = match sources.add(entry.clone(), &bytes) {
            Ok(file) => file,
            Err(error) => {
                diagnostics.push(Diagnostic::from_source_error(&error));
                return None;
            }
        };
        Some(Project {
            config,
            config_text,
            sources,
            modules: ModuleGraph::new(entry, file),
        })
    }
}

/// Read and validate `mtek.toml`.
fn load_config(view: &dyn Fs, diagnostics: &mut Diagnostics) -> Option<(ProjectConfig, Arc<str>)> {
    let path = constant_path(PROJECT_FILE);
    let bytes = match view.read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let message = match error {
                FsError::NotFound(_) | FsError::NotADirectory(_) => {
                    format!("The project file {PROJECT_FILE} was not found.")
                }
                FsError::IsADirectory(_) => {
                    format!("The project file {PROJECT_FILE} is a directory, not a file.")
                }
                FsError::Other { .. } => format!("Could not read the project file: {error}."),
            };
            diagnostics.push(Diagnostic::new(Code::E9004, message));
            return None;
        }
    };
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => {
            diagnostics.push(Diagnostic::new(
                Code::E9001,
                format!(
                    "Invalid project configuration: {PROJECT_FILE} is not valid UTF-8 (invalid byte sequence at byte {}).",
                    error.utf8_error().valid_up_to()
                ),
            ));
            return None;
        }
    };
    let config = parse_config(&text, diagnostics)?;
    Some((config, Arc::from(text)))
}

/// The `E9005` diagnostic for an entry module that could not be read.
fn entry_not_readable(view: &dyn Fs, entry: &ProjectPath, error: &FsError) -> Diagnostic {
    let message = match error {
        FsError::NotFound(_) | FsError::NotADirectory(_) => {
            format!("Entry file '{entry}' not found.")
        }
        FsError::IsADirectory(_) => format!("Entry '{entry}' is a directory, not a file."),
        FsError::Other { .. } => format!("Could not read entry file '{entry}': {error}."),
    };
    let mut diagnostic = Diagnostic::new(Code::E9005, message);
    if matches!(error, FsError::NotFound(_) | FsError::NotADirectory(_))
        && let Some(found) = path_differing_in_case(view, entry)
    {
        diagnostic = diagnostic.help(format!(
            "'{found}' exists; file names are case-sensitive, so use that spelling in project.entry"
        ));
    }
    diagnostic.help("create the file or set project.entry in mtek.toml to the entry module")
}

/// The existing path that `wanted` differs from only in letter case, if
/// there is one. Segments are matched one directory at a time; when several
/// entries of a directory match, the first in sorted order is taken, so the
/// answer does not depend on directory enumeration order.
fn path_differing_in_case(fs: &dyn Fs, wanted: &ProjectPath) -> Option<ProjectPath> {
    let mut found = ProjectPath::root();
    for segment in wanted.segments() {
        let mut names = fs.list_dir(&found).ok()?;
        names.sort();
        let lowered = segment.to_lowercase();
        let name = names
            .iter()
            .find(|name| name.as_str() == segment)
            .or_else(|| names.iter().find(|name| name.to_lowercase() == lowered))?;
        found = found.join(&ProjectPath::new(name).ok()?);
    }
    (found != *wanted).then_some(found)
}

#[cfg(test)]
mod tests;
