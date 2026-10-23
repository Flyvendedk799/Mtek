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
        &["build", "--loop-budget", "5"],
        &["build", "--mode", "dev", "--loop-budget", "5"],
        &["build", "--mode", "preview", "--loop-budget", "0"],
        &["build", "--mode", "preview", "--loop-budget", "many"],
        &["build", "--out", "."],
        &["inspect"],
        &["inspect", "--bindings", "--shaders", "--format", "json"],
        &["inspect", "--ir", "--shaders"],
        &["dev", "--port", "0"],
        &["dev", "--host", "0.0.0.0"],
        &["lsp", "--port", "1"],
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
    assert!(stderr(&run(&["build", "--loop-budget", "5"])).contains("--mode preview"));
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
fn empty_host_port_names_fail_check_and_build_before_emission() {
    let scratch = Scratch::new("empty-host-port-names");
    for direction in ["inputs", "outputs"] {
        let project = scratch.project(
            direction,
            "scene Demo { state value: f32 = 1.0; camera Main {} }",
        );
        scratch.write(
            &format!("{direction}/mtek.toml"),
            &format!("{TOML}[host.{direction}]\n\"\" = \"Demo.value\"\n"),
        );
        for command in ["check", "build"] {
            let out = run_in(&project, &[command, "--format", "json"]);
            assert_eq!(
                out.status.code(),
                Some(1),
                "{direction} {command}: {}",
                stderr(&out)
            );
            let report = report_of(&out, &scratch);
            // Rust-only builds also report the missing runtime; checking never needs it.
            let expected_codes = if command == "build" && !cfg!(mtek_runtime_embedded) {
                vec!["MTEK-E9001", "MTEK-E9030"]
            } else {
                vec!["MTEK-E9001"]
            };
            assert_eq!(codes(&report), expected_codes);
            assert_eq!(
                report["diagnostics"][0]["message"],
                format!("Invalid project configuration: host.{direction} names must not be empty.")
            );
            assert!(!project.join("dist").exists());
        }
    }
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
fn inspect_assets_prints_the_goldens_in_both_formats() {
    let scratch = Scratch::new("inspect-assets");
    let project = copy_fixture(&scratch, "assets/pass", "assets_supported");
    let goldens = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/assets/inspect");
    for (format, extension) in [("json", "assets.json"), ("human", "assets.txt")] {
        let out = run_in(&project, &["inspect", "--assets", "--format", format]);
        assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
        assert!(out.stderr.is_empty(), "{}", stderr(&out));
        let golden = fs::read_to_string(goldens.join(format!("assets_supported.{extension}")))
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(stdout(&out), golden, "--format {format}");
    }
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_build_with_assets_writes_them_next_to_the_program() {
    let scratch = Scratch::new("build-assets");
    let project = copy_fixture(&scratch, "assets/pass", "assets_supported");
    let out = run_in(&project, &["build", "--format", "json"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let manifest: Value =
        serde_json::from_slice(&fs::read(project.join("dist/program.manifest.json")).unwrap())
            .unwrap();
    for asset in manifest["assets"].as_array().unwrap() {
        let url = asset["url"].as_str().unwrap();
        let bytes = fs::read(project.join("dist").join(url)).unwrap();
        assert_eq!(
            asset["bytes"].as_u64().unwrap(),
            bytes.len() as u64,
            "{url}"
        );
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

/// The runtime files selected by `build.rs`, including its fresh-clone prebuilt fallback.
#[cfg(mtek_runtime_embedded)]
fn runtime_file(name: &str) -> Vec<u8> {
    let path = Path::new(env!("MTEK_RUNTIME_ORIGIN_DIR")).join(name);
    fs::read(&path).unwrap_or_else(|error| {
        panic!(
            "cannot read embedded runtime source {}: {error}; run `npm run build` first",
            path.display()
        )
    })
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

/// The release output contains no development overlay code; the dev and test outputs carry the
/// development runtime (decision 0055). This inspects the real files `mtek build` writes.
#[cfg(mtek_runtime_embedded)]
#[test]
fn a_release_build_has_no_overlay_code_and_dev_and_test_builds_do() {
    const MARKERS: [&str; 2] = ["data-mtek-dev-overlay", "GPU time unavailable"];
    let scratch = Scratch::new("build-flavours");
    let project = scratch.project("app", VALID);
    for (mode, flavour) in [
        ("release", "runtime.js"),
        ("dev", "runtime.dev.js"),
        ("test", "runtime.dev.js"),
    ] {
        let out = run_in(&project, &["build", "--mode", mode, "--out", mode]);
        assert_eq!(out.status.code(), Some(0), "{mode}: {}", stderr(&out));
        let built = tree(&project.join(mode));
        let runtime_name = built
            .keys()
            .find(|k| k.starts_with("runtime.") && k.ends_with(".js"))
            .unwrap();
        assert_eq!(built[runtime_name], runtime_file(flavour), "{mode}");
        for (file, bytes) in &built {
            let text = String::from_utf8_lossy(bytes);
            for marker in MARKERS {
                assert_eq!(
                    text.contains(marker),
                    mode != "release" && file == runtime_name,
                    "{mode}: {file} and {marker:?}"
                );
            }
        }
        let page = String::from_utf8_lossy(&built["index.html"]).into_owned();
        assert_eq!(page.contains("devOverlay"), mode == "dev", "{mode}: {page}");
    }
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
fn new_template_game_scaffolds_the_small_game() {
    let scratch = Scratch::new("new-game");
    let out = run_in(&scratch.0, &["new", "my-game", "--template", "game"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "created 'my-game' with the small-game template (mtek.toml, src/main.mtek, .gitignore)\n"
    );
    let root = scratch.path("my-game");
    let toml = fs::read_to_string(root.join("mtek.toml")).unwrap();
    assert!(toml.contains("scene = \"Title\""));
    assert!(!toml.contains("[host.inputs]"));
    let main = fs::read_to_string(root.join("src/main.mtek")).unwrap();
    assert!(main.contains("scene Title"));
    assert!(main.contains("scene Play"));
    assert!(main.contains("choose("));
    assert!(main.contains("key_pressed"));
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
fn scaffold_check_succeeds_for_the_demo() {
    let scratch = Scratch::new("new-check");
    assert_eq!(run_in(&scratch.0, &["new", "demo"]).status.code(), Some(0));
    let project = scratch.path("demo");
    let out = run_in(&project, &["check", "--format", "json"]);
    // M3-01..M3-06: the Demo template (state + host.inputs tint) type-checks cleanly.
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(codes(&report_of(&out, &scratch)), [] as [&str; 0]);
}

/// Every example under `examples/` checks clean: no error and no warning (the release
/// demonstrations of decision 0002 must always compile against the current compiler).
#[test]
fn every_example_checks_without_diagnostics() {
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples");
    let mut checked = Vec::new();
    for entry in fs::read_dir(&examples).unwrap() {
        let dir = entry.unwrap().path();
        if !dir.join("mtek.toml").is_file() {
            continue;
        }
        let out = run(&["check", "--format", "json", dir.to_str().unwrap()]);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{}: {}",
            dir.display(),
            stdout(&out)
        );
        let report = json(&out);
        assert_schema_valid(&report);
        assert_eq!(
            codes(&report),
            [] as [&str; 0],
            "{} has diagnostics",
            dir.display()
        );
        checked.push(dir.file_name().unwrap().to_str().unwrap().to_owned());
    }
    checked.sort();
    assert!(
        checked.contains(&"physics-playground".to_owned()),
        "the physics playground was not found among {checked:?}"
    );
    assert!(
        checked.contains(&"modular-scene".to_owned()),
        "the modular scene was not found among {checked:?}"
    );
}

/// The ownership rule on the real physics playground (decision 0069): put the two mistakes its
/// handlers avoid back into the example's own source (lift `First` by writing its position, put a
/// fallen crate back by writing its rotation through `self`) and `mtek check` rejects exactly
/// those two writes with `E5071`. The edits are asserted to apply, so the test cannot pass on an
/// example that was reworded.
#[test]
fn writing_the_pose_of_a_dynamic_body_in_the_physics_playground_is_e5071() {
    let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/physics-playground");
    let scratch = Scratch::new("playground-e5071");
    let project = scratch.path("physics-playground");
    for (rel, bytes) in tree(&example) {
        if rel.starts_with("dist/") {
            continue;
        }
        let to = project.join(&rel);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::write(to, bytes).unwrap();
    }
    let main = project.join("src/main.mtek");
    let source = fs::read_to_string(&main).unwrap();
    let lift = "First.body.apply_impulse(vec3(0.0, JUMP_IMPULSE, 0.0));";
    let remove = "destroy(self);";
    assert_eq!(
        source.matches(lift).count(),
        1,
        "the example's Space handler changed"
    );
    assert_eq!(
        source.matches(remove).count(),
        1,
        "the example's crate cleanup changed"
    );
    let edited = source
        .replace(lift, "First.position.y += 5.0;")
        .replace(remove, "self.rotation = quat.identity();");
    fs::write(&main, edited).unwrap();

    let out = run_in(
        &scratch.0,
        &["check", "--format", "json", "physics-playground"],
    );
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    let report = json(&out);
    assert_schema_valid(&report);
    assert_eq!(codes(&report), ["MTEK-E5071", "MTEK-E5071"]);
    let messages: Vec<&str> = report["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["message"].as_str().unwrap())
        .collect();
    assert!(
        messages[0].contains("`self.rotation`") && messages[0].contains("prefab 'Crate'"),
        "{messages:?}"
    );
    assert!(messages[1].contains("`First.position`"), "{messages:?}");
}

/// A copy of `examples/<name>` under `scratch`, without build output; returns the project directory.
fn copy_example(scratch: &Scratch, name: &str) -> PathBuf {
    let example = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name);
    let project = scratch.path(name);
    for (rel, bytes) in tree(&example) {
        if rel.starts_with("dist/") {
            continue;
        }
        let to = project.join(&rel);
        fs::create_dir_all(to.parent().unwrap()).unwrap();
        fs::write(to, bytes).unwrap();
    }
    project
}

/// `(file of the diagnostic, message, file of its first related span)` of every diagnostic of a report.
fn located(report: &Value) -> Vec<(String, String, String)> {
    report["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["source"]["file"].as_str().unwrap().to_owned(),
                d["message"].as_str().unwrap().to_owned(),
                d["related"][0]["source"]["file"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned(),
            )
        })
        .collect()
}

/// The cross-file rule on the real modular scene (M7-01, decision 0002): the prefab `Pillar` is
/// declared in `src/props/pillar.mtek` and instantiated and spawned in `src/main.mtek`. Take the
/// `export` off the declaration and `mtek check` rejects the one import with `E2033`, at the name
/// in the importing file, with the declaration in the other file as related span; the instances
/// and the `spawn` that use the name are not reported again. The edit is asserted to apply, so
/// the test cannot pass on an example that was reworded.
#[test]
fn importing_a_prefab_that_is_not_exported_from_the_modular_scene_is_e2033() {
    let scratch = Scratch::new("modular-scene-e2033-prefab");
    let project = copy_example(&scratch, "modular-scene");
    let pillar = project.join("src/props/pillar.mtek");
    let source = fs::read_to_string(&pillar).unwrap();
    assert_eq!(
        source.matches("export prefab Pillar {").count(),
        1,
        "the example's Pillar declaration changed"
    );
    fs::write(
        &pillar,
        source.replace("export prefab Pillar {", "prefab Pillar {"),
    )
    .unwrap();

    let out = run_in(&scratch.0, &["check", "--format", "json", "modular-scene"]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E2033"]);
    assert_eq!(
        located(&report),
        [(
            "src/main.mtek".to_owned(),
            "'Pillar' is not exported by 'src/props/pillar.mtek'.".to_owned(),
            "src/props/pillar.mtek".to_owned()
        )]
    );
    assert_eq!(
        report["diagnostics"][0]["related"][0]["message"],
        "the prefab 'Pillar' is declared here without `export`"
    );
}

/// The same rule for the material that three modules import: without `export` on `Matte`, each of
/// the three importing files (the two prefabs and the scene) gets its own `E2033`, in load order,
/// every one pointing at the declaration in `src/materials.mtek`.
#[test]
fn a_material_that_is_not_exported_is_e2033_in_each_module_that_imports_it() {
    let scratch = Scratch::new("modular-scene-e2033-material");
    let project = copy_example(&scratch, "modular-scene");
    let materials = project.join("src/materials.mtek");
    let source = fs::read_to_string(&materials).unwrap();
    assert_eq!(
        source.matches("export material Matte {").count(),
        1,
        "the example's Matte declaration changed"
    );
    fs::write(
        &materials,
        source.replace("export material Matte {", "material Matte {"),
    )
    .unwrap();

    let out = run_in(&scratch.0, &["check", "--format", "json", "modular-scene"]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    let report = report_of(&out, &scratch);
    assert_eq!(codes(&report), ["MTEK-E2033", "MTEK-E2033", "MTEK-E2033"]);
    let message = "'Matte' is not exported by 'src/materials.mtek'.".to_owned();
    let related = "src/materials.mtek".to_owned();
    assert_eq!(
        located(&report),
        [
            ("src/main.mtek".to_owned(), message.clone(), related.clone()),
            (
                "src/props/pillar.mtek".to_owned(),
                message.clone(),
                related.clone()
            ),
            ("src/props/beacon.mtek".to_owned(), message, related),
        ]
    );
}

// ---------------------------------------------------------------------------
// Untrusted previews (decision 0075)
// ---------------------------------------------------------------------------

/// A scene with a loop in an `update`.
#[cfg(mtek_runtime_embedded)]
const LOOPING: &str = "scene Demo {
    state total: i32 = 0;
    camera Main {}
    entity Cube { mesh: Box {}; }
    update(dt: f32) {
        for i in 0..4 {
            total += i;
        }
    }
}
";

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_preview_build_has_the_policy_page_the_bootstrap_the_budget_and_the_release_runtime() {
    let scratch = Scratch::new("preview");
    let project = scratch.project("app", LOOPING);
    let out = run_in(
        &project,
        &["build", "--mode", "preview", "--out", "default"],
    );
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(
        stdout(&out).starts_with("built 'demo' (preview): "),
        "{}",
        stdout(&out)
    );
    let built = tree(&project.join("default"));
    let page = String::from_utf8_lossy(&built["index.html"]).into_owned();
    assert!(page.contains("Content-Security-Policy"), "{page}");
    assert!(page.contains("'wasm-unsafe-eval'"), "{page}");
    assert!(
        page.contains("<script type=\"module\" src=\"./bootstrap.js\"></script>"),
        "{page}"
    );
    assert_eq!(
        page.matches("<script").count(),
        1,
        "no inline script: {page}"
    );
    let bootstrap = String::from_utf8_lossy(&built["bootstrap.js"]).into_owned();
    assert!(bootstrap.contains("mountMtek("), "{bootstrap}");
    // The release flavour of the runtime: no development overlay code (decision 0055).
    let runtime_name = built
        .keys()
        .find(|k| k.starts_with("runtime.") && k.ends_with(".js"))
        .unwrap();
    assert_eq!(built[runtime_name], runtime_file("runtime.js"));
    // The loop is checked, with the default budget; `--loop-budget` changes the manifest.
    let app = String::from_utf8_lossy(&built["app.js"]).into_owned();
    assert!(app.contains("--budget.n < 0"), "{app}");
    let manifest = |dir: &str| -> Value {
        serde_json::from_slice(&tree(&project.join(dir))["program.manifest.json"]).unwrap()
    };
    assert_eq!(
        manifest("default")["preview"],
        serde_json::json!({ "loopBudget": 10_000_000 })
    );
    let out = run_in(
        &project,
        &[
            "build",
            "--mode",
            "preview",
            "--loop-budget",
            "250",
            "--out",
            "small",
        ],
    );
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        manifest("small")["preview"],
        serde_json::json!({ "loopBudget": 250 })
    );
}

/// Source that makes the compiler's limits (and its stack) work: every one of these ends in a
/// diagnostic and exit code 1 within the time limit, in preview mode and in every other.
#[cfg(mtek_runtime_embedded)]
#[test]
fn hostile_sources_end_in_a_diagnostic_and_never_in_a_crash_or_a_hang() {
    use std::time::{Duration, Instant};

    let nest = |depth: usize| format!("{}1.0{}", "(".repeat(depth), ")".repeat(depth));
    let scene = |body: &str| format!("scene S {{\n    camera C {{}}\n{body}}}\n");
    let state = |value: &str| scene(&format!("    state x: f32 = {value};\n"));
    let cases: Vec<(&str, String, &str)> = vec![
        // Nesting past the parser's 256 levels: parentheses, a chain of operators, prefix operators.
        ("parentheses", state(&nest(100_000)), "MTEK-E1050"),
        ("barely too deep", state(&nest(300)), "MTEK-E1050"),
        (
            "operator chain",
            state(&vec!["1.0"; 100_000].join(" + ")),
            "MTEK-E1050",
        ),
        (
            "prefix operators",
            state(&format!("{}1.0", "-".repeat(100_000))),
            "MTEK-E1050",
        ),
        (
            "blocks",
            format!(
                "fn f() -> f32 {{ {}{} return 1.0; }}\n{}",
                "{ ".repeat(5_000),
                " }".repeat(5_000),
                state("1.0")
            ),
            "MTEK-E1050",
        ),
        // A file past 4 MiB.
        (
            "huge file",
            format!("{}// {}\n", state("1.0"), "x".repeat(5 * 1024 * 1024)),
            "MTEK-E0004",
        ),
        // More static entities than a scene may have.
        (
            "entities",
            scene(
                &(0..17_000)
                    .map(|i| format!("    entity E{i} {{ position: vec3(0.0, 0.0, 0.0); }}\n"))
                    .collect::<String>(),
            ),
            "MTEK-E5092",
        ),
    ];
    let scratch = Scratch::new("hostile");
    for mode in ["preview", "release"] {
        for (name, source, code) in &cases {
            let project = scratch.project(&format!("{mode}-{name}").replace(' ', "-"), source);
            let started = Instant::now();
            let out = run_in(
                &project,
                &[
                    "build", "--mode", mode, "--format", "json", "--out", "../out",
                ],
            );
            let spent = started.elapsed();
            assert_eq!(
                out.status.code(),
                Some(1),
                "{mode} {name}: {}",
                stderr(&out)
            );
            let report = report_of(&out, &scratch);
            assert!(
                codes(&report).iter().any(|c| c == code),
                "{mode} {name}: {:?}",
                codes(&report).iter().take(5).collect::<Vec<_>>()
            );
            assert!(
                spent < Duration::from_secs(9),
                "{mode} {name} took {spent:?}"
            );
            assert!(
                !scratch.path("out").exists(),
                "{mode} {name}: nothing is written"
            );
        }
    }
    // Over a thousand modules.
    let mut main = String::new();
    scratch.write("modules/mtek.toml", TOML);
    for i in 0..1_100 {
        scratch.write(
            &format!("modules/src/m{i}.mtek"),
            &format!("fn g{i}() -> f32 {{ return 1.0; }}\n"),
        );
        main.push_str(&format!("import {{ g{i} }} from \"./m{i}.mtek\";\n"));
    }
    main.push_str(&state("1.0"));
    scratch.write("modules/src/main.mtek", &main);
    let started = Instant::now();
    let out = run_in(
        &scratch.path("modules"),
        &[
            "build", "--mode", "preview", "--format", "json", "--out", "../out",
        ],
    );
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    assert!(codes(&report_of(&out, &scratch)).contains(&"MTEK-E9002".to_owned()));
    assert!(started.elapsed() < Duration::from_secs(9));
}

/// The deepest expression the parser accepts (255 levels) is a legal program, and compiling it on the
/// compiler thread neither overflows the stack nor takes noticeable time.
#[cfg(mtek_runtime_embedded)]
#[test]
fn the_deepest_legal_nesting_builds_as_a_preview() {
    let scratch = Scratch::new("deepest");
    let depth = 250;
    let source = format!(
        "scene S {{\n    camera C {{}}\n    state x: f32 = {}1.0{};\n}}\n",
        "(".repeat(depth),
        ")".repeat(depth)
    );
    let project = scratch.project("app", &source);
    let out = run_in(&project, &["build", "--mode", "preview", "--out", "out"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
}

// ---------------------------------------------------------------------------------------------
// The game template and the itch.io zip (decision 0136)
// ---------------------------------------------------------------------------------------------

#[test]
fn the_game_template_is_the_small_game_example_byte_for_byte() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let template = fs::read(manifest.join("templates/game.mtek")).unwrap();
    let example = fs::read(manifest.join("../../examples/small-game/src/main.mtek")).unwrap();
    assert_eq!(
        template, example,
        "templates/game.mtek drifted from examples/small-game"
    );
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_scaffolded_game_builds_as_a_release_package_with_an_itch_zip() {
    let scratch = Scratch::new("new-game-build");
    let made = run_in(&scratch.0, &["new", "my-game", "--template", "game"]);
    assert_eq!(made.status.code(), Some(0), "{}", stderr(&made));
    let project = scratch.path("my-game");
    let ignore = fs::read_to_string(project.join(".gitignore")).unwrap();
    assert!(
        ignore.lines().any(|line| line == "/dist-itch.zip"),
        "{ignore}"
    );
    let out = run_in(&project, &["build", "--release", "--itch"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(project.join("dist/index.html").is_file());
    assert!(project.join("dist-itch.zip").is_file());
}

/// `game` of the manifest a build wrote.
#[cfg(mtek_runtime_embedded)]
fn built_game(project: &Path) -> Value {
    let manifest: Value =
        serde_json::from_slice(&fs::read(project.join("dist/program.manifest.json")).unwrap())
            .unwrap();
    manifest["game"].clone()
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn two_scaffolded_games_of_one_name_save_under_different_keys() {
    let scratch = Scratch::new("save-ids");
    let mut storages = Vec::new();
    for dir in ["a", "b"] {
        let made = run_in(&scratch.path(""), &["new", "my-game", "--template", "game"]);
        assert_eq!(made.status.code(), Some(0), "{}", stderr(&made));
        fs::rename(scratch.path("my-game"), scratch.path(dir)).unwrap();
        let project = scratch.path(dir);
        let toml = fs::read_to_string(project.join("mtek.toml")).unwrap();
        let id = toml
            .lines()
            .find_map(|line| line.strip_prefix("id = \""))
            .map(|rest| rest.trim_end_matches('"').to_owned())
            .expect("mtek new writes a save id");
        let out = run_in(&project, &["build"]);
        assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
        let game = built_game(&project);
        assert_eq!(game["storage"], format!("my-game.{id}"));
        assert!(game.get("legacyStorage").is_none(), "{game}");
        storages.push(id);
    }
    assert_ne!(storages[0], storages[1]);
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_project_without_an_id_keeps_its_old_key_and_migrate_saves_names_it() {
    let scratch = Scratch::new("save-migrate");
    let project = copy_fixture(&scratch, "semantics/pass", "saved_state");
    let out = run_in(&project, &["build"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(built_game(&project)["storage"], "fixture");
    assert!(built_game(&project).get("legacyStorage").is_none());
    let toml = fs::read_to_string(project.join("mtek.toml")).unwrap();
    fs::write(
        project.join("mtek.toml"),
        format!("{toml}id = \"1a2b3c4d\"\nmigrate_saves = true\n"),
    )
    .unwrap();
    let out = run_in(&project, &["build"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let game = built_game(&project);
    assert_eq!(game["storage"], "fixture.1a2b3c4d");
    assert_eq!(game["legacyStorage"], "fixture");
}

#[cfg(mtek_runtime_embedded)]
#[test]
fn a_failing_itch_build_removes_the_zip_of_the_build_before() {
    let scratch = Scratch::new("itch-stale");
    let project = scratch.project("app", VALID);
    let first = run_in(&project, &["build", "--release", "--itch"]);
    assert_eq!(first.status.code(), Some(0), "{}", stderr(&first));
    assert!(project.join("dist-itch.zip").is_file());
    fs::write(project.join("src/main.mtek"), INVALID).unwrap();
    let second = run_in(&project, &["build", "--release", "--itch"]);
    assert_eq!(second.status.code(), Some(1), "{}", stderr(&second));
    assert!(
        !project.join("dist-itch.zip").exists(),
        "a stale zip survived a failing build"
    );
}
