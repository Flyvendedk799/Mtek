//! Items, members and types (`spec/grammar.ebnf` sections 2 to 5).

use crate::source::Span;
use crate::syntax::TokenKind;
use crate::syntax::ast::{
    ConstDecl, EntityDecl, EntityMember, EnumDecl, FieldInit, FieldValue, FnDecl, Handler,
    HandlerArg, ImportDecl, Item, ItemKind, LifecycleFn, MaterialDecl, MaterialMember, Module,
    Node, Param, ParamDecl, Persist, PrefabDecl, SceneDecl, SceneMember, SceneObject, StageFn,
    StateDecl, StructDecl, StructField, Type, TypeKind,
};

use super::doc::Doc;
use super::printer::{ListStyle, Printer, combine_leading};

/// Where the closing brace of a declaration or body is: its last byte.
pub(super) fn closing(span: Span) -> u32 {
    span.end.saturating_sub(1)
}

impl Printer<'_> {
    /// The whole file.
    pub(super) fn module(&mut self, module: &Module) -> Doc {
        let end = u32::try_from(self.text.len()).unwrap_or(u32::MAX);
        let pieces = self.members(
            &module.items,
            &|item| matches!(item.kind, ItemKind::Import(_)),
            &mut |printer, item| printer.item(item),
            0,
            end,
            true,
        );
        Doc::concat(pieces)
    }

    fn item(&mut self, item: &Item) -> Doc {
        let declaration = match &item.kind {
            ItemKind::Import(decl) => self.import(decl),
            ItemKind::Const(decl) => self.const_decl(decl),
            ItemKind::Fn(decl) => self.fn_decl(decl),
            ItemKind::Struct(decl) => self.struct_decl(decl),
            ItemKind::Enum(decl) => self.enum_decl(decl),
            ItemKind::Material(decl) => self.material_decl(decl),
            ItemKind::Prefab(decl) => self.prefab_decl(decl),
            ItemKind::Scene(decl) => self.scene_decl(decl),
            ItemKind::Error => Doc::text(self.slice(item.span)),
        };
        if item.export {
            Doc::concat(vec![Doc::text("export "), declaration])
        } else {
            declaration
        }
    }

    fn import(&mut self, decl: &ImportDecl) -> Doc {
        let after_names = decl.names.last().map_or(decl.span.start, |n| n.span.end);
        let close = self.token_start(TokenKind::RBrace, after_names, decl.source.span.start);
        let names = self.list(
            &ListStyle::IMPORT_BRACES,
            &decl.names,
            close,
            &mut |p, n| p.ident(n),
        );
        let source = Doc::text(self.slice(decl.source.span));
        let source = self.with_leading(decl.source.span.start, source);
        let semicolon = self.semicolon(decl.span.end);
        Doc::concat(vec![
            Doc::text("import "),
            names,
            Doc::text(" from "),
            source,
            semicolon,
        ])
    }

    pub(super) fn const_decl(&mut self, decl: &ConstDecl) -> Doc {
        let name = self.ident(&decl.name);
        let ty = self.annotation(decl.ty.as_ref());
        let value = self.expr(&decl.value);
        let semicolon = self.semicolon(decl.span.end);
        Doc::concat(vec![
            Doc::text("const "),
            name,
            ty,
            Doc::text(" = "),
            value,
            semicolon,
        ])
    }

    fn fn_decl(&mut self, decl: &FnDecl) -> Doc {
        let name = self.ident(&decl.name);
        let params = self.params(&decl.params, decl.name.span.end);
        let ret = self.return_type(decl.ret.as_ref());
        let body = self.block(&decl.body);
        Doc::concat(vec![
            Doc::text(if decl.cpu { "cpu fn " } else { "fn " }),
            name,
            params,
            ret,
            Doc::Space,
            body,
        ])
    }

    fn struct_decl(&mut self, decl: &StructDecl) -> Doc {
        let name = self.ident(&decl.name);
        let open = self.token_start(TokenKind::LBrace, decl.name.span.end, decl.span.start);
        let body = self.braced(open, closing(decl.span), &decl.fields, &mut |p, f| {
            p.struct_field(f)
        });
        Doc::concat(vec![Doc::text("struct "), name, Doc::Space, body])
    }

    /// `enum Name { A, B }` on one line if it fits, else one variant per line
    /// with a trailing comma.
    fn enum_decl(&mut self, decl: &EnumDecl) -> Doc {
        let name = self.ident(&decl.name);
        let variants = self.list(
            &ListStyle::IMPORT_BRACES,
            &decl.variants,
            closing(decl.span),
            &mut |p, v| p.ident(v),
        );
        Doc::concat(vec![Doc::text("enum "), name, Doc::Space, variants])
    }

    fn struct_field(&mut self, field: &StructField) -> Doc {
        let name = self.ident(&field.name);
        let ty = self.ty(&field.ty);
        let semicolon = self.semicolon(field.span.end);
        Doc::concat(vec![name, Doc::text(": "), ty, semicolon])
    }

    fn material_decl(&mut self, decl: &MaterialDecl) -> Doc {
        let name = self.ident(&decl.name);
        let open = self.token_start(TokenKind::LBrace, decl.name.span.end, decl.span.start);
        let body = self.braced(open, closing(decl.span), &decl.members, &mut |p, m| {
            p.material_member(m)
        });
        Doc::concat(vec![Doc::text("material "), name, Doc::Space, body])
    }

    fn material_member(&mut self, member: &MaterialMember) -> Doc {
        match member {
            MaterialMember::Param(decl) => self.param_decl(decl),
            MaterialMember::Stage(stage) => self.stage_fn(stage),
            MaterialMember::Error(node) => Doc::text(self.slice(node.span)),
        }
    }

    pub(super) fn param_decl(&mut self, decl: &ParamDecl) -> Doc {
        let name = self.ident(&decl.name);
        let ty = self.ty(&decl.ty);
        let mut parts = vec![Doc::text("param "), name, Doc::text(": "), ty];
        if let Some(default) = &decl.default {
            parts.push(Doc::text(" = "));
            parts.push(self.expr(default));
        }
        parts.push(self.semicolon(decl.span.end));
        Doc::concat(parts)
    }

    fn stage_fn(&mut self, stage: &StageFn) -> Doc {
        let name = self.ident(&stage.name);
        let params = self.params(&stage.params, stage.name.span.end);
        let ret = self.return_type(stage.ret.as_ref());
        let body = self.block(&stage.body);
        Doc::concat(vec![name, params, ret, Doc::Space, body])
    }

    fn prefab_decl(&mut self, decl: &PrefabDecl) -> Doc {
        let name = self.ident(&decl.name);
        let open = self.token_start(TokenKind::LBrace, decl.name.span.end, decl.span.start);
        let body = self.braced(open, closing(decl.span), &decl.members, &mut |p, m| {
            p.entity_member(m)
        });
        Doc::concat(vec![Doc::text("prefab "), name, Doc::Space, body])
    }

    fn scene_decl(&mut self, decl: &SceneDecl) -> Doc {
        let name = self.ident(&decl.name);
        let open = self.token_start(TokenKind::LBrace, decl.name.span.end, decl.span.start);
        let body = self.braced(open, closing(decl.span), &decl.members, &mut |p, m| {
            p.scene_member(m)
        });
        Doc::concat(vec![Doc::text("scene "), name, Doc::Space, body])
    }

    fn scene_member(&mut self, member: &SceneMember) -> Doc {
        match member {
            SceneMember::Field(field) => self.field_init(field),
            SceneMember::Function(function) => self.fn_decl(function),
            SceneMember::Const(decl) => self.const_decl(decl),
            SceneMember::State(decl) => self.state_decl(decl),
            SceneMember::Object(object) => self.scene_object(object),
            SceneMember::Entity(entity) => self.entity_decl(entity),
            SceneMember::Lifecycle(function) => self.lifecycle_fn(function),
            SceneMember::Handler(handler) => self.handler(handler),
            SceneMember::Error(node) => Doc::text(self.slice(node.span)),
        }
    }

    fn entity_member(&mut self, member: &EntityMember) -> Doc {
        match member {
            EntityMember::Field(field) => self.field_init(field),
            EntityMember::Const(decl) => self.const_decl(decl),
            EntityMember::State(decl) => self.state_decl(decl),
            EntityMember::Param(decl) => self.param_decl(decl),
            EntityMember::Entity(entity) => self.entity_decl(entity),
            EntityMember::Lifecycle(function) => self.lifecycle_fn(function),
            EntityMember::Handler(handler) => self.handler(handler),
            EntityMember::Error(node) => Doc::text(self.slice(node.span)),
        }
    }

    fn entity_decl(&mut self, decl: &EntityDecl) -> Doc {
        let name = self.ident(&decl.name);
        let mut parts = vec![Doc::text("entity "), name];
        let header_end = match &decl.prefab {
            Some(prefab) => {
                parts.push(Doc::text(": "));
                parts.push(self.ident(prefab));
                prefab.span.end
            }
            None => decl.name.span.end,
        };
        let open = self.token_start(TokenKind::LBrace, header_end, decl.span.start);
        parts.push(Doc::Space);
        parts.push(
            self.braced(open, closing(decl.span), &decl.members, &mut |p, m| {
                p.entity_member(m)
            }),
        );
        Doc::concat(parts)
    }

    fn scene_object(&mut self, object: &SceneObject) -> Doc {
        let kind = self.ident(&object.kind);
        let name = self.ident(&object.name);
        let open = self.token_start(TokenKind::LBrace, object.name.span.end, object.span.start);
        let body = self.braced(open, closing(object.span), &object.fields, &mut |p, f| {
            p.field_init(f)
        });
        Doc::concat(vec![kind, Doc::Space, name, Doc::Space, body])
    }

    fn state_decl(&mut self, decl: &StateDecl) -> Doc {
        let name = self.ident(&decl.name);
        let ty = self.ty(&decl.ty);
        let value = self.expr(&decl.value);
        let semicolon = self.semicolon(decl.span.end);
        Doc::concat(vec![
            Doc::text(
                match (
                    decl.shared.is_some(),
                    decl.persist.map(|(persist, _)| persist),
                ) {
                    (false, None) => "state ",
                    (true, None) => "shared state ",
                    (false, Some(Persist::Saved)) => "saved state ",
                    (false, Some(Persist::Setting)) => "setting state ",
                    (true, Some(Persist::Saved)) => "shared saved state ",
                    (true, Some(Persist::Setting)) => "shared setting state ",
                },
            ),
            name,
            Doc::text(": "),
            ty,
            Doc::text(" = "),
            value,
            semicolon,
        ])
    }

    pub(super) fn field_init(&mut self, field: &FieldInit) -> Doc {
        let name = self.ident(&field.name);
        let value = self.field_value(&field.value);
        let semicolon = self.semicolon(field.span.end);
        Doc::concat(vec![name, Doc::text(": "), value, semicolon])
    }

    /// An expression or `bind(expression)`: the value of a field.
    pub(super) fn field_value(&mut self, value: &FieldValue) -> Doc {
        match value {
            FieldValue::Expr(expr) => self.expr(expr),
            FieldValue::Bind(bind) => {
                let leading = self.leading_comments(bind.span.start);
                let source = self.expr(&bind.source);
                let trailing = self.trailing_comments(closing(bind.span));
                let doc = Doc::group(Doc::concat(vec![
                    Doc::text("bind("),
                    Doc::indent(Doc::concat(vec![Doc::SoftLine, source, trailing])),
                    Doc::SoftLine,
                    Doc::text(")"),
                ]));
                combine_leading(leading, doc)
            }
        }
    }

    fn lifecycle_fn(&mut self, function: &LifecycleFn) -> Doc {
        let name = self.ident(&function.name);
        let params = self.params(&function.params, function.name.span.end);
        let body = self.block(&function.body);
        Doc::concat(vec![name, params, Doc::Space, body])
    }

    fn handler(&mut self, handler: &Handler) -> Doc {
        let event = self.ident(&handler.event);
        let after_args = handler
            .args
            .last()
            .map_or(handler.event.span.end, |arg| arg.span().end);
        let close = self.token_start(TokenKind::RParen, after_args, handler.span.start);
        let args = self.list(
            &ListStyle::PARENS,
            &handler.args,
            close,
            &mut |p, arg| match arg {
                HandlerArg::Param(param) => p.param(param),
                HandlerArg::Filter(filter) => p.expr(filter),
            },
        );
        let body = self.block(&handler.body);
        Doc::concat(vec![Doc::text("on "), event, args, Doc::Space, body])
    }

    // ----- parameters and types ---------------------------------------------

    /// A parenthesized parameter list; `after` is where the function's name
    /// ends.
    fn params(&mut self, params: &[Param], after: u32) -> Doc {
        let after_last = params.last().map_or(after, |param| param.span.end);
        let close = self.token_start(TokenKind::RParen, after_last, after_last);
        self.list(&ListStyle::PARENS, params, close, &mut |p, param| {
            p.param(param)
        })
    }

    fn param(&mut self, param: &Param) -> Doc {
        let name = self.ident(&param.name);
        let ty = self.ty(&param.ty);
        Doc::concat(vec![name, Doc::text(": "), ty])
    }

    /// `: Type` or nothing.
    pub(super) fn annotation(&mut self, ty: Option<&Type>) -> Doc {
        match ty {
            Some(ty) => {
                let ty = self.ty(ty);
                Doc::concat(vec![Doc::text(": "), ty])
            }
            None => Doc::Nil,
        }
    }

    /// ` -> Type` or nothing.
    fn return_type(&mut self, ty: Option<&Type>) -> Doc {
        match ty {
            Some(ty) => {
                let ty = self.ty(ty);
                Doc::concat(vec![Doc::text(" -> "), ty])
            }
            None => Doc::Nil,
        }
    }

    pub(super) fn ty(&mut self, ty: &Type) -> Doc {
        let leading = self.leading_comments(ty.span.start);
        let doc = match &ty.kind {
            TypeKind::Named(name) => Doc::text(&name.name),
            TypeKind::Generic {
                name,
                element,
                length,
            } => {
                let element = self.ty(element);
                let length_text = Doc::text(self.slice(length.span));
                let length = self.with_leading(length.span.start, length_text);
                Doc::concat(vec![
                    Doc::text(&name.name),
                    Doc::text("<"),
                    element,
                    Doc::text(", "),
                    length,
                    Doc::text(">"),
                ])
            }
            TypeKind::Error => Doc::text(self.slice(ty.span)),
        };
        combine_leading(leading, doc)
    }

    /// A name.
    pub(super) fn ident(&mut self, ident: &crate::syntax::ast::Ident) -> Doc {
        let doc = Doc::text(&ident.name);
        self.with_leading(ident.span.start, doc)
    }
}
