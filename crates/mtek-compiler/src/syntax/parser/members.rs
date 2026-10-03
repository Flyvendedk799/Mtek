//! The members of scene, entity, prefab and material bodies, scene objects,
//! lifecycle functions and handlers (`spec/grammar.ebnf` sections 3 and 4,
//! `spec/scenes.md`, `spec/materials.md`).
//!
//! The grammar is LL(2) at member level. A member that starts with a name is
//! told apart by the next tokens:
//!
//! | tokens | member |
//! |---|---|
//! | `Ident :` | field initialiser |
//! | `Ident (` | lifecycle function (stage function in a material) |
//! | `Ident Ident {` | scene object |
//!
//! Everything else that starts with a name is a field whose `:` is missing.
//!
//! All four kinds of body share one parser, which reads the union of the
//! members ([`Member`]) and then checks the body allows what was read:
//! a member that is valid Mtek but not here (`fn` in a scene, `param` in an
//! entity that is not a prefab, a field in a material) is `E1040`; it is
//! parsed for its own mistakes and replaced by an `Error` member. A
//! `vertex` or `compute` member of a material is `E4901` and nothing else.

use crate::diagnostics::{Code, Diagnostic};
use crate::source::Span;

use super::Parser;
use super::recover::{Nest, Sync, is_item_keyword, starts_expression};
use crate::syntax::ast::{
    ConstDecl, EntityDecl, EntityMember, ErrorNode, FieldInit, Handler, HandlerArg, LifecycleFn,
    MaterialMember, Node, NodeId, Param, ParamDecl, SceneMember, SceneObject, StageFn, StateDecl,
};
use crate::syntax::token::TokenKind;

/// Where a construct that is parsed by the member machinery stands, for the
/// `E1040` of a construct that does not belong there.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Place {
    TopLevel,
    Block,
    Scene,
    Entity,
    Prefab,
    Material,
}

impl Place {
    /// "in a scene", for messages.
    fn describe(self) -> &'static str {
        match self {
            Place::TopLevel => "at the top level of a file",
            Place::Block => "in a function body or block",
            Place::Scene => "in a scene",
            Place::Entity => "in an entity",
            Place::Prefab => "in a prefab",
            Place::Material => "in a material",
        }
    }

    /// What is allowed there, as advice.
    fn allowed(self) -> &'static str {
        match self {
            Place::TopLevel => {
                "a file contains `import`, `const`, `fn`, `struct`, `material`, `prefab` and `scene` items"
            }
            Place::Block => "a block contains statements such as `let`, `if`, `for` and calls",
            Place::Scene => {
                "a scene contains fields (`name: value;`), `const`, `state`, scene objects (`camera Name { ... }`), `entity` declarations, lifecycle functions and `on` handlers"
            }
            Place::Entity => {
                "an entity contains fields (`name: value;`), `const`, `state`, nested `entity` declarations, lifecycle functions and `on` handlers"
            }
            Place::Prefab => {
                "a prefab contains `param` declarations, fields (`name: value;`), `const`, `state`, lifecycle functions and `on` handlers"
            }
            Place::Material => {
                "a material contains `param` declarations and a stage function such as `fragment(input: SurfaceInput) -> color { ... }`"
            }
        }
    }
}

/// A member of a body, before it is known which body it is in.
pub(super) enum Member {
    Field(FieldInit),
    // The big declarations are boxed: a member is a temporary in every
    // function of the recursion path of nested bodies, and a debug build keeps
    // each temporary on the stack (see [`Parser::member`]).
    Const(Box<ConstDecl>),
    State(Box<StateDecl>),
    Param(Box<ParamDecl>),
    Object(SceneObject),
    Entity(EntityDecl),
    Lifecycle(LifecycleFn),
    Handler(Handler),
    Stage(Box<StageFn>),
    Error(ErrorNode),
}

impl Member {
    fn id(&self) -> NodeId {
        match self {
            Member::Field(node) => node.id,
            Member::Const(node) => node.id,
            Member::State(node) => node.id,
            Member::Param(node) => node.id,
            Member::Object(node) => node.id,
            Member::Entity(node) => node.id,
            Member::Lifecycle(node) => node.id,
            Member::Handler(node) => node.id,
            Member::Stage(node) => node.id,
            Member::Error(node) => node.id,
        }
    }

    fn span(&self) -> Span {
        match self {
            Member::Field(node) => node.span(),
            Member::Const(node) => node.span(),
            Member::State(node) => node.span(),
            Member::Param(node) => node.span(),
            Member::Object(node) => node.span(),
            Member::Entity(node) => node.span(),
            Member::Lifecycle(node) => node.span(),
            Member::Handler(node) => node.span(),
            Member::Stage(node) => node.span(),
            Member::Error(node) => node.span(),
        }
    }

    /// The member as an `Error` member (it has been reported).
    fn into_error(self) -> ErrorNode {
        ErrorNode {
            id: self.id(),
            span: self.span(),
        }
    }

    /// What the member is, in the plural, for `E1040`.
    fn plural(&self) -> &'static str {
        match self {
            Member::Field(_) => "fields",
            Member::Const(_) => "`const` declarations",
            Member::State(_) => "`state` declarations",
            Member::Param(_) => "`param` declarations",
            Member::Object(_) => "scene objects",
            Member::Entity(_) => "`entity` declarations",
            Member::Lifecycle(_) => "lifecycle functions",
            Member::Handler(_) => "`on` handlers",
            Member::Stage(_) => "stage functions",
            Member::Error(_) => "errors",
        }
    }

    /// True if a body of kind `place` has such members (`spec/scenes.md` 2
    /// and 5, `spec/materials.md` 1). Prefabs may syntactically contain
    /// entities; that is a rule of the checker (`E5040`).
    fn allowed_in(&self, place: Place) -> bool {
        matches!(
            (self, place),
            (Member::Error(_), _)
                | (Member::Param(_), Place::Prefab | Place::Material)
                | (Member::Stage(_), Place::Material)
                | (Member::Object(_), Place::Scene)
                | (
                    Member::Field(_)
                        | Member::Const(_)
                        | Member::State(_)
                        | Member::Entity(_)
                        | Member::Lifecycle(_)
                        | Member::Handler(_),
                    Place::Scene | Place::Entity | Place::Prefab,
                )
        )
    }

    pub(super) fn into_scene(self) -> SceneMember {
        match self {
            Member::Field(node) => SceneMember::Field(node),
            Member::Const(node) => SceneMember::Const(*node),
            Member::State(node) => SceneMember::State(*node),
            Member::Object(node) => SceneMember::Object(node),
            Member::Entity(node) => SceneMember::Entity(node),
            Member::Lifecycle(node) => SceneMember::Lifecycle(node),
            Member::Handler(node) => SceneMember::Handler(node),
            // `Parser::member` lets nothing else through a scene body.
            other => SceneMember::Error(other.into_error()),
        }
    }

    pub(super) fn into_entity(self) -> EntityMember {
        match self {
            Member::Field(node) => EntityMember::Field(node),
            Member::Const(node) => EntityMember::Const(*node),
            Member::State(node) => EntityMember::State(*node),
            Member::Param(node) => EntityMember::Param(*node),
            Member::Entity(node) => EntityMember::Entity(node),
            Member::Lifecycle(node) => EntityMember::Lifecycle(node),
            Member::Handler(node) => EntityMember::Handler(node),
            other => EntityMember::Error(other.into_error()),
        }
    }

    pub(super) fn into_material(self) -> MaterialMember {
        match self {
            Member::Param(node) => MaterialMember::Param(*node),
            Member::Stage(node) => MaterialMember::Stage(*node),
            other => MaterialMember::Error(other.into_error()),
        }
    }
}

impl Parser<'_> {
    /// `'{' Member* '}'`: the body of a scene, prefab, material or entity.
    /// Every body is one level of nesting. Without the `{` this reports it and
    /// answers no members (nothing consumed).
    pub(super) fn body(&mut self, place: Place) -> Vec<Member> {
        let open = self.span();
        if self.kind() != TokenKind::LBrace {
            self.expected("`{` to start the body");
            return Vec::new();
        }
        if !self.enter() {
            return self.body_too_deep(open, place);
        }
        self.bump();
        let mut members = Vec::new();
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof) {
            let before = self.pos;
            members.push(self.member(place));
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        self.leave();
        members
    }

    /// The nesting limit was hit by the body that starts at `open`: `E1050`,
    /// skip it without recursion.
    #[inline(never)]
    fn body_too_deep(&mut self, open: Span, place: Place) -> Vec<Member> {
        let nest = if place == Place::Entity {
            Nest::Entity
        } else {
            Nest::Block
        };
        self.report_nesting(open, nest);
        self.skip_nested(true);
        vec![Member::Error(self.error_node(open.start))]
    }

    /// One member of a body of kind `place`. Always consumes a token unless
    /// the current one is `}` or the end of the file.
    ///
    /// The functions on the recursion path of nested bodies (this one,
    /// [`Parser::member_of_kind`], [`Parser::entity_member`]) keep their frames
    /// small: in a debug build every temporary of every match arm has a slot
    /// of its own, and the nesting limit is deep (see the module
    /// documentation), so each kind of member is built by a function of its
    /// own that is not on the path of the others.
    fn member(&mut self, place: Place) -> Member {
        self.depth_reported = false;
        self.mark_documentable();
        let first = self.span();
        let member = self.member_of_kind(place);
        if member.allowed_in(place) {
            return member;
        }
        self.rejected_member(first, place, &member)
    }

    /// The member does not belong in `place`: `E1040`, and an `Error` member
    /// stands for it.
    #[inline(never)]
    fn rejected_member(&mut self, first: Span, place: Place, member: &Member) -> Member {
        self.report_not_allowed(first, place, member.plural());
        Member::Error(ErrorNode {
            id: member.id(),
            span: member.span(),
        })
    }

    fn member_of_kind(&mut self, place: Place) -> Member {
        match self.kind() {
            TokenKind::KwConst => self.const_member(),
            TokenKind::KwState => self.state_member(),
            TokenKind::KwParam => self.param_member(),
            TokenKind::KwEntity => self.entity_member(),
            TokenKind::KwOn => self.handler_member(),
            // `material: Unlit { ... };` is a field; the keyword is also its name.
            TokenKind::KwMaterial if self.kind_at(1) == TokenKind::Colon => {
                self.named_member(place)
            }
            kind if is_item_keyword(kind) => self.misplaced_item(place),
            TokenKind::KwLet
            | TokenKind::KwVar
            | TokenKind::KwIf
            | TokenKind::KwFor
            | TokenKind::KwReturn
            | TokenKind::KwBreak
            | TokenKind::KwContinue => self.misplaced_statement(place),
            TokenKind::Ident | TokenKind::Underscore => self.named_member(place),
            _ => self.unexpected_member(place),
        }
    }

    fn const_member(&mut self) -> Member {
        let start = self.span().start;
        let decl = self.const_decl(Sync::Member);
        self.member_from(start, decl, |decl| Member::Const(Box::new(decl)))
    }

    fn state_member(&mut self) -> Member {
        let start = self.span().start;
        let decl = self.state_decl();
        self.member_from(start, decl, |decl| Member::State(Box::new(decl)))
    }

    fn param_member(&mut self) -> Member {
        let start = self.span().start;
        let decl = self.param_decl();
        self.member_from(start, decl, |decl| Member::Param(Box::new(decl)))
    }

    fn entity_member(&mut self) -> Member {
        let start = self.span().start;
        let decl = self.entity_decl();
        self.member_from(start, decl, Member::Entity)
    }

    fn handler_member(&mut self) -> Member {
        let start = self.span().start;
        let decl = self.handler();
        self.member_from(start, decl, Member::Handler)
    }

    fn field_member(&mut self) -> Member {
        let start = self.span().start;
        let field = self.field_init();
        self.member_from(start, field, Member::Field)
    }

    fn lifecycle_member(&mut self) -> Member {
        let start = self.span().start;
        let function = self.lifecycle_fn();
        self.member_from(start, function, Member::Lifecycle)
    }

    fn object_member(&mut self) -> Member {
        let start = self.span().start;
        let object = self.scene_object();
        self.member_from(start, object, Member::Object)
    }

    /// A declaration that is no member (an item): `E1040`, parsed and dropped.
    #[inline(never)]
    fn misplaced_item(&mut self, place: Place) -> Member {
        let start = self.span().start;
        self.drop_misplaced(place);
        Member::Error(self.error_node(start))
    }

    /// `member` of the parsed `value`, or an `Error` member from `start` if
    /// the construct was too broken to build.
    fn member_from<T>(&mut self, start: u32, value: Option<T>, wrap: fn(T) -> Member) -> Member {
        match value {
            Some(value) => wrap(value),
            None => Member::Error(self.error_node(start)),
        }
    }

    /// A member that starts with a name: told apart by the tokens after it.
    fn named_member(&mut self, place: Place) -> Member {
        match (self.kind_at(1), self.kind_at(2)) {
            (TokenKind::Colon, _) => self.field_member(),
            (TokenKind::LParen, _) if place == Place::Material => self.stage_member(),
            (TokenKind::LParen, _) => self.lifecycle_member(),
            (TokenKind::Ident, TokenKind::LBrace) => self.object_member(),
            _ if place == Place::Material => self.unexpected_member(place),
            // A field whose `:` was forgotten.
            _ => self.field_member(),
        }
    }

    /// A token that starts no member: `E1001` listing what can, and skip to
    /// the next member.
    #[inline(never)]
    fn unexpected_member(&mut self, place: Place) -> Member {
        let start = self.span().start;
        let what = match place {
            Place::Material => {
                "a member of the material: `param name: Type = value;`, a stage function such as `fragment(...) { ... }`, or `}`"
            }
            Place::Prefab => {
                "a member of the prefab: a field `name: value;`, `param`, `const`, `state`, `entity`, a lifecycle function, `on`, or `}`"
            }
            _ => {
                "a member: a field `name: value;`, `const`, `state`, `entity`, a lifecycle function such as `update(dt: f32) { ... }`, `on`, a scene object such as `camera Name { ... }`, or `}`"
            }
        };
        self.expected(what);
        self.skip_to_sync(Sync::Member);
        Member::Error(self.error_node(start))
    }

    /// A statement in a body that has no statements: `E1040`; it is parsed
    /// and dropped.
    #[inline(never)]
    fn misplaced_statement(&mut self, place: Place) -> Member {
        let first = self.span();
        self.report_not_allowed(first, place, "statements");
        drop(self.stmt());
        Member::Error(self.error_node(first.start))
    }

    // ----- E1040 -------------------------------------------------------------

    /// A declaration or member that does not belong in `place` (the current
    /// token starts it): `E1040`, then it is parsed, for its own mistakes,
    /// and dropped.
    pub(super) fn drop_misplaced(&mut self, place: Place) {
        let first = self.span();
        let noun = self.construct_plural();
        self.report_not_allowed(first, place, &noun);
        match self.kind() {
            TokenKind::KwState => drop(self.state_decl()),
            TokenKind::KwParam => drop(self.param_decl()),
            TokenKind::KwEntity => drop(self.entity_decl()),
            TokenKind::KwOn => drop(self.handler()),
            _ => drop(self.item()),
        }
    }

    /// The construct that starts at the current token, in the plural, for
    /// messages: `` `fn` declarations ``.
    fn construct_plural(&self) -> String {
        let word = |n: usize| {
            self.tokens
                .get(self.pos.saturating_add(n))
                .map_or("", |token| token.text(self.text))
        };
        match self.kind() {
            TokenKind::KwOn => "`on` handlers".to_owned(),
            TokenKind::KwExport | TokenKind::KwCpu => {
                format!("`{} {}` declarations", word(0), word(1))
            }
            _ => format!("`{}` declarations", word(0)),
        }
    }

    #[inline(never)]
    fn report_not_allowed(&mut self, first: Span, place: Place, what: &str) {
        let diagnostic = Diagnostic::new(
            Code::E1040,
            format!("{what} cannot appear {}.", place.describe()),
        )
        .at(first)
        .help(place.allowed());
        self.report(diagnostic);
    }

    // ----- fields, state, params -----------------------------------------------

    /// `name: value;`. The value is a `FieldValue`: `bind(expr)` or an
    /// expression. A `:` that is missing (or an `=` written instead) is
    /// `E1001`; the value is read all the same.
    pub(super) fn field_init(&mut self) -> Option<FieldInit> {
        let start = self.span().start;
        let name = self.field_name()?;
        match self.kind() {
            TokenKind::Colon => self.bump(),
            TokenKind::Eq => {
                self.expected_colon_after(&name.name);
                self.bump();
            }
            _ => self.expected_colon_after(&name.name),
        }
        let mut height = 0;
        let value = self.field_value(&mut height);
        self.semi(Sync::Member, "field");
        Some(FieldInit {
            id: self.id(),
            span: self.span_from(start),
            name,
            value,
        })
    }

    /// `state name: Type = expr;`.
    pub(super) fn state_decl(&mut self) -> Option<StateDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a name after `state`");
            self.skip_to_sync(Sync::Member);
            return None;
        };
        if self.kind() == TokenKind::Colon {
            self.bump();
        } else {
            self.expected_colon_and_type("the state", &name.name);
        }
        let ty = self.ty();
        let value = self.initialiser("`state`");
        self.semi(Sync::Member, "declaration");
        Some(StateDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
            value,
        })
    }

    /// `param name: Type = default;` (the default is optional).
    pub(super) fn param_decl(&mut self) -> Option<ParamDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.expected("a name after `param`");
            self.skip_to_sync(Sync::Member);
            return None;
        };
        if self.kind() == TokenKind::Colon {
            self.bump();
        } else {
            self.expected_colon_and_type("the parameter", &name.name);
        }
        let ty = self.ty();
        let default = if self.kind() == TokenKind::Eq {
            self.bump();
            Some(self.expr(true))
        } else {
            None
        };
        self.semi(Sync::Member, "declaration");
        Some(ParamDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            ty,
            default,
        })
    }

    // ----- scene objects, entities ---------------------------------------------

    /// `kind Name { field: value; ... }`, e.g. `camera Main { ... }`; the
    /// current token is `kind`, followed by a name and a `{`.
    fn scene_object(&mut self) -> Option<SceneObject> {
        let start = self.span().start;
        let kind = self.ident()?;
        let name = self.ident()?;
        let open = self.span();
        self.bump();
        let mut fields = Vec::new();
        while !matches!(self.kind(), TokenKind::RBrace | TokenKind::Eof) {
            let before = self.pos;
            self.depth_reported = false;
            self.mark_documentable();
            if self.at_field_name() {
                if let Some(field) = self.field_init() {
                    fields.push(field);
                }
            } else {
                self.expected("a field `name: value;` or `}`");
                self.skip_to_sync(Sync::Member);
            }
            if self.pos == before {
                self.bump();
            }
        }
        self.expect_close(open, TokenKind::RBrace);
        Some(SceneObject {
            id: self.id(),
            span: self.span_from(start),
            kind,
            name,
            fields,
        })
    }

    /// `entity Name { ... }` and `entity Name: Prefab { ... }`.
    pub(super) fn entity_decl(&mut self) -> Option<EntityDecl> {
        let start = self.span().start;
        self.bump();
        let Some(name) = self.ident() else {
            self.recover_decl_header("an entity name after `entity`", Place::Entity);
            return None;
        };
        let prefab = if self.kind() == TokenKind::Colon {
            self.bump();
            let prefab = self.ident();
            if prefab.is_none() {
                self.expected("the name of a prefab after `:`");
            }
            prefab
        } else {
            None
        };
        let members = self
            .body(Place::Entity)
            .into_iter()
            .map(Member::into_entity)
            .collect();
        Some(EntityDecl {
            id: self.id(),
            span: self.span_from(start),
            name,
            prefab,
            members,
        })
    }

    // ----- functions and handlers -----------------------------------------------

    /// `update(dt: f32) { ... }`: which names are lifecycle functions is the
    /// checker's rule.
    fn lifecycle_fn(&mut self) -> Option<LifecycleFn> {
        let start = self.span().start;
        let name = self.ident()?;
        let params = self.param_list();
        self.reject_return_type("lifecycle function");
        let body = self.fn_body();
        Some(LifecycleFn {
            id: self.id(),
            span: self.span_from(start),
            name,
            params,
            body,
        })
    }

    /// A stage function of a material, or a `vertex` or `compute` stage:
    /// `E4901`, parsed and dropped.
    fn stage_member(&mut self) -> Member {
        let start = self.span().start;
        if self.tok().is_reserved_word()
            && matches!(self.text_of(self.span()), "vertex" | "compute")
        {
            self.unsupported_stage();
            return Member::Error(self.error_node(start));
        }
        let stage = self.stage_fn();
        self.member_from(start, stage, |stage| Member::Stage(Box::new(stage)))
    }

    /// `fragment(input: SurfaceInput) -> color { ... }`.
    fn stage_fn(&mut self) -> Option<StageFn> {
        let start = self.span().start;
        let name = self.ident()?;
        let params = self.param_list();
        let ret = self.return_type();
        let body = self.fn_body();
        Some(StageFn {
            id: self.id(),
            span: self.span_from(start),
            name,
            params,
            ret,
            body,
        })
    }

    /// A `vertex` or `compute` stage (reserved words, `spec/materials.md` 1):
    /// `E4901` at the word, and nothing else; in particular not `E0013`. The
    /// function is parsed as a stage function, for the mistakes in it, and
    /// dropped.
    #[inline(never)]
    fn unsupported_stage(&mut self) {
        let word = self.span();
        let name = self.text_of(word);
        let diagnostic = Diagnostic::new(
            Code::E4901,
            format!("Custom `{name}` stages are not supported in v0.1; they are planned for v0.2."),
        )
        .at(word)
        .help("a material has exactly one stage function, `fragment`; the compiler supplies the vertex stage");
        self.report(diagnostic);
        self.bump();
        drop(self.param_list());
        drop(self.return_type());
        drop(self.fn_body());
    }

    /// `on event(args) { ... }`; `None` if the header is broken (the body has
    /// been parsed and dropped).
    pub(super) fn handler(&mut self) -> Option<Handler> {
        let start = self.span().start;
        self.bump();
        let Some(event) = self.ident() else {
            self.expected("an event name after `on`");
            self.recover_handler();
            return None;
        };
        if self.kind() != TokenKind::LParen {
            self.expected("`(` after the event name");
            self.recover_handler();
            return None;
        }
        let open = self.span();
        self.bump();
        let mut args = Vec::new();
        while self.list_has_item(TokenKind::RParen) {
            let parsed = self.handler_arg_into(&mut args);
            if !self.list_continues(TokenKind::Comma, TokenKind::RParen, parsed) {
                break;
            }
        }
        self.expect_close(open, TokenKind::RParen);
        self.reject_return_type("handler");
        let body = self.fn_body();
        Some(Handler {
            id: self.id(),
            span: self.span_from(start),
            event,
            args,
            body,
        })
    }

    fn recover_handler(&mut self) {
        if self.skip_to_block() {
            drop(self.fn_body());
        } else if self.kind() == TokenKind::Semi {
            self.bump();
        }
    }

    /// One `HandlerArg`: `name: Type` is the parameter form (told apart by the
    /// `:` after a name), anything else is a filter expression. False
    /// (nothing consumed) if neither can start here.
    fn handler_arg_into(&mut self, args: &mut Vec<HandlerArg>) -> bool {
        if self.at_name() && self.kind_at(1) == TokenKind::Colon {
            let start = self.span().start;
            let Some(name) = self.ident() else {
                return false;
            };
            self.bump();
            let ty = self.ty();
            args.push(HandlerArg::Param(Param {
                id: self.id(),
                span: self.span_from(start),
                name,
                ty,
            }));
            return true;
        }
        if starts_expression(self.kind()) {
            args.push(HandlerArg::Filter(self.expr(true)));
            return true;
        }
        self.expected(
            "an event argument: a filter such as `Key.Space` or a parameter `name: Type`",
        );
        false
    }
}
