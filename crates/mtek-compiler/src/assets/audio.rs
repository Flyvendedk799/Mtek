//! Sound files: the container and header of a `.wav`, `.ogg` or `.mp3` declared with
//! `asset.sound(..)` (`spec/audio.md` section 2, decision 0130).
//!
//! Like images, sounds are checked without decoding: the compiler reads enough of the header to
//! know that the file is what its extension says, that it is not truncated where the header can
//! tell, and how long it plays where that is cheap to know (WAV). Decoding is the browser's job
//! (`AudioContext.decodeAudioData`); a file the browser cannot decode after all is the run-time
//! warning `W8202`, never a stopped program.

use serde::Serialize;

use super::Issue;
use crate::diagnostics::Code;

/// The container of a sound file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    Wav,
    Ogg,
    Mp3,
}

impl AudioFormat {
    /// The file extension the packaged copy keeps.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            AudioFormat::Wav => "wav",
            AudioFormat::Ogg => "ogg",
            AudioFormat::Mp3 => "mp3",
        }
    }

    /// The MIME type the manifest records.
    #[must_use]
    pub const fn mime(self) -> &'static str {
        match self {
            AudioFormat::Wav => "audio/wav",
            AudioFormat::Ogg => "audio/ogg",
            AudioFormat::Mp3 => "audio/mpeg",
        }
    }
}

/// What the header of a sound file says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioInfo {
    pub format: AudioFormat,
    /// Channels and sample rate, where the header gives them (WAV, Ogg Vorbis/Opus).
    pub channels: Option<u16>,
    pub sample_rate: Option<u32>,
    /// Length in milliseconds, for WAV only.
    pub duration_ms: Option<u64>,
}

fn unsupported(message: impl Into<String>) -> Issue {
    Issue::new(Code::E7101, message)
        .help("convert the sound to WAV (16-bit PCM), Ogg Vorbis or MP3")
}

fn malformed(message: impl Into<String>) -> Issue {
    Issue::new(Code::E7102, message).help("re-export the sound from an audio editor")
}

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

/// The format the extension of `name` names, if any (case-insensitive).
#[must_use]
pub fn format_of_extension(name: &str) -> Option<AudioFormat> {
    let (_, extension) = name.rsplit_once('.')?;
    match extension.to_ascii_lowercase().as_str() {
        "wav" | "wave" => Some(AudioFormat::Wav),
        "ogg" | "oga" | "opus" => Some(AudioFormat::Ogg),
        "mp3" => Some(AudioFormat::Mp3),
        _ => None,
    }
}

/// The format the first bytes of `data` show, if it is one of the three.
fn format_of_content(data: &[u8]) -> Option<AudioFormat> {
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WAVE" {
        return Some(AudioFormat::Wav);
    }
    if data.starts_with(b"OggS") {
        return Some(AudioFormat::Ogg);
    }
    if data.starts_with(b"ID3") || mpeg_frame_at(data, 0) {
        return Some(AudioFormat::Mp3);
    }
    None
}

/// Whether an MPEG audio frame header (layer III or II, a valid bitrate and sample rate) starts
/// at `at`.
fn mpeg_frame_at(data: &[u8], at: usize) -> bool {
    let Some(header) = data.get(at..at + 4) else {
        return false;
    };
    let sync = header[0] == 0xFF && header[1] & 0xE0 == 0xE0;
    let version = (header[1] >> 3) & 0b11;
    let layer = (header[1] >> 1) & 0b11;
    let bitrate = header[2] >> 4;
    let rate = (header[2] >> 2) & 0b11;
    sync && version != 0b01 && layer != 0 && bitrate != 0 && bitrate != 0xF && rate != 0b11
}

/// The format and header facts of the sound file `name` (its project path) with content `data`.
///
/// # Errors
/// `E7101` for a file that is not WAV, Ogg or MP3, or whose content differs from its extension;
/// `E7102` for a header that is truncated or inconsistent.
pub fn sniff_audio(name: &str, data: &[u8]) -> Result<AudioInfo, Issue> {
    let Some(by_name) = format_of_extension(name) else {
        return Err(unsupported(format!(
            "'{name}' is not a `.wav`, `.ogg` or `.mp3` file; `asset.sound` reads those three formats."
        )));
    };
    let Some(by_content) = format_of_content(data) else {
        if data.len() < 12 {
            return Err(malformed(format!(
                "'{name}' is {} bytes long, too short to be a sound file.",
                data.len()
            )));
        }
        return Err(unsupported(format!(
            "'{name}' has the extension `.{}`, but its bytes are not {} data.",
            name.rsplit_once('.').map_or("", |(_, e)| e),
            by_name.extension().to_ascii_uppercase()
        )));
    };
    if by_content != by_name {
        return Err(unsupported(format!(
            "'{name}' has the extension of {} file, but its bytes are {} data.",
            match by_name {
                AudioFormat::Mp3 => "an MP3",
                AudioFormat::Ogg => "an Ogg",
                AudioFormat::Wav => "a WAV",
            },
            by_content.extension().to_ascii_uppercase()
        ))
        .help("rename the file so that its extension matches its content"));
    }
    match by_content {
        AudioFormat::Wav => sniff_wav(name, data),
        AudioFormat::Ogg => sniff_ogg(name, data),
        AudioFormat::Mp3 => sniff_mp3(name, data),
    }
}

fn sniff_wav(name: &str, data: &[u8]) -> Result<AudioInfo, Issue> {
    let mut at = 12usize;
    let mut fmt: Option<(u16, u16, u32, u16, u16)> = None;
    let mut data_len: Option<u32> = None;
    while at + 8 <= data.len() {
        let id = &data[at..at + 4];
        let len = u32_at(data, at + 4).unwrap_or(0);
        let body = at + 8;
        let Some(end) = body.checked_add(len as usize) else {
            break;
        };
        if id == b"fmt " {
            if len < 16 || end > data.len() {
                return Err(malformed(format!(
                    "The `fmt ` chunk of '{name}' is truncated."
                )));
            }
            fmt = Some((
                u16_at(data, body).unwrap_or(0),
                u16_at(data, body + 2).unwrap_or(0),
                u32_at(data, body + 4).unwrap_or(0),
                u16_at(data, body + 12).unwrap_or(0),
                u16_at(data, body + 14).unwrap_or(0),
            ));
        } else if id == b"data" {
            if end > data.len() {
                return Err(malformed(format!(
                    "The `data` chunk of '{name}' declares {len} bytes, but the file ends after {}.",
                    data.len() - body
                )));
            }
            data_len = Some(len);
        }
        // Chunks are padded to an even length.
        at = end + (len as usize & 1);
    }
    let Some((tag, channels, sample_rate, block_align, bits)) = fmt else {
        return Err(malformed(format!("'{name}' has no `fmt ` chunk.")));
    };
    let Some(data_len) = data_len else {
        return Err(malformed(format!("'{name}' has no `data` chunk.")));
    };
    // 1 = PCM, 3 = IEEE float, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (PCM or float inside).
    if !matches!(tag, 1 | 3 | 0xFFFE) {
        return Err(unsupported(format!(
            "'{name}' is a WAV file with codec tag {tag:#06x}; WAV sounds must be PCM or IEEE float."
        )));
    }
    if channels == 0 || sample_rate == 0 || block_align == 0 {
        return Err(malformed(format!(
            "The `fmt ` chunk of '{name}' gives {channels} channels at {sample_rate} Hz with a block size of {block_align} bytes."
        )));
    }
    if !matches!(bits, 8 | 16 | 24 | 32) {
        return Err(unsupported(format!(
            "'{name}' has {bits}-bit samples; WAV sounds must have 8, 16, 24 or 32-bit samples."
        )));
    }
    let frames = u64::from(data_len) / u64::from(block_align);
    Ok(AudioInfo {
        format: AudioFormat::Wav,
        channels: Some(channels),
        sample_rate: Some(sample_rate),
        duration_ms: Some(frames * 1000 / u64::from(sample_rate)),
    })
}

fn sniff_ogg(name: &str, data: &[u8]) -> Result<AudioInfo, Issue> {
    // The first page: "OggS", version 0, header type, granule (8), serial (4), sequence (4),
    // checksum (4), segment count, segment table, then the first packet.
    if data.len() < 28 || data[4] != 0 {
        return Err(malformed(format!(
            "The first Ogg page of '{name}' is truncated."
        )));
    }
    let segments = usize::from(data[26]);
    let packet = 27 + segments;
    let Some(head) = data.get(packet..) else {
        return Err(malformed(format!(
            "The first Ogg page of '{name}' is truncated."
        )));
    };
    if head.len() >= 16 && head[0] == 1 && &head[1..7] == b"vorbis" {
        let channels = u16::from(head[11]);
        let sample_rate = u32_at(head, 12).unwrap_or(0);
        if channels == 0 || sample_rate == 0 {
            return Err(malformed(format!(
                "The Vorbis header of '{name}' gives {channels} channels at {sample_rate} Hz."
            )));
        }
        return Ok(AudioInfo {
            format: AudioFormat::Ogg,
            channels: Some(channels),
            sample_rate: Some(sample_rate),
            duration_ms: None,
        });
    }
    if head.len() >= 19 && &head[0..8] == b"OpusHead" {
        let channels = u16::from(head[9]);
        if channels == 0 {
            return Err(malformed(format!(
                "The Opus header of '{name}' gives 0 channels."
            )));
        }
        return Ok(AudioInfo {
            format: AudioFormat::Ogg,
            channels: Some(channels),
            sample_rate: Some(48_000),
            duration_ms: None,
        });
    }
    Err(unsupported(format!(
        "'{name}' is an Ogg file, but not Vorbis or Opus audio."
    )))
}

fn sniff_mp3(name: &str, data: &[u8]) -> Result<AudioInfo, Issue> {
    let mut at = 0usize;
    if data.starts_with(b"ID3") {
        // ID3v2: 10-byte header, the size as four 7-bit bytes, plus a footer of 10 if flagged.
        let Some(size) = data.get(6..10) else {
            return Err(malformed(format!("The ID3 tag of '{name}' is truncated.")));
        };
        if size.iter().any(|b| b & 0x80 != 0) {
            return Err(malformed(format!(
                "The ID3 tag of '{name}' has an invalid size."
            )));
        }
        let size = size
            .iter()
            .fold(0usize, |acc, b| (acc << 7) | usize::from(*b));
        let footer = if data[5] & 0x10 != 0 { 10 } else { 0 };
        at = 10 + size + footer;
    }
    // Allow a little padding between the tag and the first frame.
    let limit = at.saturating_add(4096).min(data.len());
    while at < limit {
        if mpeg_frame_at(data, at) {
            return Ok(AudioInfo {
                format: AudioFormat::Mp3,
                channels: None,
                sample_rate: None,
                duration_ms: None,
            });
        }
        at += 1;
    }
    Err(malformed(format!("'{name}' contains no MPEG audio frame.")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(bits: u16, tag: u16, samples: usize) -> Vec<u8> {
        let data_len = samples * usize::from(bits / 8);
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&u32::try_from(36 + data_len).unwrap().to_le_bytes());
        v.extend_from_slice(b"WAVEfmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&tag.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&8000u32.to_le_bytes());
        v.extend_from_slice(&(8000u32 * u32::from(bits / 8)).to_le_bytes());
        v.extend_from_slice(&(bits / 8).to_le_bytes());
        v.extend_from_slice(&bits.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&u32::try_from(data_len).unwrap().to_le_bytes());
        v.resize(v.len() + data_len, 0);
        v
    }

    #[test]
    fn a_pcm_wav_is_read() {
        let info = sniff_audio("a.wav", &wav(16, 1, 8000)).unwrap();
        assert_eq!(info.format, AudioFormat::Wav);
        assert_eq!(info.duration_ms, Some(1000));
    }

    #[test]
    fn wrong_extension_and_codec_and_truncation() {
        assert_eq!(
            sniff_audio("a.flac", b"fLaC....").unwrap_err().code,
            Code::E7101
        );
        assert_eq!(
            sniff_audio("a.mp3", &wav(16, 1, 10)).unwrap_err().code,
            Code::E7101
        );
        assert_eq!(
            sniff_audio("a.wav", &wav(16, 2, 10)).unwrap_err().code,
            Code::E7101
        );
        let mut cut = wav(16, 1, 100);
        cut.truncate(60);
        assert_eq!(sniff_audio("a.wav", &cut).unwrap_err().code, Code::E7102);
        assert_eq!(sniff_audio("a.wav", b"RIF").unwrap_err().code, Code::E7102);
    }

    #[test]
    fn mp3_frames_and_ogg_pages() {
        let mut mp3 = b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec();
        mp3.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64, 0, 0, 0, 0]);
        assert_eq!(sniff_audio("a.mp3", &mp3).unwrap().format, AudioFormat::Mp3);
        let only_tag = b"ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00".to_vec();
        assert_eq!(
            sniff_audio("a.mp3", &only_tag).unwrap_err().code,
            Code::E7102
        );
        let mut ogg = b"OggS\x00\x02".to_vec();
        ogg.resize(26, 0);
        ogg.push(1);
        ogg.push(30);
        ogg.push(1);
        ogg.extend_from_slice(b"vorbis");
        ogg.extend_from_slice(&[0, 0, 0, 0, 2]);
        ogg.extend_from_slice(&44_100u32.to_le_bytes());
        ogg.resize(ogg.len() + 16, 0);
        let info = sniff_audio("a.ogg", &ogg).unwrap();
        assert_eq!((info.channels, info.sample_rate), (Some(2), Some(44_100)));
    }
}
