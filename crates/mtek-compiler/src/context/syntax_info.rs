//! The `syntax` section: keywords, operator precedence and the rules that most often catch a
//! newcomer (decision 0072).
//!
//! The keywords and the precedence are read from the tables the lexer and the parser use
//! ([`KEYWORDS`], [`BINARY_OPERATORS`]). The rules are sentences, so they are written here, but
//! each carries a program that breaks it and the diagnostic the compiler reports for it; a test
//! runs every one, so a rule cannot say what the compiler no longer does.

use crate::diagnostics::Code;
use crate::syntax::{BINARY_OPERATORS, KEYWORDS, TokenKind};

/// A syntax rule with the proof that the compiler enforces it.
#[derive(Clone, Copy, Debug)]
pub struct SyntaxRule {
    /// The rule, as the context states it.
    pub text: &'static str,
    /// An entry module that breaks the rule.
    pub violation: &'static str,
    /// A diagnostic the compiler reports for `violation`.
    pub code: Code,
}

/// The rules, in the order the context lists them.
pub const RULES: [SyntaxRule; 8] = [
    SyntaxRule {
        text: "Declarations, fields, assignments and statements end with ';', also the last one before '}'.",
        violation: "scene Demo {\n    camera Main {}\n    clear_color: #000000\n}\n",
        code: Code::E1003,
    },
    SyntaxRule {
        text: "Float literals have digits on both sides of the point (1.0, 0.5, 2.5e-3), never 1. or .5; integer literals have no sign, no leading zeros and no hexadecimal form.",
        violation: "scene Demo {\n    camera Main {}\n    ambient_intensity: 1.;\n}\n",
        code: Code::E0022,
    },
    SyntaxRule {
        text: "Colours are written #RRGGBB or #RRGGBBAA.",
        violation: "scene Demo {\n    camera Main {}\n    clear_color: #fff;\n}\n",
        code: Code::E0025,
    },
    SyntaxRule {
        text: "Comparison operators (< <= > >=) and equality operators (== !=) do not chain: write (a < b) && (b < c).",
        violation: "const A: bool = 1 < 2 < 3;\n\nscene Demo {\n    camera Main {}\n}\n",
        code: Code::E1010,
    },
    SyntaxRule {
        text: "Typed values are never converted implicitly: an i32 value is not an f32 value, and only a literal such as 1 may stand where an f32 is expected.",
        violation: "scene Demo {\n    camera Main {}\n    state n: i32 = 1;\n    state f: f32 = 1.0;\n    on key_down(Key.Space) {\n        f = n;\n    }\n}\n",
        code: Code::E3001,
    },
    SyntaxRule {
        text: "An import is import { Name } from \"./path.mtek\"; the path is relative (starts with ./ or ../) and ends in .mtek.",
        violation: "import { Helper } from \"helper.mtek\";\n\nscene Demo {\n    camera Main {}\n}\n",
        code: Code::E2034,
    },
    SyntaxRule {
        text: "Every scene needs a camera: camera Main { position: vec3(0.0, 2.0, 5.0); }.",
        violation: "scene Demo {\n    entity Cube {\n        mesh: Box {};\n    }\n}\n",
        code: Code::E5012,
    },
    SyntaxRule {
        text: "Fields and parameters must exist on their schema or declaration: an unknown name is an error, never ignored.",
        violation: "scene Demo {\n    camera Main {}\n    entity Cube {\n        mesh: Box { sizee: vec3(1.0); };\n    }\n}\n",
        code: Code::E5001,
    },
];

/// The reserved keywords, in the order of the lexer's table.
#[must_use]
pub fn keywords() -> Vec<String> {
    KEYWORDS
        .iter()
        .map(|(word, _)| (*word).to_owned())
        .collect()
}

/// Operator precedence, tightest first: `level 8: call f(...), field .x, index [i] (left)`.
///
/// The binary levels are read from [`BINARY_OPERATORS`], the table the parser itself uses; the
/// two structural levels (postfix and prefix) are the shape of the parser's unary and postfix
/// loops and are checked against `spec/language.md` section 6.1 by a test.
#[must_use]
pub fn precedence() -> Vec<String> {
    let mut lines = vec![
        "level 8: call f(...), field .x, index [i] (left)".to_owned(),
        "level 7: unary - ! (right)".to_owned(),
    ];
    let mut level = BINARY_OPERATORS
        .iter()
        .map(|row| row.level)
        .max()
        .unwrap_or(0);
    while level > 0 {
        let rows: Vec<_> = BINARY_OPERATORS
            .iter()
            .filter(|row| row.level == level)
            .collect();
        if let Some(first) = rows.first() {
            let spellings: Vec<&str> = rows
                .iter()
                .filter_map(|row| TokenKind::fixed_text(row.token))
                .collect();
            let associativity = if first.non_associative {
                "non-associative"
            } else {
                "left"
            };
            lines.push(format!(
                "level {level}: {} ({associativity})",
                spellings.join(" ")
            ));
        }
        level -= 1;
    }
    lines
}

/// The rules as sentences.
#[must_use]
pub fn rules() -> Vec<String> {
    RULES.iter().map(|rule| rule.text.to_owned()).collect()
}
