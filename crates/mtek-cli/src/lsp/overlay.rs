//! The unsaved buffers of the editor over the files on disk (`spec/compiler-architecture.md`
//! section 4.1: the language server's unsaved buffers are an in-memory file system).
//!
//! [`OverlayFs`] serves a file from its open buffer when there is one, and from the base file
//! system otherwise. A buffer whose file does not exist on disk (a new file) is served too, and
//! shows up in directory listings, so an import of a file that has not been saved yet resolves.
//! Nothing here ever writes: the editor's text reaches the compiler only through reads.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use mtek_compiler::source::{Fs, FsError, ProjectPath};

/// The open buffers of a project, by project-relative path.
pub type Buffers = BTreeMap<ProjectPath, Arc<str>>;

/// `base` with `buffers` laid over it.
pub struct OverlayFs<'a> {
    base: &'a dyn Fs,
    buffers: &'a Buffers,
}

impl<'a> OverlayFs<'a> {
    pub fn new(base: &'a dyn Fs, buffers: &'a Buffers) -> Self {
        Self { base, buffers }
    }

    /// True if some buffer is a file below the directory `dir`.
    fn has_buffer_below(&self, dir: &ProjectPath) -> bool {
        if dir.is_root() {
            return !self.buffers.is_empty();
        }
        let prefix = format!("{}/", dir.as_str());
        self.buffers
            .keys()
            .any(|path| path.as_str().starts_with(&prefix))
    }
}

impl Fs for OverlayFs<'_> {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        match self.buffers.get(p) {
            Some(text) => Ok(text.as_bytes().to_vec()),
            None => self.base.read(p),
        }
    }

    fn len(&self, p: &ProjectPath) -> Result<u64, FsError> {
        match self.buffers.get(p) {
            Some(text) => Ok(text.len() as u64),
            None => self.base.len(p),
        }
    }

    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        self.buffers.contains_key(p) || self.has_buffer_below(p) || self.base.exact_case_exists(p)
    }

    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        if self.buffers.contains_key(p) {
            return Err(FsError::NotADirectory(p.clone()));
        }
        let from_buffers: BTreeSet<&str> = {
            let prefix = if p.is_root() {
                String::new()
            } else {
                format!("{}/", p.as_str())
            };
            self.buffers
                .keys()
                .filter_map(|path| path.as_str().strip_prefix(prefix.as_str()))
                .filter_map(|rest| rest.split('/').next())
                .collect()
        };
        let mut names = match self.base.list_dir(p) {
            Ok(names) => names,
            // The directory exists only through buffers (a new file in a new directory).
            Err(FsError::NotFound(_)) if !from_buffers.is_empty() => Vec::new(),
            Err(error) => return Err(error),
        };
        for name in from_buffers {
            if !names.iter().any(|existing| existing == name) {
                names.push(name.to_owned());
            }
        }
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use mtek_compiler::source::MemFs;

    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn base() -> MemFs {
        let mut fs = MemFs::new();
        fs.insert(p("mtek.toml"), "toml")
            .insert(p("src/main.mtek"), "disk main")
            .insert(p("src/util.mtek"), "disk util");
        fs
    }

    fn buffers(items: &[(&str, &str)]) -> Buffers {
        items
            .iter()
            .map(|(path, text)| (p(path), Arc::<str>::from(*text)))
            .collect()
    }

    #[test]
    fn a_buffer_shadows_the_file_and_other_files_come_from_disk() {
        let base = base();
        let buffers = buffers(&[("src/main.mtek", "unsaved main")]);
        let fs = OverlayFs::new(&base, &buffers);
        assert_eq!(fs.read(&p("src/main.mtek")), Ok(b"unsaved main".to_vec()));
        assert_eq!(fs.len(&p("src/main.mtek")), Ok(12));
        assert_eq!(fs.read(&p("src/util.mtek")), Ok(b"disk util".to_vec()));
        assert_eq!(fs.len(&p("src/util.mtek")), Ok(9));
        assert_eq!(
            fs.read(&p("src/none.mtek")),
            Err(FsError::NotFound(p("src/none.mtek")))
        );
    }

    #[test]
    fn a_buffer_of_a_file_that_is_not_on_disk_exists_and_is_listed() {
        let base = base();
        let buffers = buffers(&[("src/new.mtek", "new"), ("extra/deep/x.mtek", "x")]);
        let fs = OverlayFs::new(&base, &buffers);
        assert_eq!(fs.read(&p("src/new.mtek")), Ok(b"new".to_vec()));
        assert!(fs.exact_case_exists(&p("src/new.mtek")));
        assert!(
            fs.exact_case_exists(&p("extra")),
            "a directory made by a buffer"
        );
        assert!(fs.exact_case_exists(&p("extra/deep")));
        assert!(!fs.exact_case_exists(&p("extra/Deep")), "case-exact");
        assert!(!fs.exact_case_exists(&p("extra/dee")));
        assert!(fs.exact_case_exists(&p("src/util.mtek")), "from disk");
        let mut src = fs.list_dir(&p("src")).unwrap();
        src.sort();
        assert_eq!(src, ["main.mtek", "new.mtek", "util.mtek"]);
        let mut root = fs.list_dir(&ProjectPath::root()).unwrap();
        root.sort();
        assert_eq!(root, ["extra", "mtek.toml", "src"]);
        assert_eq!(fs.list_dir(&p("extra/deep")), Ok(vec!["x.mtek".to_owned()]));
    }

    #[test]
    fn listing_errors_pass_through() {
        let base = base();
        let buffers = buffers(&[("src/new.mtek", "new")]);
        let fs = OverlayFs::new(&base, &buffers);
        assert_eq!(
            fs.list_dir(&p("src/new.mtek")),
            Err(FsError::NotADirectory(p("src/new.mtek")))
        );
        assert_eq!(
            fs.list_dir(&p("src/main.mtek")),
            Err(FsError::NotADirectory(p("src/main.mtek")))
        );
        assert_eq!(fs.list_dir(&p("nope")), Err(FsError::NotFound(p("nope"))));
        assert_eq!(
            fs.read(&p("src")),
            Err(FsError::IsADirectory(p("src"))),
            "a directory is not a file"
        );
    }

    #[test]
    fn with_no_buffers_the_base_is_unchanged() {
        let base = base();
        let none = Buffers::new();
        let fs = OverlayFs::new(&base, &none);
        assert_eq!(
            fs.list_dir(&ProjectPath::root()),
            base.list_dir(&ProjectPath::root())
        );
        assert_eq!(fs.read(&p("mtek.toml")), Ok(b"toml".to_vec()));
        assert!(!fs.exact_case_exists(&p("zzz")));
    }
}
