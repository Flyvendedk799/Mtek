//! Integration tests of `mtek fmt` (decision 0070): the real binary on files in temporary
//! directories.

// Test-only code: helper functions outside `#[test]` functions may unwrap and panic.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const UGLY: &str = "scene Demo{camera Main{}\nentity Cube{mesh:Box{size:vec3(1.0,1.0,1.0);};}}\n";
const PRETTY: &str = "scene Demo {\n    camera Main {}\n    entity Cube {\n        mesh: Box { size: vec3(1.0, 1.0, 1.0) };\n    }\n}\n";
/// A syntax error: the `;` is missing.
const BROKEN: &str = "const A = 1\nconst B = 2;\n";

/// A fresh directory for one test, removed again on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("mtek-fmt-it-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.path(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.path(rel)).unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_in(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mtek"))
        .args(args)
        .current_dir(cwd)
        .env_remove("NO_COLOR")
        .output()
        .unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8(out.stderr.clone()).unwrap()
}

#[test]
fn fmt_rewrites_files_in_place_and_a_second_run_changes_nothing() {
    let scratch = Scratch::new("rewrite");
    scratch.write("a.mtek", UGLY);
    scratch.write("src/b.mtek", UGLY);
    scratch.write("src/notes.txt", "not mtek");
    let out = run_in(&scratch.0, &["fmt"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "formatted a.mtek\nformatted src/b.mtek\nformatted 2 of 2 files\n"
    );
    assert!(stderr(&out).is_empty());
    assert_eq!(scratch.read("a.mtek"), PRETTY);
    assert_eq!(scratch.read("src/b.mtek"), PRETTY);
    assert_eq!(scratch.read("src/notes.txt"), "not mtek");
    let left: Vec<String> = fs::read_dir(scratch.path("src"))
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert!(
        left.iter().all(|name| !name.ends_with(".fmt-tmp")),
        "no temporary file is left behind: {left:?}"
    );
    let again = run_in(&scratch.0, &["fmt"]);
    assert_eq!(again.status.code(), Some(0));
    assert_eq!(stdout(&again), "2 files already formatted\n");
}

#[test]
fn check_lists_the_files_to_change_and_writes_nothing() {
    let scratch = Scratch::new("check");
    scratch.write("ugly.mtek", UGLY);
    scratch.write("pretty.mtek", PRETTY);
    let out = run_in(&scratch.0, &["fmt", "--check"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "would reformat ugly.mtek\n");
    assert_eq!(
        stderr(&out),
        "fmt --check failed: 1 of 2 files would be reformatted (run `mtek fmt` to format them)\n"
    );
    assert_eq!(scratch.read("ugly.mtek"), UGLY);

    scratch.write("ugly.mtek", PRETTY);
    let ok = run_in(&scratch.0, &["fmt", "--check"]);
    assert_eq!(ok.status.code(), Some(0));
    assert_eq!(stdout(&ok), "checked 2 files: all formatted\n");
    assert!(stderr(&ok).is_empty());
}

#[test]
fn files_and_directories_are_taken_and_dependencies_and_build_output_skipped() {
    let scratch = Scratch::new("paths");
    scratch.write("one.mtek", UGLY);
    scratch.write("dir/two.mtek", UGLY);
    scratch.write("dir/node_modules/dep.mtek", UGLY);
    scratch.write("dir/.hidden/h.mtek", UGLY);
    scratch.write("dir/target/t.mtek", UGLY);
    let out = run_in(&scratch.0, &["fmt", "--check", "dir"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "would reformat dir/two.mtek\n");
    // A file is taken whatever its name.
    scratch.write("plain.txt", UGLY);
    let out = run_in(&scratch.0, &["fmt", "--check", "plain.txt", "one.mtek"]);
    assert_eq!(
        stdout(&out),
        "would reformat one.mtek\nwould reformat plain.txt\n"
    );
}

#[test]
fn a_file_that_does_not_parse_is_refused_and_never_rewritten() {
    let scratch = Scratch::new("refuse");
    scratch.write("broken.mtek", BROKEN);
    scratch.write("ugly.mtek", UGLY);
    for args in [&["fmt"][..], &["fmt", "--check"]] {
        let out = run_in(&scratch.0, args);
        assert_eq!(out.status.code(), Some(1), "{args:?}");
        let text = stderr(&out);
        assert!(text.contains("error[MTEK-E1003]"), "{text}");
        assert!(text.contains("broken.mtek:1:"), "{text}");
        assert!(
            text.contains("1 file not formatted: 1 error, 0 warnings"),
            "{text}"
        );
        assert_eq!(scratch.read("broken.mtek"), BROKEN);
    }
    // The other file was formatted by the first run, whatever the exit code.
    assert_eq!(scratch.read("ugly.mtek"), PRETTY);
}

#[test]
fn a_missing_path_is_an_io_failure() {
    let scratch = Scratch::new("missing");
    let out = run_in(&scratch.0, &["fmt", "--check", "nothing.mtek"]);
    assert_eq!(out.status.code(), Some(3));
    assert!(
        stderr(&out).contains("cannot read 'nothing.mtek'"),
        "{}",
        stderr(&out)
    );
    assert!(stdout(&out).is_empty());
}

#[test]
fn comments_are_kept_and_a_warning_does_not_stop_the_formatting() {
    let scratch = Scratch::new("comments");
    scratch.write(
        "c.mtek",
        "// head\nscene Demo{ // brace\n camera Main{}\n /// dangling\n}\n",
    );
    let out = run_in(&scratch.0, &["fmt"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        scratch.read("c.mtek"),
        "// head\nscene Demo { // brace\n    camera Main {}\n    /// dangling\n}\n"
    );
}

#[test]
fn lf_is_written_and_a_byte_order_mark_is_dropped() {
    let scratch = Scratch::new("bytes");
    fs::write(scratch.path("w.mtek"), "\u{feff}fn f() {\r\n}\r\n").unwrap();
    let out = run_in(&scratch.0, &["fmt"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(fs::read(scratch.path("w.mtek")).unwrap(), b"fn f() {}\n");
}

#[test]
fn no_project_is_needed_and_there_is_no_format_option() {
    let scratch = Scratch::new("usage");
    let out = run_in(&scratch.0, &["fmt", "--format", "json"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stdout(&out).is_empty());
    let out = run_in(&scratch.0, &["fmt"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(stdout(&out), "0 files already formatted\n");
}

/// Starters that are broken on purpose: their task is to repair a syntax error, so `mtek fmt` must
/// refuse them. Every other Mtek source of the benchmarks is canonical.
const BROKEN_ON_PURPOSE: [&str; 1] = ["benchmarks/tasks/maintenance-03/mtek"];

/// The runtime benchmark programs are printed by `benchmarks/runtime/tools/gen-mtek.ts` and frozen
/// by tree hash (decisions 0097 and 0105): canonical form would multiply them to some twenty
/// thousand lines and change the frozen definitions, so they are not held to `mtek fmt`.
const GENERATED_AND_FROZEN: &str = "benchmarks/runtime/";

/// The directories named `mtek` below `dir` (starters and references of the benchmark tasks).
fn mtek_dirs(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().is_some_and(|name| name == "mtek") {
            found.push(path);
        } else {
            mtek_dirs(&path, found);
        }
    }
}

#[test]
fn the_repository_sources_that_ci_checks_are_canonical() {
    // What CI checks (decision 0070): the examples, the CLI templates and every Mtek source of the
    // benchmark tasks and the holdout, except the starters that are broken on purpose.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut dirs = Vec::new();
    mtek_dirs(&root.join("benchmarks"), &mut dirs);
    let mut paths: Vec<String> = vec!["examples".into(), "crates/mtek-cli/templates".into()];
    for dir in dirs {
        let relative = dir
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if !BROKEN_ON_PURPOSE.contains(&relative.as_str())
            && !relative.starts_with(GENERATED_AND_FROZEN)
        {
            paths.push(relative);
        }
    }
    assert!(
        paths.len() > 60,
        "the benchmark sources were found: {paths:?}"
    );
    let mut args = vec!["fmt", "--check"];
    args.extend(paths.iter().map(String::as_str));
    let out = run_in(&root, &args);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}{}",
        stdout(&out),
        stderr(&out)
    );
}
