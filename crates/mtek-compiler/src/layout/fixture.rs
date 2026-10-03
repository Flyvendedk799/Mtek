//! Parser for the JSON type description of layout fixtures (`spec/testing.md` section 4.2),
//! the "tiny typed representation" used before the `.mtek` parser exists.
//!
//! ```json
//! { "name": "Mixed", "kind": "struct", "members": [
//!   { "name": "a", "type": "f32" }, { "name": "b", "type": "vec3" } ] }
//! ```
//!
//! A type is a scalar/vector name (`"f32"`, `"i32"`, `"u32"`, `"bool"`, `"vec2"`, `"vec3"`,
//! `"vec4"`, `"color"`, `"quat"`, `"mat4"`), a struct object
//! `{ "kind": "struct", "name": ..., "members": [...] }`, or an array object
//! `{ "kind": "array", "element": <type>, "length": N }`. Unknown keys are errors, so a
//! misspelt fixture can never be silently ignored.

use std::error::Error;
use std::fmt;

use serde_json::{Map, Value};

use super::types::LayoutType;

/// Why a fixture type description could not be parsed. `path` locates the problem,
/// for example `members[2].type.element`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureError {
    pub path: String,
    pub message: String,
}

impl fmt::Display for FixtureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "invalid fixture type: {}", self.message)
        } else {
            write!(
                f,
                "invalid fixture type at `{}`: {}",
                self.path, self.message
            )
        }
    }
}

impl Error for FixtureError {}

fn error(path: &str, message: impl Into<String>) -> FixtureError {
    FixtureError {
        path: path.to_owned(),
        message: message.into(),
    }
}

/// Parses the text of a `<name>.type.json` file. The top level must be a struct.
pub fn parse_type_json(text: &str) -> Result<LayoutType, FixtureError> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| error("", format!("not valid JSON: {e}")))?;
    parse_type_value(&value)
}

/// Parses an already decoded `<name>.type.json` document. The top level must be a struct.
pub fn parse_type_value(value: &Value) -> Result<LayoutType, FixtureError> {
    let ty = parse_type(value, "")?;
    match ty {
        LayoutType::Struct { .. } => Ok(ty),
        other => Err(error(
            "",
            format!("the top-level type must be a struct, found `{other}`"),
        )),
    }
}

const SCALAR_NAMES: &str = "f32, i32, u32, bool, vec2, vec3, vec4, color, quat, mat4";

fn parse_type(value: &Value, path: &str) -> Result<LayoutType, FixtureError> {
    match value {
        Value::String(name) => match name.as_str() {
            "f32" => Ok(LayoutType::F32),
            "i32" => Ok(LayoutType::I32),
            "u32" => Ok(LayoutType::U32),
            "bool" => Ok(LayoutType::Bool),
            "vec2" => Ok(LayoutType::Vec2),
            "vec3" => Ok(LayoutType::Vec3),
            "vec4" => Ok(LayoutType::Vec4),
            "color" => Ok(LayoutType::Color),
            "quat" => Ok(LayoutType::Quat),
            "mat4" => Ok(LayoutType::Mat4),
            other => Err(error(
                path,
                format!("unknown type name `{other}`; expected one of {SCALAR_NAMES}"),
            )),
        },
        Value::Object(object) => match string_field(object, "kind", path)? {
            "struct" => parse_struct(object, path),
            "array" => parse_array(object, path),
            other => Err(error(
                &join(path, "kind"),
                format!("unknown kind `{other}`; expected `struct` or `array`"),
            )),
        },
        other => Err(error(
            path,
            format!(
                "expected a type name or an object, found {}",
                describe(other)
            ),
        )),
    }
}

fn parse_struct(object: &Map<String, Value>, path: &str) -> Result<LayoutType, FixtureError> {
    reject_unknown_keys(object, &["kind", "name", "members"], path)?;
    let name = string_field(object, "name", path)?;
    let members_path = join(path, "members");
    let list = match object.get("members") {
        Some(Value::Array(list)) => list,
        Some(other) => {
            return Err(error(
                &members_path,
                format!("expected an array, found {}", describe(other)),
            ));
        }
        None => return Err(error(path, "missing key `members`")),
    };
    let mut members = Vec::with_capacity(list.len());
    for (index, entry) in list.iter().enumerate() {
        let entry_path = format!("{members_path}[{index}]");
        let Value::Object(member) = entry else {
            return Err(error(
                &entry_path,
                format!("expected an object, found {}", describe(entry)),
            ));
        };
        reject_unknown_keys(member, &["name", "type"], &entry_path)?;
        let member_name = string_field(member, "name", &entry_path)?;
        let type_path = join(&entry_path, "type");
        let Some(type_value) = member.get("type") else {
            return Err(error(&entry_path, "missing key `type`"));
        };
        members.push((member_name.to_owned(), parse_type(type_value, &type_path)?));
    }
    Ok(LayoutType::new_struct(name, members))
}

fn parse_array(object: &Map<String, Value>, path: &str) -> Result<LayoutType, FixtureError> {
    reject_unknown_keys(object, &["kind", "element", "length"], path)?;
    let Some(element) = object.get("element") else {
        return Err(error(path, "missing key `element`"));
    };
    let element = parse_type(element, &join(path, "element"))?;
    let length_path = join(path, "length");
    let length = match object.get("length") {
        Some(Value::Number(number)) => number
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| {
                error(
                    &length_path,
                    format!("expected a non-negative 32-bit integer, found {number}"),
                )
            })?,
        Some(other) => {
            return Err(error(
                &length_path,
                format!("expected an integer, found {}", describe(other)),
            ));
        }
        None => return Err(error(path, "missing key `length`")),
    };
    Ok(LayoutType::new_array(element, length))
}

fn string_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a str, FixtureError> {
    match object.get(key) {
        Some(Value::String(text)) => Ok(text),
        Some(other) => Err(error(
            &join(path, key),
            format!("expected a string, found {}", describe(other)),
        )),
        None => Err(error(path, format!("missing key `{key}`"))),
    }
}

fn reject_unknown_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    path: &str,
) -> Result<(), FixtureError> {
    let mut unknown: Vec<&str> = object
        .keys()
        .map(String::as_str)
        .filter(|key| !allowed.contains(key))
        .collect();
    unknown.sort_unstable();
    match unknown.first() {
        Some(key) => Err(error(
            path,
            format!(
                "unknown key `{key}`; allowed keys here are {}",
                allowed.join(", ")
            ),
        )),
        None => Ok(()),
    }
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

fn describe(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<LayoutType, FixtureError> {
        parse_type_json(text)
    }

    fn err(text: &str) -> FixtureError {
        parse(text).expect_err("fixture must be rejected")
    }

    #[test]
    fn parses_the_mixed_example_of_the_specification() {
        let ty = parse(
            r#"{ "name": "Mixed", "kind": "struct", "members": [
                { "name": "a", "type": "f32" }, { "name": "b", "type": "vec3" },
                { "name": "c", "type": "u32" }, { "name": "d", "type": "vec2" },
                { "name": "e", "type": "bool" }, { "name": "f", "type": "color" } ] }"#,
        )
        .expect("valid");
        let expected = LayoutType::new_struct(
            "Mixed",
            vec![
                ("a".to_owned(), LayoutType::F32),
                ("b".to_owned(), LayoutType::Vec3),
                ("c".to_owned(), LayoutType::U32),
                ("d".to_owned(), LayoutType::Vec2),
                ("e".to_owned(), LayoutType::Bool),
                ("f".to_owned(), LayoutType::Color),
            ],
        );
        assert_eq!(ty, expected);
    }

    #[test]
    fn parses_every_type_name() {
        let names = [
            ("f32", LayoutType::F32),
            ("i32", LayoutType::I32),
            ("u32", LayoutType::U32),
            ("bool", LayoutType::Bool),
            ("vec2", LayoutType::Vec2),
            ("vec3", LayoutType::Vec3),
            ("vec4", LayoutType::Vec4),
            ("color", LayoutType::Color),
            ("quat", LayoutType::Quat),
            ("mat4", LayoutType::Mat4),
        ];
        for (name, expected) in names {
            let text = format!(
                r#"{{ "name": "S", "kind": "struct", "members": [{{ "name": "m", "type": "{name}" }}] }}"#
            );
            let ty = parse(&text).expect("valid");
            assert_eq!(
                ty,
                LayoutType::new_struct("S", vec![("m".to_owned(), expected)])
            );
        }
    }

    #[test]
    fn parses_nested_structs_and_arrays() {
        let ty = parse(
            r#"{ "name": "O", "kind": "struct", "members": [
                { "name": "items", "type": { "kind": "array", "length": 3,
                    "element": { "kind": "struct", "name": "P",
                        "members": [ { "name": "a", "type": "f32" } ] } } } ] }"#,
        )
        .expect("valid");
        let p = LayoutType::new_struct("P", vec![("a".to_owned(), LayoutType::F32)]);
        assert_eq!(
            ty,
            LayoutType::new_struct("O", vec![("items".to_owned(), LayoutType::new_array(p, 3))])
        );
    }

    #[test]
    fn invalid_json_is_reported() {
        let e = err("{ not json");
        assert_eq!(e.path, "");
        assert!(e.message.starts_with("not valid JSON"), "{e}");
    }

    #[test]
    fn top_level_must_be_a_struct() {
        let e = err(r#""f32""#);
        assert!(e.message.contains("top-level type must be a struct"), "{e}");
        let e = err(r#"{ "kind": "array", "element": "f32", "length": 2 }"#);
        assert!(e.message.contains("top-level type must be a struct"), "{e}");
    }

    #[test]
    fn unknown_type_name_names_the_path() {
        let e = err(r#"{ "name": "S", "kind": "struct", "members": [
                { "name": "a", "type": "f32" }, { "name": "b", "type": "float" } ] }"#);
        assert_eq!(e.path, "members[1].type");
        assert!(e.message.contains("unknown type name `float`"), "{e}");
        assert!(e.to_string().contains("members[1].type"), "{e}");
    }

    #[test]
    fn unknown_kind_and_unknown_keys_are_rejected() {
        let e = err(r#"{ "name": "S", "kind": "union", "members": [] }"#);
        assert_eq!(e.path, "kind");
        let e = err(r#"{ "name": "S", "kind": "struct", "members": [], "extra": 1 }"#);
        assert!(e.message.contains("unknown key `extra`"), "{e}");
        let e = err(
            r#"{ "name": "S", "kind": "struct", "members": [ { "name": "a", "type": "f32", "align": 16 } ] }"#,
        );
        assert_eq!(e.path, "members[0]");
        assert!(e.message.contains("unknown key `align`"), "{e}");
    }

    #[test]
    fn missing_and_mistyped_keys_are_rejected() {
        let e = err(r#"{ "kind": "struct", "members": [] }"#);
        assert!(e.message.contains("missing key `name`"), "{e}");
        let e = err(r#"{ "name": "S", "kind": "struct" }"#);
        assert!(e.message.contains("missing key `members`"), "{e}");
        let e = err(r#"{ "name": "S", "kind": "struct", "members": {} }"#);
        assert_eq!(e.path, "members");
        let e = err(r#"{ "name": "S", "kind": "struct", "members": [ "f32" ] }"#);
        assert_eq!(e.path, "members[0]");
        let e = err(r#"{ "name": "S", "kind": "struct", "members": [ { "name": "a" } ] }"#);
        assert!(e.message.contains("missing key `type`"), "{e}");
        let e = err(r#"{ "name": 3, "kind": "struct", "members": [] }"#);
        assert_eq!(e.path, "name");
        let e =
            err(r#"{ "name": "S", "kind": "struct", "members": [ { "name": "a", "type": 4 } ] }"#);
        assert_eq!(e.path, "members[0].type");
    }

    #[test]
    fn array_length_must_be_a_u32() {
        let wrap = |array: &str| {
            format!(
                r#"{{ "name": "S", "kind": "struct", "members": [ {{ "name": "a", "type": {array} }} ] }}"#
            )
        };
        for bad in ["-1", "1.5", "4294967296", "\"3\""] {
            let e = err(&wrap(&format!(
                r#"{{ "kind": "array", "element": "f32", "length": {bad} }}"#
            )));
            assert_eq!(e.path, "members[0].type.length", "length {bad}");
        }
        let e = err(&wrap(r#"{ "kind": "array", "length": 2 }"#));
        assert!(e.message.contains("missing key `element`"), "{e}");
        let e = err(&wrap(r#"{ "kind": "array", "element": "f32" }"#));
        assert!(e.message.contains("missing key `length`"), "{e}");
        // Length 0 parses; the layout engine rejects it.
        assert!(
            parse(&wrap(
                r#"{ "kind": "array", "element": "f32", "length": 0 }"#
            ))
            .is_ok()
        );
    }
}
