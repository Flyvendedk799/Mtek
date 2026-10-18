//! `mtek context --entry FILE [--symbol NAME…] [--max-bytes N] --format json`
//! (`spec/tooling.md` section 1, `spec/ai-and-benchmarks.md` section 2, decision 0072).
//!
//! The compiler library does the work ([`mtek_compiler::context::context`]); this module finds
//! the project, turns `--entry` into the path the project knows, and maps the library's errors
//! to the CLI's conventions:
//!
//! * success: the document on stdout, exit code 0, nothing on stderr;
//! * the project cannot be loaded (`E9001`, `E9004`, `E9005`, …): the diagnostics of
//!   `spec/diagnostics.md` section 2.2 as the one JSON document on stdout, exit code 1;
//! * `--entry` is not the project's entry module, a `--symbol` names nothing, `--max-bytes`
//!   is too small: a message on stderr, exit code 2, nothing on stdout.

use std::path::Path;

use mtek_compiler::context::{ContextError, ContextOptions, context};
use mtek_compiler::diagnostics::{to_pretty_string, to_report};
use mtek_compiler::project::ProjectRoot;

use crate::args::Format;
use crate::commands::{Context, EXIT_USAGE, Outcome, absolute, exit_code, locate_project, single};
use crate::real_fs::RealFs;

/// Run `mtek context`.
pub fn run(entry: &Path, symbols: &[String], max_bytes: usize, env: &Context) -> Outcome {
    let dir = match locate_project(&env.cwd, Some(entry)) {
        Ok(dir) => dir,
        Err(diagnostic) => return single("context", Format::Json, env.color, *diagnostic),
    };
    let Some(entry) = relative_entry(&dir, &absolute(&env.cwd, entry)) else {
        return usage(format!(
            "'--entry {}' is not inside the project at '{}'",
            entry.display(),
            dir.display()
        ));
    };
    let options = ContextOptions {
        entry: Some(entry),
        symbols: symbols.to_vec(),
        max_bytes,
    };
    match context(&ProjectRoot::at_base(), &RealFs::new(&dir), &options) {
        Ok(output) => Outcome::stdout(output.text),
        Err(ContextError::Project(failed)) => {
            let report = to_report(
                &failed.report,
                failed.project_name.as_deref(),
                &failed.sources,
            );
            Outcome {
                stdout: format!("{}\n", to_pretty_string(&report)),
                stderr: String::new(),
                code: exit_code(&failed.report),
            }
        }
        Err(error) => usage(error.to_string()),
    }
}

/// `entry` below `dir`, with `/` separators, as the project spells module paths.
fn relative_entry(dir: &Path, entry: &Path) -> Option<String> {
    let relative = entry.strip_prefix(dir).ok()?;
    let parts: Vec<&str> = relative
        .components()
        .map(|component| component.as_os_str().to_str())
        .collect::<Option<_>>()?;
    Some(parts.join("/"))
}

fn usage(message: String) -> Outcome {
    Outcome {
        stdout: String::new(),
        stderr: format!("error: {message}\n"),
        code: EXIT_USAGE,
    }
}
