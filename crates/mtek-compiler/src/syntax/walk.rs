//! A generic pre-order walk over every node of the AST.
//!
//! The walk names each node by what every node has: its id, its span and a
//! kind label. It exists to state and test invariants that hold for the whole
//! tree (ids are unique and below `node_count`, children lie inside their
//! parent, ...) and for tools that only need positions. Passes that need to
//! look inside nodes match on the typed AST instead.

use super::ast::{
    ArrayLength, Bind, Block, ConstDecl, DescField, ElseBranch, EntityDecl, EntityMember, Expr,
    ExprKind, FieldInit, FieldValue, FnDecl, ForIter, ForStmt, Handler, HandlerArg, Ident, IfStmt,
    ImportDecl, Item, ItemKind, LifecycleFn, LocalDecl, MaterialDecl, MaterialMember, Module, Node,
    NodeId, Param, ParamDecl, PrefabDecl, SceneDecl, SceneMember, SceneObject, StageFn, StateDecl,
    Stmt, StructDecl, StructField, Type, TypeKind,
};
use crate::source::Span;

/// What the walk reports about one node.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct NodeInfo {
    pub id: NodeId,
    pub span: Span,
    /// A stable label of the node type: `"module"`, `"binary"`, `"call"`,
    /// `"let"`, ... Labels name the node type, not what it contains: every
    /// literal is `"lit"`, a field access is `"field-access"`.
    pub kind: &'static str,
}

/// Visit `module` and everything in it, parents before children, children in
/// source order. The callback receives the node and its parent (`None` for
/// the root).
pub fn walk_module(module: &Module, f: &mut dyn FnMut(NodeInfo, Option<NodeInfo>)) {
    let mut walker = Walker { f, parent: None };
    walker.module(module);
}

/// Visit `expr` and everything in it, like [`walk_module`].
pub fn walk_expr(expr: &Expr, f: &mut dyn FnMut(NodeInfo, Option<NodeInfo>)) {
    let mut walker = Walker { f, parent: None };
    walker.expr(expr);
}

struct Walker<'f> {
    f: &'f mut dyn FnMut(NodeInfo, Option<NodeInfo>),
    parent: Option<NodeInfo>,
}

impl Walker<'_> {
    /// Report a node, then walk its children with it as their parent.
    fn node(
        &mut self,
        id: NodeId,
        span: Span,
        kind: &'static str,
        children: impl FnOnce(&mut Self),
    ) {
        let info = NodeInfo { id, span, kind };
        (self.f)(info, self.parent);
        let saved = self.parent.replace(info);
        children(self);
        self.parent = saved;
    }

    fn leaf(&mut self, node: &impl Node, kind: &'static str) {
        self.node(node.id(), node.span(), kind, |_| {});
    }

    fn module(&mut self, module: &Module) {
        self.node(module.id, module.span, "module", |w| {
            for item in &module.items {
                w.item(item);
            }
        });
    }

    fn item(&mut self, item: &Item) {
        self.node(item.id, item.span, "item", |w| match &item.kind {
            ItemKind::Import(decl) => w.import(decl),
            ItemKind::Const(decl) => w.const_decl(decl),
            ItemKind::Fn(decl) => w.fn_decl(decl),
            ItemKind::Struct(decl) => w.struct_decl(decl),
            ItemKind::Material(decl) => w.material(decl),
            ItemKind::Prefab(decl) => w.prefab(decl),
            ItemKind::Scene(decl) => w.scene(decl),
            ItemKind::Error => {}
        });
    }

    fn ident(&mut self, ident: &Ident) {
        self.leaf(ident, "ident");
    }

    fn import(&mut self, decl: &ImportDecl) {
        self.node(decl.id, decl.span, "import", |w| {
            for name in &decl.names {
                w.ident(name);
            }
            w.leaf(&decl.source, "str");
        });
    }

    fn const_decl(&mut self, decl: &ConstDecl) {
        self.node(decl.id, decl.span, "const", |w| {
            w.ident(&decl.name);
            if let Some(ty) = &decl.ty {
                w.ty(ty);
            }
            w.expr(&decl.value);
        });
    }

    fn param(&mut self, param: &Param) {
        self.node(param.id, param.span, "param", |w| {
            w.ident(&param.name);
            w.ty(&param.ty);
        });
    }

    fn fn_decl(&mut self, decl: &FnDecl) {
        self.node(decl.id, decl.span, "fn", |w| {
            w.ident(&decl.name);
            for param in &decl.params {
                w.param(param);
            }
            if let Some(ret) = &decl.ret {
                w.ty(ret);
            }
            w.block(&decl.body);
        });
    }

    fn struct_decl(&mut self, decl: &StructDecl) {
        self.node(decl.id, decl.span, "struct", |w| {
            w.ident(&decl.name);
            for field in &decl.fields {
                w.struct_field(field);
            }
        });
    }

    fn struct_field(&mut self, field: &StructField) {
        self.node(field.id, field.span, "struct-field", |w| {
            w.ident(&field.name);
            w.ty(&field.ty);
        });
    }

    fn material(&mut self, decl: &MaterialDecl) {
        self.node(decl.id, decl.span, "material", |w| {
            w.ident(&decl.name);
            for member in &decl.members {
                match member {
                    MaterialMember::Param(param) => w.param_decl(param),
                    MaterialMember::Stage(stage) => w.stage_fn(stage),
                    MaterialMember::Error(error) => w.leaf(error, "error"),
                }
            }
        });
    }

    fn param_decl(&mut self, decl: &ParamDecl) {
        self.node(decl.id, decl.span, "param-decl", |w| {
            w.ident(&decl.name);
            w.ty(&decl.ty);
            if let Some(default) = &decl.default {
                w.expr(default);
            }
        });
    }

    fn stage_fn(&mut self, stage: &StageFn) {
        self.node(stage.id, stage.span, "stage", |w| {
            w.ident(&stage.name);
            for param in &stage.params {
                w.param(param);
            }
            if let Some(ret) = &stage.ret {
                w.ty(ret);
            }
            w.block(&stage.body);
        });
    }

    fn prefab(&mut self, decl: &PrefabDecl) {
        self.node(decl.id, decl.span, "prefab", |w| {
            w.ident(&decl.name);
            for member in &decl.members {
                w.entity_member(member);
            }
        });
    }

    fn scene(&mut self, decl: &SceneDecl) {
        self.node(decl.id, decl.span, "scene", |w| {
            w.ident(&decl.name);
            for member in &decl.members {
                match member {
                    SceneMember::Field(field) => w.field_init(field),
                    SceneMember::Const(decl) => w.const_decl(decl),
                    SceneMember::State(state) => w.state(state),
                    SceneMember::Object(object) => w.scene_object(object),
                    SceneMember::Entity(entity) => w.entity(entity),
                    SceneMember::Lifecycle(function) => w.lifecycle(function),
                    SceneMember::Handler(handler) => w.handler(handler),
                    SceneMember::Error(error) => w.leaf(error, "error"),
                }
            }
        });
    }

    fn entity(&mut self, decl: &EntityDecl) {
        self.node(decl.id, decl.span, "entity", |w| {
            w.ident(&decl.name);
            if let Some(prefab) = &decl.prefab {
                w.ident(prefab);
            }
            for member in &decl.members {
                w.entity_member(member);
            }
        });
    }

    fn entity_member(&mut self, member: &EntityMember) {
        match member {
            EntityMember::Field(field) => self.field_init(field),
            EntityMember::Const(decl) => self.const_decl(decl),
            EntityMember::State(state) => self.state(state),
            EntityMember::Param(param) => self.param_decl(param),
            EntityMember::Entity(entity) => self.entity(entity),
            EntityMember::Lifecycle(function) => self.lifecycle(function),
            EntityMember::Handler(handler) => self.handler(handler),
            EntityMember::Error(error) => self.leaf(error, "error"),
        }
    }

    fn scene_object(&mut self, object: &SceneObject) {
        self.node(object.id, object.span, "object", |w| {
            w.ident(&object.kind);
            w.ident(&object.name);
            for field in &object.fields {
                w.field_init(field);
            }
        });
    }

    fn state(&mut self, state: &StateDecl) {
        self.node(state.id, state.span, "state", |w| {
            w.ident(&state.name);
            w.ty(&state.ty);
            w.expr(&state.value);
        });
    }

    fn field_init(&mut self, field: &FieldInit) {
        self.node(field.id, field.span, "init", |w| {
            w.ident(&field.name);
            w.field_value(&field.value);
        });
    }

    fn field_value(&mut self, value: &FieldValue) {
        match value {
            FieldValue::Expr(expr) => self.expr(expr),
            FieldValue::Bind(bind) => self.bind(bind),
        }
    }

    fn bind(&mut self, bind: &Bind) {
        self.node(bind.id, bind.span, "bind", |w| w.expr(&bind.source));
    }

    fn lifecycle(&mut self, function: &LifecycleFn) {
        self.node(function.id, function.span, "lifecycle", |w| {
            w.ident(&function.name);
            for param in &function.params {
                w.param(param);
            }
            w.block(&function.body);
        });
    }

    fn handler(&mut self, handler: &Handler) {
        self.node(handler.id, handler.span, "on", |w| {
            w.ident(&handler.event);
            for arg in &handler.args {
                match arg {
                    HandlerArg::Param(param) => w.param(param),
                    HandlerArg::Filter(expr) => w.expr(expr),
                }
            }
            w.block(&handler.body);
        });
    }

    fn ty(&mut self, ty: &Type) {
        self.node(ty.id, ty.span, "type", |w| match &ty.kind {
            TypeKind::Named(name) => w.ident(name),
            TypeKind::Generic {
                name,
                element,
                length,
            } => {
                w.ident(name);
                w.ty(element);
                w.array_length(length);
            }
            TypeKind::Error => {}
        });
    }

    fn array_length(&mut self, length: &ArrayLength) {
        self.leaf(length, "len");
    }

    fn block(&mut self, block: &Block) {
        self.node(block.id, block.span, "block", |w| {
            for stmt in &block.stmts {
                w.stmt(stmt);
            }
        });
    }

    fn local(&mut self, local: &LocalDecl, kind: &'static str) {
        self.node(local.id, local.span, kind, |w| {
            w.ident(&local.name);
            if let Some(ty) = &local.ty {
                w.ty(ty);
            }
            w.expr(&local.value);
        });
    }

    fn stmt(&mut self, stmt: &Stmt) {
        match stmt {
            Stmt::Let(local) => self.local(local, "let"),
            Stmt::Var(local) => self.local(local, "var"),
            Stmt::Const(decl) => self.const_decl(decl),
            Stmt::If(stmt) => self.if_stmt(stmt),
            Stmt::For(stmt) => self.for_stmt(stmt),
            Stmt::Return(stmt) => self.node(stmt.id, stmt.span, "return", |w| {
                if let Some(value) = &stmt.value {
                    w.expr(value);
                }
            }),
            Stmt::Break(stmt) => self.leaf(stmt, "break"),
            Stmt::Continue(stmt) => self.leaf(stmt, "continue"),
            Stmt::Block(block) => self.block(block),
            Stmt::Assign(stmt) => self.node(stmt.id, stmt.span, "assign", |w| {
                w.expr(&stmt.target);
                w.expr(&stmt.value);
            }),
            Stmt::Expr(stmt) => self.node(stmt.id, stmt.span, "expr-stmt", |w| w.expr(&stmt.expr)),
            Stmt::Error(error) => self.leaf(error, "error"),
        }
    }

    fn if_stmt(&mut self, stmt: &IfStmt) {
        self.node(stmt.id, stmt.span, "if", |w| {
            w.expr(&stmt.cond);
            w.block(&stmt.then_block);
            match &stmt.else_branch {
                Some(ElseBranch::If(inner)) => w.if_stmt(inner),
                Some(ElseBranch::Block(block)) => w.block(block),
                None => {}
            }
        });
    }

    fn for_stmt(&mut self, stmt: &ForStmt) {
        self.node(stmt.id, stmt.span, "for", |w| {
            w.ident(&stmt.var);
            match &stmt.iter {
                ForIter::Range { start, end } => {
                    w.expr(start);
                    w.expr(end);
                }
                ForIter::Each(expr) => w.expr(expr),
            }
            w.block(&stmt.body);
        });
    }

    fn expr(&mut self, expr: &Expr) {
        let kind = expr_label(&expr.kind);
        self.node(expr.id, expr.span, kind, |w| match &expr.kind {
            ExprKind::Int { .. }
            | ExprKind::Float { .. }
            | ExprKind::Str { .. }
            | ExprKind::Color { .. }
            | ExprKind::Bool(_)
            | ExprKind::SelfValue
            | ExprKind::Name(_)
            | ExprKind::Error => {}
            ExprKind::Paren(inner) => w.expr(inner),
            ExprKind::Array(elements) => {
                for element in elements {
                    w.expr(element);
                }
            }
            ExprKind::Descriptor { name, fields } => {
                w.ident(name);
                for field in fields {
                    w.desc_field(field);
                }
            }
            ExprKind::Unary { operand, .. } => w.expr(operand),
            ExprKind::Binary { lhs, rhs, .. } => {
                w.expr(lhs);
                w.expr(rhs);
            }
            ExprKind::Call { callee, args } => {
                w.expr(callee);
                for arg in args {
                    w.expr(arg);
                }
            }
            ExprKind::Field { base, name } => {
                w.expr(base);
                w.ident(name);
            }
            ExprKind::Index { base, index } => {
                w.expr(base);
                w.expr(index);
            }
        });
    }

    fn desc_field(&mut self, field: &DescField) {
        self.node(field.id, field.span, "field", |w| {
            w.ident(&field.name);
            w.field_value(&field.value);
        });
    }
}

/// The label of an expression node: the head word of its AST dump.
fn expr_label(kind: &ExprKind) -> &'static str {
    match kind {
        ExprKind::Int { .. }
        | ExprKind::Float { .. }
        | ExprKind::Str { .. }
        | ExprKind::Color { .. }
        | ExprKind::Bool(_) => "lit",
        ExprKind::SelfValue => "self",
        ExprKind::Name(_) => "name",
        ExprKind::Paren(_) => "paren",
        ExprKind::Array(_) => "array",
        ExprKind::Descriptor { .. } => "desc",
        ExprKind::Unary { .. } => "unary",
        ExprKind::Binary { .. } => "binary",
        ExprKind::Call { .. } => "call",
        ExprKind::Field { .. } => "field-access",
        ExprKind::Index { .. } => "index",
        ExprKind::Error => "error",
    }
}
