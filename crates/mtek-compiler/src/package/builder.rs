//! Assembling a build: shaders, `app.js`, the manifest and the `dist/` file set
//! (`spec/runtime-abi.md` sections 2 and 5).
//!
//! [`package`] runs after the typed IR exists. In a fixed order it
//!
//! 1. plans the entry scene's resources ([`crate::plan`]);
//! 2. emits one shader per material through the shader lowering
//!    ([`crate::lowering::shader`], decision 0041): user materials and the built-in ones,
//!    which the front end compiled from the embedded prelude `std/materials.mtek` (decision
//!    0044) and added to the project's source map, so the manifest's `sources` and `spans`
//!    cover it;
//! 3. interns the manifest's spans in this order: symbols (scene, cameras, entities, per
//!    material its declaration and its params, then the functions compiled for the CPU),
//!    material params, shader span maps;
//! 4. emits `app.js` ([`crate::emit_js::emit_program`]) with the writers of `builtin:frame`,
//!    `builtin:object` and every material block and the CPU functions, whose run-time index
//!    checks intern their spans last;
//! 5. builds the manifest and writes the files with content-addressed names for the runtime
//!    bundle and the shaders.
//!
//! The manifest carries structure and constant scene fields only; entity and camera values
//! are set by `init(ctx)` (`spec/scenes.md` section 11). `ambientColor`, `ambientIntensity`
//! and `gravity` are registry fields that M4/M5 implement: until then they are the registry
//! defaults of the `Scene` schema.

use std::collections::BTreeMap;

use crate::diagnostics::{Code, Diagnostic};
use crate::emit_js::{ProgramParts, emit_app_dts, emit_program, source_map};
use crate::emit_wgsl::{ShaderArtifact, emit_shader};
use crate::ir::{self, BehaviorKind, MeshDesc, Owner, Program};
use crate::layout::{LayoutRecord, builtin_blocks, compute};
use crate::lowering::shader::lower_material;
use crate::plan::{ParamClass, PlannedMaterial, ResourcePlan, check_limits, plan_program};
use crate::project::Project;
use crate::source::Span;
use crate::stdlib::registry;
use crate::types::ConstValue;
use crate::{BuildMode, COMPILER_VERSION, LANGUAGE_VERSION, RUNTIME_ABI, TargetProfile};

use super::html::index_html;
use super::identity::{BuildIdentity, h16};
use super::manifest::{
    Binding, BindingDep, BindingTarget, Camera, Entity, EntityMaterial, InstanceParam, Layout, MANIFEST_SCHEMA, Manifest, Material,
    MaterialInstance, MaterialParam, Mesh, MeshShape, Num, ParamClass as ManifestClass,
    RequiredCapabilities, RuntimeConfig, Scene, SceneFields, Shader, SourceEntry, StateEntry,
    Subsystems, SymbolEntry, SymbolKind,
};
use super::spans::SpanTable;

/// The fixed file names of `spec/runtime-abi.md` section 2.
pub const INDEX_HTML: &str = "index.html";
pub const APP_JS: &str = "app.js";
pub const APP_JS_MAP: &str = "app.js.map";
pub const APP_DTS: &str = "app.d.ts";
pub const RUNTIME_DTS: &str = "runtime.d.ts";
pub const MANIFEST_JSON: &str = "program.manifest.json";

/// What [`package`] needs besides the project and the IR.
#[derive(Clone, Copy, Debug)]
pub struct PackageInput<'a> {
    pub profile: TargetProfile,
    pub mode: BuildMode,
    /// The runtime bundle (`runtime.<h16>.js`).
    pub runtime_bundle: &'a [u8],
    /// The runtime host declarations (`runtime.d.ts`).
    pub runtime_declarations: &'a [u8],
}

/// A packaged build.
#[derive(Clone, Debug)]
pub struct Package {
    /// Every file of `dist/`, keyed by its path relative to `dist/` (`/`-separated).
    pub files: BTreeMap<String, Vec<u8>>,
    /// The manifest's `buildId`.
    pub build_id: String,
    /// The manifest written to `program.manifest.json`.
    pub manifest: Manifest,
}

/// `E9999` for a packaging defect.
fn defect(text: impl Into<String>) -> Vec<Diagnostic> {
    vec![
        Diagnostic::new(
            Code::E9999,
            "The program could not be packaged; this is a compiler bug.",
        )
        .note(text.into())
        .help("please report it with the program that caused it"),
    ]
}

/// A material of the build: its plan and its shader.
struct BuiltMaterial<'p> {
    planned: &'p PlannedMaterial,
    shader: ShaderArtifact,
}

/// Packages the checked `program` of `project`. The project's source map holds the prelude
/// modules the program uses (the front end added them, decision 0044).
///
/// # Errors
/// `E6001` for a parameter block over the target profile's limit; `E9999` (or `E6100` from
/// Naga) for a compiler defect, `E9010` for a build mode this build does not implement.
pub fn package(
    project: &Project,
    program: &Program,
    input: &PackageInput<'_>,
) -> Result<Package, Vec<Diagnostic>> {
    let sources = &project.sources;
    let scene = program.entry().ok_or_else(|| {
        defect(format!(
            "the entry scene '{}' is not in the IR",
            program.entry_scene
        ))
    })?;
    let plan = checked_plan(program, input.profile)?;
    let materials: Vec<BuiltMaterial<'_>> = plan
        .materials
        .iter()
        .zip(material_shaders(program, &plan)?)
        .map(|(planned, shader)| BuiltMaterial { planned, shader })
        .collect();

    let mut layouts = Vec::new();
    for block in builtin_blocks() {
        if block.id == "builtin:frame" || block.id == "builtin:object" {
            let record = compute(&block.ty, block.id, block.wgsl_struct)
                .map_err(|e| defect(format!("the block '{}' has no layout: {e}", block.id)))?;
            layouts.push(record);
        }
    }
    let mut material_layouts: Vec<LayoutRecord> = plan
        .materials
        .iter()
        .filter_map(|m| m.layout.clone())
        .collect();
    material_layouts.sort_by(|a, b| a.id.cmp(&b.id));
    layouts.extend(material_layouts);

    let mut spans = SpanTable::new(sources);
    let symbols = symbols(program, scene, &plan, &mut spans).map_err(defect)?;
    let mut manifest_materials = Vec::with_capacity(materials.len());
    let mut shaders = Vec::with_capacity(materials.len());
    let mut shader_files = Vec::with_capacity(materials.len() * 2);
    for material in &materials {
        let planned = material.planned;
        let mut params = Vec::with_capacity(planned.params.len());
        for param in &planned.params {
            params.push(MaterialParam {
                name: param.name.clone(),
                ty: param.ty.clone(),
                span: spans.intern(param.span).map_err(defect)?,
            });
        }
        manifest_materials.push(Material {
            id: planned.symbol.to_string(),
            layout: planned.layout.as_ref().map(|l| l.id.clone()),
            shader: material.shader.sha256.clone(),
            resources: Vec::new(),
            params,
        });
    }
    for material in &materials {
        let artifact = &material.shader;
        for entry in &artifact.span_map.entries {
            spans.intern(entry.span).map_err(defect)?;
        }
        // Every span was interned above, so the lookup cannot fail.
        let document = artifact.span_map_document(|span| spans.intern(span).unwrap_or(0));
        let mut map_text = serde_json::to_string_pretty(&document).unwrap_or_default();
        map_text.push('\n');
        shaders.push(Shader {
            hash: artifact.sha256.clone(),
            url: artifact.wgsl_path(),
            map: artifact.map_path(),
            material: artifact.material.clone(),
            vertex_entry: artifact.vertex_entry.to_owned(),
            fragment_entry: artifact.fragment_entry.to_owned(),
            vertex_attributes: artifact
                .vertex_attributes
                .iter()
                .map(|a| a.name().to_owned())
                .collect(),
            surface_inputs: artifact
                .surface_inputs
                .iter()
                .map(|s| s.name().to_owned())
                .collect(),
        });
        shader_files.push((artifact.wgsl_path(), artifact.wgsl.clone().into_bytes()));
        shader_files.push((artifact.map_path(), map_text.into_bytes()));
    }

    // The binding spans come before app.js too, for the same reason.
    let manifest_scene = manifest_scene(scene, &plan, &mut spans).map_err(defect)?;

    // `app.js` last: the spans its run-time warnings report (clamped indices) follow every
    // other span, so a program's span ids do not depend on its function bodies.
    let runtime_file = format!("runtime.{}.js", h16(input.runtime_bundle));
    let app = emit_program(
        program,
        &plan,
        &ProgramParts {
            runtime_file: &runtime_file,
            layouts: &layouts,
            release: input.mode == BuildMode::Release,
        },
        &mut |span| spans.intern(span),
    )
    .map_err(defect)?;
    let app_map = source_map(APP_JS, &app.mappings, sources).map_err(defect)?;
    let span_entries = spans.into_entries();

    let source_entries: Vec<SourceEntry> = sources
        .files()
        .map(|file| SourceEntry {
            id: file.id().0,
            path: file.path().as_str().to_owned(),
            sha256: file.sha256_hex(),
        })
        .collect();
    let features: Vec<String> = Vec::new();
    let build_id = BuildIdentity {
        compiler_version: COMPILER_VERSION,
        language_version: LANGUAGE_VERSION,
        runtime_abi: RUNTIME_ABI,
        target_profile: input.profile.as_str(),
        features: &features,
        sources: source_entries
            .iter()
            .map(|s| (s.path.clone(), s.sha256.clone()))
            .collect(),
        assets: Vec::new(),
        config: &project.config_text,
    }
    .build_id();

    let runtime = &project.config.runtime;
    let number = |value: f64, what: &str| {
        Num::from_f64(value).ok_or_else(|| defect(format!("{what} is not finite")))
    };
    let manifest = Manifest {
        manifest_schema: MANIFEST_SCHEMA,
        runtime_abi: RUNTIME_ABI,
        language_version: LANGUAGE_VERSION.to_owned(),
        compiler_version: COMPILER_VERSION.to_owned(),
        build_id: build_id.clone(),
        target_profile: input.profile.as_str().to_owned(),
        required_capabilities: RequiredCapabilities {
            features,
            limits: BTreeMap::new(),
            wgsl_language_features: Vec::new(),
        },
        subsystems: Subsystems { physics: false },
        runtime_config: RuntimeConfig {
            fixed_step: number(runtime.fixed_step, "runtime.fixed_step")?,
            max_catch_up_steps: runtime.max_catch_up_steps,
            max_frame_delta: number(runtime.max_frame_delta, "runtime.max_frame_delta")?,
            max_entities: runtime.max_entities,
            pause_when_hidden: runtime.pause_when_hidden,
        },
        entry_scene: scene.name.clone(),
        sources: source_entries,
        spans: span_entries,
        symbols,
        layouts: layouts.iter().map(Layout::from_record).collect(),
        shaders,
        materials: manifest_materials,
        meshes: meshes(&plan).map_err(defect)?,
        assets: Vec::new(),
        scene: manifest_scene,
    };

    let html = index_html(&project.config.build.title, input.mode).ok_or_else(|| {
        vec![Diagnostic::new(
            Code::E9010,
            "Preview builds are specified for v0.1 but not implemented by this compiler build yet (planned for M6).",
        )]
    })?;
    let mut files = BTreeMap::new();
    files.insert(INDEX_HTML.to_owned(), html.into_bytes());
    files.insert(APP_JS.to_owned(), app.text.into_bytes());
    files.insert(APP_JS_MAP.to_owned(), app_map.to_json().into_bytes());
    files.insert(APP_DTS.to_owned(), emit_app_dts().into_bytes());
    files.insert(RUNTIME_DTS.to_owned(), input.runtime_declarations.to_vec());
    files.insert(runtime_file, input.runtime_bundle.to_vec());
    files.insert(MANIFEST_JSON.to_owned(), manifest.to_json().into_bytes());
    for (path, bytes) in shader_files {
        files.insert(path, bytes);
    }
    Ok(Package {
        files,
        build_id,
        manifest,
    })
}

/// The resource plan of `program`'s entry scene, checked against the limits of `profile`
/// (`E6001`, `spec/gpu-layout.md` section 8.3) before any shader is lowered.
///
/// # Errors
/// `E6001` for a parameter block over the profile's limit; `E9999` for a compiler defect.
pub fn checked_plan(
    program: &Program,
    profile: TargetProfile,
) -> Result<ResourcePlan, Vec<Diagnostic>> {
    let plan = plan_program(program).map_err(defect)?;
    let over = check_limits(
        &plan,
        profile.as_str(),
        profile.max_uniform_buffer_binding_size(),
    );
    if over.is_empty() { Ok(plan) } else { Err(over) }
}

/// The validated shader of every material of `plan`, in the plan's order (sorted by
/// symbol): user materials and the built-in ones of the embedded prelude alike, through the
/// shader lowering (decisions 0041 and 0044).
///
/// # Errors
/// `E9999` (or `E6100` from Naga) for a compiler defect.
pub fn material_shaders(
    program: &Program,
    plan: &ResourcePlan,
) -> Result<Vec<ShaderArtifact>, Vec<Diagnostic>> {
    plan.materials
        .iter()
        .map(|planned| {
            let material = program
                .materials()
                .find(|m| m.symbol == planned.symbol)
                .ok_or_else(|| {
                    defect(format!(
                        "the material '{}' is not in the IR",
                        planned.symbol
                    ))
                })?;
            emit_shader(&lower_material(program, material)?)
        })
        .collect()
}

/// The manifest's `symbols`: the scene, its cameras and entities, then every material and its
/// params, then every function compiled for the CPU (the entries of `app.js`'s `functions`).
fn symbols(
    program: &Program,
    scene: &ir::Scene,
    plan: &ResourcePlan,
    spans: &mut SpanTable<'_>,
) -> Result<Vec<SymbolEntry>, String> {
    let mut symbols = Vec::new();
    let mut add = |id: String, kind: SymbolKind, span: Span| -> Result<(), String> {
        symbols.push(SymbolEntry {
            id,
            kind,
            span: spans.intern(span)?,
        });
        Ok(())
    };
    add(scene.symbol.to_string(), SymbolKind::Scene, scene.span)?;
    for state in &scene.state {
        add(state.symbol.to_string(), SymbolKind::State, state.span)?;
    }
    for camera in &scene.cameras {
        add(camera.symbol.to_string(), SymbolKind::Camera, camera.span)?;
    }
    for entity in &scene.entities {
        add(entity.symbol.to_string(), SymbolKind::Entity, entity.span)?;
    }
    for material in &plan.materials {
        add(
            material.symbol.to_string(),
            SymbolKind::Material,
            material.declaration,
        )?;
        for param in &material.params {
            add(
                material.symbol.child(&param.name).to_string(),
                SymbolKind::Param,
                param.span,
            )?;
        }
    }
    for module in &program.modules {
        for item in &module.items {
            if let ir::Item::Function(function) = item
                && function.cpu_reachable
            {
                add(
                    function.symbol.to_string(),
                    SymbolKind::Function,
                    function.span,
                )?;
            }
        }
    }
    Ok(symbols)
}

fn nums(values: &[f32]) -> Result<Vec<Num>, String> {
    values
        .iter()
        .map(|v| Num::from_f32(*v).ok_or_else(|| format!("the value {v} is not finite")))
        .collect()
}

fn num(value: f32) -> Result<Num, String> {
    Num::from_f32(value).ok_or_else(|| format!("the value {value} is not finite"))
}

/// The manifest's `meshes`.
fn meshes(plan: &ResourcePlan) -> Result<Vec<Mesh>, String> {
    let mut meshes = Vec::with_capacity(plan.meshes.len());
    for (index, desc) in plan.meshes.iter().enumerate() {
        let index = u32::try_from(index).map_err(|_| "too many meshes".to_owned())?;
        let shape = match desc {
            MeshDesc::Box { size } => MeshShape::Box { size: nums(size)? },
            MeshDesc::Sphere {
                radius,
                segments,
                rings,
            } => MeshShape::Sphere {
                radius: num(*radius)?,
                segments: *segments,
                rings: *rings,
            },
            MeshDesc::Plane { size } => MeshShape::Plane { size: nums(size)? },
        };
        meshes.push(Mesh {
            id: ResourcePlan::mesh_id(index),
            shape,
        });
    }
    Ok(meshes)
}

/// The registry default of the `Scene` field `name` (fields that later milestones implement).
fn scene_default(name: &str) -> Result<ConstValue, String> {
    registry()
        .schema_field("Scene", name)
        .and_then(|field| field.default.as_ref())
        .and_then(crate::types::value::from_registry)
        .ok_or_else(|| format!("the registry has no constant default for 'Scene.{name}'"))
}

fn color_nums(value: &ConstValue, what: &str) -> Result<Vec<Num>, String> {
    match value {
        ConstValue::Color(rgba) => nums(rgba),
        _ => Err(format!("{what} is not a colour")),
    }
}

/// The manifest's `scene`.
fn manifest_scene(
    scene: &ir::Scene,
    plan: &ResourcePlan,
    spans: &mut SpanTable,
) -> Result<Scene, String> {
    let clear_color = match scene.fields.clear_color.source.as_const() {
        Some(ir::Value::Color(rgba)) => nums(rgba)?,
        _ => return Err("the scene's clear_color is not a constant colour".to_owned()),
    };
    let ambient_intensity = match scene_default("ambient_intensity")? {
        ConstValue::F32(v) => num(v)?,
        _ => return Err("the default of 'Scene.ambient_intensity' is not an f32".to_owned()),
    };
    let gravity = match scene_default("gravity")? {
        ConstValue::Vec3(v) => nums(&v)?,
        _ => return Err("the default of 'Scene.gravity' is not a vec3".to_owned()),
    };
    let fields = SceneFields {
        clear_color,
        ambient_color: color_nums(&scene_default("ambient_color")?, "Scene.ambient_color")?,
        ambient_intensity,
        gravity,
    };
    let cameras = scene
        .cameras
        .iter()
        .map(|camera| Camera {
            name: camera.name.clone(),
            symbol: camera.symbol.to_string(),
            projection: camera.projection.desc.kind().to_owned(),
            has_target: camera.target.is_some(),
            active: camera.active,
        })
        .collect();
    let mut entities = Vec::with_capacity(scene.entities.len());
    for entity in &scene.entities {
        let slot = entity.index as usize;
        let mesh = plan
            .entity_meshes
            .get(slot)
            .ok_or_else(|| format!("the entity '{}' is not in the plan", entity.symbol))?;
        let instance = plan
            .entity_instances
            .get(slot)
            .copied()
            .flatten()
            .and_then(|index| plan.instances.get(index as usize));
        entities.push(Entity {
            index: entity.index,
            name: entity.name.clone(),
            symbol: entity.symbol.to_string(),
            parent: entity.parent,
            mesh: mesh.map(ResourcePlan::mesh_id),
            material: instance.map(|i| EntityMaterial {
                id: i.material.to_string(),
                instance: i.index,
            }),
            light: None,
            body: None,
            collider: None,
            state: state_entries(
                scene,
                Owner::Entity {
                    index: entity.index,
                },
            ),
            update: has_behavior(scene, entity.index, &BehaviorKind::Update),
            fixed_update: has_behavior(scene, entity.index, &BehaviorKind::FixedUpdate),
        });
    }
    let material_instances = plan
        .instances
        .iter()
        .map(|instance| {
            Ok(MaterialInstance {
            index: instance.index,
            material: instance.material.to_string(),
            entity: instance.entity,
            params: instance
                .params
                .iter()
                .map(|param| {
                    Ok(InstanceParam {
                        name: param.name.clone(),
                        class: match (param.class, param.binding) {
                            (ParamClass::Initial, _) => ManifestClass::Initial,
                            (ParamClass::Imperative, _) => ManifestClass::Imperative,
                            (ParamClass::Bound, Some(binding)) => ManifestClass::Bound { binding },
                            (ParamClass::Bound, None) => {
                                return Err(format!(
                                    "the bound parameter '{}' has no binding",
                                    param.name
                                ));
                            }
                        },
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
            shareable: instance.shareable(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let bindings = manifest_bindings(scene, plan, spans)?;
    Ok(Scene {
        name: scene.name.clone(),
        symbol: scene.symbol.to_string(),
        fields,
        state: state_entries(scene, Owner::Scene),
        cameras,
        entities,
        material_instances,
        bindings,
        host_inputs: Vec::new(),
        lights: Vec::new(),
    })
}

/// The manifest's `bindings`, by id: targets and dependencies by static entity index, material
/// params by instance index (`spec/runtime-abi.md` section 5.2).
fn manifest_bindings(
    scene: &ir::Scene,
    plan: &ResourcePlan,
    spans: &mut SpanTable,
) -> Result<Vec<Binding>, String> {
    let instance = |entity: u32| -> Result<u32, String> {
        plan.entity_instances
            .get(entity as usize)
            .copied()
            .flatten()
            .ok_or_else(|| format!("the entity {entity} has no material instance to bind"))
    };
    let mut out = Vec::with_capacity(scene.bindings.len());
    for binding in &scene.bindings {
        let target = match &binding.target {
            ir::BindingTarget::Transform { entity, field } => BindingTarget::Transform {
                entity: *entity,
                field: field.clone(),
            },
            ir::BindingTarget::Visible { entity } => BindingTarget::Visible { entity: *entity },
            ir::BindingTarget::Param { entity, name } => BindingTarget::Param {
                instance: instance(*entity)?,
                name: name.clone(),
            },
            ir::BindingTarget::Camera { field } => BindingTarget::Camera {
                field: field.clone(),
            },
        };
        let mut deps = Vec::with_capacity(binding.deps.len());
        for dep in &binding.deps {
            deps.push(match dep {
                ir::BindingDep::State { name } => BindingDep::State { name: name.clone() },
                ir::BindingDep::Frame { name } => BindingDep::Frame { name: name.clone() },
                ir::BindingDep::EntityField { entity, field } => BindingDep::EntityField {
                    entity: *entity,
                    field: field.clone(),
                },
                ir::BindingDep::EntityState { entity, name } => BindingDep::EntityState {
                    entity: *entity,
                    name: name.clone(),
                },
                ir::BindingDep::Param { entity, name } => BindingDep::Param {
                    instance: instance(*entity)?,
                    name: name.clone(),
                },
            });
        }
        out.push(Binding {
            id: binding.id,
            target,
            deps,
            order: binding.order,
            span: spans.intern(binding.span)?,
        });
    }
    Ok(out)
}

/// The manifest's `state` entries of `owner`, in declaration order.
fn state_entries(scene: &crate::ir::Scene, owner: Owner) -> Vec<StateEntry> {
    scene
        .state
        .iter()
        .filter(|state| state.owner == owner)
        .map(|state| StateEntry {
            name: state.name.clone(),
            ty: state.ty.clone(),
            symbol: state.symbol.to_string(),
        })
        .collect()
}

/// Whether the entity `index` has a lifecycle function of `kind`.
fn has_behavior(scene: &crate::ir::Scene, index: u32, kind: &BehaviorKind) -> bool {
    scene
        .behaviors
        .iter()
        .any(|b| b.owner == (Owner::Entity { index }) && b.kind == *kind)
}
