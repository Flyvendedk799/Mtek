//! Integration tests of `mtek test` (`spec/tooling.md` section 6, decision 0074) that run the real
//! `mtek` binary on projects in temporary directories.
//!
//! The browser is not needed: `MTEK_TEST_RUNNER` points the command at a stand-in runner (a few
//! lines of JavaScript) that reads the plan the CLI wrote and writes a report chosen by the test.
//! That exercises everything of the command that is not the browser: the fixture files, the build
//! in test mode, the plan, how a report is merged, the exit codes, the text and the JSON. The real
//! runner and the real browser are covered by `tests/browser/specs/m6/mtek-test.spec.ts` (hardware)
//! and `tests/browser/support/mtek-test/*.test.ts` (logic). The stand-in needs a Node.js, which every
//! checkout of this repository has; tests that need a successful build are
//! `#[cfg(mtek_runtime_embedded)]` like those of `cli.rs`.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

const SCHEMA: &str = include_str!("../../../spec/test-report.schema.json");

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";
const VALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n}\n";
/// One error: `E2003`.
const INVALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Boks {}; }\n}\n";

/// A fixture that asserts something, named so that the stand-in runner knows what to report.
fn fixture(name: &str) -> String {
    format!(
        "name = \"{name}\"\nseed = 7\nsteps = [\n  {{ step = 2, dt = 0.5 }},\n  {{ expect_counter = {{ drawCalls = {{ min = 1 }} }} }},\n]\n"
    )
}

/// The stand-in runner. By default a fixture whose name contains `fails` fails, one whose name
/// contains `skips` is NOT-RUN and every other one passes. `FAKE_RUNNER_MODE` overrides that:
/// `crash` (exit 1, no report), `garbage` (a report that is not JSON), `forget` (no result for
/// the last fixture), `no-gpu` (everything NOT-RUN with an environment that has no adapter).
const FAKE_RUNNER: &str = r#"
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [planPath, reportPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (process.env.FAKE_RUNNER_PLAN_COPY) {
  const index = plan.root + "/index.html";
  writeFileSync(process.env.FAKE_RUNNER_PLAN_COPY, JSON.stringify({
    plan,
    indexExists: existsSync(index),
    mountDefined: existsSync(index) && readFileSync(index, "utf8").includes("__mtekMount"),
  }));
}
const mode = process.env.FAKE_RUNNER_MODE ?? "";
if (mode === "crash") { console.error("simulated crash of the runner"); process.exit(1); }
if (mode === "garbage") { writeFileSync(reportPath, "{ not json"); process.exit(0); }
const adapter = { vendor: "test", architecture: "", device: "Test GPU", description: "", isFallbackAdapter: false };
const browser = { name: "chromium", channel: "chromium", version: "1.0", headless: true, launchArgs: [] };
const environment = mode === "no-gpu"
  ? { browser, gpu: { available: false, reason: "navigator.gpu is undefined", adapter: null } }
  : { browser, gpu: { available: true, reason: null, adapter } };
let fixtures = plan.fixtures.map((f) => {
  const base = { file: f.file, reason: null, failure: null, stepsRun: f.steps.length, durationMs: 12 };
  if (mode === "no-gpu") return { ...base, status: "not-run", reason: "no WebGPU adapter: navigator.gpu is undefined", stepsRun: 0 };
  if (f.name.includes("fails")) return { ...base, status: "fail", stepsRun: 1,
    failure: { kind: "expect_counter", step: 2, line: 5, message: "counter 'drawCalls' is 0, expected at least 1" } };
  if (f.name.includes("skips")) return { ...base, status: "not-run", reason: "no WebGPU adapter: simulated", stepsRun: 0 };
  return { ...base, status: "pass" };
});
if (mode === "forget") fixtures = fixtures.slice(0, -1);
writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, environment, fixtures }));
"#;

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir =
            std::env::temp_dir().join(format!("mtek-cli-test-cmd-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.path(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// A project in `proj` with `main` as its entry and one fixture file per name.
    fn project(&self, main: &str, fixtures: &[&str]) -> PathBuf {
        self.write("proj/mtek.toml", TOML);
        self.write("proj/src/main.mtek", main);
        for name in fixtures {
            self.write(
                &format!("proj/tests/{}.test.toml", name.replace(' ', "-")),
                &fixture(name),
            );
        }
        self.path("proj")
    }

    fn runner(&self) -> PathBuf {
        let path = self.path("fake-runner.mjs");
        fs::write(&path, FAKE_RUNNER).unwrap();
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// `mtek test args…` with the stand-in runner and `env` set.
fn run_test(scratch: &Scratch, args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mtek"));
    command
        .arg("test")
        .args(args)
        .current_dir(&scratch.0)
        .env_remove("NO_COLOR")
        .env_remove("MTEK_NODE")
        .env("MTEK_TEST_RUNNER", scratch.runner())
        .env_remove("FAKE_RUNNER_MODE")
        .env_remove("FAKE_RUNNER_PLAN_COPY");
    for (key, value) in env {
        command.env(key, value);
    }
    command.output().unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8(out.stderr.clone()).unwrap()
}

fn code(out: &Output) -> i32 {
    out.status.code().unwrap()
}

/// The report of `--format json`: exactly one document on stdout, nothing on stderr, valid
/// against `spec/test-report.schema.json` and without the scratch directory in it.
fn report_of(out: &Output, scratch: &Scratch) -> Value {
    assert!(stderr(out).is_empty(), "stderr: {}", stderr(out));
    let text = stdout(out);
    let report: Value = serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("stdout is not one JSON document ({e}):\n{text}"));
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let validator = jsonschema::draft202012::new(&schema).unwrap();
    let problems: Vec<String> = validator
        .iter_errors(&report)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}\n{report:#}");
    for form in [
        scratch.0.display().to_string(),
        scratch.0.display().to_string().replace('\\', "/"),
    ] {
        assert!(
            !text.contains(&form),
            "absolute path in the report:\n{text}"
        );
    }
    assert_eq!(
        report["exitCode"].as_i64(),
        Some(i64::from(code(out))),
        "the report names the exit code"
    );
    report
}

fn statuses(report: &Value) -> Vec<String> {
    report["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["status"].as_str().unwrap().to_owned())
        .collect()
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

// ---- usage and what needs no build ------------------------------------------------------------

#[test]
fn mtek_test_is_in_the_help_and_takes_its_options() {
    let out = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(["test", "--help"])
        .output()
        .unwrap();
    assert_eq!(code(&out), 0);
    let help = stdout(&out);
    assert!(
        help.contains("--allow-not-run") && help.contains("--format"),
        "{help}"
    );
    let out = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(["--help"])
        .output()
        .unwrap();
    assert!(stdout(&out).contains("test"), "{}", stdout(&out));
    let out = Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(["test", "--nope"])
        .output()
        .unwrap();
    assert_eq!(code(&out), 2);
}

#[test]
fn a_project_without_fixtures_is_not_a_pass() {
    let scratch = Scratch::new("none");
    scratch.project(VALID, &[]);
    for allow in [false, true] {
        let mut args = vec!["--format", "json", "proj"];
        if allow {
            args.push("--allow-not-run");
        }
        let out = run_test(&scratch, &args, &[]);
        assert_eq!(code(&out), 1, "even with --allow-not-run");
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "fail");
        assert!(report["error"].as_str().unwrap().starts_with("no fixtures"));
        assert!(report["build"].is_null() && report["fixtures"].as_array().unwrap().is_empty());
    }
    let out = run_test(&scratch, &["proj"], &[]);
    assert_eq!(code(&out), 1);
    assert!(
        stderr(&out).contains("error: no fixtures"),
        "{}",
        stderr(&out)
    );
    assert!(
        stdout(&out).contains("0 fixtures: 0 passed, 0 failed, 0 not run"),
        "{}",
        stdout(&out)
    );
    // Files that are not `*.test.toml` in `tests/` do not count as fixtures.
    scratch.write("proj/tests/notes.toml", "name = \"x\"\n");
    scratch.write("proj/tests/README.md", "text\n");
    assert_eq!(code(&run_test(&scratch, &["proj"], &[])), 1);
}

#[test]
fn a_directory_without_a_project_is_reported() {
    let scratch = Scratch::new("noproject");
    scratch.write("empty/.keep", "");
    let out = run_test(&scratch, &["--format", "json", "empty"], &[]);
    assert_eq!(code(&out), 1);
    let report = report_of(&out, &scratch);
    assert_eq!(report["status"], "fail");
    assert!(report["project"].is_null());
    assert!(report["error"].as_str().unwrap().contains("mtek.toml"));
    assert_eq!(report["build"]["ok"], false);
    assert_eq!(report["build"]["diagnostics"][0]["code"], "MTEK-E9004");
    let out = run_test(&scratch, &["empty"], &[]);
    assert_eq!(code(&out), 1);
    assert!(stderr(&out).contains("E9004"), "{}", stderr(&out));
}

#[test]
fn an_invalid_fixture_fails_with_its_problems_and_the_others_still_count() {
    let scratch = Scratch::new("invalid");
    scratch.project(VALID, &["good"]);
    scratch.write(
        "proj/tests/bad.test.toml",
        "name = \"bad\"\nsteps = [\n  { step = 0, dt = 0.1 },\n  { press = \"Hyper\" },\n]\n",
    );
    let out = run_test(&scratch, &["--format", "json", "proj"], &[]);
    assert_eq!(code(&out), 1);
    let report = report_of(&out, &scratch);
    let bad = &report["fixtures"][0];
    assert_eq!(bad["file"], "tests/bad.test.toml");
    assert_eq!(bad["name"], "bad");
    assert_eq!(bad["status"], "fail");
    assert_eq!(bad["failure"]["kind"], "invalid-fixture");
    let details: Vec<&str> = bad["failure"]["details"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_str().unwrap())
        .collect();
    assert_eq!(details.len(), 2, "{details:?}");
    assert!(details[0].starts_with("line 3:"), "{details:?}");
    assert!(details[1].starts_with("line 4:"), "{details:?}");
    // The valid fixture is never sent to the browser in a state of doubt: it ran (or, without a
    // successful build, failed for the build), but the report names both.
    assert_eq!(report["fixtures"][1]["file"], "tests/good.test.toml");
    let human = run_test(&scratch, &["proj"], &[]);
    assert!(
        stdout(&human).contains("  FAIL    bad  (tests/bad.test.toml"),
        "{}",
        stdout(&human)
    );
    assert!(
        stdout(&human).contains("line 4: step 2 (press): 'Hyper'"),
        "{}",
        stdout(&human)
    );
}

#[cfg(not(mtek_runtime_embedded))]
#[test]
fn without_the_embedded_runtime_the_build_fails_and_so_does_every_fixture() {
    let scratch = Scratch::new("e9030");
    scratch.project(VALID, &["one"]);
    let out = run_test(&scratch, &["--format", "json", "proj"], &[]);
    assert_eq!(code(&out), 1);
    let report = report_of(&out, &scratch);
    assert_eq!(report["build"]["ok"], false);
    assert_eq!(report["build"]["diagnostics"][0]["code"], "MTEK-E9030");
    assert_eq!(report["fixtures"][0]["status"], "fail");
    assert_eq!(report["fixtures"][0]["failure"]["kind"], "build");
}

// ---- with the stand-in runner (needs the embedded runtime for the test build) ---------------------

#[cfg(mtek_runtime_embedded)]
mod with_a_build {
    use super::*;

    #[test]
    fn every_fixture_passing_is_exit_0_and_the_runner_gets_the_test_build() {
        let scratch = Scratch::new("pass");
        let project = scratch.project(VALID, &["alpha", "beta"]);
        let copy = scratch.path("plan-copy.json");
        let out = run_test(
            &scratch,
            &["--format", "json", "proj"],
            &[("FAKE_RUNNER_PLAN_COPY", copy.to_str().unwrap())],
        );
        assert_eq!(code(&out), 0, "{}", stderr(&out));
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "pass");
        assert_eq!(report["project"], "demo");
        assert_eq!(report["allowNotRun"], false);
        assert!(report["error"].is_null());
        assert_eq!(
            report["summary"],
            serde_json::json!({ "total": 2, "passed": 2, "failed": 0, "notRun": 0 })
        );
        assert_eq!(report["build"]["ok"], true);
        assert_eq!(report["build"]["mode"], "test");
        assert_eq!(report["build"]["buildId"].as_str().unwrap().len(), 64);
        assert_eq!(
            report["environment"]["gpu"]["adapter"]["device"],
            "Test GPU"
        );
        let files: Vec<&str> = report["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["file"].as_str().unwrap())
            .collect();
        assert_eq!(files, ["tests/alpha.test.toml", "tests/beta.test.toml"]);
        assert_eq!(report["fixtures"][0]["name"], "alpha");
        assert_eq!(report["fixtures"][0]["seed"], 7);
        assert_eq!(report["fixtures"][0]["stepsTotal"], 2);
        assert_eq!(report["fixtures"][0]["stepsRun"], 2);

        // What the runner was given: a test-mode build outside the project, the fixed target, the
        // fixtures as data with explicit tolerances.
        let seen: Value = serde_json::from_str(&fs::read_to_string(copy).unwrap()).unwrap();
        assert_eq!(seen["indexExists"], true);
        assert_eq!(seen["mountDefined"], true, "test mode: __mtekMount");
        let plan = &seen["plan"];
        assert_eq!(plan["schemaVersion"], 1);
        assert_eq!(
            plan["renderTarget"],
            serde_json::json!({ "width": 128, "height": 128 })
        );
        assert_eq!(
            plan["fixtures"][0]["steps"][0],
            serde_json::json!({ "kind": "step", "frames": 2, "dt": 0.5, "line": 4 })
        );
        assert_eq!(
            plan["fixtures"][0]["steps"][1],
            serde_json::json!({
                "kind": "expect_counter", "line": 5,
                "entries": [{ "name": "drawCalls", "equals": null, "min": 1, "max": null }]
            })
        );
        assert!(
            !Path::new(plan["root"].as_str().unwrap()).exists(),
            "the scratch build is removed afterwards"
        );
        // The project is left as it was: no dist and no other output.
        assert_eq!(names(&project), ["mtek.toml", "src", "tests"]);
    }

    #[test]
    fn the_human_text_lists_each_fixture_and_the_adapter() {
        let scratch = Scratch::new("human");
        scratch.project(VALID, &["alpha"]);
        let out = run_test(&scratch, &["proj"], &[]);
        assert_eq!(code(&out), 0, "{}", stderr(&out));
        let text = stdout(&out);
        assert!(text.starts_with("mtek test: demo\n"), "{text}");
        assert!(
            text.contains("adapter: test Test GPU (hardware adapter)\n"),
            "{text}"
        );
        assert!(
            text.contains("  PASS    alpha  (tests/alpha.test.toml, 0.0 s)\n"),
            "{text}"
        );
        assert!(
            text.ends_with("1 fixture: 1 passed, 0 failed, 0 not run\n"),
            "{text}"
        );
        assert_eq!(stderr(&out), "");
    }

    #[test]
    fn a_failed_fixture_is_exit_1_and_shows_step_line_and_message() {
        let scratch = Scratch::new("fail");
        scratch.project(VALID, &["alpha", "beta fails"]);
        let out = run_test(&scratch, &["proj"], &[]);
        assert_eq!(code(&out), 1);
        let text = stdout(&out);
        assert!(text.contains("  PASS    alpha"), "{text}");
        assert!(text.contains("  FAIL    beta fails"), "{text}");
        assert!(
            text.contains(
                "step 2 (line 5), expect_counter: counter 'drawCalls' is 0, expected at least 1"
            ),
            "{text}"
        );
        assert!(
            text.ends_with("2 fixtures: 1 passed, 1 failed, 0 not run\n"),
            "{text}"
        );
        assert!(
            stderr(&out).contains("mtek test failed: 1 of 2 fixtures failed"),
            "{}",
            stderr(&out)
        );
        let out = run_test(&scratch, &["--format", "json", "proj"], &[]);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "fail");
        assert_eq!(report["fixtures"][1]["failure"]["step"], 2);
        assert_eq!(report["fixtures"][1]["failure"]["line"], 5);
        assert_eq!(report["fixtures"][1]["stepsRun"], 1);
    }

    #[test]
    fn not_run_is_reported_and_exit_1_unless_allowed() {
        let scratch = Scratch::new("notrun");
        scratch.project(VALID, &["alpha", "beta skips"]);

        let out = run_test(&scratch, &["--format", "json", "proj"], &[]);
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "not-run");
        assert_eq!(statuses(&report), ["pass", "not-run"]);
        assert_eq!(
            report["fixtures"][1]["reason"],
            "no WebGPU adapter: simulated"
        );
        assert!(report["fixtures"][1]["failure"].is_null());
        assert_eq!(report["summary"]["notRun"], 1);

        let out = run_test(&scratch, &["proj"], &[]);
        assert_eq!(code(&out), 1);
        assert!(
            stdout(&out).contains("  NOT-RUN beta skips"),
            "{}",
            stdout(&out)
        );
        assert!(
            stderr(&out).contains("1 fixture NOT-RUN, which is not a pass"),
            "{}",
            stderr(&out)
        );

        let out = run_test(
            &scratch,
            &["--allow-not-run", "--format", "json", "proj"],
            &[],
        );
        assert_eq!(code(&out), 0);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "not-run", "allowed, but still not a pass");
        assert_eq!(report["allowNotRun"], true);
        assert_eq!(statuses(&report), ["pass", "not-run"]);

        let out = run_test(&scratch, &["--allow-not-run", "proj"], &[]);
        assert_eq!(code(&out), 0);
        assert!(
            stdout(&out).contains("  NOT-RUN beta skips"),
            "{}",
            stdout(&out)
        );
        assert!(
            stderr(&out)
                .contains("NOT-RUN (allowed by --allow-not-run); nothing was verified for it"),
            "{}",
            stderr(&out)
        );
    }

    #[test]
    fn allowing_not_run_never_hides_a_failure() {
        let scratch = Scratch::new("failandskip");
        scratch.project(VALID, &["a fails", "b skips"]);
        let out = run_test(
            &scratch,
            &["--allow-not-run", "--format", "json", "proj"],
            &[],
        );
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "fail");
        assert_eq!(statuses(&report), ["fail", "not-run"]);
    }

    #[test]
    fn a_machine_without_a_gpu_reports_every_fixture_not_run_with_the_reason() {
        let scratch = Scratch::new("nogpu");
        scratch.project(VALID, &["a", "b"]);
        let out = run_test(
            &scratch,
            &["--format", "json", "proj"],
            &[("FAKE_RUNNER_MODE", "no-gpu")],
        );
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(statuses(&report), ["not-run", "not-run"]);
        assert_eq!(report["environment"]["gpu"]["available"], false);
        assert!(report["environment"]["gpu"]["adapter"].is_null());
        let out = run_test(
            &scratch,
            &["--allow-not-run", "proj"],
            &[("FAKE_RUNNER_MODE", "no-gpu")],
        );
        assert_eq!(code(&out), 0);
        assert!(
            stdout(&out).contains("adapter: none (navigator.gpu is undefined)"),
            "{}",
            stdout(&out)
        );
        assert!(
            stdout(&out).ends_with("2 fixtures: 0 passed, 0 failed, 2 not run\n"),
            "{}",
            stdout(&out)
        );
    }

    #[test]
    fn a_missing_node_or_runner_is_not_run_with_the_reason() {
        let scratch = Scratch::new("nonode");
        scratch.project(VALID, &["a"]);
        let out = run_test(
            &scratch,
            &["--format", "json", "proj"],
            &[("MTEK_NODE", "mtek-no-such-node")],
        );
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "not-run");
        assert!(report["environment"].is_null());
        let reason = report["fixtures"][0]["reason"].as_str().unwrap();
        assert!(reason.contains("Node.js was not found"), "{reason}");
        let out = run_test(
            &scratch,
            &["--allow-not-run", "proj"],
            &[("MTEK_NODE", "mtek-no-such-node")],
        );
        assert_eq!(code(&out), 0);

        let out = run_test(
            &scratch,
            &["--format", "json", "proj"],
            &[(
                "MTEK_TEST_RUNNER",
                scratch.path("missing.mjs").to_str().unwrap(),
            )],
        );
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "not-run");
        assert!(
            report["fixtures"][0]["reason"]
                .as_str()
                .unwrap()
                .contains("does not exist")
        );
    }

    #[test]
    fn a_runner_that_crashes_is_an_internal_error_not_a_result() {
        let scratch = Scratch::new("crash");
        scratch.project(VALID, &["a"]);
        let out = run_test(&scratch, &["proj"], &[("FAKE_RUNNER_MODE", "crash")]);
        assert_eq!(code(&out), 3);
        assert!(
            stderr(&out).contains("simulated crash of the runner"),
            "{}",
            stderr(&out)
        );
        assert!(
            stderr(&out).contains("ended without a report"),
            "{}",
            stderr(&out)
        );
        // `--allow-not-run` does not turn a broken tool into success.
        let out = run_test(
            &scratch,
            &["--allow-not-run", "--format", "json", "proj"],
            &[("FAKE_RUNNER_MODE", "crash")],
        );
        assert_eq!(code(&out), 3);
        let text = stdout(&out);
        let report: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(report["status"], "fail");
        assert_eq!(report["exitCode"], 3);
        assert!(
            report["error"]
                .as_str()
                .unwrap()
                .contains("ended without a report")
        );
    }

    #[test]
    fn a_report_that_does_not_make_sense_is_an_internal_error() {
        let scratch = Scratch::new("garbage");
        scratch.project(VALID, &["a", "b"]);
        let out = run_test(&scratch, &["proj"], &[("FAKE_RUNNER_MODE", "garbage")]);
        assert_eq!(code(&out), 3);
        assert!(stderr(&out).contains("malformed"), "{}", stderr(&out));
        let out = run_test(&scratch, &["proj"], &[("FAKE_RUNNER_MODE", "forget")]);
        assert_eq!(code(&out), 3);
        assert!(
            stderr(&out).contains("has no result for 'tests/b.test.toml'"),
            "{}",
            stderr(&out)
        );
    }

    #[test]
    fn a_project_that_does_not_build_fails_every_fixture_without_running_the_browser() {
        let scratch = Scratch::new("broken");
        scratch.project(INVALID, &["a", "b"]);
        let copy = scratch.path("plan-copy.json");
        let env = [("FAKE_RUNNER_PLAN_COPY", copy.to_str().unwrap())];
        let out = run_test(
            &scratch,
            &["--format", "json", "--allow-not-run", "proj"],
            &env,
        );
        assert_eq!(code(&out), 1);
        let report = report_of(&out, &scratch);
        assert_eq!(report["status"], "fail");
        assert_eq!(report["build"]["ok"], false);
        assert_eq!(report["build"]["errors"], 1);
        assert_eq!(report["build"]["diagnostics"][0]["code"], "MTEK-E2003");
        assert_eq!(statuses(&report), ["fail", "fail"]);
        assert_eq!(report["fixtures"][0]["failure"]["kind"], "build");
        assert!(report["environment"].is_null());
        assert!(!copy.exists(), "the runner was not started");
        let out = run_test(&scratch, &["proj"], &env);
        assert_eq!(code(&out), 1);
        assert!(stderr(&out).contains("E2003"), "{}", stderr(&out));
        assert!(
            stdout(&out).contains("  FAIL    a  (tests/a.test.toml"),
            "{}",
            stdout(&out)
        );
    }

    #[test]
    fn the_project_is_found_from_a_directory_inside_it() {
        let scratch = Scratch::new("inside");
        scratch.project(VALID, &["a"]);
        let out = run_test(&scratch, &["proj/src"], &[]);
        assert_eq!(code(&out), 0, "{}", stderr(&out));
        assert!(stdout(&out).contains("PASS    a"), "{}", stdout(&out));
    }
}
