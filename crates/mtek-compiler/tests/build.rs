//! `mtek_compiler::build`: the `dist/` file set (`spec/runtime-abi.md` section 2,
//! `spec/testing.md` sections 3.1, 4.3 and 7, decision 0030).
//!
//! * Goldens: every codegen fixture (a directory directly under `tests/codegen/` with an
//!   `mtek.toml`) is built in release mode with the stub runtime bundle and the stub
//!   declarations; its `expected/` directory holds exactly the resulting `dist/` tree minus
//!   the bundle file. Rewrite with `MTEK_BLESS=1 cargo test -p mtek-compiler --test build`
//!   and review the diff like code.
//! * Reproducibility: every codegen fixture and every semantic pass fixture builds to
//!   byte-identical files twice and with shuffled directory listings.
//! * Every manifest validates against `spec/manifest.schema.json`, every span of it resolves
//!   back through the source map to the same seven fields, and every content-addressed name
//!   is the hash of its bytes.
//! * Hygiene (`spec/testing.md` section 4.3): no generated `app.js` names a forbidden
//!   identifier outside the runtime import line; no output contains an absolute path.
//! * `E9030` without a bundle or declarations, no files for a program with errors.
//! * Preview builds (decision 0075): the release code plus a budget check at the head of every
//!   loop, the `preview` object of the manifest, the external `bootstrap.js`, the policy page;
//!   every other mode is untouched.
//! * Every semantic pass fixture builds, those with user materials included (their shaders
//!   come from the shader lowering, decision 0041).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use common::manifest_schema::{assert_valid, validator};
use mtek_compiler::package::Manifest;
use mtek_compiler::package::identity::{h16, sha256_hex};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{FileId, MemFs, ProjectPath};
use mtek_compiler::{
    BuildMode, BuildResult, CompileOptions, STUB_PHYSICS_BUNDLE, STUB_RUNTIME_BUNDLE,
    STUB_RUNTIME_DECLARATIONS, build, check,
};
use serde_json::{Value, json};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn codegen_dir() -> PathBuf {
    repo().join("tests/codegen")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// Sorted names of the directories under `dir` that satisfy `keep`.
fn directories(dir: &Path, keep: impl Fn(&Path) -> bool) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            entry.file_type().ok()?.is_dir().then_some(())?;
            keep(&entry.path()).then_some(())?;
            entry.file_name().into_string().ok()
        })
        .collect();
    names.sort();
    names
}

/// The codegen fixtures: directories directly under `tests/codegen/` with an `mtek.toml`.
fn codegen_fixtures() -> Vec<String> {
    directories(&codegen_dir(), |path| path.join("mtek.toml").is_file())
}

/// The fixtures of a semantic suite: directories with an `mtek.toml`, and the
/// fixtures of group directories (`types/`) as `group/name` (the rule of
/// `tests/fixtures.rs`).
fn semantic_fixtures(suite: &str) -> Vec<String> {
    let root = repo().join("tests/semantics").join(suite);
    let mut names = Vec::new();
    for name in directories(&root, |_| true) {
        let dir = root.join(&name);
        if dir.join("mtek.toml").is_file() {
            names.push(name);
        } else {
            names.extend(
                directories(&dir, |_| true)
                    .into_iter()
                    .map(|fixture| format!("{name}/{fixture}")),
            );
        }
    }
    names.sort();
    names
}

/// Every file below `dir` relative to `root`, sorted, skipping `skip` (relative names).
fn files(root: &Path, dir: &Path, skip: &[&str], out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .components()
            .map(|c| c.as_os_str().to_str().unwrap().to_owned())
            .collect::<Vec<_>>()
            .join("/");
        if skip.contains(&relative.as_str()) {
            continue;
        }
        if path.is_dir() {
            files(root, &path, skip, out);
        } else {
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

/// The in-memory project in `root` (without its expectations).
fn project_fs(root: &Path, shuffle: Option<u64>) -> MemFs {
    let mut list = Vec::new();
    files(
        root,
        root,
        &["expected", "expected.diag.json", "exec.json"],
        &mut list,
    );
    let mut memory = match shuffle {
        Some(seed) => MemFs::new().with_shuffled_listing(seed),
        None => MemFs::new(),
    };
    for (path, bytes) in list {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

fn stub(mode: BuildMode) -> CompileOptions {
    CompileOptions::with_stub_runtime(mode)
}

fn build_dir(root: &Path, shuffle: Option<u64>, mode: BuildMode) -> BuildResult {
    build(
        &ProjectRoot::at_base(),
        &project_fs(root, shuffle),
        &stub(mode),
    )
}

fn built(root: &Path, mode: BuildMode) -> BuildResult {
    let result = build_dir(root, None, mode);
    assert!(
        !result.has_errors() && !result.files.is_empty(),
        "{} does not build: {:#?}",
        root.display(),
        result.report.diagnostics
    );
    result
}

fn runtime_file() -> String {
    format!("runtime.{}.js", h16(STUB_RUNTIME_BUNDLE))
}

fn manifest_of(result: &BuildResult) -> Manifest {
    let text = std::str::from_utf8(&result.files["program.manifest.json"]).unwrap();
    Manifest::from_json(text).unwrap()
}

/// Every built project: the codegen fixtures and the semantic pass fixtures.
fn every_project() -> Vec<(String, PathBuf)> {
    let mut all: Vec<(String, PathBuf)> = codegen_fixtures()
        .into_iter()
        .map(|name| (format!("codegen/{name}"), codegen_dir().join(name)))
        .collect();
    all.extend(semantic_fixtures("pass").into_iter().map(|name| {
        (
            format!("semantics/pass/{name}"),
            repo().join("tests/semantics/pass").join(name),
        )
    }));
    all
}

#[test]
fn the_two_m1_scenes_are_codegen_fixtures_with_the_semantic_sources() {
    let fixtures = codegen_fixtures();
    assert_eq!(
        fixtures,
        [
            "assignable_places",
            "bindings",
            "cpu_functions",
            "light_bindings",
            "light_bindings_edited",
            "lights",
            "numeric_cpu_table",
            "physics",
            "prefabs",
            "scene_a_target_camera_box",
            "scene_b_orthographic_nested",
            "spawn",
            "state_and_handlers"
        ]
    );
    for name in ["scene_a_target_camera_box", "scene_b_orthographic_nested"] {
        let ours = fs::read(codegen_dir().join(name).join("src/main.mtek")).unwrap();
        let theirs = fs::read(
            repo()
                .join("tests/semantics/pass")
                .join(name)
                .join("src/main.mtek"),
        )
        .unwrap();
        assert_eq!(
            ours, theirs,
            "{name}: src/main.mtek differs from the pass fixture"
        );
    }
}

#[test]
fn every_codegen_fixture_matches_its_expected_dist() {
    let mut problems = Vec::new();
    for name in codegen_fixtures() {
        let root = codegen_dir().join(&name);
        let result = built(&root, BuildMode::Release);
        let mut actual = result.files.clone();
        assert_eq!(
            actual.remove(&runtime_file()).as_deref(),
            Some(STUB_RUNTIME_BUNDLE),
            "{name}: the stub bundle is written under its hash"
        );
        let expected_dir = root.join("expected");
        if blessing() {
            let _ = fs::remove_dir_all(&expected_dir);
            for (path, bytes) in &actual {
                let target = expected_dir.join(path);
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                fs::write(target, bytes).unwrap();
            }
            continue;
        }
        let mut expected = Vec::new();
        if expected_dir.is_dir() {
            files(&expected_dir, &expected_dir, &[], &mut expected);
        }
        let expected: BTreeMap<String, Vec<u8>> = expected.into_iter().collect();
        let names = |m: &BTreeMap<String, Vec<u8>>| m.keys().cloned().collect::<Vec<_>>();
        if names(&actual) != names(&expected) {
            problems.push(format!(
                "{name}: files {:?}, expected {:?}",
                names(&actual),
                names(&expected)
            ));
            continue;
        }
        for (path, bytes) in &actual {
            if expected.get(path) != Some(bytes) {
                problems.push(format!("{name}: {path} differs from expected/{path}"));
            }
        }
    }
    assert!(
        problems.is_empty(),
        "codegen goldens differ (bless with MTEK_BLESS=1 and review):\n{}",
        problems.join("\n")
    );
}

#[test]
fn builds_are_reproducible_including_with_shuffled_listings() {
    for (label, root) in every_project() {
        for mode in [
            BuildMode::Release,
            BuildMode::Test,
            BuildMode::Dev,
            BuildMode::Preview,
        ] {
            let first = built(&root, mode);
            for shuffle in [None, Some(1), Some(0x5eed)] {
                let again = build_dir(&root, shuffle, mode);
                assert_eq!(
                    again.files, first.files,
                    "{label} ({mode:?}, shuffle {shuffle:?}) is not reproducible"
                );
                assert_eq!(again.build_id, first.build_id);
            }
        }
    }
}

#[test]
fn every_manifest_validates_against_the_schema() {
    let schema = validator();
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Release);
        let text = std::str::from_utf8(&result.files["program.manifest.json"]).unwrap();
        assert_valid(&schema, &label, text);
        // The model prints it back identically.
        assert_eq!(manifest_of(&result).to_json(), text, "{label}");
    }
    for name in codegen_fixtures() {
        let path = codegen_dir()
            .join(&name)
            .join("expected/program.manifest.json");
        if let Ok(text) = fs::read_to_string(&path) {
            assert_valid(&schema, &format!("{name}/expected"), &text);
        }
    }
}

#[test]
fn every_span_resolves_back_through_the_source_map() {
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Release);
        let manifest = manifest_of(&result);
        assert!(!manifest.spans.is_empty(), "{label}");
        for (id, span) in manifest.spans.iter().enumerate() {
            let file = result
                .sources
                .get(FileId(span.file))
                .unwrap_or_else(|| panic!("{label}: span {id} has an unknown file"));
            let source = &manifest.sources[span.file as usize];
            assert_eq!(source.id, span.file);
            assert_eq!(source.path, file.path().as_str());
            assert_eq!(source.sha256, file.sha256_hex());
            assert!(
                file.slice(span.start, span.end).is_some(),
                "{label}: span {id}"
            );
            let start = file.line_col(span.start);
            let end = file.line_col(span.end);
            assert_eq!(
                (
                    span.start_line,
                    span.start_column,
                    span.end_line,
                    span.end_column
                ),
                (start.line, start.column, end.line, end.column),
                "{label}: span {id}"
            );
        }
        // Every symbol and material param refers to an existing span.
        for symbol in &manifest.symbols {
            assert!((symbol.span as usize) < manifest.spans.len(), "{label}");
        }
    }
}

#[test]
fn content_addressed_files_are_named_by_their_hash() {
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Release);
        let manifest = manifest_of(&result);
        assert!(result.files.contains_key(&runtime_file()), "{label}");
        for shader in &manifest.shaders {
            let wgsl = &result.files[&shader.url];
            assert_eq!(shader.hash, sha256_hex(wgsl), "{label}");
            assert_eq!(shader.url, format!("shaders/{}.wgsl", h16(wgsl)), "{label}");
            assert_eq!(
                shader.map,
                format!("shaders/{}.mtek-map.json", h16(wgsl)),
                "{label}"
            );
            let map: Value = serde_json::from_slice(&result.files[&shader.map]).unwrap();
            assert_eq!(map["shader"], Value::from(shader.hash.clone()), "{label}");
            for entry in map["entries"].as_array().unwrap() {
                let span = entry["span"].as_u64().unwrap() as usize;
                assert!(span < manifest.spans.len(), "{label}: span map entry");
            }
        }
        let fixed = [
            "index.html",
            "app.js",
            "app.js.map",
            "app.d.ts",
            "runtime.d.ts",
            "program.manifest.json",
        ];
        // A program with a body also has the physics bundle (decision 0063, decision 0065).
        let physics_files = usize::from(manifest.subsystems.physics);
        let expected_count = fixed.len() + 1 + physics_files + 2 * manifest.shaders.len();
        assert_eq!(
            result.files.len(),
            expected_count,
            "{label}: {:?}",
            result.files.keys()
        );
        for name in fixed {
            assert!(result.files.contains_key(name), "{label}: {name}");
        }
        assert_eq!(result.files["runtime.d.ts"], STUB_RUNTIME_DECLARATIONS);
        assert_eq!(result.build_id.as_deref(), Some(manifest.build_id.as_str()));
    }
}

/// Identifiers generated code must never use (`spec/testing.md` section 4.3).
const FORBIDDEN: [&str; 12] = [
    "globalThis",
    "window",
    "document",
    "navigator",
    "fetch",
    "XMLHttpRequest",
    "eval",
    "Function(",
    "setTimeout",
    "setInterval",
    "Math.random",
    "import(",
];

/// `text` without `//` comments and string literals, so that only code is scanned.
fn code_only(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                while let Some(d) = chars.next() {
                    match d {
                        '\\' => {
                            chars.next();
                        }
                        '"' => break,
                        _ => {}
                    }
                }
                out.push_str("\"\"");
            }
            '/' if chars.peek() == Some(&'/') => break,
            _ => out.push(c),
        }
    }
    out
}

/// Forbidden identifiers in `app.js` outside the runtime import line, as `line: identifier`.
fn hygiene_violations(app_js: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (index, line) in app_js.lines().enumerate() {
        if line.starts_with("export { mountMtek } from \"./runtime.") {
            continue;
        }
        let code = code_only(line);
        for word in FORBIDDEN {
            let bytes = code.as_bytes();
            let mut from = 0;
            while let Some(at) = code[from..].find(word) {
                let start = from + at;
                let end = start + word.len();
                let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
                let before = start == 0 || !ident(bytes[start - 1]);
                let after = word.ends_with('(') || end >= bytes.len() || !ident(bytes[end]);
                if before && after {
                    found.push(format!("{}: {word}", index + 1));
                }
                from = end;
            }
        }
    }
    found
}

#[test]
fn the_hygiene_scan_finds_what_it_should() {
    assert_eq!(hygiene_violations("const a = window.x;\n"), ["1: window"]);
    assert_eq!(
        hygiene_violations("f(Math.random());\n"),
        ["1: Math.random"]
    );
    assert_eq!(
        hygiene_violations("const p = import(\"x\");\n"),
        ["1: import("]
    );
    assert!(hygiene_violations("const windows = 1; // window\n").is_empty());
    assert!(hygiene_violations("ctx.f(\"document\");\n").is_empty());
    assert!(hygiene_violations("new URL(\"./\", import.meta.url);\n").is_empty());
    assert!(hygiene_violations("export { mountMtek } from \"./runtime.0123.js\";\n").is_empty());
}

#[test]
fn generated_code_names_no_forbidden_identifier() {
    for (label, root) in every_project() {
        for mode in [BuildMode::Release, BuildMode::Preview] {
            let result = built(&root, mode);
            let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
            let violations = hygiene_violations(app);
            assert!(violations.is_empty(), "{label} ({mode:?}): {violations:?}");
            assert!(app.is_ascii(), "{label}: app.js is not ASCII");
            assert!(!app.contains("\nexport function w_") && !app.contains("export { w_"));
        }
    }
}

#[test]
fn outputs_contain_no_absolute_paths_or_dates() {
    let absolute = repo().canonicalize().unwrap();
    let absolute = absolute.to_string_lossy().replace('\\', "/");
    let absolute = absolute.trim_start_matches("//?/");
    for (label, root) in every_project() {
        for mode in [BuildMode::Dev, BuildMode::Preview] {
            let result = built(&root, mode);
            for (path, bytes) in &result.files {
                let text = String::from_utf8_lossy(bytes).replace('\\', "/");
                assert!(
                    !text.contains(absolute),
                    "{label}: {path} names the checkout"
                );
                for marker in ["C:/", "/Users/", "/home/", "file://"] {
                    assert!(!text.contains(marker), "{label}: {path} contains {marker}");
                }
            }
        }
    }
}

#[test]
fn the_manifest_carries_structure_but_no_entity_or_camera_values() {
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Release);
        let manifest: Value =
            serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
        for camera in manifest["scene"]["cameras"].as_array().unwrap() {
            let keys: Vec<&String> = camera.as_object().unwrap().keys().collect();
            assert_eq!(
                keys,
                [
                    "name",
                    "symbol",
                    "projection",
                    "hasTarget",
                    "active",
                    "exposure"
                ],
                "{label}"
            );
        }
        for entity in manifest["scene"]["entities"].as_array().unwrap() {
            for value_key in ["position", "rotation", "scale", "visible"] {
                assert!(entity.get(value_key).is_none(), "{label}: {value_key}");
            }
        }
        for instance in manifest["scene"]["materialInstances"].as_array().unwrap() {
            let classes: Vec<&Value> = instance["params"]
                .as_array()
                .unwrap()
                .iter()
                .map(|param| &param["class"])
                .collect();
            // `imperative` once a handler writes the param (task M3-01), `bound` once a `bind`
            // supplies it (M3-05), `resource` for a texture or sampler (M4-04); every other
            // param is `initial`.
            for class in &classes {
                assert!(
                    ["initial", "imperative", "bound", "resource"]
                        .contains(&class.as_str().unwrap_or("")),
                    "{label}: {class}"
                );
            }
            let shareable = classes
                .iter()
                .all(|class| *class == "initial" || *class == "resource");
            assert_eq!(instance["shareable"], shareable, "{label}");
        }
    }
}

#[test]
fn bindings_that_read_light_fields_are_ordered_by_them_and_lights_carry_update_classes() {
    // Decision 0067. `tests/codegen/light_bindings`: Marker (entity 0) is declared first and reads
    // the intensities of Fill (1), Sun (2) and Lamp (3, which a handler writes); Fill binds its colour to the colour of Sun, which is
    // a constant, and its intensity to the bound intensity of Sun; Sun binds its intensity to
    // state. So Fill.color (id 1) and Sun.intensity (id 3) have nothing to wait for, in id order;
    // Fill.intensity (id 2) follows Sun.intensity and Marker.position (id 0) both.
    let result = built(&codegen_dir().join("light_bindings"), BuildMode::Release);
    let manifest: Value = serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    let scene = &manifest["scene"];
    let summary: Vec<(u64, u64, &Value, &Value)> = scene["bindings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| {
            (
                b["id"].as_u64().unwrap(),
                b["order"].as_u64().unwrap(),
                &b["target"],
                &b["deps"],
            )
        })
        .collect();
    let expected = [
        (
            0,
            3,
            json!({ "kind": "transform", "entity": 0, "field": "position" }),
            json!([
                { "kind": "light", "entity": 1, "field": "intensity" },
                { "kind": "light", "entity": 2, "field": "intensity" },
                { "kind": "light", "entity": 3, "field": "intensity" }
            ]),
        ),
        (
            1,
            0,
            json!({ "kind": "light", "entity": 1, "field": "color" }),
            json!([{ "kind": "light", "entity": 2, "field": "color" }]),
        ),
        (
            2,
            2,
            json!({ "kind": "light", "entity": 1, "field": "intensity" }),
            json!([{ "kind": "light", "entity": 2, "field": "intensity" }]),
        ),
        (
            3,
            1,
            json!({ "kind": "light", "entity": 2, "field": "intensity" }),
            json!([{ "kind": "state", "name": "warmth" }]),
        ),
    ];
    assert_eq!(summary.len(), expected.len());
    for (actual, (id, order, target, deps)) in summary.iter().zip(&expected) {
        assert_eq!(actual, &(*id, *order, target, deps), "binding {id}");
    }
    // The update class of each field: written by a handler, bound, or neither.
    assert_eq!(
        scene["lights"],
        json!([
            { "index": 0, "entity": 1, "kind": "point", "range": 8.0,
              "classes": { "color": "bound", "intensity": "bound" } },
            { "index": 1, "entity": 2, "kind": "directional",
              "classes": { "color": "initial", "intensity": "bound" } },
            { "index": 2, "entity": 3, "kind": "point", "range": 6.5,
              "classes": { "color": "imperative", "intensity": "imperative" } }
        ])
    );
}

#[test]
fn textures_and_samplers_reach_the_manifest_the_instances_and_the_shader() {
    // Decision 0054: `materials[].resources` lists the bindings of group 1 in param order, each instance
    // names the built-in it holds as a `resource` param, the layout holds the value params only, and
    // `app.js` writes no resource param.
    let root = repo().join("tests/semantics/pass/materials/textures");
    let result = built(&root, BuildMode::Release);
    let manifest: Value = serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    let material = &manifest["materials"][0];
    assert_eq!(material["id"], "src/main.mtek::Textured");
    let resources: Vec<(&str, &str, u64)> = material["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["name"].as_str().unwrap(),
                r["kind"].as_str().unwrap(),
                r["binding"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        resources,
        [
            ("base", "texture", 1),
            ("filter", "sampler", 2),
            ("mask", "texture", 3),
            ("crisp", "sampler", 4)
        ]
    );
    let layout = manifest["layouts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == material["layout"])
        .unwrap();
    let members: Vec<&str> = layout["root"]["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();
    assert_eq!(members, ["tint", "strength"]);
    let instances = manifest["scene"]["materialInstances"].as_array().unwrap();
    let resource = |instance: usize, param: &str| {
        let found = instances[instance]["params"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == param)
            .unwrap();
        assert_eq!(found["class"], "resource", "{param}");
        assert_eq!(found["value"]["kind"], "builtin");
        found["value"]["name"].as_str().unwrap().to_owned()
    };
    assert_eq!(resource(0, "base"), "texture.white");
    assert_eq!(resource(0, "filter"), "sampler.linear_repeat");
    assert_eq!(resource(1, "filter"), "sampler.nearest_repeat");
    assert_eq!(resource(1, "mask"), "texture.white");
    assert_eq!(resource(2, "base"), "texture.black");
    assert_eq!(resource(2, "crisp"), "sampler.nearest_clamp");
    // Value params stay `initial`, and every instance may share its block (resources are immutable).
    assert_eq!(instances[2]["params"][0]["class"], "initial");
    assert_eq!(instances[2]["shareable"], true);

    let shader = &manifest["shaders"][0];
    let wgsl = String::from_utf8(result.files[shader["url"].as_str().unwrap()].clone()).unwrap();
    assert!(wgsl.contains("@group(1) @binding(1) var mtek_texture_base: texture_2d<f32>;"));
    assert!(wgsl.contains("@group(1) @binding(4) var mtek_sampler_crisp: sampler;"));
    let app = String::from_utf8(result.files["app.js"].clone()).unwrap();
    for param in ["base", "filter", "mask", "crisp"] {
        assert!(
            !app.contains(&format!("\"{param}\"")),
            "app.js writes the resource param {param}"
        );
    }
    assert!(app.contains("setParam(") && app.contains("\"strength\""));
}

#[test]
fn a_colour_state_bound_into_a_material_colour_gets_the_opaque_host_input_codec() {
    // spec/runtime-abi.md section 6.3: the codec of a colour host input is `color-hex-opaque` when the state reaches a material
    // `color` param through a binding (so `setInput` itself rejects a translucent value with E8100), `color-hex` otherwise.
    // Found by task M4-10: the packager passed an empty set of such states, so every colour input was `color-hex`, a translucent
    // value was accepted by `setInput` and only refused (or applied) later by the binding.
    let mut memory = MemFs::new();
    let mut insert = |path: &str, text: &str| {
        memory.insert(ProjectPath::new(path).unwrap(), text.as_bytes().to_vec());
    };
    insert(
        "mtek.toml",
        "[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n\n[host.inputs]\nbound = \"Demo.bound\"\nvia_pbr = \"Demo.via_pbr\"\nunused = \"Demo.unused\"\nlevel = \"Demo.level\"\n",
    );
    insert(
        "src/main.mtek",
        "scene Demo {
    state bound: color = #6b5cff;
    state via_pbr: color = #ffffff;
    state unused: color = #123456;
    state level: f32 = 0.5;
    camera Main {}
    entity A {
        mesh: Box {};
        material: Unlit { color: bind(bound) };
    }
    entity B {
        mesh: Box {};
        position: vec3(2.0, 0.0, 0.0);
        material: Pbr { base_color: bind(via_pbr); roughness: bind(level); };
    }
}
",
    );
    let result = build(&ProjectRoot::at_base(), &memory, &stub(BuildMode::Release));
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    let manifest: Value = serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    let codecs: BTreeMap<String, String> = manifest["scene"]["hostInputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|input| {
            (
                input["name"].as_str().unwrap().to_owned(),
                input["codec"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        codecs,
        BTreeMap::from([
            ("bound".to_owned(), "color-hex-opaque".to_owned()),
            ("level".to_owned(), "f32".to_owned()),
            ("unused".to_owned(), "color-hex".to_owned()),
            ("via_pbr".to_owned(), "color-hex-opaque".to_owned()),
        ])
    );
}

#[test]
fn the_modes_differ_only_in_the_page() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let release = built(&root, BuildMode::Release);
    for mode in [BuildMode::Test, BuildMode::Dev] {
        let other = built(&root, mode);
        for (path, bytes) in &release.files {
            if path != "index.html" {
                assert_eq!(other.files.get(path), Some(bytes), "{mode:?}: {path}");
            }
        }
        assert_ne!(other.files["index.html"], release.files["index.html"]);
    }
    let test_page =
        String::from_utf8(built(&root, BuildMode::Test).files["index.html"].clone()).unwrap();
    assert!(
        test_page.contains("window.__mtekMount = (options) =>"),
        "{test_page}"
    );
    let page = String::from_utf8(release.files["index.html"].clone()).unwrap();
    assert!(
        page.contains("<title>Scene A: &lt;target&gt; camera &amp; box</title>"),
        "{page}"
    );
}

#[test]
fn a_preview_of_a_program_without_loops_differs_from_release_in_the_page_the_bootstrap_and_the_manifest()
 {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let release = built(&root, BuildMode::Release);
    let preview = built(&root, BuildMode::Preview);
    for (path, bytes) in &release.files {
        if !matches!(path.as_str(), "index.html" | "program.manifest.json") {
            assert_eq!(preview.files.get(path), Some(bytes), "{path}");
        }
    }
    assert_eq!(preview.files.len(), release.files.len() + 1);
    assert!(preview.files.contains_key("bootstrap.js"));
    // The manifest has the `preview` object and the id of the build that differs; nothing else.
    let mut with_preview: Value =
        serde_json::from_slice(&preview.files["program.manifest.json"]).unwrap();
    let without: Value = serde_json::from_slice(&release.files["program.manifest.json"]).unwrap();
    assert_eq!(with_preview["preview"], json!({ "loopBudget": 10_000_000 }));
    let object = with_preview.as_object_mut().unwrap();
    object.remove("preview");
    object.insert("buildId".to_owned(), without["buildId"].clone());
    assert_eq!(with_preview, without);
    assert_ne!(preview.build_id, release.build_id);
}

fn codes(result: &BuildResult) -> Vec<&'static str> {
    result
        .report
        .diagnostics
        .iter()
        .map(|d| d.code.short())
        .collect()
}

#[test]
fn a_build_without_the_runtime_is_e9030() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    let mut options = stub(BuildMode::Release);
    options.runtime_bundle = None;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert_eq!(codes(&result), ["E9030"]);
    assert!(result.files.is_empty() && result.build_id.is_none());
    assert_eq!(
        result.report.diagnostics[0].message,
        "Cannot build: the runtime bundle is not available to the compiler."
    );
    options.runtime_declarations = None;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert_eq!(
        result.report.diagnostics[0].message,
        "Cannot build: the runtime bundle and runtime.d.ts are not available to the compiler."
    );
    let mut options = stub(BuildMode::Release);
    options.runtime_declarations = None;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert_eq!(codes(&result), ["E9030"]);
    // The real bytes are written verbatim under their hash.
    let mut options = stub(BuildMode::Release);
    options.runtime_bundle = Some(Arc::from(&b"export const real = 1;\n"[..]));
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    let name = format!("runtime.{}.js", h16(b"export const real = 1;\n"));
    assert_eq!(result.files[&name], b"export const real = 1;\n");
    let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
    assert!(app.contains(&format!("export {{ mountMtek }} from \"./{name}\";")));
}

/// Options whose release and development bundles are distinguishable.
fn two_flavours(mode: BuildMode) -> CompileOptions {
    let mut options = stub(mode);
    options.runtime_bundle = Some(Arc::from(&b"// release flavour\n"[..]));
    options.dev_runtime_bundle = Some(Arc::from(&b"// development flavour\n"[..]));
    options
}

#[test]
fn dev_and_test_builds_embed_the_development_runtime_and_release_the_release_one() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    for (mode, expected) in [
        (BuildMode::Release, &b"// release flavour\n"[..]),
        (BuildMode::Dev, &b"// development flavour\n"[..]),
        (BuildMode::Test, &b"// development flavour\n"[..]),
    ] {
        let result = build(&ProjectRoot::at_base(), &memory, &two_flavours(mode));
        assert!(codes(&result).is_empty(), "{mode:?}: {:?}", codes(&result));
        let name = format!("runtime.{}.js", h16(expected));
        assert_eq!(result.files[&name], expected, "{mode:?}");
        // Exactly one runtime file, and app.js imports that one.
        let runtimes: Vec<&String> = result
            .files
            .keys()
            .filter(|path| path.starts_with("runtime.") && path.ends_with(".js"))
            .collect();
        assert_eq!(runtimes, [&name], "{mode:?}");
        let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
        assert!(
            app.contains(&format!("export {{ mountMtek }} from \"./{name}\";")),
            "{mode:?}"
        );
    }
}

#[test]
fn without_a_development_bundle_every_mode_uses_the_release_bundle() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    let mut options = two_flavours(BuildMode::Dev);
    options.dev_runtime_bundle = None;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert!(
        result
            .files
            .contains_key(&format!("runtime.{}.js", h16(b"// release flavour\n")))
    );
}

#[test]
fn each_mode_needs_its_own_bundle_for_e9030() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    // Only the development flavour: dev builds work, release builds cannot.
    let mut options = two_flavours(BuildMode::Dev);
    options.runtime_bundle = None;
    assert!(codes(&build(&ProjectRoot::at_base(), &memory, &options)).is_empty());
    options.mode = BuildMode::Release;
    assert_eq!(
        codes(&build(&ProjectRoot::at_base(), &memory, &options)),
        ["E9030"]
    );
}

/// Options that mark the program as using physics (decision 0063: the only way before M5-03).
fn physics(mode: BuildMode) -> CompileOptions {
    let mut options = stub(mode);
    options.force_physics_subsystem = true;
    options
}

fn is_physics_file(path: &str) -> bool {
    path == "physics" || path.starts_with("physics/")
}

#[test]
fn a_build_has_a_physics_file_exactly_when_the_program_has_a_body() {
    // `stub` carries a physics bundle; only the programs with a body write it (decision 0065).
    assert!(stub(BuildMode::Release).physics_bundle.is_some());
    let (mut with_body, mut without_body) = (0, 0);
    for (label, root) in every_project() {
        for mode in [BuildMode::Release, BuildMode::Dev, BuildMode::Test] {
            let result = build_dir(&root, None, mode);
            assert!(!result.has_errors(), "{label}");
            let manifest = manifest_of(&result);
            // A prefab the program can spawn counts as well (decision 0064).
            let has_body = manifest.scene.entities.iter().any(|e| e.body.is_some())
                || manifest.prefabs.iter().any(|p| p.body.is_some());
            let physics_files: Vec<&String> = result
                .files
                .keys()
                .filter(|path| is_physics_file(path))
                .collect();
            assert_eq!(manifest.subsystems.physics, has_body, "{label} {mode:?}");
            // The manifest names the bundle file exactly when there is one (decision 0066).
            assert_eq!(
                manifest.subsystems.physics_module.as_ref(),
                physics_files.first().copied(),
                "{label} {mode:?}"
            );
            assert_eq!(
                physics_files.len(),
                usize::from(has_body),
                "{label} {mode:?}: {physics_files:?}"
            );
            if has_body {
                with_body += 1;
            } else {
                without_body += 1;
            }
        }
    }
    // Both kinds of program are among the fixtures, so neither half of the test is empty.
    assert!(with_body > 0 && without_body > 0);
}

#[test]
fn a_build_that_uses_physics_has_the_bundle_under_its_hash_and_says_so_in_the_manifest() {
    let schema = validator();
    for (label, root) in every_project() {
        for mode in [BuildMode::Release, BuildMode::Dev, BuildMode::Test] {
            let memory = project_fs(&root, None);
            let plain = build(&ProjectRoot::at_base(), &memory, &stub(mode));
            let with = build(&ProjectRoot::at_base(), &memory, &physics(mode));
            assert!(!with.has_errors(), "{label} {mode:?}");
            if manifest_of(&plain).subsystems.physics {
                // A program with a body is a physics program already: the option changes nothing.
                assert_eq!(with.files, plain.files, "{label} {mode:?}");
                continue;
            }

            let name = format!("physics/{}.js", h16(STUB_PHYSICS_BUNDLE));
            assert_eq!(with.files[&name], STUB_PHYSICS_BUNDLE, "{label} {mode:?}");
            // Exactly one more file, and it is the bundle; everything else is byte for byte the plain build,
            // except the manifest, which differs in `subsystems` alone (`physics` and `physicsModule`).
            let extra: Vec<&String> = with
                .files
                .keys()
                .filter(|path| !plain.files.contains_key(*path))
                .collect();
            assert_eq!(extra, [&name], "{label} {mode:?}");
            for (path, bytes) in &plain.files {
                if path != "program.manifest.json" {
                    assert_eq!(&with.files[path], bytes, "{label} {mode:?} {path}");
                }
            }
            let text = std::str::from_utf8(&with.files["program.manifest.json"]).unwrap();
            assert_valid(&schema, &label, text);
            let mut flagged: Value = serde_json::from_str(text).unwrap();
            assert_eq!(flagged["subsystems"]["physics"], Value::Bool(true));
            // The runtime cannot derive the hashed name: the manifest names the file (decision 0066).
            assert_eq!(
                flagged["subsystems"]["physicsModule"],
                Value::String(name.clone()),
                "{label} {mode:?}"
            );
            flagged["subsystems"]["physics"] = Value::Bool(false);
            flagged["subsystems"]
                .as_object_mut()
                .unwrap()
                .remove("physicsModule");
            let unflagged: Value =
                serde_json::from_slice(&plain.files["program.manifest.json"]).unwrap();
            assert_eq!(flagged, unflagged, "{label} {mode:?}");
            // The build id does not depend on the bundle (nor does the runtime bundle's).
            assert_eq!(with.build_id, plain.build_id, "{label} {mode:?}");
        }
    }
}

#[test]
fn a_spawned_prefab_carries_its_body_and_collider_in_the_manifest_and_needs_the_physics_bundle() {
    // No entity of the scene has a body, the spawned prefab has (decision 0064, items 6 and 16 of 0065).
    let root = repo().join("tests/semantics/pass/spawn_physics_prefab");
    let result = built(&root, BuildMode::Release);
    let manifest: Value = serde_json::from_slice(&result.files["program.manifest.json"]).unwrap();
    assert!(
        manifest["scene"]["entities"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entity| entity["body"].is_null())
    );
    assert_eq!(manifest["subsystems"]["physics"], Value::Bool(true));
    assert_eq!(
        result.files.keys().filter(|p| is_physics_file(p)).count(),
        1
    );
    let prefabs = manifest["prefabs"].as_array().unwrap();
    assert_eq!(prefabs.len(), 1);
    assert_eq!(
        prefabs[0]["body"],
        serde_json::json!({ "kind": "dynamic", "mass": 1.5, "linearDamping": 0.05, "angularDamping": 0.05 })
    );
    assert_eq!(prefabs[0]["collider"]["kind"], "box");
    assert_eq!(
        prefabs[0]["collider"]["size"],
        serde_json::json!([1.0, 1.0, 1.0])
    );
    assert_eq!(prefabs[0]["collider"]["sensor"], Value::Bool(false));
    assert_eq!(prefabs[0]["collider"]["friction"], serde_json::json!(0.6));
    assert_eq!(
        prefabs[0]["collider"]["restitution"],
        serde_json::json!(0.2)
    );
}

#[test]
fn the_physics_bundle_is_written_verbatim_under_the_hash_of_its_bytes() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    let bytes: &[u8] = b"export default async () => ({ name: 'real' });\n";
    let mut options = physics(BuildMode::Release);
    options.physics_bundle = Some(Arc::from(bytes));
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert!(!result.has_errors());
    let name = format!("physics/{}.js", h16(bytes));
    assert_eq!(result.files[&name], bytes);
    assert_eq!(name.len(), "physics/".len() + 16 + ".js".len());
    assert_eq!(
        result.files.keys().filter(|p| is_physics_file(p)).count(),
        1
    );
    // The stub's name is not there.
    assert!(
        !result
            .files
            .contains_key(&format!("physics/{}.js", h16(STUB_PHYSICS_BUNDLE)))
    );
}

#[test]
fn a_physics_build_is_reproducible() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let first = build(
        &ProjectRoot::at_base(),
        &project_fs(&root, None),
        &physics(BuildMode::Release),
    );
    let second = build(
        &ProjectRoot::at_base(),
        &project_fs(&root, Some(7)),
        &physics(BuildMode::Release),
    );
    assert_eq!(first.files, second.files);
}

#[test]
fn a_program_that_uses_physics_cannot_be_built_without_the_physics_bundle() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let memory = project_fs(&root, None);
    let mut options = physics(BuildMode::Release);
    options.physics_bundle = None;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert_eq!(codes(&result), ["E9030"]);
    assert!(result.files.is_empty() && result.build_id.is_none());
    assert_eq!(
        result.report.diagnostics[0].message,
        "Cannot build: the physics bundle is not available to the compiler, but the program uses physics."
    );
    // The same options build a program that does not use physics.
    options.force_physics_subsystem = false;
    let result = build(&ProjectRoot::at_base(), &memory, &options);
    assert!(codes(&result).is_empty());
    assert!(result.files.keys().all(|path| !is_physics_file(path)));
}

/// A project of one source file.
fn inline_project(source: &str) -> MemFs {
    let mut memory = MemFs::new();
    memory
        .insert(
            ProjectPath::new("mtek.toml").unwrap(),
            "[project]\nname = \"inline\"\nlanguage = \"0.1\"\n",
        )
        .insert(ProjectPath::new("src/main.mtek").unwrap(), source);
    memory
}

const PLAIN_SCENE: &str =
    "scene Demo {\n    camera Main {}\n    entity Crate { mesh: Box {}; }\n}\n";

const BODY_SCENE: &str = "scene Demo {
    gravity: vec3(0.0, -3.0, 0.0);
    camera Main {}
    entity Floor {
        mesh: Box {};
        body: Static {};
        collider: BoxCollider { size: vec3(10.0, 1.0, 10.0); friction: 0.75; };
    }
    entity Ball {
        mesh: Sphere {};
        body: Dynamic { mass: 2.5; linear_damping: 0.125; };
        collider: SphereCollider { radius: 0.5; restitution: 0.5; sensor: true; };
    }
    entity Lift {
        mesh: Box {};
        body: Kinematic {};
        collider: BoxCollider { size: vec3(2.0, 0.5, 2.0); };
    }
    entity Marker { mesh: Box {}; }
}
";

#[test]
fn a_program_with_a_body_packages_the_physics_bundle_without_any_option() {
    // No `force_physics_subsystem`: the bodies alone make `subsystems.physics` true, the bundle
    // is written under its hash, and the manifest carries what the runtime needs to create them
    // (decision 0065, `spec/runtime-abi.md` section 5.2).
    let options = stub(BuildMode::Release);
    assert!(!options.force_physics_subsystem);
    let result = build(
        &ProjectRoot::at_base(),
        &inline_project(BODY_SCENE),
        &options,
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    let name = format!("physics/{}.js", h16(STUB_PHYSICS_BUNDLE));
    assert_eq!(result.files[&name], STUB_PHYSICS_BUNDLE);
    let text = std::str::from_utf8(&result.files["program.manifest.json"]).unwrap();
    assert_valid(&validator(), "inline", text);
    let manifest = manifest_of(&result);
    assert!(manifest.subsystems.physics);
    assert_eq!(manifest.subsystems.physics_module, Some(name.clone()));
    assert_eq!(
        serde_json::to_value(&manifest.scene.fields.gravity).unwrap(),
        serde_json::json!([0.0, -3.0, 0.0])
    );
    let bodies: Vec<Value> = manifest
        .scene
        .entities
        .iter()
        .map(|e| serde_json::to_value((&e.body, &e.collider)).unwrap())
        .collect();
    assert_eq!(
        bodies,
        [
            serde_json::json!([
                { "kind": "static" },
                { "kind": "box", "size": [10.0, 1.0, 10.0], "sensor": false, "friction": 0.75, "restitution": 0.0 }
            ]),
            serde_json::json!([
                { "kind": "dynamic", "mass": 2.5, "linearDamping": 0.125, "angularDamping": 0.05 },
                { "kind": "sphere", "radius": 0.5, "sensor": true, "friction": 0.5, "restitution": 0.5 }
            ]),
            serde_json::json!([
                { "kind": "kinematic" },
                { "kind": "box", "size": [2.0, 0.5, 2.0], "sensor": false, "friction": 0.5, "restitution": 0.0 }
            ]),
            serde_json::json!([null, null]),
        ]
    );
}

#[test]
fn a_program_without_a_body_has_no_physics_module_and_the_default_gravity() {
    let result = build(
        &ProjectRoot::at_base(),
        &inline_project(PLAIN_SCENE),
        &stub(BuildMode::Release),
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    assert!(result.files.keys().all(|path| !is_physics_file(path)));
    let manifest = manifest_of(&result);
    assert!(!manifest.subsystems.physics);
    assert_eq!(manifest.subsystems.physics_module, None);
    assert!(
        manifest
            .scene
            .entities
            .iter()
            .all(|e| e.body.is_none() && e.collider.is_none())
    );
    assert_eq!(
        serde_json::to_value(&manifest.scene.fields.gravity).unwrap(),
        serde_json::json!([0.0, -9.81, 0.0])
    );
}

#[test]
fn a_program_with_a_body_cannot_be_built_without_the_physics_bundle() {
    let mut options = stub(BuildMode::Release);
    options.physics_bundle = None;
    let result = build(
        &ProjectRoot::at_base(),
        &inline_project(BODY_SCENE),
        &options,
    );
    assert_eq!(codes(&result), ["E9030"]);
    assert!(result.files.is_empty());
    // The same options build the program without bodies.
    let result = build(
        &ProjectRoot::at_base(),
        &inline_project(PLAIN_SCENE),
        &options,
    );
    assert!(codes(&result).is_empty());
}

#[test]
fn a_prefab_with_a_body_makes_a_physics_program_even_without_an_instance() {
    // A prefab can be spawned from any handler (spawn sites are not tracked), so its body counts.
    let source = "prefab Crate {
    mesh: Box {};
    body: Dynamic {};
    collider: BoxCollider { size: vec3(1.0, 1.0, 1.0); };
}

scene Demo {
    camera Main {}
}
";
    let result = build(
        &ProjectRoot::at_base(),
        &inline_project(source),
        &stub(BuildMode::Release),
    );
    assert!(!result.has_errors(), "{:#?}", result.report.diagnostics);
    assert!(manifest_of(&result).subsystems.physics);
    assert_eq!(
        result.files.keys().filter(|p| is_physics_file(p)).count(),
        1
    );
}

/// A program with loops in a function, a handler and a `print`.
const LOOPS: &str = "fn busy(n: i32) -> i32 {
    var total = 0;
    for i in 0..n {
        total += i;
    }
    return total;
}

scene Demo {
    state total: i32 = 0;
    camera Main {}
    entity Crate { mesh: Box {}; }
    update(dt: f32) {
        print(\"tick\");
        for i in 0..10 {
            total += busy(i);
        }
    }
}
";

fn preview_options(budget: Option<u32>) -> CompileOptions {
    CompileOptions {
        loop_budget: budget,
        ..stub(BuildMode::Preview)
    }
}

fn text_of<'a>(result: &'a BuildResult, path: &str) -> &'a str {
    std::str::from_utf8(&result.files[path]).unwrap()
}

#[test]
fn a_preview_build_is_a_release_build_with_the_budget_the_policy_and_the_bootstrap() {
    let memory = inline_project(LOOPS);
    let preview = build(&ProjectRoot::at_base(), &memory, &preview_options(None));
    assert!(!preview.has_errors(), "{:#?}", preview.report.diagnostics);
    let release = build(&ProjectRoot::at_base(), &memory, &stub(BuildMode::Release));
    let dev = build(&ProjectRoot::at_base(), &memory, &stub(BuildMode::Dev));

    // The files: the release set plus `bootstrap.js`.
    let mut names: Vec<&String> = preview.files.keys().collect();
    let release_names: Vec<&String> = release.files.keys().collect();
    assert!(names.contains(&&"bootstrap.js".to_owned()));
    names.retain(|name| *name != "bootstrap.js");
    assert_eq!(names, release_names);
    assert_eq!(
        text_of(&preview, "bootstrap.js"),
        "import program, { mountMtek } from \"./app.js\";\n\
         mountMtek(document.getElementById(\"mtek\"), program).catch(() => {}); // failures are shown by the overlay\n"
    );

    // The page: the policy first, then one script, which has a source and no body.
    let page = text_of(&preview, "index.html");
    assert!(
        page.contains(
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'\">"
        ),
        "{page}"
    );
    assert_eq!(page.matches("<script").count(), 1, "{page}");
    assert!(page.contains("<script type=\"module\" src=\"./bootstrap.js\"></script>"));
    assert!(!text_of(&release, "index.html").contains("Content-Security-Policy"));
    assert!(!text_of(&dev, "index.html").contains("Content-Security-Policy"));

    // The manifest names the budget; no other mode has the key.
    let manifest = manifest_of(&preview);
    assert_eq!(
        manifest.preview.as_ref().map(|p| p.loop_budget),
        Some(10_000_000)
    );
    assert!(manifest_of(&release).preview.is_none() && manifest_of(&dev).preview.is_none());
    assert!(!text_of(&release, "program.manifest.json").contains("\"preview\""));
    assert_valid(
        &validator(),
        "preview",
        text_of(&preview, "program.manifest.json"),
    );

    // The code: every loop starts with the check, `print` is compiled out like in a release build,
    // and nothing of the budget is in a build of another mode.
    let app = text_of(&preview, "app.js");
    assert_eq!(app.matches("for (").count(), 2, "{app}");
    assert_eq!(app.matches("if (--budget.n < 0) {").count(), 2, "{app}");
    assert_eq!(
        app.matches("const budget = ctx.budget;").count(),
        2,
        "{app}"
    );
    assert!(!app.contains("ctx.print"), "print is compiled out: {app}");
    for other in [&release, &dev] {
        assert!(!text_of(other, "app.js").contains("budget"));
    }
    assert!(text_of(&dev, "app.js").contains("ctx.print"));

    // Each check reports the loop it guards: the span id resolves to the `for` statement.
    let spans_of_checks: Vec<usize> = app
        .lines()
        .filter_map(|line| line.trim().strip_prefix("rt.budgetExceeded("))
        .map(|rest| rest.trim_end_matches(");").parse().unwrap())
        .collect();
    assert_eq!(spans_of_checks.len(), 2);
    let main = preview
        .sources
        .files()
        .find(|file| file.path().as_str() == "src/main.mtek")
        .unwrap();
    for id in spans_of_checks {
        let span = &manifest.spans[id];
        assert_eq!(manifest.sources[span.file as usize].path, "src/main.mtek");
        let text = main.slice(span.start, span.end).unwrap();
        assert!(
            text.starts_with("for i in 0..") && text.ends_with('}'),
            "{text}"
        );
    }
}

#[test]
fn the_budget_is_an_option_of_the_host_at_least_one_and_part_of_the_identity() {
    let memory = inline_project(LOOPS);
    let with = |budget| build(&ProjectRoot::at_base(), &memory, &preview_options(budget));
    let default = with(None);
    let small = with(Some(1_000));
    let zero = with(Some(0));
    assert_eq!(
        manifest_of(&small).preview.map(|p| p.loop_budget),
        Some(1_000)
    );
    assert_eq!(manifest_of(&zero).preview.map(|p| p.loop_budget), Some(1));
    assert_eq!(default.files.len(), small.files.len());
    assert_ne!(default.build_id, small.build_id);
    assert_ne!(small.build_id, zero.build_id);
    // The same program built twice with the same budget is byte-identical.
    assert_eq!(with(Some(1_000)).files, small.files);
    // A release build ignores the option.
    let release = |budget| {
        let options = CompileOptions {
            loop_budget: budget,
            ..stub(BuildMode::Release)
        };
        build(&ProjectRoot::at_base(), &memory, &options)
    };
    assert_eq!(release(Some(5)).files, release(None).files);
    assert_eq!(release(Some(5)).build_id, release(None).build_id);
}

#[test]
fn every_project_builds_as_a_preview_with_a_valid_manifest_and_checks_that_resolve() {
    let schema = validator();
    let mut checks = 0;
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Preview);
        let text = text_of(&result, "program.manifest.json");
        assert_valid(&schema, &label, text);
        let manifest = manifest_of(&result);
        assert_eq!(manifest.to_json(), text, "{label}");
        assert!(manifest.preview.is_some(), "{label}");
        let app = text_of(&result, "app.js");
        let loops = app.matches("--budget.n < 0").count();
        assert_eq!(loops, app.matches("rt.budgetExceeded(").count(), "{label}");
        for line in app.lines() {
            let Some(rest) = line.trim().strip_prefix("rt.budgetExceeded(") else {
                continue;
            };
            let span = &manifest.spans[rest.trim_end_matches(");").parse::<usize>().unwrap()];
            let file = result.sources.get(FileId(span.file)).unwrap();
            let text = file.slice(span.start, span.end).unwrap();
            assert!(text.starts_with("for "), "{label}: {text}");
            checks += 1;
        }
    }
    assert!(checks >= 6, "{checks} loops in the fixtures");
}

#[test]
fn a_program_with_errors_has_check_s_diagnostics_and_no_files() {
    for name in semantic_fixtures("fail") {
        let root = repo().join("tests/semantics/fail").join(&name);
        let memory = project_fs(&root, None);
        let result = build(&ProjectRoot::at_base(), &memory, &stub(BuildMode::Release));
        let checked = check(&ProjectRoot::at_base(), &memory);
        assert_eq!(
            result.report.diagnostics, checked.report.diagnostics,
            "{name}"
        );
        assert!(
            result.files.is_empty() && result.build_id.is_none(),
            "{name}"
        );
    }
}

/// A project whose entity uses a material with a parameter block of `len` padded `f32`
/// elements and an `f32` after them (`16 * len + 16` bytes, rounded to 16).
fn big_block(len: usize) -> MemFs {
    let zeros = vec!["0.0"; len].join(", ");
    let mut memory = MemFs::new();
    memory
        .insert(
            ProjectPath::new("mtek.toml").unwrap(),
            "[project]\nname = \"big\"\nlanguage = \"0.1\"\n",
        )
        .insert(
            ProjectPath::new("src/main.mtek").unwrap(),
            format!(
                "material Big {{\n    param samples: array<f32, {len}> = [{zeros}];\n    param gain: f32 = 1.0;\n    fragment(input: SurfaceInput) -> color {{ return #ffffff; }}\n}}\n\nscene Demo {{\n    camera Main {{}}\n    entity Crate {{ mesh: Box {{}}; material: Big {{}}; }}\n}}\n"
            ),
        );
    memory
}

#[test]
fn a_parameter_block_over_the_profile_limit_is_e6001_and_no_files() {
    // 65 536 bytes exactly: builds.
    let fits = build(
        &ProjectRoot::at_base(),
        &big_block(4095),
        &stub(BuildMode::Release),
    );
    assert!(fits.report.diagnostics.is_empty(), "{:#?}", fits.report);
    let manifest = manifest_of(&fits);
    let layout = manifest
        .layouts
        .iter()
        .find(|l| l.id == "material:src/main.mtek::Big")
        .unwrap();
    assert_eq!(layout.size, 65_536);
    // 65 552 bytes: `E6001` (an emit-phase limit, so `check` does not report it), before
    // any shader is lowered, and nothing is written.
    let memory = big_block(4096);
    let result = build(&ProjectRoot::at_base(), &memory, &stub(BuildMode::Release));
    assert_eq!(codes(&result), ["E6001"]);
    assert!(result.files.is_empty() && result.build_id.is_none());
    let diagnostic = &result.report.diagnostics[0];
    assert_eq!(
        diagnostic.message,
        "The parameter block of material 'Big' is 65552 bytes, more than the 65536 bytes a uniform block may have in the target profile 'webgpu-core-2026'."
    );
    assert_eq!(diagnostic.phase, mtek_compiler::diagnostics::Phase::Emit);
    let primary = diagnostic.primary.as_ref().unwrap().span;
    assert!(
        result
            .sources
            .slice(primary)
            .unwrap()
            .starts_with("material Big {")
    );
    assert!(
        check(&ProjectRoot::at_base(), &memory)
            .report
            .diagnostics
            .is_empty()
    );
}
