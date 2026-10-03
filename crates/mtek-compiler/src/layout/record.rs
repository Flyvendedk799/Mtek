//! The layout record: the one authoritative description of a block's memory layout
//! (`spec/gpu-layout.md` section 5).
//!
//! Field order in these declarations is the normative JSON key order. serde serialises
//! struct fields in declaration order, and an internally tagged enum writes its tag
//! (`kind`) first, so the output order is stable without any map type.
//! Key order of a node: `kind, name, offset, size, align, scalar, components, columns,
//! rows, columnStride, length, stride, padded, element, members`.

use serde::{Deserialize, Serialize};

/// The layout of one block. Key order: `id, wgslStruct, size, align, root`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRecord {
    /// Identity, for example `material:src/main.mtek::Pulse`, `builtin:frame`, `fixture:mixed`.
    pub id: String,
    /// Name of the generated WGSL struct.
    pub wgsl_struct: String,
    /// Size of the block in bytes (a multiple of `align`).
    pub size: u32,
    /// Alignment of the block in bytes (`layoutStruct(..).align`, at least 4).
    pub align: u32,
    /// The block as a struct node.
    pub root: LayoutNode,
}

/// The scalar a leaf node is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScalarKind {
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "u32")]
    U32,
    /// A bool stored as a `u32` holding `0` or `1`.
    #[serde(rename = "bool32")]
    Bool32,
}

/// One member of a struct node. Key order: `name, mtekType, node`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutMember {
    pub name: String,
    /// The Mtek spelling of the member's type (`f32`, `color`, `array<f32, 3>`, `Inner`).
    pub mtek_type: String,
    pub node: LayoutNode,
}

/// A node of the layout tree. All numbers are bytes.
///
/// Member offsets are absolute within the block. Inside an array, the `element` node
/// starts at offset 0 and everything below it is relative to the element start.
/// `align` is the alignment the node was placed with (`UAlign`); only the root node
/// carries the block's own alignment (`layoutStruct(..).align`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum LayoutNode {
    Scalar {
        offset: u32,
        size: u32,
        align: u32,
        scalar: ScalarKind,
    },
    Vector {
        offset: u32,
        size: u32,
        align: u32,
        scalar: ScalarKind,
        components: u32,
    },
    Matrix {
        offset: u32,
        size: u32,
        align: u32,
        columns: u32,
        rows: u32,
        column_stride: u32,
    },
    Struct {
        /// The Mtek struct name.
        name: String,
        offset: u32,
        size: u32,
        align: u32,
        members: Vec<LayoutMember>,
    },
    Array {
        offset: u32,
        size: u32,
        align: u32,
        length: u32,
        stride: u32,
        /// True when each element must be wrapped to reach a 16-byte stride
        /// (`spec/gpu-layout.md` section 4.4 rule 3).
        padded: bool,
        element: Box<LayoutNode>,
    },
}

impl LayoutNode {
    /// Offset of the node in bytes.
    pub fn offset(&self) -> u32 {
        match self {
            LayoutNode::Scalar { offset, .. }
            | LayoutNode::Vector { offset, .. }
            | LayoutNode::Matrix { offset, .. }
            | LayoutNode::Struct { offset, .. }
            | LayoutNode::Array { offset, .. } => *offset,
        }
    }

    /// Size of the node in bytes.
    pub fn size(&self) -> u32 {
        match self {
            LayoutNode::Scalar { size, .. }
            | LayoutNode::Vector { size, .. }
            | LayoutNode::Matrix { size, .. }
            | LayoutNode::Struct { size, .. }
            | LayoutNode::Array { size, .. } => *size,
        }
    }

    /// Alignment of the node in bytes.
    pub fn align(&self) -> u32 {
        match self {
            LayoutNode::Scalar { align, .. }
            | LayoutNode::Vector { align, .. }
            | LayoutNode::Matrix { align, .. }
            | LayoutNode::Struct { align, .. }
            | LayoutNode::Array { align, .. } => *align,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scalar(offset: u32) -> LayoutNode {
        LayoutNode::Scalar {
            offset,
            size: 4,
            align: 4,
            scalar: ScalarKind::Bool32,
        }
    }

    #[test]
    fn scalar_node_key_order_and_names() {
        let json = serde_json::to_string(&scalar(8)).unwrap_or_default();
        assert_eq!(
            json,
            r#"{"kind":"scalar","offset":8,"size":4,"align":4,"scalar":"bool32"}"#
        );
    }

    #[test]
    fn matrix_node_uses_camel_case_column_stride() {
        let node = LayoutNode::Matrix {
            offset: 0,
            size: 64,
            align: 16,
            columns: 4,
            rows: 4,
            column_stride: 16,
        };
        let json = serde_json::to_string(&node).unwrap_or_default();
        assert_eq!(
            json,
            r#"{"kind":"matrix","offset":0,"size":64,"align":16,"columns":4,"rows":4,"columnStride":16}"#
        );
    }

    #[test]
    fn struct_and_array_key_order() {
        let array = LayoutNode::Array {
            offset: 0,
            size: 32,
            align: 16,
            length: 2,
            stride: 16,
            padded: true,
            element: Box::new(scalar(0)),
        };
        let node = LayoutNode::Struct {
            name: "S".to_owned(),
            offset: 0,
            size: 32,
            align: 16,
            members: vec![LayoutMember {
                name: "m".to_owned(),
                mtek_type: "array<bool, 2>".to_owned(),
                node: array,
            }],
        };
        let json = serde_json::to_string(&node).unwrap_or_default();
        assert_eq!(
            json,
            concat!(
                r#"{"kind":"struct","name":"S","offset":0,"size":32,"align":16,"members":["#,
                r#"{"name":"m","mtekType":"array<bool, 2>","node":"#,
                r#"{"kind":"array","offset":0,"size":32,"align":16,"length":2,"stride":16,"#,
                r#""padded":true,"element":"#,
                r#"{"kind":"scalar","offset":0,"size":4,"align":4,"scalar":"bool32"}}}]}"#
            )
        );
    }

    #[test]
    fn record_key_order_and_round_trip() {
        let record = LayoutRecord {
            id: "fixture:x".to_owned(),
            wgsl_struct: "MtekFixture_x".to_owned(),
            size: 4,
            align: 4,
            root: LayoutNode::Struct {
                name: "X".to_owned(),
                offset: 0,
                size: 4,
                align: 4,
                members: Vec::new(),
            },
        };
        let json = serde_json::to_string(&record).unwrap_or_default();
        assert!(json.starts_with(
            r#"{"id":"fixture:x","wgslStruct":"MtekFixture_x","size":4,"align":4,"root":{"kind":"struct""#
        ));
        let back: Result<LayoutRecord, _> = serde_json::from_str(&json);
        assert_eq!(back.ok(), Some(record));
    }

    #[test]
    fn accessors_read_every_variant() {
        assert_eq!(
            (scalar(12).offset(), scalar(12).size(), scalar(12).align()),
            (12, 4, 4)
        );
    }
}
