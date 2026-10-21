//! HUD calls in the checker (`spec/hud.md`, decision 0134): `E5601` for a constant size outside
//! its range. Run-time sizes outside the range are clamped by the runtime.

use super::check::Checker;
use super::consteval::Folded;
use super::value::ConstValue;
use crate::diagnostics::{Code, Diagnostic};
use crate::syntax::ast::Expr;

/// The range of a text or button size, in CSS pixels.
pub(crate) const TEXT_SIZE_RANGE: (f32, f32) = (1.0, 512.0);
/// The range of each component of a rectangle size, in CSS pixels.
pub(crate) const RECT_SIZE_RANGE: (f32, f32) = (0.0, 8192.0);

impl Checker<'_> {
    /// `E5601` for a constant size argument of a `hud` call outside its range.
    pub(super) fn check_hud_args(&mut self, member: &str, args: &[Expr]) {
        let (index, range, what) = match member {
            "text" | "button" => (2, TEXT_SIZE_RANGE, "text size"),
            "rect" => (1, RECT_SIZE_RANGE, "rectangle size"),
            _ => return,
        };
        let Some(arg) = args.get(index) else { return };
        let values: Vec<f32> = match self.fold(arg) {
            Folded::Value(ConstValue::F32(value)) => vec![value],
            Folded::Value(ConstValue::Vec2(v)) => v.to_vec(),
            _ => return,
        };
        let (lo, hi) = range;
        let Some(bad) = values
            .into_iter()
            .find(|v| !(v.is_finite() && (lo..=hi).contains(v)))
        else {
            return;
        };
        self.report(
            Diagnostic::new(
                Code::E5601,
                format!("The {what} {bad:?} of `hud.{member}` is outside the range {lo:?} to {hi:?}."),
            )
            .at(arg.span)
            .expected(format!("{lo:?} to {hi:?} CSS pixels"))
            .actual(format!("{bad:?}"))
            .note("HUD sizes are CSS pixels; values computed at run time are clamped to the same range")
            .help(format!("give a {what} between {lo:?} and {hi:?}")),
        );
    }
}
