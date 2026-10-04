//! A tiny JavaScript text printer: indentation plus the escaping helpers that make sure
//! user-visible strings are never spliced into generated code unescaped
//! (`spec/compiler-architecture.md` section 6).
//!
//! Every string that did not originate in the compiler itself (layout ids, field names,
//! source paths) must pass through [`string_literal`], [`line_comment`], [`property_key`],
//! [`member_access`] or [`identifier_part`] before it reaches the output.

use std::fmt::Write as _;

/// Indentation unit of generated code.
const INDENT: &str = "  ";

/// Accumulates lines of code with a current indentation level.
#[derive(Debug, Default)]
pub struct Printer {
    out: String,
    level: usize,
    lines: usize,
}

impl Printer {
    /// An empty printer at indentation level 0.
    pub fn new() -> Self {
        Self::default()
    }

    /// Writes one line at the current indentation. `text` must not contain a line break;
    /// use the escaping helpers of this module for anything user-visible.
    pub fn line(&mut self, text: &str) {
        for _ in 0..self.level {
            self.out.push_str(INDENT);
        }
        self.out.push_str(text);
        self.out.push('\n');
        self.lines += 1;
    }

    /// Writes an empty line.
    pub fn blank(&mut self) {
        self.out.push('\n');
        self.lines += 1;
    }

    /// Writes every line of `text` (pre-printed code such as the writer functions) at the
    /// current indentation; empty lines stay empty.
    pub fn verbatim(&mut self, text: &str) {
        for line in text.lines() {
            if line.is_empty() {
                self.blank();
            } else {
                self.line(line);
            }
        }
    }

    /// The number of lines written so far: the 0-based index of the next line.
    pub fn line_count(&self) -> usize {
        self.lines
    }

    /// The width of the current indentation in columns.
    pub fn indent_width(&self) -> usize {
        self.level * INDENT.len()
    }

    /// Increases the indentation by one level.
    pub fn indent(&mut self) {
        self.level += 1;
    }

    /// Decreases the indentation by one level (never below zero).
    pub fn dedent(&mut self) {
        self.level = self.level.saturating_sub(1);
    }

    /// Writes `header {`, the lines produced by `body` one level deeper, then `}`.
    pub fn block(&mut self, header: &str, body: impl FnOnce(&mut Self)) {
        self.line(&format!("{header} {{"));
        self.indent();
        body(self);
        self.dedent();
        self.line("}");
    }

    /// The printed text.
    pub fn finish(self) -> String {
        self.out
    }
}

/// A double-quoted JavaScript string literal for `text`.
///
/// The result is pure ASCII on a single line: quotes and backslashes are escaped, control
/// characters and the line terminators U+2028/U+2029 become `\uXXXX`, and every non-ASCII
/// character is written as its UTF-16 escape sequence.
pub fn string_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ' '..='~' => out.push(c),
            _ => push_unicode_escape(&mut out, c),
        }
    }
    out.push('"');
    out
}

fn push_unicode_escape(out: &mut String, c: char) {
    let mut units = [0u16; 2];
    for unit in c.encode_utf16(&mut units) {
        // Writing to a String cannot fail.
        let _ = write!(out, "\\u{unit:04x}");
    }
}

/// A `//` line comment carrying `text`, safe against line-break injection: control
/// characters (including all JavaScript line terminators) are replaced by `?`, and
/// non-ASCII characters are escaped like in a string literal so the comment stays ASCII.
pub fn line_comment(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 3);
    out.push_str("//");
    if !text.is_empty() {
        out.push(' ');
    }
    for c in text.chars() {
        match c {
            ' '..='~' => out.push(c),
            c if c.is_control() || c == '\u{2028}' || c == '\u{2029}' => out.push('?'),
            _ => push_unicode_escape(&mut out, c),
        }
    }
    out
}

/// True if `name` is a plain ASCII identifier name (`[A-Za-z_$][A-Za-z0-9_$]*`). Reserved
/// words count as identifier names: they are valid property names.
pub fn is_identifier_name(name: &str) -> bool {
    let mut chars = name.chars();
    let starts_well = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$');
    starts_well && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

/// The key of an object-literal property: a bare identifier name when that is safe, a
/// string literal otherwise. `__proto__` is written as a computed key, because both the
/// bare and the quoted form would set the prototype instead of defining a property.
pub fn property_key(name: &str) -> String {
    if name == "__proto__" {
        format!("[{}]", string_literal(name))
    } else if is_identifier_name(name) {
        name.to_owned()
    } else {
        string_literal(name)
    }
}

/// `object.name`, or `object["name"]` when `name` is not a plain identifier name.
pub fn member_access(object: &str, name: &str) -> String {
    if is_identifier_name(name) {
        format!("{object}.{name}")
    } else {
        format!("{object}[{}]", string_literal(name))
    }
}

/// `name` made safe for use as part of a JavaScript identifier. ASCII letters, digits and
/// `_` are kept; every other character becomes `_u<hex code point>_`.
pub fn identifier_part(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
        } else {
            // Writing to a String cannot fail.
            let _ = write!(out, "_u{:x}_", u32::from(c));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn printer_indents_blocks_and_never_underflows() {
        let mut p = Printer::new();
        p.line("a;");
        p.block("function f()", |p| {
            p.line("b;");
            p.blank();
            p.block("if (x)", |p| p.line("c;"));
        });
        p.dedent();
        p.line("d;");
        assert_eq!(
            p.finish(),
            "a;\nfunction f() {\n  b;\n\n  if (x) {\n    c;\n  }\n}\nd;\n"
        );
    }

    #[test]
    fn string_literal_escapes_everything_dangerous() {
        assert_eq!(string_literal("plain"), r#""plain""#);
        assert_eq!(string_literal(r#"a"b\c"#), r#""a\"b\\c""#);
        assert_eq!(string_literal("l1\nl2\r\t"), r#""l1\nl2\r\t""#);
        assert_eq!(string_literal("\u{0}\u{7f}"), r#""\u0000\u007f""#);
        let esc = |units: &[&str]| -> String {
            let body: String = units.iter().map(|hex| format!("\\u{hex}")).collect();
            format!("\"{body}\"")
        };
        assert_eq!(string_literal("\u{2028}\u{2029}"), esc(&["2028", "2029"]));
        assert_eq!(string_literal("\u{e9}"), esc(&["00e9"]));
        // Astral characters become surrogate pairs.
        assert_eq!(string_literal("\u{1f600}"), esc(&["d83d", "de00"]));
        let hostile = string_literal("\"; process.exit(1); //\n");
        assert!(!hostile.contains('\n'));
        assert_eq!(hostile, r#""\"; process.exit(1); //\n""#);
    }

    #[test]
    fn line_comment_cannot_be_broken_out_of() {
        assert_eq!(line_comment("size 4"), "// size 4");
        assert_eq!(line_comment(""), "//");
        for terminator in ["\n", "\r", "\u{2028}", "\u{2029}", "\u{0085}", "\u{b}"] {
            let comment = line_comment(&format!("x{terminator}alert(1)"));
            assert_eq!(comment, "// x?alert(1)", "terminator {terminator:?}");
        }
        assert_eq!(line_comment("caf\u{e9}"), "// caf\\u00e9");
    }

    #[test]
    fn identifier_names_and_property_keys() {
        assert!(is_identifier_name("tint"));
        assert!(is_identifier_name("_a$1"));
        assert!(is_identifier_name("class"));
        assert!(!is_identifier_name(""));
        assert!(!is_identifier_name("1a"));
        assert!(!is_identifier_name("a-b"));
        assert!(!is_identifier_name("\u{e9}"));
        assert_eq!(property_key("tint"), "tint");
        assert_eq!(property_key("a-b"), r#""a-b""#);
        assert_eq!(property_key("__proto__"), r#"["__proto__"]"#);
        assert_eq!(member_access("v", "x"), "v.x");
        assert_eq!(member_access("v", "a b"), r#"v["a b"]"#);
    }

    #[test]
    fn identifier_part_is_safe() {
        assert_eq!(identifier_part("Pulse_1"), "Pulse_1");
        assert_eq!(identifier_part("a-b"), "a_u2d_b");
        assert_eq!(identifier_part("a b"), "a_u20_b");
        assert_eq!(identifier_part("\u{e9}"), "_ue9_");
        assert!(
            identifier_part("x\ny;")
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        );
    }
}
