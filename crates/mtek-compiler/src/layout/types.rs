//! The typed block description the layout engine consumes.
//!
//! One Mtek type maps to one `LayoutType` (`spec/gpu-layout.md` section 3). A block
//! (material parameter block, frame block, object block) is described as a
//! `LayoutType::Struct` whose members are the block's fields.

use std::fmt;

/// An Mtek type as far as GPU memory layout is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutType {
    F32,
    I32,
    U32,
    /// Stored as `u32` (`0u`/`1u`) inside blocks, structs and arrays.
    Bool,
    Vec2,
    Vec3,
    Vec4,
    /// Linear RGBA, laid out like `vec4`.
    Color,
    /// `(x, y, z, w)`, laid out like `vec4`.
    Quat,
    /// Column-major 4x4 matrix.
    Mat4,
    Struct {
        name: String,
        members: Vec<(String, LayoutType)>,
    },
    Array {
        element: Box<LayoutType>,
        length: u32,
    },
}

impl LayoutType {
    /// Builds a struct type from `(member name, member type)` pairs.
    pub fn new_struct<N: Into<String>>(name: N, members: Vec<(String, LayoutType)>) -> Self {
        LayoutType::Struct {
            name: name.into(),
            members,
        }
    }

    /// Builds an array type.
    pub fn new_array(element: LayoutType, length: u32) -> Self {
        LayoutType::Array {
            element: Box::new(element),
            length,
        }
    }

    /// The Mtek spelling of the type: `f32`, `vec3`, `array<f32, 3>`, or a struct's name.
    pub fn mtek_spelling(&self) -> String {
        match self {
            LayoutType::F32 => "f32".to_owned(),
            LayoutType::I32 => "i32".to_owned(),
            LayoutType::U32 => "u32".to_owned(),
            LayoutType::Bool => "bool".to_owned(),
            LayoutType::Vec2 => "vec2".to_owned(),
            LayoutType::Vec3 => "vec3".to_owned(),
            LayoutType::Vec4 => "vec4".to_owned(),
            LayoutType::Color => "color".to_owned(),
            LayoutType::Quat => "quat".to_owned(),
            LayoutType::Mat4 => "mat4".to_owned(),
            LayoutType::Struct { name, .. } => name.clone(),
            LayoutType::Array { element, length } => {
                format!("array<{}, {}>", element.mtek_spelling(), length)
            }
        }
    }
}

impl fmt::Display for LayoutType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.mtek_spelling())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelling_of_every_type() {
        let cases = [
            (LayoutType::F32, "f32"),
            (LayoutType::I32, "i32"),
            (LayoutType::U32, "u32"),
            (LayoutType::Bool, "bool"),
            (LayoutType::Vec2, "vec2"),
            (LayoutType::Vec3, "vec3"),
            (LayoutType::Vec4, "vec4"),
            (LayoutType::Color, "color"),
            (LayoutType::Quat, "quat"),
            (LayoutType::Mat4, "mat4"),
        ];
        for (ty, expected) in cases {
            assert_eq!(ty.mtek_spelling(), expected);
            assert_eq!(ty.to_string(), expected);
        }
    }

    #[test]
    fn spelling_of_composites() {
        let inner = LayoutType::new_struct("Inner", vec![("k".to_owned(), LayoutType::F32)]);
        assert_eq!(inner.mtek_spelling(), "Inner");
        assert_eq!(
            LayoutType::new_array(LayoutType::F32, 3).mtek_spelling(),
            "array<f32, 3>"
        );
        assert_eq!(
            LayoutType::new_array(LayoutType::new_array(inner, 2), 4).mtek_spelling(),
            "array<array<Inner, 2>, 4>"
        );
    }
}
