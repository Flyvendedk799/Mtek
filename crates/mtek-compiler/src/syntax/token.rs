//! Tokens, token values and the trivia side table (`spec/language.md`
//! section 2, `spec/grammar.ebnf` section 1).
//!
//! [`TokenKind`] is a plain `Copy` enum so that the parser can compare and
//! match it cheaply; everything a token carries beyond its kind (the decoded
//! string, the parsed integer, the `reserved` flag of an identifier) lives in
//! [`TokenValue`]. The text of a token is never copied: it is the slice of the
//! source named by [`Token::span`] (see [`Token::text`]).

use std::fmt;

use crate::source::Span;

/// What a token is.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum TokenKind {
    /// An identifier. Words reserved for future use (`spec/language.md` 2.3)
    /// are identifiers too; they carry `reserved: true` in their
    /// [`TokenValue::Ident`] so that the parser and resolver can report
    /// `E0013` where the word is used as a name.
    Ident,
    /// The single identifier `_`. It is a token kind of its own so that the
    /// resolver can report `E0012` wherever a name is declared.
    Underscore,
    /// An integer literal (`0`, `42`).
    Int,
    /// A float literal (`1.0`, `2.5e-3`).
    Float,
    /// A string literal (`"text"`).
    String,
    /// A color literal (`#6b5cff`, `#6b5cffcc`).
    Color,

    // Keywords (`spec/language.md` 2.2): each is a kind of its own.
    KwBind,
    KwBreak,
    KwConst,
    KwContinue,
    KwCpu,
    KwElse,
    KwEntity,
    KwExport,
    KwFalse,
    KwFn,
    KwFor,
    KwIf,
    KwImport,
    KwIn,
    KwLet,
    KwMaterial,
    KwOn,
    KwParam,
    KwPrefab,
    KwReturn,
    KwScene,
    KwSelf,
    KwState,
    KwStruct,
    KwTrue,
    KwVar,

    // Punctuation and operators (`spec/language.md` 2.6).
    LBrace,
    RBrace,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Lt,
    Gt,
    Comma,
    Semi,
    Colon,
    Dot,
    /// `..`
    DotDot,
    /// `->`
    Arrow,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Bang,
    /// `=`
    Eq,
    /// `==`
    EqEq,
    /// `!=`
    BangEq,
    /// `<=`
    Le,
    /// `>=`
    Ge,
    /// `&&`
    AndAnd,
    /// `||`
    OrOr,
    /// `+=`
    PlusEq,
    /// `-=`
    MinusEq,
    /// `*=`
    StarEq,
    /// `/=`
    SlashEq,

    // Bitwise operators. They are not part of v0.1; the lexer produces them
    // only so that the parser can reject them with `E1901` instead of a
    // confusing syntax error.
    /// `&`
    Amp,
    /// `|`
    Pipe,
    /// `^`
    Caret,
    /// `~`
    Tilde,
    /// `<<`
    Shl,
    /// `>>`
    Shr,

    /// End of input. Every token stream ends with exactly one `Eof`, an empty
    /// token at the end of the text.
    Eof,
}

/// The keywords of `spec/language.md` 2.2, with the kind each one lexes to.
pub const KEYWORDS: &[(&str, TokenKind)] = &[
    ("bind", TokenKind::KwBind),
    ("break", TokenKind::KwBreak),
    ("const", TokenKind::KwConst),
    ("continue", TokenKind::KwContinue),
    ("cpu", TokenKind::KwCpu),
    ("else", TokenKind::KwElse),
    ("entity", TokenKind::KwEntity),
    ("export", TokenKind::KwExport),
    ("false", TokenKind::KwFalse),
    ("fn", TokenKind::KwFn),
    ("for", TokenKind::KwFor),
    ("if", TokenKind::KwIf),
    ("import", TokenKind::KwImport),
    ("in", TokenKind::KwIn),
    ("let", TokenKind::KwLet),
    ("material", TokenKind::KwMaterial),
    ("on", TokenKind::KwOn),
    ("param", TokenKind::KwParam),
    ("prefab", TokenKind::KwPrefab),
    ("return", TokenKind::KwReturn),
    ("scene", TokenKind::KwScene),
    ("self", TokenKind::KwSelf),
    ("state", TokenKind::KwState),
    ("struct", TokenKind::KwStruct),
    ("true", TokenKind::KwTrue),
    ("var", TokenKind::KwVar),
];

/// The words reserved for future use (`spec/language.md` 2.3). They lex as
/// identifiers flagged `reserved`; using one as a name is `E0013`.
pub const RESERVED_WORDS: &[&str] = &[
    "as",
    "async",
    "await",
    "enum",
    "extern",
    "impl",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "priv",
    "pub",
    "static",
    "super",
    "trait",
    "type",
    "unsafe",
    "use",
    "where",
    "while",
    "yield",
    "compute",
    "vertex",
    "storage",
    "uniform",
    "workgroup",
    "system",
    "query",
    "component",
];

/// The spelling of every punctuation and operator kind. The lexer decides
/// between kinds by lookahead (longest match); this table only names the
/// spelling of each kind for [`TokenKind::fixed_text`].
pub const PUNCTUATION: &[(&str, TokenKind)] = &[
    ("{", TokenKind::LBrace),
    ("}", TokenKind::RBrace),
    ("(", TokenKind::LParen),
    (")", TokenKind::RParen),
    ("[", TokenKind::LBracket),
    ("]", TokenKind::RBracket),
    ("<", TokenKind::Lt),
    (">", TokenKind::Gt),
    (",", TokenKind::Comma),
    (";", TokenKind::Semi),
    (":", TokenKind::Colon),
    (".", TokenKind::Dot),
    ("..", TokenKind::DotDot),
    ("->", TokenKind::Arrow),
    ("+", TokenKind::Plus),
    ("-", TokenKind::Minus),
    ("*", TokenKind::Star),
    ("/", TokenKind::Slash),
    ("%", TokenKind::Percent),
    ("!", TokenKind::Bang),
    ("=", TokenKind::Eq),
    ("==", TokenKind::EqEq),
    ("!=", TokenKind::BangEq),
    ("<=", TokenKind::Le),
    (">=", TokenKind::Ge),
    ("&&", TokenKind::AndAnd),
    ("||", TokenKind::OrOr),
    ("+=", TokenKind::PlusEq),
    ("-=", TokenKind::MinusEq),
    ("*=", TokenKind::StarEq),
    ("/=", TokenKind::SlashEq),
    ("&", TokenKind::Amp),
    ("|", TokenKind::Pipe),
    ("^", TokenKind::Caret),
    ("~", TokenKind::Tilde),
    ("<<", TokenKind::Shl),
    (">>", TokenKind::Shr),
];

/// The keyword kind of `word`, or `None` if it is not a keyword.
#[must_use]
pub fn keyword_kind(word: &str) -> Option<TokenKind> {
    KEYWORDS
        .iter()
        .find(|(text, _)| *text == word)
        .map(|&(_, kind)| kind)
}

/// True if `word` is reserved for future use (`spec/language.md` 2.3).
#[must_use]
pub fn is_reserved_word(word: &str) -> bool {
    RESERVED_WORDS.contains(&word)
}

impl TokenKind {
    /// True for the keyword kinds of `spec/language.md` 2.2.
    #[must_use]
    pub fn is_keyword(self) -> bool {
        KEYWORDS.iter().any(|&(_, kind)| kind == self)
    }

    /// The fixed spelling of a keyword, punctuation or operator kind;
    /// `None` for identifiers, literals and `Eof`, whose text varies.
    #[must_use]
    pub fn fixed_text(self) -> Option<&'static str> {
        KEYWORDS
            .iter()
            .chain(PUNCTUATION)
            .find(|&&(_, kind)| kind == self)
            .map(|&(text, _)| text)
    }

    /// A short phrase for messages: `` `fn` ``, `` `;` ``, `identifier`,
    /// `integer literal`, `end of file`, ...
    #[must_use]
    pub fn describe(self) -> &'static str {
        match self {
            TokenKind::Ident => "identifier",
            TokenKind::Underscore => "`_`",
            TokenKind::Int => "integer literal",
            TokenKind::Float => "float literal",
            TokenKind::String => "string literal",
            TokenKind::Color => "color literal",
            TokenKind::Eof => "end of file",
            // Fixed-text kinds are described by their spelling in backticks;
            // the quoted form is stored here to stay `'static`.
            TokenKind::KwBind => "`bind`",
            TokenKind::KwBreak => "`break`",
            TokenKind::KwConst => "`const`",
            TokenKind::KwContinue => "`continue`",
            TokenKind::KwCpu => "`cpu`",
            TokenKind::KwElse => "`else`",
            TokenKind::KwEntity => "`entity`",
            TokenKind::KwExport => "`export`",
            TokenKind::KwFalse => "`false`",
            TokenKind::KwFn => "`fn`",
            TokenKind::KwFor => "`for`",
            TokenKind::KwIf => "`if`",
            TokenKind::KwImport => "`import`",
            TokenKind::KwIn => "`in`",
            TokenKind::KwLet => "`let`",
            TokenKind::KwMaterial => "`material`",
            TokenKind::KwOn => "`on`",
            TokenKind::KwParam => "`param`",
            TokenKind::KwPrefab => "`prefab`",
            TokenKind::KwReturn => "`return`",
            TokenKind::KwScene => "`scene`",
            TokenKind::KwSelf => "`self`",
            TokenKind::KwState => "`state`",
            TokenKind::KwStruct => "`struct`",
            TokenKind::KwTrue => "`true`",
            TokenKind::KwVar => "`var`",
            TokenKind::LBrace => "`{`",
            TokenKind::RBrace => "`}`",
            TokenKind::LParen => "`(`",
            TokenKind::RParen => "`)`",
            TokenKind::LBracket => "`[`",
            TokenKind::RBracket => "`]`",
            TokenKind::Lt => "`<`",
            TokenKind::Gt => "`>`",
            TokenKind::Comma => "`,`",
            TokenKind::Semi => "`;`",
            TokenKind::Colon => "`:`",
            TokenKind::Dot => "`.`",
            TokenKind::DotDot => "`..`",
            TokenKind::Arrow => "`->`",
            TokenKind::Plus => "`+`",
            TokenKind::Minus => "`-`",
            TokenKind::Star => "`*`",
            TokenKind::Slash => "`/`",
            TokenKind::Percent => "`%`",
            TokenKind::Bang => "`!`",
            TokenKind::Eq => "`=`",
            TokenKind::EqEq => "`==`",
            TokenKind::BangEq => "`!=`",
            TokenKind::Le => "`<=`",
            TokenKind::Ge => "`>=`",
            TokenKind::AndAnd => "`&&`",
            TokenKind::OrOr => "`||`",
            TokenKind::PlusEq => "`+=`",
            TokenKind::MinusEq => "`-=`",
            TokenKind::StarEq => "`*=`",
            TokenKind::SlashEq => "`/=`",
            TokenKind::Amp => "`&`",
            TokenKind::Pipe => "`|`",
            TokenKind::Caret => "`^`",
            TokenKind::Tilde => "`~`",
            TokenKind::Shl => "`<<`",
            TokenKind::Shr => "`>>`",
        }
    }

    /// True for the bitwise operator kinds, which v0.1 rejects with `E1901`.
    #[must_use]
    pub fn is_bitwise(self) -> bool {
        matches!(
            self,
            TokenKind::Amp
                | TokenKind::Pipe
                | TokenKind::Caret
                | TokenKind::Tilde
                | TokenKind::Shl
                | TokenKind::Shr
        )
    }
}

impl fmt::Display for TokenKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.describe())
    }
}

/// What a token carries beyond its kind.
///
/// A literal for which the lexer already reported a diagnostic carries
/// [`TokenValue::Malformed`]: the parser should treat it as an erroneous
/// literal and must not report anything more about it.
#[derive(Clone, PartialEq, Debug, Default)]
pub enum TokenValue {
    /// Keywords, punctuation, `_`, `Eof`.
    #[default]
    None,
    /// An identifier. `reserved` is true for the words of
    /// [`RESERVED_WORDS`].
    Ident { reserved: bool },
    /// An integer literal. The text is the token's source slice; `value` is
    /// the parsed number, or `None` when it exceeds `u64::MAX` (range checks
    /// against the target type happen in the type checker).
    Int { value: Option<u64> },
    /// A float literal. `value` is the text parsed as `f64` and may be
    /// infinite for huge exponents; range checks against `f32` happen in the
    /// type checker.
    Float { value: f64 },
    /// A string literal with its escapes decoded.
    String(String),
    /// A color literal as `[r, g, b, a]` bytes; the alpha of `#RRGGBB` is 255.
    /// The values are still sRGB-encoded (`spec/language.md` 5.4).
    Color { rgba: [u8; 4] },
    /// A literal with a lexical error; see the type documentation.
    Malformed,
}

/// One token: its kind, where it is and what it carries.
#[derive(Clone, PartialEq, Debug)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
    pub value: TokenValue,
}

impl Token {
    /// The source text of the token, or `""` if the span does not fit
    /// `source` (a token is only meaningful with the text it was lexed from).
    #[must_use]
    pub fn text<'a>(&self, source: &'a str) -> &'a str {
        source.get(self.span.range()).unwrap_or("")
    }

    /// True if this is an identifier that is a word reserved for future use.
    #[must_use]
    pub fn is_reserved_word(&self) -> bool {
        matches!(self.value, TokenValue::Ident { reserved: true })
    }

    /// True if the lexer reported a diagnostic for this literal.
    #[must_use]
    pub fn is_malformed(&self) -> bool {
        self.value == TokenValue::Malformed
    }
}

/// The kinds of comments kept as trivia.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum TriviaKind {
    /// `// ...`
    LineComment,
    /// `/// ...` (a documentation comment, `spec/language.md` 1.5)
    DocComment,
    /// `/* ... */`, possibly nested.
    BlockComment,
}

/// One comment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TriviaItem {
    pub kind: TriviaKind,
    /// The whole comment: from its first `/` to the last byte before the line
    /// terminator (line comments) or through the closing `*/` (block
    /// comments; to the end of the text if unterminated).
    pub span: Span,
    /// Index into the token list of the token that follows the comment. A
    /// comment after the last real token belongs to the `Eof` token.
    pub next_token: usize,
}

/// All comments of a file, in source order, each keyed by the index of the
/// token that follows it. The parser ignores trivia; the formatter and the
/// documentation extraction read it.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Trivia {
    items: Vec<TriviaItem>,
}

impl Trivia {
    pub(crate) fn push(&mut self, item: TriviaItem) {
        self.items.push(item);
    }

    /// Every comment, in source order.
    #[must_use]
    pub fn items(&self) -> &[TriviaItem] {
        &self.items
    }

    /// Number of comments.
    #[must_use]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// True if the file has no comments.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The comments that sit between token `token_index - 1` and token
    /// `token_index`, in source order.
    #[must_use]
    pub fn before(&self, token_index: usize) -> &[TriviaItem] {
        let start = self
            .items
            .partition_point(|item| item.next_token < token_index);
        let end = self
            .items
            .partition_point(|item| item.next_token <= token_index);
        self.items.get(start..end).unwrap_or(&[])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::FileId;

    #[test]
    fn keyword_table_round_trips() {
        for &(text, kind) in KEYWORDS {
            assert_eq!(keyword_kind(text), Some(kind), "{text}");
            assert!(kind.is_keyword(), "{text}");
            assert_eq!(kind.fixed_text(), Some(text));
            assert_eq!(kind.describe(), format!("`{text}`"));
        }
        assert_eq!(keyword_kind("update"), None);
        assert_eq!(keyword_kind("while"), None);
        assert_eq!(keyword_kind("Fn"), None);
    }

    #[test]
    fn keywords_and_reserved_words_are_disjoint_and_sorted_uniquely() {
        for word in RESERVED_WORDS {
            assert!(keyword_kind(word).is_none(), "{word} is both");
        }
        for (i, word) in RESERVED_WORDS.iter().enumerate() {
            assert!(!RESERVED_WORDS[..i].contains(word), "duplicate {word}");
        }
    }

    #[test]
    fn contextual_names_are_not_reserved() {
        for word in ["camera", "update", "fixed_update", "fragment", "from"] {
            assert!(!is_reserved_word(word), "{word}");
            assert!(keyword_kind(word).is_none(), "{word}");
        }
    }

    #[test]
    fn punctuation_spellings_round_trip_with_describe() {
        for &(text, kind) in PUNCTUATION {
            assert_eq!(kind.fixed_text(), Some(text));
            assert_eq!(kind.describe(), format!("`{text}`"));
            assert!(!kind.is_keyword());
        }
        assert!(TokenKind::Shl.is_bitwise());
        assert!(!TokenKind::AndAnd.is_bitwise());
    }

    #[test]
    fn variable_kinds_have_no_fixed_text() {
        for kind in [
            TokenKind::Ident,
            TokenKind::Underscore,
            TokenKind::Int,
            TokenKind::Float,
            TokenKind::String,
            TokenKind::Color,
            TokenKind::Eof,
        ] {
            assert_eq!(kind.fixed_text(), None);
        }
    }

    #[test]
    fn token_text_is_a_checked_slice() {
        let token = Token {
            kind: TokenKind::Ident,
            span: Span::new(FileId(0), 4, 7),
            value: TokenValue::Ident { reserved: false },
        };
        assert_eq!(token.text("let abc = 1;"), "abc");
        assert_eq!(token.text("ab"), "");
        assert_eq!(token.text("é é é"), "");
    }

    #[test]
    fn trivia_before_finds_the_comments_of_one_token() {
        let item = |next_token| TriviaItem {
            kind: TriviaKind::LineComment,
            span: Span::new(FileId(0), 0, 1),
            next_token,
        };
        let mut trivia = Trivia::default();
        for next in [0, 0, 2, 2, 2, 5] {
            trivia.push(item(next));
        }
        assert_eq!(trivia.len(), 6);
        assert_eq!(trivia.before(0).len(), 2);
        assert_eq!(trivia.before(1).len(), 0);
        assert_eq!(trivia.before(2).len(), 3);
        assert_eq!(trivia.before(5).len(), 1);
        assert_eq!(trivia.before(99).len(), 0);
        assert!(!trivia.is_empty());
        assert!(Trivia::default().before(0).is_empty());
    }
}
