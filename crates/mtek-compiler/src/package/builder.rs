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
//! 3. packages the referenced assets ([`crate::assets::pack`], decision 0058);
//! 4. interns the manifest's spans in this order: symbols (scene, cameras, entities, per
//!    material its declaration and its params, then the functions compiled for the CPU),
//!    material params, shader span maps, the declaring spans of the assets;
//! 5. emits `app.js` ([`crate::emit_js::emit_program`]) with the writers of `builtin:frame`,
//!    `builtin:object` and every material block and the CPU functions, whose run-time index
//!    checks intern their spans last;
//! 6. builds the manifest and writes the files with content-addressed names for the runtime
//!    bundle and the shaders.
//!
//! The manifest carries structure and constant scene fields only; entity and camera values
//! are set by `init(ctx)` (`spec/scenes.md` section 11); a light's kind and range are structure
//! and live in `scene.lights`, its colour and intensity are set by `init(ctx)`. A body and its
//! collider are structure and live in the entity (`spec/physics.md` section 2); `subsystems.physics`
//! is true when any body exists, and `gravity` is the scene field.

use std::collections::BTreeMap;

use crate::assets::{AssetStore, ImageRef, MeshRef, pack::Packed};
use crate::diagnostics::{Code, Diagnostic};
use crate::emit_js::{CpuFlags, ProgramParts, emit_app_dts, emit_program, source_map};
use crate::emit_wgsl::{ShaderArtifact, emit_shader};
use crate::ir::{self, BehaviorKind, MeshDesc, Owner, Program, Symbol};
use crate::layout::{LayoutRecord, builtin_blocks, compute};
use crate::lowering::shader::lower_material;
use crate::plan::{
    ParamClass, PlannedInstance, PlannedMaterial, ResourcePlan, check_limits, plan_program,
};
use crate::project::{
    Project, ResolvedHostInput, ResolvedHostOutput, validate_host_inputs, validate_host_outputs,
};
use crate::source::Span;
use crate::{
    BuildMode, COMPILER_VERSION, DEFAULT_LOOP_BUDGET, LANGUAGE_VERSION, RUNTIME_ABI, TargetProfile,
};

use super::html::{BOOTSTRAP_JS, index_html, preview_bootstrap};
use super::identity::{BuildIdentity, h16};
use super::manifest::{
    Binding, BindingDep, BindingTarget, Body, Camera, CharacterSettings, Clip, ClipChannel,
    Collider, Entity, EntityMaterial, Game, GameScene, InstanceParam, Layout,
    Light as ManifestLight, LightClass, LightClasses, LightKind as ManifestLightKind,
    MANIFEST_SCHEMA, Manifest, Material, MaterialInstance, MaterialParam, MaterialResource, Mesh,
    MeshShape, Num, ParamClass as ManifestClass, Particles, Prefab, PrefabMaterial, PrefabParam,
    Preview, RequiredCapabilities, ResourceValue, RuntimeConfig, Scene, SceneFields, Shader,
    SourceEntry, StateEntry, Subsystems, SymbolEntry, SymbolKind,
};
use super::spans::SpanTable;

/// The fixed file names of `spec/runtime-abi.md` section 2.
pub const INDEX_HTML: &str = "index.html";
pub const APP_JS: &str = "app.js";
pub const APP_JS_MAP: &str = "app.js.map";
pub const APP_DTS: &str = "app.d.ts";
pub const RUNTIME_DTS: &str = "runtime.d.ts";
pub const MANIFEST_JSON: &str = "program.manifest.json";
/// The directory of the content-addressed physics bundle (`physics/<h16>.js`, `spec/physics.md`
/// section 5).
pub const PHYSICS_DIR: &str = "physics";

/// What [`package`] needs besides the project and the IR.
#[derive(Clone, Copy, Debug)]
pub struct PackageInput<'a> {
    pub profile: TargetProfile,
    pub mode: BuildMode,
    /// The runtime bundle (`runtime.<h16>.js`).
    pub runtime_bundle: &'a [u8],
    /// The runtime host declarations (`runtime.d.ts`).
    pub runtime_declarations: &'a [u8],
    /// The physics bundle (`physics/<h16>.js`, decision 0063); written, and required, only when the
    /// program uses physics.
    pub physics_bundle: Option<&'a [u8]>,
    /// Treat the program as using physics although no source construct says so
    /// ([`CompileOptions::force_physics_subsystem`](crate::CompileOptions::force_physics_subsystem)).
    pub force_physics_subsystem: bool,
    /// The loop budget of a `preview` build ([`CompileOptions::loop_budget`](crate::CompileOptions::loop_budget));
    /// `None` is the default. Ignored by every other mode.
    pub loop_budget: Option<u32>,
    /// The assets the front end loaded (decision 0058).
    pub assets: &'a AssetStore,
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

/// The program files of one scene (decision 0141): `app.js`, `app.js.map` and
/// `program.manifest.json` for the entry scene, `app.<Scene>.js`, `app.<Scene>.js.map` and
/// `program.<Scene>.manifest.json` for every other scene of a multi-scene program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneFiles {
    pub module: String,
    pub source_map: String,
    pub manifest: String,
}

impl SceneFiles {
    /// The files of scene `name`; `entry` says whether it is the entry scene.
    #[must_use]
    pub fn of(name: &str, entry: bool) -> Self {
        if entry {
            Self {
                module: APP_JS.to_owned(),
                source_map: APP_JS_MAP.to_owned(),
                manifest: MANIFEST_JSON.to_owned(),
            }
        } else {
            Self {
                module: format!("app.{name}.js"),
                source_map: format!("app.{name}.js.map"),
                manifest: format!("program.{name}.manifest.json"),
            }
        }
    }
}

/// The storage name of a program's saved state (decision 0145): the project name (`[a-z0-9-]+`),
/// at most 64 characters, as the manifest schema allows.
fn storage_name(project: &str) -> String {
    let name: String = project.chars().take(64).collect();
    if name.is_empty() {
        "mtek".to_owned()
    } else {
        name
    }
}

/// The storage name and the old one to adopt (decision 0179): with a project `id`, the name is
/// `<name>.<id>` within the 64 characters the schema allows; the old name is the plain project
/// name, given only when `migrate_saves` asks for it.
fn storage_names(section: &crate::project::ProjectSection) -> (String, Option<String>) {
    let plain = storage_name(&section.name);
    match &section.id {
        None => (plain, None),
        Some(id) => {
            let room = 64 - id.len() - 1;
            let name: String = plain.chars().take(room).collect();
            let old = section.migrate_saves.then_some(plain);
            (format!("{name}.{id}"), old)
        }
    }
}

/// Packages the checked `program` of `project`. The project's source map holds the prelude
/// modules the program uses (the front end added them, decision 0044).
///
/// A program with several scenes (decision 0141) is packaged once per scene: the entry scene
/// into `app.js` and `program.manifest.json`, every other scene into `app.<Scene>.js` and
/// `program.<Scene>.manifest.json`, which `go_to` loads. The content-addressed files (shaders,
/// assets, the runtime and physics bundles) are shared; every manifest lists the scenes in
/// `game.scenes`. A single-scene program is packaged exactly as before.
///
/// # Errors
/// `E6001` for a parameter block over the target profile's limit; `E9999` (or `E6100` from
/// Naga) for a compiler defect.
pub fn package(
    project: &Project,
    program: &Program,
    input: &PackageInput<'_>,
) -> Result<Package, Vec<Diagnostic>> {
    let entry = program.entry().ok_or_else(|| {
        defect(format!(
            "the entry scene '{}' is not in the IR",
            program.entry_scene
        ))
    })?;
    let mut scenes: Vec<(String, Symbol)> = program
        .scenes()
        .map(|scene| (scene.name.clone(), scene.symbol.clone()))
        .collect();
    // Saved state and settings (decision 0145) are stored under the project's name.
    let names = program
        .scenes()
        .any(|scene| scene.state.iter().any(|state| state.persist.is_some()))
        .then(|| storage_names(&project.config.project));
    let (storage, legacy_storage) = match names {
        Some((storage, legacy)) => (Some(storage), legacy),
        None => (None, None),
    };
    if scenes.len() <= 1 {
        let game = storage.map(|storage| Game {
            scenes: Vec::new(),
            storage: Some(storage),
            legacy_storage: legacy_storage.clone(),
        });
        return package_scene(
            project,
            program,
            input,
            &SceneFiles::of(&entry.name, true),
            game.as_ref(),
        );
    }
    scenes.sort();
    let entry_symbol = entry.symbol.clone();
    let game = Game {
        scenes: scenes
            .iter()
            .map(|(name, symbol)| {
                let files = SceneFiles::of(name, *symbol == entry_symbol);
                GameScene {
                    name: name.clone(),
                    module: files.module,
                    manifest: files.manifest,
                }
            })
            .collect(),
        storage,
        legacy_storage,
    };
    let mut packaged = package_scene(
        project,
        program,
        input,
        &SceneFiles::of(&entry.name, true),
        Some(&game),
    )?;
    for (name, symbol) in &scenes {
        if *symbol == entry_symbol {
            continue;
        }
        let mut other = program.clone();
        other.entry_scene = symbol.clone();
        let scene = package_scene(
            project,
            &other,
            input,
            &SceneFiles::of(name, false),
            Some(&game),
        )?;
        for (path, bytes) in scene.files {
            // The page, the host declarations and the preview bootstrap belong to the entry.
            if path == INDEX_HTML || path == APP_DTS || path == BOOTSTRAP_JS {
                continue;
            }
            packaged.files.entry(path).or_insert(bytes);
        }
    }
    Ok(packaged)
}

/// Packages the scene `program.entry_scene` into `files`, with the manifest `game` object.
fn package_scene(
    project: &Project,
    program: &Program,
    input: &PackageInput<'_>,
    scene_files: &SceneFiles,
    game: Option<&Game>,
) -> Result<Package, Vec<Diagnostic>> {
    let sources = &project.sources;
    let scene = program.entry().ok_or_else(|| {
        defect(format!(
            "the entry scene '{}' is not in the IR",
            program.entry_scene
        ))
    })?;
    let plan = checked_plan(program, input.profile)?;
    let (host_inputs, host_outputs) = resolve_host_ports(project, scene);
    // `subsystems.physics` is true when any body exists (decision 0065); the library-only option
    // of decision 0063 forces it for the packaging tests and never turns it off.
    let uses_physics = input.force_physics_subsystem || program_uses_physics(program, scene);
    let physics_bundle = match (uses_physics, input.physics_bundle) {
        (false, _) => None,
        (true, Some(bundle)) => Some(bundle),
        (true, None) => {
            return Err(vec![
                Diagnostic::new(
                    Code::E9030,
                    "Cannot build: the physics bundle is not available to the compiler, but the program uses physics.",
                )
                .help("build the runtime first (`npm run build`), then rebuild the mtek command line tool"),
            ]);
        }
    };
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
            resources: planned
                .resources
                .iter()
                .map(|r| MaterialResource {
                    name: r.name.clone(),
                    kind: r.kind.to_owned(),
                    binding: r.binding,
                })
                .collect(),
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
        let map_text = metadata_json(&document, input.mode);
        shaders.push(Shader {
            lighting: artifact.lighting.then_some(1),
            vertex_deformation: artifact.vertex_deformation.then_some(1),
            hash: artifact.sha256.clone(),
            url: artifact.wgsl_path(),
            map: artifact.map_path(),
            material: artifact.material.clone(),
            vertex_entry: artifact.vertex_entry.to_owned(),
            instanced_vertex_entry: Some(artifact.instanced_vertex_entry.to_owned()),
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
    let compute_programs =
        super::compute::assemble(program, &mut spans, &mut layouts, &mut shader_files)?;

    // The assets: re-laid out meshes and copied images, with the declaring spans interned here.
    let packed = pack_assets(input.assets, &plan, &mut spans)?;

    // The binding spans come before app.js too, for the same reason.
    let clip_files = clip_source_files(scene, program);
    let manifest_scene = manifest_scene(
        scene,
        &plan,
        &packed,
        &mut spans,
        (&host_inputs, &host_outputs),
        input.assets,
        &clip_files,
    )
    .map_err(defect)?;
    let manifest_prefabs = manifest_prefabs(
        program,
        &plan,
        &packed,
        &mut spans,
        input.assets,
        &clip_files,
    )
    .map_err(defect)?;
    let clip_sources = clip_files
        .iter()
        .map(|file| clip_source(file, input.assets))
        .collect::<Result<Vec<_>, String>>()
        .map_err(defect)?;

    // `app.js` last: the spans its run-time warnings report (clamped indices) follow every
    // other span, so a program's span ids do not depend on its function bodies.
    let runtime_file = format!("runtime.{}.js", h16(input.runtime_bundle));
    // A preview build is a release build with the loop budget (decision 0075): the budget is
    // clamped to at least 1, the manifest says what the program was instrumented with.
    let preview = (input.mode == BuildMode::Preview).then(|| Preview {
        loop_budget: input.loop_budget.unwrap_or(DEFAULT_LOOP_BUDGET).max(1),
    });
    let app = emit_program(
        program,
        &plan,
        &ProgramParts {
            runtime_file: &runtime_file,
            layouts: &layouts,
            manifest_file: &scene_files.manifest,
            source_map_file: &scene_files.source_map,
            flags: CpuFlags {
                release: matches!(input.mode, BuildMode::Release | BuildMode::Preview),
                loop_budget: preview.is_some(),
            },
        },
        &mut |span| spans.intern(span),
    )
    .map_err(defect)?;
    let app_map = source_map(&scene_files.module, &app.mappings, sources).map_err(defect)?;
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
        assets: packed.sources.clone(),
        config: &project.config_text,
        preview_loop_budget: preview.as_ref().map(|preview| preview.loop_budget),
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
        subsystems: Subsystems {
            physics: uses_physics,
            physics_module: physics_bundle
                .map(|bundle| format!("{PHYSICS_DIR}/{}.js", h16(bundle))),
        },
        runtime_config: RuntimeConfig {
            fixed_step: number(runtime.fixed_step, "runtime.fixed_step")?,
            max_catch_up_steps: runtime.max_catch_up_steps,
            max_frame_delta: number(runtime.max_frame_delta, "runtime.max_frame_delta")?,
            max_entities: runtime.max_entities,
            pause_when_hidden: runtime.pause_when_hidden,
        },
        game: game.cloned(),
        preview,
        entry_scene: scene.name.clone(),
        sources: source_entries,
        spans: span_entries,
        symbols,
        layouts: layouts.iter().map(Layout::from_record).collect(),
        shaders,
        materials: manifest_materials,
        compute_programs,
        meshes: meshes(&plan, &packed, input.assets).map_err(defect)?,
        clip_sources,
        assets: packed.assets.clone(),
        prefabs: manifest_prefabs,
        scene: manifest_scene,
    };

    let html = index_html(&project.config.build.title, input.mode);
    let mut files = BTreeMap::new();
    files.insert(INDEX_HTML.to_owned(), html.into_bytes());
    if input.mode == BuildMode::Preview {
        files.insert(BOOTSTRAP_JS.to_owned(), preview_bootstrap().into_bytes());
    }
    files.insert(scene_files.module.clone(), app.text.into_bytes());
    files.insert(
        scene_files.source_map.clone(),
        app_map.to_json().into_bytes(),
    );
    files.insert(
        APP_DTS.to_owned(),
        emit_app_dts(&host_inputs, &host_outputs).into_bytes(),
    );
    files.insert(RUNTIME_DTS.to_owned(), input.runtime_declarations.to_vec());
    files.insert(runtime_file, input.runtime_bundle.to_vec());
    if let (Some(bundle), Some(module)) = (physics_bundle, &manifest.subsystems.physics_module) {
        files.insert(module.clone(), bundle.to_vec());
    }
    files.insert(
        scene_files.manifest.clone(),
        metadata_json(&manifest, input.mode).into_bytes(),
    );
    for (path, bytes) in shader_files {
        files.insert(path, bytes);
    }
    for (path, bytes) in packed.files {
        files.insert(path, bytes);
    }
    Ok(Package {
        files,
        build_id,
        manifest,
    })
}

/// Production metadata keeps all diagnostics and source mappings without shipping indentation.
/// Development and test packages keep the readable form; both represent the same JSON values.
fn metadata_json(value: &impl serde::Serialize, mode: BuildMode) -> String {
    let mut text = if matches!(mode, BuildMode::Release | BuildMode::Preview) {
        serde_json::to_string(value)
    } else {
        serde_json::to_string_pretty(value)
    }
    .unwrap_or_default();
    text.push('\n');
    text
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

/// The manifest's `symbols`: the scene, its cameras and entities (the static instances of
/// prefabs included), then every material and its params, then every prefab with its params and
/// state (the keys of `app.js`'s `prefabs`), then every function compiled for the CPU (the
/// entries of `functions`).
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
    for prefab in program.prefabs() {
        add(prefab.symbol.to_string(), SymbolKind::Prefab, prefab.span)?;
        for param in &prefab.params {
            add(
                prefab.symbol.child(&param.name).to_string(),
                SymbolKind::Param,
                param.span,
            )?;
        }
        for state in &prefab.state {
            add(state.symbol.to_string(), SymbolKind::State, state.span)?;
        }
    }
    for compute in program.computes() {
        add(
            compute.symbol.to_string(),
            SymbolKind::Compute,
            compute.span,
        )?;
        add(
            compute.kernel.symbol.to_string(),
            SymbolKind::Function,
            compute.kernel.span,
        )?;
        for param in &compute.params {
            add(
                compute.symbol.child(&param.name).to_string(),
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

/// The manifest's `body` of an entity (`spec/runtime-abi.md` section 5.2, decision 0065).
pub(crate) fn manifest_body(body: &ir::Body) -> Result<Body, String> {
    Ok(match body.desc {
        ir::BodyDesc::Static => Body::Static,
        ir::BodyDesc::Kinematic { character } => Body::Kinematic {
            character: character
                .map(|c| {
                    Ok::<_, String>(CharacterSettings {
                        max_slope: num(c.max_slope)?,
                        step_height: num(c.step_height)?,
                        step_min_width: num(c.step_min_width)?,
                        snap_to_ground: num(c.snap_to_ground)?,
                        skin: num(c.skin)?,
                        carry: c.carry,
                    })
                })
                .transpose()?,
        },
        ir::BodyDesc::Dynamic {
            mass,
            linear_damping,
            angular_damping,
            continuous,
        } => Body::Dynamic {
            mass: num(mass)?,
            linear_damping: num(linear_damping)?,
            angular_damping: num(angular_damping)?,
            continuous,
        },
    })
}

/// The manifest's `collider` of an entity.
pub(crate) fn manifest_collider(collider: &ir::Collider) -> Result<Collider, String> {
    Ok(match collider.desc {
        ir::ColliderDesc::Box {
            size,
            sensor,
            friction,
            restitution,
        } => Collider::Box {
            size: nums(&size)?,
            sensor,
            friction: num(friction)?,
            restitution: num(restitution)?,
        },
        ir::ColliderDesc::Sphere {
            radius,
            sensor,
            friction,
            restitution,
        } => Collider::Sphere {
            radius: num(radius)?,
            sensor,
            friction: num(friction)?,
            restitution: num(restitution)?,
        },
        ir::ColliderDesc::Capsule {
            radius,
            height,
            sensor,
            friction,
            restitution,
        } => Collider::Capsule {
            radius: num(radius)?,
            height: num(height)?,
            sensor,
            friction: num(friction)?,
            restitution: num(restitution)?,
        },
    })
}

/// Whether the program needs the physics subsystem: the entry scene has a body, or a prefab of
/// the program declares one (a prefab can be spawned from any handler, so the runtime must be
/// able to create its body; spawn sites are not tracked, decision 0065).
fn program_uses_physics(program: &Program, scene: &ir::Scene) -> bool {
    scene.entities.iter().any(|entity| entity.body.is_some())
        || program
            .modules
            .iter()
            .flat_map(|module| module.items.iter())
            .any(|item| matches!(item, ir::Item::Prefab(prefab) if prefab.entity.body.is_some()))
}

/// The asset meshes of `plan.meshes` and the image values of the resource params of its
/// material instances: what `mtek build` and `mtek inspect --assets` package.
#[must_use]
pub fn asset_references(plan: &ResourcePlan) -> (Vec<MeshRef>, Vec<ImageRef>) {
    let meshes: Vec<MeshRef> = plan
        .meshes
        .iter()
        .filter_map(|desc| match desc {
            MeshDesc::Asset {
                file,
                mesh,
                primitive,
            } => Some(MeshRef {
                file: file.clone(),
                mesh: mesh.clone(),
                primitive: *primitive as usize,
            }),
            _ => None,
        })
        .collect();
    let images: Vec<ImageRef> = plan
        .instances
        .iter()
        .chain(
            plan.prefabs
                .iter()
                .filter_map(|prefab| prefab.instance.as_ref()),
        )
        .flat_map(|instance| instance.params.iter())
        .filter_map(|param| match &param.value {
            Some(ir::Value::Image(image)) => Some(ImageRef {
                source: image.source.clone(),
                space: image.space,
                mipmapped: image.mipmapped,
            }),
            _ => None,
        })
        .collect();
    (meshes, images)
}

/// Package the assets the plan references.
fn pack_assets(
    store: &AssetStore,
    plan: &ResourcePlan,
    spans: &mut SpanTable,
) -> Result<Packed, Vec<Diagnostic>> {
    let (meshes, images) = asset_references(plan);
    crate::assets::pack::pack(store, &meshes, &images, &mut |span| spans.intern(span).ok())
}

/// The manifest's `meshes`.
fn meshes(plan: &ResourcePlan, packed: &Packed, assets: &AssetStore) -> Result<Vec<Mesh>, String> {
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
            MeshDesc::Asset {
                file,
                mesh,
                primitive,
            } => {
                let key = MeshRef {
                    file: file.clone(),
                    mesh: mesh.clone(),
                    primitive: *primitive as usize,
                };
                let location = packed.meshes.get(&key).ok_or_else(|| {
                    format!("the asset mesh '{mesh}' of '{file}' was not packaged")
                })?;
                MeshShape::Asset {
                    asset: location.asset.clone(),
                    primitive: location.primitive,
                    skin: assets
                        .glb(file)
                        .and_then(|asset| {
                            asset
                                .file
                                .skins
                                .iter()
                                .find(|s| s.mesh == *mesh && s.primitive == *primitive as usize)
                        })
                        .map(|s| s.skin.clone()),
                }
            }
        };
        meshes.push(Mesh {
            id: ResourcePlan::mesh_id(index),
            shape,
        });
    }
    Ok(meshes)
}

/// The manifest's `scene`.
fn resolve_host_ports(
    project: &Project,
    scene: &ir::Scene,
) -> (Vec<ResolvedHostInput>, Vec<ResolvedHostOutput>) {
    let mut sink = crate::diagnostics::Diagnostics::new();
    let checked = crate::types::CheckedScene {
        def: None,
        name: scene.name.clone(),
        name_span: scene.span,
        span: scene.span,
        fields: Vec::new(),
        state: scene
            .state
            .iter()
            .filter(|s| s.owner == ir::Owner::Scene)
            .map(|s| crate::types::CheckedState {
                def: None,
                name: s.name.clone(),
                name_span: s.span,
                span: s.span,
                ty: s.ty.clone(),
            })
            .collect(),
        objects: Vec::new(),
        entities: Vec::new(),
    };
    let inputs = validate_host_inputs(
        &project.config.host_inputs,
        &checked,
        &states_feeding_material_colors(scene),
        &mut sink,
    );
    let outputs = validate_host_outputs(&project.config.host_outputs, &checked, &mut sink);
    (inputs, outputs)
}

/// The scene `state` that some `bind(..)` reads to set a `color` param of a material instance. A host input of such a state gets
/// the `color-hex-opaque` codec (`spec/runtime-abi.md` section 6.3: a translucent value is rejected by `setInput` itself
/// with `E8100`, not accepted and then refused when the binding runs). A colour state that feeds nothing opaque stays `color-hex`.
fn states_feeding_material_colors(scene: &ir::Scene) -> std::collections::BTreeSet<String> {
    scene
        .bindings
        .iter()
        .filter(|binding| {
            matches!(binding.target, ir::BindingTarget::Param { .. }) && binding.ty == "color"
        })
        .flat_map(|binding| &binding.deps)
        .filter_map(|dep| match dep {
            ir::BindingDep::State { name } => Some(name.clone()),
            _ => None,
        })
        .collect()
}

fn manifest_scene(
    scene: &ir::Scene,
    plan: &ResourcePlan,
    packed: &Packed,
    spans: &mut SpanTable,
    (host_inputs, host_outputs): (&[ResolvedHostInput], &[ResolvedHostOutput]),
    assets: &AssetStore,
    clip_files: &[String],
) -> Result<Scene, String> {
    let clear_color = match scene.fields.clear_color.source.as_const() {
        Some(ir::Value::Color(rgba)) => nums(rgba)?,
        _ => return Err("the scene's clear_color is not a constant colour".to_owned()),
    };
    let ambient_color = match scene.fields.ambient_color.source.as_const() {
        Some(ir::Value::Color(rgba)) => nums(rgba)?,
        _ => return Err("the scene's ambient_color is not a constant colour".to_owned()),
    };
    let ambient_intensity = match scene.fields.ambient_intensity.source.as_const() {
        Some(ir::Value::F32(v)) => num(*v)?,
        _ => return Err("the scene's ambient_intensity is not a constant f32".to_owned()),
    };
    let gravity = match scene.fields.gravity.source.as_const() {
        Some(ir::Value::Vec3(v)) => nums(v)?,
        _ => return Err("the scene's gravity is not a constant vec3".to_owned()),
    };
    let fields = SceneFields {
        clear_color,
        ambient_color,
        ambient_intensity,
        gravity,
    };
    let cameras = scene
        .cameras
        .iter()
        .map(|camera| {
            let exposure = match camera.exposure.source.as_const() {
                Some(ir::Value::F32(value)) => num(*value)?,
                _ => {
                    return Err(format!(
                        "the exposure of camera '{}' is not a constant f32",
                        camera.name
                    ));
                }
            };
            Ok(Camera {
                name: camera.name.clone(),
                symbol: camera.symbol.to_string(),
                projection: camera.projection.desc.kind().to_owned(),
                has_target: camera.target.is_some(),
                active: camera.active,
                exposure,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut entities = Vec::with_capacity(scene.entities.len());
    let mut lights = Vec::new();
    for entity in &scene.entities {
        let slot = entity.index as usize;
        // Lights are numbered in stable instance order; their colour and intensity are set by
        // `init(ctx)` and the entity's bindings, the manifest carries the structure.
        let light = match &entity.light {
            Some(light) => {
                let index = u32::try_from(lights.len())
                    .map_err(|_| "the scene has too many lights".to_owned())?;
                lights.push(ManifestLight {
                    index,
                    entity: entity.index,
                    kind: match light.kind {
                        ir::LightKind::Directional => ManifestLightKind::Directional,
                        ir::LightKind::Point { range } => {
                            ManifestLightKind::Point { range: num(range)? }
                        }
                    },
                    classes: LightClasses {
                        color: light_class(light.color_update)?,
                        intensity: light_class(light.intensity_update)?,
                    },
                });
                Some(index)
            }
            None => None,
        };
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
            light,
            body: entity.body.as_ref().map(manifest_body).transpose()?,
            collider: entity
                .collider
                .as_ref()
                .map(manifest_collider)
                .transpose()?,
            state: state_entries(
                scene,
                Owner::Entity {
                    index: entity.index,
                },
            ),
            update: has_behavior(scene, entity.index, &BehaviorKind::Update),
            fixed_update: has_behavior(scene, entity.index, &BehaviorKind::FixedUpdate),
            tag: entity.tag.clone(),
            particles: entity
                .particles
                .as_ref()
                .map(manifest_particles)
                .transpose()?,
            clip: manifest_clip(entity, assets)?,
            clips_from: clips_from_index(entity, clip_files)?,
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
                params: instance_params(instance, packed)?,
                shareable: instance.shareable(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let bindings = manifest_bindings(&scene.bindings, spans, |entity| {
        plan.entity_instances
            .get(entity as usize)
            .copied()
            .flatten()
            .ok_or_else(|| format!("the entity {entity} has no material instance to bind"))
    })?;
    Ok(Scene {
        name: scene.name.clone(),
        symbol: scene.symbol.to_string(),
        fields,
        state: state_entries(scene, Owner::Scene),
        cameras,
        entities,
        material_instances,
        bindings,
        host_inputs: host_inputs
            .iter()
            .map(ResolvedHostInput::to_manifest)
            .collect(),
        host_outputs: host_outputs
            .iter()
            .map(ResolvedHostOutput::to_manifest)
            .collect(),
        lights,
    })
}

/// The manifest's value of a resource param: the built-in texture or sampler it holds, or the
/// packaged image (`ResourceValue::Asset`, decision 0058).
fn resource_value(value: Option<&ir::Value>, packed: &Packed) -> Option<ResourceValue> {
    match value? {
        ir::Value::Texture(name) | ir::Value::Sampler(name) => {
            Some(ResourceValue::Builtin { name: name.clone() })
        }
        ir::Value::Image(image) => packed
            .images
            .get(&(image.source.clone(), image.space))
            .map(|url| ResourceValue::Asset { asset: url.clone() }),
        _ => None,
    }
}

/// The params of a planned material instance as the manifest lists them.
fn instance_params(
    instance: &PlannedInstance,
    packed: &Packed,
) -> Result<Vec<InstanceParam>, String> {
    instance
        .params
        .iter()
        .map(|param| {
            Ok(InstanceParam {
                name: param.name.clone(),
                class: match (param.class, param.binding) {
                    (ParamClass::Initial, _) => ManifestClass::Initial,
                    (ParamClass::Imperative, _) => ManifestClass::Imperative,
                    (ParamClass::Resource, _) => ManifestClass::Resource {
                        value: resource_value(param.value.as_ref(), packed).ok_or_else(|| {
                            format!(
                                "the resource parameter '{}' has no packaged value",
                                param.name
                            )
                        })?,
                    },
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
        .collect()
}

/// The manifest's `prefabs`: one entry for every prefab the program spawns, sorted by symbol
/// (decision 0064). Entity 0 of its bindings is the instance and material instance 0 its material.
fn manifest_prefabs(
    program: &Program,
    plan: &ResourcePlan,
    packed: &Packed,
    spans: &mut SpanTable,
    assets: &AssetStore,
    clip_files: &[String],
) -> Result<Vec<Prefab>, String> {
    let mut out = Vec::with_capacity(plan.prefabs.len());
    for planned in &plan.prefabs {
        let item = program
            .prefabs()
            .find(|p| p.symbol == planned.symbol)
            .ok_or_else(|| format!("the prefab '{}' is not in the IR", planned.symbol))?;
        let has = |kind: &BehaviorKind| item.behaviors.iter().any(|b| b.kind == *kind);
        let bindings = manifest_bindings(&item.bindings, spans, |entity| {
            if entity == 0 && planned.instance.is_some() {
                Ok(0)
            } else {
                Err(format!(
                    "the prefab '{}' binds the material of entity {entity}, which it does not have",
                    planned.symbol
                ))
            }
        })?;
        out.push(Prefab {
            symbol: planned.symbol.to_string(),
            name: planned.name.clone(),
            params: planned
                .params
                .iter()
                .map(|p| PrefabParam {
                    name: p.name.clone(),
                    ty: p.ty.clone(),
                })
                .collect(),
            mesh: planned.mesh.map(ResourcePlan::mesh_id),
            material: planned
                .instance
                .as_ref()
                .map(|instance| {
                    Ok::<_, String>(PrefabMaterial {
                        id: instance.material.to_string(),
                        params: instance_params(instance, packed)?,
                        shareable: instance.shareable(),
                    })
                })
                .transpose()?,
            body: item.entity.body.as_ref().map(manifest_body).transpose()?,
            collider: item
                .entity
                .collider
                .as_ref()
                .map(manifest_collider)
                .transpose()?,
            state: item
                .state
                .iter()
                .map(|state| StateEntry {
                    name: state.name.clone(),
                    ty: state.ty.clone(),
                    symbol: state.symbol.to_string(),
                    shared: false,
                    persist: None,
                    stored_type: state.stored_type.clone(),
                })
                .collect(),
            update: has(&BehaviorKind::Update),
            fixed_update: has(&BehaviorKind::FixedUpdate),
            bindings,
            span: spans.intern(item.span)?,
            tag: item.entity.tag.clone(),
            particles: item
                .entity
                .particles
                .as_ref()
                .map(manifest_particles)
                .transpose()?,
            clip: manifest_clip(&item.entity, assets)?,
            clips_from: clips_from_index(&item.entity, clip_files)?,
        });
    }
    Ok(out)
}

/// The manifest's emitter (decision 0155).
fn manifest_particles(particles: &ir::Particles) -> Result<Particles, String> {
    Ok(Particles {
        rate: num(particles.rate)?,
        lifetime: num(particles.lifetime)?,
        speed: num(particles.speed)?,
        size: num(particles.size)?,
        gravity: num(particles.gravity)?,
    })
}

/// The GLB files whose skeletons entities and prefabs take clips from (`clips_from`, decision 0223),
/// sorted and without repeats: the order of the manifest's `clipSources`.
fn clip_source_files(scene: &ir::Scene, program: &Program) -> Vec<String> {
    let mut files: Vec<String> = scene
        .entities
        .iter()
        .chain(program.prefabs().map(|prefab| &prefab.entity))
        .filter_map(|entity| entity.clips_from.clone())
        .collect();
    files.sort();
    files.dedup();
    files
}

/// The position of the entity's `clips_from` file in `clip_files`.
fn clips_from_index(entity: &ir::Entity, clip_files: &[String]) -> Result<Option<u32>, String> {
    let Some(file) = &entity.clips_from else {
        return Ok(None);
    };
    let at = clip_files
        .iter()
        .position(|candidate| candidate == file)
        .ok_or_else(|| {
            format!(
                "the clips_from '{file}' of '{}' was not collected",
                entity.name
            )
        })?;
    u32::try_from(at)
        .map(Some)
        .map_err(|_| "too many clip sources".to_owned())
}

/// The skeleton of `file` that supplies clips: its first skin with a clip, without the vertex
/// influences (the manifest needs nodes, joints, inverse binds and clips only).
fn clip_source(file: &str, assets: &AssetStore) -> Result<crate::assets::skin::Skin, String> {
    let declared = assets
        .glb(file)
        .ok_or_else(|| format!("the clips_from '{file}' names a GLB that was not loaded"))?;
    let mut skin = declared
        .file
        .skins
        .iter()
        .find(|skin| !skin.skin.clips.is_empty())
        .map(|skin| skin.skin.clone())
        .ok_or_else(|| format!("the clips_from '{file}' has no skeletal clips"))?;
    skin.indices = Vec::new();
    skin.weights = Vec::new();
    Ok(skin)
}

/// The manifest's clip (decision 0156): keyframes copied out of the GLB, because lowering has
/// no asset store. A clip the checker accepted and that cannot be found here is a defect.
fn manifest_clip(entity: &ir::Entity, assets: &AssetStore) -> Result<Option<Clip>, String> {
    let Some(name) = &entity.clip else {
        return Ok(None);
    };
    let Some(mesh) = &entity.mesh else {
        return Err(format!(
            "entity '{}' has a clip without a mesh",
            entity.name
        ));
    };
    let MeshDesc::Asset { file, mesh, .. } = &mesh.desc else {
        return Err(format!(
            "the clip of entity '{}' is not on an asset mesh",
            entity.name
        ));
    };
    if let Some(source) = &entity.clips_from {
        // The name is one of the source skeleton's clips (decision 0223); the keyframes are retargeted at mount.
        let skin = clip_source(source, assets)?;
        let clip = skin
            .clips
            .iter()
            .find(|clip| clip.name == *name)
            .ok_or_else(|| {
                format!(
                    "the clip '{name}' of entity '{}' is not a clip of '{source}'",
                    entity.name
                )
            })?;
        return Ok(Some(Clip {
            name: clip.name.clone(),
            duration: num(clip.duration)?,
            channels: Vec::new(),
        }));
    }
    let declared = assets.glb(file).ok_or_else(|| {
        format!(
            "the clip of entity '{}' names a GLB that was not loaded",
            entity.name
        )
    })?;
    let clip = declared.file.clip_for(name, mesh).ok_or_else(|| {
        format!(
            "the clip '{name}' of entity '{}' does not play on '{mesh}'",
            entity.name
        )
    })?;
    if declared.file.skins.iter().any(|skin| skin.mesh == *mesh) {
        return Ok(Some(Clip {
            name: clip.name,
            duration: num(clip.duration)?,
            channels: Vec::new(),
        }));
    }
    let channels = clip
        .channels
        .iter()
        .map(|channel| {
            Ok(ClipChannel {
                path: channel.path.as_str().to_owned(),
                interpolation: channel.interpolation.as_str().to_owned(),
                times: channel
                    .times
                    .iter()
                    .copied()
                    .map(num)
                    .collect::<Result<Vec<_>, _>>()?,
                values: channel
                    .values
                    .iter()
                    .copied()
                    .map(num)
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Some(Clip {
        name: clip.name,
        duration: num(clip.duration)?,
        channels,
    }))
}

/// The manifest's update class of a light field: a light field is never a resource.
fn light_class(update: ir::UpdateClass) -> Result<LightClass, String> {
    match update {
        ir::UpdateClass::Initial => Ok(LightClass::Initial),
        ir::UpdateClass::Imperative => Ok(LightClass::Imperative),
        ir::UpdateClass::Bound => Ok(LightClass::Bound),
        ir::UpdateClass::Resource => {
            Err("a light field has the update class `resource`".to_owned())
        }
    }
}

/// The manifest's `bindings`, by id: targets and dependencies by static entity index, material
/// params by instance index (`spec/runtime-abi.md` section 5.2). `instance` names the material
/// instance of an entity.
fn manifest_bindings(
    bindings: &[ir::Binding],
    spans: &mut SpanTable,
    instance: impl Fn(u32) -> Result<u32, String>,
) -> Result<Vec<Binding>, String> {
    let mut out = Vec::with_capacity(bindings.len());
    for binding in bindings {
        let target = match &binding.target {
            ir::BindingTarget::Bounds { entity, field } => BindingTarget::Bounds {
                entity: *entity,
                field: field.clone(),
            },
            ir::BindingTarget::Transform { entity, field } => BindingTarget::Transform {
                entity: *entity,
                field: field.clone(),
            },
            ir::BindingTarget::Visible { entity } => BindingTarget::Visible { entity: *entity },
            ir::BindingTarget::Param { entity, name } => BindingTarget::Param {
                instance: instance(*entity)?,
                name: name.clone(),
            },
            ir::BindingTarget::Camera { camera, field } => BindingTarget::Camera {
                field: field.clone(),
                camera: Some(camera.clone()),
            },
            ir::BindingTarget::Light { entity, field } => BindingTarget::Light {
                entity: *entity,
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
                ir::BindingDep::Light { entity, field } => BindingDep::Light {
                    entity: *entity,
                    field: field.clone(),
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
            shared: state.shared,
            persist: state.persist.clone(),
            stored_type: state.stored_type.clone(),
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
