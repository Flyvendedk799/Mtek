//! Bounded source compute checking. Builds checked resource/kernel metadata;
//! an explicit E4901 build gate remains until packaging/runtime dispatch exists.

use std::collections::BTreeSet;

use super::body::StageState;
use super::check::Checker;
use super::consteval::Folded;
use super::{
    ComputeBuffer, ComputeInfo, ConstValue, MaterialParam, StageInfo, Ty, TyId, TyInterner,
};
use crate::diagnostics::{Code, Diagnostic};
use crate::layout::{LayoutType, compute, storage_array};
use crate::resolve::{DefKind, PreludeItem, Res};
use crate::syntax::ast::{
    ArrayLength, ArrayLengthKind, ComputeDecl, ComputeMember, FieldValue, StageFn, StorageDecl,
    TypeKind,
};

pub const MAX_STORAGE_BYTES: u32 = 16 * 1024 * 1024;
pub const MAX_INPUT_BUFFERS: usize = 4;
const MAX_LAYOUT_NODES: usize = 16_384;

fn layout_type(types: &TyInterner, ty: TyId) -> Option<LayoutType> {
    let mut remaining = MAX_LAYOUT_NODES;
    layout_type_bounded(types, ty, &mut remaining)
}

fn layout_type_bounded(types: &TyInterner, ty: TyId, remaining: &mut usize) -> Option<LayoutType> {
    *remaining = remaining.checked_sub(1)?;
    Some(match types.get(ty) {
        Ty::Bool => LayoutType::Bool,
        Ty::I32 => LayoutType::I32,
        Ty::U32 => LayoutType::U32,
        Ty::F32 => LayoutType::F32,
        Ty::Vec2 => LayoutType::Vec2,
        Ty::Vec3 => LayoutType::Vec3,
        Ty::Vec4 => LayoutType::Vec4,
        Ty::Color => LayoutType::Color,
        Ty::Quat => LayoutType::Quat,
        Ty::Mat4 => LayoutType::Mat4,
        Ty::Array { element, len } => {
            LayoutType::new_array(layout_type_bounded(types, element, remaining)?, len)
        }
        Ty::Struct(_) => {
            let record = types.struct_def(ty)?;
            LayoutType::new_struct(
                types.display(ty),
                record
                    .fields
                    .iter()
                    .map(|(name, field)| {
                        Some((name.clone(), layout_type_bounded(types, *field, remaining)?))
                    })
                    .collect::<Option<Vec<_>>>()?,
            )
        }
        _ => return None,
    })
}

impl<'a> Checker<'a> {
    pub(super) fn compute_program(&mut self, decl: &ComputeDecl) {
        let Some(def) = self.res.def_of(decl.id) else {
            return;
        };
        let mut info = ComputeInfo {
            name: decl.name.name.clone(),
            name_span: decl.name.span,
            span: decl.span,
            params: vec![],
            inputs: vec![],
            output: None,
            kernel: None,
            workgroup_size: [64, 1, 1],
        };
        let mut uniform_fields = Vec::new();
        for member in &decl.members {
            match member {
                ComputeMember::Param(param) => {
                    let ty = self.annotation(&param.ty);
                    if let Some(def) = self.res.def_of(param.id) {
                        self.out.locals.insert(def, ty);
                    }
                    if let Some(layout) = layout_type(&self.out.interner, ty) {
                        uniform_fields.push((param.name.name.clone(), layout));
                    } else if !self.is_error(ty) {
                        self.report(Diagnostic::new(Code::E4051, "Compute params must be GPU-storable values with at most 16,384 expanded layout nodes; resources and input records are not uniform values.").at(param.ty.span));
                    }
                    let default = param.default.as_ref().and_then(|expr| {
                        let actual = self.check(expr, Some(ty));
                        if !self.assignable(actual, ty) {
                            self.report(
                                Diagnostic::new(
                                    Code::E4031,
                                    "The compute parameter default has the wrong type.",
                                )
                                .at(expr.span)
                                .expected(self.display(ty))
                                .actual(self.display(actual)),
                            );
                            return None;
                        }
                        match self.fold(expr) {
                            Folded::Value(value) => Some(value),
                            _ => {
                                self.report(
                                    Diagnostic::new(
                                        Code::E4031,
                                        "A compute parameter default must be constant.",
                                    )
                                    .at(expr.span),
                                );
                                None
                            }
                        }
                    });
                    info.params.push(MaterialParam {
                        name: param.name.name.clone(),
                        def: self.res.def_of(param.id),
                        ty,
                        default,
                        has_default: param.default.is_some(),
                        name_span: param.name.span,
                        span: param.span,
                    });
                }
                ComputeMember::Input(buffer) => {
                    if let Some(buffer) = self.compute_buffer(buffer) {
                        info.inputs.push(buffer);
                    }
                }
                ComputeMember::Output(buffer) => {
                    let checked = self.compute_buffer(buffer);
                    if info.output.is_some() {
                        self.report(
                            Diagnostic::new(
                                Code::E4050,
                                "A compute program declares exactly one output buffer.",
                            )
                            .at(buffer.name.span),
                        );
                    } else {
                        info.output = checked;
                    }
                }
                _ => {}
            }
        }
        if info.params.len() > 64 {
            self.report(
                Diagnostic::new(
                    Code::E4051,
                    "A compute program supports at most 64 uniform parameters.",
                )
                .at(decl.name.span),
            );
        }
        if !uniform_fields.is_empty() {
            match compute(&LayoutType::new_struct("ComputeParams", uniform_fields), "compute:params", "MtekComputeParams") {
                Ok(layout) if layout.size <= 65_536 => {},
                _ => self.report(Diagnostic::new(Code::E4051, "The compute uniform parameter block exceeds its 65,536-byte layout budget.").at(decl.name.span)),
            }
        }
        if info.inputs.len() > MAX_INPUT_BUFFERS {
            self.report(
                Diagnostic::new(
                    Code::E4051,
                    "A compute program supports at most four input storage buffers.",
                )
                .at(decl.name.span),
            );
        }
        if !decl
            .members
            .iter()
            .any(|m| matches!(m, ComputeMember::Output(_)))
        {
            self.report(
                Diagnostic::new(
                    Code::E4050,
                    "A compute program requires one `output name: array<T, N>;` declaration.",
                )
                .at(decl.name.span),
            );
        }
        let mut workgroup_seen = None;
        let mut kernel_seen = None;
        for member in &decl.members {
            match member {
                ComputeMember::Workgroup(field) => {
                    if let Some(first) = workgroup_seen {
                        self.report(
                            Diagnostic::new(Code::E4050, "Duplicate `workgroup_size`.")
                                .at(field.name.span)
                                .related(first, "first workgroup size"),
                        );
                    }
                    workgroup_seen = Some(field.name.span);
                    let FieldValue::Expr(expr) = &field.value else {
                        self.report(
                            Diagnostic::new(
                                Code::E4053,
                                "The workgroup size is a constant array, not a binding.",
                            )
                            .at(field.span),
                        );
                        continue;
                    };
                    let expected = self.out.interner.intern(Ty::Array {
                        element: TyId::U32,
                        len: 3,
                    });
                    self.check(expr, Some(expected));
                    let size = match self.fold(expr) {
                        Folded::Value(ConstValue::Array(values)) if values.len() == 3 => values
                            .iter()
                            .map(|v| match v {
                                ConstValue::U32(value) => Some(*value),
                                _ => None,
                            })
                            .collect::<Option<Vec<_>>>(),
                        _ => None,
                    };
                    if let Some(values) = size {
                        let size = [values[0], values[1], values[2]];
                        let total = size[0]
                            .checked_mul(size[1])
                            .and_then(|n| n.checked_mul(size[2]));
                        if size[0] > 0
                            && size[0] <= 256
                            && size[1] > 0
                            && size[1] <= 256
                            && size[2] > 0
                            && size[2] <= 64
                            && total.is_some_and(|n| n <= 256)
                        {
                            info.workgroup_size = size;
                            continue;
                        }
                    }
                    self.report(Diagnostic::new(Code::E4053, "The workgroup size must be three positive constant u32 values, axes at most [256, 256, 64] and at most 256 invocations in total.").at(expr.span));
                }
                ComputeMember::Stage(stage) => {
                    if stage.name.name != "kernel" {
                        self.report(
                            Diagnostic::new(
                                Code::E4050,
                                "The compute entry function must be named `kernel`.",
                            )
                            .at(stage.name.span),
                        );
                    }
                    if let Some(first) = kernel_seen {
                        self.report(
                            Diagnostic::new(
                                Code::E4050,
                                "A compute program has exactly one kernel.",
                            )
                            .at(stage.name.span)
                            .related(first, "first kernel"),
                        );
                    }
                    kernel_seen = Some(stage.name.span);
                    let kernel =
                        self.compute_kernel(decl, stage, info.output.as_ref().map(|b| b.element));
                    if info.kernel.is_none() {
                        info.kernel = Some(kernel);
                    }
                }
                _ => {}
            }
        }
        if kernel_seen.is_none() {
            self.report(
                Diagnostic::new(
                    Code::E4050,
                    "A compute program requires `kernel(input: ComputeInput) -> T { ... }`.",
                )
                .at(decl.name.span),
            );
        }
        self.out.computes.insert(def, info);
        self.report(Diagnostic::new(Code::E4901, "Source compute checking is implemented, but compute packaging and runtime dispatch are not yet available.")
            .at(decl.name.span).note("the required compute-authoring workstream remains in progress; this declaration cannot produce a runnable package yet"));
    }

    fn compute_buffer(&mut self, buffer: &StorageDecl) -> Option<ComputeBuffer> {
        let def = self.res.def_of(buffer.id)?;
        let TypeKind::Generic {
            name,
            element,
            length,
        } = &buffer.ty.kind
        else {
            self.report(
                Diagnostic::new(
                    Code::E4051,
                    "A storage resource must have type `array<T, N>`.",
                )
                .at(buffer.ty.span),
            );
            return None;
        };
        if !matches!(
            self.res.res(name.id),
            Some(Res::Prelude(PreludeItem::Type("array")))
        ) {
            self.report(
                Diagnostic::new(
                    Code::E4051,
                    "A storage resource must use the built-in `array<T, N>` type.",
                )
                .at(buffer.ty.span),
            );
            return None;
        }
        let element = self.annotation(element);
        let capacity = self.compute_capacity(length)?;
        let root = self.out.interner.intern(Ty::Array {
            element,
            len: capacity,
        });
        self.out.locals.insert(def, root);
        if self.is_error(element) {
            return None;
        }
        let Some(element_layout) = layout_type(&self.out.interner, element) else {
            self.report(Diagnostic::new(Code::E4051, "Storage elements must be GPU-storable values with at most 16,384 expanded layout nodes, without resources or input records.").at(buffer.ty.span));
            return None;
        };
        let layout = match storage_array(&element_layout, capacity) {
            Ok(layout) if layout.size() <= MAX_STORAGE_BYTES => layout,
            _ => {
                self.report(
                    Diagnostic::new(
                        Code::E4051,
                        "The storage array exceeds the 16,777,216-byte resource layout budget.",
                    )
                    .at(buffer.ty.span),
                );
                return None;
            }
        };
        Some(ComputeBuffer {
            name: buffer.name.name.clone(),
            def,
            span: buffer.span,
            element,
            capacity,
            layout,
        })
    }

    fn compute_capacity(&mut self, length: &ArrayLength) -> Option<u32> {
        let value = match &length.kind {
            ArrayLengthKind::Int { value } => value.and_then(|v| u32::try_from(v).ok()),
            ArrayLengthKind::Name(_) => match self.res.res(length.id) {
                Some(Res::Def(def))
                    if self
                        .res
                        .def(def)
                        .is_some_and(|decl| decl.kind == DefKind::Const) =>
                {
                    self.const_info(def, Some(length.span));
                    match self.out.consts.get(&def).and_then(|c| c.value.as_ref()) {
                        Some(ConstValue::U32(value)) => Some(*value),
                        Some(ConstValue::I32(value)) => u32::try_from(*value).ok(),
                        _ => None,
                    }
                }
                _ => None,
            },
            ArrayLengthKind::Error => return None,
        };
        if value.is_some_and(|n| n > 0 && n <= MAX_STORAGE_BYTES / 4) {
            return value;
        }
        self.report(Diagnostic::new(Code::E4051, "Storage capacity must be a positive integer literal or integer constant, at most 4,194,304 elements and within the resource byte budget.").at(length.span));
        None
    }

    fn compute_kernel(
        &mut self,
        decl: &ComputeDecl,
        stage: &StageFn,
        element: Option<TyId>,
    ) -> StageInfo {
        let input = self.out.interner.intern(Ty::Record("ComputeInput"));
        let mut surface = None;
        for param in &stage.params {
            let ty = self.annotation(&param.ty);
            if let Some(def) = self.res.def_of(param.id) {
                self.out.locals.insert(def, ty);
                if ty == input {
                    surface = Some(def);
                }
            }
        }
        if stage.params.len() != 1 || surface.is_none() {
            self.report(
                Diagnostic::new(
                    Code::E4021,
                    "A compute kernel takes exactly one `ComputeInput` parameter.",
                )
                .at(stage.name.span),
            );
        }
        let ret = stage
            .ret
            .as_ref()
            .map(|ty| self.annotation(ty))
            .unwrap_or(TyId::UNIT);
        if stage.ret.is_none() || element.is_some_and(|ty| !self.is_error(ret) && ty != ret) {
            self.report(
                Diagnostic::new(
                    Code::E4021,
                    "A compute kernel must return exactly the output buffer's element type.",
                )
                .at(stage.ret.as_ref().map_or(stage.name.span, |ty| ty.span)),
            );
        }
        self.start_body(
            format!("The kernel of compute program '{}'", decl.name.name),
            "kernel".into(),
            ret,
            Some(StageState {
                input_type: "ComputeInput",
                material: decl.name.name.clone(),
                surface,
                surface_uses: 0,
                surface_field_reads: 0,
                surface_reads: BTreeSet::new(),
                sample_operands: BTreeSet::new(),
                derivatives_allowed: false,
            }),
        );
        if let Some(body) = self.body.as_mut() {
            body.ret_span = stage.ret.as_ref().map(|ty| ty.span);
        }
        let facts = self
            .end_body(&stage.body, stage.ret.as_ref())
            .map(|body| body.facts)
            .unwrap_or_default();
        StageInfo {
            result: ret,
            varying: None,
            name_span: stage.name.span,
            span: stage.span,
            surface,
            surface_inputs: vec![],
            facts,
        }
    }
}
