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
pub const RULES: [SyntaxRule; 9] = [
    SyntaxRule {
        text: "Declarations/fields/assignments/statements need ';', before '}' too.",
        violation: "scene Demo {\n    camera Main {}\n    clear_color: #000000\n}\n",
        code: Code::E1003,
    },
    SyntaxRule {
        text: "Floats 1.0,0.5,2.5e-3: digits around '.'; integers unsigned decimal, no leading zeros.",
        violation: "scene Demo {\n    camera Main {}\n    ambient_intensity: 1.;\n}\n",
        code: Code::E0022,
    },
    SyntaxRule {
        text: "Colours: #RRGGBB or #RRGGBBAA.",
        violation: "scene Demo {\n    camera Main {}\n    clear_color: #fff;\n}\n",
        code: Code::E0025,
    },
    SyntaxRule {
        text: "< <= > >= == != do not chain; use (a < b) && (b < c).",
        violation: "const A: bool = 1 < 2 < 3;\n\nscene Demo {\n    camera Main {}\n}\n",
        code: Code::E1010,
    },
    SyntaxRule {
        text: "No implicit conversions; literals take expected numeric types.",
        violation: "scene Demo {\n    camera Main {}\n    state n: i32 = 1;\n    state f: f32 = 1.0;\n    on key_down(Key.Space) {\n        f = n;\n    }\n}\n",
        code: Code::E3001,
    },
    SyntaxRule {
        text: "import {Name} from \"./path.mtek\"; paths: ./ or ../, .mtek suffix.",
        violation: "import { Helper } from \"helper.mtek\";\n\nscene Demo {\n    camera Main {}\n}\n",
        code: Code::E2034,
    },
    SyntaxRule {
        text: "Scene camera: camera Main {}.",
        violation: "scene Demo {\n    entity Cube {\n        mesh: Box {};\n    }\n}\n",
        code: Code::E5012,
    },
    SyntaxRule {
        text: "Fields/params must be declared.",
        violation: "scene Demo {\n    camera Main {}\n    entity Cube {\n        mesh: Box { sizee: vec3(1.0); };\n    }\n}\n",
        code: Code::E5001,
    },
    SyntaxRule {
        text: "compute P { param gain:f32=2.0; input src:array<T,N>; output dst:array<T,N>; kernel(i:ComputeInput)->T{return src[i.index];} } Host: app.createCompute. Fixed N; <=4 inputs, 1 output.",
        violation: "compute P { kernel(i:ComputeInput)->f32 { return 0.0; } } scene Demo { camera Main {} }",
        code: Code::E4050,
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
