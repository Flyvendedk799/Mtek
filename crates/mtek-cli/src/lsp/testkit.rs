//! Helpers of the language server's tests: projects on disk, cursor markers.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// The cursor marker of test sources: it is removed and its byte offset is the position.
pub const CURSOR: char = '\u{a7}';

/// The minimal `mtek.toml` of a test project.
pub const MANIFEST: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

/// `text` without its cursor marker, and the byte offset the marker was at.
///
/// # Panics
/// If the text has no marker, or two.
pub fn cursor(text: &str) -> (String, u32) {
    let mut parts = text.split(CURSOR);
    let before = parts.next().unwrap();
    let after = parts.next().expect("the text has a cursor marker");
    assert!(parts.next().is_none(), "the text has one cursor marker");
    (
        format!("{before}{after}"),
        u32::try_from(before.len()).unwrap(),
    )
}

/// A project in a fresh directory of the system's temporary directory, removed on drop.
pub struct TempProject {
    pub dir: PathBuf,
}

impl TempProject {
    /// A project with the default `mtek.toml` and `files` (project-relative paths and texts).
    pub fn new(files: &[(&str, &str)]) -> Self {
        Self::with_manifest(MANIFEST, files)
    }

    pub fn with_manifest(manifest: &str, files: &[(&str, &str)]) -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "mtek-lsp-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let project = Self { dir };
        project.write("mtek.toml", manifest);
        for (path, text) in files {
            project.write(path, text);
        }
        project
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.join(relative)
    }

    pub fn write(&self, relative: &str, text: &str) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    pub fn remove(&self, relative: &str) {
        fs::remove_file(self.path(relative)).unwrap();
    }

    /// The `file:` URI of a project file, as VS Code spells it (a lowercase drive letter with
    /// an escaped colon on Windows).
    pub fn uri(&self, relative: &str) -> String {
        file_uri(&self.path(relative))
    }
}

impl Drop for TempProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// The `file:` URI of `path`.
pub fn file_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    let text = if let Some(rest) = text.strip_prefix('/') {
        out.push('/');
        rest.to_owned()
    } else {
        // `C:/x` -> `/c%3A/x`, as VS Code writes it.
        out.push('/');
        let mut chars = text.chars();
        let drive = chars.next().unwrap_or('c').to_ascii_lowercase();
        let rest: String = chars.collect();
        format!("{drive}%3A{}", rest.strip_prefix(':').unwrap_or(&rest))
    };
    for byte in text.bytes() {
        if byte == b'/' || byte == b'%' || byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cursor_marker_is_removed_and_its_offset_is_in_bytes() {
        let (text, offset) = cursor("a\u{e9}\u{a7}b");
        assert_eq!(text, "a\u{e9}b");
        assert_eq!(offset, 3);
    }

    #[test]
    fn file_uris_are_vs_code_style() {
        let uri = file_uri(Path::new("/tmp/a b/c.mtek"));
        if !cfg!(windows) {
            assert_eq!(uri, "file:///tmp/a%20b/c.mtek");
        }
        let windows = file_uri(Path::new("C:\\Users\\x y\\p.mtek"));
        if cfg!(windows) {
            assert_eq!(windows, "file:///c%3A/Users/x%20y/p.mtek");
        }
    }
}
