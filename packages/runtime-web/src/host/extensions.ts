import type { Vec3, Quat } from "../math/types.js";
import type { SkeletonPlayer } from "../scene/skeleton.js";
import type { World, EntityRecord } from "../scene/world.js";
import type { SceneInspection, BodyInspection, RenderInspection } from "./inspection.js";

export const EXTENSION_API_VERSION = 1;
export interface SceneTransform {
  /** Opaque scene generation plus declaration symbol or spawn slot/generation. */
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
  readonly visible: boolean;
  /** Explicit final mesh-local sphere, when supplied by source. Fresh copied values. */
  readonly bounds?: { readonly center: Vec3; readonly radius: number };
}
export interface TransformUpdate {
  readonly id: string;
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly scale?: Vec3;
}
export interface ExtensionContext {
  readonly apiVersion: 1;
  /** Fresh copies; no mutable world records cross the boundary. */
  readTransforms(): readonly SceneTransform[];
  /** Optional additive API 1 capability. Passive copies; use afterFrame for render-aligned data. */
  inspectScene?(): SceneInspection | undefined;
  /** Validates the complete batch before applying any write. Local transforms, before bindings. */
  writeTransforms(updates: readonly TransformUpdate[]): void;
  animation(id: string): SkeletonPlayer | undefined;
  /** Explicit shared-pose cohort; use distinct sources for distinct phases or actions. */
  shareAnimation(source: string, targets: readonly string[]): void;
  /** Independent held pose; select a clip or locomotion blend to resume motion. */
  detachAnimation(id: string): SkeletonPlayer;
  /** Explicitly supplied host services (for example a loader or navigation adapter). */
  service<T>(name: string): T | undefined;
}
export interface MtekExtension {
  readonly id: string;
  readonly apiVersion: 1;
  setup(context: ExtensionContext): void | (() => void);
  beforeFrame?(context: ExtensionContext, delta: number): void;
  afterFrame?(context: ExtensionContext, delta: number): void;
}

export function validateExtensions(extensions: readonly MtekExtension[]): void {
  const ids = new Set<string>();
  for (const extension of extensions) {
    if (extension.apiVersion !== EXTENSION_API_VERSION)
      throw new RangeError(
        `Extension '${extension.id}' requires an unsupported API version: ${String(extension.apiVersion)}`,
      );
    if (
      extension.id === "" ||
      ids.has(extension.id) ||
      typeof extension.setup !== "function"
    )
      throw new RangeError(
        `Invalid or duplicate extension ID: ${extension.id}`,
      );
    ids.add(extension.id);
  }
}

export function sceneAccess(
  getWorld: () => World,
  active: () => void,
  inspect?: () => RenderInspection & { readonly bodies: readonly BodyInspection[] },
): Pick<ExtensionContext, "readTransforms" | "inspectScene" | "writeTransforms" | "animation" | "shareAnimation" | "detachAnimation"> {
  const epochs = new WeakMap<World, number>();
  let nextEpoch = 0;
  const records = (): Map<string, EntityRecord> => {
    const world = getWorld(),
      entries = new Map<string, EntityRecord>();
    if (!epochs.has(world)) epochs.set(world, ++nextEpoch);
    const prefix = `scene:${String(epochs.get(world))}:`;
    for (let slot = 0; slot < world.entities.length; slot++) {
      const entity = world.resolvedAt(slot),
        record = world.recordAt(slot);
      if (entity !== undefined && record !== undefined)
        entries.set(prefix + entity.symbol, record);
    }
    for (const entity of world.dynamic.live)
      if (!entity.removing)
        entries.set(
          `${prefix}spawn:${String(entity.ref.slot)}:${String(entity.ref.gen)}`,
          entity.record,
        );
    return entries;
  };
  return {
    inspectScene: () => {
      active();
      if (inspect === undefined) return undefined;
      const world = getWorld(), entries = records(), raw = inspect();
      const ids = new Map([...entries].map(([id, r]) => [r.ref.slot, id]));
      const bounds = new Map(raw.bounds.map(row => [row.slot, row.value]));
      return {
        frame: raw.frame, renderable: raw.renderable, viewport: { ...raw.viewport }, viewProjection: [...raw.viewProjection],
        entities: [...entries].map(([id, r]) => {
          const parent = world.resolvedAt(r.ref.slot)?.parent;
          const bound = bounds.get(r.ref.slot);
          return { id, parentId: parent === null || parent === undefined ? null : ids.get(parent) ?? null,
            worldMatrix: [...world.worldMatrix(r.ref.slot)], ...(bound === undefined ? {} : { bounds: structuredClone(bound) }) };
        }),
        bodies: raw.bodies.flatMap(body => {
          const entityId = ids.get(body.slot), record = world.recordAt(body.slot);
          if (entityId === undefined || record?.ref.gen !== body.generation) return [];
          return [{ entityId, kind: body.kind, active: body.active, collider: structuredClone(body.collider),
            position: { ...body.position }, rotation: { ...body.rotation }, ...(body.contacts === undefined ? {} : {
              contacts: body.contacts.map(c => ({ otherId: ids.get(c.userId) ?? null, point: { ...c.point }, normal: { ...c.normal }, distance: c.distance })),
            }) }];
        }),
      };
    },
    readTransforms: () => {
      active();
      const world = getWorld();
      return [...records()].map(([id, r]) => ({
        id,
        name: world.resolvedAt(r.ref.slot)!.name,
        position: { ...r.position },
        rotation: { ...r.rotation },
        scale: { ...r.scale },
        visible: r.visible,
        ...(r.bounds_radius > 0 ? { bounds: { center: { ...r.bounds_center }, radius: r.bounds_radius } } : {}),
      }));
    },
    writeTransforms: (updates) => {
      active();
      const world = getWorld(),
        entries = records(),
        writes: Array<{
          record: EntityRecord;
          field: string;
          value: Vec3 | Quat;
        }> = [];
      for (const update of updates) {
        const record = entries.get(update.id);
        if (record === undefined)
          throw new RangeError(`Unknown or stale entity ID: ${update.id}`);
        for (const field of ["position", "rotation", "scale"] as const) {
          const value = update[field];
          if (value === undefined) continue;
          if (
            ![value.x, value.y, value.z].every(Number.isFinite) ||
            (field === "scale" &&
              (value.x <= 0 || value.y <= 0 || value.z <= 0))
          )
            throw new RangeError(`Invalid ${field} for ${update.id}`);
          if (field === "rotation") {
            const q = value as Quat;
            if (!Number.isFinite(q.w) || Math.hypot(q.x, q.y, q.z, q.w) < 1e-8)
              throw new RangeError(`Invalid rotation for ${update.id}`);
            const length = Math.hypot(q.x, q.y, q.z, q.w);
            writes.push({
              record,
              field,
              value: Object.freeze({
                x: q.x / length,
                y: q.y / length,
                z: q.z / length,
                w: q.w / length,
              }),
            });
          } else
            writes.push({ record, field, value: Object.freeze({ ...value }) });
        }
      }
      for (const { record, field, value } of writes)
        world.transformSetter(record, field)(value);
    },
    animation: (id) => {
      active();
      const record = records().get(id);
      if (record === undefined)
        throw new RangeError(`Unknown or stale entity ID: ${id}`);
      return getWorld().skinPlayer(record.ref.slot);
    },
    shareAnimation: (source, targets) => {
      active();
      const entities = records();
      const slots = [source,...targets].map(id => {
        const entity = entities.get(id);
        if (entity === undefined) throw new RangeError(`Unknown or stale entity ID: ${id}`);
        return entity.ref.slot;
      });
      getWorld().shareAnimation(slots[0]!,slots.slice(1));
    },
    detachAnimation: id => {
      active(); const entity = records().get(id);
      if (entity === undefined) throw new RangeError(`Unknown or stale entity ID: ${id}`);
      return getWorld().detachAnimation(entity.ref.slot);
    },
  };
}

/** Per-app extension lifetime. One failed callback disables its extension; cleanup always runs. */
export class ExtensionHost {
  private readonly installed: Array<{
    extension: MtekExtension;
    dispose: (() => void) | undefined;
  }> = [];
  constructor(
    private readonly context: ExtensionContext,
    private readonly report: (id: string, error: unknown) => void,
  ) {}
  install(extensions: readonly MtekExtension[]): void {
    validateExtensions(extensions);
    try {
      for (const extension of extensions) {
        const dispose = extension.setup(this.context);
        this.installed.push({ extension, dispose: dispose ?? undefined });
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  frame(phase: "beforeFrame" | "afterFrame", delta: number): void {
    for (const item of [...this.installed]) {
      try {
        item.extension[phase]?.(this.context, delta);
      } catch (error) {
        this.report(item.extension.id, error);
        this.remove(item);
      }
    }
  }
  private remove(item: (typeof this.installed)[number]): void {
    const index = this.installed.indexOf(item);
    if (index < 0) return;
    this.installed.splice(index, 1);
    try {
      item.dispose?.();
    } catch (error) {
      this.report(item.extension.id, error);
    }
  }
  dispose(): void {
    for (const item of [...this.installed].reverse()) this.remove(item);
  }
}
