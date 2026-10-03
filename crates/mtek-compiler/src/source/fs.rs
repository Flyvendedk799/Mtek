//! The file-system abstraction and an in-memory implementation.
//!
//! The compiler library performs no I/O of its own. The real implementation
//! lives in `mtek-cli`; [`MemFs`] serves tests and the language server's
//! unsaved buffers.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use super::path::ProjectPath;

/// Why a file-system operation failed.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum FsError {
    /// Nothing exists at the path (with exactly this case).
    NotFound(ProjectPath),
    /// A file operation was applied to a directory.
    IsADirectory(ProjectPath),
    /// A directory operation was applied to a file.
    NotADirectory(ProjectPath),
    /// Any other failure, with the operating system's message.
    Other { path: ProjectPath, message: String },
}

impl fmt::Display for FsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FsError::NotFound(p) => write!(f, "'{p}' not found"),
            FsError::IsADirectory(p) => write!(f, "'{p}' is a directory"),
            FsError::NotADirectory(p) => write!(f, "'{p}' is not a directory"),
            FsError::Other { path, message } => write!(f, "'{path}': {message}"),
        }
    }
}

impl std::error::Error for FsError {}

/// Read access to the project's files.
///
/// All paths are project-relative. Implementations must be case-exact:
/// `read` and `list_dir` on a path whose case differs from the stored entry
/// fail with [`FsError::NotFound`], even on case-insensitive systems.
pub trait Fs {
    /// The bytes of the file at `p`, exactly as stored.
    ///
    /// # Errors
    /// [`FsError::NotFound`], [`FsError::IsADirectory`] or [`FsError::Other`].
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError>;

    /// True if a file or directory exists at `p` and every segment of `p`
    /// matches the stored entry name exactly, including case
    /// (`spec/language.md` section 9.1, `E2032`).
    fn exact_case_exists(&self, p: &ProjectPath) -> bool;

    /// The entry names (not paths) directly inside the directory `p`. The
    /// order is **unspecified**: callers that need determinism must sort.
    ///
    /// # Errors
    /// [`FsError::NotFound`], [`FsError::NotADirectory`] or [`FsError::Other`].
    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError>;
}

/// An in-memory [`Fs`]. Directories exist implicitly as the parents of files.
#[derive(Clone, Default, Debug)]
pub struct MemFs {
    files: BTreeMap<ProjectPath, Vec<u8>>,
    shuffle_seed: Option<u64>,
}

impl MemFs {
    /// An empty file system that lists directories in sorted order.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Make `list_dir` return entries in a pseudo-random order derived from
    /// `seed` and the directory path (same seed and contents give the same
    /// order; different seeds usually differ). For determinism tests: output
    /// that depends on directory order shows up as a difference between seeds.
    #[must_use]
    pub fn with_shuffled_listing(mut self, seed: u64) -> Self {
        self.shuffle_seed = Some(seed);
        self
    }

    /// Insert or replace a file. Returns `self` for chaining.
    pub fn insert(&mut self, path: ProjectPath, bytes: impl Into<Vec<u8>>) -> &mut Self {
        self.files.insert(path, bytes.into());
        self
    }

    /// Remove a file; true if it existed.
    pub fn remove(&mut self, path: &ProjectPath) -> bool {
        self.files.remove(path).is_some()
    }

    fn is_dir(&self, p: &ProjectPath) -> bool {
        if p.is_root() {
            return true;
        }
        let prefix = format!("{}/", p.as_str());
        self.files.keys().any(|k| k.as_str().starts_with(&prefix))
    }
}

impl Fs for MemFs {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        match self.files.get(p) {
            Some(bytes) => Ok(bytes.clone()),
            None if self.is_dir(p) => Err(FsError::IsADirectory(p.clone())),
            None => Err(FsError::NotFound(p.clone())),
        }
    }

    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        self.files.contains_key(p) || self.is_dir(p)
    }

    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        if self.files.contains_key(p) {
            return Err(FsError::NotADirectory(p.clone()));
        }
        if !self.is_dir(p) {
            return Err(FsError::NotFound(p.clone()));
        }
        let prefix = if p.is_root() {
            String::new()
        } else {
            format!("{}/", p.as_str())
        };
        let names: BTreeSet<&str> = self
            .files
            .keys()
            .filter_map(|k| k.as_str().strip_prefix(prefix.as_str()))
            .filter_map(|rest| rest.split('/').next())
            .collect();
        let mut names: Vec<String> = names.into_iter().map(str::to_owned).collect();
        if let Some(seed) = self.shuffle_seed {
            shuffle(&mut names, seed ^ fnv1a(p.as_str().as_bytes()));
        }
        Ok(names)
    }
}

/// FNV-1a, to mix the directory path into the shuffle seed.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// Deterministic Fisher-Yates shuffle driven by SplitMix64.
fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut state = seed;
    let mut next = move || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    };
    for i in (1..items.len()).rev() {
        let bound = (i as u64) + 1;
        // Modulo bias is irrelevant for test shuffling.
        let j = (next() % bound) as usize;
        items.swap(i, j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn sample() -> MemFs {
        let mut fs = MemFs::new();
        fs.insert(p("mtek.toml"), "x")
            .insert(p("src/main.mtek"), "main")
            .insert(p("src/util.mtek"), "util")
            .insert(p("src/deep/a.mtek"), "a")
            .insert(p("assets/b.bin"), vec![0u8, 255, 1]);
        fs
    }

    #[test]
    fn read_returns_exact_bytes() {
        let fs = sample();
        assert_eq!(fs.read(&p("assets/b.bin")), Ok(vec![0, 255, 1]));
        assert_eq!(fs.read(&p("src/main.mtek")), Ok(b"main".to_vec()));
    }

    #[test]
    fn read_errors() {
        let fs = sample();
        assert_eq!(
            fs.read(&p("nope.mtek")),
            Err(FsError::NotFound(p("nope.mtek")))
        );
        assert_eq!(fs.read(&p("src")), Err(FsError::IsADirectory(p("src"))));
        assert_eq!(
            fs.read(&ProjectPath::root()),
            Err(FsError::IsADirectory(ProjectPath::root()))
        );
    }

    #[test]
    fn exact_case_exists_is_case_sensitive_for_files_and_directories() {
        let fs = sample();
        assert!(fs.exact_case_exists(&p("src/main.mtek")));
        assert!(fs.exact_case_exists(&p("src")));
        assert!(fs.exact_case_exists(&p("src/deep")));
        assert!(fs.exact_case_exists(&ProjectPath::root()));
        assert!(!fs.exact_case_exists(&p("src/Main.mtek")));
        assert!(!fs.exact_case_exists(&p("Src/main.mtek")));
        assert!(!fs.exact_case_exists(&p("src/missing.mtek")));
        assert!(!fs.exact_case_exists(&p("sr")));
    }

    #[test]
    fn list_dir_names_files_and_subdirectories_once() {
        let fs = sample();
        assert_eq!(
            fs.list_dir(&ProjectPath::root()),
            Ok(vec![
                "assets".to_owned(),
                "mtek.toml".to_owned(),
                "src".to_owned()
            ])
        );
        assert_eq!(
            fs.list_dir(&p("src")),
            Ok(vec![
                "deep".to_owned(),
                "main.mtek".to_owned(),
                "util.mtek".to_owned()
            ])
        );
        assert_eq!(fs.list_dir(&p("src/deep")), Ok(vec!["a.mtek".to_owned()]));
    }

    #[test]
    fn list_dir_errors() {
        let fs = sample();
        assert_eq!(fs.list_dir(&p("nope")), Err(FsError::NotFound(p("nope"))));
        assert_eq!(
            fs.list_dir(&p("src/main.mtek")),
            Err(FsError::NotADirectory(p("src/main.mtek")))
        );
        assert_eq!(MemFs::new().list_dir(&ProjectPath::root()), Ok(Vec::new()));
    }

    #[test]
    fn directory_prefix_does_not_match_sibling_with_common_prefix() {
        let mut fs = MemFs::new();
        fs.insert(p("src/a.mtek"), "");
        fs.insert(p("src2/b.mtek"), "");
        assert_eq!(fs.list_dir(&p("src")), Ok(vec!["a.mtek".to_owned()]));
        assert!(!fs.exact_case_exists(&p("sr")));
    }

    #[test]
    fn insert_replaces_and_remove_deletes() {
        let mut fs = MemFs::new();
        fs.insert(p("a.mtek"), "one");
        fs.insert(p("a.mtek"), "two");
        assert_eq!(fs.read(&p("a.mtek")), Ok(b"two".to_vec()));
        assert!(fs.remove(&p("a.mtek")));
        assert!(!fs.remove(&p("a.mtek")));
        assert!(!fs.exact_case_exists(&p("a.mtek")));
    }

    fn many() -> MemFs {
        let mut fs = MemFs::new();
        for i in 0..32 {
            fs.insert(p(&format!("src/m{i:02}.mtek")), "");
        }
        fs
    }

    #[test]
    fn shuffled_listing_is_a_permutation_and_depends_on_the_seed() {
        let sorted = many().list_dir(&p("src")).unwrap();
        let mut orders = Vec::new();
        for seed in 0..4u64 {
            let fs = many().with_shuffled_listing(seed);
            let listing = fs.list_dir(&p("src")).unwrap();
            let mut copy = listing.clone();
            copy.sort();
            assert_eq!(copy, sorted, "seed {seed} must list the same entries");
            // Stable for a given seed.
            assert_eq!(fs.list_dir(&p("src")).unwrap(), listing);
            orders.push(listing);
        }
        assert!(
            orders.iter().any(|o| *o != sorted),
            "some seed must change the order"
        );
        assert!(
            orders.windows(2).any(|w| w[0] != w[1]),
            "different seeds must give different orders"
        );
    }

    #[test]
    fn error_display_names_the_path() {
        assert_eq!(FsError::NotFound(p("a/b")).to_string(), "'a/b' not found");
        assert_eq!(
            FsError::IsADirectory(p("a")).to_string(),
            "'a' is a directory"
        );
        assert_eq!(
            FsError::NotADirectory(p("a")).to_string(),
            "'a' is not a directory"
        );
        assert_eq!(
            FsError::Other {
                path: p("a"),
                message: "denied".to_owned()
            }
            .to_string(),
            "'a': denied"
        );
    }
}
