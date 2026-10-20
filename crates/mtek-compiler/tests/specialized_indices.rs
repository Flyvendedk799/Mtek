//! Prefab parameter specialization preserves the run-time indexing contract.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::Code;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, build, check};

fn project(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"indices\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

#[test]
fn specialized_out_of_range_indices_build_in_every_mode() {
    let fs = project(include_str!(
        "../../../tests/codegen/assignable_places/src/main.mtek"
    ));
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
        assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
        let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
        // Preserve the signed input; treating -1 as u32::MAX would select the wrong end.
        assert!(app.contains("rt.clampIndex(-1, 2,"), "{mode:?}");
        assert!(app.contains("rt.clampIndex(4294967295, 2,"), "{mode:?}");
        assert!(app.contains("rt.clampIndex(-1, 4,"), "{mode:?}");
        assert!(app.contains("rt.clampIndex(4294967295, 4,"), "{mode:?}");
        assert!(
            app.contains("rt.clampIndex(self.params.low, 2,"),
            "{mode:?}"
        );
        assert!(
            app.contains("self.state.read_inside = l_values[1]"),
            "{mode:?}"
        );
    }
}

#[test]
fn source_constant_indices_still_report_e3030() {
    for operation in [
        "let result = values[-1];",
        "let result = values[4];",
        "let result = values[u32(-1)];",
        "values[-1] = 1.0;",
        "values[4] += 1.0;",
        "let result = mat4.identity()[4];",
    ] {
        let source = format!(
            "prefab Indexed {{ update(dt: f32) {{ var values = [10.0, 20.0]; {operation} }} }}\n\
             scene Demo {{ camera Main {{}} entity Instance: Indexed {{}} }}"
        );
        let report = check(&ProjectRoot::at_base(), &project(&source)).report;
        let errors: Vec<_> = report
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == mtek_compiler::diagnostics::Severity::Error)
            .map(|diagnostic| diagnostic.code)
            .collect();
        assert_eq!(
            errors,
            [Code::E3030],
            "{operation}: {:#?}",
            report.diagnostics
        );
    }
}
