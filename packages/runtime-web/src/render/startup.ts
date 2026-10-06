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
import type { MtekDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { CheckedProgram } from "../scene/program.js";
import type { SceneStructure } from "../scene/structure.js";
import { Bindings } from "../scene/bindings.js";
import { World, type CpuServices } from "../scene/world.js";
import { MaterialStore } from "./materials.js";
import { MeshStore } from "./meshes.js";
import { BindingPlan, PipelineCache } from "./pipelines.js";
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
}

/** The running scene: its CPU world, its GPU state and its renderer. */
export interface Scene {
  readonly world: World;
  /** The `bind(..)` of the scene, evaluated in phase 5. */
  readonly bindings: Bindings;
  readonly materials: MaterialStore;
  readonly pipelines: PipelineCache;
  readonly renderer: Renderer;
}

export type SceneStartupResult = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

/** Builds and initialises the scene. Errors thrown by generated code (internal errors) propagate. */
export async function startScene(options: SceneStartupOptions): Promise<SceneStartupResult> {
  const { manifest, structure, program, device, registry, surface, modules, report, services } = options;

  const plan = new BindingPlan(registry, structure.frameLayout, structure.objectLayout);
  const materials = new MaterialStore(device, registry, plan, structure, program.writers);
  const world = new World({ manifest, structure, params: materials, report, ...(services === undefined ? {} : { services }) });
  const bindings = new Bindings(manifest, program.scene.bindings, world);
  world.initialise(program.scene.init, () => {
    bindings.evaluate();
  });

  const meshes = new MeshStore(registry, device.queue);
  meshes.upload(structure.meshes);

  const pipelines = new PipelineCache(device, registry, plan, manifest);
  const results = await Promise.all(
    structure.materials.map((material) => {
      const module = modules.get(material.shader.hash);
      if (module === undefined) throw new Error(`internal error: no shader module for '${material.id}'`);
      return pipelines.obtain({ material, module, colorFormat: surface.colorFormat });
    }),
  );
  const diagnostics: MtekDiagnostic[] = [];
  const byMaterial = new Map<string, MaterialPipeline>();
  results.forEach((result, index) => {
    const material = structure.materials[index];
    if (!result.ok) diagnostics.push(result.diagnostic);
    else if (material !== undefined) byMaterial.set(material.id, { key: result.key, pipeline: result.pipeline });
  });
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  world.phase = "runtime:update";
  const renderer = new Renderer({ device, registry, surface, manifest, structure, world, writers: program.writers, plan, materials, meshes, pipelines: byMaterial, report });
  return { ok: true, scene: { world, bindings, materials, pipelines, renderer } };
}
