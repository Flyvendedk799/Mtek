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
//! * `E9030` without a bundle or declarations, `E9010` for preview builds, no files for a
//!   program with errors.
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
    BuildMode, BuildResult, CompileOptions, STUB_RUNTIME_BUNDLE, STUB_RUNTIME_DECLARATIONS, build,
    check,
};
use serde_json::Value;

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
            "cpu_functions",
            "numeric_cpu_table",
            "scene_a_target_camera_box",
            "scene_b_orthographic_nested"
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
        for mode in [BuildMode::Release, BuildMode::Test, BuildMode::Dev] {
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
        let expected_count = fixed.len() + 1 + 2 * manifest.shaders.len();
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
        let result = built(&root, BuildMode::Release);
        let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
        let violations = hygiene_violations(app);
        assert!(violations.is_empty(), "{label}: {violations:?}");
        assert!(app.is_ascii(), "{label}: app.js is not ASCII");
        assert!(!app.contains("\nexport function w_") && !app.contains("export { w_"));
    }
}

#[test]
fn outputs_contain_no_absolute_paths_or_dates() {
    let absolute = repo().canonicalize().unwrap();
    let absolute = absolute.to_string_lossy().replace('\\', "/");
    let absolute = absolute.trim_start_matches("//?/");
    for (label, root) in every_project() {
        let result = built(&root, BuildMode::Dev);
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
                ["name", "symbol", "projection", "hasTarget", "active"],
                "{label}"
            );
        }
        for entity in manifest["scene"]["entities"].as_array().unwrap() {
            for value_key in ["position", "rotation", "scale", "visible"] {
                assert!(entity.get(value_key).is_none(), "{label}: {value_key}");
            }
        }
        for instance in manifest["scene"]["materialInstances"].as_array().unwrap() {
            for param in instance["params"].as_array().unwrap() {
                assert_eq!(param["class"], "initial", "{label}");
            }
            assert_eq!(instance["shareable"], true, "{label}");
        }
    }
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

#[test]
fn preview_builds_are_not_implemented_yet() {
    let root = codegen_dir().join("scene_a_target_camera_box");
    let result = build_dir(&root, None, BuildMode::Preview);
    assert_eq!(codes(&result), ["E9010"]);
    assert!(result.files.is_empty());
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
