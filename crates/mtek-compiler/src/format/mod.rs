//! The canonical formatter (`mtek fmt`, `spec/tooling.md` section 5, decision
//! 0070).
//!
//! [`format_text`] turns the text of a valid module into its canonical text:
//! an AST-based printer ([`Doc`](doc::Doc) layout in [`MAX_WIDTH`] columns)
//! with the comments of the trivia side table attached by position. A file
//! that does not parse is refused with its diagnostics and never rewritten.
//!
//! Three properties hold for every module (they are tested on the whole
//! corpus, and the first two are checked on every run, see below):
//!
//! * the formatted text parses to the same syntax tree as the original,
//!   ignoring spans ([`dump_module`] is equal);
//! * the comments are the same, as a multiset of [`comment_texts`];
//! * formatting the formatted text changes nothing.
//!
//! The library performs no I/O: it takes text and returns text.

mod comments;
mod decls;
mod doc;
mod exprs;
mod printer;
mod stmts;

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::FileId;
use crate::syntax::{dump_module, lex_str, parse_module};

use comments::normalized_text;
use printer::Printer;

/// The maximum width of a line, in characters (`spec/tooling.md` section 5).
pub const MAX_WIDTH: usize = 100;

/// The canonical text of the module `text`.
///
/// `file` is the identity the diagnostics of a module that does not parse are
/// reported against. Text that is already canonical is returned unchanged,
/// byte for byte.
///
/// # Errors
/// The error diagnostics of the lexer and the parser if `text` is not a
/// syntactically valid module: nothing is formatted then. Warnings are not
/// reported. An `E9999` is returned in the (defective) case that the printer
/// would change the program or lose a comment; a result that does that is
/// never returned.
pub fn format_text(file: FileId, text: &str) -> Result<String, Vec<Diagnostic>> {
    let (formatted, original_tree) = print(file, text)?;
    verify(file, text, &original_tree, &formatted)?;
    Ok(formatted)
}

/// The printed text of the module `text` and the dump of its tree, before the
/// result is checked.
fn print(file: FileId, text: &str) -> Result<(String, String), Vec<Diagnostic>> {
    let mut lexed = lex_str(file, text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    if sink.has_errors() {
        return Err(sink.finish().diagnostics);
    }
    let mut printer = Printer::new(text, &lexed.tokens, &lexed.trivia);
    let layout = printer.module(&parsed.module);
    let unprinted = printer.unprinted_comments();
    if unprinted > 0 {
        return Err(vec![defect(format!(
            "the formatter did not print {unprinted} comment(s)"
        ))]);
    }
    let mut formatted = doc::render(&layout, MAX_WIDTH);
    if !formatted.is_empty() {
        formatted.push('\n');
    }
    Ok((formatted, dump_module(&parsed.module)))
}

/// The texts of the comments of `text`, sorted: what the formatter must keep.
/// A `//` comment is without trailing spaces and tabs and a block comment has
/// `\n` line breaks, as printed.
#[must_use]
pub fn comment_texts(file: FileId, text: &str) -> Vec<String> {
    let lexed = lex_str(file, text);
    let mut texts: Vec<String> = lexed
        .trivia
        .items()
        .iter()
        .map(|item| {
            let raw = text.get(item.span.range()).unwrap_or_default();
            normalized_text(item.kind, raw)
        })
        .collect();
    texts.sort();
    texts
}

/// Check that `formatted` is the same program with the same comments as
/// `text` (whose tree dumps as `original_tree`).
fn verify(
    file: FileId,
    text: &str,
    original_tree: &str,
    formatted: &str,
) -> Result<(), Vec<Diagnostic>> {
    let mut lexed = lex_str(file, formatted);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(formatted, &lexed.tokens, &lexed.trivia, &mut sink);
    if sink.has_errors() {
        return Err(vec![defect(
            "the formatted text does not parse".to_owned(),
        )]);
    }
    if dump_module(&parsed.module) != original_tree {
        return Err(vec![defect(
            "the formatted text is a different program".to_owned(),
        )]);
    }
    if comment_texts(file, formatted) != comment_texts(file, text) {
        return Err(vec![defect(
            "the formatted text has different comments".to_owned(),
        )]);
    }
    Ok(())
}

fn defect(what: String) -> Diagnostic {
    Diagnostic::new(
        Code::E9999,
        "The formatter stopped because of an internal error; this is a compiler bug.",
    )
    .note(what)
    .help("please report it with the program that caused it; the file was not changed")
}

#[cfg(test)]
mod tests;
