//! WGSL struct declarations, typed leaf accessors and binding declarations for GPU blocks
//! (`spec/gpu-layout.md` sections 3, 4.4 and 6).
//!
//! WGSL computes member offsets itself from natural alignment and then checks the uniform
//! rules; it never adjusts an offset. The emitter therefore adds the attributes of section
//! 4.4 so that WGSL's own computation lands exactly on the offsets of the layout record:
//!
//! 1. `@align(16)` on every member whose type is a struct or an array,
//! 2. `@size(n)` on every member whose gap to the next member (`next.offset - offset`)
//!    exceeds the natural size of its type (this covers the struct-followed-by-member
//!    rule),
//! 3. a wrapper `struct MtekPad16_<elem> { @size(stride) value: <elem> }` as the element
//!    type of every array whose record node has `padded: true`.
//!
//! Nothing here computes an offset: attribute values are differences of offsets already in
//! the record. The Naga oracle (`tests/naga_oracle.rs`) proves the result per fixture.

use std::collections::BTreeSet;

use crate::layout::{LayoutMember, LayoutNode, LayoutRecord, ScalarKind, user_struct_name};

/// The alignment attribute value for struct- and array-typed members (section 4.4 rule 1).
const UNIFORM_ALIGN: u32 = 16;

/// Prefix of generated padded-element wrapper structs.
const PAD_PREFIX: &str = "MtekPad16_";

/// The WGSL name of a nested Mtek struct (`spec/gpu-layout.md` section 5).
///
/// A user struct of a module is named by its symbol (`src/a.mtek::Shape`) and becomes
/// `S_<hash8>_<Name>` ([`user_struct_name`], decision 0036), so same-named structs of two
/// modules never collide. A plain name (the layout fixtures, which have no module) becomes
/// `S_<Name>`. Names that already carry the reserved `Mtek` prefix are compiler-owned
/// built-in structs (`MtekLight`) and keep their name.
pub fn wgsl_struct_name(mtek_name: &str) -> String {
    if mtek_name.starts_with("Mtek") {
        mtek_name.to_owned()
    } else if let Some((module_path, name)) = mtek_name.rsplit_once("::") {
        user_struct_name(module_path, name)
    } else {
        format!("S_{mtek_name}")
    }
}

/// The WGSL name of a member of the Mtek struct `struct_name`.
///
/// Every Mtek-declared struct and parameter-block member is emitted as `u_<name>`, because
/// Mtek field names such as `target`, `filter`, `layout` or `type` are WGSL reserved words
/// (`spec/gpu-layout.md` section 3). Built-in blocks (`MtekFrame`, `MtekLight`,
/// `MtekObject`, recognised by the reserved `Mtek` prefix) keep their fixed member names.
/// The layout record and `Leaf::path` keep the Mtek names.
pub fn member_wgsl_name(struct_name: &str, member_name: &str) -> String {
    if struct_name.starts_with("Mtek") {
        member_name.to_owned()
    } else {
        format!("u_{member_name}")
    }
}

/// The WGSL spelling of a scalar as stored in a block (`bool` is stored as `u32`).
fn scalar_name(kind: ScalarKind) -> &'static str {
    match kind {
        ScalarKind::F32 => "f32",
        ScalarKind::I32 => "i32",
        ScalarKind::U32 | ScalarKind::Bool32 => "u32",
    }
}

/// Single-letter suffix of WGSL's predeclared vector aliases (`vec2f`, `vec3i`, `vec4u`).
fn alias_letter(kind: ScalarKind) -> char {
    match kind {
        ScalarKind::F32 => 'f',
        ScalarKind::I32 => 'i',
        ScalarKind::U32 | ScalarKind::Bool32 => 'u',
    }
}

/// The element part of a wrapper name: `f32`, `i32`, `u32`, `vec2f`, `S_<Name>`.
fn wrapper_suffix(element: &LayoutNode) -> String {
    match element {
        LayoutNode::Scalar { scalar, .. } => scalar_name(*scalar).to_owned(),
        LayoutNode::Vector {
            components, scalar, ..
        } => format!("vec{components}{}", alias_letter(*scalar)),
        LayoutNode::Matrix { columns, rows, .. } => format!("mat{columns}x{rows}f"),
        LayoutNode::Struct { name, .. } => wgsl_struct_name(name),
        // The layout engine never pads an array element that is itself an array (its
        // stride is already a multiple of 16); the name only keeps hand-made records
        // distinct.
        LayoutNode::Array {
            length, element, ..
        } => format!("array{length}_{}", wrapper_suffix(element)),
    }
}

/// The name of the wrapper struct for a padded array element: `MtekPad16_f32`,
/// `MtekPad16_u32` (also for `bool32`), `MtekPad16_vec2f`, `MtekPad16_S_<Name>`.
pub fn padded_element_name(element: &LayoutNode) -> String {
    format!("{PAD_PREFIX}{}", wrapper_suffix(element))
}

/// The WGSL type of a node as it appears in a struct member or an array element.
pub fn type_expr(node: &LayoutNode) -> String {
    match node {
        LayoutNode::Scalar { scalar, .. } => scalar_name(*scalar).to_owned(),
        LayoutNode::Vector {
            components, scalar, ..
        } => format!("vec{components}<{}>", scalar_name(*scalar)),
        LayoutNode::Matrix { columns, rows, .. } => format!("mat{columns}x{rows}<f32>"),
        LayoutNode::Struct { name, .. } => wgsl_struct_name(name),
        LayoutNode::Array {
            length,
            padded,
            element,
            ..
        } => {
            let inner = if *padded {
                padded_element_name(element)
            } else {
                type_expr(element)
            };
            format!("array<{inner}, {length}>")
        }
    }
}

/// Collects declarations, inner types first, each name once.
struct Declarations {
    seen: BTreeSet<String>,
    ordered: Vec<String>,
}

impl Declarations {
    fn new() -> Self {
        Declarations {
            seen: BTreeSet::new(),
            ordered: Vec::new(),
        }
    }

    /// Declares the types a member of this node type depends on.
    fn declare_dependencies(&mut self, node: &LayoutNode) {
        match node {
            LayoutNode::Struct { name, .. } => self.declare_struct(&wgsl_struct_name(name), node),
            LayoutNode::Array {
                stride,
                padded,
                element,
                ..
            } => {
                self.declare_dependencies(element);
                if *padded {
                    self.declare_wrapper(element, *stride);
                }
            }
            LayoutNode::Scalar { .. } | LayoutNode::Vector { .. } | LayoutNode::Matrix { .. } => {}
        }
    }

    fn declare_wrapper(&mut self, element: &LayoutNode, stride: u32) {
        let name = padded_element_name(element);
        if !self.seen.insert(name.clone()) {
            return;
        }
        self.ordered.push(format!(
            "struct {name} {{\n    @size({stride}) value: {},\n}}\n",
            type_expr(element)
        ));
    }

    fn declare_struct(&mut self, name: &str, node: &LayoutNode) {
        let LayoutNode::Struct {
            name: mtek_name,
            members,
            ..
        } = node
        else {
            return;
        };
        if !self.seen.insert(name.to_owned()) {
            return;
        }
        for member in members {
            self.declare_dependencies(&member.node);
        }
        let mut text = format!("struct {name} {{\n");
        for (index, member) in members.iter().enumerate() {
            let next = members.get(index + 1);
            text.push_str(&member_line(mtek_name, member, next));
        }
        text.push_str("}\n");
        self.ordered.push(text);
    }
}

/// One member declaration line with the attributes of section 4.4. `next` is the member
/// declared after this one, if any; the gap between the two offsets drives `@size`.
fn member_line(struct_name: &str, member: &LayoutMember, next: Option<&LayoutMember>) -> String {
    let node = &member.node;
    let mut attributes = String::new();
    if matches!(node, LayoutNode::Struct { .. } | LayoutNode::Array { .. }) {
        attributes.push_str(&format!("@align({UNIFORM_ALIGN}) "));
    }
    if let Some(next) = next {
        let gap = next.node.offset().saturating_sub(node.offset());
        if gap > node.size() {
            attributes.push_str(&format!("@size({gap}) "));
        }
    }
    format!(
        "    {attributes}{}: {},\n",
        member_wgsl_name(struct_name, &member.name),
        type_expr(node)
    )
}

/// Emits, in dependency order (inner types first, each declared once), every struct the
/// block needs: nested user structs (`S_<Name>`), padded element wrappers
/// (`MtekPad16_<elem>`) and finally the block struct itself (`record.wgsl_struct`).
///
/// Two nested structs with the same Mtek name are declared once; the Mtek type system
/// forbids two different structs of one name within a module, and module qualification
/// arrives in M2.
///
/// The text uses 4-space indentation, one member per line, a blank line between
/// declarations and ends with a newline. It is deterministic.
pub fn emit_block_structs(record: &LayoutRecord) -> String {
    let mut declarations = Declarations::new();
    declarations.declare_struct(&record.wgsl_struct, &record.root);
    declarations.ordered.join("\n")
}

/// `@group(g) @binding(b) var<uniform> name: Struct;` followed by a newline.
pub fn emit_bindings(group: u32, binding: u32, var_name: &str, struct_name: &str) -> String {
    format!("@group({group}) @binding({binding}) var<uniform> {var_name}: {struct_name};\n")
}

/// The 32-bit scalar kind of a leaf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeafKind {
    F32,
    I32,
    U32,
    /// A bool stored as a `u32` holding `0` or `1`.
    Bool32,
}

impl From<ScalarKind> for LeafKind {
    fn from(kind: ScalarKind) -> Self {
        match kind {
            ScalarKind::F32 => LeafKind::F32,
            ScalarKind::I32 => LeafKind::I32,
            ScalarKind::U32 => LeafKind::U32,
            ScalarKind::Bool32 => LeafKind::Bool32,
        }
    }
}

/// One 32-bit scalar component of a block, reachable through a typed WGSL path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Leaf {
    /// Path from the block root, for example `weights[2]` or `b.y`.
    pub path: String,
    /// The WGSL expression that reads the leaf, for example `mtek_params.weights[2].value`.
    pub wgsl: String,
    pub kind: LeafKind,
    /// Offset of the leaf in bytes from the start of the block.
    pub byte_offset: u32,
}

impl Leaf {
    /// The leaf as a `u32` bit pattern: `bitcast<u32>(..)` for `f32` and `i32`, the value
    /// itself for `u32` and the raw `0u`/`1u` word for a stored bool.
    pub fn raw_bits_expr(&self) -> String {
        match self.kind {
            LeafKind::F32 | LeafKind::I32 => format!("bitcast<u32>({})", self.wgsl),
            LeafKind::U32 | LeafKind::Bool32 => self.wgsl.clone(),
        }
    }

    /// The leaf as a value of its Mtek type: a stored bool reads as `(.. != 0u)`.
    pub fn typed_expr(&self) -> String {
        match self.kind {
            LeafKind::Bool32 => format!("({} != 0u)", self.wgsl),
            _ => self.wgsl.clone(),
        }
    }
}

const COMPONENTS: [char; 4] = ['x', 'y', 'z', 'w'];

fn component_name(index: u32) -> char {
    usize::try_from(index)
        .ok()
        .and_then(|i| COMPONENTS.get(i))
        .copied()
        .unwrap_or('x')
}

fn child(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}.{name}")
    }
}

/// `frame` is the byte position the offsets of `node` are relative to: 0 for the block,
/// the start of the element for everything below an array element.
fn collect_leaves(node: &LayoutNode, frame: u32, path: &str, wgsl: &str, out: &mut Vec<Leaf>) {
    match node {
        LayoutNode::Scalar { offset, scalar, .. } => out.push(Leaf {
            path: path.to_owned(),
            wgsl: wgsl.to_owned(),
            kind: (*scalar).into(),
            byte_offset: frame.saturating_add(*offset),
        }),
        LayoutNode::Vector {
            offset,
            components,
            scalar,
            ..
        } => {
            for index in 0..*components {
                let name = component_name(index).to_string();
                out.push(Leaf {
                    path: child(path, &name),
                    wgsl: format!("{wgsl}.{name}"),
                    kind: (*scalar).into(),
                    byte_offset: frame
                        .saturating_add(*offset)
                        .saturating_add(index.saturating_mul(4)),
                });
            }
        }
        LayoutNode::Matrix {
            offset,
            columns,
            rows,
            column_stride,
            ..
        } => {
            for column in 0..*columns {
                for row in 0..*rows {
                    let name = component_name(row);
                    out.push(Leaf {
                        path: format!("{path}[{column}].{name}"),
                        wgsl: format!("{wgsl}[{column}].{name}"),
                        kind: LeafKind::F32,
                        byte_offset: frame
                            .saturating_add(*offset)
                            .saturating_add(column.saturating_mul(*column_stride))
                            .saturating_add(row.saturating_mul(4)),
                    });
                }
            }
        }
        LayoutNode::Struct { name, members, .. } => {
            for member in members {
                collect_leaves(
                    &member.node,
                    frame,
                    &child(path, &member.name),
                    &child(wgsl, &member_wgsl_name(name, &member.name)),
                    out,
                );
            }
        }
        LayoutNode::Array {
            offset,
            length,
            stride,
            padded,
            element,
            ..
        } => {
            let array_start = frame.saturating_add(*offset);
            for index in 0..*length {
                let element_frame = array_start.saturating_add(index.saturating_mul(*stride));
                let element_wgsl = if *padded {
                    format!("{wgsl}[{index}].value")
                } else {
                    format!("{wgsl}[{index}]")
                };
                collect_leaves(
                    element,
                    element_frame,
                    &format!("{path}[{index}]"),
                    &element_wgsl,
                    out,
                );
            }
        }
    }
}

/// Every 32-bit scalar component of the block in **leaf order**: declaration order,
/// depth-first, array elements in index order, vector components `x, y, z, w`, matrix
/// columns then rows. `root_expr` is the WGSL expression of the block value, for example
/// `mtek_params`.
pub fn leaf_accessors(record: &LayoutRecord, root_expr: &str) -> Vec<Leaf> {
    let mut leaves = Vec::new();
    collect_leaves(&record.root, 0, "", root_expr, &mut leaves);
    leaves
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{LayoutType, compute};

    fn st(name: &str, members: Vec<(&str, LayoutType)>) -> LayoutType {
        LayoutType::new_struct(
            name,
            members
                .into_iter()
                .map(|(n, t)| (n.to_owned(), t))
                .collect(),
        )
    }

    fn record(id: &str, ty: &LayoutType) -> LayoutRecord {
        compute(ty, &format!("fixture:{id}"), &format!("MtekFixture_{id}")).expect("valid layout")
    }

    fn mixed() -> LayoutRecord {
        record(
            "mixed",
            &st(
                "Mixed",
                vec![
                    ("a", LayoutType::F32),
                    ("b", LayoutType::Vec3),
                    ("c", LayoutType::U32),
                    ("d", LayoutType::Vec2),
                    ("e", LayoutType::Bool),
                    ("f", LayoutType::Color),
                ],
            ),
        )
    }

    fn struct_then_scalar() -> LayoutRecord {
        record(
            "struct_then_scalar",
            &st(
                "Outer",
                vec![
                    ("inner", st("Inner", vec![("k", LayoutType::F32)])),
                    ("after", LayoutType::F32),
                ],
            ),
        )
    }

    fn array_f32() -> LayoutRecord {
        record(
            "array_f32",
            &st(
                "W",
                vec![
                    ("weights", LayoutType::new_array(LayoutType::F32, 3)),
                    ("bias", LayoutType::F32),
                ],
            ),
        )
    }

    #[test]
    fn mixed_block_is_emitted_with_explicit_gaps() {
        assert_eq!(
            emit_block_structs(&mixed()),
            "struct MtekFixture_mixed {\n\
             \x20   @size(16) u_a: f32,\n\
             \x20   u_b: vec3<f32>,\n\
             \x20   u_c: u32,\n\
             \x20   u_d: vec2<f32>,\n\
             \x20   @size(8) u_e: u32,\n\
             \x20   u_f: vec4<f32>,\n\
             }\n"
        );
    }

    #[test]
    fn struct_followed_by_scalar_gets_align_and_size() {
        assert_eq!(
            emit_block_structs(&struct_then_scalar()),
            "struct S_Inner {\n\
             \x20   u_k: f32,\n\
             }\n\
             \n\
             struct MtekFixture_struct_then_scalar {\n\
             \x20   @align(16) @size(16) u_inner: S_Inner,\n\
             \x20   u_after: f32,\n\
             }\n"
        );
    }

    #[test]
    fn padded_scalar_array_uses_a_wrapper() {
        assert_eq!(
            emit_block_structs(&array_f32()),
            "struct MtekPad16_f32 {\n\
             \x20   @size(16) value: f32,\n\
             }\n\
             \n\
             struct MtekFixture_array_f32 {\n\
             \x20   @align(16) u_weights: array<MtekPad16_f32, 3>,\n\
             \x20   u_bias: f32,\n\
             }\n"
        );
    }

    #[test]
    fn wrappers_exist_for_bool_vec2_and_struct_elements_once() {
        let ty = st(
            "W",
            vec![
                ("flags", LayoutType::new_array(LayoutType::Bool, 2)),
                ("more", LayoutType::new_array(LayoutType::U32, 2)),
                ("pairs", LayoutType::new_array(LayoutType::Vec2, 3)),
                (
                    "items",
                    LayoutType::new_array(st("P", vec![("a", LayoutType::F32)]), 3),
                ),
            ],
        );
        let text = emit_block_structs(&record("w", &ty));
        // bool32 and u32 share MtekPad16_u32, declared once.
        assert_eq!(text.matches("struct MtekPad16_u32 {").count(), 1, "{text}");
        assert!(text.contains("struct MtekPad16_vec2f {\n    @size(16) value: vec2<f32>,\n}"));
        assert!(text.contains("struct MtekPad16_S_P {\n    @size(16) value: S_P,\n}"));
        assert!(text.contains("u_items: array<MtekPad16_S_P, 3>,"), "{text}");
        // Inner types come first: S_P before its wrapper before the block.
        let position = |needle: &str| text.find(needle).expect(needle);
        assert!(position("struct S_P ") < position("struct MtekPad16_S_P "));
        assert!(position("struct MtekPad16_S_P ") < position("struct MtekFixture_w "));
    }

    #[test]
    fn unpadded_struct_elements_have_no_wrapper() {
        let light = st(
            "L",
            vec![("color", LayoutType::Vec3), ("intensity", LayoutType::F32)],
        );
        let ty = st(
            "Lights",
            vec![
                ("lights", LayoutType::new_array(light, 2)),
                ("count", LayoutType::U32),
            ],
        );
        let text = emit_block_structs(&record("lights", &ty));
        assert!(!text.contains("MtekPad16"), "{text}");
        assert!(
            text.contains("@align(16) u_lights: array<S_L, 2>,"),
            "{text}"
        );
    }

    #[test]
    fn struct_used_twice_is_declared_once_and_builtin_names_are_kept() {
        let inner = st("Inner", vec![("k", LayoutType::Vec4)]);
        let light = st("MtekLight", vec![("k", LayoutType::Vec4)]);
        let ty = st(
            "Twice",
            vec![
                ("one", inner.clone()),
                ("two", inner),
                ("lights", LayoutType::new_array(light, 2)),
            ],
        );
        let text = emit_block_structs(&record("twice", &ty));
        assert_eq!(text.matches("struct S_Inner {").count(), 1, "{text}");
        assert!(text.contains("struct MtekLight {"), "{text}");
        assert!(!text.contains("S_MtekLight"), "{text}");
    }

    #[test]
    fn user_members_get_the_u_prefix_and_builtin_blocks_keep_their_names() {
        assert_eq!(member_wgsl_name("Mixed", "target"), "u_target");
        assert_eq!(member_wgsl_name("Inner", "a"), "u_a");
        assert_eq!(member_wgsl_name("MtekFrame", "view_proj"), "view_proj");
        assert_eq!(member_wgsl_name("MtekLight", "range"), "range");
        let light = st("MtekLight", vec![("range", LayoutType::F32)]);
        let ty = st("Twice", vec![("filter", LayoutType::F32), ("light", light)]);
        let text = emit_block_structs(&record("twice", &ty));
        assert!(text.contains("    range: f32,\n"), "{text}");
        assert!(text.contains("    @size(16) u_filter: f32,\n"), "{text}");
        assert!(text.contains("u_light: MtekLight,\n"), "{text}");
        let leaves = leaf_accessors(&record("twice", &ty), "p");
        assert_eq!(leaves[0].path, "filter");
        assert_eq!(leaves[0].wgsl, "p.u_filter");
        assert_eq!(leaves[1].path, "light.range");
        assert_eq!(leaves[1].wgsl, "p.u_light.range");
    }

    #[test]
    fn trailing_struct_member_needs_no_size_attribute() {
        let ty = st(
            "Outer",
            vec![("inner", st("Inner", vec![("k", LayoutType::F32)]))],
        );
        let text = emit_block_structs(&record("trailing", &ty));
        assert!(
            text.contains("    @align(16) u_inner: S_Inner,\n"),
            "{text}"
        );
    }

    #[test]
    fn emission_is_deterministic() {
        assert_eq!(emit_block_structs(&mixed()), emit_block_structs(&mixed()));
    }

    #[test]
    fn struct_names_follow_the_module_naming_rules() {
        assert_eq!(wgsl_struct_name("MtekLight"), "MtekLight");
        assert_eq!(wgsl_struct_name("Inner"), "S_Inner");
        // A user struct named by its symbol carries its module's hash.
        assert_eq!(
            wgsl_struct_name("src/main.mtek::Shape"),
            format!("S_{}_Shape", crate::layout::hash8("src/main.mtek"))
        );
        assert_ne!(
            wgsl_struct_name("src/a.mtek::Shape"),
            wgsl_struct_name("src/b.mtek::Shape")
        );
    }

    #[test]
    fn binding_declaration_text() {
        assert_eq!(
            emit_bindings(1, 0, "mtek_params", "MtekFixture_mixed"),
            "@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_mixed;\n"
        );
    }

    #[test]
    fn mixed_leaves_are_in_leaf_order_with_byte_offsets() {
        let leaves = leaf_accessors(&mixed(), "mtek_params");
        let actual: Vec<(&str, &str, LeafKind, u32)> = leaves
            .iter()
            .map(|l| (l.path.as_str(), l.wgsl.as_str(), l.kind, l.byte_offset))
            .collect();
        assert_eq!(
            actual,
            vec![
                ("a", "mtek_params.u_a", LeafKind::F32, 0),
                ("b.x", "mtek_params.u_b.x", LeafKind::F32, 16),
                ("b.y", "mtek_params.u_b.y", LeafKind::F32, 20),
                ("b.z", "mtek_params.u_b.z", LeafKind::F32, 24),
                ("c", "mtek_params.u_c", LeafKind::U32, 28),
                ("d.x", "mtek_params.u_d.x", LeafKind::F32, 32),
                ("d.y", "mtek_params.u_d.y", LeafKind::F32, 36),
                ("e", "mtek_params.u_e", LeafKind::Bool32, 40),
                ("f.x", "mtek_params.u_f.x", LeafKind::F32, 48),
                ("f.y", "mtek_params.u_f.y", LeafKind::F32, 52),
                ("f.z", "mtek_params.u_f.z", LeafKind::F32, 56),
                ("f.w", "mtek_params.u_f.w", LeafKind::F32, 60),
            ]
        );
    }

    #[test]
    fn array_leaves_go_through_the_wrapper_value() {
        let leaves = leaf_accessors(&array_f32(), "mtek_params");
        let actual: Vec<(&str, &str, u32)> = leaves
            .iter()
            .map(|l| (l.path.as_str(), l.wgsl.as_str(), l.byte_offset))
            .collect();
        assert_eq!(
            actual,
            vec![
                ("weights[0]", "mtek_params.u_weights[0].value", 0),
                ("weights[1]", "mtek_params.u_weights[1].value", 16),
                ("weights[2]", "mtek_params.u_weights[2].value", 32),
                ("bias", "mtek_params.u_bias", 48),
            ]
        );
    }

    #[test]
    fn struct_elements_and_unpadded_arrays_have_relative_element_offsets() {
        let light = st(
            "L",
            vec![("color", LayoutType::Vec3), ("intensity", LayoutType::F32)],
        );
        let ty = st(
            "Lights",
            vec![
                ("lights", LayoutType::new_array(light, 2)),
                ("count", LayoutType::U32),
            ],
        );
        let leaves = leaf_accessors(&record("lights", &ty), "b");
        assert_eq!(leaves.len(), 9);
        assert_eq!(leaves[0].wgsl, "b.u_lights[0].u_color.x");
        assert_eq!(leaves[3].path, "lights[0].intensity");
        assert_eq!(leaves[3].byte_offset, 12);
        assert_eq!(leaves[4].wgsl, "b.u_lights[1].u_color.x");
        assert_eq!(leaves[4].byte_offset, 16);
        assert_eq!(leaves[7].byte_offset, 28);
        assert_eq!(leaves[8].path, "count");
        assert_eq!(leaves[8].byte_offset, 32);
    }

    #[test]
    fn padded_struct_elements_read_through_value() {
        let ty = st(
            "Nested",
            vec![
                (
                    "items",
                    LayoutType::new_array(st("P", vec![("a", LayoutType::F32)]), 3),
                ),
                ("tail", LayoutType::Vec2),
            ],
        );
        let leaves = leaf_accessors(&record("nested", &ty), "b");
        assert_eq!(leaves[1].wgsl, "b.u_items[1].value.u_a");
        assert_eq!(leaves[1].byte_offset, 16);
        assert_eq!(leaves[3].path, "tail.x");
        assert_eq!(leaves[3].byte_offset, 48);
    }

    #[test]
    fn matrix_leaves_run_columns_then_rows() {
        let ty = st("M", vec![("m", LayoutType::Mat4)]);
        let leaves = leaf_accessors(&record("m", &ty), "b");
        assert_eq!(leaves.len(), 16);
        assert_eq!(leaves[0].wgsl, "b.u_m[0].x");
        assert_eq!(leaves[1].wgsl, "b.u_m[0].y");
        assert_eq!(leaves[4].wgsl, "b.u_m[1].x");
        assert_eq!(leaves[4].byte_offset, 16);
        assert_eq!(leaves[15].path, "m[3].w");
        assert_eq!(leaves[15].byte_offset, 60);
    }

    #[test]
    fn bool_leaves_read_raw_in_the_probe_and_compared_in_typed_use() {
        let leaves = leaf_accessors(&mixed(), "p");
        let flag = leaves.iter().find(|l| l.path == "e").expect("leaf e");
        assert_eq!(flag.raw_bits_expr(), "p.u_e");
        assert_eq!(flag.typed_expr(), "(p.u_e != 0u)");
        let float = leaves.iter().find(|l| l.path == "a").expect("leaf a");
        assert_eq!(float.raw_bits_expr(), "bitcast<u32>(p.u_a)");
        assert_eq!(float.typed_expr(), "p.u_a");
    }
}
