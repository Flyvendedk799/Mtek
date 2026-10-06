//! Integration tests that run the real `mtek` binary on projects in temporary directories
//! (`spec/tooling.md` section 1; decision 0032).
//!
//! Tests that need the embedded runtime bundle are `#[cfg(mtek_runtime_embedded)]` (the CI
//! `node` job builds the bundle first); the `E9030` test is `#[cfg(not(mtek_runtime_embedded))]`.
//! `E9031` (the build output could not be written) is covered by
//! `a_build_that_cannot_be_written_is_e9031_and_exit_3`.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

const SCHEMA: &str = include_str!("../../../spec/diagnostic.schema.json");

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";
const VALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n}\n";
/// One error: `E2003` at 3:25.
const INVALID: &str = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Boks {}; }\n}\n";
/// One warning: `W0007`.
const WARNING: &str = "scene Demo {\n    camera Main {}\n}\n/// dangling\n";

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("mtek-cli-it-{}-{name}", std::process::id()));
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

    /// A project in `rel` with `main` as its entry module.
    fn project(&self, rel: &str, main: &str) -> PathBuf {
        self.write(&format!("{rel}/mtek.toml"), TOML);
        self.write(&format!("{rel}/src/main.mtek"), main);
        self.path(rel)
    }

    /// The entry names directly inside the scratch directory (or `rel` below it).
    fn names(&self, rel: &str) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.path(rel))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Run `mtek args…` in `cwd`, with `NO_COLOR` unset (stderr is a pipe, so no colour anyway).
fn run_in(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(args)
        .current_dir(cwd)
        .env_remove("NO_COLOR")
        .output()
        .unwrap()
}

fn run(args: &[&str]) -> Output {
    run_in(&std::env::temp_dir(), args)
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8(out.stderr.clone()).unwrap()
}

/// The single JSON document on stdout (parsing the whole text fails on anything extra).
fn json(out: &Output) -> Value {
    serde_json::from_str(&stdout(out))
        .unwrap_or_else(|e| panic!("stdout is not one JSON document ({e}):\n{}", stdout(out)))
}

/// `report` validates against `spec/diagnostic.schema.json`.
fn assert_schema_valid(report: &Value) {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    let validator = jsonschema::draft202012::new(&schema).unwrap();
    let problems: Vec<String> = validator
        .iter_errors(report)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}\n{report:#}");
}

fn codes(report: &Value) -> Vec<String> {
    report["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_owned())
        .collect()
}

/// The JSON report of `out`: one schema-valid document, nothing on stderr, and no absolute
/// path of the scratch directory inside.
fn report_of(out: &Output, scratch: &Scratch) -> Value {
    assert!(stderr(out).is_empty(), "stderr: {}", stderr(out));
    let report = json(out);
    assert_schema_valid(&report);
    let text = stdout(out);
    for form in [
        scratch.0.display().to_string(),
        scratch.0.display().to_string().replace('\\', "/"),
    ] {
        assert!(
            !text.contains(&form),
            "absolute path in the report:\n{text}"
        );
    }
    report
}

/// Every file below `dir`, by `/`-separated relative path.
fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, prefix: &str, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = format!("{prefix}{}", entry.file_name().into_string().unwrap());
            if entry.file_type().unwrap().is_dir() {
                walk(&entry.path(), &format!("{name}/"), out);
            } else {
                out.insert(name, fs::read(entry.path()).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, "", &mut out);
    out
}

// ---- --version, --help, usage errors -------------------------------------------------------

#[test]
fn version_prints_exact_line_and_exits_zero() {
    let out = run(&["--version"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        stdout(&out),
        "mtek 0.1.0-dev (language 0.1, runtime ABI 1)\n"
    );
    assert!(out.stderr.is_empty());
}

#[test]
fn help_goes_to_stdout_and_exits_zero() {
    for args in [&["--help"][..], &["build", "--help"]] {
        let out = run(args);
        assert_eq!(out.status.code(), Some(0), "{args:?}");
        assert!(stdout(&out).contains("Usage: mtek"), "{args:?}");
        assert!(out.stderr.is_empty(), "{args:?}");
    }
}

#[test]
fn usage_errors_exit_two_with_nothing_on_stdout() {
    let cases: &[&[&str]] = &[
        &[],
        &["--version", "extra"],
        &["--nope"],
        &["chek"],
        &["check", "a", "b"],
        &["check", "--format", "yaml"],
        &["build", "--target", "native"],
        &["build", "--mode", "preview", "--format", "json"],
        &["build", "--out", "."],
        &["inspect"],
        &["inspect", "--bindings", "--shaders", "--format", "json"],
        &["inspect", "--ir", "--shaders"],
        &["dev", "--port", "0"],
        &["dev", "--host", "0.0.0.0"],
        &["lsp"],
    ];
    for args in cases {
        let out = run(args);
        assert_eq!(out.status.code(), Some(2), "arguments: {args:?}");
        assert!(out.stdout.is_empty(), "arguments: {args:?}");
        assert!(
            stderr(&out).starts_with("error:"),
            "{args:?}: {}",
            stderr(&out)
        );
    }
    assert!(stderr(&run(&["build", "--mode", "preview"])).contains("M6"));
}

#[test]
fn dev_without_a_project_is_e9004_and_exit_1() {
    let scratch = Scratch::new("dev-no-project");
    let out = run_in(&scratch.0, &["dev", "--port", "1"]);
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    assert!(out.stdout.is_empty());
    assert!(
        stderr(&out).starts_with("error[MTEK-E9004]"),
        "{}",
        stderr(&out)
    );
}

// ---- mtek check ------------------------------------------------------------------------------

#[test]
fn check_success_prints_one_line() {
    let scratch = Scratch::new("check-ok");
    let project = scratch.project("app", VALID);
    let out = run_in(&project, &["check"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "checked 'demo': 0 errors, 0 warnings\n");
    assert!(out.stderr.is_empty());

    let out = run_in(&project, &["check", "--format", "json"]);
    assert_eq!(out.status.code(), Some(0));
    let report = report_of(&out, &scratch);
    assert_eq!(report["project"], "demo");
    assert_eq!(codes(&report), Vec::<String>::new());
    assert_eq!(report["summary"]["errors"], 0);
}

#[test]
fn check_with_errors_exits_one_in_both_formats() {
    let scratch = Scratch::new("check-errors");
    let project = scratch.project("app", INVALID);

    let out = run_in(&project, &["check"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    let text = stderr(&out);
    assert!(
        text.starts_with("error[MTEK-E2003]: Unknown descriptor type 'Boks'"),
        "{text}"
    );
    assert!(text.contains(" --> src/main.mtek:3:25\n"), "{text}");
    assert!(
        text.ends_with("check failed: 1 error, 0 warnings\n"),
        "{text}"
    );
    assert!(
        !text.contains('\x1b'),
        "no colour when stderr is not a terminal"
    );

    let out = run_in(&project, &["check", "--format", "json"]);
    assert_eq!(out.status.code(), Some(1));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E2003"]);
    assert_eq!(report["diagnostics"][0]["source"]["file"], "src/main.mtek");
    assert_eq!(report["summary"]["errors"], 1);
}

#[test]
fn warnings_do_not_fail_a_check() {
    let scratch = Scratch::new("check-warning");
    let project = scratch.project("app", WARNING);
    let out = run_in(&project, &["check"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout(&out), "checked 'demo': 0 errors, 1 warning\n");
    assert!(stderr(&out).starts_with("warning[MTEK-W0007]"));
    let out = run_in(&project, &["check", "--format", "json"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(codes(&report_of(&out, &scratch)), ["MTEK-W0007"]);
}

#[test]
fn the_project_is_the_nearest_ancestor_with_mtek_toml() {
    let scratch = Scratch::new("discovery");
    let project = scratch.project("app", VALID);
    for (cwd, args) in [
        (project.join("src"), &["check"][..]),
        (project.clone(), &["check", "src"]),
        (project.clone(), &["check", "src/main.mtek"]),
        (scratch.0.clone(), &["check", "app/src/does/not/exist"]),
        (scratch.0.clone(), &["check", "app"]),
    ] {
        let out = run_in(&cwd, args);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{args:?} in {cwd:?}: {}",
            stderr(&out)
        );
        assert_eq!(stdout(&out), "checked 'demo': 0 errors, 0 warnings\n");
    }
}

#[test]
fn no_project_is_e9004() {
    let scratch = Scratch::new("no-project");
    scratch.write("empty/readme.txt", "");
    let out = run_in(&scratch.0, &["check", "--format", "json", "empty"]);
    assert_eq!(out.status.code(), Some(1));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E9004"]);
    assert_eq!(report["project"], Value::Null);
    assert_eq!(
        report["diagnostics"][0]["message"],
        "No mtek.toml found in 'empty' or any of its parent directories."
    );
}

#[test]
fn deep_nesting_is_a_diagnostic_not_a_crash() {
    let scratch = Scratch::new("deep");
    let deep = format!(
        "const X: f32 = {}1.0{};\nscene Demo {{\n    camera Main {{}}\n}}\n",
        "(".repeat(300),
        ")".repeat(300)
    );
    let project = scratch.project("app", &deep);
    let out = run_in(&project, &["check", "--format", "json"]);
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    assert!(codes(&report_of(&out, &scratch)).contains(&"MTEK-E1050".to_owned()));
}

// ---- mtek inspect --ir -----------------------------------------------------------------------

/// A copy of `tests/semantics/pass/<name>` in the scratch directory.
fn copy_fixture(scratch: &Scratch, suite: &str, name: &str) -> PathBuf {
    let from = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests")
        .join(suite)
        .join(name);
    for (rel, bytes) in tree(&from) {
        if rel.starts_with("expected") {
            continue;
        }
        let to = scratch.path(name).join(&rel);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::write(to, bytes).unwrap();
    }
    scratch.path(name)
}

#[test]
fn inspect_ir_prints_the_golden_ir_in_both_formats() {
    let scratch = Scratch::new("inspect");
    let name = "scene_a_target_camera_box";
    let project = copy_fixture(&scratch, "semantics/pass", name);
    let goldens = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/codegen/ir");
    for (format, extension) in [("json", "ir.json"), ("human", "ir.txt")] {
        let out = run_in(&project, &["inspect", "--ir", "--format", format]);
        assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
        assert!(out.stderr.is_empty());
        let golden = fs::read_to_string(goldens.join(format!("{name}.{extension}"))).unwrap();
        assert_eq!(stdout(&out), golden, "--format {format}");
    }
}

#[test]
fn inspect_with_errors_prints_the_report() {
    let scratch = Scratch::new("inspect-errors");
    let project = scratch.project("app", INVALID);
    let out = run_in(&project, &["inspect", "--ir", "--format", "json"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(codes(&report_of(&out, &scratch)), ["MTEK-E2003"]);
    let out = run_in(&project, &["inspect", "--ir"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    assert!(stderr(&out).ends_with("inspect failed: 1 error, 0 warnings\n"));
}

#[test]
fn inspect_shaders_and_bindings_print_the_goldens_in_both_formats() {
    let scratch = Scratch::new("inspect-views");
    let goldens = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/codegen/inspect");
    for (suite, name, stem) in [
        (
            "semantics/pass",
            "scene_a_target_camera_box",
            "scene_a_target_camera_box",
        ),
        (
            "semantics/pass/materials",
            "params_and_defaults",
            "materials_params_and_defaults",
        ),
    ] {
        let project = copy_fixture(&scratch, suite, name);
        for view in ["shaders", "bindings"] {
            for (format, extension) in [("json", "json"), ("human", "txt")] {
                let out = run_in(
                    &project,
                    &["inspect", &format!("--{view}"), "--format", format],
                );
                assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
                assert!(out.stderr.is_empty(), "{}", stderr(&out));
                let golden = fs::read_to_string(goldens.join(format!("{stem}.{view}.{extension}")))
                    .unwrap()
                    .replace("\r\n", "\n");
                assert_eq!(stdout(&out), golden, "{name} --{view} --format {format}");
            }
        }
    }
}

#[test]
fn inspect_shaders_with_errors_prints_the_report() {
    let scratch = Scratch::new("inspect-views-errors");
    let project = scratch.project("app", INVALID);
    for view in ["--shaders", "--bindings"] {
        let out = run_in(&project, &["inspect", view, "--format", "json"]);
        assert_eq!(out.status.code(), Some(1));
        assert_eq!(codes(&report_of(&out, &scratch)), ["MTEK-E2003"]);
        let out = run_in(&project, &["inspect", view]);
        assert_eq!(out.status.code(), Some(1));
        assert!(out.stdout.is_empty());
        assert!(stderr(&out).ends_with("inspect failed: 1 error, 0 warnings\n"));
    }
}

// ---- mtek build ------------------------------------------------------------------------------

#[cfg(not(mtek_runtime_embedded))]
#[test]
fn build_without_the_embedded_runtime_is_e9030() {
    let scratch = Scratch::new("e9030");
    let project = scratch.project("app", VALID);
    let out = run_in(&project, &["build", "--format", "json"]);
    assert_eq!(out.status.code(), Some(1));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E9030"]);
    assert!(
        report["diagnostics"][0]["notes"][0]
            .as_str()
            .unwrap()
            .contains("npm run build")
    );
    assert_eq!(
        scratch.names("app"),
        ["mtek.toml", "src"],
        "nothing written"
    );

    let out = run_in(&project, &["build"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).starts_with("error[MTEK-E9030]"));
}

#[test]
fn a_failed_build_leaves_the_previous_output_untouched() {
    let scratch = Scratch::new("failed-build");
    let project = scratch.project("app", VALID);
    let previous = if cfg!(mtek_runtime_embedded) {
        let out = run_in(&project, &["build"]);
        assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
        tree(&project.join("dist"))
    } else {
        // Without the runtime every build fails (`E9030`); an earlier output stands in.
        scratch.write("app/dist/index.html", "previous");
        tree(&project.join("dist"))
    };
    scratch.write("app/src/main.mtek", INVALID);
    let out = run_in(&project, &["build"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("build failed:"));
    assert_eq!(tree(&project.join("dist")), previous);
    assert_eq!(
        scratch.names("app"),
        ["dist", "mtek.toml", "src"],
        "no temporary directory"
    );
}

/// The runtime files as `npm run build` left them.
#[cfg(mtek_runtime_embedded)]
fn runtime_file(name: &str) -> Vec<u8> {
    fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/runtime-web/dist")
            .join(name),
    )
    .unwrap()
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn build_writes_the_output_tree_with_the_embedded_runtime() {
    let scratch = Scratch::new("build-tree");
    let name = "scene_a_target_camera_box";
    let project = copy_fixture(&scratch, "codegen", name);
    let out = run_in(&project, &["build"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(out.stderr.is_empty());
    let line = stdout(&out);
    assert!(
        line.starts_with("built 'fixture' (release): 9 files in dist, build "),
        "{line}"
    );
    assert!(line.ends_with("; 0 errors, 0 warnings\n"), "{line}");
    assert_eq!(scratch.names(name), ["dist", "mtek.toml", "src"]);

    let built = tree(&project.join("dist"));
    let runtime_name = built
        .keys()
        .find(|k| k.starts_with("runtime.") && k.ends_with(".js"))
        .unwrap()
        .clone();
    assert_eq!(built[&runtime_name], runtime_file("runtime.js"));
    assert_eq!(built["runtime.d.ts"], runtime_file("runtime.d.ts"));

    // The codegen golden was built with the stub runtime: everything else is identical, except
    // the hashed runtime name that `app.js` imports.
    let golden = tree(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/codegen")
            .join(name)
            .join("expected"),
    );
    let mut names: Vec<&String> = golden.keys().collect();
    names.push(&runtime_name);
    names.sort();
    assert_eq!(built.keys().collect::<Vec<_>>(), names);
    for (file, bytes) in &golden {
        match file.as_str() {
            "runtime.d.ts" => {}
            "app.js" => {
                let golden_text = String::from_utf8(bytes.clone()).unwrap();
                let stub_name = golden_text
                    .lines()
                    .nth(1)
                    .unwrap()
                    .split("./")
                    .nth(1)
                    .unwrap()
                    .trim_end_matches("\";")
                    .to_owned();
                assert_eq!(
                    String::from_utf8(built[file].clone()).unwrap(),
                    golden_text.replace(&stub_name, &runtime_name)
                );
            }
            _ => assert_eq!(&built[file], bytes, "{file}"),
        }
    }

    // Reproducible: a second build into another directory gives the same bytes.
    let out = run_in(&project, &["build", "--out", "again"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(tree(&project.join("again")), built);
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn build_json_test_mode_and_out() {
    let scratch = Scratch::new("build-json");
    let project = scratch.project("app", VALID);
    let out = run_in(
        &scratch.0,
        &[
            "build", "--mode", "test", "--out", "out/web", "--format", "json", "app",
        ],
    );
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let report = report_of(&out, &scratch);
    assert_eq!(report["project"], "demo");
    assert_eq!(codes(&report), Vec::<String>::new());
    let index = fs::read_to_string(scratch.path("out/web/index.html")).unwrap();
    assert!(index.contains("window.__mtekMount"), "{index}");
    assert!(
        !project.join("dist").exists(),
        "--out replaces build.out_dir"
    );
    assert_eq!(scratch.names("out"), ["web"]);
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_build_that_cannot_be_written_is_e9031_and_exit_3() {
    let scratch = Scratch::new("e9031");
    let project = scratch.project("app", VALID);
    scratch.write("blocker", "a file where a directory should be");
    let out = run_in(
        &project,
        &["build", "--format", "json", "--out", "../blocker/dist"],
    );
    assert_eq!(out.status.code(), Some(3));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E9031"]);
    assert!(
        report["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .starts_with("Could not write the build output to '../blocker/dist'")
    );
    let out = run_in(&project, &["build", "--out", "../blocker/dist"]);
    assert_eq!(out.status.code(), Some(3));
    assert!(out.stdout.is_empty());
    assert!(
        stderr(&out).starts_with("error[MTEK-E9031]"),
        "{}",
        stderr(&out)
    );
    assert_eq!(
        fs::read_to_string(scratch.path("blocker")).unwrap(),
        "a file where a directory should be"
    );
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn an_output_directory_that_would_replace_the_project_is_refused() {
    let scratch = Scratch::new("out-guard");
    let project = scratch.project("app", VALID);
    for out_dir in ["../app", "src", "..", "../.."] {
        let out = run_in(&project, &["build", "--format", "json", "--out", out_dir]);
        assert_eq!(
            out.status.code(),
            Some(2),
            "--out {out_dir}: {}",
            stderr(&out)
        );
        assert!(out.stdout.is_empty());
    }
    assert_eq!(
        fs::read_to_string(project.join("src/main.mtek")).unwrap(),
        VALID
    );
    assert_eq!(scratch.names("app"), ["mtek.toml", "src"]);
}

// ---- mtek new ------------------------------------------------------------------------------

#[test]
fn new_scaffolds_the_demo_project() {
    let scratch = Scratch::new("new-ok");
    let out = run_in(&scratch.0, &["new", "pulse-cube"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "created 'pulse-cube' with the Demo scene (mtek.toml, src/main.mtek, .gitignore)\n"
    );
    assert!(out.stderr.is_empty());

    let root = scratch.path("pulse-cube");
    assert!(root.is_dir());
    let toml = fs::read_to_string(root.join("mtek.toml")).unwrap();
    assert!(toml.contains("name = \"pulse-cube\""));
    assert!(toml.contains("scene = \"Demo\""));
    assert!(toml.contains("[host.inputs]"));
    assert!(toml.contains("tint = \"Demo.tint\""));
    assert!(toml.contains("title = \"Pulse Cube\""));

    let main = fs::read_to_string(root.join("src/main.mtek")).unwrap();
    assert!(main.contains("fn pulse("));
    assert!(main.contains("material Pulse"));
    assert!(main.contains("scene Demo"));
    assert!(main.contains("bind(frame.time)"));
    assert!(main.contains("on key_down(Key.Space)"));
    assert!(main.contains("update(dt: f32)"));

    let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(gitignore.contains("/dist/"));

    assert_eq!(
        scratch.names("pulse-cube"),
        vec![
            ".gitignore".to_string(),
            "mtek.toml".to_string(),
            "src".to_string()
        ]
    );
}

#[test]
fn new_rejects_invalid_and_existing_names() {
    let scratch = Scratch::new("new-bad");
    let out = run_in(&scratch.0, &["new", "Pulse"]);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(out.stdout.is_empty());
    assert!(stderr(&out).contains("[a-z0-9-]+"), "{}", stderr(&out));

    let out = run_in(&scratch.0, &["new", "ok-name"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let again = run_in(&scratch.0, &["new", "ok-name"]);
    assert_eq!(again.status.code(), Some(1), "{}", stderr(&again));
    assert!(
        stderr(&again).contains("already exists"),
        "{}",
        stderr(&again)
    );
}

#[test]
fn new_without_a_name_is_usage() {
    let out = run(&["new"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    assert!(stderr(&out).starts_with("error:"));
}

/// The scaffold matches the committed `examples/pulse-cube` template bit-for-bit (except the
/// project name / title, which are derived from `NAME`).
#[test]
fn new_matches_examples_pulse_cube_aside_from_the_name() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/pulse-cube");
    if !example.is_dir() {
        // The example is committed by the same task that lands `mtek new`; skip only if absent.
        return;
    }
    let scratch = Scratch::new("new-vs-example");
    let out = run_in(&scratch.0, &["new", "pulse-cube"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let created = scratch.path("pulse-cube");
    for rel in ["mtek.toml", "src/main.mtek", ".gitignore"] {
        let got = fs::read_to_string(created.join(rel)).unwrap();
        let want = fs::read_to_string(example.join(rel)).unwrap();
        assert_eq!(got, want, "{rel} differs from examples/pulse-cube");
    }
}

/// Honest check of the scaffold against the current compiler: until M3-01..05 land on this
/// branch (`bind`, lifecycle, handlers, `self`), `mtek check` reports `E9010`. This test
/// records that, so a green run never pretends the Demo already type-checks.
#[cfg(mtek_runtime_embedded)]
#[test]
fn scaffold_check_reports_e9010_until_m3_gates_open() {
    let scratch = Scratch::new("new-check");
    assert_eq!(run_in(&scratch.0, &["new", "demo"]).status.code(), Some(0));
    let project = scratch.path("demo");
    let out = run_in(&project, &["check", "--format", "json"]);
    // Exit 1: the program has errors (gated constructs).
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    let report = report_of(&out, &scratch);
    let found = codes(&report);
    assert!(
        found.iter().any(|c| c == "MTEK-E9010"),
        "expected E9010 for gated Demo constructs, got {found:?}"
    );
}
