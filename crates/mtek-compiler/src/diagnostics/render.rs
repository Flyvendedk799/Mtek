//! The human renderer (`spec/diagnostics.md` section 4): a rustc-style
//! header, `-->` location, numbered source lines, carets under the primary
//! span, dashes under related spans and `= help:` / `= note:` lines.
//!
//! Layout rules, all deterministic:
//!
//! * The header shows the diagnostic's `message`; the catalogue title is
//!   available in the JSON envelope.
//! * Source lines are shown without their terminator (`\n` or `\r\n`). Tabs
//!   render as 4 spaces; other control characters render as their Unicode
//!   control picture (`U+2400` block) so that a stray `\r` cannot move the
//!   terminal cursor. Every other scalar value takes one cell; wide
//!   (East Asian) characters are not measured.
//! * The primary span starts the first snippet. A related span joins a
//!   snippet of its file if it lies within 3 lines of what the snippet shows;
//!   otherwise (other file, or far away in the same file) it gets its own
//!   snippet introduced by `:::`, in the order of `related`.
//! * A span over several lines is underlined on each of its lines (all of
//!   them for up to 4 lines, otherwise the first two and the last, with
//!   `...` for the lines left out); its text follows the underline of its last
//!   line. A zero-width span shows one caret.
//! * Lines longer than [`MAX_LINE_COLUMNS`] cells are cut to that width around
//!   their underlined part, with `...` where text was cut.
//! * Colour is used only when [`RenderOptions::color`] is set (the caller
//!   decides: stdout is a terminal and `NO_COLOR` is unset).

use std::collections::BTreeMap;
use std::fmt::Write as _;

use super::model::{Diagnostic, HELP_PREFIX, Label, Severity};
use super::sink::Report;
use crate::source::{FileId, SourceFile, SourceMap, Span};

/// Lines longer than this many cells are elided around the span.
pub const MAX_LINE_COLUMNS: usize = 160;

/// How many cells of leading context stay visible before an elided span.
const ELISION_MARGIN: usize = 20;
const ELLIPSIS: &str = "...";
/// Interior lines of a multi-line span are listed in full up to this many.
const MAX_FULL_SPAN_LINES: u32 = 4;
/// Labels at most this many lines apart share one snippet.
const MERGE_DISTANCE: u32 = 3;
const NOTE_INDENT: &str = "        "; // width of "= note: "

/// Options of the human renderer.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct RenderOptions {
    /// Emit ANSI colour escape sequences.
    pub color: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Role {
    Plain,
    /// Carets, the primary message and the severity word.
    Primary(Severity),
    /// Dashes and related messages.
    Related,
    /// Line numbers, `|`, `-->`, `:::` and `=`.
    Gutter,
    Bold,
    Help,
    Note,
}

struct Painter {
    color: bool,
}

impl Painter {
    fn paint(&self, role: Role, text: &str) -> String {
        if !self.color || text.is_empty() {
            return text.to_string();
        }
        let code = match role {
            Role::Plain => return text.to_string(),
            Role::Primary(Severity::Error) => "1;31",
            Role::Primary(Severity::Warning) => "1;33",
            Role::Primary(Severity::Note) => "1;32",
            Role::Related | Role::Gutter => "1;34",
            Role::Bold => "1",
            Role::Help => "1;36",
            Role::Note => "1;32",
        };
        format!("\x1b[{code}m{text}\x1b[0m")
    }
}

/// A growable row of cells, each with the role that colours it.
#[derive(Default)]
struct Row {
    cells: Vec<(char, Role)>,
}

impl Row {
    fn put(&mut self, col: usize, ch: char, role: Role) {
        while self.cells.len() <= col {
            self.cells.push((' ', Role::Plain));
        }
        if let Some(cell) = self.cells.get_mut(col) {
            *cell = (ch, role);
        }
    }

    fn put_str(&mut self, col: usize, text: &str, role: Role) {
        for (i, ch) in text.chars().enumerate() {
            self.put(col + i, ch, role);
        }
    }

    fn len(&self) -> usize {
        self.cells.len()
    }

    /// The row as text with colour runs; trailing spaces are dropped.
    fn render(&self, painter: &Painter) -> String {
        let end = self
            .cells
            .iter()
            .rposition(|(ch, _)| *ch != ' ')
            .map_or(0, |i| i + 1);
        let mut out = String::new();
        let mut run = String::new();
        let mut run_role = Role::Plain;
        for (ch, role) in self.cells.iter().take(end) {
            if *role != run_role && !run.is_empty() {
                out.push_str(&painter.paint(run_role, &run));
                run.clear();
            }
            run_role = *role;
            run.push(*ch);
        }
        out.push_str(&painter.paint(run_role, &run));
        out
    }
}

/// One label's part on one source line, in cells of the unelided line.
#[derive(Clone, Debug)]
struct LineLabel {
    start: usize,
    end: usize,
    primary: bool,
    message: Option<String>,
    order: usize,
}

struct Block {
    file: FileId,
    /// Where the `-->` / `:::` line points.
    anchor: Span,
    lines: BTreeMap<u32, Vec<LineLabel>>,
}

/// Render one diagnostic. The result ends with a newline.
#[must_use]
pub fn render(diagnostic: &Diagnostic, map: &SourceMap, options: RenderOptions) -> String {
    let painter = Painter {
        color: options.color,
    };
    let blocks = build_blocks(diagnostic, map);
    let width = blocks
        .iter()
        .filter_map(|b| b.lines.keys().next_back())
        .map(|line| line.to_string().len())
        .max()
        .unwrap_or(1);
    let gutter = |text: &str| painter.paint(Role::Gutter, text);
    let bar = format!("{}{}", " ".repeat(width + 1), gutter("|"));

    let mut out = String::new();
    // Header.
    let sev = diagnostic.severity;
    let _ = writeln!(
        out,
        "{}{}",
        painter.paint(
            Role::Primary(sev),
            &format!("{}[{}]", sev.as_str(), diagnostic.code.as_str())
        ),
        painter.paint(Role::Bold, &format!(": {}", diagnostic.message)),
    );

    // Snippets. If the primary file is not in the map (a compiler bug) the
    // location line names the file id and no snippet follows.
    let missing_primary = diagnostic
        .primary
        .as_ref()
        .filter(|label| map.get(label.span.file).is_none());
    if let Some(label) = missing_primary {
        let _ = writeln!(
            out,
            "{}{} file#{}",
            " ".repeat(width),
            gutter("-->"),
            label.span.file.0
        );
    }
    for (index, block) in blocks.iter().enumerate() {
        let location = location_text(map, block.anchor);
        if index == 0 && missing_primary.is_none() {
            let _ = writeln!(out, "{}{} {location}", " ".repeat(width), gutter("-->"));
        } else {
            let _ = writeln!(
                out,
                "{}{} {location}",
                " ".repeat(width.saturating_sub(1)),
                gutter(":::")
            );
        }
        let _ = writeln!(out, "{bar}");
        if let Some(file) = map.get(block.file) {
            render_block(&mut out, block, file, width, &painter, sev);
        }
        if index + 1 < blocks.len() {
            let _ = writeln!(out, "{bar}");
        }
    }

    // Notes.
    let mut notes: Vec<String> = diagnostic.notes.clone();
    if diagnostic.primary.is_none()
        && let Some(text) = expected_found(diagnostic)
    {
        notes.insert(0, text);
    }
    for note in &notes {
        let (role, label, text) = match note.strip_prefix(HELP_PREFIX) {
            Some(text) => (Role::Help, "help", text),
            None => (Role::Note, "note", note.as_str()),
        };
        let mut lines = text.split('\n');
        let first = lines.next().unwrap_or("");
        let _ = writeln!(
            out,
            "{}{} {}{first}",
            " ".repeat(width + 1),
            gutter("="),
            painter.paint(role, &format!("{label}:")) + " ",
        );
        for line in lines {
            let _ = writeln!(out, "{}{NOTE_INDENT}{line}", " ".repeat(width + 1));
        }
    }
    out
}

/// Render several diagnostics, each followed by an empty line.
#[must_use]
pub fn render_report(report: &Report, map: &SourceMap, options: RenderOptions) -> String {
    let mut out = String::new();
    for diagnostic in &report.diagnostics {
        out.push_str(&render(diagnostic, map, options));
        out.push('\n');
    }
    out
}

fn expected_found(diagnostic: &Diagnostic) -> Option<String> {
    match (&diagnostic.expected, &diagnostic.actual) {
        (Some(e), Some(a)) => Some(format!("expected {e}, found {a}")),
        (Some(e), None) => Some(format!("expected {e}")),
        (None, Some(a)) => Some(format!("found {a}")),
        (None, None) => None,
    }
}

fn location_text(map: &SourceMap, span: Span) -> String {
    match map.get(span.file) {
        Some(file) => {
            let at = file.line_col(span.start);
            format!("{}:{}:{}", file.path(), at.line, at.column)
        }
        None => format!("file#{}", span.file.0),
    }
}

// ---- building the blocks -------------------------------------------------

fn build_blocks(diagnostic: &Diagnostic, map: &SourceMap) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut order = 0usize;
    let mut add = |label: &Label, primary: bool, text: Option<String>| {
        let Some(file) = map.get(label.span.file) else {
            return;
        };
        // A label joins a snippet of its file when it is within a few lines
        // of what that snippet already shows; otherwise it gets its own.
        let first = file.line_col(label.span.start).line;
        let last = file.line_col(label.span.end).line.max(first);
        let near = |b: &Block| {
            b.file == label.span.file
                && b.lines.keys().any(|&l| {
                    l.saturating_add(MERGE_DISTANCE) >= first
                        && l <= last.saturating_add(MERGE_DISTANCE)
                })
        };
        let at = match blocks.iter().position(near) {
            Some(i) => i,
            None => {
                blocks.push(Block {
                    file: label.span.file,
                    anchor: label.span,
                    lines: BTreeMap::new(),
                });
                blocks.len() - 1
            }
        };
        if let Some(block) = blocks.get_mut(at) {
            add_label(block, file, label.span, primary, text, order);
        }
        order += 1;
    };
    if let Some(primary) = &diagnostic.primary {
        let text = primary
            .message
            .clone()
            .or_else(|| expected_found(diagnostic));
        add(primary, true, text);
    }
    for label in &diagnostic.related {
        add(label, false, label.message.clone());
    }
    blocks
}

fn add_label(
    block: &mut Block,
    file: &SourceFile,
    span: Span,
    primary: bool,
    message: Option<String>,
    order: usize,
) {
    let lines = file.lines();
    let start = lines.line_col(span.start);
    let end = lines.line_col(span.end);
    let (mut end_line, mut end_cell) = (end.line, None);
    if end.line > start.line && end.column == 1 {
        // The span ends with a line terminator: it ends on the previous line.
        end_line = end.line - 1;
        end_cell = Some(cell_count(lines.line_text(end_line).unwrap_or("")));
    }
    let end_cell = end_cell.unwrap_or_else(|| {
        cells_before(
            lines.line_text(end_line).unwrap_or(""),
            (end.column as usize).saturating_sub(1),
        )
    });
    let message = message.map(|m| m.replace(['\r', '\n'], " "));
    let push = |block: &mut Block, line: u32, from: usize, to: usize, text: Option<String>| {
        block.lines.entry(line).or_default().push(LineLabel {
            start: from,
            end: to,
            primary,
            message: text,
            order,
        });
    };
    let first_text = lines.line_text(start.line).unwrap_or("");
    let start_cell = cells_before(first_text, (start.column as usize).saturating_sub(1));
    if end_line <= start.line {
        let to = end_cell.max(start_cell + 1);
        push(block, start.line, start_cell, to, message);
        return;
    }
    // Several lines.
    let total = end_line - start.line + 1;
    let shown: Vec<u32> = if total <= MAX_FULL_SPAN_LINES {
        (start.line..=end_line).collect()
    } else {
        vec![start.line, start.line + 1, end_line]
    };
    for line in shown {
        let text = lines.line_text(line).unwrap_or("");
        let full = cell_count(text);
        let indent = text
            .chars()
            .take_while(|c| *c == ' ' || *c == '\t')
            .map(cell_width)
            .sum::<usize>();
        if line == start.line {
            push(block, line, start_cell, full.max(start_cell + 1), None);
        } else if line == end_line {
            let from = indent.min(end_cell);
            push(block, line, from, end_cell.max(from + 1), message.clone());
        } else if full > indent {
            push(block, line, indent, full, None);
        } else {
            block.lines.entry(line).or_default();
        }
    }
}

// ---- cells ---------------------------------------------------------------

fn cell_width(c: char) -> usize {
    if c == '\t' { 4 } else { 1 }
}

fn cell_count(text: &str) -> usize {
    text.chars().map(cell_width).sum()
}

/// Cells taken by the first `scalars` characters of `text`.
fn cells_before(text: &str, scalars: usize) -> usize {
    text.chars().take(scalars).map(cell_width).sum()
}

fn display_chars(text: &str) -> Vec<char> {
    let mut cells = Vec::new();
    for c in text.chars() {
        match c {
            '\t' => cells.extend([' '; 4]),
            c if (c as u32) < 0x20 => {
                cells.push(char::from_u32(0x2400 + c as u32).unwrap_or('\u{FFFD}'));
            }
            '\u{7f}' => cells.push('\u{2421}'),
            c if c.is_control() => cells.push('\u{FFFD}'),
            c => cells.push(c),
        }
    }
    cells
}

// ---- drawing a block -----------------------------------------------------

fn render_block(
    out: &mut String,
    block: &Block,
    file: &SourceFile,
    width: usize,
    painter: &Painter,
    severity: Severity,
) {
    let gutter = |text: &str| painter.paint(Role::Gutter, text);
    let bar = format!("{} {}", " ".repeat(width), gutter("|"));
    let numbered = |line: u32| gutter(&format!("{line:>width$} |"));

    let mut previous: Option<u32> = None;
    // Lines to draw: the block's lines plus single lines between them.
    let mut drawn: Vec<(u32, bool)> = Vec::new();
    for &line in block.lines.keys() {
        if let Some(prev) = previous {
            match line - prev {
                0 | 1 => {}
                2 => drawn.push((prev + 1, false)),
                _ => drawn.push((0, false)), // marker for "..."
            }
        }
        drawn.push((line, true));
        previous = Some(line);
    }

    for (line, own) in drawn {
        if line == 0 {
            let _ = writeln!(out, "{}", painter.paint(Role::Gutter, ELLIPSIS));
            continue;
        }
        let text = file.lines().line_text(line).unwrap_or("");
        let labels: &[LineLabel] = if own {
            block.lines.get(&line).map_or(&[], Vec::as_slice)
        } else {
            &[]
        };
        let cells = display_chars(text);
        let (shown, window) = window_text(&cells, labels);
        if shown.is_empty() {
            let _ = writeln!(out, "{}", numbered(line));
        } else {
            let _ = writeln!(out, "{} {shown}", numbered(line));
        }
        for row in underline_rows(labels, window, severity)
            .iter()
            .map(|row| row.render(painter))
        {
            let _ = writeln!(out, "{bar} {row}");
        }
    }
}

/// Which cells of a line are visible and where marks may be drawn.
#[derive(Clone, Copy)]
struct Window {
    /// First cell of the line that is shown.
    offset: usize,
    /// Marks are clipped to `[low, high)`, in shown cells; the cells outside
    /// are taken by `...`.
    low: usize,
    high: usize,
}

/// The visible part of a line, elided when the line is longer than
/// [`MAX_LINE_COLUMNS`].
fn window_text(cells: &[char], labels: &[LineLabel]) -> (String, Window) {
    let furthest = labels.iter().map(|l| l.end).max().unwrap_or(0);
    let len = cells.len().max(furthest);
    if len <= MAX_LINE_COLUMNS {
        let all = Window {
            offset: 0,
            low: 0,
            high: len,
        };
        return (cells.iter().collect(), all);
    }
    let first = labels.iter().map(|l| l.start).min().unwrap_or(0);
    let start = first
        .saturating_sub(ELISION_MARGIN)
        .min(len.saturating_sub(MAX_LINE_COLUMNS));
    let end = start + MAX_LINE_COLUMNS;
    let mut shown: Vec<char> = (start..end)
        .map(|i| cells.get(i).copied().unwrap_or(' '))
        .collect();
    if start > 0 {
        for (slot, dot) in shown.iter_mut().zip(ELLIPSIS.chars()) {
            *slot = dot;
        }
    }
    if end < cells.len() {
        let n = shown.len();
        for (slot, dot) in shown.iter_mut().skip(n - 3).zip(ELLIPSIS.chars()) {
            *slot = dot;
        }
    }
    let text: String = shown.iter().collect();
    let window = Window {
        offset: start,
        low: if start > 0 { ELLIPSIS.len() } else { 0 },
        high: if end < cells.len() {
            MAX_LINE_COLUMNS - ELLIPSIS.len()
        } else {
            MAX_LINE_COLUMNS
        },
    };
    (text.trim_end().to_string(), window)
}

/// The underline rows of one line: marks, then connectors and messages.
fn underline_rows(labels: &[LineLabel], window: Window, severity: Severity) -> Vec<Row> {
    // Clip to the window; marks that fall completely outside are dropped.
    let mut marks: Vec<LineLabel> = Vec::new();
    for label in labels {
        let start = label.start.saturating_sub(window.offset).max(window.low);
        let end = label.end.saturating_sub(window.offset).min(window.high);
        if label.end <= window.offset || end <= start {
            continue;
        }
        marks.push(LineLabel {
            start,
            end,
            ..label.clone()
        });
    }
    if marks.is_empty() {
        return Vec::new();
    }
    let role_of = |primary: bool| {
        if primary {
            Role::Primary(severity)
        } else {
            Role::Related
        }
    };
    let mut row = Row::default();
    // Related marks first so that a primary mark wins an overlap.
    for primary_pass in [false, true] {
        for mark in marks.iter().filter(|m| m.primary == primary_pass) {
            let glyph = if mark.primary { '^' } else { '-' };
            for col in mark.start..mark.end {
                row.put(col, glyph, role_of(mark.primary));
            }
        }
    }

    let mut messaged: Vec<&LineLabel> = marks.iter().filter(|m| m.message.is_some()).collect();
    messaged.sort_by_key(|m| (m.start, m.order));
    let mut rows = Vec::new();
    let inline = messaged.pop();
    if let Some(label) = inline {
        let col = row.len() + 1;
        if let Some(text) = &label.message {
            row.put_str(col, text, role_of(label.primary));
        }
    }
    rows.push(row);
    if messaged.is_empty() {
        return rows;
    }
    let mut connectors = Row::default();
    for label in &messaged {
        connectors.put(label.start, '|', role_of(label.primary));
    }
    rows.push(connectors);
    for (i, label) in messaged.iter().enumerate().rev() {
        let mut row = Row::default();
        for earlier in &messaged[..i] {
            row.put(earlier.start, '|', role_of(earlier.primary));
        }
        if let Some(text) = &label.message {
            row.put_str(label.start, text, role_of(label.primary));
        }
        rows.push(row);
    }
    rows
}
