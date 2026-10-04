//! Coverage of `app.js.map` (`spec/compiler-architecture.md` section 6, decision 0040): every
//! codegen fixture and every semantic pass fixture is built, its source map decoded with an
//! independent Base64 VLQ decoder, and
//!
//! * every segment is well formed: it lies on a generated line and column of `app.js`, names a
//!   listed source, and points at a position inside that source;
//! * inside the emitted functions, every segment points at the start of the function, of one of
//!   its statements or of one of its expressions, and every line holding code has a segment;
//! * every emitted function and statement of the typed IR is mapped (some segment points at the
//!   position where it starts), and at least nine in ten of its expressions are; an expression is
//!   unmapped only where an enclosing one starts at the same generated position, which the unit
//!   test `emit_js::cpu::tests::every_function_statement_and_expression_is_mapped` checks node by
//!   node.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::ir::{self, Expr, ExprKind, Item, Stmt};
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath, SourceMap, Span};
use mtek_compiler::{BuildMode, CompileOptions, analyze, build};
use serde_json::Value;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn files(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
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
        if ["expected", "expected.diag.json", "exec.json"].contains(&relative.as_str()) {
            continue;
        }
        if path.is_dir() {
            files(root, &path, out);
        } else {
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

fn project(root: &Path) -> MemFs {
    let mut list = Vec::new();
    files(root, root, &mut list);
    let mut memory = MemFs::new();
    for (path, bytes) in list {
        memory.insert(ProjectPath::new(&path).unwrap(), bytes);
    }
    memory
}

/// Directories with an `mtek.toml` directly under `dir`, or one level deeper (groups).
fn projects(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_dir())
        .collect();
    entries.sort();
    for path in entries {
        if path.join("mtek.toml").is_file() {
            out.push(path);
        } else if depth > 0 {
            projects(&path, out, depth - 1);
        }
    }
}

fn every_project() -> Vec<PathBuf> {
    let mut all = Vec::new();
    projects(&repo().join("tests/codegen"), &mut all, 0);
    projects(&repo().join("tests/semantics/pass"), &mut all, 1);
    all
}

/// An independent Base64 VLQ decoder: one segment's fields.
fn decode_segment(text: &str) -> Vec<i64> {
    const ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut values = Vec::new();
    let mut value: u64 = 0;
    let mut shift = 0;
    for c in text.chars() {
        let digit = ALPHABET
            .find(c)
            .unwrap_or_else(|| panic!("not base64: {c}")) as u64;
        value |= (digit & 31) << shift;
        if digit & 32 == 0 {
            let magnitude = (value >> 1) as i64;
            values.push(if value & 1 == 1 {
                -magnitude
            } else {
                magnitude
            });
            value = 0;
            shift = 0;
        } else {
            shift += 5;
        }
    }
    assert_eq!(shift, 0, "unterminated VLQ in {text}");
    values
}

/// A decoded segment: generated line and column, source index, original line and column.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Segment {
    line: u32,
    column: u32,
    source: u32,
    original_line: u32,
    original_column: u32,
}

fn decode(mappings: &str) -> Vec<Segment> {
    let mut out = Vec::new();
    let (mut source, mut original_line, mut original_column) = (0i64, 0i64, 0i64);
    for (line, text) in mappings.split(';').enumerate() {
        let mut column = 0i64;
        for segment in text.split(',').filter(|s| !s.is_empty()) {
            let fields = decode_segment(segment);
            assert_eq!(fields.len(), 4, "segment {segment} has no source position");
            column += fields[0];
            source += fields[1];
            original_line += fields[2];
            original_column += fields[3];
            out.push(Segment {
                line: line as u32,
                column: u32::try_from(column).unwrap(),
                source: u32::try_from(source).unwrap(),
                original_line: u32::try_from(original_line).unwrap(),
                original_column: u32::try_from(original_column).unwrap(),
            });
        }
    }
    out
}

/// What the emitted functions should map: spans of functions and statements, and of
/// expressions.
#[derive(Default)]
struct Expected {
    statements: Vec<Span>,
    expressions: Vec<Span>,
}

fn expr(e: &Expr, out: &mut Expected) {
    out.expressions.push(e.span);
    let mut children: Vec<&Expr> = Vec::new();
    match &e.kind {
        ExprKind::Const { .. } | ExprKind::Local { .. } | ExprKind::Param { .. } => {}
        ExprKind::Unary { operand, .. } => children.push(operand),
        ExprKind::Binary { lhs, rhs, .. } => children.extend([&**lhs, &**rhs]),
        ExprKind::Call { args, .. }
        | ExprKind::Builtin { args, .. }
        | ExprKind::Construct { args } => children.extend(args),
        ExprKind::Convert { arg } => children.push(arg),
        ExprKind::Components { base, .. } | ExprKind::Field { base, .. } => children.push(base),
        ExprKind::Index { base, index } => children.extend([&**base, &**index]),
        ExprKind::Array { elements } => children.extend(elements),
        ExprKind::Struct { fields }
        | ExprKind::Descriptor { fields, .. }
        | ExprKind::Material { params: fields, .. } => {
            children.extend(fields.iter().map(|f| &f.value));
        }
    }
    for child in children {
        expr(child, out);
    }
}

fn block(b: &ir::Block, out: &mut Expected) {
    for s in &b.stmts {
        stmt(s, out);
    }
}

fn stmt(s: &Stmt, out: &mut Expected) {
    match s {
        Stmt::Let { value, span, .. } | Stmt::Var { value, span, .. } => {
            out.statements.push(*span);
            expr(value, out);
        }
        Stmt::Const { .. } => {}
        Stmt::Assign {
            target,
            value,
            span,
            ..
        } => {
            out.statements.push(*span);
            // The place (decision 0045): its root and each step map to their own text.
            let ir::PlaceRoot::Local { span: root, .. } = &target.root;
            out.expressions.push(*root);
            for step in &target.steps {
                out.expressions.push(step.span());
                if let ir::PlaceStep::Index { index, .. } = step {
                    expr(index, out);
                }
            }
            expr(value, out);
        }
        Stmt::If {
            branches,
            otherwise,
            span,
        } => {
            out.statements.push(*span);
            for branch in branches {
                expr(&branch.cond, out);
                block(&branch.body, out);
            }
            if let Some(b) = otherwise {
                block(b, out);
            }
        }
        Stmt::ForRange {
            start,
            end,
            body,
            span,
            ..
        } => {
            out.statements.push(*span);
            expr(start, out);
            expr(end, out);
            block(body, out);
        }
        Stmt::ForEach {
            array, body, span, ..
        } => {
            out.statements.push(*span);
            expr(array, out);
            block(body, out);
        }
        Stmt::Return { value, span } => {
            out.statements.push(*span);
            if let Some(v) = value {
                expr(v, out);
            }
        }
        Stmt::Break { span } | Stmt::Continue { span } => out.statements.push(*span),
        Stmt::Block { body } => block(body, out),
        Stmt::Expr { expr: e, span } => {
            out.statements.push(*span);
            expr(e, out);
        }
    }
}

/// `(file id, line, UTF-16 column)` of where `span` starts.
fn start(sources: &SourceMap, span: Span) -> (u32, u32, u32) {
    let position = sources.get(span.file).unwrap().lsp_position(span.start);
    (span.file.0, position.line, position.character)
}

/// The generated lines of the bodies of the emitted functions (`function f_…` to `}`).
fn function_lines(app: &str) -> BTreeSet<u32> {
    let mut lines = BTreeSet::new();
    let mut inside = false;
    for (index, line) in app.lines().enumerate() {
        if line.starts_with("function f_") {
            inside = true;
        }
        if inside {
            lines.insert(index as u32);
        }
        if line == "}" {
            inside = false;
        }
    }
    lines
}

#[test]
fn app_js_maps_every_emitted_statement_and_expression() {
    let mut functions_seen = 0;
    let mut expressions_seen = 0;
    let mut statements_seen = 0;
    let mut mapped_seen = 0;
    let mut segments_seen = 0;
    for root in every_project() {
        let label = root.display().to_string();
        let memory = project(&root);
        let result = build(
            &ProjectRoot::at_base(),
            &memory,
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!result.has_errors(), "{label}: {:#?}", result.report);
        let app = std::str::from_utf8(&result.files["app.js"]).unwrap();
        let map: Value = serde_json::from_slice(&result.files["app.js.map"]).unwrap();
        let sources: Vec<&str> = map["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect();
        let segments = decode(map["mappings"].as_str().unwrap());
        let lines: Vec<&str> = app.lines().collect();

        // The source index of a file id (the map lists the referenced files in id order).
        let file_of = |index: u32| -> u32 {
            let path = sources[index as usize];
            result
                .sources
                .files()
                .find(|f| f.path().as_str() == path)
                .unwrap_or_else(|| panic!("{label}: unknown source {path}"))
                .id()
                .0
        };

        // Well formed.
        let mut previous: Option<(u32, u32)> = None;
        for segment in &segments {
            let line = lines
                .get(segment.line as usize)
                .unwrap_or_else(|| panic!("{label}: segment on line {}", segment.line));
            assert!(
                (segment.column as usize) < line.len(),
                "{label}: {segment:?}"
            );
            assert!((segment.source as usize) < sources.len(), "{label}");
            let file = result
                .sources
                .get(mtek_compiler::source::FileId(file_of(segment.source)))
                .unwrap();
            let text = file.text();
            let source_line = text
                .split('\n')
                .nth(segment.original_line as usize)
                .unwrap_or_else(|| panic!("{label}: {segment:?} is past the end"));
            assert!(
                (segment.original_column as usize) <= source_line.encode_utf16().count(),
                "{label}: {segment:?}"
            );
            // Sorted, one segment per generated position.
            assert!(
                previous < Some((segment.line, segment.column)),
                "{label}: {segment:?}"
            );
            previous = Some((segment.line, segment.column));
        }

        // The emitted functions of the IR.
        let analysis = analyze(&ProjectRoot::at_base(), &memory);
        let program = ir::lower_to_ir(&analysis).unwrap();
        let mut expected = Expected::default();
        for module in &program.modules {
            for item in &module.items {
                if let Item::Function(function) = item
                    && function.cpu_reachable
                {
                    functions_seen += 1;
                    expected.statements.push(function.span);
                    block(&function.body, &mut expected);
                }
            }
        }
        expressions_seen += expected.expressions.len();
        statements_seen += expected.statements.len();
        segments_seen += segments.len();
        let mapped: BTreeSet<(u32, u32, u32)> = segments
            .iter()
            .map(|s| (file_of(s.source), s.original_line, s.original_column))
            .collect();
        let starts: BTreeSet<(u32, u32, u32)> = expected
            .statements
            .iter()
            .chain(&expected.expressions)
            .map(|span| start(&result.sources, *span))
            .collect();
        // Functions and statements always own their generated position. (An expression may
        // share its position with an enclosing one, `a_x >>> 0` for `u32(x)`; that every
        // expression is mapped up to such sharing is `emit_js::cpu`'s unit test.)
        let mut expressions_mapped = 0;
        for span in &expected.expressions {
            if mapped.contains(&start(&result.sources, *span)) {
                expressions_mapped += 1;
            }
        }
        mapped_seen += expressions_mapped;
        assert!(
            expressions_mapped * 10 >= expected.expressions.len() * 9,
            "{label}: only {expressions_mapped} of {} expressions are mapped",
            expected.expressions.len()
        );
        for span in &expected.statements {
            let position = start(&result.sources, *span);
            assert!(
                mapped.contains(&position),
                "{label}: nothing maps to {span:?} at {position:?}"
            );
        }

        // Inside the functions: segments point at node starts, and code lines are mapped.
        let body_lines = function_lines(app);
        for segment in segments.iter().filter(|s| body_lines.contains(&s.line)) {
            let position = (
                file_of(segment.source),
                segment.original_line,
                segment.original_column,
            );
            assert!(
                starts.contains(&position),
                "{label}: {segment:?} points at no statement or expression"
            );
        }
        let segment_lines: BTreeSet<u32> = segments.iter().map(|s| s.line).collect();
        for line in &body_lines {
            let text = lines[*line as usize].trim();
            let structural = text == "}" || text == "{" || text == "} else {";
            if !structural {
                assert!(
                    segment_lines.contains(line),
                    "{label}: line {} '{text}' has no mapping",
                    line + 1
                );
            }
        }
    }
    println!(
        "{functions_seen} functions, {statements_seen} functions and statements (all mapped), \
         {mapped_seen} of {expressions_seen} expressions with their own segment, \
         {segments_seen} segments"
    );
    assert!(functions_seen > 300, "{functions_seen} functions checked");
    assert!(
        expressions_seen > 1000,
        "{expressions_seen} expressions checked"
    );
}

#[test]
fn the_vlq_decoder_reads_the_known_vectors() {
    assert_eq!(decode_segment("AAAA"), [0, 0, 0, 0]);
    assert_eq!(decode_segment("CDEF"), [1, -1, 2, -2]);
    assert_eq!(decode_segment("gB"), [16]);
    assert_eq!(decode_segment("hgggggE"), [-2_147_483_648]);
    assert_eq!(decode_segment("w+B"), [1000]);
}
