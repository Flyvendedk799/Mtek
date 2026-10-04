// TEMPORARY (decision 0013): removed in M2-09
//! The compiler-built shader of the built-in `Unlit` material: the temporary M1 path of
//! decision 0013. Until M2 compiles material source, `Unlit` is not lowered from
//! `std/materials.mtek`; this module builds its shader IR directly and runs it through the
//! same standard stage, printer and Naga validation every material will use. M2-09
//! replaces it with the prelude's `Unlit` compiled from source and deletes this file (the
//! M2 gate checks that it is gone).
//!
//! What is *not* hard-coded here:
//! - the parameter block comes from the stdlib registry's `Unlit` schema (its fields,
//!   types and order), laid out by the layout engine with the id
//!   `material:std/materials.mtek::Unlit` and the struct `MtekParams_<hash8>_Unlit`
//!   (`spec/gpu-layout.md` section 5);
//! - the declaration span is the `material Unlit { … }` item found by parsing the prelude
//!   source the caller registered in its source map.
//!
//! What is: the fragment body `return color;`, lowered to `return mtek_params.u_color;`
//! (params are read from the block, never folded), and that it reads no `SurfaceInput`
//! field.

use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::emit_wgsl::{ShaderArtifact, emit_shader};
use crate::layout::{
    LayoutNode, LayoutRecord, LayoutType, compute, material_layout_id, material_params_struct,
};
use crate::source::{SourceFile, Span};
use crate::stdlib::{SchemaCategory, TypeRef, registry};
use crate::syntax::ast::{Item, ItemKind, MaterialMember};
use crate::syntax::{lex, parse_module};

use super::shader_ir::{Expr, Name, ShaderType, Statement, UserNameKind};
use super::standard_stage::{
    FragmentBody, MaterialDescription, build_standard_stage, params_global,
};

/// The prelude module that declares `Unlit` (its symbol is
/// `std/materials.mtek::Unlit`, decision 0028).
pub const PRELUDE_PATH: &str = "std/materials.mtek";

/// The material's name.
pub const UNLIT: &str = "Unlit";

/// The text of the prelude module [`PRELUDE_PATH`], embedded in the compiler. The caller
/// adds it to its source map under [`PRELUDE_PATH`] and passes the resulting file to
/// [`unlit_shader`], so that spans into it resolve to lines and columns like any other.
pub fn prelude_text() -> Option<&'static str> {
    registry().prelude_source(PRELUDE_PATH)
}

/// The symbol of `Unlit`: `std/materials.mtek::Unlit`.
pub fn unlit_symbol() -> String {
    format!("{PRELUDE_PATH}::{UNLIT}")
}

/// `E9999` for a defect of this temporary path (the prelude or the registry does not
/// describe `Unlit` the way it expects).
fn internal(defect: impl Into<String>) -> Vec<Diagnostic> {
    vec![
        Diagnostic::new(
            Code::E9999,
            "The built-in material 'Unlit' could not be built; this is a compiler bug.",
        )
        .note(defect.into())
        .help("please report it with the program that caused it"),
    ]
}

/// The validated shader of `Unlit`. `prelude` is the file [`PRELUDE_PATH`] with the text
/// of [`prelude_text`] in the caller's source map.
///
/// # Errors
/// `E9999` if `prelude` is not the prelude or does not declare `Unlit`, or the registry's
/// `Unlit` schema has a parameter type that is not a GPU value; `E6100` if Naga rejects the
/// emitted module. Both are compiler defects.
pub fn unlit_shader(prelude: &SourceFile) -> Result<ShaderArtifact, Vec<Diagnostic>> {
    let declaration = unlit_declaration(prelude)?;
    let record = unlit_params()?;
    let fragment = unlit_fragment(&record, declaration)?;
    let material = MaterialDescription {
        symbol: unlit_symbol(),
        declaration,
        surface_inputs: Default::default(),
        params: Some(record),
        fragment,
        structs: Vec::new(),
        functions: Vec::new(),
    };
    let shader = build_standard_stage(&material)
        .map_err(|e| internal(format!("a built-in block has no layout: {e}")))?;
    emit_shader(&shader)
}

/// Where `Unlit` and its parameters are declared in the prelude: the manifest's material and
/// param symbols and the materials' param spans point there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnlitDeclarations {
    /// `export material Unlit { … }`.
    pub declaration: Span,
    /// Each `param name: T = default;`, in declaration order.
    pub params: Vec<(String, Span)>,
}

/// The declarations of `Unlit` in `prelude` (the file [`PRELUDE_PATH`] with the text of
/// [`prelude_text`]).
///
/// # Errors
/// `E9999` if `prelude` is not the prelude or does not declare `Unlit`.
pub fn unlit_declarations(prelude: &SourceFile) -> Result<UnlitDeclarations, Vec<Diagnostic>> {
    let item = unlit_item(prelude)?;
    let ItemKind::Material(material) = &item.kind else {
        return Err(internal("the prelude item 'Unlit' is not a material"));
    };
    let params = material
        .members
        .iter()
        .filter_map(|member| match member {
            MaterialMember::Param(param) => Some((param.name.name.clone(), param.span)),
            _ => None,
        })
        .collect();
    Ok(UnlitDeclarations {
        declaration: item.span,
        params,
    })
}

/// The span of `material Unlit { … }` (from `export`) in the prelude file.
fn unlit_declaration(prelude: &SourceFile) -> Result<Span, Vec<Diagnostic>> {
    unlit_item(prelude).map(|item| item.span)
}

/// The item `export material Unlit { … }` of the prelude file.
fn unlit_item(prelude: &SourceFile) -> Result<Item, Vec<Diagnostic>> {
    if prelude.path().as_str() != PRELUDE_PATH || Some(prelude.text()) != prelude_text() {
        return Err(internal(format!(
            "the file '{}' passed as the prelude is not the embedded '{PRELUDE_PATH}'",
            prelude.path()
        )));
    }
    let mut sink = Diagnostics::new();
    let mut lexed = lex(prelude);
    lexed.report_into(&mut sink);
    let parsed = parse_module(prelude.text(), &lexed.tokens, &lexed.trivia, &mut sink);
    if sink.has_errors() {
        return Err(internal(format!(
            "the prelude '{PRELUDE_PATH}' does not parse"
        )));
    }
    parsed
        .module
        .items
        .into_iter()
        .find(|item| matches!(&item.kind, ItemKind::Material(m) if m.name.name == UNLIT))
        .ok_or_else(|| {
            internal(format!(
                "the prelude '{PRELUDE_PATH}' declares no material '{UNLIT}'"
            ))
        })
}

/// The layout type of a material parameter of registry type `ty`, if it is a GPU value.
fn layout_type(ty: TypeRef) -> Option<LayoutType> {
    Some(match ty {
        TypeRef::Bool => LayoutType::Bool,
        TypeRef::I32 => LayoutType::I32,
        TypeRef::U32 => LayoutType::U32,
        TypeRef::F32 => LayoutType::F32,
        TypeRef::Vec2 => LayoutType::Vec2,
        TypeRef::Vec3 => LayoutType::Vec3,
        TypeRef::Vec4 => LayoutType::Vec4,
        TypeRef::Mat4 => LayoutType::Mat4,
        TypeRef::Quat => LayoutType::Quat,
        TypeRef::Color => LayoutType::Color,
        _ => return None,
    })
}

/// The parameter block of `Unlit`, from the registry's schema.
fn unlit_params() -> Result<LayoutRecord, Vec<Diagnostic>> {
    let schema = registry()
        .schema(UNLIT)
        .filter(|s| s.category == SchemaCategory::Material)
        .ok_or_else(|| internal(format!("the registry has no material schema '{UNLIT}'")))?;
    let mut members = Vec::new();
    for field in &schema.fields {
        let ty = layout_type(field.ty).ok_or_else(|| {
            internal(format!(
                "the parameter '{}' of '{UNLIT}' has the type {}, which this temporary path does not lay out",
                field.name,
                field.ty.spelling()
            ))
        })?;
        members.push((field.name.to_owned(), ty));
    }
    compute(
        &LayoutType::new_struct(UNLIT, members),
        &material_layout_id(PRELUDE_PATH, UNLIT),
        &material_params_struct(PRELUDE_PATH, UNLIT),
    )
    .map_err(|e| {
        internal(format!(
            "the parameter block of '{UNLIT}' has no layout: {e}"
        ))
    })
}

/// `return mtek_params.u_color;`
fn unlit_fragment(record: &LayoutRecord, span: Span) -> Result<FragmentBody, Vec<Diagnostic>> {
    let LayoutNode::Struct { name, members, .. } = &record.root else {
        return Err(internal("the parameter block is not a struct"));
    };
    let color = members
        .iter()
        .find(|m| m.name == "color")
        .ok_or_else(|| internal(format!("'{UNLIT}' has no parameter 'color'")))?;
    let value = Expr::global(&params_global(record, span), span).field(
        crate::emit_wgsl::member_wgsl_name(name, &color.name),
        ShaderType::from_layout_node(&color.node),
        span,
    );
    Ok(FragmentBody {
        // `fragment(surface: SurfaceInput)` in the prelude; unused, as Unlit reads no field.
        surface_param: Name::user(UserNameKind::Param, "surface"),
        body: vec![Statement::Return {
            value: Some(value),
            span,
        }],
        symbol: format!("{}.fragment", unlit_symbol()),
        span,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::{ProjectPath, SourceMap};

    fn prelude_map(path: &str, text: &str) -> SourceMap {
        let mut sources = SourceMap::new();
        sources
            .add(
                ProjectPath::new("src/main.mtek").expect("path"),
                b"scene S {}\n",
            )
            .expect("added");
        sources
            .add(ProjectPath::new(path).expect("path"), text.as_bytes())
            .expect("added");
        sources
    }

    fn prelude_file(sources: &SourceMap) -> &SourceFile {
        sources.files().last().expect("the prelude file")
    }

    #[test]
    fn the_declaration_is_the_whole_unlit_item_of_the_prelude() {
        let text = prelude_text().expect("embedded prelude");
        let sources = prelude_map(PRELUDE_PATH, text);
        let file = prelude_file(&sources);
        let span = unlit_declaration(file).expect("found");
        assert_eq!(span.file, file.id());
        let declared = file.slice(span.start, span.end).expect("in the file");
        assert!(
            declared.starts_with("export material Unlit {"),
            "{declared}"
        );
        assert!(declared.ends_with('}'), "{declared}");
        assert!(!declared.contains("Pbr"), "{declared}");
    }

    #[test]
    fn the_param_declarations_are_found_in_the_prelude() {
        let text = prelude_text().expect("embedded prelude");
        let sources = prelude_map(PRELUDE_PATH, text);
        let file = prelude_file(&sources);
        let found = unlit_declarations(file).expect("found");
        assert_eq!(found.declaration, unlit_declaration(file).expect("found"));
        let names: Vec<&str> = found.params.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["color"]);
        let span = found.params[0].1;
        assert_eq!(
            file.slice(span.start, span.end),
            Some("param color: color = #ffffff;")
        );
    }

    #[test]
    fn the_param_block_comes_from_the_registry() {
        let record = unlit_params().expect("laid out");
        assert_eq!(record.id, "material:std/materials.mtek::Unlit");
        assert_eq!(record.wgsl_struct, "MtekParams_2b212d15_Unlit");
        assert_eq!((record.size, record.align), (16, 16));
        let LayoutNode::Struct { members, .. } = &record.root else {
            panic!("struct root");
        };
        let names: Vec<(&str, &str)> = members
            .iter()
            .map(|m| (m.name.as_str(), m.mtek_type.as_str()))
            .collect();
        assert_eq!(names, [("color", "color")]);
    }

    #[test]
    fn a_file_that_is_not_the_prelude_is_an_internal_error() {
        let sources = prelude_map("src/other.mtek", "export material Unlit {}\n");
        let diagnostics = unlit_shader(prelude_file(&sources)).expect_err("rejected");
        assert_eq!(diagnostics[0].code, Code::E9999);
        assert!(
            diagnostics[0].notes[0].contains("is not the embedded"),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn only_gpu_value_types_are_laid_out() {
        assert_eq!(layout_type(TypeRef::Color), Some(LayoutType::Color));
        assert_eq!(layout_type(TypeRef::Texture), None);
        assert_eq!(layout_type(TypeRef::String), None);
    }
}
