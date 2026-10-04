//! Unit tests of the resource plan, on programs compiled from source.

use super::*;
use crate::ir::lower_to_ir;
use crate::project::ProjectRoot;
use crate::source::{MemFs, ProjectPath};
use crate::{analyze, ir::UpdateClass};

fn program(source: &str) -> Program {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"plan\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    let analysis = analyze(&ProjectRoot::at_base(), &fs);
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    lower_to_ir(&analysis).unwrap()
}

const PULSE: &str = "struct Wave { phase: f32; amp: f32; }\nmaterial Pulse {\n    param tint: color = #ff8800;\n    param waves: array<Wave, 2> = [Wave { phase: 0.0; amp: 1.0 }, Wave { phase: 0.5; amp: 0.5 }];\n    fragment(input: SurfaceInput) -> color { return tint; }\n}\n";

fn scene(entities: &str) -> String {
    format!("{PULSE}scene Demo {{\n    camera Main {{}}\n{entities}}}\n")
}

#[test]
fn equal_meshes_share_an_entry_in_first_use_order() {
    let program = program(&scene(
        "    entity A { mesh: Sphere {}; }\n    entity B {}\n    entity C { mesh: Box {}; }\n    entity D { mesh: Sphere {}; material: Unlit { color: #808080 }; }\n",
    ));
    let plan = plan_program(&program).unwrap();
    let ball = MeshDesc::Sphere {
        radius: 0.5,
        segments: 32,
        rings: 16,
    };
    assert_eq!(plan.meshes.len(), 2);
    assert_eq!(plan.meshes[0], ball, "{:?}", plan.meshes);
    assert!(matches!(plan.meshes[1], MeshDesc::Box { .. }));
    assert_eq!(plan.entity_meshes, [Some(0), None, Some(1), Some(0)]);
    assert_eq!(ResourcePlan::mesh_id(1), "mesh:1");
}

#[test]
fn every_entity_with_a_material_gets_an_instance_with_the_ir_update_classes() {
    let program = program(&scene(
        "    entity A { mesh: Box {}; }\n    entity B {}\n    entity C { mesh: Box {}; material: Pulse { tint: #0000ff }; }\n",
    ));
    let plan = plan_program(&program).unwrap();
    assert_eq!(plan.entity_instances, [Some(0), None, Some(1)]);
    let entities: Vec<u32> = plan.instances.iter().map(|i| i.entity).collect();
    assert_eq!(entities, [0, 2]);
    assert_eq!(
        plan.instances[1].entity_symbol.as_str(),
        "src/main.mtek::Demo.C"
    );
    assert_eq!(plan.instances[1].material.as_str(), "src/main.mtek::Pulse");
    let names: Vec<&str> = plan.instances[1]
        .params
        .iter()
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(names, ["tint", "waves"]);
    // The class is the one the IR recorded for the param (every param `initial` in M2).
    let scene = program.entry().unwrap();
    for (instance, entity) in plan
        .instances
        .iter()
        .zip(scene.entities.iter().filter(|e| e.material.is_some()))
    {
        let material = entity.material.as_ref().unwrap();
        for (planned, param) in instance.params.iter().zip(&material.params) {
            assert_eq!(planned.class, ParamClass::from(param.update));
            assert_eq!(planned.span, param.span);
        }
        assert!(instance.shareable());
    }
    assert_eq!(ParamClass::from(UpdateClass::Initial).as_str(), "initial");
}

#[test]
fn materials_are_planned_from_their_ir_items_sorted_by_symbol() {
    let program = program(&scene(
        "    entity A { mesh: Box {}; }\n    entity C { mesh: Box {}; material: Pulse {}; }\n    entity D { mesh: Box {}; material: Pulse {}; }\n",
    ));
    let plan = plan_program(&program).unwrap();
    let symbols: Vec<&str> = plan.materials.iter().map(|m| m.symbol.as_str()).collect();
    assert_eq!(
        symbols,
        ["src/main.mtek::Pulse", "std/materials.mtek::Unlit"]
    );
    for planned in &plan.materials {
        let item = program
            .materials()
            .find(|m| m.symbol == planned.symbol)
            .unwrap();
        assert_eq!(planned.name, item.name);
        assert_eq!(planned.layout, item.layout);
        assert_eq!(planned.declaration, item.span);
        assert_eq!(planned.params.len(), item.params.len());
    }
    let pulse = plan
        .material(&Symbol::item("src/main.mtek", "Pulse"))
        .unwrap();
    let types: Vec<(&str, &str)> = pulse
        .params
        .iter()
        .map(|p| (p.name.as_str(), p.ty.as_str()))
        .collect();
    // Struct types as written, without the module path the IR spells them with.
    assert_eq!(types, [("tint", "color"), ("waves", "array<Wave, 2>")]);
    let layout = pulse.layout.as_ref().unwrap();
    assert_eq!(layout.id, "material:src/main.mtek::Pulse");
    let unlit = plan
        .material(&Symbol::item("std/materials.mtek", "Unlit"))
        .unwrap();
    assert_eq!(unlit.layout.as_ref().unwrap().size, 16);
    assert!(check_limits(&plan, "webgpu-core-2026", MAX_UNIFORM_BUFFER_BINDING_SIZE).is_empty());
}

#[test]
fn an_instance_that_does_not_match_its_material_is_a_defect() {
    let mut program = program(&scene(
        "    entity A { mesh: Box {}; material: Pulse {}; }\n",
    ));
    for module in &mut program.modules {
        for item in &mut module.items {
            if let ir::Item::Scene(scene) = item
                && let Some(material) = scene.entities[0].material.as_mut()
            {
                material.params.pop();
            }
        }
    }
    let defect = plan_program(&program).unwrap_err();
    assert!(defect.contains("declares"), "{defect}");
    let mut missing = self::program(&scene("    entity A { mesh: Box {}; }\n"));
    missing.modules.pop();
    let defect = plan_program(&missing).unwrap_err();
    assert!(defect.contains("not a material of the program"), "{defect}");
}

#[test]
fn meshes_compare_by_bits() {
    let a = MeshDesc::Plane { size: [0.0, 1.0] };
    let b = MeshDesc::Plane { size: [-0.0, 1.0] };
    assert!(!same_mesh(&a, &b));
    assert!(same_mesh(&a, &a.clone()));
    assert!(!same_mesh(&a, &MeshDesc::Box { size: [1.0; 3] }));
}

#[test]
fn written_types_drop_module_paths() {
    assert_eq!(written_type("color"), "color");
    assert_eq!(written_type("src/a.mtek::Wave"), "Wave");
    assert_eq!(
        written_type("array<src/shapes/a.mtek::Wave, 2>"),
        "array<Wave, 2>"
    );
}

fn block_of(len: u32) -> String {
    let zeros = vec!["0.0"; len as usize].join(", ");
    format!(
        "material Big {{\n    param samples: array<f32, {len}> = [{zeros}];\n    param gain: f32 = 1.0;\n    fragment(input: SurfaceInput) -> color {{ return #ffffff; }}\n}}\nscene Demo {{\n    camera Main {{}}\n    entity A {{ mesh: Box {{}}; material: Big {{}}; }}\n}}\n"
    )
}

#[test]
fn a_parameter_block_over_the_profile_limit_is_e6001() {
    // 4 095 elements of 16 bytes and the f32 after them: 65 536 bytes exactly.
    let fits = plan_program(&program(&block_of(4095))).unwrap();
    let size = fits.materials[0].layout.as_ref().unwrap().size;
    assert_eq!(size, MAX_UNIFORM_BUFFER_BINDING_SIZE);
    assert!(check_limits(&fits, "webgpu-core-2026", MAX_UNIFORM_BUFFER_BINDING_SIZE).is_empty());

    let source = block_of(4096);
    let plan = plan_program(&program(&source)).unwrap();
    let diagnostics = check_limits(&plan, "webgpu-core-2026", MAX_UNIFORM_BUFFER_BINDING_SIZE);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    let diagnostic = &diagnostics[0];
    assert_eq!(diagnostic.code, Code::E6001);
    assert_eq!(
        diagnostic.message,
        "The parameter block of material 'Big' is 65552 bytes, more than the 65536 bytes a uniform block may have in the target profile 'webgpu-core-2026'."
    );
    let primary = diagnostic.primary.as_ref().unwrap().span;
    assert!(source[primary.start as usize..primary.end as usize].starts_with("material Big {"));
    let related = &diagnostic.related[0];
    assert_eq!(
        &source[related.span.start as usize..related.span.end as usize],
        format!(
            "param samples: array<f32, 4096> = [{}];",
            vec!["0.0"; 4096].join(", ")
        )
    );
    assert_eq!(
        related.message.as_deref(),
        Some("param 'samples' takes 65536 bytes of the block")
    );
}
