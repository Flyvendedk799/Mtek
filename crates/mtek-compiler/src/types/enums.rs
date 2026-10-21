//! User enums and `match` (decision 0129, `spec/language.md` section 5.8 and
//! 7.6).
//!
//! An enum type is identified by its declaration ([`EnumKey`]), like a struct,
//! so it is one type in every module and keeps its identity across imports.
//! Its values are its variants, written `Enum.Variant`; each is a constant,
//! the index of the variant in declaration order, and the IR sees the enum as
//! that `u32` (decision 0129 item 3). Enums are CPU only.
//!
//! A `match` takes a value of an enum type (`E3203` otherwise) and arms whose
//! patterns are variants of that enum (`E3204`) or `_`. Every arm must be
//! reachable (`E3202`: a variant matched twice, an arm after `_`, a `_` after
//! every variant), and together the arms must cover every variant or end
//! with `_` (`E3201`). The arm values of a `match` expression have one type
//! (`E3206`). Naming a variant the enum does not declare is `E3205`.

use std::collections::BTreeMap;

use super::check::{Checker, FieldKind};
use super::ty::{EnumKey, TyId};
use crate::diagnostics::{Code, Diagnostic};
use crate::project::edit_distance;
use crate::resolve::{DefId, DefKind, Res};
use crate::source::Span;
use crate::syntax::ast::{ArmBody, EnumDecl, Expr, ExprKind, Ident, MatchArm, PatternKind};

/// What the patterns of a `match` cover.
pub(super) struct Coverage {
    /// Whether the arms cover every variant (or there was an error that was
    /// reported, so nothing more is said).
    pub(super) exhaustive: bool,
}

impl<'a> Checker<'a> {
    /// Remember an enum declaration of the module and give it its type.
    pub(super) fn collect_enum(&mut self, decl: &'a EnumDecl) {
        if let Some(def) = self.res.def_of(decl.id) {
            self.enum_decls.insert(def, decl);
            self.enum_type(def);
        }
    }

    /// The enum type a name resolving to `id` denotes: an enum of this module
    /// or an imported enum (`None` for anything else, and for an imported
    /// enum whose type is not known).
    pub(super) fn enum_type(&mut self, id: DefId) -> Option<TyId> {
        let def = self.res.def(id)?;
        match def.kind {
            DefKind::Enum => {
                if let Some(ty) = self.out.enum_ty(id) {
                    return Some(ty);
                }
                let decl = self.enum_decls.get(&id).copied()?;
                let key = EnumKey {
                    file: def.span.file,
                    def: id,
                };
                // Duplicates were reported by the resolver (`E2002`), `_` too
                // (`E0012`): the type keeps the first of each name.
                let mut variants: Vec<String> = Vec::with_capacity(decl.variants.len());
                for variant in &decl.variants {
                    if variant.name != "_" && !variants.contains(&variant.name) {
                        variants.push(variant.name.clone());
                    }
                }
                let name = def.name.clone();
                let ty = self.out.interner.intern_enum(key, &name, variants);
                self.out.enums.insert(id, ty);
                Some(ty)
            }
            DefKind::Import => self
                .imported_structs
                .get(&id)
                .copied()
                .filter(|ty| self.out.interner.enum_def(*ty).is_some()),
            _ => None,
        }
    }

    /// `Enum.Variant`: the enum's type, with the variant recorded as the
    /// field kind of `expr`; `None` when `base` does not name an enum.
    /// A variant the enum does not declare is `E3205`.
    pub(super) fn enum_variant(&mut self, expr: &Expr, base: &Expr, name: &Ident) -> Option<TyId> {
        let ExprKind::Name(_) = &base.kind else {
            return None;
        };
        let Some(Res::Def(id)) = self.res.res(base.id) else {
            return None;
        };
        let names_enum = match self.res.def(id).map(|d| d.kind) {
            Some(DefKind::Enum) => true,
            Some(DefKind::Import) => self
                .res
                .import_target(id)
                .is_some_and(|t| t.kind == DefKind::Enum),
            _ => false,
        };
        if !names_enum {
            return None;
        }
        let Some(ty) = self.enum_type(id) else {
            // An imported enum whose type is not known (its module has an
            // error): nothing more to say.
            return Some(TyId::ERROR);
        };
        let def = self.out.interner.enum_def(ty)?.clone();
        if let Some(index) = def.variant(&name.name) {
            self.fields.insert(
                expr.id,
                FieldKind::EnumVariant {
                    variant: name.name.clone(),
                    index,
                },
            );
            return Some(ty);
        }
        let mut diagnostic = Diagnostic::new(
            Code::E3205,
            format!("The enum '{}' has no variant '{}'.", def.name, name.name),
        )
        .at(name.span)
        .expected(format!("a variant of {}", def.name))
        .actual(format!("'{}'", name.name));
        let close: Vec<&String> = def
            .variants
            .iter()
            .filter(|v| (1..=2).contains(&edit_distance(&name.name, v)))
            .collect();
        if let [single] = close.as_slice() {
            diagnostic = diagnostic.help(format!("did you mean `{}.{single}`?", def.name));
        }
        if let Some(declared) = self.res.def(id) {
            diagnostic = diagnostic.related(
                declared.span,
                format!("the enum '{}' is declared here", def.name),
            );
        }
        self.report(diagnostic.note(format!(
            "the variants of '{}' are: {}",
            def.name,
            def.variants.join(", ")
        )));
        Some(TyId::ERROR)
    }

    /// The scrutinee and patterns of a `match`: the scrutinee's type (an
    /// enum, `E3203` otherwise), each pattern a variant of it (`E3204`),
    /// every arm reachable (`E3202`), every variant covered (`E3201`).
    /// `span` is the whole `match`; `E3201` points at its keyword.
    pub(super) fn match_patterns(
        &mut self,
        span: Span,
        scrutinee: &Expr,
        arms: &[MatchArm],
    ) -> Coverage {
        let scrutinee_ty = self.check(scrutinee, None);
        let def = if self.is_error(scrutinee_ty) {
            None
        } else if let Some(def) = self.out.interner.enum_def(scrutinee_ty).cloned() {
            Some(def)
        } else {
            let name = self.display(scrutinee_ty);
            self.report(
                Diagnostic::new(
                    Code::E3203,
                    format!("A `match` needs a value of an enum type, but this value has type {name}."),
                )
                .at(scrutinee.span)
                .expected("an enum")
                .actual(name)
                .note("`match` compares a value against the variants of its enum; use `if` for other values"),
            );
            None
        };
        // What is covered so far: the variant indices with the span of the
        // pattern that covers each, and the span of a `_`.
        let mut covered: BTreeMap<u32, Span> = BTreeMap::new();
        let mut wildcard: Option<Span> = None;
        let mut failed = def.is_none();
        for arm in arms {
            for pattern in &arm.patterns {
                match &pattern.kind {
                    PatternKind::Wildcard => {
                        let every_variant = def.as_ref().is_some_and(|d| {
                            u32::try_from(d.variants.len())
                                .is_ok_and(|n| (0..n).all(|i| covered.contains_key(&i)))
                        });
                        if let Some(first) = wildcard {
                            self.unreachable(
                                pattern.span,
                                first,
                                "a `_` arm matches everything already",
                            );
                        } else if every_variant && !failed {
                            let first = covered.values().next().copied().unwrap_or(pattern.span);
                            self.unreachable(
                                pattern.span,
                                first,
                                "the arms before it cover every variant",
                            );
                        }
                        wildcard.get_or_insert(pattern.span);
                    }
                    PatternKind::Value(value) => {
                        let Some(index) = self.pattern_variant(value, scrutinee_ty, def.is_some())
                        else {
                            failed = true;
                            continue;
                        };
                        if let Some(first) = wildcard {
                            self.unreachable(
                                pattern.span,
                                first,
                                "a `_` arm before it matches everything",
                            );
                        } else if let Some(first) = covered.get(&index).copied() {
                            self.unreachable(
                                pattern.span,
                                first,
                                "this variant is matched by an earlier pattern",
                            );
                        } else {
                            covered.insert(index, pattern.span);
                        }
                    }
                }
            }
        }
        // The scrutinee decides which arm runs: it has no GPU form.
        self.cpu_only_site(
            scrutinee.span,
            "the matched value".to_owned(),
            scrutinee_ty,
            None,
        );
        let Some(def) = def else {
            return Coverage { exhaustive: true };
        };
        if wildcard.is_some() || failed {
            return Coverage { exhaustive: true };
        }
        let missing: Vec<&String> = def
            .variants
            .iter()
            .enumerate()
            .filter(|(i, _)| u32::try_from(*i).is_ok_and(|i| !covered.contains_key(&i)))
            .map(|(_, v)| v)
            .collect();
        if missing.is_empty() {
            return Coverage { exhaustive: true };
        }
        let listed: Vec<String> = missing
            .iter()
            .map(|v| format!("`{}.{v}`", def.name))
            .collect();
        let keyword = Span::new(
            span.file,
            span.start,
            span.start.saturating_add(5).min(span.end),
        );
        self.report(
            Diagnostic::new(
                Code::E3201,
                format!(
                    "This `match` does not cover every variant of '{}': {} {} not matched.",
                    def.name,
                    listed.join(", "),
                    if missing.len() == 1 { "is" } else { "are" }
                ),
            )
            .at(keyword)
            .note("a `match` must handle every variant of its enum")
            .help(format!(
                "add {} for {}, or a final `_ => …` arm",
                if missing.len() == 1 { "an arm" } else { "arms" },
                listed.join(", ")
            )),
        );
        Coverage { exhaustive: false }
    }

    /// `E3202` for the pattern at `span`, which cannot match because of the
    /// pattern at `earlier`.
    fn unreachable(&mut self, span: Span, earlier: Span, why: &str) {
        self.report(
            Diagnostic::new(
                Code::E3202,
                "This pattern can never match: the arm is unreachable.",
            )
            .at(span)
            .related(earlier, why.to_owned())
            .help("remove the pattern, or the arm if it has no other pattern"),
        );
    }

    /// The variant index a pattern denotes: `Enum.Variant` of the
    /// scrutinee's enum. `checkable` is false when the scrutinee has no enum
    /// type (reported); the pattern is still checked for its own errors.
    fn pattern_variant(&mut self, value: &Expr, scrutinee: TyId, checkable: bool) -> Option<u32> {
        let ty = self.check(value, None);
        if self.is_error(ty) || !checkable {
            return None;
        }
        if let Some(FieldKind::EnumVariant { index, .. }) = self.fields.get(&value.id)
            && ty == scrutinee
        {
            return Some(*index);
        }
        let expected = self.display(scrutinee);
        let actual = self.display(ty);
        let message = if self.out.interner.enum_def(ty).is_some()
            && matches!(
                self.fields.get(&value.id),
                Some(FieldKind::EnumVariant { .. })
            ) {
            format!(
                "This pattern is a variant of {actual}, but the `match` is on a value of type {expected}."
            )
        } else {
            format!("A pattern must be a variant of {expected} (`{expected}.Variant`) or `_`.")
        };
        self.report(
            Diagnostic::new(Code::E3204, message)
                .at(value.span)
                .expected(format!("a variant of {expected}"))
                .actual(actual)
                .note("patterns are written `Enum.Variant`, several joined by `|`, or `_` for every other value"),
        );
        None
    }

    /// A `match` expression: its type is the type of its arm values, which
    /// must agree (`E3206`).
    pub(super) fn match_expr(
        &mut self,
        expr: &Expr,
        scrutinee: &Expr,
        arms: &[MatchArm],
        expected: Option<TyId>,
    ) -> TyId {
        self.match_patterns(expr.span, scrutinee, arms);
        let mut result: Option<(TyId, Span)> = None;
        for arm in arms {
            let ArmBody::Expr(value) = &arm.body else {
                // The parser gives a `match` expression expression arms only.
                continue;
            };
            let want = result.map(|(ty, _)| ty).or(expected);
            let ty = self.check(value, want);
            if ty == TyId::UNIT {
                self.report(
                    Diagnostic::new(
                        Code::E3001,
                        "This call gives no value: the function it calls has no result type.",
                    )
                    .at(value.span)
                    .expected("a value")
                    .actual("()"),
                );
                continue;
            }
            if self.is_error(ty) {
                continue;
            }
            match result {
                None => result = Some((ty, value.span)),
                Some((first, first_span)) => {
                    if !self.assignable(ty, first) {
                        let (a, b) = (self.display(first), self.display(ty));
                        self.report(
                            Diagnostic::new(
                                Code::E3206,
                                format!(
                                    "The arms of this `match` give values of different types: {a} and {b}."
                                ),
                            )
                            .at(value.span)
                            .expected(a.clone())
                            .actual(b)
                            .related(first_span, format!("the first arm gives {a}"))
                            .help("every arm of a `match` expression must give a value of one type; convert explicitly where needed"),
                        );
                    }
                }
            }
        }
        // With mismatching arms the first arm's type stands for the whole, so
        // the mismatch is reported once.
        result.map_or(TyId::ERROR, |(ty, _)| ty)
    }
}
