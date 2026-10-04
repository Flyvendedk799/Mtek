//! Mtek types of the typed IR as WGSL types (`spec/gpu-layout.md` section 3): one Mtek
//! type maps to one WGSL type in every context, so a struct or array local has exactly
//! the type of the same value in a parameter block.
//!
//! The IR spells types as text (`vec3`, `array<f32, 3>`, `src/main.mtek::Wave`, decision
//! 0041). Scalars, vectors, `color`, `quat` and `mat4` map directly; arrays and structs
//! go through the layout engine, which decides padded array elements (`MtekPad16_*`,
//! `.value`) and the `@align`/`@size` attributes of the struct declarations, so that no
//! offset or padding rule is computed here. A top-level `bool` is a WGSL `bool`; a `bool`
//! inside a struct or array is stored as `u32`.

use std::collections::BTreeMap;

use crate::emit_wgsl::{padded_element_name, wgsl_struct_name};
use crate::ir::{Program, StructItem};
use crate::layout::{LayoutNode, LayoutType, compute};
use crate::lowering::shader_ir::{ShaderType, StructDecl, VectorSize, struct_decls_from_layout};
use crate::lowering::standard_stage::SURFACE_INPUT_STRUCT;
use crate::source::Span;

use super::Defect;

/// The name of the registry record of the stage input.
pub(super) const SURFACE_INPUT: &str = "SurfaceInput";

/// The struct that wraps a type for the layout engine (never declared).
const PROBE: &str = "MtekProbe";

/// A parsed IR type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum MtekType {
    Bool,
    I32,
    U32,
    F32,
    Vector(VectorSize),
    Color,
    Quat,
    Mat4,
    Array {
        element: Box<MtekType>,
        length: u32,
    },
    /// A user struct, by symbol.
    Struct(String),
    /// The stage input record.
    SurfaceInput,
}

/// Parses an IR type spelling. Arrays nest at most 256 levels (`E3032`).
pub(super) fn parse(ty: &str) -> Option<MtekType> {
    Some(match ty {
        "bool" => MtekType::Bool,
        "i32" => MtekType::I32,
        "u32" => MtekType::U32,
        "f32" => MtekType::F32,
        "vec2" => MtekType::Vector(VectorSize::Two),
        "vec3" => MtekType::Vector(VectorSize::Three),
        "vec4" => MtekType::Vector(VectorSize::Four),
        "color" => MtekType::Color,
        "quat" => MtekType::Quat,
        "mat4" => MtekType::Mat4,
        SURFACE_INPUT => MtekType::SurfaceInput,
        _ => {
            if let Some((element, length)) = split_array(ty) {
                MtekType::Array {
                    element: Box::new(parse(element)?),
                    length,
                }
            } else if ty.contains("::") {
                MtekType::Struct(ty.to_owned())
            } else {
                return None;
            }
        }
    })
}

/// `array<E, N>` as `(E, N)`. The last `, ` separates the length: an element type
/// contains `, ` only inside its own brackets, which come before it.
pub(super) fn split_array(ty: &str) -> Option<(&str, u32)> {
    let inner = ty.strip_prefix("array<")?.strip_suffix('>')?;
    let (element, length) = inner.rsplit_once(", ")?;
    Some((element, length.parse().ok()?))
}

/// The element of an array type, as stored.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct ArrayElement {
    /// The element's IR type.
    pub mtek: String,
    pub length: u32,
    /// The element's WGSL type as stored (a `bool` is `u32`).
    pub stored: ShaderType,
    /// The wrapper struct (`MtekPad16_f32`) when elements are padded; its member `value`
    /// holds the element.
    pub wrapper: Option<ShaderType>,
}

/// Maps IR types to WGSL types and collects the struct declarations they need.
pub(super) struct TypeMapper<'p> {
    structs: BTreeMap<&'p str, &'p StructItem>,
    /// Layout results by type spelling: the type's WGSL form and its node.
    cache: BTreeMap<String, (ShaderType, LayoutNode)>,
    /// Struct declarations needed so far, each before its first use, without duplicates.
    pub decls: Vec<StructDecl>,
    /// The span of generated declarations (the material).
    span: Span,
}

impl<'p> TypeMapper<'p> {
    pub fn new(program: &'p Program, span: Span) -> TypeMapper<'p> {
        let structs = program
            .modules
            .iter()
            .flat_map(|module| module.items.iter())
            .filter_map(|item| match item {
                crate::ir::Item::Struct(item) => Some((item.symbol.as_str(), item)),
                _ => None,
            })
            .collect();
        TypeMapper {
            structs,
            cache: BTreeMap::new(),
            decls: Vec::new(),
            span,
        }
    }

    /// The declaration of the struct `symbol`.
    pub fn struct_item(&self, symbol: &str) -> Result<&'p StructItem, Defect> {
        self.structs
            .get(symbol)
            .copied()
            .ok_or_else(|| format!("the struct type '{symbol}' is not declared in the IR"))
    }

    /// The WGSL type of a value of the IR type `ty`.
    pub fn value_type(&mut self, ty: &str) -> Result<ShaderType, Defect> {
        let parsed = parse(ty).ok_or_else(|| no_gpu_form(ty))?;
        Ok(match parsed {
            MtekType::Bool => ShaderType::BOOL,
            MtekType::I32 => ShaderType::I32,
            MtekType::U32 => ShaderType::U32,
            MtekType::F32 => ShaderType::F32,
            MtekType::Vector(size) => ShaderType::Vector {
                size,
                scalar: crate::lowering::shader_ir::Scalar::F32,
            },
            MtekType::Color | MtekType::Quat => ShaderType::VEC4,
            MtekType::Mat4 => ShaderType::Mat4,
            MtekType::SurfaceInput => ShaderType::named(SURFACE_INPUT_STRUCT),
            MtekType::Array { .. } | MtekType::Struct(_) => self.laid_out(ty, &parsed)?.0,
        })
    }

    /// The WGSL type of a value of the IR type `ty` stored in a struct field or array
    /// element: `u32` for a `bool`, else [`TypeMapper::value_type`].
    pub fn stored_type(&mut self, ty: &str) -> Result<ShaderType, Defect> {
        if ty == "bool" {
            Ok(ShaderType::U32)
        } else {
            self.value_type(ty)
        }
    }

    /// The element of the array type `ty`.
    pub fn array_element(&mut self, ty: &str) -> Result<ArrayElement, Defect> {
        let (element, length) =
            split_array(ty).ok_or_else(|| format!("'{ty}' is not an array type"))?;
        let parsed = parse(ty).ok_or_else(|| no_gpu_form(ty))?;
        let (_, node) = self.laid_out(ty, &parsed)?;
        let LayoutNode::Array {
            padded,
            element: element_node,
            ..
        } = node
        else {
            return Err(format!("the layout of '{ty}' is not an array"));
        };
        // Declares the element's structs too.
        let stored = self.stored_type(element)?;
        Ok(ArrayElement {
            mtek: element.to_owned(),
            length,
            stored,
            wrapper: padded.then(|| ShaderType::named(padded_element_name(&element_node))),
        })
    }

    /// The WGSL name of the struct type `symbol` (`S_<hash8>_<Name>`).
    pub fn struct_name(symbol: &str) -> String {
        wgsl_struct_name(symbol)
    }

    /// The layout result of an array or struct type, declaring its structs.
    fn laid_out(
        &mut self,
        ty: &str,
        parsed: &MtekType,
    ) -> Result<(ShaderType, LayoutNode), Defect> {
        if let Some(found) = self.cache.get(ty) {
            return Ok(found.clone());
        }
        let layout = self.layout_type(parsed)?;
        let record = compute(
            &LayoutType::new_struct(PROBE, vec![("value".to_owned(), layout)]),
            "fixture:probe",
            PROBE,
        )
        .map_err(|e| format!("the type '{ty}' has no layout: {e}"))?;
        let LayoutNode::Struct { members, .. } = &record.root else {
            return Err(format!("the layout of '{ty}' has no struct root"));
        };
        let node = members
            .first()
            .map(|member| member.node.clone())
            .ok_or_else(|| format!("the layout of '{ty}' has no member"))?;
        for decl in struct_decls_from_layout(&record, self.span) {
            if decl.name != PROBE && !self.decls.iter().any(|d| d.name == decl.name) {
                self.decls.push(decl);
            }
        }
        let wgsl = ShaderType::from_layout_node(&node);
        self.cache
            .insert(ty.to_owned(), (wgsl.clone(), node.clone()));
        Ok((wgsl, node))
    }

    /// The layout type of `ty`; a struct is named by its symbol (decision 0036 item 11).
    /// Types nest at most 256 levels (`E3032`), which bounds the recursion.
    fn layout_type(&self, ty: &MtekType) -> Result<LayoutType, Defect> {
        Ok(match ty {
            MtekType::Bool => LayoutType::Bool,
            MtekType::I32 => LayoutType::I32,
            MtekType::U32 => LayoutType::U32,
            MtekType::F32 => LayoutType::F32,
            MtekType::Vector(VectorSize::Two) => LayoutType::Vec2,
            MtekType::Vector(VectorSize::Three) => LayoutType::Vec3,
            MtekType::Vector(VectorSize::Four) => LayoutType::Vec4,
            MtekType::Color => LayoutType::Color,
            MtekType::Quat => LayoutType::Quat,
            MtekType::Mat4 => LayoutType::Mat4,
            MtekType::Array { element, length } => {
                LayoutType::new_array(self.layout_type(element)?, *length)
            }
            MtekType::Struct(symbol) => {
                let item = self.struct_item(symbol)?;
                let mut members = Vec::with_capacity(item.fields.len());
                for field in &item.fields {
                    let parsed = parse(&field.ty).ok_or_else(|| no_gpu_form(&field.ty))?;
                    members.push((field.name.clone(), self.layout_type(&parsed)?));
                }
                LayoutType::new_struct(symbol.clone(), members)
            }
            MtekType::SurfaceInput => return Err(no_gpu_form(SURFACE_INPUT)),
        })
    }
}

fn no_gpu_form(ty: &str) -> Defect {
    format!("the type '{ty}' has no GPU representation")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_parse_from_their_ir_spelling() {
        assert_eq!(parse("vec2"), Some(MtekType::Vector(VectorSize::Two)));
        assert_eq!(
            parse("array<array<src/a.mtek::W, 2>, 3>"),
            Some(MtekType::Array {
                element: Box::new(MtekType::Array {
                    element: Box::new(MtekType::Struct("src/a.mtek::W".to_owned())),
                    length: 2
                }),
                length: 3
            })
        );
        assert_eq!(parse("string"), None);
        assert_eq!(parse("Box"), None);
        assert_eq!(parse("array<f32, x>"), None);
        assert_eq!(
            split_array("array<array<f32, 2>, 3>"),
            Some(("array<f32, 2>", 3))
        );
    }
}
