//! Every JSON diagnostic and report this crate produces must validate against
//! `spec/diagnostic.schema.json` (JSON Schema draft 2020-12). Validation uses
//! the `jsonschema` crate, a dev-dependency only (decision 0007).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use jsonschema::Validator;
use mtek_compiler::diagnostics::{
    Code, Diagnostic, Diagnostics, Phase, RuntimePhase, SuggestedEdit, to_envelope, to_report,
};
use mtek_compiler::source::{FileId, ProjectPath, SourceMap, Span};
use serde_json::{Value, json};

const SCHEMA: &str = include_str!("../../../spec/diagnostic.schema.json");

fn schema() -> Value {
    serde_json::from_str(SCHEMA).unwrap()
}

/// A validator for the whole schema, or for one of its `$defs`.
fn validator(def: Option<&str>) -> Validator {
    let root = schema();
    let schema = match def {
        None => root,
        Some(name) => json!({
            "$schema": root["$schema"],
            "$defs": root["$defs"],
            "$ref": format!("#/$defs/{name}"),
        }),
    };
    jsonschema::draft202012::new(&schema).unwrap()
}

fn errors(validator: &Validator, instance: &Value) -> Vec<String> {
    validator
        .iter_errors(instance)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect()
}

fn assert_valid(validator: &Validator, instance: &Value) {
    let problems = errors(validator, instance);
    assert!(
        problems.is_empty(),
        "{problems:#?}\n{}",
        serde_json::to_string_pretty(instance).unwrap()
    );
}

fn assert_invalid(validator: &Validator, instance: &Value) {
    assert!(
        !validator.is_valid(instance),
        "expected a schema violation for:\n{}",
        serde_json::to_string_pretty(instance).unwrap()
    );
}

fn map() -> SourceMap {
    let mut map = SourceMap::new();
    map.add(
        ProjectPath::new("src/main.mtek").unwrap(),
        "\u{FEFF}let caf\u{e9} = 1.;\r\nlet b = \u{1F600};\r\n".as_bytes(),
    )
    .unwrap();
    map.add(
        ProjectPath::new("src/lib.mtek").unwrap(),
        b"export fn f() {}\n",
    )
    .unwrap();
    map
}

/// A diagnostic of `code` using every optional feature.
fn rich(code: Code) -> Diagnostic {
    let f = FileId(0);
    Diagnostic::new(code, format!("Something about {code}."))
        .label(Span::new(f, 3, 12), "primary text")
        .related(Span::new(f, 20, 25), "related text")
        .related_span(Span::new(FileId(1), 0, 6))
        .expected("f32")
        .actual("vec3")
        .help("try this")
        .note("and this")
        .edit(SuggestedEdit::new("use a float literal").replace(Span::new(f, 12, 14), "1.0"))
}

#[test]
fn the_schema_is_a_valid_draft_2020_12_schema() {
    let schema = schema();
    assert_eq!(
        schema["$schema"],
        json!("https://json-schema.org/draft/2020-12/schema")
    );
    assert!(jsonschema::meta::is_valid(&schema));
    for name in [
        "diagnostic",
        "source",
        "related",
        "suggestedEdit",
        "textEdit",
        "report",
    ] {
        assert!(schema["$defs"].get(name).is_some(), "missing $defs/{name}");
    }
}

#[test]
fn every_catalogue_code_produces_a_valid_envelope() {
    let map = map();
    let validate = validator(Some("diagnostic"));
    let root = validator(None);
    for &code in Code::ALL {
        for d in [
            rich(code),
            Diagnostic::new(code, "no location"),
            Diagnostic::new(code, "only a span").at(Span::new(FileId(0), 0, 0)),
        ] {
            let value = to_envelope(&d, &map);
            assert_valid(&validate, &value);
            assert_valid(&root, &value);
            // The envelope agrees with the catalogue.
            assert_eq!(value["code"], json!(code.as_str()));
            assert_eq!(value["title"], json!(code.title()));
            assert_eq!(value["severity"], json!(code.severity().as_str()));
            let letter = &code.as_str()["MTEK-".len().."MTEK-".len() + 1];
            assert_eq!(letter, code.severity().letter());
        }
    }
}

#[test]
fn every_runtime_phase_is_valid() {
    let map = map();
    let validate = validator(Some("diagnostic"));
    for phase in RuntimePhase::ALL {
        let d = Diagnostic::new(Code::E8051, "pipeline failed").phase(Phase::Runtime(phase));
        let value = to_envelope(&d, &map);
        assert_eq!(value["phase"], json!(format!("runtime:{}", phase.as_str())));
        assert_valid(&validate, &value);
    }
    for phase in [Phase::Parse, Phase::Check, Phase::Emit, Phase::Validate] {
        let d = Diagnostic::new(Code::E1001, "x").phase(phase);
        assert_valid(&validate, &to_envelope(&d, &map));
    }
}

#[test]
fn source_errors_become_valid_envelopes() {
    let map = SourceMap::new();
    let mut scratch = SourceMap::new();
    let err = scratch
        .add(ProjectPath::new("a.mtek").unwrap(), b"ok\xFF")
        .unwrap_err();
    let value = to_envelope(&Diagnostic::from_source_error(&err), &map);
    assert_valid(&validator(Some("diagnostic")), &value);
    assert_eq!(value["code"], json!("MTEK-E0001"));
}

#[test]
fn a_report_validates_in_both_forms() {
    let map = map();
    let mut sink = Diagnostics::new();
    for &code in Code::ALL {
        sink.push(rich(code));
    }
    sink.push(Diagnostic::new(Code::E9004, "No mtek.toml."));
    let report = sink.finish();
    for project in [Some("pulse-cube"), None] {
        let value = to_report(&report, project, &map);
        assert_valid(&validator(Some("report")), &value);
        assert_valid(&validator(None), &value);
    }
    // An empty report is valid too.
    let empty = Diagnostics::new().finish();
    assert_valid(&validator(None), &to_report(&empty, Some("p"), &map));
}

#[test]
fn a_capped_report_validates_and_counts_suppressed() {
    let map = map();
    let mut sink = Diagnostics::new();
    for i in 0..300 {
        sink.push(Diagnostic::new(Code::E1001, "x").at(Span::new(FileId(0), i % 20, i % 20 + 1)));
    }
    let value = to_report(&sink.finish(), Some("p"), &map);
    assert_valid(&validator(None), &value);
    assert_eq!(value["summary"]["suppressed"], json!(100));
    assert_eq!(value["summary"]["errors"], json!(200));
    assert_eq!(value["summary"]["warnings"], json!(1));
}

#[test]
fn the_two_shapes_are_mutually_exclusive() {
    let map = map();
    let diagnostic = to_envelope(&rich(Code::E3102), &map);
    let report = to_report(&Diagnostics::new().finish(), Some("p"), &map);
    assert_invalid(&validator(Some("report")), &diagnostic);
    assert_invalid(&validator(Some("diagnostic")), &report);
    assert_valid(&validator(None), &diagnostic);
    assert_valid(&validator(None), &report);
}

fn mutate(mut value: Value, change: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Value {
    if let Some(object) = value.as_object_mut() {
        change(object);
    }
    value
}

#[test]
fn malformed_envelopes_are_rejected() {
    let map = map();
    let validate = validator(Some("diagnostic"));
    let good = to_envelope(&rich(Code::E3102), &map);
    assert_valid(&validate, &good);

    for required in [
        "schemaVersion",
        "code",
        "severity",
        "title",
        "message",
        "source",
        "related",
        "notes",
        "suggestedEdits",
        "phase",
        "docs",
    ] {
        assert_invalid(
            &validate,
            &mutate(good.clone(), |o| {
                o.remove(required);
            }),
        );
    }
    let bad: Vec<(&str, Value)> = vec![
        ("schemaVersion", json!(2)),
        ("code", json!("E3102")),
        ("code", json!("MTEK-X3102")),
        ("code", json!("MTEK-E310")),
        ("severity", json!("fatal")),
        ("title", json!("")),
        ("message", json!(7)),
        ("phase", json!("runtime:other")),
        ("phase", json!("runtime")),
        ("phase", json!("link")),
        ("docs", json!("diagnostics.md#mtek-e3102")),
        ("related", json!("none")),
        ("notes", json!([1])),
        ("suggestedEdits", json!([{ "description": "x" }])),
        ("expected", json!(3)),
        ("source", json!({})),
    ];
    for (key, value) in bad {
        assert_invalid(
            &validate,
            &mutate(good.clone(), |o| {
                o.insert(key.into(), value);
            }),
        );
    }
    // Unknown top-level keys are rejected.
    assert_invalid(
        &validate,
        &mutate(good.clone(), |o| {
            o.insert("extra".into(), json!(true));
        }),
    );
    // A source needs every position field, with 1-based lines and columns.
    for key in [
        "file",
        "startByte",
        "endByte",
        "startLine",
        "startColumn",
        "endLine",
        "endColumn",
    ] {
        let mut broken = good.clone();
        if let Some(source) = broken["source"].as_object_mut() {
            source.remove(key);
        }
        assert_invalid(&validate, &broken);
    }
    for key in ["startLine", "startColumn", "endLine", "endColumn"] {
        let mut broken = good.clone();
        broken["source"][key] = json!(0);
        assert_invalid(&validate, &broken);
    }
    let mut negative = good.clone();
    negative["source"]["startByte"] = json!(-1);
    assert_invalid(&validate, &negative);
    // A related entry must have a source.
    let mut related = good.clone();
    related["related"] = json!([{ "message": "no source" }]);
    assert_invalid(&validate, &related);
    // Null source is valid (project-level diagnostics).
    let mut project_level = good;
    project_level["source"] = Value::Null;
    assert_valid(&validate, &project_level);
}

#[test]
fn malformed_reports_are_rejected() {
    let map = map();
    let validate = validator(Some("report"));
    let good = to_report(&Diagnostics::new().finish(), Some("p"), &map);
    assert_valid(&validate, &good);
    for required in [
        "schemaVersion",
        "tool",
        "compilerVersion",
        "languageVersion",
        "project",
        "diagnostics",
        "summary",
    ] {
        assert_invalid(
            &validate,
            &mutate(good.clone(), |o| {
                o.remove(required);
            }),
        );
    }
    assert_invalid(
        &validate,
        &mutate(good.clone(), |o| {
            o.insert("tool".into(), json!("other"));
        }),
    );
    assert_invalid(
        &validate,
        &mutate(good.clone(), |o| {
            o.insert("summary".into(), json!({ "errors": 0 }));
        }),
    );
    assert_invalid(
        &validate,
        &mutate(good.clone(), |o| {
            o.insert("diagnostics".into(), json!([{ "code": "MTEK-E1001" }]));
        }),
    );
    assert_invalid(
        &validate,
        &mutate(good, |o| {
            o.insert("project".into(), json!(5));
        }),
    );
}
