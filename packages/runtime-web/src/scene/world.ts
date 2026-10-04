/**
 * The CPU world of a mounted scene (`spec/runtime-abi.md` sections 4.2, 4.3 and 5.2; `spec/scenes.md`
 * sections 3, 11 and 12): entity records, the active camera record, the generated-code context (`ctx`)
 * and world-matrix propagation.
 *
 * The manifest carries structure only. The world creates every record with the registry defaults
 * (`spec/stdlib.md` section 3), then `scenes.<Entry>.init(ctx)` sets every camera field, transform,
 * visibility and material param through the setters of the context.
 *
 * The context implements the M1 subset of ABI 1 (decision 0031): `e`, `cam`, `frame`, `setTransform`,
 * `setVisible`, `setParam`, `setCamera` and `warn`. Any other member throws a `RuntimeInternalError`
 * naming it: M1 programs never use one (the compiler gates them by milestone), so reaching one is a bug.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import {
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  type MtekDiagnostic,
  type MtekRuntimePhase,
  type RuntimeDiagnosticCode,
} from "../diagnostics/types.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { fromRotationTranslationScale, multiply, type Mat4 } from "../math/mat4.js";
import type { SceneStructure } from "./structure.js";
import {
  describeValue,
  isColor,
  isFiniteQuat,
  isFiniteVec3,
  isQuat,
  isVec3,
  type Quat,
  type Vec3,
} from "./values.js";

/** A runtime bug or a program that breaks the ABI in a way the compiler rules out. Never a user error. */
export class RuntimeInternalError extends Error {
  constructor(message: string) {
    super(`internal error: ${message}`);
    this.name = "RuntimeInternalError";
  }
}

/** The members of `ctx` this runtime build provides (decision 0031). */
export const M1_CONTEXT_MEMBERS = ["e", "cam", "frame", "setTransform", "setVisible", "setParam", "setCamera", "warn"] as const;

/** `entity_ref` (`spec/runtime-abi.md` section 4.1). Static entities: slot = static index, generation 0. */
export interface EntityRef {
  readonly slot: number;
  readonly gen: number;
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
  /** Entity state; empty until M3. */
  readonly state: Record<string, unknown>;
  /** Prefab params; static entities have none. */
  readonly params: Readonly<Record<string, unknown>>;
  /** The material instance: `p` holds the current param values. `null` without a material. */
  readonly mat: { readonly p: Record<string, unknown> } | null;
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

export interface WorldOptions {
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly params: ParamSink;
  /** Receives run-time diagnostics (`E8011`, `E8090`, `E8100`, warnings from `ctx.warn`). */
  readonly report: (diagnostic: MtekDiagnostic) => void;
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

/** The zero value of a param type, the mirror's content before `init` writes it. */
function zeroValue(type: string): unknown {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
      return 0;
    case "bool":
      return false;
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

function sameVec3(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function isWarningCode(code: string): code is RuntimeDiagnosticCode {
  return code.startsWith("W") && Object.hasOwn(RUNTIME_DIAGNOSTIC_CATALOGUE, code);
}

/** Wraps `members` so that reading or assigning any other member throws an internal error naming it. */
function guarded<T extends object>(members: T, name: string): T {
  return new Proxy(members, {
    get(target, property, receiver) {
      if (typeof property === "symbol" || Object.hasOwn(target, property)) return Reflect.get(target, property, receiver) as unknown;
      throw new RuntimeInternalError(
        `generated code read ${name}.${property}, which this runtime build does not provide (the M1 context has ${M1_CONTEXT_MEMBERS.join(", ")}).`,
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
  /** Entity records by static index. */
  readonly entities: readonly EntityRecord[];
  readonly camera: CameraRecord;
  /** Phase recorded in diagnostics. `runtime:mount` during initialisation. */
  phase: MtekRuntimePhase = "runtime:mount";

  private readonly manifest: MtekManifest;
  private readonly structure: SceneStructure;
  private readonly params: ParamSink;
  private readonly report: (diagnostic: MtekDiagnostic) => void;
  private readonly indexByRecord = new Map<object, number>();
  private readonly worlds: Mat4[];
  private readonly transformDirty: Uint8Array;
  private readonly worldChanged: Uint8Array;
  private frameValues: FrameValues = Object.freeze({ time: 0, delta: 0, index: 0 });
  private initialising = false;
  private visibility = 0;

  constructor(options: WorldOptions) {
    this.manifest = options.manifest;
    this.structure = options.structure;
    this.params = options.params;
    this.report = options.report;

    const materialParams = new Map(this.structure.materials.map((material) => [material.id, material.params]));
    this.entities = Object.freeze(
      this.structure.entities.map((entity): EntityRecord => {
        const params = entity.instance === null ? undefined : materialParams.get(entity.instance.material.id);
        const record: EntityRecord = {
          position: ORIGIN,
          rotation: IDENTITY,
          scale: UNIT_SCALE,
          visible: true,
          state: {},
          params: Object.freeze({}),
          mat: params === undefined ? null : { p: Object.fromEntries(params.map((param) => [param.name, zeroValue(param.type)])) },
          ref: Object.freeze({ slot: entity.index, gen: 0 }),
        };
        this.indexByRecord.set(record, entity.index);
        return record;
      }),
    );
    const count = this.entities.length;
    this.worlds = Array.from({ length: count }, () => new Float32Array(16));
    this.transformDirty = new Uint8Array(count).fill(1);
    this.worldChanged = new Uint8Array(count);

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

    const members = {
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
      warn: (code: unknown, spanId: unknown): void => {
        this.warn(code, spanId);
      },
    };
    Object.defineProperty(members, "frame", { enumerable: true, get: () => this.frameValues });
    this.ctx = guarded(members, "ctx");
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
  initialise(init: (ctx: object) => void): void {
    this.initialising = true;
    try {
      init(this.ctx);
    } finally {
      this.initialising = false;
    }
    const problem = this.cameraProblem(this.camera);
    if (problem !== undefined) this.reportCamera(`after initialisation ${problem}.`);
    this.propagate();
  }

  /** Sets `ctx.frame` for the frame about to run. */
  setFrame(time: number, delta: number, index: number): void {
    this.frameValues = Object.freeze({ time: f32(time), delta: f32(delta), index: index >>> 0 });
  }

  /**
   * Propagates local transforms to world matrices, parents before children (`spec/scenes.md` section 12:
   * `L = T * R * S`, `W = W_parent * L`). Only entities whose transform or parent changed are recomputed.
   * Returns the number of world matrices recomputed.
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
    return count;
  }

  /** The world matrix of entity `index` as of the last `propagate()`. */
  worldMatrix(index: number): Mat4 {
    const matrix = this.worlds[index];
    if (matrix === undefined) throw new RangeError(`no entity ${String(index)}`);
    return matrix;
  }

  /** Returns, in instance order, the entities whose world matrix changed since the last call, and forgets them. */
  takeWorldChanges(): number[] {
    const changed: number[] = [];
    this.worldChanged.forEach((flag, index) => {
      if (flag === 1) changed.push(index);
    });
    this.worldChanged.fill(0);
    return changed;
  }

  // ---- the setters of the context ----

  private indexOf(entity: unknown, setter: string): number {
    const index = typeof entity === "object" && entity !== null ? this.indexByRecord.get(entity) : undefined;
    if (index === undefined) throw new RuntimeInternalError(`generated code passed ${describeValue(entity)} to ctx.${setter}, which is not an entity record.`);
    return index;
  }

  private entitySource(index: number): ReturnType<typeof resolveSpan> {
    const symbol = this.structure.entities[index]?.symbol;
    const span = symbol === undefined ? undefined : spanOfSymbol(this.manifest, symbol);
    return span === undefined ? null : resolveSpan(this.manifest, span);
  }

  private setTransform(entity: unknown, field: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setTransform");
    const record = this.entities[index];
    if (record === undefined) return;
    if (!TRANSFORM_FIELDS.includes(field as TransformField)) {
      throw new RuntimeInternalError(`ctx.setTransform got the field ${describeValue(field)}; expected position, rotation or scale.`);
    }
    const name = field as TransformField;
    if (name === "rotation") {
      if (!isQuat(value)) throw new RuntimeInternalError(`ctx.setTransform(…, "rotation", ${describeValue(value)}) expects a quat.`);
      record.rotation = value;
    } else {
      if (!isVec3(value)) throw new RuntimeInternalError(`ctx.setTransform(…, "${name}", ${describeValue(value)}) expects a vec3.`);
      if (name === "scale" && !(isFiniteVec3(value) && value.x > 0 && value.y > 0 && value.z > 0)) {
        this.report(
          makeRuntimeDiagnostic("E8090", {
            phase: this.phase,
            message: `The scale ${describeValue(value)} written to entity '${this.structure.entities[index]?.name ?? String(index)}' is invalid: every component must be finite and greater than 0. The write is ignored.`,
            source: this.entitySource(index),
          }),
        );
        return;
      }
      if (name === "position") record.position = value;
      else record.scale = value;
    }
    this.transformDirty[index] = 1;
  }

  private setVisible(entity: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setVisible");
    const record = this.entities[index];
    if (record === undefined) return;
    if (typeof value !== "boolean") throw new RuntimeInternalError(`ctx.setVisible got ${describeValue(value)}; expected a bool.`);
    if (record.visible !== value) {
      record.visible = value;
      this.visibility += 1;
    }
  }

  private setParam(entity: unknown, name: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setParam");
    const record = this.entities[index];
    const instance = this.structure.entities[index]?.instance;
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
            message: `The colour ${describeValue(value)} for param '${param.name}' of entity '${this.structure.entities[index]?.name ?? String(index)}' is not opaque: material colours must have alpha 1.0 in v0.1. The previous value stays.`,
            source: this.entitySource(index),
          }),
        );
        return;
      }
    }
    this.params.writeParam(instance.index, param.name, value);
    record.mat.p[param.name] = value;
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
