//! Replace on success (`spec/runtime-abi.md` section 2), as a pure plan: the library performs no
//! I/O, so it decides *what* to do and the command line tool executes the steps.
//!
//! A build writes the whole file set into the sibling directory `<out_dir>.tmp-<buildId>`;
//! only when that succeeded is the existing `<out_dir>` renamed to `<out_dir>.old-<buildId>`,
//! the temporary directory renamed to `<out_dir>`, and the old directory deleted (Windows
//! cannot rename onto an existing directory, hence three steps). It is not atomic: between
//! the two renames `<out_dir>` does not exist. If a step fails, [`ReplacePlan::recovery`] lists
//! what restores the previous output: the temporary directory is deleted and, if the old
//! output was already moved aside, it is moved back.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// One file-system operation of the plan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReplaceStep {
    /// Delete the directory and everything in it, if it exists.
    RemoveDirIfExists(PathBuf),
    /// Create the directory and write every file of the build's file set into it
    /// (`shaders/x.wgsl` → `<dir>/shaders/x.wgsl`, creating parent directories).
    WriteFiles(PathBuf),
    /// Rename `from` to `to` if `from` exists.
    RenameIfExists { from: PathBuf, to: PathBuf },
    /// Rename `from` to `to`.
    Rename { from: PathBuf, to: PathBuf },
}

/// The directories of one replace-on-success write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplacePlan {
    /// The output directory (`dist`).
    pub out_dir: PathBuf,
    /// `<out_dir>.tmp-<buildId>`.
    pub temporary: PathBuf,
    /// `<out_dir>.old-<buildId>`.
    pub old: PathBuf,
}

impl ReplacePlan {
    /// The plan for writing a build with id `build_id` to `out_dir`. `None` when `out_dir` does
    /// not end in a directory name (`.`, `..`, a root), which has no sibling to write into.
    #[must_use]
    pub fn new(out_dir: &Path, build_id: &str) -> Option<ReplacePlan> {
        // Normalise away a trailing separator and `.` segments.
        let out_dir: PathBuf = out_dir
            .components()
            .filter(|c| !matches!(c, Component::CurDir))
            .collect();
        if !matches!(out_dir.components().next_back(), Some(Component::Normal(_))) {
            return None;
        }
        let sibling = |suffix: &str| {
            let mut name: OsString = out_dir.as_os_str().to_owned();
            name.push(suffix);
            name.push(build_id);
            PathBuf::from(name)
        };
        Some(ReplacePlan {
            temporary: sibling(".tmp-"),
            old: sibling(".old-"),
            out_dir,
        })
    }

    /// The steps, in order.
    #[must_use]
    pub fn steps(&self) -> Vec<ReplaceStep> {
        vec![
            // A temporary directory left by an interrupted build with the same id.
            ReplaceStep::RemoveDirIfExists(self.temporary.clone()),
            ReplaceStep::WriteFiles(self.temporary.clone()),
            ReplaceStep::RenameIfExists {
                from: self.out_dir.clone(),
                to: self.old.clone(),
            },
            ReplaceStep::Rename {
                from: self.temporary.clone(),
                to: self.out_dir.clone(),
            },
            ReplaceStep::RemoveDirIfExists(self.old.clone()),
        ]
    }

    /// What to do after step `failed` (an index into [`ReplacePlan::steps`]) failed, so that the
    /// previous output stays (or is again) in place and no temporary directory remains. A
    /// failure of the last step (deleting the old output) leaves the new output in place and
    /// only the `.old` directory behind, which the next build with the same id removes.
    #[must_use]
    pub fn recovery(&self, failed: usize) -> Vec<ReplaceStep> {
        match failed {
            0..=2 => vec![ReplaceStep::RemoveDirIfExists(self.temporary.clone())],
            3 => vec![
                ReplaceStep::RenameIfExists {
                    from: self.old.clone(),
                    to: self.out_dir.clone(),
                },
                ReplaceStep::RemoveDirIfExists(self.temporary.clone()),
            ],
            _ => Vec::new(),
        }
    }
}

/// The relative path of a file of the build's file set (`shaders/x.wgsl`) as path segments, or
/// `None` if it is not a plain relative path of named segments.
#[must_use]
pub fn file_segments(name: &str) -> Option<Vec<&str>> {
    let segments: Vec<&str> = name.split('/').collect();
    let plain = segments
        .iter()
        .all(|s| !s.is_empty() && *s != "." && *s != ".." && !s.contains(['\\', ':']));
    plain.then_some(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn siblings_carry_the_build_id() {
        let plan = ReplacePlan::new(Path::new("web/dist/"), "abc").expect("plan");
        assert_eq!(plan.out_dir, Path::new("web/dist"));
        assert_eq!(plan.temporary, Path::new("web/dist.tmp-abc"));
        assert_eq!(plan.old, Path::new("web/dist.old-abc"));
        let plan = ReplacePlan::new(Path::new("./dist"), "abc").expect("plan");
        assert_eq!(plan.temporary, Path::new("dist.tmp-abc"));
    }

    #[test]
    fn a_directory_without_a_name_has_no_plan() {
        assert_eq!(ReplacePlan::new(Path::new("."), "x"), None);
        assert_eq!(ReplacePlan::new(Path::new(""), "x"), None);
        assert_eq!(ReplacePlan::new(Path::new("a/.."), "x"), None);
    }

    #[test]
    fn the_steps_write_aside_then_swap_then_clean_up() {
        let plan = ReplacePlan::new(Path::new("dist"), "id").expect("plan");
        let tmp = PathBuf::from("dist.tmp-id");
        let old = PathBuf::from("dist.old-id");
        let out = PathBuf::from("dist");
        assert_eq!(
            plan.steps(),
            [
                ReplaceStep::RemoveDirIfExists(tmp.clone()),
                ReplaceStep::WriteFiles(tmp.clone()),
                ReplaceStep::RenameIfExists {
                    from: out.clone(),
                    to: old.clone()
                },
                ReplaceStep::Rename {
                    from: tmp.clone(),
                    to: out.clone()
                },
                ReplaceStep::RemoveDirIfExists(old.clone()),
            ]
        );
        // Writing failed: only the temporary directory goes; the old output was never touched.
        assert_eq!(
            plan.recovery(1),
            [ReplaceStep::RemoveDirIfExists(tmp.clone())]
        );
        // The swap failed after the old output was moved aside: move it back.
        assert_eq!(
            plan.recovery(3),
            [
                ReplaceStep::RenameIfExists { from: old, to: out },
                ReplaceStep::RemoveDirIfExists(tmp)
            ]
        );
        assert!(plan.recovery(4).is_empty());
    }

    #[test]
    fn only_plain_relative_file_names_are_written() {
        assert_eq!(file_segments("app.js"), Some(vec!["app.js"]));
        assert_eq!(
            file_segments("shaders/a.wgsl"),
            Some(vec!["shaders", "a.wgsl"])
        );
        for bad in ["", "/a", "a//b", "../a", "a/./b", "a\\b", "C:/a"] {
            assert_eq!(file_segments(bad), None, "{bad}");
        }
    }
}
