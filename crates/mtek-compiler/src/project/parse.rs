//! Parsing and validating `mtek.toml` into a [`ProjectConfig`].
//!
//! The TOML text is parsed with `toml::de::DeTable`, which keeps a byte span
//! for every key and value, and then walked by hand instead of deserialised
//! with `serde`: that is what gives every problem its exact key path
//! (`runtime.max_catch_up_steps`) and location, and lets one run report all
//! problems of the file instead of only the first. Every problem is an
//! `E9001` (`spec/tooling.md` section 3), reported without a source location
//! (`mtek.toml` is not a module of the program and has no `FileId`) but with
//! a note that names its line and column.

use std::collections::BTreeMap;
use std::sync::Arc;

use toml::Spanned;
use toml::de::{DeTable, DeValue};

use super::config::{
    AssetsSection, BuildSection, BuildTarget, DEFAULT_ENTRY, DEFAULT_OUT_DIR, DEV_PORT_RANGE,
    DevSection, MAX_ASSET_FILE_BYTES_RANGE, MAX_CATCH_UP_STEPS_RANGE, MAX_ENTITIES_RANGE,
    MAX_TIME_SECONDS, PROJECT_FILE, ProjectConfig, ProjectSection, RuntimeSection,
    SOURCE_EXTENSION, constant_path,
};
use crate::LANGUAGE_VERSION;
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::{LineIndex, ProjectPath};

/// Tables of `mtek.toml` and the keys each accepts. The single source for
/// unknown-key detection and the "valid keys" help.
const SCHEMA: [(&str, &[&str]); 6] = [
    ("project", &["name", "language", "entry", "scene"]),
    ("build", &["target", "out_dir", "title"]),
    ("host", &["inputs"]),
    (
        "runtime",
        &[
            "fixed_step",
            "max_catch_up_steps",
            "max_frame_delta",
            "max_entities",
            "pause_when_hidden",
        ],
    ),
    ("dev", &["port"]),
    ("assets", &["max_file_bytes"]),
];

/// Parse and validate the text of a `mtek.toml`.
///
/// Returns the configuration if the file has no problem. Otherwise every
/// problem is reported as `E9001` (ordered by position in the file) and the
/// result is `None`. A well-formed non-empty `[host.inputs]` table is
/// additionally reported as `E9010` (it is parsed and kept in the result, but
/// the feature arrives with M3).
///
/// A leading byte-order mark is ignored; byte offsets in the notes are not
/// reported, only lines and columns of the file as stored.
pub fn parse_config(text: &str, diagnostics: &mut Diagnostics) -> Option<ProjectConfig> {
    let (bom_len, body) = match text.strip_prefix('\u{FEFF}') {
        Some(rest) => (text.len() - rest.len(), rest),
        None => (0, text),
    };
    let mut validator = Validator {
        lines: LineIndex::new(Arc::from(text)),
        bom_len,
        problems: Vec::new(),
    };
    let config = match DeTable::parse(body) {
        Ok(document) => validator.document(document.get_ref()),
        Err(error) => {
            let at = error.span().map_or(0, |span| span.start);
            validator.problem(
                at,
                Diagnostic::new(
                    Code::E9001,
                    format!(
                        "Invalid project configuration: {PROJECT_FILE} is not valid TOML ({}).",
                        error.message()
                    ),
                ),
            );
            None
        }
    };
    let mut problems = validator.problems;
    // Unknown keys are problems too, although the rest of the file may be
    // valid: a configuration is only returned if there is no `E9001`.
    let invalid = problems.iter().any(|(_, d)| d.code == Code::E9001);
    // Stable: problems at the same position keep the order they were found in.
    problems.sort_by_key(|(at, _)| *at);
    diagnostics.extend(problems.into_iter().map(|(_, diagnostic)| diagnostic));
    config.filter(|_| !invalid)
}

struct Validator {
    lines: LineIndex,
    /// Length of the byte-order mark the parser did not see (0 or 3).
    bom_len: usize,
    /// `(byte offset in the parsed text, diagnostic)`.
    problems: Vec<(usize, Diagnostic)>,
}

/// A value together with its position, as the parser hands it out.
type Item<'t> = &'t Spanned<DeValue<'t>>;

/// A sub-table of the document.
enum Section<'t> {
    Absent,
    /// Present with the wrong type (already reported).
    Invalid,
    /// The table and the byte offset where it starts.
    Present(&'t DeTable<'t>, usize),
}

impl Validator {
    // ---- reporting -------------------------------------------------------

    /// Record `diagnostic` for the byte `at` of the parsed text and add the
    /// line and column to it.
    fn problem(&mut self, at: usize, diagnostic: Diagnostic) {
        let offset = u32::try_from(at + self.bom_len).unwrap_or(u32::MAX);
        let position = self.lines.line_col(offset);
        let note = format!("at {PROJECT_FILE}:{}:{}", position.line, position.column);
        self.problems.push((at, diagnostic.note(note)));
    }

    /// The text of `value` as written in the file.
    fn written(&self, value: Item<'_>) -> String {
        let span = value.span();
        self.lines
            .text()
            .get(span.start + self.bom_len..span.end + self.bom_len)
            .unwrap_or_default()
            .trim()
            .to_owned()
    }

    fn invalid(&mut self, at: usize, message: String) {
        self.problem(at, Diagnostic::new(Code::E9001, message));
    }

    fn wrong_type(&mut self, path: &str, value: Item<'_>, expected: &'static str) {
        let found = describe(value.get_ref());
        let diagnostic = Diagnostic::new(
            Code::E9001,
            format!(
                "Invalid project configuration: '{path}' must be {}, found {}.",
                with_article(expected),
                with_article(found)
            ),
        )
        .expected(expected)
        .actual(found);
        self.problem(value.span().start, diagnostic);
    }

    /// `value` has the right type but is not an accepted value.
    fn out_of_range(&mut self, path: &str, value: Item<'_>, accepted: &str, found: &str) {
        let diagnostic = Diagnostic::new(
            Code::E9001,
            format!("Invalid project configuration: '{path}' must be {accepted}, found {found}."),
        )
        .expected(accepted)
        .actual(found);
        self.problem(value.span().start, diagnostic);
    }

    fn missing(&mut self, path: &str, kind: &str, at: usize) {
        self.invalid(
            at,
            format!("Invalid project configuration: required {kind} '{path}' is missing from {PROJECT_FILE}."),
        );
    }

    // ---- value readers ---------------------------------------------------
    //
    // Each reader reports its problem itself and returns `None` for it.

    fn table<'t>(&mut self, path: &str, value: Item<'t>) -> Option<&'t DeTable<'t>> {
        match value.get_ref() {
            DeValue::Table(table) => Some(table),
            _ => {
                self.wrong_type(path, value, "table");
                None
            }
        }
    }

    fn string<'t>(&mut self, path: &str, value: Item<'t>) -> Option<&'t str> {
        match value.get_ref() {
            DeValue::String(text) => Some(text.as_ref()),
            _ => {
                self.wrong_type(path, value, "string");
                None
            }
        }
    }

    fn boolean(&mut self, path: &str, value: Item<'_>) -> Option<bool> {
        match value.get_ref() {
            DeValue::Boolean(flag) => Some(*flag),
            _ => {
                self.wrong_type(path, value, "boolean");
                None
            }
        }
    }

    /// An integer within `min..=max`.
    fn integer(&mut self, path: &str, value: Item<'_>, (min, max): (i128, i128)) -> Option<i128> {
        let DeValue::Integer(integer) = value.get_ref() else {
            self.wrong_type(path, value, "integer");
            return None;
        };
        match i128::from_str_radix(integer.as_str(), integer.radix()) {
            Ok(number) if (min..=max).contains(&number) => Some(number),
            // Out of range, including beyond even 128 bits (the TOML parser
            // keeps the digits of any integer; reading it as a 64-bit value
            // is the consumer's job).
            _ => {
                let found = self.written(value);
                self.out_of_range(
                    path,
                    value,
                    &format!("an integer from {min} to {max}"),
                    &found,
                );
                None
            }
        }
    }

    fn integer_u32(&mut self, path: &str, value: Item<'_>, (min, max): (u32, u32)) -> Option<u32> {
        let number = self.integer(path, value, (i128::from(min), i128::from(max)))?;
        u32::try_from(number).ok()
    }

    /// A finite number greater than zero and at most [`MAX_TIME_SECONDS`]. An
    /// integer is accepted where a float is expected (`max_frame_delta = 1`).
    fn seconds(&mut self, path: &str, value: Item<'_>) -> Option<f64> {
        let number = match value.get_ref() {
            DeValue::Float(float) => float.as_str().parse::<f64>().ok(),
            DeValue::Integer(integer) => i128::from_str_radix(integer.as_str(), integer.radix())
                .ok()
                .map(|n| n as f64),
            _ => {
                self.wrong_type(path, value, "number");
                return None;
            }
        };
        match number {
            Some(n) if n.is_finite() && n > 0.0 && n <= MAX_TIME_SECONDS => Some(n),
            _ => {
                let found = self.written(value);
                self.out_of_range(
                    path,
                    value,
                    &format!("a number greater than 0 and at most {MAX_TIME_SECONDS}"),
                    &found,
                );
                None
            }
        }
    }

    // ---- structure -------------------------------------------------------

    /// Fetch the optional entry `key` of `table`, validate it with `read` and
    /// fall back to `default` when it is absent. `None` means "present but
    /// invalid" (already reported).
    fn field<'t, T>(
        &mut self,
        table: &'t DeTable<'t>,
        path: &str,
        key: &str,
        default: impl FnOnce() -> T,
        read: impl FnOnce(&mut Self, &str, Item<'t>) -> Option<T>,
    ) -> Option<T> {
        match table.get(key) {
            None => Some(default()),
            Some(value) => read(self, &child_path(path, key), value),
        }
    }

    /// Like [`Self::field`] for a required key; `at` is where the problem is
    /// located when the key is missing.
    fn required<'t, T>(
        &mut self,
        table: &'t DeTable<'t>,
        path: &str,
        key: &str,
        at: usize,
        read: impl FnOnce(&mut Self, &str, Item<'t>) -> Option<T>,
    ) -> Option<T> {
        let key_path = child_path(path, key);
        match table.get(key) {
            None => {
                self.missing(&key_path, "key", at);
                None
            }
            Some(value) => read(self, &key_path, value),
        }
    }

    /// Report keys of `table` that are not in `known` (a table or a key as
    /// the message says), with help naming the valid keys.
    fn reject_unknown(&mut self, table: &DeTable<'_>, path: &str, known: &[&str]) {
        for (key, value) in table.iter() {
            let name: &str = key.get_ref().as_ref();
            if known.contains(&name) {
                continue;
            }
            let full = child_path(path, name);
            let what = if matches!(value.get_ref(), DeValue::Table(_)) {
                "table"
            } else {
                "key"
            };
            let mut diagnostic = Diagnostic::new(
                Code::E9001,
                format!(
                    "Invalid project configuration: unknown {what} '{full}' in {PROJECT_FILE}."
                ),
            );
            if let Some(suggestion) = closest(name, known) {
                diagnostic =
                    diagnostic.help(format!("did you mean '{}'?", child_path(path, suggestion)));
            } else if let Some(table_name) = owning_table(name) {
                diagnostic =
                    diagnostic.help(format!("'{name}' belongs in the [{table_name}] table"));
            }
            let valid = if path.is_empty() { "tables" } else { "keys" };
            diagnostic = diagnostic.help(format!("valid {valid}: {}", known.join(", ")));
            self.problem(key.span().start, diagnostic);
        }
    }

    /// Fetch the optional sub-table `key` of `table` and check its keys against
    /// the schema.
    fn section<'t>(&mut self, table: &'t DeTable<'t>, key: &str) -> Section<'t> {
        let Some(value) = table.get(key) else {
            return Section::Absent;
        };
        let Some(inner) = self.table(key, value) else {
            return Section::Invalid;
        };
        let known = SCHEMA
            .iter()
            .find(|(name, _)| *name == key)
            .map_or(&[][..], |(_, keys)| *keys);
        self.reject_unknown(inner, key, known);
        Section::Present(inner, value.span().start)
    }

    fn document(&mut self, root: &DeTable<'_>) -> Option<ProjectConfig> {
        let known: Vec<&str> = SCHEMA.iter().map(|(name, _)| *name).collect();
        self.reject_unknown(root, "", &known);

        let project_table = self.section(root, "project");
        let build_table = self.section(root, "build");
        let host_table = self.section(root, "host");
        let runtime_table = self.section(root, "runtime");
        let dev_table = self.section(root, "dev");
        let assets_table = self.section(root, "assets");

        let project = match project_table {
            Section::Present(table, at) => self.project(table, at),
            Section::Absent => {
                self.missing("project", "table", 0);
                None
            }
            Section::Invalid => None,
        };
        // An absent optional table behaves like an empty one: every key takes
        // its default.
        let empty = DeTable::new();
        let build = match build_table {
            Section::Present(table, _) => self.build(table),
            Section::Absent => self.build(&empty),
            Section::Invalid => None,
        };
        let host_inputs = match host_table {
            Section::Present(table, _) => self.host(table),
            Section::Absent => Some(BTreeMap::new()),
            Section::Invalid => None,
        };
        let runtime = match runtime_table {
            Section::Present(table, _) => self.runtime(table),
            Section::Absent => Some(RuntimeSection::default()),
            Section::Invalid => None,
        };
        let dev = match dev_table {
            Section::Present(table, _) => self.dev(table),
            Section::Absent => Some(DevSection::default()),
            Section::Invalid => None,
        };
        let assets = match assets_table {
            Section::Present(table, _) => self.assets(table),
            Section::Absent => Some(AssetsSection::default()),
            Section::Invalid => None,
        };

        let (project, build) = (project?, build?);
        let host_inputs = host_inputs?;
        let (runtime, dev, assets) = (runtime?, dev?, assets?);
        let build = self.finish_build(build, &project, root)?;
        Some(ProjectConfig {
            project,
            build,
            host_inputs,
            runtime,
            dev,
            assets,
        })
    }

    fn project(&mut self, table: &DeTable<'_>, at: usize) -> Option<ProjectSection> {
        let name = self.required(table, "project", "name", at, Self::project_name);
        let language = self.required(table, "project", "language", at, Self::language);
        let entry = self.field(
            table,
            "project",
            "entry",
            || constant_path(DEFAULT_ENTRY),
            Self::source_path,
        );
        let scene = self.field(
            table,
            "project",
            "scene",
            || None,
            |s, path, value| s.scene_name(path, value).map(Some),
        );
        Some(ProjectSection {
            name: name?,
            language: language?,
            entry: entry?,
            scene: scene?,
        })
    }

    fn project_name(&mut self, path: &str, value: Item<'_>) -> Option<String> {
        let name = self.string(path, value)?;
        let valid = !name.is_empty()
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !valid {
            self.out_of_range(
                path,
                value,
                "a non-empty name of lowercase letters, digits and hyphens ([a-z0-9-]+)",
                &format!("{name:?}"),
            );
            return None;
        }
        Some(name.to_owned())
    }

    fn language(&mut self, path: &str, value: Item<'_>) -> Option<String> {
        let language = self.string(path, value)?;
        if language != LANGUAGE_VERSION {
            let diagnostic = Diagnostic::new(
                Code::E9001,
                format!(
                    "Invalid project configuration: '{path}' is {language:?}, but this compiler implements language {LANGUAGE_VERSION:?}."
                ),
            )
            .expected(format!("{LANGUAGE_VERSION:?}"))
            .actual(format!("{language:?}"));
            self.problem(value.span().start, diagnostic);
            return None;
        }
        Some(language.to_owned())
    }

    /// A project-relative path with `/` separators.
    fn relative_path(&mut self, path: &str, value: Item<'_>) -> Option<ProjectPath> {
        let text = self.string(path, value)?;
        match ProjectPath::new(text) {
            Ok(parsed) => Some(parsed),
            Err(error) => {
                self.out_of_range(
                    path,
                    value,
                    &format!("a path inside the project using '/' separators ({error})"),
                    &format!("{text:?}"),
                );
                None
            }
        }
    }

    /// `project.entry`: a project-relative path to a `.mtek` file.
    fn source_path(&mut self, path: &str, value: Item<'_>) -> Option<ProjectPath> {
        let parsed = self.relative_path(path, value)?;
        let is_source = parsed.file_name().is_some_and(|name| {
            name.len() > SOURCE_EXTENSION.len() && name.ends_with(SOURCE_EXTENSION)
        });
        if !is_source {
            self.out_of_range(
                path,
                value,
                &format!("a path to a source file ending in {SOURCE_EXTENSION}"),
                &format!("{:?}", parsed.as_str()),
            );
            return None;
        }
        Some(parsed)
    }

    fn scene_name(&mut self, path: &str, value: Item<'_>) -> Option<String> {
        let name = self.string(path, value)?;
        let mut chars = name.chars();
        let valid = chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid {
            self.out_of_range(
                path,
                value,
                "the name of a scene (an identifier: letters, digits and underscores, not starting with a digit)",
                &format!("{name:?}"),
            );
            return None;
        }
        Some(name.to_owned())
    }

    fn build(&mut self, table: &DeTable<'_>) -> Option<PartialBuild> {
        let target = self.field(
            table,
            "build",
            "target",
            || BuildTarget::Web,
            Self::build_target,
        );
        let out_dir = self.field(
            table,
            "build",
            "out_dir",
            || constant_path(DEFAULT_OUT_DIR),
            Self::relative_path,
        );
        let title = self.field(
            table,
            "build",
            "title",
            || None,
            |s, path, value| s.string(path, value).map(|text| Some(text.to_owned())),
        );
        let out_dir_at = table.get("out_dir").map(|value| value.span().start);
        Some(PartialBuild {
            target: target?,
            out_dir: out_dir?,
            out_dir_at,
            title: title?,
        })
    }

    fn build_target(&mut self, path: &str, value: Item<'_>) -> Option<BuildTarget> {
        let target = self.string(path, value)?;
        if target == BuildTarget::Web.as_str() {
            Some(BuildTarget::Web)
        } else {
            self.out_of_range(
                path,
                value,
                "\"web\" (the only build target in v0.1)",
                &format!("{target:?}"),
            );
            None
        }
    }

    /// Checks that need values of several tables: the output directory must
    /// not contain the entry module (a build would overwrite or delete the
    /// sources), and the title defaults to the project name.
    fn finish_build(
        &mut self,
        build: PartialBuild,
        project: &ProjectSection,
        root: &DeTable<'_>,
    ) -> Option<BuildSection> {
        let prefix = format!("{}/", build.out_dir.as_str());
        if project.entry.as_str().starts_with(&prefix) {
            let at = build
                .out_dir_at
                .or_else(|| root.get("build").map(|value| value.span().start))
                .unwrap_or(0);
            self.invalid(
                at,
                format!(
                    "Invalid project configuration: 'build.out_dir' ({:?}) contains the entry file '{}', which a build would overwrite.",
                    build.out_dir.as_str(),
                    project.entry
                ),
            );
            return None;
        }
        Some(BuildSection {
            target: build.target,
            out_dir: build.out_dir,
            title: build.title.unwrap_or_else(|| project.name.clone()),
        })
    }

    fn host(&mut self, table: &DeTable<'_>) -> Option<BTreeMap<String, String>> {
        let Some(inputs) = table.get("inputs") else {
            return Some(BTreeMap::new());
        };
        let inputs_table = self.table("host.inputs", inputs)?;
        let mut parsed = BTreeMap::new();
        let mut valid = true;
        for (key, value) in inputs_table.iter() {
            let name: &str = key.get_ref().as_ref();
            match self.string(&child_path("host.inputs", name), value) {
                Some(target) => {
                    parsed.insert(name.to_owned(), target.to_owned());
                }
                None => valid = false,
            }
        }
        if valid && !parsed.is_empty() {
            // Host inputs are parsed and kept, but nothing consumes them
            // before M3 (`spec/tooling.md` section 3, task M1-07). This
            // report goes away with M3.
            let names: Vec<&str> = parsed.keys().map(String::as_str).collect();
            self.problem(
                inputs.span().start,
                Diagnostic::new(
                    Code::E9010,
                    "The [host.inputs] table is specified for v0.1 but not implemented by this compiler build yet.",
                )
                .note(format!("host inputs declared here: {}", names.join(", ")))
                .help("remove the [host.inputs] table until host inputs are supported (milestone M3)"),
            );
        }
        valid.then_some(parsed)
    }

    fn runtime(&mut self, table: &DeTable<'_>) -> Option<RuntimeSection> {
        let defaults = RuntimeSection::default();
        let fixed_step = self.field(
            table,
            "runtime",
            "fixed_step",
            || defaults.fixed_step,
            Self::seconds,
        );
        let max_catch_up_steps = self.field(
            table,
            "runtime",
            "max_catch_up_steps",
            || defaults.max_catch_up_steps,
            |s, path, value| s.integer_u32(path, value, MAX_CATCH_UP_STEPS_RANGE),
        );
        let max_frame_delta = self.field(
            table,
            "runtime",
            "max_frame_delta",
            || defaults.max_frame_delta,
            Self::seconds,
        );
        let max_entities = self.field(
            table,
            "runtime",
            "max_entities",
            || defaults.max_entities,
            |s, path, value| s.integer_u32(path, value, MAX_ENTITIES_RANGE),
        );
        let pause_when_hidden = self.field(
            table,
            "runtime",
            "pause_when_hidden",
            || defaults.pause_when_hidden,
            Self::boolean,
        );
        Some(RuntimeSection {
            fixed_step: fixed_step?,
            max_catch_up_steps: max_catch_up_steps?,
            max_frame_delta: max_frame_delta?,
            max_entities: max_entities?,
            pause_when_hidden: pause_when_hidden?,
        })
    }

    fn dev(&mut self, table: &DeTable<'_>) -> Option<DevSection> {
        let port = self.field(
            table,
            "dev",
            "port",
            || DevSection::default().port,
            |s, path, value| {
                let (min, max) = DEV_PORT_RANGE;
                let number = s.integer(path, value, (i128::from(min), i128::from(max)))?;
                u16::try_from(number).ok()
            },
        );
        Some(DevSection { port: port? })
    }

    fn assets(&mut self, table: &DeTable<'_>) -> Option<AssetsSection> {
        let max_file_bytes = self.field(
            table,
            "assets",
            "max_file_bytes",
            || AssetsSection::default().max_file_bytes,
            |s, path, value| {
                let (min, max) = MAX_ASSET_FILE_BYTES_RANGE;
                let number = s.integer(path, value, (i128::from(min), i128::from(max)))?;
                u64::try_from(number).ok()
            },
        );
        Some(AssetsSection {
            max_file_bytes: max_file_bytes?,
        })
    }
}

/// `[build]` before the cross-table checks of [`Validator::finish_build`].
struct PartialBuild {
    target: BuildTarget,
    out_dir: ProjectPath,
    out_dir_at: Option<usize>,
    title: Option<String>,
}

/// `parent.key`, with the key quoted if it is not a TOML bare key; just `key`
/// at the top level.
fn child_path(parent: &str, key: &str) -> String {
    let bare = !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    let key = if bare {
        key.to_owned()
    } else {
        let mut quoted = String::from("\"");
        for c in key.chars() {
            match c {
                '"' => quoted.push_str("\\\""),
                '\\' => quoted.push_str("\\\\"),
                c if c.is_control() => quoted.push_str(&format!("\\u{:04X}", u32::from(c))),
                c => quoted.push(c),
            }
        }
        quoted.push('"');
        quoted
    };
    if parent.is_empty() {
        key
    } else {
        format!("{parent}.{key}")
    }
}

/// The TOML type of a value, singular, for messages.
fn describe(value: &DeValue<'_>) -> &'static str {
    match value {
        DeValue::String(_) => "string",
        DeValue::Integer(_) => "integer",
        DeValue::Float(_) => "float",
        DeValue::Boolean(_) => "boolean",
        DeValue::Datetime(_) => "date-time",
        DeValue::Array(_) => "array",
        DeValue::Table(_) => "table",
    }
}

fn with_article(noun: &str) -> String {
    let article = if noun.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    };
    format!("{article} {noun}")
}

/// The table that has a key called `key`, for keys written at the top level
/// by mistake.
fn owning_table(key: &str) -> Option<&'static str> {
    SCHEMA
        .iter()
        .find(|(_, keys)| keys.contains(&key))
        .map(|(table, _)| *table)
}

/// The single candidate within edit distance 2 of `name`, if there is exactly
/// one closest candidate.
fn closest<'a>(name: &str, candidates: &[&'a str]) -> Option<&'a str> {
    let mut best: Option<(usize, &'a str)> = None;
    let mut tie = false;
    for &candidate in candidates {
        let distance = edit_distance(name, candidate);
        if distance > 2 {
            continue;
        }
        match best {
            Some((d, _)) if distance > d => {}
            Some((d, _)) if distance == d => tie = true,
            _ => {
                best = Some((distance, candidate));
                tie = false;
            }
        }
    }
    if tie { None } else { best.map(|(_, c)| c) }
}

/// Levenshtein distance over characters.
fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            let cost = usize::from(ca != *cb);
            row[j + 1] = (diagonal + cost).min(above + 1).min(row[j] + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests;
