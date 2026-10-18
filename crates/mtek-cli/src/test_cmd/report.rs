//! The report of `mtek test`: its meaning (status, exit code), the JSON document of
//! `spec/test-report.schema.json` and the human text (decision 0074).

use serde_json::{Map, Value, json};

use crate::commands::{EXIT_ERRORS, EXIT_INTERNAL, EXIT_OK};

/// The `schemaVersion` of the JSON report.
pub const SCHEMA_VERSION: u32 = 1;

/// The outcome of a fixture or of the whole run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Every step ran and every expectation held.
    Pass,
    /// An expectation did not hold, a step failed, or the fixture or the build is invalid.
    Fail,
    /// It could not run here (no Node, no Playwright, no browser, no WebGPU adapter). Not a pass.
    NotRun,
}

impl Status {
    /// The spelling in the JSON report.
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Pass => "pass",
            Status::Fail => "fail",
            Status::NotRun => "not-run",
        }
    }

    /// The word of the human report.
    fn label(self) -> &'static str {
        match self {
            Status::Pass => "PASS",
            Status::Fail => "FAIL",
            Status::NotRun => "NOT-RUN",
        }
    }
}

/// One fixture of the report.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    /// The path relative to the project, `/` as the separator.
    pub file: String,
    pub name: String,
    pub seed: u32,
    pub steps_total: usize,
    pub status: Status,
    /// Why it is NOT-RUN.
    pub reason: Option<String>,
    /// What failed: `kind`, `message` and, where they apply, `step`, `line`, `details`,
    /// `expected` and `actual`.
    pub failure: Option<Value>,
    pub steps_run: u64,
    pub duration_ms: u64,
}

impl Entry {
    /// A fixture that failed before any step ran.
    pub fn failed(file: &str, name: &str, kind: &str, message: &str, details: &[String]) -> Entry {
        let mut failure = json!({ "kind": kind, "message": message });
        if !details.is_empty() {
            failure["details"] = json!(details);
        }
        Entry {
            file: file.to_owned(),
            name: name.to_owned(),
            seed: 0,
            steps_total: 0,
            status: Status::Fail,
            reason: None,
            failure: Some(failure),
            steps_run: 0,
            duration_ms: 0,
        }
    }

    /// A valid fixture that could not run.
    pub fn not_run(file: &str, name: &str, seed: u32, steps_total: usize, reason: &str) -> Entry {
        Entry {
            file: file.to_owned(),
            name: name.to_owned(),
            seed,
            steps_total,
            status: Status::NotRun,
            reason: Some(reason.to_owned()),
            failure: None,
            steps_run: 0,
            duration_ms: 0,
        }
    }
}

/// The build in test mode.
#[derive(Clone, Debug, PartialEq)]
pub struct Build {
    pub ok: bool,
    /// The 64-digit build id of the output.
    pub id: Option<String>,
    pub errors: usize,
    pub warnings: usize,
    /// The `diagnostics` of the report of `spec/diagnostics.md` section 2.2.
    pub diagnostics: Value,
}

/// Everything `mtek test` found out.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub project: Option<String>,
    pub allow_not_run: bool,
    /// A problem that belongs to no fixture (no fixtures at all, a directory that cannot be
    /// listed).
    pub error: Option<String>,
    pub build: Option<Build>,
    /// The browser and the adapter, from the runner.
    pub environment: Option<Value>,
    pub fixtures: Vec<Entry>,
    /// The tool itself failed (the runner crashed, a scratch directory could not be made): exit
    /// code 3 and a failed status, whatever the fixtures say.
    pub internal: bool,
}

/// How many fixtures ended each way.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub passed: usize,
    pub failed: usize,
    pub not_run: usize,
}

impl Report {
    pub fn counts(&self) -> Counts {
        let mut counts = Counts::default();
        for fixture in &self.fixtures {
            match fixture.status {
                Status::Pass => counts.passed += 1,
                Status::Fail => counts.failed += 1,
                Status::NotRun => counts.not_run += 1,
            }
        }
        counts
    }

    /// `fail` if anything failed or the run has an error, else `not-run` if anything could not
    /// run, else `pass`. A run without fixtures is never a pass.
    pub fn status(&self) -> Status {
        let counts = self.counts();
        if counts.failed > 0 || self.error.is_some() || self.internal || self.fixtures.is_empty() {
            Status::Fail
        } else if counts.not_run > 0 {
            Status::NotRun
        } else {
            Status::Pass
        }
    }

    /// 0 unless the status is `fail`, or it is `not-run` and that is not allowed (1), or the tool
    /// itself failed (3).
    pub fn exit_code(&self) -> u8 {
        if self.internal {
            return EXIT_INTERNAL;
        }
        match self.status() {
            Status::Pass => EXIT_OK,
            Status::NotRun if self.allow_not_run => EXIT_OK,
            Status::NotRun | Status::Fail => EXIT_ERRORS,
        }
    }

    /// The document of `spec/test-report.schema.json`.
    pub fn to_json(&self) -> Value {
        let counts = self.counts();
        let fixtures: Vec<Value> = self
            .fixtures
            .iter()
            .map(|fixture| {
                json!({
                    "file": fixture.file,
                    "name": fixture.name,
                    "status": fixture.status.as_str(),
                    "reason": fixture.reason,
                    "failure": fixture.failure,
                    "seed": fixture.seed,
                    "stepsRun": fixture.steps_run,
                    "stepsTotal": fixture.steps_total,
                    "durationMs": fixture.duration_ms,
                })
            })
            .collect();
        let build = self.build.as_ref().map_or(Value::Null, |build| {
            json!({
                "ok": build.ok,
                "mode": "test",
                "buildId": build.id,
                "errors": build.errors,
                "warnings": build.warnings,
                "diagnostics": build.diagnostics,
            })
        });
        let mut document = Map::new();
        document.insert("schemaVersion".to_owned(), json!(SCHEMA_VERSION));
        document.insert("command".to_owned(), json!("mtek test"));
        document.insert("project".to_owned(), json!(self.project));
        document.insert("status".to_owned(), json!(self.status().as_str()));
        document.insert("exitCode".to_owned(), json!(self.exit_code()));
        document.insert("allowNotRun".to_owned(), json!(self.allow_not_run));
        document.insert("error".to_owned(), json!(self.error));
        document.insert(
            "summary".to_owned(),
            json!({
                "total": self.fixtures.len(),
                "passed": counts.passed,
                "failed": counts.failed,
                "notRun": counts.not_run,
            }),
        );
        document.insert("build".to_owned(), build);
        document.insert(
            "environment".to_owned(),
            self.environment.clone().unwrap_or(Value::Null),
        );
        document.insert("fixtures".to_owned(), Value::Array(fixtures));
        Value::Object(document)
    }

    /// The result of the run as text: one block per fixture and a summary line. (The build's
    /// diagnostics and the reasons that make the exit code 1 are the caller's, on stderr.)
    pub fn to_human(&self) -> String {
        let mut out = String::new();
        if let Some(project) = &self.project {
            out.push_str(&format!("mtek test: {project}\n"));
        }
        if let Some(adapter) = self.adapter_line() {
            out.push_str(&format!("{adapter}\n"));
        }
        for fixture in &self.fixtures {
            let seconds = format!("{:.1} s", fixture.duration_ms as f64 / 1000.0);
            out.push_str(&format!(
                "  {:<8}{}  ({}, {seconds})\n",
                fixture.status.label(),
                fixture.name,
                fixture.file
            ));
            if let Some(reason) = &fixture.reason {
                out.push_str(&format!("          {reason}\n"));
            }
            if let Some(failure) = &fixture.failure {
                for line in failure_lines(failure) {
                    out.push_str(&format!("          {line}\n"));
                }
            }
        }
        let counts = self.counts();
        out.push_str(&format!(
            "{} fixture{}: {} passed, {} failed, {} not run\n",
            self.fixtures.len(),
            if self.fixtures.len() == 1 { "" } else { "s" },
            counts.passed,
            counts.failed,
            counts.not_run
        ));
        out
    }

    /// `adapter: NVIDIA ... (hardware)`, or why there is none.
    fn adapter_line(&self) -> Option<String> {
        let gpu = &self.environment.as_ref()?["gpu"];
        match gpu["adapter"].as_object() {
            Some(adapter) => {
                let text = |key: &str| adapter.get(key).and_then(Value::as_str).unwrap_or("");
                let description = [text("vendor"), text("device"), text("description")]
                    .iter()
                    .filter(|part| !part.is_empty())
                    .copied()
                    .collect::<Vec<_>>()
                    .join(" ");
                let kind = if adapter.get("isFallbackAdapter") == Some(&Value::Bool(true)) {
                    "software fallback adapter"
                } else {
                    "hardware adapter"
                };
                Some(format!(
                    "adapter: {} ({kind})",
                    if description.is_empty() {
                        "unnamed"
                    } else {
                        &description
                    }
                ))
            }
            None => Some(format!(
                "adapter: none ({})",
                gpu["reason"].as_str().unwrap_or("no reason given")
            )),
        }
    }
}

/// The lines that describe a failure.
fn failure_lines(failure: &Value) -> Vec<String> {
    let mut lines = Vec::new();
    let mut head = String::new();
    if let Some(step) = failure["step"].as_u64() {
        head.push_str(&format!("step {step}"));
        if let Some(line) = failure["line"].as_u64() {
            head.push_str(&format!(" (line {line})"));
        }
        if let Some(kind) = failure["kind"].as_str() {
            head.push_str(&format!(", {kind}"));
        }
        head.push_str(": ");
    }
    head.push_str(failure["message"].as_str().unwrap_or("failed"));
    lines.push(head);
    if let Some(details) = failure["details"].as_array() {
        lines.extend(
            details
                .iter()
                .filter_map(Value::as_str)
                .map(|line| format!("  {line}")),
        );
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(status: Status) -> Entry {
        let mut entry = Entry::not_run("tests/a.test.toml", "a", 0, 3, "reason");
        entry.status = status;
        match status {
            Status::Pass => entry.reason = None,
            Status::Fail => {
                entry.reason = None;
                entry.failure = Some(json!({ "kind": "expect_pixel", "message": "wrong" }));
            }
            Status::NotRun => {}
        }
        entry
    }

    fn report(statuses: &[Status], allow_not_run: bool) -> Report {
        Report {
            project: Some("demo".to_owned()),
            allow_not_run,
            error: None,
            build: None,
            environment: None,
            fixtures: statuses.iter().copied().map(entry).collect(),
            internal: false,
        }
    }

    #[test]
    fn status_and_exit_code() {
        use Status::{Fail, NotRun, Pass};
        for (statuses, allow, status, code) in [
            (&[Pass, Pass][..], false, Pass, 0),
            (&[Pass, Fail], false, Fail, 1),
            (&[Pass, Fail], true, Fail, 1),
            (&[Pass, NotRun], false, NotRun, 1),
            (&[Pass, NotRun], true, NotRun, 0),
            (&[NotRun, NotRun], true, NotRun, 0),
            (&[Fail, NotRun], true, Fail, 1),
            // Nothing ran, nothing was verified: never a pass.
            (&[], false, Fail, 1),
            (&[], true, Fail, 1),
        ] {
            let report = report(statuses, allow);
            assert_eq!(
                (report.status(), report.exit_code()),
                (status, code),
                "{statuses:?} allow={allow}"
            );
        }
        let mut errored = report(&[Status::Pass], false);
        errored.error = Some("x".to_owned());
        assert_eq!((errored.status(), errored.exit_code()), (Status::Fail, 1));
        let mut broken = report(&[Status::Pass], true);
        broken.internal = true;
        assert_eq!((broken.status(), broken.exit_code()), (Status::Fail, 3));
    }

    #[test]
    fn the_json_names_every_count() {
        let json = report(&[Status::Pass, Status::Fail, Status::NotRun], true).to_json();
        assert_eq!(json["status"], "fail");
        assert_eq!(json["exitCode"], 1);
        assert_eq!(json["allowNotRun"], true);
        assert_eq!(
            json["summary"],
            json!({ "total": 3, "passed": 1, "failed": 1, "notRun": 1 })
        );
        assert_eq!(json["fixtures"][2]["status"], "not-run");
        assert_eq!(json["fixtures"][2]["reason"], "reason");
        assert_eq!(json["fixtures"][1]["failure"]["kind"], "expect_pixel");
        assert!(json["build"].is_null() && json["environment"].is_null());
    }

    #[test]
    fn the_human_text_separates_pass_fail_and_not_run() {
        let text = report(&[Status::Pass, Status::Fail, Status::NotRun], false).to_human();
        assert!(text.starts_with("mtek test: demo\n"), "{text}");
        assert!(
            text.contains("  PASS    a  (tests/a.test.toml, 0.0 s)\n"),
            "{text}"
        );
        assert!(text.contains("  FAIL    a"), "{text}");
        assert!(text.contains("          wrong\n"), "{text}");
        assert!(text.contains("  NOT-RUN a"), "{text}");
        assert!(text.contains("          reason\n"), "{text}");
        assert!(
            text.ends_with("3 fixtures: 1 passed, 1 failed, 1 not run\n"),
            "{text}"
        );
    }

    #[test]
    fn failure_lines_show_step_line_and_details() {
        let failure = json!({
            "kind": "expect_pixel", "step": 7, "line": 12, "message": "wrong colour",
            "details": ["a", "b"]
        });
        assert_eq!(
            failure_lines(&failure),
            ["step 7 (line 12), expect_pixel: wrong colour", "  a", "  b"]
        );
        assert_eq!(
            failure_lines(&json!({ "kind": "build", "message": "does not build" })),
            ["does not build"]
        );
    }

    #[test]
    fn the_adapter_line_says_hardware_software_or_none() {
        let mut report = report(&[Status::Pass], false);
        assert_eq!(report.adapter_line(), None);
        report.environment = Some(
            json!({ "gpu": { "available": true, "reason": null, "adapter": {
            "vendor": "nvidia", "device": "RTX", "description": "", "isFallbackAdapter": false } } }),
        );
        assert_eq!(
            report.adapter_line().as_deref(),
            Some("adapter: nvidia RTX (hardware adapter)")
        );
        report.environment = Some(
            json!({ "gpu": { "available": true, "reason": null, "adapter": {
            "vendor": "google", "device": "", "description": "", "isFallbackAdapter": true } } }),
        );
        assert_eq!(
            report.adapter_line().as_deref(),
            Some("adapter: google (software fallback adapter)")
        );
        report.environment = Some(
            json!({ "gpu": { "available": false, "reason": "requestAdapter resolved to null", "adapter": null } }),
        );
        assert_eq!(
            report.adapter_line().as_deref(),
            Some("adapter: none (requestAdapter resolved to null)")
        );
    }
}
