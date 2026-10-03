//! Locating a project: the project root and the file-system view of it.
//!
//! An [`Fs`] has a *base* directory and all its paths are relative to it. A
//! project root is a directory at or below that base: the nearest one that
//! contains `mtek.toml`. [`ProjectRoot::view`] then gives the rest of the
//! compiler an [`Fs`] whose paths are relative to the project root, which is
//! what `spec/compiler-architecture.md` section 4.1 means by a
//! `ProjectPath`.

use super::config::{PROJECT_FILE, constant_path};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::{Fs, FsError, ProjectPath};

/// The directory of a project, as a path relative to the base of the [`Fs`]
/// it was found in. [`ProjectPath::root`] when the base is the project root
/// (for example an `Fs` that the command line tool already rooted at the
/// project directory, or an in-memory project in a test).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ProjectRoot {
    dir: ProjectPath,
}

impl ProjectRoot {
    /// The project in directory `dir` of the file system, without checking
    /// that it contains a `mtek.toml` (loading reports `E9004` then).
    #[must_use]
    pub fn new(dir: ProjectPath) -> Self {
        Self { dir }
    }

    /// The project whose root is the base of the file system.
    #[must_use]
    pub fn at_base() -> Self {
        Self::new(ProjectPath::root())
    }

    /// The nearest directory at or above `start` that contains a file named
    /// `mtek.toml`, searching up to and including the base of `fs`.
    ///
    /// `start` is a directory; a caller given a file path starts at its
    /// parent. Reports `E9004` and returns `None` if no directory qualifies,
    /// or if a candidate `mtek.toml` exists but cannot be read.
    pub fn discover(
        fs: &dyn Fs,
        start: &ProjectPath,
        diagnostics: &mut Diagnostics,
    ) -> Option<ProjectRoot> {
        let project_file = constant_path(PROJECT_FILE);
        let mut dir = start.clone();
        loop {
            match fs.read(&dir.join(&project_file)) {
                Ok(_) => return Some(ProjectRoot::new(dir)),
                // A directory called mtek.toml, or a `dir` that is itself a
                // file, does not make a project; keep looking.
                Err(
                    FsError::NotFound(_) | FsError::IsADirectory(_) | FsError::NotADirectory(_),
                ) => {}
                Err(error @ FsError::Other { .. }) => {
                    diagnostics.push(
                        Diagnostic::new(
                            Code::E9004,
                            format!("Could not read the project file: {error}."),
                        )
                        .help("check the permissions of the file"),
                    );
                    return None;
                }
            }
            match dir.parent() {
                Some(parent) => dir = parent,
                None => break,
            }
        }
        let place = if start.is_root() {
            "the current directory".to_owned()
        } else {
            format!("'{start}'")
        };
        diagnostics.push(
            Diagnostic::new(
                Code::E9004,
                format!("No {PROJECT_FILE} found in {place} or any of its parent directories."),
            )
            .help(format!(
                "create a {PROJECT_FILE} in the project directory with a [project] table that sets `name` and `language`"
            )),
        );
        None
    }

    /// The project directory relative to the base of the file system.
    #[must_use]
    pub fn dir(&self) -> &ProjectPath {
        &self.dir
    }

    /// `fs` seen from the project root: paths given to the returned [`Fs`]
    /// are project-relative, as everywhere in the compiler.
    #[must_use]
    pub fn view<'a>(&'a self, fs: &'a dyn Fs) -> ProjectFs<'a> {
        ProjectFs { root: self, fs }
    }
}

/// An [`Fs`] rooted at a project directory, created by [`ProjectRoot::view`].
/// Errors name project-relative paths, whatever the real location is.
#[derive(Clone, Copy)]
pub struct ProjectFs<'a> {
    root: &'a ProjectRoot,
    fs: &'a dyn Fs,
}

impl ProjectFs<'_> {
    fn real(&self, p: &ProjectPath) -> ProjectPath {
        self.root.dir.join(p)
    }
}

/// `error` with the path replaced by the project-relative `p`.
fn rebase(error: FsError, p: &ProjectPath) -> FsError {
    match error {
        FsError::NotFound(_) => FsError::NotFound(p.clone()),
        FsError::IsADirectory(_) => FsError::IsADirectory(p.clone()),
        FsError::NotADirectory(_) => FsError::NotADirectory(p.clone()),
        FsError::Other { message, .. } => FsError::Other {
            path: p.clone(),
            message,
        },
    }
}

impl Fs for ProjectFs<'_> {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        self.fs.read(&self.real(p)).map_err(|e| rebase(e, p))
    }

    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        self.fs.exact_case_exists(&self.real(p))
    }

    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        self.fs.list_dir(&self.real(p)).map_err(|e| rebase(e, p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemFs;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn discover(fs: &MemFs, start: &ProjectPath) -> (Option<ProjectRoot>, Diagnostics) {
        let mut diagnostics = Diagnostics::new();
        let root = ProjectRoot::discover(fs, start, &mut diagnostics);
        (root, diagnostics)
    }

    fn fs_with_projects() -> MemFs {
        let mut fs = MemFs::new();
        fs.insert(p("work/app/mtek.toml"), "")
            .insert(p("work/app/src/main.mtek"), "")
            .insert(p("work/app/src/deep/er/x.mtek"), "")
            .insert(p("work/app/sub/mtek.toml"), "")
            .insert(p("work/other/readme.txt"), "")
            .insert(p("top.txt"), "");
        fs
    }

    #[test]
    fn discovers_the_project_at_the_start_directory() {
        let (root, diagnostics) = discover(&fs_with_projects(), &p("work/app"));
        assert_eq!(root, Some(ProjectRoot::new(p("work/app"))));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn discovers_the_nearest_ancestor() {
        let fs = fs_with_projects();
        let (root, _) = discover(&fs, &p("work/app/src/deep/er"));
        assert_eq!(root.unwrap().dir(), &p("work/app"));
        let (root, _) = discover(&fs, &p("work/app/sub"));
        assert_eq!(root.unwrap().dir(), &p("work/app/sub"), "nearest wins");
        let (root, _) = discover(&fs, &p("work/app/sub/nonexistent/dir"));
        assert_eq!(
            root.unwrap().dir(),
            &p("work/app/sub"),
            "a start directory that does not exist is searched from its ancestors"
        );
    }

    #[test]
    fn discovers_a_project_at_the_base_of_the_file_system() {
        let mut fs = MemFs::new();
        fs.insert(p("mtek.toml"), "").insert(p("a/b/c.mtek"), "");
        let (root, _) = discover(&fs, &p("a/b"));
        assert_eq!(root, Some(ProjectRoot::at_base()));
        let (root, _) = discover(&fs, &ProjectPath::root());
        assert_eq!(root, Some(ProjectRoot::at_base()));
    }

    #[test]
    fn missing_project_file_is_e9004() {
        let (root, diagnostics) = discover(&fs_with_projects(), &p("work/other"));
        assert_eq!(root, None);
        let report = diagnostics.finish();
        assert_eq!(report.diagnostics.len(), 1);
        let d = &report.diagnostics[0];
        assert_eq!(d.code, Code::E9004);
        assert_eq!(
            d.message,
            "No mtek.toml found in 'work/other' or any of its parent directories."
        );
        assert!(d.primary.is_none());
    }

    #[test]
    fn missing_project_file_at_the_base_names_the_current_directory() {
        let (root, diagnostics) = discover(&MemFs::new(), &ProjectPath::root());
        assert_eq!(root, None);
        let report = diagnostics.finish();
        assert_eq!(
            report.diagnostics[0].message,
            "No mtek.toml found in the current directory or any of its parent directories."
        );
    }

    #[test]
    fn a_directory_named_mtek_toml_is_not_a_project_file() {
        let mut fs = MemFs::new();
        fs.insert(p("a/mtek.toml/inner.txt"), "");
        let (root, diagnostics) = discover(&fs, &p("a"));
        assert_eq!(root, None);
        assert!(diagnostics.has_errors());
    }

    #[test]
    fn a_file_name_that_differs_in_case_is_not_a_project_file() {
        let mut fs = MemFs::new();
        fs.insert(p("a/MTEK.toml"), "");
        let (root, _) = discover(&fs, &p("a"));
        assert_eq!(root, None);
    }

    /// An `Fs` whose reads fail with an I/O error.
    struct Broken;

    impl Fs for Broken {
        fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
            Err(FsError::Other {
                path: p.clone(),
                message: "permission denied".to_owned(),
            })
        }
        fn exact_case_exists(&self, _: &ProjectPath) -> bool {
            true
        }
        fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
            Err(FsError::NotFound(p.clone()))
        }
    }

    #[test]
    fn unreadable_candidate_is_reported_not_skipped() {
        let mut diagnostics = Diagnostics::new();
        assert_eq!(
            ProjectRoot::discover(&Broken, &p("a/b"), &mut diagnostics),
            None
        );
        let report = diagnostics.finish();
        assert_eq!(report.diagnostics[0].code, Code::E9004);
        assert_eq!(
            report.diagnostics[0].message,
            "Could not read the project file: 'a/b/mtek.toml': permission denied."
        );
    }

    #[test]
    fn view_translates_paths_and_errors() {
        let fs = fs_with_projects();
        let root = ProjectRoot::new(p("work/app"));
        let view = root.view(&fs);
        assert_eq!(view.read(&p("src/main.mtek")), Ok(Vec::new()));
        assert_eq!(
            view.read(&p("src/missing.mtek")),
            Err(FsError::NotFound(p("src/missing.mtek")))
        );
        assert_eq!(view.read(&p("src")), Err(FsError::IsADirectory(p("src"))));
        assert!(view.exact_case_exists(&p("src/deep")));
        assert!(!view.exact_case_exists(&p("SRC")));
        assert_eq!(
            view.list_dir(&ProjectPath::root()),
            Ok(vec![
                "mtek.toml".to_owned(),
                "src".to_owned(),
                "sub".to_owned()
            ])
        );
        assert_eq!(
            view.list_dir(&p("src/main.mtek")),
            Err(FsError::NotADirectory(p("src/main.mtek")))
        );
    }

    #[test]
    fn view_of_the_base_is_the_file_system_itself() {
        let fs = fs_with_projects();
        let root = ProjectRoot::at_base();
        let view = root.view(&fs);
        assert_eq!(view.read(&p("top.txt")), Ok(Vec::new()));
        assert!(view.exact_case_exists(&p("work/app")));
    }

    #[test]
    fn view_rebases_other_errors() {
        let root = ProjectRoot::new(p("x"));
        let view = root.view(&Broken);
        assert_eq!(
            view.read(&p("y.mtek")),
            Err(FsError::Other {
                path: p("y.mtek"),
                message: "permission denied".to_owned()
            })
        );
    }
}
