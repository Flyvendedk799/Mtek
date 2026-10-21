//! Audio calls in the checker (`spec/audio.md` section 3, decision 0130): `E5501` for a constant
//! volume or pitch outside its range. Run-time values outside the range are clamped by the
//! runtime with `W8201`.

use super::check::Checker;
use super::consteval::Folded;
use super::value::ConstValue;
use crate::diagnostics::{Code, Diagnostic};
use crate::syntax::ast::Expr;

/// The audio intrinsics of the registry.
pub(super) const AUDIO_FUNCTIONS: [&str; 7] = [
    "play",
    "play_at",
    "play_music",
    "stop_music",
    "set_volume",
    "set_muted",
    "is_muted",
];

/// The range of a volume argument.
pub(crate) const VOLUME_RANGE: (f32, f32) = (0.0, 4.0);
/// The range of a pitch (playback-rate) argument.
pub(crate) const PITCH_RANGE: (f32, f32) = (0.0625, 16.0);

impl Checker<'_> {
    /// `E5501` for every constant volume or pitch argument of an audio call outside its range.
    pub(super) fn check_audio_args(&mut self, name: &str, args: &[Expr]) {
        // (argument index, what it is, range) per function.
        let checked: &[(usize, &str, (f32, f32))] = match name {
            "play" => &[(1, "volume", VOLUME_RANGE), (2, "pitch", PITCH_RANGE)],
            "play_at" => &[(2, "volume", VOLUME_RANGE)],
            "play_music" => &[(1, "volume", VOLUME_RANGE)],
            "set_volume" => &[(0, "volume", VOLUME_RANGE)],
            _ => &[],
        };
        for &(index, what, (lo, hi)) in checked {
            let Some(arg) = args.get(index) else {
                continue;
            };
            let Folded::Value(ConstValue::F32(value)) = self.fold(arg) else {
                continue;
            };
            if value.is_finite() && (lo..=hi).contains(&value) {
                continue;
            }
            self.report(
                Diagnostic::new(
                    Code::E5501,
                    format!(
                        "The {what} {value:?} of `{name}` is outside the range {lo:?} to {hi:?}."
                    ),
                )
                .at(arg.span)
                .expected(format!("{lo:?} to {hi:?}"))
                .actual(format!("{value:?}"))
                .note(if what == "pitch" {
                    "the pitch is a playback rate: 1.0 plays the sound as recorded, 2.0 an octave higher and twice as fast"
                } else {
                    "a volume is a gain: 0.0 is silent, 1.0 plays the sound as recorded"
                })
                .help(format!("give a {what} between {lo:?} and {hi:?}")),
            );
        }
    }
}
