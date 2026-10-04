//! A reader for `spec/grammar.ebnf`: just enough of the W3C-style EBNF to
//! list the productions, the top-level alternatives of each, and the
//! semantic restrictions written as `[S: rule-id: text]` in comments.
//!
//! * A production is a name at the start of a line followed by `::=`; its
//!   right-hand side runs to the next production.
//! * The top-level alternatives of a right-hand side are its parts separated
//!   by `|` outside parentheses. Each is identified by its *normalised text*:
//!   the symbols separated by one space, with the postfix operators `?`, `*`
//!   and `+` attached to what they follow (`'(' ArgList? ')'`), comments
//!   removed. A production without `|` at the top level has one alternative.
//! * A rule is `[S: rule-id: text]` inside a comment. The id is lower-case
//!   words joined by `-`; the text runs to the matching `]` and must name at
//!   least one diagnostic code (`E1020`, `E4020/E4021`, a range
//!   `E2030-E2034`). A rule belongs to the production whose right-hand side
//!   contains its comment. `[S: <` starts a placeholder in prose (the header
//!   of the grammar explains the notation) and is not a rule.

use std::collections::BTreeSet;

/// A production of the grammar.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Production {
    pub name: String,
    /// The 1-based line of the production's name.
    pub line: usize,
    /// The normalised top-level alternatives, in grammar order (one entry
    /// for a production without top-level `|`).
    pub alternatives: Vec<String>,
}

/// A semantic restriction `[S: id: text]`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Rule {
    pub id: String,
    /// The production the rule is written under.
    pub production: String,
    /// The 1-based line of the `[S:`.
    pub line: usize,
    /// The text after `id:`, whitespace collapsed.
    pub text: String,
    /// The diagnostic codes the text names (`E1020`), ranges expanded, in
    /// order of appearance, each once.
    pub codes: Vec<String>,
}

/// What [`parse`] reads from the grammar.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Grammar {
    pub productions: Vec<Production>,
    pub rules: Vec<Rule>,
}

impl Grammar {
    /// The production called `name`.
    #[must_use]
    pub fn production(&self, name: &str) -> Option<&Production> {
        self.productions.iter().find(|p| p.name == name)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
enum Tok {
    Name(String),
    Defines,
    Bar,
    Open,
    Close,
    /// `?`, `*`, `+`: attached to the previous symbol when normalising.
    Postfix(char),
    /// Anything else: a quoted string, a character class, `#xNN`, `-`.
    Other(String),
}

/// A token and the byte offset where it starts.
struct Lexeme {
    tok: Tok,
    start: usize,
}

/// A comment's text (without `/*` and `*/`) and the offset of its `/*`.
struct Comment {
    text: String,
    start: usize,
}

fn line_of(text: &str, offset: usize) -> usize {
    text.as_bytes()[..offset.min(text.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
        + 1
}

/// Split the grammar into tokens and comments.
fn tokenize(text: &str) -> Result<(Vec<Lexeme>, Vec<Comment>), String> {
    let bytes = text.as_bytes();
    let mut tokens = Vec::new();
    let mut comments = Vec::new();
    let mut i = 0;
    // Find `close` at or after `from`; the offset just past it.
    let until = |from: usize, close: &str, what: &str| -> Result<usize, String> {
        text[from..]
            .find(close)
            .map(|at| from + at + close.len())
            .ok_or_else(|| format!("line {}: unterminated {what}", line_of(text, from)))
    };
    while i < bytes.len() {
        let c = bytes[i];
        let start = i;
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if text[i..].starts_with("/*") {
            let end = until(i + 2, "*/", "comment")?;
            comments.push(Comment {
                text: text[i + 2..end - 2].to_owned(),
                start,
            });
            i = end;
            continue;
        }
        let tok = if text[i..].starts_with("::=") {
            i += 3;
            Tok::Defines
        } else if c == b'\'' || c == b'"' {
            let quote = if c == b'\'' { "'" } else { "\"" };
            i = until(i + 1, quote, "quoted string")?;
            Tok::Other(text[start..i].to_owned())
        } else if c == b'[' {
            i = until(i + 1, "]", "character class")?;
            Tok::Other(text[start..i].to_owned())
        } else if c.is_ascii_alphabetic() {
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            Tok::Name(text[start..i].to_owned())
        } else if c == b'#' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_alphanumeric() {
                i += 1;
            }
            Tok::Other(text[start..i].to_owned())
        } else {
            i += 1;
            match c {
                b'|' => Tok::Bar,
                b'(' => Tok::Open,
                b')' => Tok::Close,
                b'?' | b'*' | b'+' => Tok::Postfix(char::from(c)),
                b'-' => Tok::Other("-".to_owned()),
                _ => {
                    return Err(format!(
                        "line {}: unexpected character {:?}",
                        line_of(text, start),
                        char::from(c)
                    ));
                }
            }
        };
        tokens.push(Lexeme { tok, start });
    }
    Ok((tokens, comments))
}

/// The normalised top-level alternatives of a right-hand side.
fn alternatives(rhs: &[Lexeme], text: &str, name: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for lexeme in rhs {
        let piece = match &lexeme.tok {
            Tok::Bar if depth == 0 => {
                out.push(std::mem::take(&mut current));
                continue;
            }
            Tok::Postfix(op) => {
                current.push(*op);
                continue;
            }
            Tok::Bar => "|".to_owned(),
            Tok::Open => {
                depth += 1;
                "(".to_owned()
            }
            Tok::Close => {
                depth = depth.checked_sub(1).ok_or_else(|| {
                    format!(
                        "line {}: unbalanced `)` in {name}",
                        line_of(text, lexeme.start)
                    )
                })?;
                ")".to_owned()
            }
            Tok::Name(s) | Tok::Other(s) => s.clone(),
            Tok::Defines => {
                return Err(format!(
                    "line {}: `::=` inside the right-hand side of {name}",
                    line_of(text, lexeme.start)
                ));
            }
        };
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(&piece);
    }
    if depth != 0 {
        return Err(format!("{name}: unbalanced `(`"));
    }
    out.push(current);
    if out.iter().any(String::is_empty) {
        return Err(format!("{name}: an empty alternative"));
    }
    Ok(out)
}

/// The diagnostic codes named in `text`: `E` and four digits, not inside a
/// word; `E2030-E2034` is the range.
fn codes_in(text: &str) -> Vec<String> {
    fn code_at(bytes: &[u8], i: usize) -> Option<u32> {
        let digits = bytes.get(i + 1..i + 5)?;
        let boundary_before = i == 0 || !bytes[i - 1].is_ascii_alphanumeric();
        let boundary_after = bytes.get(i + 5).is_none_or(|b| !b.is_ascii_alphanumeric());
        if bytes[i] == b'E'
            && boundary_before
            && boundary_after
            && digits.iter().all(u8::is_ascii_digit)
        {
            digits
                .iter()
                .try_fold(0u32, |n, d| Some(n * 10 + u32::from(d - b'0')))
        } else {
            None
        }
    }
    let bytes = text.as_bytes();
    let mut codes: Vec<String> = Vec::new();
    let mut add = |n: u32| {
        let code = format!("E{n:04}");
        if !codes.contains(&code) {
            codes.push(code);
        }
    };
    let mut i = 0;
    while i < bytes.len() {
        if let Some(first) = code_at(bytes, i) {
            i += 5;
            let mut last = first;
            if bytes.get(i) == Some(&b'-')
                && let Some(end) = code_at(bytes, i + 1)
                && end > first
            {
                last = end;
                i += 6;
            }
            for n in first..=last {
                add(n);
            }
        } else {
            i += 1;
        }
    }
    codes
}

/// Is `id` a rule id: lower-case words of letters and digits joined by `-`?
fn is_rule_id(id: &str) -> bool {
    !id.is_empty()
        && id.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
        && id.as_bytes()[0].is_ascii_lowercase()
}

/// The rules in one comment.
fn rules_in(
    comment: &Comment,
    production: Option<&str>,
    text: &str,
    out: &mut Vec<Rule>,
) -> Result<(), String> {
    const OPEN: &str = "[S:";
    let body = comment.text.as_str();
    let mut from = 0;
    while let Some(at) = body[from..].find(OPEN) {
        let begin = from + at;
        let offset = comment.start + 2 + begin;
        let line = line_of(text, offset);
        let rest = body[begin + OPEN.len()..].trim_start();
        if rest.starts_with('<') {
            from = begin + OPEN.len();
            continue;
        }
        // The text runs to the matching `]`.
        let mut depth = 1usize;
        let mut end = None;
        for (i, c) in body[begin + 1..].char_indices() {
            match c {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(begin + 1 + i);
                        break;
                    }
                }
                _ => {}
            }
        }
        let end = end.ok_or_else(|| format!("line {line}: `[S:` without a closing `]`"))?;
        let inner = body[begin + OPEN.len()..end].trim();
        let (id, rule_text) = inner
            .split_once(':')
            .map(|(id, rest)| (id.trim(), rest))
            .filter(|(id, _)| is_rule_id(id))
            .ok_or_else(|| {
                format!("line {line}: a rule is written `[S: rule-id: text]`, found `[S: {inner}]`")
            })?;
        let production = production.ok_or_else(|| {
            format!("line {line}: the rule `{id}` stands before the first production")
        })?;
        let rule_text = rule_text.split_whitespace().collect::<Vec<_>>().join(" ");
        let codes = codes_in(&rule_text);
        if codes.is_empty() {
            return Err(format!(
                "line {line}: the rule `{id}` names no diagnostic code"
            ));
        }
        out.push(Rule {
            id: id.to_owned(),
            production: production.to_owned(),
            line,
            text: rule_text,
            codes,
        });
        from = end + 1;
    }
    Ok(())
}

/// Read the productions and rules of a grammar.
///
/// # Errors
///
/// A message naming the line, for text this reader does not understand, a
/// production defined twice, a malformed or duplicate rule, or a grammar
/// without productions.
pub fn parse(text: &str) -> Result<Grammar, String> {
    let (tokens, comments) = tokenize(text)?;
    // Production starts: a name at the start of its line, followed by `::=`.
    let mut starts = Vec::new();
    for (i, pair) in tokens.windows(2).enumerate() {
        if let (Tok::Name(name), Tok::Defines) = (&pair[0].tok, &pair[1].tok) {
            let start = pair[0].start;
            let line_start = text[..start].rfind('\n').map_or(0, |n| n + 1);
            if !text[line_start..start].trim().is_empty() {
                return Err(format!(
                    "line {}: `{name} ::=` does not start its line",
                    line_of(text, start)
                ));
            }
            starts.push((i, name.clone(), start));
        }
    }
    if starts.is_empty() {
        return Err("the grammar defines no production".to_owned());
    }
    let mut grammar = Grammar::default();
    let mut seen = BTreeSet::new();
    for (n, (index, name, start)) in starts.iter().enumerate() {
        if !seen.insert(name.clone()) {
            return Err(format!(
                "line {}: {name} is defined twice",
                line_of(text, *start)
            ));
        }
        let end = starts.get(n + 1).map_or(tokens.len(), |next| next.0);
        let alternatives = alternatives(&tokens[index + 2..end], text, name)?;
        grammar.productions.push(Production {
            name: name.clone(),
            line: line_of(text, *start),
            alternatives,
        });
    }
    for comment in &comments {
        let owner = starts
            .iter()
            .rev()
            .find(|(_, _, start)| *start < comment.start)
            .map(|(_, name, _)| name.as_str());
        rules_in(comment, owner, text, &mut grammar.rules)?;
    }
    let mut ids = BTreeSet::new();
    for rule in &grammar.rules {
        if !ids.insert(rule.id.as_str()) {
            return Err(format!(
                "line {}: the rule id `{}` is used twice",
                rule.line, rule.id
            ));
        }
    }
    Ok(grammar)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "/* Header: rules are noted as [S: <rule-id>: ...]. */\n\
        Item    ::= Import\n          | 'export'? ( Decl | Other )   /* trailing */\n\
        Decl    ::= 'const' Ident ( ':' Type )? '=' Expr ';'\n\
                    /* [S: const-rule: values fold (E3090); see E2030-E2032] */\n\
        Block   ::= '/*' ( Block | [^*/] )* '*/' /* nests */\n\
        Int     ::= '0' | [1-9] [0-9]*\n";

    #[test]
    fn productions_alternatives_and_rules_are_read() {
        let grammar = parse(SAMPLE).unwrap();
        let names: Vec<&str> = grammar
            .productions
            .iter()
            .map(|p| p.name.as_str())
            .collect();
        assert_eq!(names, ["Item", "Decl", "Block", "Int"]);
        assert_eq!(
            grammar.productions[0].alternatives,
            ["Import", "'export'? ( Decl | Other )"]
        );
        assert_eq!(
            grammar.productions[1].alternatives,
            ["'const' Ident ( ':' Type )? '=' Expr ';'"]
        );
        assert_eq!(
            grammar.productions[2].alternatives,
            ["'/*' ( Block | [^*/] )* '*/'"]
        );
        assert_eq!(grammar.productions[3].alternatives, ["'0'", "[1-9] [0-9]*"]);
        assert_eq!(grammar.productions[3].line, 7);
        assert_eq!(grammar.rules.len(), 1);
        let rule = &grammar.rules[0];
        assert_eq!(rule.id, "const-rule");
        assert_eq!(rule.production, "Decl");
        assert_eq!(rule.line, 5);
        assert_eq!(rule.text, "values fold (E3090); see E2030-E2032");
        assert_eq!(rule.codes, ["E3090", "E2030", "E2031", "E2032"]);
    }

    #[test]
    fn codes_are_read_with_separators_and_ranges() {
        assert_eq!(codes_in("(E4020/E4021)"), ["E4020", "E4021"]);
        assert_eq!(codes_in("E5050-E5052"), ["E5050", "E5051", "E5052"]);
        assert_eq!(codes_in("E1020, E1020"), ["E1020"]);
        assert_eq!(codes_in("XE1020 E10200 E102"), Vec::<String>::new());
    }

    #[test]
    fn malformed_grammars_are_reported_with_their_line() {
        let cases = [
            (
                "A ::= 'a'\n/* [S: no id here] */",
                "line 2: a rule is written",
            ),
            (
                "A ::= 'a'\n/* [S: Bad-Id: E1000] */",
                "line 2: a rule is written",
            ),
            (
                "A ::= 'a'\n/* [S: r: no code] */",
                "line 2: the rule `r` names no",
            ),
            (
                "A ::= 'a'\n/* [S: r: E1000 */",
                "line 2: `[S:` without a closing",
            ),
            (
                "/* [S: r: E1000] */\nA ::= 'a'",
                "line 1: the rule `r` stands before",
            ),
            (
                "A ::= 'a' /* [S: r: E1000] */\nB ::= 'b' /* [S: r: E1001] */",
                "line 2: the rule id `r` is used twice",
            ),
            ("A ::= 'a'\nA ::= 'b'", "line 2: A is defined twice"),
            ("A ::= ( 'a'", "A: unbalanced `(`"),
            ("A ::= 'a' )", "line 1: unbalanced `)` in A"),
            ("A ::= 'a' | | 'b'", "A: an empty alternative"),
            (
                "A ::= 'a' B ::= 'b'",
                "line 1: `B ::=` does not start its line",
            ),
            ("A ::= 'a\n", "line 1: unterminated quoted string"),
            ("A ::= 'a' /* open", "line 1: unterminated comment"),
            ("A ::= 'a' ; 'b'", "line 1: unexpected character ';'"),
            ("/* nothing */", "the grammar defines no production"),
        ];
        for (text, expected) in cases {
            let message = parse(text).unwrap_err();
            assert!(
                message.starts_with(expected),
                "{text:?}: {message:?} does not start with {expected:?}"
            );
        }
    }
}
