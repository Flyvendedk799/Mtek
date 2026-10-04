//! `build`: the library side of `mtek build` (`spec/compiler-architecture.md` section 4.12,
//! `spec/runtime-abi.md` section 2).
//!
//! `build(project, fs, options)` runs the front end, lowers the program to the typed IR and
//! packages it ([`crate::package::package`]). It performs no I/O: the result is the complete
//! `dist/` file set in memory (`BTreeMap<String, Vec<u8>>`, sorted by path), plus the build id
//! and output directory the command line tool needs to write it with replace-on-success
//! ([`crate::package::replace`]). Files exist only when the report has no error.
//!
//! The runtime bundle and its declarations come from the caller
//! ([`CompileOptions::runtime_bundle`], [`CompileOptions::runtime_declarations`]): the CLI
//! embeds the real ones; compiler tests and codegen goldens pass the fixed stubs
//! [`STUB_RUNTIME_BUNDLE`] and [`STUB_RUNTIME_DECLARATIONS`], so goldens never change when the
//! runtime is edited. A build without either fails with `E9030`.

use std::collections::BTreeMap;
use std::sync::Arc;

use crate::check::front_end;
use crate::diagnostics::{Code, Diagnostic, Diagnostics, Report};
use crate::ir::{self, LowerError};
use crate::package::{PackageInput, package};
use crate::project::ProjectRoot;
use crate::source::{Fs, ProjectPath, SourceMap};

/// The runtime bundle of compiler tests (`spec/compiler-architecture.md` section 4.12).
pub const STUB_RUNTIME_BUNDLE: &[u8] = b"// mtek test runtime stub\n";

/// The runtime declarations that accompany [`STUB_RUNTIME_BUNDLE`] in compiler tests.
pub const STUB_RUNTIME_DECLARATIONS: &[u8] = b"// mtek test runtime declarations stub\n";

/// The target profile (`spec/runtime-abi.md` section 5): v0.1 has exactly one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TargetProfile {
    /// `webgpu-core-2026`: exactly the WebGPU default limits, no optional features.
    #[default]
    WebGpuCore2026,
}

impl TargetProfile {
    /// The manifest's spelling.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            TargetProfile::WebGpuCore2026 => "webgpu-core-2026",
        }
    }
}

/// The build modes of `spec/tooling.md` section 2.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BuildMode {
    /// The default of `mtek build`.
    #[default]
    Release,
    /// `mtek dev`: the page carries the reload client.
    Dev,
    /// Browser tests: the page defines `window.__mtekMount(options)` instead of mounting.
    Test,
    /// Untrusted previews (M6); not implemented by this build (`E9010`).
    Preview,
}

/// Options of [`build`].
#[derive(Clone, Debug, Default)]
pub struct CompileOptions {
    pub profile: TargetProfile,
    pub mode: BuildMode,
    /// The runtime bundle written as `runtime.<h16>.js`.
    pub runtime_bundle: Option<Arc<[u8]>>,
    /// `runtime.d.ts`, written next to `app.d.ts`.
    pub runtime_declarations: Option<Arc<[u8]>>,
}

impl CompileOptions {
    /// Options for `mode` with the test stubs as runtime bundle and declarations.
    #[must_use]
    pub fn with_stub_runtime(mode: BuildMode) -> Self {
        Self {
            profile: TargetProfile::WebGpuCore2026,
            mode,
            runtime_bundle: Some(Arc::from(STUB_RUNTIME_BUNDLE)),
            runtime_declarations: Some(Arc::from(STUB_RUNTIME_DECLARATIONS)),
        }
    }
}

/// What [`build`] produced.
#[derive(Debug)]
pub struct BuildResult {
    /// The project name from `mtek.toml`; `None` if the project could not be loaded.
    pub project_name: Option<String>,
    /// The build's source files (the project's sources plus the prelude modules the program
    /// uses, decision 0044), to render diagnostics with.
    pub sources: SourceMap,
    /// Every diagnostic, in report order.
    pub report: Report,
    /// The `dist/` file set, keyed by `/`-separated path relative to `dist/`; empty when the
    /// report has an error.
    pub files: BTreeMap<String, Vec<u8>>,
    /// The manifest's `buildId`; `None` without files.
    pub build_id: Option<String>,
    /// `build.out_dir` of `mtek.toml`, relative to the project root; `None` if the project
    /// could not be loaded.
    pub out_dir: Option<ProjectPath>,
}

impl BuildResult {
    /// Whether the report has an error (no files are produced then).
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.report.summary.errors > 0
    }
}

/// Build the project at `root`. Never panics; problems are diagnostics.
#[must_use]
pub fn build(root: &ProjectRoot, fs: &dyn Fs, options: &CompileOptions) -> BuildResult {
    let mut sink = Diagnostics::new();
    let front = front_end(root, fs, &mut sink);
    let missing: Vec<&str> = [
        ("the runtime bundle", options.runtime_bundle.is_none()),
        ("runtime.d.ts", options.runtime_declarations.is_none()),
    ]
    .into_iter()
    .filter_map(|(what, absent)| absent.then_some(what))
    .collect();
    if !missing.is_empty() {
        sink.push(
            Diagnostic::new(
                Code::E9030,
                format!(
                    "Cannot build: {} {} not available to the compiler.",
                    missing.join(" and "),
                    if missing.len() == 1 { "is" } else { "are" }
                ),
            )
            .help("build the runtime first (`npm run build`), then rebuild the mtek command line tool"),
        );
    }

    let mut packaged = None;
    let sources = front
        .project
        .as_ref()
        .map_or_else(SourceMap::new, |project| project.sources.clone());
    if !sink.has_errors()
        && let (Some(project), Some(bundle), Some(declarations)) = (
            front.project.as_ref(),
            options.runtime_bundle.as_deref(),
            options.runtime_declarations.as_deref(),
        )
    {
        match ir::lower_parts(
            front.project.as_ref(),
            front.module.as_ref(),
            front.resolution.as_ref(),
            front.types.as_ref(),
            &front.dependencies,
            &front.effects,
        ) {
            Ok(program) => {
                let input = PackageInput {
                    profile: options.profile,
                    mode: options.mode,
                    runtime_bundle: bundle,
                    runtime_declarations: declarations,
                };
                match package(project, &program, &input) {
                    Ok(result) => packaged = Some(result),
                    Err(diagnostics) => sink.extend(diagnostics),
                }
            }
            Err(LowerError::Internal(defect)) => sink.push(
                Diagnostic::new(
                    Code::E9999,
                    "The typed IR could not be built from the checked program; this is a compiler bug.",
                )
                .note(defect)
                .help("please report it with the program that caused it"),
            ),
            Err(LowerError::HasErrors) => {}
        }
    }

    let (project_name, out_dir) = match front.project {
        Some(project) => (
            Some(project.config.project.name),
            Some(project.config.build.out_dir),
        ),
        None => (None, None),
    };
    let report = sink.finish();
    match packaged {
        Some(result) if report.summary.errors == 0 => BuildResult {
            project_name,
            sources,
            report,
            files: result.files,
            build_id: Some(result.build_id),
            out_dir,
        },
        _ => BuildResult {
            project_name,
            sources,
            report,
            files: BTreeMap::new(),
            build_id: None,
            out_dir,
        },
    }
}
