//! The parser: tokens to [`ast`](super::ast) (`spec/grammar.ebnf`,
//! `spec/compiler-architecture.md` section 4.3).
//!
//! Expressions are parsed by a Pratt parser (the [`expr`] module); types,
//! items, members and statements by recursive descent (the [`ty`], [`items`],
//! [`members`] and [`stmt`] modules, on top of the machinery in this module and
//! in [`recover`]). Whatever the input, the parser returns: it never panics,
//! recursion is bounded by [`MAX_NESTING_DEPTH`], and every loop consumes a
//! token per iteration or ends.
//!
//! # Nesting limit (`E1050`)
//!
//! Two bounds keep both the parser's own stack and the stack of every later
//! pass that walks or drops the tree within a fixed size:
//!
//! * a *recursion* counter, shared by every recursive parse function: more
//!   than [`MAX_NESTING_DEPTH`] levels of nested constructs is `E1050`, the
//!   rest of the nested construct is skipped without recursion and an `Error`
//!   node stands in for it;
//! * a *height* bound on the expression tree itself: a long chain such as
//!   `a + b + c + ...` or `a.b.c.d...` is parsed by a loop, not by recursion,
//!   but nests one tree level per operator, so a tree taller than
//!   `MAX_TREE_HEIGHT` (one more than [`MAX_NESTING_DEPTH`]) is `E1050` as
//!   well (decision 0022). The node that would make it too tall is replaced by
//!   an `Error` node.
//!
//! Items, members and statements use the same counter, so the bound holds for
//! the whole tree. Every *block*, every `else if` link of a chain (an `else
//! if` chain nests one `IfStmt` per branch in the tree, so it counts like
//! nesting although it is no recursion in the source), the body of every
//! scene, prefab, material and entity, every level of type arguments and every
//! level of expression nesting is one level; an item itself is none. Up to
//! `MAX_NESTING_DEPTH + 1` levels can be active at a time. A construct that
//! would nest deeper is skipped without recursion (see
//! [`Parser::skip_nested`]) and replaced by an `Error` node. The error is
//! reported once per outermost expression, and once per statement, member or
//! item for everything else (a new one, below the limit, starts afresh).
//!
//! # Recovery
//!
//! After an unexpected token the parser reports one diagnostic and skips to a
//! synchronisation point (`spec/compiler-architecture.md` section 4.3): inside
//! an expression a separator or closing delimiter of the construct it is in, a
//! `;`, or a bracket that belongs to an enclosing construct; for a statement
//! the next `;` or the `}` of the block; for a member the next `;`, the `}` of
//! the body or the start of the next member; for an item the next item keyword
//! at nesting depth 0 (see [`recover::Sync`]). Skipped text becomes an `Error` node. At
//! most one syntax error is reported per [`MIN_TOKENS_BETWEEN_ERRORS`]
//! tokens, so one mistake does not produce an avalanche; diagnostics with a
//! dedicated meaning (`E1010`, `E1011`, `E1020`, `E1030`, `E1040`, `E1050`,
//! `E1901`, `E4901`, `E0013`, `W0007`) are never suppressed that way.

mod expr;
#[cfg(test)]
mod expr_tests;
mod items;
mod members;
mod recover;
mod stmt;
#[cfg(test)]
mod tests;
mod ty;

use crate::diagnostics::{Code, Diagnostic, Diagnostics, SuggestedEdit};
use crate::source::{FileId, Span};

use super::ast::{Expr, Module, NodeId};
use super::token::{Token, TokenKind, TokenValue, Trivia, TriviaKind};
use recover::Nest;

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

/// The result of [`parse_module`].
#[derive(Clone, PartialEq, Debug)]
pub struct ParsedModule {
    /// The tree. Where the text was not valid it contains `Error` nodes, each
    /// accompanied by a diagnostic (except for literals the lexer reported).
    pub module: Module,
    /// Edits for `E1003` and `E1011` that the driver may validate and attach
    /// (see [`CandidateEdit`]), in the order the diagnostics were reported.
    pub candidate_edits: Vec<CandidateEdit>,
}

/// Parse a whole file: `tokens` and `trivia` are the tokens and comments of
/// `text` as produced by [`lex`](super::lex) or [`lex_str`](super::lex_str)
/// (the token list ends with `Eof`). Syntax problems are reported to `sink`
/// (the lexical diagnostics are the caller's, through
/// [`Lexed::report_into`](super::Lexed::report_into)), including `W0007` for
/// doc comments that document nothing.
///
/// The parser never panics, and a result is always returned: the tree of an
/// erroneous file has `Error` nodes where the text could not be understood.
#[must_use]
pub fn parse_module(
    text: &str,
    tokens: &[Token],
    trivia: &Trivia,
    sink: &mut Diagnostics,
) -> ParsedModule {
    let mut parser = Parser::new(text, tokens, sink);
    parser.trivia = Some(trivia);
    let module = parser.module();
    ParsedModule {
        module,
        candidate_edits: parser.candidate_edits,
    }
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
    /// The comments of the file, if the caller has them (a lone expression
    /// has none).
    trivia: Option<&'a Trivia>,
    /// Stands in for the end of input if `tokens` does not end with `Eof`.
    eof: Token,
    pos: usize,
    /// The second half of the current token when a `>>` or `>=` was split in
    /// type context (see [`Parser::eat_closing_angle`]). While it is set, it
    /// is the current token; `pos` still indexes the token it came from.
    split_rest: Option<Token>,
    /// End of the last consumed token: the end of every span being built.
    prev_end: u32,
    /// The last consumed token is a literal the lexer reported: whatever
    /// follows it may be missing because the literal swallowed it (an
    /// unterminated string takes the `;` after it).
    prev_malformed: bool,
    /// Where the last placeholder for something missing was put (see
    /// [`Parser::placeholder_span`]); spans being built reach at least that
    /// far, so that a node contains its placeholders.
    reach: u32,
    next_id: u32,
    /// Number of levels currently entered (see [`Parser::enter`]); 0 outside
    /// any parse function.
    depth: u32,
    /// The nesting depth at which the expression being parsed started (see
    /// [`Parser::report_nesting`]).
    expr_base: u32,
    /// Whether `E1050` was already reported for the statement, member or item
    /// being parsed (the outermost expression, when parsing a lone one); see
    /// [`Parser::start_construct`].
    depth_reported: bool,
    /// How many `for` bodies enclose the statement being parsed, within the
    /// current function body (`E1030`).
    loop_depth: u32,
    /// Token index of the last reported syntax error.
    last_error_pos: Option<usize>,
    /// Token indices where a documentable declaration, member or struct field
    /// starts, in increasing order (see [`Parser::report_dangling_doc_comments`]).
    documentable: Vec<usize>,
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
            trivia: None,
            eof: Token {
                kind: TokenKind::Eof,
                span: Span::at(file, end),
                value: TokenValue::None,
            },
            pos: 0,
            split_rest: None,
            prev_end: 0,
            prev_malformed: false,
            reach: 0,
            next_id: 0,
            depth: 0,
            expr_base: 0,
            depth_reported: false,
            loop_depth: 0,
            last_error_pos: None,
            documentable: Vec::new(),
            candidate_edits: Vec::new(),
            sink,
        }
    }

    // ----- the token cursor ------------------------------------------------

    fn tok(&self) -> &Token {
        match &self.split_rest {
            Some(rest) => rest,
            None => self.tokens.get(self.pos).unwrap_or(&self.eof),
        }
    }

    fn kind(&self) -> TokenKind {
        self.tok().kind
    }

    /// The kind of the token `n` places ahead; `Eof` past the end.
    fn kind_at(&self, n: usize) -> TokenKind {
        if n == 0 {
            return self.kind();
        }
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
            self.prev_malformed = self.tok().is_malformed();
            self.prev_end = self.span().end;
            self.split_rest = None;
            self.pos += 1;
        }
    }

    /// Consume a `>` that closes type arguments, and say whether there was
    /// one. Types appear only after `:` and `->`, so `>` is never an operator
    /// there; the lexer's longest-match tokens `>>` (as in `array<array<f32,
    /// 2>>`, which is an error but should be reported as one) and `>=` (as in
    /// `let a: array<f32, 2>= x;`) are split: the first character is consumed
    /// and the rest is the current token.
    fn eat_closing_angle(&mut self) -> bool {
        let rest_kind = match self.kind() {
            TokenKind::Gt => {
                self.bump();
                return true;
            }
            TokenKind::Shr => TokenKind::Gt,
            TokenKind::Ge => TokenKind::Eq,
            _ => return false,
        };
        let span = self.span();
        self.prev_end = span.start.saturating_add(1);
        self.split_rest = Some(Token {
            kind: rest_kind,
            span: Span::new(span.file, self.prev_end, span.end),
            value: TokenValue::None,
        });
        true
    }

    /// The source text of `span`, or `""` if it does not fit the text.
    fn text_of(&self, span: Span) -> &'a str {
        self.text.get(span.range()).unwrap_or("")
    }

    /// True if there is a line break in the source between the end of the last
    /// consumed token and the start of the current one.
    fn line_break_before_current(&self) -> bool {
        let between = Span::new(self.file, self.prev_end, self.span().start);
        self.text_of(between).contains('\n')
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

    /// The span from `start` to the end of the last consumed token (or of the
    /// last placeholder, if that is further).
    fn span_from(&self, start: u32) -> Span {
        Span::new(self.file, start, self.prev_end.max(self.reach).max(start))
    }

    // ----- diagnostics -----------------------------------------------------

    /// Report a diagnostic with a dedicated meaning; never suppressed.
    fn report(&mut self, diagnostic: Diagnostic) {
        self.sink.push(diagnostic);
    }

    /// Report a syntax error unless one was reported within the last few
    /// tokens (see the module documentation), or when the current token is a
    /// literal the lexer already reported. True if it was reported.
    fn error(&mut self, diagnostic: Diagnostic) -> bool {
        if self.tok().is_malformed() {
            return false;
        }
        if self
            .last_error_pos
            .is_some_and(|last| self.pos < last.saturating_add(MIN_TOKENS_BETWEEN_ERRORS))
        {
            return false;
        }
        self.last_error_pos = Some(self.pos);
        self.sink.push(diagnostic);
        true
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

    #[inline(never)]
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

    /// `E1001`: "Expected `what`, found `<current token>`." At the end of the
    /// file it is `E1004` instead: "Unexpected end of file; expected `what`."
    #[inline(never)]
    fn expected(&mut self, what: &str) {
        let diagnostic = self.expected_diagnostic(what);
        self.error(diagnostic);
    }

    /// The diagnostic of [`Self::expected`], for callers that add to it.
    fn expected_diagnostic(&self, what: &str) -> Diagnostic {
        if self.kind() == TokenKind::Eof {
            return Diagnostic::new(
                Code::E1004,
                format!("Unexpected end of file; expected {what}."),
            )
            .at(self.span())
            .expected(what);
        }
        let found = self.found();
        Diagnostic::new(Code::E1001, format!("Expected {what}, found {found}."))
            .at(self.span())
            .expected(what)
            .actual(found)
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

    /// A statement, member or item starts: it is a new place for a mistake,
    /// so a nesting that is too deep is reported again, unless the nesting is
    /// still at the limit, where it is the overflow that was reported (an
    /// `else if` chain that is too long, for one, has statements in its
    /// blocks all the way).
    fn start_construct(&mut self) {
        if self.depth < MAX_NESTING_DEPTH {
            self.depth_reported = false;
        }
    }

    /// `E1050` at `at` for an expression, once per outermost expression.
    fn report_too_deep(&mut self, at: Span) {
        self.report_nesting(at, Nest::Expression);
    }

    // ----- lists -----------------------------------------------------------

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
        let kind = self.kind();
        !(kind == close
            || kind == TokenKind::Eof
            || (close == TokenKind::RParen && matches!(kind, TokenKind::LBrace | TokenKind::Arrow)))
    }

    /// After a list item: true if the list goes on with another item. The
    /// separator is consumed; at the closing delimiter the list ends; at
    /// anything else this reports it (unless the item already reported its
    /// own failure, `parsed` false) and skips to the next separator. Every
    /// iteration of the loop consumes a token or ends it.
    ///
    /// A `{` or `->` also ends a list closed by `)`: in `fn f(a: f32 {` it is
    /// the body that follows the missing `)`, and nothing inside parentheses
    /// starts with either (a descriptor literal starts with its name).
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
            || (close == TokenKind::RParen && matches!(kind, TokenKind::LBrace | TokenKind::Arrow))
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

    // ----- documentation comments ------------------------------------------

    /// Note that a declaration, member or struct field starts at the current
    /// token: doc comments before it document something.
    fn mark_documentable(&mut self) {
        if self.documentable.last() != Some(&self.pos) {
            self.documentable.push(self.pos);
        }
    }

    /// `W0007` for every doc comment that documents nothing: one that is not
    /// directly before a declaration or member (`spec/language.md` 1.5; blank
    /// lines are allowed, other comments in between are not).
    fn report_dangling_doc_comments(&mut self) {
        let Some(trivia) = self.trivia else { return };
        let items = trivia.items();
        let mut start = 0;
        while start < items.len() {
            let next_token = items[start].next_token;
            let mut end = start;
            while end < items.len() && items[end].next_token == next_token {
                end += 1;
            }
            let group = &items[start..end];
            // Only the doc comments after the last ordinary comment of the
            // group are directly before the token.
            let attachable_from = group
                .iter()
                .rposition(|comment| comment.kind != TriviaKind::DocComment)
                .map_or(0, |last| last + 1);
            let documents = self.documentable.binary_search(&next_token).is_ok();
            for (index, comment) in group.iter().enumerate() {
                if comment.kind == TriviaKind::DocComment && (index < attachable_from || !documents)
                {
                    let diagnostic = Diagnostic::new(
                        Code::W0007,
                        "This documentation comment is not followed by a declaration or member to document.",
                    )
                    .at(comment.span)
                    .help("put the comment directly before the declaration, or make it an ordinary `//` comment");
                    self.report(diagnostic);
                }
            }
            start = end;
        }
    }
}
