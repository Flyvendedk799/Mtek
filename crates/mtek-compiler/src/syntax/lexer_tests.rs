//! Unit tests of the lexer: one group per token class and per lexical
//! diagnostic of `spec/diagnostics.md` section 5.0.

use super::lexer::{FloatFix, Lexed, lex, lex_str};
use super::token::{KEYWORDS, RESERVED_WORDS, Token, TokenKind, TokenValue, TriviaKind};
use crate::diagnostics::{Code, Diagnostic, Severity};
use crate::source::{FileId, ProjectPath, SourceMap, Span};

const FILE: FileId = FileId(0);

fn lex_src(src: &str) -> Lexed {
    lex_str(FILE, src)
}

/// The token kinds without the final `Eof`.
fn kinds(src: &str) -> Vec<TokenKind> {
    let lexed = lex_src(src);
    let mut kinds: Vec<TokenKind> = lexed.tokens.iter().map(|t| t.kind).collect();
    assert_eq!(kinds.pop(), Some(TokenKind::Eof), "{src:?}");
    kinds
}

/// The text of every token without the final `Eof`.
fn texts(src: &str) -> Vec<String> {
    lex_src(src)
        .tokens
        .iter()
        .filter(|t| t.kind != TokenKind::Eof)
        .map(|t| t.text(src).to_owned())
        .collect()
}

/// Code and primary-span text of every diagnostic.
fn problems<'a>(src: &'a str, lexed: &Lexed) -> Vec<(Code, &'a str)> {
    lexed
        .diagnostics
        .iter()
        .map(|d| {
            let span = d.primary.as_ref().map(|label| label.span);
            (d.code, span.and_then(|s| src.get(s.range())).unwrap_or("?"))
        })
        .collect()
}

/// The only diagnostic of `src`; fails if there is not exactly one.
fn single(src: &str) -> Diagnostic {
    let lexed = lex_src(src);
    assert_eq!(
        lexed.diagnostics.len(),
        1,
        "{src:?}: {:?}",
        lexed.diagnostics
    );
    lexed.diagnostics[0].clone()
}

/// Lex `src`, which must produce no diagnostics.
fn clean(src: &str) -> Lexed {
    let lexed = lex_src(src);
    assert!(
        lexed.diagnostics.is_empty(),
        "{src:?}: {:?}",
        lexed.diagnostics
    );
    lexed
}

/// The only token of `src` (besides `Eof`).
fn only_token(src: &str) -> Token {
    let lexed = lex_src(src);
    assert_eq!(lexed.tokens.len(), 2, "{src:?}: {:?}", lexed.tokens);
    lexed.tokens[0].clone()
}

fn len(src: &str) -> u32 {
    u32::try_from(src.len()).unwrap()
}

// ----- structure ---------------------------------------------------------------

#[test]
fn empty_and_blank_input_is_just_eof() {
    for src in ["", " ", "\t\n  \r\n\n"] {
        let lexed = clean(src);
        assert_eq!(lexed.tokens.len(), 1, "{src:?}");
        let eof = &lexed.tokens[0];
        assert_eq!(eof.kind, TokenKind::Eof);
        assert_eq!(eof.span, Span::at(FILE, len(src)));
        assert!(lexed.trivia.is_empty());
    }
}

#[test]
fn eof_is_unique_and_last() {
    let lexed = lex_src("let x = 1; // done");
    let eofs = lexed
        .tokens
        .iter()
        .filter(|t| t.kind == TokenKind::Eof)
        .count();
    assert_eq!(eofs, 1);
    assert_eq!(lexed.tokens.last().map(|t| t.kind), Some(TokenKind::Eof));
}

#[test]
fn leading_byte_order_mark_is_skipped_and_offsets_count_it() {
    let lexed = clean("\u{feff}fn");
    assert_eq!(lexed.tokens[0].kind, TokenKind::KwFn);
    assert_eq!(lexed.tokens[0].span, Span::new(FILE, 3, 5));
    assert_eq!(lexed.tokens[1].span, Span::at(FILE, 5));
    assert_eq!(kinds("\u{feff}"), Vec::<TokenKind>::new());
}

#[test]
fn a_misplaced_byte_order_mark_is_e0002() {
    let src = "fn \u{feff}x";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0002, "\u{feff}")]);
    assert_eq!(texts(src), ["fn", "x"]);
    let src = "\u{feff}\u{feff}";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0002, "\u{feff}")]);
}

#[test]
fn lexing_a_source_file_uses_its_text_and_file_id() {
    let mut map = SourceMap::new();
    map.add(ProjectPath::new("src/other.mtek").unwrap(), b"fn")
        .unwrap();
    let id = map
        .add(
            ProjectPath::new("src/main.mtek").unwrap(),
            b"\xEF\xBB\xBFlet x = #6b5cff;",
        )
        .unwrap();
    let file = map.get(id).unwrap();
    let lexed = lex(file);
    assert!(lexed.diagnostics.is_empty());
    assert_eq!(lexed.tokens[0].span, Span::new(id, 3, 6));
    assert!(lexed.tokens.iter().all(|t| t.span.file == id));
    assert_eq!(lexed.tokens[0].span.start, file.content_start());
}

// ----- identifiers and keywords ---------------------------------------------------

#[test]
fn every_keyword_lexes_to_its_own_kind() {
    for &(text, kind) in KEYWORDS {
        let token = only_token(text);
        assert_eq!(token.kind, kind, "{text}");
        assert_eq!(token.value, TokenValue::None);
        assert_eq!(token.span, Span::new(FILE, 0, len(text)));
    }
}

#[test]
fn keywords_are_case_sensitive_and_prefix_safe() {
    for src in ["Fn", "LET", "selfish", "fn_", "iff", "in2", "True", "_fn"] {
        let token = only_token(src);
        assert_eq!(token.kind, TokenKind::Ident, "{src}");
        assert_eq!(token.value, TokenValue::Ident { reserved: false });
    }
}

#[test]
fn reserved_words_are_flagged_identifiers_without_diagnostics() {
    for &word in RESERVED_WORDS {
        let lexed = clean(word);
        let token = &lexed.tokens[0];
        assert_eq!(token.kind, TokenKind::Ident, "{word}");
        assert_eq!(token.value, TokenValue::Ident { reserved: true }, "{word}");
        assert!(token.is_reserved_word());
    }
    assert!(!only_token("whilex").is_reserved_word());
}

#[test]
fn contextual_names_are_plain_identifiers() {
    for word in [
        "camera",
        "update",
        "fixed_update",
        "fragment",
        "from",
        "key_down",
    ] {
        let token = only_token(word);
        assert_eq!(token.kind, TokenKind::Ident);
        assert_eq!(token.value, TokenValue::Ident { reserved: false }, "{word}");
    }
}

#[test]
fn underscore_alone_is_its_own_kind() {
    assert_eq!(kinds("_"), [TokenKind::Underscore]);
    assert_eq!(
        kinds("_ _x x_"),
        [TokenKind::Underscore, TokenKind::Ident, TokenKind::Ident]
    );
    assert_eq!(kinds("_1"), [TokenKind::Ident]);
    clean("_ _x _1 a_b");
}

#[test]
fn double_underscore_prefix_is_e0011_but_still_one_identifier() {
    for src in ["__x", "__", "___", "__x__", "__1"] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0011, src)], "{src}");
        assert_eq!(lexed.tokens[0].kind, TokenKind::Ident);
        assert_eq!(lexed.tokens[0].value, TokenValue::Ident { reserved: false });
        assert!(lexed.diagnostics[0].message.contains(src));
    }
    clean("a__b _a__");
}

#[test]
fn non_ascii_identifier_run_is_one_token_with_e0010() {
    for src in ["é", "naïve", "日本語", "x1é2", "é1", "a_é_b", "_é"] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0010, src)], "{src}");
        assert_eq!(lexed.tokens.len(), 2, "{src}");
        assert_eq!(lexed.tokens[0].kind, TokenKind::Ident);
        assert_eq!(lexed.tokens[0].text(src), src);
    }
    let diagnostic = single("naïve");
    assert!(diagnostic.message.contains("naïve"));
    assert_eq!(
        diagnostic.notes,
        ["Unicode identifiers are not supported in v0.1"]
    );
}

#[test]
fn non_ascii_identifier_error_recovers_with_the_next_token() {
    let src = "let café = 1;";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0010, "café")]);
    assert_eq!(texts(src), ["let", "café", "=", "1", ";"]);
}

// ----- punctuation ----------------------------------------------------------------

#[test]
fn every_punctuation_and_operator_lexes_alone() {
    use TokenKind as K;
    #[rustfmt::skip]
    let table = [
        ("{", K::LBrace), ("}", K::RBrace), ("(", K::LParen), (")", K::RParen),
        ("[", K::LBracket), ("]", K::RBracket), ("<", K::Lt), (">", K::Gt),
        (",", K::Comma), (";", K::Semi), (":", K::Colon), (".", K::Dot),
        ("..", K::DotDot), ("->", K::Arrow), ("+", K::Plus), ("-", K::Minus),
        ("*", K::Star), ("/", K::Slash), ("%", K::Percent), ("!", K::Bang),
        ("=", K::Eq), ("==", K::EqEq), ("!=", K::BangEq), ("<=", K::Le),
        (">=", K::Ge), ("&&", K::AndAnd), ("||", K::OrOr), ("+=", K::PlusEq),
        ("-=", K::MinusEq), ("*=", K::StarEq), ("/=", K::SlashEq),
        ("&", K::Amp), ("|", K::Pipe), ("^", K::Caret), ("~", K::Tilde),
        ("<<", K::Shl), (">>", K::Shr),
    ];
    for (text, kind) in table {
        let lexed = clean(text);
        assert_eq!(lexed.tokens.len(), 2, "{text}");
        assert_eq!(lexed.tokens[0].kind, kind, "{text}");
        assert_eq!(kind.fixed_text(), Some(text));
    }
}

#[test]
fn longest_match_wins_for_operators() {
    use TokenKind as K;
    let cases: [(&str, &[TokenKind]); 14] = [
        ("<<=", &[K::Shl, K::Eq]),
        (">>=", &[K::Shr, K::Eq]),
        ("<=>", &[K::Le, K::Gt]),
        ("&&&", &[K::AndAnd, K::Amp]),
        ("|||", &[K::OrOr, K::Pipe]),
        ("===", &[K::EqEq, K::Eq]),
        ("!==", &[K::BangEq, K::Eq]),
        ("=>", &[K::Eq, K::Gt]),
        ("->>", &[K::Arrow, K::Gt]),
        ("-->", &[K::Minus, K::Arrow]),
        ("+++", &[K::Plus, K::Plus, K::Plus]),
        ("%=", &[K::Percent, K::Eq]),
        ("...", &[K::DotDot, K::Dot]),
        ("a<-b", &[K::Ident, K::Lt, K::Minus, K::Ident]),
    ];
    for (src, expected) in cases {
        assert_eq!(kinds(src), expected, "{src}");
    }
}

#[test]
fn generic_brackets_lex_as_single_angle_tokens() {
    use TokenKind as K;
    assert_eq!(
        kinds("a: array<array<f32, 3>, 4>"),
        [
            K::Ident,
            K::Colon,
            K::Ident,
            K::Lt,
            K::Ident,
            K::Lt,
            K::Ident,
            K::Comma,
            K::Int,
            K::Gt,
            K::Comma,
            K::Int,
            K::Gt
        ]
    );
}

#[test]
fn slash_is_division_unless_it_starts_a_comment() {
    use TokenKind as K;
    assert_eq!(kinds("a / b"), [K::Ident, K::Slash, K::Ident]);
    assert_eq!(kinds("a /= b"), [K::Ident, K::SlashEq, K::Ident]);
    assert_eq!(kinds("a /b"), [K::Ident, K::Slash, K::Ident]);
    assert_eq!(kinds("*/"), [K::Star, K::Slash]);
}

// ----- integers and floats ----------------------------------------------------------

#[test]
fn integer_literals_keep_text_and_u64_value() {
    for (src, value) in [
        ("0", Some(0)),
        ("7", Some(7)),
        ("42", Some(42)),
        ("1000", Some(1000)),
        ("18446744073709551615", Some(u64::MAX)),
        ("18446744073709551616", None),
        ("99999999999999999999999999", None),
    ] {
        let lexed = clean(src);
        assert_eq!(lexed.tokens[0].kind, TokenKind::Int, "{src}");
        assert_eq!(lexed.tokens[0].value, TokenValue::Int { value }, "{src}");
        assert_eq!(lexed.tokens[0].text(src), src);
    }
}

#[test]
fn float_literals_keep_text_and_f64_value() {
    for (src, value) in [
        ("0.0", 0.0),
        ("1.0", 1.0),
        ("0.5", 0.5),
        ("2.5e-3", 2.5e-3),
        ("1.5E+10", 1.5e10),
        ("10.25e3", 10250.0),
        ("0.1", 0.1),
        ("3.141592653589793", std::f64::consts::PI),
    ] {
        let lexed = clean(src);
        assert_eq!(lexed.tokens[0].kind, TokenKind::Float, "{src}");
        assert_eq!(lexed.tokens[0].value, TokenValue::Float { value }, "{src}");
        assert_eq!(lexed.tokens[0].text(src), src);
    }
}

#[test]
fn huge_float_exponents_are_not_a_lexical_error() {
    let lexed = clean("1.0e999");
    assert_eq!(
        lexed.tokens[0].value,
        TokenValue::Float {
            value: f64::INFINITY
        }
    );
}

#[test]
fn digits_followed_by_dot_dot_are_an_integer_then_the_range_operator() {
    use TokenKind as K;
    assert_eq!(kinds("0..n"), [K::Int, K::DotDot, K::Ident]);
    assert_eq!(kinds("0..10"), [K::Int, K::DotDot, K::Int]);
    assert_eq!(kinds("1..2.5"), [K::Int, K::DotDot, K::Float]);
    assert_eq!(kinds("a..b"), [K::Ident, K::DotDot, K::Ident]);
    let lexed = clean("0..n");
    assert_eq!(texts("0..n"), ["0", "..", "n"]);
    assert_eq!(lexed.tokens[0].value, TokenValue::Int { value: Some(0) });
    clean("1..");
}

#[test]
fn a_point_after_digits_before_a_name_is_still_a_malformed_float() {
    // `1.x` is `1.` (E0022) followed by `x`; the later validated-edit check
    // rejects the suggested `1.0x`.
    let src = "1.x";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0022, "1.")]);
    assert_eq!(texts(src), ["1.", "x"]);
}

#[test]
fn field_access_on_names_is_not_a_number() {
    use TokenKind as K;
    assert_eq!(
        kinds("a.b.c"),
        [K::Ident, K::Dot, K::Ident, K::Dot, K::Ident]
    );
    assert_eq!(
        kinds("m[0].x"),
        [K::Ident, K::LBracket, K::Int, K::RBracket, K::Dot, K::Ident]
    );
    assert_eq!(kinds("1.5.x"), [K::Float, K::Dot, K::Ident]);
}

#[test]
fn leading_zeros_are_e0020_and_one_token() {
    for (src, kind) in [
        ("007", TokenKind::Int),
        ("00", TokenKind::Int),
        ("01", TokenKind::Int),
        ("007.5", TokenKind::Float),
        ("00.5e3", TokenKind::Float),
        ("01.", TokenKind::Float),
        ("01e3", TokenKind::Float),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0020, src)], "{src}");
        assert_eq!(lexed.tokens.len(), 2, "{src}");
        assert_eq!(lexed.tokens[0].kind, kind, "{src}");
        assert!(lexed.tokens[0].is_malformed(), "{src}");
        assert!(
            lexed.float_fixes.is_empty(),
            "{src}: E0020 takes precedence over E0022"
        );
    }
    let diagnostic = single("007");
    assert!(diagnostic.message.contains("`007`"));
    assert_eq!(diagnostic.notes, ["help: write `7`"]);
    assert_eq!(single("00").notes, ["help: write `0`"]);
    assert_eq!(single("007.5").notes, ["help: write `7.5`"]);
    assert!(
        clean("0 0.5 10 100 0.0")
            .tokens
            .iter()
            .all(|t| !t.is_malformed())
    );
}

#[test]
fn unsupported_numeric_forms_are_one_e0021_token() {
    for (src, needle) in [
        ("0x1F", "Hexadecimal"),
        ("0XFF", "Hexadecimal"),
        ("0b101", "Binary"),
        ("0B1", "Binary"),
        ("0o17", "Octal"),
        ("1_000", "digit separators"),
        ("1_000.5", "digit separators"),
        ("0x1.8", "Hexadecimal"),
        ("10u32", "suffix `u32`"),
        ("1f", "suffix `f`"),
        ("1.5f", "suffix `f`"),
        ("1.5e", "suffix `e`"),
        ("1e3x", "suffix `x`"),
        ("1else", "suffix `else`"),
        ("1é", "suffix `é`"),
        ("00x1", "suffix `x1`"),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0021, src)], "{src}");
        assert_eq!(lexed.tokens.len(), 2, "{src}: one token");
        assert_eq!(lexed.tokens[0].kind, TokenKind::Int, "{src}");
        assert!(lexed.tokens[0].is_malformed());
        assert!(
            lexed.diagnostics[0].message.contains(needle),
            "{src}: {}",
            lexed.diagnostics[0].message
        );
    }
}

#[test]
fn an_unsupported_numeric_form_does_not_swallow_the_next_token() {
    let src = "0x1F + 1";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0021, "0x1F")]);
    assert_eq!(texts(src), ["0x1F", "+", "1"]);
    assert_eq!(texts("f(1_0, 2)"), ["f", "(", "1_0", ",", "2", ")"]);
}

#[test]
fn malformed_floats_are_e0022_with_the_recorded_replacement() {
    for (src, replacement) in [
        ("1.", "1.0"),
        (".5", "0.5"),
        ("1e3", "1.0e3"),
        ("1E3", "1.0E3"),
        ("1e-3", "1.0e-3"),
        ("1.e3", "1.0e3"),
        (".5e-3", "0.5e-3"),
        ("12.", "12.0"),
        (".25", "0.25"),
        ("0.", "0.0"),
        ("0e5", "0.0e5"),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0022, src)], "{src}");
        assert_eq!(lexed.tokens.len(), 2, "{src}");
        assert_eq!(lexed.tokens[0].kind, TokenKind::Float);
        assert!(lexed.tokens[0].is_malformed());
        assert_eq!(
            lexed.float_fixes,
            vec![FloatFix {
                span: Span::new(FILE, 0, len(src)),
                replacement: replacement.to_owned(),
            }],
            "{src}"
        );
        assert_eq!(
            lexed.diagnostics[0].notes,
            [format!("help: write `{replacement}`")]
        );
        // The lexer records the edit but must not attach it: only the driver
        // may, after re-checking the file with the edit applied.
        assert!(lexed.diagnostics[0].edits.is_empty());
        // The replacement is itself a clean float literal.
        let fixed = clean(replacement);
        assert_eq!(fixed.tokens[0].kind, TokenKind::Float, "{replacement}");
        assert!(!fixed.tokens[0].is_malformed());
    }
}

#[test]
fn malformed_float_fixes_are_positioned_in_context() {
    let src = "let a = f(1., .5, 2e3);";
    let lexed = lex_src(src);
    assert_eq!(
        problems(src, &lexed),
        vec![
            (Code::E0022, "1."),
            (Code::E0022, ".5"),
            (Code::E0022, "2e3")
        ]
    );
    let replacements: Vec<&str> = lexed
        .float_fixes
        .iter()
        .map(|f| f.replacement.as_str())
        .collect();
    assert_eq!(replacements, ["1.0", "0.5", "2.0e3"]);
    for (fix, diagnostic) in lexed.float_fixes.iter().zip(&lexed.diagnostics) {
        assert_eq!(Some(fix.span), diagnostic.primary.as_ref().map(|l| l.span));
    }
}

// ----- strings ------------------------------------------------------------------------

#[test]
fn strings_decode_their_escapes() {
    for (src, value) in [
        (r#""""#, ""),
        (r#""hello""#, "hello"),
        (r#""a b""#, "a b"),
        (r#""\"""#, "\""),
        (r#""\\""#, "\\"),
        (r#""\n\t\r\0""#, "\n\t\r\0"),
        (r#""\u{41}""#, "A"),
        (r#""\u{1F600}""#, "\u{1F600}"),
        (r#""\u{000041}""#, "A"),
        (r#""\u{0}""#, "\0"),
        (r#""\u{10FFFF}""#, "\u{10FFFF}"),
        ("\"é日本\u{1F600}\"", "é日本\u{1F600}"),
        ("\"tab\there\"", "tab\there"),
        (r#""//not a comment""#, "//not a comment"),
        (r##""# not a color""##, "# not a color"),
    ] {
        let lexed = clean(src);
        assert_eq!(lexed.tokens.len(), 2, "{src}");
        assert_eq!(lexed.tokens[0].kind, TokenKind::String, "{src}");
        assert_eq!(
            lexed.tokens[0].value,
            TokenValue::String(value.to_owned()),
            "{src}"
        );
        assert_eq!(lexed.tokens[0].span, Span::new(FILE, 0, len(src)));
    }
}

#[test]
fn invalid_escapes_are_e0023_at_the_escape_and_the_string_continues() {
    for (src, bad) in [
        (r#""a\qb""#, r"\q"),
        (r#""\a""#, r"\a"),
        (r#""\x41""#, r"\x"),
        (r#""\u""#, r"\u"),
        (r#""\u41""#, r"\u"),
        (r#""\u{}""#, r"\u{}"),
        (r#""\u{1234567}""#, r"\u{1234567}"),
        (r#""\u{D800}""#, r"\u{D800}"),
        (r#""\u{110000}""#, r"\u{110000}"),
        (r#""\u{41""#, r"\u{41"),
        (r#""\u{4g}""#, r"\u{4"),
        ("\"\\é\"", "\\é"),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0023, bad)], "{src}");
        assert_eq!(
            lexed.tokens.len(),
            2,
            "{src}: the string still ends at its quote"
        );
        assert_eq!(lexed.tokens[0].kind, TokenKind::String);
        assert!(lexed.tokens[0].is_malformed());
        assert_eq!(lexed.tokens[0].span, Span::new(FILE, 0, len(src)), "{src}");
    }
}

#[test]
fn every_bad_escape_in_a_string_is_reported() {
    let src = r#""\q and \z and \u{110000}""#;
    let lexed = lex_src(src);
    assert_eq!(
        problems(src, &lexed),
        vec![
            (Code::E0023, r"\q"),
            (Code::E0023, r"\z"),
            (Code::E0023, r"\u{110000}")
        ]
    );
    assert!(lexed.diagnostics[0].message.contains(r"`\q`"));
    assert!(
        lexed.diagnostics[2]
            .message
            .contains("not a Unicode scalar value")
    );
    assert!(lexed.diagnostics[1].notes[0].contains("valid escapes"));
}

#[test]
fn an_invisible_character_after_a_backslash_is_shown_as_a_code_point() {
    let diagnostic = single("\"\\\u{202e}\"");
    assert_eq!(diagnostic.code, Code::E0023);
    assert!(
        diagnostic.message.contains("U+202E"),
        "{}",
        diagnostic.message
    );
    assert!(!diagnostic.message.contains('\u{202e}'));
}

#[test]
fn unterminated_strings_are_e0024_from_the_quote_to_the_end_of_the_line() {
    let src = "let s = \"abc\nlet t = 1;";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0024, "\"abc")]);
    let string = &lexed.tokens[3];
    assert_eq!(string.kind, TokenKind::String);
    assert!(string.is_malformed());
    // Lexing resumes on the next line.
    assert_eq!(texts(src)[4..], ["let", "t", "=", "1", ";"]);

    for src in ["\"abc", "\"", "\"abc\\", "\"abc\\\n", "\"a\r\n"] {
        let lexed = lex_src(src);
        let codes: Vec<Code> = lexed.diagnostics.iter().map(|d| d.code).collect();
        assert_eq!(codes, vec![Code::E0024], "{src:?}");
    }
}

#[test]
fn a_lone_carriage_return_in_a_string_ends_it_and_is_e0003() {
    let src = "\"ab\rcd\"";
    let lexed = lex_src(src);
    assert_eq!(
        problems(src, &lexed),
        vec![
            (Code::E0024, "\"ab"),
            (Code::E0003, "\r"),
            (Code::E0024, "\"")
        ]
    );
    assert_eq!(texts(src), ["\"ab", "cd", "\""]);
}

// ----- colors ---------------------------------------------------------------------------

#[test]
fn colors_decode_to_rgba_bytes() {
    for (src, rgba) in [
        ("#6b5cff", [0x6b, 0x5c, 0xff, 0xff]),
        ("#6B5CFF", [0x6b, 0x5c, 0xff, 0xff]),
        ("#000000", [0, 0, 0, 255]),
        ("#ffffff", [255, 255, 255, 255]),
        ("#6b5cffcc", [0x6b, 0x5c, 0xff, 0xcc]),
        ("#00000000", [0, 0, 0, 0]),
        ("#AbCdEf12", [0xab, 0xcd, 0xef, 0x12]),
    ] {
        let lexed = clean(src);
        assert_eq!(lexed.tokens[0].kind, TokenKind::Color, "{src}");
        assert_eq!(lexed.tokens[0].value, TokenValue::Color { rgba }, "{src}");
        assert_eq!(lexed.tokens[0].text(src), src);
    }
    assert_eq!(kinds("#6b5cff;"), [TokenKind::Color, TokenKind::Semi]);
    assert_eq!(
        kinds("(#6b5cff)"),
        [TokenKind::LParen, TokenKind::Color, TokenKind::RParen]
    );
}

#[test]
fn malformed_colors_are_e0025_as_one_token() {
    for (src, needle) in [
        ("#fff", "has 3 hexadecimal digits"),
        ("#ffff", "has 4 hexadecimal digits"),
        ("#12345", "has 5 hexadecimal digits"),
        ("#1234567", "has 7 hexadecimal digits"),
        ("#123456789", "has 9 hexadecimal digits"),
        ("#", "has no hexadecimal digits"),
        ("#12345g", "contains `g`"),
        ("#6b5cffzz", "contains `z`"),
        ("#xyz", "contains `x`"),
        ("#é", "contains `é`"),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0025, src)], "{src}");
        assert_eq!(lexed.tokens.len(), 2, "{src}");
        assert_eq!(lexed.tokens[0].kind, TokenKind::Color);
        assert!(lexed.tokens[0].is_malformed());
        assert!(
            lexed.diagnostics[0].message.contains(needle),
            "{src}: {}",
            lexed.diagnostics[0].message
        );
    }
    // A space ends the literal: the digits after it are a separate token
    // (here an unsupported numeric form, because of the trailing letters).
    let src = "# 6b5cff";
    let lexed = lex_src(src);
    assert_eq!(
        problems(src, &lexed),
        vec![(Code::E0025, "#"), (Code::E0021, "6b5cff")]
    );
}

// ----- comments and trivia ---------------------------------------------------------------

fn trivia_of(src: &str) -> Vec<(TriviaKind, &str, usize)> {
    lex_src(src)
        .trivia
        .items()
        .iter()
        .map(|item| {
            (
                item.kind,
                src.get(item.span.range()).unwrap_or("?"),
                item.next_token,
            )
        })
        .collect()
}

#[test]
fn line_and_doc_comments_are_trivia_keyed_by_the_following_token() {
    use TriviaKind as T;
    let src = "// one\nfn /// doc\n  x // trail\n/// last";
    assert_eq!(
        trivia_of(src),
        vec![
            (T::LineComment, "// one", 0),
            (T::DocComment, "/// doc", 1),
            (T::LineComment, "// trail", 2),
            (T::DocComment, "/// last", 2),
        ]
    );
    assert_eq!(kinds(src), [TokenKind::KwFn, TokenKind::Ident]);
    let lexed = clean(src);
    // The last two comments belong to Eof (token index 2).
    assert_eq!(lexed.tokens[2].kind, TokenKind::Eof);
    assert_eq!(lexed.trivia.before(2).len(), 2);
    assert_eq!(lexed.trivia.before(0).len(), 1);
    assert_eq!(lexed.trivia.before(1).len(), 1);
}

#[test]
fn every_comment_that_starts_with_three_slashes_is_a_doc_comment() {
    use TriviaKind as T;
    assert_eq!(trivia_of("///"), vec![(T::DocComment, "///", 0)]);
    assert_eq!(trivia_of("////"), vec![(T::DocComment, "////", 0)]);
    assert_eq!(trivia_of("//"), vec![(T::LineComment, "//", 0)]);
    assert_eq!(trivia_of("///x"), vec![(T::DocComment, "///x", 0)]);
    assert_eq!(
        trivia_of("/** x */"),
        vec![(T::BlockComment, "/** x */", 0)]
    );
    assert_eq!(trivia_of("//! x"), vec![(T::LineComment, "//! x", 0)]);
}

#[test]
fn line_comments_stop_before_the_line_terminator() {
    use TriviaKind as T;
    assert_eq!(
        trivia_of("// a\r\n// b\n// c"),
        vec![
            (T::LineComment, "// a", 0),
            (T::LineComment, "// b", 0),
            (T::LineComment, "// c", 0)
        ]
    );
    // A lone carriage return ends the comment and is itself E0003.
    let src = "// a\rfn";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0003, "\r")]);
    assert_eq!(kinds(src), [TokenKind::KwFn]);
}

#[test]
fn block_comments_nest() {
    use TriviaKind as T;
    for comment in [
        "/* a */",
        "/**/",
        "/***/",
        "/* a /* b */ c */",
        "/* /* /* */ */ */",
        "/* // not a line comment */",
        "/* \" unbalanced quote */",
        "/* multi\nline\r\ncomment */",
        "/* é日本 */",
    ] {
        let src = format!("{comment} x");
        let lexed = clean(&src);
        assert_eq!(
            trivia_of(&src),
            vec![(T::BlockComment, comment, 0)],
            "{comment}"
        );
        assert_eq!(lexed.tokens[0].kind, TokenKind::Ident);
    }
    assert_eq!(kinds("a /* b */ c"), [TokenKind::Ident, TokenKind::Ident]);
    // The outer comment ends at the last `*/` only.
    assert_eq!(
        trivia_of("/* a /* b */ c */ d"),
        vec![(T::BlockComment, "/* a /* b */ c */", 0)]
    );
}

#[test]
fn unterminated_block_comments_are_e0006_at_the_opener() {
    for src in ["/*", "/* abc", "fn /* abc\ndef", "/*/", "/* a /* b */"] {
        let lexed = lex_src(src);
        let opener = len(&src[..src.find("/*").unwrap()]);
        assert_eq!(lexed.diagnostics.len(), 1, "{src}");
        let diagnostic = &lexed.diagnostics[0];
        assert_eq!(diagnostic.code, Code::E0006);
        assert_eq!(
            diagnostic.primary.as_ref().map(|l| l.span),
            Some(Span::new(FILE, opener, opener + 2)),
            "{src}"
        );
        // The comment swallows the rest of the file but is still trivia.
        assert_eq!(lexed.trivia.len(), 1);
        assert_eq!(lexed.trivia.items()[0].span.end, len(src));
        assert_eq!(lexed.tokens.last().map(|t| t.kind), Some(TokenKind::Eof));
    }
    assert!(single("/* a /* b").notes[0].contains("2 block comments are still open"));
    assert!(single("/* a").notes.is_empty());
}

#[test]
fn a_closing_marker_alone_is_not_a_comment() {
    use TokenKind as K;
    assert_eq!(kinds("a */ b"), [K::Ident, K::Star, K::Slash, K::Ident]);
}

#[test]
fn a_lone_carriage_return_inside_a_block_comment_is_e0003() {
    let src = "/* a\rb */ fn";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0003, "\r")]);
    assert_eq!(lexed.trivia.len(), 1);
    assert_eq!(kinds(src), [TokenKind::KwFn]);
    clean("/* a\r\nb */");
}

// ----- whitespace and invalid characters ---------------------------------------------------

#[test]
fn space_tab_lf_and_crlf_separate_tokens() {
    let lexed = clean("a \t b\nc\r\nd");
    assert_eq!(lexed.tokens.len(), 5);
}

#[test]
fn a_lone_carriage_return_is_e0003_and_lexing_continues() {
    for (src, offset) in [("a\rb", 1), ("a\r", 1), ("\r", 0), ("a\r\rb", 1)] {
        let lexed = lex_src(src);
        let first = &lexed.diagnostics[0];
        assert_eq!(first.code, Code::E0003, "{src:?}");
        assert_eq!(
            first.primary.as_ref().map(|l| l.span),
            Some(Span::new(FILE, offset, offset + 1)),
            "{src:?}"
        );
    }
    let src = "a\r\r\nb";
    let lexed = lex_src(src);
    assert_eq!(problems(src, &lexed), vec![(Code::E0003, "\r")]);
    assert_eq!(texts(src), ["a", "b"]);
    assert_eq!(
        lexed.diagnostics[0].primary.as_ref().map(|l| l.span.start),
        Some(1),
        "the first of the two carriage returns is the lone one"
    );
}

#[test]
fn disallowed_whitespace_and_control_characters_are_e0005_without_a_token() {
    for src in [
        "\u{a0}", "\u{0}", "\u{7f}", "\u{b}", "\u{c}", "\u{85}", "\u{2028}", "\u{3000}", "\u{1b}",
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0005, src)], "{src:?}");
        assert_eq!(lexed.tokens.len(), 1, "{src:?}: no token");
        assert!(
            lexed.diagnostics[0]
                .message
                .starts_with("Whitespace or control character U+"),
            "{}",
            lexed.diagnostics[0].message
        );
        assert!(!lexed.diagnostics[0].notes.is_empty());
    }
    assert!(single("\u{a0}").message.contains("U+00A0"));
}

#[test]
fn stray_characters_are_e0005_and_name_themselves_safely() {
    for (src, code_point) in [
        ("@", "U+0040"),
        ("$", "U+0024"),
        ("?", "U+003F"),
        ("`", "U+0060"),
        ("'", "U+0027"),
        ("\\", "U+005C"),
        ("\u{1F600}", "U+1F600"),
        ("\u{2192}", "U+2192"),
        ("\u{200b}", "U+200B"),
        ("\u{202e}", "U+202E"),
    ] {
        let lexed = lex_src(src);
        assert_eq!(problems(src, &lexed), vec![(Code::E0005, src)], "{src:?}");
        let message = &lexed.diagnostics[0].message;
        assert!(message.contains(code_point), "{message}");
        assert!(
            message.ends_with("is not part of the Mtek syntax."),
            "{message}"
        );
        // Only visible ASCII characters are echoed into the message.
        let echoed = src.chars().all(|c| c.is_ascii_graphic());
        assert_eq!(message.contains(src), echoed, "{message}");
        assert_eq!(lexed.tokens.len(), 1, "{src:?}: no token");
    }
}

#[test]
fn invalid_characters_do_not_stop_the_lexer() {
    let src = "let x @ = 1 \u{a0}+ 2;";
    let lexed = lex_src(src);
    assert_eq!(
        problems(src, &lexed),
        vec![(Code::E0005, "@"), (Code::E0005, "\u{a0}")]
    );
    assert_eq!(texts(src), ["let", "x", "=", "1", "+", "2", ";"]);
}

#[test]
fn invalid_characters_inside_strings_and_comments_are_fine() {
    clean("\"a\u{a0}b\u{0}c\u{202e}\"");
    clean("// \u{a0} @ \u{0}\n/* \u{2028} */");
}

#[test]
fn all_lexical_diagnostics_are_errors_with_a_location_and_the_catalogue_phase() {
    let src = "@ \r 007 0x1 1. \"\\q\" \"a\n #fff __x é /* ";
    let lexed = lex_src(src);
    let codes: Vec<Code> = lexed.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(
        codes,
        vec![
            Code::E0005,
            Code::E0003,
            Code::E0020,
            Code::E0021,
            Code::E0022,
            Code::E0023,
            Code::E0024,
            Code::E0025,
            Code::E0011,
            Code::E0010,
            Code::E0006,
        ]
    );
    for d in &lexed.diagnostics {
        assert_eq!(d.severity, Severity::Error, "{:?}", d.code);
        assert_eq!(d.phase, d.code.default_phase());
        assert!(d.primary.is_some());
    }
}

// ----- recovery and the whole stream -------------------------------------------------------

#[test]
fn a_file_full_of_errors_still_lexes_to_eof_in_order() {
    let src = "fn \u{a0}f(x: 0x1F) -> 1. { return @ \"a\nlet = #fff; }";
    let lexed = lex_src(src);
    let codes: Vec<Code> = lexed.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(
        codes,
        vec![
            Code::E0005,
            Code::E0021,
            Code::E0022,
            Code::E0005,
            Code::E0024,
            Code::E0025
        ]
    );
    let starts: Vec<u32> = lexed
        .diagnostics
        .iter()
        .filter_map(|d| d.primary.as_ref().map(|l| l.span.start))
        .collect();
    assert!(starts.is_sorted(), "{starts:?}");
    assert_eq!(lexed.tokens.last().map(|t| t.kind), Some(TokenKind::Eof));
    use TokenKind as K;
    assert_eq!(
        kinds(src),
        [
            K::KwFn,
            K::Ident,
            K::LParen,
            K::Ident,
            K::Colon,
            K::Int,
            K::RParen,
            K::Arrow,
            K::Float,
            K::LBrace,
            K::KwReturn,
            K::String,
            K::KwLet,
            K::Eq,
            K::Color,
            K::Semi,
            K::RBrace,
        ]
    );
}

#[test]
fn tokens_do_not_overlap_and_reproduce_the_text() {
    let src = "scene S { state a: f32 = 1.5; on key_down(Key.Space) { a = -a; } } // end";
    let lexed = clean(src);
    let mut end = 0;
    for token in &lexed.tokens {
        assert!(token.span.start >= end, "{token:?}");
        assert!(token.span.end <= len(src));
        end = token.span.end;
    }
    let rebuilt: String = lexed
        .tokens
        .iter()
        .filter(|t| t.kind != TokenKind::Eof)
        .map(|t| t.text(src))
        .collect();
    assert_eq!(
        rebuilt,
        "sceneS{statea:f32=1.5;onkey_down(Key.Space){a=-a;}}"
    );
}

#[test]
fn spans_stay_on_character_boundaries_with_multibyte_text() {
    let src = "// é\n\"日本\" é1 \u{1F600} /* \u{1F600} */ x @é";
    let lexed = lex_src(src);
    for token in &lexed.tokens {
        assert!(src.get(token.span.range()).is_some(), "{token:?}");
    }
    for item in lexed.trivia.items() {
        assert!(src.get(item.span.range()).is_some(), "{item:?}");
    }
    for d in &lexed.diagnostics {
        let span = d.primary.as_ref().map(|l| l.span).unwrap();
        assert!(src.get(span.range()).is_some(), "{d:?}");
    }
}

#[test]
fn dump_lists_trivia_tokens_and_values() {
    let src = "/// d\nlet x = 0x1;\nwhile #6b5cff \"a\\n\" 1.5 7";
    let expected = r##"trivia DocComment 0..5 "/// d"
KwLet 6..9 "let"
Ident 10..11 "x"
Eq 12..13 "="
Int 14..17 "0x1" = malformed
Semi 17..18 ";"
Ident 19..24 "while" = reserved
Color 25..32 "#6b5cff" = #6b5cffff
String 33..38 "\"a\\n\"" = "a\n"
Float 39..42 "1.5" = 1.5
Int 43..44 "7" = 7
Eof 44..44 ""
"##;
    assert_eq!(lex_src(src).dump(src), expected);
}
