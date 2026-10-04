//! The real file system behind the compiler's [`Fs`] trait
//! (`spec/compiler-architecture.md` section 4.1).
//!
//! Every path is checked segment by segment against the directory listing of its parent, so
//! a path whose case differs from the stored name is not found, even on the case-insensitive
//! file systems of Windows and macOS (`spec/language.md` section 9.1). Error messages carry the
//! project-relative path and the operating system's message, never the absolute location.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use mtek_compiler::source::{Fs, FsError, ProjectPath};

/// The directory tree below `base`, read through the compiler's [`Fs`] trait.
#[derive(Clone, Debug)]
pub struct RealFs {
    base: PathBuf,
}

impl RealFs {
    /// The file system whose project-relative paths start at `base`.
    pub fn new(base: impl Into<PathBuf>) -> Self {
        Self { base: base.into() }
    }

    /// The real location of `p` if every segment exists with exactly this case; `None` if
    /// some segment does not (or a segment before the last is not a directory).
    fn locate(&self, p: &ProjectPath) -> io::Result<Option<PathBuf>> {
        let mut current = self.base.clone();
        for segment in p.segments() {
            let entries = match fs::read_dir(&current) {
                Ok(entries) => entries,
                Err(error) if is_missing(&error) || is_file(&current) => return Ok(None),
                Err(error) => return Err(error),
            };
            let mut found = false;
            for entry in entries {
                if entry?.file_name() == segment {
                    found = true;
                    break;
                }
            }
            if !found {
                return Ok(None);
            }
            current.push(segment);
        }
        Ok(Some(current))
    }
}

/// True for errors that mean "nothing is there".
fn is_missing(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

/// True if `path` exists and is not a directory.
fn is_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| !m.is_dir())
}

/// `error` as an [`FsError`] about `p`.
fn other(p: &ProjectPath, error: &io::Error) -> FsError {
    FsError::Other {
        path: p.clone(),
        message: error.to_string(),
    }
}

impl Fs for RealFs {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        let path = match self.locate(p) {
            Ok(Some(path)) => path,
            Ok(None) => return Err(FsError::NotFound(p.clone())),
            Err(error) => return Err(other(p, &error)),
        };
        match fs::metadata(&path) {
            Ok(metadata) if metadata.is_dir() => return Err(FsError::IsADirectory(p.clone())),
            Ok(_) => {}
            Err(error) if is_missing(&error) => return Err(FsError::NotFound(p.clone())),
            Err(error) => return Err(other(p, &error)),
        }
        fs::read(&path).map_err(|error| {
            if is_missing(&error) {
                FsError::NotFound(p.clone())
            } else {
                other(p, &error)
            }
        })
    }

    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        matches!(self.locate(p), Ok(Some(path)) if fs::metadata(&path).is_ok())
    }

    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        let path = match self.locate(p) {
            Ok(Some(path)) => path,
            Ok(None) => return Err(FsError::NotFound(p.clone())),
            Err(error) => return Err(other(p, &error)),
        };
        match fs::metadata(&path) {
            Ok(metadata) if !metadata.is_dir() => return Err(FsError::NotADirectory(p.clone())),
            Ok(_) => {}
            Err(error) if is_missing(&error) => return Err(FsError::NotFound(p.clone())),
            Err(error) => return Err(other(p, &error)),
        }
        let entries = fs::read_dir(&path).map_err(|error| other(p, &error))?;
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| other(p, &error))?;
            // A name that is not UTF-8 cannot be a `ProjectPath` segment, so no read can name it.
            if let Ok(name) = entry.file_name().into_string() {
                names.push(name);
            }
        }
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh scratch directory for one test, removed again on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir =
                std::env::temp_dir().join(format!("mtek-cli-realfs-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn file(&self, rel: &str, content: &str) -> &Self {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
            self
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn sample(name: &str) -> (Scratch, RealFs) {
        let scratch = Scratch::new(name);
        scratch
            .file("mtek.toml", "[project]\n")
            .file("src/Main.mtek", "scene\r\n")
            .file("src/deep/a.mtek", "a");
        let fs = RealFs::new(&scratch.0);
        (scratch, fs)
    }

    #[test]
    fn read_returns_the_bytes_as_stored() {
        let (_scratch, fs) = sample("read");
        assert_eq!(fs.read(&p("mtek.toml")), Ok(b"[project]\n".to_vec()));
        assert_eq!(fs.read(&p("src/Main.mtek")), Ok(b"scene\r\n".to_vec()));
        assert_eq!(fs.read(&p("src/deep/a.mtek")), Ok(b"a".to_vec()));
    }

    #[test]
    fn a_path_that_differs_in_case_is_not_found() {
        let (_scratch, fs) = sample("case");
        for wrong in [
            "src/main.mtek",
            "SRC/Main.mtek",
            "Mtek.toml",
            "src/Deep/a.mtek",
        ] {
            assert_eq!(
                fs.read(&p(wrong)),
                Err(FsError::NotFound(p(wrong))),
                "{wrong}"
            );
            assert!(!fs.exact_case_exists(&p(wrong)), "{wrong}");
        }
        assert_eq!(
            fs.list_dir(&p("Src")),
            Err(FsError::NotFound(p("Src"))),
            "listing checks case too"
        );
        assert!(fs.exact_case_exists(&p("src/Main.mtek")));
        assert!(fs.exact_case_exists(&p("src/deep")));
        assert!(fs.exact_case_exists(&ProjectPath::root()));
    }

    #[test]
    fn missing_files_and_kinds_are_reported() {
        let (_scratch, fs) = sample("kinds");
        assert_eq!(
            fs.read(&p("nope.mtek")),
            Err(FsError::NotFound(p("nope.mtek")))
        );
        assert_eq!(fs.read(&p("src")), Err(FsError::IsADirectory(p("src"))));
        assert_eq!(
            fs.read(&ProjectPath::root()),
            Err(FsError::IsADirectory(ProjectPath::root()))
        );
        assert_eq!(
            fs.read(&p("mtek.toml/inner")),
            Err(FsError::NotFound(p("mtek.toml/inner"))),
            "a file is not a directory on the way"
        );
        assert_eq!(
            fs.list_dir(&p("mtek.toml")),
            Err(FsError::NotADirectory(p("mtek.toml")))
        );
        assert_eq!(fs.list_dir(&p("gone")), Err(FsError::NotFound(p("gone"))));
    }

    #[test]
    fn list_dir_names_entries_directly_inside() {
        let (_scratch, fs) = sample("list");
        let mut root = fs.list_dir(&ProjectPath::root()).unwrap();
        root.sort();
        assert_eq!(root, ["mtek.toml", "src"]);
        let mut src = fs.list_dir(&p("src")).unwrap();
        src.sort();
        assert_eq!(src, ["Main.mtek", "deep"]);
    }

    #[test]
    fn a_base_that_does_not_exist_has_nothing() {
        let scratch = Scratch::new("no-base");
        let fs = RealFs::new(scratch.0.join("missing"));
        assert_eq!(
            fs.read(&p("mtek.toml")),
            Err(FsError::NotFound(p("mtek.toml")))
        );
        assert!(!fs.exact_case_exists(&ProjectPath::root()));
        assert_eq!(
            fs.list_dir(&ProjectPath::root()),
            Err(FsError::NotFound(ProjectPath::root()))
        );
    }

    #[test]
    fn errors_name_the_project_relative_path_only() {
        let (scratch, fs) = sample("messages");
        let error = fs.read(&p("src/deep")).unwrap_err().to_string();
        assert_eq!(error, "'src/deep' is a directory");
        assert!(!error.contains(&*scratch.0.to_string_lossy()));
    }
}
