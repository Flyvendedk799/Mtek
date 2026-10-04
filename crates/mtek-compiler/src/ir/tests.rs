//! Unit tests of the typed IR: symbols, value serialisation, the lowering's
//! coverage of the registry, and lowering whole programs.

use std::collections::BTreeSet;

use super::lower::{
    CAMERA_FIELDS, ENTITY_FIELDS, MESH_SCHEMAS, OBJECT_KINDS, PROJECTION_SCHEMAS, SCENE_FIELDS,
    mesh_desc, prelude_material_path, projection_desc,
};
use super::*;
use crate::project::ProjectRoot;
use crate::resolve::gate::is_implemented;
use crate::source::{MemFs, ProjectPath};
use crate::stdlib::{SchemaCategory, SchemaDef, registry};
use crate::types::ConstValue;

fn project(source: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    fs
}

fn lowered(source: &str) -> Result<Program, LowerError> {
    lower_to_ir(&crate::analyze(&ProjectRoot::at_base(), &project(source)))
}

fn implemented_fields(schema: &SchemaDef) -> BTreeSet<&'static str> {
    schema
        .fields
        .iter()
        .filter(|f| is_implemented(f.since))
        .map(|f| f.name)
        .collect()
}

fn implemented_schemas(category: SchemaCategory) -> BTreeSet<&'static str> {
    registry()
        .schemas
        .iter()
        .filter(|s| s.category == category && is_implemented(s.since))
        .map(|s| s.name)
        .collect()
}

// ----- symbols and values ---------------------------------------------------

#[test]
fn symbols_are_the_path_and_the_qualified_name() {
    let scene = Symbol::item("src/main.mtek", "Demo");
    assert_eq!(scene.as_str(), "src/main.mtek::Demo");
    assert_eq!(
        scene.child("Ground").child("Fountain").as_str(),
        "src/main.mtek::Demo.Ground.Fountain"
    );
    assert_eq!(
        serde_json::to_string(&scene.child("Main")).unwrap(),
        "\"src/main.mtek::Demo.Main\""
    );
}

#[test]
fn f32_values_serialise_losslessly_and_shortest() {
    let samples = [
        0.1_f32,
        1.0 / 3.0,
        -0.0,
        0.9,
        1000.0,
        f32::MAX,
        f32::MIN_POSITIVE,
        f32::from_bits(1), // the smallest subnormal
        0.012_983_031,
        -1.570_796_4,
    ];
    for sample in samples {
        let json = serde_json::to_string(&Value::F32(sample)).unwrap();
        let text = json
            .strip_prefix("{\"f32\":")
            .and_then(|t| t.strip_suffix('}'))
            .unwrap();
        let back: f32 = text.parse().unwrap();
        assert_eq!(back.to_bits(), sample.to_bits(), "{sample:?} as {text}");
    }
    assert_eq!(
        serde_json::to_string(&Value::F32(0.1)).unwrap(),
        "{\"f32\":0.1}"
    );
}

#[test]
fn values_are_tagged_by_their_type() {
    let value = Value::from(&ConstValue::Struct {
        name: "Box".to_owned(),
        fields: vec![("size".to_owned(), ConstValue::Vec3([1.0, 2.0, 3.0]))],
    });
    assert_eq!(
        serde_json::to_string(&value).unwrap(),
        "{\"struct\":{\"name\":\"Box\",\"fields\":[{\"name\":\"size\",\"value\":{\"vec3\":[1.0,2.0,3.0]}}]}}"
    );
    assert_eq!(value.to_string(), "Box { size: vec3(1.0, 2.0, 3.0) }");
    assert_eq!(
        serde_json::to_string(&Value::from(&ConstValue::U32(24))).unwrap(),
        "{\"u32\":24}"
    );
    assert_eq!(Value::U32(24).to_string(), "u32(24)");
    assert_eq!(Value::I32(-3).to_string(), "i32(-3)");
    // Strings (M2-01): tagged in JSON, a Mtek string literal in the human form.
    let text = Value::from(&ConstValue::Str("a \"b\"\\\n\t\u{1}".to_owned()));
    assert_eq!(
        serde_json::to_string(&text).unwrap(),
        "{\"string\":\"a \\\"b\\\"\\\\\\n\\t\\u0001\"}"
    );
    assert_eq!(text.to_string(), "\"a \\\"b\\\"\\\\\\n\\t\\u{1}\"");
    assert_eq!(
        Value::from(&ConstValue::Array(vec![ConstValue::Bool(true)])).to_string(),
        "[true]"
    );
    assert_eq!(
        Value::Color([0.5, 0.25, 0.0, 1.0]).to_string(),
        "color(0.5, 0.25, 0.0, 1.0)"
    );
}

// ----- coverage of the registry ----------------------------------------------

#[test]
fn every_implemented_body_field_is_lowered() {
    // A milestone that implements a field of `Scene`, `Entity` or `Camera`
    // fails here until the IR represents it.
    let registry = registry();
    let scene = registry.scene_schema().unwrap();
    assert_eq!(
        implemented_fields(scene),
        SCENE_FIELDS.into_iter().collect()
    );
    let entity = registry.entity_schema().unwrap();
    assert_eq!(
        implemented_fields(entity),
        ENTITY_FIELDS.into_iter().collect()
    );
    let kinds: BTreeSet<&str> = registry
        .scene_objects
        .iter()
        .filter(|kind| is_implemented(kind.since))
        .map(|kind| kind.keyword)
        .collect();
    assert_eq!(kinds, OBJECT_KINDS.into_iter().collect());
    let camera = registry
        .scene_object(OBJECT_KINDS[0])
        .and_then(|kind| registry.schema(kind.schema))
        .unwrap();
    assert_eq!(
        implemented_fields(camera),
        CAMERA_FIELDS.into_iter().collect()
    );
}

#[test]
fn every_implemented_descriptor_schema_is_lowered() {
    assert_eq!(
        implemented_schemas(SchemaCategory::Mesh),
        MESH_SCHEMAS.into_iter().collect()
    );
    assert_eq!(
        implemented_schemas(SchemaCategory::Projection),
        PROJECTION_SCHEMAS.into_iter().collect()
    );
    let materials = implemented_schemas(SchemaCategory::Material);
    assert!(!materials.is_empty());
    for material in materials {
        assert_eq!(
            prelude_material_path(material),
            Some("std/materials.mtek"),
            "{material}"
        );
    }
    assert_eq!(prelude_material_path("Missing"), None);
}

#[test]
fn descriptors_the_lowering_does_not_know_are_defects_not_panics() {
    let unknown = ConstValue::Struct {
        name: "Cylinder".to_owned(),
        fields: Vec::new(),
    };
    assert!(mesh_desc("entity 'A'", &unknown).is_err());
    assert!(projection_desc("camera 'Main'", &unknown).is_err());
    assert!(mesh_desc("entity 'A'", &ConstValue::F32(1.0)).is_err());
    let incomplete = ConstValue::Struct {
        name: "Sphere".to_owned(),
        fields: vec![("radius".to_owned(), ConstValue::F32(1.0))],
    };
    assert!(mesh_desc("entity 'A'", &incomplete).is_err());
}

// ----- lowering programs --------------------------------------------------------

#[test]
fn a_program_with_errors_is_not_lowered() {
    assert_eq!(
        lowered("const A: u32 = 1.5;\nscene Demo { camera Main {} }\n"),
        Err(LowerError::HasErrors)
    );
    let no_project = crate::analyze(&ProjectRoot::at_base(), &MemFs::new());
    assert_eq!(lower_to_ir(&no_project), Err(LowerError::HasErrors));
}

#[test]
fn entities_are_flat_in_pre_order_with_parent_indices_and_nested_symbols() {
    let program = lowered(
        "scene Demo {\n    camera Main {}\n    entity A {\n        entity B { entity C {} }\n        entity D {}\n    }\n    entity E {}\n}\n",
    )
    .unwrap();
    let scene = program.entry().unwrap();
    let rows: Vec<(u32, &str, Option<u32>, &str)> = scene
        .entities
        .iter()
        .map(|e| (e.index, e.name.as_str(), e.parent, e.symbol.as_str()))
        .collect();
    assert_eq!(
        rows,
        [
            (0, "A", None, "src/main.mtek::Demo.A"),
            (1, "B", Some(0), "src/main.mtek::Demo.A.B"),
            (2, "C", Some(1), "src/main.mtek::Demo.A.B.C"),
            (3, "D", Some(0), "src/main.mtek::Demo.A.D"),
            (4, "E", None, "src/main.mtek::Demo.E"),
        ]
    );
    assert_eq!(program.entry_scene.as_str(), "src/main.mtek::Demo");
    let camera = scene.active_camera().unwrap();
    assert_eq!(camera.symbol.as_str(), "src/main.mtek::Demo.Main");
    // No mesh, no material; every transform field at its default, located
    // at the declaration.
    let a = &scene.entities[0];
    assert!(a.mesh.is_none() && a.material.is_none());
    assert_eq!(a.position.origin, Origin::Default);
    assert_eq!(a.position.span, a.span);
    assert_eq!(a.scale.source.as_const(), Some(&Value::Vec3([1.0; 3])));
    assert_eq!(
        a.rotation.source.as_const(),
        Some(&Value::Quat([0.0, 0.0, 0.0, 1.0]))
    );
    assert_eq!(a.visible.source.as_const(), Some(&Value::Bool(true)));
}

#[test]
fn constants_keep_their_scope_in_the_symbol_and_their_folded_value() {
    let text = "const SIZE: f32 = 2.0 * 3.0;\nscene Demo {\n    const H = SIZE / 2.0;\n    camera Main { position: vec3(0.0, H, 10.0); }\n    entity A {\n        const S = vec3(SIZE);\n        scale: S;\n        entity B { const K: u32 = 4; }\n    }\n}\n";
    let program = lowered(text).unwrap();
    let [module] = program.modules.as_slice() else {
        panic!("one module")
    };
    let Some(Item::Const(size)) = module.items.first() else {
        panic!("the module constant first")
    };
    assert_eq!(
        (size.symbol.as_str(), size.ty.as_str(), &size.value),
        ("src/main.mtek::SIZE", "f32", &Value::F32(6.0))
    );
    assert_eq!(
        text.get(size.span.range()),
        Some("const SIZE: f32 = 2.0 * 3.0;")
    );
    let scene = program.entry().unwrap();
    let constants: Vec<(&str, &Value)> = scene
        .constants
        .iter()
        .map(|c| (c.symbol.as_str(), &c.value))
        .collect();
    assert_eq!(
        constants,
        [
            ("src/main.mtek::Demo.H", &Value::F32(3.0)),
            ("src/main.mtek::Demo.A.S", &Value::Vec3([6.0; 3])),
            ("src/main.mtek::Demo.A.B.K", &Value::U32(4)),
        ]
    );
    let a = &scene.entities[0];
    assert_eq!(a.scale.origin, Origin::Written);
    assert_eq!(a.scale.source.as_const(), Some(&Value::Vec3([6.0; 3])));
    assert_eq!(text.get(a.scale.span.range()), Some("scale: S;"));
}

#[test]
fn meshes_materials_and_projections_are_complete_descriptors() {
    let text = "scene Demo {\n    camera Main { projection: Orthographic { height: 4.0 }; }\n    entity A { mesh: Sphere { radius: 2.0 }; material: Unlit { color: #ff0000 }; }\n    entity B { mesh: Box {}; }\n}\n";
    let program = lowered(text).unwrap();
    let scene = program.entry().unwrap();
    let camera = &scene.cameras[0];
    assert!(camera.active && camera.target.is_none());
    assert_eq!(
        camera.projection.desc,
        ProjectionDesc::Orthographic {
            height: 4.0,
            near: 0.1,
            far: 1000.0
        }
    );
    assert_eq!(camera.projection.origin, Origin::Written);
    let a = &scene.entities[0];
    let mesh = a.mesh.as_ref().unwrap();
    assert_eq!(
        mesh.desc,
        MeshDesc::Sphere {
            radius: 2.0,
            segments: 32,
            rings: 16
        }
    );
    assert_eq!(
        text.get(mesh.span.range()),
        Some("mesh: Sphere { radius: 2.0 };")
    );
    let material = a.material.as_ref().unwrap();
    assert_eq!(material.material.as_str(), "std/materials.mtek::Unlit");
    assert_eq!(material.origin, Origin::Written);
    let [color] = material.params.as_slice() else {
        panic!("one parameter")
    };
    assert_eq!((color.name.as_str(), color.ty.as_str()), ("color", "color"));
    assert_eq!(
        color.source.as_const(),
        Some(&Value::Color([1.0, 0.0, 0.0, 1.0]))
    );
    // The default material next to a mesh.
    let b = &scene.entities[1];
    assert_eq!(
        b.mesh.as_ref().map(|m| &m.desc),
        Some(&MeshDesc::Box { size: [1.0; 3] })
    );
    let material = b.material.as_ref().unwrap();
    assert_eq!(material.origin, Origin::Default);
    assert_eq!(material.span, b.span);
    assert_eq!(
        material.params[0].source.as_const(),
        Some(&Value::Color([1.0; 4]))
    );
}

#[test]
fn the_entry_scene_is_the_configured_one_and_every_scene_is_lowered() {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"demo\"\nlanguage = \"0.1\"\nscene = \"Second\"\n",
    )
    .insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        "scene First { camera Main {} }\nscene Second { camera Main {} }\n",
    );
    let program = lower_to_ir(&crate::analyze(&ProjectRoot::at_base(), &fs)).unwrap();
    assert_eq!(program.entry_scene.as_str(), "src/main.mtek::Second");
    let names: Vec<&str> = program.scenes().map(|s| s.symbol.as_str()).collect();
    assert_eq!(names, ["src/main.mtek::First", "src/main.mtek::Second"]);
    assert_eq!(
        program.entry().map(|s| s.cameras[0].symbol.as_str()),
        Some("src/main.mtek::Second.Main")
    );
}

// ----- functions (decision 0038) -------------------------------------------

fn functions(program: &Program) -> Vec<&Function> {
    program
        .modules
        .iter()
        .flat_map(|m| m.items.iter())
        .filter_map(|item| match item {
            Item::Function(function) => Some(function),
            _ => None,
        })
        .collect()
}

#[test]
fn functions_carry_effects_reachability_locals_and_folded_bodies() {
    let mut fs = project(
        "import { ease } from \"./lib.mtek\";
fn shade(t: f32) -> f32 { let k = 2.0 * 3.0; return ease(t) * k; }
cpu fn tick() { var x = 1; x += shade(0.5) > 0.0 && true == true; }
scene Demo { camera Main {} }
",
    );
    fs.insert(
        ProjectPath::new("src/lib.mtek").unwrap(),
        "export fn ease(t: f32) -> f32 { return t * t; }\n",
    );
    let options = crate::AnalyzeOptions {
        gpu_root_functions: vec!["src/main.mtek::shade".to_owned()],
    };
    let analysis = crate::analyze_with(&ProjectRoot::at_base(), &fs, &options);
    // `x += bool` does not type-check: no IR.
    assert!(analysis.has_errors());
    assert_eq!(lower_to_ir(&analysis), Err(LowerError::HasErrors));

    let mut fs = project(
        "import { ease } from \"./lib.mtek\";
fn shade(t: f32) -> f32 { let k = 2.0 * 3.0; return ease(t) * k; }
cpu fn tick() -> f32 { return shade(0.5); }
scene Demo { camera Main {} }
",
    );
    fs.insert(
        ProjectPath::new("src/lib.mtek").unwrap(),
        "export fn ease(t: f32) -> f32 { return t * t; }\n",
    );
    let analysis = crate::analyze_with(&ProjectRoot::at_base(), &fs, &options);
    let program = lower_to_ir(&analysis).unwrap();
    let all = functions(&program);
    let names: Vec<(&str, &str, bool, bool)> = all
        .iter()
        .map(|f| {
            (
                f.symbol.as_str(),
                f.effect,
                f.gpu_reachable,
                f.cpu_reachable,
            )
        })
        .collect();
    assert_eq!(
        names,
        [
            ("src/main.mtek::shade", "pure", true, true),
            ("src/main.mtek::tick", "cpu", false, true),
            ("src/lib.mtek::ease", "pure", true, true),
        ]
    );
    let shade = all[0];
    let locals: Vec<(&str, LocalKind)> = shade
        .locals
        .iter()
        .map(|l| (l.name.as_str(), l.kind))
        .collect();
    assert_eq!(locals, [("t", LocalKind::Param), ("k", LocalKind::Let)]);
    assert_eq!(shade.params().count(), 1);
    // `2.0 * 3.0` is folded; the call of the imported function names the
    // module that declares it.
    let Stmt::Let { value, .. } = &shade.body.stmts[0] else {
        panic!("{:?}", shade.body.stmts[0])
    };
    assert_eq!(
        value.kind,
        ExprKind::Const {
            value: Value::F32(6.0)
        }
    );
    let Stmt::Return {
        value: Some(ret), ..
    } = &shade.body.stmts[1]
    else {
        panic!("{:?}", shade.body.stmts[1])
    };
    let ExprKind::Binary { lhs, .. } = &ret.kind else {
        panic!("{ret:?}")
    };
    let ExprKind::Call { function, args } = &lhs.kind else {
        panic!("{lhs:?}")
    };
    assert_eq!(function.as_str(), "src/lib.mtek::ease");
    assert_eq!(args.len(), 1);
}

#[test]
fn places_are_a_root_and_steps_each_spanning_its_own_text() {
    // Decision 0045: `rig.items[i].offset.y` is the root `rig` and the steps `.items`,
    // `[i]`, `.offset`, `.y`, typed, each spanning the text from the root to its end.
    let source = "struct Item { offset: vec3; }
struct Rig { items: array<Item, 2>; }
fn f(i: i32) -> Rig {
    var rig = Rig { items: [Item { offset: vec3(0.0) }, Item { offset: vec3(1.0) }] };
    rig.items[i].offset.y = 2.0;
    rig.items[1 + 0].offset += vec3(1.0);
    return rig;
}
scene Demo { camera Main {} }
";
    let program = lowered(source).unwrap();
    let f = functions(&program)
        .into_iter()
        .find(|f| f.name == "f")
        .unwrap();
    let places: Vec<&Place> = f
        .body
        .stmts
        .iter()
        .filter_map(|s| match s {
            Stmt::Assign { target, .. } => Some(target),
            _ => None,
        })
        .collect();
    let text = |span: crate::source::Span| &source[span.range()];
    let [first, second] = places.as_slice() else {
        panic!("{places:?}");
    };
    let PlaceRoot::Local { name, ty, span, .. } = &first.root;
    assert_eq!((name.as_str(), text(*span)), ("rig", "rig"));
    assert_eq!(ty, "src/main.mtek::Rig");
    let steps: Vec<(&str, &str)> = first
        .steps
        .iter()
        .map(|s| (text(s.span()), s.ty()))
        .collect();
    assert_eq!(
        steps,
        [
            ("rig.items", "array<src/main.mtek::Item, 2>"),
            ("rig.items[i]", "src/main.mtek::Item"),
            ("rig.items[i].offset", "vec3"),
            ("rig.items[i].offset.y", "f32"),
        ]
    );
    assert!(matches!(
        &first.steps[1],
        PlaceStep::Index { index, .. } if matches!(index.kind, ExprKind::Local { .. })
    ));
    assert!(matches!(
        &first.steps[3],
        PlaceStep::Component { component: 1, .. }
    ));
    assert_eq!(
        (first.ty.as_str(), text(first.span)),
        ("f32", "rig.items[i].offset.y")
    );
    // A constant index is folded.
    assert!(matches!(
        &second.steps[1],
        PlaceStep::Index { index, .. }
            if index.kind == (ExprKind::Const { value: Value::I32(1) })
    ));
    assert_eq!(second.ty, "vec3");
}
