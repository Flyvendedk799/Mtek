import { AnimationPlayers, type SkeletonPlayer } from "./skeleton.js";
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
import { overlapSpheres, overlapBoxes } from "../math/overlap.js";
import { screenToWorld, worldToScreen } from "../math/screen.js";
import type { Vec2 } from "../math/types.js";
import {
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  type MtekDiagnostic,
  type MtekRuntimePhase,
} from "../diagnostics/types.js";
import { SILENT_AUDIO, type AudioService } from "../audio/audio.js";
import { NO_HUD, type HudService } from "../hud/hud.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { fromRotationTranslationScaleInto, multiplyInto, type Mat4 } from "../math/mat4.js";
import type { LoopBudget } from "./budget.js";
import { sampleChannelInto, type PlayableChannel } from "./clips.js";
import { DynamicEntities, type DynamicHost, type PrefabRuntime } from "./dynamic.js";
import { ParticleSim, type ParticleDraw } from "./particles.js";
import { RuntimeInternalError } from "./errors.js";
import { INERT_GAME, type GameHooks } from "./game.js";
import { MAX_TIMERS, TimerList, type TimerOwner } from "./timers.js";
import { makeRef, type EntityRef } from "./slots.js";
import { TagQueries } from "./tags.js";
import type { ResolvedEntity, ResolvedInstance, SceneStructure } from "./structure.js";
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

/** The members of `ctx` this runtime build provides (decisions 0031, 0050, 0064 and 0066). */
export const CONTEXT_MEMBERS = [
  "s",
  "e",
  "cam",
  "frame",
  "setTransform",
  "setVisible",
  "setParam",
  "setMaterial",
  "setCamera",
  "setCameraOn",
  "cameraOn",
  "selectCamera",
  "particleCount",
  "setLight",
  "spawn",
  "destroy",
  "alive",
  "countTagged",
  "firstTagged",
  "nearestTagged",
  "hasTag",
  "tagged",
  "destroyTagged",
  "body",
  "budget",
  "warn",
  "random",
  "randomRange",
  "randomInt",
  "chance",
  "isKeyDown",
  "keyPressed",
  "keyReleased",
  "pointerPosition",
  "isPointerDown",
  "choose",
  "shuffle",
  "refField",
  "send",
  "overlapSpheres",
  "overlapBoxes",
  "screenToWorld",
  "worldToScreen",
  "gamepadAxis",
  "animationPlay",
  "animationTransition",
  "animationCopyPose",
  "animationJointPosition",
  "animationJointRotation",
  "animationPause",
  "animationResume",
  "animationSeek",
  "animationFade",
  "animationTime",
  "animationDuration",
  "animationWeight",
  "animationPlaying",
  "animationFinished",
  "animationCrossed",
  "gamepadButton",
  "gamepadConnected",
  "print",
  "goTo",
  "reset",
  "pause",
  "resume",
  "paused",
  "after",
  "every",
  "save",
  "load",
  "clearSaved",
  "audio",
  "hud",
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
/** What a clip sampled for one entity: the identity for a channel the clip does not have. */
interface ClipPose {
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}

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
  readonly gamepads?: import("../input/gamepad.js").GamepadInput;
  /** Current render-target aspect ratio, also used by the renderer. Defaults to 1 in isolated worlds. */
  aspectRatio?(): number;
  /** `random()`: an f32 in `[0, 1)`. */
  random(): number;
  /** `is_key_down`: the delivered key state. `code` is a DOM `KeyboardEvent.code`. */
  isKeyDown(code: string): boolean;
  /** `key_pressed` / `key_released` (decision 0153): transitions delivered this frame. */
  keyPressed(code: string): boolean;
  keyReleased(code: string): boolean;
  /** `pointer_position`: canvas NDC. */
  pointerPosition(): { x: number; y: number };
  /** `is_pointer_down`: button 0, 1 or 2. */
  isPointerDown(button: number): boolean;
  /** `print`: development console output; `spanId` indexes the manifest spans table. */
  print(message: string, spanId: number): void;
  /** `go_to`, `reset`, `pause`, `resume`, `paused` (decisions 0140, 0141, 0143), `save`, `load`, `clear_saved` (0145); default: {@link INERT_GAME}. */
  readonly game?: GameHooks;
  /** `ctx.audio` (decision 0130); silent when absent. */
  readonly audio?: AudioService;
  /** `ctx.hud` (decision 0134); draws nothing when absent. */
  readonly hud?: HudService;
}

/**
 * The physics subsystem as `ctx.body` reaches it (`physics/system.ts` implements it): the body handle of an entity
 * record or `entity_ref`, with the commands and readable velocities of `spec/physics.md` section 3 (decision 0066).
 * `spanId` is the manifest span of the command or property in the program, for run-time diagnostics.
 */
export interface BodyService {
  handle(target: unknown, spanId: unknown): object;
}

/** Services for a world nothing drives: no keys held, a fixed sequence of zeros, no output. */
export const INERT_SERVICES: CpuServices = Object.freeze({
  random: () => 0,
  isKeyDown: () => false,
  keyPressed: () => false,
  keyReleased: () => false,
  pointerPosition: () => ({ x: 0, y: 0 }),
  isPointerDown: () => false,
  print: () => undefined,
});

export interface WorldOptions {
  readonly manifest: MtekManifest;
  readonly structure: SceneStructure;
  readonly params: ParamSink;
  /** Receives run-time diagnostics (`E8011`, `E8090`, warnings from `ctx.warn`). */
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
  // The members are fixed when the proxy is made; `ctx.frame` is read once per binding per frame, so the trap is kept short.
  const known = new Set<string | symbol>(Reflect.ownKeys(members));
  return new Proxy(members, {
    get(target, property, receiver) {
      if (typeof property === "symbol") return Reflect.get(target, property, receiver) as unknown;
      if (known.has(property)) return (target as Record<string, unknown>)[property];
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
  /** The active camera (decision 0154). `ctx.cam` reads this. */
  private activeCamera: CameraRecord = {
    position: CAMERA_POSITION,
    target: null,
    rotation: IDENTITY,
    projection: { kind: "perspective", fov_y: DEFAULT_FOV_Y, near: DEFAULT_NEAR, far: DEFAULT_FAR },
  };
  /** The scene state (`ctx.s`). */
  readonly sceneState: Record<string, unknown>;
  /** The spawned entities: queues, flush points, records (decision 0064). */
  readonly dynamic: DynamicEntities;
  /** Phase recorded in diagnostics. `runtime:mount` during initialisation. */
  phase: MtekRuntimePhase = "runtime:mount";
  /** The physics subsystem, once it is mounted (`ctx.body`); `undefined` for a program without bodies. */
  bodies: BodyService | undefined;

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
  /** Whether some entity's `transformDirty` flag is set: `propagate` does nothing otherwise (decision 0120). */
  private transformsPending = true;
  /** Slots whose world matrix was recomputed since `takeWorldChanges`; `worldChanged` is the membership flag, `changedList` the slots in order. */
  private worldChanged: Uint8Array;
  private changedList: number[] = [];
  private takenList: number[] = [];
  /** Scratch of `propagate`: the named entities recomputed in this pass. */
  private recomputed: Uint8Array;
  private readonly rotationScratch = new Float32Array(16);
  private readonly localScratch = new Float32Array(16);
  private frameValues: FrameValues = Object.freeze({ time: 0, delta: 0, index: 0 });
  private initialising = false;
  private visibility = 0;
  /** `ctx.budget` (decision 0075): the iterations of CPU loops left in this frame. Only a preview build checks it. */
  private readonly loopBudget: LoopBudget = { n: 0 };
  /** The scene's `after`/`every` timers (decision 0142). */
  readonly timers = new TimerList((spanId) => {
    this.reportTimerCap(spanId);
  });
  /** The call sites that already reported `W8205`. */
  private readonly cappedTimerSpans = new Set<number>();
  /** Living particles (decision 0155). */
  private readonly particles = new ParticleSim();
  /** Playing glTF clips (decision 0156). */
  private readonly clips = new AnimationPlayers();
  /** Per entity slot, the pose its clip last sampled; `undefined` for an entity without a clip. The local transform is the entity's own one times this (decision 0174). */
  private readonly clipPoses: (ClipPose | undefined)[] = [];
  private readonly clipBase = new Float32Array(16);
  private readonly clipLocal = new Float32Array(16);
  private readonly clipSample = new Float64Array(4);
  private readonly cameraByName = new Map<string, CameraRecord>();
  private readonly cameraMeta = new Map<CameraRecord, { name: string; symbol: string; exposure: number; hasTarget: boolean }>();
  /** `manifest.preview.loopBudget`: what {@link resetBudget} refills the counter with; `undefined` outside a preview. */
  private readonly loopBudgetLimit: number | undefined;
  private readonly materialParamTypes: ReadonlyMap<string, readonly { readonly name: string; readonly type: string }[]>;

  constructor(options: WorldOptions) {
    this.manifest = options.manifest;
    this.structure = options.structure;
    this.params = options.params;
    this.report = options.report;
    this.loopBudgetLimit = options.manifest.preview?.loopBudget;

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
    this.recomputed = new Uint8Array(count);
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

    for (const camera of this.manifest.scene.cameras) {
      const record: CameraRecord = {
        position: { x: CAMERA_POSITION.x, y: CAMERA_POSITION.y, z: CAMERA_POSITION.z },
        target: null,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        projection:
          camera.projection === "perspective"
            ? { kind: "perspective", fov_y: DEFAULT_FOV_Y, near: DEFAULT_NEAR, far: DEFAULT_FAR }
            : { kind: "orthographic", height: DEFAULT_HEIGHT, near: DEFAULT_NEAR, far: DEFAULT_FAR },
      };
      this.cameraByName.set(camera.name, record);
      this.cameraMeta.set(record, {
        name: camera.name,
        symbol: camera.symbol,
        exposure: camera.exposure,
        hasTarget: camera.hasTarget,
      });
      if (camera.active) this.activeCamera = record;
    }
    if (!this.cameraByName.has(this.structure.camera.name)) {
      this.cameraByName.set(this.structure.camera.name, this.activeCamera);
      this.cameraMeta.set(this.activeCamera, {
        name: this.structure.camera.name,
        symbol: this.structure.camera.symbol,
        exposure: this.structure.camera.exposure,
        hasTarget: this.structure.camera.hasTarget,
      });
    }

    this.sceneState = stateObject(this.manifest.scene.state);
    const services = options.services ?? INERT_SERVICES;
    for (const entity of this.structure.entities) this.trackMotion(entity.index, entity);
    const game = services.game ?? INERT_GAME;
    const timerOwner = (owner: unknown): TimerOwner => {
      if (owner === null || owner === undefined) return null;
      if (typeof owner === "object" && "ref" in owner) return owner;
      throw new RuntimeInternalError(`a timer got the owner ${describeValue(owner)}; expected an entity record or null.`);
    };
    const staticTags = this.structure.entities.map((entity) => this.manifest.scene.entities[entity.index]?.tag);
    const tags = new TagQueries({
      staticTags,
      staticRef: (index) => (this.entities[index] as EntityRecord).ref,
      spawned: () => this.dynamic.live,
      spawnedAt: (slot) => this.dynamic.entityAt(slot),
      worldPosition: (slot) => {
        this.propagate();
        const world = this.worldMatrix(slot);
        return { x: world[12] as number, y: world[13] as number, z: world[14] as number };
      },
      alive: (ref) => this.dynamic.alive(ref),
      destroy: (ref) => {
        this.dynamic.destroy(ref, -1);
      },
    });
    const members = {
      s: this.sceneState,
      e: this.entities,
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
      setCameraOn: (name: unknown, field: unknown, value: unknown): void => {
        this.setCameraOn(name, field, value);
      },
      cameraOn: (name: unknown): CameraRecord => this.cameraNamed("ctx.cameraOn", name),
      selectCamera: (name: unknown): void => {
        this.selectCamera(name);
      },
      particleCount: (): number => this.particles.count(),
      setLight: (entity: unknown, field: unknown, value: unknown): void => {
        this.setLight(entity, field, value);
      },
      spawn: (prefab: unknown, params: unknown, spanId: unknown): EntityRef => this.dynamic.spawn(prefab, params, spanId),
      destroy: (ref: unknown, spanId: unknown): void => {
        this.dynamic.destroy(ref, spanId);
      },
      alive: (ref: unknown): boolean => this.dynamic.alive(ref),
      // Decision 0150: the tag queries.
      countTagged: (tag: unknown): number => tags.countTagged(tag),
      firstTagged: (tag: unknown): EntityRef => tags.firstTagged(tag),
      nearestTagged: (tag: unknown, point: unknown): EntityRef => tags.nearestTagged(tag, point),
      hasTag: (ref: unknown, tag: unknown): boolean => tags.hasTag(ref, tag),
      tagged: (tag: unknown): Iterable<EntityRef> => tags.tagged(tag),
      destroyTagged: (tag: unknown): void => {
        tags.destroyTagged(tag);
      },
      body: (target: unknown, spanId: unknown): object => {
        if (this.bodies === undefined) {
          throw new RuntimeInternalError("generated code called ctx.body, but the physics subsystem is not mounted (the manifest says subsystems.physics is false, or the scene is still initialising).");
        }
        return this.bodies.handle(target, spanId);
      },
      budget: this.loopBudget,
      warn: (code: unknown, spanId: unknown): void => {
        this.warn(code, spanId);
      },
      random: (): number => services.random(),
      // Decision 0149: one draw of `random()` each.
      randomRange: (lo: unknown, hi: unknown): number => randomRange(services.random(), num(lo, "randomRange"), num(hi, "randomRange")),
      randomInt: (lo: unknown, hi: unknown): number => randomInt(services.random(), num(lo, "randomInt"), num(hi, "randomInt")),
      chance: (p: unknown): boolean => services.random() < num(p, "chance"),
      choose: (items: unknown): unknown => chooseItem(services.random(), items),
      shuffle: (items: unknown): unknown => shuffled(items, () => services.random()),
      setMaterial: (entity: unknown, value: unknown): void => this.setMaterial(entity, value),
      animationJointPosition: (ref: unknown, name: string): Vec3 => this.dynamic.alive(ref) ? this.clips.skin((ref as EntityRef).slot)?.jointPosition(name) ?? ORIGIN : ORIGIN,
      animationJointRotation: (ref: unknown, name: string): Quat => this.dynamic.alive(ref) ? this.clips.skin((ref as EntityRef).slot)?.jointRotation(name) ?? IDENTITY : IDENTITY,
      animationCopyPose: (target: unknown, source: unknown): boolean =>
        this.dynamic.alive(target) && this.dynamic.alive(source)
          && this.clips.copyPose((target as EntityRef).slot,(source as EntityRef).slot),
      animationTransition: (ref: unknown, name: string, seconds: number, looping: boolean, speed: number): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        return this.clips.transition((ref as EntityRef).slot, name, seconds, looping, speed);
      },
      refField: (ref: unknown, field: unknown): unknown => this.refField(ref, field),
      animationPlay: (ref: unknown, looping: boolean, speed: number): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        const slot = (ref as EntityRef).slot;
        const result = this.clips.play(slot, looping, speed);
        if (result) this.clips.poseSlot(slot, (s, c, v) => this.writeChannel(s, c, v));
        return result;
      },
      animationPause: (ref: unknown): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        const slot = (ref as EntityRef).slot;
        const result = this.clips.pause(slot);
        if (result) this.clips.poseSlot(slot, (s, c, v) => this.writeChannel(s, c, v));
        return result;
      },
      animationResume: (ref: unknown): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        const slot = (ref as EntityRef).slot;
        const result = this.clips.resume(slot);
        if (result) this.clips.poseSlot(slot, (s, c, v) => this.writeChannel(s, c, v));
        return result;
      },
      animationSeek: (ref: unknown, time: number): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        const slot = (ref as EntityRef).slot;
        const result = this.clips.seek(slot, time);
        if (result) this.clips.poseSlot(slot, (s, c, v) => this.writeChannel(s, c, v));
        return result;
      },
      animationFade: (ref: unknown, weight: number, duration: number): boolean => {
        if (!this.dynamic.alive(ref)) return false;
        const slot = (ref as EntityRef).slot;
        const result = this.clips.fade(slot, weight, duration);
        if (result) this.clips.poseSlot(slot, (s, c, v) => this.writeChannel(s, c, v));
        return result;
      },
      animationTime: (ref: unknown): number => this.dynamic.alive(ref) ? Math.fround(this.clips.time((ref as EntityRef).slot)) : 0,
      animationDuration: (ref: unknown): number => this.dynamic.alive(ref) ? Math.fround(this.clips.duration((ref as EntityRef).slot)) : 0,
      animationWeight: (ref: unknown): number => this.dynamic.alive(ref) ? Math.fround(this.clips.weight((ref as EntityRef).slot)) : 0,
      animationPlaying: (ref: unknown): boolean => this.dynamic.alive(ref) ? this.clips.playing((ref as EntityRef).slot) : false,
      animationFinished: (ref: unknown): boolean => this.dynamic.alive(ref) ? this.clips.finished((ref as EntityRef).slot) : false,
      animationCrossed: (ref: unknown, marker: number): boolean => this.dynamic.alive(ref) ? this.clips.crossed((ref as EntityRef).slot, marker) : false,
      overlapSpheres,
      overlapBoxes,
      gamepadAxis: (pad: number, axis: number): number => services.gamepads?.axis(pad, axis) ?? 0,
      gamepadButton: (pad: number, button: number): number => services.gamepads?.button(pad, button) ?? 0,
      gamepadConnected: (pad: number): boolean => services.gamepads?.connected(pad) ?? false,
      screenToWorld: (point: Vec2, z: number): Vec3 => screenToWorld(this.camera, services.aspectRatio?.() ?? 1, point, z),
      worldToScreen: (point: Vec3): Vec2 => worldToScreen(this.camera, services.aspectRatio?.() ?? 1, point),
      send: (ref: unknown, message: unknown): void => {
        if (typeof message !== "string") throw new RuntimeInternalError("ctx.send expected a string message.");
        if (this.dynamic.alive(ref)) this.messages.push({ target: ref as EntityRef, value: message });
      },
      isKeyDown: (code: unknown): boolean => {
        if (typeof code !== "string") throw new RuntimeInternalError(`ctx.isKeyDown got ${describeValue(code)}; expected a DOM key code.`);
        return services.isKeyDown(code);
      },
      keyPressed: (code: unknown): boolean => {
        if (typeof code !== "string") throw new RuntimeInternalError(`ctx.keyPressed got ${describeValue(code)}; expected a DOM key code.`);
        return services.keyPressed(code);
      },
      keyReleased: (code: unknown): boolean => {
        if (typeof code !== "string") throw new RuntimeInternalError(`ctx.keyReleased got ${describeValue(code)}; expected a DOM key code.`);
        return services.keyReleased(code);
      },
      pointerPosition: (): { x: number; y: number } => services.pointerPosition(),
      isPointerDown: (button: unknown): boolean => services.isPointerDown(num(button, "isPointerDown")),
      print: (message: unknown, spanId: unknown): void => {
        services.print(typeof message === "string" ? message : describeValue(message), typeof spanId === "number" ? spanId : -1);
      },
      goTo: (scene: unknown, spanId: unknown): void => {
        if (typeof scene !== "string") throw new RuntimeInternalError(`ctx.goTo got ${describeValue(scene)}; expected a scene name.`);
        game.goTo(scene, typeof spanId === "number" ? spanId : -1);
      },
      reset: (): void => {
        game.reset();
      },
      pause: (): void => {
        game.pause();
      },
      resume: (): void => {
        game.resume();
      },
      paused: (): boolean => game.paused(),
      save: (): void => {
        game.save();
      },
      load: (): boolean => game.load(),
      clearSaved: (): void => {
        game.clearSaved();
      },
      after: (seconds: unknown, fn: unknown, owner: unknown, spanId: unknown): void => {
        this.timers.after(seconds, fn, timerOwner(owner), spanId);
      },
      every: (seconds: unknown, fn: unknown, owner: unknown, spanId: unknown): void => {
        this.timers.every(seconds, fn, timerOwner(owner), spanId);
      },
      audio: services.audio ?? SILENT_AUDIO,
      hud: services.hud ?? NO_HUD,
    };
    Object.defineProperty(members, "cam", { enumerable: true, get: () => this.camera });
    Object.defineProperty(members, "frame", { enumerable: true, get: () => this.frameValues });
    this.ctx = guarded(members, "ctx");
    holder.ctx = this.ctx;
  }

  /**
   * Refills `ctx.budget` for a new frame (and for `init`): `manifest.preview.loopBudget` iterations. Without a
   * `preview` object in the manifest the counter stays at 0, so an instrumented `app.js` mounted against a
   * manifest that does not say so fails at its first loop instead of running without a bound (decision 0075).
   */
  resetBudget(): void {
    if (this.loopBudgetLimit !== undefined) this.loopBudget.n = this.loopBudgetLimit;
  }

  /**
   * Runs the timers that fall due after `delta` seconds more of game time (`after`/`every`, decision 0142). The
   * application calls it at the start of phase 3 of every frame in which the game is not paused. The timers of a
   * destroyed (or pending-removal) spawned entity are dropped.
   */
  advanceTimers(delta: number): void {
    this.timers.advance(delta, (owner) => this.dynamic.alive(owner.ref));
  }

  /** Samples every playing clip forward by `delta` seconds (decision 0156). Pause skips phase 3, so clips pause too. */
  advanceClips(delta: number): void {
    this.clips.advance(delta, (slot, channel, value) => {
      this.writeChannel(slot, channel, value);
    });
  }

  /** Spawns and integrates particles (decision 0155). */
  advanceParticles(delta: number): void {
    this.propagate();
    this.particles.advance(delta, (slot) => {
      const matrix = this.worlds[slot];
      if (matrix === undefined) return { x: 0, y: 0, z: 0 };
      return { x: matrix[12] ?? 0, y: matrix[13] ?? 0, z: matrix[14] ?? 0 };
    });
  }

  /** `ctx.frame` as generated code sees it. */
  get frame(): FrameValues {
    return this.frameValues;
  }

  /** The active camera. */
  get camera(): CameraRecord {
    return this.activeCamera;
  }

  /** Name, symbol, exposure and whether the active camera has a target (decision 0154). */
  cameraInfo(): { name: string; symbol: string; exposure: number; hasTarget: boolean } {
    return (
      this.cameraMeta.get(this.activeCamera) ?? {
        name: this.structure.camera.name,
        symbol: this.structure.camera.symbol,
        exposure: this.structure.camera.exposure,
        hasTarget: this.structure.camera.hasTarget,
      }
    );
  }

  /** Living particles, grouped by the mesh they draw with (decision 0155). */
  particleDraws(): readonly ParticleDraw[] {
    return this.particles.draws();
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
    this.resetBudget();
    this.initialising = true;
    try {
      init(this.ctx);
      // Bindings are evaluated once after `init`, so bound fields have values before the first frame.
      afterInit?.();
      // Preserve controls issued by init; otherwise this is the default t = 0 pose.
      this.poseClips();
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
    for (let slot = 0; slot < this.worldChanged.length; slot++) this.markChanged(slot);
  }

  /**
   * Forgets what the change tracking knows: every transform is marked dirty, so the next `propagate` recomputes every
   * world matrix and lists it as changed. For the tests that compare a tracked frame with a full recompute; nothing
   * in the runtime needs it, because every state it holds is rebuilt with the world.
   */
  markAllTransformsDirty(): void {
    this.transformDirty.fill(1);
    this.transformsPending = true;
  }

  /** Records that the world matrix of `slot` was recomputed (once per `takeWorldChanges` period). */
  private markChanged(slot: number): void {
    if (this.worldChanged[slot] === 1) return;
    this.worldChanged[slot] = 1;
    this.changedList.push(slot);
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
    // Nothing was written since the last pass: no flag is set, so there is nothing to recompute and no descendant to follow.
    if (!this.transformsPending) return 0;
    const recomputed = this.recomputed;
    recomputed.fill(0);
    let count = 0;
    for (const entity of this.structure.entities) {
      const i = entity.index;
      const parent = entity.parent;
      if (this.transformDirty[i] !== 1 && (parent === null || recomputed[parent] !== 1)) continue;
      const record = this.entities[i];
      if (record === undefined) continue;
      // The world matrix is rewritten in place: nothing keeps a reference past the frame (the renderer copies it).
      const world = this.worlds[i] as Mat4;
      const parentWorld = parent === null ? undefined : this.worlds[parent];
      if (parentWorld === undefined) {
        this.localMatrixInto(world, i, record);
      } else {
        this.localMatrixInto(this.localScratch, i, record);
        multiplyInto(world, parentWorld, this.localScratch);
      }
      this.transformDirty[i] = 0;
      this.markChanged(i);
      recomputed[i] = 1;
      count += 1;
    }
    for (const entity of this.dynamic.live) {
      const i = entity.ref.slot;
      if (this.transformDirty[i] !== 1) continue;
      const record = entity.record;
      this.localMatrixInto(this.worlds[i] as Mat4, i, record);
      this.transformDirty[i] = 0;
      this.markChanged(i);
      count += 1;
    }
    this.transformsPending = false;
    return count;
  }

  /**
   * The local matrix of the entity in slot `index` into `out`: `T * R * S` of its own transform, times the same of the
   * pose its clip sampled when it has one (`base * clip`, decision 0174).
   */
  private localMatrixInto(out: Mat4, index: number, record: EntityRecord): void {
    const pose = this.clipPoses[index];
    if (pose === undefined) {
      fromRotationTranslationScaleInto(out, this.rotationScratch, record.rotation, record.position, record.scale);
      return;
    }
    fromRotationTranslationScaleInto(this.clipBase, this.rotationScratch, record.rotation, record.position, record.scale);
    fromRotationTranslationScaleInto(this.clipLocal, this.rotationScratch, pose.rotation, pose.translation, pose.scale);
    multiplyInto(out, this.clipBase, this.clipLocal);
  }

  /** The world matrix of the entity in slot `index` as of the last `propagate()`. */
  worldMatrix(index: number): Mat4 {
    const matrix = this.worlds[index];
    if (matrix === undefined) throw new RangeError(`no entity ${String(index)}`);
    return matrix;
  }

  /**
   * Returns the slots whose world matrix was recomputed since the last call, in the order `propagate` recomputed them
   * (each once), and forgets them. The array is reused: it is valid until the next call.
   */
  takeWorldChanges(): readonly number[] {
    const list = this.changedList;
    const flags = this.worldChanged;
    let kept = 0;
    // Entries of slots that were unregistered since (flag cleared) or listed twice are dropped here.
    for (let k = 0; k < list.length; k++) {
      const slot = list[k] as number;
      if (flags[slot] === 1) {
        flags[slot] = 0;
        list[kept] = slot;
        kept += 1;
      }
    }
    list.length = kept;
    this.changedList = this.takenList;
    this.changedList.length = 0;
    this.takenList = list;
    return list;
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
    this.transformsPending = true;
    this.worldChanged[slot] = 0;
    this.trackMotion(slot, resolved, true);
  }

  private unregisterDynamic(slot: number, record: EntityRecord): void {
    this.indexByRecord.delete(record);
    this.records[slot] = undefined;
    this.resolvedBySlot[slot] = undefined;
    this.worlds[slot] = undefined;
    this.transformDirty[slot] = 0;
    this.worldChanged[slot] = 0;
    this.particles.remove(slot);
    this.clips.remove(slot);
    this.clipPoses[slot] = undefined;
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
    this.applyTransform(index, record, field as TransformField, value);
  }

  /**
   * A function that does what `ctx.setTransform(entity, field, value)` does for `value`, with the entity and the field
   * resolved once (the bindings call it every frame). An argument `setTransform` would reject gets a function that
   * calls `setTransform`, so the error is the same and happens at the same time.
   */
  transformSetter(entity: unknown, field: string): (value: unknown) => void {
    const index = typeof entity === "object" && entity !== null ? this.indexByRecord.get(entity) : undefined;
    if (index === undefined || !TRANSFORM_FIELDS.includes(field as TransformField)) {
      return (value) => {
        this.setTransform(entity, field, value);
      };
    }
    const name = field as TransformField;
    return (value) => {
      const record = this.records[index];
      if (record !== undefined) this.applyTransform(index, record, name, value);
    };
  }

  private applyTransform(index: number, record: EntityRecord, name: TransformField, value: unknown): void {
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
    this.transformsPending = true;
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
   * path as `ctx.setParam`, so the generated field writer, and the mirror apply (any colour alpha is
   * accepted, decision 0138). Mistakes of the caller throw plain errors naming what exists; they are not diagnostics.
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

  private setMaterial(entity: unknown, value: unknown): void {
    const index = this.indexOf(entity, "setMaterial");
    const material = this.resolvedBySlot[index]?.instance?.material;
    if (material === undefined || material.resources.length > 0 || typeof value !== "object" || value === null) {
      throw new RuntimeInternalError("ctx.setMaterial requires a value-only material instance.");
    }
    const values = value as Record<string, unknown>;
    for (const param of material.params) {
      if (paramValueProblem(param.type, values[param.name]) !== undefined) throw new RuntimeInternalError(`ctx.setMaterial has an invalid '${param.name}'.`);
    }
    for (const param of material.params) this.setParam(entity, param.name, values[param.name]);
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
    this.applyParam(index, record.mat, instance, param, value);
  }

  /**
   * A function that does what `ctx.setParam(entity, name, value)` does for `value`, with the entity, its material
   * instance and the param resolved once (the bindings call it every frame). An argument `setParam` would reject gets
   * a function that calls `setParam`, so the error is the same and happens at the same time.
   */
  paramSetter(entity: unknown, name: string): (value: unknown) => void {
    const index = typeof entity === "object" && entity !== null ? this.indexByRecord.get(entity) : undefined;
    const instance = index === undefined ? undefined : this.resolvedBySlot[index]?.instance;
    const param = instance?.material.params.find((candidate) => candidate.name === name);
    if (index === undefined || instance === null || instance === undefined || param === undefined) {
      return (value) => {
        this.setParam(entity, name, value);
      };
    }
    return (value) => {
      const record = this.records[index];
      if (record === undefined || record.mat === null) {
        this.setParam(entity, name, value);
        return;
      }
      this.applyParam(index, record.mat, instance, param, value);
    };
  }

  private applyParam(
    index: number,
    mat: { readonly p: Record<string, unknown> },
    instance: ResolvedInstance,
    param: { readonly name: string; readonly type: string },
    value: unknown,
  ): void {
    if (param.type === "color") {
      if (!isColor(value)) throw new RuntimeInternalError(`ctx.setParam(…, "${param.name}", ${describeValue(value)}) expects a color.`);
      // Any alpha is accepted: below 1 the draw is translucent (decision 0138).
    }
    this.params.writeParam(instance.index, param.name, value);
    mat.p[param.name] = value;
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
        if (name === "target" && !this.cameraInfo().hasTarget) {
          throw new RuntimeInternalError(`ctx.setCamera("target", …) was called for camera '${this.cameraInfo().name}', which declares no target.`);
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

  /** `W8205`: a timer was not started because the scene already has {@link MAX_TIMERS} (decision 0177). */
  private reportTimerCap(spanId: number): void {
    if (this.cappedTimerSpans.has(spanId)) return;
    this.cappedTimerSpans.add(spanId);
    this.report(
      makeRuntimeDiagnostic("W8205", {
        phase: this.phase,
        message: `The scene already has ${String(MAX_TIMERS)} timers waiting, so this timer was not started. A timer started in update or fixed_update starts again every time it runs: start it once, behind a state flag or in a handler.`,
        source: spanId >= 0 ? resolveSpan(this.manifest, spanId) : null,
        expected: `at most ${String(MAX_TIMERS)} timers at a time`,
      }),
    );
  }

  private reportCamera(message: string): void {
    const info = this.cameraInfo();
    const span = spanOfSymbol(this.manifest, info.symbol);
    this.report(
      makeRuntimeDiagnostic("E8011", {
        phase: this.phase,
        message: `Invalid value for camera '${info.name}': ${message}`,
        source: span === undefined ? null : resolveSpan(this.manifest, span),
      }),
    );
  }

  /** The record of the camera `name`; an unknown name is a defect of the emitted code (decision 0154). */
  private cameraNamed(call: string, name: unknown): CameraRecord {
    if (typeof name !== "string") {
      throw new RuntimeInternalError(`${call} got ${describeValue(name)}; expected a camera name.`);
    }
    const record = this.cameraByName.get(name);
    if (record === undefined) {
      throw new RuntimeInternalError(`${call}(${JSON.stringify(name)}) names a camera this scene does not have.`);
    }
    return record;
  }

  /** `ctx.selectCamera(name)` (decision 0154). */
  selectCamera(name: unknown): void {
    this.activeCamera = this.cameraNamed("ctx.selectCamera", name);
  }

  /** Writes `field` of the named camera without changing which camera is active (decision 0177). */
  setCameraOn(name: unknown, field: unknown, value: unknown): void {
    const record = this.cameraNamed("ctx.setCameraOn", name);
    const previous = this.activeCamera;
    this.activeCamera = record;
    try {
      this.setCamera(field, value);
    } finally {
      this.activeCamera = previous;
    }
  }

  private poseClips(time?: number): void {
    this.clips.pose((slot, channel, value) => {
      this.writeChannel(slot, channel, value);
    }, time);
  }

  /** Stores one sampled channel in the clip pose of `slot`; the entity's own transform is left alone (decision 0174). */
  private writeChannel(slot: number, channel: PlayableChannel, value: ArrayLike<number>): void {
    const pose = this.clipPoses[slot];
    if (pose === undefined) return;
    const x = value[0] ?? 0;
    const y = value[1] ?? 0;
    const z = value[2] ?? 0;
    if (channel.path === "rotation") {
      const w = value[3] ?? 1;
      if (sameQuat(pose.rotation, { x, y, z, w })) return;
      pose.rotation = { x, y, z, w };
    } else if (channel.path === "translation") {
      if (sameVec3(pose.translation, { x, y, z })) return;
      pose.translation = { x, y, z };
    } else {
      if (sameVec3(pose.scale, { x, y, z })) return;
      pose.scale = { x, y, z };
    }
    this.transformDirty[slot] = 1;
    this.transformsPending = true;
  }

  skinPlayer(slot: number): SkeletonPlayer | undefined { return this.clips.skin(slot); }

  private trackMotion(slot: number, resolved: ResolvedEntity, spawned = false): void {
    if (resolved.particles !== undefined) {
      this.particles.add({
        slot,
        rate: resolved.particles.rate,
        lifetime: resolved.particles.lifetime,
        speed: resolved.particles.speed,
        size: resolved.particles.size,
        gravity: resolved.particles.gravity,
        meshId: resolved.mesh?.id ?? null,
        materialId: resolved.instance?.material.id ?? null,
        instanceIndex: resolved.instance?.index ?? null,
      });
    }
    const descriptor = resolved.mesh?.descriptor;
    if (descriptor?.kind === "asset" && descriptor.skin !== undefined) {
      this.clips.addSkin(slot, descriptor.skin, resolved.clip?.name);
      return;
    }
    if (resolved.clip !== undefined) {
      this.clipPoses[slot] = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } };
      this.clips.add({ slot, duration: resolved.clip.duration, channels: resolved.clip.channels });
      // A named entity is posed at time 0 once `init` has run; a spawned one is posed now, not a frame later.
      if (spawned) {
        for (const channel of resolved.clip.channels) {
          sampleChannelInto(channel, 0, this.clipSample);
          this.writeChannel(slot, channel, this.clipSample);
        }
      }
    }
  }

  /**
   * `r.position` and the other transform reads through an `entity_ref` (decision 0151).
   * A reference that is not alive reads as zero: position and scale `(0, 0, 0)`, rotation identity,
   * `visible` false. The live fields are the same objects the named-entity reads return.
   */
  readonly messages: { target: EntityRef; value: string }[] = [];

  refField(ref: unknown, field: unknown): unknown {
    const name = typeof field === "string" ? field : "";
    const zero = (): unknown => {
      if (name === "visible") return false;
      if (name === "rotation") return { x: 0, y: 0, z: 0, w: 1 };
      return { x: 0, y: 0, z: 0 };
    };
    if (typeof ref !== "object" || ref === null || !("slot" in ref) || !("gen" in ref)) {
      throw new RuntimeInternalError(`ctx.refField got ${describeValue(ref)}; expected an entity_ref.`);
    }
    if (name !== "position" && name !== "rotation" && name !== "scale" && name !== "visible") {
      throw new RuntimeInternalError(`ctx.refField got the field ${describeValue(field)}; expected position, rotation, scale or visible.`);
    }
    const target = ref as EntityRef;
    if (!this.dynamic.alive(target)) return zero();
    const record = this.records[target.slot];
    if (record === undefined) return zero();
    switch (name) {
      case "position":
        return record.position;
      case "rotation":
        return record.rotation;
      case "scale":
        return record.scale;
      case "visible":
        return record.visible;
      default:
        return zero();
    }
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

/**
 * `choose(items)` (decision 0152): one draw `r` in `[0, 1)` picks `floor(r * length)`.
 * An empty array is a bug of generated code: arrays are at least one element long.
 */
export function chooseItem(r: number, items: unknown): unknown {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RuntimeInternalError(`ctx.choose got ${describeValue(items)}; expected a non-empty array.`);
  }
  let index = Math.floor(r * items.length);
  if (index >= items.length) index = items.length - 1;
  if (index < 0) index = 0;
  return items[index];
}

/** `shuffle(items)`: Fisher-Yates into a new array. `N - 1` draws; none when `N` is below 2. */
export function shuffled(items: unknown, random: () => number): unknown[] {
  if (!Array.isArray(items)) throw new RuntimeInternalError(`ctx.shuffle got ${describeValue(items)}; expected an array.`);
  const out: unknown[] = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    let j = Math.floor(random() * (i + 1));
    if (j > i) j = i;
    if (j < 0) j = 0;
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** A numeric argument of a random helper; anything else is a bug of generated code. */
function num(value: unknown, member: string): number {
  if (typeof value !== "number") throw new RuntimeInternalError(`ctx.${member} got ${describeValue(value)}; expected a number.`);
  return value;
}

/** `random_range(lo, hi)` from the draw `r` in `[0, 1)`: `lo + (hi - lo) * r`, rounded to f32 (decision 0149). */
export function randomRange(r: number, lo: number, hi: number): number {
  return Math.fround(lo + (hi - lo) * r);
}

/** `random_int(lo, hi)` from the draw `r` in `[0, 1)`: an i32 in `[lo, hi)`, `lo` when `hi <= lo` (decision 0149). */
export function randomInt(r: number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return (lo + Math.floor(r * (hi - lo))) | 0;
}

