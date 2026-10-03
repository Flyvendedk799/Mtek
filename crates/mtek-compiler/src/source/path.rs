//! Project-relative paths.

use std::fmt;

/// Why a string is not a valid [`ProjectPath`].
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PathError {
    /// The string is empty, or normalises to the project root itself.
    Empty,
    /// The path starts with `/` or a drive letter such as `C:`.
    Absolute,
    /// The path contains a backslash; only `/` separates segments.
    Backslash,
    /// The path contains an empty segment (`a//b`, a trailing `/`).
    EmptySegment,
    /// `..` segments climb out of the project root.
    EscapesRoot,
    /// The path contains a control character or `:`.
    InvalidCharacter(char),
}

impl fmt::Display for PathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathError::Empty => f.write_str("path is empty or names the project root"),
            PathError::Absolute => f.write_str("path is absolute"),
            PathError::Backslash => f.write_str("path contains a backslash"),
            PathError::EmptySegment => f.write_str("path contains an empty segment"),
            PathError::EscapesRoot => f.write_str("path escapes the project root"),
            PathError::InvalidCharacter(c) => {
                write!(f, "path contains the invalid character {c:?}")
            }
        }
    }
}

impl std::error::Error for PathError {}

/// A normalised, `/`-separated path relative to the project root.
///
/// The only constructors are [`ProjectPath::new`], [`ProjectPath::join_relative`]
/// and [`ProjectPath::root`], so every value is valid: no `.` or `..`
/// segments, no empty segments, no backslashes, never absolute, never outside
/// the root. The root itself is the empty string and exists only so that
/// directory listings can name it; `new` and `join_relative` never return it.
///
/// The exact-case check against the real file system goes through
/// [`Fs::exact_case_exists`](super::Fs::exact_case_exists).
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct ProjectPath(String);

impl ProjectPath {
    /// The project root directory.
    #[must_use]
    pub fn root() -> Self {
        Self(String::new())
    }

    /// Validate and normalise `root_relative` (`./` segments are dropped and
    /// `a/../b` becomes `b`).
    ///
    /// # Errors
    /// See [`PathError`].
    pub fn new(root_relative: &str) -> Result<Self, PathError> {
        resolve(&[], root_relative)
    }

    /// Resolve `spec` relative to the directory that contains this path, as an
    /// import specifier is resolved relative to the importing file. The result
    /// is normalised and must stay inside the project root. Whether `spec`
    /// starts with `./` or `../` and ends in `.mtek` is the import resolver's
    /// concern, not checked here.
    ///
    /// # Errors
    /// See [`PathError`]; escaping the root gives [`PathError::EscapesRoot`].
    pub fn join_relative(&self, spec: &str) -> Result<Self, PathError> {
        let mut base: Vec<&str> = self.segments().collect();
        base.pop();
        resolve(&base, spec)
    }

    /// The normalised path text; empty for the root.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// True for the project root.
    #[must_use]
    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    /// The segments from the root down.
    pub fn segments(&self) -> impl Iterator<Item = &str> {
        self.0.split('/').filter(|s| !s.is_empty())
    }

    /// The last segment, or `None` for the root.
    #[must_use]
    pub fn file_name(&self) -> Option<&str> {
        if self.is_root() {
            None
        } else {
            self.0.rsplit('/').next()
        }
    }

    /// The containing directory (the root for a single segment), or `None`
    /// for the root.
    #[must_use]
    pub fn parent(&self) -> Option<ProjectPath> {
        if self.is_root() {
            return None;
        }
        match self.0.rfind('/') {
            Some(i) => Some(ProjectPath(self.0[..i].to_owned())),
            None => Some(ProjectPath::root()),
        }
    }
}

impl fmt::Display for ProjectPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

fn resolve(base: &[&str], spec: &str) -> Result<ProjectPath, PathError> {
    if spec.is_empty() {
        return Err(PathError::Empty);
    }
    let mut chars = spec.chars();
    let first = chars.next();
    let second = chars.next();
    if first == Some('/') || (first.is_some_and(|c| c.is_ascii_alphabetic()) && second == Some(':'))
    {
        return Err(PathError::Absolute);
    }
    if spec.contains('\\') {
        return Err(PathError::Backslash);
    }
    if let Some(c) = spec.chars().find(|c| c.is_control() || *c == ':') {
        return Err(PathError::InvalidCharacter(c));
    }

    let mut stack: Vec<&str> = base.to_vec();
    for segment in spec.split('/') {
        match segment {
            "" => return Err(PathError::EmptySegment),
            "." => {}
            ".." => {
                if stack.pop().is_none() {
                    return Err(PathError::EscapesRoot);
                }
            }
            other => stack.push(other),
        }
    }
    if stack.is_empty() {
        return Err(PathError::Empty);
    }
    Ok(ProjectPath(stack.join("/")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    #[test]
    fn accepts_and_normalises() {
        assert_eq!(p("src/main.mtek").as_str(), "src/main.mtek");
        assert_eq!(p("./src/main.mtek").as_str(), "src/main.mtek");
        assert_eq!(p("src/./a/../main.mtek").as_str(), "src/main.mtek");
        assert_eq!(p("a/b/../../c").as_str(), "c");
        assert_eq!(p("üñí/ünï.mtek").as_str(), "üñí/ünï.mtek");
    }

    #[test]
    fn rejects_empty_and_root_results() {
        assert_eq!(ProjectPath::new(""), Err(PathError::Empty));
        assert_eq!(ProjectPath::new("."), Err(PathError::Empty));
        assert_eq!(ProjectPath::new("a/.."), Err(PathError::Empty));
    }

    #[test]
    fn rejects_absolute_paths() {
        assert_eq!(ProjectPath::new("/etc/passwd"), Err(PathError::Absolute));
        assert_eq!(ProjectPath::new("C:/x/y.mtek"), Err(PathError::Absolute));
        assert_eq!(ProjectPath::new("c:x"), Err(PathError::Absolute));
        assert_eq!(ProjectPath::new("//server/share"), Err(PathError::Absolute));
    }

    #[test]
    fn rejects_backslashes() {
        assert_eq!(
            ProjectPath::new("src\\main.mtek"),
            Err(PathError::Backslash)
        );
        assert_eq!(ProjectPath::new("\\a"), Err(PathError::Backslash));
        assert_eq!(ProjectPath::new("C:\\a"), Err(PathError::Absolute));
    }

    #[test]
    fn rejects_empty_segments() {
        assert_eq!(ProjectPath::new("a//b"), Err(PathError::EmptySegment));
        assert_eq!(ProjectPath::new("a/"), Err(PathError::EmptySegment));
        assert_eq!(ProjectPath::new("./"), Err(PathError::EmptySegment));
    }

    #[test]
    fn rejects_escaping_the_root() {
        assert_eq!(ProjectPath::new(".."), Err(PathError::EscapesRoot));
        assert_eq!(ProjectPath::new("../a"), Err(PathError::EscapesRoot));
        assert_eq!(ProjectPath::new("a/../../b"), Err(PathError::EscapesRoot));
    }

    #[test]
    fn rejects_control_characters_and_colons() {
        assert_eq!(
            ProjectPath::new("a\0b"),
            Err(PathError::InvalidCharacter('\0'))
        );
        assert_eq!(
            ProjectPath::new("a\nb"),
            Err(PathError::InvalidCharacter('\n'))
        );
        assert_eq!(
            ProjectPath::new("dir/file:stream"),
            Err(PathError::InvalidCharacter(':'))
        );
    }

    #[test]
    fn join_relative_resolves_against_the_importing_files_directory() {
        let main = p("src/main.mtek");
        assert_eq!(
            main.join_relative("./util.mtek").unwrap().as_str(),
            "src/util.mtek"
        );
        assert_eq!(
            main.join_relative("../lib/util.mtek").unwrap().as_str(),
            "lib/util.mtek"
        );
        assert_eq!(
            main.join_relative("./a/./b/../c.mtek").unwrap().as_str(),
            "src/a/c.mtek"
        );
        let top = p("main.mtek");
        assert_eq!(top.join_relative("./x.mtek").unwrap().as_str(), "x.mtek");
    }

    #[test]
    fn join_relative_rejects_escapes_and_bad_specs() {
        let main = p("src/main.mtek");
        assert_eq!(
            main.join_relative("../../x.mtek"),
            Err(PathError::EscapesRoot)
        );
        assert_eq!(
            p("main.mtek").join_relative("../x.mtek"),
            Err(PathError::EscapesRoot)
        );
        assert_eq!(main.join_relative("/x.mtek"), Err(PathError::Absolute));
        assert_eq!(main.join_relative("./a\\b.mtek"), Err(PathError::Backslash));
        assert_eq!(
            main.join_relative("./a//b.mtek"),
            Err(PathError::EmptySegment)
        );
        assert_eq!(main.join_relative(""), Err(PathError::Empty));
        // "." names the importing file's own directory; the resolver rejects
        // it later because it does not end in ".mtek".
        assert_eq!(main.join_relative(".").unwrap().as_str(), "src");
        assert_eq!(main.join_relative(".."), Err(PathError::Empty));
    }

    #[test]
    fn root_parent_and_names() {
        let root = ProjectPath::root();
        assert!(root.is_root());
        assert_eq!(root.as_str(), "");
        assert_eq!(root.parent(), None);
        assert_eq!(root.file_name(), None);
        assert_eq!(root.segments().count(), 0);

        let path = p("a/b/c.mtek");
        assert!(!path.is_root());
        assert_eq!(path.file_name(), Some("c.mtek"));
        assert_eq!(path.parent(), Some(p("a/b")));
        assert_eq!(p("a").parent(), Some(ProjectPath::root()));
        assert_eq!(path.segments().collect::<Vec<_>>(), ["a", "b", "c.mtek"]);
        assert_eq!(path.to_string(), "a/b/c.mtek");
    }

    #[test]
    fn ordering_is_lexicographic_by_text() {
        assert!(p("a/b") < p("a/c"));
        assert!(ProjectPath::root() < p("a"));
    }
}
