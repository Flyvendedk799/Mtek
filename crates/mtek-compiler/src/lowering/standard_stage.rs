//! The generated standard vertex stage and fragment wrapper (`spec/materials.md` sections
//! 3.2 and 3.3, `spec/gpu-layout.md` section 6) as shader IR.
//!
//! Every material gets the same two entry points, built from a [`MaterialDescription`]:
//!
//! - `mtek_vs` reads `position` (and `normal`, `uv` when used) from their fixed
//!   `@location`s, computes `world = object.model * vec4(position, 1)`,
//!   `clip = frame.view_proj * world` and, when `world_normal` is read,
//!   `normalize((object.normal_matrix * vec4(normal, 0)).xyz)`, and returns the clip
//!   position plus exactly the `SurfaceInput` fields the material reads as varyings at
//!   their fixed locations 0–3;
//! - `mtek_fs` rebuilds `SurfaceInput` from the varyings (re-normalising `world_normal`),
//!   calls the fragment body function `mtek_fragment` and writes
//!   `vec4(result.rgb, 1.0)` to colour target 0: alpha is always 1.0 in v0.1.
//!
//! Bindings are always `mtek_frame` (group 0), `mtek_params` (group 1, only when the
//! material has value params) and `mtek_object` (group 2), each at binding 0.
//!
//! All generated nodes carry the material declaration's span; the fragment body keeps the
//! spans its builder gave it.

use std::collections::BTreeSet;

use serde::Serialize;

use crate::layout::builtin::{mtek_frame, mtek_object};
use crate::layout::{LayoutError, LayoutRecord, compute};
use crate::source::Span;

use super::shader_ir::{
    BinaryOp, BuiltinValue, Component, Expr, FiniteF32, Function, FunctionParam, FunctionResult,
    GlobalDecl, GlobalKind, IoBinding, Name, ShaderModule, ShaderStage, ShaderType, Statement,
    StructDecl, StructMember,
};

/// The vertex entry point (`vertexEntry` of the manifest's shader entry).
pub const VERTEX_ENTRY: &str = "mtek_vs";
/// The fragment entry point (`fragmentEntry` of the manifest's shader entry).
pub const FRAGMENT_ENTRY: &str = "mtek_fs";
/// The struct `mtek_vs` returns and `mtek_fs` receives.
pub const VERTEX_OUTPUT_STRUCT: &str = "MtekVertexOutput";
/// The WGSL form of `SurfaceInput`, holding only the fields the material reads; its
/// members are named like the Mtek fields (`world_normal`).
pub const SURFACE_INPUT_STRUCT: &str = "MtekSurfaceInput";

/// A field of `SurfaceInput` (`spec/materials.md` section 3.1), ordered as the fixed
/// varying table of section 3.3. Serialised as the manifest's `surfaceInputs` items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceField {
    LocalPosition,
    WorldPosition,
    WorldNormal,
    Uv,
}

impl SurfaceField {
    /// Every field, in varying-location order.
    pub const ALL: [SurfaceField; 4] = [
        SurfaceField::LocalPosition,
        SurfaceField::WorldPosition,
        SurfaceField::WorldNormal,
        SurfaceField::Uv,
    ];

    /// The Mtek field name, also the WGSL member name.
    pub fn name(self) -> &'static str {
        match self {
            SurfaceField::LocalPosition => "local_position",
            SurfaceField::WorldPosition => "world_position",
            SurfaceField::WorldNormal => "world_normal",
            SurfaceField::Uv => "uv",
        }
    }

    /// The fixed `@location` of the field's varying.
    pub fn varying_location(self) -> u32 {
        match self {
            SurfaceField::LocalPosition => 0,
            SurfaceField::WorldPosition => 1,
            SurfaceField::WorldNormal => 2,
            SurfaceField::Uv => 3,
        }
    }

    /// The WGSL type of the field.
    pub fn ty(self) -> ShaderType {
        match self {
            SurfaceField::Uv => ShaderType::VEC2,
            _ => ShaderType::VEC3,
        }
    }
}

/// A vertex attribute of the fixed interface (`spec/materials.md` section 3.3), ordered as
/// the vertex-buffer slots. Serialised as the manifest's `vertexAttributes` items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VertexAttribute {
    Position,
    Normal,
    Uv,
}

impl VertexAttribute {
    /// The attribute name.
    pub fn name(self) -> &'static str {
        match self {
            VertexAttribute::Position => "position",
            VertexAttribute::Normal => "normal",
            VertexAttribute::Uv => "uv",
        }
    }

    /// The fixed `@location` (also the `shaderLocation` of the pipeline's vertex buffer).
    pub fn location(self) -> u32 {
        match self {
            VertexAttribute::Position => 0,
            VertexAttribute::Normal => 1,
            VertexAttribute::Uv => 2,
        }
    }

    /// The WebGPU vertex format.
    pub fn format(self) -> &'static str {
        match self {
            VertexAttribute::Position | VertexAttribute::Normal => "float32x3",
            VertexAttribute::Uv => "float32x2",
        }
    }

    /// The `arrayStride` of the attribute's own (non-interleaved) vertex buffer.
    pub fn array_stride(self) -> u32 {
        match self {
            VertexAttribute::Position | VertexAttribute::Normal => 12,
            VertexAttribute::Uv => 8,
        }
    }

    /// The WGSL type of the attribute.
    pub fn ty(self) -> ShaderType {
        match self {
            VertexAttribute::Uv => ShaderType::VEC2,
            _ => ShaderType::VEC3,
        }
    }

    /// The generated name of the vertex-stage parameter (`mtek_position`).
    fn param_name(self) -> Name {
        Name::generated(self.name())
    }
}

/// The present vertex attributes, in vertex-buffer slot order, for a material that reads
/// `inputs`: `position` always, `normal` if it reads `world_normal`, `uv` if it reads `uv`.
pub fn vertex_attributes(inputs: &BTreeSet<SurfaceField>) -> Vec<VertexAttribute> {
    let mut attributes = vec![VertexAttribute::Position];
    if inputs.contains(&SurfaceField::WorldNormal) {
        attributes.push(VertexAttribute::Normal);
    }
    if inputs.contains(&SurfaceField::Uv) {
        attributes.push(VertexAttribute::Uv);
    }
    attributes
}

/// The fragment body: the material's `fragment` function lowered to statements of a WGSL
/// function `mtek_fragment(<surface_param>: MtekSurfaceInput) -> vec4<f32>` (without
/// the parameter when the material reads no `SurfaceInput` field).
#[derive(Debug, Clone, PartialEq)]
pub struct FragmentBody {
    /// The name of the `SurfaceInput` parameter.
    pub surface_param: Name,
    pub body: Vec<Statement>,
    /// The symbol of the stage (`std/materials.mtek::Unlit.fragment`).
    pub symbol: String,
    pub span: Span,
}

/// What the standard stage needs to know about a material.
#[derive(Debug, Clone, PartialEq)]
pub struct MaterialDescription {
    /// The material symbol (`std/materials.mtek::Unlit`).
    pub symbol: String,
    /// The material declaration.
    pub declaration: Span,
    /// The `SurfaceInput` fields the fragment body reads.
    pub surface_inputs: BTreeSet<SurfaceField>,
    /// The value-param block, bound at group 1 binding 0; `None` without value params.
    pub params: Option<LayoutRecord>,
    pub fragment: FragmentBody,
    /// Further struct declarations the fragment body and its callees use (user structs and
    /// padded-element wrappers), each before its first use; declared after the param
    /// block's structs, skipping any the module already declares.
    pub structs: Vec<StructDecl>,
    /// Functions the fragment body calls, directly or through each other: the generated
    /// helpers and the user functions, each before its first caller; printed before
    /// `mtek_fragment`.
    pub functions: Vec<Function>,
}

/// A material's complete shader module and the facts the packager and the runtime need.
#[derive(Debug, Clone, PartialEq)]
pub struct MaterialShader {
    pub module: ShaderModule,
    /// Present vertex attributes in vertex-buffer slot order.
    pub vertex_attributes: Vec<VertexAttribute>,
    /// The `SurfaceInput` fields read, in varying-location order.
    pub surface_inputs: Vec<SurfaceField>,
    /// The parameter block's layout record (`None` without value params).
    pub layout: Option<LayoutRecord>,
}

/// `@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;`
pub fn frame_global(span: Span) -> GlobalDecl {
    uniform("frame", 0, "MtekFrame", span)
}

/// `@group(1) @binding(0) var<uniform> mtek_params: <record.wgsl_struct>;`
pub fn params_global(record: &LayoutRecord, span: Span) -> GlobalDecl {
    uniform("params", 1, &record.wgsl_struct, span)
}

/// `@group(2) @binding(0) var<uniform> mtek_object: MtekObject;`
pub fn object_global(span: Span) -> GlobalDecl {
    uniform("object", 2, "MtekObject", span)
}

fn uniform(name: &str, group: u32, struct_name: &str, span: Span) -> GlobalDecl {
    GlobalDecl {
        name: Name::generated(name),
        kind: GlobalKind::Uniform {
            group,
            binding: 0,
            ty: ShaderType::named(struct_name),
        },
        span,
    }
}

/// Builds the module of a material: the frame, params and object blocks, the stage IO
/// structs, the three bindings, the fragment body function and the two entry points.
///
/// # Errors
/// A [`LayoutError`] if a built-in block cannot be laid out (a compiler defect).
pub fn build_standard_stage(material: &MaterialDescription) -> Result<MaterialShader, LayoutError> {
    let span = material.declaration;
    let symbol = material.symbol.as_str();
    let inputs: Vec<SurfaceField> = material.surface_inputs.iter().copied().collect();
    let attributes = vertex_attributes(&material.surface_inputs);

    let frame_record = compute(&mtek_frame(), "builtin:frame", "MtekFrame")?;
    let object_record = compute(&mtek_object(), "builtin:object", "MtekObject")?;

    let mut module = ShaderModule::new(symbol, span);
    module.declare_block(&frame_record, span);
    if let Some(params) = &material.params {
        module.declare_block(params, span);
    }
    for decl in &material.structs {
        if !module.structs.iter().any(|s| s.name == decl.name) {
            module.structs.push(decl.clone());
        }
    }
    module.declare_block(&object_record, span);
    module.structs.push(vertex_output_struct(&inputs, span));
    if !inputs.is_empty() {
        module.structs.push(surface_input_struct(&inputs, span));
    }

    let frame = frame_global(span);
    let object = object_global(span);
    module.globals.push(frame.clone());
    if let Some(params) = &material.params {
        module.globals.push(params_global(params, span));
    }
    module.globals.push(object.clone());

    module.functions.extend(material.functions.iter().cloned());
    module
        .functions
        .push(fragment_function(material, !inputs.is_empty()));
    module.functions.push(vertex_entry(
        &frame,
        &object,
        &attributes,
        &inputs,
        symbol,
        span,
    ));
    module.functions.push(fragment_entry(&inputs, symbol, span));

    Ok(MaterialShader {
        module,
        vertex_attributes: attributes,
        surface_inputs: inputs,
        layout: material.params.clone(),
    })
}

fn io_member(name: &str, ty: ShaderType, binding: IoBinding, span: Span) -> StructMember {
    StructMember {
        name: name.to_owned(),
        ty,
        align: None,
        size: None,
        binding: Some(binding),
        span,
    }
}

/// `struct MtekVertexOutput { @builtin(position) clip_position, @location(k) <field> }`.
fn vertex_output_struct(inputs: &[SurfaceField], span: Span) -> StructDecl {
    let mut members = vec![io_member(
        "clip_position",
        ShaderType::VEC4,
        IoBinding::Builtin(BuiltinValue::Position),
        span,
    )];
    members.extend(inputs.iter().map(|field| {
        io_member(
            field.name(),
            field.ty(),
            IoBinding::Location(field.varying_location()),
            span,
        )
    }));
    StructDecl {
        name: VERTEX_OUTPUT_STRUCT.to_owned(),
        members,
        span,
    }
}

/// `struct MtekSurfaceInput { <field>: <type>, ... }` for the fields read.
fn surface_input_struct(inputs: &[SurfaceField], span: Span) -> StructDecl {
    StructDecl {
        name: SURFACE_INPUT_STRUCT.to_owned(),
        members: inputs
            .iter()
            .map(|field| StructMember {
                name: field.name().to_owned(),
                ty: field.ty(),
                align: None,
                size: None,
                binding: None,
                span,
            })
            .collect(),
        span,
    }
}

/// `fn mtek_fragment([surface: MtekSurfaceInput]) -> vec4<f32> { body }`.
fn fragment_function(material: &MaterialDescription, takes_surface: bool) -> Function {
    let fragment = &material.fragment;
    let params = if takes_surface {
        vec![FunctionParam {
            name: fragment.surface_param.clone(),
            ty: ShaderType::named(SURFACE_INPUT_STRUCT),
            binding: None,
            span: fragment.span,
        }]
    } else {
        Vec::new()
    };
    Function {
        name: Name::generated("fragment"),
        stage: None,
        params,
        result: Some(FunctionResult {
            ty: ShaderType::VEC4,
            binding: None,
        }),
        body: fragment.body.clone(),
        symbol: fragment.symbol.clone(),
        span: fragment.span,
    }
}

const XYZ: [Component; 3] = [Component::X, Component::Y, Component::Z];

/// `mtek_vs`: the standard vertex entry point.
fn vertex_entry(
    frame: &GlobalDecl,
    object: &GlobalDecl,
    attributes: &[VertexAttribute],
    inputs: &[SurfaceField],
    symbol: &str,
    span: Span,
) -> Function {
    let attribute = |a: VertexAttribute| Expr::local(a.param_name(), a.ty(), span);
    let world_name = Name::generated("world");
    let world_normal_name = Name::generated("world_normal");
    let world = || Expr::local(world_name.clone(), ShaderType::VEC4, span);

    // let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mut body = vec![Statement::Let {
        name: world_name.clone(),
        value: Expr::binary(
            BinaryOp::Multiply,
            Expr::global(object, span).field("model", ShaderType::Mat4, span),
            Expr::construct(
                ShaderType::VEC4,
                vec![
                    attribute(VertexAttribute::Position),
                    Expr::f32(FiniteF32::ONE, span),
                ],
                span,
            ),
            ShaderType::VEC4,
            span,
        ),
        span,
    }];
    if inputs.contains(&SurfaceField::WorldNormal) {
        // let mtek_world_normal =
        //     normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
        body.push(Statement::Let {
            name: world_normal_name.clone(),
            value: Expr::binary(
                BinaryOp::Multiply,
                Expr::global(object, span).field("normal_matrix", ShaderType::Mat4, span),
                Expr::construct(
                    ShaderType::VEC4,
                    vec![
                        attribute(VertexAttribute::Normal),
                        Expr::f32(FiniteF32::ZERO, span),
                    ],
                    span,
                ),
                ShaderType::VEC4,
                span,
            )
            .swizzle(&XYZ, span)
            .normalize(span),
            span,
        });
    }

    // return MtekVertexOutput(mtek_frame.view_proj * mtek_world, <varyings>);
    let clip = Expr::binary(
        BinaryOp::Multiply,
        Expr::global(frame, span).field("view_proj", ShaderType::Mat4, span),
        world(),
        ShaderType::VEC4,
        span,
    );
    let mut fields = vec![clip];
    fields.extend(inputs.iter().map(|field| match field {
        SurfaceField::LocalPosition => attribute(VertexAttribute::Position),
        SurfaceField::WorldPosition => world().swizzle(&XYZ, span),
        SurfaceField::WorldNormal => Expr::local(world_normal_name.clone(), ShaderType::VEC3, span),
        SurfaceField::Uv => attribute(VertexAttribute::Uv),
    }));
    body.push(Statement::Return {
        value: Some(Expr::construct(
            ShaderType::named(VERTEX_OUTPUT_STRUCT),
            fields,
            span,
        )),
        span,
    });

    Function {
        name: Name::generated("vs"),
        stage: Some(ShaderStage::Vertex),
        params: attributes
            .iter()
            .map(|a| FunctionParam {
                name: a.param_name(),
                ty: a.ty(),
                binding: Some(IoBinding::Location(a.location())),
                span,
            })
            .collect(),
        result: Some(FunctionResult {
            ty: ShaderType::named(VERTEX_OUTPUT_STRUCT),
            binding: None,
        }),
        body,
        symbol: symbol.to_owned(),
        span,
    }
}

/// `mtek_fs`: the fragment wrapper.
fn fragment_entry(inputs: &[SurfaceField], symbol: &str, span: Span) -> Function {
    let input_name = Name::generated("in");
    let surface_name = Name::generated("surface");
    let color_name = Name::generated("color");
    let mut body = Vec::new();
    let mut params = Vec::new();
    let mut call_args = Vec::new();
    if !inputs.is_empty() {
        params.push(FunctionParam {
            name: input_name.clone(),
            ty: ShaderType::named(VERTEX_OUTPUT_STRUCT),
            binding: None,
            span,
        });
        // let mtek_surface = MtekSurfaceInput(mtek_in.<field>, ..);
        let fields = inputs
            .iter()
            .map(|field| {
                let varying = Expr::local(
                    input_name.clone(),
                    ShaderType::named(VERTEX_OUTPUT_STRUCT),
                    span,
                )
                .field(field.name(), field.ty(), span);
                if *field == SurfaceField::WorldNormal {
                    varying.normalize(span)
                } else {
                    varying
                }
            })
            .collect();
        body.push(Statement::Let {
            name: surface_name.clone(),
            value: Expr::construct(ShaderType::named(SURFACE_INPUT_STRUCT), fields, span),
            span,
        });
        call_args.push(Expr::local(
            surface_name,
            ShaderType::named(SURFACE_INPUT_STRUCT),
            span,
        ));
    }
    // let mtek_color = mtek_fragment(..);
    body.push(Statement::Let {
        name: color_name.clone(),
        value: Expr::call(
            Name::generated("fragment"),
            call_args,
            ShaderType::VEC4,
            span,
        ),
        span,
    });
    // return vec4<f32>(mtek_color.xyz, 1.0);
    body.push(Statement::Return {
        value: Some(Expr::construct(
            ShaderType::VEC4,
            vec![
                Expr::local(color_name, ShaderType::VEC4, span).swizzle(&XYZ, span),
                Expr::f32(FiniteF32::ONE, span),
            ],
            span,
        )),
        span,
    });
    Function {
        name: Name::generated("fs"),
        stage: Some(ShaderStage::Fragment),
        params,
        result: Some(FunctionResult {
            ty: ShaderType::VEC4,
            binding: Some(IoBinding::Location(0)),
        }),
        body,
        symbol: symbol.to_owned(),
        span,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emit_wgsl::printer::mangle;
    use crate::emit_wgsl::{print_module, validate_wgsl};
    use crate::layout::{LayoutType, material_layout_id, material_params_struct};
    use crate::source::FileId;

    const SYMBOL: &str = "src/main.mtek::Probe";

    fn declaration() -> Span {
        Span::new(FileId(0), 10, 90)
    }

    fn params_record() -> LayoutRecord {
        compute(
            &LayoutType::new_struct(
                "Probe",
                vec![
                    ("tint".to_owned(), LayoutType::Color),
                    ("phase".to_owned(), LayoutType::F32),
                ],
            ),
            &material_layout_id("src/main.mtek", "Probe"),
            &material_params_struct("src/main.mtek", "Probe"),
        )
        .expect("valid layout")
    }

    /// A material reading `inputs`; its body reads every field it declares as read and
    /// returns a constant colour.
    fn material(inputs: &[SurfaceField], params: Option<LayoutRecord>) -> MaterialDescription {
        let span = declaration();
        let surface = Name::generated("probe_surface");
        let mut body: Vec<Statement> = inputs
            .iter()
            .map(|field| Statement::Let {
                name: Name::generated(format!("read_{}", field.name())),
                value: Expr::local(
                    surface.clone(),
                    ShaderType::named(SURFACE_INPUT_STRUCT),
                    span,
                )
                .field(field.name(), field.ty(), span),
                span,
            })
            .collect();
        let one = || Expr::f32(FiniteF32::ONE, span);
        body.push(Statement::Return {
            value: Some(Expr::construct(
                ShaderType::VEC4,
                vec![one(), one(), one(), one()],
                span,
            )),
            span,
        });
        MaterialDescription {
            symbol: SYMBOL.to_owned(),
            declaration: span,
            surface_inputs: inputs.iter().copied().collect(),
            params,
            fragment: FragmentBody {
                surface_param: surface,
                body,
                symbol: format!("{SYMBOL}.fragment"),
                span,
            },
            structs: Vec::new(),
            functions: Vec::new(),
        }
    }

    /// Every subset of `SurfaceField::ALL`.
    fn subsets() -> Vec<Vec<SurfaceField>> {
        (0u32..16)
            .map(|mask| {
                SurfaceField::ALL
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| mask & (1 << i) != 0)
                    .map(|(_, f)| *f)
                    .collect()
            })
            .collect()
    }

    fn location(binding: &Option<naga::Binding>) -> Option<u32> {
        match binding {
            Some(naga::Binding::Location { location, .. }) => Some(*location),
            _ => None,
        }
    }

    #[test]
    fn entry_names_are_the_mangled_generated_names() {
        assert_eq!(mangle(&Name::generated("vs")), VERTEX_ENTRY);
        assert_eq!(mangle(&Name::generated("fs")), FRAGMENT_ENTRY);
    }

    #[test]
    fn attributes_follow_the_fixed_interface() {
        let attrs: Vec<_> = [
            VertexAttribute::Position,
            VertexAttribute::Normal,
            VertexAttribute::Uv,
        ]
        .iter()
        .map(|a| (a.name(), a.location(), a.format(), a.array_stride()))
        .collect();
        assert_eq!(
            attrs,
            [
                ("position", 0, "float32x3", 12),
                ("normal", 1, "float32x3", 12),
                ("uv", 2, "float32x2", 8),
            ]
        );
        let varyings: Vec<_> = SurfaceField::ALL
            .iter()
            .map(|f| (f.name(), f.varying_location()))
            .collect();
        assert_eq!(
            varyings,
            [
                ("local_position", 0),
                ("world_position", 1),
                ("world_normal", 2),
                ("uv", 3)
            ]
        );
        assert_eq!(
            serde_json::to_string(&SurfaceField::ALL).expect("serialisable"),
            r#"["local_position","world_position","world_normal","uv"]"#
        );
        assert_eq!(
            serde_json::to_string(&[VertexAttribute::Position, VertexAttribute::Uv])
                .expect("serialisable"),
            r#"["position","uv"]"#
        );
    }

    #[test]
    fn every_surface_input_combination_validates_with_the_fixed_interface() {
        for inputs in subsets() {
            let shader = build_standard_stage(&material(&inputs, Some(params_record())))
                .expect("built-in layouts");
            let text = print_module(&shader.module).text;
            let naga = validate_wgsl(&text).unwrap_or_else(|e| panic!("{inputs:?}: {e}\n{text}"));

            // Vertex attributes: position always, normal iff world_normal, uv iff uv.
            let set: BTreeSet<SurfaceField> = inputs.iter().copied().collect();
            let mut expected = vec![VertexAttribute::Position];
            if set.contains(&SurfaceField::WorldNormal) {
                expected.push(VertexAttribute::Normal);
            }
            if set.contains(&SurfaceField::Uv) {
                expected.push(VertexAttribute::Uv);
            }
            assert_eq!(shader.vertex_attributes, expected, "{inputs:?}");
            assert_eq!(shader.surface_inputs, inputs);

            let vs = naga
                .entry_points
                .iter()
                .find(|e| e.name == VERTEX_ENTRY)
                .expect("vertex entry");
            assert_eq!(vs.stage, naga::ShaderStage::Vertex);
            let attribute_locations: Vec<Option<u32>> = vs
                .function
                .arguments
                .iter()
                .map(|a| location(&a.binding))
                .collect();
            let expected_locations: Vec<Option<u32>> =
                expected.iter().map(|a| Some(a.location())).collect();
            assert_eq!(attribute_locations, expected_locations, "{inputs:?}");

            // Varyings: exactly the fields read, at their fixed locations.
            let output = vs.function.result.as_ref().expect("vertex result");
            let naga::TypeInner::Struct { members, .. } = &naga.types[output.ty].inner else {
                panic!("the vertex result is a struct");
            };
            let varyings: Vec<(Option<String>, Option<u32>)> = members
                .iter()
                .filter_map(|m| location(&m.binding).map(|l| (m.name.clone(), Some(l))))
                .collect();
            let expected_varyings: Vec<(Option<String>, Option<u32>)> = inputs
                .iter()
                .map(|f| (Some(f.name().to_owned()), Some(f.varying_location())))
                .collect();
            assert_eq!(varyings, expected_varyings, "{inputs:?}");
            assert!(matches!(
                members[0].binding,
                Some(naga::Binding::BuiltIn(naga::BuiltIn::Position { .. }))
            ));

            let fs = naga
                .entry_points
                .iter()
                .find(|e| e.name == FRAGMENT_ENTRY)
                .expect("fragment entry");
            assert_eq!(fs.stage, naga::ShaderStage::Fragment);
            let result = fs.function.result.as_ref().expect("fragment result");
            assert_eq!(location(&result.binding), Some(0));
            assert_eq!(fs.function.arguments.len(), usize::from(!inputs.is_empty()));
        }
    }

    #[test]
    fn bindings_follow_the_fixed_binding_plan() {
        for params in [Some(params_record()), None] {
            let shader = build_standard_stage(&material(&[], params.clone())).expect("built");
            let naga = validate_wgsl(&print_module(&shader.module).text).expect("valid");
            let mut bindings: Vec<(String, u32, u32, String)> = naga
                .global_variables
                .iter()
                .filter_map(|(_, g)| {
                    let binding = g.binding.as_ref()?;
                    let ty = naga.types[g.ty].name.clone().unwrap_or_default();
                    Some((
                        g.name.clone().unwrap_or_default(),
                        binding.group,
                        binding.binding,
                        ty,
                    ))
                })
                .collect();
            bindings.sort_by_key(|b| b.1);
            let mut expected = vec![("mtek_frame".to_owned(), 0, 0, "MtekFrame".to_owned())];
            if params.is_some() {
                expected.push((
                    "mtek_params".to_owned(),
                    1,
                    0,
                    material_params_struct("src/main.mtek", "Probe"),
                ));
            }
            expected.push(("mtek_object".to_owned(), 2, 0, "MtekObject".to_owned()));
            assert_eq!(bindings, expected);
            assert!(
                naga.global_variables
                    .iter()
                    .all(|(_, g)| g.space == naga::AddressSpace::Uniform || g.binding.is_none())
            );
            assert_eq!(shader.layout, params);
        }
    }

    #[test]
    fn the_wrapper_writes_alpha_one_and_renormalises_the_world_normal() {
        let shader = build_standard_stage(&material(&SurfaceField::ALL, None)).expect("built");
        let text = print_module(&shader.module).text;
        assert!(
            text.contains("    return vec4<f32>(mtek_color.xyz, 1.0);\n"),
            "{text}"
        );
        assert!(
            text.contains(
                "    let mtek_surface = MtekSurfaceInput(mtek_in.local_position, \
                 mtek_in.world_position, normalize(mtek_in.world_normal), mtek_in.uv);\n"
            ),
            "{text}"
        );
        assert!(
            text.contains(
                "    let mtek_world_normal = normalize((mtek_object.normal_matrix * \
                 vec4<f32>(mtek_normal, 0.0)).xyz);\n"
            ),
            "{text}"
        );
        assert!(
            text.contains(
                "    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, \
                 mtek_position, mtek_world.xyz, mtek_world_normal, mtek_uv);\n"
            ),
            "{text}"
        );
    }

    #[test]
    fn generated_code_carries_the_declaration_span() {
        let shader = build_standard_stage(&material(&SurfaceField::ALL, Some(params_record())))
            .expect("built");
        let printed = print_module(&shader.module);
        assert!(!printed.span_map.entries.is_empty());
        assert!(
            printed
                .span_map
                .entries
                .iter()
                .all(|e| e.span == declaration())
        );
        let symbols: BTreeSet<&str> = printed
            .span_map
            .entries
            .iter()
            .map(|e| e.symbol.as_str())
            .collect();
        assert_eq!(
            symbols,
            BTreeSet::from([SYMBOL, "src/main.mtek::Probe.fragment"])
        );
    }
}
