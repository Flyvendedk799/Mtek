//! Font files of `asset.font(..)` (`spec/hud.md` section 6, decision 0139).
//!
//! A font is validated like a GLB: the extension names one of four formats (`E7105`) and the
//! bytes must show that format with a consistent header (`E7106`). The file is copied byte for
//! byte; the runtime registers it with the browser's `FontFace` and uses it for `hud.text`.

use serde::Serialize;

use super::Issue;
use crate::diagnostics::Code;

/// The four font formats `asset.font` reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FontFormat {
    Ttf,
    Otf,
    Woff,
    Woff2,
}

impl FontFormat {
    /// The file extension of the packed file.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            FontFormat::Ttf => "ttf",
            FontFormat::Otf => "otf",
            FontFormat::Woff => "woff",
            FontFormat::Woff2 => "woff2",
        }
    }

    /// The MIME type of the packed file.
    #[must_use]
    pub const fn mime(self) -> &'static str {
        match self {
            FontFormat::Ttf => "font/ttf",
            FontFormat::Otf => "font/otf",
            FontFormat::Woff => "font/woff",
            FontFormat::Woff2 => "font/woff2",
        }
    }
}

/// What the header of a valid font file says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontInfo {
    pub format: FontFormat,
    /// The number of tables of the font (sfnt `numTables`, or the WOFF header's).
    pub tables: u16,
}

/// The format the extension of `name` names, if any (case-insensitive).
#[must_use]
pub fn font_format_of_extension(name: &str) -> Option<FontFormat> {
    let (_, extension) = name.rsplit_once('.')?;
    match extension.to_ascii_lowercase().as_str() {
        "ttf" => Some(FontFormat::Ttf),
        "otf" => Some(FontFormat::Otf),
        "woff" => Some(FontFormat::Woff),
        "woff2" => Some(FontFormat::Woff2),
        _ => None,
    }
}

fn be16(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn be32(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

fn malformed(message: String) -> Issue {
    Issue::new(Code::E7106, message)
        .help("re-export the font from a font editor, or convert it to WOFF2")
}

/// The message of `E7105` for `name`.
#[must_use]
pub fn unsupported_font_message(name: &str) -> String {
    format!(
        "'{name}' is not a `.ttf`, `.otf`, `.woff` or `.woff2` file; `asset.font` reads those four formats."
    )
}

/// Validate the font file `name` with the bytes `data`.
///
/// # Errors
/// `E7105` for an extension that names no font format, `E7106` when the bytes are not that
/// format or its header is inconsistent (no tables, a WOFF length other than the file's, an sfnt
/// table directory longer than the file).
pub fn sniff_font(name: &str, data: &[u8]) -> Result<FontInfo, Issue> {
    let Some(format) = font_format_of_extension(name) else {
        return Err(Issue::new(Code::E7105, unsupported_font_message(name)));
    };
    if data.len() < 12 {
        return Err(malformed(format!(
            "'{name}' is {} bytes long, too short to be a font file.",
            data.len()
        )));
    }
    let tag = &data[0..4];
    let tables = match format {
        FontFormat::Ttf | FontFormat::Otf => {
            let sfnt = tag == [0, 1, 0, 0] || tag == b"true" || tag == b"OTTO";
            if !sfnt {
                return Err(malformed(format!(
                    "'{name}' does not start with an sfnt signature (0x00010000, 'true' or 'OTTO'), so it is not a {} font.",
                    format.extension()
                )));
            }
            let tables = be16(data, 4).unwrap_or(0);
            // The table directory: 12 bytes of header and 16 bytes per table record.
            if 12 + 16 * usize::from(tables) > data.len() {
                return Err(malformed(format!(
                    "'{name}' declares {tables} tables, but the file ends inside its table directory."
                )));
            }
            tables
        }
        FontFormat::Woff | FontFormat::Woff2 => {
            let wanted: &[u8; 4] = if format == FontFormat::Woff {
                b"wOFF"
            } else {
                b"wOF2"
            };
            if tag != wanted {
                return Err(malformed(format!(
                    "'{name}' does not start with the signature '{}', so it is not a {} font.",
                    String::from_utf8_lossy(wanted),
                    format.extension()
                )));
            }
            let length = be32(data, 8).unwrap_or(0);
            if usize::try_from(length).ok() != Some(data.len()) {
                return Err(malformed(format!(
                    "'{name}' says it is {length} bytes long, but the file has {} bytes.",
                    data.len()
                )));
            }
            be16(data, 12).unwrap_or(0)
        }
    };
    if tables == 0 {
        return Err(malformed(format!("'{name}' has no font tables.")));
    }
    Ok(FontInfo { format, tables })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sfnt(tag: &[u8; 4], tables: u16) -> Vec<u8> {
        let mut data = tag.to_vec();
        data.extend_from_slice(&tables.to_be_bytes());
        data.extend_from_slice(&[0; 6]);
        data.extend(std::iter::repeat_n(0, 16 * usize::from(tables)));
        data
    }

    fn woff(tag: &[u8; 4], tables: u16) -> Vec<u8> {
        let mut data = vec![0; 48];
        data[0..4].copy_from_slice(tag);
        data[8..12].copy_from_slice(&48u32.to_be_bytes());
        data[12..14].copy_from_slice(&tables.to_be_bytes());
        data
    }

    #[test]
    fn the_four_formats_are_read() {
        assert_eq!(
            sniff_font("a.ttf", &sfnt(&[0, 1, 0, 0], 3)).unwrap().format,
            FontFormat::Ttf
        );
        assert_eq!(
            sniff_font("a.otf", &sfnt(b"OTTO", 2)).unwrap().format,
            FontFormat::Otf
        );
        assert_eq!(sniff_font("a.woff", &woff(b"wOFF", 4)).unwrap().tables, 4);
        assert_eq!(
            sniff_font("a.WOFF2", &woff(b"wOF2", 9)).unwrap().format,
            FontFormat::Woff2
        );
    }

    #[test]
    fn e7105_for_another_extension() {
        assert_eq!(
            sniff_font("a.fnt", &sfnt(b"OTTO", 2)).unwrap_err().code,
            Code::E7105
        );
    }

    #[test]
    fn e7106_for_wrong_or_inconsistent_bytes() {
        for (name, data) in [
            ("a.ttf", woff(b"wOF2", 3)),
            ("a.woff2", sfnt(b"OTTO", 2)),
            ("a.ttf", sfnt(&[0, 1, 0, 0], 0)),
            ("a.ttf", sfnt(&[0, 1, 0, 0], 3)[..30].to_vec()),
            ("a.woff2", woff(b"wOF2", 3)[..40].to_vec()),
            ("a.otf", vec![0; 4]),
        ] {
            assert_eq!(
                sniff_font(name, &data).unwrap_err().code,
                Code::E7106,
                "{name}"
            );
        }
    }
}
