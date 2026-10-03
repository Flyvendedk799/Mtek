//! The parser: tokens to [`ast`](super::ast) (`spec/grammar.ebnf`,
//! `spec/compiler-architecture.md` section 4.3).
//!
//! Expressions are parsed by a Pratt parser (the [`expr`] module); items,
//! members and statements by recursive descent (arriving with M1-05 on top of
//! the machinery in this module). Whatever the input, the parser returns: it
//! never panics, recursion is bounded by [`MAX_NESTING_DEPTH`], and every
//! loop consumes a token per iteration or ends.
//!
//! # Nesting limit (`E1050`)
//!
//! Two bounds keep both the parser's own stack and the stack of every later
//! pass that walks or drops the tree within a fixed size:
//!
//! * a *recursion* counter, shared by every recursive parse function: more
//!   than [`MAX_NESTING_DEPTH`] levels of nested constructs is `E1050`, the
//!   rest of the nested expression is skipped without recursion and an
//!   `Error` node stands in for it;
//! * a *height* bound on the expression tree itself: a long chain such as
//!   `a + b + c + ...` or `a.b.c.d...` is parsed by a loop, not by recursion,
//!   but nests one tree level per operator, so a tree taller than
//!   `MAX_TREE_HEIGHT` (one more than [`MAX_NESTING_DEPTH`]) is `E1050` as
//!   well (decision 0022). The node that would make it too tall is replaced by
//!   an `Error` node.
//!
//! Both report once per outermost expression.
//!
//! # Recovery
//!
//! After an unexpected token the parser reports one diagnostic and skips to a
//! synchronisation point (a separator or closing delimiter of the construct
//! it is in, `;`, or a bracket that belongs to an enclosing construct). At
//! most one syntax error is reported per [`MIN_TOKENS_BETWEEN_ERRORS`]
//! tokens, so one mistake does not produce an avalanche; diagnostics with a
//! dedicated meaning (`E1010`, `E1011`, `E1050`, `E1901`, `E0013`) are never
//! suppressed that way.

mod expr;
#[cfg(test)]
mod expr_tests;

use crate::diagnostics::{Code, Diagnostic, Diagnostics, SuggestedEdit};
use crate::source::{FileId, Span};

use super::ast::{Expr, NodeId};
use super::token::{Token, TokenKind, TokenValue};

/// The deepest nesting the parser accepts (`spec/compiler-architecture.md`
/// section 9, `E1050`).
pub const MAX_NESTING_DEPTH: u32 = 256;

/// The tallest expression tree the parser builds: one more than the nesting
/// limit, so that the `Error` node standing in for a nesting that hit the
/// limit, and the construct that was being nested into, still fit.
const MAX_TREE_HEIGHT: u32 = MAX_NESTING_DEPTH + 1;

/// At most one syntax error is reported per this many tokens.
const MIN_TOKENS_BETWEEN_ERRORS: usize = 3;

/// A source edit the parser believes fixes a diagnostic, *not yet validated*.
///
/// `spec/diagnostics.md` section 6 allows attaching an edit to a diagnostic
/// only after the file was re-checked with the edit applied. The parser cannot
/// do that, so (like the lexer's `FloatFix`) it hands the driver the
/// candidates; the driver looks one up by the span of the diagnostic `at` and
/// attaches it if the re-check passes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CandidateEdit {
    /// The code of the diagnostic the edit is for.
    pub code: Code,
    /// The primary span of that diagnostic.
    pub at: Span,
    pub edit: SuggestedEdit,
}

/// The result of [`parse_expression`].
#[derive(Clone, PartialEq, Debug)]
pub struct ParsedExpr {
    pub expr: Expr,
    /// One past the largest node id used (see [`super::ast`]).
    pub node_count: u32,
    pub candidate_edits: Vec<CandidateEdit>,
}

/// Parse `tokens` (the tokens of `text`, ending with `Eof`, as produced by
/// [`lex_str`](super::lex_str)) as exactly one expression (`Expr` of
/// `spec/grammar.ebnf`) and report problems to `sink`. Anything after the
/// expression is an error. The full parser reuses the expression parser; this
/// function exists for tests and tools that parse a lone expression.
#[must_use]
pub fn parse_expression(text: &str, tokens: &[Token], sink: &mut Diagnostics) -> ParsedExpr {
    parse_one_expression(text, tokens, sink, true)
}

/// Like [`parse_expression`] for `ExprNoDesc`: a descriptor literal is not
/// recognised at the top level of the expression (the condition of an `if`,
/// the bounds of a `for`), where `x {` starts a block. Inside parentheses,
/// brackets, call arguments and descriptor fields it is recognised again.
#[must_use]
pub fn parse_expression_no_desc(
    text: &str,
    tokens: &[Token],
    sink: &mut Diagnostics,
) -> ParsedExpr {
    parse_one_expression(text, tokens, sink, false)
}

fn parse_one_expression(
    text: &str,
    tokens: &[Token],
    sink: &mut Diagnostics,
    allow_descriptor: bool,
) -> ParsedExpr {
    let mut parser = Parser::new(text, tokens, sink);
    let expr = parser.expr(allow_descriptor);
    if parser.kind() != TokenKind::Eof {
        let found = parser.found();
        let diagnostic = Diagnostic::new(
            Code::E1001,
            format!("Expected the end of the expression, found {found}."),
        )
        .at(parser.span());
        parser.error(diagnostic);
    }
    ParsedExpr {
        expr,
        node_count: parser.next_id,
        candidate_edits: parser.candidate_edits,
    }
}

/// The parser state shared by all parse functions.
struct Parser<'a> {
    file: FileId,
    text: &'a str,
    tokens: &'a [Token],
    /// Stands in for the end of input if `tokens` does not end with `Eof`.
    eof: Token,
    pos: usize,
    /// End of the last consumed token: the end of every span being built.
    prev_end: u32,
    next_id: u32,
    /// Number of levels currently entered (see [`Parser::enter`]); 0 outside
    /// any parse function.
    depth: u32,
    /// Whether `E1050` was already reported for the current expression.
    depth_reported: bool,
    /// Token index of the last reported syntax error.
    last_error_pos: Option<usize>,
    candidate_edits: Vec<CandidateEdit>,
    sink: &'a mut Diagnostics,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str, tokens: &'a [Token], sink: &'a mut Diagnostics) -> Self {
        let file = tokens.first().map_or(FileId(0), |token| token.span.file);
        let end = u32::try_from(text.len()).unwrap_or(u32::MAX);
        Parser {
            file,
            text,
            tokens,
            eof: Token {
                kind: TokenKind::Eof,
                span: Span::at(file, end),
                value: TokenValue::None,
            },
            pos: 0,
            prev_end: 0,
            next_id: 0,
            depth: 0,
            depth_reported: false,
            last_error_pos: None,
            candidate_edits: Vec::new(),
            sink,
        }
    }

    // ----- the token cursor ------------------------------------------------

    fn tok(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or(&self.eof)
    }

    fn kind(&self) -> TokenKind {
        self.tok().kind
    }

    /// The kind of the token `n` places ahead; `Eof` past the end.
    fn kind_at(&self, n: usize) -> TokenKind {
        self.pos
            .checked_add(n)
            .and_then(|index| self.tokens.get(index))
            .map_or(TokenKind::Eof, |token| token.kind)
    }

    fn span(&self) -> Span {
        self.tok().span
    }

    /// Consume the current token. `Eof` is never consumed.
    fn bump(&mut self) {
        if self.kind() != TokenKind::Eof {
            self.prev_end = self.span().end;
            self.pos += 1;
        }
    }

    /// The source text of `span`, or `""` if it does not fit the text.
    fn text_of(&self, span: Span) -> &'a str {
        self.text.get(span.range()).unwrap_or("")
    }

    /// A description of the current token for messages: `` identifier `x` ``,
    /// `` `)` ``, `end of file`.
    fn found(&self) -> String {
        let token = self.tok();
        match token.kind {
            TokenKind::Ident | TokenKind::Int | TokenKind::Float | TokenKind::Color => {
                format!("{} `{}`", token.kind.describe(), self.text_of(token.span))
            }
            TokenKind::String => {
                let text = self.text_of(token.span);
                if text.chars().count() > 24 {
                    let shortened: String = text.chars().take(24).collect();
                    format!("string literal `{shortened}...`")
                } else {
                    format!("string literal `{text}`")
                }
            }
            kind => kind.describe().to_owned(),
        }
    }

    // ----- nodes -----------------------------------------------------------

    /// The next node id. Saturates instead of overflowing; a file would need
    /// 2^32 nodes, and the source limit of 4 MiB allows far fewer.
    fn id(&mut self) -> NodeId {
        let id = NodeId(self.next_id);
        self.next_id = self.next_id.saturating_add(1);
        id
    }

    /// The span from `start` to the end of the last consumed token.
    fn span_from(&self, start: u32) -> Span {
        Span::new(self.file, start, self.prev_end)
    }

    // ----- diagnostics -----------------------------------------------------

    /// Report a diagnostic with a dedicated meaning; never suppressed.
    fn report(&mut self, diagnostic: Diagnostic) {
        self.sink.push(diagnostic);
    }

    /// Report a syntax error unless one was reported within the last few
    /// tokens (see the module documentation), or when the current token is a
    /// literal the lexer already reported.
    fn error(&mut self, diagnostic: Diagnostic) {
        if self.tok().is_malformed() {
            return;
        }
        if self
            .last_error_pos
            .is_some_and(|last| self.pos < last.saturating_add(MIN_TOKENS_BETWEEN_ERRORS))
        {
            return;
        }
        self.last_error_pos = Some(self.pos);
        self.sink.push(diagnostic);
    }

    /// `E1002` unless the current token is `close`, which is then consumed.
    /// `open` is the span of the opening delimiter.
    fn expect_close(&mut self, open: Span, close: TokenKind) {
        if self.kind() == close {
            self.bump();
        } else {
            self.report_unclosed(open, close);
        }
    }

    // The reporting functions below are separate from the parse functions on
    // purpose: the messages need stack space for formatting, and the parse
    // functions recurse (a debug build must stay within a 1 MiB stack at the
    // nesting limit, see the module documentation).

    fn report_unclosed(&mut self, open: Span, close: TokenKind) {
        let opener = match close {
            TokenKind::RParen => "`(`",
            TokenKind::RBracket => "`[`",
            _ => "`{`",
        };
        let found = self.found();
        let diagnostic = Diagnostic::new(
            Code::E1002,
            format!(
                "Expected {} to close the {opener} opened here, found {found}.",
                close.describe()
            ),
        )
        .at(self.span())
        .related(open, "opened here")
        .expected(close.describe())
        .actual(found);
        self.error(diagnostic);
    }

    /// `E1001`: "Expected `what`, found `<current token>`."
    fn expected(&mut self, what: &str) {
        let found = self.found();
        let diagnostic = Diagnostic::new(Code::E1001, format!("Expected {what}, found {found}."))
            .at(self.span());
        self.error(diagnostic);
    }

    // ----- recursion bound -------------------------------------------------

    /// Enter one more level of nesting; false (and nothing changed) if that
    /// would nest deeper than [`MAX_NESTING_DEPTH`] levels inside the
    /// outermost one. Every `true` is paired with [`Self::leave`].
    fn enter(&mut self) -> bool {
        // The outermost level is the first entered, so `MAX + 1` are active
        // when the limit is reached.
        if self.depth > MAX_NESTING_DEPTH {
            return false;
        }
        self.depth += 1;
        true
    }

    fn leave(&mut self) {
        self.depth = self.depth.saturating_sub(1);
    }

    /// `E1050` at `at`, once per outermost expression.
    fn report_too_deep(&mut self, at: Span) {
        if self.depth_reported {
            return;
        }
        self.depth_reported = true;
        let diagnostic = Diagnostic::new(
            Code::E1050,
            format!("Nesting is deeper than the limit of {MAX_NESTING_DEPTH} levels."),
        )
        .at(at)
        .help("split the expression into several `let` statements");
        self.report(diagnostic);
    }

    // ----- recovery --------------------------------------------------------

    /// Skip tokens until one of `stops` or a closing delimiter or `;` that
    /// belongs to an enclosing construct, at bracket depth 0 of the skipped
    /// text, or the end of input. Brackets inside the skipped text are
    /// skipped as a unit. Does not consume the stopping token.
    fn skip_until(&mut self, stops: &[TokenKind]) {
        let mut depth = 0u32;
        loop {
            let kind = self.kind();
            if kind == TokenKind::Eof {
                return;
            }
            if depth == 0
                && (stops.contains(&kind)
                    || matches!(
                        kind,
                        TokenKind::Semi
                            | TokenKind::RBrace
                            | TokenKind::RParen
                            | TokenKind::RBracket
                    ))
            {
                return;
            }
            match kind {
                TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
                TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                    depth = depth.saturating_sub(1);
                }
                _ => {}
            }
            self.bump();
        }
    }

    /// The loop that parses `item (sep item)* sep?` up to, not including,
    /// `close`, with recovery. A failed item has reported why and may have
    /// consumed nothing. The two halves of the loop are separate functions,
    /// used as
    ///
    /// ```text
    /// while self.list_has_item(close) {
    ///     let parsed = /* parse one item, true if it succeeded */;
    ///     if !self.list_continues(sep, close, parsed) { break; }
    /// }
    /// ```
    ///
    /// instead of one function taking a closure: a closure adds two stack
    /// frames to every level of nesting.
    fn list_has_item(&self, close: TokenKind) -> bool {
        !matches!(self.kind(), kind if kind == close || kind == TokenKind::Eof)
    }

    /// After a list item: true if the list goes on with another item. The
    /// separator is consumed; at the closing delimiter the list ends; at
    /// anything else this reports it (unless the item already reported its
    /// own failure, `parsed` false) and skips to the next separator. Every
    /// iteration of the loop consumes a token or ends it.
    fn list_continues(&mut self, sep: TokenKind, close: TokenKind, parsed: bool) -> bool {
        let kind = self.kind();
        if kind == sep {
            self.bump();
            return true;
        }
        // The end of the list: its closing delimiter, or something that
        // belongs to an enclosing construct (the caller reports the missing
        // delimiter).
        if kind == close
            || matches!(
                kind,
                TokenKind::Eof
                    | TokenKind::Semi
                    | TokenKind::RBrace
                    | TokenKind::RParen
                    | TokenKind::RBracket
            )
        {
            return false;
        }
        if parsed {
            self.expected(&format!("{} or {}", sep.describe(), close.describe()));
        }
        self.skip_until(&[sep, close]);
        if self.kind() == sep {
            self.bump();
            return true;
        }
        false
    }
}
