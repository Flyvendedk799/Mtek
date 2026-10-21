//! `supported.features` and `supported.notSupported`: what this compiler build implements,
//! derived from the build and from nothing else (`spec/ai-and-benchmarks.md` section 2,
//! decision 0072).
//!
//! The sources, each the one the compiler itself consults:
//!
//! * the **construct table** of the resolver ([`construct_gate`]): one feature per syntactic
//!   construct, named by [`feature_name`] (an exhaustive match, so a new [`Construct`] does not
//!   compile until it is named);
//! * the **registry** ([`Registry`]): every type, type method, schema, scene-object kind, event,
//!   enum, namespace, namespace member, intrinsic, body command and body property is one row with
//!   its `since`; schema fields and enum members are rows too, but only a gated one is ever
//!   listed (the fields of a schema are the `schemas` section of the context);
//! * the **hard gates** ([`HARD_GATES`]): `E9010` raised by a check of its own;
//! * the **reserved words** of the lexer ([`RESERVED_WORDS`]) and the **unsupported-feature
//!   codes** of the catalogue ([`Code::is_unsupported_feature`]), which this version of the
//!   language will never accept.
//!
//! A row whose `since` the build has reached is a *feature*; any other row is listed under
//! `notSupported` with its planned milestone. Nothing is listed by hand, so what the context says
//! follows the build: add a row to the registry and the context changes with it.

use crate::diagnostics::Code;
use crate::resolve::gate::{HARD_GATES, construct_gate};
use crate::resolve::{Construct, IMPLEMENTED_MILESTONE, PreludeItem};
use crate::stdlib::{Milestone, NamespaceMember, Registry, registry};
use crate::syntax::RESERVED_WORDS;

/// What the build implements and what it does not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Capabilities {
    /// The implemented features, in a fixed order: the constructs in the order of
    /// [`Construct::ALL`], then the registry features sorted by name.
    pub features: Vec<String>,
    /// What the build rejects: planned features (`name (planned for M5)`), then the hard gates,
    /// the reserved words and the unsupported-feature codes.
    pub not_supported: Vec<String>,
}

/// The wording of the unsupported-feature codes for an agent, by code. The *set* of codes is
/// derived from the catalogue ([`Code::is_unsupported_feature`]); this table only says what a
/// short title leaves unsaid. A test fails for a code that is missing from it, and the fallback
/// (the title without " not supported") is never used in this build.
const UNSUPPORTED_PHRASES: &[(Code, &str)] = &[
    (Code::E1901, "bitwise operators (& | ^ ~ << >>)"),
    (
        Code::E4901,
        "stage functions other than `fragment` (vertex, compute)",
    ),
    (Code::E5902, "transparency (alpha blending)"),
    (Code::E7901, "remote assets (URLs as asset paths)"),
    (
        Code::E7902,
        "instancing a whole node hierarchy of a glTF asset",
    ),
];

/// The name of a construct in `features` and `notSupported`.
///
/// An exhaustive match: a construct added to the resolver's table does not compile until it has a
/// name here.
#[must_use]
pub const fn feature_name(construct: Construct) -> &'static str {
    match construct {
        Construct::Import => "imports",
        Construct::Export => "exports",
        Construct::ConstItem => "constants",
        Construct::BodyConst => "body-constants",
        Construct::Fn => "functions",
        Construct::CpuFn => "cpu-functions",
        Construct::Struct => "structs",
        Construct::Enum => "enums",
        Construct::Material => "materials",
        Construct::Prefab => "prefabs",
        Construct::Scene => "scenes",
        Construct::SceneField => "scene-fields",
        Construct::State => "state",
        Construct::SceneObject => "scene-objects",
        Construct::Entity => "entities",
        Construct::EntityField => "entity-fields",
        Construct::PrefabInstance => "prefab-instances",
        Construct::LifecycleFn => "lifecycle-functions",
        Construct::Handler => "handlers",
        Construct::Bind => "bind",
        Construct::SelfValue => "self",
        Construct::Descriptor => "descriptors",
        Construct::StringLiteral => "strings",
        Construct::ArrayLiteral => "arrays",
        Construct::Index => "indexing",
        Construct::Negation => "negation",
        Construct::Arithmetic => "arithmetic",
        Construct::Remainder => "remainder",
        Construct::Comparison => "comparison",
        Construct::Equality => "equality",
        Construct::Logical => "logical",
        Construct::Match => "match",
    }
}

/// One row of the registry (or of the construct table) as the context sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Row {
    /// The name in `features` / `notSupported`.
    name: String,
    since: Milestone,
    /// Rows nested in another row: only meaningful while the parent is implemented.
    parent: Option<String>,
    /// Whether an implemented row is listed under `features` (fields and enum members are not).
    listed: bool,
}

impl Row {
    fn top(name: String, since: Milestone) -> Row {
        Row {
            name,
            since,
            parent: None,
            listed: true,
        }
    }

    fn child(name: String, since: Milestone, parent: &str, listed: bool) -> Row {
        Row {
            name,
            since,
            parent: Some(parent.to_owned()),
            listed,
        }
    }
}

/// Every row of the registry.
fn registry_rows(registry: &Registry) -> Vec<Row> {
    let mut rows = Vec::new();
    for def in &registry.types {
        let name = format!("type:{}", def.name);
        for method in &def.methods {
            rows.push(Row::child(
                format!("method:{}.{}", def.name, method.name),
                method.since,
                &name,
                true,
            ));
        }
        rows.push(Row::top(name, def.since));
    }
    for schema in &registry.schemas {
        let name = format!("schema:{}", schema.name);
        for field in &schema.fields {
            rows.push(Row::child(
                format!("field:{}.{}", schema.name, field.name),
                field.since,
                &name,
                false,
            ));
        }
        rows.push(Row::top(name, schema.since));
    }
    for kind in &registry.scene_objects {
        rows.push(Row::top(
            format!("scene-object:{}", kind.keyword),
            kind.since,
        ));
    }
    for event in &registry.events {
        rows.push(Row::top(format!("event:{}", event.name), event.since));
    }
    for def in &registry.enums {
        let name = format!("enum:{}", def.name);
        for member in &def.members {
            rows.push(Row::child(
                format!("enum-member:{}.{}", def.name, member.name),
                member.since,
                &name,
                false,
            ));
        }
        rows.push(Row::top(name, def.since));
    }
    for namespace in &registry.namespaces {
        let name = format!("namespace:{}", namespace.name);
        for member in &namespace.members {
            let kind = match member {
                NamespaceMember::Function(_) => "function",
                NamespaceMember::Value(_) => "value",
            };
            rows.push(Row::child(
                format!("{kind}:{}.{}", namespace.name, member.name()),
                member.since(),
                &name,
                true,
            ));
        }
        rows.push(Row::top(name, namespace.since));
    }
    for intrinsic in &registry.intrinsics {
        rows.push(Row::top(
            format!("function:{}", intrinsic.name),
            intrinsic.since,
        ));
    }
    for command in &registry.body_commands {
        rows.push(Row::top(
            format!("body-command:{}", command.name),
            command.since,
        ));
    }
    for property in &registry.body_properties {
        rows.push(Row::top(
            format!("body-property:{}", property.name),
            property.since,
        ));
    }
    rows
}

/// The feature a use of the standard-library name `item` is an instance of, named as in
/// [`Capabilities::features`]; `None` for a name the registry does not have.
#[must_use]
pub fn prelude_feature(item: PreludeItem) -> Option<String> {
    Some(match item {
        PreludeItem::Type(name) => format!("type:{name}"),
        PreludeItem::Schema(name) => format!("schema:{name}"),
        PreludeItem::Enum(name)
        | PreludeItem::EnumMember {
            enum_name: name, ..
        } => {
            format!("enum:{name}")
        }
        PreludeItem::Namespace(name) => format!("namespace:{name}"),
        PreludeItem::Function(name) => format!("function:{name}"),
        PreludeItem::NamespaceMember { namespace, member } => {
            match registry().namespace_member(namespace, member)? {
                NamespaceMember::Function(_) => format!("function:{namespace}.{member}"),
                NamespaceMember::Value(_) => format!("value:{namespace}.{member}"),
            }
        }
        PreludeItem::SceneObject(keyword) => format!("scene-object:{keyword}"),
        PreludeItem::Event(name) => format!("event:{name}"),
    })
}

/// What a build that has reached `implemented` supports, given `registry`.
///
/// [`derive`] is [`derive_for`] with the build's own registry and milestone; the parameters exist
/// so that a test can show that a changed row changes the answer.
#[must_use]
pub fn derive_for(registry: &Registry, implemented: Milestone) -> Capabilities {
    let reached = |since: Milestone| since.is_reached_by(implemented);
    let mut features: Vec<String> = Vec::new();
    let mut planned: Vec<(Milestone, String)> = Vec::new();

    for construct in Construct::ALL {
        let since = construct_gate(construct).since;
        let name = feature_name(construct);
        if reached(since) {
            features.push(name.to_owned());
        } else {
            planned.push((since, name.to_owned()));
        }
    }

    let rows = registry_rows(registry);
    let parent_reached = |row: &Row| {
        row.parent.as_ref().is_none_or(|parent| {
            rows.iter()
                .find(|candidate| candidate.name == *parent)
                .is_none_or(|parent| reached(parent.since))
        })
    };
    let mut registry_features: Vec<String> = Vec::new();
    for row in &rows {
        if !parent_reached(row) {
            // The gated parent already says it.
            continue;
        }
        if reached(row.since) {
            if row.listed {
                registry_features.push(row.name.clone());
            }
        } else {
            planned.push((row.since, row.name.clone()));
        }
    }
    registry_features.sort_unstable();
    features.extend(registry_features);

    planned.sort();
    let mut not_supported: Vec<String> = planned
        .into_iter()
        .map(|(since, name)| format!("{name} (planned for {})", since.as_str()))
        .collect();
    for gate in HARD_GATES {
        not_supported.push(match gate.since {
            Some(since) => format!("{} (planned for {})", gate.feature, since.as_str()),
            None => gate.feature.to_owned(),
        });
    }
    not_supported.extend(RESERVED_WORDS.iter().map(|word| (*word).to_owned()));
    not_supported.extend(
        Code::ALL
            .iter()
            .filter(|code| code.is_unsupported_feature())
            .map(|code| unsupported_phrase(*code)),
    );
    Capabilities {
        features,
        not_supported,
    }
}

/// What the build with `registry` and [`IMPLEMENTED_MILESTONE`] supports: the registry of
/// [`crate::stdlib::registry`] in every real use.
#[must_use]
pub fn derive(registry: &Registry) -> Capabilities {
    derive_for(registry, IMPLEMENTED_MILESTONE)
}

/// The agent-facing phrase for an unsupported-feature code.
#[must_use]
pub fn unsupported_phrase(code: Code) -> String {
    UNSUPPORTED_PHRASES
        .iter()
        .find(|(candidate, _)| *candidate == code)
        .map_or_else(
            || {
                let title = code.title();
                title
                    .strip_suffix(" not supported")
                    .unwrap_or(title)
                    .to_owned()
            },
            |(_, phrase)| (*phrase).to_owned(),
        )
}

/// The unsupported-feature codes the phrase table covers, for the test that keeps it complete.
#[must_use]
pub fn phrased_codes() -> Vec<Code> {
    UNSUPPORTED_PHRASES.iter().map(|(code, _)| *code).collect()
}
