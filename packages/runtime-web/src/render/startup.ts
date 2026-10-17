/**
 * Scene startup (`spec/runtime-abi.md` sections 4.3 and 6.1, `spec/scenes.md` section 11): everything
 * `mountMtek` does between the startup shader modules and resolving.
 *
 *  1. The binding plan and the material arenas (one slot per material instance).
 *  2. The world with its records at the registry defaults; `scenes.<Entry>.init(ctx)` sets every value,
 *     material params through the generated writers into the arenas; transforms are propagated.
 *  3. The meshes are generated and uploaded.
 *  4. Every startup pipeline (one per material, for the surface's colour format) is created; a failure
 *     is `E8051` and fails the mount.
 *  5. The renderer allocates the frame and object blocks.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { CheckedProgram } from "../scene/program.js";
import type { ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import { Bindings } from "../scene/bindings.js";
import { World, type CpuServices } from "../scene/world.js";
import { MaterialStore } from "./materials.js";
import { MeshStore } from "./meshes.js";
import { BindingPlan, PipelineCache, type PipelineResult } from "./pipelines.js";
import { Renderer, type MaterialPipeline, type RenderSurface } from "./renderer.js";

export interface SceneStartupOptions {
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly program: CheckedProgram;
  readonly device: Pick<GPUDevice, "queue" | "limits" | "pushErrorScope" | "popErrorScope">;
  readonly registry: ResourceRegistry;
  readonly surface: RenderSurface & { readonly colorFormat: GPUTextureFormat };
  /** Startup shader modules by shader hash (`host/shaders.ts`). */
  readonly modules: ReadonlyMap<string, GPUShaderModule>;
  /** Run-time diagnostics of initialisation and of later frames. */
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /** `random`, `is_key_down` and `print` for generated code, including `init`. */
  readonly services?: CpuServices;
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

  const plan = options.bindingPlan ?? new BindingPlan(registry, structure.frameLayout, structure.objectLayout);
  const materials = new MaterialStore(device, registry, plan, structure, program.writers);
  const { recover } = options;
  let world: World;
  let bindings: Bindings;
  if (recover === undefined) {
    const fresh = new World({ manifest, structure, params: materials, report, ...(services === undefined ? {} : { services }) });
    const freshBindings = new Bindings(manifest, program.scene.bindings, fresh);
    fresh.initialise(program.scene.init, () => {
      freshBindings.evaluate();
    });
    world = fresh;
    bindings = freshBindings;
  } else {
    ({ world, bindings } = recover);
    world.rebindParams(materials);
  }

  const meshes = new MeshStore(registry, device.queue);
  meshes.upload(structure.meshes);

  const pipelines = options.pipelineCache ?? new PipelineCache(device, registry, plan, manifest);
  const phase = recover === undefined ? undefined : "runtime:device";
  const results = await Promise.all(
    structure.materials.map((material) => {
      const module = modules.get(material.shader.hash);
      if (module === undefined) {
        if (recover !== undefined) return Promise.resolve(missingModule(material, phase));
        throw new Error(`internal error: no shader module for '${material.id}'`);
      }
      return pipelines.obtain({ material, module, colorFormat: surface.colorFormat, ...(phase === undefined ? {} : { phase }) });
    }),
  );
  const diagnostics: MtekDiagnostic[] = [];
  const failed: { readonly id: string; readonly diagnostic: MtekDiagnostic }[] = [];
  const byMaterial = new Map<string, MaterialPipeline>();
  results.forEach((result, index) => {
    const material = structure.materials[index];
    if (material === undefined) return;
    if (result.ok) byMaterial.set(material.id, { key: result.key, pipeline: result.pipeline });
    else if (recover === undefined) diagnostics.push(result.diagnostic);
    else failed.push({ id: material.id, diagnostic: result.diagnostic });
  });
  if (diagnostics.length > 0) {
    materials.dispose();
    meshes.dispose();
    return { ok: false, diagnostics };
  }

  world.phase = "runtime:update";
  const renderer = new Renderer({ device, registry, surface, manifest, structure, world, writers: program.writers, plan, materials, meshes, pipelines: byMaterial, report });
  for (const { id, diagnostic } of failed) renderer.failMaterial(id, diagnostic);
  return { ok: true, scene: { world, bindings, materials, meshes, plan, pipelines, renderer } };
}
