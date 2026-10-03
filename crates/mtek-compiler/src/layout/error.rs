//! Errors of the layout engine. The engine never panics: every invalid input is an error.

use std::error::Error;
use std::fmt;

/// Largest array length the layout engine accepts (`spec/gpu-layout.md` section 8.3:
/// no block may exceed 65 536 bytes, and every element occupies at least 4 bytes).
pub const MAX_ARRAY_LENGTH: u32 = 65_536;

/// Why a layout could not be computed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    /// `compute` was given a type that is not a struct; the caller wraps such types.
    NotAStruct { found: String },
    /// A struct (or block) without members.
    EmptyStruct { name: String },
    /// Two members of one struct share a name.
    DuplicateMember { struct_name: String, member: String },
    /// An array of length 0 or longer than [`MAX_ARRAY_LENGTH`].
    InvalidArrayLength { length: u32 },
    /// A size or offset does not fit in 32 bits.
    SizeOverflow,
}

impl fmt::Display for LayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LayoutError::NotAStruct { found } => write!(
                f,
                "a layout can only be computed for a struct, found `{found}`; wrap the type in a struct"
            ),
            LayoutError::EmptyStruct { name } => {
                write!(f, "struct `{name}` has no members")
            }
            LayoutError::DuplicateMember {
                struct_name,
                member,
            } => write!(
                f,
                "struct `{struct_name}` declares member `{member}` more than once"
            ),
            LayoutError::InvalidArrayLength { length } => write!(
                f,
                "array length {length} is invalid; it must be between 1 and {MAX_ARRAY_LENGTH}"
            ),
            LayoutError::SizeOverflow => {
                f.write_str("the layout is too large: a size or offset exceeds 32 bits")
            }
        }
    }
}

impl Error for LayoutError {}
