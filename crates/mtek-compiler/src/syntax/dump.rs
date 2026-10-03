//! The S-expression dump of the AST, the format of the golden files in
//! `tests/syntax/ast/` (`spec/testing.md` section 3.1).
//!
//! The dump shows structure and values, never ids or spans (those are tested
//! on their own), so that a golden file reads as the program the parser
//! understood. Each node is a list headed by a word: `(binary + (lit int 1)
//! (name x))`. Lists that fit in 80 columns stay on one line; longer ones put
//! each child on its own line, indented by two spaces, after the leading
//! atoms of the list.
//!
//! Expressions: `(lit int 1)` `(lit float 0.5)` `(lit string "a")`
//! `(lit color #6b5cff)` `(lit bool true)` `(self)` `(name x)` `(paren E)`
//! `(array E...)` `(desc Name (field n V)...)` `(unary - E)`
//! `(binary + L R)` `(call F A...)` `(field E name)` `(index E I)`
//! `(error)`. A field value is an expression or `(bind E)`. A color literal
//! is written `#rrggbb`, or `#rrggbbaa` if its alpha is not 255. An integer
//! literal that does not fit in 64 bits is `(lit int overflow)`.
//!
//! The dump of items, members, types and statements is documented on
//! [`dump_module`].

#[cfg(test)]
mod tests;

use std::fmt::Write as _;

use super::ast::{
    ArrayLength, ArrayLengthKind, Bind, Block, ConstDecl, DescField, ElseBranch, EntityDecl,
    EntityMember, Expr, ExprKind, FieldInit, FieldValue, FnDecl, ForIter, ForStmt, Handler,
    HandlerArg, IfStmt, ImportDecl, Item, ItemKind, LifecycleFn, LocalDecl, MaterialDecl,
    MaterialMember, Module, Param, ParamDecl, PrefabDecl, SceneDecl, SceneMember, SceneObject,
    StageFn, StateDecl, Stmt, StructDecl, StructField, Type, TypeKind,
};

/// Lists are kept on one line when they fit in this many columns.
const WIDTH: usize = 80;

/// The dump of one expression.
#[must_use]
pub fn dump_expr(expr: &Expr) -> String {
    render(&expr_sexp(expr))
}

/// The dump of a whole module.
///
/// ```text
/// (module ITEM...)
/// ITEM    (import "./path.mtek" A B)  (export ITEM)
///         (const N [TYPE] E)  (fn n (params (param p TYPE)...) [(ret TYPE)] BLOCK)
///         (cpu-fn ...)  (struct N (field f TYPE)...)
///         (material N (param n TYPE [E]) (stage n (params ...) [(ret TYPE)] BLOCK))
///         (prefab N MEMBER...)  (scene N MEMBER...)  (error)
/// MEMBER  (init n V)  (const ...)  (state n TYPE E)  (param n TYPE [E])
///         (object kind N (init n V)...)  (entity N [(prefab P)] MEMBER...)
///         (lifecycle n (params ...) BLOCK)  (on event ARG... BLOCK)
///         (error)
/// ARG     (param n TYPE)  (filter E)
/// TYPE    (type name)  (type name TYPE (len 4))  (type (error))
/// BLOCK   (block STMT...)
/// STMT    (let n [TYPE] E)  (var n [TYPE] E)  (const ...)
///         (if E BLOCK [BLOCK|(if ...)])
///         (for n (range A B) BLOCK)  (for n (each E) BLOCK)
///         (return [E])  (break)  (continue)  BLOCK
///         (assign = PLACE E)  (expr E)  (error)
/// ```
#[must_use]
pub fn dump_module(module: &Module) -> String {
    render(&module_sexp(module))
}

// ---------------------------------------------------------------------------
// S-expressions and their layout
// ---------------------------------------------------------------------------

enum Sexp {
    Atom(String),
    List(Vec<Sexp>),
}

/// A list under construction.
struct List(Vec<Sexp>);

impl List {
    fn new(head: &str) -> Self {
        List(vec![Sexp::Atom(head.to_owned())])
    }

    fn atom(mut self, atom: impl Into<String>) -> Self {
        self.0.push(Sexp::Atom(atom.into()));
        self
    }

    fn child(mut self, child: Sexp) -> Self {
        self.0.push(child);
        self
    }

    fn opt(self, child: Option<Sexp>) -> Self {
        match child {
            Some(child) => self.child(child),
            None => self,
        }
    }

    fn children(mut self, children: impl IntoIterator<Item = Sexp>) -> Self {
        self.0.extend(children);
        self
    }

    fn done(self) -> Sexp {
        Sexp::List(self.0)
    }
}

/// `(head)` with nothing else.
fn bare(head: &str) -> Sexp {
    List::new(head).done()
}

fn render(sexp: &Sexp) -> String {
    let mut out = String::new();
    layout(sexp, 0, &mut out);
    out.push('\n');
    out
}

fn layout(sexp: &Sexp, indent: usize, out: &mut String) {
    match sexp {
        Sexp::Atom(atom) => out.push_str(atom),
        Sexp::List(items) => {
            if fits(sexp, WIDTH.saturating_sub(indent)) {
                flat(sexp, out);
                return;
            }
            out.push('(');
            // The leading atoms stay on the first line: `(binary +`.
            let mut rest = items.as_slice();
            let mut first = true;
            while let Some((Sexp::Atom(atom), tail)) = rest.split_first() {
                if !first {
                    out.push(' ');
                }
                out.push_str(atom);
                first = false;
                rest = tail;
            }
            for child in rest {
                out.push('\n');
                out.extend(std::iter::repeat_n(' ', indent + 2));
                layout(child, indent + 2, out);
            }
            out.push(')');
        }
    }
}

fn flat(sexp: &Sexp, out: &mut String) {
    match sexp {
        Sexp::Atom(atom) => out.push_str(atom),
        Sexp::List(items) => {
            out.push('(');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(' ');
                }
                flat(item, out);
            }
            out.push(')');
        }
    }
}

/// True if `sexp` written on one line takes at most `width` columns. Stops
/// counting as soon as it is too long, so the cost per call is bounded by
/// `width`, not by the size of the tree.
fn fits(sexp: &Sexp, width: usize) -> bool {
    fn take(sexp: &Sexp, left: &mut usize) -> bool {
        let cost = |left: &mut usize, n: usize| {
            if n > *left {
                false
            } else {
                *left -= n;
                true
            }
        };
        match sexp {
            Sexp::Atom(atom) => cost(left, atom.chars().count()),
            Sexp::List(items) => {
                // Parentheses and the spaces between children.
                if !cost(left, 2 + items.len().saturating_sub(1)) {
                    return false;
                }
                items.iter().all(|item| take(item, left))
            }
        }
    }
    let mut left = width;
    take(sexp, &mut left)
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

fn expr_sexp(expr: &Expr) -> Sexp {
    match &expr.kind {
        ExprKind::Int { value: Some(value) } => lit("int", value.to_string()),
        ExprKind::Int { value: None } => lit("int", "overflow"),
        ExprKind::Float { value } => lit("float", format!("{value:?}")),
        ExprKind::Str { value } => lit("string", format!("{value:?}")),
        ExprKind::Color { rgba: [r, g, b, a] } => {
            let mut text = format!("#{r:02x}{g:02x}{b:02x}");
            if *a != 255 {
                let _ = write!(text, "{a:02x}");
            }
            lit("color", text)
        }
        ExprKind::Bool(value) => lit("bool", value.to_string()),
        ExprKind::SelfValue => bare("self"),
        ExprKind::Name(name) => List::new("name").atom(name.as_str()).done(),
        ExprKind::Paren(inner) => List::new("paren").child(expr_sexp(inner)).done(),
        ExprKind::Array(elements) => List::new("array")
            .children(elements.iter().map(expr_sexp))
            .done(),
        ExprKind::Descriptor { name, fields } => List::new("desc")
            .atom(name.name.as_str())
            .children(fields.iter().map(desc_field_sexp))
            .done(),
        ExprKind::Unary { op, operand } => List::new("unary")
            .atom(op.symbol())
            .child(expr_sexp(operand))
            .done(),
        ExprKind::Binary { op, lhs, rhs, .. } => List::new("binary")
            .atom(op.symbol())
            .child(expr_sexp(lhs))
            .child(expr_sexp(rhs))
            .done(),
        ExprKind::Call { callee, args } => List::new("call")
            .child(expr_sexp(callee))
            .children(args.iter().map(expr_sexp))
            .done(),
        ExprKind::Field { base, name } => List::new("field")
            .child(expr_sexp(base))
            .atom(name.name.as_str())
            .done(),
        ExprKind::Index { base, index } => List::new("index")
            .child(expr_sexp(base))
            .child(expr_sexp(index))
            .done(),
        ExprKind::Error => bare("error"),
    }
}

fn lit(kind: &str, value: impl Into<String>) -> Sexp {
    List::new("lit").atom(kind).atom(value).done()
}

fn desc_field_sexp(field: &DescField) -> Sexp {
    List::new("field")
        .atom(field.name.name.as_str())
        .child(field_value_sexp(&field.value))
        .done()
}

fn field_value_sexp(value: &FieldValue) -> Sexp {
    match value {
        FieldValue::Expr(expr) => expr_sexp(expr),
        FieldValue::Bind(Bind { source, .. }) => List::new("bind").child(expr_sexp(source)).done(),
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

fn type_sexp(ty: &Type) -> Sexp {
    match &ty.kind {
        TypeKind::Named(name) => List::new("type").atom(name.name.as_str()).done(),
        TypeKind::Generic {
            name,
            element,
            length,
        } => List::new("type")
            .atom(name.name.as_str())
            .child(type_sexp(element))
            .child(length_sexp(length))
            .done(),
        TypeKind::Error => List::new("type").child(bare("error")).done(),
    }
}

fn length_sexp(length: &ArrayLength) -> Sexp {
    let value = match &length.kind {
        ArrayLengthKind::Int { value: Some(value) } => value.to_string(),
        ArrayLengthKind::Int { value: None } => "overflow".to_owned(),
        ArrayLengthKind::Name(name) => name.clone(),
        ArrayLengthKind::Error => return List::new("len").child(bare("error")).done(),
    };
    List::new("len").atom(value).done()
}

// ---------------------------------------------------------------------------
// Items and members
// ---------------------------------------------------------------------------

fn module_sexp(module: &Module) -> Sexp {
    List::new("module")
        .children(module.items.iter().map(item_sexp))
        .done()
}

fn item_sexp(item: &Item) -> Sexp {
    let decl = match &item.kind {
        ItemKind::Import(decl) => import_sexp(decl),
        ItemKind::Const(decl) => const_sexp(decl),
        ItemKind::Fn(decl) => fn_sexp(decl),
        ItemKind::Struct(decl) => struct_sexp(decl),
        ItemKind::Material(decl) => material_sexp(decl),
        ItemKind::Prefab(decl) => prefab_sexp(decl),
        ItemKind::Scene(decl) => scene_sexp(decl),
        ItemKind::Error => bare("error"),
    };
    if item.export {
        List::new("export").child(decl).done()
    } else {
        decl
    }
}

fn import_sexp(decl: &ImportDecl) -> Sexp {
    let source = match &decl.source.value {
        Some(value) => format!("{value:?}"),
        None => "malformed".to_owned(),
    };
    List::new("import")
        .atom(source)
        .children(decl.names.iter().map(|name| Sexp::Atom(name.name.clone())))
        .done()
}

fn const_sexp(decl: &ConstDecl) -> Sexp {
    List::new("const")
        .atom(decl.name.name.as_str())
        .opt(decl.ty.as_ref().map(type_sexp))
        .child(expr_sexp(&decl.value))
        .done()
}

fn params_sexp(params: &[Param]) -> Sexp {
    List::new("params")
        .children(params.iter().map(param_sexp))
        .done()
}

fn param_sexp(param: &Param) -> Sexp {
    List::new("param")
        .atom(param.name.name.as_str())
        .child(type_sexp(&param.ty))
        .done()
}

fn ret_sexp(ret: Option<&Type>) -> Option<Sexp> {
    ret.map(|ty| List::new("ret").child(type_sexp(ty)).done())
}

fn fn_sexp(decl: &FnDecl) -> Sexp {
    List::new(if decl.cpu { "cpu-fn" } else { "fn" })
        .atom(decl.name.name.as_str())
        .child(params_sexp(&decl.params))
        .opt(ret_sexp(decl.ret.as_ref()))
        .child(block_sexp(&decl.body))
        .done()
}

fn struct_sexp(decl: &StructDecl) -> Sexp {
    List::new("struct")
        .atom(decl.name.name.as_str())
        .children(decl.fields.iter().map(struct_field_sexp))
        .done()
}

fn struct_field_sexp(field: &StructField) -> Sexp {
    List::new("field")
        .atom(field.name.name.as_str())
        .child(type_sexp(&field.ty))
        .done()
}

fn material_sexp(decl: &MaterialDecl) -> Sexp {
    List::new("material")
        .atom(decl.name.name.as_str())
        .children(decl.members.iter().map(|member| match member {
            MaterialMember::Param(param) => param_decl_sexp(param),
            MaterialMember::Stage(stage) => stage_sexp(stage),
            MaterialMember::Error(_) => bare("error"),
        }))
        .done()
}

fn param_decl_sexp(decl: &ParamDecl) -> Sexp {
    List::new("param")
        .atom(decl.name.name.as_str())
        .child(type_sexp(&decl.ty))
        .opt(decl.default.as_ref().map(expr_sexp))
        .done()
}

fn stage_sexp(stage: &StageFn) -> Sexp {
    List::new("stage")
        .atom(stage.name.name.as_str())
        .child(params_sexp(&stage.params))
        .opt(ret_sexp(stage.ret.as_ref()))
        .child(block_sexp(&stage.body))
        .done()
}

fn prefab_sexp(decl: &PrefabDecl) -> Sexp {
    List::new("prefab")
        .atom(decl.name.name.as_str())
        .children(decl.members.iter().map(entity_member_sexp))
        .done()
}

fn scene_sexp(decl: &SceneDecl) -> Sexp {
    List::new("scene")
        .atom(decl.name.name.as_str())
        .children(decl.members.iter().map(|member| match member {
            SceneMember::Field(field) => init_sexp(field),
            SceneMember::Const(decl) => const_sexp(decl),
            SceneMember::State(state) => state_sexp(state),
            SceneMember::Object(object) => object_sexp(object),
            SceneMember::Entity(entity) => entity_sexp(entity),
            SceneMember::Lifecycle(function) => lifecycle_sexp(function),
            SceneMember::Handler(handler) => handler_sexp(handler),
            SceneMember::Error(_) => bare("error"),
        }))
        .done()
}

fn entity_sexp(decl: &EntityDecl) -> Sexp {
    List::new("entity")
        .atom(decl.name.name.as_str())
        .opt(
            decl.prefab
                .as_ref()
                .map(|prefab| List::new("prefab").atom(prefab.name.as_str()).done()),
        )
        .children(decl.members.iter().map(entity_member_sexp))
        .done()
}

fn entity_member_sexp(member: &EntityMember) -> Sexp {
    match member {
        EntityMember::Field(field) => init_sexp(field),
        EntityMember::Const(decl) => const_sexp(decl),
        EntityMember::State(state) => state_sexp(state),
        EntityMember::Param(param) => param_decl_sexp(param),
        EntityMember::Entity(entity) => entity_sexp(entity),
        EntityMember::Lifecycle(function) => lifecycle_sexp(function),
        EntityMember::Handler(handler) => handler_sexp(handler),
        EntityMember::Error(_) => bare("error"),
    }
}

fn object_sexp(object: &SceneObject) -> Sexp {
    List::new("object")
        .atom(object.kind.name.as_str())
        .atom(object.name.name.as_str())
        .children(object.fields.iter().map(init_sexp))
        .done()
}

fn state_sexp(state: &StateDecl) -> Sexp {
    List::new("state")
        .atom(state.name.name.as_str())
        .child(type_sexp(&state.ty))
        .child(expr_sexp(&state.value))
        .done()
}

fn init_sexp(field: &FieldInit) -> Sexp {
    List::new("init")
        .atom(field.name.name.as_str())
        .child(field_value_sexp(&field.value))
        .done()
}

fn lifecycle_sexp(function: &LifecycleFn) -> Sexp {
    List::new("lifecycle")
        .atom(function.name.name.as_str())
        .child(params_sexp(&function.params))
        .child(block_sexp(&function.body))
        .done()
}

fn handler_sexp(handler: &Handler) -> Sexp {
    List::new("on")
        .atom(handler.event.name.as_str())
        .children(handler.args.iter().map(|arg| match arg {
            HandlerArg::Param(param) => param_sexp(param),
            HandlerArg::Filter(expr) => List::new("filter").child(expr_sexp(expr)).done(),
        }))
        .child(block_sexp(&handler.body))
        .done()
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

fn block_sexp(block: &Block) -> Sexp {
    List::new("block")
        .children(block.stmts.iter().map(stmt_sexp))
        .done()
}

fn local_sexp(head: &str, local: &LocalDecl) -> Sexp {
    List::new(head)
        .atom(local.name.name.as_str())
        .opt(local.ty.as_ref().map(type_sexp))
        .child(expr_sexp(&local.value))
        .done()
}

fn stmt_sexp(stmt: &Stmt) -> Sexp {
    match stmt {
        Stmt::Let(local) => local_sexp("let", local),
        Stmt::Var(local) => local_sexp("var", local),
        Stmt::Const(decl) => const_sexp(decl),
        Stmt::If(stmt) => if_sexp(stmt),
        Stmt::For(stmt) => for_sexp(stmt),
        Stmt::Return(stmt) => List::new("return")
            .opt(stmt.value.as_ref().map(expr_sexp))
            .done(),
        Stmt::Break(_) => bare("break"),
        Stmt::Continue(_) => bare("continue"),
        Stmt::Block(block) => block_sexp(block),
        Stmt::Assign(stmt) => List::new("assign")
            .atom(stmt.op.symbol())
            .child(expr_sexp(&stmt.target))
            .child(expr_sexp(&stmt.value))
            .done(),
        Stmt::Expr(stmt) => List::new("expr").child(expr_sexp(&stmt.expr)).done(),
        Stmt::Error(_) => bare("error"),
    }
}

fn if_sexp(stmt: &IfStmt) -> Sexp {
    List::new("if")
        .child(expr_sexp(&stmt.cond))
        .child(block_sexp(&stmt.then_block))
        .opt(stmt.else_branch.as_ref().map(|branch| match branch {
            ElseBranch::If(inner) => if_sexp(inner),
            ElseBranch::Block(block) => block_sexp(block),
        }))
        .done()
}

fn for_sexp(stmt: &ForStmt) -> Sexp {
    let iter = match &stmt.iter {
        ForIter::Range { start, end } => List::new("range")
            .child(expr_sexp(start))
            .child(expr_sexp(end))
            .done(),
        ForIter::Each(expr) => List::new("each").child(expr_sexp(expr)).done(),
    };
    List::new("for")
        .atom(stmt.var.name.as_str())
        .child(iter)
        .child(block_sexp(&stmt.body))
        .done()
}
