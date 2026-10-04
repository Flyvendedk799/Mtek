//! Golden WGSL for every layout fixture: `tests/codegen/wgsl-blocks/<fixture>.wgsl` holds the
//! emitted struct declarations and the block's uniform binding as reviewable text.
//!
//! Goldens are blessed with `MTEK_BLESS=1 cargo test -p mtek-compiler --test wgsl_blocks`
//! and every blessed change is reviewed in the diff like code. The WGSL layout itself is
//! proven by the Naga oracle (`naga_oracle.rs`), not by these files.

// Test helpers outside `#[test]` functions report broken fixtures by panicking.
#![allow(clippy::panic)]

mod common;

use std::collections::BTreeSet;
use std::fs;

use common::{block_declarations, compute_fixture, fixture_names, golden_dir, read};

fn blessing() -> bool {
    std::env::var("MTEK_BLESS").is_ok_and(|value| value == "1")
}

#[test]
fn emitted_wgsl_equals_the_golden_files() {
    let mut failures = Vec::new();
    for name in fixture_names() {
        let actual = block_declarations(&compute_fixture(&name));
        let path = golden_dir().join(format!("{name}.wgsl"));
        if blessing() {
            fs::create_dir_all(golden_dir())
                .unwrap_or_else(|e| panic!("cannot create {}: {e}", golden_dir().display()));
            fs::write(&path, &actual)
                .unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
            continue;
        }
        if !path.is_file() {
            failures.push(format!(
                "golden {} is missing (bless with MTEK_BLESS=1)",
                path.display()
            ));
            continue;
        }
        let expected = read(&path).replace("\r\n", "\n");
        if expected != actual {
            failures.push(format!(
                "fixture `{name}` differs from {}\n--- expected\n{expected}--- actual\n{actual}",
                path.display()
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn there_is_exactly_one_golden_per_fixture() {
    let fixtures: BTreeSet<String> = fixture_names().into_iter().collect();
    let goldens: BTreeSet<String> = fs::read_dir(golden_dir())
        .unwrap_or_else(|e| panic!("cannot list {}: {e}", golden_dir().display()))
        .filter_map(|entry| {
            let file = entry.ok()?.file_name().into_string().ok()?;
            file.strip_suffix(".wgsl").map(str::to_owned)
        })
        .collect();
    assert_eq!(goldens, fixtures);
}

#[test]
fn goldens_use_lf_line_endings_and_end_with_a_newline() {
    for name in fixture_names() {
        let text = read(&golden_dir().join(format!("{name}.wgsl")));
        assert!(!text.contains('\r'), "golden `{name}` contains CR");
        assert!(
            text.ends_with(";\n"),
            "golden `{name}` must end after the binding"
        );
    }
}

#[test]
fn the_shader_ir_printer_reproduces_every_golden() {
    // The struct declarations the shader IR builds from a layout record, printed by the
    // WGSL printer together with the block's uniform global, are byte for byte the block
    // emitter's text: both consumers of the record agree (`spec/gpu-layout.md` section 1).
    use mtek_compiler::emit_wgsl::print_module;
    use mtek_compiler::lowering::shader_ir::{
        GlobalDecl, GlobalKind, Name, ShaderModule, ShaderType,
    };
    use mtek_compiler::source::{FileId, Span};

    let span = Span::new(FileId(0), 0, 1);
    for name in fixture_names() {
        let record = compute_fixture(&name);
        let mut module = ShaderModule::new(format!("fixture:{name}"), span);
        module.declare_block(&record, span);
        module.globals.push(GlobalDecl {
            name: Name::generated(
                common::VAR_NAME
                    .strip_prefix("mtek_")
                    .unwrap_or(common::VAR_NAME),
            ),
            kind: GlobalKind::Uniform {
                group: common::GROUP,
                binding: common::BINDING,
                ty: ShaderType::named(record.wgsl_struct.clone()),
            },
            span,
        });
        let printed = print_module(&module);
        assert_eq!(
            printed.text,
            block_declarations(&record),
            "fixture `{name}`"
        );
        assert!(
            printed.span_map.entries.iter().all(|e| e.span == span),
            "fixture `{name}`"
        );
    }
}
