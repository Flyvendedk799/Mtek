//! Asset declarations and `glb_asset` accessors in the checker (`spec/assets.md` section 2,
//! decision 0058).
//!
//! `asset.glb(..)`, `asset.texture(..)` and `asset.linear_texture(..)` are ordinary registry
//! functions for typing; in addition the checker hands the string literal to the asset host
//! ([`crate::assets::AssetHost`]), which reads and validates the file and reports `E7001`–`E7026`
//! at the literal. The accessors `CHAIR.mesh("Seat")` are typed from the registry's `glb_asset`
//! methods and evaluated while constants are folded, against the validated file. A `glb_asset`
//! value exists only to be a `const` and the receiver of an accessor (`E7022` otherwise).

use std::collections::BTreeMap;

use super::check::{CallKind, Checker};
use super::consteval::Folded;
use super::ty::TyId;
use super::value::ConstValue;
use crate::assets::access::{Accessed, Failure, evaluate_checked};
use crate::assets::{AssetHandle, AssetHost, AssetImage, AssetKind, ImageSource, ImageSpace};
use crate::diagnostics::{Code, Diagnostic, SuggestedEdit};
use crate::resolve::gate::{gate_message, gate_note, is_implemented};
use crate::resolve::{DefKind, PreludeItem, Res};
use crate::source::{ProjectPath, Span};
use crate::stdlib::{BuiltinSampler, BuiltinTexture};
use crate::syntax::ast::{Expr, ExprKind, Ident, NodeId};

/// What the checker needs to declare assets: the host and the declaring module's path.
pub(crate) struct AssetHookup<'a> {
    pub(crate) host: &'a mut dyn AssetHost,
    pub(crate) module: ProjectPath,
}

/// The checker's asset state.
#[derive(Default)]
pub(super) struct AssetState {
    /// The handle each `asset.*` call stands for.
    pub(super) declared: BTreeMap<NodeId, AssetHandle>,
    /// Nodes where a `glb_asset` is allowed: the initialiser of a constant and the receiver of
    /// an accessor.
    pub(super) glb_ok: std::collections::BTreeSet<NodeId>,
    /// Accessor calls whose failure was reported.
    pub(super) reported: std::collections::BTreeSet<NodeId>,
}

/// The `Pbr` instance of a glTF material: every parameter taken from the file.
fn material_value(
    base_color: [f32; 4],
    metallic: f32,
    roughness: f32,
    texture: ConstValue,
    sampler: BuiltinSampler,
) -> ConstValue {
    ConstValue::Struct {
        name: "Pbr".to_owned(),
        fields: vec![
            ("base_color".to_owned(), ConstValue::Color(base_color)),
            ("metallic".to_owned(), ConstValue::F32(metallic)),
            ("roughness".to_owned(), ConstValue::F32(roughness)),
            ("base_color_texture".to_owned(), texture),
            ("base_color_sampler".to_owned(), ConstValue::Sampler(sampler)),
        ],
    }
}

/// The texture constant of a glTF base colour texture, and the sampler it asks for.
fn texture_value(
    file: &str,
    texture: Option<crate::assets::GlbTexture>,
) -> (ConstValue, BuiltinSampler) {
    match texture {
        Some(texture) => (
            ConstValue::AssetTexture(AssetImage {
                source: ImageSource::Embedded {
                    glb: file.to_owned(),
                    image: texture.image,
                },
                space: ImageSpace::Srgb,
                mipmapped: texture.sampler.mipmapped,
            }),
            texture.sampler.builtin(),
        ),
        None => (
            ConstValue::Texture(BuiltinTexture::White),
            BuiltinSampler::LinearRepeat,
        ),
    }
}

/// The constant an accessor's value stands for.
pub(super) fn accessed_value(file: &str, accessed: Accessed) -> ConstValue {
    match accessed {
        Accessed::Mesh { mesh, primitive } => ConstValue::AssetMesh {
            file: file.to_owned(),
            mesh,
            primitive: u32::try_from(primitive).unwrap_or(u32::MAX),
        },
        Accessed::Color(c) => ConstValue::Color(c),
        Accessed::Scalar(v) => ConstValue::F32(v),
        Accessed::Vec3(v) => ConstValue::Vec3(v),
        Accessed::Quat(q) => ConstValue::Quat(q),
        Accessed::Texture(texture) => texture_value(file, texture).0,
        Accessed::Material {
            base_color,
            metallic,
            roughness,
            texture,
        } => {
            let (texture, sampler) = texture_value(file, texture);
            material_value(base_color, metallic, roughness, texture, sampler)
        }
    }
}

/// A string as an Mtek string literal, or `None` if it needs an escape the edit should not
/// invent.
fn string_literal(text: &str) -> Option<String> {
    if text.chars().any(|c| c.is_control() || c == '"' || c == '\\') {
        return None;
    }
    Some(format!("\"{text}\""))
}

impl Checker<'_> {
    /// `asset.glb(..)`, `asset.texture(..)`, `asset.linear_texture(..)`: typed as a registry
    /// function, then declared with the host.
    pub(super) fn asset_call(
        &mut self,
        expr: &Expr,
        callee: &Expr,
        member: &'static str,
        args: &[Expr],
    ) -> TyId {
        let ty = self.namespace_call(expr, callee, "asset", member, args);
        if !self.calls.contains_key(&expr.id) {
            return ty;
        }
        let Some(literal) = args.first() else {
            return ty;
        };
        let ExprKind::Str { value } = &literal.kind else {
            self.report(
                Diagnostic::new(
                    Code::E7022,
                    format!("The path of `asset.{member}` must be a string literal."),
                )
                .at(literal.span)
                .note("the compiler opens the file while it checks the program, so the path cannot be computed"),
            );
            return TyId::ERROR;
        };
        let kind = match member {
            "glb" => AssetKind::Glb,
            "texture" => AssetKind::Texture,
            _ => AssetKind::LinearTexture,
        };
        let Some(hookup) = self.assets.as_mut() else {
            return ty;
        };
        if let Some(handle) =
            hookup
                .host
                .declare(&hookup.module, kind, value, literal.span, self.sink)
        {
            self.asset_state.declared.insert(expr.id, handle);
        }
        ty
    }

    /// The value of a declaration call, after the host loaded the file.
    pub(super) fn fold_asset_declaration(&self, expr: &Expr) -> Folded {
        match self.asset_state.declared.get(&expr.id) {
            Some(AssetHandle::Glb { path }) => Folded::Value(ConstValue::GlbAsset(path.clone())),
            Some(AssetHandle::Image { path, space }) => {
                Folded::Value(ConstValue::AssetTexture(AssetImage {
                    source: ImageSource::File(path.clone()),
                    space: *space,
                    mipmapped: false,
                }))
            }
            None => Folded::Unknown,
        }
    }

    /// Whether `base` is the receiver of an accessor: a constant of type `glb_asset`, or a
    /// direct `asset.glb(..)` call.
    fn is_glb_receiver(&self, base: &Expr) -> bool {
        match &base.kind {
            ExprKind::Name(_) => match self.res.res(base.id) {
                Some(Res::Def(id)) => {
                    matches!(
                        self.res.def(id).map(|d| d.kind),
                        Some(DefKind::Const | DefKind::Import)
                    ) && self.out.consts.get(&id).map(|info| info.ty) == Some(TyId::GLB_ASSET)
                }
                _ => false,
            },
            ExprKind::Call { callee, .. } => match &callee.kind {
                ExprKind::Field { name, .. } => matches!(
                    self.res.res(name.id),
                    Some(Res::Prelude(PreludeItem::NamespaceMember {
                        namespace: "asset",
                        member: "glb"
                    }))
                ),
                _ => false,
            },
            _ => false,
        }
    }

    /// `receiver.method(args)` where the receiver is a `glb_asset`.
    pub(super) fn glb_accessor_call(
        &mut self,
        expr: &Expr,
        base: &Expr,
        name: &Ident,
        args: &[Expr],
    ) -> Option<TyId> {
        if !self.is_glb_receiver(base) {
            return None;
        }
        self.asset_state.glb_ok.insert(base.id);
        self.check(base, None);
        let Some(function) = self.registry.type_method("glb_asset", &name.name) else {
            self.synth_args(args);
            let accessors: Vec<&str> = self
                .registry
                .type_def("glb_asset")
                .map(|t| t.methods.iter().map(|m| m.name).collect())
                .unwrap_or_default();
            self.report(
                Diagnostic::new(
                    Code::E3001,
                    format!("A `glb_asset` has no accessor `{}`.", name.name),
                )
                .at(name.span)
                .note(format!("accessors: {}", accessors.join(", "))),
            );
            return Some(TyId::ERROR);
        };
        if !is_implemented(function.since) {
            self.synth_args(args);
            return Some(TyId::ERROR);
        }
        let full = format!("glb_asset.{}", function.name);
        self.record_builtin_call(expr.span, full.clone(), function);
        let kind = CallKind::GlbAccessor {
            method: function.name,
        };
        Some(self.function_call(expr, &full, function, args, kind, None))
    }

    /// Evaluate a recorded accessor call while folding.
    pub(super) fn fold_glb_accessor(
        &mut self,
        expr: &Expr,
        callee: &Expr,
        args: &[Expr],
        method: &'static str,
    ) -> Folded {
        let ExprKind::Field { base, .. } = &callee.kind else {
            return Folded::Unknown;
        };
        let file = match self.fold(base) {
            Folded::Value(ConstValue::GlbAsset(file)) => file,
            Folded::NotConstant(reason) => return Folded::NotConstant(reason),
            _ => return Folded::Unknown,
        };
        let folded_args: Vec<Folded> = args.iter().map(|arg| self.fold(arg)).collect();
        let name = match folded_args.first() {
            Some(Folded::Value(ConstValue::Str(name))) => name.clone(),
            Some(Folded::NotConstant(reason)) => return Folded::NotConstant(reason.clone()),
            _ => return Folded::Unknown,
        };
        let index = match folded_args.get(1) {
            Some(Folded::Value(ConstValue::U32(index))) => Some(*index),
            Some(Folded::NotConstant(reason)) => return Folded::NotConstant(reason.clone()),
            Some(_) => return Folded::Unknown,
            None => None,
        };
        if method == "material" && !is_implemented(self.pbr_since()) {
            let message = gate_message(
                "The built-in schema `Pbr`, which `glb_asset.material` produces,",
                false,
                self.pbr_since(),
            );
            if self.asset_state.reported.insert(expr.id) {
                self.report(
                    Diagnostic::new(Code::E9010, message)
                        .at(expr.span)
                        .note(gate_note()),
                );
            }
            return Folded::Unknown;
        }
        let Some(hookup) = self.assets.as_ref() else {
            return Folded::Unknown;
        };
        let Some(glb) = hookup.host.glb(&file) else {
            return Folded::Unknown;
        };
        match evaluate_checked(glb, method, &name, index) {
            Ok(accessed) => Folded::Value(accessed_value(&file, accessed)),
            Err(failure) => {
                if self.asset_state.reported.insert(expr.id) {
                    let (at, literal) = args.first().map_or((expr.span, false), |arg| {
                        (arg.span, matches!(arg.kind, ExprKind::Str { .. }))
                    });
                    self.report(accessor_diagnostic(&failure, at, literal));
                }
                Folded::Unknown
            }
        }
    }

    fn pbr_since(&self) -> crate::stdlib::Milestone {
        self.registry
            .schema("Pbr")
            .map_or(crate::stdlib::Milestone::M4, |schema| schema.since)
    }

    /// `E7022` for a `glb_asset` value where none is allowed.
    pub(super) fn misused_glb_asset(&mut self, expr: &Expr, ty: TyId) -> bool {
        if ty != TyId::GLB_ASSET || self.asset_state.glb_ok.contains(&expr.id) {
            return false;
        }
        self.report(
            Diagnostic::new(
                Code::E7022,
                "A `glb_asset` can only be stored in a `const` and used through its accessors.",
            )
            .at(expr.span)
            .note("write `CHAIR.mesh(\"Seat\")`, `CHAIR.material_roughness(\"Fabric\")` or `CHAIR.node_position(\"Seat\")` where the value is needed")
            .help("the model's hierarchy cannot be instanced as a whole in v0.1; each entity references one mesh"),
        );
        true
    }
}

/// The diagnostic of a failed accessor at the name argument.
fn accessor_diagnostic(failure: &Failure, at: Span, literal: bool) -> Diagnostic {
    let mut diagnostic = Diagnostic::new(failure.code, failure.message.clone()).at(at);
    for note in &failure.notes {
        diagnostic = diagnostic.note(note.clone());
    }
    if let Some(help) = &failure.help {
        diagnostic = diagnostic.help(help);
    }
    if let Some(rename) = &failure.rename
        && literal
        && let Some(text) = string_literal(rename)
    {
        diagnostic = diagnostic
            .edit(SuggestedEdit::new(format!("use the name '{rename}'")).replace(at, text));
    }
    diagnostic
}
