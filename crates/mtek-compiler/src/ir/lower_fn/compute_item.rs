//! Checked public source compute declarations to self-contained typed IR.

use super::*;
use crate::ir::{ComputeBufferItem, ComputeItem};
use crate::layout::{hash8, storage_array};
use crate::types::ComputeBuffer;

impl Lowering<'_> {
    pub(in crate::ir) fn compute(
        &self,
        decl: &ast::ComputeDecl,
        symbol: Symbol,
    ) -> Result<ComputeItem, Defect> {
        let def = self
            .resolution
            .def_of(decl.id)
            .ok_or("compute has no declaration")?;
        let info = self
            .types
            .computes()
            .find_map(|(key, info)| (key == def).then_some(info))
            .ok_or("compute was not checked")?;
        let output = info.output.as_ref().ok_or("compute has no output")?;
        let kernel_info = info.kernel.as_ref().ok_or("compute has no kernel")?;
        let kernel = decl
            .members
            .iter()
            .find_map(|member| match member {
                ast::ComputeMember::Stage(stage) if stage.name.name == "kernel" => Some(stage),
                _ => None,
            })
            .ok_or("compute has no kernel syntax")?;
        let mut positions = BTreeMap::new();
        let mut params = Vec::new();
        let mut members = Vec::new();
        for (index, param) in info.params.iter().enumerate() {
            if param.has_default != param.default.is_some() {
                return Err("compute param has a default with errors".into());
            }
            let def = param.def.ok_or("compute param has no declaration")?;
            positions.insert(
                def,
                u32::try_from(index).map_err(|_| "too many compute params")?,
            );
            members.push((param.name.clone(), self.layout_type(param.ty)?));
            params.push(MaterialParamItem {
                name: param.name.clone(),
                ty: self.type_name(param.ty),
                default: param.default.as_ref().map(Value::from),
                span: param.span,
            });
        }
        let layout = if members.is_empty() {
            None
        } else {
            Some(
                compute(
                    &LayoutType::new_struct(qualified_name(self.path, &info.name), members),
                    &format!("compute:{symbol}:params"),
                    &format!("MtekComputeParams_{}_{}", hash8(self.path), info.name),
                )
                .map_err(|error| format!("compute uniforms have no layout: {error}"))?,
            )
        };
        let mut lowering = FnLowering {
            lowering: self,
            name: format!("{}.kernel", info.name),
            locals: Vec::new(),
            index: BTreeMap::new(),
            params: positions,
            scene: None,
        };
        for param in &kernel.params {
            lowering.declare_node(param.id, &param.name, LocalKind::Param)?;
        }
        let body = lowering.block(&kernel.body)?;
        Ok(ComputeItem {
            name: info.name.clone(),
            symbol: symbol.clone(),
            params,
            layout,
            inputs: info
                .inputs
                .iter()
                .map(|buffer| self.compute_buffer(buffer))
                .collect::<Result<_, _>>()?,
            output: self.compute_buffer(output)?,
            workgroup_size: info.workgroup_size,
            kernel: StageItem {
                symbol: symbol.child("kernel"),
                surface_inputs: kernel_info.surface_inputs.clone(),
                result: self.type_name(kernel_info.result),
                locals: lowering.locals,
                body,
                span: kernel.span,
            },
            span: decl.span,
        })
    }

    fn compute_buffer(&self, buffer: &ComputeBuffer) -> Result<ComputeBufferItem, Defect> {
        let layout = storage_array(&self.layout_type(buffer.element)?, buffer.capacity)
            .map_err(|error| format!("compute storage has no layout: {error}"))?;
        if layout.size() != buffer.layout.size() || layout.align() != buffer.layout.align() {
            return Err("compute storage layout disagrees with source checking".into());
        }
        Ok(ComputeBufferItem {
            name: buffer.name.clone(),
            element: self.type_name(buffer.element),
            capacity: buffer.capacity,
            layout,
            span: buffer.span,
        })
    }
}
