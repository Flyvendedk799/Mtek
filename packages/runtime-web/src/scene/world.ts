/**
 * The CPU world of a mounted scene (`spec/runtime-abi.md` sections 4.2, 4.3 and 5.2; `spec/scenes.md`
 * sections 3, 11 and 12): entity records, the active camera record, the generated-code context (`ctx`)
 * and world-matrix propagation.
 *
 * The manifest carries structure only. The world creates every record with the registry defaults
 * (`spec/stdlib.md` section 3), then `scenes.<Entry>.init(ctx)` sets every camera field, transform,
 * visibility and material param through the setters of the context.
 *
 * The context implements the subset of ABI 1 listed in {@link CONTEXT_MEMBERS} (decisions 0031, 0050,
 * 0053). Any other member throws a `RuntimeInternalError` naming it: programs never use one (the
 * compiler gates them by milestone), so reaching one is a bug.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import {
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  type MtekDiagnostic,
  type MtekRuntimePhase,
} from "../diagnostics/types.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { fromRotationTranslationScale, multiply, type Mat4 } from "../math/mat4.js";
import { DynamicEntities, type DynamicHost, type PrefabRuntime } from "./dynamic.js";
import { RuntimeInternalError } from "./errors.js";
import { makeRef, type EntityRef } from "./slots.js";
import type { ResolvedEntity, SceneStructure } from "./structure.js";
import {
  describeValue,
  isColor,
  type Color,
  isFiniteQuat,
  isFiniteVec3,
  isQuat,
  isVec3,
  paramValueProblem,
  type Quat,
  type Vec3,
} from "./values.js";

export { RuntimeInternalError };
export type { EntityRef };

/** The members of `ctx` this runtime build provides (decisions 0031, 0050 and 0064). */
export const CONTEXT_MEMBERS = [
  "s",
  "e",
  "cam",
  "frame",
  "setTransform",
  "setVisible",
  "setParam",
  "setCamera",
  "setLight",
  "spawn",
  "destroy",
  "alive",
  "warn",
  "random",
  "isKeyDown",
  "print",
] as const;

/**
 * The light of an entity (`entity.light`, `spec/materials.md` section 7). `color` and `intensity` are
 * written only through `ctx.setLight`; `range` is construction-only (0 = unlimited, 0 for directional lights).
 */
export interface LightRecord {
  color: Color;
  intensity: number;
  readonly range: number;
}

/**
 * An entity record (`spec/runtime-abi.md` section 4.2). Generated code reads the transform fields and
 * `visible` directly and writes them only through the setters.
 */
export interface EntityRecord {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  visible: boolean;
  /** Entity state: every declared name, at its zero value until `init`; generated code writes it directly. */
  readonly state: Record<string, unknown>;
  /** Prefab params; static entities have none. */
  readonly params: Readonly<Record<string, unknown>>;
  /** The material instance: `p` holds the current param values. `null` without a material. */
  readonly mat: { readonly p: Record<string, unknown> } | null;
  /** The light component, or `null` without one. */
  readonly light: LightRecord | null;
  readonly ref: EntityRef;
}

export interface PerspectiveProjection {
  readonly kind: "perspective";
  fov_y: number;
  near: number;
  far: number;
}

export interface OrthographicProjection {
  readonly kind: "orthographic";
  height: number;
  near: number;
  far: number;
}

/** The active camera (`ctx.cam`). `target` is `null` until set, and always `null` for a camera without one. */
export interface CameraRecord {
  position: Vec3;
  target: Vec3 | null;
  rotation: Quat;
  readonly projection: PerspectiveProjection | OrthographicProjection;
}

/** `ctx.frame` (`spec/runtime-abi.md` section 4.2): already converted to f32/f32/u32. */
export interface FrameValues {
  readonly time: number;
  readonly delta: number;
  readonly index: number;
}

/** Where material param values go: the material instance's parameter block (`render/materials.ts`). */
export interface ParamSink {
  /** Writes `value` through the generated field writer of param `name` of material instance `instance`. */
  writeParam(instance: number, name: string, value: unknown): void;
}

/** The CPU intrinsics generated code reaches through `ctx` (`spec/runtime-abi.md` section 4.2). */
export interface CpuServices {
  /** `random()`: an f32 in `[0, 1)`. */
  random(): number;
  /** `is_key_down`: the delivered key state. `code` is a DOM `KeyboardEvent.code`. */
  isKeyDown(code: string): boolean;
  /** `print`: development console output; `spanId` indexes the manifest spans table. */
  print(message: string, spanId: number): void;
}

/** Services for a world nothing drives: no keys held, a fixed sequence of zeros, no output. */
export const INERT_SERVICES: CpuServices = Object.freeze({
  random: () => 0,
  isKeyDown: () => false,
  print: () => undefined,
});

export interface WorldOptions {
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly params: ParamSink;
  /** Receives run-time diagnostics (`E8011`, `E8090`, `E8100`, warnings from `ctx.warn`). */
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /** Defaults to {@link INERT_SERVICES}. */
  readonly services?: CpuServices;
  /** The prefabs the program spawns (`manifest.prefabs`) with their code; none when the program spawns nothing. */
  readonly prefabs?: ReadonlyMap<string, PrefabRuntime>;
}

const CAMERA_FIELDS = [
  "position",
  "target",
  "rotation",
  "projection.fov_y",
  "projection.height",
  "projection.near",
  "projection.far",
] as const;
type CameraField = (typeof CAMERA_FIELDS)[number];

const TRANSFORM_FIELDS = ["position", "rotation", "scale"] as const;
type TransformField = (typeof TRANSFORM_FIELDS)[number];

// Registry defaults (spec/stdlib.md section 3.2, spec/scenes.md section 3), as binary32 values.
const f32 = Math.fround;
const ORIGIN: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const UNIT_SCALE: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });
const IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const CAMERA_POSITION: Vec3 = Object.freeze({ x: 0, y: 0, z: 5 });
const DEFAULT_FOV_Y = f32(0.9);
const DEFAULT_HEIGHT = 10;
const DEFAULT_NEAR = f32(0.1);
const DEFAULT_FAR = 1000;
const WHITE: Color = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
const LIGHT_FIELDS = ["color", "intensity"] as const;

/** The zero value of a param type, the mirror's content before `init` writes it. */
function zeroValue(type: string): unknown {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
      return 0;
    case "bool":
      return false;
    case "string":
      return "";
    case "vec2":
      return Object.freeze({ x: 0, y: 0 });
    case "vec3":
      return ORIGIN;
    case "vec4":
      return Object.freeze({ x: 0, y: 0, z: 0, w: 0 });
    case "quat":
      return IDENTITY;
    case "color":
      return Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
    case "mat4":
      return new Float32Array(16);
    default:
      return null;
  }
}

function sameQuat(a: Quat, b: Quat): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isWarningCode(code: string): code is keyof typeof RUNTIME_DIAGNOSTIC_CATALOGUE {
  return code.startsWith("W") && Object.hasOwn(RUNTIME_DIAGNOSTIC_CATALOGUE, code);
}

/**
 * A state object: every declared name set to the zero value of its type. It has no prototype, so a
 * state named like an `Object.prototype` member (`constructor`, `__proto__`) is an ordinary entry.
 */
function stateObject(entries: readonly { readonly name: string; readonly type: string }[]): Record<string, unknown> {
  const state: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const entry of entries) state[entry.name] = zeroValue(entry.type);
  return state;
}

/** Wraps `members` so that reading or assigning any other member throws an internal error naming it. */
function guarded<T extends object>(members: T, name: string): T {
  return new Proxy(members, {
    get(target, property, receiver) {
      if (typeof property === "symbol" || Object.hasOwn(target, property)) return Reflect.get(target, property, receiver) as unknown;
      throw new RuntimeInternalError(
        `generated code read ${name}.${property}, which this runtime build does not provide (the context has ${CONTEXT_MEMBERS.join(", ")}).`,
      );
    },
    set(_target, property) {
      throw new RuntimeInternalError(`generated code assigned ${name}.${String(property)}; the context is read-only.`);
    },
    defineProperty(_target, property) {
      throw new RuntimeInternalError(`generated code defined ${name}.${String(property)}; the context is read-only.`);
    },
    deleteProperty(_target, property) {
      throw new RuntimeInternalError(`generated code deleted ${name}.${String(property)}; the context is read-only.`);
    },
  });
}

export class World {
  /** The generated-code context. */
  readonly ctx: object;
  /** Entity records of the named entities by static index (`ctx.e`). Spawned entities: {@link World.dynamic}. */
  readonly entities: readonly EntityRecord[];
  readonly camera: CameraRecord;
  /** The scene state (`ctx.s`). */
  readonly sceneState: Record<string, unknown>;
  /** The spawned entities: queues, flush points, records (decision 0064). */
  readonly dynamic: DynamicEntities;
  /** Phase recorded in diagnostics. `runtime:mount` during initialisation. */
  phase: MtekRuntimePhase = "runtime:mount";

  private readonly manifest: MtekManifest;
  private readonly structure: SceneStructure;
  private params: ParamSink;
  private readonly report: (diagnostic: MtekDiagnostic) => void;
  /** The slot of every record: the static index, or the slot of a spawned entity. */
  private readonly indexByRecord = new Map<object, number>();
  /** The records by slot: the named entities, then the spawned ones that exist. */
  private readonly records: (EntityRecord | undefined)[] = [];
  /** What the setters know of each slot (name, symbol, material instance). */
  private readonly resolvedBySlot: (ResolvedEntity | undefined)[] = [];
  private worlds: (Mat4 | undefined)[];
  private transformDirty: Uint8Array;
  private worldChanged: Uint8Array;
  private frameValues: FrameValues = Object.freeze({ time: 0, delta: 0, index: 0 });
  private initialising = false;
  private visibility = 0;
  private readonly materialParamTypes: ReadonlyMap<string, readonly { readonly name: string; readonly type: string }[]>;

  constructor(options: WorldOptions) {
    this.manifest = options.manifest;
    this.structure = options.structure;
    this.params = options.params;
    this.report = options.report;

    const materialParams = new Map(this.structure.materials.map((material) => [material.id, material.params]));
    this.materialParamTypes = materialParams;
    const lightOf = new Map(this.structure.lights.map((light) => [light.entity, light]));
    this.entities = Object.freeze(
      this.structure.entities.map((entity): EntityRecord => {
        const params = entity.instance === null ? undefined : materialParams.get(entity.instance.material.id);
        const light = lightOf.get(entity.index);
        const record: EntityRecord = {
          position: ORIGIN,
          rotation: IDENTITY,
          scale: UNIT_SCALE,
          visible: true,
          state: stateObject(this.manifest.scene.entities[entity.index]?.state ?? []),
          params: Object.freeze({}),
          mat: params === undefined ? null : { p: Object.fromEntries(params.map((param) => [param.name, zeroValue(param.type)])) },
          // The registry defaults (`spec/stdlib.md` section 3.6); `init` sets every unbound field.
          light: light === undefined ? null : { color: WHITE, intensity: 1, range: light.range },
          ref: makeRef(entity.index, 0),
        };
        this.indexByRecord.set(record, entity.index);
        this.records[entity.index] = record;
        this.resolvedBySlot[entity.index] = entity;
        return record;
      }),
    );
    const count = this.entities.length;
    this.worlds = Array.from({ length: count }, () => new Float32Array(16));
    this.transformDirty = new Uint8Array(count).fill(1);
    this.worldChanged = new Uint8Array(count);
    const host: DynamicHost = {
      get ctx(): object {
        if (holder.ctx === undefined) throw new RuntimeInternalError("the context was used before the world was built.");
        return holder.ctx;
      },
      get phase(): MtekRuntimePhase {
        return currentPhase();
      },
      makeRecord: (ref, resolved, prefab, params) => this.makeDynamicRecord(ref, resolved, prefab, params),
      register: (slot, record, resolved) => {
        this.registerDynamic(slot, record, resolved);
      },
      unregister: (slot, record) => {
        this.unregisterDynamic(slot, record);
      },
      source: (spanId) => resolveSpan(this.manifest, spanId),
      report: (diagnostic) => {
        this.report(diagnostic);
      },
    };
    const holder: { ctx?: object } = {};
    const currentPhase = (): MtekRuntimePhase => this.phase;
    this.dynamic = new DynamicEntities({
      prefabs: options.prefabs ?? new Map(),
      staticCount: count,
      maxEntities: this.manifest.runtimeConfig.maxEntities,
      firstInstance: this.structure.instances.length,
      host,
    });

    const camera = this.structure.camera;
    this.camera = {
      position: CAMERA_POSITION,
      target: null,
      rotation: IDENTITY,
      projection:
        camera.projection === "perspective"
          ? { kind: "perspective", fov_y: DEFAULT_FOV_Y, near: DEFAULT_NEAR, far: DEFAULT_FAR }
          : { kind: "orthographic", height: DEFAULT_HEIGHT, near: DEFAULT_NEAR, far: DEFAULT_FAR },
    };

    this.sceneState = stateObject(this.manifest.scene.state);
    const services = options.services ?? INERT_SERVICES;
    const members = {
      s: this.sceneState,
      e: this.entities,
      cam: this.camera,
      setTransform: (entity: unknown, field: unknown, value: unknown): void => {
        this.setTransform(entity, field, value);
      },
      setVisible: (entity: unknown, value: unknown): void => {
        this.setVisible(entity, value);
      },
      setParam: (entity: unknown, name: unknown, value: unknown): void => {
        this.setParam(entity, name, value);
      },
      setCamera: (field: unknown, value: unknown): void => {
        this.setCamera(field, value);
      },
      setLight: (entity: unknown, field: unknown, value: unknown): void => {
        this.setLight(entity, field, value);
      },
      spawn: (prefab: unknown, params: unknown, spanId: unknown): EntityRef => this.dynamic.spawn(prefab, params, spanId),
      destroy: (ref: unknown, spanId: unknown): void => {
        this.dynamic.destroy(ref, spanId);
      },
      alive: (ref: unknown): boolean => this.dynamic.alive(ref),
      warn: (code: unknown, spanId: unknown): void => {
        this.warn(code, spanId);
      },
      random: (): number => services.random(),
      isKeyDown: (code: unknown): boolean => {
        if (typeof code !== "string") throw new RuntimeInternalError(`ctx.isKeyDown got ${describeValue(code)}; expected a DOM key code.`);
        return services.isKeyDown(code);
      },
      print: (message: unknown, spanId: unknown): void => {
        services.print(typeof message === "string" ? message : describeValue(message), typeof spanId === "number" ? spanId : -1);
      },
    };
    Object.defineProperty(members, "frame", { enumerable: true, get: () => this.frameValues });
    this.ctx = guarded(members, "ctx");
    holder.ctx = this.ctx;
  }

  /** `ctx.frame` as generated code sees it. */
  get frame(): FrameValues {
    return this.frameValues;
  }

  /** Incremented by every `setVisible` that changed a value: the draw list depends on it. */
  get visibilityVersion(): number {
    return this.visibility;
  }

  /**
   * Runs `init(ctx)` (`spec/runtime-abi.md` section 4.3), then checks the camera as a whole (the
   * relations between fields are checked on later writes; during initialisation the compiler has
   * already checked them, `E5010`/`E5011`) and propagates transforms. Errors thrown by `init` propagate.
   */
  initialise(init: (ctx: object) => void, afterInit?: () => void): void {
    this.initialising = true;
    try {
      init(this.ctx);
      // Bindings are evaluated once after `init`, so bound fields have values before the first frame.
      afterInit?.();
    } finally {
      this.initialising = false;
    }
    const problem = this.cameraProblem(this.camera);
    if (problem !== undefined) this.reportCamera(`after initialisation ${problem}.`);
    this.propagate();
  }

  /**
   * Device recovery (`spec/runtime-abi.md` section 9.4): the records are the retained CPU state, so the world
   * survives a lost device. This points it at the rebuilt parameter store, writes every mirrored param value
   * into it through the generated writers (the bytes the lost device held), and marks every world matrix as
   * changed so the rebuilt object arena is filled by the next frame.
   */
  rebindParams(sink: ParamSink): void {
    this.params = sink;
    for (const entity of this.structure.entities) {
      const record = this.entities[entity.index];
      if (entity.instance === null || record?.mat == null) continue;
      const { params, resources } = entity.instance.material;
      for (const param of params) {
        // A texture or sampler is a binding of the group, not a field of the block (decision 0054): the rebuilt
        // material store binds it again from the manifest.
        if (resources.some((resource) => resource.name === param.name)) continue;
        sink.writeParam(entity.instance.index, param.name, record.mat.p[param.name]);
      }
    }
    // The spawned entities are rebuilt by `dynamic.rebuild` once the new stores exist.
    this.worldChanged.fill(1);
  }

  /** Sets `ctx.frame` for the frame about to run. */
  setFrame(time: number, delta: number, index: number): void {
    this.frameValues = Object.freeze({ time: f32(time), delta: f32(delta), index: index >>> 0 });
  }

  /**
   * Propagates local transforms to world matrices, parents before children (`spec/scenes.md` section 12:
   * `L = T * R * S`, `W = W_parent * L`). Only entities whose transform or parent changed are recomputed.
   * The named entities come first; a spawned entity is a root. Returns the number of world matrices recomputed.
   */
  propagate(): number {
    const recomputed = new Uint8Array(this.entities.length);
    let count = 0;
    for (const entity of this.structure.entities) {
      const i = entity.index;
      const parent = entity.parent;
      if (this.transformDirty[i] !== 1 && (parent === null || recomputed[parent] !== 1)) continue;
      const record = this.entities[i];
      if (record === undefined) continue;
      const local = fromRotationTranslationScale(record.rotation, record.position, record.scale);
      const parentWorld = parent === null ? undefined : this.worlds[parent];
      this.worlds[i] = parentWorld === undefined ? local : multiply(parentWorld, local);
      this.transformDirty[i] = 0;
      this.worldChanged[i] = 1;
      recomputed[i] = 1;
      count += 1;
    }
    for (const entity of this.dynamic.live) {
      const i = entity.ref.slot;
      if (this.transformDirty[i] !== 1) continue;
      const record = entity.record;
      this.worlds[i] = fromRotationTranslationScale(record.rotation, record.position, record.scale);
      this.transformDirty[i] = 0;
      this.worldChanged[i] = 1;
      count += 1;
    }
    return count;
  }

  /** The world matrix of the entity in slot `index` as of the last `propagate()`. */
  worldMatrix(index: number): Mat4 {
    const matrix = this.worlds[index];
    if (matrix === undefined) throw new RangeError(`no entity ${String(index)}`);
    return matrix;
  }

  /** Returns, by slot, the entities whose world matrix changed since the last call, and forgets them. */
  takeWorldChanges(): number[] {
    const changed: number[] = [];
    this.worldChanged.forEach((flag, index) => {
      if (flag === 1) changed.push(index);
    });
    this.worldChanged.fill(0);
    return changed;
  }

  /** The record in slot `slot`: a named entity or a spawned one that exists. */
  recordAt(slot: number): EntityRecord | undefined {
    return this.records[slot];
  }

  /** What the world knows of the entity in slot `slot` (name, symbol, mesh, material instance). */
  resolvedAt(slot: number): ResolvedEntity | undefined {
    return this.resolvedBySlot[slot];
  }

  // ---- the spawned entities' side of the world ----

  /** A new record for a spawned entity at the registry defaults (decision 0064). */
  private makeDynamicRecord(
    ref: EntityRef,
    resolved: ResolvedEntity,
    prefab: PrefabRuntime,
    params: Readonly<Record<string, unknown>>,
  ): EntityRecord {
    const material = resolved.instance === null ? undefined : this.materialParamTypes.get(resolved.instance.material.id);
    return {
      position: ORIGIN,
      rotation: IDENTITY,
      scale: UNIT_SCALE,
      visible: true,
      state: stateObject(prefab.resolved.state),
      params,
      mat: material === undefined ? null : { p: Object.fromEntries(material.map((param) => [param.name, zeroValue(param.type)])) },
      light: null,
      ref,
    };
  }

  /** Grows the per-slot arrays to hold `slots` slots. */
  private ensureSlots(slots: number): void {
    if (slots <= this.transformDirty.length) return;
    const capacity = Math.max(slots, this.transformDirty.length * 2);
    const dirty = new Uint8Array(capacity);
    dirty.set(this.transformDirty);
    const changed = new Uint8Array(capacity);
    changed.set(this.worldChanged);
    this.transformDirty = dirty;
    this.worldChanged = changed;
  }

  private registerDynamic(slot: number, record: EntityRecord, resolved: ResolvedEntity): void {
    this.ensureSlots(slot + 1);
    this.records[slot] = record;
    this.resolvedBySlot[slot] = resolved;
    this.indexByRecord.set(record, slot);
    this.worlds[slot] = new Float32Array(16);
    this.transformDirty[slot] = 1;
    this.worldChanged[slot] = 0;
  }

  private unregisterDynamic(slot: number, record: EntityRecord): void {
    this.indexByRecord.delete(record);
    this.records[slot] = undefined;
    this.resolvedBySlot[slot] = undefined;
    this.worlds[slot] = undefined;
    this.transformDirty[slot] = 0;
    this.worldChanged[slot] = 0;
  }

  // ---- the setters of the context ----

  private indexOf(entity: unknown, setter: string): number {
    const index = typeof entity === "object" && entity !== null ? this.indexByRecord.get(entity) : undefined;
    if (index === undefined) throw new RuntimeInternalError(`generated code passed ${describeValue(entity)} to ctx.${setter}, which is not an entity record.`);
    return index;
  }

  private entitySource(index: number): ReturnType<typeof resolveSpan> {
    const symbol = this.resolvedBySlot[index]?.symbol;
    const span = symbol === undefined ? undefined : spanOfSymbol(this.manifest, symbol);
    return span === undefined ? null : resolveSpan(this.manifest, span);
  }

  private setTransform(entity: unknown, field: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setTransform");
    const record = this.records[index];
    if (record === undefined) return;
    if (!TRANSFORM_FIELDS.includes(field as TransformField)) {
      throw new RuntimeInternalError(`ctx.setTransform got the field ${describeValue(field)}; expected position, rotation or scale.`);
    }
    const name = field as TransformField;
    if (name === "rotation") {
      if (!isQuat(value)) throw new RuntimeInternalError(`ctx.setTransform(…, "rotation", ${describeValue(value)}) expects a quat.`);
      if (sameQuat(record.rotation, value)) return;
      record.rotation = value;
    } else {
      if (!isVec3(value)) throw new RuntimeInternalError(`ctx.setTransform(…, "${name}", ${describeValue(value)}) expects a vec3.`);
      if (name === "scale" && !(isFiniteVec3(value) && value.x > 0 && value.y > 0 && value.z > 0)) {
        this.report(
          makeRuntimeDiagnostic("E8090", {
            phase: this.phase,
            message: `The scale ${describeValue(value)} written to entity '${this.resolvedBySlot[index]?.name ?? String(index)}' is invalid: every component must be finite and greater than 0. The write is ignored.`,
            source: this.entitySource(index),
          }),
        );
        return;
      }
      if (sameVec3(name === "position" ? record.position : record.scale, value)) return;
      if (name === "position") record.position = value;
      else record.scale = value;
    }
    this.transformDirty[index] = 1;
  }

  private setVisible(entity: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setVisible");
    const record = this.records[index];
    if (record === undefined) return;
    if (typeof value !== "boolean") throw new RuntimeInternalError(`ctx.setVisible got ${describeValue(value)}; expected a bool.`);
    if (record.visible !== value) {
      record.visible = value;
      this.visibility += 1;
    }
  }

  /**
   * `app.debug.setParam` (`spec/runtime-abi.md` section 10.2): writes a material param of the entity called
   * `entityName` (its name, or its qualified symbol when several entities share the name) through the same
   * path as `ctx.setParam`, so the generated field writer, the mirror and the opaque-colour rule
   * (`E8100`) apply. Mistakes of the caller throw plain errors naming what exists; they are not diagnostics.
   */
  setParamByName(entityName: string, param: string, value: unknown): void {
    const matches = this.structure.entities.filter((entity) => entity.name === entityName || entity.symbol === entityName);
    if (matches.length === 0) {
      throw new RangeError(`debug.setParam: no entity named '${entityName}' (entities: ${this.structure.entities.map((entity) => entity.name).join(", ")}).`);
    }
    if (matches.length > 1) {
      throw new RangeError(`debug.setParam: '${entityName}' names ${String(matches.length)} entities; use one of ${matches.map((entity) => `'${entity.symbol}'`).join(", ")}.`);
    }
    const entity = matches[0];
    const record = entity === undefined ? undefined : this.entities[entity.index];
    if (entity === undefined || record === undefined) return;
    if (entity.instance === null) throw new RangeError(`debug.setParam: entity '${entityName}' has no material.`);
    const declared = entity.instance.material.params.find((candidate) => candidate.name === param);
    if (declared === undefined) {
      const names = entity.instance.material.params.map((candidate) => candidate.name).join(", ");
      throw new RangeError(`debug.setParam: material '${entity.instance.material.id}' declares no param '${param}' (params: ${names === "" ? "none" : names}).`);
    }
    const problem = paramValueProblem(declared.type, value);
    if (problem !== undefined) {
      throw new TypeError(`debug.setParam: param '${param}' of '${entityName}' is a ${declared.type}; got ${describeValue(value)}: ${problem}.`);
    }
    this.setParam(record, param, value);
  }

  private setParam(entity: unknown, name: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setParam");
    const record = this.records[index];
    const instance = this.resolvedBySlot[index]?.instance;
    if (record === undefined || record.mat === null || instance === null || instance === undefined) {
      throw new RuntimeInternalError(`ctx.setParam was called for entity ${String(index)}, which has no material.`);
    }
    const param = typeof name === "string" ? instance.material.params.find((candidate) => candidate.name === name) : undefined;
    if (param === undefined) {
      throw new RuntimeInternalError(`ctx.setParam got the param ${describeValue(name)}, which material '${instance.material.id}' does not declare.`);
    }
    if (param.type === "color") {
      if (!isColor(value)) throw new RuntimeInternalError(`ctx.setParam(…, "${param.name}", ${describeValue(value)}) expects a color.`);
      if (value.a !== 1) {
        this.report(
          makeRuntimeDiagnostic("E8100", {
            phase: this.phase,
            message: `The colour ${describeValue(value)} for param '${param.name}' of entity '${this.resolvedBySlot[index]?.name ?? String(index)}' is not opaque: material colours must have alpha 1.0 in v0.1. The previous value stays.`,
            source: this.entitySource(index),
          }),
        );
        return;
      }
    }
    this.params.writeParam(instance.index, param.name, value);
    record.mat.p[param.name] = value;
  }

  /** `ctx.setLight(e, "color" | "intensity", value)`; `range` is construction-only and never written. */
  private setLight(entity: unknown, field: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setLight");
    const light = this.records[index]?.light;
    if (light === null || light === undefined) {
      throw new RuntimeInternalError(`ctx.setLight was called for entity ${String(index)}, which has no light.`);
    }
    if (!LIGHT_FIELDS.includes(field as (typeof LIGHT_FIELDS)[number])) {
      throw new RuntimeInternalError(`ctx.setLight got the field ${describeValue(field)}; expected color or intensity.`);
    }
    if (field === "color") {
      if (!isColor(value)) throw new RuntimeInternalError(`ctx.setLight(…, "color", ${describeValue(value)}) expects a color.`);
      light.color = value;
    } else {
      if (typeof value !== "number") throw new RuntimeInternalError(`ctx.setLight(…, "intensity", ${describeValue(value)}) expects an f32.`);
      light.intensity = value;
    }
  }

  private setCamera(field: unknown, value: unknown): void {
    if (!CAMERA_FIELDS.includes(field as CameraField)) {
      throw new RuntimeInternalError(`ctx.setCamera got the field ${describeValue(field)}; expected one of ${CAMERA_FIELDS.join(", ")}.`);
    }
    const name = field as CameraField;
    const camera = this.camera;
    const projection = camera.projection;
    switch (name) {
      case "position":
      case "target": {
        if (!isVec3(value)) throw new RuntimeInternalError(`ctx.setCamera("${name}", ${describeValue(value)}) expects a vec3.`);
        if (name === "target" && !this.structure.camera.hasTarget) {
          throw new RuntimeInternalError(`ctx.setCamera("target", …) was called for camera '${this.structure.camera.name}', which declares no target.`);
        }
        const next: CameraRecord = { ...camera, [name]: value };
        if (!this.acceptCamera(next, name, value)) return;
        if (name === "position") camera.position = value;
        else camera.target = value;
        return;
      }
      case "rotation":
        if (!isQuat(value)) throw new RuntimeInternalError(`ctx.setCamera("rotation", ${describeValue(value)}) expects a quat.`);
        if (!isFiniteQuat(value)) {
          this.reportCamera(`writing ${describeValue(value)} to rotation is invalid: the rotation is not finite. The write is ignored.`);
          return;
        }
        camera.rotation = value;
        return;
      default: {
        if (typeof value !== "number") throw new RuntimeInternalError(`ctx.setCamera("${name}", ${describeValue(value)}) expects an f32.`);
        const key = name.slice("projection.".length) as "fov_y" | "height" | "near" | "far";
        if (!(key in projection)) {
          throw new RuntimeInternalError(`ctx.setCamera("${name}", …) does not apply to a ${projection.kind} camera.`);
        }
        const nextProjection = { ...projection, [key]: value };
        if (!this.acceptCamera({ ...camera, projection: nextProjection }, name, value)) return;
        (projection as unknown as Record<string, number>)[key] = value;
        return;
      }
    }
  }

  /** Checks a candidate camera; reports `E8011` and returns false when the write must be ignored. */
  private acceptCamera(candidate: CameraRecord, field: CameraField, value: unknown): boolean {
    const problem = this.cameraProblem(candidate, field);
    if (problem === undefined) return true;
    this.reportCamera(`writing ${describeValue(value)} to ${field} is invalid: ${problem}. The write is ignored.`);
    return false;
  }

  /**
   * Why a camera is invalid (`spec/scenes.md` section 3), or undefined. Each field's own range is always
   * checked; relations between fields (position versus target, near versus far) only outside
   * initialisation or when `only` is undefined (the check after `init`).
   */
  private cameraProblem(camera: CameraRecord, only?: CameraField): string | undefined {
    const relations = only === undefined || !this.initialising;
    const projection = camera.projection;
    const check = (field: CameraField): boolean => only === undefined || only === field;
    if (check("position") && !isFiniteVec3(camera.position)) return "the position is not finite";
    if (check("target") && camera.target !== null && !isFiniteVec3(camera.target)) return "the target is not finite";
    if (relations && (check("position") || check("target")) && camera.target !== null && sameVec3(camera.position, camera.target)) {
      return "the position equals the target, so the view direction is undefined";
    }
    if (projection.kind === "perspective" && check("projection.fov_y") && !(projection.fov_y > 0 && projection.fov_y < Math.PI)) {
      return "fov_y is outside the open range (0, π)";
    }
    if (projection.kind === "orthographic" && check("projection.height") && !(projection.height > 0 && Number.isFinite(projection.height))) {
      return "the orthographic height is not greater than 0";
    }
    if (check("projection.near") && !(projection.near > 0 && Number.isFinite(projection.near))) return "near is not greater than 0";
    if (check("projection.far") && !Number.isFinite(projection.far)) return "far is not finite";
    if (relations && (check("projection.near") || check("projection.far")) && !(projection.far > projection.near)) {
      return "far is not greater than near";
    }
    return undefined;
  }

  private reportCamera(message: string): void {
    const symbol = this.structure.camera.symbol;
    const span = spanOfSymbol(this.manifest, symbol);
    this.report(
      makeRuntimeDiagnostic("E8011", {
        phase: this.phase,
        message: `Invalid value for camera '${this.structure.camera.name}': ${message}`,
        source: span === undefined ? null : resolveSpan(this.manifest, span),
      }),
    );
  }

  private warn(code: unknown, spanId: unknown): void {
    if (typeof code !== "string" || !isWarningCode(code)) {
      throw new RuntimeInternalError(`ctx.warn got the code ${describeValue(code)}, which is not a runtime warning code.`);
    }
    if (typeof spanId !== "number" || !Number.isInteger(spanId)) {
      throw new RuntimeInternalError(`ctx.warn got the span id ${describeValue(spanId)}; expected an index into the manifest spans table.`);
    }
    const title = RUNTIME_DIAGNOSTIC_CATALOGUE[code];
    this.report(
      makeRuntimeDiagnostic(code, {
        phase: this.phase,
        message: `${title.charAt(0).toUpperCase()}${title.slice(1)}.`,
        source: resolveSpan(this.manifest, spanId),
      }),
    );
  }
}
