//! Unit tests of the scene and schema checks (`scene.rs`) on whole modules,
//! including registries the v0.1 tables do not contain.

use super::scene::FieldOrigin;
use super::*;
use crate::diagnostics::Diagnostic;
use crate::resolve::resolve_module;
use crate::source::FileId;
use crate::stdlib::{FieldDef, FieldFlags, Milestone, Registry, registry};
use crate::syntax::{lex_str, parse_module};

struct Checked {
    typeck: Typeck,
    diagnostics: Vec<Diagnostic>,
}

impl Checked {
    fn codes(&self) -> Vec<&'static str> {
        self.diagnostics.iter().map(|d| d.code.short()).collect()
    }
}

/// Check `text` with the type checker and the scene checks reading
/// `registry` (the resolver keeps the v0.1 registry).
fn checked_with(text: &str, registry: &'static Registry) -> Checked {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    assert!(sink.is_empty(), "syntax errors in {text:?}");
    let resolution = resolve_module(&parsed.module, &mut sink);
    let mut checker =
        check::Checker::with_registry(&parsed.module, text, &resolution, &mut sink, registry);
    checker.module(&parsed.module);
    checker.scene_checks(&parsed.module);
    let typeck = checker.finish();
    Checked {
        typeck,
        diagnostics: sink.finish().diagnostics,
    }
}

fn checked(text: &str) -> Checked {
    checked_with(text, registry())
}

/// A v0.1 registry changed by `edit`, for the schema rules the v0.1 tables do
/// not exercise in this build. Leaked: it lives as long as the test binary.
fn registry_with(edit: impl FnOnce(&mut Registry)) -> &'static Registry {
    let mut changed = Registry::v0_1();
    edit(&mut changed);
    let problems = changed.validate();
    assert!(problems.is_empty(), "{problems:?}");
    Box::leak(Box::new(changed))
}

fn field_mut<'r>(registry: &'r mut Registry, schema: &str, field: &str) -> &'r mut FieldDef {
    registry
        .schemas
        .iter_mut()
        .find(|s| s.name == schema)
        .and_then(|s| s.fields.iter_mut().find(|f| f.name == field))
        .unwrap_or_else(|| panic!("no field {schema}.{field}"))
}

#[test]
fn a_missing_required_field_is_e5003() {
    // No M1 schema has a required field (the first are the M5 colliders), so
    // the rule is tested on a registry where `Box.size` and
    // `Entity.position` are required.
    let changed = registry_with(|r| {
        for (schema, field) in [("Box", "size"), ("Entity", "position")] {
            let def = field_mut(r, schema, field);
            def.flags = def.flags | FieldFlags::REQUIRED;
            def.default = None;
        }
    });
    let text = "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n    entity Ok { position: vec3(0.0); mesh: Box { size: vec3(1.0) }; }\n}\n";
    let c = checked_with(text, changed);
    let found: Vec<(&str, &str, &str)> = c
        .diagnostics
        .iter()
        .map(|d| {
            let span = d.primary.as_ref().map_or(0..0, |l| l.span.range());
            (
                d.code.short(),
                text.get(span).unwrap_or(""),
                d.message.as_str(),
            )
        })
        .collect();
    assert_eq!(
        found,
        [
            (
                "E5003",
                "Cube",
                "Missing required field 'position' on entity 'Cube'."
            ),
            ("E5003", "Box", "Missing required field 'size' on Box."),
        ]
    );
}

#[test]
fn only_material_colour_parameters_must_be_opaque() {
    // `ambient_color` is M4 (gated by the resolver, `E9010`); on a registry
    // where the checker implements it, a translucent value is accepted: the
    // renderer uses only the RGB channels of scene colours.
    let changed = registry_with(|r| field_mut(r, "Scene", "ambient_color").since = Milestone::M1);
    let c = checked_with(
        "scene Demo {\n    clear_color: #00000000;\n    ambient_color: #ffffff40;\n    camera Main {}\n}\n",
        changed,
    );
    assert_eq!(c.codes(), ["E9010"], "{:#?}", c.diagnostics);
    let c = checked(
        "scene Demo { camera Main {} entity A { mesh: Box {}; material: Unlit { color: #ffffff00 }; } }\n",
    );
    assert_eq!(c.codes(), ["E5100"]);
}

#[test]
fn declaration_schemas_have_no_descriptor_literals() {
    for (source, help) in [
        ("const E = Entity {};", "`entity Name { … }`"),
        (
            "const S = Scene { clear_color: #000000 };",
            "`scene Name { … }`",
        ),
        ("const C = Camera {};", "`camera Name { … }`"),
    ] {
        let c = checked(&format!("{source}\nscene Demo {{ camera Main {{}} }}\n"));
        assert_eq!(c.codes(), ["E3001"], "{source}");
        let notes = &c
            .diagnostics
            .first()
            .map(|d| d.notes.clone())
            .unwrap_or_default();
        assert!(
            notes.iter().any(|n| n.contains(help)),
            "{source}: {notes:?}"
        );
    }
}

#[test]
fn checked_scenes_fill_in_registry_defaults() {
    let c = checked(
        "scene Demo {\n    camera Main { target: vec3(0.0); }\n    entity Cube { mesh: Box {}; entity Child { position: vec3(1.0); } }\n}\n",
    );
    assert!(c.diagnostics.is_empty(), "{:#?}", c.diagnostics);
    let [scene] = c.typeck.scenes() else {
        panic!("one scene expected")
    };
    // The scene field `clear_color` has its default.
    let clear = scene.field("clear_color").unwrap();
    assert_eq!(clear.origin, FieldOrigin::Default);
    assert_eq!(clear.value, Some(ConstValue::Color([0.0, 0.0, 0.0, 1.0])));
    // The only camera is active; `projection` is a complete `Perspective {}`.
    let camera = scene.active_object("camera").unwrap();
    assert_eq!(camera.name, "Main");
    assert!(camera.field("target").is_some());
    assert_eq!(
        camera.field("projection").and_then(|f| f.value.clone()),
        Some(ConstValue::Struct {
            name: "Perspective".into(),
            fields: vec![
                ("fov_y".into(), ConstValue::F32(0.9)),
                ("near".into(), ConstValue::F32(0.1)),
                ("far".into(), ConstValue::F32(1000.0)),
            ],
        })
    );
    // `material` defaults to `Unlit {}` (with its colour) only next to a
    // `mesh`; the child has neither.
    let [cube] = scene.entities.as_slice() else {
        panic!("one root entity expected")
    };
    assert_eq!(
        cube.field("mesh").and_then(|f| f.value.clone()),
        Some(ConstValue::Struct {
            name: "Box".into(),
            fields: vec![("size".into(), ConstValue::Vec3([1.0, 1.0, 1.0]))],
        })
    );
    assert_eq!(
        cube.field("material").and_then(|f| f.value.clone()),
        Some(ConstValue::Struct {
            name: "Unlit".into(),
            fields: vec![("color".into(), ConstValue::Color([1.0, 1.0, 1.0, 1.0]))],
        })
    );
    let names: Vec<&str> = cube.fields.iter().map(|f| f.name).collect();
    assert_eq!(
        names,
        [
            "position", "rotation", "scale", "visible", "mesh", "material"
        ]
    );
    let [child] = cube.children.as_slice() else {
        panic!("one child expected")
    };
    assert!(child.field("mesh").is_none() && child.field("material").is_none());
    assert!(matches!(
        child.field("position").map(|f| f.origin),
        Some(FieldOrigin::Written { .. })
    ));
    let order: Vec<&str> = scene
        .entities_in_order()
        .iter()
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(order, ["Cube", "Child"]);
}

#[test]
fn rejected_values_have_no_value_and_cause_nothing_further() {
    // A mistyped `active` is one E3102; the active camera is then unknown,
    // and no E5013 follows.
    let c = checked("scene Demo { camera A { active: 1; } camera B {} }\n");
    assert_eq!(c.codes(), ["E3102"]);
    let [scene] = c.typeck.scenes() else {
        panic!("one scene expected")
    };
    assert!(scene.active_object("camera").is_none());
    let a = scene.objects.first().and_then(|o| o.field("active"));
    assert_eq!(a.map(|f| f.value.is_none()), Some(true));
}

#[test]
fn the_checker_names_no_schema_and_no_field() {
    // Acceptance criterion of M1-11: the type checker and the scene checks
    // take every schema and field from the registry. No registry schema,
    // field or scene-object kind appears as a string literal in their code.
    let sources = [
        ("check.rs", include_str!("check.rs")),
        ("consteval.rs", include_str!("consteval.rs")),
        ("scene.rs", include_str!("scene.rs")),
        ("mod.rs", include_str!("mod.rs")),
    ];
    let registry = registry();
    let mut names: Vec<&str> = registry.schemas.iter().map(|s| s.name).collect();
    for schema in &registry.schemas {
        names.extend(schema.fields.iter().map(|f| f.name));
    }
    names.extend(registry.scene_objects.iter().map(|k| k.keyword));
    for (file, source) in sources {
        for name in &names {
            assert!(
                !source.contains(&format!("\"{name}\"")),
                "{file} names \"{name}\""
            );
        }
    }
}
