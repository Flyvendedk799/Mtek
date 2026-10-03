//! The layout algorithm of `spec/gpu-layout.md` section 4 (conservative WGSL uniform rules).
//!
//! `u_align`, `u_size`, `u_stride` and `layout_struct` implement the pseudocode
//! `UAlign`, `USize`, `UStride` and `layoutStruct` of sections 4.2 and 4.3 one to one.
//! All arithmetic is checked: a layout that does not fit in 32 bits is an error, never a panic.

use super::error::{LayoutError, MAX_ARRAY_LENGTH};
use super::record::{LayoutMember, LayoutNode, LayoutRecord, ScalarKind};
use super::types::LayoutType;

/// Placement of one struct member, in bytes from the start of the struct.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemberPlacement {
    pub offset: u32,
    pub size: u32,
}

/// Result of `layoutStruct`: member placements in declaration order plus the struct metrics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructLayout {
    pub members: Vec<MemberPlacement>,
    /// `max_m UAlign(m.type)`, at least 4.
    pub align: u32,
    /// Total size, a multiple of `align`.
    pub size: u32,
}

/// Smallest multiple of `multiple` that is at least `value`. `multiple` must be non-zero;
/// every caller passes a constant or an alignment computed here, which is always 4, 8 or 16.
fn round_up(multiple: u32, value: u32) -> Result<u32, LayoutError> {
    if multiple == 0 {
        return Ok(value);
    }
    let rem = value % multiple;
    if rem == 0 {
        Ok(value)
    } else {
        value
            .checked_add(multiple - rem)
            .ok_or(LayoutError::SizeOverflow)
    }
}

/// `UAlign(T)`: the alignment a value of type `T` needs inside a uniform block.
pub fn u_align(ty: &LayoutType) -> u32 {
    match ty {
        LayoutType::F32 | LayoutType::I32 | LayoutType::U32 | LayoutType::Bool => 4,
        LayoutType::Vec2 => 8,
        LayoutType::Vec3
        | LayoutType::Vec4
        | LayoutType::Color
        | LayoutType::Quat
        | LayoutType::Mat4 => 16,
        // roundUp(16, max_i UAlign(member_i)); every member alignment is at most 16, so
        // the rounded value is 16 (an empty struct is rejected by `layout_struct`).
        LayoutType::Struct { members, .. } => {
            let widest = members.iter().map(|(_, m)| u_align(m)).max().unwrap_or(4);
            widest.next_multiple_of(16)
        }
        // roundUp(16, UAlign(E)).
        LayoutType::Array { element, .. } => u_align(element).next_multiple_of(16),
    }
}

/// `USize(T)`: the number of bytes a value of type `T` occupies inside a uniform block.
pub fn u_size(ty: &LayoutType) -> Result<u32, LayoutError> {
    match ty {
        LayoutType::F32 | LayoutType::I32 | LayoutType::U32 | LayoutType::Bool => Ok(4),
        LayoutType::Vec2 => Ok(8),
        LayoutType::Vec3 => Ok(12),
        LayoutType::Vec4 | LayoutType::Color | LayoutType::Quat => Ok(16),
        LayoutType::Mat4 => Ok(64),
        LayoutType::Struct { name, members } => Ok(layout_struct(name, members)?.size),
        LayoutType::Array { element, length } => {
            check_array_length(*length)?;
            length
                .checked_mul(u_stride(element)?)
                .ok_or(LayoutError::SizeOverflow)
        }
    }
}

/// `UStride(E) = roundUp(16, roundUp(UAlign(E), USize(E)))`: always a multiple of 16.
pub fn u_stride(element: &LayoutType) -> Result<u32, LayoutError> {
    round_up(16, round_up(u_align(element), u_size(element)?)?)
}

/// `layoutStruct`: places the members in declaration order (no reordering).
///
/// `name` is only used for error messages. Rejects empty structs and duplicate member names.
pub fn layout_struct(
    name: &str,
    members: &[(String, LayoutType)],
) -> Result<StructLayout, LayoutError> {
    if members.is_empty() {
        return Err(LayoutError::EmptyStruct {
            name: name.to_owned(),
        });
    }
    for (index, (member, _)) in members.iter().enumerate() {
        if members[..index]
            .iter()
            .any(|(earlier, _)| earlier == member)
        {
            return Err(LayoutError::DuplicateMember {
                struct_name: name.to_owned(),
                member: member.clone(),
            });
        }
    }

    let mut cursor: u32 = 0; // first byte not yet occupied
    let mut min_next: u32 = 0; // lower bound for the next member's offset
    let mut align: u32 = 4;
    let mut placed = Vec::with_capacity(members.len());
    for (_, member_type) in members {
        let member_align = u_align(member_type);
        let offset = round_up(member_align, cursor.max(min_next))?;
        let size = u_size(member_type)?;
        cursor = offset.checked_add(size).ok_or(LayoutError::SizeOverflow)?;
        min_next = if matches!(member_type, LayoutType::Struct { .. }) {
            // WGSL uniform rule: the bytes between a struct-typed member and the next
            // member must be at least roundUp(16, SizeOf(S)).
            offset
                .checked_add(round_up(16, size)?)
                .ok_or(LayoutError::SizeOverflow)?
        } else {
            cursor
        };
        align = align.max(member_align);
        placed.push(MemberPlacement { offset, size });
    }
    let size = round_up(align, cursor.max(min_next))?;
    Ok(StructLayout {
        members: placed,
        align,
        size,
    })
}

fn check_array_length(length: u32) -> Result<(), LayoutError> {
    if length == 0 || length > MAX_ARRAY_LENGTH {
        Err(LayoutError::InvalidArrayLength { length })
    } else {
        Ok(())
    }
}

/// The alignment WGSL itself derives for `ty` once the emitter has added its attributes
/// (`@align(16)` on struct and array members). For a struct this is its own
/// `layoutStruct` alignment, which can be smaller than `UAlign`.
fn natural_align(ty: &LayoutType) -> Result<u32, LayoutError> {
    match ty {
        LayoutType::Struct { name, members } => Ok(layout_struct(name, members)?.align),
        LayoutType::Array { element, .. } => natural_align(element),
        other => Ok(u_align(other)),
    }
}

/// True when the natural WGSL stride `roundUp(Align(E'), Size(E'))` of an element type is
/// not a multiple of 16, so the emitter must wrap the element (section 4.4 rule 3).
fn element_is_padded(element: &LayoutType) -> Result<bool, LayoutError> {
    let natural_stride = round_up(natural_align(element)?, u_size(element)?)?;
    Ok(natural_stride % 16 != 0)
}

/// Computes the layout record of a block.
///
/// `ty` must be a struct (a caller with a non-struct type wraps it first); `id` and
/// `wgsl_struct` are copied into the record unchanged.
pub fn compute(ty: &LayoutType, id: &str, wgsl_struct: &str) -> Result<LayoutRecord, LayoutError> {
    let LayoutType::Struct { name, members } = ty else {
        return Err(LayoutError::NotAStruct {
            found: ty.mtek_spelling(),
        });
    };
    let layout = layout_struct(name, members)?;
    let root = struct_node(name, members, &layout, 0, layout.align)?;
    Ok(LayoutRecord {
        id: id.to_owned(),
        wgsl_struct: wgsl_struct.to_owned(),
        size: layout.size,
        align: layout.align,
        root,
    })
}

/// Builds the node of `ty` placed at the absolute byte `offset`.
fn build_node(ty: &LayoutType, offset: u32) -> Result<LayoutNode, LayoutError> {
    let vector = |size: u32, align: u32, components: u32| LayoutNode::Vector {
        offset,
        size,
        align,
        scalar: ScalarKind::F32,
        components,
    };
    let scalar = |scalar: ScalarKind| LayoutNode::Scalar {
        offset,
        size: 4,
        align: 4,
        scalar,
    };
    Ok(match ty {
        LayoutType::F32 => scalar(ScalarKind::F32),
        LayoutType::I32 => scalar(ScalarKind::I32),
        LayoutType::U32 => scalar(ScalarKind::U32),
        LayoutType::Bool => scalar(ScalarKind::Bool32),
        LayoutType::Vec2 => vector(8, 8, 2),
        LayoutType::Vec3 => vector(12, 16, 3),
        LayoutType::Vec4 | LayoutType::Color | LayoutType::Quat => vector(16, 16, 4),
        LayoutType::Mat4 => LayoutNode::Matrix {
            offset,
            size: 64,
            align: 16,
            columns: 4,
            rows: 4,
            column_stride: 16,
        },
        LayoutType::Struct { name, members } => {
            let layout = layout_struct(name, members)?;
            struct_node(name, members, &layout, offset, u_align(ty))?
        }
        LayoutType::Array { element, length } => {
            let stride = u_stride(element)?;
            LayoutNode::Array {
                offset,
                size: u_size(ty)?,
                align: u_align(ty),
                length: *length,
                stride,
                padded: element_is_padded(element)?,
                // Offsets below an array element are relative to the element start.
                element: Box::new(build_node(element, 0)?),
            }
        }
    })
}

fn struct_node(
    name: &str,
    members: &[(String, LayoutType)],
    layout: &StructLayout,
    offset: u32,
    align: u32,
) -> Result<LayoutNode, LayoutError> {
    let mut nodes = Vec::with_capacity(members.len());
    for ((member_name, member_type), placement) in members.iter().zip(&layout.members) {
        let absolute = offset
            .checked_add(placement.offset)
            .ok_or(LayoutError::SizeOverflow)?;
        nodes.push(LayoutMember {
            name: member_name.clone(),
            mtek_type: member_type.mtek_spelling(),
            node: build_node(member_type, absolute)?,
        });
    }
    Ok(LayoutNode::Struct {
        name: name.to_owned(),
        offset,
        size: layout.size,
        align,
        members: nodes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(name: &str, ty: LayoutType) -> (String, LayoutType) {
        (name.to_owned(), ty)
    }

    fn st(name: &str, members: Vec<(String, LayoutType)>) -> LayoutType {
        LayoutType::new_struct(name, members)
    }

    /// (type, UAlign, USize) for every non-composite type, from the table in section 4.2.
    fn primitives() -> Vec<(LayoutType, u32, u32)> {
        vec![
            (LayoutType::F32, 4, 4),
            (LayoutType::I32, 4, 4),
            (LayoutType::U32, 4, 4),
            (LayoutType::Bool, 4, 4),
            (LayoutType::Vec2, 8, 8),
            (LayoutType::Vec3, 16, 12),
            (LayoutType::Vec4, 16, 16),
            (LayoutType::Color, 16, 16),
            (LayoutType::Quat, 16, 16),
            (LayoutType::Mat4, 16, 64),
        ]
    }

    #[test]
    fn align_and_size_of_every_primitive() {
        for (ty, align, size) in primitives() {
            assert_eq!(u_align(&ty), align, "UAlign({ty})");
            assert_eq!(u_size(&ty), Ok(size), "USize({ty})");
        }
    }

    #[test]
    fn stride_of_every_primitive_is_a_multiple_of_16() {
        // UStride = roundUp(16, roundUp(UAlign, USize)).
        let expected = [
            (LayoutType::F32, 16),
            (LayoutType::I32, 16),
            (LayoutType::U32, 16),
            (LayoutType::Bool, 16),
            (LayoutType::Vec2, 16),
            (LayoutType::Vec3, 16),
            (LayoutType::Vec4, 16),
            (LayoutType::Color, 16),
            (LayoutType::Quat, 16),
            (LayoutType::Mat4, 64),
        ];
        for (ty, stride) in expected {
            assert_eq!(u_stride(&ty), Ok(stride), "UStride({ty})");
        }
    }

    #[test]
    fn struct_metrics() {
        let inner = st("Inner", vec![member("k", LayoutType::F32)]);
        // layoutStruct(Inner): align 4, size 4; UAlign(Inner) = roundUp(16, 4) = 16.
        let layout = layout_struct("Inner", &[member("k", LayoutType::F32)]);
        assert_eq!(layout.map(|l| (l.align, l.size)), Ok((4, 4)));
        assert_eq!(u_align(&inner), 16);
        assert_eq!(u_size(&inner), Ok(4));
        assert_eq!(u_stride(&inner), Ok(16));

        let light = st(
            "L",
            vec![
                member("color", LayoutType::Vec3),
                member("i", LayoutType::F32),
            ],
        );
        assert_eq!(u_align(&light), 16);
        assert_eq!(u_size(&light), Ok(16));
        assert_eq!(u_stride(&light), Ok(16));

        let big = st(
            "Big",
            vec![member("a", LayoutType::Mat4), member("b", LayoutType::F32)],
        );
        assert_eq!(u_size(&big), Ok(80));
        assert_eq!(u_stride(&big), Ok(80));
    }

    #[test]
    fn array_metrics() {
        let cases = [
            (LayoutType::F32, 3, 16, 48),
            (LayoutType::Vec2, 3, 16, 48),
            (LayoutType::Bool, 2, 16, 32),
            (LayoutType::Vec3, 5, 16, 80),
            (LayoutType::Mat4, 2, 64, 128),
        ];
        for (element, length, stride, size) in cases {
            let ty = LayoutType::new_array(element.clone(), length);
            assert_eq!(u_align(&ty), 16, "UAlign(array<{element}, {length}>)");
            assert_eq!(u_size(&ty), Ok(size), "USize(array<{element}, {length}>)");
            assert_eq!(u_stride(&element), Ok(stride));
            // An array nested in an array: stride equals the inner array's size.
            let nested = LayoutType::new_array(ty.clone(), 2);
            assert_eq!(u_stride(&ty), Ok(size));
            assert_eq!(u_size(&nested), Ok(2 * size));
        }
    }

    #[test]
    fn struct_member_followed_by_scalar_uses_the_16_byte_rule() {
        let inner = st("Inner", vec![member("k", LayoutType::F32)]);
        let layout = layout_struct(
            "Outer",
            &[member("inner", inner), member("after", LayoutType::F32)],
        )
        .expect("valid struct");
        assert_eq!(
            layout.members,
            vec![
                MemberPlacement { offset: 0, size: 4 },
                MemberPlacement {
                    offset: 16,
                    size: 4
                }
            ]
        );
        assert_eq!((layout.align, layout.size), (16, 32));
    }

    #[test]
    fn trailing_struct_member_pads_the_block_to_16() {
        let inner = st("Inner", vec![member("k", LayoutType::F32)]);
        let layout = layout_struct("Outer", &[member("inner", inner)]).expect("valid struct");
        assert_eq!((layout.align, layout.size), (16, 16));
    }

    #[test]
    fn scalar_only_struct_keeps_align_4() {
        let layout = layout_struct("S", &[member("value", LayoutType::F32)]).expect("valid");
        assert_eq!((layout.align, layout.size), (4, 4));
        let layout = layout_struct(
            "S",
            &[member("a", LayoutType::Vec2), member("b", LayoutType::F32)],
        )
        .expect("valid");
        assert_eq!((layout.align, layout.size), (8, 16));
    }

    #[test]
    fn empty_struct_is_an_error() {
        assert_eq!(
            layout_struct("E", &[]),
            Err(LayoutError::EmptyStruct {
                name: "E".to_owned()
            })
        );
        let nested = st("Outer", vec![member("e", st("E", Vec::new()))]);
        assert_eq!(
            compute(&nested, "fixture:x", "MtekFixture_x"),
            Err(LayoutError::EmptyStruct {
                name: "E".to_owned()
            })
        );
    }

    #[test]
    fn duplicate_member_is_an_error() {
        let ty = st(
            "D",
            vec![member("x", LayoutType::F32), member("x", LayoutType::U32)],
        );
        assert_eq!(
            compute(&ty, "fixture:d", "MtekFixture_d"),
            Err(LayoutError::DuplicateMember {
                struct_name: "D".to_owned(),
                member: "x".to_owned()
            })
        );
    }

    #[test]
    fn array_length_zero_and_too_long_are_errors() {
        for length in [0, 65_537, u32::MAX] {
            let ty = st(
                "A",
                vec![member("a", LayoutType::new_array(LayoutType::F32, length))],
            );
            assert_eq!(
                compute(&ty, "fixture:a", "MtekFixture_a"),
                Err(LayoutError::InvalidArrayLength { length })
            );
        }
        let ok = st(
            "A",
            vec![member("a", LayoutType::new_array(LayoutType::F32, 65_536))],
        );
        assert!(compute(&ok, "fixture:a", "MtekFixture_a").is_ok());
    }

    #[test]
    fn oversized_nesting_is_an_overflow_error_not_a_panic() {
        // 65 536 * 65 536 * 16 bytes does not fit in 32 bits.
        let inner = LayoutType::new_array(LayoutType::F32, 65_536);
        let outer = LayoutType::new_array(inner, 65_536);
        let ty = st("Huge", vec![member("h", outer)]);
        assert_eq!(
            compute(&ty, "fixture:h", "MtekFixture_h"),
            Err(LayoutError::SizeOverflow)
        );
    }

    #[test]
    fn non_struct_top_level_is_rejected() {
        assert_eq!(
            compute(&LayoutType::Vec3, "fixture:v", "MtekFixture_v"),
            Err(LayoutError::NotAStruct {
                found: "vec3".to_owned()
            })
        );
    }

    #[test]
    fn padded_flag_follows_the_natural_stride() {
        let padded = |element: LayoutType| element_is_padded(&element).expect("valid element");
        assert!(padded(LayoutType::F32));
        assert!(padded(LayoutType::I32));
        assert!(padded(LayoutType::U32));
        assert!(padded(LayoutType::Bool));
        assert!(padded(LayoutType::Vec2));
        assert!(!padded(LayoutType::Vec3));
        assert!(!padded(LayoutType::Vec4));
        assert!(!padded(LayoutType::Color));
        assert!(!padded(LayoutType::Quat));
        assert!(!padded(LayoutType::Mat4));
        // Struct whose natural stride is 4.
        assert!(padded(st("P", vec![member("a", LayoutType::F32)])));
        // Struct of 16 bytes with natural alignment 16.
        assert!(!padded(st(
            "L",
            vec![member("c", LayoutType::Vec3), member("i", LayoutType::F32)]
        )));
        // Struct of 12 bytes (three f32): natural stride 12.
        assert!(padded(st(
            "T",
            vec![
                member("a", LayoutType::F32),
                member("b", LayoutType::F32),
                member("c", LayoutType::F32)
            ]
        )));
        // An array whose element is already a multiple of 16.
        assert!(!padded(LayoutType::new_array(LayoutType::F32, 4)));
    }

    #[test]
    fn nested_struct_member_offsets_are_absolute_and_element_offsets_relative() {
        let inner = st(
            "Inner",
            vec![member("x", LayoutType::F32), member("y", LayoutType::F32)],
        );
        let ty = st(
            "Outer",
            vec![
                member("pad", LayoutType::F32),
                member("inner", inner.clone()),
                member("list", LayoutType::new_array(inner, 2)),
            ],
        );
        let record = compute(&ty, "fixture:o", "MtekFixture_o").expect("valid");
        let LayoutNode::Struct { members, .. } = &record.root else {
            panic!("root must be a struct node");
        };
        // pad @0; inner @16 (UAlign 16) with members at 16 and 20; list @32 (16 + roundUp(16, 8)).
        let LayoutNode::Struct {
            members: inner_members,
            ..
        } = &members[1].node
        else {
            panic!("inner must be a struct node");
        };
        assert_eq!(inner_members[0].node.offset(), 16);
        assert_eq!(inner_members[1].node.offset(), 20);
        let LayoutNode::Array {
            offset,
            element,
            stride,
            padded,
            ..
        } = &members[2].node
        else {
            panic!("list must be an array node");
        };
        assert_eq!((*offset, *stride, *padded), (32, 16, true));
        let LayoutNode::Struct {
            members: element_members,
            ..
        } = element.as_ref()
        else {
            panic!("element must be a struct node");
        };
        assert_eq!(element.offset(), 0);
        assert_eq!(element_members[1].node.offset(), 4);
    }
}
