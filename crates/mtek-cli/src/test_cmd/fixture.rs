//! The fixture files of `mtek test`: `tests/*.test.toml` (`spec/tooling.md` section 6, decisions
//! 0021 and 0074).
//!
//! [`discover`] lists the fixtures of a project and [`parse`] reads one. A fixture is read in full
//! before anything runs: every problem of the file is reported with its line, and a fixture with a
//! problem is never sent to the browser (it counts as failed). The vocabulary is closed: a step
//! that is not one of the seven below, a key that a step does not take and a value of the wrong
//! kind are all problems, so a fixture is never half understood.

use std::fs;
use std::path::Path;

use mtek_compiler::stdlib::registry;
use serde_json::{Value, json};
use toml::Spanned;
use toml::de::{DeTable, DeValue};

/// The width and the height of the render target of `mtek test` (decision 0021 item 2).
pub const RENDER_TARGET: u32 = 128;
/// The tolerance of `expect_pixel` when the fixture gives none (decision 0021 item 2).
pub const DEFAULT_PIXEL_TOLERANCE: u8 = 2;
/// The absolute tolerance of a numeric `expect_state` entry when the fixture gives none (decision 0074).
pub const DEFAULT_STATE_TOLERANCE: f64 = 1e-5;
/// The most frames one `step` may run.
pub const MAX_FRAMES: u32 = 1_000_000;
/// The suffix of a fixture file.
pub const SUFFIX: &str = ".test.toml";
/// The directory of a project that holds its fixtures.
pub const DIRECTORY: &str = "tests";

/// What one `expect_state` entry compares the state with.
#[derive(Clone, Debug, PartialEq)]
pub enum Expected {
    /// A number, with its absolute tolerance.
    Number(f64, f64),
    /// A vector (`vec2`, `vec3`, `vec4`, `quat`), compared per component with the tolerance.
    Vector(Vec<f64>, f64),
    /// A boolean, compared exactly.
    Bool(bool),
    /// A string, compared exactly, or a `#rrggbb[aa]` colour for a state of type `color`.
    Text(String),
}

/// What one `expect_counter` entry demands of a counter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Bounds {
    /// Exactly this value.
    Exactly(f64),
    /// At least `min` and at most `max` (either may be absent), both inclusive.
    Between(Option<f64>, Option<f64>),
}

/// One step of a fixture.
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    /// `{ step = N, dt = SECONDS }`: `N` frames of `SECONDS` each on the manual clock.
    Frames { frames: u32, dt: f64 },
    /// `{ press = "Space" }`
    Press(String),
    /// `{ release = "Space" }`
    Release(String),
    /// `{ set_input = { name = value } }`
    SetInput { name: String, value: Value },
    /// `{ expect_state = { name = value, .. } }`
    ExpectState(Vec<(String, Expected)>),
    /// `{ expect_pixel = { x, y, color, tolerance } }`
    ExpectPixel {
        x: u32,
        y: u32,
        color: [u8; 3],
        tolerance: u8,
    },
    /// `{ expect_counter = { name = value, .. } }`
    ExpectCounter(Vec<(String, Bounds)>),
}

impl Step {
    /// The key of the step in the fixture.
    #[cfg(test)]
    fn kind(&self) -> &'static str {
        match self {
            Step::Frames { .. } => "step",
            Step::Press(_) => "press",
            Step::Release(_) => "release",
            Step::SetInput { .. } => "set_input",
            Step::ExpectState(_) => "expect_state",
            Step::ExpectPixel { .. } => "expect_pixel",
            Step::ExpectCounter(_) => "expect_counter",
        }
    }

    /// Whether the step asserts something.
    fn asserts(&self) -> bool {
        matches!(
            self,
            Step::ExpectState(_) | Step::ExpectPixel { .. } | Step::ExpectCounter(_)
        )
    }

    /// The step as the runner receives it (`tests/browser/support/mtek-test/plan.ts`).
    pub fn to_json(&self, line: usize) -> Value {
        let mut step = match self {
            Step::Frames { frames, dt } => json!({ "kind": "step", "frames": frames, "dt": dt }),
            Step::Press(code) => json!({ "kind": "press", "code": code }),
            Step::Release(code) => json!({ "kind": "release", "code": code }),
            Step::SetInput { name, value } => {
                json!({ "kind": "set_input", "name": name, "value": value })
            }
            Step::ExpectState(entries) => {
                let entries: Vec<Value> = entries
                    .iter()
                    .map(|(name, expected)| {
                        let (value, tolerance) = match expected {
                            Expected::Number(value, tolerance) => (json!(value), json!(tolerance)),
                            Expected::Vector(values, tolerance) => {
                                (json!(values), json!(tolerance))
                            }
                            Expected::Bool(value) => (json!(value), Value::Null),
                            Expected::Text(value) => (json!(value), Value::Null),
                        };
                        json!({ "name": name, "expected": value, "tolerance": tolerance })
                    })
                    .collect();
                json!({ "kind": "expect_state", "entries": entries })
            }
            Step::ExpectPixel {
                x,
                y,
                color,
                tolerance,
            } => json!({
                "kind": "expect_pixel",
                "x": x,
                "y": y,
                "color": color,
                "tolerance": tolerance,
            }),
            Step::ExpectCounter(entries) => {
                let entries: Vec<Value> = entries
                    .iter()
                    .map(|(name, bounds)| match bounds {
                        Bounds::Exactly(value) => {
                            json!({ "name": name, "equals": value, "min": null, "max": null })
                        }
                        Bounds::Between(min, max) => {
                            json!({ "name": name, "equals": null, "min": min, "max": max })
                        }
                    })
                    .collect();
                json!({ "kind": "expect_counter", "entries": entries })
            }
        };
        step["line"] = json!(line);
        step
    }
}

/// A step and the line of the fixture file it starts on.
#[derive(Clone, Debug, PartialEq)]
pub struct Located {
    pub line: usize,
    pub step: Step,
}

/// A fixture file that was read without a problem.
#[derive(Clone, Debug, PartialEq)]
pub struct Fixture {
    /// The path relative to the project directory, with `/` as the separator.
    pub file: String,
    pub name: String,
    /// The `random()` seed of the run (`seed` in the file, 0 when absent).
    pub seed: u32,
    pub steps: Vec<Located>,
}

impl Fixture {
    /// The fixture as the runner receives it.
    pub fn to_json(&self) -> Value {
        let steps: Vec<Value> = self
            .steps
            .iter()
            .map(|located| located.step.to_json(located.line))
            .collect();
        json!({ "file": self.file, "name": self.name, "seed": self.seed, "steps": steps })
    }
}

/// A fixture file that has problems (or cannot be read).
#[derive(Clone, Debug, PartialEq)]
pub struct Invalid {
    /// The path relative to the project directory, with `/` as the separator.
    pub file: String,
    /// The `name` of the fixture if it could be read, else the file name.
    pub name: String,
    /// One line per problem: `line N: ...`.
    pub problems: Vec<String>,
}

/// The fixture files `tests/*.test.toml` of the project directory `dir`, sorted by name: the
/// path relative to the project (`tests/x.test.toml`) and the file's full path. Only the
/// directory itself is searched, and only regular files whose names end in `.test.toml`.
///
/// # Errors
/// The text of the I/O error when the directory exists but cannot be listed.
pub fn discover(dir: &Path) -> Result<Vec<(String, std::path::PathBuf)>, String> {
    let tests = dir.join(DIRECTORY);
    let entries = match fs::read_dir(&tests) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("cannot list '{}': {error}", tests.display())),
    };
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("cannot list '{}': {error}", tests.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // Windows file systems are case-insensitive, so the suffix is too there; the spelling is
        // checked as written to keep the rule the same everywhere.
        if name.ends_with(SUFFIX) && name.len() > SUFFIX.len() && entry.path().is_file() {
            found.push((format!("{DIRECTORY}/{name}"), entry.path()));
        }
    }
    found.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    Ok(found)
}

/// Read the fixture file `path` (shown as `file`).
pub fn read(file: &str, path: &Path) -> Result<Fixture, Invalid> {
    match fs::read(path) {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => parse(file, &text),
            Err(_) => Err(Invalid::unreadable(file, "the file is not valid UTF-8")),
        },
        Err(error) => Err(Invalid::unreadable(
            file,
            &format!("cannot read it: {error}"),
        )),
    }
}

impl Invalid {
    fn unreadable(file: &str, problem: &str) -> Invalid {
        Invalid {
            file: file.to_owned(),
            name: file.to_owned(),
            problems: vec![problem.to_owned()],
        }
    }
}

/// Parse the text of the fixture `file`.
pub fn parse(file: &str, text: &str) -> Result<Fixture, Invalid> {
    let body = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut reader = Reader {
        text: body,
        problems: Vec::new(),
    };
    let fixture = match DeTable::parse(body) {
        Ok(document) => reader.fixture(file, document.get_ref()),
        Err(error) => {
            let at = error.span().map_or(0, |span| span.start);
            reader.problem(at, format!("not valid TOML: {}", error.message()));
            None
        }
    };
    match fixture {
        Some(fixture) if reader.problems.is_empty() => Ok(fixture),
        other => {
            let name = other.map_or_else(|| file.to_owned(), |fixture| fixture.name);
            Err(Invalid {
                file: file.to_owned(),
                name,
                problems: reader.problems,
            })
        }
    }
}

/// A value with its position.
type Item<'t> = &'t Spanned<DeValue<'t>>;

fn is_identifier(text: &str) -> bool {
    let mut characters = text.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A key of `expect_state`: a scene state (`speed`), the pose of a named entity (`Cube.position`,
/// `Cube.rotation`) or one of its material parameters (`Cube.material.tint`).
fn valid_state_key(key: &str) -> bool {
    let parts: Vec<&str> = key.split('.').collect();
    match parts.as_slice() {
        [state] => is_identifier(state),
        [entity, "position" | "rotation"] => is_identifier(entity),
        [entity, "material", parameter] => is_identifier(entity) && is_identifier(parameter),
        _ => false,
    }
}

struct Reader<'a> {
    text: &'a str,
    problems: Vec<String>,
}

fn describe(value: &DeValue<'_>) -> &'static str {
    match value {
        DeValue::String(_) => "a string",
        DeValue::Integer(_) => "an integer",
        DeValue::Float(_) => "a float",
        DeValue::Boolean(_) => "a boolean",
        DeValue::Datetime(_) => "a date",
        DeValue::Array(_) => "an array",
        DeValue::Table(_) => "a table",
    }
}

impl Reader<'_> {
    /// The 1-based line of the byte offset `at`.
    fn line(&self, at: usize) -> usize {
        let end = at.min(self.text.len());
        self.text.as_bytes()[..end]
            .iter()
            .filter(|byte| **byte == b'\n')
            .count()
            + 1
    }

    fn problem(&mut self, at: usize, message: String) {
        let line = self.line(at);
        self.problems.push(format!("line {line}: {message}"));
    }

    fn wrong_type(&mut self, what: &str, expected: &str, value: Item<'_>) {
        self.problem(
            value.span().start,
            format!(
                "{what} must be {expected}, found {}",
                describe(value.get_ref())
            ),
        );
    }

    /// An integer within `min..=max`.
    fn integer(&mut self, what: &str, value: Item<'_>, min: i64, max: i64) -> Option<i64> {
        let DeValue::Integer(integer) = value.get_ref() else {
            self.wrong_type(what, "an integer", value);
            return None;
        };
        match i64::from_str_radix(integer.as_str(), integer.radix()) {
            Ok(number) if (min..=max).contains(&number) => Some(number),
            _ => {
                self.problem(
                    value.span().start,
                    format!("{what} must be an integer from {min} to {max}"),
                );
                None
            }
        }
    }

    /// A finite number; an integer is accepted where a float is expected.
    fn number(&mut self, what: &str, value: Item<'_>) -> Option<f64> {
        let number = match value.get_ref() {
            DeValue::Float(float) => float.as_str().parse::<f64>().ok(),
            DeValue::Integer(integer) => i64::from_str_radix(integer.as_str(), integer.radix())
                .ok()
                // Beyond 2^53 an integer is not exact as a float; such a fixture is wrong anyway.
                .map(|n| n as f64),
            _ => {
                self.wrong_type(what, "a number", value);
                return None;
            }
        };
        match number {
            Some(n) if n.is_finite() => Some(n),
            _ => {
                self.problem(
                    value.span().start,
                    format!("{what} must be a finite number"),
                );
                None
            }
        }
    }

    fn string<'t>(&mut self, what: &str, value: Item<'t>) -> Option<&'t str> {
        if let DeValue::String(text) = value.get_ref() {
            Some(text.as_ref())
        } else {
            self.wrong_type(what, "a string", value);
            None
        }
    }

    fn table<'t>(&mut self, what: &str, value: Item<'t>) -> Option<&'t DeTable<'t>> {
        if let DeValue::Table(table) = value.get_ref() {
            Some(table)
        } else {
            self.wrong_type(what, "a table", value);
            None
        }
    }

    /// Report the keys of `table` that are not in `known`; true if there were none.
    fn only_keys(&mut self, what: &str, table: &DeTable<'_>, known: &[&str]) -> bool {
        let mut clean = true;
        for (key, value) in table.iter() {
            let name: &str = key.get_ref().as_ref();
            if !known.contains(&name) {
                clean = false;
                self.problem(
                    value.span().start.min(key.span().start),
                    format!("{what} has no key '{name}' (keys: {})", known.join(", ")),
                );
            }
        }
        clean
    }

    fn fixture(&mut self, file: &str, root: &DeTable<'_>) -> Option<Fixture> {
        self.only_keys("a fixture", root, &["name", "seed", "steps"]);
        let name = match root.get("name") {
            None => {
                self.problem(0, "the key 'name' is missing".to_owned());
                None
            }
            Some(value) => match self.string("'name'", value) {
                Some(text) if !text.trim().is_empty() => Some(text.to_owned()),
                Some(_) => {
                    self.problem(value.span().start, "'name' must not be empty".to_owned());
                    None
                }
                None => None,
            },
        };
        let seed = match root.get("seed") {
            None => 0,
            Some(value) => self
                .integer("'seed'", value, 0, i64::from(u32::MAX))
                .and_then(|seed| u32::try_from(seed).ok())
                .unwrap_or(0),
        };
        let mut steps = Vec::new();
        match root.get("steps") {
            None => self.problem(0, "the key 'steps' is missing".to_owned()),
            Some(value) => {
                if let DeValue::Array(items) = value.get_ref() {
                    for (index, item) in items.iter().enumerate() {
                        let what = format!("step {}", index + 1);
                        if let Some(step) = self.step(&what, item) {
                            steps.push(Located {
                                line: self.line(item.span().start),
                                step,
                            });
                        }
                    }
                    if items.is_empty() {
                        self.problem(value.span().start, "'steps' must not be empty".to_owned());
                    } else if self.problems.is_empty() && !steps.iter().any(|s| s.step.asserts()) {
                        self.problem(
                            value.span().start,
                            "the fixture asserts nothing: it needs an expect_state, expect_pixel or expect_counter step"
                                .to_owned(),
                        );
                    }
                } else {
                    self.wrong_type("'steps'", "an array of steps", value);
                }
            }
        }
        Some(Fixture {
            file: file.to_owned(),
            name: name?,
            seed,
            steps,
        })
    }

    fn step(&mut self, what: &str, item: Item<'_>) -> Option<Step> {
        let table = self.table(what, item)?;
        if table.get("step").is_some() {
            return self.frames(what, item, table);
        }
        let mut keys = table.iter();
        let (Some((key, value)), None) = (keys.next(), keys.next()) else {
            let found: Vec<&str> = table
                .iter()
                .map(|(key, _)| key.get_ref().as_ref())
                .collect();
            self.problem(
                item.span().start,
                format!(
                    "{what} must have exactly one action key (step, press, release, set_input, expect_state, expect_pixel or expect_counter), found {}",
                    if found.is_empty() {
                        "none".to_owned()
                    } else {
                        found.join(", ")
                    }
                ),
            );
            return None;
        };
        let action: &str = key.get_ref().as_ref();
        match action {
            "press" | "release" => {
                let code = self.key_code(&format!("{what} ({action})"), value)?;
                Some(if action == "press" {
                    Step::Press(code)
                } else {
                    Step::Release(code)
                })
            }
            "set_input" => self.set_input(&format!("{what} (set_input)"), value),
            "expect_state" => self.expect_state(&format!("{what} (expect_state)"), value),
            "expect_pixel" => self.expect_pixel(&format!("{what} (expect_pixel)"), value),
            "expect_counter" => self.expect_counter(&format!("{what} (expect_counter)"), value),
            other => {
                self.problem(
                    key.span().start,
                    format!(
                        "{what} is unknown: '{other}' (steps: step, press, release, set_input, expect_state, expect_pixel, expect_counter)"
                    ),
                );
                None
            }
        }
    }

    fn frames(&mut self, what: &str, item: Item<'_>, table: &DeTable<'_>) -> Option<Step> {
        if !self.only_keys(what, table, &["step", "dt"]) {
            return None;
        }
        let frames = table.get("step").and_then(|value| {
            self.integer(&format!("{what}: 'step'"), value, 1, i64::from(MAX_FRAMES))
        });
        let dt = match table.get("dt") {
            None => {
                self.problem(
                    item.span().start,
                    format!("{what} needs 'dt', the seconds of each frame"),
                );
                None
            }
            Some(value) => {
                let dt = self.number(&format!("{what}: 'dt'"), value)?;
                if dt < 0.0 {
                    self.problem(
                        value.span().start,
                        format!("{what}: 'dt' must not be negative"),
                    );
                    None
                } else {
                    Some(dt)
                }
            }
        };
        Some(Step::Frames {
            frames: u32::try_from(frames?).ok()?,
            dt: dt?,
        })
    }

    fn key_code(&mut self, what: &str, value: Item<'_>) -> Option<String> {
        let code = self.string(what, value)?;
        if registry().enum_member_by_code("Key", code).is_none() {
            self.problem(
                value.span().start,
                format!(
                    "{what}: '{code}' is not the KeyboardEvent.code of a Key member (such as \"Space\", \"KeyA\" or \"ArrowUp\")"
                ),
            );
            return None;
        }
        Some(code.to_owned())
    }

    /// A value that `app.setInput` or an `expect_state` entry may carry: a number, a boolean, a
    /// string or an array of numbers.
    fn plain_value(&mut self, what: &str, value: Item<'_>) -> Option<Value> {
        match value.get_ref() {
            DeValue::Boolean(flag) => Some(json!(flag)),
            DeValue::String(text) => Some(json!(text.as_ref())),
            DeValue::Integer(_) | DeValue::Float(_) => Some(json!(self.number(what, value)?)),
            DeValue::Array(items) => {
                if items.is_empty() || items.len() > 16 {
                    self.problem(
                        value.span().start,
                        format!("{what}: an array must hold 1 to 16 numbers"),
                    );
                    return None;
                }
                let mut numbers = Vec::new();
                for item in items {
                    numbers.push(self.number(&format!("{what}: an array element"), item)?);
                }
                Some(json!(numbers))
            }
            _ => {
                self.wrong_type(
                    what,
                    "a number, a boolean, a string or an array of numbers",
                    value,
                );
                None
            }
        }
    }

    fn set_input(&mut self, what: &str, value: Item<'_>) -> Option<Step> {
        let table = self.table(what, value)?;
        let mut entries = table.iter();
        let (Some((name, entry)), None) = (entries.next(), entries.next()) else {
            self.problem(
                value.span().start,
                format!("{what} must have exactly one entry, `name = value`"),
            );
            return None;
        };
        let value = self.plain_value(&format!("{what}: '{}'", name.get_ref()), entry)?;
        Some(Step::SetInput {
            name: name.get_ref().as_ref().to_owned(),
            value,
        })
    }

    fn expect_state(&mut self, what: &str, value: Item<'_>) -> Option<Step> {
        let table = self.table(what, value)?;
        if table.iter().next().is_none() {
            self.problem(value.span().start, format!("{what} must not be empty"));
            return None;
        }
        let mut entries = Vec::new();
        let mut valid = true;
        for (name, entry) in table.iter() {
            let key = name;
            let name = name.get_ref().as_ref();
            if !valid_state_key(name) {
                self.problem(
                    key.span().start,
                    format!(
                        "{what}: '{name}' addresses nothing: use a state name, \"Entity.position\", \"Entity.rotation\" or \"Entity.material.param\""
                    ),
                );
                valid = false;
                continue;
            }
            match self.expected(&format!("{what}: '{name}'"), entry) {
                Some(expected) => entries.push((name.to_owned(), expected)),
                None => valid = false,
            }
        }
        valid.then_some(Step::ExpectState(entries))
    }

    /// `value`, `[x, y, z]`, `{ value = .., tolerance = .. }`.
    fn expected(&mut self, what: &str, entry: Item<'_>) -> Option<Expected> {
        let (value, tolerance) = if let DeValue::Table(table) = entry.get_ref() {
            if table.get("value").is_none() && table.get("tolerance").is_none() {
                // `Cube.rotation = [..]` unquoted is the table `Cube` holding `rotation`.
                self.problem(
                    entry.span().start,
                    format!(
                        "{what} is a table; to address an entity write the key in quotes (\"Cube.rotation\" = [..]), or give `{{ value = .., tolerance = .. }}`"
                    ),
                );
                return None;
            }
            if !self.only_keys(what, table, &["value", "tolerance"]) {
                return None;
            }
            let Some(inner) = table.get("value") else {
                self.problem(
                    entry.span().start,
                    format!("{what} needs 'value' next to 'tolerance'"),
                );
                return None;
            };
            let tolerance = match table.get("tolerance") {
                None => None,
                Some(tolerance) => {
                    let number = self.number(&format!("{what}: 'tolerance'"), tolerance)?;
                    if number < 0.0 {
                        self.problem(
                            tolerance.span().start,
                            format!("{what}: 'tolerance' must not be negative"),
                        );
                        return None;
                    }
                    Some(number)
                }
            };
            (inner, tolerance)
        } else {
            (entry, None)
        };
        let expected = match self.plain_value(what, value)? {
            Value::Bool(flag) => Expected::Bool(flag),
            Value::String(text) => Expected::Text(text),
            Value::Array(numbers) => Expected::Vector(
                numbers.iter().filter_map(Value::as_f64).collect(),
                tolerance.unwrap_or(DEFAULT_STATE_TOLERANCE),
            ),
            number => Expected::Number(
                number.as_f64().unwrap_or_default(),
                tolerance.unwrap_or(DEFAULT_STATE_TOLERANCE),
            ),
        };
        if tolerance.is_some() && matches!(expected, Expected::Bool(_) | Expected::Text(_)) {
            self.problem(
                value.span().start,
                format!("{what}: a tolerance applies to numbers and vectors only"),
            );
            return None;
        }
        Some(expected)
    }

    fn expect_pixel(&mut self, what: &str, value: Item<'_>) -> Option<Step> {
        let table = self.table(what, value)?;
        if !self.only_keys(what, table, &["x", "y", "color", "tolerance"]) {
            return None;
        }
        let max = i64::from(RENDER_TARGET) - 1;
        let coordinate = |reader: &mut Self, axis: &str| match table.get(axis) {
            Some(value) => reader
                .integer(&format!("{what}: '{axis}'"), value, 0, max)
                .and_then(|n| u32::try_from(n).ok()),
            None => {
                reader.problem(value.span().start, format!("{what} needs '{axis}'"));
                None
            }
        };
        let x = coordinate(self, "x");
        let y = coordinate(self, "y");
        let color = match table.get("color") {
            None => {
                self.problem(value.span().start, format!("{what} needs 'color'"));
                None
            }
            Some(color) => self.hex_color(&format!("{what}: 'color'"), color),
        };
        let tolerance = match table.get("tolerance") {
            None => Some(DEFAULT_PIXEL_TOLERANCE),
            Some(tolerance) => self
                .integer(&format!("{what}: 'tolerance'"), tolerance, 0, 255)
                .and_then(|n| u8::try_from(n).ok()),
        };
        Some(Step::ExpectPixel {
            x: x?,
            y: y?,
            color: color?,
            tolerance: tolerance?,
        })
    }

    /// `"#rrggbb"`.
    fn hex_color(&mut self, what: &str, value: Item<'_>) -> Option<[u8; 3]> {
        let text = self.string(what, value)?;
        let digits = text
            .strip_prefix('#')
            .filter(|d| d.len() == 6 && d.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let Some(digits) = digits else {
            self.problem(
                value.span().start,
                format!("{what} must be \"#rrggbb\", found \"{text}\""),
            );
            return None;
        };
        let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
        Some([channel(0)?, channel(2)?, channel(4)?])
    }

    fn expect_counter(&mut self, what: &str, value: Item<'_>) -> Option<Step> {
        let table = self.table(what, value)?;
        if table.iter().next().is_none() {
            self.problem(value.span().start, format!("{what} must not be empty"));
            return None;
        }
        let mut entries = Vec::new();
        let mut valid = true;
        for (name, entry) in table.iter() {
            let name = name.get_ref().as_ref();
            match self.bounds(&format!("{what}: '{name}'"), entry) {
                Some(bounds) => entries.push((name.to_owned(), bounds)),
                None => valid = false,
            }
        }
        valid.then_some(Step::ExpectCounter(entries))
    }

    /// `3` or `{ min = 1, max = 5 }`.
    fn bounds(&mut self, what: &str, entry: Item<'_>) -> Option<Bounds> {
        let DeValue::Table(table) = entry.get_ref() else {
            return Some(Bounds::Exactly(self.number(what, entry)?));
        };
        if !self.only_keys(what, table, &["min", "max"]) {
            return None;
        }
        let min = match table.get("min") {
            Some(value) => Some(self.number(&format!("{what}: 'min'"), value)?),
            None => None,
        };
        let max = match table.get("max") {
            Some(value) => Some(self.number(&format!("{what}: 'max'"), value)?),
            None => None,
        };
        match (min, max) {
            (None, None) => {
                self.problem(
                    entry.span().start,
                    format!("{what} needs 'min', 'max' or both"),
                );
                None
            }
            (Some(min), Some(max)) if min > max => {
                self.problem(
                    entry.span().start,
                    format!("{what}: 'min' must not exceed 'max'"),
                );
                None
            }
            _ => Some(Bounds::Between(min, max)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(text: &str) -> Fixture {
        match parse("tests/a.test.toml", text) {
            Ok(fixture) => fixture,
            Err(invalid) => panic!("{:?}", invalid.problems),
        }
    }

    fn problems(text: &str) -> Vec<String> {
        match parse("tests/a.test.toml", text) {
            Ok(fixture) => panic!("accepted: {fixture:?}"),
            Err(invalid) => invalid.problems,
        }
    }

    /// The fixture of `spec/tooling.md` section 6, as written there.
    const SPEC_EXAMPLE: &str = r##"
name = "space toggles direction"
steps = [
  { step = 60, dt = 0.016666668 },
  { press = "Space" }, { step = 1, dt = 0.016666668 }, { release = "Space" },
  { expect_state = { speed = -0.7 } },
  { expect_pixel = { x = 64, y = 64, color = "#6b5cff", tolerance = 2 } },
]
"##;

    #[test]
    fn the_example_of_the_specification_parses() {
        let fixture = ok(SPEC_EXAMPLE);
        assert_eq!(fixture.name, "space toggles direction");
        assert_eq!(fixture.seed, 0);
        let kinds: Vec<&str> = fixture.steps.iter().map(|s| s.step.kind()).collect();
        assert_eq!(
            kinds,
            [
                "step",
                "press",
                "step",
                "release",
                "expect_state",
                "expect_pixel"
            ]
        );
        assert_eq!(
            fixture.steps[0].step,
            Step::Frames {
                frames: 60,
                dt: 0.016_666_668
            }
        );
        assert_eq!(
            fixture.steps[4].step,
            Step::ExpectState(vec![(
                "speed".to_owned(),
                Expected::Number(-0.7, DEFAULT_STATE_TOLERANCE)
            )])
        );
        assert_eq!(
            fixture.steps[5].step,
            Step::ExpectPixel {
                x: 64,
                y: 64,
                color: [0x6b, 0x5c, 0xff],
                tolerance: 2
            }
        );
        // Lines are those of the file (the text starts with a newline).
        assert_eq!(
            fixture.steps.iter().map(|s| s.line).collect::<Vec<_>>(),
            [4, 5, 5, 5, 6, 7]
        );
    }

    #[test]
    fn every_step_kind_and_its_forms() {
        let fixture = ok(r##"
name = "all"
seed = 166
steps = [
  { set_input = { tint = "#ff8800" } },
  { set_input = { gain = 2 } },
  { set_input = { flag = true } },
  { set_input = { offset = [1.0, 2, 3] } },
  { step = 2, dt = 0 },
  { expect_state = { a = 1, b = [1, 2, 3], c = true, d = "#102030", e = { value = 2.5, tolerance = 0.5 } } },
  { expect_pixel = { x = 0, y = 127, color = "#FFFFFF" } },
  { expect_counter = { drawCalls = 3, culledObjects = { min = 1 }, uploads = { min = 0, max = 4 } } },
]
"##);
        assert_eq!(fixture.seed, 166);
        assert_eq!(
            fixture.steps[0].step,
            Step::SetInput {
                name: "tint".to_owned(),
                value: json!("#ff8800")
            }
        );
        assert_eq!(
            fixture.steps[1].step,
            Step::SetInput {
                name: "gain".to_owned(),
                value: json!(2.0)
            }
        );
        assert_eq!(
            fixture.steps[3].step,
            Step::SetInput {
                name: "offset".to_owned(),
                value: json!([1.0, 2.0, 3.0])
            }
        );
        let Step::ExpectState(entries) = &fixture.steps[5].step else {
            panic!("not expect_state");
        };
        let expected: Vec<(&str, Expected)> = vec![
            ("a", Expected::Number(1.0, DEFAULT_STATE_TOLERANCE)),
            (
                "b",
                Expected::Vector(vec![1.0, 2.0, 3.0], DEFAULT_STATE_TOLERANCE),
            ),
            ("c", Expected::Bool(true)),
            ("d", Expected::Text("#102030".to_owned())),
            ("e", Expected::Number(2.5, 0.5)),
        ];
        assert_eq!(
            entries
                .iter()
                .map(|(name, e)| (name.as_str(), e.clone()))
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(
            fixture.steps[6].step,
            Step::ExpectPixel {
                x: 0,
                y: 127,
                color: [255, 255, 255],
                tolerance: DEFAULT_PIXEL_TOLERANCE
            }
        );
        let Step::ExpectCounter(entries) = &fixture.steps[7].step else {
            panic!("not expect_counter");
        };
        assert_eq!(
            entries,
            &vec![
                ("culledObjects".to_owned(), Bounds::Between(Some(1.0), None)),
                ("drawCalls".to_owned(), Bounds::Exactly(3.0)),
                ("uploads".to_owned(), Bounds::Between(Some(0.0), Some(4.0))),
            ]
        );
    }

    #[test]
    fn expect_state_addresses_entities_with_quoted_keys() {
        let fixture = ok(r##"
name = "entities"
steps = [
  { expect_state = { "Cube.rotation" = [0, 0.5, 0, 0.8], "Cube.position" = { value = [0, 0.5, 0], tolerance = 0.01 }, "Cube.material.tint" = "#6b5cff", "Cube.material.phase" = 1.5 } },
]
"##);
        let Step::ExpectState(entries) = &fixture.steps[0].step else {
            panic!("not expect_state");
        };
        let names: Vec<&str> = entries.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Cube.material.phase",
                "Cube.material.tint",
                "Cube.position",
                "Cube.rotation"
            ]
        );
        assert_eq!(
            entries[2].1,
            Expected::Vector(vec![0.0, 0.5, 0.0], 0.01),
            "a table with value and tolerance"
        );
        for key in ["speed", "a.position", "A_1.rotation", "E.material.p_1"] {
            assert!(valid_state_key(key), "{key}");
        }
        for key in [
            "",
            "1a",
            "a.scale",
            "a.material",
            "a.material.",
            "a.b.c",
            "a.position.x",
            "a b",
            "a-b",
        ] {
            assert!(!valid_state_key(key), "{key}");
        }
    }

    #[test]
    fn an_unquoted_entity_address_gets_a_hint() {
        let found = problems(
            "name = \"x\"\nsteps = [{ expect_state = { Cube.rotation = [0, 0, 0, 1] } }]\n",
        );
        assert!(found.iter().any(|p| p.contains("in quotes")), "{found:?}");
        let found =
            problems("name = \"x\"\nsteps = [{ expect_state = { \"Cube.scale\" = [1, 1, 1] } }]\n");
        assert!(
            found.iter().any(|p| p.contains("addresses nothing")),
            "{found:?}"
        );
    }

    #[test]
    fn the_runner_receives_explicit_tolerances_and_lines() {
        let json = ok(SPEC_EXAMPLE).to_json();
        assert_eq!(json["seed"], 0);
        assert_eq!(
            json["steps"][4],
            json!({
                "kind": "expect_state",
                "entries": [{ "name": "speed", "expected": -0.7, "tolerance": 1e-5 }],
                "line": 6
            })
        );
        assert_eq!(
            json["steps"][5],
            json!({
                "kind": "expect_pixel", "x": 64, "y": 64, "color": [107, 92, 255], "tolerance": 2,
                "line": 7
            })
        );
    }

    #[test]
    fn a_byte_order_mark_and_crlf_are_fine() {
        let text = format!("\u{FEFF}{}", SPEC_EXAMPLE.replace('\n', "\r\n"));
        assert_eq!(ok(&text).steps.len(), 6);
    }

    #[test]
    fn problems_name_their_line() {
        let found = problems(
            r##"name = "x"
steps = [
  { step = 0, dt = 0.1 },
  { jump = "Space" },
  { press = "Hyper" },
  { expect_pixel = { x = 128, y = 0, color = "red" } },
]
"##,
        );
        // Step 4 has two problems: all of a file are reported, not only the first.
        assert_eq!(found.len(), 5, "{found:?}");
        assert!(
            found[0].starts_with("line 3:") && found[0].contains("integer from 1"),
            "{found:?}"
        );
        assert!(
            found[1].starts_with("line 4:") && found[1].contains("'jump'"),
            "{found:?}"
        );
        assert!(
            found[2].starts_with("line 5:") && found[2].contains("Hyper"),
            "{found:?}"
        );
        assert!(
            found[3].starts_with("line 6:")
                && found[3].contains("'x'")
                && found[3].contains("0 to 127"),
            "{found:?}"
        );
        assert!(
            found[4].starts_with("line 6:") && found[4].contains("#rrggbb"),
            "{found:?}"
        );
    }

    #[test]
    fn the_vocabulary_is_closed() {
        let wrap = |step: &str| {
            format!("name = \"x\"\nsteps = [ {step}, {{ expect_counter = {{ a = 1 }} }} ]\n")
        };
        for (step, mention) in [
            ("{ step = 1 }", "'dt'"),
            ("{ step = 1, dt = 0.1, extra = 1 }", "extra"),
            ("{ step = 1, dt = -1 }", "negative"),
            ("{ step = 1.5, dt = 0.1 }", "integer"),
            ("{ step = 1000001, dt = 0.1 }", "1000000"),
            ("{ step = 1, dt = inf }", "finite"),
            ("{ press = 1 }", "string"),
            ("{ press = \"Space\", release = \"Space\" }", "exactly one"),
            ("{}", "exactly one"),
            ("1", "table"),
            ("{ set_input = {} }", "exactly one entry"),
            ("{ set_input = { a = 1, b = 2 } }", "exactly one entry"),
            ("{ set_input = { a = [] } }", "1 to 16"),
            ("{ set_input = { a = { b = 1 } } }", "number"),
            ("{ expect_state = {} }", "empty"),
            ("{ expect_state = { a = { tolerance = 1 } } }", "'value'"),
            ("{ expect_state = { a = { value = 1, x = 1 } } }", "'x'"),
            (
                "{ expect_state = { a = { value = 1, tolerance = -1 } } }",
                "negative",
            ),
            (
                "{ expect_state = { a = { value = true, tolerance = 1 } } }",
                "numbers and vectors",
            ),
            ("{ expect_state = { a = [1, \"b\"] } }", "number"),
            ("{ expect_pixel = { x = 1, y = 1 } }", "'color'"),
            ("{ expect_pixel = { x = 1, color = \"#000000\" } }", "'y'"),
            (
                "{ expect_pixel = { x = 1, y = 1, color = \"#00000\" } }",
                "#rrggbb",
            ),
            (
                "{ expect_pixel = { x = 1, y = 1, color = \"#000000ff\" } }",
                "#rrggbb",
            ),
            (
                "{ expect_pixel = { x = -1, y = 1, color = \"#000000\" } }",
                "0 to 127",
            ),
            (
                "{ expect_pixel = { x = 1, y = 1, color = \"#000000\", tolerance = 256 } }",
                "0 to 255",
            ),
            (
                "{ expect_pixel = { x = 1, y = 1, color = \"#000000\", alpha = 1 } }",
                "alpha",
            ),
            ("{ expect_counter = {} }", "empty"),
            ("{ expect_counter = { a = {} } }", "'min'"),
            (
                "{ expect_counter = { a = { min = 3, max = 1 } } }",
                "exceed",
            ),
            ("{ expect_counter = { a = { equals = 1 } } }", "equals"),
            ("{ expect_counter = { a = \"1\" } }", "number"),
        ] {
            let found = problems(&wrap(step));
            assert!(
                found.iter().any(|p| p.contains(mention)),
                "{step}: {found:?} does not mention {mention}"
            );
        }
    }

    #[test]
    fn the_structure_of_the_file_is_checked() {
        let cases: [(&str, &str); 9] = [
            ("steps = []\n", "'name'"),
            ("name = \"x\"\n", "'steps'"),
            (
                "name = \"\"\nsteps = [{ expect_counter = { a = 1 } }]\n",
                "empty",
            ),
            ("name = \"x\"\nsteps = []\n", "empty"),
            (
                "name = \"x\"\nsteps = [{ step = 1, dt = 0.1 }]\n",
                "asserts nothing",
            ),
            ("name = \"x\"\nsteps = 3\n", "array"),
            (
                "name = \"x\"\nseed = -1\nsteps = [{ expect_counter = { a = 1 } }]\n",
                "'seed'",
            ),
            (
                "name = \"x\"\nsteps = [{ expect_counter = { a = 1 } }]\nextra = 1\n",
                "'extra'",
            ),
            ("name = \"x\"\nsteps = [\n", "not valid TOML"),
        ];
        for (text, mention) in cases {
            let found = problems(text);
            assert!(
                found.iter().any(|p| p.contains(mention)),
                "{text:?}: {found:?} does not mention {mention}"
            );
        }
    }

    #[test]
    fn an_invalid_fixture_keeps_its_name_when_it_can() {
        let invalid = parse("tests/a.test.toml", "name = \"named\"\nsteps = []\n").unwrap_err();
        assert_eq!(invalid.name, "named");
        let invalid = parse("tests/a.test.toml", "steps = []\n").unwrap_err();
        assert_eq!(invalid.name, "tests/a.test.toml");
    }

    #[test]
    fn every_fixture_of_the_benchmark_tasks_parses() {
        // The benchmark fixtures (decision 0021) are written for the same format; they must run
        // under `mtek test` unchanged.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks");
        let mut count = 0;
        for group in ["tasks", "holdout"] {
            let Ok(tasks) = fs::read_dir(root.join(group)) else {
                continue;
            };
            for task in tasks.flatten() {
                let dir = task.path().join("mtek-tests");
                let Ok(files) = fs::read_dir(&dir) else {
                    continue;
                };
                for file in files.flatten() {
                    let path = file.path();
                    if !path.to_string_lossy().ends_with(SUFFIX) {
                        continue;
                    }
                    if let Err(invalid) = read("x.test.toml", &path) {
                        panic!("{}: {:?}", path.display(), invalid.problems);
                    }
                    count += 1;
                }
            }
        }
        assert!(count >= 4, "found only {count} benchmark fixtures");
    }

    #[test]
    fn discovery_lists_test_files_of_the_tests_directory_only() {
        let dir = std::env::temp_dir().join(format!("mtek-cli-fixtures-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(discover(&dir), Ok(Vec::new()), "no directory, no fixtures");
        fs::create_dir_all(dir.join("tests/nested")).unwrap();
        for name in [
            "tests/b.test.toml",
            "tests/a.test.toml",
            "tests/notes.toml",
            "tests/.test.toml",
            "tests/c.test.toml.bak",
            "tests/nested/d.test.toml",
        ] {
            fs::write(dir.join(name), "").unwrap();
        }
        fs::create_dir_all(dir.join("tests/dir.test.toml")).unwrap();
        let found: Vec<String> = discover(&dir)
            .unwrap()
            .into_iter()
            .map(|(file, _)| file)
            .collect();
        assert_eq!(found, ["tests/a.test.toml", "tests/b.test.toml"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_file_is_invalid() {
        let dir =
            std::env::temp_dir().join(format!("mtek-cli-fixture-bytes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("bad.test.toml"), [0xff, 0xfe, 0x00]).unwrap();
        let invalid = read("tests/bad.test.toml", &dir.join("bad.test.toml")).unwrap_err();
        assert!(invalid.problems[0].contains("UTF-8"), "{invalid:?}");
        let invalid = read("tests/none.test.toml", &dir.join("none.test.toml")).unwrap_err();
        assert!(invalid.problems[0].contains("cannot read"), "{invalid:?}");
        let _ = fs::remove_dir_all(&dir);
    }
}
