//! Modules and items (`spec/grammar.ebnf` sections 2 and 3, and the item
//! level of section 4): `import`, `const`, `fn`, `struct`, `material`,
//! `prefab` and `scene`, with `export` in front of all but the import.
//!
//! Recovery at item level skips to the next item keyword at nesting depth 0
//! ([`Sync::Item`]); a declaration whose header is broken still has its body
//! parsed, for the mistakes in it, and is then dropped.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::Span;

use super::Parser;
use super::members::{Member, Place};
use super::recover::Sync;
use crate::syntax::ast::{
    ConstDecl, FnDecl, ImportDecl, Item, ItemKind, MaterialDecl, Module, PrefabDecl, SceneDecl,
    StrLit, StructDecl, StructField,
};
use crate::syntax::token::{TokenKind, TokenValue};

impl Parser<'_> {
    /// `Module ::= Item* EOF`.
    pub(super) fn module(&mut self) -> Module {
        let mut items = Vec::new();
        while self.kind() != TokenKind::Eof {
            let before = self.pos;
            self.depth_reported = false;
            if self.kind() != TokenKind::KwImport {
                self.mark_documentable();
            }
            items.push(self.item());
            if self.pos == before {
                self.bump();
            }
        }
        self.report_dangling_doc_comments();
        let end = u32::try_from(self.text.len()).unwrap_or(u32::MAX);
        Module {
            id: self.id(),
            span: Span::new(self.file, 0, end),
            items,
            node_count: self.next_id,
        }
    }

    /// One `Item`, or an `Error` item for text that is none. Consumes a token
    /// unless the current one is the end of the file.
    pub(super) fn item(&mut self) -> Item {
        let start = self.span().start;
        let mut export = false;
        if self.kind() == TokenKind::KwExport {
            export = true;
            self.bump();
        }
        let kind = match self.kind() {
            TokenKind::KwImport => {
                if export {
                    self.report_export_import(start);
                    export = false;
                }
                match self.import_decl() {
                    Some(decl) => ItemKind::Import(decl),
                    None => ItemKind::Error,
                }
            }
            TokenKind::KwConst => match self.const_decl(Sync::Item) {
                Some(decl) => ItemKind::Const(decl),
                None => ItemKind::Error,
            },
            TokenKind::KwFn | TokenKind::KwCpu => match self.fn_decl() {
                Some(decl) => ItemKind::Fn(decl),
                None => ItemKind::Error,
            },
            TokenKind::KwStruct => match self.struct_decl() {
                Some(decl) => ItemKind::Struct(decl),
                None => ItemKind::Error,
            },
            TokenKind::KwMaterial => match self.material_decl() {
                Some(decl) => ItemKind::Material(decl),
                None => ItemKind::Error,
            },
            TokenKind::KwPrefab => match self.prefab_decl() {
                Some(decl) => ItemKind::Prefab(decl),
                None => ItemKind::Error,
            },
            TokenKind::KwScene => match self.scene_decl() {
                Some(decl) => ItemKind::Scene(decl),
                None => ItemKind::Error,
            },
            _ => {
                self.not_an_item(export);
                ItemKind::Error
            }
        };
        Item {
            id: self.id(),
            span: self.span_from(start),
            export,
            kind,
        }
    }

    /// `export import ...`: only declarations can be exported.
    #[inline(never)]
    fn report_export_import(&mut self, start: u32) {
        let diagnostic = Diagnostic::new(
            Code::E1001,
            "An `import` cannot be exported; only `const`, `fn`, `struct`, `material`, `prefab` and `scene` items can.",
        )
        .at(Span::new(self.file, start, start + 6))
        .help("remove `export`");
        self.error(diagnostic);
    }

    /// The current token starts no item. A member-like declaration is `E1040`
    /// (and is skipped as a whole); anything else is `E1001`.
    #[inline(never)]
    fn not_an_item(&mut self, exported: bool) {
        if !exported
            && matches!(
                self.kind(),
                TokenKind::KwEntity | TokenKind::KwState | TokenKind::KwParam | TokenKind::KwOn
            )
        {
            self.drop_misplaced(Place::TopLevel);
            return;
        }
        let diagnostic = self.expected_diagnostic(
            "an item: `import`, `const`, `fn`, `cpu fn`, `struct`, `material`, `prefab` or `scene`",
        );
        self.error(diagnostic);
        self.skip_to_sync(Sync::Item);
    }

    // ----- import ------------------------------------------------------------

    /// `import { A, B } from "./path.mtek";` (`from` is a contextual word).
    fn import_decl(&mut self) -> Option<ImportDecl> {
        let start = self.span().start;
        self.bump();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` and the names to import");
            self.skip_to_sync(Sync::Item);
            return None;
        }
        let open = self.span();
        self.bump();
        let empty = self.kind() == TokenKind::RBrace;
        let mut names = Vec::new();
        while self.list_has_item(TokenKind::RBrace) {
            let parsed = if let Some(name) = self.ident() {
                names.push(name);
                true
            } else {
                self.expected("a name to import or `}`");
                false
            };
            if !self.list_continues(TokenKind::Comma, TokenKind::RBrace, parsed) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        if empty {
            self.report_empty_import(open);
        }
        if self.kind() == TokenKind::Ident && self.text_of(self.span()) == "from" {
            self.bump();
        } else {
            self.expected("`from` after the list of imported names");
        }
        let Some(source) = self.string_literal() else {
            self.expected("the path of the module to import, a string literal");
            self.skip_to_sync(Sync::Item);
            return None;
        };
        self.semi(Sync::Item, "import");
        Some(ImportDecl {
            id: self.id(),
            span: self.span_from(start),
            names,
            source,
        })
    }

    #[inline(never)]
    fn report_empty_import(&mut self, open: Span) {
        let diagnostic = Diagnostic::new(Code::E1001, "An import needs at least one name.")
            .at(self.span_from(open.start));
        self.error(diagnostic);
    }

    /// A string literal as a [`StrLit`]; `None`, nothing consumed, for any
    /// other token.
    fn string_literal(&mut self) -> Option<StrLit> {
        if self.kind() != TokenKind::String {
            return None;
        }
        let span = self.span();
        let value = match &self.tok().value {
            TokenValue::String(text) => Some(text.clone()),
            _ => None,
        };
        self.bump();
        Some(StrLit {
            id: self.id(),
            span,
            value,
        })
    }

    // ----- const -------------------------------------------------------------

    /// `const NAME: Type = expr;`, at module level, in a scene, entity or
    /// prefab body, or as a statement. `None` if there is no name (the
    /// construct has been skipped per `sync`).
    pub(super) fn const_decl(&mut self, sync: Sync) -> Option<ConstDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a constant name after `const`");
            self.skip_to_sync(sync);
            return None;
        };
        let ty = if self.kind() == TokenKind::Colon {
            self.bump();
            Some(self.ty())
        } else {
            None
        };
        let value = self.initialiser("a constant");
        self.semi(sync, "constant declaration");
        Some(ConstDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
            value,
        })
    }

    // ----- functions ---------------------------------------------------------

    /// `fn name(params) -> T { ... }` and `cpu fn ...`. `None` if the header is
    /// broken (its body, if any, has been parsed and dropped).
    fn fn_decl(&mut self) -> Option<FnDecl> {
        let start = self.span().start;
        let cpu = self.kind() == TokenKind::KwCpu;
        if cpu {
            self.bump();
            if self.kind() != TokenKind::KwFn {
                self.expected("`fn` after `cpu`");
                self.recover_fn_header();
                return None;
            }
        }
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a function name after `fn`");
            self.recover_fn_header();
            return None;
        };
        let params = self.param_list();
        let ret = self.return_type();
        let body = self.fn_body();
        Some(FnDecl {
            id: self.id(),
            span: self.span_from(start),
            cpu,
            name,
            params,
            ret,
            body,
        })
    }

    fn recover_fn_header(&mut self) {
        if self.skip_to_block() {
            drop(self.fn_body());
        } else if self.kind() == TokenKind::Semi {
            self.bump();
        }
    }

    // ----- struct ------------------------------------------------------------

    /// `struct Name { field: Type; ... }`.
    fn struct_decl(&mut self) -> Option<StructDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a struct name after `struct`");
            if self.skip_to_block() {
                drop(self.struct_fields());
            }
            return None;
        };
        let fields = self.struct_fields();
        Some(StructDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            fields,
        })
    }

    /// `{ StructField+ }`. Without the `{` this reports it and answers no
    /// fields.
    fn struct_fields(&mut self) -> Vec<StructField> {
        let mut fields = Vec::new();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` and the fields of the struct");
            return fields;
        }
        let open = self.span();
        self.bump();
        let empty = self.kind() == TokenKind::RBrace;
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof) {
            let before = self.pos;
            self.depth_reported = false;
            self.mark_documentable();
            if let Some(field) = self.struct_field() {
                fields.push(field);
            }
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        if empty {
            self.report_empty_struct(open);
        }
        fields
    }

    #[inline(never)]
    fn report_empty_struct(&mut self, open: Span) {
        let diagnostic = Diagnostic::new(Code::E1001, "A struct needs at least one field.")
            .at(self.span_from(open.start))
            .help("declare a field as `name: Type;`");
        self.error(diagnostic);
    }

    /// `name: Type;` inside a struct.
    fn struct_field(&mut self) -> Option<StructField> {
        let start = self.span().start;
        let Some(name) = self.ident() else {
            self.expected("a field `name: Type;` or `}`");
            self.skip_to_sync(Sync::Member);
            return None;
        };
        if self.kind() == TokenKind::Colon {
            self.bump();
        } else {
            self.expected_colon_and_type("the field name", &name.name);
        }
        let ty = self.ty();
        self.semi(Sync::Member, "field");
        Some(StructField {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
        })
    }

    // ----- material, prefab, scene -------------------------------------------

    /// `material Name { param ...; stage(...) { ... } }`.
    fn material_decl(&mut self) -> Option<MaterialDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.recover_decl_header("a material name after `material`", Place::Material);
            return None;
        };
        let members = self
            .body(Place::Material)
            .into_iter()
            .map(Member::into_material)
            .collect();
        Some(MaterialDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            members,
        })
    }

    /// `prefab Name { ... }`.
    fn prefab_decl(&mut self) -> Option<PrefabDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.recover_decl_header("a prefab name after `prefab`", Place::Prefab);
            return None;
        };
        let members = self
            .body(Place::Prefab)
            .into_iter()
            .map(Member::into_entity)
            .collect();
        Some(PrefabDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            members,
        })
    }

    /// `scene Name { ... }`.
    fn scene_decl(&mut self) -> Option<SceneDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.recover_decl_header("a scene name after `scene`", Place::Scene);
            return None;
        };
        let members = self
            .body(Place::Scene)
            .into_iter()
            .map(Member::into_scene)
            .collect();
        Some(SceneDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            members,
        })
    }

    /// The name of a declaration is missing: `E1001`; the body is still
    /// parsed, for its own mistakes, and dropped.
    #[inline(never)]
    pub(super) fn recover_decl_header(&mut self, what: &str, place: Place) {
        self.expected(what);
        if self.skip_to_block() {
            drop(self.body(place));
        } else if self.kind() == TokenKind::Semi {
            self.bump();
        }
    }
}
