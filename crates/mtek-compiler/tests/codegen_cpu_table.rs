//! The codegen fixture `tests/codegen/numeric_cpu_table/` is generated from the CPU conformance
//! table `tests/semantics/numeric/cpu.json` (decision 0040): one pure Mtek function per distinct
//! operation and signature of the table (`fn add_f32_f32(a: f32, b: f32) -> f32 { return a + b;
//! }`), a `cpu fn` that calls each of them once so they are CPU-reachable, and an `exec.json` row
//! per table case that calls the function with the case's arguments and expects the case's
//! result bit for bit. The execution test (`tests/codegen/exec.test.ts`) runs the rows against
//! the JavaScript the compiler emits for those functions, with the real runtime bundle: every
//! row of the table is evaluated by generated code (operators through their inline forms,
//! everything else through the `rt` helpers), not only by `rt` directly.
//!
//! The fixture's `src/main.mtek` and `exec.json` are canonical: this test fails when they differ
//! from what it generates. Rewrite them with
//! `MTEK_BLESS=1 cargo test -p mtek-compiler --test codegen_cpu_table` (after the table changed),
//! then bless the build golden (`--test build`) and review both diffs.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

/// The type tag of a typed table value (`{"f32": 1.0}` is `f32`).
fn tag(value: &Value) -> String {
    value
        .as_object()
        .and_then(|object| object.keys().next())
        .cloned()
        .unwrap_or_else(|| panic!("not a typed value: {value}"))
}

/// The binary operators of the table and their name parts.
const OPERATORS: [(&str, &str); 11] = [
    ("+", "add"),
    ("-", "sub"),
    ("*", "mul"),
    ("/", "div"),
    ("%", "rem"),
    ("<", "lt"),
    ("<=", "le"),
    (">", "gt"),
    (">=", "ge"),
    ("==", "eq"),
    ("!=", "ne"),
];

const PARAMS: [&str; 4] = ["a", "b", "c", "d"];

/// One generated function: its name, parameter types, result type and returned expression.
struct Generated {
    name: String,
    params: Vec<String>,
    result: String,
    expr: String,
}

fn generate(callee: &str, params: &[String], result: &str) -> Generated {
    let operator = OPERATORS.iter().find(|(op, _)| *op == callee);
    let args: Vec<&str> = PARAMS.iter().take(params.len()).copied().collect();
    let (stem, expr) = if let Some((op, name)) = operator {
        assert_eq!(params.len(), 2, "{callee}");
        ((*name).to_owned(), format!("a {op} b"))
    } else if callee == "neg" {
        ("neg".to_owned(), "-a".to_owned())
    } else if matches!(callee, "f32" | "i32" | "u32") {
        (format!("to_{callee}"), format!("{callee}(a)"))
    } else if matches!(callee, "vec2" | "vec3" | "vec4") {
        (
            format!("make_{callee}"),
            format!("{callee}({})", args.join(", ")),
        )
    } else {
        (
            callee.replace('.', "_"),
            format!("{callee}({})", args.join(", ")),
        )
    };
    let mut name = stem;
    for param in params {
        name.push('_');
        name.push_str(param);
    }
    Generated {
        name,
        params: params.to_vec(),
        result: result.to_owned(),
        expr,
    }
}

/// An argument of each parameter type for the reaching call.
fn dummy(ty: &str) -> &'static str {
    match ty {
        "f32" => "0.0",
        "i32" | "u32" => "0",
        "bool" => "false",
        "vec2" => "vec2(0.0)",
        "vec3" => "vec3(0.0)",
        "vec4" => "vec4(0.0)",
        "quat" => "quat.identity()",
        "color" => "color.linear(vec3(0.0), 1.0)",
        "mat4" => "mat4.identity()",
        other => panic!("no argument of type {other}"),
    }
}

/// The fixture's `src/main.mtek` and `exec.json`.
fn fixture() -> (String, String) {
    let table: Value = serde_json::from_str(
        &fs::read_to_string(repo().join("tests/semantics/numeric/cpu.json")).unwrap(),
    )
    .unwrap();
    let cases = table["cases"].as_array().unwrap();
    let mut functions: Vec<Generated> = Vec::new();
    let mut rows = Vec::with_capacity(cases.len());
    for case in cases {
        let callee = case["fn"].as_str().unwrap();
        let params: Vec<String> = case["args"].as_array().unwrap().iter().map(tag).collect();
        let result = tag(&case["expect"]);
        let generated = generate(callee, &params, &result);
        let name = generated.name.clone();
        match functions.iter().find(|f| f.name == name) {
            Some(existing) => assert_eq!(
                (&existing.params, &existing.result),
                (&params, &result),
                "two signatures named {name}"
            ),
            None => functions.push(generated),
        }
        rows.push(format!(
            "{{\"id\":{},\"fn\":{},\"args\":{},\"expect\":{}}}",
            serde_json::to_string(&case["id"]).unwrap(),
            serde_json::to_string(&name).unwrap(),
            serde_json::to_string(&case["args"]).unwrap(),
            serde_json::to_string(&case["expect"]).unwrap(),
        ));
    }

    let mut source = String::from(
        "// Generated from tests/semantics/numeric/cpu.json by\n\
         // crates/mtek-compiler/tests/codegen_cpu_table.rs; do not edit (decision 0040).\n\
         // One function per operation and signature of the CPU conformance table; the\n\
         // execution test calls them with every case of the table.\n",
    );
    for function in &functions {
        let params: Vec<String> = function
            .params
            .iter()
            .zip(PARAMS)
            .map(|(ty, name)| format!("{name}: {ty}"))
            .collect();
        source.push_str(&format!(
            "\nfn {}({}) -> {} {{\n    return {};\n}}\n",
            function.name,
            params.join(", "),
            function.result,
            function.expr
        ));
    }
    source.push_str(
        "\n// Makes every function above CPU-reachable (decision 0038).\ncpu fn reach_all() {\n",
    );
    for function in &functions {
        let args: Vec<&str> = function.params.iter().map(|ty| dummy(ty)).collect();
        source.push_str(&format!("    {}({});\n", function.name, args.join(", ")));
    }
    source.push_str("}\n\nscene Table {\n    camera Main {}\n}\n");

    let exec = format!("[\n  {}\n]\n", rows.join(",\n  "));
    (source, exec)
}

#[test]
fn the_numeric_cpu_table_fixture_is_generated_from_the_table() {
    let dir = repo().join("tests/codegen/numeric_cpu_table");
    let (source, exec) = fixture();
    let source_path = dir.join("src/main.mtek");
    let exec_path = dir.join("exec.json");
    if blessing() {
        fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        fs::write(&source_path, &source).unwrap();
        fs::write(&exec_path, &exec).unwrap();
        return;
    }
    assert_eq!(
        fs::read_to_string(&source_path).unwrap_or_default(),
        source,
        "{} is stale (bless with MTEK_BLESS=1 and review)",
        source_path.display()
    );
    assert_eq!(
        fs::read_to_string(&exec_path).unwrap_or_default(),
        exec,
        "{} is stale (bless with MTEK_BLESS=1 and review)",
        exec_path.display()
    );
}

#[test]
fn every_case_of_the_table_has_an_execution_row() {
    let table: Value = serde_json::from_str(
        &fs::read_to_string(repo().join("tests/semantics/numeric/cpu.json")).unwrap(),
    )
    .unwrap();
    let (_, exec) = fixture();
    let rows: Value = serde_json::from_str(&exec).unwrap();
    let cases = table["cases"].as_array().unwrap();
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), cases.len());
    for (row, case) in rows.iter().zip(cases) {
        assert_eq!(row["id"], case["id"]);
        assert_eq!(row["args"], case["args"]);
        assert_eq!(row["expect"], case["expect"]);
    }
}
