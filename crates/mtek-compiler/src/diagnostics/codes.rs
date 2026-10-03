//! The diagnostic code catalogue.
//!
//! This file is the single source of truth for `spec/diagnostics.md` section 5.
//! One table drives the [`Code`] enum, [`Code::ALL`] and every accessor; a test
//! (`tests/diagnostics_catalogue.rs`) parses the markdown tables of the
//! specification and fails if a code, severity or title differs.
//!
//! The table lists exactly the concrete codes of the specification, in the
//! order of its tables. Ranges such as `E7001-E7099` are reserved by the
//! specification but are not codes yet; they are added here when the owning
//! specification section (assets, physics) lists them.

use std::fmt;

use super::model::{Phase, RuntimePhase, Severity};

macro_rules! catalogue {
    ($( $code:ident $severity:ident $title:literal, )+) => {
        /// A stable diagnostic code. The enum variant is the code without the
        /// `MTEK-` prefix (`E3102`); [`Code::as_str`] gives the full code.
        ///
        /// `Ord` follows the order of the specification's catalogue; use
        /// [`Code::as_str`] when a textual order is wanted.
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
        pub enum Code {
            $( $code, )+
        }

        impl Code {
            /// Every code, in the order of the catalogue.
            pub const ALL: &'static [Code] = &[ $( Code::$code, )+ ];

            /// The full code, for example `"MTEK-E3102"`.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $( Code::$code => concat!("MTEK-", stringify!($code)), )+
                }
            }

            /// The severity of the code (also its letter: `E`, `W`).
            #[must_use]
            pub const fn severity(self) -> Severity {
                match self {
                    $( Code::$code => Severity::$severity, )+
                }
            }

            /// The catalogue title: short and constant for the code.
            #[must_use]
            pub const fn title(self) -> &'static str {
                match self {
                    $( Code::$code => $title, )+
                }
            }
        }
    };
}

catalogue! {
    // 5.0 Source and lexical (`0xxx`)
    E0001 Error "invalid UTF-8",
    E0002 Error "misplaced byte-order mark",
    E0003 Error "lone carriage return",
    E0004 Error "file too large",
    E0005 Error "invalid character",
    E0006 Error "unterminated block comment",
    W0007 Warning "dangling doc comment",
    E0010 Error "non-ASCII identifier",
    E0011 Error "reserved identifier prefix",
    E0012 Error "reserved identifier `_`",
    E0013 Error "reserved word",
    E0020 Error "leading zero in integer literal",
    E0021 Error "unsupported numeric literal form",
    E0022 Error "malformed float literal",
    E0023 Error "invalid escape sequence",
    E0024 Error "unterminated string",
    E0025 Error "malformed color literal",
    W0030 Warning "naming convention",
    // 5.1 Syntax (`1xxx`)
    E1001 Error "unexpected token",
    E1002 Error "unclosed delimiter",
    E1003 Error "missing semicolon",
    E1004 Error "unexpected end of file",
    E1010 Error "chained comparison",
    E1011 Error "descriptor literal in condition",
    E1020 Error "unused expression",
    E1030 Error "`break`/`continue` outside loop",
    E1040 Error "member not allowed here",
    E1050 Error "nesting too deep",
    E1901 Error "bitwise operators not supported",
    // 5.2 Names and modules (`2xxx`)
    E2001 Error "shadowed name",
    E2002 Error "duplicate name",
    E2003 Error "unknown name",
    E2004 Error "built-in hidden by local",
    E2005 Error "parameter name used as namespace",
    W2010 Warning "variable never reassigned",
    E2020 Error "constant cycle",
    E2030 Error "invalid import specifier",
    E2031 Error "import outside project root",
    E2032 Error "import path case mismatch",
    E2033 Error "name not exported",
    E2034 Error "package imports not supported",
    E2035 Error "import cycle",
    E2036 Error "imported file not found",
    // 5.3 Types and values (`3xxx`)
    E3001 Error "type mismatch (general)",
    E3002 Error "wrong number of arguments",
    E3003 Error "unknown type",
    E3010 Error "arithmetic on color",
    E3011 Error "negation of unsigned value",
    E3012 Error "vector equality not supported",
    E3013 Error "invalid component or swizzle",
    E3014 Error "operator not defined for operands",
    E3020 Error "recursive struct",
    E3021 Error "missing struct field",
    E3022 Error "duplicate struct field",
    E3023 Error "unknown struct field",
    E3030 Error "constant index out of range",
    E3031 Error "invalid array length",
    E3040 Error "constant evaluation overflow or division by zero",
    E3041 Error "literal not representable",
    W3050 Warning "redundant conversion",
    E3060 Error "swizzle assignment not supported",
    E3061 Error "assignment to immutable place",
    E3070 Error "condition is not bool",
    E3080 Error "missing return",
    W3081 Warning "unreachable code",
    E3090 Error "not a constant expression",
    E3102 Error "field or parameter type mismatch",
    // 5.4 Functions, effects, stages (`4xxx`)
    E4001 Error "recursion not supported",
    E4002 Error "impure call from pure function",
    W4003 Warning "`cpu fn` could be `fn`",
    E4010 Error "unbounded loop in GPU code",
    E4011 Error "CPU-only type in GPU code",
    E4012 Error "CPU-only intrinsic in GPU code",
    E4013 Error "GPU-only intrinsic in CPU code",
    E4020 Error "material without fragment stage",
    E4021 Error "invalid stage signature",
    E4030 Error "parameter type not GPU-representable",
    E4031 Error "invalid parameter default",
    E4032 Error "too many material parameters",
    E4040 Error "capture in GPU stage",
    E4041 Error "invalid use of texture or sampler",
    E4901 Error "stage not supported",
    // 5.5 Scenes, schemas, ownership, bindings (`5xxx`)
    E5001 Error "unknown field",
    E5002 Error "duplicate field",
    E5003 Error "missing required field",
    E5004 Error "`bind` not allowed here",
    E5005 Error "impure binding",
    E5006 Error "field value out of range",
    E5010 Error "camera has both target and rotation",
    E5011 Error "invalid camera projection",
    E5012 Error "scene has no camera",
    E5013 Error "ambiguous active camera",
    E5014 Error "unknown scene object kind",
    E5020 Error "material without mesh",
    E5030 Error "named entity cannot be destroyed",
    E5040 Error "prefab cannot contain entities",
    E5041 Error "missing prefab parameter",
    E5042 Error "prefab instance sets non-parameter",
    E5050 Error "invalid lifecycle signature",
    E5051 Error "duplicate lifecycle function",
    E5052 Error "unknown lifecycle function",
    E5060 Error "unknown event",
    E5061 Error "invalid event arguments",
    E5062 Error "collision event without collider",
    E5070 Error "write to bound field",
    E5071 Error "write to physics-owned field",
    E5072 Error "binding on physics-owned field",
    E5073 Error "write to construction-only field",
    E5074 Error "field access through entity_ref",
    E5075 Error "binding cycle",
    E5080 Error "lifecycle operation during initialisation",
    E5081 Error "entity field read during initialisation",
    E5090 Error "invalid scale",
    E5091 Error "body on non-root entity",
    E5092 Error "too many static entities",
    E5100 Error "non-opaque color in material parameter",
    W5101 Warning "fragment alpha ignored",
    E5110 Error "light in prefab",
    E5111 Error "too many lights",
    E5901 Error "scene switching not supported",
    E5902 Error "transparency not supported",
    // 5.6 GPU and target (`6xxx`)
    E6001 Error "parameter block too large",
    E6002 Error "too many material resources",
    E6003 Error "too many interpolated inputs",
    E6100 Error "generated WGSL failed validation",
    // 5.7 Assets (`7xxx`)
    E7010 Error "mesh lacks required attribute",
    // 5.8 Runtime (`8xxx`)
    E8001 Error "unsupported platform endianness",
    E8002 Error "device below target profile",
    E8003 Error "incompatible program",
    E8004 Error "WebGPU unavailable",
    E8005 Error "no suitable adapter",
    E8006 Error "manifest invalid",
    E8011 Error "invalid camera value",
    W8030 Warning "index clamped",
    E8030 Error "named entity cannot be destroyed",
    W8031 Warning "command for pending entity dropped",
    W8032 Warning "entity already destroyed",
    E8033 Error "entity limit reached",
    E8040 Error "unknown host input",
    E8041 Error "host input has wrong type",
    E8050 Error "uncaptured GPU validation error",
    E8051 Error "shader or pipeline creation failed",
    W8060 Warning "GPU device lost",
    W8061 Warning "GPU device recovered",
    E8062 Error "GPU device recovery failed",
    E8063 Error "GPU allocation failed",
    W8070 Warning "scene restarted on reload",
    E8080 Error "execution budget exceeded",
    E8090 Error "invalid scale value",
    E8100 Error "non-opaque color value",
    // 5.9 Project and internal (`9xxx`)
    E9001 Error "invalid project configuration",
    E9002 Error "too many modules",
    W9003 Warning "further diagnostics suppressed",
    E9004 Error "project file not found",
    E9005 Error "entry file not found",
    E9006 Error "entry scene not found or ambiguous",
    E9010 Error "not implemented by this compiler build",
    E9020 Error "host input target not exposable",
    E9021 Error "unknown host input target",
    E9030 Error "runtime bundle not embedded",
    E9999 Error "internal compiler error",
}

impl Code {
    /// The code without the `MTEK-` prefix, for example `"E3102"`.
    #[must_use]
    pub fn short(self) -> &'static str {
        self.as_str().strip_prefix("MTEK-").unwrap_or(self.as_str())
    }

    /// Find a code by its full text (`"MTEK-E3102"`).
    #[must_use]
    pub fn parse(text: &str) -> Option<Code> {
        Self::ALL.iter().copied().find(|c| c.as_str() == text)
    }

    /// Find a code by its short text (`"E3102"`), as returned by
    /// [`SourceError::code`](crate::source::SourceError::code).
    #[must_use]
    pub fn parse_short(text: &str) -> Option<Code> {
        Self::ALL.iter().copied().find(|c| c.short() == text)
    }

    /// The thousands digit of the code: the area of `spec/diagnostics.md`
    /// section 3 (`0` source text ... `9` project and internal).
    #[must_use]
    pub fn range(self) -> u8 {
        self.short()
            .as_bytes()
            .get(1)
            .map_or(9, |digit| digit.saturating_sub(b'0'))
    }

    /// True for codes whose number ends in `9xx` (specified as "not supported
    /// in v0.1"), except the internal error `E9999`.
    #[must_use]
    pub fn is_unsupported_feature(self) -> bool {
        self != Code::E9999 && self.short().get(2..3) == Some("9")
    }

    /// The anchor of this code inside `spec/diagnostics.md`, for the `docs`
    /// field of the envelope: `spec/diagnostics.md#mtek-e3102`.
    #[must_use]
    pub fn docs(self) -> String {
        format!("spec/diagnostics.md#{}", self.as_str().to_ascii_lowercase())
    }

    /// The phase a diagnostic of this code is reported in unless the reporter
    /// says otherwise: `parse` for the `0xxx` and `1xxx` ranges, `validate` for
    /// `E6100`, `emit` for the other `6xxx` codes, `runtime:mount` for `8xxx`
    /// (reporters of other runtime phases override it) and `check` for the
    /// rest.
    #[must_use]
    pub fn default_phase(self) -> Phase {
        match self {
            Code::E6100 => Phase::Validate,
            _ => match self.range() {
                0 | 1 => Phase::Parse,
                6 => Phase::Emit,
                8 => Phase::Runtime(RuntimePhase::Mount),
                _ => Phase::Check,
            },
        }
    }
}

impl fmt::Display for Code {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn code_strings_follow_the_envelope_format() {
        let mut seen = BTreeSet::new();
        for &code in Code::ALL {
            let text = code.as_str();
            assert!(seen.insert(text), "duplicate {text}");
            let rest = text.strip_prefix("MTEK-").unwrap();
            let (letter, digits) = rest.split_at(1);
            assert_eq!(digits.len(), 4, "{text}");
            assert!(digits.bytes().all(|b| b.is_ascii_digit()), "{text}");
            assert_eq!(
                letter,
                code.severity().letter(),
                "{text}: letter must match severity"
            );
            assert!(!code.title().is_empty(), "{text}");
        }
        assert_eq!(seen.len(), Code::ALL.len());
    }

    #[test]
    fn known_codes() {
        assert_eq!(Code::E3102.as_str(), "MTEK-E3102");
        assert_eq!(Code::E3102.short(), "E3102");
        assert_eq!(Code::E3102.severity(), Severity::Error);
        assert_eq!(Code::E3102.title(), "field or parameter type mismatch");
        assert_eq!(Code::W9003.severity(), Severity::Warning);
        assert_eq!(Code::E3102.to_string(), "MTEK-E3102");
        assert_eq!(Code::E3102.docs(), "spec/diagnostics.md#mtek-e3102");
    }

    #[test]
    fn parse_round_trips() {
        for &code in Code::ALL {
            assert_eq!(Code::parse(code.as_str()), Some(code));
            assert_eq!(Code::parse_short(code.short()), Some(code));
        }
        assert_eq!(Code::parse("E3102"), None);
        assert_eq!(Code::parse("MTEK-E0000"), None);
        assert_eq!(Code::parse_short("MTEK-E3102"), None);
        assert_eq!(Code::parse(""), None);
    }

    #[test]
    fn source_error_codes_exist_in_the_catalogue() {
        for short in ["E0001", "E0002", "E0004", "E9002"] {
            assert!(Code::parse_short(short).is_some(), "{short}");
        }
    }

    #[test]
    fn ranges_and_unsupported_feature_codes() {
        assert_eq!(Code::E0001.range(), 0);
        assert_eq!(Code::E3102.range(), 3);
        assert_eq!(Code::E9999.range(), 9);
        assert!(Code::E1901.is_unsupported_feature());
        assert!(Code::E5902.is_unsupported_feature());
        assert!(Code::E4901.is_unsupported_feature());
        assert!(!Code::E9999.is_unsupported_feature());
        assert!(!Code::E9010.is_unsupported_feature());
        assert!(!Code::E3102.is_unsupported_feature());
    }

    #[test]
    fn default_phases() {
        assert_eq!(Code::E0001.default_phase(), Phase::Parse);
        assert_eq!(Code::E1003.default_phase(), Phase::Parse);
        assert_eq!(Code::E3102.default_phase(), Phase::Check);
        assert_eq!(Code::E6001.default_phase(), Phase::Emit);
        assert_eq!(Code::E6100.default_phase(), Phase::Validate);
        assert_eq!(
            Code::E8004.default_phase(),
            Phase::Runtime(RuntimePhase::Mount)
        );
        assert_eq!(Code::E9001.default_phase(), Phase::Check);
    }
}
