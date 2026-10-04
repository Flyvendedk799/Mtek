//! Robustness of the scene and schema checks (`spec/testing.md` section 3.3,
//! `spec/compiler-architecture.md` section 3: the compiler never panics).
//! Random scenes — any number of cameras, entities nested at random, known,
//! unknown, duplicated and gated fields, descriptor literals of every M1
//! schema with values in and out of range, of the right and the wrong type,
//! constants and entity field reads — go through `mtek_compiler::analyze` on a
//! thread with the compilation stack. Nothing panics, every diagnostic has a
//! catalogue code and severity and lies in its file, checking twice gives the
//! same report, and a scene without errors is complete: every field of the
//! checked scene has a value and exactly one camera is active.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::thread;

use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::types::{CheckedEntity, CheckedField};
use mtek_compiler::{Analysis, analyze};

/// The stack of the compilation thread (`spec/compiler-architecture.md` 3).
const STACK: usize = 16 * 1024 * 1024;

/// SplitMix64, for deterministic programs.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % u64::try_from(bound.max(1)).unwrap()).unwrap()
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len())]
    }
}

const VEC3: &[&str] = &[
    "vec3(0.0, 1.0, 2.0)",
    "vec3(1.0)",
    "vec3(2.0, 0.5, 2.0)",
    "vec3(0.0)",
    "vec3(-1.0, 1.0, 1.0)",
    "vec2(1.0, 2.0)",
    "SIZE",
    "OFFSET * 2.0",
    "Other.position",
    "1.0",
    "#ff0000",
];

const MESHES: &[&str] = &[
    "Box {}",
    "Box { size: SIZE }",
    "Box { size: vec3(1.0, 0.0, 1.0) }",
    "Box { size: vec2(1.0, 1.0) }",
    "Box { size: Other.scale }",
    "Sphere { radius: 0.5; segments: 16; rings: 8 }",
    "Sphere { segments: 2 }",
    "Sphere { segments: 2.5 }",
    "Sphere { radius: 1.0; radius: 2.0 }",
    "Sphere { rimgs: 8 }",
    "Plane { size: vec2(4.0) }",
    "Plane {}",
    "MESH",
    "Unlit {}",
    "Camera {}",
    "Pbr {}",
];

const MATERIALS: &[&str] = &[
    "Unlit {}",
    "Unlit { color: #6b5cff }",
    "Unlit { color: #6b5cff80 }",
    "Unlit { color: TINT }",
    "Unlit { colour: #ffffff }",
    "Unlit { color: vec3(1.0) }",
    "Box {}",
];

const PROJECTIONS: &[&str] = &[
    "Perspective {}",
    "Perspective { fov_y: 0.8; near: 0.5; far: 50.0 }",
    "Perspective { fov_y: 3.5 }",
    "Perspective { near: 2000.0 }",
    "Orthographic { height: 10.0 }",
    "Orthographic { near: 10.0; far: 5.0 }",
    "Orthographic { height: 0.0 }",
    "Box {}",
];

fn entity(rng: &mut Rng, depth: usize, counter: &mut usize, out: &mut String) {
    *counter += 1;
    let name = format!("E{counter}");
    out.push_str(&format!("entity {name} {{ "));
    for _ in 0..rng.below(5) {
        match rng.below(10) {
            0 | 1 => out.push_str(&format!("position: {}; ", rng.pick(VEC3))),
            2 => out.push_str(&format!("scale: {}; ", rng.pick(VEC3))),
            3 | 4 => out.push_str(&format!("mesh: {}; ", rng.pick(MESHES))),
            5 | 6 => out.push_str(&format!("material: {}; ", rng.pick(MATERIALS))),
            7 => out.push_str(rng.pick(&[
                "visible: false; ",
                "rotation: quat.identity(); ",
                "light: PointLight {}; ",
                "positon: vec3(0.0); ",
                "visible: 1; ",
            ])),
            8 => out.push_str("const LOCAL = 2.0; "),
            _ => {
                if depth < 6 {
                    entity(rng, depth + 1, counter, out);
                }
            }
        }
    }
    out.push_str("} ");
}

fn program(rng: &mut Rng) -> String {
    let mut text = String::from(
        "const SIZE = vec3(1.0, 2.0, 1.0);\nconst OFFSET = vec3(0.5);\nconst TINT = #ffcc00;\nconst MESH = Sphere { radius: 2.0 };\n",
    );
    text.push_str("scene Demo {\n");
    for _ in 0..rng.below(3) {
        text.push_str(rng.pick(&[
            "clear_color: #101418; ",
            "clear_color: #10141800; ",
            "clear_color: vec3(0.0); ",
            "clear_color: TINT; ",
            "background: #000000; ",
            "gravity: vec3(0.0); ",
        ]));
    }
    // Zero to three cameras.
    for index in 0..rng.below(4) {
        text.push_str(&format!("camera C{index} {{ "));
        for _ in 0..rng.below(4) {
            match rng.below(6) {
                0 => text.push_str(&format!("position: {}; ", rng.pick(VEC3))),
                1 => text.push_str("target: vec3(0.0); "),
                2 => text.push_str("rotation: quat.euler(0.1, 0.2, 0.3); "),
                3 => text.push_str(&format!("projection: {}; ", rng.pick(PROJECTIONS))),
                4 => text.push_str(rng.pick(&["active: true; ", "active: false; ", "active: 1; "])),
                _ => text.push_str("fov: 1.0; "),
            }
        }
        text.push_str("}\n");
    }
    text.push_str("entity Other { mesh: Box {}; }\n");
    let mut counter = 0;
    for _ in 0..rng.below(4) {
        entity(rng, 0, &mut counter, &mut text);
        text.push('\n');
    }
    text.push_str("}\n");
    text
}

fn check_text(text: &str) -> Analysis {
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"fuzz\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), text);
    analyze(&ProjectRoot::at_base(), &fs)
}

fn complete(fields: &[CheckedField]) -> bool {
    fields.iter().all(|f| f.value.is_some())
}

fn entity_complete(entity: &CheckedEntity) -> bool {
    complete(&entity.fields) && entity.children.iter().all(entity_complete)
}

/// The invariants of one result over `text`; `Err` describes a violation.
fn invariants(text: &str, result: &Analysis) -> Result<(), String> {
    for d in &result.report.diagnostics {
        if !Code::ALL.contains(&d.code) || d.code == Code::E9999 {
            return Err(format!("{:?} is not a catalogue code", d.code));
        }
        if d.severity != d.code.severity() {
            return Err(format!("{} reported as {:?}", d.code, d.severity));
        }
        for label in d.primary.iter().chain(&d.related) {
            if text.get(label.span.range()).is_none() {
                return Err(format!(
                    "{} at {:?} is outside the text",
                    d.code, label.span
                ));
            }
        }
    }
    let errors = result
        .report
        .diagnostics
        .iter()
        .any(|d| d.severity == Severity::Error);
    if !errors {
        let (Some(resolution), Some(types)) = (&result.resolution, &result.types) else {
            return Err("no resolution or types without errors".to_owned());
        };
        let scene = resolution
            .entry_scene()
            .and_then(|def| types.scene(def))
            .ok_or("no checked entry scene without errors")?;
        if !complete(&scene.fields)
            || !scene.objects.iter().all(|o| complete(&o.fields))
            || !scene.entities.iter().all(entity_complete)
        {
            return Err("a field of a scene without errors has no value".to_owned());
        }
        if scene.objects.iter().filter(|o| o.active).count() != 1 {
            return Err("a scene without errors has no single active camera".to_owned());
        }
    }
    Ok(())
}

#[test]
fn random_scenes_never_break_the_scene_checks() {
    let mut rng = Rng(0x4d31_2d31_3131);
    let programs: Vec<String> = (0..1500).map(|_| program(&mut rng)).collect();
    let outcome = thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let mut codes = BTreeSet::new();
            let mut clean = 0;
            for text in &programs {
                let first = check_text(text);
                if let Err(problem) = invariants(text, &first) {
                    panic!("{problem} in\n{text}");
                }
                let second = check_text(text);
                assert_eq!(
                    first.report.diagnostics, second.report.diagnostics,
                    "{text}"
                );
                if first.report.diagnostics.is_empty() {
                    clean += 1;
                }
                codes.extend(first.report.diagnostics.iter().map(|d| d.code.short()));
            }
            // The generator reaches the clean case and the codes of the
            // scene checks.
            assert!(clean > 0, "no program without diagnostics");
            for code in [
                "E3001", "E3041", "E3102", "E5001", "E5002", "E5006", "E5010", "E5011", "E5012",
                "E5013", "E5020", "E5081", "E5090", "E5100", "E9010",
            ] {
                assert!(codes.contains(code), "{code} never reported: {codes:?}");
            }
        })
        .unwrap()
        .join();
    assert!(outcome.is_ok(), "the scene checks panicked");
}

#[test]
fn deeply_nested_entities_are_checked() {
    // The parser bounds nesting (256 levels, `E1050`); entities nested just
    // below the bound are checked, and their tree is kept.
    let depth = 120;
    let mut text = String::from("scene Demo { camera Main {} ");
    for level in 0..depth {
        text.push_str(&format!("entity E{level} {{ mesh: Box {{}}; "));
    }
    text.push_str(&"} ".repeat(depth));
    text.push_str("}\n");
    let outcome = thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let result = check_text(&text);
            assert!(result.report.diagnostics.is_empty(), "{:?}", result.report);
            let types = result.types.unwrap();
            let [scene] = types.scenes() else {
                panic!("one scene expected")
            };
            assert_eq!(scene.entities_in_order().len(), depth);
        })
        .unwrap()
        .join();
    assert!(outcome.is_ok(), "nested entities panicked");
}
