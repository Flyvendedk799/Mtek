//! The shape of the context export (`spec/ai-and-benchmarks.md` section 2, decision 0072).
//!
//! The types serialise to exactly the JSON of `spec/context.schema.json`: camelCase keys in
//! declaration order, so the order of the fields below is part of the format. Nothing here
//! serialises a float, a map or a set; the text is a pure function of the build, the project and
//! the options.

use serde::Serialize;

/// The version of the context format: bumped when a key is removed, renamed or changes meaning
/// (adding a key is also a bump while `spec/context.schema.json` forbids unknown keys).
pub const CONTEXT_FORMAT: u32 = 2;

/// The `schemaGuide` text: how to read a line of `schemas[].fields`. A test checks that the
/// flag letters are the ones [`FieldFlags`](crate::stdlib::FieldFlags) has.
pub const SCHEMA_GUIDE: &str = "A field line reads `name: type = default [flags]`; R required, W writable, B bindable, C construction-only.";

/// The `schemaGuide` text of a cold-start project, whose lines also have a range and the registry's
/// documentation (decision 0110).
pub const SCHEMA_GUIDE_DETAILED: &str = "A field line reads `name: type = default [flags] range R // meaning`. Flags: R required, W writable from handlers, B bindable with bind(..), C construction-only (a constant expression). A field that is not listed does not exist. Function [brackets] mark optional arguments; [handler] means handlers/lifecycle only.";

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
    /// How to read the lines of `schemas`.
    pub schema_guide: &'static str,
    pub schemas: Vec<SchemaEntry>,
    /// What a project with (almost) no code needs to know about the built-in library, generated
    /// from the registry (decision 0110); absent for a project that has code.
    #[serde(skip_serializing_if = "Reference::is_empty")]
    pub reference: Reference,
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
    /// The registry documentation of the schema; only in the context of a cold-start project.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    /// One line per field, `name: type = default [flags]`; in the context of a cold-start project
    /// also `range R` and `// meaning` (see [`SCHEMA_GUIDE`]).
    pub fields: Vec<String>,
}

/// The built-in library for a project that has no code to learn it from (decision 0110), every
/// word of it from the registry. Each list is a section that `--max-bytes` can drop whole.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// Built-in enums with every member.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enums: Vec<EnumEntry>,
    /// What `T`, `I` and `V` stand for in `builtins`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub type_classes: Vec<String>,
    /// Built-in functions, namespace members and accessors, each with its signature.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub builtins: Vec<String>,
    /// Events a handler can subscribe to.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<String>,
    /// Built-in record types.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub records: Vec<String>,
    /// Body commands and readable body properties.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub body: Vec<String>,
    /// Cross-cutting rules (units, colour spaces, time), quoted from the registry's docs.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub conventions: Vec<ConventionEntry>,
}

/// The sections of a [`Reference`], lowest priority first: the order `--max-bytes` drops them in.
pub const REFERENCE_SECTIONS: [&str; 6] = [
    "records",
    "body",
    "events",
    "builtins",
    "conventions",
    "enums",
];

impl Reference {
    /// Whether no section has an item.
    pub fn is_empty(&self) -> bool {
        self.sections().is_empty()
    }

    /// The names of the sections that have items, lowest priority first.
    pub fn sections(&self) -> Vec<&'static str> {
        REFERENCE_SECTIONS
            .into_iter()
            .filter(|name| match *name {
                "records" => !self.records.is_empty(),
                "body" => !self.body.is_empty(),
                "events" => !self.events.is_empty(),
                "builtins" => !self.builtins.is_empty(),
                "conventions" => !self.conventions.is_empty(),
                "enums" => !self.enums.is_empty(),
                _ => false,
            })
            .collect()
    }

    /// Empty the section `name` (and `typeClasses` with `builtins`).
    pub fn clear(&mut self, name: &str) {
        match name {
            "records" => self.records.clear(),
            "body" => self.body.clear(),
            "events" => self.events.clear(),
            "builtins" => {
                self.builtins.clear();
                self.type_classes.clear();
            }
            "conventions" => self.conventions.clear(),
            "enums" => self.enums.clear(),
            _ => {}
        }
    }
}

/// One built-in enum.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EnumEntry {
    pub name: String,
    pub doc: String,
    /// Every member this build implements, as written after `Name.`, separated by one space.
    pub members: String,
}

/// One topic of the conventions: the documentation of the registry items it concerns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConventionEntry {
    pub topic: String,
    /// `item: documentation`, one per registry item.
    pub notes: Vec<String>,
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
    /// Sections of the built-in library (`reference`), by name.
    #[serde(skip_serializing_if = "Dropped::is_empty")]
    pub reference: Dropped,
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
            && self.reference.is_empty()
            && self.schemas.is_empty()
            && self.symbols.is_empty()
    }
}

fn indented_json(value: &impl Serialize) -> String {
    let mut bytes = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b" ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, formatter);
    let _ = value.serialize(&mut serializer);
    String::from_utf8(bytes).unwrap_or_default()
}

/// One-space indentation, except the machine-readable capability list, with a trailing LF.
/// Compact capabilities leave room for the complete cold-start API as builtins grow.
pub fn render(context: &Context) -> String {
    // The derived `Serialize` of these types cannot fail (no maps with non-string keys, no
    // custom serialisers).
    let mut text = indented_json(context);
    let supported = indented_json(&context.supported);
    let expanded = format!("\"supported\": {}", supported.replace('\n', "\n "));
    let compact = format!(
        "\"supported\": {}",
        serde_json::to_string(&context.supported).unwrap_or_default()
    );
    text = text.replacen(&expanded, &compact, 1);
    text.push('\n');
    text
}
