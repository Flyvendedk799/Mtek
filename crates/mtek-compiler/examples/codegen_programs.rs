//! Builds every codegen fixture with the **real** runtime bundle, for the Node execution tests
//! (`spec/testing.md` section 4.1, decision 0040).
//!
//! ```text
//! cargo run -p mtek-compiler --example codegen_programs -- <out_dir>
//! ```
//!
//! For each codegen fixture `tests/codegen/<name>/` (a directory with an `mtek.toml`) this writes
//!
//! - `<out_dir>/programs/<name>/`: the `dist/` tree of a release build with
//!   `packages/runtime-web/dist/runtime.js` and `runtime.d.ts` as the runtime (the goldens use
//!   the stub bundle, so the runtime never changes them),
//! - `<out_dir>/programs/<name>/ir.json`: the program's typed IR (`mtek inspect --ir`),
//!
//! and `<out_dir>/rt-operations.json`, the compiler's copy of the runtime's `RT_OPERATIONS`
//! index with the structural helpers the emitter uses, which `tests/codegen/rt-operations.test.ts`
//! compares with the TypeScript original. The runtime must have been built (`npm run build`).
//! Fixtures are processed in sorted order; nothing depends on time or hash-map order.

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use mtek_compiler::emit_js::rt_ops;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{
    BuildMode, CompileOptions, Inspect, InspectFormat, TargetProfile, build, inspect,
};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every file below `dir` relative to `root` (`/`-separated), skipping the fixture's
/// expectations (`expected/`, `exec.json`).
fn collect(
    root: &Path,
    dir: &Path,
    out: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), Box<dyn Error>> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<Result<_, _>>()?;
    entries.sort();
    for path in entries {
        let relative = path
            .strip_prefix(root)?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        if relative == "expected" || relative == "exec.json" {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, out)?;
        } else {
            out.push((relative, fs::read(&path)?));
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let out_dir: PathBuf = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: codegen_programs <out_dir>")?;
    let dist = repo().join("packages/runtime-web/dist");
    let bundle = fs::read(dist.join("runtime.js")).map_err(|e| {
        format!(
            "{}: {e} (run `npm run build` first)",
            dist.join("runtime.js").display()
        )
    })?;
    let declarations = fs::read(dist.join("runtime.d.ts")).map_err(|e| {
        format!(
            "{}: {e} (run `npm run build` first)",
            dist.join("runtime.d.ts").display()
        )
    })?;
    let options = CompileOptions {
        profile: TargetProfile::WebGpuCore2026,
        mode: BuildMode::Release,
        runtime_bundle: Some(Arc::from(bundle)),
        runtime_declarations: Some(Arc::from(declarations)),
    };

    let codegen = repo().join("tests/codegen");
    let mut names: Vec<String> = fs::read_dir(&codegen)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().join("mtek.toml").is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();

    for name in &names {
        let root = codegen.join(name);
        let mut files = Vec::new();
        collect(&root, &root, &mut files)?;
        let mut memory = MemFs::new();
        for (path, bytes) in files {
            memory.insert(
                ProjectPath::new(&path).map_err(|e| format!("{path}: {e}"))?,
                bytes,
            );
        }
        let result = build(&ProjectRoot::at_base(), &memory, &options);
        if result.has_errors() {
            return Err(format!("{name} does not build: {:#?}", result.report.diagnostics).into());
        }
        let target = out_dir.join("programs").join(name);
        let _ = fs::remove_dir_all(&target);
        for (path, bytes) in &result.files {
            let file = target.join(path);
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(file, bytes)?;
        }
        let ir = inspect(&ProjectRoot::at_base(), &memory, Inspect::Ir)
            .render(InspectFormat::Json)
            .ok_or_else(|| format!("{name} has no IR"))?;
        fs::write(target.join("ir.json"), ir)?;
    }

    let table: serde_json::Value = serde_json::from_str(&rt_ops::table_json())?;
    let dump = serde_json::json!({
        "operations": table,
        "structural": rt_ops::STRUCTURAL_HELPERS,
    });
    let mut text = serde_json::to_string_pretty(&dump)?;
    text.push('\n');
    fs::create_dir_all(&out_dir)?;
    fs::write(out_dir.join("rt-operations.json"), text)?;
    println!(
        "built {} codegen fixtures with the real runtime into {}",
        names.len(),
        out_dir.join("programs").display()
    );
    Ok(())
}
