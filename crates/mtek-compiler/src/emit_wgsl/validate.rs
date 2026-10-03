//! Parsing and validation of generated WGSL with the pinned Naga
//! (`spec/compiler-architecture.md` section 8).
//!
//! Validation uses `ValidationFlags::all()`, which includes `STRUCT_LAYOUTS`: the flag
//! that enforces the uniform address-space layout rules. Because Mtek type-checks before
//! it emits, any error reported here is a compiler defect; the caller turns it into
//! `E6100` and maps the byte span back to the originating Mtek span.

use std::error::Error;
use std::fmt;
use std::ops::Range;

use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::{Module, Span};

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

#[cfg(test)]
mod tests {
    use super::*;

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
