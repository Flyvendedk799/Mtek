//! User structs (`spec/language.md` section 5.5, decision 0035 item 5):
//! declarations, struct literals and field access.
//!
//! A struct type is identified by its declaration ([`StructKey`]: the
//! declaring file and its `DefId` there), so it is the same type in every
//! module; its fields live in the module's [`TyInterner`](super::TyInterner)
//! and travel with the type across imports. Declarations are checked in the
//! dependency order of the constants (`consteval.rs`): a struct after the
//! structs and constants its field types name. A struct that contains itself,
//! directly or through arrays or other structs, is `E3020`; a duplicate field
//! of a declaration is `E3022`. A struct literal names every field once
//! (`E3021` missing, `E3022` duplicate, `E3023` unknown, `E3001` a value of
//! another type); reading a field the struct does not have is `E3023`.

use std::collections::BTreeMap;

use super::check::{Checker, FieldKind};
use super::ty::{MAX_TYPE_DEPTH, StructKey, TyId};
use crate::diagnostics::{Code, Diagnostic};
use crate::project::edit_distance;
use crate::resolve::{DefId, DefKind};
use crate::source::Span;
use crate::syntax::ast::{DescField, Expr, FieldValue, Ident, StructDecl};

impl<'a> Checker<'a> {
    /// Remember a struct declaration of the module.
    pub(super) fn collect_struct(&mut self, decl: &'a StructDecl) {
        if let Some(def) = self.res.def_of(decl.id) {
            self.struct_decls.insert(def, decl);
            self.struct_type(def);
        }
    }

    /// The identity of the struct declared as `def` in this module.
    fn struct_key(&self, def: DefId) -> Option<StructKey> {
        let declared = self.res.def(def)?;
        Some(StructKey {
            file: declared.span.file,
            def,
        })
    }

    /// The struct type a name resolving to `id` denotes: a struct of this
    /// module or an imported struct (`None` for anything else, and for an
    /// imported struct whose type is not known, decision 0036 item 4).
    pub(super) fn struct_type(&mut self, id: DefId) -> Option<TyId> {
        let def = self.res.def(id)?;
        match def.kind {
            DefKind::Struct => {
                let key = self.struct_key(id)?;
                let name = def.name.clone();
                let ty = self.out.interner.intern_struct(key, &name);
                self.out.structs.insert(id, ty);
                Some(ty)
            }
            DefKind::Import => self.imported_structs.get(&id).copied(),
            _ => None,
        }
    }

    /// Whether `id` names a struct (of this module or imported).
    pub(super) fn names_struct(&self, id: DefId) -> bool {
        match self.res.def(id).map(|d| d.kind) {
            Some(DefKind::Struct) => true,
            Some(DefKind::Import) => self
                .res
                .import_target(id)
                .is_some_and(|t| t.kind == DefKind::Struct),
            _ => false,
        }
    }

    /// Check the declaration of the struct `def` once: the field types in
    /// declaration order, `E3022` for a field declared twice. A struct on a
    /// cycle keeps no fields (it was reported as `E3020`).
    pub(super) fn struct_info(&mut self, def: DefId) {
        if !self.struct_done.insert(def) {
            return;
        }
        let (Some(decl), Some(_)) = (self.struct_decls.get(&def).copied(), self.struct_type(def))
        else {
            return;
        };
        let Some(key) = self.struct_key(def) else {
            return;
        };
        if self.cyclic.contains(&def) {
            self.out.interner.break_struct(key);
            return;
        }
        let mut fields: Vec<(String, TyId)> = Vec::with_capacity(decl.fields.len());
        let mut seen: BTreeMap<&str, Span> = BTreeMap::new();
        for field in &decl.fields {
            let field_ty = self.annotation(&field.ty);
            if let Some(first) = seen.get(field.name.name.as_str()).copied() {
                let (name, struct_name) = (field.name.name.clone(), decl.name.name.clone());
                self.sink.push(
                    Diagnostic::new(
                        Code::E3022,
                        format!("The struct '{struct_name}' declares the field '{name}' twice."),
                    )
                    .at(field.name.span)
                    .related(first, format!("'{name}' is first declared here")),
                );
                continue;
            }
            seen.insert(field.name.name.as_str(), field.name.span);
            fields.push((field.name.name.clone(), field_ty));
        }
        if fields
            .iter()
            .any(|(_, ty)| self.out.interner.is_broken(*ty))
        {
            // A field of a struct reported already: nothing more to say.
            self.out.interner.break_struct(key);
            return;
        }
        let depth = fields
            .iter()
            .map(|(_, ty)| self.out.interner.depth(*ty))
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        if depth > MAX_TYPE_DEPTH {
            let subject = format!("The struct '{}'", decl.name.name);
            self.report_too_deep(decl.name.span, &subject);
            self.out.interner.break_struct(key);
            return;
        }
        self.out.interner.define_struct(key, fields);
    }

    /// `E3020` for a cycle of struct declarations (each with the reference
    /// it was reached through), closed by the reference `closing`.
    pub(super) fn report_struct_cycle(&mut self, cycle: &[(DefId, Option<Span>)], closing: Span) {
        let Some(&(first_def, _)) = cycle.first() else {
            return;
        };
        let name = |id: DefId| self.res.def(id).map_or("", |d| d.name.as_str()).to_owned();
        let first = name(first_def);
        let mut path: Vec<String> = cycle.iter().map(|(id, _)| name(*id)).collect();
        path.push(first.clone());
        let Some(primary) = self.res.def(first_def).map(|d| d.span) else {
            return;
        };
        let mut diagnostic = Diagnostic::new(
            Code::E3020,
            format!(
                "The struct '{first}' contains itself: {}.",
                path.join(" → ")
            ),
        )
        .at(primary);
        for pair in cycle.windows(2) {
            if let [(from, _), (to, Some(span))] = pair {
                diagnostic = diagnostic.related(
                    *span,
                    format!("'{}' contains '{}' here", name(*from), name(*to)),
                );
            }
        }
        if let Some((last, _)) = cycle.last() {
            diagnostic = diagnostic.related(
                closing,
                format!("'{}' contains '{first}' here", name(*last)),
            );
        }
        self.sink.push(diagnostic.help(
            "a struct cannot contain itself, not even through an array: v0.1 has no references",
        ));
        for (id, _) in cycle {
            self.cyclic.insert(*id);
        }
    }

    /// `Name { field: value; … }` of a user struct: every field exactly once,
    /// each value checked against the field's type.
    pub(super) fn struct_literal(
        &mut self,
        expr: &Expr,
        name: &Ident,
        ty: TyId,
        fields: &[DescField],
    ) -> TyId {
        let declared = self.out.interner.struct_def(ty).cloned();
        let Some(declared) = declared.filter(|d| !d.broken && !d.fields.is_empty()) else {
            // A struct whose declaration was reported (`E3020`, `E3032`):
            // its values cannot be built.
            for field in fields {
                if let FieldValue::Expr(value) = &field.value {
                    self.check(value, None);
                }
            }
            return TyId::ERROR;
        };
        let struct_name = declared.name.clone();
        let mut ok = true;
        let mut unknown = false;
        let mut seen: BTreeMap<&str, Span> = BTreeMap::new();
        for field in fields {
            let field_name = field.name.name.as_str();
            let expected = declared.field(field_name);
            let value = match &field.value {
                FieldValue::Expr(value) => Some(value),
                // `bind(..)` is gated in this build (reported by the resolver).
                FieldValue::Bind(_) => {
                    ok = false;
                    None
                }
            };
            if let Some(first) = seen.get(field_name).copied() {
                ok = false;
                if let Some(value) = value {
                    self.check(value, expected);
                }
                self.sink.push(
                    Diagnostic::new(
                        Code::E3022,
                        format!("The field '{field_name}' of struct {struct_name} is given twice."),
                    )
                    .at(field.name.span)
                    .related(first, format!("'{field_name}' is first given here")),
                );
                continue;
            }
            seen.insert(field_name, field.name.span);
            let Some(expected) = expected else {
                ok = false;
                unknown = true;
                if let Some(value) = value {
                    self.check(value, None);
                }
                let names: Vec<String> = declared
                    .fields
                    .iter()
                    .map(|(n, _)| format!("'{n}'"))
                    .collect();
                let mut diagnostic = Diagnostic::new(
                    Code::E3023,
                    format!("The struct {struct_name} has no field '{field_name}'."),
                )
                .at(field.name.span)
                .note(format!(
                    "the fields of {struct_name} are {}",
                    names.join(", ")
                ));
                if let Some(candidate) =
                    single_close_name(field_name, declared.fields.iter().map(|(n, _)| n.as_str()))
                {
                    diagnostic = diagnostic.help(format!("did you mean '{candidate}'?"));
                }
                self.sink.push(diagnostic);
                continue;
            };
            let Some(value) = value else {
                continue;
            };
            let actual = self.check(value, Some(expected));
            if self.out.interner.is_error(actual) {
                ok = false;
            } else if !self.out.interner.assignable(actual, expected) {
                ok = false;
                let (expected_name, actual_name) = (self.display(expected), self.display(actual));
                self.sink.push(
                    Diagnostic::new(
                        Code::E3001,
                        format!(
                            "Field '{field_name}' of struct {struct_name} expects {expected_name}, but received {actual_name}."
                        ),
                    )
                    .at(value.span)
                    .expected(expected_name)
                    .actual(actual_name),
                );
            }
        }
        let missing: Vec<&str> = declared
            .fields
            .iter()
            .map(|(n, _)| n.as_str())
            .filter(|n| !seen.contains_key(n))
            .collect();
        // An unknown field is most likely a missing one misspelt: one mistake,
        // one diagnostic.
        if !missing.is_empty() {
            ok = false;
        }
        if !missing.is_empty() && !unknown {
            let listed: Vec<String> = missing.iter().map(|n| format!("'{n}'")).collect();
            let (noun, list) = if listed.len() == 1 {
                ("field", listed.join(""))
            } else {
                ("fields", and_list(&listed))
            };
            self.sink.push(
                Diagnostic::new(
                    Code::E3021,
                    format!("The struct literal {struct_name} is missing the {noun} {list}."),
                )
                .at(name.span)
                .note("a struct literal gives every field exactly once; struct fields have no defaults"),
            );
        }
        if ok {
            self.struct_literals.insert(expr.id, ty);
        }
        ty
    }

    /// `value.name` where `value` has the struct type `ty`.
    pub(super) fn struct_field(&mut self, expr: &Expr, ty: TyId, name: &Ident) -> TyId {
        let Some(declared) = self.out.interner.struct_def(ty).cloned() else {
            return TyId::ERROR;
        };
        if declared.broken || declared.fields.is_empty() {
            // Reported with the declaration (`E3020`, `E3032`).
            return TyId::ERROR;
        }
        if let Some(field_ty) = declared.field(&name.name) {
            self.fields
                .insert(expr.id, FieldKind::StructField(name.name.clone()));
            return field_ty;
        }
        let struct_name = declared.name.clone();
        let names: Vec<String> = declared
            .fields
            .iter()
            .map(|(n, _)| format!("'{n}'"))
            .collect();
        let mut diagnostic = Diagnostic::new(
            Code::E3023,
            format!("The struct {struct_name} has no field '{}'.", name.name),
        )
        .at(name.span)
        .note(format!(
            "the fields of {struct_name} are {}",
            names.join(", ")
        ));
        if let Some(candidate) =
            single_close_name(&name.name, declared.fields.iter().map(|(n, _)| n.as_str()))
        {
            diagnostic = diagnostic.help(format!("did you mean '{candidate}'?"));
        }
        self.sink.push(diagnostic);
        TyId::ERROR
    }
}

/// The only name within edit distance 1–2 of `name`, if exactly one is
/// (decision 0025 item 9).
fn single_close_name<'n>(name: &str, names: impl Iterator<Item = &'n str>) -> Option<&'n str> {
    let mut found = None;
    for candidate in names {
        let distance = edit_distance(name, candidate);
        if distance == 0 || distance > 2 {
            continue;
        }
        if found.is_some() {
            return None;
        }
        found = Some(candidate);
    }
    found
}

/// "'a', 'b' and 'c'".
fn and_list(items: &[String]) -> String {
    match items.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        Some((last, _)) => last.clone(),
        None => String::new(),
    }
}
