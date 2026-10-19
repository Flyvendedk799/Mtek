//! Ambient CPU reads must not disappear behind user-function calls.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mtek_compiler::diagnostics::{Code, Diagnostic};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, build, check};

fn project(source: &str, helpers: Option<&str>) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"ambient-effects\"\nlanguage = \"0.1\"\n",
    );
    fs.insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    if let Some(helpers) = helpers {
        fs.insert(ProjectPath::new("src/helpers.mtek").unwrap(), helpers);
    }
    fs
}

fn diagnostics(fs: &MemFs) -> Vec<Diagnostic> {
    check(&ProjectRoot::at_base(), fs).report.diagnostics
}

fn built(fs: &MemFs) -> mtek_compiler::BuildResult {
    let result = build(
        &ProjectRoot::at_base(),
        fs,
        &CompileOptions::with_stub_runtime(BuildMode::Dev),
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    assert!(!result.files.is_empty());
    result
}

#[test]
fn pure_helpers_cannot_read_any_frame_member_or_body_property() {
    for (params, result, read) in [
        ("", "f32", "frame.time"),
        ("", "f32", "frame.delta"),
        ("", "u32", "frame.index"),
        ("r: entity_ref", "vec3", "r.body.linear_velocity"),
        ("r: entity_ref", "vec3", "r.body.angular_velocity"),
    ] {
        let fs = project(
            &format!(
                "fn read_value({params}) -> {result} {{ return {read}; }}\nscene Demo {{ camera Main {{}} }}"
            ),
            None,
        );
        let found = diagnostics(&fs);
        assert_eq!(found.len(), 1, "{read}: {found:#?}");
        assert_eq!(found[0].code, Code::E4002, "{read}: {found:#?}");
        assert!(found[0].message.contains("ambient CPU state"));
        assert!(found[0].primary.is_some());
    }
}

#[test]
fn ambient_effects_propagate_through_imported_pure_helpers() {
    let fs = project(
        "import { wrapped } from \"./helpers.mtek\";\nfn caller() -> f32 { return wrapped(); }\nscene Demo { camera Main {} state value: f32 = caller(); }",
        Some(
            "fn read_value() -> f32 { return frame.time; }\nexport fn wrapped() -> f32 { return read_value(); }",
        ),
    );
    let found = diagnostics(&fs);
    assert_eq!(found.len(), 3, "{found:#?}");
    assert!(found.iter().all(|d| d.code == Code::E4002));
    let caller = found
        .iter()
        .find(|d| d.message.contains("'caller'"))
        .unwrap();
    assert!(caller.message.contains("frame.time"));
    assert!(
        caller
            .notes
            .iter()
            .any(|note| note.contains("pass it explicitly"))
    );
    assert!(
        caller
            .notes
            .iter()
            .all(|note| !note.contains("declare 'caller' as `cpu fn`"))
    );
    assert!(caller.related.iter().any(|label| {
        label
            .message
            .as_ref()
            .is_some_and(|m| m.contains("reads `frame.time`"))
    }));
}

#[test]
fn gpu_helper_capture_is_a_source_diagnostic_in_check_and_build() {
    let fs = project(
        "import { wrapped } from \"./helpers.mtek\";\nmaterial Clock { fragment(input: SurfaceInput) -> color { return color.linear(vec3(wrapped()), 1.0); } }\nscene Demo { camera Main {} entity A { mesh: Box {}; material: Clock {}; } }",
        Some(
            "fn read_value() -> f32 { return frame.time; }\nexport fn wrapped() -> f32 { return read_value(); }",
        ),
    );
    let checked = diagnostics(&fs);
    let compiled = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Dev),
    );
    for found in [&checked, &compiled.report.diagnostics] {
        assert!(found.iter().all(|d| d.code != Code::E9999), "{found:#?}");
        let capture = found.iter().find(|d| d.code == Code::E4040).unwrap();
        assert!(capture.primary.is_some());
        assert!(capture.message.contains("frame.time"));
        assert!(capture.related.len() >= 3, "{capture:#?}");
    }
    assert!(compiled.files.is_empty());
}

#[test]
fn cpu_frame_helpers_keep_context_in_handlers_and_initialisers() {
    let fs = project(
        "cpu fn clock_value() -> f32 { return frame.time + frame.delta; }\ncpu fn wrapped() -> f32 { return clock_value(); }\nscene Demo { camera Main {} state elapsed: f32 = wrapped(); update(dt: f32) { elapsed = wrapped(); } }",
        None,
    );
    assert!(diagnostics(&fs).is_empty());
    let result = built(&fs);
    let js = String::from_utf8(result.files["app.js"].clone()).unwrap();
    assert!(js.contains("ctx.frame.time"));
    assert!(js.contains("ctx.frame.delta"));
    assert!(js.contains("_clock_value(ctx)"));
    assert!(js.contains("_wrapped(ctx)"));
}

#[test]
fn direct_frame_bindings_and_explicit_pure_arguments_keep_dependencies() {
    let fs = project(
        "fn scalar(value: f32) -> f32 { return value; }\nfn vector(value: vec3) -> vec3 { return value; }\nscene Demo { camera Main {} state observed: vec3 = vec3(0.0); entity Ball { body: Dynamic {}; collider: SphereCollider { radius: 0.5; }; } entity Gauge { position: bind(vec3(scalar(frame.time))); } update(dt: f32) { observed = vector(Ball.body.linear_velocity); } }",
        None,
    );
    assert!(diagnostics(&fs).is_empty());
    let result = built(&fs);
    let manifest: serde_json::Value =
        serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    let deps = &manifest["scene"]["bindings"][0]["deps"];
    assert_eq!(
        deps,
        &serde_json::json!([{ "kind": "frame", "name": "time" }])
    );
}

#[test]
fn cpu_body_helpers_are_valid_in_handlers_but_not_initialisation() {
    let helpers = "cpu fn velocity(r: entity_ref) -> vec3 { return r.body.linear_velocity; }\nexport cpu fn wrapped(r: entity_ref) -> vec3 { return velocity(r); }";
    let scene = "camera Main {} entity Ball { body: Dynamic {}; collider: SphereCollider { radius: 0.5; }; }";
    let valid = project(
        &format!(
            "import {{ wrapped }} from \"./helpers.mtek\"; scene Demo {{ {scene} state observed: vec3 = vec3(0.0); update(dt: f32) {{ observed = wrapped(Ball); }} }}"
        ),
        Some(helpers),
    );
    assert!(diagnostics(&valid).is_empty());
    let result = built(&valid);
    let js = String::from_utf8(result.files["app.js"].clone()).unwrap();
    assert!(js.contains("ctx.body(a_r,"));
    assert!(js.contains(".linearVelocity"));

    let invalid = project(
        &format!(
            "import {{ wrapped }} from \"./helpers.mtek\"; scene Demo {{ {scene} state observed: vec3 = wrapped(Ball); }}"
        ),
        Some(helpers),
    );
    let found = diagnostics(&invalid);
    assert_eq!(found.len(), 1, "{found:#?}");
    assert_eq!(found[0].code, Code::E5081);
    assert!(found[0].related.len() >= 3, "{found:#?}");
    assert!(found[0].message.contains("body.linear_velocity"));
}

#[test]
fn prefab_field_initialisation_cannot_hide_body_reads_in_cpu_helpers() {
    let fs = project(
        "cpu fn velocity(r: entity_ref) -> vec3 { return r.body.angular_velocity; }\nprefab Probe { param target: entity_ref; position: velocity(target); }\nscene Demo { camera Main {} }",
        None,
    );
    let found = diagnostics(&fs);
    assert_eq!(found.len(), 1, "{found:#?}");
    assert_eq!(found[0].code, Code::E5081);
    assert!(found[0].related.iter().any(|label| {
        label
            .message
            .as_ref()
            .is_some_and(|m| m.contains("initialiser of the field 'position'"))
    }));
}

#[test]
fn bindings_reject_cpu_helpers_and_direct_body_reads() {
    for expression in ["velocity(Ball)", "Ball.body.linear_velocity"] {
        let fs = project(
            &format!(
                "cpu fn velocity(r: entity_ref) -> vec3 {{ return r.body.linear_velocity; }}\nscene Demo {{ camera Main {{}} entity Ball {{ body: Dynamic {{}}; collider: SphereCollider {{ radius: 0.5; }}; }} entity Gauge {{ position: bind({expression}); }} }}"
            ),
            None,
        );
        let found = diagnostics(&fs);
        assert_eq!(found.len(), 1, "{expression}: {found:#?}");
        assert_eq!(found[0].code, Code::E5005);
    }
}

#[test]
fn a_pure_velocity_wrapper_cannot_produce_an_empty_dependency_binding() {
    let fs = project(
        "fn velocity(r: entity_ref) -> vec3 { return r.body.linear_velocity; }\nfn wrapped(r: entity_ref) -> vec3 { return velocity(r); }\nscene Demo { camera Main {} entity Ball { body: Dynamic {}; collider: SphereCollider { radius: 0.5; }; } entity Gauge { position: bind(wrapped(Ball)); } }",
        None,
    );
    let found = diagnostics(&fs);
    assert_eq!(found.len(), 2, "{found:#?}");
    assert!(found.iter().all(|d| d.code == Code::E4002));
    let result = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Dev),
    );
    assert!(result.has_errors());
    assert!(result.files.is_empty());
}

#[test]
fn cpu_frame_helpers_cannot_be_called_from_bindings_or_stages() {
    for (body, expected) in [
        (
            "scene Demo { camera Main {} entity A { position: bind(vec3(clock_value())); } }",
            Code::E5005,
        ),
        (
            "material Clock { fragment(input: SurfaceInput) -> color { return color.linear(vec3(clock_value()), 1.0); } } scene Demo { camera Main {} entity A { mesh: Box {}; material: Clock {}; } }",
            Code::E4040,
        ),
    ] {
        let fs = project(
            &format!("cpu fn clock_value() -> f32 {{ return frame.time; }}\n{body}"),
            None,
        );
        let found = diagnostics(&fs);
        assert_eq!(found.len(), 1, "{found:#?}");
        assert_eq!(found[0].code, expected);
    }
}

#[test]
fn stages_can_call_pure_helpers_with_explicit_material_params() {
    let fs = project(
        "fn scalar(value: f32) -> f32 { return value; }\nmaterial Clock { param phase: f32 = 0.0; fragment(input: SurfaceInput) -> color { return color.linear(vec3(scalar(phase)), 1.0); } }\nscene Demo { camera Main {} entity A { mesh: Box {}; material: Clock { phase: bind(frame.time); }; } }",
        None,
    );
    assert!(diagnostics(&fs).is_empty());
    let _ = built(&fs);
}
