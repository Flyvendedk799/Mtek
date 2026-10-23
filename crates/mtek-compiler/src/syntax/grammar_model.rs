//! The grammar model: `spec/grammar.ebnf` as data (`spec/ai-and-benchmarks.md`
//! section 3, decision 0073).
//!
//! [`grammar`] describes every production of the reference grammar as an
//! expression tree ([`Expr`]), together with the layout and the comments of
//! the checked-in file, so that [`ebnf`] prints `spec/grammar.ebnf` byte for
//! byte (a test asserts it) and the GBNF translation
//! ([`gbnf`](super::gbnf)) works from the same data instead of from text.
//!
//! The model is a description, not a parser: the handwritten parser stays the
//! authority (decision 0005). What the reference grammar leaves to the
//! compiler (the `[S: …]` restrictions, decision 0042) is prose in the
//! comments and is not modelled.
//!
//! Layout is part of the model only as far as the file needs it: where an
//! alternative starts a new line ([`Arm::line_break`]), the comments written
//! after a line ([`Production::inline_comments`]) and the comment lines
//! under a production ([`Production::notes`]). Everything else (the column of
//! `::=`, the indentation of continued alternatives, the spacing of the
//! operators) follows from the printing rules of [`ebnf`].

use std::fmt::Write as _;

/// A character inside a character class.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClassItem {
    /// The character itself (`*`, `"`, `\`).
    Char(char),
    /// A character written as a code point (`#x0A`).
    CodePoint(u32),
    /// An inclusive range (`A-Z`).
    Range(char, char),
}

/// How often the operand of [`Expr::Repeat`] occurs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Repeat {
    /// `?`: zero or one.
    Optional,
    /// `*`: zero or more.
    ZeroOrMore,
    /// `+`: one or more.
    OneOrMore,
}

impl Repeat {
    /// The postfix operator.
    #[must_use]
    pub fn operator(self) -> char {
        match self {
            Repeat::Optional => '?',
            Repeat::ZeroOrMore => '*',
            Repeat::OneOrMore => '+',
        }
    }
}

/// An alternative of [`Expr::Alt`].
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Arm {
    pub expr: Expr,
    /// The file starts this alternative on a new line (the `|` is aligned
    /// under the start of the enclosing group, or two columns left of the
    /// right-hand side at the top level).
    pub line_break: bool,
}

/// A right-hand side, as the W3C-style EBNF of `spec/grammar.ebnf` writes it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Expr {
    /// A quoted terminal: `'fn'`.
    Literal(&'static str),
    /// A character written as a code point: `#x20`.
    CodePoint(u32),
    /// A character class: `[A-Za-z_]`, `[^*/]`.
    Class {
        negated: bool,
        items: Vec<ClassItem>,
    },
    /// A production.
    Ref(&'static str),
    /// The end of the input (`EOF`).
    Eof,
    /// Juxtaposition.
    Seq(Vec<Expr>),
    /// Alternatives separated by `|`.
    Alt(Vec<Arm>),
    /// A parenthesised expression: `( … )`.
    Group(Box<Expr>),
    /// `?`, `*` or `+` after its operand.
    Repeat(Box<Expr>, Repeat),
    /// `A - B`: the strings of `A` that are not strings of `B`.
    Except(Box<Expr>, Box<Expr>),
}

/// Which part of the grammar a production belongs to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    /// Section 1: characters to tokens, whitespace and comments.
    Lexical,
    /// Sections 2 to 7: tokens to a module.
    Syntactic,
}

/// A production the reference grammar defines in prose on top of another one.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Derivation {
    /// `ExprNoDesc`: `base` with the alternative `removed` taken out of the
    /// productions reached from `base` outside brackets (inside `( )`, `[ ]`
    /// and call arguments it is allowed again). Generated adapters expand it
    /// as a duplicated rule set.
    WithoutAtTopLevel {
        base: &'static str,
        removed: &'static str,
    },
}

/// A comment written after a line of a production.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct InlineComment {
    /// The 0-based line of the production it ends.
    pub line: usize,
    /// The number of spaces between the line and the comment.
    pub gap: usize,
    /// The comment, `/*` to `*/`.
    pub text: &'static str,
}

/// A production of the reference grammar.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Production {
    pub name: &'static str,
    pub level: Level,
    pub rhs: Expr,
    /// For a production the grammar defines in prose ([`Derivation`]).
    pub derivation: Option<Derivation>,
    pub inline_comments: Vec<InlineComment>,
    /// Comment lines under the production, as written (with indentation).
    pub notes: Vec<&'static str>,
}

/// A part of the grammar file.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Part {
    /// Lines of commentary, as written, without the final line break.
    Comment(&'static str),
    /// An empty line.
    Blank,
    Production(Production),
}

/// The reference grammar.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct GrammarModel {
    pub parts: Vec<Part>,
}

impl GrammarModel {
    /// The productions, in file order.
    pub fn productions(&self) -> impl Iterator<Item = &Production> {
        self.parts.iter().filter_map(|part| match part {
            Part::Production(production) => Some(production),
            Part::Comment(_) | Part::Blank => None,
        })
    }

    /// The production called `name`.
    #[must_use]
    pub fn production(&self, name: &str) -> Option<&Production> {
        self.productions().find(|p| p.name == name)
    }
}

// ----- printing ---------------------------------------------------------------

/// The column where a production's right-hand side starts (the name is padded
/// to 15 characters, then ` ::= `).
const NAME_WIDTH: usize = 15;

/// `spec/grammar.ebnf`, printed from the model.
#[must_use]
pub fn ebnf() -> String {
    let mut out = String::new();
    for part in grammar().parts {
        match part {
            Part::Comment(text) => {
                out.push_str(text);
                out.push('\n');
            }
            Part::Blank => out.push('\n'),
            Part::Production(production) => print_production(&mut out, &production),
        }
    }
    out
}

fn print_production(out: &mut String, production: &Production) {
    let head = format!("{:<NAME_WIDTH$} ::= ", production.name);
    let mut printer = Printer {
        text: head.clone(),
        column: head.chars().count(),
    };
    let rhs_column = printer.column;
    printer.expr(&production.rhs, rhs_column.saturating_sub(2), false);
    for (index, line) in printer.text.split('\n').enumerate() {
        out.push_str(line);
        for comment in production
            .inline_comments
            .iter()
            .filter(|c| c.line == index)
        {
            out.push_str(&" ".repeat(comment.gap));
            out.push_str(comment.text);
        }
        out.push('\n');
    }
    for note in &production.notes {
        out.push_str(note);
        out.push('\n');
    }
}

struct Printer {
    text: String,
    /// The column of the end of `text` (characters since the last line break).
    column: usize,
}

impl Printer {
    fn push(&mut self, s: &str) {
        match s.rfind('\n') {
            Some(at) => self.column = s[at + 1..].chars().count(),
            None => self.column += s.chars().count(),
        }
        self.text.push_str(s);
    }

    /// Print `expr`. `break_column` is where a `|` that starts a new line
    /// goes; `atomic` asks for parentheses-free operands only (asserted by the
    /// model's shape: a repeated operand is a symbol or a group).
    fn expr(&mut self, expr: &Expr, break_column: usize, atomic: bool) {
        match expr {
            Expr::Literal(text) => self.push(&format!("'{text}'")),
            Expr::CodePoint(code) => self.push(&format!("#x{code:02X}")),
            Expr::Class { negated, items } => {
                let mut s = String::from("[");
                if *negated {
                    s.push('^');
                }
                for item in items {
                    match item {
                        ClassItem::Char(c) => s.push(*c),
                        ClassItem::CodePoint(code) => {
                            let _ = write!(s, "#x{code:02X}");
                        }
                        ClassItem::Range(a, b) => {
                            s.push(*a);
                            s.push('-');
                            s.push(*b);
                        }
                    }
                }
                s.push(']');
                self.push(&s);
            }
            Expr::Ref(name) => self.push(name),
            Expr::Eof => self.push("EOF"),
            Expr::Seq(items) => {
                debug_assert!(!atomic, "a sequence is never an operand");
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        self.push(" ");
                    }
                    self.expr(item, break_column, false);
                }
            }
            Expr::Alt(arms) => {
                debug_assert!(!atomic, "alternatives are never an operand");
                for (index, arm) in arms.iter().enumerate() {
                    if index > 0 {
                        if arm.line_break {
                            self.push(&format!("\n{}| ", " ".repeat(break_column)));
                        } else {
                            self.push(" | ");
                        }
                    }
                    self.expr(&arm.expr, break_column, false);
                }
            }
            Expr::Group(inner) => {
                let open = self.column;
                self.push("( ");
                self.expr(inner, open, false);
                self.push(" )");
            }
            Expr::Repeat(operand, repeat) => {
                self.expr(operand, break_column, true);
                self.push(&repeat.operator().to_string());
            }
            Expr::Except(left, right) => {
                self.expr(left, break_column, false);
                self.push(" - ");
                self.expr(right, break_column, false);
            }
        }
    }
}

// ----- the model ----------------------------------------------------------------

fn lit(text: &'static str) -> Expr {
    Expr::Literal(text)
}

fn cp(code: u32) -> Expr {
    Expr::CodePoint(code)
}

fn r(name: &'static str) -> Expr {
    Expr::Ref(name)
}

fn seq(items: Vec<Expr>) -> Expr {
    Expr::Seq(items)
}

/// Alternatives on one line.
fn alt(items: Vec<Expr>) -> Expr {
    Expr::Alt(
        items
            .into_iter()
            .map(|expr| Arm {
                expr,
                line_break: false,
            })
            .collect(),
    )
}

/// Alternatives; the arms whose index is in `breaks` start a new line.
fn alt_lines(items: Vec<Expr>, breaks: &[usize]) -> Expr {
    Expr::Alt(
        items
            .into_iter()
            .enumerate()
            .map(|(index, expr)| Arm {
                expr,
                line_break: breaks.contains(&index),
            })
            .collect(),
    )
}

fn group(inner: Expr) -> Expr {
    Expr::Group(Box::new(inner))
}

fn opt(operand: Expr) -> Expr {
    Expr::Repeat(Box::new(operand), Repeat::Optional)
}

fn star(operand: Expr) -> Expr {
    Expr::Repeat(Box::new(operand), Repeat::ZeroOrMore)
}

fn plus(operand: Expr) -> Expr {
    Expr::Repeat(Box::new(operand), Repeat::OneOrMore)
}

fn class(items: &[ClassItem]) -> Expr {
    Expr::Class {
        negated: false,
        items: items.to_vec(),
    }
}

fn not_class(items: &[ClassItem]) -> Expr {
    Expr::Class {
        negated: true,
        items: items.to_vec(),
    }
}

use ClassItem::{Char as C, CodePoint as X, Range as R};

/// A production without comments.
fn prod(name: &'static str, level: Level, rhs: Expr) -> Production {
    Production {
        name,
        level,
        rhs,
        derivation: None,
        inline_comments: Vec::new(),
        notes: Vec::new(),
    }
}

fn lexical(name: &'static str, rhs: Expr) -> Part {
    Part::Production(prod(name, Level::Lexical, rhs))
}

fn syntax(name: &'static str, rhs: Expr) -> Part {
    Part::Production(prod(name, Level::Syntactic, rhs))
}

/// `part` (a production) with an inline comment after its line `line`.
fn commented(part: Part, line: usize, gap: usize, text: &'static str) -> Part {
    match part {
        Part::Production(mut production) => {
            production
                .inline_comments
                .push(InlineComment { line, gap, text });
            Part::Production(production)
        }
        other => other,
    }
}

/// `part` (a production) with comment lines under it.
fn noted(part: Part, notes: &[&'static str]) -> Part {
    match part {
        Part::Production(mut production) => {
            production.notes.extend_from_slice(notes);
            Part::Production(production)
        }
        other => other,
    }
}

/// The alternatives of a production that is a list of words.
fn words(list: &[&'static str], breaks: &[usize]) -> Expr {
    alt_lines(list.iter().map(|w| lit(w)).collect(), breaks)
}

/// The keywords (`Keyword`), in grammar order.
pub const KEYWORD_WORDS: [&str; 29] = [
    "bind", "break", "const", "continue", "cpu", "else", "entity", "enum", "export", "false", "fn",
    "for", "if", "import", "in", "let", "match", "material", "on", "param", "prefab", "return",
    "scene", "self", "state", "struct", "true", "var", "while",
];

/// The words reserved for future use (`Reserved`), in grammar order.
pub const RESERVED_WORDS_MODEL: [&str; 27] = [
    "as",
    "async",
    "await",
    "extern",
    "impl",
    "loop",
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

const HEADER: &str = "\
/* =====================================================================
   Mtek language 0.1 — reference grammar
   Authoritative parser: crates/mtek-compiler/src/syntax (handwritten,
   recursive descent + Pratt). This file is the reference used for the
   shared conformance corpus and for generated adapters (GBNF, tree-sitter).
   It is printed by `mtek grammar export --format ebnf` from the grammar
   model (crates/mtek-compiler/src/syntax/grammar_model.rs, decision 0073);
   a test keeps the two equal, so a change edits both.
   Semantic restrictions are noted as [S: <rule-id>: ... (codes)]; they are
   enforced by the compiler (lexer, parser or checker), not by this grammar.
   A fail fixture that exercises one declares `// covers: [S: <rule-id>]`
   (decision 0042; tools/grammar-coverage checks every rule is covered).
   ===================================================================== */";

const SECTION_1: &str = "\
/* ---------------------------------------------------------------------
   1. Lexical grammar
   Tokens are separated by whitespace and comments. Longest match wins,
   with one exception: a digit sequence followed by '..' lexes as Int,
   so `0..n` is Int '..' Ident (a Float requires a digit after '.').
   --------------------------------------------------------------------- */";

const CONTEXTUAL_WORDS: &str = "\
/* Contextual words (ordinary identifiers, meaningful only in position):
   'camera'                  scene-object kind      (SceneObject)
   'update', 'fixed_update', 'ui'  lifecycle functions  (LifecycleFn)
   'fragment'                material stage         (StageFn)
   'from'                    import clause          (Import)
   'shared'                  scene state carry-over (StateDecl)
   'saved', 'setting'        persistent scene state (StateDecl)
   'after', 'every'          timer blocks           (TimerStmt)
   event names after 'on'    resolved via registry  (Handler)             */";

const PUNCTUATION: &str = "\
/* Punctuation and operators */
/*  {  }  (  )  [  ]  <  >  ,  ;  :  .  ..  ->  =>
    +  -  *  /  %  !  =  ==  !=  <=  >=  &&  ||  +=  -=  *=  /=
    The lexer also recognises  &  |  ^  ~  <<  >>  so they can be rejected
    with E1901 (bitwise operators are not in v0.1); '|' also separates the
    patterns of a match arm (Patterns).                                   */";

const SECTION_2: &str = "\
/* ---------------------------------------------------------------------
   2. Modules and items
   --------------------------------------------------------------------- */";

const SECTION_3: &str = "\
/* ---------------------------------------------------------------------
   3. Materials
   --------------------------------------------------------------------- */";

const SECTION_4: &str = "\
/* ---------------------------------------------------------------------
   4. Scenes, entities, prefabs
   Members are distinguished with two tokens of lookahead:
     Ident ':'      -> FieldInit
     Ident Ident    -> SceneObject (only in scene bodies)
     Ident '('      -> LifecycleFn
   --------------------------------------------------------------------- */";

const SECTION_5: &str = "\
/* ---------------------------------------------------------------------
   5. Types
   --------------------------------------------------------------------- */";

const SECTION_6: &str = "\
/* ---------------------------------------------------------------------
   6. Statements
   --------------------------------------------------------------------- */";

const SECTION_7: &str = "\
/* ---------------------------------------------------------------------
   7. Expressions (precedence from loosest to tightest; see the table in
      spec/language.md §6.1). Comparison and equality are NON-associative.
   --------------------------------------------------------------------- */";

const NO_DESC: &str = "\
/* ExprNoDesc is Expr with DescriptorLiteral removed from Primary at the top
   level (it is still allowed inside parentheses, brackets and call arguments).
   It exists only to keep `if x { ... }` unambiguous. A descriptor literal in
   that position is reported as E1011 with a parenthesising edit. Generated
   adapters (GBNF, tree-sitter) must expand this as a duplicated rule set:
   ExprNoDesc, OrExprNoDesc, ..., PrimaryNoDesc.                               */";

/// The content of a block comment that is not `/*`, `*/` or a nested comment.
fn comment_char() -> Expr {
    not_class(&[C('*'), C('/')])
}

/// The model of `spec/grammar.ebnf`.
#[must_use]
#[allow(clippy::too_many_lines)] // one entry per line of the grammar
pub fn grammar() -> GrammarModel {
    use Part::{Blank, Comment};
    let hex = || r("Hex");
    let digits = || class(&[R('0', '9')]);
    let int_part = || {
        alt(vec![
            lit("0"),
            seq(vec![class(&[R('1', '9')]), star(digits())]),
        ])
    };
    let type_annotation = || opt(group(seq(vec![lit(":"), r("Type")])));
    let parens_params = || vec![lit("("), opt(r("ParamList")), lit(")")];
    let return_type = || opt(group(seq(vec![lit("->"), r("Type")])));

    let parts = vec![
        Comment(HEADER),
        Blank,
        Comment(SECTION_1),
        Blank,
        commented(
            lexical(
                "Whitespace",
                plus(group(alt(vec![
                    cp(0x20),
                    cp(0x09),
                    cp(0x0A),
                    seq(vec![cp(0x0D), cp(0x0A)]),
                ]))),
            ),
            0,
            8,
            "/* lone #x0D is an error (E0003) */",
        ),
        commented(
            lexical(
                "LineComment",
                seq(vec![lit("//"), star(not_class(&[X(0x0A), X(0x0D)]))]),
            ),
            0,
            27,
            "/* includes '///' doc comments  */",
        ),
        noted(
            lexical(
                "BlockComment",
                seq(vec![
                    lit("/*"),
                    star(group(alt(vec![
                        seq(vec![star(lit("/")), r("BlockComment")]),
                        seq(vec![plus(lit("/")), comment_char()]),
                        seq(vec![plus(lit("*")), comment_char()]),
                        comment_char(),
                    ]))),
                    star(lit("*")),
                    lit("*/"),
                ]),
            ),
            &[
                "                                                                /* nests; unterminated is E0006  */",
            ],
        ),
        Blank,
        lexical(
            "Ident",
            Expr::Except(
                Box::new(seq(vec![r("IdentStart"), star(r("IdentContinue"))])),
                Box::new(group(alt(vec![r("Keyword"), r("Reserved")]))),
            ),
        ),
        lexical("IdentStart", class(&[R('A', 'Z'), R('a', 'z'), C('_')])),
        noted(
            lexical(
                "IdentContinue",
                class(&[R('A', 'Z'), R('a', 'z'), R('0', '9'), C('_')]),
            ),
            &[
                "                    /* [S: reserved-identifiers: '_' alone and names starting with '__' are rejected (E0012, E0011)] */",
            ],
        ),
        Blank,
        lexical("Keyword", words(&KEYWORD_WORDS, &[8, 16, 24])),
        Blank,
        commented(
            lexical("Reserved", words(&RESERVED_WORDS_MODEL, &[6, 14, 20, 26])),
            4,
            33,
            "/* E0013 when used as a name */",
        ),
        Blank,
        Comment(CONTEXTUAL_WORDS),
        Blank,
        commented(
            lexical("Int", int_part()),
            0,
            26,
            "/* no leading zeros, no suffixes */",
        ),
        lexical(
            "Float",
            seq(vec![
                r("IntPart"),
                lit("."),
                plus(digits()),
                opt(r("Exponent")),
            ]),
        ),
        lexical("IntPart", int_part()),
        lexical(
            "Exponent",
            seq(vec![
                class(&[C('e'), C('E')]),
                opt(class(&[C('+'), C('-')])),
                plus(digits()),
            ]),
        ),
        commented(
            lexical(
                "String",
                seq(vec![
                    lit("\""),
                    star(group(alt(vec![r("StringChar"), r("Escape")]))),
                    lit("\""),
                ]),
            ),
            0,
            3,
            "/* '${' Expr ( ':' '.' [0-9] )? '}' inside is an interpolation (language.md 5.8) */",
        ),
        lexical(
            "StringChar",
            not_class(&[C('"'), C('\\'), X(0x0A), X(0x0D)]),
        ),
        lexical(
            "Escape",
            seq(vec![
                lit("\\"),
                group(alt(vec![
                    lit("\""),
                    lit("\\"),
                    lit("n"),
                    lit("t"),
                    lit("r"),
                    lit("0"),
                    lit("$"),
                    seq(vec![
                        lit("u{"),
                        hex(),
                        opt(hex()),
                        opt(hex()),
                        opt(hex()),
                        opt(hex()),
                        opt(hex()),
                        lit("}"),
                    ]),
                ])),
            ]),
        ),
        lexical(
            "Color",
            seq(vec![
                lit("#"),
                hex(),
                hex(),
                hex(),
                hex(),
                hex(),
                hex(),
                opt(group(seq(vec![hex(), hex()]))),
            ]),
        ),
        lexical("Hex", class(&[R('0', '9'), R('A', 'F'), R('a', 'f')])),
        lexical("Bool", alt(vec![lit("true"), lit("false")])),
        Blank,
        Comment(PUNCTUATION),
        Blank,
        Comment(SECTION_2),
        Blank,
        syntax("Module", seq(vec![star(r("Item")), Expr::Eof])),
        syntax(
            "Item",
            alt_lines(
                vec![
                    r("Import"),
                    seq(vec![
                        opt(lit("export")),
                        group(alt_lines(
                            vec![
                                r("ConstDecl"),
                                r("FnDecl"),
                                r("StructDecl"),
                                r("EnumDecl"),
                                r("MaterialDecl"),
                                r("PrefabDecl"),
                                r("SceneDecl"),
                            ],
                            &[5],
                        )),
                    ]),
                ],
                &[1],
            ),
        ),
        Blank,
        noted(
            syntax(
                "Import",
                seq(vec![
                    lit("import"),
                    lit("{"),
                    r("Ident"),
                    star(group(seq(vec![lit(","), r("Ident")]))),
                    opt(lit(",")),
                    lit("}"),
                    lit("from"),
                    r("String"),
                    lit(";"),
                ]),
            ),
            &[
                "                    /* 'from' is contextual. [S: import-specifier: specifier rules E2030-E2034] */",
            ],
        ),
        Blank,
        syntax(
            "ConstDecl",
            seq(vec![
                lit("const"),
                r("Ident"),
                type_annotation(),
                lit("="),
                r("Expr"),
                lit(";"),
            ]),
        ),
        syntax(
            "FnDecl",
            seq([
                vec![opt(lit("cpu")), lit("fn"), r("Ident")],
                parens_params(),
                vec![return_type(), r("Block")],
            ]
            .concat()),
        ),
        syntax(
            "ParamList",
            seq(vec![
                r("Param"),
                star(group(seq(vec![lit(","), r("Param")]))),
                opt(lit(",")),
            ]),
        ),
        syntax("Param", seq(vec![r("Ident"), lit(":"), r("Type")])),
        Blank,
        syntax(
            "StructDecl",
            seq(vec![
                lit("struct"),
                r("Ident"),
                lit("{"),
                plus(r("StructField")),
                lit("}"),
            ]),
        ),
        syntax(
            "StructField",
            seq(vec![r("Ident"), lit(":"), r("Type"), lit(";")]),
        ),
        Blank,
        noted(
            syntax(
                "EnumDecl",
                seq(vec![
                    lit("enum"),
                    r("Ident"),
                    lit("{"),
                    r("Ident"),
                    star(group(seq(vec![lit(","), r("Ident")]))),
                    opt(lit(",")),
                    lit("}"),
                ]),
            ),
            &[
                "                    /* The Idents in braces are the variants, numbered from 0 in order (decision 0129).",
                "                       [S: enum-variants: variant names are distinct (E2002)] */",
            ],
        ),
        Blank,
        Comment(SECTION_3),
        Blank,
        syntax(
            "MaterialDecl",
            seq(vec![
                lit("material"),
                r("Ident"),
                lit("{"),
                star(r("MaterialMember")),
                lit("}"),
            ]),
        ),
        syntax("MaterialMember", alt(vec![r("ParamDecl"), r("StageFn")])),
        syntax(
            "ParamDecl",
            seq(vec![
                lit("param"),
                r("Ident"),
                lit(":"),
                r("Type"),
                opt(group(seq(vec![lit("="), r("Expr")]))),
                lit(";"),
            ]),
        ),
        noted(
            syntax(
                "StageFn",
                seq([
                    vec![r("Ident")],
                    parens_params(),
                    vec![return_type(), r("Block")],
                ]
                .concat()),
            ),
            &[
                "                    /* [S: stage-name: Ident must be 'fragment' (E4020/E4021); 'vertex'/'compute'",
                "                        are reserved words and are reported as E4901 by the parser] */",
            ],
        ),
        Blank,
        Comment(SECTION_4),
        Blank,
        syntax(
            "SceneDecl",
            seq(vec![
                lit("scene"),
                r("Ident"),
                lit("{"),
                star(r("SceneMember")),
                lit("}"),
            ]),
        ),
        syntax(
            "SceneMember",
            alt_lines(
                vec![
                    r("FieldInit"),
                    r("ConstDecl"),
                    r("StateDecl"),
                    r("SceneObject"),
                    r("EntityDecl"),
                    r("LifecycleFn"),
                    r("Handler"),
                ],
                &[5],
            ),
        ),
        Blank,
        noted(
            syntax(
                "PrefabDecl",
                seq(vec![
                    lit("prefab"),
                    r("Ident"),
                    lit("{"),
                    star(r("EntityMember")),
                    lit("}"),
                ]),
            ),
            &[
                "                    /* [S: prefab-static-assembly-limits: spawning a prefab with children or nesting a prefab instance inside a prefab is E5040] */",
            ],
        ),
        Blank,
        noted(
            syntax(
                "EntityDecl",
                seq(vec![
                    lit("entity"),
                    r("Ident"),
                    opt(group(seq(vec![lit(":"), r("Ident")]))),
                    lit("{"),
                    star(r("EntityMember")),
                    lit("}"),
                ]),
            ),
            &[
                "                    /* ': Ident' instantiates a prefab. [S: prefab-instance-params: then only FieldInit",
                "                       naming prefab params is allowed (E5042)] */",
            ],
        ),
        noted(
            syntax(
                "EntityMember",
                alt_lines(
                    vec![
                        r("FieldInit"),
                        r("ConstDecl"),
                        r("StateDecl"),
                        r("ParamDecl"),
                        r("EntityDecl"),
                        r("LifecycleFn"),
                        r("Handler"),
                    ],
                    &[5],
                ),
            ),
            &[
                "                    /* [S: param-only-in-prefab: ParamDecl only inside prefabs (E1040)] */",
            ],
        ),
        Blank,
        noted(
            syntax(
                "SceneObject",
                seq(vec![
                    r("Ident"),
                    r("Ident"),
                    lit("{"),
                    star(r("FieldInit")),
                    lit("}"),
                ]),
            ),
            &[
                "                    /* [S: scene-object-kind: first Ident is a registered scene-object kind: 'camera' (E5014 \"unknown scene object kind\" otherwise)] */",
            ],
        ),
        Blank,
        noted(
            syntax(
                "StateDecl",
                seq(vec![
                    opt(lit("shared")),
                    opt(group(alt(vec![lit("saved"), lit("setting")]))),
                    lit("state"),
                    r("Ident"),
                    lit(":"),
                    r("Type"),
                    lit("="),
                    r("Expr"),
                    lit(";"),
                ]),
            ),
            &[
                "                    /* [S: shared-state: 'shared' is contextual; shared state is declared in a scene only (E5202),",
                "                        has a type that can carry over a scene change (E5203) and one type in every scene (E5204)] */",
                "                    /* [S: saved-state: 'saved' and 'setting' are contextual; persistent state is declared in a scene only (E5210),",
                "                        has a type that can be stored (E5211) and one type and kind in every scene (E5212)] */",
            ],
        ),
        syntax(
            "FieldInit",
            seq(vec![r("Ident"), lit(":"), r("FieldValue"), lit(";")]),
        ),
        noted(
            syntax(
                "FieldValue",
                alt(vec![
                    seq(vec![lit("bind"), lit("("), r("Expr"), lit(")")]),
                    r("Expr"),
                ]),
            ),
            &[
                "                    /* [S: bind-bindable-field: bind only on bindable fields (E5004)] */",
            ],
        ),
        Blank,
        noted(
            syntax(
                "LifecycleFn",
                seq([vec![r("Ident")], parens_params(), vec![r("Block")]].concat()),
            ),
            &[
                "                    /* [S: lifecycle-signature: 'update' | 'fixed_update' | 'ui' (a scene only) with exactly (name: f32),",
                "                        at most one of each per body (E5050-E5052)] */",
            ],
        ),
        Blank,
        syntax(
            "Handler",
            seq(vec![
                lit("on"),
                r("Ident"),
                lit("("),
                opt(r("HandlerArgs")),
                lit(")"),
                r("Block"),
            ]),
        ),
        syntax(
            "HandlerArgs",
            seq(vec![
                r("HandlerArg"),
                star(group(seq(vec![lit(","), r("HandlerArg")]))),
                opt(lit(",")),
            ]),
        ),
        commented(
            commented(
                noted(
                    syntax(
                        "HandlerArg",
                        alt_lines(
                            vec![seq(vec![r("Ident"), lit(":"), r("Type")]), r("Expr")],
                            &[1],
                        ),
                    ),
                    &[
                        "                    /* disambiguation: Ident followed by ':' is the parameter form        */",
                    ],
                ),
                0,
                12,
                "/* parameter form, e.g. other: entity_ref   */",
            ),
            1,
            23,
            "/* filter form, e.g. Key.Space              */",
        ),
        Blank,
        Comment(SECTION_5),
        Blank,
        syntax(
            "Type",
            seq(vec![
                r("Ident"),
                opt(group(seq(vec![
                    lit("<"),
                    r("Type"),
                    lit(","),
                    r("ArrayLength"),
                    lit(">"),
                ]))),
            ]),
        ),
        noted(
            syntax("ArrayLength", alt(vec![r("Int"), r("Ident")])),
            &[
                "                    /* [S: array-type-arguments: only 'array' takes arguments, and it needs them (E3003);",
                "                        Ident must name an integer constant, the length is 1 to 65 536 (E3031)] */",
            ],
        ),
        Blank,
        Comment(SECTION_6),
        Blank,
        syntax("Block", seq(vec![lit("{"), star(r("Statement")), lit("}")])),
        syntax(
            "Statement",
            alt_lines(
                vec![
                    r("LetStmt"),
                    r("VarStmt"),
                    r("ConstDecl"),
                    r("IfStmt"),
                    r("ForStmt"),
                    r("WhileStmt"),
                    r("TimerStmt"),
                    r("MatchStmt"),
                    r("ReturnStmt"),
                    r("BreakStmt"),
                    r("ContinueStmt"),
                    r("Block"),
                    r("SimpleStmt"),
                ],
                &[6],
            ),
        ),
        Blank,
        syntax(
            "LetStmt",
            seq(vec![
                lit("let"),
                r("Ident"),
                type_annotation(),
                lit("="),
                r("Expr"),
                lit(";"),
            ]),
        ),
        syntax(
            "VarStmt",
            seq(vec![
                lit("var"),
                r("Ident"),
                type_annotation(),
                lit("="),
                r("Expr"),
                lit(";"),
            ]),
        ),
        noted(
            syntax(
                "SimpleStmt",
                seq(vec![
                    r("Expr"),
                    opt(group(seq(vec![r("AssignOp"), r("Expr")]))),
                    lit(";"),
                ]),
            ),
            &[
                "                    /* [S: simple-statement: without AssignOp, Expr must be a call (E1020);",
                "                        with AssignOp, the left side must be a place (E3061)] */",
            ],
        ),
        syntax(
            "AssignOp",
            alt(vec![lit("="), lit("+="), lit("-="), lit("*="), lit("/=")]),
        ),
        Blank,
        syntax(
            "IfStmt",
            seq(vec![
                lit("if"),
                r("ExprNoDesc"),
                r("Block"),
                opt(group(seq(vec![
                    lit("else"),
                    group(alt(vec![r("IfStmt"), r("Block")])),
                ]))),
            ]),
        ),
        syntax(
            "ForStmt",
            seq(vec![
                lit("for"),
                r("Ident"),
                lit("in"),
                r("ExprNoDesc"),
                opt(group(seq(vec![lit(".."), r("ExprNoDesc")]))),
                r("Block"),
            ]),
        ),
        noted(
            syntax(
                "WhileStmt",
                seq(vec![lit("while"), r("ExprNoDesc"), r("Block")]),
            ),
            &[
                "                    /* [S: while-loop: the condition is bool (E3070); CPU only (E4010 in GPU code)] */",
            ],
        ),
        noted(
            syntax(
                "TimerStmt",
                seq(vec![
                    group(alt(vec![lit("after"), lit("every")])),
                    lit("("),
                    r("Expr"),
                    lit(")"),
                    r("Block"),
                ]),
            ),
            &[
                "                    /* [S: timer: 'after' and 'every' are contextual; the time is f32 seconds (E3001), a constant one",
                "                        positive for 'every' and not negative for 'after' (E3211); handlers only (E5080);",
                "                        the block cannot use a 'var' of the enclosing body (E3210)] */",
            ],
        ),
        syntax(
            "ReturnStmt",
            seq(vec![lit("return"), opt(r("Expr")), lit(";")]),
        ),
        syntax("BreakStmt", seq(vec![lit("break"), lit(";")])),
        syntax("ContinueStmt", seq(vec![lit("continue"), lit(";")])),
        Blank,
        syntax(
            "MatchStmt",
            seq(vec![
                lit("match"),
                r("ExprNoDesc"),
                lit("{"),
                plus(r("MatchStmtArm")),
                lit("}"),
            ]),
        ),
        syntax(
            "MatchStmtArm",
            seq(vec![r("Patterns"), lit("=>"), r("Block"), opt(lit(","))]),
        ),
        syntax(
            "Patterns",
            seq(vec![
                r("Pattern"),
                star(group(seq(vec![lit("|"), r("Pattern")]))),
            ]),
        ),
        noted(
            syntax(
                "Pattern",
                alt(vec![lit("_"), seq(vec![r("Ident"), lit("."), r("Ident")])]),
            ),
            &[
                "                    /* Ident '.' Ident names a variant: Enum.Variant (decision 0129).",
                "                       [S: match-patterns: the value matched is of an enum type (E3203); each Pattern",
                "                       is a variant of that enum (E3204); every arm can match (E3202); the arms cover",
                "                       every variant or one is '_' (E3201)] */",
            ],
        ),
        Blank,
        Comment(SECTION_7),
        Blank,
        syntax("Expr", r("OrExpr")),
        syntax(
            "OrExpr",
            seq(vec![
                r("AndExpr"),
                star(group(seq(vec![lit("||"), r("AndExpr")]))),
            ]),
        ),
        syntax(
            "AndExpr",
            seq(vec![
                r("EqExpr"),
                star(group(seq(vec![lit("&&"), r("EqExpr")]))),
            ]),
        ),
        syntax(
            "EqExpr",
            seq(vec![
                r("RelExpr"),
                opt(group(seq(vec![
                    group(alt(vec![lit("=="), lit("!=")])),
                    r("RelExpr"),
                ]))),
            ]),
        ),
        syntax(
            "RelExpr",
            seq(vec![
                r("AddExpr"),
                opt(group(seq(vec![
                    group(alt(vec![lit("<"), lit("<="), lit(">"), lit(">=")])),
                    r("AddExpr"),
                ]))),
            ]),
        ),
        syntax(
            "AddExpr",
            seq(vec![
                r("MulExpr"),
                star(group(seq(vec![
                    group(alt(vec![lit("+"), lit("-")])),
                    r("MulExpr"),
                ]))),
            ]),
        ),
        syntax(
            "MulExpr",
            seq(vec![
                r("UnaryExpr"),
                star(group(seq(vec![
                    group(alt(vec![lit("*"), lit("/"), lit("%")])),
                    r("UnaryExpr"),
                ]))),
            ]),
        ),
        syntax(
            "UnaryExpr",
            alt(vec![
                seq(vec![group(alt(vec![lit("-"), lit("!")])), r("UnaryExpr")]),
                r("PostfixExpr"),
            ]),
        ),
        syntax("PostfixExpr", seq(vec![r("Primary"), star(r("PostfixOp"))])),
        syntax(
            "PostfixOp",
            alt(vec![
                seq(vec![lit("("), opt(r("ArgList")), lit(")")]),
                seq(vec![lit("."), r("Ident")]),
                seq(vec![lit("["), r("Expr"), lit("]")]),
            ]),
        ),
        syntax(
            "ArgList",
            seq(vec![
                r("Expr"),
                star(group(seq(vec![lit(","), r("Expr")]))),
                opt(lit(",")),
            ]),
        ),
        Blank,
        syntax(
            "Primary",
            alt_lines(
                vec![
                    r("Int"),
                    r("Float"),
                    r("String"),
                    r("Color"),
                    r("Bool"),
                    lit("self"),
                    r("Ident"),
                    seq(vec![lit("("), r("Expr"), lit(")")]),
                    r("ArrayLiteral"),
                    r("DescriptorLiteral"),
                    r("MatchExpr"),
                ],
                &[5, 6, 7, 8, 9, 10],
            ),
        ),
        Blank,
        syntax(
            "ArrayLiteral",
            seq(vec![
                lit("["),
                r("Expr"),
                star(group(seq(vec![lit(","), r("Expr")]))),
                opt(lit(",")),
                lit("]"),
            ]),
        ),
        syntax(
            "DescriptorLiteral",
            seq(vec![
                r("Ident"),
                lit("{"),
                opt(group(seq(vec![
                    r("DescField"),
                    star(group(seq(vec![lit(";"), r("DescField")]))),
                    opt(lit(";")),
                ]))),
                lit("}"),
            ]),
        ),
        syntax(
            "DescField",
            seq(vec![r("Ident"), lit(":"), r("FieldValue")]),
        ),
        noted(
            syntax(
                "MatchExpr",
                seq(vec![
                    lit("match"),
                    r("ExprNoDesc"),
                    lit("{"),
                    r("MatchExprArm"),
                    star(group(seq(vec![lit(","), r("MatchExprArm")]))),
                    opt(lit(",")),
                    lit("}"),
                ]),
            ),
            &[
                "                    /* A 'match' that starts a statement is a MatchStmt. [S: match-arm-types: the",
                "                       arm values have one type (E3206)] */",
            ],
        ),
        syntax(
            "MatchExprArm",
            seq(vec![r("Patterns"), lit("=>"), r("Expr")]),
        ),
        Blank,
        Comment(NO_DESC),
        commented(
            Part::Production(Production {
                derivation: Some(Derivation::WithoutAtTopLevel {
                    base: "Expr",
                    removed: "DescriptorLiteral",
                }),
                ..prod("ExprNoDesc", Level::Syntactic, r("Expr"))
            }),
            0,
            3,
            "/* with the restriction above */",
        ),
    ];
    GrammarModel { parts }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::syntax::{KEYWORDS, RESERVED_WORDS};

    #[test]
    fn the_word_lists_are_the_lexers() {
        let mut keywords: Vec<&str> = KEYWORDS.iter().map(|(word, _)| *word).collect();
        keywords.sort_unstable();
        let mut model: Vec<&str> = KEYWORD_WORDS.to_vec();
        model.sort_unstable();
        assert_eq!(model, keywords);
        let mut reserved: Vec<&str> = RESERVED_WORDS.to_vec();
        reserved.sort_unstable();
        let mut model: Vec<&str> = RESERVED_WORDS_MODEL.to_vec();
        model.sort_unstable();
        assert_eq!(model, reserved);
    }

    #[test]
    fn every_reference_names_a_production() {
        let model = grammar();
        fn refs<'a>(expr: &'a Expr, out: &mut Vec<&'a str>) {
            match expr {
                Expr::Ref(name) => out.push(name),
                Expr::Seq(items) => items.iter().for_each(|e| refs(e, out)),
                Expr::Alt(arms) => arms.iter().for_each(|a| refs(&a.expr, out)),
                Expr::Group(inner) | Expr::Repeat(inner, _) => refs(inner, out),
                Expr::Except(a, b) => {
                    refs(a, out);
                    refs(b, out);
                }
                Expr::Literal(_) | Expr::CodePoint(_) | Expr::Class { .. } | Expr::Eof => {}
            }
        }
        for production in model.productions() {
            let mut names = Vec::new();
            refs(&production.rhs, &mut names);
            for name in names {
                assert!(
                    model.production(name).is_some(),
                    "{} refers to {name}",
                    production.name
                );
            }
        }
        assert_eq!(model.productions().count(), 82);
    }

    #[test]
    fn literals_need_no_quoting() {
        fn check(expr: &Expr) {
            match expr {
                Expr::Literal(text) => assert!(!text.contains('\'') && !text.is_empty()),
                Expr::Seq(items) => items.iter().for_each(check),
                Expr::Alt(arms) => arms.iter().for_each(|a| check(&a.expr)),
                Expr::Group(inner) | Expr::Repeat(inner, _) => check(inner),
                Expr::Except(a, b) => {
                    check(a);
                    check(b);
                }
                Expr::CodePoint(_) | Expr::Class { .. } | Expr::Ref(_) | Expr::Eof => {}
            }
        }
        grammar().productions().for_each(|p| check(&p.rhs));
    }
}
