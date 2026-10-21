//! The `reference` section and the detailed schemas: what a project with (almost) no code is
//! told about the built-in library (decision 0110).
//!
//! A project that already has code teaches the model most of this by example, and the context
//! stays as small as the neighbourhood allows. A *cold-start* project (see [`is_cold`]) has
//! nothing to learn from, and a model that is not told the field names, the enum members and the
//! argument lists invents them (`vfov`, `Key.Up`, `color.linear(r, g, b)`). So for such a project
//! the export carries, in addition to the neighbourhood:
//!
//! * every implemented schema with the documentation, the range and the rules of its fields
//!   ([`detailed_schemas`]);
//! * the [`Reference`]: which declaration takes which schema, every member of every built-in enum,
//!   the signature of every built-in function, event, record and body command, and the
//!   *conventions*.
//!
//! Everything is read from the registry. The wording is the registry's own (`doc` of the
//! schema, field, function, type or namespace); this module only chooses where to put it and how
//! to spell a signature. The *conventions* are the documentation of registry items named in
//! [`CONVENTIONS`]: the table names items, never prose, so a convention that matters is added to
//! the `doc` of the item it is about, and a test fails for a name that no longer exists.

use std::fmt::Write as _;

use super::model::{ConventionEntry, EnumEntry, Reference, SchemaEntry};
use super::program::Program;
use crate::resolve::gate::is_implemented;
use crate::stdlib::{
    BodyKind, Domain, EventForm, EventHost, IntrinsicDef, NamespaceMember, ParamDef, Registry,
    SchemaDef, TypeClass, TypeKind, TypeRef, ValueDef,
};

/// Whether the project is a cold start: it declares nothing but scenes, scene objects (cameras),
/// state and parameters, so there is no code to learn the library from. An empty project, a
/// project whose entry module does not parse and `scene Main { camera Cam {} }` are cold; one
/// entity, prefab, material, function, constant or struct makes a project warm.
#[must_use]
pub fn is_cold(program: &Program<'_>, registry: &Registry) -> bool {
    program.decls.iter().all(|decl| {
        matches!(decl.kind.as_str(), "scene" | "state" | "param")
            || registry.scene_object(&decl.kind).is_some()
    })
}

/// A registry item a convention quotes. (The lighting rules are the docs of schema fields, which the
/// detailed schemas carry in full; quoting them again would cost bytes and say nothing new.)
#[derive(Clone, Copy, Debug)]
pub enum Item {
    /// A prelude type.
    Type(&'static str),
    /// A namespace.
    Namespace(&'static str),
}

/// The conventions: a topic and the registry items whose documentation states it.
///
/// There is no prose here. To state a rule, write it in the `doc` of the item it belongs to.
pub const CONVENTIONS: &[(&str, &[Item])] = &[
    ("colour", &[Item::Type("color")]),
    ("time", &[Item::Namespace("frame")]),
];

/// The label and documentation of the item, if the registry has it and the build implements it.
fn resolve(registry: &Registry, item: Item) -> Option<(String, &'static str)> {
    match item {
        Item::Type(name) => {
            let def = registry.type_def(name)?;
            is_implemented(def.since).then(|| (name.to_owned(), def.doc))
        }
        Item::Namespace(name) => {
            let def = registry.namespace(name)?;
            is_implemented(def.since).then(|| (name.to_owned(), def.doc))
        }
    }
}

/// The conventions of the build: one entry per topic of [`CONVENTIONS`], one note per item.
#[must_use]
pub fn conventions(registry: &Registry) -> Vec<ConventionEntry> {
    CONVENTIONS
        .iter()
        .map(|(topic, items)| ConventionEntry {
            topic: (*topic).to_owned(),
            notes: items
                .iter()
                .filter_map(|item| resolve(registry, *item))
                .map(|(label, doc)| format!("{label}: {doc}"))
                .collect(),
        })
        .filter(|entry| !entry.notes.is_empty())
        .collect()
}

/// Every implemented schema that has fields, with the documentation and range of its fields,
/// sorted by name. A schema without fields (`Static`) is named by the documentation of the field
/// that takes it and adds nothing to list.
#[must_use]
pub fn detailed_schemas(registry: &Registry) -> Vec<SchemaEntry> {
    let mut schemas: Vec<&SchemaDef> = registry
        .schemas
        .iter()
        .filter(|schema| {
            is_implemented(schema.since)
                && schema
                    .fields
                    .iter()
                    .any(|field| is_implemented(field.since))
        })
        .collect();
    schemas.sort_by_key(|schema| schema.name);
    schemas
        .into_iter()
        .map(|schema| super::schema_entry(schema, true))
        .collect()
}

/// The reference section of the build.
#[must_use]
pub fn reference(registry: &Registry) -> Reference {
    let (type_classes, builtins) = builtins(registry);
    Reference {
        enums: enums(registry),
        type_classes,
        builtins,
        events: events(registry),
        records: records(registry),
        body: body(registry),
        conventions: conventions(registry),
    }
}

/// Every implemented enum with every implemented member.
fn enums(registry: &Registry) -> Vec<EnumEntry> {
    registry
        .enums
        .iter()
        .filter(|def| is_implemented(def.since))
        .map(|def| EnumEntry {
            name: def.name.to_owned(),
            doc: def.doc.to_owned(),
            members: def
                .members
                .iter()
                .filter(|member| is_implemented(member.since))
                .map(|member| member.name)
                .collect::<Vec<_>>()
                .join(" "),
        })
        .collect()
}

fn params_text(params: &[ParamDef]) -> String {
    params
        .iter()
        .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `name(a: T) -> T; name(a: I) -> I [cpu only]`, with the documentation after ` // ` when
/// `with_doc`.
fn function_line(name: &str, def: &IntrinsicDef, with_doc: bool) -> String {
    let mut line = def
        .signatures
        .iter()
        .map(|sig| format!("{name}{}", sig.text()))
        .collect::<Vec<_>>()
        .join("; ");
    let mut tags = Vec::new();
    match def.domain {
        Domain::Both => {}
        // A compile-time function (`texture.white()`, `asset.glb(..)`) runs in the compiler, so
        // its being CPU-side is no restriction on where it is written.
        Domain::Cpu if def.const_eligible => {}
        Domain::Cpu => tags.push("cpu only"),
        Domain::Gpu => tags.push("gpu only"),
    }
    if def.handlers_only {
        // Only the CPU side has handlers: the restriction subsumes `cpu only`.
        tags.clear();
        tags.push("handlers and lifecycle functions only");
    }
    if !tags.is_empty() {
        let _ = write!(line, " [{}]", tags.join(", "));
    }
    if with_doc && !def.doc.is_empty() {
        let _ = write!(line, " // {}", def.doc);
    }
    line
}

fn value_line(namespace: &str, value: &ValueDef) -> String {
    let mut line = format!("{namespace}.{}: {}", value.name, value.ty.spelling());
    match value.domain {
        Domain::Both => {}
        Domain::Cpu => line.push_str(" [cpu only]"),
        Domain::Gpu => line.push_str(" [gpu only]"),
    }
    if !value.doc.is_empty() {
        let _ = write!(line, " // {}", value.doc);
    }
    line
}

/// The type classes and the signatures of the global intrinsics and the namespace members. The
/// accessors of a `glb_asset` are left out: they apply to a value only an asset file makes (they
/// are in `supported.features` as `method:glb_asset.<name>`, and the compiler's diagnostics name
/// them).
///
/// The plain mathematical functions (global, usable on both sides) are listed by signature only:
/// their argument names and the classes say what they do. Everything else carries its
/// documentation.
fn builtins(registry: &Registry) -> (Vec<String>, Vec<String>) {
    let classes = TypeClass::ALL
        .iter()
        .map(|class| {
            let members = class
                .members()
                .iter()
                .map(TypeRef::spelling)
                .collect::<Vec<_>>()
                .join(" | ");
            format!("{} = {members}", class.name())
        })
        .collect();

    let mut lines = Vec::new();
    for namespace in registry
        .namespaces
        .iter()
        .filter(|ns| is_implemented(ns.since))
    {
        // Functions of one namespace that take nothing and give the same type are presets
        // (`sampler.linear_repeat()`): one line, no documentation, the names say the difference.
        let implemented: Vec<&NamespaceMember> = namespace
            .members
            .iter()
            .filter(|member| is_implemented(member.since()))
            .collect();
        let mut done: Vec<&'static str> = Vec::new();
        for member in &implemented {
            match member {
                NamespaceMember::Function(def)
                    if def.signatures.iter().all(|sig| sig.params.is_empty())
                        && preset_names(&implemented, def).len() > 1 =>
                {
                    if done.contains(&def.name) {
                        continue;
                    }
                    let names = preset_names(&implemented, def);
                    done.extend(names.iter().copied());
                    let name = format!("{}.{}", namespace.name, names.join("|"));
                    lines.push(function_line(&name, def, false));
                }
                NamespaceMember::Function(def) => {
                    let name = format!("{}.{}", namespace.name, def.name);
                    lines.push(function_line(&name, def, true));
                }
                NamespaceMember::Value(value) => lines.push(value_line(namespace.name, value)),
            }
        }
    }
    // The plain mathematical functions share signatures: one line per distinct signature list,
    // `a|b(x: T) -> T`. The others have a line (and their documentation) each.
    let (math, documented): (Vec<&IntrinsicDef>, Vec<&IntrinsicDef>) = registry
        .intrinsics
        .iter()
        .filter(|def| is_implemented(def.since))
        .partition(|def| def.domain == Domain::Both);
    // Global functions that take nothing and share their signatures, domain and placement are
    // presets too (`reset|pause|resume() -> ()`, decisions 0140 and 0143): one line in the place of
    // the first, no documentation.
    let mut done: Vec<&'static str> = Vec::new();
    for def in &documented {
        if done.contains(&def.name) {
            continue;
        }
        let presets: Vec<&'static str> = if def.signatures.iter().all(|sig| sig.params.is_empty()) {
            documented
                .iter()
                .filter(|other| {
                    other.signatures == def.signatures
                        && other.domain == def.domain
                        && other.handlers_only == def.handlers_only
                })
                .map(|other| other.name)
                .collect()
        } else {
            Vec::new()
        };
        if presets.len() > 1 {
            done.extend(presets.iter().copied());
            lines.push(function_line(&presets.join("|"), def, false));
        } else {
            lines.push(function_line(def.name, def, true));
        }
    }
    let mut all = grouped_lines(&math);
    all.append(&mut lines);
    (classes, all)
}

/// One line per distinct list of signatures, signature only: `min|max(a: T, b: T) -> T`.
fn grouped_lines(defs: &[&IntrinsicDef]) -> Vec<String> {
    let mut groups: Vec<(String, Vec<&IntrinsicDef>)> = Vec::new();
    for def in defs {
        let key = signatures_text(def);
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, members)) => members.push(def),
            None => groups.push((key, vec![def])),
        }
    }
    groups
        .iter()
        .filter_map(|(_, members)| {
            let names = members
                .iter()
                .map(|def| def.name)
                .collect::<Vec<_>>()
                .join("|");
            members.first().map(|def| function_line(&names, def, false))
        })
        .collect()
}

/// The names of the functions among `members` that have the signatures and domain of `def`.
fn preset_names(members: &[&NamespaceMember], def: &IntrinsicDef) -> Vec<&'static str> {
    members
        .iter()
        .filter_map(|member| match member {
            NamespaceMember::Function(other)
                if other.signatures == def.signatures && other.domain == def.domain =>
            {
                Some(other.name)
            }
            _ => None,
        })
        .collect()
}

/// The signatures of `def` without the function name: `(x: T) -> T; (x: I) -> I`.
fn signatures_text(def: &IntrinsicDef) -> String {
    def.signatures
        .iter()
        .map(|sig| sig.text())
        .collect::<Vec<_>>()
        .join("; ")
}

/// `on key_down(Key.<member>)` and `on pointer_down(<name>: PointerEvent)`, with the hosts when
/// not every body can host the handler.
fn events(registry: &Registry) -> Vec<String> {
    registry
        .events
        .iter()
        .filter(|event| is_implemented(event.since))
        .map(|event| {
            let mut line = match event.form {
                EventForm::Filter(ty) => format!("on {}({}.<member>)", event.name, ty.spelling()),
                EventForm::Parameter(ty) => {
                    format!("on {}(<name>: {})", event.name, ty.spelling())
                }
            };
            if event.hosts.len() < 3 {
                let hosts: Vec<&str> = event.hosts.iter().map(|h: &EventHost| h.as_str()).collect();
                let _ = write!(line, " [in {}", hosts.join(" and "));
                if event.requires_collider {
                    line.push_str(", needs a collider");
                }
                line.push(']');
            }
            if !event.doc.is_empty() {
                let _ = write!(line, " // {}", event.doc);
            }
            line
        })
        .collect()
}

/// `PointerEvent { position: vec2, button: i32 } // doc`.
fn records(registry: &Registry) -> Vec<String> {
    registry
        .types
        .iter()
        .filter(|ty| is_implemented(ty.since) && ty.kind == TypeKind::Record)
        .map(|ty| {
            let fields = ty
                .fields
                .iter()
                .map(|f| format!("{}: {}", f.name, f.ty.spelling()))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{} {{ {fields} }} // {}", ty.name, ty.doc)
        })
        .collect()
}

fn kinds_text(kinds: &[BodyKind]) -> String {
    kinds
        .iter()
        .map(|kind| kind.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// `<Entity>.body.apply_force(force: vec3) [Dynamic] // doc`, and the readable properties.
fn body(registry: &Registry) -> Vec<String> {
    let mut lines = Vec::new();
    for command in registry
        .body_commands
        .iter()
        .filter(|c| is_implemented(c.since))
    {
        // Signature and the bodies that take it; the name and the argument names say the rest.
        lines.push(format!(
            "<Entity>.body.{}({}) [{}]",
            command.name,
            params_text(&command.params),
            kinds_text(command.applies_to),
        ));
    }
    for property in registry
        .body_properties
        .iter()
        .filter(|p| is_implemented(p.since))
    {
        lines.push(format!(
            "<Entity>.body.{}: {} [{}] // {}",
            property.name,
            property.ty.spelling(),
            kinds_text(property.applies_to),
            property.doc
        ));
    }
    lines
}
