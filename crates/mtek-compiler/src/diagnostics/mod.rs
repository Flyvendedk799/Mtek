//! Diagnostics: the code catalogue, the diagnostic model and sink, the JSON
//! envelope and the human renderer (`spec/diagnostics.md`).
//!
//! Every stage reports problems as [`Diagnostic`]s pushed into a
//! [`Diagnostics`] sink and never panics on user input. At the end
//! [`Diagnostics::finish`] yields the ordered [`Report`], which
//! [`to_report`] / [`to_envelope`] turn into the versioned JSON of
//! `spec/diagnostic.schema.json` and [`render_report`] / [`render`] turn into
//! the terminal text of `spec/diagnostics.md` section 4.

mod codes;
mod json;
mod model;
mod render;
mod sink;

pub use codes::Code;
pub use json::{SCHEMA_VERSION, source_object, to_envelope, to_pretty_string, to_report};
pub use model::{
    Diagnostic, HELP_PREFIX, Label, Phase, RuntimePhase, Severity, SuggestedEdit, TextEdit,
};
pub use render::{MAX_LINE_COLUMNS, RenderOptions, render, render_report};
pub use sink::{Diagnostics, MAX_DIAGNOSTICS_PER_FILE, Report, Summary};
