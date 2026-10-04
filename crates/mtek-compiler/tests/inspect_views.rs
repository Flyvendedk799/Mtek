//! `mtek inspect --shaders` and `--bindings` through `mtek_compiler::inspect` (decision 0044).
//!
//! * Goldens: `tests/codegen/inspect/<fixture>.{shaders,bindings}.{json,txt}` (`--format
//!   json` and `--format human`) for the pass fixtures `scene_a_target_camera_box` (the
//!   built-in `Unlit`), `materials/pulse` (a user material with a function) and
//!   `materials/params_and_defaults` (every kind of param: struct, array, `bool`, `mat4`).
//!   Rewrite them with `MTEK_BLESS=1 cargo test -p mtek-compiler --test inspect_views` and
//!   review the diff like code.
//! * Agreement with `build`: the shaders are the build's `.wgsl` files byte for byte, the
//!   blocks are the manifest's `layouts`, the instances its `materialInstances`.
//! * Every semantic pass fixture gives both views, deterministically (twice, and with
//!   shuffled listings); JSON parses; a program with errors gives `check`'s diagnostics and
//!   no view; a parameter block over the profile limit is `E6001` and no view.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{
    BuildMode, CompileOptions, Inspect, InspectFormat, InspectResult, build, check, inspect,
};
use serde_json::Value;

const GOLDEN_FIXTURES: [&str; 3] = [
    "scene_a_target_camera_box",
    "materials/pulse",
    "materials/params_and_defaults",
];

const VIEWS: [(Inspect, &str); 2] = [
    (Inspect::Shaders, "shaders"),
    (Inspect::Bindings, "bindings"),
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn golden_dir() -> PathBuf {
    repo().join("tests/codegen/inspect")
}

fn semantics_dir(suite: &str) -> PathBuf {
    repo().join("tests/semantics").join(suite)
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

fn subdirectories(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry.file_type().ok()?.is_dir().then_some(())?;
            entry.file_name().into_string().ok()
        })
        .collect();
    names.sort();
    names
}

/// The fixtures of a semantic suite (group directories contribute `group/name`).
fn fixtures(suite: &str) -> Vec<String> {
    let root = semantics_dir(suite);
    let mut names = Vec::new();
    for name in subdirectories(&root) {
        let dir = root.join(&name);
        if dir.join("mtek.toml").is_file() {
            names.push(name);
        } else {
            names.extend(
                subdirectories(&dir)
                    .into_iter()
                    .map(|fixture| format!("{name}/{fixture}")),
            );
        }
    }
    names
}

fn files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            files(root, &path, out);
            continue;
        }
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

fn fixture_fs(suite: &str, name: &str, shuffle: Option<u64>) -> MemFs {
    let root = semantics_dir(suite).join(name);
    let mut found = Vec::new();
    files(&root, &root, &mut found);
    if let Some(seed) = shuffle {
        let len = found.len();
        for index in 0..len {
            let other = (index * 7 + seed as usize * 13 + 5) % len;
            found.swap(index, other);
        }
    }
    let mut memory = MemFs::new();
    for (path, bytes) in found {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

fn inspected(memory: &MemFs, what: Inspect) -> InspectResult {
    inspect(&ProjectRoot::at_base(), memory, what)
}

fn check_golden(path: &Path, actual: &str) {
    if blessing() {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("{}: {e} (bless with MTEK_BLESS=1)", path.display()))
        .replace("\r\n", "\n");
    assert_eq!(actual, expected, "{} differs", path.display());
}

#[test]
fn inspect_views_match_their_goldens() {
    for fixture in GOLDEN_FIXTURES {
        let memory = fixture_fs("pass", fixture, None);
        for (what, view) in VIEWS {
            let result = inspected(&memory, what);
            assert!(!result.has_errors(), "{fixture}: {:#?}", result.report);
            let stem = fixture.replace('/', "_");
            for (format, extension) in
                [(InspectFormat::Json, "json"), (InspectFormat::Human, "txt")]
            {
                let text = result.render(format).unwrap();
                check_golden(
                    &golden_dir().join(format!("{stem}.{view}.{extension}")),
                    &text,
                );
            }
        }
    }
}

#[test]
fn the_golden_directory_holds_exactly_the_goldens() {
    let mut expected: Vec<String> = GOLDEN_FIXTURES
        .iter()
        .flat_map(|fixture| {
            let stem = fixture.replace('/', "_");
            VIEWS.iter().flat_map(move |(_, view)| {
                let stem = stem.clone();
                ["json", "txt"].map(move |ext| format!("{stem}.{view}.{ext}"))
            })
        })
        .collect();
    expected.sort();
    if blessing() {
        return;
    }
    let mut found: Vec<String> = fs::read_dir(golden_dir())
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    found.sort();
    assert_eq!(found, expected);
}

#[test]
fn the_views_agree_with_the_build() {
    for fixture in fixtures("pass") {
        let memory = fixture_fs("pass", &fixture, None);
        let built = build(
            &ProjectRoot::at_base(),
            &memory,
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!built.has_errors(), "{fixture}: {:#?}", built.report);
        let manifest: Value =
            serde_json::from_slice(&built.files["program.manifest.json"]).unwrap();

        let shaders = inspected(&memory, Inspect::Shaders);
        let view: Value =
            serde_json::from_str(&shaders.render(InspectFormat::Json).unwrap()).unwrap();
        let listed = view["shaders"].as_array().unwrap();
        assert_eq!(
            listed.len(),
            manifest["shaders"].as_array().unwrap().len(),
            "{fixture}"
        );
        for (shader, entry) in listed.iter().zip(manifest["shaders"].as_array().unwrap()) {
            assert_eq!(shader["material"], entry["material"], "{fixture}");
            assert_eq!(shader["hash"], entry["hash"], "{fixture}");
            assert_eq!(shader["url"], entry["url"], "{fixture}");
            let url = shader["url"].as_str().unwrap();
            assert_eq!(
                shader["wgsl"].as_str().unwrap().as_bytes(),
                built.files[url].as_slice(),
                "{fixture}"
            );
            assert_eq!(shader["vertexAttributes"], entry["vertexAttributes"]);
            assert_eq!(shader["surfaceInputs"], entry["surfaceInputs"]);
        }

        let bindings = inspected(&memory, Inspect::Bindings);
        let view: Value =
            serde_json::from_str(&bindings.render(InspectFormat::Json).unwrap()).unwrap();
        let ids: Vec<&str> = view["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["id"].as_str().unwrap())
            .collect();
        let layouts: Vec<&str> = manifest["layouts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, layouts, "{fixture}");
        for (block, layout) in view["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .zip(manifest["layouts"].as_array().unwrap())
        {
            assert_eq!(block["size"], layout["size"], "{fixture}");
            assert_eq!(block["wgslStruct"], layout["wgslStruct"], "{fixture}");
        }
        let instances = view["instances"].as_array().unwrap();
        let planned = manifest["scene"]["materialInstances"].as_array().unwrap();
        assert_eq!(instances.len(), planned.len(), "{fixture}");
        for (instance, entry) in instances.iter().zip(planned) {
            assert_eq!(instance["index"], entry["index"]);
            assert_eq!(instance["material"], entry["material"]);
            assert_eq!(instance["entityIndex"], entry["entity"]);
            assert_eq!(instance["shareable"], entry["shareable"]);
            let classes: Vec<&Value> = instance["params"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| &p["update"])
                .collect();
            let expected: Vec<&Value> = entry["params"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| &p["class"])
                .collect();
            assert_eq!(classes, expected, "{fixture}");
        }
    }
}

#[test]
fn every_pass_fixture_gives_deterministic_views() {
    for fixture in fixtures("pass") {
        for (what, view) in VIEWS {
            let first = inspected(&fixture_fs("pass", &fixture, None), what);
            assert!(!first.has_errors(), "{fixture} {view}: {:#?}", first.report);
            for format in [InspectFormat::Json, InspectFormat::Human] {
                let text = first.render(format).unwrap();
                assert!(text.ends_with('\n'));
                for seed in [None, Some(3)] {
                    let again = inspected(&fixture_fs("pass", &fixture, seed), what);
                    assert_eq!(again.render(format).unwrap(), text, "{fixture} {view}");
                }
            }
            let json: Value = serde_json::from_str(&first.render(InspectFormat::Json).unwrap())
                .unwrap_or_else(|e| panic!("{fixture} {view}: {e}"));
            assert_eq!(json["targetProfile"], "webgpu-core-2026");
        }
    }
}

#[test]
fn a_program_with_errors_has_check_s_diagnostics_and_no_view() {
    for fixture in fixtures("fail") {
        let memory = fixture_fs("fail", &fixture, None);
        let checked = check(&ProjectRoot::at_base(), &memory);
        for (what, view) in VIEWS {
            let result = inspected(&memory, what);
            assert_eq!(
                result.report.diagnostics, checked.report.diagnostics,
                "{fixture} {view}"
            );
            assert!(result.render(InspectFormat::Json).is_none(), "{fixture}");
            assert!(result.render(InspectFormat::Human).is_none(), "{fixture}");
        }
    }
}

#[test]
fn a_parameter_block_over_the_profile_limit_is_e6001_and_no_view() {
    let zeros = vec!["0.0"; 4096].join(", ");
    let mut memory = MemFs::new();
    memory
        .insert(
            ProjectPath::new("mtek.toml").unwrap(),
            "[project]\nname = \"big\"\nlanguage = \"0.1\"\n",
        )
        .insert(
            ProjectPath::new("src/main.mtek").unwrap(),
            format!(
                "material Big {{\n    param samples: array<f32, 4096> = [{zeros}];\n    param gain: f32 = 1.0;\n    fragment(input: SurfaceInput) -> color {{ return #ffffff; }}\n}}\nscene Demo {{\n    camera Main {{}}\n    entity A {{ mesh: Box {{}}; material: Big {{}}; }}\n}}\n"
            ),
        );
    for (what, view) in VIEWS {
        let result = inspected(&memory, what);
        let codes: Vec<&str> = result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.short())
            .collect();
        assert_eq!(codes, ["E6001"], "{view}");
        assert!(result.render(InspectFormat::Json).is_none());
    }
    // `--ir` shows the program: the limit is the plan's, not the IR's.
    let ir = inspected(&memory, Inspect::Ir);
    assert!(ir.report.diagnostics.is_empty());
    assert!(ir.render(InspectFormat::Json).is_some());
}
