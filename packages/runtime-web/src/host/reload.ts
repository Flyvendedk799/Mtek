/**
 * Candidate-based hot reload helpers (`spec/runtime-abi.md` section 11): structural comparison,
 * state migration by identity, and the W8070 restart diagnostic.
 */
import type { MtekBody, MtekEntity, MtekLight, MtekManifest, MtekPrefab, MtekScene, MtekStateEntry } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { resolveSpan, spanOfSymbol } from "./failures.js";
import type { EntityRecord, World } from "../scene/world.js";
import { isColor, isQuat, isVec3 } from "../scene/values.js";

/** Why a candidate forces a full scene restart instead of a state-preserving swap. */
export interface StructuralChange {
  /** Symbol of the declaration that forces the restart (shown in W8070). */
  readonly symbol: string;
  readonly reason: string;
}

function bodyKey(body: MtekBody | null): string {
  if (body === null) return "none";
  if (body.kind === "dynamic") return `dynamic:${String(body.mass)}`;
  return body.kind;
}

function parentSymbol(entities: readonly MtekEntity[], parent: number | null): string | null {
  if (parent === null) return null;
  return entities[parent]?.symbol ?? `index:${String(parent)}`;
}

/** `name: type` of each param of a spawned prefab, in order: what spawned entities were made from (decision 0064). */
function paramSignature(prefab: MtekPrefab): string {
  return prefab.params.map((param) => `${param.name}: ${param.type}`).join(", ");
}

/**
 * Detects hierarchy, body and prefab-set changes that cannot be migrated
 * (`spec/runtime-abi.md` section 11.3). Returns the first forcing declaration. A prefab that the program spawns
 * and whose params changed also forces a restart: the params the live instances were spawned with no longer fit
 * its `init` (decision 0064).
 */
export function findStructuralChange(
  previous: MtekScene,
  next: MtekScene,
  previousPrefabs: ReadonlySet<string>,
  nextPrefabs: ReadonlySet<string>,
  previousSpawned: readonly MtekPrefab[] = [],
  nextSpawned: readonly MtekPrefab[] = [],
): StructuralChange | undefined {
  for (const name of nextPrefabs) {
    if (!previousPrefabs.has(name)) {
      return { symbol: name, reason: `prefab '${name}' was added` };
    }
  }
  for (const name of previousPrefabs) {
    if (!nextPrefabs.has(name)) {
      return { symbol: name, reason: `prefab '${name}' was removed` };
    }
  }

  const previousSpawnedBySymbol = new Map(previousSpawned.map((prefab) => [prefab.symbol, prefab]));
  for (const prefab of nextSpawned) {
    const before = previousSpawnedBySymbol.get(prefab.symbol);
    if (before !== undefined && paramSignature(before) !== paramSignature(prefab)) {
      return { symbol: prefab.symbol, reason: `the params of prefab '${prefab.name}' changed (${paramSignature(before)} became ${paramSignature(prefab)})` };
    }
  }

  const previousBySymbol = new Map(previous.entities.map((entity) => [entity.symbol, entity]));
  const nextBySymbol = new Map(next.entities.map((entity) => [entity.symbol, entity]));

  for (const entity of next.entities) {
    const before = previousBySymbol.get(entity.symbol);
    if (before === undefined) {
      return { symbol: entity.symbol, reason: `entity '${entity.name}' was added` };
    }
  }
  for (const entity of previous.entities) {
    if (!nextBySymbol.has(entity.symbol)) {
      return { symbol: entity.symbol, reason: `entity '${entity.name}' was removed` };
    }
  }

  for (const entity of next.entities) {
    const before = previousBySymbol.get(entity.symbol);
    if (before === undefined) continue;
    const beforeParent = parentSymbol(previous.entities, before.parent);
    const nextParent = parentSymbol(next.entities, entity.parent);
    if (beforeParent !== nextParent) {
      return { symbol: entity.symbol, reason: `entity '${entity.name}' changed parent` };
    }
    if (bodyKey(before.body) !== bodyKey(entity.body)) {
      return { symbol: entity.symbol, reason: `entity '${entity.name}' changed body` };
    }
  }

  return undefined;
}

/** Copies a migrated value. A quaternion also satisfies `isVec3`, so it must be tested first or `w` is lost. */
export function copyValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Float32Array) return new Float32Array(value);
  if (isQuat(value)) return { x: value.x, y: value.y, z: value.z, w: value.w };
  if (isVec3(value)) return { x: value.x, y: value.y, z: value.z };
  if (isColor(value)) return { r: value.r, g: value.g, b: value.b, a: value.a };
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record["x"] === "number" && typeof record["y"] === "number" && record["z"] === undefined) {
      return { x: record["x"], y: record["y"] };
    }
    if (
      typeof record["x"] === "number" &&
      typeof record["y"] === "number" &&
      typeof record["z"] === "number" &&
      typeof record["w"] === "number" &&
      record["r"] === undefined
    ) {
      return { x: record["x"], y: record["y"], z: record["z"], w: record["w"] };
    }
  }
  return value;
}

function stateTypeMap(entries: readonly MtekStateEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.symbol, entry.type]));
}

function stateBySymbol(entries: readonly MtekStateEntry[], values: Record<string, unknown>): Map<string, { type: string; value: unknown }> {
  const out = new Map<string, { type: string; value: unknown }>();
  for (const entry of entries) {
    if (Object.hasOwn(values, entry.name)) {
      out.set(entry.symbol, { type: entry.type, value: values[entry.name] });
    }
  }
  return out;
}

/**
 * Carries what the program kept in one entity from `before` onto `after`: transform, visibility, the state whose
 * identity (symbol) and type are unchanged, and the imperative material params, which are written through the
 * context so the parameter store sees them (a param that `init` supplied stays as the new `init` left it, so a
 * changed default is applied).
 */
function carryEntity(
  before: EntityRecord,
  beforeState: ReadonlyMap<string, string>,
  after: EntityRecord,
  afterState: readonly MtekStateEntry[],
  imperative: readonly string[],
  setParam: (entity: object, name: string, value: unknown) => void,
): void {
  after.position = copyValue(before.position) as EntityRecord["position"];
  after.rotation = copyValue(before.rotation) as EntityRecord["rotation"];
  after.scale = copyValue(before.scale) as EntityRecord["scale"];
  after.visible = before.visible;

  for (const entry of afterState) {
    if (beforeState.get(entry.symbol) === entry.type && Object.hasOwn(before.state, entry.name)) {
      after.state[entry.name] = copyValue(before.state[entry.name]);
    }
  }

  if (after.mat !== null && before.mat !== null) {
    for (const name of imperative) {
      if (!Object.hasOwn(before.mat.p, name)) continue;
      setParam(after, name, copyValue(before.mat.p[name]));
    }
  }
}

const LIGHT_FIELDS = ["color", "intensity"] as const;

/**
 * Carries the colour and intensity a handler wrote into the light of `before` onto the light of `after`
 * (decision 0067). The update class of each field decides: `imperative` in both programs keeps the running
 * value, written through the context so the world sees it; `initial` takes what the new `init` set (an edited
 * literal applies), and `bound` is evaluated again every frame. A light that was added or removed, or whose
 * kind changed, keeps what the new `init` made of it.
 */
function carryLight(
  before: EntityRecord,
  previous: MtekLight | undefined,
  after: EntityRecord,
  next: MtekLight | undefined,
  setLight: (entity: object, field: string, value: unknown) => void,
): void {
  if (before.light === null || after.light === null || previous === undefined || next === undefined || previous.kind !== next.kind) return;
  for (const field of LIGHT_FIELDS) {
    if (previous.classes[field] !== "imperative" || next.classes[field] !== "imperative") continue;
    setLight(after, field, copyValue(before.light[field]));
  }
}

/**
 * Carries compatible state from `previous` onto `next` by identity
 * (`path::Qualified.Name` with identical types). Material `initial` params stay as the new
 * `init` left them (so a changed literal default is applied); imperative mirrors are migrated. The colour and
 * intensity of a light follow the same rule by their own update classes ({@link carryLight}).
 */
export function migrateWorld(previous: World, previousManifest: MtekManifest, next: World, nextManifest: MtekManifest): void {
  const previousSceneState = stateBySymbol(previousManifest.scene.state, previous.sceneState);
  for (const entry of nextManifest.scene.state) {
    const before = previousSceneState.get(entry.symbol);
    if (before !== undefined && before.type === entry.type) {
      next.sceneState[entry.name] = copyValue(before.value);
    }
  }

  const previousEntities = new Map<string, EntityRecord>();
  previousManifest.scene.entities.forEach((entity, index) => {
    const record = previous.entities[index];
    if (record !== undefined) previousEntities.set(entity.symbol, record);
  });
  const previousEntityStateTypes = new Map(
    previousManifest.scene.entities.map((entity) => [entity.symbol, stateTypeMap(entity.state)]),
  );

  const previousLights = new Map(
    previousManifest.scene.entities.map((entity) => [entity.symbol, entity.light === null ? undefined : previousManifest.scene.lights[entity.light]]),
  );
  const { setParam, setLight } = next.ctx as {
    setParam: (entity: object, name: string, value: unknown) => void;
    setLight: (entity: object, field: string, value: unknown) => void;
  };
  nextManifest.scene.entities.forEach((entity, index) => {
    const nextRecord = next.entities[index];
    const before = previousEntities.get(entity.symbol);
    if (nextRecord === undefined || before === undefined) return;
    carryLight(before, previousLights.get(entity.symbol), nextRecord, entity.light === null ? undefined : nextManifest.scene.lights[entity.light], setLight);
    const nextInstance = nextManifest.scene.materialInstances[entity.material?.instance ?? -1];
    carryEntity(
      before,
      previousEntityStateTypes.get(entity.symbol) ?? new Map(),
      nextRecord,
      entity.state,
      (nextInstance?.params ?? []).filter((param) => param.class === "imperative").map((param) => param.name),
      setParam,
    );
  });

  // The spawned entities that exist (decision 0064): created again under the same slot and generation by the
  // new program's `init`, with the params they were spawned with; what the program kept moves over like a
  // named entity's. References held in state stay valid for them and dead for everything else.
  next.dynamic.restoreFrom(previous.dynamic, (before, after) => {
    carryEntity(
      before.record,
      new Map(before.prefab.resolved.state.map((entry) => [entry.symbol, entry.type])),
      after.record,
      after.prefab.resolved.state,
      (after.prefab.resolved.material?.params ?? []).filter((param) => param.class === "imperative").map((param) => param.name),
      setParam,
    );
  });

  // Camera: preserve when the active camera symbol and projection kind match.
  const previousCamera = previousManifest.scene.cameras.find((camera) => camera.active);
  const nextCamera = nextManifest.scene.cameras.find((camera) => camera.active);
  if (
    previousCamera !== undefined &&
    nextCamera !== undefined &&
    previousCamera.symbol === nextCamera.symbol &&
    previousCamera.projection === nextCamera.projection
  ) {
    next.camera.position = copyValue(previous.camera.position) as EntityRecord["position"];
    next.camera.rotation = copyValue(previous.camera.rotation) as EntityRecord["rotation"];
    next.camera.target = previous.camera.target === null ? null : (copyValue(previous.camera.target) as EntityRecord["position"]);
    if (next.camera.projection.kind === "perspective" && previous.camera.projection.kind === "perspective") {
      next.camera.projection.fov_y = previous.camera.projection.fov_y;
      next.camera.projection.near = previous.camera.projection.near;
      next.camera.projection.far = previous.camera.projection.far;
    } else if (next.camera.projection.kind === "orthographic" && previous.camera.projection.kind === "orthographic") {
      next.camera.projection.height = previous.camera.projection.height;
      next.camera.projection.near = previous.camera.projection.near;
      next.camera.projection.far = previous.camera.projection.far;
    }
  }

  next.propagate();
}

/** Builds the W8070 diagnostic naming the declaration that forced a restart. */
export function restartDiagnostic(manifest: MtekManifest, change: StructuralChange): MtekDiagnostic {
  const spanId = spanOfSymbol(manifest, change.symbol);
  return makeRuntimeDiagnostic("W8070", {
    phase: "runtime:reload",
    message: `The scene was restarted on reload because ${change.reason}.`,
    source: spanId === undefined ? null : resolveSpan(manifest, spanId),
    notes: [`declaration: ${change.symbol}`],
  });
}

/** Prefab names from a program module's `prefabs` table. */
export function prefabNames(prefabs: unknown): ReadonlySet<string> {
  if (typeof prefabs !== "object" || prefabs === null || Array.isArray(prefabs)) return new Set();
  return new Set(Object.keys(prefabs));
}
