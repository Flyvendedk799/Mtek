//! Constants in CPU lifecycle and event bodies use the ordinary constant evaluator.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, build, check};

fn project(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"constants\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

fn body_sources(body: &str) -> Vec<String> {
    let mut sources = Vec::new();
    for signature in [
        "update(dt: f32)",
        "fixed_update(dt: f32)",
        "on key_down(Key.Space)",
    ] {
        let member = format!("{signature} {{ {body} }}");
        sources.extend([
            format!("scene Demo {{ camera Main {{}} {member} }}"),
            format!("scene Demo {{ camera Main {{}} entity A {{ {member} }} }}"),
            format!("scene Demo {{ camera Main {{}} entity A {{ entity B {{ {member} }} }} }}"),
            format!("prefab P {{ {member} }} scene Demo {{ camera Main {{}} entity A: P {{}} }}"),
            format!("prefab P {{ entity B {{ {member} }} }} scene Demo {{ camera Main {{}} entity A: P {{}} }}"),
        ]);
    }
    sources
}

#[test]
fn lifecycle_constants_build_in_all_owners_and_nested_blocks() {
    let body = "let dt_value = 0.0; const INDEX = 1; let values = [10.0, 20.0]; let result = values[INDEX];
        { const BLOCK = INDEX + 1; let block = BLOCK; }
        if dt_value > 0.0 { const THEN = INDEX; let yes = THEN; }
        else if dt_value < 0.0 { const ELSE_IF = INDEX; let no = ELSE_IF; }
        else { const ELSE = INDEX; let zero = ELSE; }
        for i in 0..2 { const LOOP = INDEX; let item = values[LOOP]; }";
    for source in body_sources(body) {
        let fs = project(&source);
        for mode in [
            BuildMode::Release,
            BuildMode::Preview,
            BuildMode::Dev,
            BuildMode::Test,
        ] {
            let result = build(
                &ProjectRoot::at_base(),
                &fs,
                &CompileOptions::with_stub_runtime(mode),
            );
            assert!(
                !result.has_errors(),
                "{mode:?}: {source}: {:#?}",
                result.report.diagnostics
            );
        }
    }
}

#[test]
fn lifecycle_constants_report_initializer_errors_in_all_owners() {
    for (body, expected) in [
        ("const BAD: i32 = 1 / 0;", Code::E3040),
        ("const BAD = frame.time;", Code::E3090),
        ("const BAD: i32 = true;", Code::E3001),
        // Block declarations retain lexical visibility: later constants are not in scope.
        ("const FIRST = SECOND; const SECOND = 1;", Code::E2003),
    ] {
        for source in body_sources(body) {
            let report = check(&ProjectRoot::at_base(), &project(&source)).report;
            let errors: Vec<_> = report
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.severity == Severity::Error)
                .map(|diagnostic| diagnostic.code)
                .collect();
            assert_eq!(errors, [expected], "{source}: {:#?}", report.diagnostics);
        }
    }
}
