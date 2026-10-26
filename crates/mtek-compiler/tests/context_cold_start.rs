//! The context of a project with no code to learn the library from (decision 0110): the
//! schemas, the enum members, the signatures of the built-ins and the conventions are generated
//! from the registry, complete, within the byte budget, and absent for a project that has code.
//!
//! The goldens are `tests/context/golden/{empty,scene-stub}.default.json`. To regenerate after an
//! intended change: `MTEK_BLESS=1 cargo test -p mtek-compiler --test context_cold_start`.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use mtek_compiler::context::model::REFERENCE_SECTIONS;
use mtek_compiler::context::reference::CONVENTIONS;
use mtek_compiler::context::{
    ContextError, ContextOptions, ContextOutput, DEFAULT_MAX_BYTES, SCHEMA_GUIDE,
    SCHEMA_GUIDE_DETAILED, context,
};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::IMPLEMENTED_MILESTONE;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::stdlib::{FieldDef, FieldRule, Milestone, NamespaceMember, TypeKind, registry};
use serde_json::Value;

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

/// A project whose only module is `main`.
fn project(main: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        TOML.as_bytes().to_vec(),
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        main.as_bytes().to_vec(),
    );
    fs
}

fn options(max_bytes: usize) -> ContextOptions {
    ContextOptions {
        entry: None,
        symbols: Vec::new(),
        max_bytes,
    }
}

fn run(fs: &MemFs, max_bytes: usize) -> Result<ContextOutput, ContextError> {
    context(&ProjectRoot::at_base(), fs, &options(max_bytes))
}

fn ok(main: &str) -> ContextOutput {
    run(&project(main), DEFAULT_MAX_BYTES).unwrap_or_else(|error| panic!("{error}"))
}

fn names(output: &ContextOutput) -> Vec<&str> {
    output
        .context
        .symbols
        .iter()
        .map(|s| s.name.as_str())
        .collect()
}

fn assert_valid(output: &ContextOutput) {
    let schema: Value =
        serde_json::from_str(&fs::read_to_string(repo("spec/context.schema.json")).unwrap())
            .unwrap();
    let validator: Validator = jsonschema::draft202012::new(&schema).unwrap();
    let instance: Value = serde_json::from_str(&output.text).unwrap();
    let problems: Vec<String> = validator
        .iter_errors(&instance)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}");
}

fn assert_golden(name: &str, text: &str) {
    let path = repo("tests/context/golden").join(name);
    if std::env::var_os("MTEK_BLESS").is_some_and(|v| v == "1") {
        // Replace rather than truncate: desktop editors can retain mapped golden files on Windows.
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, text).unwrap();
        fs::rename(&temporary, &path).unwrap();
        return;
    }
    let expected = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read golden {}: {e}\nGenerate it with: MTEK_BLESS=1 cargo test -p mtek-compiler --test context_cold_start",
            path.display()
        )
    });
    assert!(
        expected == text,
        "golden {name} differs from the output; if the change is intended regenerate with: \
         MTEK_BLESS=1 cargo test -p mtek-compiler --test context_cold_start"
    );
}

/// Whether the context of the entry module `main` is a cold-start context.
fn is_cold(main: &str) -> bool {
    !ok(main).context.reference.is_empty()
}

fn reached(since: Milestone) -> bool {
    since.is_reached_by(IMPLEMENTED_MILESTONE)
}

/// `name: type = default [flags]`, written out from the registry field independently of the
/// exporter: flag letters in the order R W B C.
fn expected_field_line(field: &FieldDef) -> String {
    let flags: String = [
        (field.flags.is_required(), 'R'),
        (field.flags.is_writable(), 'W'),
        (field.flags.is_bindable(), 'B'),
        (field.flags.is_construction_only(), 'C'),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .map(|(_, c)| *c)
    .collect();
    let mut line = format!("{}: {}", field.name, field.ty.spelling());
    if let Some(default) = field.default_text() {
        line.push_str(&format!(" = {default}"));
    }
    if !flags.is_empty() {
        line.push_str(&format!(" [{flags}]"));
    }
    line
}

/// Whether `line` gives the signature `needle` (`(a: T, b: T) -> T`): either as written, or as the
/// first part of overloads that only add trailing arguments, which a line writes once with the
/// optional arguments in brackets (`(a: T, [b: T]) -> T`, decision 0172).
fn lists_signature(line: &str, needle: &str) -> bool {
    if line.contains(needle) {
        return true;
    }
    let Some((params, ret)) = needle.split_once(") -> ") else {
        return false;
    };
    // Without the brackets the folded signature is the longest overload; the shorter ones are
    // its leading arguments, so `(a: T` is followed by `,` or `)` and the return type is the same.
    let flat = line.replace(['[', ']'], "");
    let shorter = params.to_owned();
    flat.match_indices(&shorter)
        .any(|(at, found)| matches!(flat[at + found.len()..].chars().next(), Some(',' | ')')))
        && flat.contains(&format!(") -> {ret}"))
        && (line.contains(", [") || line.contains("(["))
}

/// A `builtins` line that starts with `prefix`, has `name` among the `|`-separated alternatives
/// before the first `(` or `:`, and gives the signature `needle`.
fn builtin_line<'a>(
    lines: &'a [String],
    prefix: &str,
    name: &str,
    needle: &str,
) -> Option<&'a str> {
    lines.iter().map(String::as_str).find(|line| {
        line.strip_prefix(prefix).is_some_and(|rest| {
            let head = rest.split(['(', ':']).next().unwrap_or("");
            head.split('|').any(|alternative| alternative == name) && lists_signature(line, needle)
        })
    })
}

// ---------------------------------------------------------------------------
// what the context of an empty project holds
// ---------------------------------------------------------------------------

#[test]
fn an_empty_project_lists_every_schema_field_and_every_enum_member() {
    let output = ok("");
    assert_valid(&output);
    assert!(output.context.truncated.is_none());
    assert!(
        output.text.len() <= DEFAULT_MAX_BYTES,
        "{}",
        output.text.len()
    );
    let registry = registry();

    // Every field of every implemented schema, in registry order, with its documentation.
    let mut listed = 0;
    for schema in registry.schemas.iter().filter(|s| reached(s.since)) {
        let fields: Vec<_> = schema.fields.iter().filter(|f| reached(f.since)).collect();
        let entry = output
            .context
            .schemas
            .iter()
            .find(|s| s.name == schema.name);
        if fields.is_empty() {
            // A schema without fields (`Static`) is named by the field that takes it.
            assert!(entry.is_none(), "{}", schema.name);
            continue;
        }
        let entry = entry.unwrap_or_else(|| panic!("schema {} is missing", schema.name));
        assert_eq!(entry.doc.as_deref(), Some(schema.doc), "{}", schema.name);
        assert_eq!(entry.fields.len(), fields.len(), "{}", schema.name);
        for (line, field) in entry.fields.iter().zip(&fields) {
            assert!(
                line.starts_with(&expected_field_line(field)),
                "{}: {line}",
                schema.name
            );
            if !field.doc.is_empty() {
                assert!(
                    line.ends_with(&format!(" // {}", field.doc)),
                    "{}.{}: {line}",
                    schema.name,
                    field.name
                );
            }
            listed += 1;
        }
    }
    assert!(listed >= 45, "{listed}");
    // The ones a scene is made of, by name.
    for name in [
        "Scene",
        "Entity",
        "Camera",
        "Perspective",
        "Orthographic",
        "DirectionalLight",
        "PointLight",
        "Box",
        "Sphere",
        "Plane",
        "Unlit",
        "Pbr",
    ] {
        assert!(
            output.context.schemas.iter().any(|s| s.name == name),
            "{name}"
        );
    }
    let listed_names: Vec<&str> = output
        .context
        .schemas
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    let mut sorted = listed_names.clone();
    sorted.sort_unstable();
    assert_eq!(listed_names, sorted, "sorted by name");

    // Every member of every enum, as written after `Key.`.
    assert!(!registry.enums.is_empty());
    for def in registry.enums.iter().filter(|d| reached(d.since)) {
        let entry = output
            .context
            .reference
            .enums
            .iter()
            .find(|e| e.name == def.name)
            .unwrap();
        let expected: Vec<&str> = def
            .members
            .iter()
            .filter(|m| reached(m.since))
            .map(|m| m.name)
            .collect();
        assert_eq!(entry.members.split(' ').collect::<Vec<_>>(), expected);
        assert_eq!(entry.doc, def.doc);
    }
    let key = &output.context.reference.enums[0];
    for member in [
        "ArrowUp",
        "ArrowDown",
        "Space",
        "Digit0",
        "A",
        "Z",
        "ShiftLeft",
    ] {
        assert!(key.members.split(' ').any(|m| m == member), "{member}");
    }
    for invented in [
        "Up", "Down", "Left", "Right", "Shift", "KeyA", "Control", "Alt",
    ] {
        assert!(!key.members.split(' ').any(|m| m == invented), "{invented}");
    }
}

#[test]
fn an_empty_project_lists_the_signature_of_every_built_in() {
    let output = ok("");
    let reference = &output.context.reference;
    let registry = registry();

    for class in [
        "T = f32 | vec2 | vec3 | vec4",
        "I = i32 | u32",
        "V = vec2 | vec3 | vec4",
    ] {
        assert!(reference.type_classes.iter().any(|c| c == class), "{class}");
    }

    for def in registry.intrinsics.iter().filter(|d| reached(d.since)) {
        for signature in &def.signatures {
            assert!(
                builtin_line(&reference.builtins, "", def.name, &signature.text()).is_some(),
                "{}{}",
                def.name,
                signature.text()
            );
        }
    }
    for namespace in registry.namespaces.iter().filter(|n| reached(n.since)) {
        let prefix = format!("{}.", namespace.name);
        for member in &namespace.members {
            match member {
                NamespaceMember::Function(def) => {
                    for signature in &def.signatures {
                        assert!(
                            builtin_line(&reference.builtins, &prefix, def.name, &signature.text())
                                .is_some(),
                            "{prefix}{}{}",
                            def.name,
                            signature.text()
                        );
                    }
                }
                NamespaceMember::Value(value) => {
                    let wanted = format!("{prefix}{}: {}", value.name, value.ty.spelling());
                    assert!(
                        reference.builtins.iter().any(|l| l.starts_with(&wanted)),
                        "{wanted}"
                    );
                }
            }
        }
    }
    // The accessors of an asset handle are named in `supported.features`, not listed here.
    for ty in registry.types.iter().filter(|t| reached(t.since)) {
        for method in &ty.methods {
            let feature = format!("method:{}.{}", ty.name, method.name);
            assert!(
                output.context.supported.features.contains(&feature),
                "{feature}"
            );
            assert!(
                reference
                    .builtins
                    .iter()
                    .all(|l| !l.contains(&format!("<{}>", ty.name))),
                "{}",
                ty.name
            );
        }
    }
    // The ones models get wrong, spelled out.
    let has = |line: &str| reference.builtins.iter().any(|l| l.starts_with(line));
    assert!(has("color.linear(rgb: vec3, a: f32) -> color"));
    assert!(has("color.srgb(rgb: vec3, a: f32) -> color"));
    assert!(has("quat.euler(x: f32, y: f32, z: f32) -> quat"));
    assert!(has(
        "sample(t: texture, s: sampler, uv: vec2) -> vec4 [GPU]"
    ));
    assert!(has("asset.texture(path: string) -> texture"));
    assert!(has(
        "spawn(prefab: prefab descriptor) -> entity_ref [handler]"
    ));
    assert!(has("frame.delta: f32"));

    // Events, records and body commands.
    for event in registry.events.iter().filter(|e| reached(e.since)) {
        let wanted = format!("on {}(", event.name);
        let line = reference
            .events
            .iter()
            .find(|l| l.starts_with(&wanted))
            .unwrap();
        assert!(line.ends_with(&format!(" // {}", event.doc)), "{line}");
    }
    assert!(
        reference
            .events
            .iter()
            .any(|l| l.starts_with("on key_down(Key.<member>)"))
    );
    assert!(
        reference
            .events
            .iter()
            .any(|l| l.starts_with("on pointer_down(<name>: PointerEvent)"))
    );
    for ty in registry
        .types
        .iter()
        .filter(|t| reached(t.since) && t.kind == TypeKind::Record)
    {
        let line = reference
            .records
            .iter()
            .find(|l| l.starts_with(&format!("{} {{", ty.name)))
            .unwrap();
        for field in &ty.fields {
            assert!(
                line.contains(&format!("{}: {}", field.name, field.ty.spelling())),
                "{line}"
            );
        }
    }
    for command in registry.body_commands.iter().filter(|c| reached(c.since)) {
        let wanted = format!(".body.{}(", command.name);
        let line = reference.body.iter().find(|l| l.contains(&wanted)).unwrap();
        for param in &command.params {
            assert!(
                line.contains(&format!("{}: {}", param.name, param.ty.spelling())),
                "{line}"
            );
        }
    }
    for property in registry.body_properties.iter().filter(|p| reached(p.since)) {
        let wanted = format!(".body.{}: {}", property.name, property.ty.spelling());
        assert!(
            reference.body.iter().any(|l| l.contains(&wanted)),
            "{wanted}"
        );
    }
}

#[test]
fn the_conventions_are_the_documentation_of_registry_items() {
    let output = ok("");
    let conventions = &output.context.reference.conventions;
    // Every topic and every item of the table resolved: none was dropped silently.
    assert_eq!(conventions.len(), CONVENTIONS.len());
    for (entry, (topic, items)) in conventions.iter().zip(CONVENTIONS) {
        assert_eq!(entry.topic, *topic);
        assert_eq!(entry.notes.len(), items.len(), "{topic}");
    }
    let registry = registry();
    for entry in conventions {
        for note in &entry.notes {
            let (label, doc) = note.split_once(": ").unwrap();
            let expected = registry
                .type_def(label)
                .map(|t| t.doc)
                .or_else(|| registry.namespace(label).map(|n| n.doc))
                .unwrap_or_else(|| panic!("no registry item {label}"));
            assert_eq!(doc, expected);
        }
    }
    let text = conventions
        .iter()
        .flat_map(|c| c.notes.iter())
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n");
    // Colour spaces, the two durations, and where each is available.
    assert!(text.contains("#rrggbb") && text.contains("sRGB") && text.contains("linear"));
    assert!(text.contains("color.linear(rgb, a)") && text.contains("color.srgb(rgb, a)"));
    assert!(text.contains("`update(dt)`") && text.contains("`fixed_update(dt)`"));
    assert!(text.contains("1/60 s"));
}

#[test]
fn the_units_and_scales_a_model_needs_are_in_the_registry_documentation() {
    // The detailed schemas carry the documentation of every field, so what the registry says
    // there is what the model reads: lighting units, the exposure scale that multiplies the
    // ambient term, angles in radians.
    let registry = registry();
    let doc = |schema: &str, field: &str| registry.schema_field(schema, field).unwrap().doc;
    assert!(doc("DirectionalLight", "intensity").contains("lux"));
    assert!(doc("PointLight", "intensity").contains("candela"));
    assert!(doc("Perspective", "fov_y").contains("radians"));
    assert!(doc("Scene", "ambient_intensity").contains("exposure"));
    assert!(doc("Camera", "exposure").contains("1.2"));
    // The wrong guesses of the key names are not members, and the documentation says so.
    let key = registry.enum_def("Key").unwrap();
    for invented in ["Up", "Down", "Left", "Right", "Shift", "KeyA"] {
        assert!(key.members.iter().all(|m| m.name != invented), "{invented}");
    }
    assert!(key.doc.contains("Key.ArrowUp") && key.doc.contains("no `Key.Up`"));
    // And they reach the context.
    let output = ok("");
    let scene = output
        .context
        .schemas
        .iter()
        .find(|s| s.name == "Scene")
        .unwrap();
    assert!(
        scene
            .fields
            .iter()
            .any(|l| l.starts_with("ambient_intensity") && l.contains("exposure"))
    );
    let camera = output
        .context
        .schemas
        .iter()
        .find(|s| s.name == "Camera")
        .unwrap();
    assert!(
        camera
            .fields
            .iter()
            .any(|l| l.starts_with("exposure") && l.contains("EV100"))
    );
    let perspective = output
        .context
        .schemas
        .iter()
        .find(|s| s.name == "Perspective")
        .unwrap();
    assert!(perspective.fields.iter().any(|l| {
        l.starts_with("fov_y: f32 = 0.9 [WB] range (0, \u{3c0}) //") && l.contains("radians")
    }));
}

#[test]
fn every_rule_between_fields_is_stated_in_the_documentation_of_the_field() {
    // The detailed schemas carry the field documentation but not the rules as such, so the
    // documentation has to say what the checker enforces.
    for schema in &registry().schemas {
        for rule in &schema.rules {
            let (field, other) = match rule {
                FieldRule::Requires {
                    field, requires, ..
                } => (field, requires),
                FieldRule::ExcludedBy {
                    field, excluded_by, ..
                } => (field, excluded_by),
            };
            let text = schema.field(field).unwrap().doc;
            assert!(
                text.contains(&format!("`{other}`")),
                "{}.{field} does not mention `{other}`: {text}",
                schema.name
            );
        }
    }
}

#[test]
fn a_range_is_shown_when_it_says_more_than_greater_than_zero() {
    let output = ok("");
    let line = |schema: &str, field: &str| -> String {
        output
            .context
            .schemas
            .iter()
            .find(|s| s.name == schema)
            .unwrap()
            .fields
            .iter()
            .find(|l| l.starts_with(&format!("{field}: ")))
            .unwrap()
            .clone()
    };
    assert!(line("Sphere", "segments").contains(" range 3\u{2026}256 "));
    assert!(line("Perspective", "far").contains(" range > near "));
    assert!(line("BoxCollider", "restitution").contains(" range 0\u{2026}1 "));
    for (schema, field) in [
        ("Sphere", "radius"),
        ("Box", "size"),
        ("Dynamic", "mass"),
        ("Scene", "gravity"),
    ] {
        assert!(!line(schema, field).contains(" range "), "{schema}.{field}");
    }
}

// ---------------------------------------------------------------------------
// which projects are cold, and what a warm one gets
// ---------------------------------------------------------------------------

#[test]
fn a_cold_start_is_a_project_without_entities_materials_functions_constants_or_structs() {
    // Cold: nothing to learn the library from.
    assert!(is_cold(""));
    assert!(is_cold("scene Demo {}\n"));
    assert!(is_cold("scene Demo { camera Main {} }\n"));
    assert!(is_cold(
        "scene Demo {\n    camera Main {}\n    clear_color: #101418;\n    state n: f32 = 1.0;\n}\n"
    ));
    assert!(is_cold("scene {{{ not a program"));
    // Warm: the project has code of its own.
    assert!(!is_cold(
        "scene Demo { camera Main {} entity Cube { mesh: Box {}; } }\n"
    ));
    assert!(!is_cold(
        "const A: f32 = 1.0;\nscene Demo { camera Main {} }\n"
    ));
    assert!(!is_cold(
        "struct P { a: f32; }\nscene Demo { camera Main {} }\n"
    ));
    assert!(!is_cold(
        "fn f(x: f32) -> f32 { return x; }\nscene Demo { camera Main {} }\n"
    ));
    assert!(!is_cold(
        "prefab P { mesh: Box {}; }\nscene Demo { camera Main {} }\n"
    ));
    // A warm context has neither the library nor the documentation of the fields.
    let warm = ok("scene Demo { camera Main {} entity Cube { mesh: Box {}; } }\n");
    assert!(warm.context.reference.is_empty());
    assert!(!warm.text.contains("\"reference\""));
    assert!(warm.context.schemas.iter().all(|s| s.doc.is_none()));
    assert!(
        warm.context
            .schemas
            .iter()
            .all(|s| s.fields.iter().all(|l| !l.contains(" // ")))
    );
    assert!(warm.context.schemas.len() < 8);
    assert!(
        warm.text.len() < ok("").text.len() - 5_000,
        "{}",
        warm.text.len()
    );
}

#[test]
fn a_cold_start_names_the_functions_once() {
    // Decision 0148: `reference.builtins` gives every function its signature, so `supported.features`
    // of a cold start has no `function:*` entry; the namespaces stay.
    let functions = |output: &ContextOutput| {
        output
            .context
            .supported
            .features
            .iter()
            .filter(|feature| feature.starts_with("function:"))
            .count()
    };
    let cold = ok("");
    assert_eq!(functions(&cold), 0);
    assert!(
        cold.context
            .supported
            .features
            .iter()
            .any(|feature| feature == "namespace:mat4")
    );
    for name in ["abs", "spawn", "save", "mat4.identity"] {
        assert!(
            cold.context
                .reference
                .builtins
                .iter()
                .any(|line| line.starts_with(name) || line.contains(&format!("|{name}"))),
            "{name} has no signature"
        );
    }
    // A warm context has no reference and lists them.
    let warm = ok("scene Demo { camera Main {} entity Cube { mesh: Box {}; } }\n");
    assert!(functions(&warm) > 50);
    assert!(
        warm.context
            .supported
            .features
            .iter()
            .any(|feature| feature == "function:abs")
    );
    // A budget that drops `builtins` lists them again.
    let small = run(&project(""), 12_000).unwrap();
    assert!(small.context.reference.builtins.is_empty());
    assert_eq!(functions(&small), functions(&warm));
}

#[test]
fn overloads_and_families_share_a_line_without_losing_a_function() {
    // Decision 0172: the library outgrew the budget, so overloads that only add trailing
    // arguments are one signature with the optional ones in brackets, and functions with one
    // signature and one closing sentence in their documentation (`easing.*`) are one line.
    let lines = ok("").context.reference.builtins;
    let line = |start: &str| lines.iter().find(|l| l.starts_with(start)).unwrap();
    assert!(line("hud.text(").starts_with(
        "hud.text(content: string, at: vec2, [size: f32, tint: color, align: f32, font: font]) -> ()"
    ));
    assert!(line("play(").starts_with("play(sound: sound, [volume: f32, pitch: f32]) -> ()"));
    assert!(line("hud.button(").contains("(label: string, at: vec2, [size: f32]) -> bool"));
    // Overloads that are not a prefix chain stay as they are.
    assert!(line("abs(").starts_with("abs(x: T) -> T; abs(x: I) -> I"));
    let easing = line("easing.");
    for def in registry().namespace("easing").unwrap().members.iter() {
        let NamespaceMember::Function(def) = def else {
            continue;
        };
        assert!(easing.contains(def.name), "{}", def.name);
    }
    assert!(easing.contains("(t: f32) -> f32 [CPU] // `t` is clamped to 0..1"));
    assert_eq!(lines.iter().filter(|l| l.starts_with("easing.")).count(), 1);
    // No function has two lines, whatever it is grouped with.
    let mut names: Vec<(String, String)> = Vec::new();
    for l in &lines {
        let head = l.split(['(', ':']).next().unwrap();
        let (prefix, alternatives) = match head.split_once('.') {
            Some((namespace, rest)) if !head.starts_with("frame") => (namespace, rest),
            _ => ("", head),
        };
        for name in alternatives.split('|') {
            names.push((prefix.to_owned(), name.to_owned()));
        }
    }
    let mut seen = names.clone();
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), names.len(), "a function is listed twice");
}

#[test]
fn a_stub_scene_gets_the_library_and_its_own_symbols_within_the_budget() {
    let stub = "// Build the scene here.\nscene Demo {\n    camera Main {\n        position: vec3(0.0, 2.0, 5.0);\n    }\n}\n";
    let output = ok(stub);
    assert!(
        output.context.truncated.is_none(),
        "{:?}",
        output.context.truncated
    );
    assert!(
        output.text.len() <= DEFAULT_MAX_BYTES,
        "{}",
        output.text.len()
    );
    assert!(!output.context.reference.is_empty());
    assert_eq!(names(&output), ["Demo", "Demo.Main"]);
    assert_valid(&output);
    // The project section and a few symbols of a stub fit with room to spare: 1 000 bytes
    // (decision 0112; 600 in decision 0147, 1 000 again since decision 0148 made room).
    let empty = ok("");
    assert!(
        empty.text.len() + 1_000 <= DEFAULT_MAX_BYTES,
        "the empty project leaves less than 1000 bytes for the project: {}",
        empty.text.len()
    );
}

#[test]
fn a_cold_start_context_is_deterministic() {
    let reference = ok("");
    for seed in [1, 2, 3] {
        let shuffled = project("").with_shuffled_listing(seed);
        assert_eq!(
            run(&shuffled, DEFAULT_MAX_BYTES).unwrap().text,
            reference.text
        );
    }
    assert_eq!(ok("").text, reference.text);
    assert!(reference.text.lines().all(|line| line == line.trim_end()));
    assert!(!reference.text.contains('\r'));
}

#[test]
fn cold_start_compaction_preserves_every_value_even_after_reference_truncation() {
    for budget in [DEFAULT_MAX_BYTES, 12_000, 9_000] {
        let output = run(&project(""), budget).unwrap();
        if budget == 9_000 {
            assert!(output.context.reference.is_empty());
        }
        assert_eq!(output.text.lines().count(), 1);
        assert!(output.text.ends_with('\n'));
        assert_eq!(
            serde_json::from_str::<Value>(&output.text).unwrap(),
            serde_json::to_value(&output.context).unwrap()
        );
    }
    let warm = ok("scene Demo { camera Main {} entity Cube { mesh: Box {}; } }");
    assert!(warm.text.lines().count() > 1);
}

// ---------------------------------------------------------------------------
// the budget
// ---------------------------------------------------------------------------

#[test]
fn a_budget_drops_the_library_in_sections_before_any_schema() {
    let fs = project("");
    let full = run(&fs, 1_000_000).unwrap();
    assert!(full.context.truncated.is_none());
    let mut seen_schema_drop = false;
    let mut most = 0;
    let mut budget = full.text.len();
    loop {
        budget = budget.saturating_sub(83);
        match run(&fs, budget) {
            Err(ContextError::BudgetTooSmall { .. }) => break,
            Err(other) => panic!("{other:?}"),
            Ok(output) => {
                assert!(output.text.len() <= budget);
                assert_valid(&output);
                let truncated = output.context.truncated.clone().unwrap_or_default();
                let dropped = &truncated.reference;
                // The lowest-priority sections go first, in the documented order.
                assert_eq!(
                    dropped.names,
                    REFERENCE_SECTIONS[..dropped.count.min(16)].to_vec()
                );
                most = most.max(dropped.count);
                if !truncated.schemas.is_empty() {
                    assert_eq!(
                        dropped.count,
                        REFERENCE_SECTIONS.len(),
                        "schemas go after the library"
                    );
                    seen_schema_drop = true;
                }
                // `reference` is present while any section is.
                assert_eq!(
                    output.context.reference.is_empty(),
                    dropped.count == REFERENCE_SECTIONS.len()
                );
            }
        }
    }
    assert_eq!(most, REFERENCE_SECTIONS.len());
    assert!(seen_schema_drop);
}

#[test]
fn a_small_budget_still_gives_a_valid_context() {
    // 12 000 bytes: the library is partly gone and the context says which parts.
    let output = run(&project(""), 12_000).unwrap();
    assert!(output.text.len() <= 12_000);
    let truncated = output.context.truncated.as_ref().unwrap();
    assert!(!truncated.reference.is_empty());
    assert_valid(&output);
}

// ---------------------------------------------------------------------------
// goldens and the guide
// ---------------------------------------------------------------------------

#[test]
fn cold_start_goldens() {
    let empty = ok("");
    assert_golden("empty.default.json", &empty.text);
    let stub = ok("scene Demo {\n    camera Main {}\n}\n");
    assert_golden("scene-stub.default.json", &stub.text);
    assert!(empty.context.truncated.is_none() && stub.context.truncated.is_none());
}

#[test]
fn the_schema_guide_names_the_flag_letters_of_the_registry() {
    for (letter, meaning) in [
        ('R', "required"),
        ('W', "writable"),
        ('B', "bindable"),
        ('C', "construction-only"),
    ] {
        for guide in [SCHEMA_GUIDE, SCHEMA_GUIDE_DETAILED] {
            assert!(
                guide.contains(&format!("{letter} {meaning}")),
                "{letter} {meaning}"
            );
        }
    }
    // The cold-start guide explains the range and the meaning; the other does not need to.
    assert!(
        SCHEMA_GUIDE_DETAILED.contains("range R") && SCHEMA_GUIDE_DETAILED.contains("// meaning")
    );
    assert!(!SCHEMA_GUIDE.contains("range") && !SCHEMA_GUIDE.contains("meaning"));
    assert_eq!(ok("").context.schema_guide, SCHEMA_GUIDE_DETAILED);
    assert_eq!(
        ok("scene Demo { camera Main {} entity Cube { mesh: Box {}; } }")
            .context
            .schema_guide,
        SCHEMA_GUIDE
    );
    // The letters of the lines in a context are only these.
    let output = ok("");
    for schema in &output.context.schemas {
        for line in &schema.fields {
            let head = line.split(" // ").next().unwrap();
            if let Some(start) = head.find(" [") {
                let flags = &head[start + 2..start + head[start..].find(']').unwrap()];
                assert!(flags.chars().all(|c| "RWBC".contains(c)), "{line}");
            }
        }
    }
}
