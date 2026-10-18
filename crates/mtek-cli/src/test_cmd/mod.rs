//! `mtek test`: run the declarative fixtures of a project in a real browser
//! (`spec/tooling.md` section 6, decision 0074).
//!
//! The command reads `tests/*.test.toml` ([`fixture`]), builds the project in `test` mode into a
//! scratch directory, and hands the fixtures to the browser runner ([`runner`]), which drives the
//! test build through Playwright. The result is a [`report::Report`], printed as text or as the
//! JSON document of `spec/test-report.schema.json`.
//!
//! Exit codes: `0` every fixture passed (or, with `--allow-not-run`, every fixture that could run
//! did and the others are reported as NOT-RUN), `1` a fixture failed, the project does not build,
//! a fixture file is invalid, there are no fixtures, or a fixture was NOT-RUN and that was not
//! allowed, `2` bad arguments, `3` an internal error or an I/O failure (including a browser
//! runner that crashed). NOT-RUN is never a pass.

mod fixture;
mod report;
mod runner;

use std::path::{Path, PathBuf};

use clap::Args;
use mtek_compiler::BuildMode;
use mtek_compiler::diagnostics::{
    Diagnostics, RenderOptions, Report as Diagnosed, render_report, to_pretty_string, to_report,
};
use mtek_compiler::source::SourceMap;
use serde_json::Value;

use crate::args::Format;
use crate::commands::{
    Context, EXIT_INTERNAL, Located, Outcome, compile_and_write, counts, exit_code, locate_project,
};
use crate::real_fs::RealFs;
use fixture::{Fixture, Invalid};
use report::{Build, Entry, Report, Status};

/// The arguments of `mtek test`.
#[derive(Args, Debug, PartialEq, Eq)]
pub struct TestArgs {
    /// Exit 0 although some fixtures were NOT-RUN (no Node, Playwright, browser or WebGPU adapter);
    /// they are still reported as NOT-RUN, never as passed
    #[arg(long)]
    pub allow_not_run: bool,
    /// Output format
    #[arg(long, value_enum, default_value_t)]
    pub format: Format,
    /// The project directory or a directory inside it [default: the current directory]
    pub path: Option<PathBuf>,
}

/// A scratch directory for the test build, the plan and the runner's report; removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> std::io::Result<Scratch> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.subsec_nanos());
        let dir = std::env::temp_dir().join(format!("mtek-test-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        Ok(Scratch(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // A scratch directory that cannot be removed is the operating system's to clean up.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The `diagnostics` array of the report of `spec/diagnostics.md` section 2.2.
fn diagnostics_json(report: &Diagnosed, project: Option<&str>, sources: &SourceMap) -> Value {
    serde_json::from_str::<Value>(&to_pretty_string(&to_report(report, project, sources)))
        .map_or(Value::Null, |document| document["diagnostics"].clone())
}

/// Run `mtek test`.
pub fn run(args: &TestArgs, context: &Context) -> Outcome {
    let mut run = Run {
        report: Report {
            project: None,
            allow_not_run: args.allow_not_run,
            error: None,
            build: None,
            environment: None,
            fixtures: Vec::new(),
            internal: false,
        },
        diagnostics: String::new(),
    };
    run.execute(args, context);
    run.finish(args.format)
}

/// A run in progress: the report, and the build's diagnostics as text for stderr.
struct Run {
    report: Report,
    diagnostics: String,
}

impl Run {
    fn execute(&mut self, args: &TestArgs, context: &Context) {
        let dir = match locate_project(&context.cwd, args.path.as_deref()) {
            Ok(dir) => dir,
            Err(diagnostic) => {
                self.report.error = Some(diagnostic.message.clone());
                let mut sink = Diagnostics::new();
                sink.push(*diagnostic);
                self.add_build_diagnostics(context, &sink.finish(), None, &SourceMap::new());
                return;
            }
        };
        let found = match fixture::discover(&dir) {
            Ok(found) => found,
            Err(message) => {
                self.report.error = Some(message);
                return;
            }
        };
        if found.is_empty() {
            self.report.error = Some(format!(
                "no fixtures: the project has no {}/*{}; a project with nothing to run has verified nothing",
                fixture::DIRECTORY,
                fixture::SUFFIX
            ));
            return;
        }
        let read: Vec<Result<Fixture, Invalid>> = found
            .iter()
            .map(|(file, path)| fixture::read(file, path))
            .collect();

        let scratch = match Scratch::new() {
            Ok(scratch) => scratch,
            Err(error) => {
                self.internal(format!("cannot create a scratch directory: {error}"));
                return;
            }
        };
        let dist = scratch.0.join("dist");
        let fs = RealFs::new(&dir);
        let project = Located { dir: &dir, fs: &fs };
        let written = compile_and_write(context, &project, BuildMode::Test, Some(&dist));
        let failed = written.written.is_none();
        self.report.project.clone_from(&written.name);
        self.add_build_diagnostics(
            context,
            &written.report,
            written.name.as_deref(),
            &written.sources,
        );
        if let Some(build) = &mut self.report.build {
            build.ok = !failed;
            build.id = written.written.as_ref().map(|(id, _)| id.clone());
        }
        if failed {
            if exit_code(&written.report) == EXIT_INTERNAL {
                self.report.internal = true;
                self.report.error = Some(
                    "the test build could not be completed (an internal error or an output failure)"
                        .to_owned(),
                );
            }
            let message = format!(
                "the project does not build: {}",
                counts(&written.report.summary)
            );
            self.fixtures_without_a_run(&read, &message);
            return;
        }
        self.run_fixtures(&read, &dist, &scratch.0);
    }

    /// A project that does not build has no fixture that passes: the invalid fixtures fail for
    /// their problems, the others for the build (`message`).
    fn fixtures_without_a_run(&mut self, read: &[Result<Fixture, Invalid>], message: &str) {
        for item in read {
            self.report.fixtures.push(match item {
                Ok(fixture) => Entry::failed(&fixture.file, &fixture.name, "build", message, &[]),
                Err(invalid) => invalid_entry(invalid),
            });
        }
    }

    /// Keep the diagnostics of a build (or of a project that could not be found) as the report's
    /// JSON and as text for stderr.
    fn add_build_diagnostics(
        &mut self,
        context: &Context,
        report: &Diagnosed,
        project: Option<&str>,
        sources: &SourceMap,
    ) {
        self.report.build = Some(Build {
            ok: report.summary.errors == 0,
            id: None,
            errors: report.summary.errors,
            warnings: report.summary.warnings,
            diagnostics: diagnostics_json(report, project, sources),
        });
        self.diagnostics = render_report(
            report,
            sources,
            RenderOptions {
                color: context.color,
            },
        );
    }

    fn internal(&mut self, message: String) {
        self.report.internal = true;
        self.report.error = Some(message);
    }

    /// Hand the valid fixtures to the browser runner and merge its results with the invalid ones.
    fn run_fixtures(&mut self, read: &[Result<Fixture, Invalid>], dist: &Path, scratch: &Path) {
        let valid: Vec<&Fixture> = read.iter().filter_map(|item| item.as_ref().ok()).collect();
        let mut results = None;
        let mut not_run_reason = None;
        if valid.is_empty() {
            // Nothing for the browser to do.
        } else {
            match runner::locate() {
                Err(reason) => not_run_reason = Some(reason),
                Ok(found) => {
                    let plan = serde_json::json!({
                        "schemaVersion": report::SCHEMA_VERSION,
                        "root": dist.to_string_lossy(),
                        "renderTarget": { "width": fixture::RENDER_TARGET, "height": fixture::RENDER_TARGET },
                        "fixtures": valid.iter().map(|fixture| fixture.to_json()).collect::<Vec<_>>(),
                    });
                    match runner::run(&found, &plan, scratch) {
                        Ok(report) => {
                            self.report.environment = report.environment.clone();
                            results = Some(report.results);
                        }
                        Err(message) => {
                            self.internal(message);
                            return;
                        }
                    }
                }
            }
        }
        for item in read {
            let entry = match item {
                Err(invalid) => invalid_entry(invalid),
                Ok(fixture) => match (&results, &not_run_reason) {
                    (Some(results), _) => match results.iter().find(|r| r.file == fixture.file) {
                        Some(result) => entry_of(fixture, result),
                        None => {
                            self.internal(format!(
                                "the browser runner's report has no result for '{}'",
                                fixture.file
                            ));
                            return;
                        }
                    },
                    (None, Some(reason)) => Entry::not_run(
                        &fixture.file,
                        &fixture.name,
                        fixture.seed,
                        fixture.steps.len(),
                        reason,
                    ),
                    (None, None) => continue,
                },
            };
            self.report.fixtures.push(entry);
        }
    }

    fn finish(self, format: Format) -> Outcome {
        let Run {
            report,
            diagnostics,
        } = self;
        let code = report.exit_code();
        match format {
            Format::Json => Outcome {
                stdout: format!(
                    "{}\n",
                    serde_json::to_string_pretty(&report.to_json()).unwrap_or_default()
                ),
                stderr: String::new(),
                code,
            },
            Format::Human => {
                let mut stderr = diagnostics;
                stderr.push_str(&verdict(&report));
                Outcome {
                    stdout: report.to_human(),
                    stderr,
                    code,
                }
            }
        }
    }
}

fn invalid_entry(invalid: &Invalid) -> Entry {
    Entry::failed(
        &invalid.file,
        &invalid.name,
        "invalid-fixture",
        &format!(
            "the fixture file is not valid ({} problem{})",
            invalid.problems.len(),
            if invalid.problems.len() == 1 { "" } else { "s" }
        ),
        &invalid.problems,
    )
}

fn entry_of(fixture: &Fixture, result: &runner::FixtureResult) -> Entry {
    let status = match result.status.as_str() {
        "pass" => Status::Pass,
        "fail" => Status::Fail,
        _ => Status::NotRun,
    };
    Entry {
        file: fixture.file.clone(),
        name: fixture.name.clone(),
        seed: fixture.seed,
        steps_total: fixture.steps.len(),
        status,
        reason: result.reason.clone(),
        failure: result.failure.clone(),
        steps_run: result.steps_run,
        duration_ms: result.duration_ms,
    }
}

/// What goes to stderr after the report in the human format: why the exit code is not 0.
fn verdict(report: &Report) -> String {
    let counts = report.counts();
    let plural = |n: usize| if n == 1 { "fixture" } else { "fixtures" };
    let mut text = String::new();
    if let Some(error) = &report.error {
        text.push_str(&format!("error: {error}\n"));
    }
    if counts.failed > 0 {
        text.push_str(&format!(
            "mtek test failed: {} of {} {} failed\n",
            counts.failed,
            report.fixtures.len(),
            plural(report.fixtures.len())
        ));
    }
    if counts.not_run > 0 {
        if report.allow_not_run {
            text.push_str(&format!(
                "note: {} {} NOT-RUN (allowed by --allow-not-run); nothing was verified for {}\n",
                counts.not_run,
                plural(counts.not_run),
                if counts.not_run == 1 { "it" } else { "them" }
            ));
        } else {
            text.push_str(&format!(
                "error: {} {} NOT-RUN, which is not a pass; run where a browser with WebGPU is available, or pass --allow-not-run to accept it\n",
                counts.not_run,
                plural(counts.not_run)
            ));
        }
    }
    text
}
