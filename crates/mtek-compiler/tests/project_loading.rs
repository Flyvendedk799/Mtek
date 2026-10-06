//! End-to-end tests of project loading through the public API: discovery,
//! `mtek.toml` validation, the entry module and the module graph, with the
//! diagnostics rendered in both output formats and validated against
//! `spec/diagnostic.schema.json`.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use jsonschema::Validator;
use mtek_compiler::diagnostics::{
    Code, Diagnostics, RenderOptions, Report, render_report, to_report,
};
use mtek_compiler::project::{Project, ProjectRoot};
use mtek_compiler::source::{MemFs, ProjectPath, SourceMap};
use serde_json::Value;

const MINIMAL: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

fn p(s: &str) -> ProjectPath {
    ProjectPath::new(s).unwrap()
}

fn schema_validator() -> Validator {
    let schema: Value =
        serde_json::from_str(include_str!("../../../spec/diagnostic.schema.json")).unwrap();
    jsonschema::draft202012::new(&schema).unwrap()
}

/// Discover the project from `start` and load it; returns the project, the
/// finished report and the project name for the JSON envelope.
fn run(fs: &MemFs, start: &str) -> (Option<Project>, Report) {
    let mut diagnostics = Diagnostics::new();
    let start = if start.is_empty() {
        ProjectPath::root()
    } else {
        p(start)
    };
    let project = ProjectRoot::discover(fs, &start, &mut diagnostics)
        .and_then(|root| Project::load(&root, fs, &mut diagnostics));
    (project, diagnostics.finish())
}

fn assert_schema_valid(report: &Report, map: &SourceMap) -> Value {
    let json = to_report(report, None, map);
    let validator = schema_validator();
    let problems: Vec<String> = validator
        .iter_errors(&json)
        .map(|e| format!("{e} at {}", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}\n{json:#}");
    json
}

fn human(report: &Report) -> String {
    render_report(report, &SourceMap::new(), RenderOptions::default())
}

#[test]
fn a_valid_project_loads_without_diagnostics() {
    let mut fs = MemFs::new();
    fs.insert(p("app/mtek.toml"), MINIMAL)
        .insert(p("app/src/main.mtek"), "scene Demo { }\n");
    let (project, report) = run(&fs, "app/src");
    assert!(report.diagnostics.is_empty());
    let project = project.unwrap();
    assert_eq!(project.modules.len(), 1);
    assert_eq!(project.config.project.name, "demo");
    assert_schema_valid(&report, &project.sources);
}

#[test]
fn a_missing_project_file_renders_as_e9004() {
    let mut fs = MemFs::new();
    fs.insert(p("work/readme.txt"), "");
    let (project, report) = run(&fs, "work");
    assert!(project.is_none());
    assert_eq!(report.summary.errors, 1);

    let json = assert_schema_valid(&report, &SourceMap::new());
    let first = &json["diagnostics"][0];
    assert_eq!(first["code"], "MTEK-E9004");
    assert_eq!(first["title"], "project file not found");
    assert_eq!(first["source"], Value::Null);

    assert_eq!(
        human(&report),
        "\
error[MTEK-E9004]: No mtek.toml found in 'work' or any of its parent directories.
  = help: create a mtek.toml in the project directory with a [project] table that sets `name` and `language`

"
    );
}

#[test]
fn an_invalid_key_renders_with_its_exact_path() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        format!("{MINIMAL}\n[runtime]\nmax_catch_up_steps = 0\n"),
    )
    .insert(p("src/main.mtek"), "");
    let (project, report) = run(&fs, "");
    assert!(project.is_none());

    let json = assert_schema_valid(&report, &SourceMap::new());
    let d = &json["diagnostics"][0];
    assert_eq!(d["code"], "MTEK-E9001");
    assert_eq!(
        d["message"],
        "Invalid project configuration: 'runtime.max_catch_up_steps' must be an integer from 1 to 1000, found 0."
    );
    assert_eq!(d["expected"], "an integer from 1 to 1000");
    assert_eq!(d["actual"], "0");
    assert_eq!(d["notes"][0], "at mtek.toml:6:22");

    assert_eq!(
        human(&report),
        "\
error[MTEK-E9001]: Invalid project configuration: 'runtime.max_catch_up_steps' must be an integer from 1 to 1000, found 0.
  = note: expected an integer from 1 to 1000, found 0
  = note: at mtek.toml:6:22

"
    );
}

#[test]
fn a_missing_entry_renders_as_e9005() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/Main.mtek"), "");
    let (project, report) = run(&fs, "");
    assert!(project.is_none());
    let json = assert_schema_valid(&report, &SourceMap::new());
    assert_eq!(json["diagnostics"][0]["code"], "MTEK-E9005");
    assert_eq!(
        human(&report),
        "\
error[MTEK-E9005]: Entry file 'src/main.mtek' not found.
  = help: 'src/Main.mtek' exists; file names are case-sensitive, so use that spelling in project.entry
  = help: create the file or set project.entry in mtek.toml to the entry module

"
    );
}

#[test]
fn host_inputs_are_kept_and_the_project_still_loads() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        format!("{MINIMAL}[host.inputs]\ntint = \"Demo.tint\"\n"),
    )
    .insert(p("src/main.mtek"), "");
    let (project, report) = run(&fs, "");
    let project = project.expect("project loads with host.inputs");
    assert!(report.diagnostics.is_empty());
    assert_eq!(
        project.config.host_inputs.get("tint").map(String::as_str),
        Some("Demo.tint")
    );
}

#[test]
fn every_problem_of_a_file_is_reported_in_one_run() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        "[project]\nname = \"Bad\"\nlanguage = \"0.2\"\n[build]\ntarget = \"native\"\n[dev]\nport = 70000\nhost = \"x\"\n",
    );
    let (project, report) = run(&fs, "");
    assert!(project.is_none());
    assert_eq!(report.summary.errors, 5);
    let codes: Vec<&str> = report.diagnostics.iter().map(|d| d.code.short()).collect();
    assert_eq!(codes, ["E9001"; 5]);
    assert_schema_valid(&report, &SourceMap::new());
}

#[test]
fn project_loading_is_independent_of_directory_listing_order() {
    let files = [
        ("mtek.toml", MINIMAL),
        ("src/main.mtek", "scene Demo { }\n"),
        ("src/a.mtek", ""),
        ("src/b.mtek", ""),
    ];
    let reference = {
        let mut fs = MemFs::new();
        for (path, text) in files {
            fs.insert(p(path), text);
        }
        let (project, _) = run(&fs, "src");
        let project = project.unwrap();
        (project.config, project.modules)
    };
    for seed in 0..8 {
        let mut fs = MemFs::new().with_shuffled_listing(seed);
        for (path, text) in files {
            fs.insert(p(path), text);
        }
        let (project, report) = run(&fs, "src");
        let project = project.unwrap();
        assert!(report.diagnostics.is_empty());
        assert_eq!((project.config, project.modules), reference, "seed {seed}");
    }
}

#[test]
fn a_failed_load_reports_codes_from_the_catalogue() {
    // The codes this task is responsible for exist with the spec titles.
    for (code, title) in [
        (Code::E9001, "invalid project configuration"),
        (Code::E9004, "project file not found"),
        (Code::E9005, "entry file not found"),
        (Code::E9010, "not implemented by this compiler build"),
    ] {
        assert_eq!(code.title(), title);
    }
}
