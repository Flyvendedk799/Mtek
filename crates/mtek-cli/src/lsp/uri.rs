//! Document URIs: `file:` URIs of project files, and the `mtek-prelude:` scheme of the virtual,
//! read-only documents the server serves for the standard library (decision 0076 item 6).
//!
//! The server never rewrites a URI a client sent: a document is published to under the exact
//! string the client opened it with. A URI the server makes itself (a diagnostic in a file the
//! client has not opened, a definition in another module) is the project directory's URI as
//! the client spelled it, plus the percent-encoded project-relative path.

use std::path::{Path, PathBuf};

use mtek_compiler::source::ProjectPath;

/// The scheme of the virtual documents of the standard library.
pub const PRELUDE_SCHEME: &str = "mtek-prelude";

/// What a document URI denotes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum UriKind {
    /// A file of the local file system.
    File(PathBuf),
    /// A virtual document of the standard library: its path (`std/materials.mtek`).
    Prelude(String),
    /// Anything else (`untitled:`, `vscode-notebook-cell:`, a remote file system, a malformed
    /// URI): the document is served from the client's text only.
    Other,
}

/// What `uri` denotes. Never fails: URIs the server cannot map are [`UriKind::Other`].
#[must_use]
pub fn classify(uri: &str) -> UriKind {
    let Some((scheme, rest)) = split_scheme(uri) else {
        return UriKind::Other;
    };
    if scheme.eq_ignore_ascii_case("file") {
        return file_path(rest).map_or(UriKind::Other, UriKind::File);
    }
    if scheme.eq_ignore_ascii_case(PRELUDE_SCHEME) {
        let path = strip_suffixes(rest);
        let path = path.strip_prefix('/').unwrap_or(path);
        return match percent_decode(path) {
            Some(path) if !path.is_empty() => UriKind::Prelude(path),
            _ => UriKind::Other,
        };
    }
    UriKind::Other
}

/// The URI of the virtual document at `path` (`std/materials.mtek`).
#[must_use]
pub fn prelude_uri(path: &str) -> String {
    format!("{PRELUDE_SCHEME}:/{}", encode_path(path))
}

/// The `file:` URI of the local path `path`, spelled as VS Code does: a drive letter becomes
/// lowercase with an escaped colon (`file:///c%3A/dir/file`), everything but the unreserved
/// characters is percent-encoded.
#[must_use]
pub fn file_uri(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    let text = if text.starts_with('/') {
        text
    } else {
        // `C:/dir` becomes `/c%3A/dir`.
        let mut chars = text.chars();
        let drive = chars.next().map_or('c', |c| c.to_ascii_lowercase());
        let rest: String = chars.collect();
        format!("/{drive}%3A{}", rest.strip_prefix(':').unwrap_or(&rest))
    };
    out.push_str(&encode_path_keeping_escapes(&text));
    out
}

/// [`encode_path`] that leaves an existing `%XX` alone (the drive colon above).
fn encode_path_keeping_escapes(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = String::with_capacity(path.len());
    let mut i = 0;
    while let Some(&byte) = bytes.get(i) {
        let escape = byte == b'%'
            && bytes.get(i + 1).copied().and_then(hex).is_some()
            && bytes.get(i + 2).copied().and_then(hex).is_some();
        if escape
            || byte == b'/'
            || byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'.' | b'_' | b'~')
        {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
        i += 1;
    }
    out
}

/// The URI of the project-relative `path` below the project directory whose URI is `prefix` (as
/// [`project_dir_uri`] derived it).
#[must_use]
pub fn join_uri(prefix: &str, path: &ProjectPath) -> String {
    if path.is_root() {
        return prefix.to_owned();
    }
    format!(
        "{}/{}",
        prefix.trim_end_matches('/'),
        encode_path(path.as_str())
    )
}

/// The URI of the project directory, derived from the URI `file_uri` of a file that is `path`
/// below it: `file_uri` without its last `path` segments, exactly as the client wrote them.
/// `None` if the URI does not end in those segments.
#[must_use]
pub fn project_dir_uri(file_uri: &str, path: &ProjectPath) -> Option<String> {
    let mut kept = strip_suffixes(file_uri);
    let segments: Vec<&str> = path.segments().collect();
    for expected in segments.into_iter().rev() {
        let (before, segment) = kept.rsplit_once('/')?;
        if percent_decode(segment).as_deref() != Some(expected) {
            return None;
        }
        kept = before;
    }
    Some(kept.to_owned())
}

/// `scheme` and the rest of the URI after the colon.
fn split_scheme(uri: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = uri.split_once(':')?;
    let valid = !scheme.is_empty()
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then_some((scheme, rest))
}

/// `rest` without its query and fragment.
fn strip_suffixes(rest: &str) -> &str {
    rest.find(['?', '#']).map_or(rest, |end| &rest[..end])
}

/// The local path of a `file:` URI whose scheme-specific part is `rest`.
fn file_path(rest: &str) -> Option<PathBuf> {
    let rest = strip_suffixes(rest);
    let (authority, path) = match rest.strip_prefix("//") {
        Some(after) => match after.find('/') {
            Some(slash) => (&after[..slash], &after[slash..]),
            None => (after, ""),
        },
        None => ("", rest),
    };
    let decoded = percent_decode(path)?;
    if decoded.is_empty() || decoded.contains('\0') {
        return None;
    }
    if authority.is_empty() || authority.eq_ignore_ascii_case("localhost") {
        return Some(native_path(&decoded));
    }
    // A UNC path: `file://server/share/dir/file`.
    cfg!(windows).then(|| PathBuf::from(format!("//{authority}{decoded}")))
}

/// `/c:/dir/file` is `c:/dir/file` on Windows; every other path is as it is.
fn native_path(decoded: &str) -> PathBuf {
    if cfg!(windows) {
        let bytes = decoded.as_bytes();
        if bytes.len() >= 3
            && bytes.first() == Some(&b'/')
            && bytes.get(1).is_some_and(u8::is_ascii_alphabetic)
            && bytes.get(2) == Some(&b':')
        {
            return PathBuf::from(&decoded[1..]);
        }
    }
    PathBuf::from(decoded)
}

/// `text` with every `%XX` replaced by its byte; `None` if an escape is malformed or the result
/// is not UTF-8.
#[must_use]
pub fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while let Some(&byte) = bytes.get(i) {
        if byte == b'%' {
            let high = hex(*bytes.get(i + 1)?)?;
            let low = hex(*bytes.get(i + 2)?)?;
            out.push(high << 4 | low);
            i += 3;
        } else {
            out.push(byte);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// `path` for the path part of a URI: segments joined by `/`, every byte but the unreserved
/// characters of RFC 3986 percent-encoded.
fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte == b'/' || byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
        {
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

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    #[test]
    fn file_uris_decode_to_native_paths() {
        if cfg!(windows) {
            assert_eq!(
                classify("file:///c%3A/Users/Tobias/proj/src/a%20b.mtek"),
                UriKind::File(PathBuf::from("c:/Users/Tobias/proj/src/a b.mtek"))
            );
            assert_eq!(
                classify("file:///C:/x/y.mtek"),
                UriKind::File(PathBuf::from("C:/x/y.mtek"))
            );
        } else {
            assert_eq!(
                classify("file:///home/t/proj/src/a%20b.mtek"),
                UriKind::File(PathBuf::from("/home/t/proj/src/a b.mtek"))
            );
        }
        // Non-ASCII characters are percent-encoded UTF-8.
        let encoded = if cfg!(windows) {
            "file:///c%3A/p/%C3%A9%F0%9F%98%80.mtek"
        } else {
            "file:///p/%C3%A9%F0%9F%98%80.mtek"
        };
        let UriKind::File(path) = classify(encoded) else {
            panic!("not a file");
        };
        assert!(path.to_string_lossy().ends_with("é😀.mtek"));
        // The query and fragment are not part of the path; `localhost` is the local machine.
        if !cfg!(windows) {
            assert_eq!(
                classify("file://localhost/a/b.mtek?x=1#y"),
                UriKind::File(PathBuf::from("/a/b.mtek"))
            );
        }
    }

    #[test]
    fn malformed_and_foreign_uris_are_other() {
        for uri in [
            "",
            "no scheme",
            "untitled:Untitled-1",
            "vscode-notebook-cell:/x",
            "https://example.com/a.mtek",
            "file:///a%zz",
            "file:///a%2",
            "file:///a%FF%FE",
            "file:",
            "file://",
            "1file:///x",
            "file:///x%00y",
        ] {
            assert_eq!(classify(uri), UriKind::Other, "{uri:?}");
        }
    }

    #[test]
    fn prelude_uris_round_trip() {
        let uri = prelude_uri("std/materials.mtek");
        assert_eq!(uri, "mtek-prelude:/std/materials.mtek");
        assert_eq!(
            classify(&uri),
            UriKind::Prelude("std/materials.mtek".to_owned())
        );
        assert_eq!(
            classify("MTEK-PRELUDE:/std/prelude.mtek"),
            UriKind::Prelude("std/prelude.mtek".to_owned())
        );
        assert_eq!(classify("mtek-prelude:/"), UriKind::Other);
        assert_eq!(classify("mtek-prelude:"), UriKind::Other);
    }

    #[test]
    fn the_project_directory_uri_is_the_file_uri_without_the_relative_path() {
        let file = "file:///c%3A/Users/T%20x/proj/src/main.mtek";
        let dir = project_dir_uri(file, &p("src/main.mtek")).unwrap();
        assert_eq!(dir, "file:///c%3A/Users/T%20x/proj");
        assert_eq!(join_uri(&dir, &p("src/main.mtek")), file);
        assert_eq!(
            join_uri(&dir, &p("src/ü.mtek")),
            format!("{dir}/src/%C3%BC.mtek")
        );
        // The client's spelling of the prefix is kept; the segments are compared decoded.
        assert_eq!(
            project_dir_uri("file:///p/src/a%2Dz.mtek", &p("src/a-z.mtek")).as_deref(),
            Some("file:///p")
        );
        // A file that is not below the claimed relative path has no directory.
        assert_eq!(
            project_dir_uri("file:///p/src/main.mtek", &p("lib/main.mtek")),
            None
        );
        assert_eq!(
            project_dir_uri("file:///main.mtek", &p("src/main.mtek")),
            None
        );
        assert_eq!(join_uri("file:///p/", &ProjectPath::root()), "file:///p/");
    }

    #[test]
    fn file_uris_are_vs_code_style_and_round_trip() {
        if cfg!(windows) {
            let uri = file_uri(Path::new("C:\\Users\\x y\\p\u{e9}.mtek"));
            assert_eq!(uri, "file:///c%3A/Users/x%20y/p%C3%A9.mtek");
            assert_eq!(
                classify(&uri),
                UriKind::File(PathBuf::from("c:/Users/x y/p\u{e9}.mtek"))
            );
        } else {
            let uri = file_uri(Path::new("/tmp/a b/c\u{e9}.mtek"));
            assert_eq!(uri, "file:///tmp/a%20b/c%C3%A9.mtek");
            assert_eq!(
                classify(&uri),
                UriKind::File(PathBuf::from("/tmp/a b/c\u{e9}.mtek"))
            );
        }
    }

    #[test]
    fn decoding_is_strict() {
        assert_eq!(percent_decode("a%20b").as_deref(), Some("a b"));
        assert_eq!(percent_decode("%C3%A9").as_deref(), Some("é"));
        assert_eq!(percent_decode("%c3%a9").as_deref(), Some("é"));
        assert_eq!(percent_decode("%"), None);
        assert_eq!(percent_decode("%4"), None);
        assert_eq!(percent_decode("%GG"), None);
        assert_eq!(percent_decode("%C3"), None, "not UTF-8");
    }
}
