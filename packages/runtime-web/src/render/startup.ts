/**
 * Scene startup (`spec/runtime-abi.md` sections 4.3 and 6.1, `spec/scenes.md` section 11): everything
 * `mountMtek` does between the startup shader modules and resolving.
 *
 *  1. The binding plan and the material arenas (one slot per material instance).
 *  2. The world with its records at the registry defaults; `scenes.<Entry>.init(ctx)` sets every value,
 *     material params through the generated writers into the arenas; transforms are propagated. Identical
 *     `shareable` instances then share one parameter block (`MaterialStore.shareIdentical`, decision 0059).
 *  3. The meshes are generated (primitive shapes) or read from the loaded asset files, and uploaded; the
 *     material store made the textures of image assets (`options.assets`, decision 0060) with its instances.
 *  4. Every startup pipeline (one per material, for the surface's colour format, and the instanced
 *     variant of each material that has entities to instance) is created; a failure is `E8051` and
 *     fails the mount.
 *  5. The blended variant of every material known to blend (a Sprite, an instance whose initial colour alpha is
 *     below 1) is created too, so its first frame is already translucent (decision 0173); any other is made lazily.
 *  6. The renderer allocates the frame and object blocks.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import type { DecodedImages, LoadedAssets } from "../assets/loader.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { CheckedProgram } from "../scene/program.js";
import type { ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import { Bindings } from "../scene/bindings.js";
import { buildPrefabRuntimes } from "../scene/dynamic.js";
import { World, type CpuServices } from "../scene/world.js";
import { MaterialStore } from "./materials.js";
import { MeshStore } from "./meshes.js";
import {MipmapGenerator} from "./mipmaps.js";
import type {MtekRenderingOptions} from "./options.js";
import { instancingCandidates } from "./instancing.js";
import { BindingPlan, PipelineCache, alwaysBlends, canBlend, materialPipelineKey, type PipelineResult } from "./pipelines.js";
import type { TextureOverrides } from "./resources.js";
import { Renderer, blendedKey, type MaterialPipeline, type RenderSurface } from "./renderer.js";
import { SceneLighting, sceneLightingProblem } from "./scene-lighting.js";

export interface SceneStartupOptions {
  readonly rendering?:MtekRenderingOptions;
  /** Reject stale asynchronous candidate work before allocating or publishing scene resources. */
  readonly assertActive?: () => void;
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly program: CheckedProgram;
  readonly device: Pick<GPUDevice, "queue" | "limits" | "pushErrorScope" | "popErrorScope"> & Partial<Pick<GPUDevice, "createCommandEncoder" | "createComputePipeline">>;
  readonly registry: ResourceRegistry;
  readonly surface: RenderSurface & { readonly colorFormat: GPUTextureFormat };
  /** Startup shader modules by shader hash (`host/shaders.ts`). */
  readonly modules: ReadonlyMap<string, GPUShaderModule>;
  /** Run-time diagnostics of initialisation and of later frames. */
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /** `random`, `is_key_down` and `print` for generated code, including `init`. */
  readonly services?: CpuServices;
  /** Called with the new world before its `init` runs (the scene of a `go_to` binds its game hooks to it). */
  readonly onWorld?: (world: World) => void;
  /**
   * When set (hot reload), new materials reuse pipelines already in this cache for unchanged
   * shader hashes so a colour edit creates no pipeline (`spec/runtime-abi.md` section 11.3).
   * Must be paired with `bindingPlan` from the same previous scene (bind groups stay compatible).
   */
  readonly pipelineCache?: PipelineCache;
  /** Reused with `pipelineCache` so new bind groups match the cached pipelines. */
  readonly bindingPlan?: BindingPlan;
  /**
   * Device recovery (`spec/runtime-abi.md` section 9.4, decision 0056): rebuild every GPU resource for a new
   * device around the retained CPU state. `init` does not run again; the world is pointed at the new
   * material arenas and refills them from its mirrors. A material whose shader module is missing or whose
   * pipeline cannot be created is reported (phase `runtime:device`) and not drawn instead of failing the rebuild.
   */
  readonly recover?: { readonly world: World; readonly bindings: Bindings };
  /** `options.test.textures`: replacement pixels for the built-in textures (`spec/runtime-abi.md` section 10.2). */
  readonly textures?: TextureOverrides;
  /** Group compatible draws into instanced draws (default true; `options.test.disableInstancing` makes it false). */
  readonly instancing?: boolean;
  /**
   * The verified files of the manifest's `assets` table and the decoded images (`assets/loader.ts`): the meshes and
   * textures that come from assets are made from them. The caller closes the bitmaps once the scene has started
   * (the textures are filled by then). Required when the manifest has assets.
   */
  readonly assets?: { readonly files: LoadedAssets; readonly images: DecodedImages };
}

/** The running scene: its CPU world, its GPU state and its renderer. */
export interface Scene {
  readonly world: World;
  /** The `bind(..)` of the scene, evaluated in phase 5. */
  readonly bindings: Bindings;
  readonly materials: MaterialStore;
  readonly meshes: MeshStore;
  readonly plan: BindingPlan;
  readonly pipelines: PipelineCache;
  readonly renderer: Renderer;
}

export type SceneStartupResult = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

/** The result for a material whose shader module could not be created while recovering from a device loss. */
function missingModule(material: ResolvedMaterial, phase: MtekRuntimePhase | undefined): PipelineResult {
  return {
    ok: false,
    diagnostic: makeRuntimeDiagnostic("E8051", {
      phase: phase ?? "runtime:mount",
      message: `The shader of material '${material.id}' could not be loaded after the GPU device was recreated.`,
    }),
  };
}

/** Builds and initialises the scene. Errors thrown by generated code (internal errors) propagate. */
export async function startScene(options: SceneStartupOptions): Promise<SceneStartupResult> {
  const { manifest, structure, program, device, registry, surface, modules, report, services } = options;
  const lightingProblem = sceneLightingProblem(manifest, options.rendering);
  if (lightingProblem !== undefined) return { ok: false, diagnostics: [makeRuntimeDiagnostic("E8051", { phase: "runtime:mount", message: lightingProblem })] };
  const additive=new Set(options.rendering?.additiveMaterials??[]);
  const blendMode=(material:ResolvedMaterial):"alpha"|"additive"=>additive.has(material.id)?"additive":"alpha";
  options.assertActive?.();
  const generation = registry.generation;

  const plan = options.bindingPlan ?? new BindingPlan(registry, structure.frameLayout, structure.objectLayout);
  const mipmaps=device.createCommandEncoder!==undefined&&device.createComputePipeline!==undefined&&[...options.assets?.images.values()??[]].some(image=>image.width>1||image.height>1)
    ?new MipmapGenerator({queue:device.queue,createCommandEncoder:device.createCommandEncoder.bind(device)},registry):undefined;
  const materials = new MaterialStore(device, registry, plan, structure, program.writers, options.textures, options.assets?.images, mipmaps);
  let meshes: MeshStore | undefined;
  let renderer: Renderer | undefined;
  let lighting: SceneLighting | undefined;
  let committed = false;
  try {
    const { recover } = options;
    let world: World;
    let bindings: Bindings;
    if (recover === undefined) {
      const fresh = new World({
        manifest,
        structure,
        params: materials,
        report,
        prefabs: buildPrefabRuntimes(structure.prefabs, program.prefabs),
        ...(services === undefined ? {} : { services }),
      });
      const freshBindings = new Bindings(manifest, program.scene.bindings, fresh);
      options.onWorld?.(fresh);
      fresh.initialise(program.scene.init, () => {
        freshBindings.evaluate();
      });
      world = fresh;
      bindings = freshBindings;
    } else {
      ({ world, bindings } = recover);
      world.rebindParams(materials);
    }
    options.assertActive?.();
    // Every instance holds its initial values: identical immutable ones now share a parameter block.
    materials.shareIdentical();

    meshes = new MeshStore(registry, device.queue, undefined, device.limits.maxBufferSize, structure.meshes.some(m => m.descriptor.kind === "asset" && m.descriptor.skin !== undefined) ? device : undefined, structure.materials.some(m => m.shader.vertexAttributes.includes("tangent")));
    meshes.upload(structure.meshes, options.assets?.files);

    if (structure.materials.some(material => material.shader.lighting === 1)) {
      device.pushErrorScope("validation");
      let validation: GPUError | null;
      try { lighting = new SceneLighting(device, registry, plan, manifest, options.rendering, { structure, modules }); }
      finally { validation = await device.popErrorScope(); }
      if (validation !== null) return { ok: false, diagnostics: [makeRuntimeDiagnostic("E8051", { phase: options.recover === undefined ? "runtime:mount" : "runtime:device", message: `Scene lighting initialization failed: ${validation.message}` })] };
      options.assertActive?.();
    }

    const pipelines = options.pipelineCache ?? new PipelineCache(device, registry, plan, manifest);
    const phase: MtekRuntimePhase | undefined = recover === undefined ? undefined : "runtime:device";
    // The materials with entities that can share an instanced draw also get the instanced variant of their pipeline.
    const instanced = new Set<string>(
      options.instancing === false
        ? []
        : instancingCandidates(
            structure,
            (instance) => materials.blockOf(instance),
            (material) => materialPipelineKey(material, surface.colorFormat),
          ).materials,
    );
    // Particles are always drawn as instances (decision 0155), also when batching is off: their materials keep the variant.
    const emitterMaterials = new Map<string, ResolvedMaterial>();
    for (const entity of structure.entities) {
      if (entity.particles !== undefined && entity.instance !== null) emitterMaterials.set(entity.instance.material.id, entity.instance.material);
    }
    for (const prefab of structure.prefabs) {
      if (prefab.particles !== undefined && prefab.material !== null) emitterMaterials.set(prefab.material.material.id, prefab.material.material);
    }
    for (const [id, material] of emitterMaterials) if (material.shader.instancedVertexEntry !== undefined) instanced.add(id);
    const results = await Promise.all(
      structure.materials.map(async (material): Promise<PipelineResult & { readonly instancedPipeline?: GPURenderPipeline }> => {
        const module = modules.get(material.shader.hash);
        if (module === undefined) {
          if (recover !== undefined) return missingModule(material, phase);
          throw new Error(`internal error: no shader module for '${material.id}'`);
        }
        const request = { material, module, colorFormat: surface.colorFormat, ...(phase === undefined ? {} : { phase }) };
        const [plain, variant] = await Promise.all([
          pipelines.obtain(request),
          instanced.has(material.id) ? pipelines.obtain({ ...request, instanced: true }) : undefined,
        ]);
        if (!plain.ok) return plain;
        if (variant !== undefined && !variant.ok) return variant;
        return {
          ...plain,
          ...(variant === undefined ? {} : { instancedPipeline: variant.pipeline }),
        };
      }),
    );
    const diagnostics: MtekDiagnostic[] = [];
    options.assertActive?.();
    const failed: { readonly id: string; readonly diagnostic: MtekDiagnostic }[] = [];
    const byMaterial = new Map<string, MaterialPipeline>();
    results.forEach((result, index) => {
      const material = structure.materials[index];
      if (material === undefined) return;
      if (result.ok) {
        byMaterial.set(material.id, {
          key: result.key,
          pipeline: result.pipeline,
          ...(result.instancedPipeline === undefined ? {} : { instanced: result.instancedPipeline }),
        });
      }
      else if (recover === undefined) diagnostics.push(result.diagnostic);
      else failed.push({ id: material.id, diagnostic: result.diagnostic });
    });
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics };
    }

    // The blended pipelines of the materials known to blend now (decision 0173): a plain one for each, and the
    // instanced one for those an emitter draws. The rest is made the first time a draw needs it.
    const blendedSeed = new Map<string, { readonly key: string; readonly pipeline: GPURenderPipeline }>();
    const wanted = new Map<string, { readonly material: ResolvedMaterial; readonly instanced: boolean }>();
    const want = (material: ResolvedMaterial, instancedVariant: boolean): void => {
      if ((!canBlend(material)&&!additive.has(material.id)) || modules.get(material.shader.hash) === undefined || !byMaterial.has(material.id)) return;
      if (instancedVariant && material.shader.instancedVertexEntry === undefined) return;
      wanted.set(blendedKey(material.id, instancedVariant), { material, instanced: instancedVariant });
    };
    for (const entity of structure.entities) {
      if (entity.mesh === null || entity.instance === null) continue;
      const { material } = entity.instance;
      if (!alwaysBlends(material) && !materials.isTranslucent(entity.instance.index) && !additive.has(material.id)) continue;
      want(material, false);
      if (entity.particles !== undefined) want(material, true);
    }
    for (const prefab of structure.prefabs) {
      const material = prefab.material?.material;
      if (prefab.mesh === null || material === undefined || (!alwaysBlends(material)&&!additive.has(material.id))) continue;
      want(material, false);
      if (prefab.particles !== undefined) want(material, true);
    }
    await Promise.all(
      [...wanted].map(async ([id, { material, instanced: instancedVariant }]) => {
        const module = modules.get(material.shader.hash);
        if (module === undefined) return;
        const made = await pipelines.obtain({ material, module, colorFormat: surface.colorFormat, blended: true, blendMode:blendMode(material), ...(instancedVariant ? { instanced: true } : {}) });
        if (made.ok) blendedSeed.set(id, { key: made.key, pipeline: made.pipeline });
        // A failure here is reported when a draw asks for the pipeline, as for a lazily made one.
      }),
    );
    options.assertActive?.();

    world.phase = "runtime:update";
    renderer = new Renderer({
      device,
      registry,
      surface,
      manifest,
      structure,
      world,
      writers: program.writers,
      plan,
      materials,
      meshes,
      pipelines: byMaterial,
      blendedSeed,
      additiveMaterials:additive,
      ...(lighting === undefined ? {} : { lighting }),
      // The translucent variant (decision 0138) of a material not known to blend at startup is made the first time a draw needs it.
      blend: async (material, instancedVariant) => {
        const module = modules.get(material.shader.hash);
        if (module === undefined || (!canBlend(material)&&!additive.has(material.id))) return undefined;
        if (instancedVariant && material.shader.instancedVertexEntry === undefined) return undefined;
        const made = await pipelines.obtain({ material, module, colorFormat: surface.colorFormat, blended: true, blendMode:blendMode(material), ...(instancedVariant ? { instanced: true } : {}) });
        if (made.ok) return { key: made.key, pipeline: made.pipeline };
        report(made.diagnostic);
        return undefined;
      },
      report,
      ...(options.instancing === undefined ? {} : { instancing: options.instancing }),
    });
    for (const { id, diagnostic } of failed) renderer.failMaterial(id, diagnostic);
    // Spawned entities are created through these stores (decision 0064). After a device loss the entities that
    // exist get their material instance and object block again in the rebuilt ones.
    if (recover === undefined) world.dynamic.attach(renderer, materials);
    else world.dynamic.rebuild(renderer, materials);
    committed = true;
    return { ok: true, scene: { world, bindings, materials, meshes, plan, pipelines, renderer } };
  } finally {
    // A retired generation has already released these resources; never release a rebuilt scene's objects.
    if (!committed && registry.generation === generation) {
      renderer?.dispose();
      lighting?.dispose();
      meshes?.dispose();
      materials.dispose();
    }
  }
}
