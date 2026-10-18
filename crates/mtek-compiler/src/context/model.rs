//! The shape of the context export (`spec/ai-and-benchmarks.md` section 2, decision 0072).
//!
//! The types serialise to exactly the JSON of `spec/context.schema.json`: camelCase keys in
//! declaration order, so the order of the fields below is part of the format. Nothing here
//! serialises a float, a map or a set; the text is a pure function of the build, the project and
//! the options.

use serde::Serialize;

/// The version of the context format: bumped when a key is removed, renamed or changes meaning
/// (adding a key is also a bump while `spec/context.schema.json` forbids unknown keys).
pub const CONTEXT_FORMAT: u32 = 1;

/// One context document.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub language_version: &'static str,
    pub compiler_version: &'static str,
    pub context_format: u32,
    pub supported: Supported,
    pub syntax: SyntaxSection,
    pub project: ProjectSection,
    pub symbols: Vec<SymbolEntry>,
    pub schemas: Vec<SchemaEntry>,
    pub examples: Vec<ExampleEntry>,
    pub diagnostics_guide: &'static str,
    /// What `--max-bytes` made the export leave out; absent when nothing was left out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<Truncated>,
}

/// What the build implements and what it rejects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Supported {
    pub features: Vec<String>,
    pub not_supported: Vec<String>,
}

/// The syntax in brief.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SyntaxSection {
    pub keywords: Vec<String>,
    pub precedence: Vec<String>,
    pub rules: Vec<String>,
}

/// The project the context was made for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProjectSection {
    /// The entry module, relative to the project root.
    pub entry: String,
    /// The entry scene; `null` if the project selects none (`E9006`).
    pub scene: Option<String>,
    /// Every module of the project, in load order, relative to the project root.
    pub modules: Vec<String>,
}

/// One declaration of the project.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SymbolEntry {
    /// The declaration names from the module item down, joined by `.` (`Demo.Cube.speed`).
    pub name: String,
    /// `scene`, `entity`, `prefab`, `material`, `struct`, `fn`, `cpu_fn`, `const`, `state`,
    /// `param`, or the keyword of a scene object (`camera`).
    pub kind: String,
    /// The type as written, or a short description for a declaration without one.
    #[serde(rename = "type")]
    pub ty: String,
    /// The documentation comment (`///` lines joined by a line feed), or `""`.
    pub doc: String,
    /// The module, relative to the project root.
    pub file: String,
    /// The 1-based line the declaration starts on.
    pub line: u32,
}

/// One registry schema, with the fields this build implements.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SchemaEntry {
    pub name: String,
    pub fields: Vec<FieldEntry>,
}

/// One field of a schema.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FieldEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    /// The default as canonical source text; `null` for a field without one.
    pub default: Option<String>,
    /// Some of `R` (required), `W` (writable from handlers), `B` (bindable), `C`
    /// (construction-only), in that order; `""` for none.
    pub flags: String,
}

/// A complete program that `mtek check` accepts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ExampleEntry {
    pub title: String,
    pub source: String,
}

/// The most names `truncated` keeps per section, so that dropping a long list stays short.
pub const MAX_DROPPED_NAMES: usize = 16;

/// What one section lost.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Dropped {
    /// How many items were left out.
    pub count: usize,
    /// The names of the first [`MAX_DROPPED_NAMES`] of them, lowest priority first.
    pub names: Vec<String>,
}

impl Dropped {
    /// Record that `name` was left out.
    pub fn push(&mut self, name: String) {
        self.count += 1;
        if self.names.len() < MAX_DROPPED_NAMES {
            self.names.push(name);
        }
    }

    /// Whether nothing was left out.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
}

/// What was dropped to fit `--max-bytes`, by section; a section that lost nothing is absent.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Truncated {
    /// Examples, by title.
    #[serde(skip_serializing_if = "Dropped::is_empty")]
    pub examples: Dropped,
    /// Symbols one reference away from the requested ones, by name.
    #[serde(skip_serializing_if = "Dropped::is_empty")]
    pub neighbours: Dropped,
    /// Schemas, by name.
    #[serde(skip_serializing_if = "Dropped::is_empty")]
    pub schemas: Dropped,
    /// The requested symbols (or the entry scene's declarations), by name.
    #[serde(skip_serializing_if = "Dropped::is_empty")]
    pub symbols: Dropped,
}

impl Truncated {
    /// Whether nothing was dropped.
    pub fn is_empty(&self) -> bool {
        self.examples.is_empty()
            && self.neighbours.is_empty()
            && self.schemas.is_empty()
            && self.symbols.is_empty()
    }
}

/// The text of a context: two-space indentation, a trailing line feed, LF line endings.
pub fn render(context: &Context) -> String {
    // The derived `Serialize` of these types cannot fail (no maps with non-string keys, no
    // custom serialisers).
    let mut text = serde_json::to_string_pretty(context).unwrap_or_default();
    text.push('\n');
    text
}
