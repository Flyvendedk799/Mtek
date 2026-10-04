//! Parsing and validation of generated WGSL with the pinned Naga
//! (`spec/compiler-architecture.md` section 8).
//!
//! Validation uses `ValidationFlags::all()`, which includes `STRUCT_LAYOUTS`: the flag
//! that enforces the uniform address-space layout rules. Because Mtek type-checks before
//! it emits, any error reported here is a compiler defect: [`validate()`] turns it into
//! `E6100` at the Mtek span the span map gives for the WGSL position.

use std::error::Error;
use std::fmt;
use std::ops::Range;

use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::{Module, Span};

use crate::diagnostics::{Code, Diagnostic};

use super::span_map::{SpanMap, wgsl_line_column};

/// Which Naga phase rejected the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WgslErrorStage {
    /// The WGSL front end could not parse or lower the source.
    Parse,
    /// The module parsed but failed validation.
    Validate,
}

/// A source range with the description Naga attached to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WgslLabel {
    /// Byte range into the validated source text.
    pub range: Range<usize>,
    pub text: String,
}

/// Naga rejected generated WGSL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WgslValidationError {
    pub stage: WgslErrorStage,
    /// Naga's one-line message.
    pub message: Box<str>,
    /// The causes Naga chains below the message, outermost first. For a uniform layout
    /// violation this contains `Alignment requirements for address space Uniform ...`.
    pub causes: Box<[String]>,
    /// Byte range of the primary span in the validated source, if Naga reported one.
    pub span: Option<Range<usize>>,
    /// Every labelled span Naga reported, primary first.
    pub labels: Box<[WgslLabel]>,
    /// Naga's full rendering of the error against the source (`emit_to_string`).
    pub rendered: Box<str>,
}

impl fmt::Display for WgslValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stage = match self.stage {
            WgslErrorStage::Parse => "parse",
            WgslErrorStage::Validate => "validation",
        };
        write!(f, "WGSL {stage} error: {}", self.message)?;
        for cause in &self.causes {
            write!(f, ": {cause}")?;
        }
        Ok(())
    }
}

impl Error for WgslValidationError {}

fn label(span: Span, text: &str) -> Option<WgslLabel> {
    span.to_range().map(|range| WgslLabel {
        range,
        text: text.to_owned(),
    })
}

/// Parses `source` with `naga::front::wgsl::parse_str` and validates the module with
/// `ValidationFlags::all()` and `Capabilities::default()`.
pub fn validate_wgsl(source: &str) -> Result<Module, WgslValidationError> {
    let module = naga::front::wgsl::parse_str(source).map_err(|e| {
        let labels: Vec<WgslLabel> = e.labels().filter_map(|(s, t)| label(s, t)).collect();
        WgslValidationError {
            stage: WgslErrorStage::Parse,
            message: e.message().into(),
            causes: e.notes().map(str::to_owned).collect(),
            span: labels.first().map(|l| l.range.clone()),
            labels: labels.into(),
            rendered: e.emit_to_string(source).into(),
        }
    })?;

    let mut validator = Validator::new(ValidationFlags::all(), Capabilities::default());
    match validator.validate(&module) {
        Ok(_) => Ok(module),
        Err(e) => {
            let labels: Vec<WgslLabel> = e.spans().filter_map(|(s, t)| label(*s, t)).collect();
            let mut causes = Vec::new();
            let mut cause = Error::source(e.as_inner());
            while let Some(next) = cause {
                causes.push(next.to_string());
                cause = next.source();
            }
            Err(WgslValidationError {
                stage: WgslErrorStage::Validate,
                message: e.as_inner().to_string().into(),
                causes: causes.into(),
                span: labels.first().map(|l| l.range.clone()),
                labels: labels.into(),
                rendered: e.emit_to_string(source).into(),
            })
        }
    }
}

/// Validates emitted WGSL (`spec/compiler-architecture.md` section 8): [`validate_wgsl`],
/// with any Naga parse or validation error turned into one `E6100` diagnostic ("generated
/// WGSL failed validation — this is a compiler bug"). The diagnostic sits at the Mtek span
/// the span map gives for the WGSL position of Naga's primary span (the material
/// declaration when Naga reports no position or no entry covers it), carries Naga's
/// message and the WGSL position as notes and asks for a report.
///
/// # Errors
/// The `E6100` diagnostic when Naga rejects `module_text`.
pub fn validate(module_text: &str, span_map: &SpanMap) -> Result<(), Vec<Diagnostic>> {
    let Err(error) = validate_wgsl(module_text) else {
        return Ok(());
    };
    let position = error
        .span
        .as_ref()
        .map(|range| wgsl_line_column(module_text, range.start));
    let (span, symbol) = match position {
        Some((line, column)) => span_map.resolve(line, column),
        None => (span_map.declaration, span_map.symbol.as_str()),
    };
    let location = match position {
        Some((line, column)) => format!(
            "the error is at line {line}, column {column} of the generated WGSL, in code generated for '{symbol}'"
        ),
        None => format!("Naga reported no position; the code was generated for '{symbol}'"),
    };
    Err(vec![
        Diagnostic::new(
            Code::E6100,
            format!(
                "The WGSL generated for material '{}' failed validation; this is a compiler bug.",
                span_map.symbol
            ),
        )
        .at(span)
        .note(format!("Naga: {error}"))
        .note(location)
        .help("please report it with the program that caused it"),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emit_wgsl::span_map::{SpanMapEntry, WgslRange};
    use crate::source::FileId;

    fn mtek(start: u32, end: u32) -> crate::source::Span {
        crate::source::Span::new(FileId(4), start, end)
    }

    fn map(entries: Vec<SpanMapEntry>) -> SpanMap {
        SpanMap {
            symbol: "std/materials.mtek::Unlit".to_owned(),
            declaration: mtek(0, 100),
            entries,
        }
    }

    #[test]
    fn valid_wgsl_passes_validate() {
        assert_eq!(validate(OK, &map(Vec::new())), Ok(()));
    }

    #[test]
    fn a_naga_error_is_e6100_at_the_mapped_span() {
        // Line 3 returns a `vec3` from a function declared to return `vec4`.
        let source = "struct S { a: f32 }\n@group(0) @binding(0) var<uniform> u: S;\n\
                      @fragment fn main() -> @location(0) vec4<f32> { return vec3<f32>(u.a); }\n";
        let entries = vec![
            SpanMapEntry {
                wgsl: WgslRange {
                    line: 3,
                    col_start: 1,
                    col_end: 75,
                },
                span: mtek(10, 20),
                symbol: "std/materials.mtek::Unlit".to_owned(),
            },
            SpanMapEntry {
                wgsl: WgslRange {
                    line: 3,
                    col_start: 49,
                    col_end: 71,
                },
                span: mtek(12, 18),
                symbol: "std/materials.mtek::Unlit.fragment".to_owned(),
            },
        ];
        let error = validate_wgsl(source).expect_err("invalid");
        let (line, column) = wgsl_line_column(source, error.span.clone().expect("span").start);
        assert_eq!(line, 3, "{error:?}");
        let diagnostics = validate(source, &map(entries)).expect_err("invalid");
        assert_eq!(diagnostics.len(), 1);
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E6100);
        assert_eq!(d.severity, Code::E6100.severity());
        assert_eq!(
            d.message,
            "The WGSL generated for material 'std/materials.mtek::Unlit' failed validation; this is a compiler bug."
        );
        // Naga points into `return vec3<f32>(u.a);` (columns 49..71): the narrower entry.
        assert!((49..71).contains(&column), "{error:?}");
        assert_eq!(d.primary.as_ref().map(|l| l.span), Some(mtek(12, 18)));
        assert!(d.notes[0].starts_with("Naga: WGSL "), "{:?}", d.notes);
        assert!(
            d.notes[1].starts_with(&format!("the error is at line 3, column {column} ")),
            "{:?}",
            d.notes
        );
        assert!(d.message.contains("compiler bug"));
    }

    #[test]
    fn an_unmapped_naga_error_falls_back_to_the_material_declaration() {
        let source = "struct S { a: f32 \n";
        let diagnostics = validate(source, &map(Vec::new())).expect_err("invalid");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E6100);
        assert_eq!(d.primary.as_ref().map(|l| l.span), Some(mtek(0, 100)));
        assert!(
            d.notes[1].ends_with("in code generated for 'std/materials.mtek::Unlit'"),
            "{:?}",
            d.notes
        );
    }

    const OK: &str = "struct S { a: f32 }\n@group(0) @binding(0) var<uniform> u: S;\n\
                      @fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(u.a); }\n";

    #[test]
    fn valid_source_returns_the_module() {
        let module = validate_wgsl(OK).expect("valid WGSL");
        assert_eq!(module.entry_points.len(), 1);
    }

    #[test]
    fn syntax_errors_keep_message_and_span() {
        let source = "struct S { a: f32 \n";
        let err = validate_wgsl(source).expect_err("must not parse");
        assert_eq!(err.stage, WgslErrorStage::Parse);
        assert!(!err.message.is_empty());
        let span = err.span.clone().expect("a primary span");
        assert!(span.end <= source.len() && span.start <= span.end);
        assert!(err.rendered.contains("wgsl"), "{}", err.rendered);
        assert!(err.to_string().starts_with("WGSL parse error"), "{err}");
    }

    #[test]
    fn validation_errors_keep_causes_and_span() {
        // `after` follows a struct member without the uniform padding: Naga rejects it.
        let source = "struct Inner { k: f32 }\nstruct Outer { inner: Inner, after: f32 }\n\
                      @group(1) @binding(0) var<uniform> u: Outer;\n\
                      @fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(u.after); }\n";
        let err = validate_wgsl(source).expect_err("must not validate");
        assert_eq!(err.stage, WgslErrorStage::Validate);
        assert!(
            err.causes
                .iter()
                .any(|c| c.contains("Alignment requirements for address space Uniform")),
            "{err:?}"
        );
        let span = err.span.clone().expect("a primary span");
        assert!(source.get(span).is_some());
        assert!(err.rendered.contains("error"), "{}", err.rendered);
    }
}
