//! Resource planning (`spec/compiler-architecture.md` section 4.10, decisions 0030 and 0044):
//! what the packager, the JavaScript emitter and `mtek inspect --bindings` need to know about
//! the entry scene's GPU-side resources, decided once from the typed IR.
//!
//! - the **meshes**: one entry per distinct mesh descriptor, in first-use order of the stable
//!   instance order (`spec/scenes.md` section 10.1), so equal descriptors share one
//!   `mesh:<n>` and the runtime builds the geometry once;
//! - the **material instances**: one per entity that has a material, in entity order, each
//!   param with the update class the IR recorded for it (`initial`, `imperative`, `bound`, and
//!   `resource` for a texture or sampler, decision 0054), and whether the instance may share its
//!   parameter slot (every param `initial` or `resource`, `spec/gpu-layout.md` section 8.2);
//! - the **materials**: the distinct materials the instances use, sorted by symbol, each with
//!   its parameter block (the `layout` the IR computed with `layout::compute`), its
//!   texture and sampler bindings, its declaration and its params — built-in materials of the
//!   embedded prelude exactly like user materials (decision 0044).
//!
//! [`check_limits`] checks the plan against the target profile's limits before any shader is
//! lowered (`spec/gpu-layout.md` section 8.3): a parameter block larger than
//! `maxUniformBufferBindingSize` is `E6001`. The plan depends only on the IR, never on
//! traversal of unordered structures.

use crate::diagnostics::{Code, Diagnostic};
use crate::ir::{self, MaterialItem, MeshDesc, Program, Scene, Symbol, Value};
use crate::layout::{LayoutNode, LayoutRecord};
use crate::source::Span;

/// The update class of a material parameter (`spec/materials.md` section 4,
/// `spec/runtime-abi.md` section 5.2), as the IR recorded it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParamClass {
    /// A default or constant initialiser, never written: uploaded once at creation.
    Initial,
    /// Some lifecycle function or handler writes it.
    Imperative,
    /// A `bind(..)` supplies it.
    Bound,
    /// A texture or sampler: part of the instance's bind group, fixed at creation.
    Resource,
}

impl ParamClass {
    /// The spelling of the manifest and of `mtek inspect --bindings`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            ParamClass::Initial => "initial",
            ParamClass::Imperative => "imperative",
            ParamClass::Bound => "bound",
            ParamClass::Resource => "resource",
        }
    }
}

impl From<ir::UpdateClass> for ParamClass {
    fn from(class: ir::UpdateClass) -> Self {
        match class {
            ir::UpdateClass::Initial => ParamClass::Initial,
            ir::UpdateClass::Imperative => ParamClass::Imperative,
            ir::UpdateClass::Bound => ParamClass::Bound,
            ir::UpdateClass::Resource => ParamClass::Resource,
        }
    }
}

/// One parameter of a planned material instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedParam {
    pub name: String,
    /// The Mtek type spelling (`color`).
    pub ty: String,
    /// The constant initial value; `None` for a bound param, whose value the binding supplies,
    /// and for a param of a prefab instance that `init` computes from the instance's params.
    pub value: Option<Value>,
    pub class: ParamClass,
    /// The binding that supplies a bound param (its id in the scene's `bindings`).
    pub binding: Option<u32>,
    /// What the binding reads, as `mtek inspect --bindings` prints it (empty unless bound).
    pub dependencies: Vec<String>,
    /// The material instance's span (decision 0028).
    pub span: Span,
}

/// A material instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedInstance {
    /// Its index in the manifest's `materialInstances`.
    pub index: u32,
    /// The static index of the entity that owns it.
    pub entity: u32,
    /// The symbol of the entity that owns it.
    pub entity_symbol: Symbol,
    /// The material's symbol (`std/materials.mtek::Unlit`).
    pub material: Symbol,
    /// Every parameter of the material, in declaration order.
    pub params: Vec<PlannedParam>,
}

impl PlannedInstance {
    /// True when every parameter is `initial` or a resource (fixed at creation): the instance
    /// may share a parameter slot with byte-identical instances of the same material
    /// (`spec/gpu-layout.md` section 8.2).
    #[must_use]
    pub fn shareable(&self) -> bool {
        self.params
            .iter()
            .all(|p| matches!(p.class, ParamClass::Initial | ParamClass::Resource))
    }
}

/// One param of a planned material, as declared.
#[derive(Clone, Debug, PartialEq)]
pub struct MaterialParam {
    pub name: String,
    /// The type as written in source (`array<Wave, 2>`): the IR's spelling without module
    /// paths (decision 0041 item 1).
    pub ty: String,
    /// The `param name: T = default;` declaration.
    pub span: Span,
}

/// One texture or sampler binding of a planned material (`spec/gpu-layout.md` section 6).
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedResource {
    /// The param's name; it is also the WGSL global's name suffix (`u_p_<name>`).
    pub name: String,
    /// `texture` or `sampler`.
    pub kind: &'static str,
    /// The binding in group 1: `1…` in param declaration order.
    pub binding: u32,
    /// The `param name: T = default;` declaration.
    pub span: Span,
}

/// A material the entry scene uses.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedMaterial {
    /// The declared name (`Pulse`).
    pub name: String,
    /// `src/main.mtek::Pulse`, `std/materials.mtek::Unlit`.
    pub symbol: Symbol,
    /// The material declaration (`material Name { … }`).
    pub declaration: Span,
    /// The params in declaration order.
    pub params: Vec<MaterialParam>,
    /// The parameter block; `None` for a material without value params.
    pub layout: Option<LayoutRecord>,
    /// The textures and samplers, in param declaration order.
    pub resources: Vec<PlannedResource>,
}

/// A parameter of a planned prefab.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedPrefabParam {
    pub name: String,
    /// The Mtek type spelling.
    pub ty: String,
}

/// A prefab the program spawns (decision 0064): what the runtime needs to create an instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedPrefab {
    /// The declared name.
    pub name: String,
    /// `src/main.mtek::Crate`, the key of the `prefabs` table of `app.js`.
    pub symbol: Symbol,
    /// The params in declaration order.
    pub params: Vec<PlannedPrefabParam>,
    /// The prefab's mesh: its position in [`ResourcePlan::meshes`].
    pub mesh: Option<u32>,
    /// The prefab's material instance (`index` 0 of the prefab, `entity` 0 is the instance).
    pub instance: Option<PlannedInstance>,
    /// The whole declaration.
    pub span: Span,
}

/// The resource plan of a scene.
#[derive(Clone, Debug, PartialEq)]
pub struct ResourcePlan {
    /// Distinct mesh descriptors; the position is the `<n>` of `mesh:<n>`.
    pub meshes: Vec<MeshDesc>,
    /// Per static entity index: its mesh's position in [`ResourcePlan::meshes`].
    pub entity_meshes: Vec<Option<u32>>,
    /// Material instances in entity order.
    pub instances: Vec<PlannedInstance>,
    /// Per static entity index: its material instance's index.
    pub entity_instances: Vec<Option<u32>>,
    /// The distinct materials the instances and the spawned prefabs use, sorted by symbol.
    pub materials: Vec<PlannedMaterial>,
    /// The prefabs the program spawns, sorted by symbol (decision 0064). Their meshes follow the
    /// scene's in [`ResourcePlan::meshes`].
    pub prefabs: Vec<PlannedPrefab>,
}

impl ResourcePlan {
    /// The manifest id of mesh `index`: `mesh:<index>`.
    #[must_use]
    pub fn mesh_id(index: u32) -> String {
        format!("mesh:{index}")
    }

    /// The planned material `symbol`.
    #[must_use]
    pub fn material(&self, symbol: &Symbol) -> Option<&PlannedMaterial> {
        self.materials.iter().find(|m| &m.symbol == symbol)
    }
}

/// Bitwise equality of mesh descriptors (an `f32` compares by its bits, so the plan never
/// depends on how `NaN` or `-0.0` compare).
fn same_mesh(a: &MeshDesc, b: &MeshDesc) -> bool {
    let bits = |values: &[f32]| values.iter().map(|v| v.to_bits()).collect::<Vec<_>>();
    match (a, b) {
        (MeshDesc::Box { size: x }, MeshDesc::Box { size: y }) => bits(x) == bits(y),
        (MeshDesc::Plane { size: x }, MeshDesc::Plane { size: y }) => bits(x) == bits(y),
        (
            MeshDesc::Sphere {
                radius: r1,
                segments: s1,
                rings: g1,
            },
            MeshDesc::Sphere {
                radius: r2,
                segments: s2,
                rings: g2,
            },
        ) => r1.to_bits() == r2.to_bits() && s1 == s2 && g1 == g2,
        (a @ MeshDesc::Asset { .. }, b @ MeshDesc::Asset { .. }) => a == b,
        _ => false,
    }
}

/// The source spelling of an IR type: the IR names a user struct by its symbol
/// (`array<src/a.mtek::Wave, 2>`, decision 0041), the manifest's `mtekTypeName` as written
/// in source (`array<Wave, 2>`).
#[must_use]
pub fn written_type(ty: &str) -> String {
    let mut out = String::with_capacity(ty.len());
    for (index, part) in ty.split("::").enumerate() {
        if index == 0 {
            out.push_str(part);
            continue;
        }
        // Drop the module path that ends `out`: everything after the last `<` or space.
        let keep = out.rfind(['<', ' ']).map_or(0, |i| i + 1);
        out.truncate(keep);
        out.push_str(part);
    }
    out
}

/// The planned material of the IR item `item`.
fn planned_material(item: &MaterialItem) -> PlannedMaterial {
    PlannedMaterial {
        name: item.name.clone(),
        symbol: item.symbol.clone(),
        declaration: item.span,
        params: item
            .params
            .iter()
            .map(|p| MaterialParam {
                name: p.name.clone(),
                ty: written_type(&p.ty),
                span: p.span,
            })
            .collect(),
        layout: item.layout.clone(),
        resources: resources(item),
    }
}

/// The texture and sampler params of `item` with their bindings: group 1, from binding 1, in
/// declaration order (`spec/gpu-layout.md` section 6).
#[must_use]
pub fn resources(item: &MaterialItem) -> Vec<PlannedResource> {
    let mut binding = 0;
    item.params
        .iter()
        .filter_map(|param| {
            let kind = match param.ty.as_str() {
                "texture" => "texture",
                "sampler" => "sampler",
                _ => return None,
            };
            binding += 1;
            Some(PlannedResource {
                name: param.name.clone(),
                kind,
                binding,
                span: param.span,
            })
        })
        .collect()
}

/// Plans the resources of the entry scene of `program`.
///
/// # Errors
/// A text describing a compiler defect: no entry scene, a material instance of a material
/// that is not an item of the program or whose params differ from it, a material parameter
/// without a constant value (this build has no other kind), or an index that does not fit
/// the manifest's integers.
pub fn plan_program(program: &Program) -> Result<ResourcePlan, String> {
    let scene = program
        .entry()
        .ok_or_else(|| format!("the entry scene '{}' is not in the IR", program.entry_scene))?;
    plan_scene(program, scene)
}

/// Plans the resources of `scene`, a scene of `program`.
///
/// # Errors
/// As [`plan_program`].
pub fn plan_scene(program: &Program, scene: &Scene) -> Result<ResourcePlan, String> {
    let mut meshes: Vec<MeshDesc> = Vec::new();
    let mut entity_meshes = Vec::with_capacity(scene.entities.len());
    let mut instances: Vec<PlannedInstance> = Vec::new();
    let mut entity_instances = Vec::with_capacity(scene.entities.len());
    let mut materials: Vec<PlannedMaterial> = Vec::new();
    for entity in &scene.entities {
        entity_meshes.push(plan_mesh(&mut meshes, entity.mesh.as_ref())?);
        let instance = match &entity.material {
            Some(material) => {
                let index = index_u32(instances.len())?;
                instances.push(plan_instance(
                    program,
                    &mut materials,
                    &scene.bindings,
                    Owned {
                        symbol: &entity.symbol,
                        index: entity.index,
                    },
                    material,
                    index,
                )?);
                Some(index)
            }
            None => None,
        };
        entity_instances.push(instance);
    }
    let mut prefabs = Vec::new();
    for symbol in spawned_prefabs(program, scene) {
        let prefab = program
            .prefabs()
            .find(|p| p.symbol == symbol)
            .ok_or_else(|| format!("the prefab '{symbol}' is spawned but not in the program"))?;
        prefabs.push(PlannedPrefab {
            name: prefab.name.clone(),
            symbol: prefab.symbol.clone(),
            params: prefab
                .params
                .iter()
                .map(|p| PlannedPrefabParam {
                    name: p.name.clone(),
                    ty: written_type(&p.ty),
                })
                .collect(),
            mesh: plan_mesh(&mut meshes, prefab.entity.mesh.as_ref())?,
            instance: prefab
                .entity
                .material
                .as_ref()
                .map(|material| {
                    plan_instance(
                        program,
                        &mut materials,
                        &prefab.bindings,
                        Owned {
                            symbol: &prefab.symbol,
                            index: 0,
                        },
                        material,
                        0,
                    )
                })
                .transpose()?,
            span: prefab.span,
        });
    }
    materials.sort_by(|a, b| a.symbol.cmp(&b.symbol));
    Ok(ResourcePlan {
        meshes,
        entity_meshes,
        instances,
        entity_instances,
        materials,
        prefabs,
    })
}

/// The entity a material instance belongs to.
struct Owned<'a> {
    symbol: &'a Symbol,
    index: u32,
}

/// The position of `mesh`'s descriptor in `meshes`, which it joins if it is new.
fn plan_mesh(meshes: &mut Vec<MeshDesc>, mesh: Option<&ir::Mesh>) -> Result<Option<u32>, String> {
    let Some(mesh) = mesh else {
        return Ok(None);
    };
    let index = match meshes.iter().position(|m| same_mesh(m, &mesh.desc)) {
        Some(index) => index,
        None => {
            meshes.push(mesh.desc.clone());
            meshes.len() - 1
        }
    };
    index_u32(index).map(Some)
}

/// The material instance `material` of `owner`, whose bound params read `bindings` (the scene's, or
/// the prefab's); the material joins `materials` if it is new.
fn plan_instance(
    program: &Program,
    materials: &mut Vec<PlannedMaterial>,
    bindings: &[ir::Binding],
    owner: Owned<'_>,
    material: &ir::MaterialInstanceDesc,
    index: u32,
) -> Result<PlannedInstance, String> {
    let item = program
        .materials()
        .find(|m| m.symbol == material.material)
        .ok_or_else(|| {
            format!(
                "the material '{}' of '{}' is not a material of the program",
                material.material, owner.symbol
            )
        })?;
    let declared: Vec<&str> = item.params.iter().map(|p| p.name.as_str()).collect();
    let given: Vec<&str> = material.params.iter().map(|p| p.name.as_str()).collect();
    if declared != given {
        return Err(format!(
            "the material instance of '{}' has the params {given:?}, but '{}' declares {declared:?}",
            owner.symbol, item.symbol
        ));
    }
    if !materials.iter().any(|m| m.symbol == item.symbol) {
        materials.push(planned_material(item));
    }
    let mut params = Vec::with_capacity(material.params.len());
    for param in &material.params {
        let (value, binding, dependencies) = match &param.source {
            ir::Source::Const(value) => (Some(value.clone()), None, Vec::new()),
            // The prefab's `init` computes the value when it runs (decision 0062).
            ir::Source::Expr(_) => (None, None, Vec::new()),
            ir::Source::Bound(id) => {
                let bound = bindings.iter().find(|b| b.id == *id).ok_or_else(|| {
                    format!(
                        "the parameter '{}' of the material instance of '{}' names the missing binding {id}",
                        param.name, owner.symbol
                    )
                })?;
                (
                    None,
                    Some(*id),
                    bound.deps.iter().map(dependency_text).collect(),
                )
            }
        };
        params.push(PlannedParam {
            name: param.name.clone(),
            ty: param.ty.clone(),
            value,
            class: param.update.into(),
            binding,
            dependencies,
            span: param.span,
        });
    }
    Ok(PlannedInstance {
        index,
        entity: owner.index,
        entity_symbol: owner.symbol.clone(),
        material: material.material.clone(),
        params,
    })
}

/// The prefabs some lifecycle function or handler spawns, directly in the scene or through the
/// handlers of a prefab that is spawned itself, sorted by symbol (decision 0064). A prefab that
/// nothing spawns is in the program's `prefabs` table but needs no mesh, material or pipeline.
fn spawned_prefabs(program: &Program, scene: &Scene) -> Vec<Symbol> {
    fn literals(block: &ir::Block, out: &mut Vec<Symbol>) {
        fn expr(e: &ir::Expr, out: &mut Vec<Symbol>) {
            use ir::ExprKind as K;
            match &e.kind {
                K::PrefabLiteral { prefab, params } => {
                    out.push(prefab.clone());
                    params.iter().for_each(|p| expr(&p.value, out));
                }
                K::Const { .. }
                | K::Local { .. }
                | K::Param { .. }
                | K::State { .. }
                | K::EntityRef { .. }
                | K::EntityField { .. }
                | K::CameraField { .. }
                | K::InstanceParam { .. }
                | K::LightField { .. }
                | K::Frame { .. }
                | K::EnumMember { .. } => {}
                K::Unary { operand, .. } => expr(operand, out),
                K::Binary { lhs, rhs, .. } => {
                    expr(lhs, out);
                    expr(rhs, out);
                }
                K::Call { args, .. } | K::Builtin { args, .. } | K::Construct { args } => {
                    args.iter().for_each(|a| expr(a, out));
                }
                K::Convert { arg } => expr(arg, out),
                K::Components { base, .. } | K::Field { base, .. } => expr(base, out),
                K::Index { base, index } => {
                    expr(base, out);
                    expr(index, out);
                }
                K::Array { elements } => elements.iter().for_each(|a| expr(a, out)),
                K::Struct { fields }
                | K::Descriptor { fields, .. }
                | K::Material { params: fields, .. } => {
                    fields.iter().for_each(|f| expr(&f.value, out));
                }
                K::BodyCommand { target, args, .. } => {
                    if let ir::BodyTarget::Ref { target } = target {
                        expr(target, out);
                    }
                    args.iter().for_each(|a| expr(a, out));
                }
                K::BodyProperty { target, .. } => {
                    if let ir::BodyTarget::Ref { target } = target {
                        expr(target, out);
                    }
                }
            }
        }
        for stmt in &block.stmts {
            match stmt {
                ir::Stmt::Let { value, .. } | ir::Stmt::Var { value, .. } => expr(value, out),
                ir::Stmt::Assign { target, value, .. } => {
                    for step in &target.steps {
                        if let ir::PlaceStep::Index { index, .. } = step {
                            expr(index, out);
                        }
                    }
                    expr(value, out);
                }
                ir::Stmt::If {
                    branches,
                    otherwise,
                    ..
                } => {
                    for branch in branches {
                        expr(&branch.cond, out);
                        literals(&branch.body, out);
                    }
                    if let Some(body) = otherwise {
                        literals(body, out);
                    }
                }
                ir::Stmt::ForRange {
                    start, end, body, ..
                } => {
                    expr(start, out);
                    expr(end, out);
                    literals(body, out);
                }
                ir::Stmt::ForEach { array, body, .. } => {
                    expr(array, out);
                    literals(body, out);
                }
                ir::Stmt::Return { value, .. } => {
                    if let Some(value) = value {
                        expr(value, out);
                    }
                }
                ir::Stmt::Block { body } => literals(body, out),
                ir::Stmt::Expr { expr: e, .. } => expr(e, out),
                ir::Stmt::Const { .. } | ir::Stmt::Break { .. } | ir::Stmt::Continue { .. } => {}
            }
        }
    }
    let mut found: Vec<Symbol> = Vec::new();
    for behavior in &scene.behaviors {
        literals(&behavior.body, &mut found);
    }
    let mut spawned: std::collections::BTreeSet<Symbol> = std::collections::BTreeSet::new();
    while let Some(symbol) = found.pop() {
        if !spawned.insert(symbol.clone()) {
            continue;
        }
        // A spawned prefab's handlers may spawn further prefabs.
        if let Some(prefab) = program.prefabs().find(|p| p.symbol == symbol) {
            for behavior in &prefab.behaviors {
                literals(&behavior.body, &mut found);
            }
        }
    }
    spawned.into_iter().collect()
}

/// How `mtek inspect --bindings` names what a binding reads.
fn dependency_text(dep: &ir::BindingDep) -> String {
    match dep {
        ir::BindingDep::State { name } => format!("state {name}"),
        ir::BindingDep::Frame { name } => format!("frame.{name}"),
        ir::BindingDep::EntityField { entity, field } => format!("entity#{entity}.{field}"),
        ir::BindingDep::EntityState { entity, name } => format!("entity#{entity}.{name}"),
        ir::BindingDep::Param { entity, name } => format!("entity#{entity}.material.{name}"),
    }
}

fn index_u32(index: usize) -> Result<u32, String> {
    u32::try_from(index).map_err(|_| format!("the index {index} does not fit a u32"))
}

/// The largest uniform block the target profile `webgpu-core-2026` binds
/// (`maxUniformBufferBindingSize` of the WebGPU default limits, `spec/gpu-layout.md`
/// section 8.3).
pub const MAX_UNIFORM_BUFFER_BINDING_SIZE: u32 = 65_536;

/// The limits of `spec/gpu-layout.md` section 8.3 that the plan decides, checked before any
/// shader is lowered: `E6001` for every planned material whose parameter block is larger
/// than `max_block` bytes (`maxUniformBufferBindingSize` of the target profile `profile`), at
/// the material declaration, with the largest param as a related location. `E6002` (more than
/// 8 texture and sampler params) is decided by the checker, where the params are declared
/// (decision 0054), and `E6003` (custom vertex stages, v0.2) cannot occur in this build.
#[must_use]
pub fn check_limits(plan: &ResourcePlan, profile: &str, max_block: u32) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for material in &plan.materials {
        let Some(layout) = &material.layout else {
            continue;
        };
        if layout.size <= max_block {
            continue;
        }
        let name = &material.name;
        let mut diagnostic = Diagnostic::new(
            Code::E6001,
            format!(
                "The parameter block of material '{name}' is {} bytes, more than the {max_block} bytes a uniform block may have in the target profile '{profile}'.",
                layout.size
            ),
        )
        .at(material.declaration)
        .note(format!(
            "the limit is maxUniformBufferBindingSize of '{profile}' (spec/gpu-layout.md section 8.3)"
        ));
        if let Some((param, size)) = largest_param(material, layout) {
            diagnostic = diagnostic.related(
                param.span,
                format!("param '{}' takes {size} bytes of the block", param.name),
            );
        }
        diagnostics.push(diagnostic.help(
            "use fewer or smaller params; in a uniform block every array element takes at least 16 bytes",
        ));
    }
    diagnostics
}

/// The param of `material` that takes the most bytes of `layout` (the first of equals).
fn largest_param<'m>(
    material: &'m PlannedMaterial,
    layout: &LayoutRecord,
) -> Option<(&'m MaterialParam, u32)> {
    let LayoutNode::Struct { members, .. } = &layout.root else {
        return None;
    };
    let mut best: Option<(&MaterialParam, u32)> = None;
    // The block's members are the value params: a texture or sampler is a binding of its own.
    let values = material
        .params
        .iter()
        .filter(|p| !matches!(p.ty.as_str(), "texture" | "sampler"));
    for (param, member) in values.zip(members) {
        let size = member.node.size();
        if best.is_none_or(|(_, largest)| size > largest) {
            best = Some((param, size));
        }
    }
    best
}

#[cfg(test)]
mod tests;
