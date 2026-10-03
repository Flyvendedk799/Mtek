//! Constant values and value ranges of registry fields (`spec/stdlib.md` section 1.2).
//!
//! A field default is stored as a [`ConstValue`]; its canonical source text is derived from
//! the value by [`ConstValue::canonical_text`], so the two can never drift apart.

use super::model::TypeRef;

/// Formats an `f32` as canonical source text: the shortest decimal that round-trips the
/// binary32 value, with at least one fractional digit (`1` is printed `1.0`).
///
/// Non-finite values never occur in registry data (the registry validation rejects them);
/// they are printed with Rust's spelling so the function stays total.
pub fn format_f32(value: f32) -> String {
    // Rust's `Display` for floats is the shortest round-trip form and never uses an exponent.
    let text = format!("{value}");
    if value.is_finite() && !text.contains('.') {
        format!("{text}.0")
    } else {
        text
    }
}

/// A colour constant: the sRGB literal it was declared with and the linear value it denotes
/// (`spec/language.md` section 5.4).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColorValue {
    /// Linear RGBA, straight alpha.
    pub linear: [f32; 4],
    /// The literal channels `#RRGGBBAA` as declared (alpha `255` prints as `#RRGGBB`).
    pub literal: [u8; 4],
}

impl ColorValue {
    /// The value of the literal `#RRGGBBAA`: each RGB channel goes through the exact sRGB EOTF
    /// computed in `f64` and rounded once to `f32`; alpha is `AA / 255` and linear.
    pub fn from_srgb8(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self {
            linear: [
                srgb_to_linear(r),
                srgb_to_linear(g),
                srgb_to_linear(b),
                (f64::from(a) / 255.0) as f32,
            ],
            literal: [r, g, b, a],
        }
    }

    /// The literal as canonical source text: lowercase, eight digits only when alpha is not 1.
    pub fn literal_text(&self) -> String {
        let [r, g, b, a] = self.literal;
        if a == 255 {
            format!("#{r:02x}{g:02x}{b:02x}")
        } else {
            format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
        }
    }
}

/// The binary32 sRGB transfer function of one channel: the definition constant folding uses
/// for `color.srgb(rgb, a)` (decision 0024 item 6). Every operation is rounded to binary32
/// and `powf` is `libm::powf`, so the result is identical on every host. Run-time evaluation
/// uses the same formula and agrees within the CPU/GPU tolerance, not necessarily bit for
/// bit. `#rrggbb` literals use [`srgb_to_linear`] instead.
pub fn srgb_channel_to_linear_f32(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        libm::powf((c + 0.055) / 1.055, 2.4)
    }
}

/// The sRGB electro-optical transfer function of one 8-bit channel.
pub fn srgb_to_linear(channel: u8) -> f32 {
    let c = f64::from(channel) / 255.0;
    let linear = if c <= 0.04045 {
        c / 12.92
    } else {
        libm::pow((c + 0.055) / 1.055, 2.4)
    };
    linear as f32
}

/// The built-in 1x1 textures (`texture.white()`, `texture.black()`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinTexture {
    White,
    Black,
}

/// The built-in sampler presets (`sampler.linear_repeat()` and friends).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinSampler {
    LinearRepeat,
    LinearClamp,
    NearestRepeat,
    NearestClamp,
}

/// A value the compiler can fold at compile time: what a field default evaluates to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConstValue {
    Bool(bool),
    I32(i32),
    U32(u32),
    F32(f32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    Color(ColorValue),
    /// `quat.identity()`.
    QuatIdentity,
    Texture(BuiltinTexture),
    Sampler(BuiltinSampler),
    /// `Name {}`: a descriptor of the named schema with every field at its default.
    EmptyDescriptor(&'static str),
}

impl ConstValue {
    /// A `vec3` with every component equal to `value` (the `vec3(1.0)` shorthand).
    pub fn splat3(value: f32) -> Self {
        ConstValue::Vec3([value; 3])
    }

    /// A `vec2` with every component equal to `value`.
    pub fn splat2(value: f32) -> Self {
        ConstValue::Vec2([value; 2])
    }

    /// An opaque colour from the literal `#RRGGBB`.
    pub fn srgb(r: u8, g: u8, b: u8) -> Self {
        ConstValue::Color(ColorValue::from_srgb8(r, g, b, 255))
    }

    /// The canonical source text of the value (`spec/stdlib.md` section 1.2): vector
    /// shorthands expanded to every component, floats in the shortest round-trip form with a
    /// fractional digit, colours as the lowercase literal they were declared with, namespace
    /// calls as written.
    pub fn canonical_text(&self) -> String {
        fn list(values: &[f32]) -> String {
            values
                .iter()
                .map(|v| format_f32(*v))
                .collect::<Vec<_>>()
                .join(", ")
        }
        match self {
            ConstValue::Bool(v) => v.to_string(),
            ConstValue::I32(v) => v.to_string(),
            ConstValue::U32(v) => v.to_string(),
            ConstValue::F32(v) => format_f32(*v),
            ConstValue::Vec2(v) => format!("vec2({})", list(v)),
            ConstValue::Vec3(v) => format!("vec3({})", list(v)),
            ConstValue::Vec4(v) => format!("vec4({})", list(v)),
            ConstValue::Color(c) => c.literal_text(),
            ConstValue::QuatIdentity => "quat.identity()".to_owned(),
            ConstValue::Texture(BuiltinTexture::White) => "texture.white()".to_owned(),
            ConstValue::Texture(BuiltinTexture::Black) => "texture.black()".to_owned(),
            ConstValue::Sampler(BuiltinSampler::LinearRepeat) => {
                "sampler.linear_repeat()".to_owned()
            }
            ConstValue::Sampler(BuiltinSampler::LinearClamp) => "sampler.linear_clamp()".to_owned(),
            ConstValue::Sampler(BuiltinSampler::NearestRepeat) => {
                "sampler.nearest_repeat()".to_owned()
            }
            ConstValue::Sampler(BuiltinSampler::NearestClamp) => {
                "sampler.nearest_clamp()".to_owned()
            }
            ConstValue::EmptyDescriptor(name) => format!("{name} {{}}"),
        }
    }

    /// Whether the value is finite in every component (no NaN, no infinity).
    pub fn is_finite(&self) -> bool {
        match self {
            ConstValue::F32(v) => v.is_finite(),
            ConstValue::Vec2(v) => v.iter().all(|c| c.is_finite()),
            ConstValue::Vec3(v) => v.iter().all(|c| c.is_finite()),
            ConstValue::Vec4(v) => v.iter().all(|c| c.is_finite()),
            ConstValue::Color(c) => c.linear.iter().all(|c| c.is_finite()),
            _ => true,
        }
    }

    /// The value as the registry type it inhabits, or `None` for descriptors (their type is
    /// the descriptor category of the schema they name, which only the registry knows).
    pub fn value_type(&self) -> Option<TypeRef> {
        Some(match self {
            ConstValue::Bool(_) => TypeRef::Bool,
            ConstValue::I32(_) => TypeRef::I32,
            ConstValue::U32(_) => TypeRef::U32,
            ConstValue::F32(_) => TypeRef::F32,
            ConstValue::Vec2(_) => TypeRef::Vec2,
            ConstValue::Vec3(_) => TypeRef::Vec3,
            ConstValue::Vec4(_) => TypeRef::Vec4,
            ConstValue::Color(_) => TypeRef::Color,
            ConstValue::QuatIdentity => TypeRef::Quat,
            ConstValue::Texture(_) => TypeRef::Texture,
            ConstValue::Sampler(_) => TypeRef::Sampler,
            ConstValue::EmptyDescriptor(_) => return None,
        })
    }
}

/// One numeric limit of a [`Bound`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Limit {
    Int(i64),
    Float(f32),
    /// The real number pi (not the binary32 approximation, which lies above it).
    Pi,
}

impl Limit {
    /// The limit as an `f64`.
    pub fn as_f64(self) -> f64 {
        match self {
            Limit::Int(v) => v as f64,
            Limit::Float(v) => f64::from(v),
            Limit::Pi => std::f64::consts::PI,
        }
    }

    fn text(self) -> String {
        match self {
            Limit::Int(v) => v.to_string(),
            Limit::Float(v) => format_f32(v),
            Limit::Pi => "\u{3c0}".to_owned(),
        }
    }
}

/// A lower or upper bound, inclusive or exclusive.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bound {
    pub limit: Limit,
    pub inclusive: bool,
}

impl Bound {
    /// `value` itself is allowed.
    pub const fn inclusive(limit: Limit) -> Self {
        Self {
            limit,
            inclusive: true,
        }
    }

    /// `value` itself is not allowed.
    pub const fn exclusive(limit: Limit) -> Self {
        Self {
            limit,
            inclusive: false,
        }
    }
}

/// The structured constraint on a field's value (`spec/stdlib.md` section 3).
///
/// For vector fields the bounds apply to every component. Checking a constant outside the
/// range is diagnostic `E5006`; the cross-field rule (`far > near`) is a rule over two fields
/// of the same schema descriptor and is checked by the caller with
/// [`ValueRange::greater_than_field`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ValueRange {
    pub lower: Option<Bound>,
    pub upper: Option<Bound>,
    /// The value must exceed the value of this sibling field of the same descriptor.
    pub greater_than_field: Option<&'static str>,
    /// The value must be finite (no infinity).
    pub finite: bool,
}

impl ValueRange {
    const EMPTY: ValueRange = ValueRange {
        lower: None,
        upper: None,
        greater_than_field: None,
        finite: false,
    };

    /// `> 0`.
    pub const fn positive() -> Self {
        Self::bounded(Some(Bound::exclusive(Limit::Int(0))), None)
    }

    /// `>= 0`.
    pub const fn non_negative() -> Self {
        Self::bounded(Some(Bound::inclusive(Limit::Int(0))), None)
    }

    /// `lo ..= hi`, both ends allowed.
    pub const fn closed(lo: i64, hi: i64) -> Self {
        Self::bounded(
            Some(Bound::inclusive(Limit::Int(lo))),
            Some(Bound::inclusive(Limit::Int(hi))),
        )
    }

    /// Arbitrary bounds.
    pub const fn bounded(lower: Option<Bound>, upper: Option<Bound>) -> Self {
        Self {
            lower,
            upper,
            ..Self::EMPTY
        }
    }

    /// `> sibling`, a cross-field constraint (for example `far > near`).
    pub const fn above_field(sibling: &'static str) -> Self {
        Self {
            greater_than_field: Some(sibling),
            ..Self::EMPTY
        }
    }

    /// Adds the finiteness requirement.
    pub const fn and_finite(mut self) -> Self {
        self.finite = true;
        self
    }

    /// Whether one scalar (or one vector component) satisfies the numeric bounds and the
    /// finiteness requirement. The cross-field constraint is not part of this check.
    pub fn contains(&self, value: f64) -> bool {
        if value.is_nan() || (self.finite && !value.is_finite()) {
            return false;
        }
        let lower_ok = self.lower.is_none_or(|b| {
            let limit = b.limit.as_f64();
            if b.inclusive {
                value >= limit
            } else {
                value > limit
            }
        });
        let upper_ok = self.upper.is_none_or(|b| {
            let limit = b.limit.as_f64();
            if b.inclusive {
                value <= limit
            } else {
                value < limit
            }
        });
        lower_ok && upper_ok
    }

    /// The canonical documentation text of the range for a field of type `ty`
    /// (`"every component > 0"`, `"3\u{2026}256"`, `"(0, \u{3c0})"`, `"> near"`, ...).
    pub fn describe(&self, ty: &TypeRef) -> String {
        let mut parts: Vec<String> = Vec::new();
        let per_component = matches!(ty, TypeRef::Vec2 | TypeRef::Vec3 | TypeRef::Vec4);
        let prefix = if per_component {
            "every component "
        } else {
            ""
        };
        match (self.lower, self.upper) {
            (None, None) => {}
            (Some(lo), None) => {
                let op = if lo.inclusive { "\u{2265}" } else { ">" };
                parts.push(format!("{prefix}{op} {}", lo.limit.text()));
            }
            (None, Some(hi)) => {
                let op = if hi.inclusive { "\u{2264}" } else { "<" };
                parts.push(format!("{prefix}{op} {}", hi.limit.text()));
            }
            (Some(lo), Some(hi)) => {
                let text = if lo.inclusive && hi.inclusive {
                    format!("{}\u{2026}{}", lo.limit.text(), hi.limit.text())
                } else {
                    let open = if lo.inclusive { '[' } else { '(' };
                    let close = if hi.inclusive { ']' } else { ')' };
                    format!("{open}{}, {}{close}", lo.limit.text(), hi.limit.text())
                };
                parts.push(format!("{prefix}{text}"));
            }
        }
        if let Some(sibling) = self.greater_than_field {
            parts.push(format!("> {sibling}"));
        }
        if self.finite {
            parts.push("finite".to_owned());
        }
        parts.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_print_shortest_round_trip_with_a_fractional_digit() {
        assert_eq!(format_f32(1.0), "1.0");
        assert_eq!(format_f32(0.0), "0.0");
        assert_eq!(format_f32(-9.81), "-9.81");
        assert_eq!(format_f32(0.9), "0.9");
        assert_eq!(format_f32(1000.0), "1000.0");
        assert_eq!(format_f32(0.05), "0.05");
        assert_eq!(format_f32(1.0e-7), "0.0000001");
        // The shortest decimal of the binary32 value, not of the f64 widening.
        assert_eq!(format_f32(0.1), "0.1");
        assert_eq!(format_f32(16_777_216.0), "16777216.0");
    }

    #[test]
    fn canonical_text_expands_vector_shorthand_and_keeps_calls() {
        assert_eq!(
            ConstValue::splat3(1.0).canonical_text(),
            "vec3(1.0, 1.0, 1.0)"
        );
        assert_eq!(ConstValue::splat2(0.0).canonical_text(), "vec2(0.0, 0.0)");
        assert_eq!(
            ConstValue::Vec3([0.0, -9.81, 0.0]).canonical_text(),
            "vec3(0.0, -9.81, 0.0)"
        );
        assert_eq!(
            ConstValue::Vec4([0.0, 0.0, 0.0, 1.0]).canonical_text(),
            "vec4(0.0, 0.0, 0.0, 1.0)"
        );
        assert_eq!(ConstValue::QuatIdentity.canonical_text(), "quat.identity()");
        assert_eq!(
            ConstValue::Texture(BuiltinTexture::White).canonical_text(),
            "texture.white()"
        );
        assert_eq!(
            ConstValue::Sampler(BuiltinSampler::LinearRepeat).canonical_text(),
            "sampler.linear_repeat()"
        );
        assert_eq!(
            ConstValue::EmptyDescriptor("Unlit").canonical_text(),
            "Unlit {}"
        );
        assert_eq!(ConstValue::Bool(true).canonical_text(), "true");
        assert_eq!(ConstValue::U32(32).canonical_text(), "32");
        assert_eq!(ConstValue::I32(-3).canonical_text(), "-3");
    }

    #[test]
    fn colours_print_as_the_lowercase_declared_literal() {
        assert_eq!(ConstValue::srgb(0, 0, 0).canonical_text(), "#000000");
        assert_eq!(ConstValue::srgb(255, 255, 255).canonical_text(), "#ffffff");
        assert_eq!(
            ConstValue::srgb(0x6b, 0x5c, 0xff).canonical_text(),
            "#6b5cff"
        );
        let translucent = ConstValue::Color(ColorValue::from_srgb8(0x10, 0x14, 0x18, 0x80));
        assert_eq!(translucent.canonical_text(), "#10141880");
    }

    #[test]
    fn colour_literals_follow_the_exact_srgb_eotf() {
        let white = ColorValue::from_srgb8(255, 255, 255, 255);
        assert_eq!(white.linear, [1.0, 1.0, 1.0, 1.0]);
        let black = ColorValue::from_srgb8(0, 0, 0, 255);
        assert_eq!(black.linear, [0.0, 0.0, 0.0, 1.0]);
        // Below the knee the transfer function is linear: 10 / 255 / 12.92.
        assert_eq!(
            srgb_to_linear(10),
            ((10.0_f64 / 255.0) / 12.92) as f32,
            "linear segment"
        );
        // Mid grey 128 is 0.2158605... in linear light.
        assert!((srgb_to_linear(128) - 0.215_860_5).abs() < 1.0e-6);
        // Alpha is linear: 0x80 / 255.
        assert_eq!(
            ColorValue::from_srgb8(0, 0, 0, 0x80).linear[3],
            (128.0_f64 / 255.0) as f32
        );
    }

    #[test]
    fn folded_srgb_uses_the_binary32_formula() {
        assert_eq!(srgb_channel_to_linear_f32(0.0), 0.0);
        assert_eq!(srgb_channel_to_linear_f32(1.0), 1.0);
        // Linear segment.
        assert_eq!(srgb_channel_to_linear_f32(0.04), 0.04_f32 / 12.92);
        // Power segment, every operation in binary32.
        let c = 128.0_f32 / 255.0;
        assert_eq!(
            srgb_channel_to_linear_f32(c),
            libm::powf((c + 0.055) / 1.055, 2.4)
        );
        // The literal path rounds once from f64 and may differ in the last bit; both are
        // within a few binary32 steps of each other.
        let literal = srgb_to_linear(128);
        assert!((srgb_channel_to_linear_f32(c) - literal).abs() <= 4.0 * f32::EPSILON * literal);
    }

    #[test]
    fn value_types_of_constants() {
        assert_eq!(ConstValue::F32(1.0).value_type(), Some(TypeRef::F32));
        assert_eq!(ConstValue::QuatIdentity.value_type(), Some(TypeRef::Quat));
        assert_eq!(ConstValue::srgb(1, 2, 3).value_type(), Some(TypeRef::Color));
        assert_eq!(ConstValue::EmptyDescriptor("Box").value_type(), None);
        assert!(ConstValue::F32(1.0).is_finite());
        assert!(!ConstValue::Vec3([0.0, f32::INFINITY, 0.0]).is_finite());
    }

    #[test]
    fn range_text() {
        let v3 = TypeRef::Vec3;
        let f = TypeRef::F32;
        assert_eq!(ValueRange::positive().describe(&v3), "every component > 0");
        assert_eq!(ValueRange::positive().describe(&f), "> 0");
        assert_eq!(ValueRange::non_negative().describe(&f), "\u{2265} 0");
        assert_eq!(
            ValueRange::closed(3, 256).describe(&TypeRef::U32),
            "3\u{2026}256"
        );
        assert_eq!(ValueRange::closed(0, 1).describe(&f), "0\u{2026}1");
        let fov = ValueRange::bounded(
            Some(Bound::exclusive(Limit::Int(0))),
            Some(Bound::exclusive(Limit::Pi)),
        );
        assert_eq!(fov.describe(&f), "(0, \u{3c0})");
        assert_eq!(ValueRange::above_field("near").describe(&f), "> near");
        assert_eq!(
            ValueRange::positive().and_finite().describe(&f),
            "> 0, finite"
        );
        assert_eq!(
            ValueRange::positive().and_finite().describe(&v3),
            "every component > 0, finite"
        );
        let half_open = ValueRange::bounded(
            Some(Bound::inclusive(Limit::Int(0))),
            Some(Bound::exclusive(Limit::Int(1))),
        );
        assert_eq!(half_open.describe(&f), "[0, 1)");
        let capped = ValueRange::bounded(None, Some(Bound::inclusive(Limit::Float(0.5))));
        assert_eq!(capped.describe(&f), "\u{2264} 0.5");
    }

    #[test]
    fn range_membership() {
        let positive = ValueRange::positive();
        assert!(positive.contains(0.001));
        assert!(!positive.contains(0.0));
        assert!(!positive.contains(-1.0));
        assert!(!positive.contains(f64::NAN));
        assert!(positive.contains(f64::INFINITY));
        assert!(!positive.and_finite().contains(f64::INFINITY));
        let closed = ValueRange::closed(0, 1);
        assert!(closed.contains(0.0) && closed.contains(1.0));
        assert!(!closed.contains(1.0001));
        let fov = ValueRange::bounded(
            Some(Bound::exclusive(Limit::Int(0))),
            Some(Bound::exclusive(Limit::Pi)),
        );
        assert!(fov.contains(0.9));
        assert!(!fov.contains(std::f64::consts::PI));
        // The binary32 value nearest pi lies above pi and is out of range.
        assert!(!fov.contains(f64::from(std::f32::consts::PI)));
    }
}
