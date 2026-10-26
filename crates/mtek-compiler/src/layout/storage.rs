//! Root storage-array layout (decision 0201). An element retains the ordinary
//! Mtek value representation, including bool32 and padding inside composites.
//! Only the resource's outer array uses the natural WGSL stride: a scalar stream
//! is packed, rather than acquiring the uniform-array 16-byte wrapper.

use super::compute::{build_node, natural_align, u_size};
use super::{LayoutError, LayoutNode, LayoutType};

/// A fixed-capacity storage resource, with checked byte arithmetic. Root capacity
/// is independent of the uniform/value-array length limit; the resource consumer
/// must additionally enforce its byte budget and the actual GPU device limits.
pub fn storage_array(element: &LayoutType, length: u32) -> Result<LayoutNode, LayoutError> {
    if length == 0 {
        return Err(LayoutError::EmptyStorageArray);
    }
    let align = natural_align(element)?;
    let size = u_size(element)?;
    let stride = size
        .checked_add(align - 1)
        .map(|size| size / align * align)
        .ok_or(LayoutError::SizeOverflow)?;
    let size = stride
        .checked_mul(length)
        .ok_or(LayoutError::SizeOverflow)?;
    let mut element = build_node(element, 0)?;
    // A root element has the alignment of its emitted value type, rather than
    // the stricter placement alignment used inside an ordinary uniform block.
    match &mut element {
        LayoutNode::Scalar { align: at, .. }
        | LayoutNode::Vector { align: at, .. }
        | LayoutNode::Matrix { align: at, .. }
        | LayoutNode::Struct { align: at, .. }
        | LayoutNode::Array { align: at, .. } => *at = align,
    }
    Ok(LayoutNode::Array {
        offset: 0,
        size,
        align,
        length,
        stride,
        padded: false,
        element: Box::new(element),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{ScalarKind, compute};

    fn metrics(ty: &LayoutType, length: u32) -> (u32, u32, u32) {
        let LayoutNode::Array {
            size,
            align,
            stride,
            padded,
            ..
        } = storage_array(ty, length).unwrap()
        else {
            panic!("storage root must be an array")
        };
        assert!(!padded);
        (size, align, stride)
    }

    #[test]
    fn packed_streams_and_vector_matrix_strides() {
        for (ty, align, stride) in [
            (LayoutType::F32, 4, 4),
            (LayoutType::I32, 4, 4),
            (LayoutType::U32, 4, 4),
            (LayoutType::Bool, 4, 4),
            (LayoutType::Vec2, 8, 8),
            (LayoutType::Vec3, 16, 16),
            (LayoutType::Vec4, 16, 16),
            (LayoutType::Color, 16, 16),
            (LayoutType::Quat, 16, 16),
            (LayoutType::Mat4, 16, 64),
        ] {
            assert_eq!(metrics(&ty, 7), (7 * stride, align, stride));
        }
        let LayoutNode::Array { element, .. } = storage_array(&LayoutType::Bool, 3).unwrap() else {
            unreachable!()
        };
        assert!(matches!(
            *element,
            LayoutNode::Scalar {
                scalar: ScalarKind::Bool32,
                ..
            }
        ));
    }

    #[test]
    fn small_structs_use_their_emitted_alignment() {
        let small = LayoutType::new_struct("Small", vec![("x".into(), LayoutType::F32)]);
        assert_eq!(metrics(&small, 3), (12, 4, 4));
        let nested = LayoutType::new_struct(
            "Nested",
            vec![("v".into(), small), ("last".into(), LayoutType::F32)],
        );
        assert_eq!(metrics(&nested, 3), (96, 16, 32));
        let LayoutNode::Array { element, .. } = storage_array(&nested, 3).unwrap() else {
            unreachable!()
        };
        let ordinary = compute(&nested, "fixture:nested", "NestedBlock").unwrap();
        assert_eq!(*element, ordinary.root);
    }

    #[test]
    fn nested_value_arrays_retain_uniform_compatible_representation() {
        let inner = LayoutType::new_array(LayoutType::F32, 3);
        assert_eq!(metrics(&inner, 5), (240, 4, 48));
        let LayoutNode::Array { element, .. } = storage_array(&inner, 5).unwrap() else {
            unreachable!()
        };
        assert!(matches!(
            *element,
            LayoutNode::Array {
                length: 3,
                stride: 16,
                padded: true,
                ..
            }
        ));
    }

    #[test]
    fn resource_capacity_is_separate_from_value_array_limit() {
        assert_eq!(metrics(&LayoutType::F32, 1_000_000), (4_000_000, 4, 4));
        assert_eq!(
            storage_array(&LayoutType::F32, 0),
            Err(LayoutError::EmptyStorageArray)
        );
        assert_eq!(
            storage_array(&LayoutType::Mat4, u32::MAX),
            Err(LayoutError::SizeOverflow)
        );
        assert!(storage_array(&LayoutType::new_array(LayoutType::F32, 0), 1).is_err());
        assert!(storage_array(&LayoutType::new_array(LayoutType::F32, 65_537), 1).is_err());
        assert!(storage_array(&LayoutType::new_struct("Empty", vec![]), 1).is_err());
        assert!(
            storage_array(
                &LayoutType::new_struct(
                    "Duplicate",
                    vec![("x".into(), LayoutType::F32), ("x".into(), LayoutType::U32)]
                ),
                1
            )
            .is_err()
        );
    }
}
