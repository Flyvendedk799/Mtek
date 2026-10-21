//! The context export (`mtek context`, decision 0072): what it says is derived from the build,
//! its examples compile, its neighbourhoods and truncation follow the documented order, and its
//! text is deterministic, valid against `spec/context.schema.json`, and pinned by goldens.
//!
//! The goldens are `tests/context/golden/*.json`. To regenerate after an intended change:
//! `MTEK_BLESS=1 cargo test -p mtek-compiler --test context`.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use mtek_compiler::check;
use mtek_compiler::context::capabilities::{
    derive, derive_for, feature_name, phrased_codes, prelude_feature, unsupported_phrase,
};
use mtek_compiler::context::examples::{LIBRARY, MAX_EXAMPLES, features_of};
use mtek_compiler::context::syntax_info::{RULES, keywords, precedence};
use mtek_compiler::context::{
    CONTEXT_FORMAT, ContextError, ContextOptions, ContextOutput, DEFAULT_MAX_BYTES,
    DIAGNOSTICS_GUIDE, context, used_features,
};
use mtek_compiler::diagnostics::Code;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::gate::{HARD_GATES, NON_CONSTANT_INITIAL_VALUES};
use mtek_compiler::resolve::{Construct, IMPLEMENTED_MILESTONE, PreludeItem};
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::stdlib::{Milestone, Registry, export_schema_json, registry};
use mtek_compiler::syntax::RESERVED_WORDS;
use serde_json::Value;

const TOML: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn repo(path: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

fn mem(files: &[(&str, &str)]) -> MemFs {
    let mut fs = MemFs::new();
    for (path, text) in files {
        fs.insert(ProjectPath::new(path).unwrap(), text.as_bytes().to_vec());
    }
    fs
}

/// A project whose only module is `main`.
fn project(main: &str) -> MemFs {
    mem(&[("mtek.toml", TOML), ("src/main.mtek", main)])
}

/// Every file under `dir`, as a project.
fn load_dir(dir: &Path) -> MemFs {
    fn walk(base: &Path, dir: &Path, fs: &mut MemFs) {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                walk(base, &path, fs);
            } else {
                let relative = path.strip_prefix(base).unwrap();
                let relative: Vec<_> = relative
                    .components()
                    .map(|c| c.as_os_str().to_str().unwrap())
                    .collect();
                fs.insert(
                    ProjectPath::new(&relative.join("/")).unwrap(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut fs = MemFs::new();
    walk(dir, dir, &mut fs);
    fs
}

fn options(symbols: &[&str], max_bytes: usize) -> ContextOptions {
    ContextOptions {
        entry: None,
        symbols: symbols.iter().map(|s| (*s).to_owned()).collect(),
        max_bytes,
    }
}

fn run(fs: &MemFs, options: &ContextOptions) -> Result<ContextOutput, ContextError> {
    context(&ProjectRoot::at_base(), fs, options)
}

fn ok(fs: &MemFs, options: &ContextOptions) -> ContextOutput {
    run(fs, options).unwrap_or_else(|error| panic!("{error}"))
}

fn default_options() -> ContextOptions {
    ContextOptions::default()
}

fn json(output: &ContextOutput) -> Value {
    serde_json::from_str(&output.text).unwrap()
}

struct Checked {
    errors: usize,
    warnings: usize,
    codes: Vec<&'static str>,
}

fn check_fs(fs: &MemFs) -> Checked {
    let result = check(&ProjectRoot::at_base(), fs);
    Checked {
        errors: result.report.summary.errors,
        warnings: result.report.summary.warnings,
        codes: result
            .report
            .diagnostics
            .iter()
            .map(|d| d.code.as_str())
            .collect(),
    }
}

fn set(items: &[String]) -> BTreeSet<&str> {
    items.iter().map(String::as_str).collect()
}

fn names(context: &mtek_compiler::context::Context) -> Vec<&str> {
    context.symbols.iter().map(|s| s.name.as_str()).collect()
}

fn bless() -> bool {
    std::env::var_os("MTEK_BLESS").is_some_and(|v| v == "1")
}

/// Compare `text` with `tests/context/golden/<name>` (or write it when blessing).
fn assert_golden(name: &str, text: &str) {
    let path = repo("tests/context/golden").join(name);
    if bless() {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        return;
    }
    let expected = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read golden {}: {e}\nGenerate it with: MTEK_BLESS=1 cargo test -p mtek-compiler --test context",
            path.display()
        )
    });
    assert!(
        expected == text,
        "golden {name} differs from the output; if the change is intended regenerate with: \
         MTEK_BLESS=1 cargo test -p mtek-compiler --test context"
    );
}

fn validator() -> Validator {
    let schema: Value =
        serde_json::from_str(&fs::read_to_string(repo("spec/context.schema.json")).unwrap())
            .unwrap();
    jsonschema::draft202012::new(&schema).unwrap()
}

fn assert_valid(output: &ContextOutput) {
    let instance = json(output);
    let problems: Vec<String> = validator()
        .iter_errors(&instance)
        .map(|e| format!("{e} (at {})", e.instance_path()))
        .collect();
    assert!(problems.is_empty(), "{problems:#?}");
}

/// Every emitted example is a complete program that checks without errors or warnings.
fn assert_examples_check(output: &ContextOutput) {
    for example in &output.context.examples {
        let checked = check_fs(&project(&example.source));
        assert!(
            checked.errors == 0 && checked.warnings == 0,
            "example '{}': {:?}",
            example.title,
            checked.codes
        );
    }
}

/// The project of the neighbourhood tests: two modules, an import, a material with a param,
/// documentation comments, a scene with state, a camera and two entities.
fn neighbourhood_project() -> MemFs {
    mem(&[
        ("mtek.toml", TOML),
        (
            "src/main.mtek",
            "import { clampy } from \"./helpers.mtek\";\n\
             \n\
             /// A pulsing material.\n\
             ///\n\
             /// Used by the cube.\n\
             material Pulse {\n\
             \x20   /// The colour.\n\
             \x20   param tint: color = #6b5cff;\n\
             \n\
             \x20   fragment(input: SurfaceInput) -> color {\n\
             \x20       return tint;\n\
             \x20   }\n\
             }\n\
             \n\
             scene Main {\n\
             \x20   /// Turning speed.\n\
             \x20   state speed: f32 = 1.0;\n\
             \x20   state unrelated: i32 = 0;\n\
             \n\
             \x20   camera Cam {\n\
             \x20       position: vec3(0.0, 2.0, 5.0);\n\
             \x20       target: vec3(0.0, 0.0, 0.0);\n\
             \x20   }\n\
             \n\
             \x20   entity A {\n\
             \x20       mesh: Box {};\n\
             \x20       material: Pulse { tint: #ff0000; };\n\
             \n\
             \x20       update(dt: f32) {\n\
             \x20           self.rotation *= quat.axis_angle(vec3(0.0, 1.0, 0.0), clampy(speed) * dt);\n\
             \x20       }\n\
             \x20   }\n\
             \n\
             \x20   entity B {\n\
             \x20       mesh: Sphere {};\n\
             \x20   }\n\
             }\n",
        ),
        (
            "src/helpers.mtek",
            "const LIMIT: f32 = 2.0;\n\
             \n\
             /// Limit a value.\n\
             export fn clampy(x: f32) -> f32 {\n\
             \x20   return min(x, LIMIT);\n\
             }\n",
        ),
    ])
}

// ---------------------------------------------------------------------------
// supported / notSupported are derived from the build
// ---------------------------------------------------------------------------

#[test]
fn constructs_are_features_in_table_order_and_all_implemented() {
    let capabilities = derive(registry());
    let constructs: Vec<&str> = Construct::ALL.iter().map(|c| feature_name(*c)).collect();
    assert_eq!(
        capabilities
            .features
            .iter()
            .map(String::as_str)
            .take(constructs.len())
            .collect::<Vec<_>>(),
        constructs
    );
    assert_eq!(
        set(&capabilities.features).len(),
        capabilities.features.len(),
        "feature names are unique"
    );
    // Every name of a construct is a plain word, the library items are `kind:name`.
    for (index, feature) in capabilities.features.iter().enumerate() {
        assert_eq!(
            index >= constructs.len(),
            feature.contains(':'),
            "{feature}"
        );
    }
}

fn reached(since: &Value) -> bool {
    let milestone = match since.as_str().unwrap() {
        "M1" => Milestone::M1,
        "M2" => Milestone::M2,
        "M3" => Milestone::M3,
        "M4" => Milestone::M4,
        "M5" => Milestone::M5,
        other => panic!("unknown milestone {other}"),
    };
    milestone.is_reached_by(IMPLEMENTED_MILESTONE)
}

/// The `kind:name` of every registry row, from the generated `stdlib-schema.json` (a second path
/// to the registry, independent of the one the context export uses), split into the rows this
/// build has reached and the rows it has not (with their milestone).
fn registry_rows_from_json() -> (BTreeSet<String>, BTreeSet<String>) {
    let schema: Value = serde_json::from_str(&export_schema_json(registry())).unwrap();
    let mut listed = BTreeSet::new();
    let mut planned = BTreeSet::new();
    let mut row = |name: String, since: &Value, listed_when_reached: bool| {
        if reached(since) {
            if listed_when_reached {
                listed.insert(name);
            }
        } else {
            planned.insert(format!("{name} (planned for {})", since.as_str().unwrap()));
        }
    };
    let array = |key: &str| schema[key].as_array().unwrap().clone();
    for ty in array("types") {
        let name = ty["name"].as_str().unwrap();
        row(format!("type:{name}"), &ty["since"], true);
        for method in ty["methods"].as_array().unwrap() {
            row(
                format!("method:{name}.{}", method["name"].as_str().unwrap()),
                &method["since"],
                true,
            );
        }
    }
    for item in array("schemas") {
        let name = item["name"].as_str().unwrap();
        row(format!("schema:{name}"), &item["since"], true);
        for field in item["fields"].as_array().unwrap() {
            row(
                format!("field:{name}.{}", field["name"].as_str().unwrap()),
                &field["since"],
                false,
            );
        }
    }
    for item in array("sceneObjects") {
        row(
            format!("scene-object:{}", item["keyword"].as_str().unwrap()),
            &item["since"],
            true,
        );
    }
    for item in array("events") {
        row(
            format!("event:{}", item["name"].as_str().unwrap()),
            &item["since"],
            true,
        );
    }
    for item in array("enums") {
        let name = item["name"].as_str().unwrap();
        row(format!("enum:{name}"), &item["since"], true);
        for member in item["members"].as_array().unwrap() {
            row(
                format!("enum-member:{name}.{}", member["name"].as_str().unwrap()),
                &member["since"],
                false,
            );
        }
    }
    for item in array("namespaces") {
        let name = item["name"].as_str().unwrap();
        row(format!("namespace:{name}"), &item["since"], true);
        for member in item["members"].as_array().unwrap() {
            row(
                format!(
                    "{}:{name}.{}",
                    member["kind"].as_str().unwrap(),
                    member["name"].as_str().unwrap()
                ),
                &member["since"],
                true,
            );
        }
    }
    for item in array("intrinsics") {
        row(
            format!("function:{}", item["name"].as_str().unwrap()),
            &item["since"],
            true,
        );
    }
    for item in array("bodyCommands") {
        row(
            format!("body-command:{}", item["name"].as_str().unwrap()),
            &item["since"],
            true,
        );
    }
    for item in array("bodyProperties") {
        row(
            format!("body-property:{}", item["name"].as_str().unwrap()),
            &item["since"],
            true,
        );
    }
    (listed, planned)
}

#[test]
fn every_registry_row_is_a_feature_or_planned_and_nothing_else_is() {
    let capabilities = derive(registry());
    let (listed, planned) = registry_rows_from_json();
    assert!(
        listed.len() > 100,
        "the registry has rows: {}",
        listed.len()
    );
    let library_features: BTreeSet<String> = capabilities
        .features
        .iter()
        .filter(|f| f.contains(':'))
        .cloned()
        .collect();
    assert_eq!(
        library_features, listed,
        "`supported.features` lists exactly the registry rows this build has reached"
    );
    let not_supported = set(&capabilities.not_supported);
    for name in &planned {
        assert!(not_supported.contains(name.as_str()), "{name}");
    }
    let planned_in_output = capabilities
        .not_supported
        .iter()
        .filter(|s| s.contains("(planned for"))
        .count();
    assert_eq!(
        planned_in_output,
        planned.len()
            + HARD_GATES
                .iter()
                .filter(|gate| gate.since.is_some())
                .count(),
        "only gated rows and hard gates are planned"
    );
}

#[test]
fn the_names_of_used_library_items_are_the_names_of_features() {
    // `prelude_feature` names what a program uses; the names must be the registry rows'.
    let registry = registry();
    let features = derive(registry).features;
    let features = set(&features);
    let mut checked = 0;
    let mut verify = |item: PreludeItem| {
        let name = prelude_feature(item).unwrap();
        assert!(features.contains(name.as_str()), "{item:?} -> {name}");
        checked += 1;
    };
    for ty in &registry.types {
        verify(PreludeItem::Type(ty.name));
    }
    for schema in &registry.schemas {
        verify(PreludeItem::Schema(schema.name));
    }
    for kind in &registry.scene_objects {
        verify(PreludeItem::SceneObject(kind.keyword));
    }
    for event in &registry.events {
        verify(PreludeItem::Event(event.name));
    }
    for def in &registry.enums {
        verify(PreludeItem::Enum(def.name));
        for member in &def.members {
            verify(PreludeItem::EnumMember {
                enum_name: def.name,
                member: member.name,
            });
        }
    }
    for intrinsic in &registry.intrinsics {
        verify(PreludeItem::Function(intrinsic.name));
    }
    for namespace in &registry.namespaces {
        verify(PreludeItem::Namespace(namespace.name));
        for member in &namespace.members {
            verify(PreludeItem::NamespaceMember {
                namespace: namespace.name,
                member: member.name(),
            });
        }
    }
    assert!(checked > 150, "{checked}");
}

#[test]
fn used_features_are_the_features_a_project_uses_also_when_the_ir_folds_them_away() {
    // `tools/coverage-matrix` (decision 0093): the standard-library names the resolver bound, the
    // constructs of the declarations and the accessors and commands of the type checker, named as
    // `supported.features` names them. `quat.identity()` and `CHAIR.node_position(..)` fold to
    // constants, so the typed IR keeps neither.
    let used = used_features(
        &ProjectRoot::at_base(),
        &load_dir(&repo("tests/assets/pass/assets_supported")),
    )
    .unwrap();
    for name in [
        "function:asset.glb",
        "function:asset.texture",
        "function:asset.linear_texture",
        "method:glb_asset.mesh",
        "method:glb_asset.node_position",
        "method:glb_asset.material_base_color",
        "materials",
        "scenes",
    ] {
        assert!(used.contains(name), "{name} is not among {used:?}");
    }
    let program = project(
        "scene Demo {\n    camera Main {}\n    update(dt: f32) {\n        let q = quat.identity();\n    }\n}\n",
    );
    let used = used_features(&ProjectRoot::at_base(), &program).unwrap();
    assert!(used.contains("function:quat.identity"), "{used:?}");
    assert!(used.contains("lifecycle-functions"), "{used:?}");
    assert!(!used.contains("function:sin"), "{used:?}");
    // Every name is a feature of the build (or a construct), so nothing the tool reads is invented.
    let features = derive(registry()).features;
    let features = set(&features);
    for name in &used {
        assert!(features.contains(name.as_str()), "{name} is not a feature");
    }
}

#[test]
fn a_project_that_cannot_be_loaded_has_no_used_features() {
    let error = used_features(&ProjectRoot::at_base(), &MemFs::new()).unwrap_err();
    assert!(matches!(error, ContextError::Project(_)), "{error}");
}

#[test]
fn every_registry_item_the_build_has_not_reached_is_planned_and_every_new_one_is_listed() {
    let mut changed = Registry::v0_1();
    let baseline = derive_for(&changed, IMPLEMENTED_MILESTONE);

    // A new implemented row appears in `features`, and only there.
    let mut extra = changed.intrinsics[0].clone();
    extra.name = "extra_function";
    changed.intrinsics.push(extra.clone());
    let with_row = derive_for(&changed, IMPLEMENTED_MILESTONE);
    assert!(set(&with_row.features).contains("function:extra_function"));
    assert_eq!(with_row.not_supported, baseline.not_supported);
    assert_eq!(with_row.features.len(), baseline.features.len() + 1);

    // The same row planned for a later milestone is `notSupported`, with its milestone.
    changed.intrinsics.pop();
    extra.since = Milestone::M4;
    changed.intrinsics.push(extra);
    let planned = derive_for(&changed, IMPLEMENTED_MILESTONE);
    assert_eq!(planned.features, baseline.features);
    assert!(set(&planned.not_supported).contains("function:extra_function (planned for M4)"));

    // A schema, its fields and a gated field: the parent gates its children.
    let mut changed = Registry::v0_1();
    let mut schema = changed.schema("Box").unwrap().clone();
    schema.name = "Gem";
    schema.fields[0].since = Milestone::M3;
    changed.schemas.push(schema.clone());
    let gem = derive_for(&changed, IMPLEMENTED_MILESTONE);
    assert!(set(&gem.features).contains("schema:Gem"));
    assert!(set(&gem.not_supported).contains("field:Gem.size (planned for M3)"));
    changed.schemas.pop();
    schema.since = Milestone::M5;
    changed.schemas.push(schema);
    let gated = derive_for(&changed, IMPLEMENTED_MILESTONE);
    assert!(!set(&gated.features).contains("schema:Gem"));
    assert!(set(&gated.not_supported).contains("schema:Gem (planned for M5)"));
    assert!(
        !gated
            .not_supported
            .iter()
            .any(|s| s.starts_with("field:Gem")),
        "the gated schema says it for its fields"
    );

    // A gated enum member and a gated namespace member.
    let mut changed = Registry::v0_1();
    changed.enums[0].members[0].since = Milestone::M2;
    let member = changed.enums[0].members[0].name;
    let enum_name = changed.enums[0].name;
    let namespace = changed.namespaces[0].name;
    let namespace_member = changed.namespaces[0].members[0].name();
    for member_row in &mut changed.namespaces[0].members {
        match member_row {
            mtek_compiler::stdlib::NamespaceMember::Function(f) => f.since = Milestone::M3,
            mtek_compiler::stdlib::NamespaceMember::Value(v) => v.since = Milestone::M3,
        }
    }
    let gated = derive_for(&changed, IMPLEMENTED_MILESTONE);
    let not_supported = set(&gated.not_supported);
    assert!(
        not_supported
            .contains(format!("enum-member:{enum_name}.{member} (planned for M2)").as_str())
    );
    assert!(
        gated.not_supported.iter().any(|s| s
            .starts_with(&format!("function:{namespace}.{namespace_member} "))
            || s.starts_with(&format!("value:{namespace}.{namespace_member} "))),
        "{namespace}.{namespace_member}"
    );

    // Reaching the milestone lifts the gate: the same registry, a build that has reached M5.
    let lifted = derive_for(&changed, Milestone::M5);
    assert!(
        lifted
            .not_supported
            .iter()
            .all(|s| !s.contains("(planned for M2)"))
    );
    assert!(
        lifted
            .not_supported
            .iter()
            .all(|s| !s.contains("(planned for M3)")
                || HARD_GATES.iter().any(|g| s.starts_with(g.feature))),
        "only hard gates stay planned"
    );
}

#[test]
fn the_hard_gate_is_what_the_build_rejects() {
    let source = "fn f(a: f32) -> f32 { return a; }\n\
                  scene Demo {\n    camera Main {}\n    entity E { mesh: Box {}; position: vec3(f(1.0), 0.0, 0.0); }\n}\n";
    let result = check(&ProjectRoot::at_base(), &project(source));
    let gate = result
        .report
        .diagnostics
        .iter()
        .find(|d| d.code == Code::E9010)
        .expect("the build rejects a non-constant initial value");
    assert!(
        gate.message
            .starts_with(NON_CONSTANT_INITIAL_VALUES.subject),
        "{}",
        gate.message
    );
    // No milestone is planned for it (the old "planned for M3" outlived M3): neither the message nor
    // the export promises one.
    assert_eq!(NON_CONSTANT_INITIAL_VALUES.since, None);
    assert!(!gate.message.contains("planned for"), "{}", gate.message);
    let not_supported = derive(registry()).not_supported;
    assert!(set(&not_supported).contains(NON_CONSTANT_INITIAL_VALUES.feature));
}

#[test]
fn reserved_words_and_unsupported_codes_are_listed_from_their_catalogues() {
    let not_supported = derive(registry()).not_supported;
    let listed = set(&not_supported);
    for word in RESERVED_WORDS {
        assert!(listed.contains(word), "{word}");
    }
    let unsupported: Vec<Code> = Code::ALL
        .iter()
        .copied()
        .filter(|c| c.is_unsupported_feature())
        .collect();
    assert!(unsupported.len() >= 5, "{unsupported:?}");
    for code in &unsupported {
        assert!(
            listed.contains(unsupported_phrase(*code).as_str()),
            "{code:?}"
        );
    }
    // The wording table covers every unsupported-feature code of the catalogue, so the fallback
    // (the title) is never what an agent reads; a new code fails here until it has a phrase.
    let phrased: BTreeSet<Code> = phrased_codes().into_iter().collect();
    assert_eq!(phrased, unsupported.into_iter().collect());
    // Nothing a build supports is also rejected.
    let features = derive(registry()).features;
    for feature in &features {
        assert!(!listed.contains(feature.as_str()), "{feature}");
    }
    assert_eq!(set(&not_supported).len(), not_supported.len(), "unique");
}

// ---------------------------------------------------------------------------
// syntax
// ---------------------------------------------------------------------------

#[test]
fn every_syntax_rule_is_enforced_by_the_compiler() {
    for rule in &RULES {
        let checked = check_fs(&project(rule.violation));
        assert!(
            checked.codes.contains(&rule.code.as_str()),
            "rule '{}' expects {} for its violation, got {:?}",
            rule.text,
            rule.code.as_str(),
            checked.codes
        );
    }
}

/// The text between the first pair of code fences after `heading` in `spec/language.md`.
fn language_block(heading: &str) -> String {
    let text = fs::read_to_string(repo("spec/language.md")).unwrap();
    let start = text.find(heading).unwrap();
    let rest = &text[start..];
    let open = rest.find("```").unwrap() + 3;
    let close = open + rest[open..].find("```").unwrap();
    rest[open..close].to_owned()
}

#[test]
fn keywords_and_reserved_words_are_the_specified_lists() {
    let specified: BTreeSet<String> = language_block("2.2 **Keywords")
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let emitted: BTreeSet<String> = keywords().into_iter().collect();
    assert_eq!(emitted, specified);
    let reserved: BTreeSet<String> = language_block("2.3 **Reserved")
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    assert_eq!(
        reserved,
        RESERVED_WORDS.iter().map(|w| (*w).to_owned()).collect()
    );
}

#[test]
fn precedence_is_the_specified_table() {
    let text = fs::read_to_string(repo("spec/language.md")).unwrap();
    let start = text.find("6.1 **Precedence and associativity**").unwrap();
    let mut specified = Vec::new();
    // The heading line, a blank line, the header row and the separator row come first.
    for line in text[start..].lines().skip(4) {
        if !line.starts_with('|') {
            break;
        }
        let cells: Vec<&str> = line.trim_matches('|').split(" | ").collect();
        let level: u32 = cells[0].trim().parse().unwrap();
        // The backticked operators of the second cell, `\|` unescaped.
        let operators: Vec<String> = cells[1]
            .split('`')
            .skip(1)
            .step_by(2)
            .map(|op| op.replace("\\|", "|"))
            .collect();
        let associativity = if cells[2].contains("non-associative") {
            "non-associative"
        } else if cells[2].contains("right") {
            "right"
        } else {
            "left"
        };
        specified.push((level, operators, associativity));
    }
    assert_eq!(specified.len(), 8);
    let emitted = precedence();
    assert_eq!(emitted.len(), 8);
    for (line, (level, operators, associativity)) in emitted.iter().zip(&specified) {
        assert!(line.starts_with(&format!("level {level}: ")), "{line}");
        assert!(line.ends_with(&format!("({associativity})")), "{line}");
        if *level <= 6 {
            assert_eq!(
                line,
                &format!("level {level}: {} ({associativity})", operators.join(" "))
            );
        }
    }
}

// ---------------------------------------------------------------------------
// examples
// ---------------------------------------------------------------------------

#[test]
fn every_example_of_the_library_checks_without_errors_or_warnings() {
    assert!(LIBRARY.len() > MAX_EXAMPLES);
    let titles: BTreeSet<&str> = LIBRARY.iter().map(|e| e.title).collect();
    assert_eq!(titles.len(), LIBRARY.len(), "titles are unique");
    for example in &LIBRARY {
        let checked = check_fs(&project(example.source));
        assert!(
            checked.errors == 0 && checked.warnings == 0,
            "'{}': {:?}",
            example.title,
            checked.codes
        );
        assert!(example.source.ends_with("}\n"), "'{}'", example.title);
    }
}

#[test]
fn the_features_of_an_example_are_features_of_the_build() {
    let supported = derive(registry()).features;
    let supported = set(&supported);
    for example in &LIBRARY {
        let used = features_of(example);
        assert!(used.len() >= 4, "'{}': {used:?}", example.title);
        for feature in &used {
            assert!(
                supported.contains(feature.as_str()),
                "'{}' uses {feature}, which this build does not list as supported",
                example.title
            );
        }
    }
}

#[test]
fn a_project_that_is_an_example_gets_that_example_back() {
    for example in &LIBRARY {
        let output = ok(&project(example.source), &default_options());
        assert!(
            output
                .context
                .examples
                .iter()
                .any(|emitted| emitted.source == example.source),
            "'{}' is not among {:?}",
            example.title,
            output
                .context
                .examples
                .iter()
                .map(|e| &e.title)
                .collect::<Vec<_>>()
        );
        assert_examples_check(&output);
    }
}

#[test]
fn examples_are_the_ones_that_share_features_with_the_neighbourhood() {
    let fs = neighbourhood_project();
    // Pulse is a material with a fragment stage and a param, bound nowhere.
    let output = ok(&fs, &options(&["Pulse"], DEFAULT_MAX_BYTES));
    let titles: Vec<&str> = output
        .context
        .examples
        .iter()
        .map(|e| e.title.as_str())
        .collect();
    assert!(
        titles.contains(&"A material with a fragment stage"),
        "{titles:?}"
    );
    assert!(titles.len() <= MAX_EXAMPLES);
    // A plain scene constant has no example about prefabs.
    let output = ok(&fs, &options(&["Main.speed"], DEFAULT_MAX_BYTES));
    assert!(
        output
            .context
            .examples
            .iter()
            .all(|e| e.title != "Prefabs and prefab instances")
    );
}

#[test]
fn the_diagnostics_guide_names_fields_the_envelope_has() {
    let schema: Value =
        serde_json::from_str(&fs::read_to_string(repo("spec/diagnostic.schema.json")).unwrap())
            .unwrap();
    let diagnostic = schema["$defs"]["diagnostic"]["properties"]
        .as_object()
        .unwrap();
    let source = schema["$defs"]["source"]["properties"].as_object().unwrap();
    for field in [
        "code",
        "severity",
        "title",
        "message",
        "source",
        "expected",
        "actual",
        "related",
        "notes",
        "suggestedEdits",
        "phase",
    ] {
        assert!(diagnostic.contains_key(field), "{field}");
        assert!(DIAGNOSTICS_GUIDE.contains(field), "{field}");
    }
    for field in [
        "file",
        "startByte",
        "endByte",
        "startLine",
        "startColumn",
        "endLine",
        "endColumn",
    ] {
        assert!(source.contains_key(field), "{field}");
        assert!(DIAGNOSTICS_GUIDE.contains(field), "{field}");
    }
}

// ---------------------------------------------------------------------------
// neighbourhood
// ---------------------------------------------------------------------------

#[test]
fn without_symbols_the_context_is_the_entry_scene_and_what_it_touches() {
    let output = ok(&neighbourhood_project(), &default_options());
    let context = &output.context;
    assert_eq!(context.project.scene.as_deref(), Some("Main"));
    assert_eq!(context.project.entry, "src/main.mtek");
    assert_eq!(
        context.project.modules,
        ["src/main.mtek", "src/helpers.mtek"]
    );
    // Source order inside a module, modules in load order; the material and the imported
    // function are one reference away, the constant `LIMIT` is two.
    assert_eq!(
        names(context),
        [
            "Pulse",
            "Main",
            "Main.speed",
            "Main.unrelated",
            "Main.Cam",
            "Main.A",
            "Main.B",
            "clampy"
        ]
    );
    let by_name = |name: &str| context.symbols.iter().find(|s| s.name == name).unwrap();
    assert_eq!(by_name("Pulse").kind, "material");
    assert_eq!(by_name("Main").kind, "scene");
    assert_eq!(by_name("Main.speed").kind, "state");
    assert_eq!(by_name("Main.speed").ty, "f32");
    assert_eq!(by_name("Main.Cam").kind, "camera");
    assert_eq!(by_name("Main.Cam").ty, "Camera");
    assert_eq!(by_name("Main.A").kind, "entity");
    assert_eq!(by_name("clampy").kind, "fn");
    assert_eq!(by_name("clampy").ty, "(x: f32) -> f32");
    assert_eq!(by_name("clampy").file, "src/helpers.mtek");
    assert_eq!(by_name("clampy").line, 4);
    assert_eq!(
        by_name("Main.speed").line,
        17,
        "the line of `state`, not of its doc comment"
    );
    let schemas: Vec<&str> = context.schemas.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(schemas, ["Box", "Camera", "Entity", "Scene", "Sphere"]);
}

#[test]
fn doc_comments_are_the_docs_of_the_declaration_that_follows() {
    let output = ok(&neighbourhood_project(), &default_options());
    let doc = |name: &str| {
        output
            .context
            .symbols
            .iter()
            .find(|s| s.name == name)
            .unwrap()
            .doc
            .clone()
    };
    assert_eq!(doc("Pulse"), "A pulsing material.\n\nUsed by the cube.");
    assert_eq!(doc("Main.speed"), "Turning speed.");
    assert_eq!(doc("clampy"), "Limit a value.");
    assert_eq!(doc("Main.unrelated"), "");
    // A parameter is a symbol of its own when its material is requested.
    let output = ok(
        &neighbourhood_project(),
        &options(&["Pulse"], DEFAULT_MAX_BYTES),
    );
    let tint = output
        .context
        .symbols
        .iter()
        .find(|s| s.name == "Pulse.tint")
        .unwrap();
    assert_eq!(
        (tint.kind.as_str(), tint.ty.as_str(), tint.doc.as_str()),
        ("param", "color", "The colour.")
    );
}

#[test]
fn a_symbol_brings_its_types_its_schemas_and_the_declarations_one_reference_away() {
    let fs = neighbourhood_project();
    let output = ok(&fs, &options(&["Main.A"], DEFAULT_MAX_BYTES));
    // The entity, the material and the state it uses, the function it calls (in another
    // module); not its sibling, the camera, the scene or the constant behind the function.
    assert_eq!(
        names(&output.context),
        ["Pulse", "Main.speed", "Main.A", "clampy"]
    );
    let schemas: Vec<&str> = output
        .context
        .schemas
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(schemas, ["Box", "Entity"]);
    assert!(output.context.truncated.is_none());

    // References count in both directions: asked for the material, the entity that uses it
    // comes along.
    let output = ok(&fs, &options(&["Pulse"], DEFAULT_MAX_BYTES));
    assert_eq!(names(&output.context), ["Pulse", "Pulse.tint", "Main.A"]);
    assert!(output.context.schemas.is_empty());

    // The state is read by the entity (and by nothing else).
    let output = ok(&fs, &options(&["Main.speed"], DEFAULT_MAX_BYTES));
    assert_eq!(names(&output.context), ["Main.speed", "Main.A"]);

    // Several symbols, by file and name, in any order, once each.
    let output = ok(
        &fs,
        &options(
            &["src/helpers.mtek::clampy", "Main.B", "Main.B"],
            DEFAULT_MAX_BYTES,
        ),
    );
    assert_eq!(
        names(&output.context),
        ["Main.A", "Main.B", "LIMIT", "clampy"]
    );
    let schemas: Vec<&str> = output
        .context
        .schemas
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(schemas, ["Entity", "Sphere"]);
}

#[test]
fn an_unknown_symbol_is_an_error_with_suggestions() {
    let fs = neighbourhood_project();
    match run(&fs, &options(&["Main.Aa"], DEFAULT_MAX_BYTES)) {
        Err(ContextError::UnknownSymbol { name, suggestions }) => {
            assert_eq!(name, "Main.Aa");
            assert_eq!(suggestions, ["Main.A", "Main.B", "Main.Cam"]);
        }
        other => panic!("{other:?}"),
    }
    assert!(run(&fs, &options(&["nothing like it"], DEFAULT_MAX_BYTES)).is_err());
    // A name from another file's spelling does not match.
    assert!(
        run(
            &fs,
            &options(&["src/helpers.mtek::Main"], DEFAULT_MAX_BYTES)
        )
        .is_err()
    );
}

#[test]
fn the_entry_must_be_the_projects_entry() {
    let fs = neighbourhood_project();
    let mut with_entry = default_options();
    with_entry.entry = Some("src/main.mtek".to_owned());
    assert!(run(&fs, &with_entry).is_ok());
    with_entry.entry = Some("src/helpers.mtek".to_owned());
    match run(&fs, &with_entry) {
        Err(ContextError::EntryMismatch { given, configured }) => {
            assert_eq!(
                (given.as_str(), configured.as_str()),
                ("src/helpers.mtek", "src/main.mtek")
            );
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_project_that_cannot_be_loaded_is_a_report_not_a_context() {
    match run(&mem(&[("src/main.mtek", "scene A {}")]), &default_options()) {
        Err(ContextError::Project(failed)) => {
            assert!(
                failed
                    .report
                    .diagnostics
                    .iter()
                    .any(|d| d.code == Code::E9004)
            );
        }
        other => panic!("{other:?}"),
    }
    let missing_entry = mem(&[("mtek.toml", TOML)]);
    match run(&missing_entry, &default_options()) {
        Err(ContextError::Project(failed)) => {
            assert!(
                failed
                    .report
                    .diagnostics
                    .iter()
                    .any(|d| d.code == Code::E9005)
            );
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_project_with_errors_still_has_a_context() {
    // A syntax error, an unknown name and no selectable scene: the context describes what parsed.
    let fs = project(
        "/// Kept.\nconst KEPT: f32 = 1.0;\nscene A {\n    camera C {}\n    entity E { mesh: Nope {}; }\n}\nscene B {\n    camera C {}\n}\nscene Broken {\n",
    );
    let output = ok(&fs, &default_options());
    assert_eq!(output.context.project.scene, None);
    // With no entry scene, every top-level declaration of the entry module is requested.
    assert!(names(&output.context).contains(&"KEPT"));
    assert!(names(&output.context).contains(&"A.E"));
    assert_valid(&output);
}

// ---------------------------------------------------------------------------
// truncation
// ---------------------------------------------------------------------------

#[test]
fn a_budget_drops_examples_then_neighbours_then_schemas_then_symbols() {
    let fs = neighbourhood_project();
    let full = ok(&fs, &options(&["Main.A"], DEFAULT_MAX_BYTES));
    assert_eq!(full.context.examples.len(), MAX_EXAMPLES);
    let total = full.text.len();
    let full_titles: Vec<String> = full
        .context
        .examples
        .iter()
        .map(|e| e.title.clone())
        .collect();

    // Walk the budget down; every output fits and what is dropped follows the order.
    let mut previous_symbols = full.context.symbols.len();
    let mut previous_schemas = full.context.schemas.len();
    let mut phases = BTreeSet::new();
    let mut budget = total;
    let mut minimum = None;
    while budget > 0 {
        budget -= 31.min(budget);
        match run(&fs, &options(&["Main.A"], budget)) {
            Err(ContextError::BudgetTooSmall {
                max_bytes,
                minimum: needed,
            }) => {
                assert_eq!(max_bytes, budget);
                assert!(needed > budget);
                minimum = Some(needed);
                break;
            }
            Err(other) => panic!("{other:?}"),
            Ok(output) => {
                assert!(
                    output.text.len() <= budget,
                    "{} > {budget}",
                    output.text.len()
                );
                let context = &output.context;
                let truncated = context.truncated.clone().unwrap_or_default();
                // Examples go first, the least relevant first.
                let kept = context.examples.len();
                assert_eq!(truncated.examples.count, full_titles.len() - kept);
                assert_eq!(
                    truncated.examples.names,
                    full_titles[kept..]
                        .iter()
                        .rev()
                        .cloned()
                        .collect::<Vec<_>>()
                );
                // Neighbours only once every example is gone ...
                if !truncated.neighbours.is_empty() {
                    assert!(context.examples.is_empty());
                    phases.insert("neighbours");
                }
                // ... schemas only once every neighbour is gone ...
                if !truncated.schemas.is_empty() {
                    assert_eq!(
                        truncated.neighbours.names,
                        ["clampy", "Main.speed", "Pulse"]
                    );
                    phases.insert("schemas");
                }
                // ... and requested symbols last.
                if !truncated.symbols.is_empty() {
                    assert!(context.schemas.is_empty());
                    phases.insert("symbols");
                }
                assert!(context.symbols.len() <= previous_symbols);
                assert!(context.schemas.len() <= previous_schemas);
                previous_symbols = context.symbols.len();
                previous_schemas = context.schemas.len();
                assert_valid(&output);
                assert_examples_check(&output);
                // `truncated` is present exactly when something was dropped.
                assert_eq!(
                    context.truncated.is_some(),
                    context.examples.len() < full_titles.len()
                        || context.symbols.len() < 4
                        || context.schemas.len() < 2
                );
            }
        }
    }
    assert_eq!(phases, BTreeSet::from(["neighbours", "schemas", "symbols"]));

    // The smallest budget that works works, and one byte less does not.
    let minimum = minimum.expect("a budget small enough to have no context");
    let smallest = ok(&fs, &options(&["Main.A"], minimum));
    assert_eq!(smallest.text.len(), minimum);
    assert!(smallest.context.symbols.is_empty());
    assert!(smallest.context.schemas.is_empty() && smallest.context.examples.is_empty());
    let truncated = smallest.context.truncated.as_ref().unwrap();
    assert_eq!(truncated.symbols.names, ["Main.A"]);
    assert_eq!(truncated.symbols.count, 1);
    match run(&fs, &options(&["Main.A"], minimum - 1)) {
        Err(ContextError::BudgetTooSmall { minimum: again, .. }) => assert_eq!(again, minimum),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_budget_that_is_large_enough_changes_nothing() {
    let fs = neighbourhood_project();
    let default = ok(&fs, &default_options());
    let huge = ok(&fs, &options(&[], 10_000_000));
    assert_eq!(default.text, huge.text);
    assert!(default.context.truncated.is_none());
    assert!(!default.text.contains("truncated"));
}

// ---------------------------------------------------------------------------
// determinism and format
// ---------------------------------------------------------------------------

#[test]
fn the_text_is_deterministic_and_free_of_paths_and_clocks() {
    let reference = ok(&neighbourhood_project(), &default_options());
    for seed in [1, 2, 3] {
        // Listing order of the in-memory file system must not matter.
        let shuffled = neighbourhood_project().with_shuffled_listing(seed);
        assert_eq!(ok(&shuffled, &default_options()).text, reference.text);
    }
    assert_eq!(
        ok(&neighbourhood_project(), &default_options()).text,
        reference.text
    );
    let text = &reference.text;
    assert!(text.ends_with("}\n") && !text.ends_with("\n\n"));
    assert!(
        !text.contains('\r') && !text.contains("\\\\"),
        "no CR and no Windows path"
    );
    assert!(text.lines().all(|line| line == line.trim_end()));
    // No absolute or backslash paths: only project-relative, `/`-separated ones.
    for symbol in &reference.context.symbols {
        assert!(!symbol.file.contains('\\') && !symbol.file.contains(':'));
        assert!(Path::new(&symbol.file).is_relative());
    }
    let value = json(&reference);
    assert_eq!(value["contextFormat"], CONTEXT_FORMAT);
    assert_eq!(value["languageVersion"], mtek_compiler::LANGUAGE_VERSION);
    assert_eq!(value["compilerVersion"], mtek_compiler::COMPILER_VERSION);
    // The keys come in the order of the specification's sketch.
    let keys: Vec<&str> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "languageVersion",
            "compilerVersion",
            "contextFormat",
            "supported",
            "syntax",
            "project",
            "symbols",
            "schemaGuide",
            "schemas",
            "examples",
            "diagnosticsGuide"
        ]
    );
}

#[test]
fn schema_fields_are_the_registry_fields_this_build_implements() {
    let output = ok(&neighbourhood_project(), &default_options());
    let registry = registry();
    for entry in &output.context.schemas {
        let schema = registry.schema(&entry.name).unwrap();
        let expected: Vec<&str> = schema.fields.iter().map(|f| f.name).collect();
        let emitted: Vec<&str> = entry
            .fields
            .iter()
            .map(|line| line.split(':').next().unwrap())
            .collect();
        assert_eq!(emitted, expected, "{}", entry.name);
        for (line, field) in entry.fields.iter().zip(&schema.fields) {
            // A project that has code gets the bare line: no range, no documentation.
            assert_eq!(*line, expected_field_line(field), "{}", entry.name);
            assert!(!line.contains(" // ") && !line.contains(" range "));
        }
        assert!(entry.doc.is_none());
    }
    let box_schema = output
        .context
        .schemas
        .iter()
        .find(|s| s.name == "Box")
        .unwrap();
    assert_eq!(
        box_schema.fields,
        ["size: vec3 = vec3(1.0, 1.0, 1.0) [C]".to_owned()]
    );
}

/// `name: type = default [flags]`, written out from the registry field independently of the
/// exporter: flag letters in the order R W B C.
fn expected_field_line(field: &mtek_compiler::stdlib::FieldDef) -> String {
    let flags: String = [
        (field.flags.is_required(), 'R'),
        (field.flags.is_writable(), 'W'),
        (field.flags.is_bindable(), 'B'),
        (field.flags.is_construction_only(), 'C'),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .map(|(_, c)| *c)
    .collect();
    let mut line = format!("{}: {}", field.name, field.ty.spelling());
    if let Some(default) = field.default_text() {
        line.push_str(&format!(" = {default}"));
    }
    if !flags.is_empty() {
        line.push_str(&format!(" [{flags}]"));
    }
    line
}

#[test]
fn the_schema_accepts_what_is_emitted_and_rejects_what_is_not() {
    let output = ok(&neighbourhood_project(), &default_options());
    assert_valid(&output);
    let validator = validator();
    let mut value = json(&output);
    value["contextFormat"] = Value::from(3);
    assert!(
        !validator.is_valid(&value),
        "a new format number needs a new schema"
    );
    let mut value = json(&output);
    value["surprise"] = Value::from(true);
    assert!(!validator.is_valid(&value));
    let mut value = json(&output);
    value["symbols"][0]["line"] = Value::from(0);
    assert!(!validator.is_valid(&value));
    let mut value = json(&output);
    value["truncated"] = serde_json::json!({});
    assert!(
        !validator.is_valid(&value),
        "an empty truncated object is not emitted"
    );
    let mut value = json(&output);
    value["schemas"][0]["fields"][0] = Value::from("Size! vec3");
    assert!(
        !validator.is_valid(&value),
        "a field line starts with the field name and a colon"
    );
    let mut value = json(&output);
    value["schemas"][0]["fields"][0] = serde_json::json!({ "name": "size" });
    assert!(
        !validator.is_valid(&value),
        "a field is a line, not an object"
    );
    let mut value = json(&output);
    value["reference"] = serde_json::json!({ "surprise": [] });
    assert!(!validator.is_valid(&value), "reference has fixed keys");
    let mut value = json(&output);
    value["reference"] = serde_json::json!({});
    assert!(
        !validator.is_valid(&value),
        "an empty reference is not emitted"
    );
}

// ---------------------------------------------------------------------------
// goldens: the example projects of the repository
// ---------------------------------------------------------------------------

struct Golden {
    name: &'static str,
    project: &'static str,
    symbols: &'static [&'static str],
    max_bytes: usize,
}

const GOLDENS: &[Golden] = &[
    Golden {
        name: "pulse-cube.default.json",
        project: "examples/pulse-cube",
        symbols: &[],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "pulse-cube.symbol-cube.json",
        project: "examples/pulse-cube",
        symbols: &["Demo.Cube"],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "pulse-cube.max-bytes-9000.json",
        project: "examples/pulse-cube",
        symbols: &["Demo.Cube", "Pulse"],
        max_bytes: 9000,
    },
    Golden {
        name: "physics-playground.default.json",
        project: "examples/physics-playground",
        symbols: &[],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "physics-playground.symbol-crate.json",
        project: "examples/physics-playground",
        symbols: &["Crate"],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "material-configurator.default.json",
        project: "examples/material-configurator",
        symbols: &[],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "material-configurator.symbol-striped.json",
        project: "examples/material-configurator",
        symbols: &["Striped"],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "modular-scene.default.json",
        project: "examples/modular-scene",
        symbols: &[],
        max_bytes: DEFAULT_MAX_BYTES,
    },
    Golden {
        name: "modular-scene.symbol-pillar.json",
        project: "examples/modular-scene",
        symbols: &["Pillar"],
        max_bytes: DEFAULT_MAX_BYTES,
    },
];

#[test]
fn goldens() {
    for golden in GOLDENS {
        let fs = load_dir(&repo(golden.project));
        let output = ok(&fs, &options(golden.symbols, golden.max_bytes));
        assert!(output.text.len() <= golden.max_bytes, "{}", golden.name);
        assert_golden(golden.name, &output.text);
        // What the golden pins is valid, and every example in it compiles.
        assert_valid(&output);
        assert_examples_check(&output);
        assert!(
            !output.context.examples.is_empty() || golden.max_bytes < 10_000,
            "{}",
            golden.name
        );
    }
}

#[test]
fn goldens_are_all_used_and_the_example_projects_have_no_errors() {
    let mut used: BTreeSet<&str> = GOLDENS.iter().map(|g| g.name).collect();
    used.insert("examples.features.json");
    // The goldens of the cold-start projects are pinned by `tests/context_cold_start.rs`.
    used.insert("empty.default.json");
    used.insert("scene-stub.default.json");
    let dir = repo("tests/context/golden");
    if dir.exists() {
        for entry in fs::read_dir(&dir).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            assert!(used.contains(name.as_str()), "stale golden {name}");
        }
    }
    for project in [
        "pulse-cube",
        "physics-playground",
        "material-configurator",
        "modular-scene",
    ] {
        let checked = check_fs(&load_dir(&repo(&format!("examples/{project}"))));
        assert_eq!(checked.errors, 0, "{project}: {:?}", checked.codes);
    }
}

/// The `kind` words that appear in the goldens are the ones the schema documents.
#[test]
fn symbol_kinds_are_the_documented_ones() {
    let documented: BTreeSet<&str> = [
        "scene", "entity", "prefab", "material", "struct", "fn", "cpu_fn", "const", "state",
        "param",
    ]
    .into_iter()
    .collect();
    let registry = registry();
    for golden in GOLDENS {
        let output = ok(
            &load_dir(&repo(golden.project)),
            &options(golden.symbols, 1_000_000),
        );
        for symbol in &output.context.symbols {
            assert!(
                documented.contains(symbol.kind.as_str())
                    || registry.scene_object(&symbol.kind).is_some(),
                "{}: {}",
                golden.name,
                symbol.kind
            );
        }
    }
}

#[test]
fn a_large_scene_fits_the_default_budget_and_says_what_it_left_out() {
    let mut source = String::from("scene Big {\n    camera Main {}\n");
    for i in 0..400 {
        source.push_str(&format!(
            "    entity E{i} {{\n        mesh: Box {{}};\n    }}\n"
        ));
    }
    source.push_str("}\n");
    let output = ok(&project(&source), &default_options());
    assert!(
        output.text.len() <= DEFAULT_MAX_BYTES,
        "{}",
        output.text.len()
    );
    let truncated = output.context.truncated.as_ref().unwrap();
    // The scene and its first entities are kept, the rest is counted, and only the first few
    // names are listed, so the note itself stays short however much was left out.
    let dropped = &truncated.symbols;
    assert!(dropped.count > 200, "{}", dropped.count);
    assert_eq!(dropped.names.len(), 16);
    assert_eq!(dropped.names[0], "Big.E399");
    assert_eq!(output.context.symbols[0].name, "Big");
    assert_eq!(output.context.symbols.len() + dropped.count, 402);
    assert_valid(&output);
    // Asking for one entity of it is cheap.
    let one = ok(
        &project(&source),
        &options(&["Big.E123"], DEFAULT_MAX_BYTES),
    );
    assert!(one.context.truncated.is_none());
    assert_eq!(names(&one.context), ["Big.E123"]);
}

#[test]
fn the_embedded_prelude_is_not_part_of_the_project() {
    // A program that uses a built-in material compiles `std/materials.mtek` with it.
    let example = LIBRARY
        .iter()
        .find(|e| e.title == "Lights and the Pbr material")
        .unwrap();
    let output = ok(&project(example.source), &default_options());
    assert_eq!(output.context.project.modules, ["src/main.mtek"]);
    assert!(
        output
            .context
            .symbols
            .iter()
            .all(|s| s.file == "src/main.mtek")
    );
    assert!(output.context.schemas.iter().any(|s| s.name == "Pbr"));
}

/// The features of every example, pinned: which examples a neighbourhood gets follows from them.
#[test]
fn example_features_are_pinned() {
    let tags: Vec<Value> = LIBRARY
        .iter()
        .map(|example| {
            serde_json::json!({
                "title": example.title,
                "features": features_of(example).into_iter().collect::<Vec<_>>(),
            })
        })
        .collect();
    let mut text = serde_json::to_string_pretty(&tags).unwrap();
    text.push('\n');
    assert_golden("examples.features.json", &text);
}
