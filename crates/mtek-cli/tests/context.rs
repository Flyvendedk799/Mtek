//! `mtek context` end to end: the real binary on projects in temporary directories
//! (`spec/tooling.md` section 1, `spec/ai-and-benchmarks.md` section 2, decision 0072).

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

const CONTEXT_SCHEMA: &str = include_str!("../../../spec/context.schema.json");
const DIAGNOSTIC_SCHEMA: &str = include_str!("../../../spec/diagnostic.schema.json");

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";
const MAIN: &str = "/// The demo.\nscene Demo {\n    state speed: f32 = 1.0;\n\n    camera Main {}\n\n    entity Cube {\n        mesh: Box {};\n\n        update(dt: f32) {\n            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), speed * dt);\n        }\n    }\n\n    entity Ball {\n        mesh: Sphere {};\n    }\n}\n";

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("mtek-cli-ctx-{}-{name}", std::process::id()));
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
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn mtek(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(args)
        .current_dir(cwd)
        .env_remove("NO_COLOR")
        .output()
        .unwrap()
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

fn assert_valid(schema_text: &str, instance: &Value) {
    let schema: Value = serde_json::from_str(schema_text).unwrap();
    let validator = jsonschema::draft202012::new(&schema).unwrap();
    let problems: Vec<String> = validator
        .iter_errors(instance)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}");
}

/// The context on stdout: exit code 0, nothing on stderr, one document valid against
/// `spec/context.schema.json`.
fn context_of(out: &Output) -> Value {
    assert_eq!(code(out), 0, "stderr: {}", stderr(out));
    assert!(stderr(out).is_empty(), "stderr: {}", stderr(out));
    let value: Value = serde_json::from_str(&stdout(out))
        .unwrap_or_else(|e| panic!("stdout is not one JSON document ({e})"));
    assert_valid(CONTEXT_SCHEMA, &value);
    value
}

fn symbol_names(context: &Value) -> Vec<&str> {
    context["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect()
}

#[test]
fn prints_the_context_of_the_project_as_one_json_document() {
    let scratch = Scratch::new("basic");
    let project = scratch.project("proj", MAIN);
    let out = mtek(&project, &["context", "--entry", "src/main.mtek"]);
    let context = context_of(&out);
    assert_eq!(context["contextFormat"], 2);
    assert_eq!(context["languageVersion"], "0.1");
    assert_eq!(context["project"]["scene"], "Demo");
    assert_eq!(context["project"]["entry"], "src/main.mtek");
    assert_eq!(
        symbol_names(&context),
        ["Demo", "Demo.speed", "Demo.Main", "Demo.Cube", "Demo.Ball"]
    );
    assert_eq!(context["symbols"][0]["doc"], "The demo.");
    // `--format json` is the format and the default.
    let explicit = mtek(
        &project,
        &["context", "--entry", "src/main.mtek", "--format", "json"],
    );
    assert_eq!(stdout(&explicit), stdout(&out));
}

#[test]
fn the_same_bytes_from_any_directory_and_without_absolute_paths() {
    let scratch = Scratch::new("cwd");
    let project = scratch.project("proj", MAIN);
    let from_project = stdout(&mtek(&project, &["context", "--entry", "src/main.mtek"]));
    let from_source = stdout(&mtek(
        &project.join("src"),
        &["context", "--entry", "main.mtek"],
    ));
    let from_above = stdout(&mtek(
        &scratch.0,
        &["context", "--entry", "proj/src/main.mtek"],
    ));
    let absolute = project.join("src/main.mtek");
    let from_absolute = stdout(&mtek(
        &std::env::temp_dir(),
        &["context", "--entry", absolute.to_str().unwrap()],
    ));
    assert!(!from_project.is_empty());
    assert_eq!(from_source, from_project);
    assert_eq!(from_above, from_project);
    assert_eq!(from_absolute, from_project);
    for form in [
        scratch.0.display().to_string(),
        scratch.0.display().to_string().replace('\\', "/"),
    ] {
        assert!(
            !from_project.contains(&form),
            "absolute path in the context"
        );
    }
}

#[test]
fn symbols_are_repeatable_and_take_several_values() {
    let scratch = Scratch::new("symbols");
    let project = scratch.project("proj", MAIN);
    let one = context_of(&mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--symbol",
            "Demo.Cube",
        ],
    ));
    assert_eq!(symbol_names(&one), ["Demo.speed", "Demo.Cube"]);
    let repeated = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--symbol",
            "Demo.Cube",
            "--symbol",
            "Demo.Ball",
        ],
    );
    let together = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--symbol",
            "Demo.Cube",
            "Demo.Ball",
        ],
    );
    let repeated = context_of(&repeated);
    assert_eq!(
        symbol_names(&repeated),
        ["Demo.speed", "Demo.Cube", "Demo.Ball"]
    );
    assert_eq!(context_of(&together), repeated);
}

#[test]
fn an_unknown_symbol_is_a_usage_error() {
    let scratch = Scratch::new("unknown");
    let project = scratch.project("proj", MAIN);
    let out = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--symbol",
            "Demo.Cub",
        ],
    );
    assert_eq!(code(&out), 2);
    assert!(stdout(&out).is_empty());
    assert!(
        stderr(&out).contains("'Demo.Cub'") && stderr(&out).contains("did you mean 'Demo.Cube'")
    );
}

#[test]
fn max_bytes_truncates_and_says_so() {
    let scratch = Scratch::new("budget");
    let project = scratch.project("proj", MAIN);
    let full = mtek(&project, &["context", "--entry", "src/main.mtek"]);
    let full_len = stdout(&full).len();
    // The floor rose with particles, camera switching and clips (decisions 0154–0156).
    // 12 000 still drops the four examples and stays under the full document.
    assert!(full_len > 12_000, "{full_len}");
    let out = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--max-bytes",
            "12000",
        ],
    );
    let context = context_of(&out);
    assert!(stdout(&out).len() <= 12_000, "{}", stdout(&out).len());
    let dropped = &context["truncated"]["examples"];
    assert_eq!(dropped["count"], 1);
    assert_eq!(dropped["names"].as_array().unwrap().len(), 1);
    // A budget that already fits leaves everything and has no `truncated` field.
    let fits = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--max-bytes",
            &full_len.to_string(),
        ],
    );
    assert_eq!(stdout(&fits), stdout(&full));
    assert!(context_of(&fits).get("truncated").is_none());
}

#[test]
fn a_budget_below_the_smallest_context_is_a_usage_error_that_names_the_minimum() {
    let scratch = Scratch::new("tiny");
    let project = scratch.project("proj", MAIN);
    let out = mtek(
        &project,
        &["context", "--entry", "src/main.mtek", "--max-bytes", "100"],
    );
    assert_eq!(code(&out), 2);
    assert!(stdout(&out).is_empty());
    let text = stderr(&out);
    assert!(text.contains("'--max-bytes 100' is too small"), "{text}");
    let minimum: usize = text
        .split("is ")
        .last()
        .unwrap()
        .split(' ')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    // The number it names is the smallest budget that works.
    let works = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--max-bytes",
            &minimum.to_string(),
        ],
    );
    let context = context_of(&works);
    assert_eq!(stdout(&works).len(), minimum);
    assert!(context["symbols"].as_array().unwrap().is_empty());
    let below = mtek(
        &project,
        &[
            "context",
            "--entry",
            "src/main.mtek",
            "--max-bytes",
            &(minimum - 1).to_string(),
        ],
    );
    assert_eq!(code(&below), 2);
    // Not a number, or no value.
    assert_eq!(
        code(&mtek(
            &project,
            &["context", "--entry", "src/main.mtek", "--max-bytes", "lots"]
        )),
        2
    );
}

#[test]
fn the_entry_must_be_the_projects_entry() {
    let scratch = Scratch::new("entry");
    let project = scratch.project("proj", MAIN);
    scratch.write("proj/src/other.mtek", "export const X: f32 = 1.0;\n");
    let out = mtek(&project, &["context", "--entry", "src/other.mtek"]);
    assert_eq!(code(&out), 2);
    assert!(stdout(&out).is_empty());
    assert!(
        stderr(&out).contains("'--entry src/other.mtek' is not the entry module of the project")
            && stderr(&out).contains("'src/main.mtek'"),
        "{}",
        stderr(&out)
    );
    // `--entry` is required.
    assert_eq!(code(&mtek(&project, &["context"])), 2);
}

#[test]
fn a_directory_without_a_project_is_a_diagnostics_report() {
    let scratch = Scratch::new("noproject");
    scratch.write("src/main.mtek", "scene A {}\n");
    let out = mtek(&scratch.0, &["context", "--entry", "src/main.mtek"]);
    assert_eq!(code(&out), 1);
    assert!(stderr(&out).is_empty(), "{}", stderr(&out));
    let report: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_valid(DIAGNOSTIC_SCHEMA, &report);
    assert_eq!(report["diagnostics"][0]["code"], "MTEK-E9004");
}

#[test]
fn an_invalid_project_file_is_a_diagnostics_report() {
    let scratch = Scratch::new("badtoml");
    let project = scratch.project("proj", MAIN);
    scratch.write(
        "proj/mtek.toml",
        "[project]\nname = \"demo\"\nlanguage = \"9.9\"\n",
    );
    let out = mtek(&project, &["context", "--entry", "src/main.mtek"]);
    assert_eq!(code(&out), 1);
    let report: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_valid(DIAGNOSTIC_SCHEMA, &report);
    assert_eq!(report["diagnostics"][0]["code"], "MTEK-E9001");
    assert_eq!(report["project"], Value::Null);
}

#[test]
fn a_project_with_errors_still_has_a_context() {
    let scratch = Scratch::new("errors");
    let project = scratch.project(
        "proj",
        "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Nope {}; }\n}\n",
    );
    assert_eq!(code(&mtek(&project, &["check"])), 1);
    let context = context_of(&mtek(&project, &["context", "--entry", "src/main.mtek"]));
    assert_eq!(context["project"]["scene"], "Demo");
    assert!(symbol_names(&context).contains(&"Demo.Cube"));
}

#[test]
fn only_json_is_a_format_and_the_command_is_documented() {
    let scratch = Scratch::new("format");
    let project = scratch.project("proj", MAIN);
    let out = mtek(
        &project,
        &["context", "--entry", "src/main.mtek", "--format", "human"],
    );
    assert_eq!(code(&out), 2);
    assert!(stdout(&out).is_empty());
    let help = mtek(&project, &["context", "--help"]);
    assert_eq!(code(&help), 0);
    let text = stdout(&help);
    for word in ["--entry", "--symbol", "--max-bytes", "--format"] {
        assert!(text.contains(word), "{word}\n{text}");
    }
    assert!(stdout(&mtek(&project, &["--help"])).contains("context"));
}

#[test]
fn the_output_is_the_golden_of_the_library() {
    // The CLI adds nothing to the library's text: the golden of the example project, byte for byte.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = mtek(
        &root,
        &["context", "--entry", "examples/pulse-cube/src/main.mtek"],
    );
    assert_eq!(code(&out), 0, "{}", stderr(&out));
    let golden =
        fs::read_to_string(root.join("tests/context/golden/pulse-cube.default.json")).unwrap();
    assert_eq!(stdout(&out), golden);
}

#[test]
fn every_example_in_the_context_checks_with_the_real_checker() {
    let scratch = Scratch::new("examples");
    let project = scratch.project("proj", MAIN);
    let mut checked = 0;
    for symbols in [&[][..], &["Demo.Cube"], &["Demo.speed"]] {
        let mut args = vec!["context", "--entry", "src/main.mtek"];
        for symbol in symbols {
            args.extend(["--symbol", symbol]);
        }
        let context = context_of(&mtek(&project, &args));
        for example in context["examples"].as_array().unwrap() {
            let dir = format!("example-{checked}");
            let example_project = scratch.project(&dir, example["source"].as_str().unwrap());
            let out = mtek(&example_project, &["check", "--format", "json"]);
            let report: Value = serde_json::from_str(&stdout(&out)).unwrap();
            assert_eq!(code(&out), 0, "'{}': {report:#}", example["title"]);
            assert!(
                report["diagnostics"].as_array().unwrap().is_empty(),
                "'{}': {report:#}",
                example["title"]
            );
            checked += 1;
        }
    }
    assert!(checked >= 6, "{checked}");
}
