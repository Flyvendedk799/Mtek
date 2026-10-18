//! Image headers: the format and size of an embedded or standalone image, read with
//! `imagesize` without decoding any pixels (`spec/assets.md` section 3, "Images").

use imagesize::ImageType;

use super::Issue;
use super::glb::ImageFormat;
use crate::diagnostics::Code;

/// What the header of a PNG or JPEG file says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ImageInfo {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}

/// The format and dimensions of `data`, which must be PNG or JPEG with both sides within
/// `1..=max_dimension`. The message of the issue completes a sentence about the image
/// ("its bytes are …").
///
/// # Errors
/// `E7017`.
pub fn sniff_image(data: &[u8], max_dimension: u32) -> Result<ImageInfo, Issue> {
    let issue = |message: String| Issue::new(Code::E7017, message);
    let format = match imagesize::image_type(data) {
        Ok(ImageType::Png) => ImageFormat::Png,
        Ok(ImageType::Jpeg) => ImageFormat::Jpeg,
        Ok(other) => {
            return Err(issue(format!(
                "its bytes are {other:?} data; the profile supports PNG and JPEG."
            ))
            .help("convert the image to PNG or JPEG"));
        }
        Err(_) => {
            return Err(issue(
                "its bytes are not PNG or JPEG data; the profile supports PNG and JPEG.".into(),
            )
            .help("convert the image to PNG or JPEG"));
        }
    };
    let size = imagesize::blob_size(data)
        .map_err(|error| issue(format!("its header cannot be read: {error}.")))?;
    let (width, height) = (
        u32::try_from(size.width).unwrap_or(u32::MAX),
        u32::try_from(size.height).unwrap_or(u32::MAX),
    );
    if width == 0 || height == 0 {
        return Err(issue(format!("it is {width} by {height} pixels.")));
    }
    if width > max_dimension || height > max_dimension {
        return Err(issue(format!(
            "it is {width} by {height} pixels, over the limit of {max_dimension} per side."
        ))
        .help("scale the image down, or raise `max_texture_dimension` in the `[assets]` table of mtek.toml (at most 8192, the WebGPU default)"));
    }
    if format == ImageFormat::Jpeg
        && let Some(orientation) = jpeg_exif_orientation(data)
        && orientation != 1
    {
        return Err(issue(format!(
            "it is a JPEG with the EXIF orientation {orientation} (rotated or mirrored); browsers apply the orientation when they decode the image, so the texture would not be the stored pixels. Re-save it without the orientation tag."
        ))
        .help("re-save the image without the EXIF orientation tag (apply the rotation to the pixels when exporting), or convert it to PNG"));
    }
    Ok(ImageInfo {
        format,
        width,
        height,
    })
}

/// The value of the EXIF `Orientation` tag (0x0112) in IFD0 of the first `Exif` APP1 segment
/// of the JPEG `data`, if there is one (decision 0082). Only the markers before the first
/// start-of-scan are read; a malformed EXIF block is treated as having no orientation (the
/// browser ignores it as well).
#[must_use]
pub fn jpeg_exif_orientation(data: &[u8]) -> Option<u16> {
    if data.get(..2)? != [0xFF, 0xD8] {
        return None;
    }
    let mut at = 2usize;
    loop {
        // Fill bytes (0xFF) may precede a marker.
        while data.get(at)? == &0xFF && data.get(at + 1)? == &0xFF {
            at += 1;
        }
        if data.get(at)? != &0xFF {
            return None;
        }
        let marker = *data.get(at + 1)?;
        // Standalone markers without a length: TEM and RST0..7.
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            at += 2;
            continue;
        }
        // Start of scan or end of image: no EXIF before the image data.
        if marker == 0xDA || marker == 0xD9 {
            return None;
        }
        let length = usize::from(u16::from_be_bytes([*data.get(at + 2)?, *data.get(at + 3)?]));
        if length < 2 {
            return None;
        }
        let segment = data.get(at + 4..at + 2 + length)?;
        if marker == 0xE1 && segment.starts_with(b"Exif\0\0") {
            return tiff_orientation(&segment[6..]);
        }
        at += 2 + length;
    }
}

/// The `Orientation` entry of IFD0 of a TIFF block (the body of an `Exif` segment).
fn tiff_orientation(tiff: &[u8]) -> Option<u16> {
    let little = match tiff.get(..4)? {
        [0x49, 0x49, 0x2A, 0x00] => true,
        [0x4D, 0x4D, 0x00, 0x2A] => false,
        _ => return None,
    };
    let u16_at = |at: usize| -> Option<u16> {
        let bytes = [*tiff.get(at)?, *tiff.get(at + 1)?];
        Some(if little {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let bytes = [
            *tiff.get(at)?,
            *tiff.get(at + 1)?,
            *tiff.get(at + 2)?,
            *tiff.get(at + 3)?,
        ];
        Some(if little {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    };
    let ifd = usize::try_from(u32_at(4)?).ok()?;
    let count = usize::from(u16_at(ifd)?);
    (0..count).find_map(|index| {
        let entry = ifd + 2 + index * 12;
        // Tag 0x0112, type SHORT (3), count 1: the value is in the first two bytes.
        (u16_at(entry)? == 0x0112 && u16_at(entry + 2)? == 3).then(|| u16_at(entry + 8))?
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A JPEG prefix: SOI, an `Exif` APP1 segment with IFD0 holding `entries`, then SOS.
    fn jpeg_with_exif(little: bool, entries: &[(u16, u16, u16)]) -> Vec<u8> {
        let u16b = |v: u16| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let u32b = |v: u32| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let mut tiff = if little {
            vec![0x49, 0x49, 0x2A, 0x00]
        } else {
            vec![0x4D, 0x4D, 0x00, 0x2A]
        };
        tiff.extend_from_slice(&u32b(8));
        tiff.extend_from_slice(&u16b(u16::try_from(entries.len()).unwrap()));
        for (tag, ty, value) in entries {
            tiff.extend_from_slice(&u16b(*tag));
            tiff.extend_from_slice(&u16b(*ty));
            tiff.extend_from_slice(&u32b(1));
            tiff.extend_from_slice(&u16b(*value));
            tiff.extend_from_slice(&[0, 0]);
        }
        tiff.extend_from_slice(&u32b(0));
        let mut body = b"Exif\0\0".to_vec();
        body.extend_from_slice(&tiff);
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x4A, 0x46];
        out.extend_from_slice(&[0xFF, 0xE1]);
        out.extend_from_slice(&u16::try_from(body.len() + 2).unwrap().to_be_bytes());
        out.extend_from_slice(&body);
        out.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]);
        out
    }

    #[test]
    fn reads_the_orientation_in_both_byte_orders_and_ignores_other_tags() {
        for little in [true, false] {
            assert_eq!(
                jpeg_exif_orientation(&jpeg_with_exif(little, &[(0x010F, 3, 9), (0x0112, 3, 6)])),
                Some(6)
            );
            assert_eq!(
                jpeg_exif_orientation(&jpeg_with_exif(little, &[(0x010F, 3, 9)])),
                None
            );
        }
        // No EXIF at all, not a JPEG, a cut-off segment.
        assert_eq!(jpeg_exif_orientation(&[0xFF, 0xD8, 0xFF, 0xDA, 0, 2]), None);
        assert_eq!(jpeg_exif_orientation(b"\x89PNG"), None);
        let cut = jpeg_with_exif(true, &[(0x0112, 3, 6)]);
        assert_eq!(jpeg_exif_orientation(&cut[..20]), None);
    }
}
