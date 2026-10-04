//! Writing a build's `dist/` to disk with replace-on-success (`spec/runtime-abi.md` section 2).
//!
//! The compiler library returns the file set in memory and the plan of file-system steps
//! ([`ReplacePlan`]); this module executes the steps. If one fails, the plan's recovery steps
//! run (their own failures are ignored: the first error is the one reported), so a failed
//! write leaves the previous output in place and no temporary directory behind.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use mtek_compiler::package::replace::file_segments;
use mtek_compiler::package::{ReplacePlan, ReplaceStep};

/// Writes `files` to `out_dir` with replace-on-success, using `build_id` for the sibling
/// directory names.
///
/// # Errors
/// The first I/O error, after the previous output has been restored; `InvalidInput` when
/// `out_dir` has no final directory name or a file name is not a plain relative path.
pub fn write_dist(
    out_dir: &Path,
    build_id: &str,
    files: &BTreeMap<String, Vec<u8>>,
) -> io::Result<()> {
    execute(out_dir, build_id, files, |step| run(step, files))
}

/// Executes the plan with `run` performing each step (tests inject failures through it).
fn execute(
    out_dir: &Path,
    build_id: &str,
    files: &BTreeMap<String, Vec<u8>>,
    mut run: impl FnMut(&ReplaceStep) -> io::Result<()>,
) -> io::Result<()> {
    let plan = ReplacePlan::new(out_dir, build_id).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "the output directory '{}' has no directory name",
                out_dir.display()
            ),
        )
    })?;
    if let Some(bad) = files.keys().find(|name| file_segments(name).is_none()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("'{bad}' is not a plain relative file name"),
        ));
    }
    for (index, step) in plan.steps().iter().enumerate() {
        if let Err(error) = run(step) {
            for recovery in plan.recovery(index) {
                // The original error is the one worth reporting.
                let _ = run(&recovery);
            }
            return Err(error);
        }
    }
    Ok(())
}

/// Performs one step on the real file system.
fn run(step: &ReplaceStep, files: &BTreeMap<String, Vec<u8>>) -> io::Result<()> {
    match step {
        ReplaceStep::RemoveDirIfExists(dir) => match fs::remove_dir_all(dir) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        },
        ReplaceStep::WriteFiles(dir) => {
            fs::create_dir_all(dir)?;
            for (name, bytes) in files {
                let mut path = dir.clone();
                for segment in file_segments(name).unwrap_or_default() {
                    path.push(segment);
                }
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&path, bytes)?;
            }
            Ok(())
        }
        ReplaceStep::RenameIfExists { from, to } => match fs::symlink_metadata(from) {
            Ok(_) => fs::rename(from, to),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
        ReplaceStep::Rename { from, to } => fs::rename(from, to),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fresh scratch directory for one test, removed again by [`Scratch::drop`].
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir =
                std::env::temp_dir().join(format!("mtek-cli-dist-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn file_set(content: &str) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        files.insert("index.html".to_owned(), content.as_bytes().to_vec());
        files.insert(
            "shaders/abc.wgsl".to_owned(),
            format!("// {content}\n").into_bytes(),
        );
        files
    }

    #[test]
    fn a_first_build_creates_the_output_directory() {
        let scratch = Scratch::new("first");
        let out = scratch.0.join("dist");
        write_dist(&out, "b1", &file_set("one")).unwrap();
        assert_eq!(fs::read_to_string(out.join("index.html")).unwrap(), "one");
        assert_eq!(
            fs::read_to_string(out.join("shaders/abc.wgsl")).unwrap(),
            "// one\n"
        );
        assert_eq!(scratch.names(), ["dist"]);
    }

    #[test]
    fn a_later_build_replaces_the_whole_tree() {
        let scratch = Scratch::new("replace");
        let out = scratch.0.join("dist");
        write_dist(&out, "b1", &file_set("one")).unwrap();
        fs::write(out.join("stale.js"), "old").unwrap();
        let mut second = file_set("two");
        second.remove("shaders/abc.wgsl");
        write_dist(&out, "b2", &second).unwrap();
        assert_eq!(fs::read_to_string(out.join("index.html")).unwrap(), "two");
        assert!(
            !out.join("stale.js").exists(),
            "files of the old tree are gone"
        );
        assert!(!out.join("shaders").exists());
        assert_eq!(
            scratch.names(),
            ["dist"],
            "no .tmp or .old directory remains"
        );
    }

    #[test]
    fn a_failed_write_leaves_the_previous_output_untouched() {
        let scratch = Scratch::new("fail-write");
        let out = scratch.0.join("dist");
        write_dist(&out, "b1", &file_set("one")).unwrap();
        let error = execute(&out, "b2", &file_set("two"), |step| match step {
            ReplaceStep::WriteFiles(dir) => {
                // Write part of the tree, then fail.
                fs::create_dir_all(dir)?;
                fs::write(dir.join("index.html"), "partial")?;
                Err(io::Error::other("disk full"))
            }
            other => run(other, &file_set("two")),
        })
        .unwrap_err();
        assert_eq!(error.to_string(), "disk full");
        assert_eq!(fs::read_to_string(out.join("index.html")).unwrap(), "one");
        assert_eq!(scratch.names(), ["dist"]);
    }

    #[test]
    fn a_failed_swap_moves_the_previous_output_back() {
        let scratch = Scratch::new("fail-swap");
        let out = scratch.0.join("dist");
        write_dist(&out, "b1", &file_set("one")).unwrap();
        let files = file_set("two");
        let error = execute(&out, "b2", &files, |step| match step {
            ReplaceStep::Rename { .. } => Err(io::Error::other("rename refused")),
            other => run(other, &files),
        })
        .unwrap_err();
        assert_eq!(error.to_string(), "rename refused");
        assert_eq!(fs::read_to_string(out.join("index.html")).unwrap(), "one");
        assert_eq!(scratch.names(), ["dist"]);
    }

    #[test]
    fn a_stale_temporary_directory_is_replaced() {
        let scratch = Scratch::new("stale-tmp");
        let out = scratch.0.join("dist");
        let stale = scratch.0.join("dist.tmp-b1");
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("junk"), "x").unwrap();
        write_dist(&out, "b1", &file_set("one")).unwrap();
        assert!(!out.join("junk").exists());
        assert_eq!(scratch.names(), ["dist"]);
    }

    #[test]
    fn a_compiled_build_is_written_file_for_file() {
        use mtek_compiler::project::ProjectRoot;
        use mtek_compiler::source::{MemFs, ProjectPath};
        use mtek_compiler::{BuildMode, CompileOptions, build};

        let mut project = MemFs::new();
        project
            .insert(
                ProjectPath::new("mtek.toml").unwrap(),
                "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n",
            )
            .insert(
                ProjectPath::new("src/main.mtek").unwrap(),
                "scene Demo {\n    camera Main {}\n    entity Cube { mesh: Box {}; }\n}\n",
            );
        let result = build(
            &ProjectRoot::at_base(),
            &project,
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!result.has_errors(), "{:?}", result.report.diagnostics);
        let build_id = result.build_id.clone().unwrap();
        let scratch = Scratch::new("compiled");
        let out = scratch.0.join(result.out_dir.unwrap().as_str());
        write_dist(&out, &build_id, &result.files).unwrap();
        for (name, bytes) in &result.files {
            assert_eq!(&fs::read(out.join(name)).unwrap(), bytes, "{name}");
        }
        assert_eq!(scratch.names(), ["dist"]);
    }

    #[test]
    fn bad_names_are_rejected_before_anything_is_written() {
        let scratch = Scratch::new("bad-names");
        let out = scratch.0.join("dist");
        let mut files = file_set("one");
        files.insert("../escape.js".to_owned(), Vec::new());
        let error = write_dist(&out, "b1", &files).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(scratch.names().is_empty());
        let error = write_dist(Path::new("."), "b1", &file_set("x")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }
}
