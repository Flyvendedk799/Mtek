/**
 * The frame renderer: phase 7 of the frame (`spec/runtime-abi.md` section 8, `spec/scenes.md` section 10).
 *
 * Per frame, when the target has pixels:
 *  1. `MtekFrame` is written through the generated `builtin:frame` field writers: `view_proj = P * V`
 *     from the camera (`spec/runtime-abi.md` section 8.3, aspect = target width / height), the camera
 *     position, the lights (`lights`, `light_count`: `render/lights.ts`) and `ambient` = ambient colour RGB x
 *     intensity. The remaining member (`reserved0`) is never written and stays zero.
 *  2. For every entity whose world matrix changed (phase 6), `MtekObject` (model, normal matrix) is
 *     written through the generated `builtin:object` writers into its slot of the object arena.
 *  3. The frame, object and material arenas upload their dirty slots (`writeIfChanged` keeps unchanged
 *     blocks clean, so a static scene uploads nothing after its first frame).
 *  4. The draw list (visible entities with a mesh, sorted by (pipeline key, material instance, mesh),
 *     ties by instance order) is frustum-culled: an entity whose world-space bounding sphere lies
 *     outside one of the six planes of `view_proj` is not drawn (section 8.4, decision 0055). Its
 *     object block is still written, so it is correct when it comes back into view.
 *  5. One render pass clears to the scene clear colour and draws the remaining entities. Group 0 is
 *     bound once, group 1 when the material instance changes, vertex and index buffers when the mesh
 *     changes, group 2 per draw with the object's dynamic offset.
 *  6. The command buffer is submitted (by the surface).
 *
 * The runtime never computes an offset inside `MtekFrame` or `MtekObject`: only the generated writers
 * know the layout.
 */
import type { MtekManifest, MtekVertexAttribute } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { UniformArena, type ArenaDevice } from "../gpu/uniform-arena.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { multiply, normalMatrix, orthographic, perspective, viewMatrix, identity, type Mat4 } from "../math/mat4.js";
import type { BlockWriter, LayoutWriters } from "../scene/program.js";
import type { SceneStructure } from "../scene/structure.js";
import type { World } from "../scene/world.js";
import { emptyPackedLights, packLights, type LightSource, type PackedLight } from "./lights.js";
import { extractFrustumPlanes, sphereIntersectsFrustum, worldBoundingSphere, type WorldSphere } from "./frustum.js";
import type { MaterialStore } from "./materials.js";
import type { GpuMesh, MeshStore } from "./meshes.js";
import type { BindingPlan } from "./pipelines.js";

/** What the renderer needs of the drawing surface (`host/surface.ts`). */
export interface RenderSurface {
  readonly renderable: boolean;
  readonly size: { readonly width: number; readonly height: number };
  render(clearColor: readonly [number, number, number, number], encode?: (pass: GPURenderPassEncoder) => void): boolean;
}

/** The pipeline of a material for the surface's colour format. */
export interface MaterialPipeline {
  readonly key: string;
  readonly pipeline: GPURenderPipeline;
}

/** The order of the draw list (`spec/runtime-abi.md` section 8.4). */
export interface DrawSortKey {
  readonly pipelineKey: string;
  /** Material instance index. */
  readonly instance: number;
  /** Mesh upload order. */
  readonly mesh: number;
  /** Static entity index: instance order. */
  readonly entity: number;
}

/** Compares draws by (pipeline key, material instance, mesh), ties by instance order. Never locale-dependent. */
export function compareDraws(a: DrawSortKey, b: DrawSortKey): number {
  if (a.pipelineKey !== b.pipelineKey) return a.pipelineKey < b.pipelineKey ? -1 : 1;
  return a.instance - b.instance || a.mesh - b.mesh || a.entity - b.entity;
}

/** One draw of the draw list. */
export interface DrawItem extends DrawSortKey {
  readonly pipeline: GPURenderPipeline;
  readonly attributes: readonly MtekVertexAttribute[];
  readonly gpuMesh: GpuMesh;
  readonly objectSlot: number;
}

export interface RendererOptions {
  readonly device: ArenaDevice;
  readonly registry: ResourceRegistry;
  readonly surface: RenderSurface;
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly world: World;
  readonly writers: ReadonlyMap<string, LayoutWriters>;
  readonly plan: BindingPlan;
  readonly materials: MaterialStore;
  readonly meshes: MeshStore;
  /** By material id. */
  readonly pipelines: ReadonlyMap<string, MaterialPipeline>;
  readonly report: (diagnostic: MtekDiagnostic) => void;
}

function fieldWriter(writers: LayoutWriters, name: string, layoutId: string): BlockWriter {
  const writer = writers.fields.get(name);
  if (writer === undefined) throw new Error(`internal error: the layout '${layoutId}' has no writer for '${name}'`);
  return writer;
}

export class Renderer {
  private readonly options: RendererOptions;
  private readonly frameArena: UniformArena;
  private readonly frameSlot: number;
  private readonly objectArena: UniformArena;
  /** By static entity index; `undefined` for entities without a mesh. */
  private readonly objectSlots: (number | undefined)[] = [];
  private readonly writeViewProj: BlockWriter;
  private readonly writeCameraPosition: BlockWriter;
  private readonly writeLightCount: BlockWriter;
  private readonly writeAmbient: BlockWriter;
  private readonly writeLights: BlockWriter;
  /** The value of `MtekFrame.lights`, refilled every frame. */
  private readonly packedLights: PackedLight[];
  private readonly lightSource: LightSource;
  private readonly writeModel: BlockWriter;
  private readonly writeNormalMatrix: BlockWriter;
  private readonly ambient: { readonly x: number; readonly y: number; readonly z: number };
  private lastView: Mat4 = identity();
  private draws: readonly DrawItem[] = [];
  private drawsVersion = -1;
  private drawCallsLastFrame = 0;
  private culledLastFrame = 0;
  private drawCallsTotal = 0;
  private culledTotal = 0;
  /** The draws that survived culling this frame (reused between frames). */
  private readonly drawn: DrawItem[] = [];
  private readonly planes = new Float64Array(24);
  /** Per static entity index, from its last object-block write: world-space sphere centre (x, y, z) and largest world scale. */
  private readonly sphereCentres: Float64Array;
  private readonly sphereScales: Float64Array;
  private readonly sphere: WorldSphere = { x: 0, y: 0, z: 0, radius: 0 };
  private cullingEnabled = true;
  /** Materials that failed after mount (`failMaterial`): never drawn. */
  private readonly failedMaterials = new Set<string>();

  constructor(options: RendererOptions) {
    this.options = options;
    const { device, registry, structure, writers, manifest } = options;
    const frameWriters = writers.get(structure.frameLayout.id);
    const objectWriters = writers.get(structure.objectLayout.id);
    if (frameWriters === undefined || objectWriters === undefined) throw new Error("internal error: no writers for the built-in blocks");
    this.writeViewProj = fieldWriter(frameWriters, "view_proj", structure.frameLayout.id);
    this.writeCameraPosition = fieldWriter(frameWriters, "camera_position", structure.frameLayout.id);
    this.writeLightCount = fieldWriter(frameWriters, "light_count", structure.frameLayout.id);
    this.writeAmbient = fieldWriter(frameWriters, "ambient", structure.frameLayout.id);
    this.writeLights = fieldWriter(frameWriters, "lights", structure.frameLayout.id);
    this.packedLights = emptyPackedLights(structure.lightCapacity);
    this.lightSource = {
      light: (entity) => {
        const light = options.world.entities[entity]?.light;
        if (light === null || light === undefined) throw new Error(`internal error: entity ${String(entity)} has no light record`);
        return light;
      },
      worldMatrix: (entity) => options.world.worldMatrix(entity),
    };
    this.writeModel = fieldWriter(objectWriters, "model", structure.objectLayout.id);
    this.writeNormalMatrix = fieldWriter(objectWriters, "normal_matrix", structure.objectLayout.id);

    const { ambientColor, ambientIntensity } = manifest.scene.fields;
    this.ambient = Object.freeze({ x: ambientColor[0] * ambientIntensity, y: ambientColor[1] * ambientIntensity, z: ambientColor[2] * ambientIntensity });

    this.frameArena = new UniformArena(device, registry, structure.frameLayout, { initialCapacity: 1 });
    this.frameSlot = this.frameArena.allocate();
    const drawable = structure.entities.filter((entity) => entity.mesh !== null);
    this.objectArena = new UniformArena(device, registry, structure.objectLayout, { dynamicOffset: true, initialCapacity: Math.max(1, drawable.length) });
    for (const entity of drawable) this.objectSlots[entity.index] = this.objectArena.allocate();
    this.sphereCentres = new Float64Array(structure.entities.length * 3);
    this.sphereScales = new Float64Array(structure.entities.length);
  }

  /** Draw calls encoded by the last rendered frame. */
  get drawCalls(): number {
    return this.drawCallsLastFrame;
  }

  /** Drawable entities (visible, with a mesh) outside the frustum in the last rendered frame; 0 when no frame was drawn. */
  get culledObjects(): number {
    return this.culledLastFrame;
  }

  /** Draw calls encoded since the scene started. */
  get drawCallsCumulative(): number {
    return this.drawCallsTotal;
  }

  /** Entity culls since the scene started (an entity culled in ten frames counts ten times). */
  get culledObjectsCumulative(): number {
    return this.culledTotal;
  }

  /** Turns frustum culling on (the default) or off. Off exists for tests that compare culled and unculled frames. */
  setFrustumCulling(enabled: boolean): void {
    this.cullingEnabled = enabled;
  }

  /** Number of materials taken out of the draw list by `failMaterial`. */
  get failedMaterialCount(): number {
    return this.failedMaterials.size;
  }

  /**
   * A material whose shader or pipeline failed after mount (`spec/runtime-abi.md` section 12): reports
   * `diagnostic` and stops drawing every entity that uses it. The rest of the scene keeps running; the
   * entities stay in the world and their params stay writable. Idempotent.
   */
  /** Releases frame and object arenas (hot reload: discard a retired scene). */
  dispose(): void {
    this.frameArena.dispose();
    this.objectArena.dispose();
  }

  failMaterial(materialId: string, diagnostic: MtekDiagnostic): void {
    if (this.failedMaterials.has(materialId)) return;
    this.failedMaterials.add(materialId);
    this.drawsVersion = -1;
    this.options.report(diagnostic);
  }

  /** The current draw list (rebuilt when visibility or the set of failed materials changed). */
  drawList(): readonly DrawItem[] {
    const { world, structure, pipelines, meshes } = this.options;
    if (this.drawsVersion === world.visibilityVersion) return this.draws;
    const items: DrawItem[] = [];
    for (const entity of structure.entities) {
      const record = world.entities[entity.index];
      const objectSlot = this.objectSlots[entity.index];
      if (record?.visible !== true || entity.mesh === null || entity.instance === null || objectSlot === undefined) continue;
      if (this.failedMaterials.has(entity.instance.material.id)) continue;
      const pipeline = pipelines.get(entity.instance.material.id);
      if (pipeline === undefined) throw new Error(`internal error: no pipeline for material '${entity.instance.material.id}'`);
      const gpuMesh = meshes.get(entity.mesh.id);
      items.push({
        pipelineKey: pipeline.key,
        instance: entity.instance.index,
        mesh: gpuMesh.order,
        entity: entity.index,
        pipeline: pipeline.pipeline,
        attributes: entity.instance.material.shader.vertexAttributes,
        gpuMesh,
        objectSlot,
      });
    }
    this.draws = items.sort(compareDraws);
    this.drawsVersion = world.visibilityVersion;
    return this.draws;
  }

  /** Renders one frame (phase 7). Returns false when the target has no pixels (nothing is drawn or uploaded). */
  frame(): boolean {
    const { surface, manifest, device, materials } = this.options;
    const clearColor = manifest.scene.fields.clearColor;
    // A zero-sized target skips the frame; the surface counts the skip.
    if (!surface.renderable) {
      this.drawCallsLastFrame = 0;
      this.culledLastFrame = 0;
      return surface.render(clearColor);
    }

    const viewProj = this.writeFrameBlock();
    this.writeObjectBlocks();
    this.frameArena.flush(device.queue);
    this.objectArena.flush(device.queue);
    materials.flush(device.queue);

    const listed = this.drawList();
    const draws = this.cull(listed, viewProj);
    const rendered = surface.render(clearColor, (pass) => {
      this.encode(pass, draws);
    });
    this.drawCallsLastFrame = rendered ? draws.length : 0;
    this.culledLastFrame = rendered ? listed.length - draws.length : 0;
    this.drawCallsTotal += this.drawCallsLastFrame;
    this.culledTotal += this.culledLastFrame;
    return rendered;
  }

  /** The draws whose world-space bounding sphere is not entirely outside one of the six planes of `viewProj`, in draw-list order. */
  private cull(draws: readonly DrawItem[], viewProj: Mat4): readonly DrawItem[] {
    if (!this.cullingEnabled) return draws;
    const { planes, drawn, sphereCentres, sphereScales } = this;
    extractFrustumPlanes(viewProj, planes);
    drawn.length = 0;
    for (const draw of draws) {
      const e = draw.entity;
      const radius = draw.gpuMesh.boundingRadius * (sphereScales[e] ?? 0);
      if (sphereIntersectsFrustum(planes, sphereCentres[e * 3] ?? 0, sphereCentres[e * 3 + 1] ?? 0, sphereCentres[e * 3 + 2] ?? 0, radius)) drawn.push(draw);
    }
    return drawn;
  }

  /** `P * V` of the active camera for the target's aspect ratio. */
  private viewProjection(aspect: number): Mat4 {
    const { camera } = this.options.world;
    try {
      this.lastView = viewMatrix(camera.position, camera.target !== null ? { target: camera.target } : { rotation: camera.rotation });
    } catch (error) {
      // Unreachable for checked programs (position = target is rejected on write, E8011); keep the last view.
      this.reportCamera(error instanceof Error ? error.message : String(error));
    }
    const projection = camera.projection;
    const p =
      projection.kind === "perspective"
        ? perspective(projection.fov_y, aspect, projection.near, projection.far)
        : orthographic(projection.height, aspect, projection.near, projection.far);
    return multiply(p, this.lastView);
  }

  private reportCamera(message: string): void {
    const { manifest, structure, report } = this.options;
    const span = spanOfSymbol(manifest, structure.camera.symbol);
    report(
      makeRuntimeDiagnostic("E8011", {
        phase: "runtime:render",
        message: `Invalid value for camera '${structure.camera.name}': ${message}; the previous view is kept.`,
        source: span === undefined ? null : resolveSpan(manifest, span),
      }),
    );
  }

  /** Writes `MtekFrame` and returns the `view_proj` it holds. */
  private writeFrameBlock(): Mat4 {
    const { width, height } = this.options.surface.size;
    const viewProj = this.viewProjection(width / height);
    const position = this.options.world.camera.position;
    const lightCount = packLights(this.options.structure.lights, this.lightSource, this.packedLights);
    this.frameArena.writeIfChanged(this.frameSlot, (memory, base) => {
      this.writeViewProj(memory, base, viewProj);
      this.writeCameraPosition(memory, base, position);
      this.writeLightCount(memory, base, lightCount);
      this.writeAmbient(memory, base, this.ambient);
      this.writeLights(memory, base, this.packedLights);
    });
    return viewProj;
  }

  private writeObjectBlocks(): void {
    const { world } = this.options;
    for (const index of world.takeWorldChanges()) {
      const slot = this.objectSlots[index];
      if (slot === undefined) continue;
      const model = world.worldMatrix(index);
      // The mesh-independent part of the bounding sphere: the centre, and the largest scale (radius of a unit-radius mesh).
      worldBoundingSphere(model, 1, this.sphere);
      this.sphereCentres[index * 3] = this.sphere.x;
      this.sphereCentres[index * 3 + 1] = this.sphere.y;
      this.sphereCentres[index * 3 + 2] = this.sphere.z;
      this.sphereScales[index] = this.sphere.radius;
      const normal = normalMatrix(model);
      this.objectArena.writeIfChanged(slot, (memory, base) => {
        this.writeModel(memory, base, model);
        this.writeNormalMatrix(memory, base, normal);
      });
    }
  }

  private encode(pass: GPURenderPassEncoder, draws: readonly DrawItem[]): void {
    if (draws.length === 0) return;
    const { plan, materials } = this.options;
    pass.setBindGroup(0, this.frameArena.bindGroupForSlot(this.frameSlot, plan.frame));
    const objectGroup = this.objectArena.bindGroupDynamic(plan.object);
    let pipeline: GPURenderPipeline | undefined;
    let instance = -1;
    let mesh: GpuMesh | undefined;
    for (const draw of draws) {
      if (draw.pipeline !== pipeline) {
        pass.setPipeline(draw.pipeline);
        pipeline = draw.pipeline;
        // Another pipeline may read other attributes: rebind the mesh's buffers.
        mesh = undefined;
      }
      if (draw.instance !== instance) {
        pass.setBindGroup(1, materials.bindGroup(draw.instance));
        instance = draw.instance;
      }
      if (draw.gpuMesh !== mesh) {
        draw.attributes.forEach((attribute, slot) => {
          pass.setVertexBuffer(slot, draw.gpuMesh.vertexBuffers[attribute]);
        });
        pass.setIndexBuffer(draw.gpuMesh.indexBuffer, draw.gpuMesh.indexFormat);
        mesh = draw.gpuMesh;
      }
      pass.setBindGroup(2, objectGroup, [this.objectArena.slotOffset(draw.objectSlot)]);
      pass.drawIndexed(draw.gpuMesh.indexCount);
    }
  }
}
