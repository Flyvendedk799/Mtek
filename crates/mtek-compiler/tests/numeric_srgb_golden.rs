//! Compiler-folded `color.srgb` values over a sweep of channel inputs, written to the golden
//! `tests/semantics/numeric/srgb-fold.json` that the runtime's cross-check reads
//! (`packages/runtime-web/src/math/srgb.test.ts`; decision 0024 item 6, decision 0037).
//!
//! Every value is produced by the real compiler: the sweep is written as constants
//! `const C<n> = color.srgb(vec3(r, g, b), 1.0);` of a one-scene project and folded by
//! `mtek_compiler::analyze`, so the golden holds exactly what a build would emit. The run-time
//! evaluation in JavaScript (binary64 `Math.pow` rounded once instead of binary32 `libm::powf`)
//! must agree within the tolerance of `spec/testing.md` section 5.
//!
//! The sweep: 0 and `-0`, the binary32 value nearest 0.04045 and its eight neighbours on each
//! side, every 8-bit channel value `c / 255`, a grid of 1001 points over `[0, 1]`, 1 and values
//! above it up to 10000, small and negative values. Regenerate with
//! `MTEK_BLESS=1 cargo test -p mtek-compiler --test numeric_srgb_golden`.

// Test-only code: helper functions outside `#[test]` functions may panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use mtek_compiler::analyze;
use mtek_compiler::diagnostics::Severity;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::resolve::DefKind;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::types::ConstValue;

fn golden_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/semantics/numeric/srgb-fold.json")
}

/// The channel inputs of the sweep, in a fixed order, without duplicates.
fn sweep() -> Vec<f32> {
    let mut inputs: Vec<f32> = vec![0.0, -0.0];
    let threshold = 0.04045_f32;
    for k in -8_i32..=8 {
        inputs.push(f32::from_bits(threshold.to_bits().wrapping_add_signed(k)));
    }
    inputs.extend((0..=255_u8).map(|c| (f64::from(c) / 255.0) as f32));
    inputs.extend((0..=1000_u16).map(|i| (f64::from(i) / 1000.0) as f32));
    inputs.extend([
        1.0,
        f32::from_bits(1.0_f32.to_bits() + 1),
        1.001,
        1.5,
        2.0,
        3.0,
        10.0,
        100.0,
        1000.0,
        10000.0,
        1.0e-6,
        1.0e-30,
        f32::from_bits(1),
        -1.0e-6,
        -0.001,
        -0.5,
        -2.0,
    ]);
    let mut seen = std::collections::BTreeSet::new();
    inputs.retain(|v| seen.insert(v.to_bits()));
    inputs
}

/// A Mtek float literal of `v` (`[0-9]+ '.' [0-9]+ exponent`), negated by a unary minus.
fn literal(v: f32) -> String {
    let text = format!("{:e}", v.abs());
    let (mantissa, exponent) = text.split_once('e').unwrap();
    let mantissa = if mantissa.contains('.') {
        mantissa.to_owned()
    } else {
        format!("{mantissa}.0")
    };
    let sign = if v.is_sign_negative() { "-" } else { "" };
    format!("{sign}{mantissa}e{exponent}")
}

/// Folds every input through `color.srgb` with the compiler; returns `(input, folded)` pairs.
fn fold_all(inputs: &[f32]) -> Vec<(f32, f32)> {
    let mut source = String::new();
    let chunks: Vec<&[f32]> = inputs.chunks(3).collect();
    for (n, chunk) in chunks.iter().enumerate() {
        let mut channels: Vec<String> = chunk.iter().map(|v| literal(*v)).collect();
        channels.resize(3, "0.0".to_owned());
        source.push_str(&format!(
            "const C{n} = color.srgb(vec3({}), 1.0);\n",
            channels.join(", ")
        ));
    }
    source.push_str("\nscene Demo {\n    camera Main {}\n}\n");
    let mut fs = MemFs::new();
    fs.insert(
        ProjectPath::new("mtek.toml").unwrap(),
        "[project]\nname = \"srgb\"\nlanguage = \"0.1\"\n",
    )
    .insert(ProjectPath::new("src/main.mtek").unwrap(), source.as_str());
    let result = analyze(&ProjectRoot::at_base(), &fs);
    let errors: Vec<_> = result
        .report
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
    let resolution = result.resolution.unwrap();
    let types = result.types.unwrap();
    let mut out = Vec::new();
    for (n, chunk) in chunks.iter().enumerate() {
        let name = format!("C{n}");
        let def = resolution
            .defs()
            .iter()
            .find(|d| d.kind == DefKind::Const && d.name == name)
            .unwrap();
        let Some(ConstValue::Color(c)) = types.const_info(def.id).and_then(|i| i.value.clone())
        else {
            panic!("{name} was not folded to a colour");
        };
        for (i, input) in chunk.iter().enumerate() {
            out.push((*input, c[i]));
        }
        assert_eq!(c[3], 1.0, "alpha is passed through");
    }
    out
}

fn number(v: f32) -> String {
    if v == 0.0 && v.is_sign_negative() {
        "\"-0\"".to_owned()
    } else {
        assert!(v.is_finite());
        serde_json::to_string(&f64::from(v)).unwrap()
    }
}

fn render(pairs: &[(f32, f32)]) -> String {
    let mut out = String::from(
        "{\n  \"$comment\": [\n    \
         \"color.srgb(rgb, 1.0) folded by the compiler: one [channel input, folded linear channel] pair per input \
         (binary32 values as exact JSON numbers, -0 as \\\"-0\\\").\",\n    \
         \"Generated by crates/mtek-compiler/tests/numeric_srgb_golden.rs; never edit by hand. Read by \
         packages/runtime-web/src/math/srgb.test.ts (decision 0037).\"\n  ],\n  \
         \"format\": \"mtek-srgb-fold/1\",\n  \"cases\": [\n",
    );
    for (i, (input, folded)) in pairs.iter().enumerate() {
        out.push_str(&format!("    [{}, {}]", number(*input), number(*folded)));
        out.push_str(if i + 1 < pairs.len() { ",\n" } else { "\n" });
    }
    out.push_str("  ]\n}\n");
    out
}

#[test]
fn golden_matches_the_compiler() {
    let inputs = sweep();
    assert!(inputs.len() > 1200, "{} inputs", inputs.len());
    let pairs = fold_all(&inputs);
    // The folded value is the constant folder's own channel function.
    for (input, folded) in &pairs {
        assert_eq!(
            folded.to_bits(),
            mtek_compiler::stdlib::srgb_channel_to_linear_f32(*input).to_bits(),
            "{input:e}"
        );
    }
    let rendered = render(&pairs);
    let path = golden_path();
    if std::env::var_os("MTEK_BLESS").is_some_and(|v| v == "1") {
        fs::write(&path, &rendered).unwrap();
        return;
    }
    let committed = fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == rendered,
        "tests/semantics/numeric/srgb-fold.json is stale; regenerate it with \
         MTEK_BLESS=1 cargo test -p mtek-compiler --test numeric_srgb_golden"
    );
}

#[test]
fn literals_round_trip() {
    for v in sweep() {
        let text = literal(v);
        let parsed: f32 = text.parse().unwrap();
        assert_eq!(parsed.to_bits(), v.to_bits(), "{text}");
        assert!(text.trim_start_matches('-').contains('.'), "{text}");
    }
}
