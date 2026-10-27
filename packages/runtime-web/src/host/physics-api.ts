/**
 * The host's view of physics (decision 0217): ray and shape casts, contacts and collision groups, by entity ID.
 *
 * `app.physics` and `ExtensionContext.physics` are `undefined` for a program without bodies and this object
 * otherwise. IDs are the opaque ones of `inspectScene` / `readTransforms` (never adapter handles or slots), and
 * results are fresh copies. Queries see the world as of the last completed tick: they never step it, and no method
 * here moves a body (the single pose authority of `spec/physics.md` holds). A method the loaded adapter does not
 * implement throws a `MtekPhysicsUnsupportedError` that names it; every method validates its input first and throws
 * a `RangeError` (a bad value or an unknown or stale ID) or a `TypeError` (a value of the wrong kind).
 *
 * Collision groups are 16-bit masks: `memberships` says which groups a body is in and `filter` which groups it
 * collides with. Two bodies interact when each one's filter shares a bit with the other's memberships. The adapter
 * receives them packed as `((memberships << 16) | filter) >>> 0`, which is also how a query's `groups` option is
 * packed. A new world (a hot reload that rebuilds physics) starts with every body in every group.
 */
import type { Quat, Vec3 } from "../math/types.js";
import type { PhysicsQueries } from "../physics/system.js";
import type { BodyHandle, ColliderDesc, PhysicsQueryFilter } from "../physics/types.js";
import type { EntityIds } from "./entity-ids.js";

/** A query shape; sizes are full extents, a capsule's height includes both caps and exceeds `2 * radius`. */
export type MtekQueryShape =
  | { readonly kind: "sphere"; readonly radius: number }
  | { readonly kind: "box"; readonly size: Vec3 }
  | { readonly kind: "capsule"; readonly radius: number; readonly height: number };

/** 16-bit collision groups. */
export interface MtekCollisionGroups {
  readonly memberships: number;
  readonly filter: number;
}

/** What a query may skip or restrict. */
export interface MtekQueryOptions {
  /** Only bodies whose groups interact with these (as if the query were a body with them). */
  readonly groups?: MtekCollisionGroups;
  /** Sensors are skipped unless this is true. */
  readonly includeSensors?: boolean;
  /** The entity whose body the query ignores (for example the caster itself). */
  readonly exclude?: string;
}

export interface MtekRayHit {
  readonly entityId: string;
  /** Metres along the unit direction. */
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface MtekShapeHit {
  readonly entityId: string;
  /** How much of the displacement was travelled before the hit, 0 to 1. */
  readonly fraction: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface MtekContact {
  /** The other entity, or null when it is not an entity of the scene any more. */
  readonly entityId: string | null;
  readonly point: Vec3;
  readonly normal: Vec3;
  /** Negative when the shapes overlap. */
  readonly distance: number;
}

export interface MtekPhysics {
  /**
   * The nearest body the ray `origin + t * direction` hits within `maxDistance` metres (`direction` need not be
   * normalised, `maxDistance` is along its unit vector).
   */
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, options?: MtekQueryOptions): MtekRayHit | undefined;
  /** Sweeps `shape` placed at `pose` (rotation defaults to the identity) along `displacement` and reports the first hit. */
  castShape(
    shape: MtekQueryShape,
    pose: { readonly position: Vec3; readonly rotation?: Quat },
    displacement: Vec3,
    options?: MtekQueryOptions,
  ): MtekShapeHit | undefined;
  /** The contacts of the body of an entity as of the last step. */
  contacts(entityId: string): readonly MtekContact[];
  /** Sets the groups of the collider of the entity's body; effective at once, also for the next step. */
  setCollisionGroups(entityId: string, memberships: number, filter: number): void;
}

/** The loaded physics adapter does not implement a method of the host API. */
export class MtekPhysicsUnsupportedError extends Error {
  constructor(
    readonly method: string,
    readonly adapter: string,
  ) {
    super(`The physics adapter '${adapter}' does not support ${method}.`);
    this.name = "MtekPhysicsUnsupportedError";
  }
}

const GROUP_MAX = 0xffff;

function vec3(value: unknown, what: string): Vec3 {
  const v = value as Partial<Record<"x" | "y" | "z", unknown>> | null | undefined;
  if (typeof v !== "object" || v === null || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.z !== "number")
    throw new TypeError(`${what} must be an object with numeric x, y and z.`);
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) throw new RangeError(`${what} must be finite.`);
  return { x: v.x, y: v.y, z: v.z };
}

function quat(value: unknown, what: string): Quat {
  const q = value as Partial<Record<"x" | "y" | "z" | "w", unknown>> | null | undefined;
  if (typeof q !== "object" || q === null || typeof q.x !== "number" || typeof q.y !== "number" || typeof q.z !== "number" || typeof q.w !== "number")
    throw new TypeError(`${what} must be an object with numeric x, y, z and w.`);
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length < 1e-8) throw new RangeError(`${what} must be finite and not of zero length.`);
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function positive(value: unknown, what: string): number {
  if (typeof value !== "number") throw new TypeError(`${what} must be a number.`);
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${what} must be finite and greater than zero.`);
  return value;
}

function mask(value: unknown, what: string): number {
  if (typeof value !== "number") throw new TypeError(`${what} must be a number.`);
  if (!Number.isInteger(value) || value < 0 || value > GROUP_MAX) throw new RangeError(`${what} must be an integer from 0 to ${String(GROUP_MAX)}.`);
  return value;
}

const pack = (memberships: number, filter: number): number => ((memberships << 16) | filter) >>> 0;

function shapeOf(value: unknown): ColliderDesc["shape"] {
  const shape = value as { readonly kind?: unknown; readonly radius?: unknown; readonly size?: unknown; readonly height?: unknown } | null | undefined;
  if (typeof shape !== "object" || shape === null) throw new TypeError("shape must be an object.");
  switch (shape.kind) {
    case "sphere":
      return { kind: "sphere", radius: positive(shape.radius, "shape.radius") };
    case "box": {
      const size = vec3(shape.size, "shape.size");
      positive(size.x, "shape.size.x");
      positive(size.y, "shape.size.y");
      positive(size.z, "shape.size.z");
      return { kind: "box", size };
    }
    case "capsule": {
      const radius = positive(shape.radius, "shape.radius");
      const height = positive(shape.height, "shape.height");
      if (height <= 2 * radius) throw new RangeError("shape.height must be greater than twice shape.radius.");
      return { kind: "capsule", radius, height };
    }
    default:
      throw new TypeError("shape.kind must be 'sphere', 'box' or 'capsule'.");
  }
}

/** What the physics API needs of the application; read at every call, so a hot reload is followed. */
export interface HostPhysicsAccess {
  /** The queries of the live physics world, or `undefined` for a program without bodies. */
  readonly queries: () => PhysicsQueries | undefined;
  readonly ids: EntityIds;
  /** Throws when the application is failed or disposed. */
  readonly active: () => void;
}

const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

/** Builds the host API object; it stays valid across hot reloads and throws once the program has no physics. */
export function createHostPhysics(access: HostPhysicsAccess): MtekPhysics {
  const live = (method: "castRay" | "castShape" | "contacts" | "setCollisionGroups"): PhysicsQueries => {
    access.active();
    const queries = access.queries();
    if (queries === undefined) throw new Error("The running program has no physics.");
    if (!queries.supports(method)) throw new MtekPhysicsUnsupportedError(method, queries.adapter);
    return queries;
  };
  /** The body of the entity `id` names. */
  const bodyOf = (queries: PhysicsQueries, id: unknown): BodyHandle => {
    if (typeof id !== "string") throw new TypeError("entityId must be a string.");
    const record = access.ids.records().get(id);
    if (record === undefined) throw new RangeError(`Unknown or stale entity ID: ${id}`);
    const handle = queries.handleOf(record.ref.slot, record.ref.gen);
    if (handle === undefined) throw new RangeError(`The entity ${id} has no active physics body.`);
    return handle;
  };
  const filterOf = (queries: PhysicsQueries, options: MtekQueryOptions | undefined): PhysicsQueryFilter => {
    if (options === undefined) return {};
    const groups = options.groups === undefined ? undefined : pack(mask(options.groups.memberships, "groups.memberships"), mask(options.groups.filter, "groups.filter"));
    if (options.includeSensors !== undefined && typeof options.includeSensors !== "boolean") throw new TypeError("includeSensors must be a boolean.");
    const exclude = options.exclude === undefined ? undefined : bodyOf(queries, options.exclude);
    return {
      ...(groups === undefined ? {} : { groups }),
      ...(options.includeSensors === undefined ? {} : { includeSensors: options.includeSensors }),
      ...(exclude === undefined ? {} : { exclude }),
    };
  };
  return {
    castRay: (origin, direction, maxDistance, options) => {
      const queries = live("castRay");
      const from = vec3(origin, "origin");
      const along = vec3(direction, "direction");
      if (along.x === 0 && along.y === 0 && along.z === 0) throw new RangeError("direction must not be zero.");
      const hit = queries.castRay(from, along, positive(maxDistance, "maxDistance"), filterOf(queries, options));
      const entityId = hit === undefined ? undefined : access.ids.idOfSlot(hit.userId);
      return hit === undefined || entityId === undefined ? undefined : { entityId, distance: hit.distance, point: copy(hit.point), normal: copy(hit.normal) };
    },
    castShape: (shape, pose, displacement, options) => {
      const queries = live("castShape");
      const description = shapeOf(shape);
      const placed = { position: vec3(pose?.position, "pose.position"), rotation: pose?.rotation === undefined ? { x: 0, y: 0, z: 0, w: 1 } : quat(pose.rotation, "pose.rotation") };
      const sweep = vec3(displacement, "displacement");
      const hit = queries.castShape(description, placed, sweep, filterOf(queries, options));
      const entityId = hit === undefined ? undefined : access.ids.idOfSlot(hit.userId);
      return hit === undefined || entityId === undefined ? undefined : { entityId, fraction: hit.fraction, point: copy(hit.point), normal: copy(hit.normal) };
    },
    contacts: (entityId) => {
      const queries = live("contacts");
      return queries.contacts(bodyOf(queries, entityId)).map((contact) => ({
        entityId: access.ids.idOfSlot(contact.userId) ?? null,
        point: copy(contact.point),
        normal: copy(contact.normal),
        distance: contact.distance,
      }));
    },
    setCollisionGroups: (entityId, memberships, filter) => {
      const queries = live("setCollisionGroups");
      const m = mask(memberships, "memberships");
      const f = mask(filter, "filter");
      queries.setCollisionGroups(bodyOf(queries, entityId), m, f);
    },
  };
}
