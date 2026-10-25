//! Finding and running the browser runner of `mtek test` (decision 0074).
//!
//! The runner is a Node program (`tests/browser/support/mtek-test/main.ts`) that serves the test
//! build, opens it in Chromium through Playwright, drives each fixture and writes one JSON report.
//! This module finds Node and the runner, hands over the plan and reads the report back. Whatever
//! is missing is a reason (`Err(String)`) that becomes NOT-RUN for every fixture: a machine
//! without Node or Playwright cannot have passed anything, and it is never reported as a pass.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// The environment variable naming the Node executable [default: `node` from `PATH`].
pub const NODE_VARIABLE: &str = "MTEK_NODE";
/// The environment variable naming the runner script [default: found from the executable].
pub const RUNNER_VARIABLE: &str = "MTEK_TEST_RUNNER";
/// The runner, relative to the repository root.
const RUNNER_PATH: [&str; 4] = ["tests", "browser", "support", "mtek-test"];
const RUNNER_FILE: &str = "main.ts";
/// Versions with default type stripping (backported on the Node 22 release line).
const NODE_REQUIREMENT: &str = "22.18+ on Node 22, 23.6+ on Node 23, or Node 24+";
type NodeVersion = (u32, u32, u32);

/// Node and the runner script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Runner {
    pub node: OsString,
    pub script: PathBuf,
}

/// Find Node and the runner, or say why not.
///
/// # Errors
/// The reason the fixtures cannot run: Node is missing or too old, or the runner script is not
/// where it should be.
pub fn locate() -> Result<Runner, String> {
    locate_with(
        std::env::var_os(NODE_VARIABLE),
        std::env::var_os(RUNNER_VARIABLE),
        std::env::current_exe().ok().as_deref(),
    )
}

fn locate_with(
    node: Option<OsString>,
    script: Option<OsString>,
    exe: Option<&Path>,
) -> Result<Runner, String> {
    let node = node.unwrap_or_else(|| OsString::from("node"));
    let (version, parsed) = node_version(&node)?;
    let script = locate_script(script, exe)?;
    // Node strips types by default from 22.18, 23.6 and 24 onward; a
    // JavaScript runner (a stand-in set with `MTEK_TEST_RUNNER`) runs on any Node.
    if script
        .extension()
        .is_some_and(|extension| extension == "ts")
        && !strips_types(parsed)
    {
        return Err(format!(
            "Node.js {NODE_REQUIREMENT} is required to run the browser runner, found {version}"
        ));
    }
    Ok(Runner { node, script })
}

/// The runner script: the one named by `script`, else the one of the checkout `exe` is in.
fn locate_script(script: Option<OsString>, exe: Option<&Path>) -> Result<PathBuf, String> {
    match script {
        Some(path) => {
            let path = PathBuf::from(path);
            if path.is_file() {
                Ok(path)
            } else {
                // The reason goes into the machine-readable report, which never carries absolute
                // paths (decision 0074): name the file, not where it was looked for.
                let name = path.file_name().map_or_else(
                    || path.display().to_string(),
                    |name| name.to_string_lossy().into_owned(),
                );
                Err(format!(
                    "the runner '{name}' named by {RUNNER_VARIABLE} does not exist"
                ))
            }
        }
        None => exe.and_then(find_beside).ok_or_else(|| {
            format!(
                "the browser runner (tests/browser/support/mtek-test/{RUNNER_FILE}) was not found above the mtek executable; run mtek from a checkout of the repository or set {RUNNER_VARIABLE}"
            )
        }),
    }
}

/// The runner of the repository that `exe` (`target/debug/mtek`) was built in: the nearest
/// ancestor directory that contains it.
fn find_beside(exe: &Path) -> Option<PathBuf> {
    exe.ancestors().skip(1).find_map(|dir| {
        let script = RUNNER_PATH
            .iter()
            .fold(dir.to_path_buf(), |path, part| path.join(part))
            .join(RUNNER_FILE);
        script.is_file().then_some(script)
    })
}

/// The version text and parsed release version of `node`, if it runs.
fn node_version(node: &OsString) -> Result<(String, NodeVersion), String> {
    let output = match Command::new(node).arg("--version").output() {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return Err(format!(
                "'{} --version' failed ({})",
                node.to_string_lossy(),
                output.status
            ));
        }
        Err(error) => {
            return Err(format!(
                "Node.js was not found ('{}': {error}); install Node.js {NODE_REQUIREMENT} or set {NODE_VARIABLE}",
                node.to_string_lossy()
            ));
        }
    };
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    match node_parts(&version) {
        Some(parsed) => Ok((version, parsed)),
        None => Err(format!("cannot read the Node.js version '{version}'")),
    }
}

fn node_parts(version: &str) -> Option<NodeVersion> {
    let mut parts = version.strip_prefix('v')?.split('.');
    let result = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(result)
}

fn strips_types(version: NodeVersion) -> bool {
    matches!(version, (22, 18.., _) | (23, 6.., _) | (24.., _, _))
}

/// What the runner reported about one fixture.
#[derive(Clone, Debug, PartialEq)]
pub struct FixtureResult {
    pub file: String,
    /// `pass`, `fail` or `not-run`.
    pub status: String,
    pub reason: Option<String>,
    pub failure: Option<Value>,
    pub steps_run: u64,
    pub duration_ms: u64,
}

/// The runner's report.
#[derive(Clone, Debug, PartialEq)]
pub struct RunnerReport {
    /// The browser and the adapter, when the runner got that far.
    pub environment: Option<Value>,
    pub results: Vec<FixtureResult>,
}

/// Run the runner on `plan` (written to `dir/plan.json`) and read `dir/report.json`.
///
/// # Errors
/// The runner crashed, or wrote no report or one that does not have the documented shape: a
/// defect of the tool, not a result of the fixtures.
pub fn run(runner: &Runner, plan: &Value, dir: &Path) -> Result<RunnerReport, String> {
    let plan_path = dir.join("plan.json");
    let report_path = dir.join("report.json");
    std::fs::write(&plan_path, plan.to_string())
        .map_err(|error| format!("cannot write '{}': {error}", plan_path.display()))?;
    let output = Command::new(&runner.node)
        .arg(&runner.script)
        .arg(&plan_path)
        .arg(&report_path)
        .output()
        .map_err(|error| format!("cannot start '{}': {error}", runner.node.to_string_lossy()))?;
    let text = std::fs::read_to_string(&report_path).map_err(|_| {
        format!(
            "the browser runner ({}) ended without a report: {}\n{}",
            output.status,
            runner.script.display(),
            tail(&String::from_utf8_lossy(&output.stderr))
        )
    })?;
    if !output.status.success() {
        return Err(format!(
            "the browser runner ({}) failed after writing its report\n{}",
            output.status,
            tail(&String::from_utf8_lossy(&output.stderr))
        ));
    }
    read_report(&text)
}

/// The last lines of `text`.
fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(20)..].join("\n")
}

/// Read the runner's report (`tests/browser/support/mtek-test/plan.ts`, `RunnerReport`).
pub fn read_report(text: &str) -> Result<RunnerReport, String> {
    let bad = |what: &str| format!("the browser runner's report is malformed: {what}");
    let report: Value = serde_json::from_str(text).map_err(|error| bad(&error.to_string()))?;
    if report["schemaVersion"] != 1 {
        return Err(bad("schemaVersion is not 1"));
    }
    let environment = match &report["environment"] {
        Value::Null => None,
        environment @ Value::Object(_) => Some(environment.clone()),
        _ => return Err(bad("environment is neither null nor an object")),
    };
    let Some(fixtures) = report["fixtures"].as_array() else {
        return Err(bad("fixtures is not an array"));
    };
    let mut results = Vec::new();
    for fixture in fixtures {
        let text = |key: &str| fixture[key].as_str().map(str::to_owned);
        let (Some(file), Some(status)) = (text("file"), text("status")) else {
            return Err(bad("a fixture has no file or status"));
        };
        if !["pass", "fail", "not-run"].contains(&status.as_str()) {
            return Err(bad(&format!("'{status}' is not a status")));
        }
        let reason = text("reason");
        let failure = match &fixture["failure"] {
            Value::Null => None,
            failure @ Value::Object(_) => Some(failure.clone()),
            _ => return Err(bad("failure is neither null nor an object")),
        };
        if status != "pass" && reason.is_none() && failure.is_none() {
            return Err(bad(&format!("{file}: {status} without a reason")));
        }
        results.push(FixtureResult {
            file,
            status,
            reason,
            failure,
            steps_run: fixture["stepsRun"].as_u64().unwrap_or(0),
            duration_ms: fixture["durationMs"].as_u64().unwrap_or(0),
        });
    }
    Ok(RunnerReport {
        environment,
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn node_versions() {
        assert_eq!(node_parts("v24.9.0"), Some((24, 9, 0)));
        for version in ["24.0.0", "vx", "", "v22.18", "v24.0.0.1"] {
            assert_eq!(node_parts(version), None);
        }
        for version in ["v22.18.0", "v22.23.2", "v23.6.0", "v24.0.0", "v26.0.0"] {
            assert!(strips_types(node_parts(version).unwrap()), "{version}");
        }
        for version in ["v8.0.0", "v22.17.9", "v23.0.0", "v23.5.9"] {
            assert!(!strips_types(node_parts(version).unwrap()), "{version}");
        }
    }

    #[test]
    fn a_missing_node_is_a_reason() {
        let reason = locate_with(Some("mtek-no-such-node-binary".into()), None, None).unwrap_err();
        assert!(reason.contains("Node.js was not found"), "{reason}");
        assert!(reason.contains(NODE_VARIABLE), "{reason}");
    }

    #[test]
    fn a_missing_runner_is_a_reason() {
        let reason = locate_script(Some("definitely/not/here.ts".into()), None).unwrap_err();
        assert!(reason.contains("does not exist"), "{reason}");
        let reason =
            locate_script(None, Some(Path::new("/nowhere/target/debug/mtek"))).unwrap_err();
        assert!(reason.contains(RUNNER_VARIABLE), "{reason}");
        assert!(locate_script(None, None).is_err());
    }

    #[test]
    fn the_runner_is_found_above_the_executable() {
        let exe = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/mtek");
        let script = find_beside(&exe).unwrap();
        assert!(
            script.ends_with("tests/browser/support/mtek-test/main.ts"),
            "{script:?}"
        );
    }

    fn fixture(status: &str) -> Value {
        json!({ "file": "tests/a.test.toml", "status": status, "reason": null, "failure": null,
                "stepsRun": 3, "durationMs": 12 })
    }

    fn report(fixtures: &[Value]) -> String {
        json!({ "schemaVersion": 1, "environment": null, "fixtures": fixtures }).to_string()
    }

    #[test]
    fn a_report_is_read() {
        let mut failed = fixture("fail");
        failed["failure"] = json!({ "kind": "expect_pixel", "message": "no" });
        let mut not_run = fixture("not-run");
        not_run["reason"] = json!("no WebGPU adapter");
        let read = read_report(&report(&[fixture("pass"), failed, not_run])).unwrap();
        assert_eq!(read.environment, None);
        let statuses: Vec<&str> = read.results.iter().map(|r| r.status.as_str()).collect();
        assert_eq!(statuses, ["pass", "fail", "not-run"]);
        assert_eq!(read.results[0].steps_run, 3);
        assert_eq!(read.results[0].duration_ms, 12);
        assert_eq!(read.results[2].reason.as_deref(), Some("no WebGPU adapter"));
    }

    #[test]
    fn a_malformed_report_is_an_error() {
        for text in [
            "not json".to_owned(),
            json!({ "schemaVersion": 2, "environment": null, "fixtures": [] }).to_string(),
            json!({ "schemaVersion": 1, "environment": 3, "fixtures": [] }).to_string(),
            json!({ "schemaVersion": 1, "environment": null }).to_string(),
            report(&[json!({ "file": "a" })]),
            report(&[json!({ "file": "a", "status": "passed" })]),
            // A failure or a NOT-RUN without any reason says nothing.
            report(&[fixture("fail")]),
            report(&[fixture("not-run")]),
        ] {
            let error = read_report(&text).unwrap_err();
            assert!(error.contains("malformed"), "{error}");
        }
    }
}
