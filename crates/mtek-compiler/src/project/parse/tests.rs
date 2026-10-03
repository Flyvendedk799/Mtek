//! Tests of `mtek.toml` parsing and validation.

use super::*;
use crate::project::config::*;

const MINIMAL: &str = "[project]\nname = \"pulse-cube\"\nlanguage = \"0.1\"\n";

fn parse(text: &str) -> (Option<ProjectConfig>, Vec<Diagnostic>) {
    let mut diagnostics = Diagnostics::new();
    let config = parse_config(text, &mut diagnostics);
    (config, diagnostics.finish().diagnostics)
}

fn valid(text: &str) -> ProjectConfig {
    let (config, diagnostics) = parse(text);
    assert!(
        diagnostics.is_empty(),
        "unexpected diagnostics: {diagnostics:#?}"
    );
    config.unwrap()
}

/// Exactly one diagnostic, an `E9001`; returns its message and location note.
fn invalid(text: &str) -> (String, String) {
    let (config, diagnostics) = parse(text);
    assert!(
        config.is_none(),
        "an invalid file must not yield a configuration"
    );
    assert_eq!(
        diagnostics.len(),
        1,
        "expected one diagnostic: {diagnostics:#?}"
    );
    let d = &diagnostics[0];
    assert_eq!(d.code, Code::E9001);
    assert!(d.primary.is_none());
    let location = d.notes.last().cloned().unwrap_or_default();
    (d.message.clone(), location)
}

fn p(s: &str) -> ProjectPath {
    ProjectPath::new(s).unwrap()
}

// ---- defaults and valid files ----------------------------------------

#[test]
fn a_minimal_file_takes_every_default() {
    let config = valid(MINIMAL);
    assert_eq!(config.project.name, "pulse-cube");
    assert_eq!(config.project.language, "0.1");
    assert_eq!(config.project.entry, p("src/main.mtek"));
    assert_eq!(config.project.scene, None);
    assert_eq!(config.build.target, BuildTarget::Web);
    assert_eq!(config.build.out_dir, p("dist"));
    assert_eq!(
        config.build.title, "pulse-cube",
        "the title defaults to the name"
    );
    assert!(config.host_inputs.is_empty());
    assert_eq!(config.runtime, RuntimeSection::default());
    assert_eq!(config.runtime.fixed_step, 0.016_666_668);
    assert_eq!(config.runtime.max_catch_up_steps, 4);
    assert_eq!(config.runtime.max_frame_delta, 0.1);
    assert_eq!(config.runtime.max_entities, 16_384);
    assert!(config.runtime.pause_when_hidden);
    assert_eq!(config.dev.port, 5173);
    assert_eq!(config.assets.max_file_bytes, 67_108_864);
}

#[test]
fn the_default_constants_match_the_specification() {
    assert_eq!(DEFAULT_ENTRY, "src/main.mtek");
    assert_eq!(DEFAULT_OUT_DIR, "dist");
    assert_eq!(DEFAULT_FIXED_STEP, 0.016_666_668);
    assert_eq!(DEFAULT_MAX_CATCH_UP_STEPS, 4);
    assert_eq!(DEFAULT_MAX_FRAME_DELTA, 0.1);
    assert_eq!(DEFAULT_MAX_ENTITIES, 16_384);
    assert_eq!(DEFAULT_DEV_PORT, 5173);
    assert_eq!(DEFAULT_MAX_ASSET_FILE_BYTES, 64 * 1024 * 1024);
    // `constant_path` falls back to the root only for invalid text.
    for text in [DEFAULT_ENTRY, DEFAULT_OUT_DIR, PROJECT_FILE] {
        assert_eq!(ProjectPath::new(text), Ok(constant_path(text)));
        assert!(!constant_path(text).is_root());
    }
}

#[test]
fn the_specification_example_is_valid_except_for_host_inputs() {
    // `spec/tooling.md` section 3, host inputs removed.
    let text = r#"
[project]
name = "pulse-cube"
language = "0.1"
entry = "src/main.mtek"
scene = "Demo"

[build]
target = "web"
out_dir = "dist"
title = "Pulse Cube"

[runtime]
fixed_step = 0.016666668
max_catch_up_steps = 4
max_frame_delta = 0.1
max_entities = 16384
pause_when_hidden = true

[dev]
port = 5173

[assets]
max_file_bytes = 67108864
"#;
    let config = valid(text);
    assert_eq!(config.project.scene.as_deref(), Some("Demo"));
    assert_eq!(config.build.title, "Pulse Cube");
    assert_eq!(config.runtime, RuntimeSection::default());
    assert_eq!(config.dev, DevSection::default());
    assert_eq!(config.assets, AssetsSection::default());
}

#[test]
fn every_key_can_be_set() {
    let text = r#"
[project]
name = "a-1"
language = "0.1"
entry = "game/./start.mtek"
scene = "_Main2"
[build]
target = "web"
out_dir = "out/web"
title = "My Title"
[runtime]
fixed_step = 0.02
max_catch_up_steps = 8
max_frame_delta = 0.25
max_entities = 100
pause_when_hidden = false
[dev]
port = 8080
[assets]
max_file_bytes = 1024
"#;
    let c = valid(text);
    assert_eq!(c.project.entry, p("game/start.mtek"), "entry is normalised");
    assert_eq!(c.project.scene.as_deref(), Some("_Main2"));
    assert_eq!(c.build.out_dir, p("out/web"));
    assert_eq!(c.build.title, "My Title");
    assert_eq!(c.runtime.fixed_step, 0.02);
    assert_eq!(c.runtime.max_catch_up_steps, 8);
    assert_eq!(c.runtime.max_frame_delta, 0.25);
    assert_eq!(c.runtime.max_entities, 100);
    assert!(!c.runtime.pause_when_hidden);
    assert_eq!(c.dev.port, 8080);
    assert_eq!(c.assets.max_file_bytes, 1024);
}

#[test]
fn range_bounds_are_inclusive() {
    for (key, value) in [
        ("fixed_step", "1.0"),
        ("fixed_step", "1"),
        ("fixed_step", "1e-9"),
        ("max_frame_delta", "1"),
        ("max_catch_up_steps", "1"),
        ("max_catch_up_steps", "1000"),
        ("max_entities", "1"),
        ("max_entities", "1048576"),
    ] {
        valid(&format!("{MINIMAL}[runtime]\n{key} = {value}\n"));
    }
    valid(&format!("{MINIMAL}[dev]\nport = 1\n"));
    valid(&format!("{MINIMAL}[dev]\nport = 65535\n"));
    valid(&format!("{MINIMAL}[assets]\nmax_file_bytes = 1\n"));
    valid(&format!("{MINIMAL}[assets]\nmax_file_bytes = 4294967295\n"));
}

#[test]
fn dotted_keys_inline_tables_and_integer_forms_are_accepted() {
    let text = "project = { name = \"x\", language = \"0.1\" }\nruntime.max_entities = 0x10\n";
    let c = valid(text);
    assert_eq!(c.project.name, "x");
    assert_eq!(c.runtime.max_entities, 16);
    let c = valid(&format!("{MINIMAL}[runtime]\nmax_entities = 1_000\n"));
    assert_eq!(c.runtime.max_entities, 1000);
}

#[test]
fn a_byte_order_mark_is_ignored() {
    let text = format!("\u{FEFF}{MINIMAL}");
    assert_eq!(valid(&text).project.name, "pulse-cube");
    // Positions are those of the file as stored: the mark is not a column.
    let (message, location) = invalid("\u{FEFF}[project]\nname = 3\nlanguage = \"0.1\"\n");
    assert!(message.contains("'project.name'"));
    assert_eq!(location, "at mtek.toml:2:8");
}

// ---- invalid TOML ----------------------------------------------------

#[test]
fn invalid_toml_is_e9001_with_a_location() {
    let (message, location) = invalid("[project\nname = 1\n");
    assert!(
        message.starts_with("Invalid project configuration: mtek.toml is not valid TOML ("),
        "{message}"
    );
    assert!(location.starts_with("at mtek.toml:1:"), "{location}");
}

#[test]
fn duplicate_keys_are_invalid_toml() {
    let (message, location) = invalid(&format!("{MINIMAL}name = \"again\"\n"));
    assert!(message.contains("not valid TOML"), "{message}");
    assert_eq!(location, "at mtek.toml:4:1");
}

#[test]
fn hostile_input_is_an_error_not_a_panic() {
    let deep_arrays = format!("a = {}{}", "[".repeat(100_000), "]".repeat(100_000));
    let deep_tables = format!("a = {}", "{ b = ".repeat(50_000));
    for text in [
        deep_arrays.as_str(),
        deep_tables.as_str(),
        "\0",
        "[project]\nname = \"\u{0}\"",
        "\u{FEFF}\u{FEFF}[project]",
        "[[project]]\n[project]",
        "project.name = 1\n[project]",
    ] {
        let (config, diagnostics) = parse(text);
        assert!(config.is_none());
        assert!(
            diagnostics.iter().all(|d| d.code == Code::E9001) && !diagnostics.is_empty(),
            "{diagnostics:#?}"
        );
    }
}

// ---- unknown tables and keys ------------------------------------------

#[test]
fn an_unknown_key_is_named_by_its_path_with_help() {
    let (config, diagnostics) = parse(&format!("{MINIMAL}[runtime]\nmax_catchup_steps = 4\n"));
    assert!(config.is_none());
    assert_eq!(diagnostics.len(), 1);
    let d = &diagnostics[0];
    assert_eq!(d.code, Code::E9001);
    assert_eq!(
        d.message,
        "Invalid project configuration: unknown key 'runtime.max_catchup_steps' in mtek.toml."
    );
    assert_eq!(
        d.notes,
        [
            "help: did you mean 'runtime.max_catch_up_steps'?",
            "help: valid keys: fixed_step, max_catch_up_steps, max_frame_delta, max_entities, pause_when_hidden",
            "at mtek.toml:5:1",
        ]
    );
}

#[test]
fn an_unknown_table_is_named_by_its_path() {
    let (config, diagnostics) = parse(&format!("{MINIMAL}[runtim]\nmax_entities = 4\n"));
    assert!(config.is_none());
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        diagnostics[0].message,
        "Invalid project configuration: unknown table 'runtim' in mtek.toml."
    );
    assert_eq!(diagnostics[0].notes[0], "help: did you mean 'runtime'?");
    assert_eq!(
        diagnostics[0].notes[1],
        "help: valid tables: project, build, host, runtime, dev, assets"
    );
    assert_eq!(diagnostics[0].notes[2], "at mtek.toml:4:2");
}

#[test]
fn a_dependency_table_is_unknown() {
    // `spec/tooling.md`: there is no dependency table in v0.1.
    let (message, _) = invalid(&format!("{MINIMAL}[dependencies]\nphysics = \"1\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: unknown table 'dependencies' in mtek.toml."
    );
}

#[test]
fn a_key_in_the_wrong_table_gets_a_pointer() {
    // `name` before the first table header is a root key.
    let (config, diagnostics) = parse(&format!("name = \"x\"\n{MINIMAL}"));
    assert!(config.is_none());
    let unknown: Vec<&Diagnostic> = diagnostics
        .iter()
        .filter(|d| d.message.contains("unknown key 'name'"))
        .collect();
    assert_eq!(unknown.len(), 1, "{diagnostics:#?}");
    assert_eq!(
        unknown[0].notes[0],
        "help: 'name' belongs in the [project] table"
    );
}

#[test]
fn unknown_keys_inside_host_and_dev_are_reported() {
    let (message, _) = invalid(&format!("{MINIMAL}[host]\nouputs = 1\n"));
    assert_eq!(
        message,
        "Invalid project configuration: unknown key 'host.ouputs' in mtek.toml."
    );
    let (message, _) = invalid(&format!("{MINIMAL}[host.output]\nx = 1\n"));
    assert_eq!(
        message,
        "Invalid project configuration: unknown table 'host.output' in mtek.toml."
    );
    let (message, _) = invalid(&format!("{MINIMAL}[dev]\nhost = \"0.0.0.0\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: unknown key 'dev.host' in mtek.toml."
    );
}

#[test]
fn no_suggestion_when_two_candidates_are_equally_close() {
    assert_eq!(
        closest("max_entitie", &["max_entities", "max_entitiex"]),
        None
    );
    assert_eq!(closest("nam", &["name", "language"]), Some("name"));
    assert_eq!(closest("zzzzzz", &["name"]), None);
}

#[test]
fn edit_distance_is_levenshtein() {
    assert_eq!(edit_distance("", ""), 0);
    assert_eq!(edit_distance("abc", ""), 3);
    assert_eq!(edit_distance("", "abc"), 3);
    assert_eq!(edit_distance("kitten", "sitting"), 3);
    assert_eq!(edit_distance("port", "port"), 0);
    assert_eq!(edit_distance("ünï", "uni"), 2);
}

// ---- wrong types ------------------------------------------------------

#[test]
fn wrong_types_name_the_key_path_and_both_types() {
    // (toml, key path, expected type, found type)
    let cases: [(&str, &str, &str, &str); 17] = [
        (
            "[project]\nname = 3\nlanguage = \"0.1\"\n",
            "project.name",
            "string",
            "integer",
        ),
        (
            "[project]\nname = \"a\"\nlanguage = 0.1\n",
            "project.language",
            "string",
            "float",
        ),
        (
            "[project]\nname = \"a\"\nlanguage = \"0.1\"\nentry = true\n",
            "project.entry",
            "string",
            "boolean",
        ),
        (
            "[project]\nname = \"a\"\nlanguage = \"0.1\"\nscene = [\"A\"]\n",
            "project.scene",
            "string",
            "array",
        ),
        ("[build]\ntarget = 1", "build.target", "string", "integer"),
        ("[build]\nout_dir = {}", "build.out_dir", "string", "table"),
        (
            "[build]\ntitle = 1979-05-27",
            "build.title",
            "string",
            "date-time",
        ),
        (
            "[runtime]\nfixed_step = \"fast\"",
            "runtime.fixed_step",
            "number",
            "string",
        ),
        (
            "[runtime]\nmax_catch_up_steps = 4.5",
            "runtime.max_catch_up_steps",
            "integer",
            "float",
        ),
        (
            "[runtime]\nmax_frame_delta = false",
            "runtime.max_frame_delta",
            "number",
            "boolean",
        ),
        (
            "[runtime]\nmax_entities = \"many\"",
            "runtime.max_entities",
            "integer",
            "string",
        ),
        (
            "[runtime]\npause_when_hidden = 1",
            "runtime.pause_when_hidden",
            "boolean",
            "integer",
        ),
        ("[dev]\nport = \"5173\"", "dev.port", "integer", "string"),
        (
            "[assets]\nmax_file_bytes = 1.5",
            "assets.max_file_bytes",
            "integer",
            "float",
        ),
        (
            "[host.inputs]\ntint = 1",
            "host.inputs.tint",
            "string",
            "integer",
        ),
        ("[host]\ninputs = \"x\"", "host.inputs", "table", "string"),
        (
            "[host.inputs]\n\"a b\" = true",
            "host.inputs.\"a b\"",
            "string",
            "boolean",
        ),
    ];
    for (extra, path, expected, found) in cases {
        let text = if extra.starts_with("[project]") {
            extra.to_owned()
        } else {
            format!("{MINIMAL}{extra}\n")
        };
        let (config, diagnostics) = parse(&text);
        assert!(config.is_none(), "{text}");
        assert_eq!(diagnostics.len(), 1, "{text}: {diagnostics:#?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E9001, "{text}");
        assert!(
            d.message.contains(&format!("'{path}' must be ")),
            "{text}: {}",
            d.message
        );
        assert_eq!(d.expected.as_deref(), Some(expected), "{text}");
        assert_eq!(d.actual.as_deref(), Some(found), "{text}");
    }
}

#[test]
fn a_wrong_type_message_is_a_complete_sentence_with_a_location() {
    let (message, location) = invalid(&format!("{MINIMAL}[runtime]\nmax_catch_up_steps = \"4\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: 'runtime.max_catch_up_steps' must be an integer, found a string."
    );
    assert_eq!(location, "at mtek.toml:5:22");
}

#[test]
fn a_table_where_a_value_is_expected_and_the_reverse() {
    let (message, _) = invalid("project = 1\n");
    assert_eq!(
        message,
        "Invalid project configuration: 'project' must be a table, found an integer."
    );
    // `[[dev]]` is an array of tables.
    let (message, _) = invalid(&format!("{MINIMAL}[[dev]]\nport = 1\n"));
    assert_eq!(
        message,
        "Invalid project configuration: 'dev' must be a table, found an array."
    );
}

// ---- ranges -----------------------------------------------------------

#[test]
fn out_of_range_values_name_the_key_the_accepted_range_and_the_value() {
    const SECONDS: &str = "a number greater than 0 and at most 1";
    // (toml, key path, accepted, found as written)
    let cases: [(&str, &str, &str, &str); 18] = [
        (
            "[runtime]\nfixed_step = 0.0",
            "runtime.fixed_step",
            SECONDS,
            "0.0",
        ),
        (
            "[runtime]\nfixed_step = -0.5",
            "runtime.fixed_step",
            SECONDS,
            "-0.5",
        ),
        (
            "[runtime]\nfixed_step = 1.5",
            "runtime.fixed_step",
            SECONDS,
            "1.5",
        ),
        (
            "[runtime]\nfixed_step = nan",
            "runtime.fixed_step",
            SECONDS,
            "nan",
        ),
        (
            "[runtime]\nfixed_step = inf",
            "runtime.fixed_step",
            SECONDS,
            "inf",
        ),
        (
            "[runtime]\nfixed_step = 0",
            "runtime.fixed_step",
            SECONDS,
            "0",
        ),
        (
            "[runtime]\nmax_frame_delta = 2",
            "runtime.max_frame_delta",
            SECONDS,
            "2",
        ),
        (
            "[runtime]\nmax_catch_up_steps = 0",
            "runtime.max_catch_up_steps",
            "an integer from 1 to 1000",
            "0",
        ),
        (
            "[runtime]\nmax_catch_up_steps = 1001",
            "runtime.max_catch_up_steps",
            "an integer from 1 to 1000",
            "1001",
        ),
        (
            "[runtime]\nmax_catch_up_steps = -1",
            "runtime.max_catch_up_steps",
            "an integer from 1 to 1000",
            "-1",
        ),
        (
            "[runtime]\nmax_entities = 0",
            "runtime.max_entities",
            "an integer from 1 to 1048576",
            "0",
        ),
        (
            "[runtime]\nmax_entities = 1048577",
            "runtime.max_entities",
            "an integer from 1 to 1048576",
            "1048577",
        ),
        (
            "[dev]\nport = 0",
            "dev.port",
            "an integer from 1 to 65535",
            "0",
        ),
        (
            "[dev]\nport = 65536",
            "dev.port",
            "an integer from 1 to 65535",
            "65536",
        ),
        (
            "[assets]\nmax_file_bytes = 0",
            "assets.max_file_bytes",
            "an integer from 1 to 4294967295",
            "0",
        ),
        (
            "[assets]\nmax_file_bytes = 4294967296",
            "assets.max_file_bytes",
            "an integer from 1 to 4294967295",
            "4294967296",
        ),
        // Beyond 64 bits: the TOML parser keeps the digits, the range check rejects them.
        (
            "[runtime]\nmax_entities = 99999999999999999999999999999999999999999",
            "runtime.max_entities",
            "an integer from 1 to 1048576",
            "99999999999999999999999999999999999999999",
        ),
        (
            "[runtime]\nmax_entities = 0x0",
            "runtime.max_entities",
            "an integer from 1 to 1048576",
            "0x0",
        ),
    ];
    for (extra, path, accepted, found) in cases {
        let text = format!("{MINIMAL}{extra}\n");
        let (config, diagnostics) = parse(&text);
        assert!(config.is_none(), "{text}");
        assert_eq!(diagnostics.len(), 1, "{text}: {diagnostics:#?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E9001, "{text}");
        assert_eq!(
            d.message,
            format!("Invalid project configuration: '{path}' must be {accepted}, found {found}."),
            "{text}"
        );
        assert_eq!(d.expected.as_deref(), Some(accepted), "{text}");
        assert_eq!(d.actual.as_deref(), Some(found), "{text}");
        let location = d.notes.last().cloned().unwrap_or_default();
        assert!(location.starts_with("at mtek.toml:5:"), "{location}");
    }
}

// ---- project.* ---------------------------------------------------------

#[test]
fn the_language_must_equal_the_compilers() {
    let (config, diagnostics) = parse("[project]\nname = \"a\"\nlanguage = \"0.2\"\n");
    assert!(config.is_none());
    assert_eq!(diagnostics.len(), 1);
    let d = &diagnostics[0];
    assert_eq!(
        d.message,
        "Invalid project configuration: 'project.language' is \"0.2\", but this compiler implements language \"0.1\"."
    );
    assert_eq!(d.expected.as_deref(), Some("\"0.1\""));
    assert_eq!(d.actual.as_deref(), Some("\"0.2\""));
    assert_eq!(d.notes, ["at mtek.toml:3:12"]);
    for bad in ["\"0.1.0\"", "\"1\"", "\"\"", "\" 0.1\""] {
        let (message, _) = invalid(&format!("[project]\nname = \"a\"\nlanguage = {bad}\n"));
        assert!(message.contains("'project.language' is"), "{message}");
    }
}

#[test]
fn the_name_must_match_the_pattern() {
    for good in ["a", "0", "a-b-1", "-", "pulse-cube", "x9"] {
        valid(&format!(
            "[project]\nname = \"{good}\"\nlanguage = \"0.1\"\n"
        ));
    }
    for bad in [
        "",
        "Pulse",
        "pulse cube",
        "pulse_cube",
        "pulse.cube",
        "pulsé",
        "a/b",
        "A",
    ] {
        let (message, location) = invalid(&format!(
            "[project]\nname = \"{bad}\"\nlanguage = \"0.1\"\n"
        ));
        assert!(
            message.starts_with(
                "Invalid project configuration: 'project.name' must be a non-empty name of lowercase letters, digits and hyphens ([a-z0-9-]+), found "
            ),
            "{bad:?}: {message}"
        );
        assert_eq!(location, "at mtek.toml:2:8");
    }
}

#[test]
fn required_keys_and_tables_must_be_present() {
    let (message, location) = invalid("");
    assert_eq!(
        message,
        "Invalid project configuration: required table 'project' is missing from mtek.toml."
    );
    assert_eq!(location, "at mtek.toml:1:1");

    let (message, location) = invalid("\n[project]\nlanguage = \"0.1\"\n");
    assert_eq!(
        message,
        "Invalid project configuration: required key 'project.name' is missing from mtek.toml."
    );
    assert_eq!(location, "at mtek.toml:2:1");

    let (message, _) = invalid("[project]\nname = \"a\"\n");
    assert_eq!(
        message,
        "Invalid project configuration: required key 'project.language' is missing from mtek.toml."
    );
}

#[test]
fn the_entry_must_be_a_project_relative_mtek_file() {
    let entry = |value: &str| {
        let (_, diagnostics) = parse(&format!(
            "[project]\nname = \"a\"\nlanguage = \"0.1\"\nentry = {value}\n"
        ));
        diagnostics
    };
    for bad in [
        "\"\"",
        "\"src\\\\main.mtek\"",
        "\"/abs/main.mtek\"",
        "\"C:/x/main.mtek\"",
        "\"../main.mtek\"",
        "\"src//main.mtek\"",
        "\"src/\"",
        "\"src/main.txt\"",
        "\"src/main\"",
        "\"src/.mtek\"",
        "\".\"",
    ] {
        let diagnostics = entry(bad);
        assert_eq!(diagnostics.len(), 1, "{bad}: {diagnostics:#?}");
        assert_eq!(diagnostics[0].code, Code::E9001, "{bad}");
        assert!(
            diagnostics[0]
                .message
                .starts_with("Invalid project configuration: 'project.entry' must be a "),
            "{bad}: {}",
            diagnostics[0].message
        );
    }
    assert!(entry("\"main.mtek\"").is_empty());
    assert!(entry("\"./a/../b/c.mtek\"").is_empty());
}

#[test]
fn the_entry_message_names_the_reason() {
    let (message, _) =
        invalid("[project]\nname = \"a\"\nlanguage = \"0.1\"\nentry = \"../x.mtek\"\n");
    assert_eq!(
        message,
        "Invalid project configuration: 'project.entry' must be a path inside the project using '/' separators (path escapes the project root), found \"../x.mtek\"."
    );
    let (message, _) =
        invalid("[project]\nname = \"a\"\nlanguage = \"0.1\"\nentry = \"src/main.txt\"\n");
    assert_eq!(
        message,
        "Invalid project configuration: 'project.entry' must be a path to a source file ending in .mtek, found \"src/main.txt\"."
    );
}

#[test]
fn the_scene_must_be_an_identifier() {
    let scene = |value: &str| {
        parse(&format!(
            "[project]\nname = \"a\"\nlanguage = \"0.1\"\nscene = {value}\n"
        ))
    };
    for good in ["\"Demo\"", "\"_x\"", "\"Scene2\"", "\"a_b_C\""] {
        let (config, diagnostics) = scene(good);
        assert!(diagnostics.is_empty(), "{good}");
        assert!(config.unwrap().project.scene.is_some());
    }
    for bad in [
        "\"\"",
        "\"2Fast\"",
        "\"My Scene\"",
        "\"a-b\"",
        "\"Démo\"",
        "\"A.B\"",
    ] {
        let (config, diagnostics) = scene(bad);
        assert!(config.is_none(), "{bad}");
        assert_eq!(diagnostics.len(), 1, "{bad}");
        assert!(
            diagnostics[0].message.starts_with(
                "Invalid project configuration: 'project.scene' must be the name of a scene"
            ),
            "{bad}: {}",
            diagnostics[0].message
        );
    }
}

// ---- build.* -----------------------------------------------------------

#[test]
fn only_the_web_target_exists() {
    let (message, _) = invalid(&format!("{MINIMAL}[build]\ntarget = \"native\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: 'build.target' must be \"web\" (the only build target in v0.1), found \"native\"."
    );
    assert_eq!(
        valid(&format!("{MINIMAL}[build]\ntarget = \"web\"\n"))
            .build
            .target,
        BuildTarget::Web
    );
    assert_eq!(BuildTarget::Web.as_str(), "web");
}

#[test]
fn out_dir_is_a_project_relative_path() {
    let (message, _) = invalid(&format!("{MINIMAL}[build]\nout_dir = \"/tmp/out\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: 'build.out_dir' must be a path inside the project using '/' separators (path is absolute), found \"/tmp/out\"."
    );
    let (message, _) = invalid(&format!("{MINIMAL}[build]\nout_dir = \".\"\n"));
    assert!(
        message.contains("'build.out_dir' must be a path inside the project"),
        "{message}"
    );
}

#[test]
fn out_dir_must_not_contain_the_entry() {
    let (message, location) = invalid(&format!("{MINIMAL}[build]\nout_dir = \"src\"\n"));
    assert_eq!(
        message,
        "Invalid project configuration: 'build.out_dir' (\"src\") contains the entry file 'src/main.mtek', which a build would overwrite."
    );
    assert_eq!(location, "at mtek.toml:5:11");
    // Only whole path segments count.
    valid(&format!("{MINIMAL}[build]\nout_dir = \"sr\"\n"));
    valid(&format!("{MINIMAL}[build]\nout_dir = \"src/out\"\n"));
}

// ---- host.inputs -------------------------------------------------------

#[test]
fn host_inputs_are_parsed_kept_and_reported_as_not_implemented() {
    let (config, diagnostics) = parse(&format!(
        "{MINIMAL}[host.inputs]\ntint = \"Demo.tint\"\nspeed = \"Demo.speed\"\n"
    ));
    let config = config.unwrap();
    let kept: Vec<(&str, &str)> = config
        .host_inputs
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(
        kept,
        [("speed", "Demo.speed"), ("tint", "Demo.tint")],
        "sorted by name"
    );
    assert_eq!(diagnostics.len(), 1);
    let d = &diagnostics[0];
    assert_eq!(d.code, Code::E9010);
    assert_eq!(
        d.message,
        "The [host.inputs] table is specified for v0.1 but not implemented by this compiler build yet."
    );
    assert!(
        d.notes
            .contains(&"host inputs declared here: speed, tint".to_owned())
    );
    assert!(
        d.notes
            .last()
            .is_some_and(|n| n.starts_with("at mtek.toml:"))
    );
}

#[test]
fn an_empty_host_inputs_table_is_fine() {
    let c = valid(&format!("{MINIMAL}[host.inputs]\n"));
    assert!(c.host_inputs.is_empty());
    let c = valid(&format!("{MINIMAL}[host]\n"));
    assert!(c.host_inputs.is_empty());
}

#[test]
fn invalid_host_inputs_do_not_also_report_e9010() {
    let (config, diagnostics) = parse(&format!("{MINIMAL}[host.inputs]\ntint = 1\n"));
    assert!(config.is_none());
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, Code::E9001);
}

// ---- several problems, ordering ----------------------------------------

#[test]
fn every_problem_is_reported_in_file_order() {
    let text = "\
[project]
name = \"Bad Name\"
language = \"0.2\"
bogus = 1

[runtime]
max_entities = 0
fixed_step = \"x\"

[dev]
port = 70000
";
    let (config, diagnostics) = parse(text);
    assert!(config.is_none());
    let found: Vec<(&str, &str)> = diagnostics
        .iter()
        .map(|d| (d.code.short(), d.notes.last().map_or("", String::as_str)))
        .collect();
    assert_eq!(
        found,
        [
            ("E9001", "at mtek.toml:2:8"),
            ("E9001", "at mtek.toml:3:12"),
            ("E9001", "at mtek.toml:4:1"),
            ("E9001", "at mtek.toml:7:16"),
            ("E9001", "at mtek.toml:8:14"),
            ("E9001", "at mtek.toml:11:8"),
        ]
    );
}

#[test]
fn the_result_does_not_depend_on_key_order() {
    let a = "[runtime]\nmax_entities = 5\nfixed_step = 0.5\n[project]\nlanguage = \"0.1\"\nname = \"x\"\n";
    let b = "[project]\nname = \"x\"\nlanguage = \"0.1\"\n[runtime]\nfixed_step = 0.5\nmax_entities = 5\n";
    assert_eq!(valid(a), valid(b));
}

#[test]
fn child_paths_quote_keys_that_are_not_bare() {
    assert_eq!(child_path("", "project"), "project");
    assert_eq!(child_path("host.inputs", "tint"), "host.inputs.tint");
    assert_eq!(child_path("host.inputs", "a b"), "host.inputs.\"a b\"");
    assert_eq!(child_path("host.inputs", "a.b"), "host.inputs.\"a.b\"");
    assert_eq!(child_path("x", "q\"uote\\"), "x.\"q\\\"uote\\\\\"");
    assert_eq!(child_path("x", "tab\t"), "x.\"tab\\u0009\"");
    assert_eq!(child_path("x", ""), "x.\"\"");
    assert_eq!(child_path("", "ünï"), "\"ünï\"");
}

#[test]
fn articles_agree_with_the_noun() {
    assert_eq!(with_article("integer"), "an integer");
    assert_eq!(with_article("array"), "an array");
    assert_eq!(with_article("string"), "a string");
    assert_eq!(with_article("date-time"), "a date-time");
    assert_eq!(with_article("table"), "a table");
}
