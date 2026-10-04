//! Multi-file projects end to end (`spec/language.md` section 9, decision 0036):
//! the module fixtures of `tests/semantics/` checked, inspected and built, with
//! the properties the diagnostic goldens of `tests/fixtures.rs` do not show —
//! load order, where imported names point, folded cross-module values, the
//! symbols of same-named declarations, the build's sources, and independence
//! of directory enumeration order.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_js::{emit_writer_parts, writer_qualifier};
use mtek_compiler::emit_wgsl::{emit_bindings, emit_block_structs, validate_wgsl};
use mtek_compiler::ir::{MaterialItem, lower_to_ir, to_json};
use mtek_compiler::layout::{
    LayoutRecord, LayoutType, compute, hash8, material_layout_id, material_params_struct,
    qualified_name,
};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::{Construct, DefKind, construct_implemented};
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{Analysis, BuildMode, CompileOptions, analyze, build};
use serde_json::Value;

fn semantics_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/semantics")
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(root, &path, out);
        } else {
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .components()
                .map(|c| c.as_os_str().to_str().unwrap().to_owned())
                .collect::<Vec<_>>()
                .join("/");
            if relative != "expected.diag.json" {
                out.push((relative, fs::read(&path).unwrap()));
            }
        }
    }
}

/// The fixture `<suite>/<name>` as an in-memory project.
fn fixture(suite: &str, name: &str, shuffle: Option<u64>) -> MemFs {
    let root = semantics_dir().join(suite).join(name);
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    let mut memory = match shuffle {
        Some(seed) => MemFs::new().with_shuffled_listing(seed),
        None => MemFs::new(),
    };
    for (path, bytes) in files {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

fn analyze_fixture(suite: &str, name: &str) -> Analysis {
    analyze(&ProjectRoot::at_base(), &fixture(suite, name, None))
}

/// The module paths of an analysis in load order.
fn module_paths(analysis: &Analysis) -> Vec<String> {
    analysis
        .project
        .as_ref()
        .unwrap()
        .modules
        .modules()
        .iter()
        .map(|m| m.path().as_str().to_owned())
        .collect()
}

fn ir_json(analysis: &Analysis) -> Value {
    let program = lower_to_ir(analysis).expect("the program lowers");
    serde_json::from_str(&to_json(&program)).unwrap()
}

/// The `const` items of the IR module `path`: `(symbol, value)`.
fn constants(ir: &Value, path: &str) -> Vec<(String, Value)> {
    let module = ir["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["path"] == path)
        .unwrap_or_else(|| panic!("no IR module {path}"));
    module["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "const")
        .map(|item| {
            (
                item["symbol"].as_str().unwrap().to_owned(),
                item["value"].clone(),
            )
        })
        .collect()
}

const MODULE_FIXTURES: [&str; 4] = [
    "export_in_entry_module",
    "modules_diamond_load_order",
    "modules_imported_constant_and_material",
    "modules_same_name_in_two_modules",
];

#[test]
fn modules_load_depth_first_in_import_order_whatever_the_listing_order() {
    let reference = analyze_fixture("pass", "modules_diamond_load_order");
    assert!(!reference.has_errors(), "{:#?}", reference.report);
    assert_eq!(
        module_paths(&reference),
        [
            "src/main.mtek",
            "src/right.mtek",
            "src/lib/base.mtek",
            "src/left.mtek"
        ]
    );
    // The analysis keeps every other module, in load order.
    let ids: Vec<usize> = reference
        .dependencies
        .iter()
        .map(|u| u.id.index())
        .collect();
    assert_eq!(ids, [1, 2, 3]);
    for name in MODULE_FIXTURES {
        let first = analyze_fixture("pass", name);
        let ir = to_json(&lower_to_ir(&first).unwrap());
        for seed in 0..6 {
            let shuffled = analyze(&ProjectRoot::at_base(), &fixture("pass", name, Some(seed)));
            assert_eq!(
                module_paths(&shuffled),
                module_paths(&first),
                "{name} {seed}"
            );
            assert_eq!(shuffled.report, first.report, "{name} {seed}");
            assert_eq!(
                to_json(&lower_to_ir(&shuffled).unwrap()),
                ir,
                "{name} {seed}"
            );
        }
    }
}

#[test]
fn imported_names_point_at_the_exported_declaration() {
    let analysis = analyze_fixture("pass", "modules_imported_constant_and_material");
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    // The entities use `Unlit`, so the embedded prelude follows the project's
    // modules (decision 0044).
    assert_eq!(
        module_paths(&analysis),
        [
            "src/main.mtek",
            "src/shared/palette.mtek",
            "src/shared/sizes.mtek",
            "std/materials.mtek"
        ]
    );
    let resolution = analysis.resolution.as_ref().unwrap();
    let targets: Vec<(String, usize, DefKind, String)> = resolution
        .imports()
        .map(|(def, target)| {
            let name = resolution.def(def).unwrap().name.clone();
            let unit = analysis
                .dependencies
                .iter()
                .find(|unit| unit.id == target.module)
                .unwrap();
            let declared = unit.resolution.def_of(target.node).unwrap();
            let declared = unit.resolution.def(declared).unwrap();
            assert_eq!(declared.span, target.span);
            (
                name,
                target.module.index(),
                target.kind,
                declared.name.clone(),
            )
        })
        .collect();
    assert_eq!(
        targets,
        [
            ("BACKDROP".into(), 1, DefKind::Const, "BACKDROP".into()),
            ("GLOW".into(), 1, DefKind::Const, "GLOW".into()),
            ("LIFT".into(), 1, DefKind::Const, "LIFT".into()),
            ("CRATE_SIZE".into(), 2, DefKind::Const, "CRATE_SIZE".into()),
        ]
    );
}

#[test]
fn imported_constants_and_material_instances_fold_across_modules() {
    let analysis = analyze_fixture("pass", "modules_imported_constant_and_material");
    let ir = ir_json(&analysis);
    assert_eq!(ir["entryScene"], "src/main.mtek::Gallery");
    // Each constant is listed once, in the module that declares it.
    let palette: Vec<String> = constants(&ir, "src/shared/palette.mtek")
        .into_iter()
        .map(|(symbol, _)| symbol)
        .collect();
    assert_eq!(
        palette,
        [
            "src/shared/palette.mtek::BACKDROP",
            "src/shared/palette.mtek::ACCENT",
            "src/shared/palette.mtek::GLOW",
            "src/shared/palette.mtek::LIFT",
            "src/shared/palette.mtek::UNUSED",
        ]
    );
    assert!(constants(&ir, "src/main.mtek").is_empty());
    let entity = &ir["modules"][0]["items"][0]["entities"][0];
    assert_eq!(entity["position"]["source"]["const"]["vec3"][1], 0.5);
    assert_eq!(
        entity["mesh"]["desc"],
        serde_json::json!({ "kind": "box", "size": [1.0, 1.0, 1.0] })
    );
    // The material instance imported as a constant: the built-in Unlit with
    // the palette's accent colour (linear, from sRGB #6b5cff).
    assert_eq!(entity["material"]["material"], "std/materials.mtek::Unlit");
    let accent = &constants(&ir, "src/shared/palette.mtek")[1].1;
    assert_eq!(
        entity["material"]["params"][0]["source"]["const"], *accent,
        "the entity's colour is the exporting module's ACCENT"
    );
    // Spans of the entry scene point into the entry file, not the palette.
    assert_eq!(entity["material"]["span"]["file"], 0);
}

#[test]
fn same_named_declarations_of_two_modules_keep_their_own_identity() {
    let analysis = analyze_fixture("pass", "modules_same_name_in_two_modules");
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    let ir = ir_json(&analysis);
    let a = constants(&ir, "src/pulse_a.mtek");
    let b = constants(&ir, "src/pulse_b.mtek");
    assert_eq!(a[0].0, "src/pulse_a.mtek::Pulse");
    assert_eq!(b[0].0, "src/pulse_b.mtek::Pulse");
    assert_eq!(a[0].1, serde_json::json!({ "f32": 1.5 }));
    assert_eq!(b[0].1, serde_json::json!({ "f32": 0.25 }));
    // DOUBLED is computed from its own module's Pulse, not the imported one.
    assert_eq!(b[1].1, serde_json::json!({ "f32": 0.5 }));
    let position = &ir["modules"][0]["items"][0]["entities"][0]["position"];
    assert_eq!(
        position["source"]["const"],
        serde_json::json!({ "vec3": [1.5, 0.5, 0.0] })
    );
}

#[test]
fn a_build_ships_every_module_as_a_source() {
    let options = CompileOptions::with_stub_runtime(BuildMode::Release);
    let built = build(
        &ProjectRoot::at_base(),
        &fixture("pass", "modules_imported_constant_and_material", None),
        &options,
    );
    assert!(!built.has_errors(), "{:#?}", built.report);
    let manifest: Value = serde_json::from_slice(&built.files["program.manifest.json"]).unwrap();
    let sources: Vec<(u64, &str)> = manifest["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["id"].as_u64().unwrap(), s["path"].as_str().unwrap()))
        .collect();
    assert_eq!(
        sources,
        [
            (0, "src/main.mtek"),
            (1, "src/shared/palette.mtek"),
            (2, "src/shared/sizes.mtek"),
            (3, "std/materials.mtek"),
        ]
    );
    // Changing an imported module changes the build id.
    let mut changed = fixture("pass", "modules_imported_constant_and_material", None);
    changed.insert(
        ProjectPath::new("src/shared/sizes.mtek").unwrap(),
        "export const CRATE_SIZE: f32 = 2.0;\n",
    );
    let rebuilt = build(&ProjectRoot::at_base(), &changed, &options);
    assert!(!rebuilt.has_errors(), "{:#?}", rebuilt.report);
    assert_ne!(rebuilt.build_id, built.build_id);
}

#[test]
fn a_type_error_in_an_imported_module_is_reported_there_without_cascades() {
    let analysis = analyze_fixture("fail", "e3001_in_imported_module");
    let located: Vec<(&str, String)> = analysis
        .report
        .diagnostics
        .iter()
        .map(|d| {
            let file = d.primary.as_ref().unwrap().span.file;
            let path = analysis
                .project
                .as_ref()
                .unwrap()
                .sources
                .get(file)
                .unwrap()
                .path()
                .as_str()
                .to_owned();
            (d.code.short(), path)
        })
        .collect();
    assert_eq!(located, [("E3001", "src/palette.mtek".to_owned())]);
}

#[test]
fn an_import_cycle_still_checks_every_module() {
    let analysis = analyze_fixture("fail", "e2035_import_cycle");
    let codes: Vec<&str> = analysis
        .report
        .diagnostics
        .iter()
        .map(|d| d.code.short())
        .collect();
    assert_eq!(codes, ["E2035"]);
    assert_eq!(analysis.dependencies.len(), 2);
    // `a` imports `B` across an import that is not part of the cycle's
    // closing edge, so its constant folds.
    let a = &analysis.dependencies[0];
    let def = a
        .resolution
        .defs()
        .iter()
        .find(|d| d.name == "A" && d.kind == DefKind::Const)
        .unwrap();
    assert!(a.types.const_info(def.id).unwrap().value.is_some());
}

// ---------------------------------------------------------------------------
// Same-named declarations in generated code (`spec/gpu-layout.md` sections 5
// and 7): the acceptance criterion "two modules declaring `Pulse` produce
// distinct WGSL struct and writer names".
// ---------------------------------------------------------------------------

/// The parameter block of a material `Pulse` declared in `module`, with a
/// nested user struct `Wave` of the same module, laid out and named by the
/// naming rules every emitter uses.
fn pulse_block(module: &str) -> LayoutRecord {
    let wave = LayoutType::new_struct(
        qualified_name(module, "Wave"),
        vec![
            ("amplitude".to_owned(), LayoutType::F32),
            ("direction".to_owned(), LayoutType::Vec2),
        ],
    );
    let ty = LayoutType::new_struct(
        qualified_name(module, "Pulse"),
        vec![
            ("tint".to_owned(), LayoutType::Color),
            ("phase".to_owned(), LayoutType::F32),
            ("wave".to_owned(), wave),
        ],
    );
    compute(
        &ty,
        &material_layout_id(module, "Pulse"),
        &material_params_struct(module, "Pulse"),
    )
    .unwrap()
}

#[test]
fn two_modules_declaring_pulse_get_distinct_wgsl_structs_and_writers() {
    let (a, b) = ("src/pulse_a.mtek", "src/pulse_b.mtek");
    let (ha, hb) = (hash8(a), hash8(b));
    assert_ne!(ha, hb);
    let (record_a, record_b) = (pulse_block(a), pulse_block(b));
    assert_eq!(record_a.id, "material:src/pulse_a.mtek::Pulse");
    assert_eq!(record_a.wgsl_struct, format!("MtekParams_{ha}_Pulse"));
    assert_eq!(record_b.wgsl_struct, format!("MtekParams_{hb}_Pulse"));

    // WGSL: both blocks and their nested `Wave` structs in one module, which
    // Naga accepts (a collision would be a redefinition error).
    let wgsl = format!(
        "{}\n{}\n{}\n{}",
        emit_block_structs(&record_a),
        emit_bindings(2, 0, "params_a", &record_a.wgsl_struct),
        emit_block_structs(&record_b),
        emit_bindings(2, 1, "params_b", &record_b.wgsl_struct),
    );
    let module = validate_wgsl(&wgsl).unwrap_or_else(|e| panic!("{e:?}\n{wgsl}"));
    let mut names: Vec<String> = module
        .types
        .iter()
        .filter_map(|(_, ty)| ty.name.clone())
        .collect();
    names.sort();
    let mut expected = vec![
        format!("MtekParams_{ha}_Pulse"),
        format!("MtekParams_{hb}_Pulse"),
        format!("S_{ha}_Wave"),
        format!("S_{hb}_Wave"),
    ];
    expected.sort();
    assert_eq!(names, expected, "{wgsl}");

    // JavaScript: the writers of the two blocks share no function name, and
    // their `writers` table entries have distinct keys.
    let parts_a = emit_writer_parts(&record_a, &writer_qualifier(&record_a));
    let parts_b = emit_writer_parts(&record_b, &writer_qualifier(&record_b));
    assert_eq!(parts_a.function_names[0], format!("w_{ha}_Pulse"));
    assert_eq!(parts_b.function_names[0], format!("w_{hb}_Pulse"));
    assert!(
        parts_a
            .function_names
            .iter()
            .all(|name| !parts_b.function_names.contains(name)),
        "{:?} {:?}",
        parts_a.function_names,
        parts_b.function_names
    );
    assert!(
        parts_a
            .table_entry
            .starts_with("\"material:src/pulse_a.mtek::Pulse\":")
    );
    assert!(
        parts_b
            .table_entry
            .starts_with("\"material:src/pulse_b.mtek::Pulse\":")
    );
}

/// `tests/modules/same_named_materials/`: two modules declaring a material
/// `Pulse`, used by one scene.
fn same_named_materials() -> MemFs {
    let root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/modules/same_named_materials");
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    let mut memory = MemFs::new();
    for (path, bytes) in files {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

#[test]
fn same_named_materials_of_two_modules_build_to_distinct_names() {
    let fs = same_named_materials();
    let (ha, hb) = (hash8("src/pulse_a.mtek"), hash8("src/pulse_b.mtek"));
    assert!(construct_implemented(Construct::Material));
    // M2-04 (decision 0039): both materials are compiled from source and
    // check without diagnostics, the entry module imports one of them and an
    // instance of the other.
    let analysis = analyze(&ProjectRoot::at_base(), &fs);
    assert!(
        analysis.report.diagnostics.is_empty(),
        "{:#?}",
        analysis.report
    );
    assert_eq!(
        module_paths(&analysis),
        ["src/main.mtek", "src/pulse_a.mtek", "src/pulse_b.mtek"]
    );
    let resolution = analysis.resolution.as_ref().unwrap();
    let kinds: Vec<DefKind> = resolution.imports().map(|(_, t)| t.kind).collect();
    assert_eq!(kinds, [DefKind::Material, DefKind::Const]);

    // The typed IR lists each material once, in its module, with a parameter
    // block named from the declaring module's path (`layout::naming`).
    let program = lower_to_ir(&analysis).expect("the program lowers");
    let materials: Vec<&MaterialItem> = program.materials().collect();
    let symbols: Vec<&str> = materials.iter().map(|m| m.symbol.as_str()).collect();
    assert_eq!(
        symbols,
        ["src/pulse_a.mtek::Pulse", "src/pulse_b.mtek::Pulse"]
    );
    let records: Vec<&LayoutRecord> = materials
        .iter()
        .map(|m| m.layout.as_ref().expect("a parameter block"))
        .collect();
    for (record, module, hash) in [
        (records[0], "src/pulse_a.mtek", &ha),
        (records[1], "src/pulse_b.mtek", &hb),
    ] {
        assert_eq!(record.id, material_layout_id(module, "Pulse"));
        assert_eq!(record.wgsl_struct, material_params_struct(module, "Pulse"));
        assert_eq!(record.wgsl_struct, format!("MtekParams_{hash}_Pulse"));
    }
    // The entities use one material each: `Left` the imported one, `Right`
    // the other through the imported instance, with its defaults filled in.
    let scene = program.entry().unwrap();
    let used: Vec<(&str, &str)> = scene
        .entities
        .iter()
        .map(|e| {
            let material = e.material.as_ref().unwrap();
            (e.name.as_str(), material.material.as_str())
        })
        .collect();
    assert_eq!(
        used,
        [
            ("Left", "src/pulse_a.mtek::Pulse"),
            ("Right", "src/pulse_b.mtek::Pulse")
        ]
    );
    let right: Vec<&str> = scene.entities[1]
        .material
        .as_ref()
        .unwrap()
        .params
        .iter()
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(right, ["glow", "base"]);

    // The WGSL structs and the writers generated from the two real blocks:
    // distinct names, accepted together by Naga, no common writer name.
    let wgsl = format!(
        "{}\n{}\n{}\n{}",
        emit_block_structs(records[0]),
        emit_bindings(2, 0, "params_a", &records[0].wgsl_struct),
        emit_block_structs(records[1]),
        emit_bindings(2, 1, "params_b", &records[1].wgsl_struct),
    );
    validate_wgsl(&wgsl).unwrap_or_else(|e| panic!("{e:?}\n{wgsl}"));
    let parts_a = emit_writer_parts(records[0], &writer_qualifier(records[0]));
    let parts_b = emit_writer_parts(records[1], &writer_qualifier(records[1]));
    assert_eq!(parts_a.function_names[0], format!("w_{ha}_Pulse"));
    assert_eq!(parts_b.function_names[0], format!("w_{hb}_Pulse"));
    assert!(
        parts_a
            .function_names
            .iter()
            .all(|name| !parts_b.function_names.contains(name))
    );

    // The build (M2-05, decision 0041): each material gets its own shader with
    // its own module-qualified block, and the same names reach `app.js` and
    // the manifest.
    let built = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Release),
    );
    assert!(!built.has_errors(), "{:#?}", built.report);
    let shaders: Vec<String> = built
        .files
        .iter()
        .filter(|(path, _)| path.ends_with(".wgsl"))
        .map(|(_, bytes)| String::from_utf8(bytes.clone()).unwrap())
        .collect();
    assert_eq!(shaders.len(), 2);
    let app = String::from_utf8(built.files["app.js"].clone()).unwrap();
    for (hash, other) in [(&ha, &hb), (&hb, &ha)] {
        let own: Vec<&String> = shaders
            .iter()
            .filter(|wgsl| wgsl.contains(&format!("struct MtekParams_{hash}_Pulse {{")))
            .collect();
        assert_eq!(own.len(), 1, "{shaders:#?}");
        assert!(
            own[0].contains(&format!(
                "@group(1) @binding(0) var<uniform> mtek_params: MtekParams_{hash}_Pulse;"
            )),
            "{}",
            own[0]
        );
        assert!(!own[0].contains(&format!("MtekParams_{other}_Pulse")));
        validate_wgsl(own[0]).unwrap_or_else(|e| panic!("{e}\n{}", own[0]));
        assert!(app.contains(&format!("function w_{hash}_Pulse(")), "{app}");
    }
    let manifest: Value = serde_json::from_slice(&built.files["program.manifest.json"]).unwrap();
    let ids = |key: &str, field: &str| -> Vec<String> {
        manifest[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l[field].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        ids("layouts", "id"),
        [
            "builtin:frame",
            "builtin:object",
            "material:src/pulse_a.mtek::Pulse",
            "material:src/pulse_b.mtek::Pulse"
        ]
    );
    assert_eq!(
        ids("layouts", "wgslStruct")[2..],
        [
            format!("MtekParams_{ha}_Pulse"),
            format!("MtekParams_{hb}_Pulse")
        ]
    );
    assert_eq!(
        ids("shaders", "material"),
        ["src/pulse_a.mtek::Pulse", "src/pulse_b.mtek::Pulse"]
    );
    assert_eq!(
        ids("materials", "layout"),
        [
            "material:src/pulse_a.mtek::Pulse",
            "material:src/pulse_b.mtek::Pulse"
        ]
    );
}

#[test]
fn struct_types_cross_modules_with_their_identity_and_fields() {
    // M2-01 (decision 0035 item 5): an imported struct is a type in the
    // importing module, values of it fold across the import, and the struct
    // is an IR item once, in the module that declares it.
    let analysis = analyze_fixture("pass", "types/struct_across_modules");
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    let ir = ir_json(&analysis);
    let shapes = ir["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["path"] == "src/shapes.mtek")
        .unwrap();
    let structs: Vec<(&str, Value)> = shapes["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "struct")
        .map(|item| (item["symbol"].as_str().unwrap(), item["fields"].clone()))
        .collect();
    assert_eq!(
        structs,
        [
            (
                "src/shapes.mtek::Wave",
                serde_json::json!([{ "name": "amp", "type": "f32" }, { "name": "dir", "type": "vec3" }])
            ),
            (
                "src/shapes.mtek::Swell",
                serde_json::json!([{ "name": "waves", "type": "array<src/shapes.mtek::Wave, 2>" }, { "name": "count", "type": "u32" }])
            ),
        ]
    );
    // The literal wrote `dir` before `amp`: values list declaration order.
    let sea = &constants(&ir, "src/shapes.mtek")[1].1;
    assert_eq!(
        sea["struct"]["fields"][0]["value"]["array"][1]["struct"]["fields"][0],
        serde_json::json!({ "name": "amp", "value": { "f32": 2.0 } })
    );
    let main = constants(&ir, "src/main.mtek");
    assert_eq!(main[0].0, "src/main.mtek::LOCAL");
    let entity = &ir["modules"][0]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["kind"] == "scene")
        .unwrap()["entities"][0];
    assert_eq!(
        entity["position"]["source"]["const"],
        serde_json::json!({ "vec3": [1.0, 1.0, 0.0] })
    );
}
