//! The GBNF translation of the grammar model (`spec/ai-and-benchmarks.md`
//! section 3, decision 0073): the text `mtek grammar export --format gbnf`
//! prints, for llama.cpp's grammar-constrained sampling ([S9]).
//!
//! GBNF is a grammar over characters, the reference grammar one over tokens.
//! The translation therefore does what the lexer does implicitly:
//!
//! * **Separators.** Every token of a syntactic production is preceded by a
//!   separator: `ws` (whitespace and comments, possibly none) or `ws1` (at
//!   least one whitespace character or comment) where two tokens written
//!   together would lex differently: a word followed by a word (`fn main`,
//!   not `fnmain`), and an integer followed by the `.` of a field access
//!   (`1 .x`, because `1.x` is the malformed float `1.`, E0022). Which
//!   separator a token needs depends on the token before it, which can come
//!   from another production, so productions are emitted in *variants* by
//!   the class of the token before them (`-aw`: after a word, `-ai`: after an
//!   integer) and, where the next token cares, by the class of their last
//!   token (`-ei`, `-ewp`, …). This is the intersection of the grammar with
//!   the small automaton that tracks the class of the last token; it keeps
//!   the grammar unambiguous and adds no strings and drops none.
//! * **Identifiers** exclude the keywords and reserved words by a trie over
//!   the words (`ident`, `ident-x-…`), GBNF having no difference operator.
//! * **`ExprNoDesc`** is expanded as the duplicated rule set the grammar asks
//!   for (`expr-no-desc`, `or-expr-no-desc`, …, `primary-no-desc`).
//! * **Nested block comments** are a recursive rule (`block-comment`), with no
//!   depth bound, as in the lexer.
//! * **`root`** accepts one module: an optional byte-order mark, the items,
//!   trailing whitespace and comments, and a line comment that ends the file
//!   without a line break.
//!
//! Where the compiler accepts or rejects more precisely than the reference
//! grammar says, the translation follows the compiler (decision 0005): the
//! keyword `material` is a field name (decision 0023 item 1), a lone carriage
//! return is never accepted (E0003), a `\u{…}` escape must name a Unicode
//! scalar value (E0023), and `_` (a token of its own) cannot name a
//! descriptor literal or a scene object (E1001). Everything else is the model as written; the
//! `[S: …]` restrictions are not expressed, so the grammar accepts programs
//! the compiler then rejects with those codes. The grammar does not bound the
//! length of the output: the caller enforces a maximum (the harness's
//! `maxOutputTokens`) and treats a generation that reaches it as truncated.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;

use super::grammar_model::{
    ClassItem, Derivation, Expr, GrammarModel, Level, Production, Repeat, grammar,
};

/// The start rule of the exported grammar.
pub const GBNF_ROOT: &str = "root";

/// The GBNF translation of the grammar model. The error names a model shape
/// the translation does not know (a change to the grammar that needs a
/// change here); the model of this build translates.
///
/// # Errors
///
/// When the grammar model has a construct the translation cannot express.
pub fn gbnf() -> Result<String, String> {
    let model = grammar();
    Translator::new(&model)?.run()
}

// ----- the GBNF syntax tree -----------------------------------------------------

#[derive(Clone, PartialEq, Eq, Debug)]
enum G {
    /// The empty string.
    Empty,
    /// Characters, matched literally.
    Lit(String),
    /// A character class over code-point ranges.
    Class {
        negated: bool,
        ranges: Vec<(u32, u32)>,
    },
    Sym(String),
    Seq(Vec<G>),
    Alt(Vec<G>),
    Rep(Box<G>, Repeat),
    /// `{min,max}`.
    Times(Box<G>, u32, u32),
}

fn seq(items: Vec<G>) -> G {
    let mut flat = Vec::new();
    for item in items {
        match item {
            G::Empty => {}
            G::Seq(inner) => flat.extend(inner),
            other => flat.push(other),
        }
    }
    match flat.len() {
        0 => G::Empty,
        1 => flat.pop().unwrap_or(G::Empty),
        _ => G::Seq(flat),
    }
}

fn alt(items: Vec<G>) -> Option<G> {
    let mut flat: Vec<G> = Vec::new();
    for item in items {
        match item {
            G::Alt(inner) => {
                for g in inner {
                    if !flat.contains(&g) {
                        flat.push(g);
                    }
                }
            }
            other => {
                if !flat.contains(&other) {
                    flat.push(other);
                }
            }
        }
    }
    match flat.len() {
        0 => None,
        1 => flat.pop(),
        _ => Some(G::Alt(flat)),
    }
}

fn sym(name: &str) -> G {
    G::Sym(name.to_owned())
}

fn lit(text: &str) -> G {
    G::Lit(text.to_owned())
}

fn star(g: G) -> G {
    G::Rep(Box::new(g), Repeat::ZeroOrMore)
}

fn class(ranges: &[(u32, u32)]) -> G {
    G::Class {
        negated: false,
        ranges: ranges.to_vec(),
    }
}

// ----- printing -----------------------------------------------------------------

fn escape_char(c: char, in_class: bool, out: &mut String) {
    match c {
        '\n' => out.push_str("\\n"),
        '\r' => out.push_str("\\r"),
        '\t' => out.push_str("\\t"),
        '\\' => out.push_str("\\\\"),
        '"' if !in_class => out.push_str("\\\""),
        '[' | ']' | '-' | '^' if in_class => {
            let _ = write!(out, "\\x{:02X}", u32::from(c));
        }
        c if c.is_ascii_graphic() || c == ' ' => out.push(c),
        c if u32::from(c) <= 0xFF => {
            let _ = write!(out, "\\x{:02X}", u32::from(c));
        }
        c if u32::from(c) <= 0xFFFF => {
            let _ = write!(out, "\\u{:04X}", u32::from(c));
        }
        c => {
            let _ = write!(out, "\\U{:08X}", u32::from(c));
        }
    }
}

fn print_code_point(code: u32, out: &mut String) {
    match char::from_u32(code) {
        Some(c) => escape_char(c, true, out),
        None => {
            let _ = write!(out, "\\U{code:08X}");
        }
    }
}

/// How tightly `g` binds: 0 alternatives, 1 sequence, 2 atom.
fn precedence(g: &G) -> u8 {
    match g {
        G::Alt(_) => 0,
        G::Seq(_) => 1,
        _ => 2,
    }
}

fn print(g: &G, out: &mut String) {
    match g {
        G::Empty => out.push_str("\"\""),
        G::Lit(text) => {
            out.push('"');
            for c in text.chars() {
                escape_char(c, false, out);
            }
            out.push('"');
        }
        G::Class { negated, ranges } => {
            out.push('[');
            if *negated {
                out.push('^');
            }
            for &(a, b) in ranges {
                print_code_point(a, out);
                if b != a {
                    out.push('-');
                    print_code_point(b, out);
                }
            }
            out.push(']');
        }
        G::Sym(name) => out.push_str(name),
        G::Seq(items) => {
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(' ');
                }
                print_operand(item, 1, out);
            }
        }
        G::Alt(items) => {
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push_str(" | ");
                }
                print(item, out);
            }
        }
        G::Rep(inner, repeat) => {
            print_operand(inner, 2, out);
            out.push(repeat.operator());
        }
        G::Times(inner, min, max) => {
            print_operand(inner, 2, out);
            let _ = write!(out, "{{{min},{max}}}");
        }
    }
}

fn print_operand(g: &G, needed: u8, out: &mut String) {
    if precedence(g) < needed {
        out.push_str("( ");
        print(g, out);
        out.push_str(" )");
    } else {
        print(g, out);
    }
}

/// `Alt` with `Empty` among its arms becomes `( … )?`, recursively.
fn normalize(g: G) -> G {
    match g {
        G::Alt(items) => {
            let has_empty = items.contains(&G::Empty);
            let rest: Vec<G> = items
                .into_iter()
                .filter(|g| *g != G::Empty)
                .map(normalize)
                .collect();
            let inner = alt(rest).unwrap_or(G::Empty);
            if has_empty && inner != G::Empty {
                G::Rep(Box::new(inner), Repeat::Optional)
            } else {
                inner
            }
        }
        G::Seq(items) => seq(items.into_iter().map(normalize).collect()),
        G::Rep(inner, repeat) => G::Rep(Box::new(normalize(*inner)), repeat),
        G::Times(inner, a, b) => G::Times(Box::new(normalize(*inner)), a, b),
        other => other,
    }
}

// ----- names --------------------------------------------------------------------

/// `FnDecl` -> `fn-decl`, `ExprNoDesc` -> `expr-no-desc`.
fn kebab(name: &str) -> String {
    let mut out = String::new();
    for (index, c) in name.chars().enumerate() {
        if c.is_ascii_uppercase() {
            if index > 0 {
                out.push('-');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

// ----- token classes ------------------------------------------------------------

/// The class of the last character of a token, as far as the next token
/// cares: a word (identifier, keyword, float, colour), an integer, or
/// punctuation. The start of the file counts as punctuation.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
enum Last {
    Word,
    Int,
    Punct,
}

const LASTS: [Last; 3] = [Last::Word, Last::Int, Last::Punct];

impl Last {
    fn bit(self) -> u8 {
        match self {
            Last::Word => 1,
            Last::Int => 2,
            Last::Punct => 4,
        }
    }

    fn tag(self) -> &'static str {
        match self {
            Last::Word => "w",
            Last::Int => "i",
            Last::Punct => "p",
        }
    }
}

const ALL_LASTS: u8 = 7;

/// The class of the first character of a token: a word, the `.` of a field
/// access, or other punctuation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum First {
    Word,
    Dot,
    Punct,
}

impl First {
    fn bit(self) -> u8 {
        match self {
            First::Word => 1,
            First::Dot => 2,
            First::Punct => 4,
        }
    }
}

/// Whether a token of class `first` needs at least one separator after a
/// token of class `last` (otherwise the lexer would read the two together).
fn needs_separator(last: Last, first: First) -> bool {
    matches!(
        (last, first),
        (Last::Word | Last::Int, First::Word) | (Last::Int, First::Dot)
    )
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// A terminal of the syntactic grammar.
#[derive(Clone, Debug)]
struct Token {
    gbnf: G,
    first: First,
    last: Last,
}

fn literal_token(text: &str) -> Token {
    let first = match text.chars().next() {
        Some(c) if is_word_char(c) => First::Word,
        _ if text == "." => First::Dot,
        _ => First::Punct,
    };
    let last = match text.chars().last() {
        Some(c) if is_word_char(c) => Last::Word,
        _ => Last::Punct,
    };
    Token {
        gbnf: lit(text),
        first,
        last,
    }
}

/// The lexical productions the syntactic grammar refers to, as tokens:
/// `(production, first class, last class)`. A colour ends in a hexadecimal
/// digit, which joins a following word (`#ffffffx` is E0025); an integer
/// joins a following `.` (`1.x` is E0022).
const LEXICAL_TOKENS: [(&str, First, Last); 6] = [
    ("Ident", First::Word, Last::Word),
    ("Int", First::Word, Last::Int),
    ("Float", First::Word, Last::Word),
    ("String", First::Punct, Last::Punct),
    ("Color", First::Punct, Last::Word),
    ("Bool", First::Word, Last::Word),
];

/// The field-name token of decision 0023 item 1: an identifier or the keyword
/// `material`.
const FIELD_NAME: &str = "field-name";

// ----- the translator -------------------------------------------------------------

/// What a part of a syntactic expression can start and end with.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
struct Shape {
    /// `First` bits.
    first: u8,
    /// `Last` bits.
    last: u8,
    nullable: bool,
}

/// A rule variant: a production (or a repetition helper) entered after a
/// token of class `after`, restricted to derivations whose last token is in
/// `ends` (or, for the empty derivation, `after` is).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
struct Variant {
    rule: String,
    after: Last,
    ends: u8,
}

struct Translator<'m> {
    model: &'m GrammarModel,
    /// The syntactic rules, including the `NoDesc` copies, by model name.
    rules: BTreeMap<String, Expr>,
    /// Their order of appearance (model order, copies after their originals).
    order: Vec<String>,
    shapes: HashMap<String, Shape>,
    /// Repetition helpers: the repeated expression, by helper name.
    helpers: BTreeMap<String, Expr>,
    /// Helper names by the identity of their expression.
    /// `(context, repeated expression, helper name)`: a repetition is the same
    /// helper wherever the same expression repeats in the same production.
    helper_ids: Vec<(String, Expr, String)>,
    variants: BTreeMap<Variant, Option<G>>,
    pending: Vec<Variant>,
    /// Lexical productions to emit.
    lexical: BTreeSet<&'static str>,
}

impl<'m> Translator<'m> {
    fn new(model: &'m GrammarModel) -> Result<Self, String> {
        let mut rules = BTreeMap::new();
        let mut order: Vec<String> = Vec::new();
        let syntactic: Vec<&Production> = model
            .productions()
            .filter(|p| p.level == Level::Syntactic)
            .collect();
        for production in syntactic.iter().filter(|p| p.derivation.is_none()) {
            rules.insert(production.name.to_owned(), field_names(production)?);
            order.push(production.name.to_owned());
        }
        // The derived productions are expanded once every original is known;
        // their copies follow the originals.
        for production in &syntactic {
            let Some(Derivation::WithoutAtTopLevel { base, removed }) = &production.derivation
            else {
                continue;
            };
            if production.rhs != Expr::Ref(base) {
                return Err(format!(
                    "{} is derived from {base} but its right-hand side is not {base}",
                    production.name
                ));
            }
            let suffix = production
                .name
                .strip_prefix(base)
                .ok_or_else(|| format!("{} does not extend the name {base}", production.name))?;
            for (copy, rhs) in without_at_top_level(&rules, &order, base, removed, suffix)? {
                order.push(copy.clone());
                rules.insert(copy, rhs);
            }
        }
        let expanded_order = order;
        let mut translator = Translator {
            model,
            rules,
            order: expanded_order,
            shapes: HashMap::new(),
            helpers: BTreeMap::new(),
            helper_ids: Vec::new(),
            variants: BTreeMap::new(),
            pending: Vec::new(),
            lexical: BTreeSet::new(),
        };
        translator.compute_shapes()?;
        Ok(translator)
    }

    // ----- shapes ---------------------------------------------------------------

    fn token(&mut self, expr: &Expr) -> Result<Option<Token>, String> {
        match expr {
            Expr::Literal(text) => Ok(Some(literal_token(text))),
            Expr::Ref(name) if *name == FIELD_NAME || *name == NAMED => {
                self.lexical.insert("Ident");
                Ok(Some(Token {
                    gbnf: sym(name),
                    first: First::Word,
                    last: Last::Word,
                }))
            }
            Expr::Ref(name) if !self.rules.contains_key(*name) => {
                let Some((production, first, last)) =
                    LEXICAL_TOKENS.iter().find(|(p, _, _)| p == name)
                else {
                    return Err(format!(
                        "the syntactic grammar uses the lexical production {name}, which has no token class"
                    ));
                };
                self.lexical.insert(production);
                Ok(Some(Token {
                    gbnf: sym(&kebab(production)),
                    first: *first,
                    last: *last,
                }))
            }
            _ => Ok(None),
        }
    }

    fn compute_shapes(&mut self) -> Result<(), String> {
        for name in self.rules.keys() {
            self.shapes.insert(name.clone(), Shape::default());
        }
        loop {
            let mut changed = false;
            let names: Vec<String> = self.rules.keys().cloned().collect();
            for name in names {
                let rhs = self.rules.get(&name).cloned().unwrap_or(Expr::Eof);
                let shape = self.shape(&rhs)?;
                if self.shapes.get(&name) != Some(&shape) {
                    self.shapes.insert(name, shape);
                    changed = true;
                }
            }
            if !changed {
                return Ok(());
            }
        }
    }

    fn shape(&mut self, expr: &Expr) -> Result<Shape, String> {
        if let Some(token) = self.token(expr)? {
            return Ok(Shape {
                first: token.first.bit(),
                last: token.last.bit(),
                nullable: false,
            });
        }
        Ok(match expr {
            Expr::Ref(name) => self.shapes.get(*name).copied().unwrap_or_default(),
            Expr::Eof => Shape {
                nullable: true,
                ..Shape::default()
            },
            Expr::Seq(items) => self.shape_of_seq(items)?,
            Expr::Alt(arms) => {
                let mut shape = Shape::default();
                for arm in arms {
                    let s = self.shape(&arm.expr)?;
                    shape.first |= s.first;
                    shape.last |= s.last;
                    shape.nullable |= s.nullable;
                }
                shape
            }
            Expr::Group(inner) => self.shape(inner)?,
            Expr::Repeat(inner, repeat) => {
                let s = self.shape(inner)?;
                Shape {
                    nullable: s.nullable || *repeat != Repeat::OneOrMore,
                    ..s
                }
            }
            Expr::Literal(_) | Expr::CodePoint(_) | Expr::Class { .. } | Expr::Except(..) => {
                return Err(format!(
                    "a lexical construct in a syntactic production: {expr:?}"
                ));
            }
        })
    }

    fn shape_of_seq(&mut self, items: &[Expr]) -> Result<Shape, String> {
        let mut shape = Shape {
            nullable: true,
            ..Shape::default()
        };
        for item in items {
            let s = self.shape(item)?;
            if shape.nullable {
                shape.first |= s.first;
            }
            if s.nullable {
                shape.last |= s.last;
            } else {
                shape.last = s.last;
            }
            shape.nullable &= s.nullable;
        }
        Ok(shape)
    }

    /// The classes the last token can have when `shape` is entered after
    /// `after` (the empty derivation leaves `after` the last).
    fn possible_last(shape: Shape, after: Last) -> u8 {
        shape.last | if shape.nullable { after.bit() } else { 0 }
    }

    /// The representative of the classes that behave like `after` in front of
    /// `shape` restricted to `ends`: same separators before its first tokens
    /// and the same answer for the empty derivation.
    fn canonical(shape: Shape, after: Last, ends: u8) -> Last {
        let key = |last: Last| {
            (
                shape.first & First::Word.bit() != 0 && needs_separator(last, First::Word),
                shape.first & First::Dot.bit() != 0 && needs_separator(last, First::Dot),
                shape.nullable && ends & last.bit() != 0,
            )
        };
        let wanted = key(after);
        [Last::Punct, Last::Word, Last::Int]
            .into_iter()
            .find(|c| key(*c) == wanted)
            .unwrap_or(after)
    }

    // ----- compiling ------------------------------------------------------------

    fn separator(after: Last, first: First) -> G {
        if needs_separator(after, first) {
            sym("ws1")
        } else {
            sym("ws")
        }
    }

    /// `expr` after a token of class `after`, ending in one of `ends`.
    fn compile(
        &mut self,
        context: &str,
        expr: &Expr,
        after: Last,
        ends: u8,
    ) -> Result<Option<G>, String> {
        if let Some(token) = self.token(expr)? {
            if ends & token.last.bit() == 0 {
                return Ok(None);
            }
            return Ok(Some(seq(vec![
                Self::separator(after, token.first),
                token.gbnf,
            ])));
        }
        match expr {
            Expr::Ref(name) => Ok(self.request(name, after, ends)),
            Expr::Eof => Ok((ends & after.bit() != 0).then_some(G::Empty)),
            Expr::Seq(items) => self.compile_seq(context, items, after, ends),
            Expr::Alt(arms) => {
                let mut out = Vec::new();
                for arm in arms {
                    if let Some(g) = self.compile(context, &arm.expr, after, ends)? {
                        out.push(g);
                    }
                }
                Ok(alt(out))
            }
            Expr::Group(inner) => self.compile(context, inner, after, ends),
            Expr::Repeat(inner, Repeat::Optional) => {
                let mut out = Vec::new();
                if ends & after.bit() != 0 {
                    out.push(G::Empty);
                }
                if let Some(g) = self.compile(context, inner, after, ends)? {
                    out.push(g);
                }
                Ok(alt(out))
            }
            Expr::Repeat(inner, Repeat::ZeroOrMore) => self.repetition(context, inner, after, ends),
            Expr::Repeat(inner, Repeat::OneOrMore) => {
                self.compile_plus(context, inner, after, ends)
            }
            Expr::Literal(_) | Expr::CodePoint(_) | Expr::Class { .. } | Expr::Except(..) => Err(
                format!("a lexical construct in the syntactic production {context}: {expr:?}"),
            ),
        }
    }

    /// `x x*` for `x+` (the repetition is keyed by `inner` itself, so that
    /// its helper is shared with a `x*` of the same expression).
    fn compile_plus(
        &mut self,
        context: &str,
        inner: &Expr,
        after: Last,
        ends: u8,
    ) -> Result<Option<G>, String> {
        let head = self.shape(inner)?;
        let rest = self.repetition_shape(inner)?;
        let mut out = Vec::new();
        for (members, rep) in self.groups(head, after, rest, ends) {
            let Some(left) = self.compile(context, inner, after, members)? else {
                continue;
            };
            let Some(right) = self.repetition(context, inner, rep, ends)? else {
                continue;
            };
            out.push(seq(vec![left, right]));
        }
        Ok(alt(out))
    }

    fn repetition_shape(&mut self, inner: &Expr) -> Result<Shape, String> {
        let s = self.shape(inner)?;
        Ok(Shape {
            nullable: true,
            ..s
        })
    }

    /// Partition the possible last classes of `head` (entered after `after`)
    /// by how the continuation `rest` (restricted to `ends`) treats them:
    /// `(classes, representative)` pairs.
    fn groups(&self, head: Shape, after: Last, rest: Shape, ends: u8) -> Vec<(u8, Last)> {
        let possible = Self::possible_last(head, after);
        let mut groups: Vec<(u8, Last)> = Vec::new();
        for last in LASTS {
            if possible & last.bit() == 0 {
                continue;
            }
            let rep = Self::canonical(rest, last, ends);
            match groups.iter_mut().find(|(_, r)| *r == rep) {
                Some(group) => group.0 |= last.bit(),
                None => groups.push((last.bit(), rep)),
            }
        }
        groups
    }

    fn compile_seq(
        &mut self,
        context: &str,
        items: &[Expr],
        after: Last,
        ends: u8,
    ) -> Result<Option<G>, String> {
        let Some((head, rest)) = items.split_first() else {
            return Ok((ends & after.bit() != 0).then_some(G::Empty));
        };
        if rest.is_empty() {
            return self.compile(context, head, after, ends);
        }
        let head_shape = self.shape(head)?;
        let rest_shape = self.shape_of_seq(rest)?;
        let mut out = Vec::new();
        for (members, rep) in self.groups(head_shape, after, rest_shape, ends) {
            let Some(left) = self.compile(context, head, after, members)? else {
                continue;
            };
            let Some(right) = self.compile_seq(context, rest, rep, ends)? else {
                continue;
            };
            out.push(seq(vec![left, right]));
        }
        Ok(alt(out))
    }

    /// `inner*` after `after`, ending in `ends`.
    fn repetition(
        &mut self,
        context: &str,
        inner: &Expr,
        after: Last,
        ends: u8,
    ) -> Result<Option<G>, String> {
        let shape = self.shape(inner)?;
        let rep_shape = Shape {
            nullable: true,
            ..shape
        };
        let possible = Self::possible_last(rep_shape, after);
        let ends = ends & possible;
        if ends == 0 {
            return Ok(None);
        }
        // A plain `( … )*` when every iteration starts the same way whatever
        // came before and no ending is excluded.
        let entries: Vec<Last> = LASTS
            .into_iter()
            .filter(|l| (shape.last | after.bit()) & l.bit() != 0)
            .collect();
        let canon = Self::canonical(shape, after, ALL_LASTS);
        if ends == possible
            && entries
                .iter()
                .all(|l| Self::canonical(shape, *l, ALL_LASTS) == canon)
        {
            return Ok(self
                .compile(context, inner, canon, ALL_LASTS)?
                .map(|g| star(g)));
        }
        let name = self.helper_name(context, inner);
        let after = Self::canonical(rep_shape, after, ends);
        let variant = Variant {
            rule: name,
            after,
            ends,
        };
        Ok(Some(self.enqueue(variant)))
    }

    fn helper_name(&mut self, context: &str, inner: &Expr) -> String {
        let base = kebab(context);
        if let Some((_, _, name)) = self
            .helper_ids
            .iter()
            .find(|(b, e, _)| *b == base && e == inner)
        {
            return name.clone();
        }
        let mut n = 1;
        let name = loop {
            let candidate = format!("{base}-rep{n}");
            if !self.helpers.contains_key(&candidate) {
                break candidate;
            }
            n += 1;
        };
        self.helpers.insert(name.clone(), inner.clone());
        self.helper_ids.push((base, inner.clone(), name.clone()));
        name
    }

    /// A reference to the variant of production `name`, or `None` when no
    /// derivation fits.
    fn request(&mut self, name: &str, after: Last, ends: u8) -> Option<G> {
        let shape = self.shapes.get(name).copied().unwrap_or_default();
        let ends = ends & Self::possible_last(shape, after);
        if ends == 0 {
            return None;
        }
        let after = Self::canonical(shape, after, ends);
        let variant = Variant {
            rule: name.to_owned(),
            after,
            ends,
        };
        Some(self.enqueue(variant))
    }

    fn enqueue(&mut self, variant: Variant) -> G {
        let name = self.variant_name(&variant);
        if !self.variants.contains_key(&variant) {
            self.variants.insert(variant.clone(), None);
            self.pending.push(variant);
        }
        G::Sym(name)
    }

    fn variant_shape(&mut self, rule: &str) -> Result<Shape, String> {
        if let Some(inner) = self.helpers.get(rule).cloned() {
            return self.repetition_shape(&inner);
        }
        Ok(self.shapes.get(rule).copied().unwrap_or_default())
    }

    fn variant_name(&self, variant: &Variant) -> String {
        // Helpers are always named with their ending tag; productions only
        // when the variant excludes some of their possible endings.
        let (base, full) = if self.helpers.contains_key(&variant.rule) {
            (variant.rule.clone(), None)
        } else {
            let shape = self.shapes.get(&variant.rule).copied().unwrap_or_default();
            (
                kebab(&variant.rule),
                Some(Self::possible_last(shape, variant.after)),
            )
        };
        let mut name = base;
        match variant.after {
            Last::Punct => {}
            Last::Word => name.push_str("-aw"),
            Last::Int => name.push_str("-ai"),
        }
        if full != Some(variant.ends) {
            name.push_str("-e");
            for last in LASTS {
                if variant.ends & last.bit() != 0 {
                    name.push_str(last.tag());
                }
            }
        }
        name
    }

    fn build_variant(&mut self, variant: &Variant) -> Result<Option<G>, String> {
        if let Some(inner) = self.helpers.get(&variant.rule).cloned() {
            // helper ::= ε | inner helper
            let shape = self.shape(&inner)?;
            let rep_shape = self.variant_shape(&variant.rule)?;
            let mut out = Vec::new();
            if variant.ends & variant.after.bit() != 0 {
                out.push(G::Empty);
            }
            for (members, rep) in self.groups(shape, variant.after, rep_shape, variant.ends) {
                // `inner` is not nullable here in practice; its empty
                // derivation would make the helper left-recursive.
                if shape.nullable {
                    return Err(format!(
                        "the repeated expression of {} can be empty",
                        variant.rule
                    ));
                }
                let Some(left) = self.compile(&variant.rule, &inner, variant.after, members)?
                else {
                    continue;
                };
                let rest_ends = variant.ends & Self::possible_last(rep_shape, rep);
                if rest_ends == 0 {
                    continue;
                }
                let next = Variant {
                    rule: variant.rule.clone(),
                    after: Self::canonical(rep_shape, rep, rest_ends),
                    ends: rest_ends,
                };
                let right = self.enqueue(next);
                out.push(seq(vec![left, right]));
            }
            return Ok(alt(out));
        }
        let rhs = self
            .rules
            .get(&variant.rule)
            .cloned()
            .ok_or_else(|| format!("no syntactic rule {}", variant.rule))?;
        let context = variant.rule.clone();
        self.compile(&context, &rhs, variant.after, variant.ends)
    }

    // ----- the whole grammar ------------------------------------------------------

    fn run(mut self) -> Result<String, String> {
        let module = self
            .compile("Module", &Expr::Ref("Module"), Last::Punct, ALL_LASTS)?
            .ok_or("the module rule has no derivation")?;
        while let Some(variant) = self.pending.pop() {
            let body = self.build_variant(&variant)?;
            self.variants.insert(variant, body);
        }
        // Every requested variant has a derivation (the shapes are exact);
        // an empty one would be a bug in the shapes.
        for (variant, body) in &self.variants {
            if body.is_none() {
                return Err(format!("internal: variant {variant:?} has no derivation"));
            }
        }

        let mut out = String::new();
        out.push_str(HEADER);
        let rule = |name: &str, body: G, out: &mut String| {
            let mut text = String::new();
            print(&normalize(body), &mut text);
            let _ = writeln!(out, "{name} ::= {text}");
        };

        out.push_str("\n# One module.\n");
        rule(
            GBNF_ROOT,
            seq(vec![
                G::Rep(Box::new(lit("\u{feff}")), Repeat::Optional),
                module,
                sym("ws"),
                G::Rep(Box::new(sym("line-comment")), Repeat::Optional),
            ]),
            &mut out,
        );

        out.push_str(
            "\n# Syntactic productions (sections 2 to 7), in grammar order, with their variants.\n",
        );
        let mut emitted: BTreeSet<String> = BTreeSet::new();
        let order = self.order.clone();
        for name in &order {
            let mut mine: Vec<(String, G)> = self
                .variants
                .iter()
                .filter(|(v, _)| v.rule == *name)
                .map(|(v, body)| (self.variant_name(v), body.clone().unwrap_or(G::Empty)))
                .collect();
            mine.sort_by(|a, b| a.0.cmp(&b.0));
            for (variant_name, body) in mine {
                if emitted.insert(variant_name.clone()) {
                    rule(&variant_name, body, &mut out);
                }
            }
        }
        let helpers: Vec<(String, G)> = self
            .variants
            .iter()
            .filter(|(v, _)| self.helpers.contains_key(&v.rule))
            .map(|(v, body)| (self.variant_name(v), body.clone().unwrap_or(G::Empty)))
            .collect();
        if !helpers.is_empty() {
            out.push_str("\n# Repetitions whose iterations depend on the token before them.\n");
            let mut helpers = helpers;
            helpers.sort_by(|a, b| a.0.cmp(&b.0));
            for (name, body) in helpers {
                if emitted.insert(name.clone()) {
                    rule(&name, body, &mut out);
                }
            }
        }

        out.push_str("\n# Separators: whitespace and comments (`ws1`: at least one).\n");
        let lexical = Lexical { model: self.model };
        for (name, body) in lexical.separators()? {
            rule(&name, body, &mut out);
        }

        out.push_str("\n# Tokens (section 1).\n");
        if self.lexical.contains("Ident") {
            rule(
                FIELD_NAME,
                alt(vec![sym("ident"), lit("material")]).unwrap_or(G::Empty),
                &mut out,
            );
        }
        for (name, body) in lexical.tokens(&self.lexical)? {
            rule(&name, body, &mut out);
        }
        out.push_str(
            "\n# Identifiers: IdentStart IdentContinue* minus the keywords and reserved words, as a\n# trie over those words (each `ident-x-<prefix>` continues an identifier that starts with <prefix>).\n",
        );
        for (name, body) in lexical.identifiers()? {
            rule(&name, body, &mut out);
        }
        Ok(out)
    }
}

const HEADER: &str = "\
# Mtek language 0.1: GBNF grammar for llama.cpp grammar-constrained sampling.
# Generated by `mtek grammar export --format gbnf` from the grammar model
# (crates/mtek-compiler/src/syntax/grammar_model.rs, the data behind
# spec/grammar.ebnf); decision 0073 describes the translation. Do not edit.
#
# - Start rule: root (one module). The grammar does not bound the length of
#   the output; the caller enforces a maximum and treats a generation that
#   reaches it as truncated, never as complete.
# - Every token is preceded by `ws` (whitespace or comments, possibly none) or
#   `ws1` (at least one) where the two tokens would otherwise lex as one.
#   Rule variants: `-aw` entered after a word, `-ai` after an integer;
#   `-e<classes>` restricted to derivations whose last token is a word (w),
#   an integer (i) or punctuation (p).
# - ExprNoDesc is expanded as expr-no-desc, or-expr-no-desc, ...,
#   primary-no-desc. Block comments nest by recursion, without a depth bound.
# - Follows the compiler where it is stricter than the reference grammar: no
#   lone carriage return, \\u{...} escapes name Unicode scalar values, `_`
#   names no descriptor literal or scene object, and the keyword `material`
#   is a field name (decision 0023). The [S: ...]
#   restrictions of the reference grammar are not expressed: accepted text
#   still goes through the compiler.
";

/// The `NoDesc` copies of the rules reached from `base` outside brackets, with
/// the arms that are exactly `removed` dropped. Returns `(name, rhs)` pairs,
/// `base` first, then in the grammar order `order`.
fn without_at_top_level(
    rules: &BTreeMap<String, Expr>,
    order: &[String],
    base: &str,
    removed: &str,
    suffix: &str,
) -> Result<Vec<(String, Expr)>, String> {
    // The rules from which `removed` is reachable through unbracketed
    // references.
    let mut unbracketed: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    for (name, rhs) in rules {
        let mut refs = BTreeSet::new();
        unbracketed_refs(rhs, &mut refs);
        unbracketed.insert(name, refs);
    }
    let mut copied: BTreeSet<String> = BTreeSet::new();
    loop {
        let mut changed = false;
        for (name, refs) in &unbracketed {
            if copied.contains(*name) {
                continue;
            }
            if refs.iter().any(|r| r == removed || copied.contains(r)) {
                copied.insert((*name).to_owned());
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    if !copied.contains(base) {
        return Err(format!(
            "{removed} is not reachable from {base} outside brackets"
        ));
    }
    // Only the rules reachable from `base` through copied rules.
    let mut wanted = vec![base.to_owned()];
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = Vec::new();
    while let Some(name) = wanted.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let rhs = rules.get(&name).ok_or_else(|| format!("no rule {name}"))?;
        let copy = rewrite_without(rhs, &copied, removed, suffix, 0);
        for r in unbracketed.get(name.as_str()).into_iter().flatten() {
            if copied.contains(r) {
                wanted.push(r.clone());
            }
        }
        out.push((format!("{name}{suffix}"), copy));
    }
    // Keep the grammar order: the order of first reference from `base`.
    let position = |name: &str| {
        order
            .iter()
            .position(|k| format!("{k}{suffix}") == name)
            .unwrap_or(usize::MAX)
    };
    let base_name = format!("{base}{suffix}");
    out.sort_by_key(|(name, _)| (*name != base_name, position(name)));
    Ok(out)
}

/// References in `expr` that are not between a bracket literal and its
/// closing literal of the same sequence.
fn unbracketed_refs(expr: &Expr, out: &mut BTreeSet<String>) {
    match expr {
        Expr::Ref(name) => {
            out.insert((*name).to_owned());
        }
        Expr::Seq(items) => {
            let mut depth = 0usize;
            for item in items {
                match item {
                    Expr::Literal("(" | "[") => depth += 1,
                    Expr::Literal(")" | "]") => depth = depth.saturating_sub(1),
                    _ if depth == 0 => unbracketed_refs(item, out),
                    _ => {}
                }
            }
        }
        Expr::Alt(arms) => arms.iter().for_each(|a| unbracketed_refs(&a.expr, out)),
        Expr::Group(inner) | Expr::Repeat(inner, _) => unbracketed_refs(inner, out),
        Expr::Except(..)
        | Expr::Literal(_)
        | Expr::CodePoint(_)
        | Expr::Class { .. }
        | Expr::Eof => {}
    }
}

fn rewrite_without(
    expr: &Expr,
    copied: &BTreeSet<String>,
    removed: &str,
    suffix: &str,
    depth: usize,
) -> Expr {
    match expr {
        Expr::Ref(name) if depth == 0 && copied.contains(*name) => {
            // A leaked name: copies are referenced by their new name. The
            // model only has `&'static str` names, so the copies' names are
            // leaked once per translation (a few dozen bytes).
            Expr::Ref(leak(format!("{name}{suffix}")))
        }
        Expr::Seq(items) => {
            let mut level = depth;
            let mut out = Vec::new();
            for item in items {
                match item {
                    Expr::Literal("(" | "[") => {
                        level += 1;
                        out.push(item.clone());
                    }
                    Expr::Literal(")" | "]") => {
                        level = level.saturating_sub(1);
                        out.push(item.clone());
                    }
                    _ => out.push(rewrite_without(item, copied, removed, suffix, level)),
                }
            }
            Expr::Seq(out)
        }
        Expr::Alt(arms) => Expr::Alt(
            arms.iter()
                .filter(|a| depth > 0 || !matches!(&a.expr, Expr::Ref(n) if *n == removed))
                .map(|a| super::grammar_model::Arm {
                    expr: rewrite_without(&a.expr, copied, removed, suffix, depth),
                    line_break: a.line_break,
                })
                .collect(),
        ),
        Expr::Group(inner) => Expr::Group(Box::new(rewrite_without(
            inner, copied, removed, suffix, depth,
        ))),
        Expr::Repeat(inner, repeat) => Expr::Repeat(
            Box::new(rewrite_without(inner, copied, removed, suffix, depth)),
            *repeat,
        ),
        other => other.clone(),
    }
}

fn leak(name: String) -> &'static str {
    Box::leak(name.into_boxed_str())
}

/// The model with the field names of decision 0023 item 1: the first
/// identifier of `FieldInit` and `DescField` and the identifier after `.` in
/// `PostfixOp` are `field-name` (an identifier or `material`).
fn field_names(production: &Production) -> Result<Expr, String> {
    let rhs = production.rhs.clone();
    let rewritten = match production.name {
        "FieldInit" | "DescField" => match rhs {
            Expr::Seq(mut items) if items.first() == Some(&Expr::Ref("Ident")) => {
                items[0] = Expr::Ref(FIELD_NAME_REF);
                Expr::Seq(items)
            }
            other => {
                return Err(format!(
                    "{} does not start with Ident: {other:?}",
                    production.name
                ));
            }
        },
        "PostfixOp" => match rhs {
            Expr::Alt(mut arms) => {
                let mut found = false;
                for arm in &mut arms {
                    if let Expr::Seq(items) = &mut arm.expr
                        && items.as_slice() == [Expr::Literal("."), Expr::Ref("Ident")]
                    {
                        items[1] = Expr::Ref(FIELD_NAME_REF);
                        found = true;
                    }
                }
                if !found {
                    return Err("PostfixOp has no '.' Ident alternative".to_owned());
                }
                Expr::Alt(arms)
            }
            other => return Err(format!("PostfixOp is not alternatives: {other:?}")),
        },
        // The parser reads `Name {` as a descriptor literal and `kind name {`
        // as a scene object only when the name is an identifier token, which
        // `_` is not (it is a token kind of its own): `_ { … }` and
        // `camera _ { … }` are E1001.
        "DescriptorLiteral" => match rhs {
            Expr::Seq(mut items) if items.first() == Some(&Expr::Ref("Ident")) => {
                items[0] = Expr::Ref(NAMED_REF);
                Expr::Seq(items)
            }
            other => {
                return Err(format!(
                    "DescriptorLiteral does not start with Ident: {other:?}"
                ));
            }
        },
        "SceneObject" => match rhs {
            Expr::Seq(mut items) if items.get(1) == Some(&Expr::Ref("Ident")) => {
                items[1] = Expr::Ref(NAMED_REF);
                Expr::Seq(items)
            }
            other => return Err(format!("SceneObject is not Ident Ident …: {other:?}")),
        },
        _ => rhs,
    };
    Ok(rewritten)
}

const FIELD_NAME_REF: &str = FIELD_NAME;

/// An identifier other than `_` (the trie with `_` among the excluded words).
const NAMED: &str = "ident-not-underscore";
const NAMED_REF: &str = NAMED;

// ----- lexical productions ----------------------------------------------------------

struct Lexical<'m> {
    model: &'m GrammarModel,
}

impl Lexical<'_> {
    fn production(&self, name: &str) -> Result<&Production, String> {
        self.model
            .production(name)
            .filter(|p| p.level == Level::Lexical)
            .ok_or_else(|| format!("no lexical production {name}"))
    }

    /// `ws`, `ws1`, `line-comment`, `block-comment` and their parts.
    fn separators(&self) -> Result<Vec<(String, G)>, String> {
        let whitespace = match &self.production("Whitespace")?.rhs {
            Expr::Repeat(inner, Repeat::OneOrMore) => translate(inner, "Whitespace")?,
            other => return Err(format!("Whitespace is not `( … )+`: {other:?}")),
        };
        let item = alt(vec![
            sym("ws-char"),
            seq(vec![
                sym("line-comment"),
                alt(vec![lit("\n"), lit("\r\n")]).unwrap_or(G::Empty),
            ]),
            sym("block-comment"),
        ])
        .unwrap_or(G::Empty);
        Ok(vec![
            ("ws".to_owned(), star(item.clone())),
            ("ws1".to_owned(), G::Rep(Box::new(item), Repeat::OneOrMore)),
            ("ws-char".to_owned(), whitespace),
            (
                "line-comment".to_owned(),
                translate(&self.production("LineComment")?.rhs, "LineComment")?,
            ),
            (
                "block-comment".to_owned(),
                translate(&self.production("BlockComment")?.rhs, "BlockComment")?,
            ),
        ])
    }

    /// The token productions the syntactic grammar uses, and the productions
    /// they use (but not the identifier trie).
    fn tokens(&self, used: &BTreeSet<&'static str>) -> Result<Vec<(String, G)>, String> {
        let mut out = Vec::new();
        let mut wanted: Vec<&str> = used.iter().copied().filter(|n| *n != "Ident").collect();
        let mut seen = BTreeSet::new();
        while let Some(name) = wanted.pop() {
            if !seen.insert(name) {
                continue;
            }
            let production = self.production(name)?;
            let mut body = translate(&production.rhs, name)?;
            if name == "Escape" {
                body = scalar_escape(body)?;
                out.push(("unicode-scalar".to_owned(), unicode_scalar()));
                out.push(("hex4-not-surrogate".to_owned(), hex4_not_surrogate()));
            }
            let mut refs = BTreeSet::new();
            lexical_refs(&production.rhs, &mut refs);
            for r in refs {
                if r != "Ident" {
                    wanted.push(r);
                }
            }
            out.push((kebab(name), body));
        }
        if !seen.contains("Hex") && seen.contains("Escape") {
            out.push((
                "hex".to_owned(),
                translate(&self.production("Hex")?.rhs, "Hex")?,
            ));
        }
        // Grammar order.
        let order: Vec<String> = self.model.productions().map(|p| kebab(p.name)).collect();
        out.sort_by_key(|(name, _)| order.iter().position(|n| n == name).unwrap_or(usize::MAX));
        Ok(out)
    }

    /// `Ident ::= IdentStart IdentContinue* - ( Keyword | Reserved )` as a
    /// trie over the excluded words.
    fn identifiers(&self) -> Result<Vec<(String, G)>, String> {
        let Expr::Except(left, right) = &self.production("Ident")?.rhs else {
            return Err("Ident is not a difference".to_owned());
        };
        let (start, cont) = match &**left {
            Expr::Seq(items) => match items.as_slice() {
                [Expr::Ref(s), Expr::Repeat(c, Repeat::ZeroOrMore)] => match &**c {
                    Expr::Ref(c) => (*s, *c),
                    other => return Err(format!("Ident continues with {other:?}")),
                },
                other => return Err(format!("Ident is not Start Continue*: {other:?}")),
            },
            other => return Err(format!("Ident is not a sequence: {other:?}")),
        };
        let start = class_ranges(&self.production(start)?.rhs)?;
        let cont_ranges = class_ranges(&self.production(cont)?.rhs)?;
        let mut words = BTreeSet::new();
        self.words(right, &mut words)?;

        let mut prefixes: BTreeSet<String> = BTreeSet::new();
        for word in &words {
            for end in 0..word.len() {
                prefixes.insert(word[..end].to_owned());
            }
        }
        let node = |prefix: &str| {
            if prefix.is_empty() {
                "ident".to_owned()
            } else {
                format!("ident-x-{prefix}")
            }
        };
        // The identifiers other than `_`: the same trie with `_` excluded too,
        // which changes only the root (`_` is a one-character word).
        let mut named_words = words.clone();
        named_words.insert("_".to_owned());
        let mut out = Vec::new();
        for (prefix, words, name) in
            prefixes
                .iter()
                .map(|p| (p, &words, node(p)))
                .chain(std::iter::once((
                    &String::new(),
                    &named_words,
                    NAMED.to_owned(),
                )))
        {
            let allowed = if prefix.is_empty() {
                &start
            } else {
                &cont_ranges
            };
            let mut children: Vec<char> = words
                .iter()
                .filter(|w| w.len() > prefix.len() && w.starts_with(prefix.as_str()))
                .filter_map(|w| w[prefix.len()..].chars().next())
                .collect();
            children.sort_unstable();
            children.dedup();
            let mut arms = Vec::new();
            for c in &children {
                let next = format!("{prefix}{c}");
                if prefixes.contains(&next) {
                    arms.push(seq(vec![lit(&c.to_string()), sym(&node(&next))]));
                } else {
                    // `next` is a whole word and no longer word starts with
                    // it: the identifier must go on.
                    arms.push(seq(vec![
                        lit(&c.to_string()),
                        G::Rep(Box::new(sym("ident-continue")), Repeat::OneOrMore),
                    ]));
                }
            }
            let rest = subtract(allowed, &children);
            if !rest.is_empty() {
                arms.push(seq(vec![
                    G::Class {
                        negated: false,
                        ranges: rest,
                    },
                    star(sym("ident-continue")),
                ]));
            }
            if !prefix.is_empty() && !words.contains(prefix) {
                arms.push(G::Empty);
            }
            out.push((name, alt(arms).unwrap_or(G::Empty)));
        }
        out.push((
            "ident-continue".to_owned(),
            G::Class {
                negated: false,
                ranges: cont_ranges,
            },
        ));
        Ok(out)
    }

    /// The words of `expr`, a group of references to productions that are
    /// alternatives of literals.
    fn words(&self, expr: &Expr, out: &mut BTreeSet<String>) -> Result<(), String> {
        match expr {
            Expr::Group(inner) => self.words(inner, out),
            Expr::Alt(arms) => arms.iter().try_for_each(|a| self.words(&a.expr, out)),
            Expr::Ref(name) => self.words(&self.production(name)?.rhs, out),
            Expr::Literal(word) => {
                out.insert((*word).to_owned());
                Ok(())
            }
            other => Err(format!("not a word list: {other:?}")),
        }
    }
}

fn lexical_refs(expr: &Expr, out: &mut BTreeSet<&'static str>) {
    match expr {
        Expr::Ref(name) => {
            out.insert(name);
        }
        Expr::Seq(items) => items.iter().for_each(|e| lexical_refs(e, out)),
        Expr::Alt(arms) => arms.iter().for_each(|a| lexical_refs(&a.expr, out)),
        Expr::Group(inner) | Expr::Repeat(inner, _) => lexical_refs(inner, out),
        Expr::Except(a, b) => {
            lexical_refs(a, out);
            lexical_refs(b, out);
        }
        Expr::Literal(_) | Expr::CodePoint(_) | Expr::Class { .. } | Expr::Eof => {}
    }
}

fn class_ranges(expr: &Expr) -> Result<Vec<(u32, u32)>, String> {
    match expr {
        Expr::Class {
            negated: false,
            items,
        } => Ok(items.iter().map(item_range).collect()),
        other => Err(format!("not a plain character class: {other:?}")),
    }
}

fn item_range(item: &ClassItem) -> (u32, u32) {
    match *item {
        ClassItem::Char(c) => (u32::from(c), u32::from(c)),
        ClassItem::CodePoint(code) => (code, code),
        ClassItem::Range(a, b) => (u32::from(a), u32::from(b)),
    }
}

/// `ranges` without the characters `remove`, as sorted ranges.
fn subtract(ranges: &[(u32, u32)], remove: &[char]) -> Vec<(u32, u32)> {
    let mut points: BTreeSet<u32> = BTreeSet::new();
    for &(a, b) in ranges {
        points.extend(a..=b);
    }
    for c in remove {
        points.remove(&u32::from(*c));
    }
    let mut out: Vec<(u32, u32)> = Vec::new();
    for p in points {
        match out.last_mut() {
            Some((_, end)) if *end + 1 == p => *end = p,
            _ => out.push((p, p)),
        }
    }
    out
}

/// A lexical expression, character for character. A negated class never
/// matches a lone carriage return (E0003): `\r` is added to the excluded
/// characters, and where the class allows a line feed, `"\r\n"` becomes an
/// alternative.
fn translate(expr: &Expr, context: &str) -> Result<G, String> {
    Ok(match expr {
        Expr::Literal(text) => lit(text),
        Expr::CodePoint(code) => match char::from_u32(*code) {
            Some(c) => lit(&c.to_string()),
            None => return Err(format!("{context}: invalid code point {code:#x}")),
        },
        Expr::Class { negated, items } => {
            let mut ranges: Vec<(u32, u32)> = items.iter().map(item_range).collect();
            if *negated {
                let excludes = |c: u32| ranges.iter().any(|&(a, b)| a <= c && c <= b);
                let excludes_lf = excludes(0x0A);
                if excludes(0x0D) {
                    G::Class {
                        negated: true,
                        ranges,
                    }
                } else {
                    ranges.push((0x0D, 0x0D));
                    let class = G::Class {
                        negated: true,
                        ranges,
                    };
                    if excludes_lf {
                        class
                    } else {
                        alt(vec![class, lit("\r\n")]).unwrap_or(G::Empty)
                    }
                }
            } else {
                G::Class {
                    negated: false,
                    ranges,
                }
            }
        }
        Expr::Ref(name) => sym(&kebab(name)),
        Expr::Seq(items) => seq(items
            .iter()
            .map(|e| translate(e, context))
            .collect::<Result<_, _>>()?),
        Expr::Alt(arms) => alt(arms
            .iter()
            .map(|a| translate(&a.expr, context))
            .collect::<Result<_, _>>()?)
        .unwrap_or(G::Empty),
        Expr::Group(inner) => translate(inner, context)?,
        Expr::Repeat(inner, repeat) => G::Rep(Box::new(translate(inner, context)?), *repeat),
        Expr::Eof | Expr::Except(..) => {
            return Err(format!(
                "{context}: cannot translate {expr:?} character by character"
            ));
        }
    })
}

/// `Escape` with its `'u{' Hex Hex? … '}'` arm replaced by `"u{"
/// unicode-scalar "}"`: the lexer accepts only Unicode scalar values (E0023).
fn scalar_escape(body: G) -> Result<G, String> {
    let mut replaced = false;
    fn walk(g: G, replaced: &mut bool) -> G {
        match g {
            G::Seq(items) if items.first() == Some(&G::Lit("u{".to_owned())) => {
                *replaced = true;
                seq(vec![lit("u{"), sym("unicode-scalar"), lit("}")])
            }
            G::Seq(items) => G::Seq(items.into_iter().map(|g| walk(g, replaced)).collect()),
            G::Alt(items) => G::Alt(items.into_iter().map(|g| walk(g, replaced)).collect()),
            G::Rep(inner, r) => G::Rep(Box::new(walk(*inner, replaced)), r),
            other => other,
        }
    }
    let out = walk(body, &mut replaced);
    if replaced {
        Ok(out)
    } else {
        Err("Escape has no `'u{' Hex … '}'` alternative".to_owned())
    }
}

/// One to six hexadecimal digits naming a Unicode scalar value (at most
/// `10FFFF`, not `D800`-`DFFF`); leading zeros are allowed.
fn unicode_scalar() -> G {
    let hex = || sym("hex");
    let nonzero = || class(&[(0x31, 0x39), (0x41, 0x46), (0x61, 0x66)]);
    alt(vec![
        G::Times(Box::new(hex()), 1, 3),
        sym("hex4-not-surrogate"),
        seq(vec![lit("0"), sym("hex4-not-surrogate")]),
        seq(vec![nonzero(), G::Times(Box::new(hex()), 4, 4)]),
        seq(vec![lit("00"), sym("hex4-not-surrogate")]),
        seq(vec![lit("0"), nonzero(), G::Times(Box::new(hex()), 4, 4)]),
        seq(vec![lit("10"), G::Times(Box::new(hex()), 4, 4)]),
    ])
    .unwrap_or(G::Empty)
}

/// Four hexadecimal digits that are not `D800`-`DFFF`.
fn hex4_not_surrogate() -> G {
    let hex = || sym("hex");
    alt(vec![
        seq(vec![
            class(&[
                (0x30, 0x39),
                (0x41, 0x43),
                (0x45, 0x46),
                (0x61, 0x63),
                (0x65, 0x66),
            ]),
            G::Times(Box::new(hex()), 3, 3),
        ]),
        seq(vec![
            class(&[(0x44, 0x44), (0x64, 0x64)]),
            class(&[(0x30, 0x37)]),
            G::Times(Box::new(hex()), 2, 2),
        ]),
    ])
    .unwrap_or(G::Empty)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grammar_text() -> String {
        gbnf().expect("the model translates")
    }

    /// `(name, body)` of every rule of the text.
    fn rules(text: &str) -> Vec<(String, String)> {
        text.lines()
            .filter(|l| !l.starts_with('#') && !l.is_empty())
            .filter_map(|l| l.split_once(" ::= "))
            .map(|(a, b)| (a.to_owned(), b.to_owned()))
            .collect()
    }

    #[test]
    fn every_reference_is_defined_once_and_every_rule_is_used() {
        let text = grammar_text();
        let rules = rules(&text);
        let names: BTreeSet<&str> = rules.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names.len(), rules.len(), "a rule is defined twice");
        let mut used: BTreeSet<String> = BTreeSet::new();
        for (_, body) in &rules {
            let mut in_string = false;
            let mut in_class = false;
            let mut escaped = false;
            let mut word = String::new();
            for c in body.chars().chain(std::iter::once(' ')) {
                if escaped {
                    escaped = false;
                    continue;
                }
                if (in_string || in_class) && c == '\\' {
                    escaped = true;
                    continue;
                }
                if in_string {
                    in_string = c != '"';
                    continue;
                }
                if in_class {
                    in_class = c != ']';
                    continue;
                }
                if c.is_ascii_alphanumeric() || c == '-' {
                    word.push(c);
                    continue;
                }
                if !word.is_empty() && !word.chars().all(|c| c.is_ascii_digit() || c == ',') {
                    used.insert(std::mem::take(&mut word));
                }
                word.clear();
                in_string = c == '"';
                in_class = c == '[';
            }
        }
        for name in &used {
            assert!(
                names.contains(name.as_str()),
                "{name} is used but not defined"
            );
        }
        for name in &names {
            assert!(
                *name == GBNF_ROOT || used.contains(*name),
                "{name} is defined but not used"
            );
        }
    }

    #[test]
    fn names_are_gbnf_names() {
        for (name, _) in rules(&grammar_text()) {
            assert!(
                name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "{name}"
            );
        }
    }

    #[test]
    fn expr_no_desc_is_a_duplicated_rule_set() {
        let text = grammar_text();
        let names: BTreeSet<String> = rules(&text).into_iter().map(|(n, _)| n).collect();
        for base in [
            "expr",
            "or-expr",
            "and-expr",
            "eq-expr",
            "rel-expr",
            "add-expr",
            "mul-expr",
            "unary-expr",
            "postfix-expr",
            "primary",
        ] {
            let copy = format!("{base}-no-desc");
            assert!(
                names
                    .iter()
                    .any(|n| n == &copy || n.starts_with(&format!("{copy}-"))),
                "{copy} is missing"
            );
        }
        // The copy of Primary has no descriptor literal; the original has.
        let body = |prefix: &str| {
            rules(&text)
                .into_iter()
                .filter(|(n, _)| {
                    n == prefix
                        || n.starts_with(&format!("{prefix}-e"))
                        || n.starts_with(&format!("{prefix}-a"))
                })
                .map(|(_, b)| b)
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert!(body("primary").contains("descriptor-literal"));
        assert!(!body("primary-no-desc").contains("descriptor-literal"));
    }

    #[test]
    fn block_comments_nest_by_recursion() {
        let text = grammar_text();
        let (_, body) = rules(&text)
            .into_iter()
            .find(|(n, _)| n == "block-comment")
            .expect("block-comment");
        assert!(body.contains("block-comment"), "{body}");
    }

    #[test]
    fn identifiers_exclude_every_keyword_and_reserved_word() {
        // Walk the trie: a word is excluded when following its characters
        // reaches a node without the empty alternative, or a leaf that needs
        // more characters.
        let text = grammar_text();
        let rules: BTreeMap<String, String> = rules(&text).into_iter().collect();
        let model = grammar();
        let lexical = Lexical { model: &model };
        let trie: BTreeMap<String, G> = lexical.identifiers().expect("trie").into_iter().collect();
        for word in super::super::grammar_model::KEYWORD_WORDS
            .iter()
            .chain(super::super::grammar_model::RESERVED_WORDS_MODEL.iter())
        {
            let prefix = &word[..word.len() - 1];
            let node = if prefix.is_empty() {
                "ident".to_owned()
            } else {
                format!("ident-x-{prefix}")
            };
            let body = trie.get(&node).expect("node");
            let last = word.chars().last().expect("non-empty");
            let next = format!("ident-x-{word}");
            match trie.get(&next) {
                // A longer word starts with this one: its node must not end.
                Some(g) => assert!(
                    !matches!(g, G::Alt(arms) if arms.contains(&G::Empty)),
                    "{word} is accepted as an identifier"
                ),
                None => {
                    let G::Alt(arms) = body else { panic!("{node}") };
                    let leaf = seq(vec![
                        lit(&last.to_string()),
                        G::Rep(Box::new(sym("ident-continue")), Repeat::OneOrMore),
                    ]);
                    assert!(arms.contains(&leaf), "{word}: {body:?}");
                }
            }
        }
        assert!(rules.contains_key("ident"));
    }

    #[test]
    fn the_refinements_apply() {
        let text = grammar_text();
        assert!(text.contains("unicode-scalar"));
        assert!(text.contains(&format!("{FIELD_NAME} ::= ident | \"material\"")));
        // The block comment's content class excludes a lone carriage return.
        let (_, body) = rules(&text)
            .into_iter()
            .find(|(n, _)| n == "block-comment")
            .expect("block-comment");
        assert!(body.contains("\\r\\n"), "{body}");
        // `_` names no descriptor literal and no scene object.
        let all = rules(&text);
        let body_of = |name: &str| {
            all.iter()
                .find(|(n, _)| n == name)
                .map(|(_, b)| b.clone())
                .expect(name)
        };
        assert!(body_of("descriptor-literal").starts_with(&format!("ws {NAMED} ")));
        assert!(body_of("scene-object").contains(&format!("ws1 {NAMED} ")));
        let named = body_of(NAMED);
        assert!(named.contains("\"_\" ident-continue+"), "{named}");
        assert!(!body_of("ident").contains("\"_\""));
    }

    #[test]
    fn the_translation_is_deterministic() {
        assert_eq!(grammar_text(), grammar_text());
    }
}
