//! The lexer: source text to tokens, trivia and lexical diagnostics
//! (`spec/grammar.ebnf` section 1, `spec/language.md` sections 1 and 2,
//! `spec/diagnostics.md` section 5.0).
//!
//! The lexer is total: it never panics, whatever the text, and after any
//! error it carries on with the next character, so the token stream always
//! ends with [`TokenKind::Eof`]. What it reports (the lexical catalogue
//! `E0003`-`E0025`) and what it deliberately leaves to later stages:
//!
//! * Reserved words lex as identifiers flagged `reserved`; `E0013` is the
//!   parser's and resolver's to report, where the word is used as a name.
//! * `_` alone is [`TokenKind::Underscore`]; `E0012` belongs to the resolver.
//! * Bitwise operators lex as tokens; `E1901` belongs to the parser.
//! * Invalid UTF-8 (`E0001`), a misplaced byte-order mark (`E0002`) and an
//!   oversized file (`E0004`) are rejected earlier by the
//!   [`SourceMap`](crate::source::SourceMap). [`lex_str`] still answers a
//!   misplaced mark with `E0002` so that it is total on every `&str`.
//! * A dangling doc comment (`W0007`) depends on what follows and is the
//!   parser's to report; the lexer only marks doc comments in the trivia.
//!
//! A literal that received a diagnostic carries
//! [`TokenValue::Malformed`], so that the parser does not report it again.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::{FileId, SourceFile, Span};

use super::token::{
    Token, TokenKind, TokenValue, Trivia, TriviaItem, TriviaKind, is_reserved_word, keyword_kind,
};

/// A replacement the lexer recorded for a malformed float literal (`E0022`):
/// writing `replacement` over `span` yields the float the author meant
/// (`1.` -> `1.0`, `.5` -> `0.5`, `1e3` -> `1.0e3`).
///
/// The lexer cannot validate the edit: `spec/diagnostics.md` section 6 only
/// allows attaching an edit after the file was re-checked with it applied.
/// The driver that can do that looks the fix up by the span of the `E0022`
/// diagnostic and attaches it as a suggested edit if the re-check passes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FloatFix {
    pub span: Span,
    pub replacement: String,
}

/// Everything the lexer produces for one file.
#[derive(Clone, PartialEq, Debug)]
pub struct Lexed {
    /// The tokens, in source order, ending with exactly one `Eof`.
    pub tokens: Vec<Token>,
    /// Comments, keyed by the index of the following token.
    pub trivia: Trivia,
    /// Lexical diagnostics in source order.
    pub diagnostics: Vec<Diagnostic>,
    /// The recorded replacements of `E0022` diagnostics, in source order
    /// (one per `E0022` diagnostic in [`Self::diagnostics`]).
    pub float_fixes: Vec<FloatFix>,
    /// Diagnostics found after the first [`MAX_LEXICAL_DIAGNOSTICS`] and not
    /// stored, so that a file of junk cannot exhaust memory. The driver
    /// counts them as suppressed (`W9003`).
    pub suppressed_diagnostics: usize,
}

/// The lexer stores at most this many diagnostics per file; the driver's sink
/// keeps only the first [`MAX_DIAGNOSTICS_PER_FILE`](crate::diagnostics::MAX_DIAGNOSTICS_PER_FILE) of all stages anyway
/// (`spec/compiler-architecture.md` section 9).
pub const MAX_LEXICAL_DIAGNOSTICS: usize = 1000;

/// Lex a validated source file. Lexing starts after a leading byte-order
/// mark; every span refers to the file as stored.
#[must_use]
pub fn lex(file: &SourceFile) -> Lexed {
    lex_str(file.id(), file.text())
}

/// Lex `text` as the content of file `file`. A leading byte-order mark is
/// skipped (it is permitted and ignored, `spec/language.md` 1.1); offsets
/// count from the start of `text`.
#[must_use]
pub fn lex_str(file: FileId, text: &str) -> Lexed {
    Lexer {
        file,
        text,
        bytes: text.as_bytes(),
        pos: 0,
        tokens: Vec::new(),
        trivia: Trivia::default(),
        diagnostics: Vec::new(),
        float_fixes: Vec::new(),
        suppressed: 0,
    }
    .run()
}

/// Which part of a float literal is missing (`E0022`): the variant names the
/// missing part.
#[derive(Clone, Copy)]
enum FloatForm {
    /// `1.`: nothing after the point.
    Fraction,
    /// `.5`: nothing before the point.
    Integer,
    /// `1e3`: an exponent without a point.
    Point,
}

struct Lexer<'a> {
    file: FileId,
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
    tokens: Vec<Token>,
    trivia: Trivia,
    diagnostics: Vec<Diagnostic>,
    float_fixes: Vec<FloatFix>,
    suppressed: usize,
}

impl<'a> Lexer<'a> {
    fn run(mut self) -> Lexed {
        if self.text.starts_with('\u{feff}') {
            self.pos = '\u{feff}'.len_utf8();
        }
        while let Some(byte) = self.byte(0) {
            match byte {
                b' ' | b'\t' | b'\n' => self.pos += 1,
                b'\r' => self.carriage_return(),
                b'/' => self.slash(),
                b'"' => self.string(),
                b'#' => self.color(),
                b'0'..=b'9' => self.number(),
                b'.' => self.dot(),
                b'A'..=b'Z' | b'a'..=b'z' | b'_' => self.ident(),
                0x80..=0xFF => self.non_ascii(),
                _ => self.punctuation(byte),
            }
        }
        let end = self.text.len();
        self.tokens.push(Token {
            kind: TokenKind::Eof,
            span: self.span(end, end),
            value: TokenValue::None,
        });
        Lexed {
            tokens: self.tokens,
            trivia: self.trivia,
            diagnostics: self.diagnostics,
            float_fixes: self.float_fixes,
            suppressed_diagnostics: self.suppressed,
        }
    }

    // ----- cursor helpers -------------------------------------------------

    /// The byte `offset` bytes ahead of the cursor.
    fn byte(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.pos.checked_add(offset)?).copied()
    }

    /// The character at the cursor. The cursor is always on a character
    /// boundary, because it only advances by whole characters or over ASCII.
    fn char_here(&self) -> Option<char> {
        self.text.get(self.pos..)?.chars().next()
    }

    fn slice(&self, start: usize, end: usize) -> &'a str {
        self.text.get(start..end).unwrap_or("")
    }

    fn span(&self, start: usize, end: usize) -> Span {
        Span::new(self.file, to_offset(start), to_offset(end))
    }

    fn push(&mut self, kind: TokenKind, start: usize, value: TokenValue) {
        let span = self.span(start, self.pos);
        self.tokens.push(Token { kind, span, value });
    }

    /// Record a diagnostic; returns false if the cap of
    /// [`MAX_LEXICAL_DIAGNOSTICS`] was reached and the diagnostic was only
    /// counted.
    fn report(&mut self, diagnostic: Diagnostic) -> bool {
        if self.diagnostics.len() >= MAX_LEXICAL_DIAGNOSTICS {
            self.suppressed += 1;
            return false;
        }
        self.diagnostics.push(diagnostic);
        true
    }

    fn trivia(&mut self, kind: TriviaKind, start: usize) {
        let item = TriviaItem {
            kind,
            span: self.span(start, self.pos),
            next_token: self.tokens.len(),
        };
        self.trivia.push(item);
    }

    fn skip_digits(&mut self) {
        while self.byte(0).is_some_and(|b| b.is_ascii_digit()) {
            self.pos += 1;
        }
    }

    /// Byte length of the identifier-continue character at the cursor: an
    /// ASCII letter, digit or `_`, or a non-ASCII alphanumeric character
    /// (which is reported as `E0010` wherever it ends up in a name).
    fn ident_continue_len(&self) -> Option<usize> {
        let byte = self.byte(0)?;
        if byte.is_ascii_alphanumeric() || byte == b'_' {
            return Some(1);
        }
        if byte >= 0x80 {
            let c = self.char_here()?;
            if c.is_alphanumeric() {
                return Some(c.len_utf8());
            }
        }
        None
    }

    /// Consume identifier-continue characters; true if any was non-ASCII.
    fn skip_ident_run(&mut self) -> bool {
        let mut non_ascii = false;
        while let Some(len) = self.ident_continue_len() {
            non_ascii |= len > 1;
            self.pos += len;
        }
        non_ascii
    }

    // ----- whitespace and invalid characters ------------------------------

    fn carriage_return(&mut self) {
        if self.byte(1) != Some(b'\n') {
            self.report_lone_cr(self.pos);
        }
        self.pos += 1;
    }

    fn report_lone_cr(&mut self, at: usize) {
        let diagnostic = Diagnostic::new(
            Code::E0003,
            "Carriage return without a following line feed; line endings are `\\n` or `\\r\\n`.",
        )
        .at(self.span(at, at + 1))
        .help("replace the carriage return with a line feed (`\\n`)");
        self.report(diagnostic);
    }

    fn non_ascii(&mut self) {
        let Some(c) = self.char_here() else {
            // Not reachable on a `&str`; advance so the loop always ends.
            self.pos += 1;
            return;
        };
        if c.is_alphanumeric() {
            self.ident();
        } else if c == '\u{feff}' {
            let span = self.span(self.pos, self.pos + c.len_utf8());
            let diagnostic = Diagnostic::new(
                Code::E0002,
                format!(
                    "Byte-order mark at byte {}; it is only allowed at the start of the file.",
                    self.pos
                ),
            )
            .at(span);
            self.report(diagnostic);
            self.pos += c.len_utf8();
        } else {
            self.invalid_char(c);
        }
    }

    /// `E0005`: a character that cannot start any token. It produces no token.
    fn invalid_char(&mut self, c: char) {
        let span = self.span(self.pos, self.pos + c.len_utf8());
        let code_point = format!("U+{:04X}", u32::from(c));
        let diagnostic = if c.is_whitespace() || c.is_control() {
            Diagnostic::new(
                Code::E0005,
                format!(
                    "Whitespace or control character {code_point} is not allowed outside strings and comments."
                ),
            )
            .help("separate tokens with a space (U+0020), a tab or a line break")
        } else {
            Diagnostic::new(
                Code::E0005,
                format!(
                    "Character {} is not part of the Mtek syntax.",
                    describe_char(c)
                ),
            )
        };
        self.report(diagnostic.at(span));
        self.pos += c.len_utf8();
    }

    // ----- identifiers, keywords --------------------------------------------

    fn ident(&mut self) {
        let start = self.pos;
        let non_ascii = self.skip_ident_run();
        let word = self.slice(start, self.pos);
        let span = self.span(start, self.pos);
        if non_ascii {
            let diagnostic = Diagnostic::new(
                Code::E0010,
                format!("Identifier `{word}` contains non-ASCII characters."),
            )
            .at(span)
            .note("Unicode identifiers are not supported in v0.1");
            self.report(diagnostic);
            self.push(
                TokenKind::Ident,
                start,
                TokenValue::Ident { reserved: false },
            );
        } else if word == "_" {
            self.push(TokenKind::Underscore, start, TokenValue::None);
        } else if let Some(kind) = keyword_kind(word) {
            self.push(kind, start, TokenValue::None);
        } else {
            if word.starts_with("__") {
                let diagnostic = Diagnostic::new(
                    Code::E0011,
                    format!(
                        "Identifier `{word}` starts with two underscores, which are reserved for generated code."
                    ),
                )
                .at(span);
                self.report(diagnostic);
            }
            let reserved = is_reserved_word(word);
            self.push(TokenKind::Ident, start, TokenValue::Ident { reserved });
        }
    }

    // ----- comments ---------------------------------------------------------

    fn slash(&mut self) {
        match self.byte(1) {
            Some(b'/') => self.line_comment(),
            Some(b'*') => self.block_comment(),
            Some(b'=') => {
                let start = self.pos;
                self.pos += 2;
                self.push(TokenKind::SlashEq, start, TokenValue::None);
            }
            _ => {
                let start = self.pos;
                self.pos += 1;
                self.push(TokenKind::Slash, start, TokenValue::None);
            }
        }
    }

    /// `// ...` up to, not including, the line terminator. Every comment that
    /// starts with `///` is a documentation comment (`spec/language.md` 1.5).
    fn line_comment(&mut self) {
        let start = self.pos;
        let kind = if self.byte(2) == Some(b'/') {
            TriviaKind::DocComment
        } else {
            TriviaKind::LineComment
        };
        while self.byte(0).is_some_and(|b| b != b'\n' && b != b'\r') {
            self.pos += 1;
        }
        self.trivia(kind, start);
    }

    /// `/* ... */`, nesting. Unterminated is `E0006` at the opener.
    fn block_comment(&mut self) {
        let start = self.pos;
        self.pos += 2;
        let mut depth = 1usize;
        while depth > 0 {
            match (self.byte(0), self.byte(1)) {
                (None, _) => break,
                (Some(b'/'), Some(b'*')) => {
                    depth += 1;
                    self.pos += 2;
                }
                (Some(b'*'), Some(b'/')) => {
                    depth -= 1;
                    self.pos += 2;
                }
                (Some(b'\r'), next) => {
                    if next != Some(b'\n') {
                        self.report_lone_cr(self.pos);
                    }
                    self.pos += 1;
                }
                _ => self.pos += 1,
            }
        }
        if depth > 0 {
            let mut diagnostic = Diagnostic::new(
                Code::E0006,
                "Block comment is not terminated; the `/*` here needs a matching `*/`.",
            )
            .at(self.span(start, start + 2));
            if depth > 1 {
                diagnostic = diagnostic.note(format!(
                    "{depth} block comments are still open at the end of the file (block comments nest)"
                ));
            }
            self.report(diagnostic);
        }
        self.trivia(TriviaKind::BlockComment, start);
    }

    // ----- numbers ----------------------------------------------------------

    fn dot(&mut self) {
        let start = self.pos;
        match self.byte(1) {
            Some(b'.') => {
                self.pos += 2;
                self.push(TokenKind::DotDot, start, TokenValue::None);
            }
            Some(b'0'..=b'9') => {
                // `.5`: a float without an integer part.
                self.pos += 1;
                self.skip_digits();
                self.skip_exponent();
                self.malformed_float(start, 0, FloatForm::Integer);
            }
            _ => {
                self.pos += 1;
                self.push(TokenKind::Dot, start, TokenValue::None);
            }
        }
    }

    /// If an exponent (`e`/`E`, optional sign, at least one digit) starts at
    /// the cursor, consume it and return true.
    fn skip_exponent(&mut self) -> bool {
        if !matches!(self.byte(0), Some(b'e' | b'E')) {
            return false;
        }
        let sign = usize::from(matches!(self.byte(1), Some(b'+' | b'-')));
        if self.byte(1 + sign).is_some_and(|b| b.is_ascii_digit()) {
            self.pos += 1 + sign;
            self.skip_digits();
            true
        } else {
            false
        }
    }

    fn number(&mut self) {
        let start = self.pos;
        self.skip_digits();
        let int_len = self.pos - start;
        match self.byte(0) {
            Some(b'.') => match self.byte(1) {
                Some(b'0'..=b'9') => {
                    // A float with a fraction.
                    self.pos += 1;
                    self.skip_digits();
                    self.skip_exponent();
                    self.finish_number(start, int_len, TokenKind::Float);
                }
                // `0..n`: the digits are an integer and `..` follows.
                Some(b'.') => self.finish_number(start, int_len, TokenKind::Int),
                _ => {
                    // `1.` (or `1.e3`): nothing after the point.
                    self.pos += 1;
                    self.skip_exponent();
                    self.malformed_float(start, int_len, FloatForm::Fraction);
                }
            },
            Some(b'e' | b'E') if self.exponent_follows() => {
                self.skip_exponent();
                if self.ident_continue_len().is_some() {
                    self.unsupported_numeric_form(start);
                } else {
                    self.malformed_float(start, int_len, FloatForm::Point);
                }
            }
            _ => self.finish_number(start, int_len, TokenKind::Int),
        }
    }

    /// True if an exponent starts at the cursor (without consuming it).
    fn exponent_follows(&self) -> bool {
        let sign = usize::from(matches!(self.byte(1), Some(b'+' | b'-')));
        self.byte(1 + sign).is_some_and(|b| b.is_ascii_digit())
    }

    /// The literal `start..pos` is well-formed except for what follows it:
    /// a trailing identifier run is a suffix (`E0021`), leading zeros are
    /// `E0020`, otherwise it is a valid literal of `kind`.
    fn finish_number(&mut self, start: usize, int_len: usize, kind: TokenKind) {
        if self.ident_continue_len().is_some() {
            self.unsupported_numeric_form(start);
            return;
        }
        let text = self.slice(start, self.pos);
        if int_len > 1 && text.starts_with('0') {
            self.leading_zero(start, int_len, kind);
            return;
        }
        let value = if kind == TokenKind::Float {
            match text.parse::<f64>() {
                Ok(value) => TokenValue::Float { value },
                Err(_) => {
                    self.internal_literal_error(start, "float");
                    TokenValue::Malformed
                }
            }
        } else {
            // Only overflow can fail here: the text is all ASCII digits.
            TokenValue::Int {
                value: text.parse::<u64>().ok(),
            }
        };
        self.push(kind, start, value);
    }

    /// A parse that the lexical grammar guarantees to succeed failed.
    fn internal_literal_error(&mut self, start: usize, what: &str) {
        let diagnostic = Diagnostic::new(
            Code::E9999,
            format!("The lexer could not read a {what} literal; this is a compiler bug."),
        )
        .at(self.span(start, self.pos));
        self.report(diagnostic);
    }

    /// `E0020`.
    fn leading_zero(&mut self, start: usize, int_len: usize, kind: TokenKind) {
        let text = self.slice(start, self.pos);
        let (int_part, rest) = text.split_at_checked(int_len).unwrap_or((text, ""));
        let trimmed = int_part.trim_start_matches('0');
        let fixed = format!("{}{rest}", if trimmed.is_empty() { "0" } else { trimmed });
        let what = if kind == TokenKind::Float {
            "Float"
        } else {
            "Integer"
        };
        let diagnostic = Diagnostic::new(
            Code::E0020,
            format!("{what} literal `{text}` has a leading zero; write it without leading zeros."),
        )
        .at(self.span(start, self.pos))
        .help(format!("write `{fixed}`"));
        self.report(diagnostic);
        self.push(kind, start, TokenValue::Malformed);
    }

    /// `E0021`: hexadecimal, binary, octal, suffixed or separated numbers.
    /// The whole malformed literal (the digits, the trailing identifier run
    /// and a fraction after it, as in `1_000.5`) becomes one token.
    fn unsupported_numeric_form(&mut self, start: usize) {
        let run_start = self.pos;
        self.skip_ident_run();
        let run_end = self.pos;
        if self.byte(0) == Some(b'.') && self.byte(1).is_some_and(|b| b.is_ascii_digit()) {
            self.pos += 1;
            self.skip_ident_run();
        }
        let text = self.slice(start, self.pos);
        let lower_prefix = text.get(..2).map(str::to_ascii_lowercase);
        let message = match lower_prefix.as_deref() {
            Some("0x") => format!(
                "Hexadecimal literal `{text}` is not supported in v0.1; write integers in decimal."
            ),
            Some("0b") => format!(
                "Binary literal `{text}` is not supported in v0.1; write integers in decimal."
            ),
            Some("0o") => format!(
                "Octal literal `{text}` is not supported in v0.1; write integers in decimal."
            ),
            _ if text.contains('_') => {
                format!("Literal `{text}` uses digit separators, which are not supported in v0.1.")
            }
            _ => {
                let suffix = self.slice(run_start, run_end);
                format!(
                    "Numeric literal `{text}` has the suffix `{suffix}`, which is not supported in v0.1; numeric literals have no suffixes."
                )
            }
        };
        let diagnostic = Diagnostic::new(Code::E0021, message).at(self.span(start, self.pos));
        self.report(diagnostic);
        self.push(TokenKind::Int, start, TokenValue::Malformed);
    }

    /// `E0022`: a float literal missing digits around the point, or written
    /// as an integer with an exponent. Records the replacement for a later
    /// validated edit. Leading zeros (`E0020`) take precedence.
    fn malformed_float(&mut self, start: usize, int_len: usize, form: FloatForm) {
        if int_len > 1 && self.slice(start, start + 1) == "0" {
            self.leading_zero(start, int_len, TokenKind::Float);
            return;
        }
        let text = self.slice(start, self.pos);
        let (int_part, rest) = text.split_at_checked(int_len).unwrap_or((text, ""));
        let (problem, replacement) = match form {
            FloatForm::Fraction => (
                "has no digits after the decimal point",
                // `rest` starts with the point: insert the missing `0` after it.
                format!("{int_part}.0{}", rest.get(1..).unwrap_or("")),
            ),
            FloatForm::Integer => ("has no digits before the decimal point", format!("0{text}")),
            FloatForm::Point => (
                "has an exponent but no decimal point",
                format!("{int_part}.0{rest}"),
            ),
        };
        let span = self.span(start, self.pos);
        let diagnostic = Diagnostic::new(
            Code::E0022,
            format!(
                "Float literal `{text}` {problem}; floats need digits on both sides of the point."
            ),
        )
        .at(span)
        .help(format!("write `{replacement}`"));
        if self.report(diagnostic) {
            self.float_fixes.push(FloatFix { span, replacement });
        }
        self.push(TokenKind::Float, start, TokenValue::Malformed);
    }

    // ----- strings ------------------------------------------------------------

    fn string(&mut self) {
        let start = self.pos;
        self.pos += 1;
        let mut value = String::new();
        let mut malformed = false;
        loop {
            match self.byte(0) {
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                None | Some(b'\n' | b'\r') => {
                    let diagnostic = Diagnostic::new(
                        Code::E0024,
                        "String literal is not terminated; a string must end with `\"` on the same line.",
                    )
                    .at(self.span(start, self.pos));
                    self.report(diagnostic);
                    malformed = true;
                    break;
                }
                Some(b'\\') => {
                    if !self.escape(&mut value) {
                        malformed = true;
                    }
                }
                Some(_) => {
                    // Any other character is taken as it is.
                    let Some(c) = self.char_here() else { break };
                    value.push(c);
                    self.pos += c.len_utf8();
                }
            }
        }
        let value = if malformed {
            TokenValue::Malformed
        } else {
            TokenValue::String(value)
        };
        self.push(TokenKind::String, start, value);
    }

    /// Read one escape sequence at the cursor (a backslash), append its
    /// character to `out` and return true; on `E0023` return false. A
    /// backslash right before the end of the line is left for the string
    /// scanner, which reports the string as unterminated.
    fn escape(&mut self, out: &mut String) -> bool {
        let start = self.pos;
        self.pos += 1;
        let simple = match self.byte(0) {
            None | Some(b'\n' | b'\r') => return true,
            Some(b'"') => Some('"'),
            Some(b'\\') => Some('\\'),
            Some(b'n') => Some('\n'),
            Some(b't') => Some('\t'),
            Some(b'r') => Some('\r'),
            Some(b'0') => Some('\0'),
            Some(b'u') => None,
            Some(_) => {
                // Unknown escape: report it with the whole character.
                if let Some(c) = self.char_here() {
                    self.pos += c.len_utf8();
                }
                let escaped = self.slice(start + 1, self.pos).chars().next();
                let shown = escaped.map_or_else(String::new, show_char);
                self.invalid_escape(
                    start,
                    format!("Invalid escape sequence `\\{shown}` in string literal."),
                );
                return false;
            }
        };
        if let Some(c) = simple {
            out.push(c);
            self.pos += 1;
            return true;
        }
        self.pos += 1; // the `u`
        self.unicode_escape(start, out)
    }

    /// `\u{H...}` after the `\u`: 1 to 6 hex digits naming a Unicode scalar
    /// value.
    fn unicode_escape(&mut self, start: usize, out: &mut String) -> bool {
        if self.byte(0) != Some(b'{') {
            self.invalid_escape(
                start,
                "Invalid escape sequence `\\u` in string literal; a Unicode escape is written `\\u{...}`."
                    .to_owned(),
            );
            return false;
        }
        self.pos += 1;
        let digits_start = self.pos;
        while self.byte(0).is_some_and(|b| b.is_ascii_hexdigit()) {
            self.pos += 1;
        }
        let digits = self.slice(digits_start, self.pos);
        let closed = self.byte(0) == Some(b'}');
        if closed {
            self.pos += 1;
        }
        let escape = self.slice(start, self.pos).to_owned();
        let problem = if !closed {
            "it is missing the closing `}`"
        } else if digits.is_empty() {
            "it has no hexadecimal digits"
        } else if digits.len() > 6 {
            "it has more than 6 hexadecimal digits"
        } else {
            match u32::from_str_radix(digits, 16)
                .ok()
                .and_then(char::from_u32)
            {
                Some(c) => {
                    out.push(c);
                    return true;
                }
                None => "it is not a Unicode scalar value",
            }
        };
        self.invalid_escape(
            start,
            format!("Invalid escape sequence `{escape}` in string literal: {problem}."),
        );
        false
    }

    fn invalid_escape(&mut self, start: usize, message: String) {
        let diagnostic = Diagnostic::new(Code::E0023, message)
            .at(self.span(start, self.pos))
            .note("valid escapes are \\\", \\\\, \\n, \\t, \\r, \\0 and \\u{HEX} with 1 to 6 hexadecimal digits");
        self.report(diagnostic);
    }

    // ----- colors -------------------------------------------------------------

    /// `#RRGGBB` or `#RRGGBBAA`. The whole run of identifier characters after
    /// the `#` belongs to the literal, so `#fff` and `#12345g` are one token
    /// each with `E0025`.
    fn color(&mut self) {
        let start = self.pos;
        self.pos += 1;
        let digits_start = self.pos;
        self.skip_ident_run();
        let digits = self.slice(digits_start, self.pos);
        let text = self.slice(start, self.pos);
        let non_hex = digits.chars().find(|c| !c.is_ascii_hexdigit());
        let problem = match (non_hex, digits.len()) {
            (Some(c), _) => Some(format!("contains `{c}`, which is not a hexadecimal digit")),
            (None, 6 | 8) => None,
            (None, 0) => Some("has no hexadecimal digits".to_owned()),
            (None, n) => Some(format!("has {n} hexadecimal digits")),
        };
        if let Some(problem) = problem {
            let diagnostic = Diagnostic::new(
                Code::E0025,
                format!("Color literal `{text}` {problem}; colors are `#RRGGBB` or `#RRGGBBAA`."),
            )
            .at(self.span(start, self.pos));
            self.report(diagnostic);
            self.push(TokenKind::Color, start, TokenValue::Malformed);
            return;
        }
        let byte = |index: usize| -> u8 {
            digits
                .get(index * 2..index * 2 + 2)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
                .unwrap_or(0)
        };
        let alpha = if digits.len() == 8 { byte(3) } else { 255 };
        let rgba = [byte(0), byte(1), byte(2), alpha];
        self.push(TokenKind::Color, start, TokenValue::Color { rgba });
    }

    // ----- punctuation --------------------------------------------------------

    fn punctuation(&mut self, byte: u8) {
        use TokenKind as K;
        let next = self.byte(1);
        let (kind, len) = match (byte, next) {
            (b'{', _) => (K::LBrace, 1),
            (b'}', _) => (K::RBrace, 1),
            (b'(', _) => (K::LParen, 1),
            (b')', _) => (K::RParen, 1),
            (b'[', _) => (K::LBracket, 1),
            (b']', _) => (K::RBracket, 1),
            (b',', _) => (K::Comma, 1),
            (b';', _) => (K::Semi, 1),
            (b':', _) => (K::Colon, 1),
            (b'<', Some(b'=')) => (K::Le, 2),
            (b'<', Some(b'<')) => (K::Shl, 2),
            (b'<', _) => (K::Lt, 1),
            (b'>', Some(b'=')) => (K::Ge, 2),
            (b'>', Some(b'>')) => (K::Shr, 2),
            (b'>', _) => (K::Gt, 1),
            (b'-', Some(b'>')) => (K::Arrow, 2),
            (b'-', Some(b'=')) => (K::MinusEq, 2),
            (b'-', _) => (K::Minus, 1),
            (b'+', Some(b'=')) => (K::PlusEq, 2),
            (b'+', _) => (K::Plus, 1),
            (b'*', Some(b'=')) => (K::StarEq, 2),
            (b'*', _) => (K::Star, 1),
            (b'%', _) => (K::Percent, 1),
            (b'!', Some(b'=')) => (K::BangEq, 2),
            (b'!', _) => (K::Bang, 1),
            (b'=', Some(b'=')) => (K::EqEq, 2),
            (b'=', _) => (K::Eq, 1),
            (b'&', Some(b'&')) => (K::AndAnd, 2),
            (b'&', _) => (K::Amp, 1),
            (b'|', Some(b'|')) => (K::OrOr, 2),
            (b'|', _) => (K::Pipe, 1),
            (b'^', _) => (K::Caret, 1),
            (b'~', _) => (K::Tilde, 1),
            _ => {
                if let Some(c) = self.char_here() {
                    self.invalid_char(c);
                } else {
                    self.pos += 1;
                }
                return;
            }
        };
        let start = self.pos;
        self.pos += len;
        self.push(kind, start, TokenValue::None);
    }
}

/// A character for use inside a message: itself if it is visible (an ASCII
/// graphic character or a letter or digit), otherwise its code point, so that
/// invisible and direction-changing characters never reach the terminal.
fn show_char(c: char) -> String {
    if c.is_ascii_graphic() || c.is_alphanumeric() {
        c.to_string()
    } else {
        format!("U+{:04X}", u32::from(c))
    }
}

/// `` `c` (U+XXXX) `` for visible characters, `U+XXXX` for the others.
fn describe_char(c: char) -> String {
    let code_point = format!("U+{:04X}", u32::from(c));
    if c == '`' {
        // A backtick cannot be quoted with backticks.
        format!("'{c}' ({code_point})")
    } else if c.is_ascii_graphic() || c.is_alphanumeric() {
        format!("`{c}` ({code_point})")
    } else {
        code_point
    }
}

/// A byte position as a span offset. Source files are limited to 4 MiB, so
/// the saturation only matters for text handed to [`lex_str`] directly.
fn to_offset(position: usize) -> u32 {
    u32::try_from(position).unwrap_or(u32::MAX)
}

impl Lexed {
    /// A deterministic text dump of the tokens and comments, one per line,
    /// used by the golden fixtures: `Kind start..end "text"` followed by
    /// ` = value` for literals and reserved words. Comments appear as
    /// `trivia Kind start..end "text"` before the token they precede.
    /// `source` must be the text that was lexed.
    #[must_use]
    pub fn dump(&self, source: &str) -> String {
        let mut out = String::new();
        for (index, token) in self.tokens.iter().enumerate() {
            for item in self.trivia.before(index) {
                let text = source.get(item.span.range()).unwrap_or("");
                out.push_str(&format!(
                    "trivia {:?} {}..{} \"{}\"\n",
                    item.kind,
                    item.span.start,
                    item.span.end,
                    escape_dump(text)
                ));
            }
            out.push_str(&format!(
                "{:?} {}..{} \"{}\"",
                token.kind,
                token.span.start,
                token.span.end,
                escape_dump(token.text(source))
            ));
            match &token.value {
                TokenValue::None | TokenValue::Ident { reserved: false } => {}
                TokenValue::Ident { reserved: true } => out.push_str(" = reserved"),
                TokenValue::Int { value: Some(value) } => {
                    out.push_str(&format!(" = {value}"));
                }
                TokenValue::Int { value: None } => out.push_str(" = overflow"),
                TokenValue::Float { value } => out.push_str(&format!(" = {value:?}")),
                TokenValue::String(value) => {
                    out.push_str(&format!(" = \"{}\"", escape_dump(value)));
                }
                TokenValue::Color { rgba: [r, g, b, a] } => {
                    out.push_str(&format!(" = #{r:02x}{g:02x}{b:02x}{a:02x}"));
                }
                TokenValue::Malformed => out.push_str(" = malformed"),
            }
            out.push('\n');
        }
        out
    }
}

/// Escape text for the dump so that every token stays on one line:
/// backslash, quote and the usual control characters in the Rust style,
/// other control characters and non-characters as `\u{...}`.
fn escape_dump(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() || (c.is_whitespace() && c != ' ') => {
                out.push_str(&format!("\\u{{{:x}}}", u32::from(c)));
            }
            c => out.push(c),
        }
    }
    out
}
