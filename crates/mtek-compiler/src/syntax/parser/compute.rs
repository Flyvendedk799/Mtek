//! Standalone compute declarations. `compute`, `input` and `output` are read in
//! their declaration positions; existing expression/member names keep their meaning.

use super::Parser;
use super::recover::Sync;
use crate::syntax::ast::{ComputeDecl, ComputeMember, StorageDecl};
use crate::syntax::token::TokenKind;

impl Parser<'_> {
    pub(super) fn compute_decl(&mut self) -> Option<ComputeDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a compute program name after `compute`");
            self.skip_to_sync(Sync::Item);
            return None;
        };
        let open = self.span();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` to start the compute program");
            return None;
        }
        if !self.enter() {
            self.skip_to_sync(Sync::Item);
            return None;
        }
        self.bump();
        let mut members = Vec::new();
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof)
            && !self.at_unindented_item()
        {
            let before = self.pos;
            self.start_construct();
            self.mark_documentable();
            let member_start = self.span().start;
            let member = match self.kind() {
                TokenKind::KwParam => self.param_decl().map(ComputeMember::Param),
                TokenKind::Ident | TokenKind::Underscore => match self.text_of(self.span()) {
                    "input" => self.storage_decl().map(ComputeMember::Input),
                    "output" => self.storage_decl().map(ComputeMember::Output),
                    "workgroup_size" if self.kind_at(1) != TokenKind::LParen => {
                        self.field_init().map(ComputeMember::Workgroup)
                    }
                    _ if self.kind_at(1) == TokenKind::LParen => {
                        self.stage_fn().map(ComputeMember::Stage)
                    }
                    _ => None,
                },
                _ => None,
            };
            members.push(match member {
                Some(member) => member,
                None => {
                    if self.pos == before {
                        self.expected(
                            "`param`, `input`, `output`, `workgroup_size` or a kernel function",
                        );
                        self.skip_to_sync(Sync::Member);
                    }
                    ComputeMember::Error(self.error_node(member_start))
                }
            });
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        self.leave();
        Some(ComputeDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            members,
        })
    }

    fn storage_decl(&mut self) -> Option<StorageDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a storage buffer name");
            self.skip_to_sync(Sync::Member);
            return None;
        };
        if self.kind() == TokenKind::Colon {
            self.bump();
        } else {
            self.expected_colon_and_type("the storage buffer", &name.name);
        }
        let ty = self.ty();
        self.semi(Sync::Member, "storage declaration");
        Some(StorageDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
        })
    }
}
