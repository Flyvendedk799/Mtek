//! `spec/stdlib-schema.json`: the registry exported for tools (`spec/stdlib.md` section 1.2).
//!
//! The output is a pure function of the registry: arrays sorted by name, defaults as canonical
//! text, only strings, booleans and integers (no floats), two-space indentation and a trailing
//! newline. Nothing depends on the host, the clock or hash-map order.

use serde_json::{Map, Value, json};

use super::model::{
    BodyCommandDef, BodyPropertyDef, EnumDef, EventDef, EventForm, FieldDef, IntrinsicDef,
    NamespaceDef, NamespaceMember, ParamDef, Registry, SceneObjectKind, SchemaDef, TypeClass,
    TypeDef, ValueDef,
};
use crate::LANGUAGE_VERSION;

/// The version of the JSON format below. Bumped when a key is removed or changes meaning.
pub const REGISTRY_VERSION: u32 = 1;

/// Renders the registry as `stdlib-schema.json` text, ending with a newline.
pub fn export_schema_json(registry: &Registry) -> String {
    let mut root = Map::new();
    root.insert("registryVersion".to_owned(), json!(REGISTRY_VERSION));
    root.insert("languageVersion".to_owned(), json!(LANGUAGE_VERSION));
    root.insert(
        "schemas".to_owned(),
        sorted(&registry.schemas, |s| s.name, schema),
    );
    root.insert(
        "events".to_owned(),
        sorted(&registry.events, |e| e.name, event),
    );
    root.insert(
        "enums".to_owned(),
        sorted(&registry.enums, |e| e.name, enum_def),
    );
    root.insert(
        "intrinsics".to_owned(),
        sorted(&registry.intrinsics, |i| i.name, |i| function(i, None)),
    );
    root.insert(
        "namespaces".to_owned(),
        sorted(&registry.namespaces, |n| n.name, namespace),
    );
    root.insert(
        "types".to_owned(),
        sorted(&registry.types, |t| t.name, type_def),
    );
    root.insert(
        "sceneObjects".to_owned(),
        sorted(&registry.scene_objects, |k| k.keyword, scene_object),
    );
    root.insert(
        "bodyCommands".to_owned(),
        sorted(&registry.body_commands, |c| c.name, body_command),
    );
    root.insert(
        "bodyProperties".to_owned(),
        sorted(&registry.body_properties, |p| p.name, body_property),
    );
    root.insert("typeClasses".to_owned(), type_classes());
    let mut paths: Vec<&str> = registry.prelude_sources.iter().map(|(p, _)| *p).collect();
    paths.sort_unstable();
    root.insert("preludeSources".to_owned(), json!(paths));

    // The alternate `Display` of a `Value` is its two-space pretty form; unlike
    // `to_string_pretty` it cannot fail.
    format!("{:#}\n", Value::Object(root))
}

/// Maps `items` to JSON, ordered by `key`.
fn sorted<T>(items: &[T], key: impl Fn(&T) -> &'static str, render: impl Fn(&T) -> Value) -> Value {
    let mut refs: Vec<&T> = items.iter().collect();
    refs.sort_by_key(|item| key(item));
    Value::Array(refs.into_iter().map(render).collect())
}

fn schema(schema: &SchemaDef) -> Value {
    json!({
        "name": schema.name,
        "category": schema.category.as_str(),
        "since": schema.since.as_str(),
        "doc": schema.doc,
        "fields": sorted(&schema.fields, |f| f.name, field),
    })
}

fn field(field: &FieldDef) -> Value {
    let mut object = Map::new();
    object.insert("name".to_owned(), json!(field.name));
    object.insert("type".to_owned(), json!(field.ty.spelling()));
    object.insert("default".to_owned(), json!(field.default_text()));
    if let Some(sibling) = field.default_when_set {
        object.insert("defaultWhenSet".to_owned(), json!(sibling));
    }
    object.insert("required".to_owned(), json!(field.flags.is_required()));
    object.insert("writable".to_owned(), json!(field.flags.is_writable()));
    object.insert("bindable".to_owned(), json!(field.flags.is_bindable()));
    object.insert(
        "constructionOnly".to_owned(),
        json!(field.flags.is_construction_only()),
    );
    object.insert("range".to_owned(), json!(field.range_text()));
    object.insert("since".to_owned(), json!(field.since.as_str()));
    object.insert("doc".to_owned(), json!(field.doc));
    Value::Object(object)
}

fn event(event: &EventDef) -> Value {
    let (form, ty) = match event.form {
        EventForm::Filter(ty) => ("filter", ty),
        EventForm::Parameter(ty) => ("parameter", ty),
    };
    let hosts: Vec<&str> = event.hosts.iter().map(|h| h.as_str()).collect();
    json!({
        "name": event.name,
        "form": form,
        "argumentType": ty.spelling(),
        "allowedIn": hosts,
        "requiresCollider": event.requires_collider,
        "since": event.since.as_str(),
        "doc": event.doc,
    })
}

fn enum_def(def: &EnumDef) -> Value {
    let members = sorted(
        &def.members,
        |m| m.name,
        |m| json!({ "name": m.name, "code": m.code, "since": m.since.as_str() }),
    );
    json!({
        "name": def.name,
        "since": def.since.as_str(),
        "doc": def.doc,
        "members": members,
    })
}

/// A function as JSON; `kind` is added for namespace members.
fn function(function: &IntrinsicDef, kind: Option<&str>) -> Value {
    let mut object = Map::new();
    object.insert("name".to_owned(), json!(function.name));
    if let Some(kind) = kind {
        object.insert("kind".to_owned(), json!(kind));
    }
    let signatures: Vec<String> = function.signatures.iter().map(|s| s.text()).collect();
    object.insert("signatures".to_owned(), json!(signatures));
    object.insert("domain".to_owned(), json!(function.domain.as_str()));
    object.insert("constEligible".to_owned(), json!(function.const_eligible));
    object.insert("handlersOnly".to_owned(), json!(function.handlers_only));
    object.insert("cpuSemantics".to_owned(), json!(function.cpu_semantics));
    object.insert("since".to_owned(), json!(function.since.as_str()));
    object.insert("doc".to_owned(), json!(function.doc));
    Value::Object(object)
}

fn value_member(value: &ValueDef) -> Value {
    json!({
        "name": value.name,
        "kind": "value",
        "type": value.ty.spelling(),
        "domain": value.domain.as_str(),
        "since": value.since.as_str(),
        "doc": value.doc,
    })
}

fn namespace(def: &NamespaceDef) -> Value {
    let members = {
        let mut refs: Vec<&NamespaceMember> = def.members.iter().collect();
        refs.sort_by_key(|m| m.name());
        Value::Array(
            refs.into_iter()
                .map(|m| match m {
                    NamespaceMember::Function(f) => function(f, Some("function")),
                    NamespaceMember::Value(v) => value_member(v),
                })
                .collect(),
        )
    };
    json!({
        "name": def.name,
        "since": def.since.as_str(),
        "doc": def.doc,
        "members": members,
    })
}

fn type_def(def: &TypeDef) -> Value {
    let fields = Value::Array(
        def.fields
            .iter()
            .map(|f| json!({ "name": f.name, "type": f.ty.spelling() }))
            .collect(),
    );
    json!({
        "name": def.name,
        "kind": def.kind.as_str(),
        "gpu": def.gpu,
        "since": def.since.as_str(),
        "doc": def.doc,
        "fields": fields,
        "methods": sorted(&def.methods, |m| m.name, |m| function(m, None)),
    })
}

fn scene_object(kind: &SceneObjectKind) -> Value {
    json!({
        "keyword": kind.keyword,
        "schema": kind.schema,
        "since": kind.since.as_str(),
        "doc": kind.doc,
    })
}

fn params(params: &[ParamDef]) -> Value {
    Value::Array(
        params
            .iter()
            .map(|p| json!({ "name": p.name, "type": p.ty.spelling() }))
            .collect(),
    )
}

fn body_command(command: &BodyCommandDef) -> Value {
    let bodies: Vec<&str> = command.applies_to.iter().map(|b| b.as_str()).collect();
    json!({
        "name": command.name,
        "params": params(&command.params),
        "appliesTo": bodies,
        "since": command.since.as_str(),
        "doc": command.doc,
    })
}

fn body_property(property: &BodyPropertyDef) -> Value {
    let bodies: Vec<&str> = property.applies_to.iter().map(|b| b.as_str()).collect();
    json!({
        "name": property.name,
        "type": property.ty.spelling(),
        "appliesTo": bodies,
        "since": property.since.as_str(),
        "doc": property.doc,
    })
}

/// The meaning of the type letters used in the `signatures` of intrinsics.
fn type_classes() -> Value {
    let mut classes: Vec<TypeClass> = TypeClass::ALL.to_vec();
    classes.sort_by_key(|c| c.name());
    Value::Array(
        classes
            .into_iter()
            .map(|class| {
                let members: Vec<&str> = class.members().iter().map(|m| m.spelling()).collect();
                json!({ "name": class.name(), "members": members })
            })
            .collect(),
    )
}
