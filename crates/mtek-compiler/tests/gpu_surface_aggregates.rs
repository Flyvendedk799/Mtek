//! Whole SurfaceInput values keep the stage wrapper's representation when nested.
#![allow(clippy::unwrap_used, clippy::panic)]

use mtek_compiler::emit_wgsl::validate_wgsl;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, analyze, build};
use naga::TypeInner;

fn compile(declarations: &str, body: &str) -> naga::Module {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"surface\"\nlanguage = \"0.1\"\n",
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        format!(
            "{declarations}\nmaterial M {{ param index: i32 = 1; fragment(input: SurfaceInput) -> color {{ {body} }} }}\nscene Demo {{ camera Main {{}} entity E {{ mesh: Box {{}}; material: M {{}}; }} }}"
        ),
    );
    let checked = analyze(&ProjectRoot::at_base(), &fs);
    assert!(!checked.has_errors(), "{:#?}", checked.report);
    let built = build(
        &ProjectRoot::at_base(),
        &fs,
        &CompileOptions::with_stub_runtime(BuildMode::Release),
    );
    assert!(!built.has_errors(), "{:#?}", built.report);
    let wgsl = built
        .files
        .iter()
        .find(|(path, _)| path.ends_with(".wgsl"))
        .unwrap()
        .1;
    let module = validate_wgsl(std::str::from_utf8(wgsl).unwrap()).unwrap();
    let surface: Vec<_> = module
        .types
        .iter()
        .filter(|(_, ty)| ty.name.as_deref() == Some("MtekSurfaceInput"))
        .collect();
    assert_eq!(surface.len(), 1);
    let TypeInner::Struct { members, span } = &surface[0].1.inner else {
        panic!("SurfaceInput must be a struct");
    };
    assert_eq!(*span, 80);
    assert_eq!(
        members
            .iter()
            .map(|m| (m.name.as_deref().unwrap(), m.offset))
            .collect::<Vec<_>>(),
        [
            ("local_position", 0),
            ("world_position", 16),
            ("world_normal", 32),
            ("uv", 48),
            ("world_tangent", 64)
        ]
    );
    module
}

#[test]
fn stage_inputs_in_arrays_support_constant_and_clamped_indices() {
    let module = compile(
        "",
        "let values = [input, input]; return color.linear(values[index].world_normal + values[0].world_position, 1.0);",
    );
    assert!(module.types.iter().any(|(_, ty)| matches!(ty.inner, TypeInner::Array { base, stride: 80, .. } if module.types[base].name.as_deref() == Some("MtekSurfaceInput"))));
}

#[test]
fn stage_inputs_in_nested_structs_arrays_and_function_signatures_validate() {
    compile(
        "struct Wrapped { surface: SurfaceInput; enabled: bool; }\nstruct Bundle { values: array<Wrapped, 2>; }\nfn wrap(surface: SurfaceInput) -> Bundle { return Bundle { values: [Wrapped { surface: surface; enabled: true; }, Wrapped { surface: surface; enabled: false; }]; }; }\nfn unwrap(bundle: Bundle, at: i32) -> SurfaceInput { return bundle.values[at].surface; }",
        "let bundle = wrap(input); let result = unwrap(bundle, index); return color.linear(result.world_normal + vec3(result.uv, 0.0), 1.0);",
    );
}

#[test]
fn stage_input_aggregate_iteration_and_place_writes_validate() {
    compile(
        "struct Wrapped { surface: SurfaceInput; }",
        "var values = [Wrapped { surface: input; }, Wrapped { surface: input; }]; values[index] = Wrapped { surface: input; }; var sum = vec3(0.0); for value in values { sum += value.surface.world_normal; } return color.linear(sum, 1.0);",
    );
}

#[test]
fn arrays_of_stage_inputs_in_function_parameters_and_results_validate() {
    compile(
        "fn repeat(surface: SurfaceInput) -> array<SurfaceInput, 2> { return [surface, surface]; }\nfn pick(values: array<SurfaceInput, 2>, at: i32) -> SurfaceInput { return values[at]; }",
        "return color.linear(pick(repeat(input), index).world_normal, 1.0);",
    );
}
