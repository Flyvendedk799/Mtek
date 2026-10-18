//! The acceptance test of suggested edits (`spec/diagnostics.md` section 6,
//! decision 0071): across every fixture project of the repository, every edit
//! the compiler attaches is proven, by this file's own re-check, to remove its
//! diagnostic without introducing an error, and the edits of one report never
//! overlap.
//!
//! The proof here does not call the compiler's validator. It applies the edit
//! with a plain string splice, runs `analyze` on the edited copy and compares
//! the diagnostics itself; if the validator had a bug, this would still catch
//! it. The corpus is every project under `tests/semantics`, `tests/assets`
//! and `tests/modules`, and every file of `tests/syntax/{fail,lex}` wrapped in a
//! minimal project (so that the lexical and syntax fixtures, whose edits
//! the front end validates, are covered too).

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::diagnostics::{Code, Severity};
use mtek_compiler::edits::spans_conflict;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{Fs, MemFs, ProjectPath};
use mtek_compiler::{Analysis, analyze};

/// The codes that carry validated edits (decision 0071).
const CODES_WITH_EDITS: &[Code] = &[
    Code::E0022,
    Code::E1003,
    Code::E1011,
    Code::E2003,
    Code::E7024,
];

const PROJECT: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A fixture project: a label and its files.
struct Fixture {
    label: String,
    fs: MemFs,
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect_files(root, &path, out);
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

fn project_dirs(dir: &Path, out: &mut Vec<PathBuf>) {
    if dir.join("mtek.toml").is_file() {
        out.push(dir.to_path_buf());
        return;
    }
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.is_dir())
        .collect();
    entries.sort();
    for path in entries {
        project_dirs(&path, out);
    }
}

fn fixtures() -> Vec<Fixture> {
    let mut out = Vec::new();
    for suite in ["semantics", "assets", "modules"] {
        let mut dirs = Vec::new();
        project_dirs(&repo().join("tests").join(suite), &mut dirs);
        for dir in dirs {
            let mut files = Vec::new();
            collect_files(&dir, &dir, &mut files);
            let mut memory = MemFs::new();
            for (path, bytes) in files {
                memory.insert(ProjectPath::new(&path).unwrap(), bytes);
            }
            let label = dir
                .strip_prefix(repo().join("tests"))
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push(Fixture { label, fs: memory });
        }
    }
    for suite in ["fail", "lex"] {
        let dir = repo().join("tests/syntax").join(suite);
        let mut names: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|e| e == "mtek"))
            .collect();
        names.sort();
        for path in names {
            let mut memory = MemFs::new();
            memory.insert(ProjectPath::new("mtek.toml").unwrap(), PROJECT);
            memory.insert(
                ProjectPath::new("src/main.mtek").unwrap(),
                fs::read(&path).unwrap(),
            );
            let label = format!(
                "syntax/{suite}/{}",
                path.file_name().unwrap().to_string_lossy()
            );
            out.push(Fixture { label, fs: memory });
        }
    }
    out
}

/// A diagnostic as this file compares them: severity, code, file and message,
/// without byte offsets.
type Key = (Severity, Code, Option<String>, String);

fn keys(analysis: &Analysis) -> BTreeMap<Key, usize> {
    let mut counts = BTreeMap::new();
    for d in &analysis.report.diagnostics {
        let file = d.primary.as_ref().and_then(|label| {
            analysis
                .project
                .as_ref()?
                .sources
                .get(label.span.file)
                .map(|f| f.path().as_str().to_owned())
        });
        *counts
            .entry((d.severity, d.code, file, d.message.clone()))
            .or_insert(0) += 1;
    }
    counts
}

/// Every attached edit of `fixture`, with the key of its diagnostic and its
/// replacements as `(path, start, end, text)`.
type Attached = (Key, Vec<(String, usize, usize, String)>);

fn attached(analysis: &Analysis) -> Vec<Attached> {
    let mut out = Vec::new();
    for d in &analysis.report.diagnostics {
        for suggestion in &d.edits {
            let sources = &analysis.project.as_ref().unwrap().sources;
            let file = d.primary.as_ref().map(|label| {
                sources
                    .get(label.span.file)
                    .unwrap()
                    .path()
                    .as_str()
                    .to_owned()
            });
            let edits = suggestion
                .edits
                .iter()
                .map(|e| {
                    (
                        sources.get(e.span.file).unwrap().path().as_str().to_owned(),
                        e.span.start as usize,
                        e.span.end as usize,
                        e.replacement.clone(),
                    )
                })
                .collect();
            out.push(((d.severity, d.code, file, d.message.clone()), edits));
        }
    }
    out
}

/// `fixture` with the edits written into the text of its files, by a plain
/// splice (highest offset first).
fn edited(fixture: &Fixture, edits: &[(String, usize, usize, String)]) -> MemFs {
    let mut memory = fixture.fs.clone();
    let mut paths: Vec<&String> = edits.iter().map(|e| &e.0).collect();
    paths.dedup();
    for path in paths {
        let project_path = ProjectPath::new(path).unwrap();
        let mut text = String::from_utf8(memory.read(&project_path).unwrap()).unwrap();
        let mut ours: Vec<&(String, usize, usize, String)> =
            edits.iter().filter(|e| &e.0 == path).collect();
        ours.sort_by_key(|e| std::cmp::Reverse((e.1, e.2)));
        for (_, start, end, replacement) in ours {
            text.replace_range(*start..*end, replacement);
        }
        memory.insert(project_path, text.into_bytes());
    }
    memory
}

fn errors(counts: &BTreeMap<Key, usize>) -> BTreeMap<&Key, usize> {
    counts
        .iter()
        .filter(|(key, _)| key.0 == Severity::Error)
        .map(|(key, count)| (key, *count))
        .collect()
}

#[test]
fn every_attached_edit_removes_its_diagnostic_and_adds_no_error() {
    let mut proven: BTreeMap<Code, usize> = BTreeMap::new();
    for fixture in fixtures() {
        let before = analyze(&ProjectRoot::at_base(), &fixture.fs);
        let before_keys = keys(&before);
        for (key, edits) in attached(&before) {
            let label = format!("{}: {} {:?}", fixture.label, key.1, key.3);
            assert!(
                CODES_WITH_EDITS.contains(&key.1),
                "{label}: this code is not allowed to carry edits"
            );
            assert!(!edits.is_empty(), "{label}: a suggestion without an edit");
            let after = analyze(&ProjectRoot::at_base(), &edited(&fixture, &edits));
            let after_keys = keys(&after);
            let was = before_keys.get(&key).copied().unwrap_or(0);
            let now = after_keys.get(&key).copied().unwrap_or(0);
            assert!(
                now < was,
                "{label}: the diagnostic is still there after the edit ({was} before, {now} after)"
            );
            let baseline = errors(&before_keys);
            for (error, count) in errors(&after_keys) {
                let allowed = baseline.get(error).copied().unwrap_or(0);
                assert!(
                    count <= allowed,
                    "{label}: the edit introduces the error {error:?} ({count} after, {allowed} before)"
                );
            }
            *proven.entry(key.1).or_insert(0) += 1;
        }
    }
    // The proof is not vacuous: every code that carries edits has some in the
    // corpus.
    for code in CODES_WITH_EDITS {
        assert!(
            proven.get(code).copied().unwrap_or(0) > 0,
            "no fixture has an attached edit for {code}: {proven:?}"
        );
    }
}

#[test]
fn the_edits_of_one_report_never_overlap() {
    let mut reports_with_edits = 0;
    for fixture in fixtures() {
        let analysis = analyze(&ProjectRoot::at_base(), &fixture.fs);
        let spans: Vec<_> = analysis
            .report
            .diagnostics
            .iter()
            .enumerate()
            .flat_map(|(index, d)| {
                d.edits
                    .iter()
                    .flat_map(|s| s.edits.iter())
                    .map(move |e| (index, e.span))
            })
            .collect();
        if !spans.is_empty() {
            reports_with_edits += 1;
        }
        for (i, (di, a)) in spans.iter().enumerate() {
            for (dj, b) in &spans[i + 1..] {
                assert!(
                    !spans_conflict(*a, *b),
                    "{}: edits {a:?} (diagnostic {di}) and {b:?} (diagnostic {dj}) overlap",
                    fixture.label
                );
            }
        }
    }
    assert!(reports_with_edits > 5, "{reports_with_edits}");
}

#[test]
fn a_diagnostic_has_at_most_one_suggestion_and_it_never_deletes() {
    for fixture in fixtures() {
        let analysis = analyze(&ProjectRoot::at_base(), &fixture.fs);
        for d in &analysis.report.diagnostics {
            assert!(
                d.edits.len() <= 1,
                "{}: {} has {} suggestions",
                fixture.label,
                d.code,
                d.edits.len()
            );
            assert!(d.candidates.is_empty(), "proposals must be consumed");
            for suggestion in &d.edits {
                assert!(!suggestion.description.trim().is_empty());
                for edit in &suggestion.edits {
                    assert!(
                        !edit.replacement.is_empty(),
                        "{}: {} deletes text",
                        fixture.label,
                        d.code
                    );
                }
            }
        }
    }
}
