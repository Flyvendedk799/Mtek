//! Interpolated strings in the checker (`spec/language.md` section 5.8, decision 0133): every
//! `${expr}` must be a value with a text form (`E3501`) and its format spec, if any, must be
//! `.N` on a floating-point value (`E3502`). The literal itself is a `string`.

use super::check::Checker;
use super::ty::TyId;
use crate::diagnostics::{Code, Diagnostic};
use crate::syntax::ast::InterpPart;

/// The types an interpolation can show, and whether `.N` applies to them.
fn formattable(ty: TyId) -> Option<bool> {
    match ty {
        TyId::STRING | TyId::BOOL | TyId::I32 | TyId::U32 => Some(false),
        TyId::F32 | TyId::VEC2 | TyId::VEC3 | TyId::VEC4 => Some(true),
        _ => None,
    }
}

/// The digit count of a `.N` spec, `None` if the spec is not one.
#[must_use]
pub(crate) fn precision(spec: &str) -> Option<u8> {
    let digits = spec.strip_prefix('.')?;
    if digits.len() != 1 {
        return None;
    }
    let digit = digits.as_bytes()[0];
    digit.is_ascii_digit().then(|| digit - b'0')
}

impl Checker<'_> {
    /// The type of `"text ${expr} text"`: `string`.
    pub(super) fn interpolation(&mut self, parts: &[InterpPart]) -> TyId {
        for part in parts {
            let InterpPart::Expr { expr, spec } = part else {
                continue;
            };
            let ty = self.check(expr, None);
            if ty == TyId::ERROR {
                continue;
            }
            let Some(takes_precision) = formattable(ty) else {
                let shown = self.display(ty);
                self.report(
                    Diagnostic::new(
                        Code::E3501,
                        format!("A value of type `{shown}` cannot be shown in a string."),
                    )
                    .at(expr.span)
                    .expected("string, bool, i32, u32, f32, vec2, vec3 or vec4")
                    .actual(shown)
                    .note("an interpolation `${..}` shows a number, a bool, a string or a vector")
                    .help("show one of its fields or components instead, as in `${v.x}`"),
                );
                continue;
            };
            let Some(spec) = spec else { continue };
            if precision(&spec.text).is_some() && takes_precision {
                continue;
            }
            let shown = self.display(ty);
            let diagnostic = if precision(&spec.text).is_some() {
                Diagnostic::new(
                    Code::E3502,
                    format!(
                        "The format spec `:{}` needs a floating-point value; this one is `{shown}`.",
                        spec.text
                    ),
                )
                .at(spec.span)
                .note("`.N` sets the digits after the decimal point of an f32 or of each vector component")
                .help("remove the format spec")
            } else {
                Diagnostic::new(
                    Code::E3502,
                    format!("`:{}` is not a format spec.", spec.text),
                )
                .at(spec.span)
                .expected("`.N` with one digit N, as in `${time:.2}`")
                .actual(format!("`:{}`", spec.text))
                .note("the only format spec is `.N`: N digits after the decimal point")
            };
            self.report(diagnostic);
        }
        TyId::STRING
    }
}
