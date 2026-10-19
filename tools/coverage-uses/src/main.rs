//! `coverage-uses DIR...` (or the directories, one per line, on standard input when there is no
//! argument): print, as one JSON object, the features each project directory uses, named as in
//! `mtek context` (`supported.features`). The answer comes from the compiler's own tables
//! ([`mtek_compiler::context::used_features`]): the names the resolver bound to the standard
//! library, the constructs the declarations are instances of and the calls the type checker
//! recorded. Nothing is read from source text by pattern.
//!
//! The output maps each directory, as it was given, to `{"features": [...]}` or, when the project
//! cannot be loaded, to `{"error": "..."}`. Exit status 0 when every directory was read, 2 when
//! one could not be (the others are still printed).

use std::fs;
use std::io::{self, BufRead};
use std::path::Path;
use std::process::ExitCode;

use mtek_compiler::context::used_features;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use serde_json::{Map, Value, json};

/// Directories that hold build output or dependencies, never sources of the project.
const SKIPPED: [&str; 4] = ["node_modules", ".out", "dist", "target"];

/// Every file below `dir` in `memory`, under its path relative to `base`.
fn read_tree(base: &Path, dir: &Path, memory: &mut MemFs) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    let mut paths: Vec<_> = entries.filter_map(Result::ok).map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            let skipped = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| SKIPPED.contains(&n));
            if !skipped {
                read_tree(base, &path, memory)?;
            }
            continue;
        }
        let relative = path
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let project_path = ProjectPath::new(&relative).map_err(|e| format!("{relative}: {e:?}"))?;
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        memory.insert(project_path, bytes);
    }
    Ok(())
}

/// The features used by the project in `dir`.
fn features_of(dir: &Path) -> Result<Vec<String>, String> {
    let mut memory = MemFs::new();
    read_tree(dir, dir, &mut memory)?;
    used_features(&ProjectRoot::at_base(), &memory)
        .map(|set| set.into_iter().collect())
        .map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    let mut dirs: Vec<String> = std::env::args().skip(1).collect();
    if dirs.is_empty() {
        dirs = io::stdin()
            .lock()
            .lines()
            .map_while(Result::ok)
            .map(|line| line.trim().to_owned())
            .filter(|line| !line.is_empty())
            .collect();
    }
    let mut out = Map::new();
    let mut failed = false;
    for dir in dirs {
        let entry = match features_of(Path::new(&dir)) {
            Ok(features) => json!({ "features": features }),
            Err(error) => {
                failed = true;
                json!({ "error": error })
            }
        };
        out.insert(dir, entry);
    }
    println!(
        "{}",
        serde_json::to_string(&Value::Object(out)).unwrap_or_default()
    );
    if failed {
        ExitCode::from(2)
    } else {
        ExitCode::SUCCESS
    }
}
