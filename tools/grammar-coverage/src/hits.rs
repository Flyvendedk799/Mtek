//! Which productions and alternatives a source file exercises, measured on
//! what the compiler's front end actually built from it: the tokens and
//! comments of `mtek_compiler::syntax::lex_str` and the tree of
//! `parse_module`.
//!
//! The tree has one node type per production and one enum variant per
//! alternative (`syntax/ast.rs`, "Shape"), so a production is hit when the
//! parser built its node. The mapping is an exhaustive `match` over the tree:
//! a new node kind does not compile until it is mapped. Nothing is added to
//! the compiler, so the measurement costs nothing at run time in any build.
//!
//! What counts as a hit, where the grammar is not one node per production:
//!
//! * **Precedence levels.** `OrExpr`, `AndExpr`, `EqExpr`, `RelExpr`,
//!   `AddExpr` and `MulExpr` are hit by a binary expression with one of their
//!   own operators, `PostfixExpr` by a call, field access or index. Every
//!   expression *passes through* all of them; that alone does not count.
//! * **Lists.** `ParamList`, `ArgList` and `HandlerArgs` are hit by a
//!   non-empty list (the grammar makes them optional where they occur).
//! * **`ExprNoDesc`** is hit by the condition of an `if` and the operands of
//!   `for … in`, which the parser reads without top-level descriptor
//!   literals.
//! * **`HandlerArg`'s parameter form** `Ident ':' Type` is not the production
//!   `Param`, although the tree shares the node type.
//! * **Lexical productions** come from the tokens: `IdentContinue` from an
//!   identifier longer than one character, `IntPart` and `Exponent` from the
//!   text of a float, `StringChar` and `Escape` from the text of a string,
//!   `Hex` from a colour or a `\u{…}` escape, `Whitespace` from a blank
//!   between tokens and comments; `LineComment` includes `///`.

use std::collections::BTreeSet;

use mtek_compiler::diagnostics::Diagnostics;
use mtek_compiler::source::FileId;
use mtek_compiler::syntax::ast::{
    ArrayLengthKind, AssignOp, BinaryOp, Block, ConstDecl, ElseBranch, EntityDecl, EntityMember,
    Expr, ExprKind, FieldInit, FieldValue, ForIter, HandlerArg, IfStmt, ItemKind, MaterialMember,
    Module, Param, SceneMember, Stmt, Type, TypeKind,
};
use mtek_compiler::syntax::{Token, TokenKind, TriviaKind, lex_str, parse_module};

/// A production, or one of its top-level alternatives (in the normalised
/// text of [`crate::ebnf`]).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Point {
    pub production: String,
    pub alternative: Option<String>,
}

impl Point {
    #[must_use]
    pub fn production(name: &str) -> Point {
        Point {
            production: name.to_owned(),
            alternative: None,
        }
    }

    #[must_use]
    pub fn alternative(name: &str, alternative: &str) -> Point {
        Point {
            production: name.to_owned(),
            alternative: Some(alternative.to_owned()),
        }
    }
}

impl std::fmt::Display for Point {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.alternative {
            None => write!(f, "{}", self.production),
            Some(alternative) => write!(f, "{} ::= … | {alternative} | …", self.production),
        }
    }
}

// The alternatives the tree distinguishes, as `spec/grammar.ebnf` writes them.
const ITEM_DECLARATION: &str =
    "'export'? ( ConstDecl | FnDecl | StructDecl | MaterialDecl | PrefabDecl | SceneDecl )";
const UNARY_OPERATOR: &str = "( '-' | '!' ) UnaryExpr";
const POSTFIX_CALL: &str = "'(' ArgList? ')'";
const POSTFIX_FIELD: &str = "'.' Ident";
const POSTFIX_INDEX: &str = "'[' Expr ']'";
const FIELD_BIND: &str = "'bind' '(' Expr ')'";
const HANDLER_PARAMETER: &str = "Ident ':' Type";
const INT_ZERO: &str = "'0'";
const INT_NONZERO: &str = "[1-9] [0-9]*";

/// Collects the points of one file.
struct Hits<'a> {
    text: &'a str,
    points: BTreeSet<Point>,
}

impl Hits<'_> {
    fn hit(&mut self, production: &str) {
        self.points.insert(Point::production(production));
    }

    /// The production and one of its alternatives.
    fn alt(&mut self, production: &str, alternative: &str) {
        self.hit(production);
        self.points
            .insert(Point::alternative(production, alternative));
    }

    // ----- tokens and comments -------------------------------------------

    fn token(&mut self, token: &Token) {
        let text = token.text(self.text);
        match token.kind {
            TokenKind::Ident | TokenKind::Underscore => {
                self.hit("Ident");
                self.hit("IdentStart");
                if text.len() > 1 {
                    self.hit("IdentContinue");
                }
            }
            TokenKind::Int => {
                let form = if text == "0" { INT_ZERO } else { INT_NONZERO };
                self.alt("Int", form);
            }
            TokenKind::Float => {
                self.hit("Float");
                let int_part = text.split('.').next().unwrap_or_default();
                let form = if int_part == "0" {
                    INT_ZERO
                } else {
                    INT_NONZERO
                };
                self.alt("IntPart", form);
                if text.contains(['e', 'E']) {
                    self.hit("Exponent");
                }
            }
            TokenKind::String => self.string(text),
            TokenKind::Color => {
                self.hit("Color");
                self.hit("Hex");
            }
            kind if kind.is_keyword() => {
                self.alt("Keyword", &format!("'{text}'"));
                if matches!(kind, TokenKind::KwTrue | TokenKind::KwFalse) {
                    self.alt("Bool", &format!("'{text}'"));
                }
            }
            _ => {}
        }
    }

    /// The characters and escapes between the quotes of a string literal.
    fn string(&mut self, text: &str) {
        self.hit("String");
        let inner = text
            .strip_prefix('"')
            .and_then(|t| t.strip_suffix('"'))
            .unwrap_or_default();
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                self.hit("Escape");
                if chars.next() == Some('u') {
                    // `\u{…}`: hex digits up to the closing brace.
                    self.hit("Hex");
                    for c in chars.by_ref() {
                        if c == '}' {
                            break;
                        }
                    }
                }
            } else {
                self.hit("StringChar");
            }
        }
    }

    // ----- items ----------------------------------------------------------

    fn module(&mut self, module: &Module) {
        self.hit("Module");
        for item in &module.items {
            match &item.kind {
                // The names and the specifier are tokens only.
                ItemKind::Import(_) => {
                    self.alt("Item", "Import");
                    self.hit("Import");
                }
                ItemKind::Const(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.const_decl(decl);
                }
                ItemKind::Fn(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.hit("FnDecl");
                    self.params(&decl.params);
                    if let Some(ret) = &decl.ret {
                        self.ty(ret);
                    }
                    self.block(&decl.body);
                }
                ItemKind::Struct(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.hit("StructDecl");
                    for field in &decl.fields {
                        self.hit("StructField");
                        self.ty(&field.ty);
                    }
                }
                ItemKind::Material(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.hit("MaterialDecl");
                    for member in &decl.members {
                        match member {
                            MaterialMember::Param(param) => {
                                self.alt("MaterialMember", "ParamDecl");
                                self.param_decl(&param.ty, param.default.as_ref());
                            }
                            MaterialMember::Stage(stage) => {
                                self.alt("MaterialMember", "StageFn");
                                self.hit("StageFn");
                                self.params(&stage.params);
                                if let Some(ret) = &stage.ret {
                                    self.ty(ret);
                                }
                                self.block(&stage.body);
                            }
                            MaterialMember::Error(_) => {}
                        }
                    }
                }
                ItemKind::Prefab(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.hit("PrefabDecl");
                    for member in &decl.members {
                        self.entity_member(member);
                    }
                }
                ItemKind::Scene(decl) => {
                    self.alt("Item", ITEM_DECLARATION);
                    self.hit("SceneDecl");
                    for member in &decl.members {
                        self.scene_member(member);
                    }
                }
                ItemKind::Error => {}
            }
        }
    }

    fn const_decl(&mut self, decl: &ConstDecl) {
        self.hit("ConstDecl");
        if let Some(ty) = &decl.ty {
            self.ty(ty);
        }
        self.expr(&decl.value);
    }

    /// `ParamList?` of a function, stage or lifecycle function.
    fn params(&mut self, params: &[Param]) {
        if !params.is_empty() {
            self.hit("ParamList");
        }
        for param in params {
            self.hit("Param");
            self.ty(&param.ty);
        }
    }

    fn param_decl(&mut self, ty: &Type, default: Option<&Expr>) {
        self.hit("ParamDecl");
        self.ty(ty);
        if let Some(default) = default {
            self.expr(default);
        }
    }

    // ----- scenes, entities, prefabs ---------------------------------------

    fn scene_member(&mut self, member: &SceneMember) {
        const P: &str = "SceneMember";
        match member {
            SceneMember::Field(field) => {
                self.alt(P, "FieldInit");
                self.field_init(field);
            }
            SceneMember::Const(decl) => {
                self.alt(P, "ConstDecl");
                self.const_decl(decl);
            }
            SceneMember::State(state) => {
                self.alt(P, "StateDecl");
                self.hit("StateDecl");
                self.ty(&state.ty);
                self.expr(&state.value);
            }
            SceneMember::Object(object) => {
                self.alt(P, "SceneObject");
                self.hit("SceneObject");
                for field in &object.fields {
                    self.field_init(field);
                }
            }
            SceneMember::Entity(entity) => {
                self.alt(P, "EntityDecl");
                self.entity(entity);
            }
            SceneMember::Lifecycle(lifecycle) => {
                self.alt(P, "LifecycleFn");
                self.hit("LifecycleFn");
                self.params(&lifecycle.params);
                self.block(&lifecycle.body);
            }
            SceneMember::Handler(handler) => {
                self.alt(P, "Handler");
                self.handler(&handler.args, &handler.body);
            }
            SceneMember::Error(_) => {}
        }
    }

    fn entity(&mut self, entity: &EntityDecl) {
        self.hit("EntityDecl");
        for member in &entity.members {
            self.entity_member(member);
        }
    }

    fn entity_member(&mut self, member: &EntityMember) {
        const P: &str = "EntityMember";
        match member {
            EntityMember::Field(field) => {
                self.alt(P, "FieldInit");
                self.field_init(field);
            }
            EntityMember::Const(decl) => {
                self.alt(P, "ConstDecl");
                self.const_decl(decl);
            }
            EntityMember::State(state) => {
                self.alt(P, "StateDecl");
                self.hit("StateDecl");
                self.ty(&state.ty);
                self.expr(&state.value);
            }
            EntityMember::Param(param) => {
                self.alt(P, "ParamDecl");
                self.param_decl(&param.ty, param.default.as_ref());
            }
            EntityMember::Entity(entity) => {
                self.alt(P, "EntityDecl");
                self.entity(entity);
            }
            EntityMember::Lifecycle(lifecycle) => {
                self.alt(P, "LifecycleFn");
                self.hit("LifecycleFn");
                self.params(&lifecycle.params);
                self.block(&lifecycle.body);
            }
            EntityMember::Handler(handler) => {
                self.alt(P, "Handler");
                self.handler(&handler.args, &handler.body);
            }
            EntityMember::Error(_) => {}
        }
    }

    fn field_init(&mut self, field: &FieldInit) {
        self.hit("FieldInit");
        self.field_value(&field.value);
    }

    fn field_value(&mut self, value: &FieldValue) {
        match value {
            FieldValue::Expr(expr) => {
                self.alt("FieldValue", "Expr");
                self.expr(expr);
            }
            FieldValue::Bind(bind) => {
                self.alt("FieldValue", FIELD_BIND);
                self.expr(&bind.source);
            }
        }
    }

    fn handler(&mut self, args: &[HandlerArg], body: &Block) {
        self.hit("Handler");
        if !args.is_empty() {
            self.hit("HandlerArgs");
        }
        for arg in args {
            match arg {
                HandlerArg::Param(param) => {
                    self.alt("HandlerArg", HANDLER_PARAMETER);
                    self.ty(&param.ty);
                }
                HandlerArg::Filter(expr) => {
                    self.alt("HandlerArg", "Expr");
                    self.expr(expr);
                }
            }
        }
        self.block(body);
    }

    // ----- types ------------------------------------------------------------

    fn ty(&mut self, ty: &Type) {
        match &ty.kind {
            TypeKind::Named(_) => self.hit("Type"),
            TypeKind::Generic {
                element, length, ..
            } => {
                self.hit("Type");
                self.ty(element);
                match length.kind {
                    ArrayLengthKind::Int { .. } => self.alt("ArrayLength", "Int"),
                    ArrayLengthKind::Name(_) => self.alt("ArrayLength", "Ident"),
                    ArrayLengthKind::Error => {}
                }
            }
            TypeKind::Error => {}
        }
    }

    // ----- statements -------------------------------------------------------

    fn block(&mut self, block: &Block) {
        self.hit("Block");
        for stmt in &block.stmts {
            self.stmt(stmt);
        }
    }

    fn stmt(&mut self, stmt: &Stmt) {
        const P: &str = "Statement";
        match stmt {
            Stmt::Let(local) | Stmt::Var(local) => {
                let production = if matches!(stmt, Stmt::Let(_)) {
                    "LetStmt"
                } else {
                    "VarStmt"
                };
                self.alt(P, production);
                self.hit(production);
                if let Some(ty) = &local.ty {
                    self.ty(ty);
                }
                self.expr(&local.value);
            }
            Stmt::Const(decl) => {
                self.alt(P, "ConstDecl");
                self.const_decl(decl);
            }
            Stmt::If(stmt) => {
                self.alt(P, "IfStmt");
                self.if_stmt(stmt);
            }
            Stmt::For(stmt) => {
                self.alt(P, "ForStmt");
                self.hit("ForStmt");
                match &stmt.iter {
                    ForIter::Range { start, end } => {
                        self.expr_no_desc(start);
                        self.expr_no_desc(end);
                    }
                    ForIter::Each(expr) => self.expr_no_desc(expr),
                }
                self.block(&stmt.body);
            }
            Stmt::Return(stmt) => {
                self.alt(P, "ReturnStmt");
                self.hit("ReturnStmt");
                if let Some(value) = &stmt.value {
                    self.expr(value);
                }
            }
            Stmt::Break(_) => {
                self.alt(P, "BreakStmt");
                self.hit("BreakStmt");
            }
            Stmt::Continue(_) => {
                self.alt(P, "ContinueStmt");
                self.hit("ContinueStmt");
            }
            Stmt::Block(block) => {
                self.alt(P, "Block");
                self.block(block);
            }
            Stmt::Assign(assign) => {
                self.alt(P, "SimpleStmt");
                self.hit("SimpleStmt");
                self.expr(&assign.target);
                let op = match assign.op {
                    AssignOp::Assign => "'='",
                    AssignOp::Add => "'+='",
                    AssignOp::Sub => "'-='",
                    AssignOp::Mul => "'*='",
                    AssignOp::Div => "'/='",
                };
                self.alt("AssignOp", op);
                self.expr(&assign.value);
            }
            Stmt::Expr(stmt) => {
                self.alt(P, "SimpleStmt");
                self.hit("SimpleStmt");
                self.expr(&stmt.expr);
            }
            Stmt::Error(_) => {}
        }
    }

    fn if_stmt(&mut self, stmt: &IfStmt) {
        self.hit("IfStmt");
        self.expr_no_desc(&stmt.cond);
        self.block(&stmt.then_block);
        match &stmt.else_branch {
            Some(ElseBranch::If(next)) => self.if_stmt(next),
            Some(ElseBranch::Block(block)) => self.block(block),
            None => {}
        }
    }

    // ----- expressions ------------------------------------------------------

    fn expr_no_desc(&mut self, expr: &Expr) {
        self.hit("ExprNoDesc");
        self.expr(expr);
    }

    fn expr(&mut self, expr: &Expr) {
        self.hit("Expr");
        let primary = |hits: &mut Self, alternative: &str| {
            hits.alt("UnaryExpr", "PostfixExpr");
            hits.alt("Primary", alternative);
        };
        match &expr.kind {
            ExprKind::Int { .. } => primary(self, "Int"),
            ExprKind::Float { .. } => primary(self, "Float"),
            ExprKind::Str { .. } => primary(self, "String"),
            ExprKind::Color { .. } => primary(self, "Color"),
            ExprKind::Bool(_) => primary(self, "Bool"),
            ExprKind::SelfValue => primary(self, "'self'"),
            ExprKind::Name(_) => primary(self, "Ident"),
            ExprKind::Paren(inner) => {
                primary(self, "'(' Expr ')'");
                self.expr(inner);
            }
            ExprKind::Array(elements) => {
                primary(self, "ArrayLiteral");
                self.hit("ArrayLiteral");
                for element in elements {
                    self.expr(element);
                }
            }
            ExprKind::Descriptor { fields, .. } => {
                primary(self, "DescriptorLiteral");
                self.hit("DescriptorLiteral");
                for field in fields {
                    self.hit("DescField");
                    self.field_value(&field.value);
                }
            }
            ExprKind::Unary { operand, .. } => {
                self.alt("UnaryExpr", UNARY_OPERATOR);
                self.expr(operand);
            }
            ExprKind::Binary { op, lhs, rhs, .. } => {
                let production = match op {
                    BinaryOp::Or => "OrExpr",
                    BinaryOp::And => "AndExpr",
                    BinaryOp::Eq | BinaryOp::Ne => "EqExpr",
                    BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => "RelExpr",
                    BinaryOp::Add | BinaryOp::Sub => "AddExpr",
                    BinaryOp::Mul | BinaryOp::Div | BinaryOp::Rem => "MulExpr",
                };
                self.hit(production);
                self.expr(lhs);
                self.expr(rhs);
            }
            ExprKind::Call { callee, args } => {
                self.postfix(POSTFIX_CALL);
                if !args.is_empty() {
                    self.hit("ArgList");
                }
                self.expr(callee);
                for arg in args {
                    self.expr(arg);
                }
            }
            ExprKind::Field { base, .. } => {
                self.postfix(POSTFIX_FIELD);
                self.expr(base);
            }
            ExprKind::Index { base, index } => {
                self.postfix(POSTFIX_INDEX);
                self.expr(base);
                self.expr(index);
            }
            ExprKind::Error => {}
        }
    }

    fn postfix(&mut self, alternative: &str) {
        self.alt("UnaryExpr", "PostfixExpr");
        self.hit("PostfixExpr");
        self.alt("PostfixOp", alternative);
    }
}

/// Whether the text between two tokens or comments is blank.
fn has_whitespace(gap: &str) -> bool {
    gap.bytes()
        .any(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
}

/// The points `text` exercises when it lexes and parses without any
/// diagnostic.
///
/// # Errors
///
/// The diagnostics (`code start..end: message`) of a text that does not lex
/// and parse cleanly: a positive fixture must not have any.
pub fn points_of(text: &str) -> Result<BTreeSet<Point>, Vec<String>> {
    let mut lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    lexed.report_into(&mut sink);
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let report = sink.finish();
    if !report.diagnostics.is_empty() {
        return Err(report
            .diagnostics
            .iter()
            .map(|d| {
                let span = d
                    .primary
                    .as_ref()
                    .map(|label| format!(" {}..{}", label.span.start, label.span.end))
                    .unwrap_or_default();
                format!("{}{span}: {}", d.code.short(), d.message)
            })
            .collect());
    }
    let mut hits = Hits {
        text,
        points: BTreeSet::new(),
    };
    // Tokens and comments in source order; the gaps between them are blank.
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for token in &lexed.tokens {
        hits.token(token);
        spans.push((token.span.start as usize, token.span.end as usize));
    }
    for comment in lexed.trivia.items() {
        match comment.kind {
            TriviaKind::LineComment | TriviaKind::DocComment => hits.hit("LineComment"),
            TriviaKind::BlockComment => hits.hit("BlockComment"),
        }
        spans.push((comment.span.start as usize, comment.span.end as usize));
    }
    spans.sort_unstable();
    let mut at = 0;
    for (start, end) in spans {
        if has_whitespace(text.get(at..start).unwrap_or_default()) {
            hits.hit("Whitespace");
        }
        at = at.max(end);
    }
    if has_whitespace(text.get(at..).unwrap_or_default()) {
        hits.hit("Whitespace");
    }
    hits.module(&parsed.module);
    Ok(hits.points)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn productions(text: &str) -> Vec<String> {
        let mut names: Vec<String> = points_of(text)
            .unwrap()
            .into_iter()
            .filter(|p| p.alternative.is_none())
            .map(|p| p.production)
            .collect();
        names.dedup();
        names
    }

    #[test]
    fn an_empty_file_is_a_module_and_nothing_else() {
        assert_eq!(productions(""), ["Module"]);
    }

    #[test]
    fn passing_through_a_precedence_level_is_not_a_hit() {
        let names = productions("const A = 1;");
        for level in [
            "OrExpr",
            "AndExpr",
            "EqExpr",
            "RelExpr",
            "AddExpr",
            "MulExpr",
            "PostfixExpr",
        ] {
            assert!(!names.iter().any(|n| n == level), "{level}: {names:?}");
        }
        assert!(names.iter().any(|n| n == "UnaryExpr"), "{names:?}");
        let names = productions("const A = f(1)[0].x || b && c == d < e + g * h;");
        for level in [
            "OrExpr",
            "AndExpr",
            "EqExpr",
            "RelExpr",
            "AddExpr",
            "MulExpr",
            "PostfixExpr",
            "ArgList",
        ] {
            assert!(names.iter().any(|n| n == level), "{level}: {names:?}");
        }
    }

    #[test]
    fn alternatives_follow_the_tree() {
        let points = points_of(
            "scene S {\n  on key_down(Key.Space, other: entity_ref) { x += 1; }\n}\n/* c */",
        )
        .unwrap();
        for point in [
            Point::alternative("SceneMember", "Handler"),
            Point::alternative("HandlerArg", "Expr"),
            Point::alternative("HandlerArg", HANDLER_PARAMETER),
            Point::alternative("AssignOp", "'+='"),
            Point::alternative("Statement", "SimpleStmt"),
            Point::alternative("PostfixOp", POSTFIX_FIELD),
            Point::alternative("Keyword", "'on'"),
            Point::alternative("Int", INT_NONZERO),
            Point::production("HandlerArgs"),
            Point::production("BlockComment"),
            Point::production("Whitespace"),
        ] {
            assert!(points.contains(&point), "{point}: {points:#?}");
        }
        // The parameter form of a handler argument is not `Param`.
        assert!(!points.contains(&Point::production("Param")));
        assert!(!points.contains(&Point::production("ParamList")));
    }

    #[test]
    fn lexical_details_come_from_the_token_text() {
        let points = points_of("const A = \"a\\u{41}\"; const B = 0.5e3; const C = 10.0;").unwrap();
        for point in [
            Point::production("StringChar"),
            Point::production("Escape"),
            Point::production("Hex"),
            Point::production("Exponent"),
            Point::alternative("IntPart", INT_ZERO),
            Point::alternative("IntPart", INT_NONZERO),
            Point::production("IdentStart"),
        ] {
            assert!(points.contains(&point), "{point}: {points:#?}");
        }
        // One-character names only: no `IdentContinue`.
        assert!(!points.contains(&Point::production("IdentContinue")));
    }

    #[test]
    fn a_text_with_diagnostics_is_refused() {
        let errors = points_of("const = 1;").unwrap_err();
        assert!(errors[0].starts_with("E1001 6..7"), "{errors:?}");
    }
}
