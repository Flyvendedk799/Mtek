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
    Ok(ImageInfo {
        format,
        width,
        height,
    })
}
