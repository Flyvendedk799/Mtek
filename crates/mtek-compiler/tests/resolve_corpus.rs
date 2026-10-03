//! Name resolution over the fixture corpora: side-table coverage of every
//! declaration and name in the positive syntax corpus, and robustness of the
//! whole front end (lexer, parser, resolver) against mutated programs
//! (`spec/testing.md` section 3.3). These tests read the corpora from disk,
//! which library code may not do (`no_direct_io.rs`), so they live here.

// Test-only code: helper functions outside `#[test]` functions may unwrap.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::Path;

use mtek_compiler::diagnostics::{Code, Diagnostic, Diagnostics};
use mtek_compiler::resolve::{Resolution, resolve_module};
use mtek_compiler::source::FileId;
use mtek_compiler::syntax::ast::Module;
use mtek_compiler::syntax::{lex_str, parse_module, walk_module};

struct Resolved {
    module: Module,
    resolution: Resolution,
    diagnostics: Vec<Diagnostic>,
    syntax_errors: usize,
}

fn resolve_text(text: &str) -> Resolved {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let syntax_errors = sink.len();
    let resolution = resolve_module(&parsed.module, &mut sink);
    Resolved {
        module: parsed.module,
        resolution,
        diagnostics: sink.finish().diagnostics,
        syntax_errors,
    }
}

#[test]
fn every_declaration_and_every_name_is_in_the_side_tables() {
    // Over the whole positive syntax corpus: every declaring node has a
    // `DefId`, and every name node a `Res` (contextual words aside: the
    // names of lifecycle and stage functions and events).
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/syntax/pass");
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "mtek"))
        .collect();
    names.sort();
    assert!(names.len() >= 80);
    let declaring = [
        "const",
        "fn",
        "struct",
        "material",
        "prefab",
        "scene",
        "entity",
        "object",
        "state",
        "param",
        "param-decl",
        "let",
        "var",
        "for",
    ];
    for path in names {
        let text = std::fs::read_to_string(&path).unwrap();
        let r = resolve_text(&text);
        assert_eq!(r.syntax_errors, 0, "{}", path.display());
        let mut missing: Vec<String> = Vec::new();
        walk_module(&r.module, &mut |info, parent| {
            let snippet = || text.get(info.span.range()).unwrap_or("").to_owned();
            let label = |what: &str| format!("{what} {} `{}`", info.kind, snippet());
            if declaring.contains(&info.kind) && r.resolution.def_of(info.id).is_none() {
                missing.push(label("no DefId for"));
            }
            let contextual = info.kind == "ident"
                && parent.is_some_and(|p| matches!(p.kind, "lifecycle" | "stage" | "on"));
            let is_name = matches!(info.kind, "name" | "self" | "ident")
                || (info.kind == "len"
                    && snippet().starts_with(|c: char| c.is_ascii_alphabetic() || c == '_'));
            if is_name && !contextual && r.resolution.res(info.id).is_none() {
                missing.push(label("no Res for"));
            }
        });
        assert!(missing.is_empty(), "{}: {missing:#?}", path.display());
    }
}

/// SplitMix64, for deterministic mutations.
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
}

/// Every `.mtek` file under `dir`, in sorted order.
fn mtek_files(dir: &Path, out: &mut Vec<String>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            mtek_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "mtek") {
            out.push(std::fs::read_to_string(&path).unwrap());
        }
    }
}

#[test]
fn mutated_programs_resolve_without_panicking() {
    // `spec/testing.md` 3.3 for this stage: token-level mutations (delete,
    // duplicate, swap) and truncations of the syntax and semantic corpora go
    // through lexing, parsing and resolution. Nothing panics, every span lies
    // in its file, every diagnostic has a catalogue code.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests");
    let mut corpus = Vec::new();
    mtek_files(&root.join("syntax/pass"), &mut corpus);
    mtek_files(&root.join("syntax/fail"), &mut corpus);
    mtek_files(&root.join("semantics"), &mut corpus);
    assert!(corpus.len() >= 150, "{} files", corpus.len());
    let mut rng = Rng(0x004d_312d_3039);
    let mut cases = 0;
    for text in &corpus {
        let lexed = lex_str(FileId(0), text);
        let spans: Vec<_> = lexed.tokens.iter().map(|t| t.span.range()).collect();
        for _ in 0..40 {
            let (Some(a), Some(b)) = (
                spans.get(rng.below(spans.len())).cloned(),
                spans.get(rng.below(spans.len())).cloned(),
            ) else {
                continue;
            };
            let (first, second) = if a.start <= b.start { (a, b) } else { (b, a) };
            let mutated = match rng.below(4) {
                0 => format!("{}{}", &text[..first.start], &text[first.end..]),
                1 => format!(
                    "{}{}{}",
                    &text[..first.end],
                    &text[first.clone()],
                    &text[first.end..]
                ),
                2 if first.end <= second.start => format!(
                    "{}{}{}{}{}",
                    &text[..first.start],
                    &text[second.clone()],
                    &text[first.end..second.start],
                    &text[first.clone()],
                    &text[second.end..]
                ),
                _ => text[..first.start].to_owned(),
            };
            let r = resolve_text(&mutated);
            for d in &r.diagnostics {
                assert!(
                    Code::parse_short(d.code.short()).is_some(),
                    "{d:?} has no catalogue code"
                );
                for span in d
                    .primary
                    .iter()
                    .map(|l| l.span)
                    .chain(d.related.iter().map(|l| l.span))
                {
                    assert!(span.end as usize <= mutated.len(), "{d:?} in {mutated:?}");
                }
            }
            cases += 1;
        }
    }
    assert!(cases >= 5000, "{cases} cases");
}
