//! The standard library as documents and hover text (decision 0076 item 6).
//!
//! Every prelude name is defined once, in the compiler's registry (`spec/stdlib.md` section 1).
//! This module renders the registry for the editor in two ways, both from the same data:
//!
//! * **hover text** for any registry item (Markdown: a signature in a code block, the facts
//!   the registry knows, then its documentation);
//! * **virtual, read-only documents** under the `mtek-prelude:` scheme that go to definition
//!   opens for a prelude name:
//!   * `mtek-prelude:/std/materials.mtek`: the embedded Mtek source of the built-in materials
//!     (`Unlit`, `Pbr`), exactly the text the compiler compiles;
//!   * `mtek-prelude:/std/prelude.mtek`: a reference generated from the registry, one
//!     declaration per item (types, schemas and their fields, enums and their members,
//!     namespaces, functions, events, scene-object kinds, body commands and properties), each
//!     with its documentation as `///` comments. It is deterministic for a registry (a test
//!     builds it twice) and is not valid Mtek to compile: it documents, it is not imported.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use mtek_compiler::prelude::{MATERIALS_PATH, is_builtin_material, materials_text};
use mtek_compiler::resolve::PreludeItem;
use mtek_compiler::source::LineIndex;
use mtek_compiler::stdlib::{
    FieldDef, IntrinsicDef, NamespaceMember, Registry, SchemaDef, registry,
};
use mtek_compiler::syntax::ast::{ItemKind, Node};
use mtek_compiler::syntax::{lex_str, parse_module};
use mtek_compiler::diagnostics::Diagnostics;
use mtek_compiler::source::FileId;

/// The path of the generated reference document (below the `mtek-prelude:` scheme).
pub const REFERENCE_PATH: &str = "std/prelude.mtek";

/// One documented item of the registry.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum RefKey {
    Type(&'static str),
    Schema(&'static str),
    SchemaField(&'static str, &'static str),
    Enum(&'static str),
    EnumMember(&'static str, &'static str),
    Namespace(&'static str),
    NamespaceMember(&'static str, &'static str),
    Function(&'static str),
    Event(&'static str),
    SceneObject(&'static str),
    RecordField(&'static str, &'static str),
    BodyProperty(&'static str),
    BodyCommand(&'static str),
}

impl From<PreludeItem> for RefKey {
    fn from(item: PreludeItem) -> Self {
        match item {
            PreludeItem::Type(name) => RefKey::Type(name),
            PreludeItem::Schema(name) => RefKey::Schema(name),
            PreludeItem::Enum(name) => RefKey::Enum(name),
            PreludeItem::Namespace(name) => RefKey::Namespace(name),
            PreludeItem::Function(name) => RefKey::Function(name),
            PreludeItem::NamespaceMember { namespace, member } => {
                RefKey::NamespaceMember(namespace, member)
            }
            PreludeItem::EnumMember { enum_name, member } => RefKey::EnumMember(enum_name, member),
            PreludeItem::SceneObject(keyword) => RefKey::SceneObject(keyword),
            PreludeItem::Event(name) => RefKey::Event(name),
        }
    }
}

/// A virtual document: its path below the scheme and its text.
pub struct VirtualDoc {
    pub path: &'static str,
    pub text: Arc<str>,
    pub lines: LineIndex,
}

/// Where an item is defined: a virtual document and a byte range in it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Location {
    pub path: &'static str,
    pub start: u32,
    pub end: u32,
}

/// The generated reference: its text and where each item's name is in it.
struct Reference {
    doc: VirtualDoc,
    spans: BTreeMap<RefKey, (u32, u32)>,
}

/// The text of `materials.mtek` and the span of each material's name in it.
struct Materials {
    doc: VirtualDoc,
    spans: BTreeMap<&'static str, (u32, u32)>,
}

fn reference() -> &'static Reference {
    static REFERENCE: OnceLock<Reference> = OnceLock::new();
    REFERENCE.get_or_init(|| build_reference(registry()))
}

fn materials() -> Option<&'static Materials> {
    static MATERIALS: OnceLock<Option<Materials>> = OnceLock::new();
    MATERIALS.get_or_init(build_materials).as_ref()
}

/// The virtual document at `path` (`std/materials.mtek`, `std/prelude.mtek`).
pub fn document(path: &str) -> Option<&'static VirtualDoc> {
    if path == REFERENCE_PATH {
        Some(&reference().doc)
    } else if path == MATERIALS_PATH {
        materials().map(|materials| &materials.doc)
    } else {
        None
    }
}

/// Where `key` is defined. A built-in material is defined in its Mtek source; everything else
/// in the generated reference.
pub fn location(key: RefKey) -> Option<Location> {
    if let RefKey::Schema(name) = key
        && is_builtin_material(name)
        && let Some(materials) = materials()
        && let Some(&(start, end)) = materials.spans.get(name)
    {
        return Some(Location {
            path: MATERIALS_PATH,
            start,
            end,
        });
    }
    let reference = reference();
    let &(start, end) = reference.spans.get(&key)?;
    Some(Location {
        path: REFERENCE_PATH,
        start,
        end,
    })
}

fn build_materials() -> Option<Materials> {
    let text = materials_text()?;
    let lexed = lex_str(FileId(0), text);
    let mut sink = Diagnostics::new();
    let parsed = parse_module(text, &lexed.tokens, &lexed.trivia, &mut sink);
    let mut spans = BTreeMap::new();
    for item in &parsed.module.items {
        if let ItemKind::Material(decl) = &item.kind {
            let span = decl.name.span();
            if let Some(schema) = registry().schema(&decl.name.name) {
                spans.insert(schema.name, (span.start, span.end));
            }
        }
    }
    Some(Materials {
        doc: VirtualDoc {
            path: MATERIALS_PATH,
            text: Arc::from(text),
            lines: LineIndex::new(Arc::from(text)),
        },
        spans,
    })
}

// ---------------------------------------------------------------------------
// The generated reference document
// ---------------------------------------------------------------------------

/// Builds the text and records where names are.
struct Writer {
    text: String,
    spans: BTreeMap<RefKey, (u32, u32)>,
}

impl Writer {
    fn line(&mut self, indent: usize, text: &str) {
        for _ in 0..indent {
            self.text.push_str("    ");
        }
        self.text.push_str(text);
        self.text.push('\n');
    }

    fn doc(&mut self, indent: usize, doc: &str) {
        for line in doc.lines() {
            if line.is_empty() {
                self.line(indent, "///");
            } else {
                self.line(indent, &format!("/// {line}"));
            }
        }
    }

    fn blank(&mut self) {
        self.text.push('\n');
    }

    /// A declaration line `prefix name suffix`; `key` is recorded at `name`.
    fn declaration(&mut self, indent: usize, key: RefKey, prefix: &str, name: &str, suffix: &str) {
        for _ in 0..indent {
            self.text.push_str("    ");
        }
        self.text.push_str(prefix);
        let start = self.text.len();
        self.text.push_str(name);
        let end = self.text.len();
        self.text.push_str(suffix);
        self.text.push('\n');
        if let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end)) {
            self.spans.entry(key).or_insert((start, end));
        }
    }
}

fn build_reference(registry: &'static Registry) -> Reference {
    let mut w = Writer {
        text: String::new(),
        spans: BTreeMap::new(),
    };
    w.line(0, "// The Mtek standard library, as the compiler's registry defines it.");
    w.line(0, "// This document is generated by `mtek lsp`, is read-only and is not part of any project:");
    w.line(0, "// it describes the names every program can use; it is not source code to compile.");
    w.blank();

    section(&mut w, "Types");
    for ty in &registry.types {
        w.doc(0, ty.doc);
        let suffix = if ty.fields.is_empty() && ty.methods.is_empty() {
            format!(";  // {}", ty.kind.as_str())
        } else {
            " {".to_owned()
        };
        w.declaration(0, RefKey::Type(ty.name), "type ", ty.name, &suffix);
        if !(ty.fields.is_empty() && ty.methods.is_empty()) {
            for field in &ty.fields {
                w.declaration(
                    1,
                    RefKey::RecordField(ty.name, field.name),
                    "",
                    field.name,
                    &format!(": {};", field.ty.spelling()),
                );
            }
            for method in &ty.methods {
                w.doc(1, method.doc);
                for sig in &method.signatures {
                    w.declaration(
                        1,
                        RefKey::Function(method.name),
                        "fn ",
                        method.name,
                        &format!("{};", sig.text()),
                    );
                }
            }
            w.line(0, "}");
        }
        w.blank();
    }

    section(&mut w, "Schemas");
    for schema in &registry.schemas {
        w.doc(0, schema.doc);
        w.declaration(
            0,
            RefKey::Schema(schema.name),
            "schema ",
            schema.name,
            &format!(" {{  // {}", schema.category.as_str()),
        );
        for field in &schema.fields {
            w.doc(1, field.doc);
            w.declaration(
                1,
                RefKey::SchemaField(schema.name, field.name),
                "",
                field.name,
                &field_declaration_suffix(field),
            );
        }
        w.line(0, "}");
        w.blank();
    }

    section(&mut w, "Enums");
    for e in &registry.enums {
        w.doc(0, e.doc);
        w.declaration(0, RefKey::Enum(e.name), "enum ", e.name, " {");
        for member in &e.members {
            w.declaration(
                1,
                RefKey::EnumMember(e.name, member.name),
                "",
                member.name,
                &format!(",  // KeyboardEvent.code \"{}\"", member.code),
            );
        }
        w.line(0, "}");
        w.blank();
    }

    section(&mut w, "Namespaces");
    for namespace in &registry.namespaces {
        w.doc(0, namespace.doc);
        w.declaration(0, RefKey::Namespace(namespace.name), "namespace ", namespace.name, " {");
        for member in &namespace.members {
            match member {
                NamespaceMember::Function(function) => {
                    w.doc(1, function.doc);
                    for sig in &function.signatures {
                        w.declaration(
                            1,
                            RefKey::NamespaceMember(namespace.name, function.name),
                            "fn ",
                            function.name,
                            &format!("{};{}", sig.text(), intrinsic_notes(function)),
                        );
                    }
                }
                NamespaceMember::Value(value) => {
                    w.doc(1, value.doc);
                    w.declaration(
                        1,
                        RefKey::NamespaceMember(namespace.name, value.name),
                        "",
                        value.name,
                        &format!(": {};  // domain: {}", value.ty.spelling(), value.domain.as_str()),
                    );
                }
            }
        }
        w.line(0, "}");
        w.blank();
    }

    section(&mut w, "Functions");
    for function in &registry.intrinsics {
        w.doc(0, function.doc);
        for sig in &function.signatures {
            w.declaration(
                0,
                RefKey::Function(function.name),
                "fn ",
                function.name,
                &format!("{};{}", sig.text(), intrinsic_notes(function)),
            );
        }
        w.blank();
    }

    section(&mut w, "Events");
    for event in &registry.events {
        w.doc(0, event.doc);
        w.declaration(
            0,
            RefKey::Event(event.name),
            "on ",
            event.name,
            &format!("({});  // {}", event_form(event), hosts(event)),
        );
        w.blank();
    }

    section(&mut w, "Scene objects");
    for kind in &registry.scene_objects {
        w.doc(0, kind.doc);
        w.declaration(
            0,
            RefKey::SceneObject(kind.keyword),
            "object ",
            kind.keyword,
            &format!(" Name;  // fields of the schema {}", kind.schema),
        );
        w.blank();
    }

    section(&mut w, "Body properties and commands");
    for property in &registry.body_properties {
        w.doc(0, property.doc);
        w.declaration(
            0,
            RefKey::BodyProperty(property.name),
            "Name.body.",
            property.name,
            &format!(": {};  // read-only", property.ty.spelling()),
        );
        w.blank();
    }
    for command in &registry.body_commands {
        w.doc(0, command.doc);
        let params = command
            .params
            .iter()
            .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
            .collect::<Vec<_>>()
            .join(", ");
        w.declaration(
            0,
            RefKey::BodyCommand(command.name),
            "Name.body.",
            command.name,
            &format!("({params});"),
        );
        w.blank();
    }

    let text: Arc<str> = Arc::from(w.text);
    Reference {
        doc: VirtualDoc {
            path: REFERENCE_PATH,
            lines: LineIndex::new(Arc::clone(&text)),
            text,
        },
        spans: w.spans,
    }
}

fn section(w: &mut Writer, title: &str) {
    w.line(0, &format!("// ---- {title} ----"));
    w.blank();
}

/// `: type = default;  // flags` for a schema field of the reference.
fn field_declaration_suffix(field: &FieldDef) -> String {
    let facts = field_facts(field);
    let comment = if facts.is_empty() {
        String::new()
    } else {
        format!("  // {}", facts.join(", "))
    };
    format!("{};{comment}", field_type_and_default(field))
}

/// The registry's flags and range of a field, as words.
fn field_facts(field: &FieldDef) -> Vec<String> {
    let mut facts = Vec::new();
    if field.flags.is_required() {
        facts.push("required".to_owned());
    }
    if field.flags.is_writable() {
        facts.push("writable".to_owned());
    }
    if field.flags.is_bindable() {
        facts.push("bindable".to_owned());
    }
    if field.flags.is_construction_only() {
        facts.push("construction-only".to_owned());
    }
    if let Some(range) = field.range_text() {
        facts.push(format!("range {range}"));
    }
    facts
}

fn intrinsic_notes(function: &IntrinsicDef) -> String {
    let mut notes = vec![format!("domain: {}", function.domain.as_str())];
    if function.const_eligible {
        notes.push("const".to_owned());
    }
    if function.handlers_only {
        notes.push("handlers only".to_owned());
    }
    format!("  // {}", notes.join(", "))
}

fn event_form(event: &mtek_compiler::stdlib::EventDef) -> String {
    use mtek_compiler::stdlib::EventForm;
    match event.form {
        EventForm::Filter(ty) => ty.spelling().to_owned(),
        EventForm::Parameter(ty) => format!("event: {}", ty.spelling()),
    }
}

fn hosts(event: &mtek_compiler::stdlib::EventDef) -> String {
    let hosts: Vec<&str> = event.hosts.iter().map(|host| host.as_str()).collect();
    let mut text = format!("in a {}", hosts.join(", "));
    if event.requires_collider {
        text.push_str("; the host needs a collider");
    }
    text
}

// ---------------------------------------------------------------------------
// Hover text
// ---------------------------------------------------------------------------

fn code(text: &str) -> String {
    format!("```mtek\n{text}\n```")
}

fn with_doc(head: String, facts: &[String], doc: &str) -> String {
    let mut out = head;
    if !facts.is_empty() {
        out.push_str("\n\n");
        out.push_str(&facts.join("  \n"));
    }
    if !doc.is_empty() {
        out.push_str("\n\n");
        out.push_str(doc);
    }
    out
}

/// The Markdown shown when hovering over the registry item `key`.
pub fn hover(key: RefKey) -> Option<String> {
    let registry = registry();
    match key {
        RefKey::Type(name) => {
            let ty = registry.type_def(name)?;
            let mut facts = vec![format!("a {} type", ty.kind.as_str())];
            if !ty.gpu {
                facts.push("CPU only".to_owned());
            }
            if !ty.fields.is_empty() {
                let fields: Vec<String> = ty
                    .fields
                    .iter()
                    .map(|f| format!("`{}: {}`", f.name, f.ty.spelling()))
                    .collect();
                facts.push(format!("fields: {}", fields.join(", ")));
            }
            Some(with_doc(code(&format!("type {name}")), &facts, ty.doc))
        }
        RefKey::Schema(name) => {
            let schema = registry.schema(name)?;
            Some(schema_hover(schema))
        }
        RefKey::SchemaField(schema, field) => {
            let field = registry.schema_field(schema, field)?;
            let mut facts = vec![format!("field of `{schema}`")];
            facts.extend(field_facts(field));
            Some(with_doc(
                code(&format!("{}{}", field.name, field_type_and_default(field))),
                &facts,
                field.doc,
            ))
        }
        RefKey::Enum(name) => {
            let e = registry.enum_def(name)?;
            Some(with_doc(
                code(&format!("enum {name}")),
                &[format!("{} members", e.members.len())],
                e.doc,
            ))
        }
        RefKey::EnumMember(enum_name, member) => {
            let m = registry.enum_member(enum_name, member)?;
            Some(code(&format!("{enum_name}.{}", m.name))
                + &format!("\n\nThe key with the DOM `KeyboardEvent.code` `{}`.", m.code))
        }
        RefKey::Namespace(name) => {
            let ns = registry.namespace(name)?;
            let members: Vec<String> = ns.members.iter().map(|m| format!("`{}`", m.name())).collect();
            Some(with_doc(
                code(&format!("namespace {name}")),
                &[format!("members: {}", members.join(", "))],
                ns.doc,
            ))
        }
        RefKey::NamespaceMember(namespace, member) => {
            match registry.namespace_member(namespace, member)? {
                NamespaceMember::Function(function) => {
                    Some(function_hover(function, &format!("{namespace}.")))
                }
                NamespaceMember::Value(value) => Some(with_doc(
                    code(&format!("{namespace}.{}: {}", value.name, value.ty.spelling())),
                    &[format!("domain: {}", value.domain.as_str())],
                    value.doc,
                )),
            }
        }
        RefKey::Function(name) => {
            let function = registry.intrinsic(name)?;
            Some(function_hover(function, ""))
        }
        RefKey::Event(name) => {
            let event = registry.event(name)?;
            Some(with_doc(
                code(&format!("on {name}({})", event_form(event))),
                &[hosts(event)],
                event.doc,
            ))
        }
        RefKey::SceneObject(keyword) => {
            let kind = registry.scene_object(keyword)?;
            Some(with_doc(
                code(&format!("{keyword} Name {{ .. }}")),
                &[format!("a scene object with the fields of `{}`", kind.schema)],
                kind.doc,
            ))
        }
        RefKey::RecordField(record, field) => {
            let ty = registry
                .type_def(record)?
                .fields
                .iter()
                .find(|f| f.name == field)?
                .ty;
            Some(code(&format!("{field}: {}", ty.spelling())) + &format!("\n\nfield of `{record}`"))
        }
        RefKey::BodyProperty(name) => {
            let property = registry.body_property(name)?;
            Some(with_doc(
                code(&format!("Name.body.{name}: {}", property.ty.spelling())),
                &["a read-only property of a physics body".to_owned()],
                property.doc,
            ))
        }
        RefKey::BodyCommand(name) => {
            let command = registry.body_command(name)?;
            let params = command
                .params
                .iter()
                .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
                .collect::<Vec<_>>()
                .join(", ");
            Some(with_doc(
                code(&format!("Name.body.{name}({params})")),
                &["a command of a physics body (handlers only)".to_owned()],
                command.doc,
            ))
        }
    }
}

fn field_type_and_default(field: &FieldDef) -> String {
    let mut out = format!(": {}", field.ty.spelling());
    if let Some(default) = field.default_text() {
        out.push_str(&format!(" = {default}"));
    }
    out
}

fn schema_hover(schema: &SchemaDef) -> String {
    let mut facts = vec![format!("a {} schema", schema.category.as_str())];
    let fields: Vec<String> = schema
        .fields
        .iter()
        .map(|f| format!("- `{}{}`", f.name, field_type_and_default(f)))
        .collect();
    if !fields.is_empty() {
        facts.push(format!("fields:\n\n{}", fields.join("\n")));
    }
    with_doc(code(&format!("schema {}", schema.name)), &facts, schema.doc)
}

fn function_hover(function: &IntrinsicDef, prefix: &str) -> String {
    let signatures: Vec<String> = function
        .signatures
        .iter()
        .map(|sig| format!("fn {prefix}{}{}", function.name, sig.text()))
        .collect();
    let mut facts = vec![format!("domain: {}", function.domain.as_str())];
    if function.const_eligible {
        facts.push("usable in constant expressions".to_owned());
    }
    if function.handlers_only {
        facts.push("only in lifecycle functions and handlers".to_owned());
    }
    if !function.cpu_semantics.is_empty() {
        facts.push(format!("CPU: {}", function.cpu_semantics));
    }
    with_doc(code(&signatures.join("\n")), &facts, function.doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slice(doc: &VirtualDoc, start: u32, end: u32) -> &str {
        doc.text.get(start as usize..end as usize).unwrap_or("?")
    }

    #[test]
    fn the_reference_is_deterministic_and_complete() {
        let again = build_reference(registry());
        assert_eq!(reference().doc.text, again.doc.text);
        assert_eq!(reference().spans, again.spans);
        let registry = registry();
        let spans = &reference().spans;
        for ty in &registry.types {
            assert!(spans.contains_key(&RefKey::Type(ty.name)), "type {}", ty.name);
        }
        for schema in &registry.schemas {
            assert!(spans.contains_key(&RefKey::Schema(schema.name)), "{}", schema.name);
            for field in &schema.fields {
                assert!(
                    spans.contains_key(&RefKey::SchemaField(schema.name, field.name)),
                    "{}.{}",
                    schema.name,
                    field.name
                );
            }
        }
        for e in &registry.enums {
            for member in &e.members {
                assert!(spans.contains_key(&RefKey::EnumMember(e.name, member.name)));
            }
        }
        for function in &registry.intrinsics {
            assert!(spans.contains_key(&RefKey::Function(function.name)));
        }
        for event in &registry.events {
            assert!(spans.contains_key(&RefKey::Event(event.name)));
        }
        for kind in &registry.scene_objects {
            assert!(spans.contains_key(&RefKey::SceneObject(kind.keyword)));
        }
    }

    #[test]
    fn every_span_names_its_item_in_the_text() {
        let doc = &reference().doc;
        for (key, &(start, end)) in &reference().spans {
            let name = match key {
                RefKey::Type(n)
                | RefKey::Schema(n)
                | RefKey::Enum(n)
                | RefKey::Namespace(n)
                | RefKey::Function(n)
                | RefKey::Event(n)
                | RefKey::SceneObject(n)
                | RefKey::BodyProperty(n)
                | RefKey::BodyCommand(n) => n,
                RefKey::SchemaField(_, n)
                | RefKey::EnumMember(_, n)
                | RefKey::NamespaceMember(_, n)
                | RefKey::RecordField(_, n) => n,
            };
            assert_eq!(slice(doc, start, end), *name, "{key:?}");
        }
    }

    #[test]
    fn a_builtin_material_is_defined_in_its_source_and_other_items_in_the_reference() {
        let pbr = location(RefKey::Schema("Pbr")).unwrap();
        assert_eq!(pbr.path, MATERIALS_PATH);
        let doc = document(pbr.path).unwrap();
        assert_eq!(slice(doc, pbr.start, pbr.end), "Pbr");
        assert!(doc.text.contains("export material Pbr"));
        let boxed = location(RefKey::Schema("Box")).unwrap();
        assert_eq!(boxed.path, REFERENCE_PATH);
        let reference_doc = document(boxed.path).unwrap();
        assert_eq!(slice(reference_doc, boxed.start, boxed.end), "Box");
        let size = location(RefKey::SchemaField("Box", "size")).unwrap();
        assert_eq!(slice(reference_doc, size.start, size.end), "size");
        assert!(location(RefKey::Type("nope")).is_none());
        assert!(document("std/other.mtek").is_none());
    }

    #[test]
    fn the_reference_documents_every_item_with_its_doc_comment() {
        let text = &reference().doc.text;
        assert!(text.contains("schema Box {  // mesh"), "{text}");
        assert!(text.contains("enum Key {"));
        assert!(text.contains("namespace frame {"));
        assert!(text.contains("fn smoothstep("));
        assert!(text.contains("on key_down(Key);"));
        assert!(text.contains("object camera Name;"));
        // The doc comment of the registry is the `///` block above the declaration.
        let doc = registry().schema("Box").unwrap().doc;
        assert!(text.contains(&format!("/// {}\nschema Box", doc.lines().next().unwrap())));
    }

    #[test]
    fn hover_text_has_a_signature_the_facts_and_the_doc() {
        let smoothstep = hover(RefKey::Function("smoothstep")).unwrap();
        assert!(smoothstep.starts_with("```mtek\nfn smoothstep("), "{smoothstep}");
        assert!(smoothstep.contains("domain: "));
        let size = hover(RefKey::SchemaField("Box", "size")).unwrap();
        assert!(size.starts_with("```mtek\nsize: vec3 = vec3(1.0, 1.0, 1.0)\n```"), "{size}");
        assert!(size.contains("field of `Box`"));
        let space = hover(RefKey::EnumMember("Key", "Space")).unwrap();
        assert!(space.contains("Key.Space") && space.contains("`Space`"));
        let time = hover(RefKey::NamespaceMember("frame", "time")).unwrap();
        assert!(time.contains("frame.time: f32"), "{time}");
        let event = hover(RefKey::Event("key_down")).unwrap();
        assert!(event.contains("on key_down(Key)"), "{event}");
        let camera = hover(RefKey::SceneObject("camera")).unwrap();
        assert!(camera.contains("Camera"), "{camera}");
        let surface = hover(RefKey::RecordField("SurfaceInput", "uv")).unwrap();
        assert!(surface.contains("uv: vec2"), "{surface}");
        assert!(hover(RefKey::Type("vec3")).unwrap().contains("type vec3"));
        assert!(hover(RefKey::Enum("Key")).unwrap().contains("enum Key"));
        assert!(hover(RefKey::Namespace("quat")).unwrap().contains("`identity`"));
        assert!(hover(RefKey::Schema("Pbr")).unwrap().contains("base_color"));
        assert!(hover(RefKey::Function("nope")).is_none());
    }

    #[test]
    fn every_registry_item_has_hover_text() {
        let registry = registry();
        for ty in &registry.types {
            assert!(hover(RefKey::Type(ty.name)).is_some(), "{}", ty.name);
        }
        for schema in &registry.schemas {
            assert!(hover(RefKey::Schema(schema.name)).is_some());
            for field in &schema.fields {
                assert!(hover(RefKey::SchemaField(schema.name, field.name)).is_some());
            }
        }
        for function in &registry.intrinsics {
            assert!(hover(RefKey::Function(function.name)).is_some());
        }
        for ns in &registry.namespaces {
            for member in &ns.members {
                assert!(hover(RefKey::NamespaceMember(ns.name, member.name())).is_some());
            }
        }
        for event in &registry.events {
            assert!(hover(RefKey::Event(event.name)).is_some());
        }
        for property in &registry.body_properties {
            assert!(hover(RefKey::BodyProperty(property.name)).is_some());
        }
        for command in &registry.body_commands {
            assert!(hover(RefKey::BodyCommand(command.name)).is_some());
        }
    }
}
