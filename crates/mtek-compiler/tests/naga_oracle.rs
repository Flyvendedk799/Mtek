//! The Naga layout oracle (`spec/gpu-layout.md` section 9.2): for every fixture of
//! `tests/gpu-layout/` the emitted WGSL is parsed and validated by the pinned Naga
//! (`ValidationFlags::all()`, which enforces the uniform layout rules), and every struct
//! member offset, struct span and array stride Naga computed is compared with the layout
//! record. Naga is an implementation independent of `layout::compute`.

// Test helpers outside `#[test]` functions report broken fixtures by panicking.
#![allow(clippy::panic)]

mod common;

use common::{BINDING, GROUP, VAR_NAME, block_declarations, compute_fixture, fixture_names};
use mtek_compiler::emit_wgsl::{
    Leaf, LeafKind, WgslErrorStage, emit_bindings, emit_block_structs, leaf_accessors,
    member_wgsl_name, padded_element_name, validate_wgsl, wgsl_struct_name,
};
use mtek_compiler::layout::{LayoutNode, LayoutRecord, LayoutType, ScalarKind, compute};
use naga::{ArraySize, Handle, Module, Scalar, Type, TypeInner, VectorSize};

/// The oracle module: structs, the binding and a fragment entry point that XORs the bit
/// pattern of every leaf into an accumulator, so that every leaf is read.
fn oracle_module(record: &LayoutRecord, structs: &str) -> (String, Vec<Leaf>) {
    let leaves = leaf_accessors(record, VAR_NAME);
    let mut source = String::new();
    source.push_str(structs);
    source.push('\n');
    source.push_str(&emit_bindings(
        GROUP,
        BINDING,
        VAR_NAME,
        &record.wgsl_struct,
    ));
    source.push_str("\n@fragment\nfn fs_main() -> @location(0) vec4<u32> {\n");
    source.push_str("    var acc: u32 = 0u;\n");
    for leaf in &leaves {
        source.push_str(&format!("    acc = acc ^ {};\n", leaf.raw_bits_expr()));
    }
    source.push_str("    return vec4<u32>(acc);\n}\n");
    (source, leaves)
}

fn struct_handle(module: &Module, name: &str) -> Handle<Type> {
    let mut found = module
        .types
        .iter()
        .filter(|(_, ty)| ty.name.as_deref() == Some(name))
        .map(|(handle, _)| handle);
    let handle = found
        .next()
        .unwrap_or_else(|| panic!("Naga module has no type named `{name}`"));
    assert!(found.next().is_none(), "type `{name}` is declared twice");
    handle
}

fn expect_scalar(inner: &TypeInner, kind: ScalarKind, what: &str) {
    let expected = match kind {
        ScalarKind::F32 => Scalar::F32,
        ScalarKind::I32 => Scalar::I32,
        ScalarKind::U32 | ScalarKind::Bool32 => Scalar::U32,
    };
    assert_eq!(
        inner,
        &TypeInner::Scalar(expected),
        "{what}: scalar type differs"
    );
}

fn vector_size(components: u32) -> VectorSize {
    match components {
        2 => VectorSize::Bi,
        3 => VectorSize::Tri,
        4 => VectorSize::Quad,
        other => panic!("unsupported vector width {other}"),
    }
}

/// Asserts that the Naga type `handle` is the WGSL form of `node` with the same offsets,
/// spans and strides, recursively. `what` names the location for failure messages.
fn check_node(module: &Module, handle: Handle<Type>, node: &LayoutNode, what: &str) {
    let ty = &module.types[handle];
    match node {
        LayoutNode::Scalar { scalar, .. } => expect_scalar(&ty.inner, *scalar, what),
        LayoutNode::Vector {
            components, scalar, ..
        } => {
            let expected = match scalar {
                ScalarKind::F32 => Scalar::F32,
                ScalarKind::I32 => Scalar::I32,
                ScalarKind::U32 | ScalarKind::Bool32 => Scalar::U32,
            };
            assert_eq!(
                ty.inner,
                TypeInner::Vector {
                    size: vector_size(*components),
                    scalar: expected
                },
                "{what}: vector type differs"
            );
        }
        LayoutNode::Matrix { columns, rows, .. } => {
            assert_eq!(
                ty.inner,
                TypeInner::Matrix {
                    columns: vector_size(*columns),
                    rows: vector_size(*rows),
                    scalar: Scalar::F32
                },
                "{what}: matrix type differs"
            );
        }
        LayoutNode::Struct { name, .. } => {
            assert_eq!(
                ty.name.as_deref(),
                Some(wgsl_struct_name(name).as_str()),
                "{what}: struct name differs"
            );
            check_struct(module, handle, node, what);
        }
        LayoutNode::Array {
            length,
            stride,
            padded,
            element,
            ..
        } => {
            let TypeInner::Array {
                base,
                size,
                stride: naga_stride,
            } = &ty.inner
            else {
                panic!("{what}: expected an array, Naga has {:?}", ty.inner);
            };
            assert_eq!(
                *size,
                ArraySize::Constant(
                    std::num::NonZeroU32::new(*length)
                        .unwrap_or_else(|| panic!("{what}: length 0"))
                ),
                "{what}: array length differs"
            );
            assert_eq!(naga_stride, stride, "{what}: array stride differs");
            if *padded {
                let wrapper = &module.types[*base];
                assert_eq!(
                    wrapper.name.as_deref(),
                    Some(padded_element_name(element).as_str()),
                    "{what}: wrapper name differs"
                );
                let TypeInner::Struct { members, span } = &wrapper.inner else {
                    panic!("{what}: wrapper is not a struct");
                };
                assert_eq!(*span, *stride, "{what}: wrapper span differs from stride");
                assert_eq!(members.len(), 1, "{what}: wrapper has one member");
                assert_eq!(members[0].name.as_deref(), Some("value"));
                assert_eq!(members[0].offset, 0, "{what}: wrapper value offset");
                check_node(module, members[0].ty, element, &format!("{what}[].value"));
            } else {
                check_node(module, *base, element, &format!("{what}[]"));
            }
        }
    }
}

/// The struct span and every member offset (relative to the struct) equal the record.
fn check_struct(module: &Module, handle: Handle<Type>, node: &LayoutNode, what: &str) {
    let LayoutNode::Struct {
        name: struct_name,
        offset,
        size,
        members,
        ..
    } = node
    else {
        panic!("{what}: record node is not a struct");
    };
    let TypeInner::Struct {
        members: naga_members,
        span,
    } = &module.types[handle].inner
    else {
        panic!("{what}: Naga type is not a struct");
    };
    assert_eq!(
        span, size,
        "{what}: struct span differs from the record size"
    );
    assert_eq!(
        naga_members.len(),
        members.len(),
        "{what}: member count differs"
    );
    for (naga_member, member) in naga_members.iter().zip(members) {
        let location = format!("{what}.{}", member.name);
        assert_eq!(
            naga_member.name.as_deref(),
            Some(member_wgsl_name(struct_name, &member.name).as_str()),
            "{location}: member name differs"
        );
        assert_eq!(
            naga_member.offset,
            member.node.offset() - offset,
            "{location}: member offset differs from the record"
        );
        check_node(module, naga_member.ty, &member.node, &location);
    }
}

/// A position while resolving a leaf path in Naga's types.
#[derive(Clone, Copy)]
enum Cursor {
    Type(Handle<Type>),
    /// A matrix column: a vector of this scalar, addressed without a Naga type handle.
    Column(Scalar),
    Scalar(Scalar),
}

/// Resolves the path of a leaf (`.name` and `[index]` steps below `root`) through Naga's
/// own offsets, strides and column sizes; returns the byte offset and the scalar found.
fn resolve_leaf(module: &Module, root: Handle<Type>, rest: &str) -> (u32, Scalar) {
    let mut cursor = Cursor::Type(root);
    let mut offset = 0u32;
    let mut chars = rest.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '.' => {
                let mut name = String::new();
                while let Some(&n) = chars.peek() {
                    if n == '.' || n == '[' {
                        break;
                    }
                    name.push(n);
                    chars.next();
                }
                cursor = match cursor {
                    Cursor::Type(handle) => match &module.types[handle].inner {
                        TypeInner::Struct { members, .. } => {
                            let member = members
                                .iter()
                                .find(|m| m.name.as_deref() == Some(name.as_str()))
                                .unwrap_or_else(|| panic!("no member `{name}` in `{rest}`"));
                            offset += member.offset;
                            Cursor::Type(member.ty)
                        }
                        TypeInner::Vector { scalar, .. } => {
                            offset += component_index(&name) * 4;
                            Cursor::Scalar(*scalar)
                        }
                        other => panic!("cannot select `{name}` of {other:?} in `{rest}`"),
                    },
                    Cursor::Column(scalar) => {
                        offset += component_index(&name) * 4;
                        Cursor::Scalar(scalar)
                    }
                    Cursor::Scalar(_) => panic!("cannot select `{name}` of a scalar in `{rest}`"),
                };
            }
            '[' => {
                let mut digits = String::new();
                for n in chars.by_ref() {
                    if n == ']' {
                        break;
                    }
                    digits.push(n);
                }
                let index: u32 = digits
                    .parse()
                    .unwrap_or_else(|_| panic!("bad array index `{digits}` in `{rest}`"));
                let Cursor::Type(handle) = cursor else {
                    panic!("cannot index a non-aggregate in `{rest}`");
                };
                cursor = match &module.types[handle].inner {
                    TypeInner::Array { base, stride, .. } => {
                        offset += index * stride;
                        Cursor::Type(*base)
                    }
                    TypeInner::Matrix { rows, scalar, .. } => {
                        // A column is a vector of `rows` scalars, aligned like one.
                        let column = match rows {
                            VectorSize::Tri => 4 * u32::from(scalar.width),
                            other => *other as u32 * u32::from(scalar.width),
                        };
                        offset += index * column;
                        Cursor::Column(*scalar)
                    }
                    other => panic!("cannot index {other:?} in `{rest}`"),
                };
            }
            other => panic!("unexpected character `{other}` in `{rest}`"),
        }
    }
    match cursor {
        Cursor::Scalar(scalar) => (offset, scalar),
        Cursor::Type(handle) => match module.types[handle].inner {
            TypeInner::Scalar(scalar) => (offset, scalar),
            ref other => panic!("leaf `{rest}` ends at {other:?}, not a scalar"),
        },
        Cursor::Column(_) => panic!("leaf `{rest}` ends at a matrix column"),
    }
}

fn component_index(name: &str) -> u32 {
    match name {
        "x" => 0,
        "y" => 1,
        "z" => 2,
        "w" => 3,
        other => panic!("unknown component `{other}`"),
    }
}

fn leaf_scalar(kind: LeafKind) -> Scalar {
    match kind {
        LeafKind::F32 => Scalar::F32,
        LeafKind::I32 => Scalar::I32,
        LeafKind::U32 | LeafKind::Bool32 => Scalar::U32,
    }
}

fn validated(source: &str, fixture: &str) -> Module {
    validate_wgsl(source).unwrap_or_else(|e| {
        panic!(
            "fixture `{fixture}`: Naga rejected the emitted WGSL: {e}\n{}\n--- source\n{source}",
            e.rendered
        )
    })
}

#[test]
fn naga_accepts_every_fixture_and_agrees_with_the_layout_record() {
    let names = fixture_names();
    assert_eq!(names.len(), 14, "all 14 fixtures take part: {names:?}");
    for name in &names {
        let record = compute_fixture(name);
        let (source, leaves) = oracle_module(&record, &emit_block_structs(&record));
        let module = validated(&source, name);

        let root = struct_handle(&module, &record.wgsl_struct);
        check_struct(&module, root, &record.root, &record.wgsl_struct);
        assert_eq!(
            match &module.types[root].inner {
                TypeInner::Struct { span, .. } => *span,
                _ => 0,
            },
            record.size,
            "fixture `{name}`: block span differs from the record size"
        );

        // The binding and the entry point exist as emitted.
        assert_eq!(module.global_variables.len(), 1, "fixture `{name}`");
        assert_eq!(module.entry_points.len(), 1, "fixture `{name}`");

        // Every leaf is reachable through its typed path, at the byte offset Naga
        // derives for that path, with the scalar type the leaf kind promises.
        assert!(!leaves.is_empty(), "fixture `{name}` has leaves");
        let mut previous: Option<u32> = None;
        for leaf in &leaves {
            let rest = leaf
                .wgsl
                .strip_prefix(VAR_NAME)
                .unwrap_or_else(|| panic!("leaf `{}` does not start at the root", leaf.wgsl));
            let (naga_offset, naga_scalar) = resolve_leaf(&module, root, rest);
            assert_eq!(
                naga_offset, leaf.byte_offset,
                "fixture `{name}`: leaf `{}` byte offset differs from Naga's",
                leaf.path
            );
            assert_eq!(
                naga_scalar,
                leaf_scalar(leaf.kind),
                "fixture `{name}`: leaf `{}` scalar differs",
                leaf.path
            );
            if let Some(previous) = previous {
                assert!(
                    leaf.byte_offset > previous,
                    "fixture `{name}`: leaf order is not offset order at `{}`",
                    leaf.path
                );
            }
            previous = Some(leaf.byte_offset);
        }
    }
}

#[test]
fn leaf_counts_of_selected_fixtures() {
    let expected = [
        ("scalar_f32", 1),
        ("mixed", 12),
        ("array_f32", 4),
        ("all_types", 37),
        ("builtin_object", 32),
        ("builtin_frame", 72),
    ];
    for (name, count) in expected {
        let record = compute_fixture(name);
        assert_eq!(
            leaf_accessors(&record, "p").len(),
            count,
            "fixture `{name}`"
        );
    }
}

#[test]
fn emitted_structs_are_byte_identical_across_runs() {
    for name in fixture_names() {
        let first = emit_block_structs(&compute_fixture(&name));
        let second = emit_block_structs(&compute_fixture(&name));
        assert_eq!(first, second, "fixture `{name}`");
        assert_eq!(
            block_declarations(&compute_fixture(&name)),
            block_declarations(&compute_fixture(&name)),
            "fixture `{name}`"
        );
    }
}

/// Removes every `@size(n) ` attribute: the deliberate layout mistake of the negative test.
fn strip_size_attributes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("@size(") {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let end = after
            .find(") ")
            .unwrap_or_else(|| panic!("unterminated @size attribute in `{after}`"));
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

#[test]
fn naga_rejects_a_struct_member_without_its_size_attribute() {
    let record = compute_fixture("struct_then_scalar");
    let correct = emit_block_structs(&record);
    let broken = strip_size_attributes(&correct);
    assert_ne!(correct, broken, "the mutation must remove something");
    assert!(!broken.contains("@size"), "{broken}");

    // The mutation breaks only the offset of `after`; the correct text is accepted.
    let (good_source, _) = oracle_module(&record, &correct);
    validated(&good_source, "struct_then_scalar");

    let (bad_source, _) = oracle_module(&record, &broken);
    let error = validate_wgsl(&bad_source).expect_err("Naga must reject the broken layout");
    assert_eq!(error.stage, WgslErrorStage::Validate, "{error}");
    assert!(
        error
            .causes
            .iter()
            .any(|c| c.contains("Alignment requirements for address space Uniform")),
        "expected a uniform alignment error, got {error:?}"
    );
    assert!(
        error
            .causes
            .iter()
            .any(|c| c.contains("offset 4 must be at least 16")),
        "expected the member-after-struct rule, got {error:?}"
    );
    assert!(error.span.is_some(), "the error keeps a WGSL byte span");
}

#[test]
fn naga_rejects_a_padded_array_without_its_wrapper() {
    // Without MtekPad16_f32 the array stride would be 4, which uniform rules reject.
    let source = "struct W {\n    @align(16) weights: array<f32, 3>,\n    bias: f32,\n}\n\
                  @group(1) @binding(0) var<uniform> mtek_params: W;\n\
                  @fragment fn fs_main() -> @location(0) vec4<f32> {\n\
                  \x20   return vec4<f32>(mtek_params.weights[0] + mtek_params.bias);\n}\n";
    let error = validate_wgsl(source).expect_err("an unpadded f32 array is not uniform-legal");
    assert_eq!(error.stage, WgslErrorStage::Validate, "{error}");
}

#[test]
fn members_named_like_wgsl_reserved_words_validate_with_naga() {
    // `target`, `filter`, `layout` and `type` are reserved words in WGSL; the u_ prefix of
    // spec/gpu-layout.md section 3 makes the emitted module valid by construction.
    let names = ["target", "filter", "layout", "type"];
    let inner = LayoutType::new_struct("Inner", vec![("target".to_owned(), LayoutType::F32)]);
    let mut members: Vec<(String, LayoutType)> = names
        .iter()
        .zip([
            LayoutType::Vec3,
            LayoutType::F32,
            LayoutType::new_array(LayoutType::U32, 2),
            LayoutType::Bool,
        ])
        .map(|(name, ty)| ((*name).to_owned(), ty))
        .collect();
    members.push(("inner".to_owned(), inner));
    let ty = LayoutType::new_struct("Reserved", members);
    let record = compute(&ty, "fixture:reserved", "MtekFixture_reserved")
        .unwrap_or_else(|e| panic!("layout: {e}"));

    let structs = emit_block_structs(&record);
    for name in names {
        assert!(
            structs.contains(&format!("u_{name}: ")),
            "missing u_{name} in\n{structs}"
        );
    }
    let (source, leaves) = oracle_module(&record, &structs);
    let module = validated(&source, "reserved");
    let root = struct_handle(&module, &record.wgsl_struct);
    check_struct(&module, root, &record.root, &record.wgsl_struct);

    // The record keeps the Mtek names; only the WGSL paths are prefixed.
    let paths: Vec<&str> = leaves.iter().map(|l| l.path.as_str()).collect();
    assert_eq!(paths[0], "target.x");
    assert!(paths.contains(&"layout[1]"));
    assert!(paths.contains(&"inner.target"));
    assert!(
        leaves
            .iter()
            .any(|l| l.wgsl == "mtek_params.u_layout[1].value")
    );

    // Without the prefix the same names are rejected by Naga.
    let unprefixed = source.replace("u_", "");
    assert_ne!(unprefixed, source);
    let error = validate_wgsl(&unprefixed).expect_err("reserved words are not member names");
    assert_eq!(error.stage, WgslErrorStage::Parse, "{error}");
}
