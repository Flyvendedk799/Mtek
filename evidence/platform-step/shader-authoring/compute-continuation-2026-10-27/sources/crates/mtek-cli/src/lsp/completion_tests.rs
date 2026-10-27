//! Tests of completion against real projects on disk: each context of the table of
//! `completion.rs`, the filtering by scope, and the texts nothing can be completed in.

use lsp_types::CompletionItemKind;
use mtek_compiler::source::ProjectPath;

use super::completion::{Candidate, Completion, complete};
use super::overlay::Buffers;
use super::testkit::{TempProject, cursor};

const LIB: &str = "\
/// A point light.
export struct Light {
    /// How bright it is.
    intensity: f32;
    position: vec3;
}

/// Doubles a number.
export fn double(x: f32) -> f32 {
    return x * 2.0;
}

export prefab Marker {
    param size: f32 = 1.0;
    mesh: Box { size: vec3(1.0, 1.0, 1.0) };
}
";

/// The entry module; the tests replace a part of it with text that has the cursor marker.
const MAIN: &str = "\
import { Light, double, Marker } from \"./lib.mtek\";

const SPEED: f32 = 0.7;

material Pulse {
    param tint: color = #6b5cff;
    param phase: f32 = 0.0;
    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb, 1.0);
    }
}

fn unrelated(q: f32) -> f32 {
    let inner = q;
    return inner;
}

scene Demo {
    state speed: f32 = SPEED;
    camera Main { position: vec3(0.0, 2.0, 5.0); }
    entity Cube {
        state hits: i32 = 0;
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Pulse { tint: #ffffff };
        update(dt: f32) {
            let angle = double(speed) * dt;
            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), angle);
        }
    }
    on key_down(Key.Space) {
        speed = -speed;
    }
}
";

fn run(main: &str) -> Option<Completion> {
    let (text, offset) = cursor(main);
    let project = TempProject::new(&[("src/lib.mtek", LIB), ("src/main.mtek", &text)]);
    complete(
        &project.dir,
        &Buffers::new(),
        &ProjectPath::new("src/main.mtek").unwrap(),
        &text,
        offset,
        None,
    )
}

/// The completion with the cursor marker replacing `old` in the fixture by `new`.
fn at(old: &str, new: &str) -> Completion {
    assert!(MAIN.contains(old), "{old}");
    run(&MAIN.replacen(old, new, 1)).expect("something can be completed there")
}

fn labels(completion: &Completion) -> Vec<&str> {
    completion
        .candidates
        .iter()
        .map(|c| c.label.as_str())
        .collect()
}

fn find<'a>(completion: &'a Completion, label: &str) -> &'a Candidate {
    completion
        .candidates
        .iter()
        .find(|c| c.label == label)
        .unwrap_or_else(|| panic!("no candidate {label:?} in {:?}", labels(completion)))
}

fn assert_has(completion: &Completion, wanted: &[&str]) {
    for label in wanted {
        find(completion, label);
    }
}

fn assert_lacks(completion: &Completion, unwanted: &[&str]) {
    for label in unwanted {
        assert!(
            !completion.candidates.iter().any(|c| c.label == *label),
            "{label:?} must not be offered here: {:?}",
            labels(completion)
        );
    }
}

#[test]
fn enum_members_after_the_enum_name() {
    let c = at("Key.Space", "Key.\u{a7}Space");
    assert_has(&c, &["Space", "A", "Digit1", "ArrowLeft"]);
    assert_lacks(&c, &["sin", "Key", "speed"]);
    assert!(
        c.candidates
            .iter()
            .all(|c| c.kind == CompletionItemKind::ENUM_MEMBER)
    );
    assert_eq!(
        find(&c, "Space").detail.as_deref(),
        Some("Key (KeyboardEvent.code `Space`)")
    );
    // Nothing typed yet: the candidates replace nothing.
    assert_eq!(c.replace.0, c.replace.1);
}

#[test]
fn enum_members_while_typing_a_member_name() {
    let c = at("Key.Space", "Key.Sp\u{a7}ace");
    assert_has(&c, &["Space"]);
    // The part before the cursor is what a candidate replaces.
    let (text, offset) = cursor(&MAIN.replacen("Key.Space", "Key.Sp\u{a7}ace", 1));
    assert_eq!(c.replace, (offset - 2, offset));
    assert_eq!(&text[c.replace.0 as usize..c.replace.1 as usize], "Sp");
}

#[test]
fn namespace_members_after_the_namespace_name() {
    let c = at("quat.axis_angle", "quat.\u{a7}axis_angle");
    assert_has(&c, &["identity", "axis_angle", "euler"]);
    assert_eq!(find(&c, "axis_angle").kind, CompletionItemKind::FUNCTION);
    assert!(
        find(&c, "axis_angle")
            .detail
            .as_deref()
            .unwrap()
            .starts_with("axis_angle(")
    );
    let c = at("speed = -speed;", "frame.\u{a7}");
    assert_has(&c, &["time", "delta", "index"]);
    assert_eq!(find(&c, "time").kind, CompletionItemKind::PROPERTY);
}

#[test]
fn schema_fields_in_a_descriptor() {
    let c = at("Box { size: vec3(1.0, 1.0, 1.0) }", "Box { \u{a7} }");
    assert_has(&c, &["size"]);
    assert_lacks(&c, &["radius", "position", "sin"]);
    assert_eq!(find(&c, "size").kind, CompletionItemKind::FIELD);
    assert_eq!(
        find(&c, "size").detail.as_deref(),
        Some("size: vec3 = vec3(1.0, 1.0, 1.0)")
    );
    assert!(find(&c, "size").documentation.is_some());
    // The same while a name is being typed.
    let c = at("Box { size: vec3(1.0, 1.0, 1.0) }", "Box { si\u{a7} }");
    assert_has(&c, &["size"]);
}

#[test]
fn fields_already_written_are_not_offered_again() {
    let c = at(
        "material: Pulse { tint: #ffffff }",
        "material: Pulse { tint: #ffffff; \u{a7} }",
    );
    assert_has(&c, &["phase"]);
    assert_lacks(&c, &["tint"]);
    let c = at(
        "material: Pulse { tint: #ffffff }",
        "material: Pulse { \u{a7} }",
    );
    assert_has(&c, &["tint", "phase"]);
    assert_eq!(
        find(&c, "tint").detail.as_deref(),
        Some("param tint: color = #6b5cff")
    );
}

#[test]
fn struct_and_prefab_fields_in_a_descriptor() {
    let c = at("speed = -speed;", "let l = Light { \u{a7} };");
    assert_has(&c, &["intensity", "position"]);
    assert_eq!(
        find(&c, "intensity").detail.as_deref(),
        Some("intensity: f32")
    );
    let c = at("speed = -speed;", "let m = spawn(Marker { \u{a7} });");
    assert_has(&c, &["size"]);
}

#[test]
fn members_of_an_entity_body_and_of_a_scene_body() {
    let c = at("state hits: i32 = 0;", "\u{a7}");
    assert_has(
        &c,
        &[
            "position", "rotation", "scale", "light", "body", "state", "update", "on", "entity",
        ],
    );
    assert_lacks(&c, &["clear_color", "sin", "param"]);
    assert_eq!(find(&c, "state").kind, CompletionItemKind::KEYWORD);
    // Fields written in the body are not offered again.
    assert_lacks(&c, &["mesh", "material"]);
    let c = at("state speed: f32 = SPEED;", "\u{a7}");
    assert_has(
        &c,
        &[
            "clear_color",
            "ambient_color",
            "gravity",
            "state",
            "entity",
            "camera",
            "on",
            "update",
        ],
    );
    assert_lacks(&c, &["position", "param"]);
    let c = at(
        "camera Main { position: vec3(0.0, 2.0, 5.0); }",
        "camera Main { \u{a7} }",
    );
    assert_has(&c, &["position", "target", "active"]);
    assert_lacks(&c, &["clear_color"]);
}

#[test]
fn material_and_item_level_keywords() {
    let c = at("param phase: f32 = 0.0;", "\u{a7}");
    assert_has(&c, &["param", "fragment", "vertex"]);
    let c = at("const SPEED: f32 = 0.7;", "\u{a7}");
    assert_has(
        &c,
        &[
            "import", "export", "const", "fn", "struct", "material", "prefab", "scene",
        ],
    );
    assert_lacks(&c, &["position"]);
}

#[test]
fn names_in_scope_intrinsics_and_constructors_where_a_value_is_written() {
    let c = at("double(speed) * dt", "sm\u{a7} * dt");
    // The standard library.
    assert_has(
        &c,
        &[
            "smoothstep",
            "sin",
            "length",
            "vec3",
            "f32",
            "quat",
            "frame",
            "Key",
            "Box",
        ],
    );
    // The scope: the parameter, the state, the constant, the import, the entity.
    assert_has(
        &c,
        &[
            "dt", "speed", "SPEED", "double", "Cube", "hits", "Pulse", "Light",
        ],
    );
    assert_eq!(find(&c, "dt").kind, CompletionItemKind::VARIABLE);
    assert_eq!(find(&c, "dt").detail.as_deref(), Some("dt: f32"));
    assert_eq!(
        find(&c, "speed").detail.as_deref(),
        Some("state speed: f32")
    );
    assert_eq!(find(&c, "SPEED").kind, CompletionItemKind::CONSTANT);
    assert_eq!(find(&c, "double").kind, CompletionItemKind::FUNCTION);
    assert_eq!(
        find(&c, "double").detail.as_deref(),
        Some("fn double(x: f32) -> f32")
    );
    assert_eq!(find(&c, "smoothstep").kind, CompletionItemKind::FUNCTION);
    // The program's names come before the library's.
    let order = labels(&c);
    let position = |label: &str| order.iter().position(|l| *l == label).unwrap();
    assert!(position("dt") < position("speed") && position("speed") < position("sin"));
    // Not in scope here: another function's parameter and local, the scene's own name.
    assert_lacks(&c, &["q", "inner", "Demo", "tint", "phase", "input"]);
}

#[test]
fn a_local_is_visible_after_its_declaration_only() {
    let c = at("self.rotation *=", "\u{a7} self.rotation *=");
    assert_has(&c, &["angle", "dt"]);
    let c = at("let angle = double(speed) * dt;", "let angle = \u{a7};");
    assert_lacks(&c, &["angle"]);
    assert_has(&c, &["dt"]);
}

#[test]
fn statement_keywords_only_at_the_start_of_a_statement() {
    let c = at("self.rotation *=", "\u{a7} self.rotation *=");
    assert_has(&c, &["let", "var", "if", "for", "return", "const"]);
    let c = at("double(speed) * dt", "\u{a7}");
    assert_lacks(&c, &["let", "var", "if", "return"]);
    assert_has(&c, &["true", "false", "self"]);
}

#[test]
fn members_of_a_material_body_see_its_params() {
    let c = at("tint.rgb", "\u{a7}");
    assert_has(&c, &["tint", "phase", "input"]);
    assert_lacks(&c, &["speed", "Cube", "hits"]);
}

#[test]
fn types_in_a_type_position() {
    let c = at(
        "let angle = double(speed) * dt;",
        "let angle: \u{a7} = 1.0;",
    );
    assert_has(
        &c,
        &[
            "f32",
            "vec3",
            "color",
            "SurfaceInput",
            "VertexInput",
            "Light",
        ],
    );
    assert_lacks(&c, &["sin", "speed", "double", "Key"]);
}

#[test]
fn members_of_an_entity_and_its_material() {
    let c = at("speed = -speed;", "Cube.\u{a7}");
    assert_has(
        &c,
        &["position", "rotation", "scale", "mesh", "material", "hits"],
    );
    assert_eq!(find(&c, "hits").detail.as_deref(), Some("state hits: i32"));
    assert_lacks(&c, &["clear_color", "sin"]);
    let c = at("speed = -speed;", "Cube.material.\u{a7}");
    assert_has(&c, &["tint", "phase"]);
    assert_lacks(&c, &["position"]);
    assert_eq!(
        find(&c, "phase").detail.as_deref(),
        Some("param phase: f32")
    );
    let c = at("self.rotation *=", "self.\u{a7}");
    assert_has(&c, &["position", "rotation", "hits"]);
    let c = at(
        "camera Main { position: vec3(0.0, 2.0, 5.0); }",
        "camera Main { position: vec3(0.0, 2.0, 5.0); }\n    on key_up(Key.A) { Main.\u{a7} }",
    );
    assert_has(&c, &["position", "target", "projection", "exposure"]);
}

#[test]
fn members_of_a_builtin_material_are_its_params() {
    // Decision 0087: `Name.material.` of a built-in `Pbr` and of the default `Unlit {}` of a mesh.
    let c = at(
        "    on key_down(Key.Space) {",
        "    entity Ball { mesh: Sphere {}; material: Pbr { roughness: 0.25 }; }\n    entity Plain { mesh: Box {}; }\n    on key_down(Key.Enter) { Ball.material.\u{a7} }\n    on key_down(Key.Space) {",
    );
    assert_has(
        &c,
        &[
            "base_color",
            "metallic",
            "roughness",
            "base_color_texture",
            "base_color_sampler",
        ],
    );
    assert_lacks(&c, &["position", "tint"]);
    let c = at(
        "    on key_down(Key.Space) {",
        "    entity Plain { mesh: Box {}; }\n    on key_down(Key.Enter) { Plain.material.\u{a7} }\n    on key_down(Key.Space) {",
    );
    assert_has(&c, &["color"]);
    assert_lacks(&c, &["roughness", "position"]);
}

#[test]
fn components_of_vectors_colours_and_fields_of_structs() {
    let c = at(
        "speed = -speed;",
        "let v = vec3(0.0, 1.0, 0.0);\n        v.\u{a7}",
    );
    assert_eq!(labels(&c), ["x", "y", "z"]);
    let c = at(
        "speed = -speed;",
        "let v = vec2(0.0, 1.0);\n        v.\u{a7}",
    );
    assert_eq!(labels(&c), ["x", "y"]);
    let c = at("speed = -speed;", "let k = #ffffff;\n        k.\u{a7}");
    assert_has(&c, &["r", "g", "b", "a", "rgb"]);
    let c = at(
        "speed = -speed;",
        "let l = Light { intensity: 1.0; position: vec3(0.0, 0.0, 0.0); };\n        l.\u{a7}",
    );
    assert_eq!(labels(&c), ["intensity", "position"]);
    assert_eq!(
        find(&c, "position").detail.as_deref(),
        Some("position: vec3")
    );
    let c = at(
        "return color.linear(tint.rgb, 1.0);",
        "return input.\u{a7};",
    );
    assert_has(&c, &["uv", "world_position", "world_normal"]);
}

#[test]
fn events_after_on_and_prefabs_after_the_entity_colon() {
    let c = at("on key_down(Key.Space)", "on \u{a7}(Key.Space)");
    assert_has(&c, &["key_down", "key_up"]);
    assert_lacks(&c, &["sin", "update"]);
    let c = at(
        "entity Cube {",
        "entity Other: \u{a7} {}\n    entity Cube {",
    );
    assert_eq!(labels(&c), ["Marker"]);
}

#[test]
fn nothing_is_offered_in_comments_strings_and_numbers() {
    for (old, new) in [
        ("speed = -speed;", "// a comment \u{a7}"),
        ("speed = -speed;", "/* block \u{a7} */"),
        ("speed = -speed;", "/// doc \u{a7}"),
        ("speed = -speed;", "let s = \"te\u{a7}xt\";"),
        ("speed = -speed;", "let n = 12\u{a7};"),
        ("speed = -speed;", "let n = 1.5\u{a7};"),
        ("speed = -speed;", "let c = #6b5c\u{a7}ff;"),
    ] {
        let main = MAIN.replacen(old, new, 1);
        assert!(run(&main).is_none(), "{new}");
    }
    // Just after a comment on a line of its own, and after a string, completion works again.
    assert!(run(&MAIN.replacen("speed = -speed;", "// c\n        \u{a7}", 1)).is_some());
    assert!(run(&MAIN.replacen("speed = -speed;", "let s = \"t\"\u{a7};", 1)).is_some());
}

#[test]
fn a_cursor_in_the_middle_of_a_multibyte_text_is_fine() {
    // Astral and two-byte characters before the cursor: the offsets are bytes.
    let main = MAIN.replacen(
        "speed = -speed;",
        "// \u{1d54a}\u{e9}\nlet z = sm\u{a7};",
        1,
    );
    let c = run(&main).unwrap();
    assert_has(&c, &["smoothstep"]);
}

#[test]
fn broken_programs_still_complete() {
    for broken in [
        "Key.\u{a7}",
        "Box { \u{a7}",
        "scene \u{a7}",
        "entity \u{a7}",
        "fn \u{a7}",
        "}}}} \u{a7} {{{{",
        "let x: \u{a7}",
        "on \u{a7}",
        "import { \u{a7} } from",
        "(((\u{a7}",
    ] {
        // Whatever is offered, nothing panics and the answer is deterministic.
        let first = run(broken).map(|c| {
            labels(&c)
                .iter()
                .map(|s| (*s).to_owned())
                .collect::<Vec<_>>()
        });
        let second = run(broken).map(|c| {
            labels(&c)
                .iter()
                .map(|s| (*s).to_owned())
                .collect::<Vec<_>>()
        });
        assert_eq!(first, second, "{broken}");
    }
}

#[test]
fn a_file_outside_the_module_graph_has_no_completion() {
    let (text, offset) = cursor("fn f() { sm\u{a7} }");
    let project = TempProject::new(&[
        ("src/lib.mtek", LIB),
        ("src/main.mtek", MAIN),
        ("src/loose.mtek", &text),
    ]);
    let got = complete(
        &project.dir,
        &Buffers::new(),
        &ProjectPath::new("src/loose.mtek").unwrap(),
        &text,
        offset,
        None,
    );
    assert!(got.is_none());
}

/// A prefab with a body, a named instance of it and a handler, as the physics example writes them.
const PHYSICS: &str = "\
prefab Crate {
    param origin: vec3 = vec3(0.0, 0.5, 0.0);
    position: origin;
    mesh: Box { size: vec3(1.0, 1.0, 1.0); };
    body: Dynamic { mass: 2.0; };
    collider: BoxCollider { size: vec3(1.0, 1.0, 1.0); };
}

scene Playground {
    camera Main {}
    entity First: Crate { origin: vec3(0.0, 0.5, 0.0); }
    entity Wall {
        mesh: Box { size: vec3(1.0, 1.0, 1.0); };
        body: Static {};
        collider: BoxCollider { size: vec3(1.0, 1.0, 1.0); };
    }
    on key_down(Key.Space) {
        First.body.apply_impulse(vec3(0.0, 1.0, 0.0));
    }
}
";

#[test]
fn the_properties_and_commands_of_a_body_depend_on_its_kind() {
    let completion = |old: &str, new: &str| {
        let (text, offset) = cursor(&PHYSICS.replacen(old, new, 1));
        let project = TempProject::new(&[("src/main.mtek", &text)]);
        complete(
            &project.dir,
            &Buffers::new(),
            &ProjectPath::new("src/main.mtek").unwrap(),
            &text,
            offset,
            None,
        )
        .expect("something can be completed there")
    };
    let call = "First.body.apply_impulse(vec3(0.0, 1.0, 0.0));";
    // `First` is an instance of the prefab with a dynamic body: velocities and forces.
    let c = completion(call, "First.body.\u{a7}");
    assert_has(
        &c,
        &[
            "linear_velocity",
            "angular_velocity",
            "apply_impulse",
            "apply_force",
        ],
    );
    assert_eq!(find(&c, "apply_impulse").kind, CompletionItemKind::METHOD);
    assert_eq!(
        find(&c, "linear_velocity").kind,
        CompletionItemKind::PROPERTY
    );
    // `Wall` is static: it cannot be pushed, so no force or impulse is offered.
    let c = completion(call, "Wall.body.\u{a7}");
    assert_lacks(&c, &["apply_impulse", "apply_force"]);
    // The params of the prefab in the entity that instantiates it and in a spawn descriptor.
    let c = completion(
        "entity First: Crate { origin: vec3(0.0, 0.5, 0.0); }",
        "entity First: Crate { \u{a7} }",
    );
    assert_has(&c, &["origin", "position"]);
    let c = completion(call, "spawn(Crate { \u{a7} });");
    assert_has(&c, &["origin"]);
    assert_lacks(&c, &["position"]);
}

#[test]
fn authored_bounds_are_offered_on_entity_bodies_and_named_entity_values() {
    let fields = at("state hits: i32 = 0;", "§");
    assert_has(&fields, &["bounds_center", "bounds_radius"]);
    let values = at("self.rotation", "self.§rotation");
    assert_has(&values, &["bounds_center", "bounds_radius"]);
}

#[test]
fn standalone_compute_completes_declarations_and_invocation_fields() {
    let top = run("§
scene Demo { camera Main {} }")
    .unwrap();
    assert_has(&top, &["compute"]);
    let body = run("compute Scale { § }
scene Demo { camera Main {} }")
    .unwrap();
    assert_has(
        &body,
        &["param", "input", "output", "workgroup_size", "kernel"],
    );
    assert_lacks(&body, &["fragment", "vertex", "state"]);
    let fields = run("compute Scale { output result:array<f32,8>; kernel(i:ComputeInput)->f32 { let x = i.§; return 0.0; } } scene Demo { camera Main {} }").unwrap();
    assert_has(
        &fields,
        &[
            "index",
            "global_x",
            "local_y",
            "group_z",
            "group_count_x",
            "local_index",
        ],
    );
}
