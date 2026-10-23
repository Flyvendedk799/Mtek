/**
 * The frame renderer: phase 7 of the frame (`spec/runtime-abi.md` section 8, `spec/scenes.md` section 10).
 *
 * Per frame, when the target has pixels:
 *  1. `MtekFrame` is written through the generated `builtin:frame` field writers: `view_proj = P * V`
 *     from the camera (`spec/runtime-abi.md` section 8.3, aspect = target width / height), the camera
 *     position, the lights (`lights`, `light_count`: `render/lights.ts`) and `ambient` = ambient colour RGB x
 *     intensity, and `exposure` = `exposureScale(camera.exposure)` = 1 / (1.2 x 2^EV100) of the active camera
 *     (decision 0081), which `lighting.pbr` multiplies its result by.
 *  2. For every entity whose world matrix changed (phase 6) and differs from the one held here, the bounding
 *     sphere and the model and normal matrices (`entityMatrices`) are refreshed and the entity's object
 *     block is marked stale (decision 0120). `MtekObject` is written through the generated `builtin:object`
 *     writers only when a draw reads it (step 5): an individually drawn entity, in the frame it is drawn.
 *  3. The frame and material arenas upload their dirty slots (`writeIfChanged` keeps unchanged blocks
 *     clean, so a static scene uploads nothing after its first frame; dirty slots next to each other share
 *     one `writeBuffer`, decision 0119).
 *  4. The draw list (visible entities with a mesh, sorted by (pipeline key, parameter block, mesh),
 *     ties by instance order) is frustum-culled: an entity whose world-space bounding sphere lies
 *     outside one of the six planes of `view_proj` is not drawn (section 8.4, decision 0055). Its
 *     object block stays stale until a draw reads it, so it is correct when it comes back into view.
 *     The culling and the batching are skipped while nothing they read has changed.
 *  5. The remaining draws are grouped (`instancing.ts`, decision 0059): a run of two or more with the
 *     same pipeline key, parameter block and mesh becomes one instanced draw, whose per-instance model
 *     and normal matrices are copied into the instance buffer (only the bytes that changed are uploaded,
 *     and only the records of entities that changed are visited when the draws are the same as last frame).
 *     Every other draw stays individual; the object blocks of those that are stale are written and the
 *     object arena uploads them.
 *  6. One render pass clears to the scene clear colour and issues the draw calls. Group 0 is bound once,
 *     group 1 when the parameter block changes, vertex and index buffers when the mesh changes, group 2
 *     per individual draw with the object's dynamic offset; an instanced draw uses the instanced pipeline
 *     and the instance buffer instead of group 2.
 *  7. The command buffer is submitted (by the surface).
 *
 * The runtime never computes an offset inside `MtekFrame` or `MtekObject`: only the generated writers
 * know the layout.
 */
import type { MtekManifest, MtekVertexAttribute } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import { UniformArena, type ArenaDevice } from "../gpu/uniform-arena.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { multiply, normalMatrixInto, orthographic, perspective, viewMatrix, identity, type Mat4 } from "../math/mat4.js";
import type { BlockWriter, LayoutWriters } from "../scene/program.js";
import type { ResolvedEntity, ResolvedMaterial, SceneStructure } from "../scene/structure.js";
import type { World } from "../scene/world.js";
import { emptyPackedLights, packLights, type LightSource, type PackedLight } from "./lights.js";
import { extractFrustumPlanes, sphereIntersectsFrustum, worldBoundingSphere, type WorldSphere } from "./frustum.js";
import { batchDraws, instancingCandidates, type Batch } from "./instancing.js";
import type { MaterialStore } from "./materials.js";
import { vertexBufferOf, type GpuMesh, type MeshStore } from "./meshes.js";
import { INSTANCE_FLOATS, INSTANCE_STRIDE, type BindingPlan, alwaysBlends } from "./pipelines.js";
import type { ParticleDraw } from "../scene/particles.js";

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
  /** The instanced variant (decision 0059); only materials that can be part of an instanced draw have one. */
  readonly instanced?: GPURenderPipeline;
}

/** Sorts translucent draws after every opaque one (decision 0138): `compareDraws` orders keys by code unit. */
export const TRANSLUCENT_KEY_PREFIX = "\uffff";

/** The order of the draw list (`spec/runtime-abi.md` section 8.4). */
export interface DrawSortKey {
  readonly pipelineKey: string;
  /** The parameter block (`MaterialStore.blockOf`): the lowest material instance index that shares it. */
  readonly instance: number;
  /** Mesh upload order. */
  readonly mesh: number;
  /** The entity's slot (its static index, or the slot of a spawned entity): indexes the per-entity render state. */
  readonly entity: number;
  /** Instance order (`spec/scenes.md` section 10.1): the static index; a spawned entity follows every static one, in spawn order. */
  readonly order: number;
}

/** Compares draws by (pipeline key, material instance, mesh), ties by instance order. Never locale-dependent. */
export function compareDraws(a: DrawSortKey, b: DrawSortKey): number {
  if (a.pipelineKey !== b.pipelineKey) return a.pipelineKey < b.pipelineKey ? -1 : 1;
  return a.instance - b.instance || a.mesh - b.mesh || a.order - b.order;
}

/** One draw of the draw list. */
export interface DrawItem extends DrawSortKey {
  readonly pipeline: GPURenderPipeline;
  /** The pipeline of an instanced draw of this draw's group; `undefined` when it can never be instanced. */
  readonly instancedPipeline: GPURenderPipeline | undefined;
  readonly attributes: readonly MtekVertexAttribute[];
  readonly gpuMesh: GpuMesh;
  readonly objectSlot: number;
  /** Drawn in the translucent pass: blended, after the opaque draws, back to front (decision 0138). */
  readonly translucent?: boolean;
}

/**
 * Orders the translucent draws of a frame back to front (decision 0138, amended by 0173): by the view-space depth of
 * their bounding-sphere centre, so it holds for a perspective and for an orthographic projection alike (the clip-space
 * `w` of the latter is 1 for every point). Ties keep draw-list order.
 *
 * The sorted list lives in a buffer of the orderer and is compared with the previous frame's: while nothing moved
 * across another draw the same array comes back with `unchanged` set, so the renderer keeps its batches (decision 0173).
 */
export class TranslucentOrder {
  private readonly sorted: DrawItem[] = [];
  private depth = new Float64Array(0);
  private readonly rank: number[] = [];
  private readonly byDepth = (a: number, b: number): number => (this.depth[a] as number) - (this.depth[b] as number) || a - b;
  /** Whether the list returned by the last `order` holds the draws the call before returned, in the same order. */
  unchanged = false;

  /**
   * `draws` with the translucent ones (the tail: they sort after every opaque one) reordered. `view` is the
   * column-major world-to-view matrix, `centres` the world-space bounding-sphere centres by entity slot. Returns
   * `draws` itself when nothing is translucent.
   */
  order(draws: readonly DrawItem[], view: ArrayLike<number>, centres: ArrayLike<number>): readonly DrawItem[] {
    let first = -1;
    for (let i = 0; i < draws.length; i++) {
      if ((draws[i] as DrawItem).translucent === true) {
        first = i;
        break;
      }
    }
    if (first < 0) {
      this.unchanged = false;
      return draws;
    }
    const count = draws.length - first;
    if (this.depth.length < count) this.depth = new Float64Array(Math.max(count, this.depth.length * 2));
    const { depth, rank, sorted } = this;
    const z0 = view[2] ?? 0;
    const z1 = view[6] ?? 0;
    const z2 = view[10] ?? 0;
    const z3 = view[14] ?? 0;
    rank.length = count;
    for (let k = 0; k < count; k++) {
      const e = (draws[first + k] as DrawItem).entity * 3;
      // View space looks down -Z: the farthest draw has the smallest z.
      depth[k] = z0 * (centres[e] ?? 0) + z1 * (centres[e + 1] ?? 0) + z2 * (centres[e + 2] ?? 0) + z3;
      rank[k] = k;
    }
    rank.sort(this.byDepth);
    let same = sorted.length === draws.length;
    for (let i = 0; i < first; i++) {
      const draw = draws[i] as DrawItem;
      if (sorted[i] !== draw) {
        same = false;
        sorted[i] = draw;
      }
    }
    for (let k = 0; k < count; k++) {
      const draw = draws[first + (rank[k] as number)] as DrawItem;
      if (sorted[first + k] !== draw) {
        same = false;
        sorted[first + k] = draw;
      }
    }
    sorted.length = draws.length;
    this.unchanged = same;
    return sorted;
  }
}

/** The key of the blended pipeline of a material in `RendererOptions.blendedSeed` (the instanced variant draws particles). */
export function blendedKey(materialId: string, instanced: boolean): string {
  return instanced ? `${materialId}#instanced` : materialId;
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
  /** Makes the alpha-blended pipeline of a material (decision 0138); without it translucent draws stay opaque. */
  readonly blend?: (material: ResolvedMaterial, instanced: boolean) => Promise<{ readonly key: string; readonly pipeline: GPURenderPipeline } | undefined>;
  /** Blended pipelines made before the first frame (`blendedKey`): the materials known to blend at `startScene` (decision 0173). */
  readonly blendedSeed?: ReadonlyMap<string, { readonly key: string; readonly pipeline: GPURenderPipeline }>;
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /** Group compatible draws into instanced draws (decision 0059). Default true; `test.disableInstancing` turns it off. */
  readonly instancing?: boolean;
}

// WebGPU buffer usage flags (constants of the standard; the globals do not exist outside a browser).
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_VERTEX = 0x20;

/** The numbers the view-projection matrix is a function of (`Renderer.viewProjection`). */
const VIEW_KEY_LENGTH = 13;

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
  private readonly writeExposure: BlockWriter;
  private readonly writeLights: BlockWriter;
  /** The value of `MtekFrame.lights`, refilled every frame. */
  private readonly packedLights: PackedLight[];
  private readonly lightSource: LightSource;
  private readonly writeModel: BlockWriter;
  private readonly writeNormalMatrix: BlockWriter;
  private readonly ambient: { readonly x: number; readonly y: number; readonly z: number };
  private lastView: Mat4 = identity();
  /** `P * V` of the last frame, and the camera numbers it was computed from (`viewKey`): reused while they are equal. */
  private lastViewProj: Mat4 = identity();
  private readonly viewKey = new Float64Array(VIEW_KEY_LENGTH);
  private readonly nextViewKey = new Float64Array(VIEW_KEY_LENGTH);
  private viewKeyValid = false;
  private draws: readonly DrawItem[] = [];
  private drawsVersion = -1;
  private drawsBlockVersion = -1;
  private drawsPopulation = -1;
  /** The blended pipelines made so far, by material id, and the requests in flight (decision 0138). */
  private readonly blended = new Map<string, { readonly key: string; readonly pipeline: GPURenderPipeline } | undefined>();
  private blendedVersion = 0;
  private readonly materialsById = new Map<string, ResolvedMaterial>();
  private drawsBlendedVersion = -1;

  /** The blended pipeline of `material`, or `undefined` while it is being made (it is asked for once). */
  private blendedPipeline(material: ResolvedMaterial, instanced = false): { readonly key: string; readonly pipeline: GPURenderPipeline } | undefined {
    const id = blendedKey(material.id, instanced);
    if (this.blended.has(id)) return this.blended.get(id);
    this.blended.set(id, undefined);
    const make = this.options.blend;
    if (make !== undefined) {
      void make(material, instanced).then((made) => {
        if (made === undefined) return;
        this.blended.set(id, made);
        this.blendedVersion += 1;
      });
    }
    return undefined;
  }
  private drawCallsLastFrame = 0;
  private instancedLastFrame = 0;
  private culledLastFrame = 0;
  private drawCallsTotal = 0;
  private instancedTotal = 0;
  private culledTotal = 0;
  private rebatchesTotal = 0;
  /** The draws that survived culling this frame (reused between frames). */
  private readonly drawn: DrawItem[] = [];
  private readonly planes = new Float64Array(24);
  /** Per static entity index, from its last object-block write: world-space sphere centre (x, y, z) and largest world scale. */
  private sphereCentres: Float64Array;
  private sphereScales: Float64Array;
  /** Per static entity index: the local-space centre of its mesh's bounding sphere; `undefined` at the mesh origin (every primitive shape). */
  private readonly localCentres: (readonly [number, number, number] | undefined)[] = [];
  private readonly sphere: WorldSphere = { x: 0, y: 0, z: 0, radius: 0 };
  private cullingEnabled = true;
  /** The instance vertex buffer (`INSTANCE_STRIDE` bytes per record); absent when no draw can ever be instanced. */
  private instanceBuffer: GPUBuffer | undefined;
  /** Billboard matrices for particles (decision 0155): one buffer of `PARTICLE_DRAW_CAP` records, made on the first frame that draws one (decision 0173). */
  private particleBuffer: GPUBuffer | undefined;
  private particleMirror: Float32Array | undefined;
  /** The particle draw calls of this frame, in draw order (reused records; the first `particleBatchCount` are live). */
  private readonly particleBatches: ParticleBatch[] = [];
  private particleBatchCount = 0;
  private particleDepth = new Float64Array(0);
  private readonly particleRank: number[] = [];
  private readonly byParticleDepth = (a: number, b: number): number => (this.particleDepth[a] as number) - (this.particleDepth[b] as number) || a - b;
  private readonly particleNormal = new Float32Array(16);
  private readonly particleAxes = new Float64Array(9);
  private particleCapReported = false;
  /** How many instance records `instanceBuffer` holds. */
  private instanceRecords = 0;
  /** Whether draws can be instanced at all: instancing is on and some entity or prefab has a material with an instanced entry point. */
  private readonly instancingPossible: boolean;
  /**
   * Per entity slot: its model matrix, then its normal matrix (`INSTANCE_FLOATS` f32), as of the last frame in which its
   * world matrix changed. The object block and the instance record of the entity are copies of these 32 words; the
   * object block only when a draw reads it (`objectStale`).
   */
  private entityMatrices: Float32Array;
  private entityWords: Uint32Array;
  /** Per entity slot, 1 when the entity's object block does not hold `entityMatrices` (it is written when the entity is drawn individually). */
  private objectStale: Uint8Array;
  /** The entity slots whose world matrix changed in this frame's `applyWorldChanges` and that have a drawable slot. */
  private changedEntities: Int32Array = new Int32Array(0);
  private changedCount = 0;
  /** What the GPU instance buffer holds, by record (to upload only what changed), and the words of it that changed this frame. */
  private instanceMirror: Float32Array;
  private instanceMirrorWords: Uint32Array;
  private instanceLow = 0;
  private instanceHigh = -1;
  /** Per entity slot: the record it occupies in the instance buffer in the current batching, or -1. */
  private recordOf: Int32Array;
  /** The draw calls of this frame (reused between frames); valid for `batchedDraws`. */
  private readonly batches: Batch[] = [];
  private batchedDraws: readonly DrawItem[] | undefined;
  private instancedBatches = 0;
  /** What the cull and the batching of the last frame were computed for. */
  private cullListed: readonly DrawItem[] | undefined;
  private cullViewProj: Mat4 | undefined;
  private cullDirty = true;
  /** Whether the last `cull` produced the same draws as the frame before. */
  private drawnUnchanged = false;
  private readonly translucentOrder = new TranslucentOrder();
  /** The one dynamic offset of every `setBindGroup(2, …)` of `encode` (the browser reads it during the call). */
  private readonly dynamicOffset: number[] = [0];
  private readonly modelScratch = new Float32Array(16);
  private readonly normalScratch = new Float32Array(16);
  /** Materials that failed after mount (`failMaterial`): never drawn. */
  private readonly failedMaterials = new Set<string>();

  constructor(options: RendererOptions) {
    this.options = options;
    const { device, registry, structure, writers, manifest } = options;
    if (options.blendedSeed !== undefined) for (const [id, made] of options.blendedSeed) this.blended.set(id, made);
    for (const material of structure.materials) this.materialsById.set(material.id, material);
    const frameWriters = writers.get(structure.frameLayout.id);
    const objectWriters = writers.get(structure.objectLayout.id);
    if (frameWriters === undefined || objectWriters === undefined) throw new Error("internal error: no writers for the built-in blocks");
    this.writeViewProj = fieldWriter(frameWriters, "view_proj", structure.frameLayout.id);
    this.writeCameraPosition = fieldWriter(frameWriters, "camera_position", structure.frameLayout.id);
    this.writeLightCount = fieldWriter(frameWriters, "light_count", structure.frameLayout.id);
    this.writeAmbient = fieldWriter(frameWriters, "ambient", structure.frameLayout.id);
    this.writeExposure = fieldWriter(frameWriters, "exposure", structure.frameLayout.id);
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
    for (const entity of drawable) {
      this.objectSlots[entity.index] = this.objectArena.allocate();
      const centre = entity.mesh === null ? undefined : options.meshes.get(entity.mesh.id).boundingCenter;
      if (centre !== undefined && (centre[0] !== 0 || centre[1] !== 0 || centre[2] !== 0)) this.localCentres[entity.index] = centre;
    }
    this.sphereCentres = new Float64Array(structure.entities.length * 3);
    this.sphereScales = new Float64Array(structure.entities.length);
    this.entityMatrices = new Float32Array(structure.entities.length * INSTANCE_FLOATS);
    this.entityWords = new Uint32Array(this.entityMatrices.buffer);
    // Every object block starts stale: its first draw as an individual writes it, whatever the matrices compare equal to.
    this.objectStale = new Uint8Array(structure.entities.length).fill(1);
    this.recordOf = new Int32Array(structure.entities.length).fill(-1);

    // The instance buffer is created here, with the other GPU objects of the scene (so device recovery
    // rebuilds it): as large as the entities of the scene that could ever be instanced. Spawned entities
    // (decision 0064) can need more: it grows (`ensureInstances`) and the old buffer is released.
    const candidates =
      options.instancing === false
        ? undefined
        : instancingCandidates(
            structure,
            (instance) => options.materials.blockOf(instance),
            (material) => options.pipelines.get(material.id)?.key ?? "",
          );
    const capacity = candidates?.capacity ?? 0;
    this.instancingPossible = candidates !== undefined && (capacity > 0 || candidates.materials.size > 0);
    this.instanceMirror = new Float32Array(0);
    this.instanceMirrorWords = new Uint32Array(0);
    if (capacity > 0) this.allocateInstances(capacity);
    // Spawned entities that exist already (device recovery) are added by `DynamicEntities.rebuild`.
  }

  /** Makes the instance buffer hold `records` records (a new buffer, zeroed, with the old one released). */
  private allocateInstances(records: number): void {
    const { registry } = this.options;
    const old = this.instanceBuffer;
    this.instanceBuffer = registry.createBuffer({ label: "mtek instance matrices", size: records * INSTANCE_STRIDE, usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST });
    this.instanceRecords = records;
    this.instanceMirror = new Float32Array(records * INSTANCE_FLOATS);
    this.instanceMirrorWords = new Uint32Array(this.instanceMirror.buffer);
    // A new buffer and mirror are zero: the next batching writes every record again.
    this.batchedDraws = undefined;
    if (old !== undefined) registry.release(old);
  }

  /** Grows the instance buffer to hold at least `records` records. Called before the frame's commands are encoded. */
  private ensureInstances(records: number): void {
    if (records <= this.instanceRecords) return;
    this.allocateInstances(Math.max(records, this.instanceRecords * 2));
  }

  /** Grows the per-entity render state to `slots` entity slots. */
  private ensureEntitySlots(slots: number): void {
    if (slots * 3 > this.sphereCentres.length) {
      const capacity = Math.max(slots, this.sphereScales.length * 2);
      const centres = new Float64Array(capacity * 3);
      centres.set(this.sphereCentres);
      const scales = new Float64Array(capacity);
      scales.set(this.sphereScales);
      this.sphereCentres = centres;
      this.sphereScales = scales;
    }
    if (slots * INSTANCE_FLOATS > this.entityMatrices.length) {
      const capacity = Math.max(slots, (this.entityMatrices.length / INSTANCE_FLOATS) * 2);
      const matrices = new Float32Array(capacity * INSTANCE_FLOATS);
      matrices.set(this.entityMatrices);
      this.entityMatrices = matrices;
      this.entityWords = new Uint32Array(matrices.buffer);
      const stale = new Uint8Array(capacity).fill(1);
      stale.set(this.objectStale);
      this.objectStale = stale;
      const records = new Int32Array(capacity).fill(-1);
      records.set(this.recordOf);
      this.recordOf = records;
    }
  }

  /**
   * A spawned entity exists (decision 0064): it gets an object block when it has a mesh, and the draw list is
   * rebuilt to include it. Its material instance was created in the material store by the caller.
   */
  addEntity(entity: ResolvedEntity): void {
    this.ensureEntitySlots(entity.index + 1);
    this.forgetEntity(entity.index);
    if (entity.mesh !== null) {
      this.objectSlots[entity.index] = this.objectArena.allocate();
      const centre = this.options.meshes.get(entity.mesh.id).boundingCenter;
      this.localCentres[entity.index] = centre !== undefined && (centre[0] !== 0 || centre[1] !== 0 || centre[2] !== 0) ? centre : undefined;
    }
    this.drawsVersion = -1;
  }

  /** A spawned entity was removed: its object block is released and the draw list forgets it. */
  removeEntity(entity: ResolvedEntity): void {
    const slot = this.objectSlots[entity.index];
    if (slot !== undefined) this.objectArena.release(slot);
    this.objectSlots[entity.index] = undefined;
    this.localCentres[entity.index] = undefined;
    this.sphereScales[entity.index] = 0;
    this.forgetEntity(entity.index);
    this.drawsVersion = -1;
  }

  /**
   * Makes the render state of an entity slot that is being given up or taken (a spawned entity) differ from any pose a
   * successor can have: the matrices are zero (a model matrix never is, so the first world change of the next entity
   * in the slot is seen as a change), its object block is stale and it holds no instance record.
   */
  private forgetEntity(index: number): void {
    this.entityMatrices.fill(0, index * INSTANCE_FLOATS, (index + 1) * INSTANCE_FLOATS);
    this.objectStale[index] = 1;
    this.recordOf[index] = -1;
  }

  /** Draw calls encoded by the last rendered frame. */
  get drawCalls(): number {
    return this.drawCallsLastFrame;
  }

  /** Drawable entities (visible, with a mesh) outside the frustum in the last rendered frame; 0 when no frame was drawn. */
  get culledObjects(): number {
    return this.culledLastFrame;
  }

  /** Instanced draws (draw calls that draw two or more entities) encoded by the last rendered frame; 0 when no frame was drawn. */
  get instancedDraws(): number {
    return this.instancedLastFrame;
  }

  /** Instanced draws encoded since the scene started. */
  get instancedDrawsCumulative(): number {
    return this.instancedTotal;
  }

  /** Draw calls encoded since the scene started. */
  get drawCallsCumulative(): number {
    return this.drawCallsTotal;
  }

  /** Entity culls since the scene started (an entity culled in ten frames counts ten times). */
  get culledObjectsCumulative(): number {
    return this.culledTotal;
  }

  /** Times the draw calls were split into batches again since the scene started (a static scene settles at one, decision 0173). */
  get rebatchesCumulative(): number {
    return this.rebatchesTotal;
  }

  /** Turns frustum culling on (the default) or off. Off exists for tests that compare culled and unculled frames. */
  setFrustumCulling(enabled: boolean): void {
    if (enabled !== this.cullingEnabled) this.cullDirty = true;
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
  /**
   * Forgets everything the change tracking has cached, so the next frame recomputes the culling, the batching, the
   * instance records and the object blocks from the world's matrices as a first frame would (the GPU copies are kept
   * and compared, so a recompute that finds the same bytes uploads nothing). For the tests that compare a tracked
   * frame with a full recompute (`render/change-tracking.test.ts`); nothing in the runtime calls it.
   */
  invalidate(): void {
    this.entityMatrices.fill(0);
    this.objectStale.fill(1);
    this.recordOf.fill(-1);
    this.batchedDraws = undefined;
    this.cullListed = undefined;
    this.cullViewProj = undefined;
    this.cullDirty = true;
    this.viewKeyValid = false;
  }

  /** Releases frame and object arenas (hot reload: discard a retired scene). */
  dispose(): void {
    this.frameArena.dispose();
    this.objectArena.dispose();
    if (this.instanceBuffer !== undefined) this.options.registry.release(this.instanceBuffer);
    if (this.particleBuffer !== undefined) this.options.registry.release(this.particleBuffer);
  }

  failMaterial(materialId: string, diagnostic: MtekDiagnostic): void {
    if (this.failedMaterials.has(materialId)) return;
    this.failedMaterials.add(materialId);
    this.drawsVersion = -1;
    this.options.report(diagnostic);
  }

  /** The current draw list (rebuilt when visibility or the set of failed materials changed). */
  drawList(): readonly DrawItem[] {
    const { world, structure, pipelines, meshes, materials } = this.options;
    if (
      this.drawsVersion === world.visibilityVersion &&
      this.drawsBlockVersion === materials.blockVersion &&
      this.drawsPopulation === world.dynamic.version &&
      this.drawsBlendedVersion === this.blendedVersion
    ) {
      return this.draws;
    }
    const items: DrawItem[] = [];
    const list = (entity: ResolvedEntity, visible: boolean | undefined, order: number): void => {
      const objectSlot = this.objectSlots[entity.index];
      if (visible !== true || entity.mesh === null || entity.instance === null || objectSlot === undefined) return;
      if (this.failedMaterials.has(entity.instance.material.id)) return;
      const pipeline = pipelines.get(entity.instance.material.id);
      if (pipeline === undefined) throw new Error(`internal error: no pipeline for material '${entity.instance.material.id}'`);
      const gpuMesh = meshes.get(entity.mesh.id);
      const translucent = materials.isTranslucent(entity.instance.index) || alwaysBlends(entity.instance.material);
      const blended = translucent ? this.blendedPipeline(entity.instance.material) : undefined;
      items.push({
        pipelineKey: blended === undefined ? pipeline.key : TRANSLUCENT_KEY_PREFIX + blended.key,
        instance: materials.blockOf(entity.instance.index),
        mesh: gpuMesh.order,
        entity: entity.index,
        order,
        pipeline: blended?.pipeline ?? pipeline.pipeline,
        // A translucent draw is never instanced: the pass is ordered back to front per draw.
        instancedPipeline: blended === undefined ? pipeline.instanced : undefined,
        attributes: entity.instance.material.shader.vertexAttributes,
        gpuMesh,
        objectSlot,
        ...(blended === undefined ? {} : { translucent: true }),
      });
    };
    for (const entity of structure.entities) list(entity, world.entities[entity.index]?.visible, entity.index);
    // The spawned entities follow the named ones, in spawn order (`spec/scenes.md` section 10.1).
    for (const spawned of world.dynamic.live) list(spawned.resolved, spawned.record.visible, structure.entities.length + spawned.order);
    this.draws = items.sort(compareDraws);
    this.drawsVersion = world.visibilityVersion;
    this.drawsBlockVersion = materials.blockVersion;
    this.drawsPopulation = world.dynamic.version;
    this.drawsBlendedVersion = this.blendedVersion;
    return this.draws;
  }

  /** Renders one frame (phase 7). Returns false when the target has no pixels (nothing is drawn or uploaded). */
  frame(): boolean {
    const { surface, manifest, device, materials } = this.options;
    const clearColor = manifest.scene.fields.clearColor;
    // A zero-sized target skips the frame; the surface counts the skip.
    if (!surface.renderable) {
      this.drawCallsLastFrame = 0;
      this.instancedLastFrame = 0;
      this.culledLastFrame = 0;
      return surface.render(clearColor);
    }

    const viewProj = this.writeFrameBlock();
    this.applyWorldChanges();
    this.frameArena.flush(device.queue);
    materials.flush(device.queue);

    const listed = this.drawList();
    const culled = this.cull(listed, viewProj);
    const draws = this.translucentOrder.order(culled, this.lastView, this.sphereCentres);
    if (draws !== culled) this.drawnUnchanged = this.translucentOrder.unchanged;
    const instanced = this.groupDraws(draws);
    this.writeIndividualObjectBlocks(draws);
    this.objectArena.flush(device.queue);
    this.prepareParticles();
    const rendered = surface.render(clearColor, (pass) => {
      this.encode(pass, draws);
    });
    this.drawCallsLastFrame = rendered ? this.batches.length : 0;
    this.instancedLastFrame = rendered ? instanced : 0;
    this.culledLastFrame = rendered ? listed.length - draws.length : 0;
    this.drawCallsTotal += this.drawCallsLastFrame;
    this.instancedTotal += this.instancedLastFrame;
    this.culledTotal += this.culledLastFrame;
    return rendered;
  }

  /**
   * The draws whose world-space bounding sphere is not entirely outside one of the six planes of `viewProj`, in
   * draw-list order. The result is `this.drawn`, updated in place; `this.drawnUnchanged` says whether it holds the
   * same draws as after the previous frame, in which case the loop is skipped altogether when nothing it reads
   * changed: the draw list, the view-projection matrix (the same object while the camera is unchanged), the
   * spheres (only `applyWorldChanges` writes them) and whether culling is on.
   */
  private cull(draws: readonly DrawItem[], viewProj: Mat4): readonly DrawItem[] {
    if (!this.cullingEnabled) {
      this.drawnUnchanged = !this.cullDirty && this.cullListed === draws;
      this.cullListed = draws;
      this.cullViewProj = undefined;
      this.cullDirty = false;
      return draws;
    }
    const { planes, drawn, sphereCentres, sphereScales } = this;
    if (!this.cullDirty && this.cullListed === draws && this.cullViewProj === viewProj && this.changedCount === 0) {
      this.drawnUnchanged = true;
      return drawn;
    }
    extractFrustumPlanes(viewProj, planes);
    let unchanged = !this.cullDirty && this.cullListed === draws;
    let count = 0;
    for (let i = 0; i < draws.length; i++) {
      const draw = draws[i] as DrawItem;
      const e = draw.entity;
      const radius = draw.gpuMesh.boundingRadius * (sphereScales[e] ?? 0);
      if (sphereIntersectsFrustum(planes, sphereCentres[e * 3] ?? 0, sphereCentres[e * 3 + 1] ?? 0, sphereCentres[e * 3 + 2] ?? 0, radius)) {
        if (drawn[count] !== draw) {
          unchanged = false;
          drawn[count] = draw;
        }
        count += 1;
      }
    }
    if (drawn.length !== count) {
      unchanged = false;
      drawn.length = count;
    }
    this.drawnUnchanged = unchanged;
    this.cullListed = draws;
    this.cullViewProj = viewProj;
    this.cullDirty = false;
    return drawn;
  }

  /**
   * Splits the culled draws into this frame's draw calls (`this.batches`) and, for the instanced ones, brings the
   * instance records up to date with the matrices of their entities (`entityMatrices`), uploading only the words
   * that differ from what the GPU buffer holds. When the culled draw list is the one the batches were made for, only
   * the records of the entities whose world matrix changed this frame are visited; otherwise every record is.
   * Returns the number of instanced draws.
   */
  private groupDraws(draws: readonly DrawItem[]): number {
    const possible = this.instancingPossible;
    if (this.batchedDraws === draws && this.drawnUnchanged) {
      if (this.instancedBatches === 0 || this.changedCount === 0) return this.instancedBatches;
      const { instanceBuffer, recordOf, changedEntities } = this;
      if (instanceBuffer === undefined) return 0;
      this.instanceLow = Number.MAX_SAFE_INTEGER;
      this.instanceHigh = -1;
      for (let i = 0; i < this.changedCount; i++) {
        const entity = changedEntities[i] as number;
        const record = recordOf[entity] as number;
        if (record >= 0) this.updateRecord(record, entity);
      }
      this.uploadInstances(instanceBuffer);
      return this.instancedBatches;
    }
    this.rebatchesTotal += 1;
    const instanced = batchDraws(draws, (draw) => possible && draw.instancedPipeline !== undefined, this.batches);
    this.instancedBatches = instanced;
    this.recordOf.fill(-1);
    let records = 0;
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b] as Batch;
      if (batch.firstInstance >= 0) records = batch.firstInstance + batch.count;
    }
    if (instanced === 0) {
      this.batchedDraws = draws;
      return 0;
    }
    this.ensureInstances(records);
    const { instanceBuffer } = this;
    if (instanceBuffer === undefined) return 0;
    this.instanceLow = Number.MAX_SAFE_INTEGER;
    this.instanceHigh = -1;
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b] as Batch;
      if (batch.firstInstance < 0) continue;
      for (let k = 0; k < batch.count; k++) {
        const entity = (draws[batch.start + k] as DrawItem).entity;
        this.recordOf[entity] = batch.firstInstance + k;
        this.updateRecord(batch.firstInstance + k, entity);
      }
    }
    this.uploadInstances(instanceBuffer);
    this.batchedDraws = draws;
    return instanced;
  }

  /** Copies the 32 words of `entity`'s matrices into instance record `record` where they differ, widening the changed word range. */
  private updateRecord(record: number, entity: number): void {
    const source = entity * INSTANCE_FLOATS;
    const target = record * INSTANCE_FLOATS;
    const { entityWords, instanceMirrorWords } = this;
    for (let k = 0; k < INSTANCE_FLOATS; k++) {
      const word = entityWords[source + k] as number;
      if (word !== instanceMirrorWords[target + k]) {
        instanceMirrorWords[target + k] = word;
        if (target + k < this.instanceLow) this.instanceLow = target + k;
        if (target + k > this.instanceHigh) this.instanceHigh = target + k;
      }
    }
  }

  /** Uploads the words that `updateRecord` changed, from the first to the last of them, in one `writeBuffer`. */
  private uploadInstances(buffer: GPUBuffer): void {
    if (this.instanceHigh < this.instanceLow) return;
    const first = this.instanceLow;
    this.options.registry.writeBuffer(this.options.device.queue, buffer, first * 4, this.instanceMirror.buffer as ArrayBuffer, first * 4, (this.instanceHigh + 1 - first) * 4);
  }

  /**
   * `P * V` of the active camera for the target's aspect ratio. The matrix is a function of the camera's position,
   * target or rotation, its projection and the aspect ratio; when those numbers equal the previous frame's the
   * previous matrix (the same object) is returned.
   */
  private viewProjection(aspect: number): Mat4 {
    const { camera } = this.options.world;
    const key = this.nextViewKey;
    const projection = camera.projection;
    const { position, target, rotation } = camera;
    key[0] = aspect;
    key[1] = projection.kind === "perspective" ? 0 : 1;
    key[2] = projection.kind === "perspective" ? projection.fov_y : projection.height;
    key[3] = projection.near;
    key[4] = projection.far;
    key[5] = position.x;
    key[6] = position.y;
    key[7] = position.z;
    if (target !== null) {
      key[8] = 1;
      key[9] = target.x;
      key[10] = target.y;
      key[11] = target.z;
      key[12] = 0;
    } else {
      key[8] = 0;
      key[9] = rotation.x;
      key[10] = rotation.y;
      key[11] = rotation.z;
      key[12] = rotation.w;
    }
    if (this.viewKeyValid) {
      let same = true;
      for (let i = 0; i < VIEW_KEY_LENGTH; i++) {
        if (key[i] !== this.viewKey[i]) {
          same = false;
          break;
        }
      }
      if (same) return this.lastViewProj;
    }
    this.viewKeyValid = false;
    try {
      this.lastView = viewMatrix(position, target !== null ? { target } : { rotation });
      this.viewKeyValid = true;
    } catch (error) {
      // Unreachable for checked programs (position = target is rejected on write, E8011); keep the last view.
      this.reportCamera(error instanceof Error ? error.message : String(error));
    }
    const p =
      projection.kind === "perspective"
        ? perspective(projection.fov_y, aspect, projection.near, projection.far)
        : orthographic(projection.height, aspect, projection.near, projection.far);
    this.lastViewProj = multiply(p, this.lastView);
    if (this.viewKeyValid) this.viewKey.set(key);
    return this.lastViewProj;
  }

  private reportCamera(message: string): void {
    const { manifest, report, world } = this.options;
    const info = world.cameraInfo();
    const span = spanOfSymbol(manifest, info.symbol);
    report(
      makeRuntimeDiagnostic("E8011", {
        phase: "runtime:render",
        message: `Invalid value for camera '${info.name}': ${message}; the previous view is kept.`,
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
      this.writeExposure(memory, base, exposureScale(this.options.world.cameraInfo().exposure));
      this.writeLights(memory, base, this.packedLights);
    });
    return viewProj;
  }

  /**
   * Brings the per-entity render state up to date with the world: for every entity whose world matrix was recomputed
   * since the last frame (and that has an object block) whose model matrix differs from the one held here, the bounding
   * sphere and the model and normal matrices (`entityMatrices`) are refreshed and the entity's object block is marked
   * stale. The block itself is written only when a draw reads it (`writeIndividualObjectBlocks`). Entities whose
   * world matrix was recomputed to the same bytes cost one comparison.
   */
  private applyWorldChanges(): void {
    const { world } = this.options;
    const changed = world.takeWorldChanges();
    if (this.changedEntities.length < changed.length) this.changedEntities = new Int32Array(Math.max(changed.length, this.changedEntities.length * 2));
    const { objectSlots, entityMatrices, objectStale, changedEntities } = this;
    let count = 0;
    for (let c = 0; c < changed.length; c++) {
      const index = changed[c] as number;
      if (objectSlots[index] === undefined) continue;
      const model = world.worldMatrix(index);
      const base = index * INSTANCE_FLOATS;
      // Bytes decide, as `writeIfChanged` did: `Object.is` tells +0 from -0 (and treats NaN as equal to itself).
      let same = true;
      for (let k = 0; k < 16; k++) {
        if (!Object.is(entityMatrices[base + k], model[k])) {
          same = false;
          break;
        }
      }
      if (same) continue;
      // The mesh-independent part of the bounding sphere: the centre (the model matrix applied to the mesh's local
      // centre, which is the origin for the primitive shapes), and the largest scale (radius of a unit-radius mesh).
      worldBoundingSphere(model, 1, this.sphere, this.localCentres[index]);
      this.sphereCentres[index * 3] = this.sphere.x;
      this.sphereCentres[index * 3 + 1] = this.sphere.y;
      this.sphereCentres[index * 3 + 2] = this.sphere.z;
      this.sphereScales[index] = this.sphere.radius;
      // Throws before writing anything when the matrix is singular (as `normalMatrix` always did).
      normalMatrixInto(entityMatrices, base + 16, model);
      for (let k = 0; k < 16; k++) entityMatrices[base + k] = model[k] as number;
      objectStale[index] = 1;
      changedEntities[count] = index;
      count += 1;
    }
    this.changedCount = count;
  }

  /** Writes the object block of every individually drawn entity whose block is stale (`applyWorldChanges`). */
  private writeIndividualObjectBlocks(draws: readonly DrawItem[]): void {
    const { batches, objectStale } = this;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b] as Batch;
      if (batch.firstInstance >= 0) continue;
      const draw = draws[batch.start] as DrawItem;
      if (objectStale[draw.entity] === 1) this.writeObjectBlock(draw.entity, draw.objectSlot);
    }
  }

  /** `MtekObject` (model, normal matrix) of `entity` into its slot, through the `builtin:object` writers. */
  private writeObjectBlock(entity: number, slot: number): void {
    const { entityMatrices, modelScratch, normalScratch } = this;
    const base = entity * INSTANCE_FLOATS;
    for (let k = 0; k < 16; k++) {
      modelScratch[k] = entityMatrices[base + k] as number;
      normalScratch[k] = entityMatrices[base + 16 + k] as number;
    }
    this.objectArena.writeIfChanged(slot, (memory, offset) => {
      this.writeModel(memory, offset, modelScratch);
      this.writeNormalMatrix(memory, offset, normalScratch);
    });
    this.objectStale[entity] = 0;
  }

  private encode(pass: GPURenderPassEncoder, draws: readonly DrawItem[]): void {
    const particles = this.particleBatchCount > 0;
    if (draws.length === 0 && !particles) return;
    const { plan, materials } = this.options;
    pass.setBindGroup(0, this.frameArena.bindGroupForSlot(this.frameSlot, plan.frame));
    const objectGroup = this.objectArena.bindGroupDynamic(plan.object);
    const dynamicOffset = this.dynamicOffset;
    let objectBound = false;
    let pipeline: GPURenderPipeline | undefined;
    let instance = -1;
    let mesh: GpuMesh | undefined;
    // Particles go between the opaque draws and the translucent ones (decision 0173).
    let particlesDrawn = !particles;
    for (const batch of this.batches) {
      const draw = draws[batch.start];
      if (draw === undefined) continue;
      if (!particlesDrawn && draw.translucent === true) {
        this.drawParticles(pass);
        particlesDrawn = true;
        pipeline = undefined;
        instance = -1;
        mesh = undefined;
        objectBound = true;
      }
      const instanced = batch.firstInstance >= 0;
      const wanted = instanced ? draw.instancedPipeline : draw.pipeline;
      if (wanted === undefined) throw new Error("internal error: an instanced draw without an instanced pipeline");
      if (wanted !== pipeline) {
        pass.setPipeline(wanted);
        pipeline = wanted;
        // Another pipeline may read other attributes: rebind the mesh's buffers (and the instance buffer, whose slot follows them).
        mesh = undefined;
        if (instanced && this.instanceBuffer !== undefined) pass.setVertexBuffer(draw.attributes.length, this.instanceBuffer);
      }
      if (draw.instance !== instance) {
        pass.setBindGroup(1, materials.bindGroup(draw.instance));
        instance = draw.instance;
      }
      if (draw.gpuMesh !== mesh) {
        for (let slot = 0; slot < draw.attributes.length; slot++) {
          pass.setVertexBuffer(slot, vertexBufferOf(draw.gpuMesh, draw.attributes[slot] as MtekVertexAttribute));
        }
        pass.setIndexBuffer(draw.gpuMesh.indexBuffer, draw.gpuMesh.indexFormat);
        mesh = draw.gpuMesh;
      }
      if (instanced) {
        // The instanced entry point does not read group 2, but the pipeline layout has it: bind it once, at any slot.
        if (!objectBound) {
          dynamicOffset[0] = 0;
          pass.setBindGroup(2, objectGroup, dynamicOffset);
          objectBound = true;
        }
        pass.drawIndexed(draw.gpuMesh.indexCount, batch.count, 0, 0, batch.firstInstance);
      } else {
        dynamicOffset[0] = this.objectArena.slotOffset(draw.objectSlot);
        pass.setBindGroup(2, objectGroup, dynamicOffset);
        objectBound = true;
        pass.drawIndexed(draw.gpuMesh.indexCount);
      }
    }
    if (!particlesDrawn) this.drawParticles(pass);
  }

  /**
   * Camera-facing billboards for living particles (decisions 0155, 0173). Each particle is one record of the
   * instanced pipeline, because a shared object slot would show only the last write after submit. The records are
   * written here, before the pass, into `particleMirror`; `drawParticles` encodes the calls. An emitter whose material
   * blends (a Sprite, a colour alpha below 1) uses the blended instanced pipeline: no depth write, its particles
   * back to front, and its emitters after the opaque ones, back to front by their mean depth.
   */
  private prepareParticles(): void {
    this.particleBatchCount = 0;
    const draws = this.options.world.particleDraws();
    if (draws.length === 0) return;
    const { device, meshes, materials, registry } = this.options;
    const view = this.lastView;
    const { particleAxes: axes, particleNormal: normal, particleBatches: batches } = this;
    axes[0] = view[0] ?? 1;
    axes[1] = view[4] ?? 0;
    axes[2] = view[8] ?? 0;
    axes[3] = view[1] ?? 0;
    axes[4] = view[5] ?? 1;
    axes[5] = view[9] ?? 0;
    axes[6] = view[2] ?? 0;
    axes[7] = view[6] ?? 0;
    axes[8] = view[10] ?? 1;
    let total = 0;
    for (const draw of draws) total += draw.points.length;
    if (total === 0) return;
    if (total > PARTICLE_DRAW_CAP && !this.particleCapReported) {
      this.particleCapReported = true;
      this.options.report(
        makeRuntimeDiagnostic("W8210", {
          phase: "runtime:render",
          message: `${String(total)} particles are alive; only the first ${String(PARTICLE_DRAW_CAP)} are drawn.`,
          expected: `at most ${String(PARTICLE_DRAW_CAP)} particles drawn per frame`,
        }),
      );
    }
    // The emitters that can be drawn this frame: opaque ones first, then the blended ones far to near.
    let count = 0;
    for (const draw of draws) {
      if (draw.points.length === 0) continue;
      const material = this.materialsById.get(draw.materialId);
      if (material === undefined) continue;
      const wanted = materials.isTranslucent(draw.instanceIndex) || alwaysBlends(material);
      const blended = wanted ? this.blendedPipeline(material, true) : undefined;
      const pipeline = blended?.pipeline ?? this.options.pipelines.get(draw.materialId)?.instanced;
      if (pipeline === undefined) continue;
      let mesh: GpuMesh;
      try {
        mesh = meshes.get(draw.meshId);
      } catch {
        continue;
      }
      const batch = (batches[count] ??= { draw, pipeline, mesh, attributes: [], instance: 0, start: 0, count: 0, blended: false, depth: 0 });
      batch.draw = draw;
      batch.pipeline = pipeline;
      batch.mesh = mesh;
      batch.attributes = material.shader.vertexAttributes;
      batch.instance = draw.instanceIndex;
      batch.blended = blended !== undefined;
      let depth = 0;
      if (batch.blended) {
        for (const point of draw.points) depth += (view[2] ?? 0) * point.x + (view[6] ?? 0) * point.y + (view[10] ?? 0) * point.z + (view[14] ?? 0);
        depth /= draw.points.length;
      }
      batch.depth = depth;
      count += 1;
    }
    if (count === 0) return;
    // Stable: the opaque emitters keep their order, the blended ones go far (most negative view z) to near.
    const order = batches.slice(0, count).sort((a, b) => Number(a.blended) - Number(b.blended) || (a.blended ? a.depth - b.depth : 0));
    for (let i = 0; i < count; i++) batches[i] = order[i] as ParticleBatch;
    this.particleMirror ??= new Float32Array(PARTICLE_DRAW_CAP * INSTANCE_FLOATS);
    const mirror = this.particleMirror;
    let written = 0;
    let live = 0;
    for (let b = 0; b < count && written < PARTICLE_DRAW_CAP; b++) {
      const batch = batches[b] as ParticleBatch;
      const points = batch.draw.points;
      const n = Math.min(points.length, PARTICLE_DRAW_CAP - written);
      const rank = this.particleRank;
      rank.length = n;
      for (let k = 0; k < n; k++) rank[k] = k;
      if (batch.blended) {
        if (this.particleDepth.length < n) this.particleDepth = new Float64Array(Math.max(n, this.particleDepth.length * 2));
        for (let k = 0; k < n; k++) {
          const point = points[k] as ParticleDraw["points"][number];
          this.particleDepth[k] = (view[2] ?? 0) * point.x + (view[6] ?? 0) * point.y + (view[10] ?? 0) * point.z + (view[14] ?? 0);
        }
        rank.sort(this.byParticleDepth);
      }
      batch.start = written;
      for (let k = 0; k < n; k++) {
        const point = points[rank[k] as number] as ParticleDraw["points"][number];
        const base = written * INSTANCE_FLOATS;
        const size = point.size;
        // A plane lies in local XZ and faces local +Y. local +Y points at the camera. local +Z is
        // -up so the basis stays right-handed: a positive determinant keeps the front face toward
        // the camera (back-face culling would drop the other orientation).
        writeBasis(mirror, base, axes, 0, size);
        writeBasis(mirror, base + 4, axes, 6, size);
        writeBasis(mirror, base + 8, axes, 3, -size);
        mirror[base + 12] = point.x;
        mirror[base + 13] = point.y;
        mirror[base + 14] = point.z;
        mirror[base + 15] = 1;
        normalMatrixInto(normal, 0, mirror.subarray(base, base + 16));
        mirror.set(normal, base + 16);
        written += 1;
      }
      batch.count = n;
      live += 1;
    }
    this.particleBatchCount = live;
    if (written === 0) return;
    this.particleBuffer ??= registry.createBuffer({
      label: "mtek particle billboards",
      size: PARTICLE_DRAW_CAP * INSTANCE_STRIDE,
      usage: BUFFER_USAGE_VERTEX | BUFFER_USAGE_COPY_DST,
    });
    registry.writeBuffer(device.queue, this.particleBuffer, 0, mirror.buffer as ArrayBuffer, 0, written * INSTANCE_STRIDE);
  }

  /** Encodes the calls `prepareParticles` made ready. Binds groups 0 and 2 itself: the caller forgets its pipeline, group 1 and mesh. */
  private drawParticles(pass: GPURenderPassEncoder): void {
    const { plan, materials } = this.options;
    const buffer = this.particleBuffer;
    if (buffer === undefined) return;
    pass.setBindGroup(0, this.frameArena.bindGroupForSlot(this.frameSlot, plan.frame));
    const dynamicOffset = this.dynamicOffset;
    dynamicOffset[0] = 0;
    pass.setBindGroup(2, this.objectArena.bindGroupDynamic(plan.object), dynamicOffset);
    for (let b = 0; b < this.particleBatchCount; b++) {
      const batch = this.particleBatches[b] as ParticleBatch;
      pass.setPipeline(batch.pipeline);
      pass.setBindGroup(1, materials.bindGroup(batch.instance));
      for (let slot = 0; slot < batch.attributes.length; slot += 1) {
        pass.setVertexBuffer(slot, vertexBufferOf(batch.mesh, batch.attributes[slot] as MtekVertexAttribute));
      }
      pass.setVertexBuffer(batch.attributes.length, buffer);
      pass.setIndexBuffer(batch.mesh.indexBuffer, batch.mesh.indexFormat);
      pass.drawIndexed(batch.mesh.indexCount, batch.count, 0, 0, batch.start);
    }
  }
}

/** One draw call of the particles of a frame (a reused record). */
interface ParticleBatch {
  draw: ParticleDraw;
  pipeline: GPURenderPipeline;
  mesh: GpuMesh;
  attributes: readonly MtekVertexAttribute[];
  instance: number;
  start: number;
  count: number;
  blended: boolean;
  /** Mean view-space z of the particles: the farthest are the most negative. */
  depth: number;
}

const PARTICLE_DRAW_CAP = 256;

function writeBasis(out: Float32Array, at: number, axes: Float64Array, axis: number, size: number): void {
  out[at] = (axes[axis] ?? 0) * size;
  out[at + 1] = (axes[axis + 1] ?? 0) * size;
  out[at + 2] = (axes[axis + 2] ?? 0) * size;
  out[at + 3] = 0;
}

/**
 * The exposure scale of an EV100 value (decision 0081, Filament's photometric exposure for a camera at
 * ISO 100): `1 / (1.2 * 2^ev100)`. The default EV100 `-log2(1.2 * pi)` gives pi, so a white Lambertian
 * surface under a 1 lux directional light (radiance 1/pi) is shown as 1.0.
 */
export function exposureScale(ev100: number): number {
  return 1 / (1.2 * 2 ** ev100);
}
