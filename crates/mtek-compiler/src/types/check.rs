//! The type checker: bidirectional typing of the expressions this build
//! implements (`spec/language.md` sections 5 and 6, decision 0026).
//!
//! `check(expr, expected)` computes the type of `expr` and records it. The
//! expected type, when there is one, flows into literals (section 6.6),
//! constructor and function arguments, operands of `+` and `-`, and the
//! fields of descriptor literals; it is a hint, not a demand: whoever passed
//! it decides whether a different type is an error, because the code differs
//! (`E3001` for constants and arguments here, `E3102` for schema fields in the
//! schema checks).
//!
//! # Gated constructs
//!
//! The checker types exactly the constructs this build implements, and asks
//! the resolver's table ([`construct_implemented`]) and the registry's `since`
//! which those are. What is gated, the resolver has reported as `E9010`; the
//! checker gives it [`Ty::Error`](super::Ty::Error) without descending and
//! without a diagnostic, so nothing is mis-typed and nothing is reported
//! twice. A unit test lists the constructs the checker does not type and
//! asserts that they are gated in this build.
//!
//! # Untyped literals
//!
//! An integer or float literal has no type of its own until its context gives
//! it one. A *literal expression* is a literal, or parentheses, unary minus
//! or an arithmetic operator applied to literal expressions only
//! ([`literal_kind`]); it adopts its type as a whole ([`Checker::assign_literal`]),
//! so in `const N: u32 = 16 * 2;` both literals are `u32`, and next to an
//! operand of known type a literal adopts the type the operator table requires
//! (`v * 2` with `v: vec3` makes `2` an `f32`).

use std::collections::{BTreeMap, BTreeSet};

use super::Typeck;
use super::ops::{arithmetic_result, literal_operand_type, negation_result};
use super::ty::{Ty, TyId};
use super::value::{ArithOp, Scalar};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::resolve::gate::is_implemented;
use crate::resolve::{
    Construct, DefId, DefKind, PreludeItem, Res, Resolution, binary_construct,
    construct_implemented, unary_construct,
};
use crate::source::Span;
use crate::stdlib::{
    ArgType, IntrinsicDef, NamespaceMember, Registry, SchemaCategory, SigType, TypeKind, registry,
};
use crate::syntax::ast::{
    BinaryOp, ConstDecl, DescField, EntityDecl, EntityMember, Expr, ExprKind, FieldInit,
    FieldValue, Ident, ItemKind, Module, NodeId, SceneDecl, SceneMember, SceneObject, Type,
    TypeKind as AstTypeKind, UnaryOp,
};

/// Whether a literal expression is made of integer literals only, or holds a
/// float literal.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum LiteralKind {
    Int,
    Float,
}

/// The kind of a literal expression (see the module documentation), or
/// `None` if `expr` is not one.
pub(super) fn literal_kind(expr: &Expr) -> Option<LiteralKind> {
    match &expr.kind {
        ExprKind::Int { .. } => Some(LiteralKind::Int),
        ExprKind::Float { .. } => Some(LiteralKind::Float),
        ExprKind::Paren(inner) => literal_kind(inner),
        ExprKind::Unary {
            op: UnaryOp::Neg,
            operand,
        } if construct_implemented(Construct::Negation) => literal_kind(operand),
        ExprKind::Binary { op, lhs, rhs, .. }
            if arith_op(*op).is_some() && construct_implemented(binary_construct(*op)) =>
        {
            let lhs = literal_kind(lhs)?;
            let rhs = literal_kind(rhs)?;
            Some(if lhs == LiteralKind::Float || rhs == LiteralKind::Float {
                LiteralKind::Float
            } else {
                LiteralKind::Int
            })
        }
        _ => None,
    }
}

/// The arithmetic operator of a binary operator, if it is one.
pub(super) fn arith_op(op: BinaryOp) -> Option<ArithOp> {
    match op {
        BinaryOp::Add => Some(ArithOp::Add),
        BinaryOp::Sub => Some(ArithOp::Sub),
        BinaryOp::Mul => Some(ArithOp::Mul),
        BinaryOp::Div => Some(ArithOp::Div),
        _ => None,
    }
}

/// What a call turned out to be, for constant evaluation.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum CallKind {
    /// `vecN(..)`.
    Vector(usize),
    /// `f32(x)`, `i32(x)`, `u32(x)`.
    Conversion(Scalar),
    /// `namespace.member(..)` of the registry.
    Namespace {
        namespace: &'static str,
        member: &'static str,
        const_eligible: bool,
    },
    /// A global intrinsic of the registry.
    Intrinsic {
        name: &'static str,
        const_eligible: bool,
    },
    /// A user function (never constant in v0.1, section 8.1).
    UserFunction(String),
}

/// What a field access turned out to be, for constant evaluation.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum FieldKind {
    /// Components of a vector, quaternion or colour (a swizzle when several).
    Components(Vec<usize>),
    /// A field of a named entity or scene object (`Cube.position`).
    ObjectField {
        noun: &'static str,
        object: String,
        field: String,
    },
    /// A value member of a namespace (`frame.time`).
    NamespaceValue(String),
}

pub(super) struct Checker<'a> {
    pub(super) text: &'a str,
    pub(super) res: &'a Resolution,
    pub(super) sink: &'a mut Diagnostics,
    pub(super) registry: &'static Registry,
    pub(super) out: Typeck,
    /// Every constant declaration the checker may evaluate, by its `DefId`.
    pub(super) const_decls: BTreeMap<DefId, &'a ConstDecl>,
    /// Constants whose evaluation has started and not finished.
    pub(super) in_progress: BTreeSet<DefId>,
    /// The constants being evaluated, innermost last, each with the span of
    /// the reference through which its evaluation was entered.
    pub(super) const_stack: Vec<(DefId, Option<Span>)>,
    /// Constants found on a cycle (`E2020`).
    pub(super) cyclic: BTreeSet<DefId>,
    /// The `state` declarations of each entity, by `(entity, name)`.
    pub(super) states: BTreeSet<(DefId, String)>,
    pub(super) calls: BTreeMap<NodeId, CallKind>,
    pub(super) fields: BTreeMap<NodeId, FieldKind>,
}

impl<'a> Checker<'a> {
    pub(super) fn new(
        module: &Module,
        text: &'a str,
        res: &'a Resolution,
        sink: &'a mut Diagnostics,
    ) -> Self {
        Self::with_registry(module, text, res, sink, registry())
    }

    /// A checker that reads its schemas from `registry` (tests check the
    /// schema rules against registries the v0.1 tables do not contain).
    pub(super) fn with_registry(
        module: &Module,
        text: &'a str,
        res: &'a Resolution,
        sink: &'a mut Diagnostics,
        registry: &'static Registry,
    ) -> Self {
        let states = res
            .defs()
            .iter()
            .filter(|def| def.kind == DefKind::State)
            .filter_map(|def| def.parent.map(|parent| (parent, def.name.clone())))
            .collect();
        Self {
            text,
            res,
            sink,
            registry,
            out: Typeck::new(module.node_count),
            const_decls: BTreeMap::new(),
            in_progress: BTreeSet::new(),
            const_stack: Vec::new(),
            cyclic: BTreeSet::new(),
            states,
            calls: BTreeMap::new(),
            fields: BTreeMap::new(),
        }
    }

    pub(super) fn finish(self) -> Typeck {
        self.out
    }

    // ----- small helpers ---------------------------------------------------

    pub(super) fn set_ty(&mut self, node: NodeId, ty: TyId) {
        if let Some(slot) = self.out.types.get_mut(node.index()) {
            *slot = Some(ty);
        }
    }

    pub(super) fn ty_of(&self, node: NodeId) -> Option<TyId> {
        self.out.types.get(node.index()).copied().flatten()
    }

    pub(super) fn display(&self, ty: TyId) -> String {
        self.out.interner.display(ty)
    }

    fn is_error(&self, ty: TyId) -> bool {
        self.out.interner.is_error(ty)
    }

    fn assignable(&self, actual: TyId, expected: TyId) -> bool {
        self.out.interner.assignable(actual, expected)
    }

    /// The source text of `span` (empty if it is not inside the file).
    pub(super) fn snippet(&self, span: Span) -> &'a str {
        self.text.get(span.range()).unwrap_or("")
    }

    fn report(&mut self, diagnostic: Diagnostic) {
        self.sink.push(diagnostic);
    }

    // ----- the module ------------------------------------------------------

    pub(super) fn module(&mut self, module: &'a Module) {
        self.collect_constants(module);
        self.evaluate_constants();
        for item in &module.items {
            match &item.kind {
                ItemKind::Const(decl) if construct_implemented(Construct::ConstItem) => {
                    self.const_decl(decl);
                }
                ItemKind::Scene(decl) if construct_implemented(Construct::Scene) => {
                    self.scene(decl);
                }
                // Imports, functions, structs, materials and prefabs are gated
                // in this build (see the tests).
                _ => {}
            }
        }
    }

    /// Every constant of the module, of its scenes and of their entities: the
    /// constants that code this build checks can refer to.
    fn collect_constants(&mut self, module: &'a Module) {
        for item in &module.items {
            match &item.kind {
                ItemKind::Const(decl) => self.collect_constant(decl),
                ItemKind::Scene(scene) => {
                    for member in &scene.members {
                        match member {
                            SceneMember::Const(decl) => self.collect_constant(decl),
                            SceneMember::Entity(entity) => self.collect_entity_constants(entity),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn collect_constant(&mut self, decl: &'a ConstDecl) {
        if let Some(def) = self.res.def_of(decl.id) {
            self.const_decls.insert(def, decl);
        }
    }

    fn collect_entity_constants(&mut self, entity: &'a EntityDecl) {
        if entity.prefab.is_some() {
            // Prefab instances are gated in this build.
            return;
        }
        for member in &entity.members {
            match member {
                EntityMember::Const(decl) => self.collect_constant(decl),
                EntityMember::Entity(child) => self.collect_entity_constants(child),
                _ => {}
            }
        }
    }

    fn const_decl(&mut self, decl: &ConstDecl) {
        if let Some(def) = self.res.def_of(decl.id) {
            self.const_info(def, None);
        }
    }

    fn scene(&mut self, decl: &SceneDecl) {
        for member in &decl.members {
            match member {
                SceneMember::Field(field) if construct_implemented(Construct::SceneField) => {
                    self.schema_field(self.registry.declaration_schemas.scene, field);
                }
                SceneMember::Const(decl) if construct_implemented(Construct::BodyConst) => {
                    self.const_decl(decl);
                }
                SceneMember::Object(object) if construct_implemented(Construct::SceneObject) => {
                    self.scene_object(object);
                }
                SceneMember::Entity(entity) => self.entity(entity),
                // `state`, lifecycle functions and handlers are gated.
                _ => {}
            }
        }
    }

    fn scene_object(&mut self, object: &SceneObject) {
        let Some(kind) = self.registry.scene_object(&object.kind.name) else {
            return;
        };
        if !is_implemented(kind.since) {
            return;
        }
        for field in &object.fields {
            self.schema_field(kind.schema, field);
        }
    }

    fn entity(&mut self, entity: &EntityDecl) {
        if !construct_implemented(Construct::Entity) || entity.prefab.is_some() {
            // Prefab instances are gated in this build.
            return;
        }
        for member in &entity.members {
            match member {
                EntityMember::Field(field) if construct_implemented(Construct::EntityField) => {
                    self.schema_field(self.registry.declaration_schemas.entity, field);
                }
                EntityMember::Const(decl) if construct_implemented(Construct::BodyConst) => {
                    self.const_decl(decl);
                }
                EntityMember::Entity(child) => self.entity(child),
                // `state`, `param`, lifecycle functions and handlers are gated.
                _ => {}
            }
        }
    }

    /// `name: value;` of a scene, entity or scene object: the value is typed
    /// with the field's registry type as expected type and folded. Whether
    /// the type fits is the schema checks' business (`E3102`).
    fn schema_field(&mut self, schema: &str, field: &FieldInit) {
        let expected = match self.registry.schema_field(schema, &field.name.name) {
            // Gated by the field's milestone: reported by the resolver.
            Some(def) if !is_implemented(def.since) => return,
            Some(def) => Some(self.out.interner.from_type_ref(def.ty)),
            None => None,
        };
        // `bind(..)` is gated in this build.
        if let FieldValue::Expr(value) = &field.value {
            self.check(value, expected);
            self.fold_root(value);
        }
    }

    // ----- types as written ------------------------------------------------

    /// The type an annotation denotes. Unknown names were reported by the
    /// resolver (`E3003`, `Res::Error`); they are `Ty::Error` here.
    pub(super) fn annotation(&mut self, ty: &Type) -> TyId {
        match &ty.kind {
            AstTypeKind::Named(name) => match self.res.res(name.id) {
                Some(Res::Prelude(PreludeItem::Type(type_name))) => {
                    if !PreludeItem::Type(type_name)
                        .since()
                        .is_some_and(is_implemented)
                    {
                        return TyId::ERROR;
                    }
                    // `None` only for `array` without arguments, which is gated.
                    self.out
                        .interner
                        .prelude_type(type_name)
                        .unwrap_or(TyId::ERROR)
                }
                // Struct types are gated in this build; anything else was
                // reported by the resolver.
                _ => TyId::ERROR,
            },
            AstTypeKind::Generic { name, .. } => match self.res.res(name.id) {
                Some(Res::Prelude(PreludeItem::Type(type_name))) => {
                    let implemented = PreludeItem::Type(type_name)
                        .since()
                        .is_some_and(is_implemented);
                    let generic = self
                        .registry
                        .type_def(type_name)
                        .is_some_and(|t| t.kind == TypeKind::Array);
                    if implemented && !generic {
                        self.report(
                            Diagnostic::new(
                                Code::E3003,
                                format!(
                                    "The type '{type_name}' takes no type arguments; only `array<T, N>` does."
                                ),
                            )
                            .at(ty.span),
                        );
                    }
                    // `array<T, N>` is gated in this build.
                    TyId::ERROR
                }
                _ => TyId::ERROR,
            },
            AstTypeKind::Error => TyId::ERROR,
        }
    }

    // ----- expressions -----------------------------------------------------

    /// The type of `expr`, with `expected` as hint; recorded for the node.
    pub(super) fn check(&mut self, expr: &Expr, expected: Option<TyId>) -> TyId {
        if let Some(kind) = literal_kind(expr) {
            let target = self.literal_target(kind, expected);
            self.assign_literal(expr, target);
            return target;
        }
        let ty = self.check_kind(expr, expected);
        self.set_ty(expr.id, ty);
        ty
    }

    /// The type a literal expression of `kind` adopts in a context expecting
    /// `expected` (section 6.6): an integer literal adopts a numeric scalar
    /// type the context requires and is `i32` otherwise; a float literal is
    /// always `f32` (asked for an integer type it is `E3041`).
    fn literal_target(&self, kind: LiteralKind, expected: Option<TyId>) -> TyId {
        let numeric = expected.filter(|t| self.out.interner.is_numeric_scalar(*t));
        match (kind, numeric) {
            (LiteralKind::Int, Some(target)) => target,
            (LiteralKind::Int, None) => TyId::I32,
            (LiteralKind::Float, Some(target)) if target != TyId::F32 => target,
            (LiteralKind::Float, _) => TyId::F32,
        }
    }

    /// The default type of a literal expression without context.
    fn literal_default(kind: LiteralKind) -> TyId {
        match kind {
            LiteralKind::Int => TyId::I32,
            LiteralKind::Float => TyId::F32,
        }
    }

    /// Give the literal expression `expr` the numeric scalar type `target`,
    /// checking that every literal in it is representable (`E3041`). A literal
    /// that is not gets `Ty::Error`, so it is not folded and causes nothing
    /// further.
    pub(super) fn assign_literal(&mut self, expr: &Expr, target: TyId) {
        let ty = match &expr.kind {
            ExprKind::Int { value } => {
                if self.int_literal_fits(expr, expr, *value, false, target) {
                    target
                } else {
                    TyId::ERROR
                }
            }
            ExprKind::Float { value } => {
                if self.float_literal_fits(expr, *value, target) {
                    target
                } else {
                    TyId::ERROR
                }
            }
            ExprKind::Paren(inner) => {
                self.assign_literal(inner, target);
                target
            }
            ExprKind::Unary {
                op: UnaryOp::Neg,
                operand,
            } => {
                if let ExprKind::Int { value } = &operand.kind {
                    // `-5`: a minus directly on an integer literal forms one
                    // negative literal (section 6.6).
                    let ty = if self.int_literal_fits(expr, operand, *value, true, target) {
                        target
                    } else {
                        TyId::ERROR
                    };
                    self.set_ty(operand.id, ty);
                    ty
                } else {
                    self.assign_literal(operand, target);
                    let operand_failed = self.ty_of(operand.id).is_none_or(|t| self.is_error(t));
                    if target == TyId::U32 && !operand_failed {
                        self.report_unsigned_negation(expr.span, target);
                        TyId::ERROR
                    } else {
                        target
                    }
                }
            }
            ExprKind::Binary { lhs, rhs, .. } => {
                self.assign_literal(lhs, target);
                self.assign_literal(rhs, target);
                target
            }
            // Not a literal expression: [`literal_kind`] never sends one here,
            // but if it did, ordinary checking is the right answer.
            _ => {
                self.check(expr, Some(target));
                return;
            }
        };
        self.set_ty(expr.id, ty);
    }

    /// The `f32` value of an integer literal (rounded to nearest, ties to
    /// even), negated if `negative`. A literal too long for `u64` is read from
    /// its text.
    pub(super) fn int_literal_f32(&self, int: &Expr, value: Option<u64>, negative: bool) -> f32 {
        let magnitude = match value {
            Some(v) => v as f32,
            None => self
                .snippet(int.span)
                .parse::<f32>()
                .unwrap_or(f32::INFINITY),
        };
        if negative { -magnitude } else { magnitude }
    }

    /// The `f32` value of a float literal, rounded once from its decimal text
    /// (reading the lexer's `f64` and rounding again could differ by one ulp:
    /// double rounding).
    pub(super) fn float_literal_f32(&self, expr: &Expr, value: f64) -> f32 {
        self.snippet(expr.span)
            .parse::<f32>()
            .unwrap_or(value as f32)
    }

    /// Whether the integer literal `int` (negated if `negative`, the whole
    /// literal being `literal`) is representable as `target`; `E3041` if not.
    fn int_literal_fits(
        &mut self,
        literal: &Expr,
        int: &Expr,
        value: Option<u64>,
        negative: bool,
        target: TyId,
    ) -> bool {
        let fits = match self.out.interner.get(target) {
            Ty::I32 => value.is_some_and(|v| {
                if negative {
                    v <= 1 << 31
                } else {
                    v <= i32::MAX as u64
                }
            }),
            Ty::U32 => value.is_some_and(|v| {
                if negative {
                    v == 0
                } else {
                    v <= u64::from(u32::MAX)
                }
            }),
            Ty::F32 => self.int_literal_f32(int, value, negative).is_finite(),
            _ => false,
        };
        if !fits {
            let text = self.snippet(literal.span).to_owned();
            let name = self.display(target);
            let range = match self.out.interner.get(target) {
                Ty::I32 => format!("{name} values range from {} to {}", i32::MIN, i32::MAX),
                Ty::U32 => format!("{name} values range from 0 to {}", u32::MAX),
                _ => "it rounds to infinity in f32".to_owned(),
            };
            self.report(
                Diagnostic::new(
                    Code::E3041,
                    format!("The integer literal {text} is not representable as {name}."),
                )
                .at(literal.span)
                .expected(name)
                .note(range),
            );
        }
        fits
    }

    /// Whether the float literal `expr` is representable as `target`: only as
    /// `f32`, and only if finite after rounding (section 6.6); `E3041` if not.
    fn float_literal_fits(&mut self, expr: &Expr, value: f64, target: TyId) -> bool {
        let text = self.snippet(expr.span).to_owned();
        let name = self.display(target);
        if target != TyId::F32 {
            self.report(
                Diagnostic::new(
                    Code::E3041,
                    format!(
                        "The float literal {text} is not representable as {name}: a float literal always has type f32."
                    ),
                )
                .at(expr.span)
                .expected(name.clone())
                .actual("f32")
                .help(format!("write an integer literal, or convert explicitly: `{name}({text})`")),
            );
            return false;
        }
        if !self.float_literal_f32(expr, value).is_finite() {
            self.report(
                Diagnostic::new(
                    Code::E3041,
                    format!("The float literal {text} is not representable as f32: it rounds to infinity."),
                )
                .at(expr.span)
                .expected("f32")
                .note(format!("the largest finite f32 is {:e}", f32::MAX)),
            );
            return false;
        }
        true
    }

    fn check_kind(&mut self, expr: &Expr, expected: Option<TyId>) -> TyId {
        match &expr.kind {
            ExprKind::Int { .. } | ExprKind::Float { .. } => {
                // Literals take the literal path of [`Self::check`].
                let target = literal_kind(expr)
                    .map_or(TyId::ERROR, |kind| self.literal_target(kind, expected));
                self.assign_literal(expr, target);
                target
            }
            ExprKind::Bool(_) => TyId::BOOL,
            ExprKind::Color { .. } => TyId::COLOR,
            ExprKind::Str { .. } if construct_implemented(Construct::StringLiteral) => TyId::STRING,
            // String and array literals, indexing and `self` are gated in this
            // build (see the tests).
            ExprKind::Str { .. }
            | ExprKind::Array(_)
            | ExprKind::Index { .. }
            | ExprKind::SelfValue
            | ExprKind::Error => TyId::ERROR,
            ExprKind::Name(_) => self.name_value(expr),
            ExprKind::Paren(inner) => self.check(inner, expected),
            ExprKind::Descriptor { name, fields } => self.descriptor(name, fields),
            ExprKind::Unary { op, operand } => self.unary(expr, *op, operand, expected),
            ExprKind::Binary { op, lhs, rhs, .. } => self.binary(expr, *op, lhs, rhs, expected),
            ExprKind::Call { callee, args } => self.call(expr, callee, args),
            ExprKind::Field { base, name } => self.field(expr, base, name),
        }
    }

    // ----- names -----------------------------------------------------------

    fn name_value(&mut self, expr: &Expr) -> TyId {
        match self.res.res(expr.id) {
            Some(Res::Def(id)) => self.def_value(expr, id),
            Some(Res::Prelude(item)) => self.prelude_value(expr.span, item),
            _ => TyId::ERROR,
        }
    }

    fn def_value(&mut self, expr: &Expr, id: DefId) -> TyId {
        let Some(def) = self.res.def(id) else {
            return TyId::ERROR;
        };
        match def.kind {
            DefKind::Const => self.const_info(id, Some(expr.span)),
            // A named entity converts to `entity_ref` where one is expected
            // (`spec/scenes.md` 8.3); that is the only meaning of a bare
            // entity name.
            DefKind::Entity => TyId::ENTITY_REF,
            DefKind::SceneObject { kind: Some(_) }
            | DefKind::Scene
            | DefKind::Fn
            | DefKind::Struct
            | DefKind::Material
            | DefKind::Prefab => {
                let (name, noun, span) = (def.name.clone(), def.kind.noun(), def.span);
                self.report(
                    Diagnostic::new(Code::E3001, format!("'{name}' is a {noun}, not a value."))
                        .at(expr.span)
                        .expected("a value")
                        .actual(noun)
                        .related(span, format!("the {noun} '{name}' is declared here")),
                );
                TyId::ERROR
            }
            DefKind::Import => self.imported_value(expr, id),
            // An unknown scene-object kind was reported (`E5014`); `state`,
            // params, parameters and locals are declared by constructs that
            // are gated in this build.
            DefKind::SceneObject { kind: None }
            | DefKind::State
            | DefKind::Param
            | DefKind::FnParam
            | DefKind::Local { .. }
            | DefKind::LoopVar => TyId::ERROR,
        }
    }

    /// An imported name used as a value (decision 0036): an imported
    /// constant has the type the caller seeded ([`super::check_module_with_imports`]);
    /// an imported scene, function, struct, material or prefab is not a
    /// value, as it would not be in its own module.
    fn imported_value(&mut self, expr: &Expr, id: DefId) -> TyId {
        if let Some(info) = self.out.consts.get(&id) {
            return info.ty;
        }
        let Some(target) = self.res.import_target(id) else {
            return TyId::ERROR;
        };
        if matches!(
            target.kind,
            DefKind::Scene | DefKind::Fn | DefKind::Struct | DefKind::Material | DefKind::Prefab
        ) {
            let name = self
                .res
                .def(id)
                .map_or_else(String::new, |d| d.name.clone());
            let (noun, span) = (target.kind.noun(), target.span);
            self.report(
                Diagnostic::new(Code::E3001, format!("'{name}' is a {noun}, not a value."))
                    .at(expr.span)
                    .expected("a value")
                    .actual(noun)
                    .related(span, format!("the {noun} '{name}' is declared here")),
            );
        }
        TyId::ERROR
    }

    /// A prelude name used as a value: types, schemas, enums, namespaces and
    /// functions are not values.
    fn prelude_value(&mut self, span: Span, item: PreludeItem) -> TyId {
        if !item.since().is_some_and(is_implemented) {
            return TyId::ERROR;
        }
        let (name, noun, help) = match item {
            PreludeItem::Type(name) => (name, "type", self.constructor_help(name)),
            PreludeItem::Schema(name) => (
                name,
                "schema",
                Some(format!("write a descriptor literal: `{name} {{ … }}`")),
            ),
            PreludeItem::Enum(name) => (
                name,
                "enum",
                self.registry
                    .enum_def(name)
                    .and_then(|e| e.members.first())
                    .map(|m| format!("name one of its members, for example `{name}.{}`", m.name)),
            ),
            PreludeItem::Namespace(name) => (name, "namespace", self.constructor_help(name)),
            PreludeItem::Function(name) => (
                name,
                "built-in function",
                Some(format!("call it: `{name}(…)`")),
            ),
            _ => return TyId::ERROR,
        };
        let mut diagnostic =
            Diagnostic::new(Code::E3001, format!("'{name}' is a {noun}, not a value."))
                .at(span)
                .expected("a value")
                .actual(noun);
        if let Some(help) = help {
            diagnostic = diagnostic.help(help);
        }
        self.report(diagnostic);
        TyId::ERROR
    }

    /// "use one of its constructors: quat.identity(), …" for a prelude name
    /// that is also an implemented namespace, from the registry.
    fn constructor_help(&self, name: &str) -> Option<String> {
        let namespace = self.registry.namespace(name)?;
        if !is_implemented(namespace.since) {
            return None;
        }
        let functions: Vec<String> = namespace
            .members
            .iter()
            .filter_map(|member| match member {
                NamespaceMember::Function(f) if is_implemented(f.since) => {
                    let args = if f.signatures.iter().all(|s| s.params.is_empty()) {
                        ""
                    } else {
                        "…"
                    };
                    Some(format!("{name}.{}({args})", f.name))
                }
                _ => None,
            })
            .collect();
        (!functions.is_empty())
            .then(|| format!("use one of its constructors: {}", functions.join(", ")))
    }

    // ----- descriptor literals ---------------------------------------------

    /// `Name { field: value; … }`. For a registry schema the value has the
    /// schema's type and each field value is checked with the field's type as
    /// expected type; unknown, duplicate, missing and mistyped fields are the
    /// schema checks' business.
    fn descriptor(&mut self, name: &Ident, fields: &[DescField]) -> TyId {
        match self.res.res(name.id) {
            Some(Res::Prelude(PreludeItem::Schema(schema))) => {
                let Some(def) = self.registry.schema(schema) else {
                    return TyId::ERROR;
                };
                if !is_implemented(def.since) {
                    return TyId::ERROR;
                }
                if def.category == SchemaCategory::Object {
                    self.object_descriptor(name, def.name, fields);
                    return TyId::ERROR;
                }
                for field in fields {
                    let expected = match def.field(&field.name.name) {
                        Some(field_def) if !is_implemented(field_def.since) => continue,
                        Some(field_def) => Some(self.out.interner.from_type_ref(field_def.ty)),
                        None => None,
                    };
                    // `bind(..)` is gated in this build.
                    if let FieldValue::Expr(value) = &field.value {
                        self.check(value, expected);
                    }
                }
                self.out.interner.intern(Ty::Schema(def.name))
            }
            Some(Res::Prelude(item)) => {
                if item.since().is_some_and(is_implemented) {
                    let (noun, item_name) = match item {
                        PreludeItem::Type(n) => ("type", n),
                        PreludeItem::Enum(n) => ("enum", n),
                        PreludeItem::Namespace(n) => ("namespace", n),
                        PreludeItem::Function(n) => ("built-in function", n),
                        _ => ("name", ""),
                    };
                    self.report(
                        Diagnostic::new(
                            Code::E3001,
                            format!(
                                "'{item_name}' is a {noun}; a descriptor literal names a schema, struct, material or prefab."
                            ),
                        )
                        .at(name.span)
                        .expected("a schema, struct, material or prefab")
                        .actual(noun),
                    );
                }
                TyId::ERROR
            }
            Some(Res::Def(id)) => {
                let Some(def) = self.res.def(id) else {
                    return TyId::ERROR;
                };
                // A declaration that took the name of a prelude schema was
                // reported by the resolver (`E2001`); its uses are not
                // reported again.
                let reused_prelude_name = !self.registry.prelude_name_kinds(&def.name).is_empty();
                // An imported name stands for what it imports (decision 0036);
                // one whose import was reported is not reported again.
                let kind = match def.kind {
                    DefKind::Import => match self.res.import_target(id) {
                        Some(target) => target.kind,
                        None => return TyId::ERROR,
                    },
                    kind => kind,
                };
                match kind {
                    _ if reused_prelude_name => TyId::ERROR,
                    // Gated in this build.
                    DefKind::Struct | DefKind::Material | DefKind::Prefab => TyId::ERROR,
                    DefKind::SceneObject { kind: None } => TyId::ERROR,
                    kind => {
                        let (def_name, noun, span) = (def.name.clone(), kind.noun(), def.span);
                        self.report(
                            Diagnostic::new(
                                Code::E3001,
                                format!(
                                    "'{def_name}' is a {noun}; a descriptor literal names a schema, struct, material or prefab."
                                ),
                            )
                            .at(name.span)
                            .expected("a schema, struct, material or prefab")
                            .actual(noun)
                            .related(span, format!("the {noun} '{def_name}' is declared here")),
                        );
                        TyId::ERROR
                    }
                }
            }
            _ => TyId::ERROR,
        }
    }

    /// `Entity { … }`, `Scene { … }`, `Camera { … }`: the schemas of
    /// declaration bodies have no descriptor literals (decision 0027). The
    /// field values are still typed, so their own mistakes are reported.
    fn object_descriptor(&mut self, name: &Ident, schema: &'static str, fields: &[DescField]) {
        for field in fields {
            if let FieldValue::Expr(value) = &field.value {
                self.check(value, None);
            }
        }
        let declarations = self.registry.declaration_schemas;
        let keyword = if schema == declarations.scene {
            Some("scene")
        } else if schema == declarations.entity {
            Some("entity")
        } else {
            self.registry
                .scene_objects
                .iter()
                .find(|kind| kind.schema == schema)
                .map(|kind| kind.keyword)
        };
        let mut diagnostic = Diagnostic::new(
            Code::E3001,
            format!(
                "'{schema}' describes the fields of a declaration; it cannot be written as a descriptor literal."
            ),
        )
        .at(name.span)
        .expected("a descriptor of a mesh, material, light, body, collider or projection schema")
        .actual(format!("the declaration schema {schema}"));
        if let Some(keyword) = keyword {
            diagnostic = diagnostic.help(format!(
                "write its fields in a declaration: `{keyword} Name {{ … }}`"
            ));
        }
        self.report(diagnostic);
    }

    // ----- operators -------------------------------------------------------

    fn unary(&mut self, expr: &Expr, op: UnaryOp, operand: &Expr, expected: Option<TyId>) -> TyId {
        if !construct_implemented(unary_construct(op)) || op != UnaryOp::Neg {
            // `!` is gated in this build.
            return TyId::ERROR;
        }
        let operand_ty = self.check(operand, expected);
        let ty = self.out.interner.get(operand_ty);
        match ty {
            Ty::Error => TyId::ERROR,
            _ if negation_result(ty).is_some() => operand_ty,
            Ty::U32 => {
                self.report_unsigned_negation(expr.span, operand_ty);
                TyId::ERROR
            }
            Ty::Color => {
                self.report_color_arithmetic(expr.span, "-");
                TyId::ERROR
            }
            _ => {
                let name = self.display(operand_ty);
                self.report(
                    Diagnostic::new(
                        Code::E3014,
                        format!("The operator `-` is not defined for {name}."),
                    )
                    .at(expr.span)
                    .actual(name)
                    .note("unary `-` negates an f32, an i32 or a vector"),
                );
                TyId::ERROR
            }
        }
    }

    fn binary(
        &mut self,
        expr: &Expr,
        op: BinaryOp,
        lhs: &Expr,
        rhs: &Expr,
        expected: Option<TyId>,
    ) -> TyId {
        if !construct_implemented(binary_construct(op)) {
            return TyId::ERROR;
        }
        let Some(arith) = arith_op(op) else {
            // The other operators are gated in this build.
            return TyId::ERROR;
        };
        // `+` and `-` give their operands' type, so the expected type flows
        // into both; `*` and `/` mix types (`vec3 * f32`), so it does not.
        let operand_expected = match arith {
            ArithOp::Add | ArithOp::Sub => expected,
            ArithOp::Mul | ArithOp::Div => None,
        };
        let (lhs_ty, rhs_ty) = match (literal_kind(lhs), literal_kind(rhs)) {
            (None, Some(kind)) => {
                let lhs_ty = self.check(lhs, operand_expected);
                let target = self.operand_literal_target(arith, lhs_ty, kind, true);
                self.assign_literal(rhs, target);
                (lhs_ty, target)
            }
            (Some(kind), None) => {
                let rhs_ty = self.check(rhs, operand_expected);
                let target = self.operand_literal_target(arith, rhs_ty, kind, false);
                self.assign_literal(lhs, target);
                (target, rhs_ty)
            }
            _ => (
                self.check(lhs, operand_expected),
                self.check(rhs, operand_expected),
            ),
        };
        self.arithmetic_type(expr.span, arith, lhs_ty, rhs_ty)
    }

    /// The type a literal operand adopts next to an operand of type `other`.
    fn operand_literal_target(
        &mut self,
        op: ArithOp,
        other: TyId,
        kind: LiteralKind,
        literal_is_rhs: bool,
    ) -> TyId {
        let other = self.out.interner.get(other);
        match literal_operand_type(op, other, literal_is_rhs) {
            // A float literal next to an integer is asked to become that
            // integer type, which is `E3041` (section 6.6).
            Some(scalar) if other != Ty::Error => self.out.interner.intern(scalar),
            _ => Self::literal_default(kind),
        }
    }

    fn arithmetic_type(&mut self, span: Span, op: ArithOp, lhs: TyId, rhs: TyId) -> TyId {
        let (l, r) = (self.out.interner.get(lhs), self.out.interner.get(rhs));
        if l == Ty::Error || r == Ty::Error {
            return TyId::ERROR;
        }
        if l == Ty::Color || r == Ty::Color {
            self.report_color_arithmetic(span, op.symbol());
            return TyId::ERROR;
        }
        if let Some(result) = arithmetic_result(op, l, r) {
            return self.out.interner.intern(result);
        }
        let (lhs_name, rhs_name) = (self.display(lhs), self.display(rhs));
        let symbol = op.symbol();
        let mut diagnostic = Diagnostic::new(
            Code::E3014,
            format!("The operator `{symbol}` is not defined for {lhs_name} and {rhs_name}."),
        )
        .at(span);
        let interner = &self.out.interner;
        if interner.is_numeric_scalar(lhs) && interner.is_numeric_scalar(rhs) {
            diagnostic = diagnostic.help(format!(
                "v0.1 has no implicit conversions; convert one operand explicitly, for example `{lhs_name}(…)`"
            ));
        } else if let (Some(a), Some(b)) = (interner.vector_dim(lhs), interner.vector_dim(rhs)) {
            if a != b {
                diagnostic = diagnostic.note("vector operands must have the same dimension");
            }
        } else if interner.vector_dim(lhs).is_some() || interner.vector_dim(rhs).is_some() {
            diagnostic = diagnostic.note(
                "a vector combines with a vector of the same dimension, is multiplied or divided by an f32, or multiplies an f32",
            );
        }
        self.report(diagnostic);
        TyId::ERROR
    }

    fn report_color_arithmetic(&mut self, span: Span, symbol: &str) {
        self.report(
            Diagnostic::new(
                Code::E3010,
                format!("The operator `{symbol}` is not defined for color: colours have no arithmetic."),
            )
            .at(span)
            .help("compute with the linear components `.rgb` (a vec3) and build the colour with `color.linear(rgb, a)`"),
        );
    }

    fn report_unsigned_negation(&mut self, span: Span, ty: TyId) {
        let name = self.display(ty);
        self.report(
            Diagnostic::new(
                Code::E3011,
                format!("A value of type {name} cannot be negated."),
            )
            .at(span)
            .actual(name)
            .note("unsigned integers have no negative values"),
        );
    }

    // ----- calls -----------------------------------------------------------

    fn synth_args(&mut self, args: &[Expr]) {
        for arg in args {
            self.check(arg, None);
        }
    }

    fn call(&mut self, expr: &Expr, callee: &Expr, args: &[Expr]) -> TyId {
        if let ExprKind::Name(_) = &callee.kind {
            match self.res.res(callee.id) {
                Some(Res::Prelude(PreludeItem::Type(name))) => {
                    return self.type_call(expr, callee, name, args);
                }
                Some(Res::Prelude(PreludeItem::Function(name))) => {
                    let Some(function) = self.registry.intrinsic(name) else {
                        return TyId::ERROR;
                    };
                    if !is_implemented(function.since) {
                        return TyId::ERROR;
                    }
                    let kind = CallKind::Intrinsic {
                        name: function.name,
                        const_eligible: function.const_eligible,
                    };
                    return self.function_call(expr, name, function, args, kind);
                }
                Some(Res::Def(id))
                    if self.res.def(id).is_some_and(|def| def.kind == DefKind::Fn) =>
                {
                    // Functions are gated in this build: their signatures are
                    // not typed, but the call is known not to be constant.
                    self.synth_args(args);
                    let name = self.res.def(id).map(|d| d.name.clone()).unwrap_or_default();
                    self.calls.insert(expr.id, CallKind::UserFunction(name));
                    return TyId::ERROR;
                }
                Some(Res::Error) | None => {
                    self.synth_args(args);
                    return TyId::ERROR;
                }
                _ => {}
            }
        }
        if let ExprKind::Field { name, .. } = &callee.kind {
            match self.res.res(name.id) {
                Some(Res::Prelude(PreludeItem::NamespaceMember { namespace, member })) => {
                    return self.namespace_call(expr, callee, namespace, member, args);
                }
                Some(Res::Error) => {
                    self.synth_args(args);
                    return TyId::ERROR;
                }
                _ => {}
            }
        }
        let callee_ty = self.check(callee, None);
        self.synth_args(args);
        if !self.is_error(callee_ty) {
            let name = self.display(callee_ty);
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!("Only functions and constructors can be called, but this expression has type {name}."),
                )
                .at(callee.span)
                .expected("a function or constructor")
                .actual(name),
            );
        }
        TyId::ERROR
    }

    /// `T(..)` where `T` is a prelude type: a vector constructor, a numeric
    /// conversion, or an error.
    fn type_call(&mut self, expr: &Expr, callee: &Expr, name: &'static str, args: &[Expr]) -> TyId {
        if !PreludeItem::Type(name).since().is_some_and(is_implemented) {
            return TyId::ERROR;
        }
        let Some(ty) = self.out.interner.prelude_type(name) else {
            // `array`, gated in this build.
            return TyId::ERROR;
        };
        if let Some(dim) = self.out.interner.vector_dim(ty) {
            return self.vector_constructor(expr, ty, dim, args);
        }
        let scalar = match self.out.interner.get(ty) {
            Ty::I32 => Some(Scalar::I32),
            Ty::U32 => Some(Scalar::U32),
            Ty::F32 => Some(Scalar::F32),
            _ => None,
        };
        if let Some(scalar) = scalar {
            return self.conversion(expr, ty, scalar, args);
        }
        self.synth_args(args);
        let mut diagnostic =
            Diagnostic::new(Code::E3001, format!("The type '{name}' cannot be called."))
                .at(callee.span)
                .expected("a function or constructor")
                .actual(format!("type {name}"));
        let scalar_kind = self
            .registry
            .type_def(name)
            .is_some_and(|t| t.kind == TypeKind::Scalar);
        if let Some(help) = self.constructor_help(name) {
            diagnostic = diagnostic.help(help);
        } else if scalar_kind {
            diagnostic = diagnostic.note(format!(
                "'{name}' has no conversions; the conversions are i32(…), u32(…) and f32(…)"
            ));
        }
        self.report(diagnostic);
        TyId::ERROR
    }

    /// The forms of the constructor `vecN` (section 6.7): splat, composition
    /// with a smaller vector in front, and one `f32` per component. Each
    /// arity has exactly one form.
    fn vector_forms(dim: usize) -> Vec<Vec<(&'static str, TyId)>> {
        let f = TyId::F32;
        match dim {
            2 => vec![vec![("s", f)], vec![("x", f), ("y", f)]],
            3 => vec![
                vec![("s", f)],
                vec![("xy", TyId::VEC2), ("z", f)],
                vec![("x", f), ("y", f), ("z", f)],
            ],
            4 => vec![
                vec![("s", f)],
                vec![("xyz", TyId::VEC3), ("w", f)],
                vec![("xy", TyId::VEC2), ("z", f), ("w", f)],
                vec![("x", f), ("y", f), ("z", f), ("w", f)],
            ],
            _ => Vec::new(),
        }
    }

    fn form_text(&self, name: &str, form: &[(&str, TyId)]) -> String {
        let params: Vec<String> = form
            .iter()
            .map(|(param, ty)| format!("{param}: {}", self.display(*ty)))
            .collect();
        format!("{name}({})", params.join(", "))
    }

    fn vector_constructor(&mut self, expr: &Expr, ty: TyId, dim: usize, args: &[Expr]) -> TyId {
        let name = self.display(ty);
        let forms = Self::vector_forms(dim);
        let Some(form) = forms.iter().find(|form| form.len() == args.len()) else {
            self.synth_args(args);
            let arities: Vec<String> = forms.iter().map(|form| form.len().to_string()).collect();
            let texts: Vec<String> = forms
                .iter()
                .map(|form| self.form_text(&name, form))
                .collect();
            self.report(
                Diagnostic::new(
                    Code::E3002,
                    format!(
                        "The constructor `{name}` takes {} arguments, but {} {} given.",
                        or_list(&arities),
                        args.len(),
                        if args.len() == 1 { "was" } else { "were" }
                    ),
                )
                .at(expr.span)
                .note(format!("the forms are {}", texts.join(", "))),
            );
            return ty;
        };
        let text = self.form_text(&name, form);
        let mut ok = true;
        for (index, (arg, (_, param))) in args.iter().zip(form.iter()).enumerate() {
            let actual = self.check(arg, Some(*param));
            if !self.assignable(actual, *param) {
                ok = false;
                self.report_argument(arg.span, index, &text, *param, actual);
            }
        }
        if ok {
            self.calls.insert(expr.id, CallKind::Vector(dim));
        }
        ty
    }

    fn report_argument(
        &mut self,
        span: Span,
        index: usize,
        callee: &str,
        expected: TyId,
        actual: TyId,
    ) {
        let (expected, actual) = (self.display(expected), self.display(actual));
        self.report(
            Diagnostic::new(
                Code::E3001,
                format!(
                    "Argument {} of `{callee}` expects {expected}, but received {actual}.",
                    index + 1
                ),
            )
            .at(span)
            .expected(expected)
            .actual(actual),
        );
    }

    /// `f32(x)`, `i32(x)`, `u32(x)` (section 6.5).
    fn conversion(&mut self, expr: &Expr, target: TyId, scalar: Scalar, args: &[Expr]) -> TyId {
        let name = self.display(target);
        let [arg] = args else {
            self.synth_args(args);
            self.report(
                Diagnostic::new(
                    Code::E3002,
                    format!(
                        "The conversion `{name}(…)` takes 1 argument, but {} {} given.",
                        args.len(),
                        if args.len() == 1 { "was" } else { "were" }
                    ),
                )
                .at(expr.span),
            );
            return target;
        };
        // A conversion accepts any numeric scalar, so it requires no type
        // of a literal argument: `f32(10)` converts the i32 10.
        let actual = self.check(arg, None);
        if self.is_error(actual) {
            return target;
        }
        if !self.out.interner.is_numeric_scalar(actual) {
            let actual_name = self.display(actual);
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!(
                        "The conversion `{name}(…)` expects an i32, u32 or f32 value, but received {actual_name}."
                    ),
                )
                .at(arg.span)
                .expected("i32, u32 or f32")
                .actual(actual_name),
            );
            return target;
        }
        if actual == target {
            self.report(
                Diagnostic::new(
                    Code::W3050,
                    format!("The conversion `{name}(…)` is redundant: its argument already has type {name}."),
                )
                .at(expr.span)
                .help("remove the conversion"),
            );
        }
        self.calls.insert(expr.id, CallKind::Conversion(scalar));
        target
    }

    fn namespace_call(
        &mut self,
        expr: &Expr,
        callee: &Expr,
        namespace: &'static str,
        member: &'static str,
        args: &[Expr],
    ) -> TyId {
        let Some(ns) = self.registry.namespace(namespace) else {
            return TyId::ERROR;
        };
        if !is_implemented(ns.since) {
            return TyId::ERROR;
        }
        match ns.member(member) {
            Some(NamespaceMember::Function(function)) => {
                if !is_implemented(function.since) {
                    return TyId::ERROR;
                }
                let kind = CallKind::Namespace {
                    namespace: ns.name,
                    member: function.name,
                    const_eligible: function.const_eligible,
                };
                let name = format!("{namespace}.{member}");
                self.function_call(expr, &name, function, args, kind)
            }
            Some(NamespaceMember::Value(value)) => {
                if !is_implemented(value.since) {
                    return TyId::ERROR;
                }
                self.synth_args(args);
                self.report(
                    Diagnostic::new(
                        Code::E3001,
                        format!("`{namespace}.{member}` is a value, not a function."),
                    )
                    .at(callee.span)
                    .expected("a function or constructor")
                    .actual(value.ty.spelling()),
                );
                TyId::ERROR
            }
            None => {
                self.synth_args(args);
                TyId::ERROR
            }
        }
    }

    /// A call of a registry function. With one signature of the call's arity
    /// whose parameters are concrete types, each argument is checked against
    /// its parameter (bidirectionally, `E3001`); otherwise the registry's
    /// overload resolution chooses (decision 0024 item 8).
    fn function_call(
        &mut self,
        expr: &Expr,
        name: &str,
        function: &IntrinsicDef,
        args: &[Expr],
        kind: CallKind,
    ) -> TyId {
        let same_arity: Vec<_> = function
            .signatures
            .iter()
            .filter(|s| s.params.len() == args.len())
            .collect();
        if same_arity.is_empty() {
            self.synth_args(args);
            let mut arities: Vec<usize> =
                function.signatures.iter().map(|s| s.params.len()).collect();
            arities.sort_unstable();
            arities.dedup();
            let plural = arities.last().is_none_or(|a| *a != 1);
            let arities: Vec<String> = arities.iter().map(ToString::to_string).collect();
            let signatures: Vec<String> = function
                .signatures
                .iter()
                .map(|s| format!("{name}{}", s.text()))
                .collect();
            self.report(
                Diagnostic::new(
                    Code::E3002,
                    format!(
                        "`{name}` takes {} argument{}, but {} {} given.",
                        or_list(&arities),
                        if plural { "s" } else { "" },
                        args.len(),
                        if args.len() == 1 { "was" } else { "were" }
                    ),
                )
                .at(expr.span)
                .note(format!("signature: {}", signatures.join(" or "))),
            );
            // The result type is still known if every signature agrees on it.
            let first = function.signatures.first().map(|s| s.ret);
            let agree = function.signatures.iter().all(|s| Some(s.ret) == first);
            return match first {
                Some(SigType::Exact(ret)) if agree => self.out.interner.from_type_ref(ret),
                _ => TyId::ERROR,
            };
        }
        if let [signature] = same_arity.as_slice() {
            let exact: Option<Vec<_>> = signature
                .params
                .iter()
                .map(|p| match p.ty {
                    SigType::Exact(t) => Some(t),
                    SigType::Class(_) => None,
                })
                .collect();
            if let (Some(params), SigType::Exact(ret)) = (exact, signature.ret) {
                let params_text: Vec<String> = signature
                    .params
                    .iter()
                    .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
                    .collect();
                let text = format!("{name}({})", params_text.join(", "));
                let mut ok = true;
                for (index, (arg, param)) in args.iter().zip(params).enumerate() {
                    let param = self.out.interner.from_type_ref(param);
                    let actual = self.check(arg, Some(param));
                    if !self.assignable(actual, param) {
                        ok = false;
                        self.report_argument(arg.span, index, &text, param, actual);
                    }
                }
                if ok {
                    self.calls.insert(expr.id, kind);
                }
                return self.out.interner.from_type_ref(ret);
            }
        }
        self.overloaded_call(expr, name, function, args, kind)
    }

    /// Overload resolution against class-typed signatures: literal arguments
    /// are passed untyped and adopt the chosen parameter type.
    fn overloaded_call(
        &mut self,
        expr: &Expr,
        name: &str,
        function: &IntrinsicDef,
        args: &[Expr],
        kind: CallKind,
    ) -> TyId {
        let mut arg_types = Vec::with_capacity(args.len());
        let mut failed = false;
        for arg in args {
            let arg_type = match literal_kind(arg) {
                Some(LiteralKind::Int) => ArgType::IntLiteral,
                Some(LiteralKind::Float) => ArgType::FloatLiteral,
                None => {
                    let ty = self.check(arg, None);
                    match self.out.interner.to_type_ref(ty) {
                        Some(type_ref) if !self.is_error(ty) => ArgType::Concrete(type_ref),
                        _ => {
                            failed = true;
                            ArgType::Concrete(crate::stdlib::TypeRef::Unit)
                        }
                    }
                }
            };
            arg_types.push(arg_type);
        }
        let resolution = if failed {
            None
        } else {
            function.resolve(&arg_types).ok()
        };
        let Some(resolution) = resolution else {
            for arg in args {
                if let Some(kind) = literal_kind(arg) {
                    self.assign_literal(arg, Self::literal_default(kind));
                }
            }
            if !failed {
                let found: Vec<String> = args
                    .iter()
                    .map(|a| {
                        self.ty_of(a.id)
                            .map_or_else(String::new, |t| self.display(t))
                    })
                    .collect();
                let signatures: Vec<String> = function
                    .signatures
                    .iter()
                    .map(|s| format!("{name}{}", s.text()))
                    .collect();
                self.report(
                    Diagnostic::new(
                        Code::E3001,
                        format!("No signature of `{name}` accepts ({}).", found.join(", ")),
                    )
                    .at(expr.span)
                    .expected(signatures.join(" or "))
                    .actual(format!("({})", found.join(", "))),
                );
            }
            return TyId::ERROR;
        };
        for (arg, param) in args.iter().zip(&resolution.params) {
            if literal_kind(arg).is_some() {
                let param = self.out.interner.from_type_ref(*param);
                self.assign_literal(arg, param);
            }
        }
        self.calls.insert(expr.id, kind);
        self.out.interner.from_type_ref(resolution.ret)
    }

    // ----- field access ----------------------------------------------------

    fn field(&mut self, expr: &Expr, base: &Expr, name: &Ident) -> TyId {
        match self.res.res(name.id) {
            Some(Res::Prelude(PreludeItem::NamespaceMember { namespace, member })) => {
                return self.namespace_member_value(expr, namespace, member);
            }
            Some(Res::Prelude(item @ PreludeItem::EnumMember { enum_name, .. })) => {
                let implemented = PreludeItem::Enum(enum_name)
                    .since()
                    .is_some_and(is_implemented)
                    && item.since().is_some_and(is_implemented);
                return if implemented {
                    self.out.interner.intern(Ty::Enum(enum_name))
                } else {
                    TyId::ERROR
                };
            }
            Some(Res::Error) => return TyId::ERROR,
            _ => {}
        }
        if let ExprKind::Name(_) = &base.kind
            && let Some(Res::Def(id)) = self.res.res(base.id)
            && let Some(def) = self.res.def(id)
        {
            let object = match def.kind {
                DefKind::Entity => Some((self.registry.declaration_schemas.entity, "entity")),
                DefKind::SceneObject { kind: Some(kind) } => self
                    .registry
                    .scene_object(kind)
                    .map(|k| (k.schema, k.keyword)),
                DefKind::SceneObject { kind: None } => return TyId::ERROR,
                _ => None,
            };
            if let Some((schema, noun)) = object {
                let object_name = def.name.clone();
                return self.object_field(expr, id, &object_name, noun, schema, name);
            }
        }
        let base_ty = self.check(base, None);
        self.components(expr, base_ty, name)
    }

    fn namespace_member_value(
        &mut self,
        expr: &Expr,
        namespace: &'static str,
        member: &'static str,
    ) -> TyId {
        let implemented = PreludeItem::Namespace(namespace)
            .since()
            .is_some_and(is_implemented)
            && PreludeItem::NamespaceMember { namespace, member }
                .since()
                .is_some_and(is_implemented);
        if !implemented {
            return TyId::ERROR;
        }
        match self.registry.namespace_member(namespace, member) {
            Some(NamespaceMember::Value(value)) => {
                self.fields.insert(
                    expr.id,
                    FieldKind::NamespaceValue(format!("{namespace}.{member}")),
                );
                self.out.interner.from_type_ref(value.ty)
            }
            Some(NamespaceMember::Function(function)) => {
                let args = if function.signatures.iter().all(|s| s.params.is_empty()) {
                    ""
                } else {
                    "…"
                };
                self.report(
                    Diagnostic::new(
                        Code::E3001,
                        format!("`{namespace}.{member}` is a function, not a value."),
                    )
                    .at(expr.span)
                    .expected("a value")
                    .actual("function")
                    .help(format!("call it: `{namespace}.{member}({args})`")),
                );
                TyId::ERROR
            }
            None => TyId::ERROR,
        }
    }

    /// `Name.field` where `Name` is a named entity or scene object: the
    /// field's registry type (reading it is never constant).
    fn object_field(
        &mut self,
        expr: &Expr,
        owner: DefId,
        object: &str,
        noun: &'static str,
        schema: &'static str,
        name: &Ident,
    ) -> TyId {
        if self.states.contains(&(owner, name.name.clone())) {
            // Entity `state` is gated in this build.
            return TyId::ERROR;
        }
        match self.registry.schema_field(schema, &name.name) {
            Some(field) if !is_implemented(field.since) => TyId::ERROR,
            Some(field) => {
                self.fields.insert(
                    expr.id,
                    FieldKind::ObjectField {
                        noun,
                        object: object.to_owned(),
                        field: field.name.to_owned(),
                    },
                );
                self.out.interner.from_type_ref(field.ty)
            }
            None => {
                let fields: Vec<&str> = self
                    .registry
                    .schema(schema)
                    .map(|s| {
                        s.fields
                            .iter()
                            .filter(|f| is_implemented(f.since))
                            .map(|f| f.name)
                            .collect()
                    })
                    .unwrap_or_default();
                self.report(
                    Diagnostic::new(
                        Code::E5001,
                        format!("The {noun} '{object}' has no field '{}'.", name.name),
                    )
                    .at(name.span)
                    .note(format!("the fields of {schema} are {}", fields.join(", "))),
                );
                TyId::ERROR
            }
        }
    }

    /// Components and swizzles (section 6.9): `.x .y .z .w` within the
    /// dimension and swizzles of 2 to 4 of them on vectors; `.x .y .z .w` on
    /// `quat`; `.r .g .b .a` and `.rgb` on `color` (section 5.4).
    fn components(&mut self, expr: &Expr, base: TyId, name: &Ident) -> TyId {
        let ty = self.out.interner.get(base);
        let text = name.name.as_str();
        let type_name = self.display(base);
        let index_in = |letters: &str, c: char| letters.find(c);
        let (indices, problem): (Option<Vec<usize>>, Option<(String, String)>) = match ty {
            Ty::Error => return TyId::ERROR,
            Ty::Vec2 | Ty::Vec3 | Ty::Vec4 => {
                let dim = self.out.interner.vector_dim(base).unwrap_or(0);
                let letters = "xyzw".get(..dim).unwrap_or("");
                let listed = list_components(letters);
                if text.chars().count() > 4 {
                    (
                        None,
                        Some((
                            format!(
                                "'.{text}' is not a valid swizzle: a swizzle has 2 to 4 components."
                            ),
                            format!("{type_name} components are {listed}"),
                        )),
                    )
                } else {
                    let found: Option<Vec<usize>> =
                        text.chars().map(|c| index_in(letters, c)).collect();
                    match found {
                        Some(found) => (Some(found), None),
                        None => (
                            None,
                            Some((
                                format!("The type {type_name} has no component '{text}'."),
                                format!(
                                    "{type_name} components are {listed}, and swizzles of 2 to 4 of them"
                                ),
                            )),
                        ),
                    }
                }
            }
            Ty::Quat => match text.chars().collect::<Vec<_>>().as_slice() {
                [c] if index_in("xyzw", *c).is_some() => {
                    (index_in("xyzw", *c).map(|i| vec![i]), None)
                }
                _ => (
                    None,
                    Some((
                        format!("The type quat has no component '{text}'."),
                        "quat components are .x, .y, .z and .w, read one at a time".to_owned(),
                    )),
                ),
            },
            Ty::Color => match text {
                "rgb" => (Some(vec![0, 1, 2]), None),
                _ => match text.chars().collect::<Vec<_>>().as_slice() {
                    [c] if index_in("rgba", *c).is_some() => {
                        (index_in("rgba", *c).map(|i| vec![i]), None)
                    }
                    _ => (
                        None,
                        Some((
                            format!("The type color has no component '{text}'."),
                            "color components are .r, .g, .b, .a and .rgb".to_owned(),
                        )),
                    ),
                },
            },
            _ => (
                None,
                Some((
                    format!("The type {type_name} has no component '{text}'."),
                    "components exist on vectors, quat and color".to_owned(),
                )),
            ),
        };
        if let Some((message, note)) = problem {
            self.report(
                Diagnostic::new(Code::E3013, message)
                    .at(name.span)
                    .note(note),
            );
            return TyId::ERROR;
        }
        let Some(indices) = indices else {
            return TyId::ERROR;
        };
        let result = match indices.len() {
            1 => TyId::F32,
            n => TyId::vector(n).unwrap_or(TyId::ERROR),
        };
        self.fields.insert(expr.id, FieldKind::Components(indices));
        result
    }
}

/// ".x, .y and .z".
fn list_components(letters: &str) -> String {
    let names: Vec<String> = letters.chars().map(|c| format!(".{c}")).collect();
    match names.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        Some((last, _)) => last.clone(),
        None => String::new(),
    }
}

/// "1, 2 or 3".
fn or_list(items: &[String]) -> String {
    match items.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} or {last}", rest.join(", ")),
        Some((last, _)) => last.clone(),
        None => String::new(),
    }
}
