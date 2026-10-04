//! Materials (`spec/materials.md` sections 1–4, decision 0039): declarations,
//! their stage function, and instances of them.
//!
//! * **Params** (section 2). Each type must be GPU-representable — a scalar,
//!   vector, `mat4`, `quat`, `color`, or a struct or array of those (`E4030`;
//!   `texture` and `sampler` are gated to M4 by the resolver); a default must
//!   be a constant expression of the param's type (`E4031`), and a `color`
//!   default must be opaque (`E5100`); at most [`MAX_MATERIAL_PARAMS`] params
//!   (`E4032`). Params are checked in the dependency order of the constants
//!   (`consteval.rs`): a material after the constants and structs its params
//!   name, a constant after the materials its descriptor literals name.
//! * **The stage function** (section 3). Exactly one, `fragment(name:
//!   SurfaceInput) -> color` (`E4020` without one, `E4021` for another name
//!   or signature, `E2002` for a second one; `vertex` and `compute` are the
//!   parser's `E4901`). Its body is checked by the statement checker of
//!   `body.rs` with the params as read-only values in scope; the
//!   `SurfaceInput` fields it reads are recorded, and a body that uses the
//!   input other than by reading one of its fields reads all of them. The
//!   body's facts make it a GPU root of the program-wide pass
//!   ([`super::effects`]).
//! * **Captures** (`E4040`). A call of a `cpu fn` and a read of a constant
//!   whose type exists only on the CPU (a handle, a descriptor) are reported
//!   here; `self`, the CPU-only namespace values (`frame.time`) and the names
//!   of scene state, entities and cameras are the resolver's, because they
//!   never resolve to anything a stage could read.
//! * **Alpha** (section 3.2). A returned colour whose alpha is a constant
//!   other than 1.0 is `W5101`.
//! * **Instances** (section 4). A descriptor literal of a user material has
//!   the material's instance type; every param without a default must be
//!   given (`E5003`), unknown and duplicate names are `E5001`/`E5002`, values
//!   are checked exactly against the param types (`E3102`) and a constant
//!   `color` must be opaque (`E5100`). The literal folds to a
//!   [`ConstValue::Material`] holding every param in declaration order.

use std::collections::BTreeSet;

use super::body::StageState;
use super::check::{CallKind, Checker, FieldKind};
use super::consteval::Folded;
use super::facts::BodyFacts;
use super::ty::{MaterialKey, Ty, TyId};
use super::value::ConstValue;
use super::{MaterialInfo, MaterialParam, StageInfo};
use crate::diagnostics::{Code, Diagnostic};
use crate::project::edit_distance;
use crate::resolve::{DefId, DefKind, Res, STAGE_CAPTURE_NOTE};
use crate::source::Span;
use crate::stdlib::NamespaceMember;
use crate::syntax::ast::{
    DescField, Expr, ExprKind, FieldValue, Ident, MaterialDecl, MaterialMember, StageFn,
};

/// The most params one material may declare (`spec/diagnostics.md`, `E4032`).
pub const MAX_MATERIAL_PARAMS: usize = 64;

/// The one stage function of a v0.1 material.
const FRAGMENT: &str = "fragment";

/// The registry record a fragment stage receives.
const SURFACE_INPUT: &str = "SurfaceInput";

/// The name of the alpha parameter of the registry's colour constructors
/// (`color.linear(rgb, a)`), for `W5101`.
const ALPHA_PARAM: &str = "a";

/// The help of `E4030`.
const PARAM_TYPES: &str = "material params are bool, i32, u32, f32, vec2, vec3, vec4, mat4, quat, color, and structs and arrays of those (texture and sampler arrive in M4)";

fn strip_parens(expr: &Expr) -> &Expr {
    let mut expr = expr;
    while let ExprKind::Paren(inner) = &expr.kind {
        expr = inner;
    }
    expr
}

impl<'a> Checker<'a> {
    /// Remember a material declaration of the module and the block
    /// constants of its stage functions.
    pub(super) fn collect_material(&mut self, decl: &'a MaterialDecl) {
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        self.material_decls.insert(def, decl);
        for member in &decl.members {
            if let MaterialMember::Stage(stage) = member {
                self.collect_block_constants(&stage.body);
            }
        }
    }

    /// The constants and structs the params of `decl` name, for the
    /// dependency order of `consteval.rs`.
    pub(super) fn material_uses(&self, decl: &MaterialDecl, uses: &mut Vec<(DefId, Span)>) {
        for member in &decl.members {
            if let MaterialMember::Param(param) = member {
                self.annotation_uses(&param.ty, uses);
                if let Some(default) = &param.default {
                    self.constant_uses(default, uses);
                }
            }
        }
    }

    /// The identity of the material declared as `def` in this module.
    fn material_key(&self, def: DefId) -> Option<MaterialKey> {
        let declared = self.res.def(def)?;
        Some(MaterialKey {
            file: declared.span.file,
            def,
        })
    }

    /// Check the params of the material `def` once: their types (`E4030`),
    /// their number (`E4032`) and their defaults (`E4031`, `E5100`).
    pub(super) fn material_params(&mut self, def: DefId) {
        if !self.material_done.insert(def) {
            return;
        }
        let (Some(decl), Some(key)) = (
            self.material_decls.get(&def).copied(),
            self.material_key(def),
        ) else {
            return;
        };
        let material = decl.name.name.clone();
        self.out.interner.intern_material(key, &material);
        let mut params = Vec::new();
        let mut declared = Vec::new();
        for member in &decl.members {
            let MaterialMember::Param(param) = member else {
                continue;
            };
            if declared.len() == MAX_MATERIAL_PARAMS {
                self.sink.push(
                    Diagnostic::new(
                        Code::E4032,
                        format!(
                            "Material '{material}' declares more than {MAX_MATERIAL_PARAMS} params."
                        ),
                    )
                    .at(param.name.span)
                    .note(format!(
                        "a material has at most {MAX_MATERIAL_PARAMS} params; this is the {}th",
                        MAX_MATERIAL_PARAMS + 1
                    ))
                    .help("group related values into a struct or an array param"),
                );
            }
            let mut ty = self.annotation(&param.ty);
            if let Some(inner) = self.unrepresentable_part(ty) {
                let (shown, inner_shown) = (self.display(ty), self.display(inner));
                let contains = if inner == ty {
                    String::new()
                } else {
                    format!(" (it contains {inner_shown})")
                };
                self.sink.push(
                    Diagnostic::new(
                        Code::E4030,
                        format!(
                            "The param '{}' has type {shown}, which a material cannot hold{contains}.",
                            param.name.name
                        ),
                    )
                    .at(param.ty.span)
                    .note("params are uploaded to the GPU in the material's parameter block")
                    .help(PARAM_TYPES),
                );
                ty = TyId::ERROR;
            }
            let param_def = self.res.def_of(param.id);
            if let Some(param_def) = param_def {
                self.out.locals.insert(param_def, ty);
            }
            params.push(MaterialParam {
                name: param.name.name.clone(),
                def: param_def,
                ty,
                default: None,
                has_default: param.default.is_some(),
                name_span: param.name.span,
                span: param.span,
            });
            declared.push(param);
        }
        // Defaults after every type: a default naming another param is not
        // constant (`E4031`), not unknown.
        for (index, param) in declared.iter().enumerate() {
            let (Some(default), Some(ty)) = (&param.default, params.get(index).map(|p| p.ty))
            else {
                continue;
            };
            let value = self.param_default(&material, &param.name, ty, default);
            if let Some(slot) = params.get_mut(index) {
                slot.default = value;
            }
        }
        self.out.materials.insert(
            def,
            MaterialInfo {
                name: material,
                key,
                name_span: decl.name.span,
                span: decl.span,
                params,
                fragment: None,
            },
        );
    }

    /// The part of `ty` that a parameter block cannot hold (`ty` itself, or
    /// a field or element type), or `None`. `Error` is fine (reported).
    fn unrepresentable_part(&self, ty: TyId) -> Option<TyId> {
        let interner = &self.out.interner;
        let mut pending = vec![ty];
        let mut seen = BTreeSet::new();
        while let Some(current) = pending.pop() {
            if !seen.insert(current) {
                continue;
            }
            match interner.get(current) {
                Ty::Error
                | Ty::Bool
                | Ty::I32
                | Ty::U32
                | Ty::F32
                | Ty::Vec2
                | Ty::Vec3
                | Ty::Vec4
                | Ty::Mat4
                | Ty::Quat
                | Ty::Color
                // Resource params (M4); gated by the resolver in this build.
                | Ty::Texture
                | Ty::Sampler => {}
                Ty::Array { element, .. } => pending.push(element),
                Ty::Struct(_) => {
                    if let Some(def) = interner.struct_def(current) {
                        pending.extend(def.fields.iter().rev().map(|(_, field)| *field));
                    }
                }
                Ty::Unit
                | Ty::String
                | Ty::Mesh
                | Ty::Material
                | Ty::EntityRef
                | Ty::GlbAsset
                | Ty::Record(_)
                | Ty::Enum(_)
                | Ty::Schema(_)
                | Ty::Descriptor(_)
                | Ty::PrefabDescriptor
                | Ty::MaterialInstance(_) => return Some(current),
            }
        }
        None
    }

    /// Check the default of the param `name` of type `ty`: a constant
    /// expression of that type (`E4031`), opaque for a colour (`E5100`).
    fn param_default(
        &mut self,
        material: &str,
        name: &Ident,
        ty: TyId,
        default: &Expr,
    ) -> Option<ConstValue> {
        let error = self.out.interner.is_error(ty);
        let actual = self.check(default, (!error).then_some(ty));
        let folded = self.fold(default);
        if let Folded::NotConstant(reason) = &folded {
            // Whatever its type: a call of a user function is not typed
            // while params are checked (before function signatures), but it
            // is never constant.
            self.sink.push(
                Diagnostic::new(
                    Code::E4031,
                    format!(
                        "The default of the param '{}' is not a constant expression: {}.",
                        name.name, reason.reason
                    ),
                )
                .at(reason.span)
                .note("a default may use only literals, constants, operators, conversions, constructors and const-eligible built-in functions"),
            );
            return None;
        }
        if error || self.out.interner.is_error(actual) {
            return None;
        }
        if !self.out.interner.assignable(actual, ty) {
            let (expected, got) = (self.display(ty), self.display(actual));
            self.sink.push(
                Diagnostic::new(
                    Code::E4031,
                    format!(
                        "The default of the param '{}' must have type {expected}, but it has type {got}.",
                        name.name
                    ),
                )
                .at(default.span)
                .expected(expected)
                .actual(got),
            );
            return None;
        }
        match folded {
            Folded::Value(value) => {
                if let ConstValue::Color([_, _, _, alpha]) = value
                    && alpha != 1.0
                {
                    self.report_translucent(
                        default.span,
                        &format!(
                            "The default of the param '{}' of material {material}",
                            name.name
                        ),
                        alpha,
                    );
                    return None;
                }
                Some(value)
            }
            Folded::NotConstant(_) | Folded::Unknown => None,
        }
    }

    /// `E5100` for a constant colour of a material param with `alpha`.
    fn report_translucent(&mut self, span: Span, subject: &str, alpha: f32) {
        self.sink.push(
            Diagnostic::new(
                Code::E5100,
                format!("{subject} must be an opaque colour, but its alpha is {alpha:?}."),
            )
            .at(span)
            .note("colour parameters of materials must have alpha 1.0 in v0.1: transparency is not supported")
            .help("use a `#rrggbb` literal, or a vec4 for four components that are not a colour"),
        );
    }

    // ----- the stage function ----------------------------------------------

    /// Check the stage functions of a material (after every function
    /// signature, so its body's calls type).
    pub(super) fn material_stages(&mut self, decl: &MaterialDecl) {
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        self.material_params(def);
        let stages: Vec<&StageFn> = decl
            .members
            .iter()
            .filter_map(|member| match member {
                MaterialMember::Stage(stage) => Some(stage),
                _ => None,
            })
            .collect();
        let material = decl.name.name.clone();
        let Some(first) = stages.first() else {
            self.sink.push(
                Diagnostic::new(
                    Code::E4020,
                    format!("Material '{material}' has no fragment stage."),
                )
                .at(decl.name.span)
                .note("a material has exactly one stage function, `fragment`; the compiler supplies the vertex stage")
                .help("add `fragment(input: SurfaceInput) -> color { … }`"),
            );
            return;
        };
        let mut fragment = None;
        for (index, stage) in stages.iter().enumerate() {
            if index > 0 {
                self.sink.push(
                    Diagnostic::new(
                        Code::E2002,
                        format!(
                            "Duplicate stage function '{}': material '{material}' already has its stage function.",
                            stage.name.name
                        ),
                    )
                    .at(stage.name.span)
                    .related(first.name.span, "the stage function is declared here")
                    .note("a material has exactly one stage function, `fragment`"),
                );
            } else if stage.name.name != FRAGMENT {
                let mut diagnostic = Diagnostic::new(
                    Code::E4021,
                    format!(
                        "Unknown stage function '{}': the stage function of a material is `fragment`.",
                        stage.name.name
                    ),
                )
                .at(stage.name.span)
                .note("custom vertex and compute stages are planned for v0.2");
                if (1..=2).contains(&edit_distance(&stage.name.name, FRAGMENT)) {
                    diagnostic = diagnostic.help(format!("did you mean '{FRAGMENT}'?"));
                }
                self.sink.push(diagnostic);
            }
            let info = self.stage(&material, stage);
            if index == 0 {
                fragment = Some(info);
            }
        }
        if let Some(info) = self.out.materials.get_mut(&def) {
            info.fragment = fragment;
        }
    }

    /// Check one stage function: its signature (`E4021`) and its body.
    fn stage(&mut self, material: &str, stage: &StageFn) -> StageInfo {
        let surface_ty = self.out.interner.prelude_type(SURFACE_INPUT);
        let mut surface = None;
        let mut param_types = Vec::with_capacity(stage.params.len());
        for param in &stage.params {
            let ty = self.annotation(&param.ty);
            param_types.push(ty);
            if let Some(param_def) = self.res.def_of(param.id) {
                self.out.locals.insert(param_def, ty);
                if surface.is_none() && Some(ty) == surface_ty {
                    surface = Some(param_def);
                }
            }
        }
        let header = Span::new(
            stage.name.span.file,
            stage.name.span.start,
            stage
                .params
                .last()
                .map_or(stage.name.span.end, |p| p.span.end.saturating_add(1))
                .min(stage.body.span.start.max(stage.name.span.end)),
        );
        match (stage.params.as_slice(), param_types.as_slice()) {
            ([param], [ty]) => {
                if Some(*ty) != surface_ty && !self.out.interner.is_error(*ty) {
                    let shown = self.display(*ty);
                    self.sink.push(
                        Diagnostic::new(
                            Code::E4021,
                            format!(
                                "The parameter of the fragment stage of material '{material}' must have type SurfaceInput, but '{}' has type {shown}.",
                                param.name.name
                            ),
                        )
                        .at(param.ty.span)
                        .expected(SURFACE_INPUT)
                        .actual(shown)
                        .help("write `fragment(input: SurfaceInput) -> color`"),
                    );
                }
            }
            (params, _) => {
                self.sink.push(
                    Diagnostic::new(
                        Code::E4021,
                        format!(
                            "The fragment stage of material '{material}' takes exactly one parameter, of type SurfaceInput, but it declares {}.",
                            params.len()
                        ),
                    )
                    .at(header)
                    .help("write `fragment(input: SurfaceInput) -> color`"),
                );
            }
        }
        let ret = match &stage.ret {
            Some(ret) => {
                let ty = self.annotation(ret);
                if ty != TyId::COLOR && !self.out.interner.is_error(ty) {
                    let shown = self.display(ty);
                    self.sink.push(
                        Diagnostic::new(
                            Code::E4021,
                            format!(
                                "The fragment stage of material '{material}' must return color, but it is declared to return {shown}."
                            ),
                        )
                        .at(ret.span)
                        .expected("color")
                        .actual(shown)
                        .help("write `-> color`; the alpha of the result is ignored in v0.1"),
                    );
                }
                ty
            }
            None => {
                self.sink.push(
                    Diagnostic::new(
                        Code::E4021,
                        format!(
                            "The fragment stage of material '{material}' must return color, but it declares no result type."
                        ),
                    )
                    .at(header)
                    .help("add `-> color` after the parameter list"),
                );
                TyId::COLOR
            }
        };
        self.start_body(
            format!("The fragment stage of material '{material}'"),
            stage.name.name.clone(),
            ret,
            Some(StageState {
                material: material.to_owned(),
                surface,
                surface_uses: 0,
                surface_field_reads: 0,
                surface_reads: BTreeSet::new(),
            }),
        );
        let state = self.end_body(&stage.body, stage.ret.as_ref());
        let (facts, surface_inputs) = match state {
            Some(state) => {
                let inputs = state
                    .stage
                    .map(|stage| self.surface_inputs(&stage))
                    .unwrap_or_default();
                (state.facts, inputs)
            }
            None => (BodyFacts::default(), Vec::new()),
        };
        StageInfo {
            name_span: stage.name.span,
            span: stage.span,
            surface,
            surface_inputs,
            facts,
        }
    }

    /// The `SurfaceInput` fields a stage reads, in registry order: every
    /// field when the body uses the input other than by reading a field.
    fn surface_inputs(&self, stage: &StageState) -> Vec<&'static str> {
        let Some(record) = self.registry.type_def(SURFACE_INPUT) else {
            return Vec::new();
        };
        let all = stage.surface_uses > stage.surface_field_reads;
        record
            .fields
            .iter()
            .enumerate()
            .filter(|(index, _)| all || stage.surface_reads.contains(index))
            .map(|(_, field)| field.name)
            .collect()
    }

    /// Count a use of the `SurfaceInput` parameter of the stage being checked.
    pub(super) fn note_surface_use(&mut self, id: DefId) {
        if let Some(stage) = self.body.as_mut().and_then(|b| b.stage.as_mut())
            && stage.surface == Some(id)
        {
            stage.surface_uses += 1;
        }
    }

    /// `value.field` where `value` is a registry record (`input.uv`): the
    /// field's type; `E3023` for a field the record does not have.
    pub(super) fn record_field(
        &mut self,
        expr: &Expr,
        base: &Expr,
        record: &'static str,
        name: &Ident,
    ) -> TyId {
        let Some(def) = self.registry.type_def(record) else {
            return TyId::ERROR;
        };
        let Some((index, field)) = def
            .fields
            .iter()
            .enumerate()
            .find(|(_, f)| f.name == name.name)
        else {
            let names: Vec<&str> = def.fields.iter().map(|f| f.name).collect();
            let mut diagnostic = Diagnostic::new(
                Code::E3023,
                format!("The type {record} has no field '{}'.", name.name),
            )
            .at(name.span)
            .note(format!("the fields of {record} are {}", names.join(", ")));
            let close: Vec<&str> = names
                .iter()
                .copied()
                .filter(|candidate| (1..=2).contains(&edit_distance(&name.name, candidate)))
                .collect();
            if let [single] = close.as_slice() {
                diagnostic = diagnostic.help(format!("did you mean '{single}'?"));
            }
            self.sink.push(diagnostic);
            return TyId::ERROR;
        };
        self.fields.insert(
            expr.id,
            FieldKind::RecordField {
                field: field.name,
                index,
            },
        );
        let reads_input = match self.res.res(strip_parens(base).id) {
            Some(Res::Def(id)) => self
                .body
                .as_ref()
                .and_then(|b| b.stage.as_ref())
                .is_some_and(|s| s.surface == Some(id)),
            _ => false,
        };
        if reads_input
            && matches!(strip_parens(base).kind, ExprKind::Name(_))
            && let Some(stage) = self.body.as_mut().and_then(|b| b.stage.as_mut())
        {
            stage.surface_field_reads += 1;
            stage.surface_reads.insert(index);
        }
        self.out.interner.from_type_ref(field.ty)
    }

    /// `E4040` for a read of the constant `id` of type `ty` in a stage when
    /// the type exists only on the CPU (a handle or a descriptor).
    pub(super) fn note_stage_capture(&mut self, expr: &Expr, id: DefId, ty: TyId) {
        let Some(material) = self
            .body
            .as_ref()
            .and_then(|b| b.stage.as_ref())
            .map(|s| s.material.clone())
        else {
            return;
        };
        if self.out.interner.is_error(ty) || self.gpu_representable(ty) {
            return;
        }
        let Some(def) = self.res.def(id) else {
            return;
        };
        let (name, span, shown) = (def.name.clone(), def.span, self.display(ty));
        self.sink.push(
            Diagnostic::new(
                Code::E4040,
                format!(
                    "The fragment stage of material '{material}' cannot capture the constant '{name}': its type {shown} exists only on the CPU."
                ),
            )
            .at(expr.span)
            .related(span, format!("the constant '{name}' is declared here"))
            .note("stage code may read only its input, the material's params, and constants and `fn`s that exist on the GPU")
            .note(STAGE_CAPTURE_NOTE),
        );
    }

    /// `E4040` for a call of the `cpu fn` `id` in a stage.
    pub(super) fn note_stage_cpu_call(&mut self, expr: &Expr, id: DefId, name: &str) {
        let Some(material) = self
            .body
            .as_ref()
            .and_then(|b| b.stage.as_ref())
            .map(|s| s.material.clone())
        else {
            return;
        };
        let mut diagnostic = Diagnostic::new(
            Code::E4040,
            format!(
                "The fragment stage of material '{material}' calls the `cpu fn` '{name}': stage code runs on the GPU and may call only `fn`s."
            ),
        )
        .at(expr.span);
        if let Some(def) = self.res.def(id) {
            diagnostic = diagnostic.related(def.span, format!("'{name}' is declared `cpu fn`"));
        }
        self.sink.push(diagnostic.note(STAGE_CAPTURE_NOTE));
    }

    /// `W5101` for a value returned by a stage whose alpha is a constant other
    /// than 1.0: a constant colour, or a colour constructor with a constant
    /// alpha argument.
    pub(super) fn returned_alpha(&mut self, value: &Expr) {
        let Some(material) = self
            .body
            .as_ref()
            .and_then(|b| b.stage.as_ref())
            .map(|s| s.material.clone())
        else {
            return;
        };
        let inner = strip_parens(value);
        let alpha = match (self.out.value(inner.id), &inner.kind) {
            (Some(ConstValue::Color([_, _, _, alpha])), _) => Some((*alpha, inner.span)),
            (Some(_), _) => None,
            (None, ExprKind::Call { args, .. }) => self.constant_alpha_argument(inner, args),
            (None, _) => None,
        };
        let Some((alpha, span)) = alpha else {
            return;
        };
        if alpha == 1.0 {
            return;
        }
        self.sink.push(
            Diagnostic::new(
                Code::W5101,
                format!(
                    "The fragment stage of material '{material}' returns the alpha {alpha:?}, which is ignored: v0.1 always writes alpha 1.0."
                ),
            )
            .at(span)
            .note("materials are opaque in v0.1; a fractional alpha does not enable blending")
            .help("return an alpha of 1.0"),
        );
    }

    /// The constant alpha argument of a call of a registry colour
    /// constructor (the parameter named `a` of the overload called).
    fn constant_alpha_argument(&self, call: &Expr, args: &[Expr]) -> Option<(f32, Span)> {
        if self.ty_of(call.id) != Some(TyId::COLOR) {
            return None;
        }
        let function = match self.calls.get(&call.id)? {
            CallKind::Namespace {
                namespace, member, ..
            } => match self.registry.namespace_member(namespace, member)? {
                NamespaceMember::Function(function) => function,
                NamespaceMember::Value(_) => return None,
            },
            CallKind::Intrinsic { name, .. } => self.registry.intrinsic(name)?,
            _ => return None,
        };
        let position = function
            .signatures
            .iter()
            .filter(|sig| sig.params.len() == args.len())
            .find_map(|sig| sig.params.iter().position(|p| p.name == ALPHA_PARAM))?;
        let arg = args.get(position)?;
        match self.out.value(arg.id) {
            Some(ConstValue::F32(alpha)) => Some((*alpha, arg.span)),
            _ => None,
        }
    }

    // ----- instances -------------------------------------------------------

    /// The material a descriptor literal's name `id` denotes: a material of
    /// this module (its params checked) or an imported one.
    fn material_of(&mut self, id: DefId) -> Option<MaterialInfo> {
        match self.res.def(id)?.kind {
            DefKind::Material => {
                self.material_params(id);
                self.out.materials.get(&id).cloned()
            }
            DefKind::Import => self.imported_materials.get(&id).cloned(),
            _ => None,
        }
    }

    /// `Material { param: value; … }` (section 4): the material's instance
    /// type. Unknown (`E5001`), duplicate (`E5002`), missing (`E5003`) and
    /// mistyped (`E3102`) params are reported here; opacity when folding.
    pub(super) fn material_instance(
        &mut self,
        expr: &Expr,
        name: &Ident,
        id: DefId,
        fields: &[DescField],
    ) -> TyId {
        let Some(info) = self.material_of(id) else {
            for field in fields {
                if let FieldValue::Expr(value) = &field.value {
                    self.check(value, None);
                }
            }
            return TyId::ERROR;
        };
        let ty = self.out.interner.intern_material(info.key, &info.name);
        let mut ok = true;
        let mut unknown = false;
        let mut seen: Vec<(&str, Span)> = Vec::new();
        for field in fields {
            let param = info.param(&field.name.name);
            let value = match &field.value {
                FieldValue::Expr(value) => Some(&**value),
                // `bind(..)` is gated in this build (the resolver's `E9010`).
                FieldValue::Bind(_) => {
                    ok = false;
                    None
                }
            };
            if let Some((_, first)) = seen.iter().find(|(n, _)| *n == field.name.name) {
                self.sink.push(
                    Diagnostic::new(
                        Code::E5002,
                        format!(
                            "The param '{}' is set twice on material {}.",
                            field.name.name, info.name
                        ),
                    )
                    .at(field.name.span)
                    .related(*first, format!("'{}' is first set here", field.name.name))
                    .help("remove one of the two"),
                );
                if let Some(value) = value {
                    self.check(value, param.map(|p| p.ty));
                }
                ok = false;
                continue;
            }
            seen.push((field.name.name.as_str(), field.name.span));
            let Some(param) = param else {
                unknown = true;
                ok = false;
                self.unknown_param(&info, &field.name);
                if let Some(value) = value {
                    self.check(value, None);
                }
                continue;
            };
            let Some(value) = value else {
                continue;
            };
            let actual = self.check(value, Some(param.ty));
            if !self.out.interner.assignable(actual, param.ty) {
                ok = false;
                let (expected, got) = (self.display(param.ty), self.display(actual));
                let mut diagnostic = Diagnostic::new(
                    Code::E3102,
                    format!(
                        "Parameter '{}' of material {} expects {expected}, but received {got}.",
                        param.name, info.name
                    ),
                )
                .at(value.span)
                .expected(expected.clone())
                .actual(got.clone());
                let interner = &self.out.interner;
                if let (Some(want), Some(have)) =
                    (interner.vector_dim(param.ty), interner.vector_dim(actual))
                {
                    diagnostic = diagnostic.note(format!(
                        "a {expected} has {want} components; this value has {have}"
                    ));
                }
                self.sink.push(diagnostic);
            } else if self.out.interner.is_error(actual) || self.out.interner.is_error(param.ty) {
                ok = false;
            }
        }
        if !unknown {
            for param in &info.params {
                if !param.has_default && !seen.iter().any(|(n, _)| *n == param.name) {
                    ok = false;
                    self.sink.push(
                        Diagnostic::new(
                            Code::E5003,
                            format!(
                                "Missing required parameter '{}' on material {}.",
                                param.name, info.name
                            ),
                        )
                        .at(name.span)
                        .note(format!("the param '{}' has no default", param.name))
                        .help(format!("add `{}: …`", param.name)),
                    );
                }
            }
        }
        if ok {
            self.material_literals.insert(expr.id, info);
        }
        ty
    }

    /// `E5001` for a param the material does not declare.
    fn unknown_param(&mut self, info: &MaterialInfo, name: &Ident) {
        let names: Vec<&str> = info.params.iter().map(|p| p.name.as_str()).collect();
        let list = if names.is_empty() {
            "none".to_owned()
        } else {
            names.join(", ")
        };
        let mut diagnostic = Diagnostic::new(
            Code::E5001,
            format!(
                "Unknown parameter '{}' on material {}. Valid parameters: {list}.",
                name.name, info.name
            ),
        )
        .at(name.span);
        let close: Vec<&str> = names
            .iter()
            .copied()
            .filter(|candidate| (1..=2).contains(&edit_distance(&name.name, candidate)))
            .collect();
        if let [single] = close.as_slice() {
            diagnostic = diagnostic.help(format!("did you mean '{single}'?"));
        }
        self.sink.push(diagnostic);
    }

    /// Fold a material instance literal checked without errors: every param
    /// in declaration order, written or defaulted. A constant `color` value
    /// must be opaque (`E5100`); the reason each written value is not
    /// constant is recorded for the scene checks.
    pub(super) fn fold_material_literal(&mut self, expr: &Expr, fields: &[DescField]) -> Folded {
        let Some(info) = self.material_literals.get(&expr.id).cloned() else {
            return Folded::Unknown;
        };
        let mut written: Vec<(&str, Folded)> = Vec::with_capacity(fields.len());
        let mut rejected = false;
        for field in fields {
            let FieldValue::Expr(value) = &field.value else {
                continue;
            };
            let folded = self.fold(value);
            if let Folded::NotConstant(reason) = &folded {
                self.out.non_constant.insert(value.id, reason.clone());
            }
            if let (Folded::Value(ConstValue::Color([_, _, _, alpha])), Some(param)) =
                (&folded, info.param(&field.name.name))
                && param.ty == TyId::COLOR
                && *alpha != 1.0
            {
                let subject = format!("Parameter '{}' of material {}", param.name, info.name);
                self.report_translucent(value.span, &subject, *alpha);
                rejected = true;
            }
            written.push((field.name.name.as_str(), folded));
        }
        // The first value that is not constant, in source order.
        if let Some(reason) = written.iter().find_map(|(_, folded)| match folded {
            Folded::NotConstant(reason) => Some(reason.clone()),
            _ => None,
        }) {
            return Folded::NotConstant(reason);
        }
        let mut params = Vec::with_capacity(info.params.len());
        let mut unknown = rejected;
        for param in &info.params {
            let value = match written.iter().find(|(n, _)| *n == param.name) {
                Some((_, Folded::Value(value))) => Some(value.clone()),
                Some(_) => None,
                None => param.default.clone(),
            };
            match value {
                Some(value) => params.push((param.name.clone(), value)),
                None => unknown = true,
            }
        }
        if unknown {
            return Folded::Unknown;
        }
        Folded::Value(ConstValue::Material {
            material: info.key,
            name: info.name,
            params,
        })
    }
}
