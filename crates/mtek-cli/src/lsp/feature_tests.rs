//! Tests of hover and go to definition against real projects on disk.

use mtek_compiler::source::ProjectPath;

use super::analysis::Snapshot;
use super::definition::{Target, definition_at};
use super::hover::hover_at;
use super::overlay::Buffers;
use super::prelude_doc::{self, REFERENCE_PATH};
use super::testkit::TempProject;

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
";

/// The entry module, with a marker where the test's cursor is.
const MAIN: &str = "\
import { Light, double } from \"./lib.mtek\";

/// Pulse speed in radians per second.
const SPEED: f32 = 0.7;

/// A material that tints.
material Pulse {
    /// The tint colour.
    param tint: color = #6b5cff;
    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb, 1.0);
    }
}

scene Demo {
    state speed: f32 = SPEED;
    camera Main { position: vec3(0.0, 2.0, 5.0); }
    entity Cube {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Pulse { tint: #ffffff };
        position: vec3(0.0, 0.5, 0.0);
        update(dt: f32) {
            let angle = double(speed) * dt;
            let light = Light { intensity: 2.0; position: vec3(0.0, 1.0, 0.0); };
            self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), angle + light.intensity);
        }
    }
    on key_down(Key.Space) {
        speed = -speed;
    }
}
";

struct Fixture {
    project: TempProject,
    snapshot: Snapshot,
}

impl Fixture {
    fn new(extra: &[(&str, &str)]) -> Self {
        let mut files: Vec<(&str, &str)> = vec![("src/lib.mtek", LIB)];
        files.extend_from_slice(extra);
        files.push(("src/main.mtek", MAIN));
        let project = TempProject::new(&files);
        let snapshot = Snapshot::run(&project.dir, &Buffers::new(), false);
        Fixture { project, snapshot }
    }

    /// The byte offset of the `n`th (0-based) `needle` of `file`, plus `delta`.
    fn at(&self, file: &str, needle: &str, n: usize, delta: usize) -> u32 {
        let text = std::fs::read_to_string(self.project.path(file)).unwrap();
        let (index, _) = text
            .match_indices(needle)
            .nth(n)
            .expect("the needle is there");
        u32::try_from(index + delta).unwrap()
    }

    fn hover(&self, file: &str, needle: &str, n: usize) -> String {
        let path = ProjectPath::new(file).unwrap();
        let view = self.snapshot.module_at(&path).unwrap();
        let offset = self.at(file, needle, n, 0);
        hover_at(&self.snapshot, &view, offset)
            .unwrap_or_else(|| panic!("no hover at {needle:?}"))
            .markdown
    }

    fn definition(&self, file: &str, needle: &str, n: usize) -> Option<Target> {
        let path = ProjectPath::new(file).unwrap();
        let view = self.snapshot.module_at(&path).unwrap();
        definition_at(&self.snapshot, &view, self.at(file, needle, n, 0))
    }

    /// The text a source target covers, with the file's path.
    fn target_text(&self, target: Target) -> (String, String) {
        match target {
            Target::Source { module, span } => {
                let view = self.snapshot.module(module).unwrap();
                (
                    view.path.to_string(),
                    view.source.slice(span.start, span.end).unwrap().to_owned(),
                )
            }
            Target::Prelude(location) => {
                let doc = prelude_doc::document(location.path).unwrap();
                (
                    format!("mtek-prelude:{}", location.path),
                    doc.text[location.start as usize..location.end as usize].to_owned(),
                )
            }
            Target::Module(module) => (
                self.snapshot.module(module).unwrap().path.to_string(),
                String::new(),
            ),
        }
    }
}

#[test]
fn the_fixture_project_has_no_errors() {
    let fixture = Fixture::new(&[]);
    let errors: Vec<_> = fixture
        .snapshot
        .analysis
        .report
        .diagnostics
        .iter()
        .map(|d| format!("{} {}", d.code.as_str(), d.message))
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
}

#[test]
fn hover_on_a_local_variable_shows_its_type() {
    let f = Fixture::new(&[]);
    assert_eq!(
        f.hover("src/main.mtek", "angle +", 0),
        "```mtek\nlet angle: f32\n```"
    );
    // The declaration itself and a use say the same.
    assert_eq!(
        f.hover("src/main.mtek", "angle =", 0),
        "```mtek\nlet angle: f32\n```"
    );
}

#[test]
fn hover_on_state_parameters_and_loop_variables() {
    let f = Fixture::new(&[]);
    assert_eq!(
        f.hover("src/main.mtek", "speed)", 0),
        "```mtek\nstate speed: f32\n```"
    );
    assert_eq!(f.hover("src/main.mtek", "dt;", 0), "```mtek\ndt: f32\n```");
}

#[test]
fn hover_on_a_constant_shows_the_value_as_written_and_the_doc_comment() {
    let f = Fixture::new(&[]);
    assert_eq!(
        f.hover("src/main.mtek", "SPEED;", 0),
        "```mtek\nconst SPEED: f32 = 0.7\n```\n\nPulse speed in radians per second."
    );
}

#[test]
fn hover_on_a_function_of_another_module_shows_signature_doc_and_origin() {
    let f = Fixture::new(&[]);
    assert_eq!(
        f.hover("src/main.mtek", "double(speed)", 0),
        "```mtek\nfn double(x: f32) -> f32\n```\n\nDoubles a number.\n\n*declared in `src/lib.mtek`*"
    );
    // The import list names the same declaration.
    assert_eq!(
        f.hover("src/main.mtek", "double }", 0),
        f.hover("src/main.mtek", "double(speed)", 0)
    );
    // In its own module there is no origin line.
    assert_eq!(
        f.hover("src/lib.mtek", "double(x", 0),
        "```mtek\nfn double(x: f32) -> f32\n```\n\nDoubles a number."
    );
}

#[test]
fn hover_on_a_struct_and_its_fields() {
    let f = Fixture::new(&[]);
    let text = f.hover("src/main.mtek", "Light { intensity", 0);
    assert!(
        text.starts_with(
            "```mtek\nstruct Light {\n    intensity: f32;\n    position: vec3;\n}\n```\n\nA point light."
        ),
        "{text}"
    );
    // A field name in a struct literal and in an access, with the field's own doc comment.
    let literal = f.hover("src/main.mtek", "intensity: 2.0", 0);
    assert_eq!(
        literal,
        "```mtek\nintensity: f32\n```\n\nHow bright it is.\n\n*declared in `src/lib.mtek`*"
    );
    assert_eq!(f.hover("src/main.mtek", "intensity);", 0), literal);
}

#[test]
fn hover_on_a_material_its_param_and_the_param_in_a_descriptor() {
    let f = Fixture::new(&[]);
    let material = f.hover("src/main.mtek", "Pulse {", 1);
    assert!(
        material.starts_with("```mtek\nmaterial Pulse {\n    param tint: color = #6b5cff;\n}\n```\n\nA material that tints."),
        "{material}"
    );
    let param = "```mtek\nparam tint: color = #6b5cff\n```\n\nThe tint colour.";
    assert_eq!(f.hover("src/main.mtek", "tint: #ffffff", 0), param);
    // Inside the material the param is a name of its body.
    assert_eq!(f.hover("src/main.mtek", "tint.rgb", 0), param);
}

#[test]
fn hover_on_registry_fields_functions_and_members_has_the_registry_docs() {
    let f = Fixture::new(&[]);
    let size = f.hover("src/main.mtek", "size:", 0);
    assert!(
        size.starts_with("```mtek\nsize: vec3 = vec3(1.0, 1.0, 1.0)\n```"),
        "{size}"
    );
    assert!(size.contains("field of `Box`"), "{size}");
    let position = f.hover("src/main.mtek", "position: vec3(0.0, 0.5", 0);
    assert!(position.contains("field of `Entity`"), "{position}");
    let camera_position = f.hover("src/main.mtek", "position: vec3(0.0, 2.0", 0);
    assert!(
        camera_position.contains("field of `Camera`"),
        "{camera_position}"
    );
    let axis_angle = f.hover("src/main.mtek", "axis_angle", 0);
    assert!(axis_angle.contains("fn quat.axis_angle("), "{axis_angle}");
    let space = f.hover("src/main.mtek", "Space", 0);
    assert!(space.contains("Key.Space"), "{space}");
    let key = f.hover("src/main.mtek", "Key.", 0);
    assert!(key.contains("enum Key"), "{key}");
    let event = f.hover("src/main.mtek", "key_down", 0);
    assert!(event.contains("on key_down(Key)"), "{event}");
    let camera = f.hover("src/main.mtek", "camera Main", 0);
    assert!(camera.contains("Camera"), "{camera}");
    let linear = f.hover("src/main.mtek", "linear", 0);
    assert!(linear.contains("fn color.linear("), "{linear}");
    let surface = f.hover("src/main.mtek", "SurfaceInput", 0);
    assert!(surface.contains("type SurfaceInput"), "{surface}");
    let vec3 = f.hover("src/main.mtek", "vec3(1.0, 1.0", 0);
    assert!(vec3.contains("type vec3"), "{vec3}");
}

#[test]
fn hover_on_an_access_through_self_reads_what_the_checker_recorded() {
    let f = Fixture::new(&[]);
    let rotation = f.hover("src/main.mtek", "rotation *=", 0);
    assert!(
        rotation.contains("field of `Entity`") && rotation.contains("rotation: quat"),
        "{rotation}"
    );
    // `tint.rgb`: a swizzle with its type.
    assert_eq!(
        f.hover("src/main.mtek", "rgb", 0),
        "`.rgb` of `color`: `vec3`"
    );
    // `self` is the entity.
    assert_eq!(
        f.hover("src/main.mtek", "self.", 0),
        "```mtek\nentity Cube\n```"
    );
}

#[test]
fn hover_on_a_literal_or_an_operator_shows_the_expression_type() {
    let f = Fixture::new(&[]);
    assert_eq!(
        f.hover("src/main.mtek", "0.7", 0),
        "```mtek\nf32\n```\n\nconstant value `0.7`"
    );
    let product = f.hover("src/main.mtek", "* dt", 0);
    assert!(product.starts_with("```mtek\nf32\n```"), "{product}");
}

#[test]
fn hover_where_there_is_nothing_is_none() {
    let f = Fixture::new(&[]);
    let view = f
        .snapshot
        .module_at(&ProjectPath::new("src/main.mtek").unwrap())
        .unwrap();
    for offset in [f.at("src/main.mtek", "\n\n///", 0, 1), u32::MAX] {
        assert!(hover_at(&f.snapshot, &view, offset).is_none(), "{offset}");
    }
}

#[test]
fn a_prelude_item_is_defined_in_a_virtual_document() {
    let f = Fixture::new(&[]);
    for (needle, n, path, name) in [
        ("Box {", 0, "mtek-prelude:std/prelude.mtek", "Box"),
        ("size:", 0, "mtek-prelude:std/prelude.mtek", "size"),
        (
            "axis_angle",
            0,
            "mtek-prelude:std/prelude.mtek",
            "axis_angle",
        ),
        ("Space", 0, "mtek-prelude:std/prelude.mtek", "Space"),
        ("key_down", 0, "mtek-prelude:std/prelude.mtek", "key_down"),
        ("camera Main", 0, "mtek-prelude:std/prelude.mtek", "camera"),
        ("vec3(1.0, 1.0", 0, "mtek-prelude:std/prelude.mtek", "vec3"),
    ] {
        let target = f
            .definition("src/main.mtek", needle, n)
            .unwrap_or_else(|| panic!("{needle}"));
        assert_eq!(
            f.target_text(target),
            (path.to_owned(), name.to_owned()),
            "{needle}"
        );
    }
}

#[test]
fn a_builtin_material_is_defined_in_its_mtek_source() {
    let main = MAIN.replace(
        "material: Pulse { tint: #ffffff }",
        "material: Pbr { metallic: 0.5 }",
    );
    let project = TempProject::new(&[("src/lib.mtek", LIB), ("src/main.mtek", &main)]);
    let snapshot = Snapshot::run(&project.dir, &Buffers::new(), false);
    let view = snapshot
        .module_at(&ProjectPath::new("src/main.mtek").unwrap())
        .unwrap();
    let offset = u32::try_from(main.find("Pbr {").unwrap()).unwrap();
    let Some(Target::Prelude(location)) = definition_at(&snapshot, &view, offset) else {
        panic!("not a prelude target");
    };
    assert_eq!(location.path, "std/materials.mtek");
    let doc = prelude_doc::document(location.path).unwrap();
    assert_eq!(
        &doc.text[location.start as usize..location.end as usize],
        "Pbr"
    );
    // The field of the material goes to the reference.
    let offset = u32::try_from(main.find("metallic").unwrap()).unwrap();
    let Some(Target::Prelude(field)) = definition_at(&snapshot, &view, offset) else {
        panic!("not a prelude target");
    };
    assert_eq!(field.path, REFERENCE_PATH);
}

#[test]
fn definitions_of_names_of_the_program() {
    let f = Fixture::new(&[]);
    let src = |text: &str| ("src/main.mtek".to_owned(), text.to_owned());
    let lib = |text: &str| ("src/lib.mtek".to_owned(), text.to_owned());
    // A local, a state, a constant, a parameter.
    let t = f.definition("src/main.mtek", "angle +", 0).unwrap();
    assert_eq!(f.target_text(t), src("angle"));
    let t = f.definition("src/main.mtek", "speed)", 0).unwrap();
    assert_eq!(f.target_text(t), src("speed"));
    let t = f.definition("src/main.mtek", "SPEED;", 0).unwrap();
    assert_eq!(f.target_text(t), src("SPEED"));
    // Through the import to the declaration in the other module.
    let t = f.definition("src/main.mtek", "double(speed)", 0).unwrap();
    assert_eq!(f.target_text(t), lib("double"));
    let t = f.definition("src/main.mtek", "double }", 0).unwrap();
    assert_eq!(f.target_text(t), lib("double"));
    let t = f
        .definition("src/main.mtek", "Light { intensity", 0)
        .unwrap();
    assert_eq!(f.target_text(t), lib("Light"));
    // A field of a struct of another module, in a literal and in an access.
    let t = f.definition("src/main.mtek", "intensity: 2.0", 0).unwrap();
    assert_eq!(f.target_text(t), lib("intensity"));
    let t = f.definition("src/main.mtek", "intensity);", 0).unwrap();
    assert_eq!(f.target_text(t), lib("intensity"));
    // A param of a material, in a descriptor and in the body.
    let t = f.definition("src/main.mtek", "tint: #ffffff", 0).unwrap();
    assert_eq!(f.target_text(t), src("tint"));
    let t = f.definition("src/main.mtek", "tint.rgb", 0).unwrap();
    assert_eq!(f.target_text(t), src("tint"));
    // `self` is the entity; a material name is its declaration.
    let t = f.definition("src/main.mtek", "self.", 0).unwrap();
    assert_eq!(f.target_text(t), src("Cube"));
    let t = f.definition("src/main.mtek", "Pulse {", 1).unwrap();
    assert_eq!(f.target_text(t), src("Pulse"));
}

#[test]
fn the_import_specifier_goes_to_the_module() {
    let f = Fixture::new(&[]);
    let t = f.definition("src/main.mtek", "./lib.mtek", 0).unwrap();
    assert_eq!(f.target_text(t), ("src/lib.mtek".to_owned(), String::new()));
}

#[test]
fn definition_where_there_is_no_name_is_none() {
    let f = Fixture::new(&[]);
    assert!(f.definition("src/main.mtek", "0.7", 0).is_none());
    assert!(
        f.definition("src/main.mtek", "rgb", 0).is_none(),
        "a swizzle has no declaration"
    );
}
