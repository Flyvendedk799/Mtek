//! Which `rt` helper implements which Mtek operation: the compiler's copy of the runtime's
//! `RT_OPERATIONS` index (`packages/runtime-web/src/math/operations.ts`, decision 0037 item 2).
//!
//! The table is built here with the same rules as there (a type prefix plus the Mtek name in
//! lower camel case; a vector form taking a scalar where the scalar form takes the vector
//! type ends in `s`), so the emitter can look helpers up without reading TypeScript. The two
//! copies cannot drift apart unnoticed: [`table_json`] is dumped by the `codegen_programs`
//! example and `tests/codegen/rt-operations.test.ts` requires it to equal `RT_OPERATIONS`
//! exactly, and every `rt.` name in every generated `app.js` to be an export of the real
//! runtime bundle.

use std::collections::BTreeMap;
use std::sync::OnceLock;

/// The `rt` exports the emitter uses that implement no callee of the table
/// (`RT_STRUCTURAL_EXPORTS` of the runtime): swizzles, single-component replacement, the
/// colour's `.rgb`, a `mat4` column, index clamping and the value copy of assignable places.
pub const STRUCTURAL_HELPERS: [&str; 10] = [
    "swizzle2",
    "swizzle3",
    "swizzle4",
    "v2with",
    "v3with",
    "v4with",
    "crgb",
    "m4col",
    "clampIndex",
    "copy",
];

/// `"(a, b) -> r"`, the signature key of the table.
#[must_use]
pub fn signature(params: &[&str], result: &str) -> String {
    format!("({}) -> {result}", params.join(", "))
}

/// `inverse_sqrt` becomes `inverseSqrt`.
fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// `callee -> signature -> helper`.
type Table = BTreeMap<String, BTreeMap<String, String>>;

fn add(table: &mut Table, callee: &str, params: &[&str], result: &str, helper: String) {
    table
        .entry(callee.to_owned())
        .or_default()
        .insert(signature(params, result), helper);
}

const FLOAT_TYPES: [&str; 4] = ["f32", "vec2", "vec3", "vec4"];
const VECTOR_TYPES: [&str; 3] = ["vec2", "vec3", "vec4"];
const INT_TYPES: [&str; 2] = ["i32", "u32"];

fn prefix(ty: &str) -> &'static str {
    match ty {
        "vec2" => "v2",
        "vec3" => "v3",
        "vec4" => "v4",
        "i32" => "i",
        "u32" => "u",
        _ => "",
    }
}

/// The table, built exactly like `build()` in `operations.ts`.
fn build() -> Table {
    let mut t = Table::new();
    let unary = [
        "abs",
        "saturate",
        "sqrt",
        "inverse_sqrt",
        "exp",
        "exp2",
        "log",
        "log2",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "floor",
        "ceil",
        "trunc",
        "fract",
        "sign",
        "round",
        "radians",
        "degrees",
    ];
    let binary = ["min", "max", "pow", "atan2", "step"];
    let ternary = ["clamp", "smoothstep", "mix"];
    for ty in FLOAT_TYPES {
        let p = prefix(ty);
        for name in unary {
            add(&mut t, name, &[ty], ty, format!("{p}{}", camel(name)));
        }
        for name in binary {
            add(&mut t, name, &[ty, ty], ty, format!("{p}{name}"));
        }
        for name in ternary {
            add(&mut t, name, &[ty, ty, ty], ty, format!("{p}{name}"));
        }
        let mix = if ty == "f32" {
            "mix".to_owned()
        } else {
            format!("{p}mixs")
        };
        add(&mut t, "mix", &[ty, ty, "f32"], ty, mix);
        add(&mut t, "length", &[ty], "f32", format!("{p}length"));
        add(&mut t, "distance", &[ty, ty], "f32", format!("{p}distance"));
    }
    for ty in INT_TYPES {
        let p = prefix(ty);
        add(&mut t, "abs", &[ty], ty, format!("{p}abs"));
        add(&mut t, "min", &[ty, ty], ty, format!("{p}min"));
        add(&mut t, "max", &[ty, ty], ty, format!("{p}max"));
        add(&mut t, "clamp", &[ty, ty, ty], ty, format!("{p}clamp"));
    }
    for ty in VECTOR_TYPES {
        let p = prefix(ty);
        add(&mut t, "dot", &[ty, ty], "f32", format!("{p}dot"));
        add(&mut t, "normalize", &[ty], ty, format!("{p}normalize"));
        add(&mut t, "reflect", &[ty, ty], ty, format!("{p}reflect"));
    }
    add(&mut t, "cross", &["vec3", "vec3"], "vec3", "v3cross".into());
    add(&mut t, "transpose", &["mat4"], "mat4", "m4transpose".into());

    add(&mut t, "quat.identity", &[], "quat", "qidentity".into());
    add(
        &mut t,
        "quat.axis_angle",
        &["vec3", "f32"],
        "quat",
        "qaxisAngle".into(),
    );
    add(
        &mut t,
        "quat.euler",
        &["f32", "f32", "f32"],
        "quat",
        "qeuler".into(),
    );
    add(&mut t, "mat4.identity", &[], "mat4", "m4identity".into());
    add(
        &mut t,
        "mat4.translation",
        &["vec3"],
        "mat4",
        "m4translation".into(),
    );
    add(
        &mut t,
        "mat4.rotation",
        &["quat"],
        "mat4",
        "m4rotation".into(),
    );
    add(&mut t, "mat4.scale", &["vec3"], "mat4", "m4scale".into());
    add(
        &mut t,
        "mat4.columns",
        &["vec4", "vec4", "vec4", "vec4"],
        "mat4",
        "m4columns".into(),
    );
    add(
        &mut t,
        "color.linear",
        &["vec3", "f32"],
        "color",
        "clinear".into(),
    );
    add(
        &mut t,
        "color.srgb",
        &["vec3", "f32"],
        "color",
        "csrgb".into(),
    );

    add(&mut t, "vec2", &["f32", "f32"], "vec2", "v2".into());
    add(&mut t, "vec2", &["f32"], "vec2", "v2splat".into());
    add(&mut t, "vec3", &["f32", "f32", "f32"], "vec3", "v3".into());
    add(&mut t, "vec3", &["f32"], "vec3", "v3splat".into());
    add(&mut t, "vec3", &["vec2", "f32"], "vec3", "v3fromV2".into());
    add(
        &mut t,
        "vec4",
        &["f32", "f32", "f32", "f32"],
        "vec4",
        "v4".into(),
    );
    add(&mut t, "vec4", &["f32"], "vec4", "v4splat".into());
    add(&mut t, "vec4", &["vec3", "f32"], "vec4", "v4fromV3".into());
    add(
        &mut t,
        "vec4",
        &["vec2", "f32", "f32"],
        "vec4",
        "v4fromV2".into(),
    );

    add(&mut t, "f32", &["i32"], "f32", "i2f".into());
    add(&mut t, "f32", &["u32"], "f32", "u2f".into());
    add(&mut t, "i32", &["f32"], "i32", "f2i".into());
    add(&mut t, "i32", &["u32"], "i32", "u2i".into());
    add(&mut t, "u32", &["f32"], "u32", "f2u".into());
    add(&mut t, "u32", &["i32"], "u32", "i2u".into());

    for (op, name) in [
        ("+", "add"),
        ("-", "sub"),
        ("*", "mul"),
        ("/", "div"),
        ("%", "rem"),
    ] {
        add(&mut t, op, &["f32", "f32"], "f32", format!("f{name}"));
        add(&mut t, op, &["i32", "i32"], "i32", format!("i{name}"));
        add(&mut t, op, &["u32", "u32"], "u32", format!("u{name}"));
    }
    add(&mut t, "neg", &["f32"], "f32", "fneg".into());
    add(&mut t, "neg", &["i32"], "i32", "ineg".into());
    for ty in VECTOR_TYPES {
        let p = prefix(ty);
        add(&mut t, "+", &[ty, ty], ty, format!("{p}add"));
        add(&mut t, "-", &[ty, ty], ty, format!("{p}sub"));
        add(&mut t, "*", &[ty, ty], ty, format!("{p}mul"));
        add(&mut t, "/", &[ty, ty], ty, format!("{p}div"));
        add(&mut t, "*", &[ty, "f32"], ty, format!("{p}scale"));
        add(&mut t, "*", &["f32", ty], ty, format!("{p}smul"));
        add(&mut t, "/", &[ty, "f32"], ty, format!("{p}divs"));
        add(&mut t, "neg", &[ty], ty, format!("{p}neg"));
    }
    add(&mut t, "*", &["mat4", "mat4"], "mat4", "m4mul".into());
    add(&mut t, "*", &["mat4", "vec4"], "vec4", "m4mulv".into());
    add(&mut t, "*", &["quat", "quat"], "quat", "qmul".into());
    add(&mut t, "*", &["quat", "vec3"], "vec3", "qrotate".into());
    t
}

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(build)
}

/// The `rt` helper of the Mtek operation `callee` with the concrete signature
/// `(params) -> result`, if there is one.
#[must_use]
pub fn helper(callee: &str, params: &[&str], result: &str) -> Option<&'static str> {
    table()
        .get(callee)?
        .get(&signature(params, result))
        .map(String::as_str)
}

/// The whole table as JSON, `{ callee: { signature: helper } }` with sorted keys: the form
/// the cross-check against `RT_OPERATIONS` reads.
#[must_use]
pub fn table_json() -> String {
    let mut text = serde_json::to_string_pretty(table()).unwrap_or_default();
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_follow_the_runtime_naming_scheme() {
        assert_eq!(helper("+", &["vec3", "vec3"], "vec3"), Some("v3add"));
        assert_eq!(helper("*", &["f32", "vec3"], "vec3"), Some("v3smul"));
        assert_eq!(helper("*", &["vec2", "f32"], "vec2"), Some("v2scale"));
        assert_eq!(helper("/", &["vec4", "f32"], "vec4"), Some("v4divs"));
        assert_eq!(helper("*", &["quat", "vec3"], "vec3"), Some("qrotate"));
        assert_eq!(helper("neg", &["vec2"], "vec2"), Some("v2neg"));
        assert_eq!(helper("/", &["i32", "i32"], "i32"), Some("idiv"));
        assert_eq!(helper("%", &["u32", "u32"], "u32"), Some("urem"));
        assert_eq!(helper("i32", &["f32"], "i32"), Some("f2i"));
        assert_eq!(
            helper("inverse_sqrt", &["vec3"], "vec3"),
            Some("v3inverseSqrt")
        );
        assert_eq!(helper("mix", &["f32", "f32", "f32"], "f32"), Some("mix"));
        assert_eq!(
            helper("mix", &["vec3", "vec3", "f32"], "vec3"),
            Some("v3mixs")
        );
        assert_eq!(
            helper("clamp", &["u32", "u32", "u32"], "u32"),
            Some("uclamp")
        );
        assert_eq!(
            helper("quat.axis_angle", &["vec3", "f32"], "quat"),
            Some("qaxisAngle")
        );
        assert_eq!(
            helper("vec4", &["vec2", "f32", "f32"], "vec4"),
            Some("v4fromV2")
        );
        assert_eq!(helper("length", &["f32"], "f32"), Some("length"));
        // No helper for what Mtek does not have.
        assert_eq!(helper("neg", &["u32"], "u32"), None);
        assert_eq!(helper("+", &["color", "color"], "color"), None);
        assert_eq!(helper("sin", &["i32"], "i32"), None);
    }

    #[test]
    fn the_json_form_lists_every_entry_with_sorted_keys() {
        let value: serde_json::Value = serde_json::from_str(&table_json()).expect("json");
        let entries: usize = value
            .as_object()
            .expect("object")
            .values()
            .map(|signatures| signatures.as_object().map_or(0, serde_json::Map::len))
            .sum();
        let counted: usize = table().values().map(BTreeMap::len).sum();
        assert_eq!(entries, counted);
        assert_eq!(value["*"]["(mat4, vec4) -> vec4"], "m4mulv");
        assert!(table_json().ends_with("}\n"));
    }
}
