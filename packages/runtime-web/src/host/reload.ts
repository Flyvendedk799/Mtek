/**
 * Candidate-based hot reload helpers (`spec/runtime-abi.md` section 11): structural comparison,
 * state migration by identity, and the W8070 restart diagnostic.
 */
import type { MtekBody, MtekEntity, MtekManifest, MtekScene, MtekStateEntry } from "../abi/manifest-types.js";
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

/**
 * Detects hierarchy, body and prefab-set changes that cannot be migrated
 * (`spec/runtime-abi.md` section 11.3). Returns the first forcing declaration.
 */
export function findStructuralChange(
  previous: MtekScene,
  next: MtekScene,
  previousPrefabs: ReadonlySet<string>,
  nextPrefabs: ReadonlySet<string>,
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

function copyValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Float32Array) return new Float32Array(value);
  if (isVec3(value)) return { x: value.x, y: value.y, z: value.z };
  if (isQuat(value)) return { x: value.x, y: value.y, z: value.z, w: value.w };
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
 * Carries compatible state from `previous` onto `next` by identity
 * (`path::Qualified.Name` with identical types). Material `initial` params stay as the new
 * `init` left them (so a changed literal default is applied); imperative mirrors are migrated.
 */
export function migrateWorld(previous: World, previousManifest: MtekManifest, next: World, nextManifest: MtekManifest): void {
  const previousSceneState = stateBySymbol(previousManifest.scene.state, previous.state);
  for (const entry of nextManifest.scene.state) {
    const before = previousSceneState.get(entry.symbol);
    if (before !== undefined && before.type === entry.type) {
      next.state[entry.name] = copyValue(before.value);
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

  nextManifest.scene.entities.forEach((entity, index) => {
    const nextRecord = next.entities[index];
    const before = previousEntities.get(entity.symbol);
    if (nextRecord === undefined || before === undefined) return;

    nextRecord.position = copyValue(before.position) as EntityRecord["position"];
    nextRecord.rotation = copyValue(before.rotation) as EntityRecord["rotation"];
    nextRecord.scale = copyValue(before.scale) as EntityRecord["scale"];
    nextRecord.visible = before.visible;

    const beforeTypes = previousEntityStateTypes.get(entity.symbol);
    for (const entry of entity.state) {
      const beforeType = beforeTypes?.get(entry.symbol);
      if (beforeType === entry.type && Object.hasOwn(before.state, entry.name)) {
        nextRecord.state[entry.name] = copyValue(before.state[entry.name]);
      }
    }

    // Imperative material params: migrate by name when both sides have a material mirror.
    // Initial params keep the values `init` wrote on the candidate (changed defaults apply).
    if (nextRecord.mat !== null && before.mat !== null) {
      const nextInstance = nextManifest.scene.materialInstances[entity.material?.instance ?? -1];
      const setParam = (next.ctx as { setParam: (entity: object, name: string, value: unknown) => void }).setParam;
      if (nextInstance !== undefined) {
        for (const param of nextInstance.params) {
          if (param.class !== "imperative") continue;
          if (!Object.hasOwn(before.mat.p, param.name)) continue;
          setParam(nextRecord, param.name, copyValue(before.mat.p[param.name]));
        }
      }
    }
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
