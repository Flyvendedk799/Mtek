//! Internal consistency of the registry tables.
//!
//! The registry is hand-written data; [`Registry::validate`] checks the invariants every
//! consumer relies on, so a typo in a table fails a test instead of mis-checking programs.

use std::collections::BTreeSet;

use super::model::{
    EventForm, FieldDef, FieldRule, IntrinsicDef, NamespaceMember, Registry, SceneObjectKind,
    SchemaCategory, SchemaDef, SigType, Signature, TypeKind, TypeRef,
};
use super::value::ConstValue;
use crate::diagnostics::{Code, Severity};

/// Whether `code` is an error of the scene and schema range (`5xxx`), the only codes the
/// registry's rules may name.
fn is_scene_error(code: Code) -> bool {
    code.range() == 5 && code.severity() == Severity::Error
}

/// The type a descriptor of a schema of `category` has.
pub fn descriptor_type(category: SchemaCategory) -> TypeRef {
    match category {
        SchemaCategory::Mesh => TypeRef::Mesh,
        SchemaCategory::Material => TypeRef::Material,
        other => TypeRef::Descriptor(other),
    }
}

/// Reports every name that occurs twice in `names`.
fn duplicates<'a>(what: &str, names: impl Iterator<Item = &'a str>, problems: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    for name in names {
        if !seen.insert(name) {
            problems.push(format!("duplicate {what} `{name}`"));
        }
    }
}

impl Registry {
    /// Checks the registry's internal consistency. An empty result means the tables are
    /// well-formed; each entry describes one violated invariant.
    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        self.validate_names(&mut problems);
        self.validate_declaration_schemas(&mut problems);
        for schema in &self.schemas {
            self.validate_schema(schema, &mut problems);
        }
        for kind in &self.scene_objects {
            self.validate_scene_object(kind, &mut problems);
        }
        self.validate_events(&mut problems);
        self.validate_enums(&mut problems);
        self.validate_functions(&mut problems);
        self.validate_types(&mut problems);
        self.validate_physics(&mut problems);
        if self.prelude_sources.is_empty() {
            problems.push("no prelude sources".to_owned());
        }
        duplicates(
            "prelude source",
            self.prelude_sources.iter().map(|(path, _)| *path),
            &mut problems,
        );
        problems
    }

    fn validate_names(&self, problems: &mut Vec<String>) {
        duplicates("type", self.types.iter().map(|t| t.name), problems);
        duplicates("schema", self.schemas.iter().map(|s| s.name), problems);
        duplicates(
            "scene object",
            self.scene_objects.iter().map(|k| k.keyword),
            problems,
        );
        duplicates("event", self.events.iter().map(|e| e.name), problems);
        duplicates("enum", self.enums.iter().map(|e| e.name), problems);
        duplicates(
            "intrinsic",
            self.intrinsics.iter().map(|i| i.name),
            problems,
        );
        duplicates(
            "namespace",
            self.namespaces.iter().map(|n| n.name),
            problems,
        );
        duplicates(
            "body command",
            self.body_commands.iter().map(|c| c.name),
            problems,
        );
        duplicates(
            "body property",
            self.body_properties.iter().map(|p| p.name),
            problems,
        );
        // A name may be a type and a namespace (`color`); nothing else may share a name.
        let mut owners: std::collections::BTreeMap<&str, Vec<&str>> = Default::default();
        let mut claim = |name: &'static str, owner: &'static str| {
            owners.entry(name).or_default().push(owner);
        };
        for t in &self.types {
            claim(t.name, "type");
        }
        for s in &self.schemas {
            claim(s.name, "schema");
        }
        for e in &self.enums {
            claim(e.name, "enum");
        }
        for n in &self.namespaces {
            claim(n.name, "namespace");
        }
        for i in &self.intrinsics {
            claim(i.name, "function");
        }
        for (name, kinds) in owners {
            let mut kinds = kinds;
            kinds.sort_unstable();
            if kinds != ["namespace", "type"] && kinds.len() > 1 {
                problems.push(format!("prelude name `{name}` is used as {kinds:?}"));
            }
        }
    }

    fn validate_schema(&self, schema: &SchemaDef, problems: &mut Vec<String>) {
        let name = schema.name;
        duplicates(
            &format!("field of `{name}`"),
            schema.fields.iter().map(|f| f.name),
            problems,
        );
        for field in &schema.fields {
            self.validate_field(schema, field, problems);
        }
        self.validate_rules(schema, problems);
    }

    fn validate_field(&self, schema: &SchemaDef, field: &FieldDef, problems: &mut Vec<String>) {
        let at = format!("{}.{}", schema.name, field.name);
        if field.since < schema.since {
            problems.push(format!("{at}: field is older than its schema"));
        }
        if field.flags.is_construction_only()
            && (field.flags.is_writable() || field.flags.is_bindable())
        {
            problems.push(format!(
                "{at}: construction-only field is writable or bindable"
            ));
        }
        if field.flags.is_required() && field.default.is_some() {
            problems.push(format!("{at}: required field has a default"));
        }
        if field.doc.is_empty() {
            problems.push(format!("{at}: missing documentation"));
        }
        if let Some(sibling) = field.default_when_set {
            if field.default.is_none() {
                problems.push(format!("{at}: default_when_set without a default"));
            }
            if schema.field(sibling).is_none() {
                problems.push(format!(
                    "{at}: default_when_set names unknown field `{sibling}`"
                ));
            }
        }
        if let Some(default) = field.default {
            self.validate_default(&at, field, default, problems);
        }
        if !is_scene_error(field.range_code) {
            problems.push(format!(
                "{at}: range code {} is not a scene error code",
                field.range_code
            ));
        }
        if field.range.is_none() && field.range_code != Code::E5006 {
            problems.push(format!("{at}: range code without a range"));
        }
        if let Some(range) = field.range {
            let numeric = matches!(
                field.ty,
                TypeRef::F32
                    | TypeRef::U32
                    | TypeRef::I32
                    | TypeRef::Vec2
                    | TypeRef::Vec3
                    | TypeRef::Vec4
            );
            if !numeric {
                problems.push(format!("{at}: range on a non-numeric type"));
            }
            if let Some(sibling) = range.greater_than_field {
                match schema.field(sibling) {
                    None => problems.push(format!("{at}: range names unknown field `{sibling}`")),
                    Some(other) if other.ty != field.ty => {
                        problems.push(format!(
                            "{at}: range compares with `{sibling}` of another type"
                        ));
                    }
                    Some(_) => {}
                }
            }
            if let Some(default) = field.default {
                for component in numeric_components(&default) {
                    if !range.contains(component) {
                        problems.push(format!("{at}: default violates the field's range"));
                    }
                }
            }
        }
    }

    fn validate_default(
        &self,
        at: &str,
        field: &FieldDef,
        default: ConstValue,
        problems: &mut Vec<String>,
    ) {
        if !default.is_finite() {
            problems.push(format!("{at}: default is not finite"));
        }
        match default {
            ConstValue::EmptyDescriptor(schema_name) => match self.schema(schema_name) {
                None => problems.push(format!(
                    "{at}: default names unknown schema `{schema_name}`"
                )),
                Some(schema) => {
                    if descriptor_type(schema.category) != field.ty {
                        problems.push(format!(
                            "{at}: default descriptor `{schema_name}` has another type"
                        ));
                    }
                }
            },
            other => {
                if other.value_type() != Some(field.ty) {
                    problems.push(format!("{at}: default does not have the field's type"));
                }
            }
        }
    }

    fn validate_scene_object(&self, kind: &SceneObjectKind, problems: &mut Vec<String>) {
        let schema = match self.schema(kind.schema) {
            None => {
                problems.push(format!(
                    "scene object `{}`: unknown schema `{}`",
                    kind.keyword, kind.schema
                ));
                return;
            }
            Some(schema) => schema,
        };
        if schema.category != SchemaCategory::Object {
            problems.push(format!(
                "scene object `{}`: schema is not an object schema",
                kind.keyword
            ));
        }
        if let Some(active) = kind.active {
            match schema.field(active.field) {
                Some(field) if field.ty == TypeRef::Bool => {}
                Some(_) => problems.push(format!(
                    "scene object `{}`: active field `{}` is not a bool",
                    kind.keyword, active.field
                )),
                None => problems.push(format!(
                    "scene object `{}`: unknown active field `{}`",
                    kind.keyword, active.field
                )),
            }
            for code in [active.missing, active.ambiguous] {
                if !is_scene_error(code) {
                    problems.push(format!(
                        "scene object `{}`: {code} is not a scene error code",
                        kind.keyword
                    ));
                }
            }
        }
    }

    fn validate_declaration_schemas(&self, problems: &mut Vec<String>) {
        let schemas = self.declaration_schemas;
        for (what, name) in [("scene", schemas.scene), ("entity", schemas.entity)] {
            match self.schema(name) {
                None => problems.push(format!("{what} declarations: unknown schema `{name}`")),
                Some(schema) if schema.category != SchemaCategory::Object => problems.push(
                    format!("{what} declarations: schema `{name}` is not an object schema"),
                ),
                Some(_) => {}
            }
        }
    }

    fn validate_rules(&self, schema: &SchemaDef, problems: &mut Vec<String>) {
        for rule in &schema.rules {
            let (field, other, code) = match *rule {
                FieldRule::Requires {
                    field,
                    requires,
                    code,
                } => (field, requires, code),
                FieldRule::ExcludedBy {
                    field,
                    excluded_by,
                    code,
                } => (field, excluded_by, code),
            };
            let at = format!("{}: rule on `{field}`", schema.name);
            for name in [field, other] {
                if schema.field(name).is_none() {
                    problems.push(format!("{at} names unknown field `{name}`"));
                }
            }
            if field == other {
                problems.push(format!("{at} relates the field to itself"));
            }
            if !is_scene_error(code) {
                problems.push(format!("{at}: {code} is not a scene error code"));
            }
        }
    }

    fn validate_events(&self, problems: &mut Vec<String>) {
        for event in &self.events {
            if event.hosts.is_empty() {
                problems.push(format!("event `{}`: no allowed hosts", event.name));
            }
            if event.doc.is_empty() {
                problems.push(format!("event `{}`: missing documentation", event.name));
            }
            match event.form {
                EventForm::Filter(TypeRef::Enum(name)) => {
                    if self.enum_def(name).is_none() {
                        problems.push(format!("event `{}`: unknown enum `{name}`", event.name));
                    }
                }
                EventForm::Filter(_) => {
                    problems.push(format!("event `{}`: filter must be an enum", event.name));
                }
                EventForm::Parameter(TypeRef::Record(name)) => {
                    if self
                        .type_def(name)
                        .is_none_or(|t| t.kind != TypeKind::Record)
                    {
                        problems.push(format!("event `{}`: unknown record `{name}`", event.name));
                    }
                }
                EventForm::Parameter(_) => {}
            }
        }
    }

    fn validate_enums(&self, problems: &mut Vec<String>) {
        for def in &self.enums {
            duplicates(
                &format!("member of `{}`", def.name),
                def.members.iter().map(|m| m.name),
                problems,
            );
            duplicates(
                &format!("code of `{}`", def.name),
                def.members.iter().map(|m| m.code),
                problems,
            );
            if def.members.iter().any(|m| m.since < def.since) {
                problems.push(format!("enum `{}`: member older than the enum", def.name));
            }
        }
    }

    fn validate_functions(&self, problems: &mut Vec<String>) {
        for function in &self.intrinsics {
            check_function(function.name, function, problems);
        }
        for namespace in &self.namespaces {
            for member in &namespace.members {
                let owner = format!("{}.{}", namespace.name, member.name());
                if member.since() < namespace.since {
                    problems.push(format!("{owner}: member older than its namespace"));
                }
                match member {
                    NamespaceMember::Function(function) => {
                        check_function(&owner, function, problems);
                    }
                    NamespaceMember::Value(value) => {
                        if value.doc.is_empty() {
                            problems.push(format!("{owner}: missing documentation"));
                        }
                    }
                }
            }
            duplicates(
                &format!("member of `{}`", namespace.name),
                namespace.members.iter().map(|m| m.name()),
                problems,
            );
        }
        for ty in &self.types {
            for method in &ty.methods {
                check_function(&format!("{}.{}", ty.name, method.name), method, problems);
            }
        }
    }

    fn validate_types(&self, problems: &mut Vec<String>) {
        for ty in &self.types {
            if ty.kind == TypeKind::Record && ty.fields.is_empty() {
                problems.push(format!("record `{}` has no fields", ty.name));
            }
            if ty.kind != TypeKind::Record && !ty.fields.is_empty() {
                problems.push(format!("non-record `{}` has fields", ty.name));
            }
            if ty.doc.is_empty() {
                problems.push(format!("type `{}`: missing documentation", ty.name));
            }
            duplicates(
                &format!("field of `{}`", ty.name),
                ty.fields.iter().map(|f| f.name),
                problems,
            );
        }
    }

    fn validate_physics(&self, problems: &mut Vec<String>) {
        for command in &self.body_commands {
            if command.applies_to.is_empty() {
                problems.push(format!(
                    "body command `{}`: applies to no body",
                    command.name
                ));
            }
            if command
                .params
                .iter()
                .any(|p| matches!(p.ty, SigType::Class(_)))
            {
                problems.push(format!(
                    "body command `{}`: generic parameter",
                    command.name
                ));
            }
        }
        for property in &self.body_properties {
            if property.applies_to.is_empty() {
                problems.push(format!(
                    "body property `{}`: applies to no body",
                    property.name
                ));
            }
        }
    }
}

fn check_function(owner: &str, function: &IntrinsicDef, problems: &mut Vec<String>) {
    if function.signatures.is_empty() {
        problems.push(format!("{owner}: no signatures"));
    }
    if function.doc.is_empty() {
        problems.push(format!("{owner}: missing documentation"));
    }
    for signature in &function.signatures {
        check_signature(owner, signature, problems);
    }
}

fn check_signature(owner: &str, signature: &Signature, problems: &mut Vec<String>) {
    duplicates(
        &format!("parameter of `{owner}`"),
        signature.params.iter().map(|p| p.name),
        problems,
    );
    if let SigType::Class(class) = signature.ret
        && !signature
            .params
            .iter()
            .any(|p| p.ty == SigType::Class(class))
    {
        problems.push(format!(
            "{owner}: result class `{}` does not occur in the parameters",
            class.name()
        ));
    }
}

/// The scalar components of a numeric constant, for range checking.
fn numeric_components(value: &ConstValue) -> Vec<f64> {
    match value {
        ConstValue::F32(v) => vec![f64::from(*v)],
        ConstValue::U32(v) => vec![f64::from(*v)],
        ConstValue::I32(v) => vec![f64::from(*v)],
        ConstValue::Vec2(v) => v.iter().map(|c| f64::from(*c)).collect(),
        ConstValue::Vec3(v) => v.iter().map(|c| f64::from(*c)).collect(),
        ConstValue::Vec4(v) => v.iter().map(|c| f64::from(*c)).collect(),
        _ => Vec::new(),
    }
}
