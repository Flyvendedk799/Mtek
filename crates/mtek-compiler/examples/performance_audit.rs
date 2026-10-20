//! Reproducible compiler performance probes; see docs/audits/2026-10-20-performance.md.
#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use std::fmt::Write as _;
use std::hint::black_box;
use std::time::Instant;

use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, analyze_without_edits, build, ir, plan};

fn source(shape: &str, n: usize) -> String {
    let mut text = String::from("scene Demo { camera Main {}\n");
    for i in 0..n {
        let deps: Vec<usize> = match shape {
            "chain" => (i > 0).then(|| i - 1).into_iter().collect(),
            "fanout" => (i > 0).then_some(0).into_iter().collect(),
            "diamond" => (i.saturating_sub(2)..i).collect(),
            // Dense bounded-width DAG: 16 predecessors, without quadratic source size.
            "dense" => (i.saturating_sub(16)..i).collect(),
            _ => Vec::new(),
        };
        let expression = deps
            .iter()
            .map(|j| format!("E{j}.position"))
            .collect::<Vec<_>>()
            .join(" + ");
        let expression = if expression.is_empty() {
            "vec3(0.0)"
        } else {
            &expression
        };
        if shape.starts_with("mesh-") {
            let size = match shape {
                "mesh-unique" => i + 1,
                "mesh-reuse" => i % 16 + 1,
                _ => 1,
            };
            writeln!(
                text,
                "entity E{i} {{ mesh: Box {{ size: vec3({size}.0) }}; }}"
            )
            .unwrap();
        } else {
            writeln!(text, "entity E{i} {{ position: bind({expression}); }}").unwrap();
        }
    }
    text.push_str("}\n");
    text
}

fn project_files(base: &std::path::Path, at: &std::path::Path, fs: &mut MemFs) {
    let mut entries: Vec<_> = std::fs::read_dir(at).unwrap().map(Result::unwrap).collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || matches!(name.as_ref(), "node_modules" | "dist") {
            continue;
        }
        let kind = entry.file_type().unwrap();
        if kind.is_dir() {
            project_files(base, &path, fs);
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            fs.insert(
                ProjectPath::new(&relative).unwrap(),
                std::fs::read(path).unwrap(),
            );
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let shape = args.get(1).expect("shape");
    let n: usize = args.get(2).expect("count").parse().unwrap();
    let samples: usize = args.get(3).expect("samples").parse().unwrap();
    let operation = args.get(4).map_or("analyze", String::as_str);
    let mut fs = MemFs::new();
    if let Some(path) = shape.strip_prefix("project:") {
        project_files(
            std::path::Path::new(path),
            std::path::Path::new(path),
            &mut fs,
        );
    } else {
        fs.insert(
            ProjectPath::new("mtek.toml").unwrap(),
            "[project]\nname = \"performance-audit\"\nlanguage = \"0.1\"\n",
        );
        fs.insert(ProjectPath::new("src/main.mtek").unwrap(), source(shape, n));
    }
    let root = ProjectRoot::at_base();
    let analysis = analyze_without_edits(&root, &fs);
    assert!(!analysis.has_errors(), "{:#?}", analysis.report);
    let program = ir::lower_to_ir(&analysis).unwrap();
    let options = CompileOptions::with_stub_runtime(BuildMode::Release);
    // One untimed warm-up, then retain every sample. Input construction is excluded.
    for sample in 0..=samples {
        let start = Instant::now();
        match operation {
            "analyze" => {
                let result = analyze_without_edits(&root, &fs);
                let elapsed = start.elapsed();
                assert!(!result.has_errors());
                black_box(&result);
                if sample > 0 {
                    println!("{shape},{n},{operation},{sample},{}", elapsed.as_nanos());
                }
            }
            "plan" => {
                let result = plan::plan_program(&program).unwrap();
                let elapsed = start.elapsed();
                black_box(&result);
                if sample > 0 {
                    println!("{shape},{n},{operation},{sample},{}", elapsed.as_nanos());
                }
            }
            "build" | "emit" => {
                let result = build(&root, &fs, &options);
                let elapsed = start.elapsed();
                assert!(!result.has_errors(), "{:#?}", result.report);
                black_box(&result);
                if sample > 0 {
                    println!("{shape},{n},build,{sample},{}", elapsed.as_nanos());
                }
                if operation == "emit" {
                    let directory = args.get(5).expect("output directory");
                    std::fs::create_dir_all(directory).unwrap();
                    for (path, bytes) in &result.files {
                        let path = std::path::Path::new(directory).join(path);
                        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                        std::fs::write(path, bytes).unwrap();
                    }
                    break;
                }
            }
            _ => panic!("unknown operation"),
        }
    }
}
