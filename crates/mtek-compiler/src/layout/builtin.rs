//! The compiler-owned blocks of the fixed binding plan (`spec/gpu-layout.md` sections 6.1
//! and 6.2). They are laid out by the same engine as user blocks and emitted, written and
//! described like any other block; the runtime never hard-codes their offsets.

use super::types::LayoutType;

/// A built-in struct together with the identity its layout record carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltinBlock {
    /// Layout record id. `MtekFrame` and `MtekObject` use `builtin:frame` and
    /// `builtin:object` (section 5); `MtekLight` is a nested helper struct that is never
    /// bound by itself, and its `builtin:light` id exists so that its layout can be
    /// computed, tested and inspected on its own.
    pub id: &'static str,
    /// Name of the generated WGSL struct (equal to the Mtek name).
    pub wgsl_struct: &'static str,
    /// The block as a struct type; its name is the Mtek struct name.
    pub ty: LayoutType,
}

fn members(list: &[(&str, LayoutType)]) -> Vec<(String, LayoutType)> {
    list.iter()
        .map(|(name, ty)| ((*name).to_owned(), ty.clone()))
        .collect()
}

/// The `MtekLight` struct (48 bytes, align 16), element type of `MtekFrame.lights`.
pub fn mtek_light() -> LayoutType {
    LayoutType::new_struct(
        "MtekLight",
        members(&[
            ("color", LayoutType::Vec3),
            ("kind", LayoutType::U32),
            ("position", LayoutType::Vec3),
            ("range", LayoutType::F32),
            ("direction", LayoutType::Vec3),
            ("reserved", LayoutType::F32),
        ]),
    )
}

/// The `MtekFrame` block (288 bytes, align 16), bound at group 0 binding 0.
pub fn mtek_frame() -> LayoutType {
    LayoutType::new_struct(
        "MtekFrame",
        members(&[
            ("view_proj", LayoutType::Mat4),
            ("camera_position", LayoutType::Vec3),
            ("light_count", LayoutType::U32),
            ("ambient", LayoutType::Vec3),
            ("reserved0", LayoutType::F32),
            ("lights", LayoutType::new_array(mtek_light(), 4)),
        ]),
    )
}

/// The `MtekObject` block (128 bytes, align 16), bound at group 2 binding 0.
pub fn mtek_object() -> LayoutType {
    LayoutType::new_struct(
        "MtekObject",
        members(&[
            ("model", LayoutType::Mat4),
            ("normal_matrix", LayoutType::Mat4),
        ]),
    )
}

/// The built-in blocks in a fixed order: `MtekLight`, `MtekFrame`, `MtekObject`.
pub fn builtin_blocks() -> Vec<BuiltinBlock> {
    vec![
        BuiltinBlock {
            id: "builtin:light",
            wgsl_struct: "MtekLight",
            ty: mtek_light(),
        },
        BuiltinBlock {
            id: "builtin:frame",
            wgsl_struct: "MtekFrame",
            ty: mtek_frame(),
        },
        BuiltinBlock {
            id: "builtin:object",
            wgsl_struct: "MtekObject",
            ty: mtek_object(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::compute::compute;
    use crate::layout::record::LayoutNode;

    fn record_of(id: &str) -> crate::layout::record::LayoutRecord {
        let block = builtin_blocks()
            .into_iter()
            .find(|b| b.id == id)
            .expect("built-in block exists");
        compute(&block.ty, block.id, block.wgsl_struct).expect("built-in layouts are valid")
    }

    #[test]
    fn blocks_are_listed_in_order() {
        let ids: Vec<&str> = builtin_blocks().iter().map(|b| b.id).collect();
        assert_eq!(ids, ["builtin:light", "builtin:frame", "builtin:object"]);
        for block in builtin_blocks() {
            assert_eq!(block.ty.mtek_spelling(), block.wgsl_struct);
        }
    }

    #[test]
    fn built_in_sizes_match_the_specification() {
        assert_eq!(record_of("builtin:light").size, 48);
        assert_eq!(record_of("builtin:frame").size, 288);
        assert_eq!(record_of("builtin:object").size, 128);
        for id in ["builtin:light", "builtin:frame", "builtin:object"] {
            assert_eq!(record_of(id).align, 16);
        }
    }

    #[test]
    fn frame_member_offsets_match_the_specification() {
        let record = record_of("builtin:frame");
        let LayoutNode::Struct { members, .. } = &record.root else {
            panic!("frame root must be a struct node");
        };
        let offsets: Vec<(&str, u32)> = members
            .iter()
            .map(|m| (m.name.as_str(), m.node.offset()))
            .collect();
        assert_eq!(
            offsets,
            [
                ("view_proj", 0),
                ("camera_position", 64),
                ("light_count", 76),
                ("ambient", 80),
                ("reserved0", 92),
                ("lights", 96),
            ]
        );
        let LayoutNode::Array {
            stride,
            padded,
            length,
            size,
            ..
        } = &members[5].node
        else {
            panic!("lights must be an array node");
        };
        assert_eq!((*stride, *padded, *length, *size), (48, false, 4, 192));
    }

    #[test]
    fn object_member_offsets_match_the_specification() {
        let record = record_of("builtin:object");
        let LayoutNode::Struct { members, .. } = &record.root else {
            panic!("object root must be a struct node");
        };
        assert_eq!(members[0].node.offset(), 0);
        assert_eq!(members[1].node.offset(), 64);
    }
}
