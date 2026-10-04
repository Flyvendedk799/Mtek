//! Shader lowering of user materials (decision 0041): typed IR to shader IR to WGSL.
//!
//! * Goldens: every material of every project under `tests/codegen/wgsl-materials/` is
//!   lowered, printed and validated by Naga; `<project>/expected/<module>.<Material>.wgsl`
//!   holds the module. Rewrite with `MTEK_BLESS=1 cargo test -p mtek-compiler --test
//!   shader_lowering` and review the diff like code. `wgsl-materials/pulse` is the
//!   semantic pass fixture `materials/pulse` (a test keeps them byte-identical).
//! * Every material of every semantic pass fixture and codegen fixture — used by an
//!   entity or not — lowers and validates; lowering is byte-identical across runs.
//! * Span maps: every entry of every golden resolves to the Mtek text it was generated
//!   from (mangled locals to their names, calls to calls, statements to statements),
//!   inside the declaration of its symbol; the Pulse material is checked entry by entry.
//! * The prelude's `Unlit`, compiled from source by this lowering, gives the golden of
//!   the temporary compiler-built `Unlit` (what M2-09 relies on).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::emit_wgsl::{ShaderArtifact, emit_shader, validate_wgsl};
use mtek_compiler::ir::{Item, Program, lower_to_ir};
use mtek_compiler::layout::hash8;
use mtek_compiler::lowering::shader::lower_material;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath, SourceMap, Span};
use mtek_compiler::{BuildMode, CompileOptions, analyze, build};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn materials_dir() -> PathBuf {
    repo().join("tests/codegen/wgsl-materials")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
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
        if path.is_dir() {
            if relative != "expected" {
                collect(root, &path, out);
            }
        } else if relative != "expected.diag.json" {
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

fn project(root: &Path) -> MemFs {
    let mut files = Vec::new();
    collect(root, root, &mut files);
    let mut memory = MemFs::new();
    for (path, bytes) in files {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

/// Sorted directories directly under `dir` that hold an `mtek.toml`; group directories
/// (without one) contribute their children.
fn projects(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_dir())
        .collect();
    entries.sort();
    for path in entries {
        if path.join("mtek.toml").is_file() {
            found.push(path);
        } else if path.file_name().is_some_and(|n| n != "expected") {
            found.extend(projects(&path));
        }
    }
    found
}

/// The lowered program and sources of the project at `root`.
fn lowered(root: &Path) -> (Program, SourceMap) {
    lowered_fs(&project(root), &root.display().to_string())
}

/// The lowered program and sources of the in-memory project `fs`.
fn lowered_fs(fs: &MemFs, label: &str) -> (Program, SourceMap) {
    let analysis = analyze(&ProjectRoot::at_base(), fs);
    assert!(!analysis.has_errors(), "{label}: {:#?}", analysis.report);
    let program = lower_to_ir(&analysis).unwrap_or_else(|e| panic!("{e:?}"));
    let sources = analysis.project.as_ref().unwrap().sources.clone();
    (program, sources)
}

/// Every material of `program` as a validated artifact, keyed by
/// `<module stem>.<Material>`.
fn shaders(program: &Program) -> BTreeMap<String, ShaderArtifact> {
    let mut out = BTreeMap::new();
    for material in program.materials() {
        let shader = lower_material(program, material).unwrap_or_else(|d| panic!("{d:#?}"));
        let artifact = emit_shader(&shader).unwrap_or_else(|d| panic!("{d:#?}"));
        // Validated independently of the artifact path, too.
        validate_wgsl(&artifact.wgsl).unwrap_or_else(|e| panic!("{e}\n{}", artifact.wgsl));
        let (path, name) = material.symbol.as_str().rsplit_once("::").unwrap();
        let stem = path.rsplit('/').next().unwrap().trim_end_matches(".mtek");
        out.insert(format!("{stem}.{name}"), artifact);
    }
    out
}

#[test]
fn the_pulse_golden_project_is_the_semantic_pulse_fixture() {
    let golden = materials_dir().join("pulse/src/main.mtek");
    let semantic = repo().join("tests/semantics/pass/materials/pulse/src/main.mtek");
    assert_eq!(fs::read(golden).unwrap(), fs::read(semantic).unwrap());
}

#[test]
fn every_golden_material_matches_its_expected_wgsl() {
    let mut differ = Vec::new();
    let mut count = 0;
    for root in projects(&materials_dir()) {
        let (program, _) = lowered(&root);
        let expected_dir = root.join("expected");
        let shaders = shaders(&program);
        assert!(!shaders.is_empty(), "{} has no material", root.display());
        if blessing() {
            let _ = fs::remove_dir_all(&expected_dir);
            fs::create_dir_all(&expected_dir).unwrap();
        }
        for (key, artifact) in &shaders {
            count += 1;
            let path = expected_dir.join(format!("{key}.wgsl"));
            if blessing() {
                fs::write(&path, &artifact.wgsl).unwrap();
            } else if fs::read_to_string(&path).ok().as_deref() != Some(artifact.wgsl.as_str()) {
                differ.push(path.display().to_string());
            }
        }
        if !blessing() {
            let on_disk = fs::read_dir(&expected_dir).map_or(0, |d| d.count());
            assert_eq!(
                on_disk,
                shaders.len(),
                "stale goldens in {}",
                expected_dir.display()
            );
        }
    }
    assert!(count >= 6, "{count} golden materials");
    assert!(
        differ.is_empty(),
        "WGSL goldens differ (bless with MTEK_BLESS=1 and review):\n{}",
        differ.join("\n")
    );
}

#[test]
fn every_material_of_every_fixture_lowers_validates_and_is_deterministic() {
    let mut roots = projects(&repo().join("tests/semantics/pass"));
    roots.extend(projects(&repo().join("tests/codegen")));
    let mut materials = 0;
    for root in roots {
        let (program, _) = lowered(&root);
        let first = shaders(&program);
        let second = shaders(&program);
        materials += first.len();
        for (key, artifact) in &first {
            assert_eq!(artifact.wgsl, second[key].wgsl, "{key}");
            assert_eq!(artifact.span_map, second[key].span_map, "{key}");
        }
    }
    assert!(materials >= 14, "{materials} materials");
}

#[test]
fn the_golden_projects_build_with_schema_shaped_shader_entries() {
    for root in projects(&materials_dir()) {
        let built = build(
            &ProjectRoot::at_base(),
            &project(&root),
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(
            !built.has_errors(),
            "{}: {:#?}",
            root.display(),
            built.report
        );
        let again = build(
            &ProjectRoot::at_base(),
            &project(&root),
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert_eq!(built.files, again.files, "{}", root.display());
        let wgsl = built.files.keys().filter(|p| p.ends_with(".wgsl")).count();
        let maps = built
            .files
            .keys()
            .filter(|p| p.ends_with(".mtek-map.json"))
            .count();
        assert!(wgsl >= 1 && wgsl == maps, "{}", root.display());
    }
}

/// The WGSL text an entry covers.
fn covered(text: &str, line: u32, start: u32, end: u32) -> &str {
    let line = text.lines().nth(line as usize - 1).unwrap();
    &line[start as usize - 1..end as usize - 1]
}

/// The declaration spans of every symbol entries may name: materials, their stages and
/// functions.
fn declarations(program: &Program) -> BTreeMap<String, Span> {
    let mut out = BTreeMap::new();
    for item in program.modules.iter().flat_map(|m| m.items.iter()) {
        match item {
            Item::Material(material) => {
                out.insert(material.symbol.to_string(), material.span);
                out.insert(material.fragment.symbol.to_string(), material.fragment.span);
            }
            Item::Function(function) => {
                out.insert(function.symbol.to_string(), function.span);
            }
            _ => {}
        }
    }
    out
}

#[test]
fn span_map_entries_resolve_to_the_source_they_come_from() {
    let mut checked = 0;
    for root in projects(&materials_dir()) {
        let (program, sources) = lowered(&root);
        let declarations = declarations(&program);
        for (key, artifact) in shaders(&program) {
            for entry in &artifact.span_map.entries {
                let wgsl = covered(
                    &artifact.wgsl,
                    entry.wgsl.line,
                    entry.wgsl.col_start,
                    entry.wgsl.col_end,
                );
                let declaration = declarations[&entry.symbol];
                assert!(
                    entry.span.file == declaration.file
                        && declaration.start <= entry.span.start
                        && entry.span.end <= declaration.end,
                    "{key}: `{wgsl}` maps outside '{}'",
                    entry.symbol
                );
                if entry.symbol == artifact.material {
                    // Generated code: the material declaration.
                    assert_eq!(entry.span, declaration, "{key}: `{wgsl}`");
                    continue;
                }
                let source = sources.slice(entry.span).unwrap();
                checked += 1;
                let mangled_local = wgsl
                    .strip_prefix("u_l_")
                    .or_else(|| wgsl.strip_prefix("u_p_"))
                    .filter(|rest| rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
                if let Some(name) = mangled_local {
                    assert!(
                        source == name
                            // An assignment target maps to its statement (the IR has
                            // no span for places).
                            || source.starts_with(&format!("{name} "))
                            || source.starts_with(&format!("{name}.")),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if let Some(call) = wgsl.strip_prefix("u_fn_") {
                    let name = &call[9..call.find('(').unwrap()];
                    assert!(
                        source.starts_with(&format!("{name}(")),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if wgsl.starts_with("return") {
                    assert!(
                        source.starts_with("return"),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if let Some(rest) = wgsl.strip_prefix("let u_l_") {
                    let name = rest.split(' ').next().unwrap();
                    // A `let` of a `for x in arr` loop variable maps to its name.
                    assert!(
                        source.starts_with(&format!("let {name}")) || source == name,
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if let Some(rest) = wgsl.strip_prefix("var u_l_") {
                    let name = rest.split(' ').next().unwrap();
                    assert!(
                        source.starts_with(&format!("var {name}")),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if wgsl.starts_with("if ") || wgsl.starts_with("} else") {
                    assert!(
                        source.starts_with("if "),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if wgsl.starts_with("for (var u_l_") {
                    assert!(
                        source.starts_with("for "),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                } else if let Some((_, member)) = wgsl.rsplit_once(".u_")
                    && member
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    assert!(
                        source.ends_with(member),
                        "{key}: `{wgsl}` maps to `{source}`"
                    );
                }
            }
        }
    }
    assert!(checked > 200, "{checked} entries checked");
}

#[test]
fn the_pulse_span_map_points_at_each_piece_of_the_material() {
    let (program, sources) = lowered(&materials_dir().join("pulse"));
    let shaders = shaders(&program);
    let artifact = &shaders["main.Pulse"];
    let h = hash8("src/main.mtek");
    let resolve = |wgsl_text: &str| -> Vec<&str> {
        let mut found = Vec::new();
        for (index, line) in artifact.wgsl.lines().enumerate() {
            let mut from = 0;
            while let Some(at) = line[from..].find(wgsl_text) {
                let column = u32::try_from(from + at + 1).unwrap();
                let line_number = u32::try_from(index + 1).unwrap();
                // The narrowest entry covering exactly this text.
                let entry = artifact
                    .span_map
                    .entries
                    .iter()
                    .find(|e| {
                        e.wgsl.line == line_number
                            && e.wgsl.col_start == column
                            && e.wgsl.width() as usize == wgsl_text.len()
                    })
                    .unwrap_or_else(|| panic!("no entry for `{wgsl_text}`"));
                found.push(sources.slice(entry.span).unwrap());
                from += at + wgsl_text.len();
            }
        }
        found
    };
    assert_eq!(
        resolve(&format!("u_fn_{h}_pulse(mtek_params.u_phase)")),
        ["pulse(phase)"]
    );
    assert_eq!(resolve("mtek_params.u_phase"), ["phase"]);
    assert_eq!(resolve("mtek_params.u_tint.xyz"), ["tint.rgb"]);
    assert_eq!(resolve("mtek_params.u_tint.w"), ["tint.a"]);
    assert_eq!(resolve("sin(u_p_t)"), ["sin(t)"]);
    assert_eq!(resolve("0.35 * sin(u_p_t)"), ["0.35 * sin(t)"]);
    assert_eq!(
        resolve("return 0.65 + (0.35 * sin(u_p_t));"),
        ["return 0.65 + 0.35 * sin(t);"]
    );
    assert_eq!(
        resolve(&format!(
            "vec4<f32>(mtek_params.u_tint.xyz * u_fn_{h}_pulse(mtek_params.u_phase), mtek_params.u_tint.w)"
        )),
        ["color.linear(tint.rgb * pulse(phase), tint.a)"]
    );
    assert_eq!(
        resolve(&format!("fn u_fn_{h}_pulse(u_p_t: f32) -> f32 {{")),
        ["fn pulse(t: f32) -> f32 {\n    return 0.65 + 0.35 * sin(t);\n}"]
    );
    // Resolving a WGSL position goes to the narrowest entry: the column of `sin` gives
    // the call, the space before it the product around it.
    let line = artifact
        .wgsl
        .lines()
        .position(|l| l.contains("sin(u_p_t)"))
        .unwrap();
    let column = artifact
        .wgsl
        .lines()
        .nth(line)
        .unwrap()
        .find("sin(")
        .unwrap();
    let line = u32::try_from(line + 1).unwrap();
    let column = u32::try_from(column + 1).unwrap();
    assert_eq!(
        sources.slice(artifact.span_map.resolve(line, column).0),
        Some("sin(t)")
    );
    assert_eq!(
        sources.slice(artifact.span_map.resolve(line, column - 1).0),
        Some("0.35 * sin(t)")
    );
}

#[test]
fn unlit_lowered_from_source_matches_the_temporary_golden() {
    // M2-09 compiles the prelude's `Unlit` through this lowering and deletes the
    // compiler-built path; its golden `tests/codegen/wgsl/unlit.wgsl` must then stay
    // equal. The prelude's declaration, compiled as a user module, gives the same text
    // up to the name of the block (the prelude's name `Unlit` is reserved for it).
    let prelude = mtek_compiler::lowering::builtin_unlit::prelude_text().unwrap();
    let start = prelude.find("export material Unlit").unwrap();
    let end = start + prelude[start..].find("\n}\n").unwrap() + 3;
    let source = format!(
        "{}\nscene Demo {{\n    camera Main {{}}\n}}\n",
        prelude[start..end].replacen("export material Unlit", "material Plain", 1)
    );
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        b"[project]\nname = \"fixture\"\nlanguage = \"0.1\"\n".to_vec(),
    );
    fs.insert(
        ProjectPath::new("src/main.mtek").unwrap(),
        source.into_bytes(),
    );
    let (program, _) = lowered_fs(&fs, "unlit");
    let wgsl = shaders(&program)["main.Plain"].wgsl.clone();
    let golden = fs::read_to_string(repo().join("tests/codegen/wgsl/unlit.wgsl")).unwrap();
    assert_eq!(
        wgsl.replace(
            &format!("MtekParams_{}_Plain", hash8("src/main.mtek")),
            &format!("MtekParams_{}_Unlit", hash8("std/materials.mtek"))
        ),
        golden
    );
}
