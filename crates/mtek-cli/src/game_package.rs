//! `mtek build --release`: the game package (decision 0136, `spec/tooling.md` section 2.1).
//!
//! A `release` build whose runtime is the minified flavour (`core.min.js`, chosen by the
//! caller), whose `index.html` is the compiler's game page ([`game_html`]: loading screen,
//! favicon, title) and which carries a favicon: `assets/favicon.svg`, `.png` or `.ico` of the
//! project (validated, `E7103`), or the built-in one. With `--itch` the folder is also written as
//! `<out>-itch.zip` beside it: stored (uncompressed) entries, `index.html` at the root, fixed
//! timestamps so the archive is reproducible, checked against the itch.io HTML5 limits (`E7104`).

use std::collections::BTreeMap;
use std::path::Path;

use mtek_compiler::diagnostics::{Code, Diagnostic, Phase};
use mtek_compiler::package::html::{DEFAULT_FAVICON_SVG, game_html};

/// The largest favicon accepted, in bytes.
pub const MAX_FAVICON_BYTES: usize = 1 << 20;
/// itch.io HTML5 limits: files in the zip, uncompressed bytes, path length.
pub const ITCH_MAX_FILES: usize = 1000;
pub const ITCH_MAX_BYTES: u64 = 500 * 1000 * 1000;
pub const ITCH_MAX_PATH: usize = 240;

/// The favicon candidates, in order of preference.
const FAVICONS: [&str; 3] = ["favicon.svg", "favicon.png", "favicon.ico"];

/// The favicon of the project at `dir`: `(file name, bytes)`, the built-in SVG when the project
/// has none, or an `E7103`.
pub fn favicon(dir: &Path) -> Result<(String, Vec<u8>), Box<Diagnostic>> {
    for name in FAVICONS {
        let path = dir.join("assets").join(name);
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        return check_favicon(name, bytes).map(|bytes| (name.to_owned(), bytes));
    }
    Ok((
        "favicon.svg".to_owned(),
        DEFAULT_FAVICON_SVG.as_bytes().to_vec(),
    ))
}

/// `bytes` if they are a plausible `name` (by extension), else an `E7103`.
pub fn check_favicon(name: &str, bytes: Vec<u8>) -> Result<Vec<u8>, Box<Diagnostic>> {
    let problem = if bytes.len() > MAX_FAVICON_BYTES {
        Some(format!("is {} bytes; the limit is 1 MiB", bytes.len()))
    } else {
        let ok = match name.rsplit('.').next() {
            Some("png") => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            Some("ico") => bytes.starts_with(&[0, 0, 1, 0]),
            Some("svg") => std::str::from_utf8(&bytes).is_ok_and(|text| text.contains("<svg")),
            _ => false,
        };
        (!ok).then(|| {
            format!(
                "is not a valid {} file",
                name.rsplit('.').next().unwrap_or("image")
            )
        })
    };
    match problem {
        None => Ok(bytes),
        Some(problem) => Err(Box::new(
            Diagnostic::new(Code::E7103, format!("The favicon 'assets/{name}' {problem}."))
                .phase(Phase::Emit)
                .help("use a real SVG, PNG or ICO file under 1 MiB, or delete it to get the built-in favicon"),
        )),
    }
}

/// Turns the `release` file set `files` into the game package: the game page and the favicon.
pub fn package(files: &mut BTreeMap<String, Vec<u8>>, title: &str, favicon: (String, Vec<u8>)) {
    let (name, bytes) = favicon;
    files.insert(
        "index.html".to_owned(),
        game_html(title, &name).into_bytes(),
    );
    files.insert(name, bytes);
}

/// The itch.io zip of `files`, or an `E7104` naming the first limit it breaks.
pub fn itch_zip(files: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, Box<Diagnostic>> {
    let total: u64 = files.values().map(|bytes| bytes.len() as u64).sum();
    let long = files.keys().find(|path| path.len() > ITCH_MAX_PATH);
    let problem = if files.len() > ITCH_MAX_FILES {
        Some(format!(
            "{} files (the limit is {ITCH_MAX_FILES})",
            files.len()
        ))
    } else if total > ITCH_MAX_BYTES {
        Some(format!("{total} bytes uncompressed (the limit is 500 MB)"))
    } else {
        long.map(|path| {
            format!(
                "the path '{path}' of {} characters (the limit is {ITCH_MAX_PATH})",
                path.len()
            )
        })
    };
    if let Some(problem) = problem {
        return Err(Box::new(
            Diagnostic::new(Code::E7104, format!("The game package would have {problem}, more than itch.io accepts for an HTML5 game."))
                .phase(Phase::Emit)
                .note("the folder was written; only the zip was not")
                .help("use fewer or smaller assets, or upload the folder another way"),
        ));
    }
    Ok(zip_stored(files))
}

/// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320).
#[must_use]
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFF_u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// A zip archive of `files` with stored entries, in key order, every timestamp 1980-01-01 00:00.
/// Sizes fit in 32 bits because [`itch_zip`] caps the total at 500 MB.
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn zip_stored(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    const DOS_DATE: u16 = 0x0021; // 1980-01-01
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (path, bytes) in files {
        let crc = crc32(bytes);
        let size = bytes.len() as u32;
        let name = path.as_bytes();
        let offset = out.len() as u32;
        let common = |buf: &mut Vec<u8>| {
            buf.extend_from_slice(&20u16.to_le_bytes()); // version needed
            buf.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 names
            buf.extend_from_slice(&0u16.to_le_bytes()); // stored
            buf.extend_from_slice(&0u16.to_le_bytes()); // time
            buf.extend_from_slice(&DOS_DATE.to_le_bytes());
            buf.extend_from_slice(&crc.to_le_bytes());
            buf.extend_from_slice(&size.to_le_bytes());
            buf.extend_from_slice(&size.to_le_bytes());
            buf.extend_from_slice(&(name.len() as u16).to_le_bytes());
            buf.extend_from_slice(&0u16.to_le_bytes()); // extra
        };
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        common(&mut out);
        out.extend_from_slice(name);
        out.extend_from_slice(bytes);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        common(&mut central);
        central.extend_from_slice(&0u16.to_le_bytes()); // comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
        central.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }
    let start = out.len() as u32;
    let count = files.len() as u16;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    #[test]
    fn the_zip_has_every_entry_and_an_end_record() {
        let files = BTreeMap::from([
            ("index.html".to_owned(), b"<!doctype html>".to_vec()),
            ("shaders/a.wgsl".to_owned(), b"fn main() {}".to_vec()),
        ]);
        let zip = zip_stored(&files);
        assert!(zip.starts_with(&[0x50, 0x4b, 0x03, 0x04]));
        let end = &zip[zip.len() - 22..];
        assert_eq!(&end[..4], &[0x50, 0x4b, 0x05, 0x06]);
        assert_eq!(u16::from_le_bytes([end[10], end[11]]), 2);
        // The first local entry is index.html, at the root of the archive.
        assert_eq!(&zip[30..40], b"index.html");
        assert_eq!(zip_stored(&files), zip, "reproducible");
    }

    #[test]
    fn the_itch_limits_are_e7104() {
        let many: BTreeMap<String, Vec<u8>> = (0..=ITCH_MAX_FILES)
            .map(|i| (format!("f{i}"), Vec::new()))
            .collect();
        assert_eq!(itch_zip(&many).unwrap_err().code, Code::E7104);
        let long = BTreeMap::from([("a".repeat(ITCH_MAX_PATH + 1), Vec::new())]);
        assert_eq!(itch_zip(&long).unwrap_err().code, Code::E7104);
        assert!(itch_zip(&BTreeMap::from([("index.html".to_owned(), Vec::new())])).is_ok());
    }

    #[test]
    fn favicons_are_checked_by_content_e7103() {
        assert!(check_favicon("favicon.png", b"\x89PNG\r\n\x1a\nrest".to_vec()).is_ok());
        assert!(check_favicon("favicon.ico", vec![0, 0, 1, 0, 1, 0]).is_ok());
        assert!(
            check_favicon(
                "favicon.svg",
                b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec()
            )
            .is_ok()
        );
        for (name, bytes) in [
            ("favicon.png", b"GIF89a".to_vec()),
            ("favicon.ico", b"\x89PNG".to_vec()),
            ("favicon.svg", b"<html></html>".to_vec()),
            ("favicon.png", vec![0; MAX_FAVICON_BYTES + 1]),
        ] {
            assert_eq!(
                check_favicon(name, bytes).unwrap_err().code,
                Code::E7103,
                "{name}"
            );
        }
    }

    #[test]
    fn packaging_replaces_the_page_and_adds_the_favicon() {
        let mut files = BTreeMap::from([("index.html".to_owned(), b"old".to_vec())]);
        let dir = std::env::temp_dir().join("mtek-no-such-project-for-favicon");
        package(&mut files, "Dodge", favicon(&dir).unwrap());
        assert!(String::from_utf8_lossy(&files["index.html"]).contains("mtek-loading"));
        assert_eq!(files["favicon.svg"], DEFAULT_FAVICON_SVG.as_bytes());
    }
}
