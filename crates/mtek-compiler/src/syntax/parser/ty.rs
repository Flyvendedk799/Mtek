//! Types and parameter lists (`spec/grammar.ebnf` sections 2 and 5).
//!
//! `Type ::= Ident ( '<' Type ',' ArrayLength '>' )?`: the grammar accepts type
//! arguments on every name; that only `array` takes them is the checker's
//! rule. A type is always built: where none can be read the result is a
//! [`TypeKind::Error`] type with an empty span.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::Span;

use super::Parser;
use super::recover::Nest;
use crate::syntax::ast::{ArrayLength, ArrayLengthKind, Param, Type, TypeKind};
use crate::syntax::token::{TokenKind, TokenValue};

impl Parser<'_> {
    /// One `Type`. Every level of type arguments is a level of nesting.
    pub(super) fn ty(&mut self) -> Type {
        let start = self.span().start;
        if !self.enter() {
            return self.type_too_deep(start);
        }
        let ty = self.ty_inner(start);
        self.leave();
        ty
    }

    fn ty_inner(&mut self, start: u32) -> Type {
        let Some(name) = self.ident() else {
            self.expected("a type");
            return self.error_type();
        };
        if self.kind() != TokenKind::Lt {
            let kind = TypeKind::Named(name);
            return self.make_type(start, kind);
        }
        let open = self.span();
        self.bump();
        let element = self.ty();
        let length = if self.kind() == TokenKind::Comma {
            self.bump();
            self.array_length()
        } else {
            self.expected("`,` and an array length after the element type");
            self.error_length()
        };
        if !self.eat_closing_angle() {
            self.report_unclosed_angle(open);
        }
        let kind = TypeKind::Generic {
            name,
            element: Box::new(element),
            length,
        };
        self.make_type(start, kind)
    }

    #[inline(never)]
    fn report_unclosed_angle(&mut self, open: Span) {
        let diagnostic = self
            .expected_diagnostic("`>` to close the type arguments")
            .related(open, "opened here");
        self.error(diagnostic);
    }

    fn make_type(&mut self, start: u32, kind: TypeKind) -> Type {
        Type {
            id: self.id(),
            span: self.span_from(start),
            kind,
        }
    }

    /// A `Type` that stands for text that is not a type: an empty span at the
    /// current token.
    fn error_type(&mut self) -> Type {
        let span = self.placeholder_span();
        Type {
            id: self.id(),
            span,
            kind: TypeKind::Error,
        }
    }

    /// `ArrayLength ::= Int | Ident`.
    fn array_length(&mut self) -> ArrayLength {
        let span = self.span();
        let kind = match self.kind() {
            TokenKind::Int => {
                let value = match &self.tok().value {
                    TokenValue::Int { value } => *value,
                    _ => None,
                };
                let malformed = self.tok().is_malformed();
                self.bump();
                if malformed {
                    ArrayLengthKind::Error
                } else {
                    ArrayLengthKind::Int { value }
                }
            }
            TokenKind::Ident | TokenKind::Underscore => {
                let (name, _) = self.name_text();
                ArrayLengthKind::Name(name)
            }
            _ => {
                self.expected("an array length (an integer or the name of a constant)");
                return self.error_length();
            }
        };
        ArrayLength {
            id: self.id(),
            span,
            kind,
        }
    }

    fn error_length(&mut self) -> ArrayLength {
        let span = self.placeholder_span();
        ArrayLength {
            id: self.id(),
            span,
            kind: ArrayLengthKind::Error,
        }
    }

    /// The nesting limit was hit by the type that starts at `start`: `E1050`,
    /// skip the type (balancing its `<` and `>`) and answer with an `Error`
    /// type.
    #[inline(never)]
    fn type_too_deep(&mut self, start: u32) -> Type {
        let at = self.span();
        self.report_nesting(at, Nest::Type);
        self.skip_type();
        let end = self.prev_end.max(start);
        Type {
            id: self.id(),
            span: Span::new(at.file, start, end),
            kind: TypeKind::Error,
        }
    }

    /// Skip `Ident` and, when it is followed by `<`, everything up to the
    /// matching `>`. Stops at anything that cannot be part of a type.
    fn skip_type(&mut self) {
        if matches!(self.kind(), TokenKind::Ident | TokenKind::Underscore) {
            self.bump();
        }
        if self.kind() != TokenKind::Lt {
            return;
        }
        let mut angles = 0u32;
        loop {
            match self.kind() {
                TokenKind::Lt => angles += 1,
                TokenKind::Gt | TokenKind::Ge => angles = angles.saturating_sub(1),
                TokenKind::Shr => angles = angles.saturating_sub(2),
                TokenKind::Ident | TokenKind::Underscore | TokenKind::Int | TokenKind::Comma => {}
                // Anything else is not part of a type: the text is broken
                // and the caller's recovery takes over.
                _ => return,
            }
            self.bump();
            if angles == 0 {
                return;
            }
        }
    }

    // ----- parameters ------------------------------------------------------

    /// `ParamList?` between parentheses, starting at the `(`. Without the `(`
    /// this reports it and answers an empty list (nothing consumed).
    pub(super) fn param_list(&mut self) -> Vec<Param> {
        let mut params = Vec::new();
        if self.kind() != TokenKind::LParen {
            self.expected("`(` to start the parameter list");
            return params;
        }
        let open = self.span();
        self.bump();
        while self.list_has_item(TokenKind::RParen) {
            let parsed = self.param_into(&mut params);
            if !self.list_continues(TokenKind::Comma, TokenKind::RParen, parsed) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RParen);
        params
    }

    /// One `Param ::= Ident ':' Type`, appended to `params`. False (nothing
    /// consumed) if there is no name.
    fn param_into(&mut self, params: &mut Vec<Param>) -> bool {
        let start = self.span().start;
        let Some(name) = self.ident() else {
            self.expected("a parameter name or `)`");
            return false;
        };
        if self.kind() == TokenKind::Colon {
            self.bump();
        } else {
            self.expected_colon_and_type("the parameter name", &name.name);
        }
        let ty = self.ty();
        params.push(Param {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
        });
        true
    }

    /// `E1001`: a name was not followed by the `:` and the type it needs.
    #[inline(never)]
    pub(super) fn expected_colon_and_type(&mut self, what: &str, name: &str) {
        let diagnostic = self.expected_diagnostic(&format!("`:` and a type after {what} `{name}`"));
        self.error(diagnostic);
    }

    /// `( '->' Type )?`.
    pub(super) fn return_type(&mut self) -> Option<Type> {
        if self.kind() != TokenKind::Arrow {
            return None;
        }
        self.bump();
        Some(self.ty())
    }

    /// A `->` where the construct has no result (`what` is e.g. "lifecycle
    /// function"): `E1001`, and the type is parsed and dropped so that it does
    /// not cascade.
    pub(super) fn reject_return_type(&mut self, what: &str) {
        if self.kind() != TokenKind::Arrow {
            return;
        }
        let diagnostic = Diagnostic::new(
            Code::E1001,
            format!("A {what} has no result: remove `-> Type`."),
        )
        .at(self.span());
        self.error(diagnostic);
        self.bump();
        drop(self.ty());
    }
}
