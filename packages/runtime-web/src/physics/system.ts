/**
 * The physics subsystem of a mounted scene: bodies made from the manifest, the command queue, the fixed tick's
 * physics half, pose write-back and collision delivery (`spec/physics.md` sections 3, 4 and 6, decision 0066).
 *
 * The scheduler's fixed tick (`spec/scenes.md` section 10, phase 2) is driven by the application:
 *
 *   1. `world.dynamic.flush()`    spawned bodies are created and destroyed ones removed (listener below);
 *   2. {@link PhysicsSystem.applyCommands}   the queued commands, once, by category then issue order;
 *   3. `fixed_update` handlers    (their commands go to the next tick);
 *   4. {@link PhysicsSystem.stepAndDeliver}  `step`, pose write-back of dynamic and kinematic bodies, the
 *      velocities `ctx.body(..).linearVelocity` reads, then the sorted collision events to the handlers.
 *
 * The system talks to the backend only through the interfaces of `./types.ts`. It keeps one {@link BodyEntry} per
 * entity that has a body, indexed by the entity's slot (`spec/scenes.md` section 9); the slot is also the user id the
 * adapter reports collisions with, which is what makes event order stable (`./events.ts`).
 *
 * Callback safety: a handler can only *queue* `destroy`, so the bodies the iteration of events walks are never
 * removed while it walks; the body goes at the flush (`EntityLifecycleListener.removed`). Events whose pair has an
 * entity pending removal are skipped, checked again before every single delivery.
 */
import type { MtekBody, MtekCollider, MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import type { DynamicEntity, EntityLifecycleListener } from "../scene/dynamic.js";
import { RuntimeInternalError } from "../scene/errors.js";
import type { EntityRef } from "../scene/slots.js";
import { describeValue, isFiniteQuat, isFiniteVec3, isQuat, isVec3 } from "../scene/values.js";
import type { BodyService, EntityRecord, World } from "../scene/world.js";
import { CommandQueue, type QueuedCommand } from "./commands.js";
import { collisionPair, sortCollisions, type CollisionPair } from "./events.js";
import type {
  BodyDesc,
  BodyHandle,
  ColliderDesc,
  PhysicsBackend,
  PhysicsContact,
  PhysicsQueryFilter,
  PhysicsWorld,
  Pose,
  Quat,
  RayHit,
  ShapeHit,
  Vec3,
} from "./types.js";
import type { BodyInspection } from "../host/inspection.js";

export type BodyKind = "static" | "kinematic" | "dynamic";

/** Which collision event a handler is called for. */
export type CollisionEventName = "collision_enter" | "collision_exit";

/** Everything the system needs from the application. */
export interface PhysicsOptions {
  readonly continuousCollision?:boolean;
  readonly backend: PhysicsBackend;
  readonly manifest: MtekManifest;
  readonly world: World;
  /** Delivers a run-time diagnostic. */
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /**
   * Calls the `kind` handlers of the entity in `slot` with `other` (in declaration order); a no-op for an entity
   * that declares none. Called in the deterministic order of `spec/physics.md` section 6.
   */
  readonly deliver: (kind: CollisionEventName, slot: number, other: EntityRef) => void;
}

/** The spatial queries of the adapter, for the host API (`PhysicsSystem.queries`); user ids are entity slots. */
export interface PhysicsQueries {
  readonly adapter: string;
  supports(method: "castRay" | "castShape" | "contacts" | "setCollisionGroups"): boolean;
  /** The body of the entity in `slot` of generation `generation`, or `undefined` (no body, frozen, stale). */
  handleOf(slot: number, generation: number): BodyHandle | undefined;
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, filter?: PhysicsQueryFilter): RayHit | undefined;
  castShape(shape: ColliderDesc["shape"], pose: Pose, displacement: Vec3, filter?: PhysicsQueryFilter): ShapeHit | undefined;
  contacts(handle: BodyHandle): readonly PhysicsContact[];
  setCollisionGroups(handle: BodyHandle, memberships: number, filter: number): void;
}

/** The `move_character` settings of a kinematic body (`spec/physics.md` section 2): radians and metres. */
export interface CharacterSettings {
  readonly maxSlope: number;
  readonly stepHeight: number;
  readonly stepMinWidth: number;
  readonly snapToGround: number;
  readonly skin: number;
  readonly carry: boolean;
}

/** What a kinematic body gets when the program wrote none of the six fields (decisions 0214, 0217). */
export const CHARACTER_DEFAULTS: CharacterSettings = Object.freeze({
  maxSlope: 0.7853982,
  stepHeight: 0.25,
  stepMinWidth: 0.1,
  snapToGround: 0.2,
  skin: 0.01,
  carry: true,
});

/** What the system knows about one entity that has a body. */
interface BodyEntry {
  readonly collider: ColliderDesc;
  readonly ref: EntityRef;
  readonly kind: BodyKind;
  /** For messages: the entity's name (a prefab's name for spawned entities). */
  readonly name: string;
  /** `undefined` once the body is frozen (`E8103`) or was never created (`E8104`): the entity keeps its last pose. */
  handle: BodyHandle | undefined;
  /** The velocities as of the last completed tick (`spec/physics.md` section 3): zero before the first. */
  linear: Vec3;
  angular: Vec3;
  /** Kinematic bodies: the settings of `move_character`, defaults applied. */
  readonly character: CharacterSettings | undefined;
  /** As of the last completed `move_character` (false and zero before the first and for a body never moved so). */
  grounded: boolean;
  groundNormal: Vec3;
  /** `E8105` was reported for this body: the loaded adapter cannot move characters (once per body). */
  unsupportedReported: boolean;
  /** The rotation the entity's record got at the last write-back: what a program reading `self.rotation` sees. */
  rotationRead: Quat | undefined;
}

/** A character move of one body in one tick: the displacements of its commands summed, the last rotation. */
interface PendingMove {
  displacement: Vec3;
  rotation: Quat;
  /** The rotation asked for is the one the body had when the command was issued: keep whatever it has when the move is resolved. */
  keepRotation: boolean;
  applied: boolean;
}

/** Whether two rotations are the same to the precision of the pose a program reads (binary32 components). */
function sameRotation(a: Quat, b: Quat): boolean {
  return Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6 && Math.abs(a.z - b.z) <= 1e-6 && Math.abs(a.w - b.w) <= 1e-6;
}

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const f32 = Math.fround;

/** Rotations shorter than this cannot be normalised by the solver without producing NaN (`E8104`). */
const MIN_ROTATION_LENGTH_SQUARED = 1e-20;

/** The body descriptor; `continuous` is the host option `physics.continuousCollision` (every dynamic body) or the body's own. */
function bodyDesc(body: MtekBody, continuous: boolean): BodyDesc {
  return body.kind === "dynamic"
    ? {
        kind: "dynamic",
        mass: body.mass,
        linearDamping: body.linearDamping,
        angularDamping: body.angularDamping,
        ...(continuous || body.continuous === true ? { continuousCollision: true } : {}),
      }
    : { kind: body.kind };
}

function characterSettings(body: MtekBody): CharacterSettings | undefined {
  return body.kind === "kinematic" ? Object.freeze({ ...CHARACTER_DEFAULTS, ...body.character }) : undefined;
}

function colliderDesc(collider: MtekCollider): ColliderDesc {
  const shape =
    collider.kind === "box"
      ? ({ kind: "box", size: { x: collider.size[0], y: collider.size[1], z: collider.size[2] } } as const)
      : collider.kind === "capsule"
        ? ({ kind: "capsule", radius: collider.radius, height: collider.height } as const)
        : ({ kind: "sphere", radius: collider.radius } as const);
  return { shape, sensor: collider.sensor, friction: collider.friction, restitution: collider.restitution };
}

function finiteRotation(rotation: Quat): boolean {
  return isFiniteQuat(rotation) && rotation.x * rotation.x + rotation.y * rotation.y + rotation.z * rotation.z + rotation.w * rotation.w >= MIN_ROTATION_LENGTH_SQUARED;
}

function frozenVec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z) });
}

/** The commands a body kind supports (`spec/physics.md` section 3, "Applies to"). */
const SUPPORTED: Readonly<Record<string, readonly BodyKind[]>> = {
  apply_impulse: ["dynamic"],
  apply_force: ["dynamic"],
  set_linear_velocity: ["dynamic"],
  set_kinematic_target: ["kinematic"],
  move_character: ["kinematic"],
  teleport: ["dynamic", "kinematic"],
  linear_velocity: ["dynamic", "kinematic"],
  angular_velocity: ["dynamic", "kinematic"],
  grounded: ["kinematic"],
  ground_normal: ["kinematic"],
};

/** The setter of the generated-code context a pose is written through (it marks the transform dirty). */
interface TransformSetter {
  setTransform(entity: object, field: "position" | "rotation", value: unknown): void;
}

export class PhysicsSystem implements BodyService {
  private readonly physics: PhysicsWorld;
  /** By slot. */
  private readonly bodies: (BodyEntry | undefined)[] = [];
  private readonly queue = new CommandQueue();
  private readonly stopListening: () => void;
  private stepCount = 0;
  private frozenCount = 0;
  private disposed = false;

  /**
   * Creates the backend world (gravity from `manifest.scene.fields`, the manifest's fixed step) and starts to
   * follow the spawned entities of `world`. Bodies of the named entities are made by {@link createNamedBodies},
   * once the scene is initialised. Throws what the backend throws; the caller reports it as `E8102`.
   */
  constructor(private readonly options: PhysicsOptions) {
    const [x, y, z] = options.manifest.scene.fields.gravity;
    this.physics = options.backend.createWorld({ x, y, z }, options.manifest.runtimeConfig.fixedStep);
    const listener: EntityLifecycleListener = {
      created: (entity) => {
        this.entityCreated(entity);
      },
      removed: (entity) => {
        this.entityRemoved(entity);
      },
    };
    this.stopListening = options.world.dynamic.addListener(listener);
  }

  // ---- bodies ----

  /**
   * Creates the bodies of the named entities from the manifest, at their poses after `init`, the bindings and the
   * propagation of transforms (`spec/scenes.md` section 11, step 5).
   */
  createNamedBodies(): void {
    const { world, manifest } = this.options;
    manifest.scene.entities.forEach((entity, index) => {
      const record = world.entities[index];
      if (entity.body === null || entity.collider === null || record === undefined) return;
      this.addBody(record.ref, record, entity.body, entity.collider, entity.name);
    });
  }

  private entityCreated(entity: DynamicEntity): void {
    const body = entity.prefab.resolved.body;
    const collider = entity.prefab.resolved.collider;
    if (body === null || collider === null) return;
    this.addBody(entity.ref, entity.record, body, collider, entity.prefab.resolved.name);
  }

  private entityRemoved(entity: DynamicEntity): void {
    const entry = this.bodies[entity.ref.slot];
    if (entry === undefined || entry.ref.gen !== entity.ref.gen) return;
    this.bodies[entity.ref.slot] = undefined;
    if (entry.handle !== undefined) this.physics.removeBody(entry.handle);
  }

  private addBody(ref: EntityRef, record: EntityRecord, body: MtekBody, collider: MtekCollider, name: string): void {
    const entry: BodyEntry = {
      ref,
      kind: body.kind,
      name,
      collider: colliderDesc(collider),
      handle: undefined,
      linear: ZERO,
      angular: ZERO,
      character: characterSettings(body),
      grounded: false,
      groundNormal: ZERO,
      unsupportedReported: false,
      rotationRead: record.rotation,
    };
    this.bodies[ref.slot] = entry;
    const pose: Pose = { position: record.position, rotation: record.rotation };
    if (!isFiniteVec3(pose.position) || !finiteRotation(pose.rotation)) {
      this.report("E8104", ref.slot, `The body of '${name}' was not created: its pose ${describeValue(pose.position)} / ${describeValue(pose.rotation)} is not finite. The entity keeps its pose and does not take part in the simulation.`);
      return;
    }
    entry.handle = this.physics.addBody(bodyDesc(body, this.options.continuousCollision === true), entry.collider, pose, ref.slot);
  }

  // ---- ctx.body ----

  /** `ctx.body(target, spanId)` (`spec/runtime-abi.md` section 4.2). */
  handle(target: unknown, spanId: unknown): object {
    if (this.disposed) throw new RuntimeInternalError("ctx.body was used after the physics subsystem was disposed.");
    const ref = this.refOf(target);
    return new BodyHandleImpl(this, ref, typeof spanId === "number" && Number.isInteger(spanId) ? spanId : -1);
  }

  private refOf(target: unknown): EntityRef {
    if (typeof target === "object" && target !== null) {
      const candidate = target as { readonly ref?: unknown; readonly slot?: unknown; readonly gen?: unknown };
      if (typeof candidate.slot === "number" && typeof candidate.gen === "number") return target as EntityRef;
      const ref = candidate.ref as Partial<EntityRef> | undefined;
      if (typeof ref?.slot === "number" && typeof ref.gen === "number") return ref as EntityRef;
    }
    throw new RuntimeInternalError(`ctx.body got ${describeValue(target)}; expected an entity record or an entity_ref.`);
  }

  /**
   * The entry a command of `command` (`snake_case`, as in the language) aimed at `ref` applies to, or `undefined`
   * when the command is dropped: for a pending or dead target with `W8031` (decided by `DynamicEntities`), for an
   * entity whose body kind does not support it with `E8101`, silently for a frozen body (already reported).
   * @internal Used by the handle only.
   */
  entryFor(ref: EntityRef, spanId: number, command: string): BodyEntry | undefined {
    const { dynamic } = this.options.world;
    // `commandTarget` is the one place that decides on `W8031`; a named entity is never dropped by it.
    if (dynamic.status(ref) !== "static" && dynamic.commandTarget(ref, spanId, command) === undefined) return undefined;
    return this.supported(ref, spanId, command, "command");
  }

  /**
   * As {@link entryFor} for a read of a readable property: a target that does not exist reads as zero without a
   * diagnostic, one whose kind has no such property is `E8101`. @internal Used by the handle only.
   */
  entryForRead(ref: EntityRef, spanId: number, property: string): BodyEntry | undefined {
    const status = this.options.world.dynamic.status(ref);
    if (status !== "static" && status !== "alive") return undefined;
    return this.supported(ref, spanId, property, "read");
  }

  /** The entry for `command` (a command or a readable property), or `undefined` with `E8101` / silently when frozen. */
  private supported(ref: EntityRef, spanId: number, command: string, what: "command" | "read"): BodyEntry | undefined {
    const entry = this.bodies[ref.slot];
    const resolved = this.options.world.resolvedAt(ref.slot);
    const outcome = what === "command" ? `The command ${command} was dropped` : `The read of ${command} gave zero`;
    if (entry === undefined || entry.ref.gen !== ref.gen) {
      this.reportAt("E8101", spanId, `${outcome}: '${resolved?.name ?? String(ref.slot)}' has no body.`, []);
      return undefined;
    }
    const kinds = SUPPORTED[command] ?? [];
    if (!kinds.includes(entry.kind)) {
      this.reportAt("E8101", spanId, `${outcome}: '${entry.name}' has a ${entry.kind} body, which does not support it.`, [
        `${command} applies to ${kinds.join(" and ")} bodies`,
      ]);
      return undefined;
    }
    // A frozen (`E8103`) or never created (`E8104`) body has been reported; its commands are dropped without a word.
    return entry.handle === undefined ? undefined : entry;
  }

  /**
   * Queues `command` after checking the vectors and rotations among its arguments (`checked`); a value that is not
   * finite drops the command with `E8104`. @internal Used by the handle only.
   */
  enqueue(entry: BodyEntry, spanId: number, name: string, command: QueuedCommand, checked: readonly (Vec3 | Quat)[]): void {
    for (const value of checked) {
      const rotation = isQuat(value);
      if (rotation ? finiteRotation(value) : isFiniteVec3(value)) continue;
      this.reportAt(
        "E8104",
        spanId,
        `The command ${name} on '${entry.name}' was dropped: its argument ${describeValue(value)} is not finite${rotation ? " (or is a rotation of zero length)" : ""}.`,
        [],
      );
      return;
    }
    this.queue.push(command);
  }

  /**
   * Queues `move_character`. A loaded adapter without `moveCharacter` cannot run it: the command is dropped and `E8105`
   * is reported, once per body. @internal Used by the handle only.
   */
  enqueueMove(entry: BodyEntry, spanId: number, displacement: Vec3, rotation: Quat): void {
    if (this.physics.moveCharacter === undefined) {
      if (entry.unsupportedReported) return;
      entry.unsupportedReported = true;
      this.reportAt(
        "E8105",
        spanId,
        `The command move_character on '${entry.name}' was dropped: the physics adapter '${this.options.backend.name}' cannot move characters.`,
        ["the adapter must implement moveCharacter; the body keeps the pose its other commands give it"],
      );
      return;
    }
    // A program that passes back the rotation it read (`self.rotation`) means "keep it". What it read is one tick old by
    // the time the move is resolved, so a platform that turned in between would be undone and the character would turn
    // at half the platform's rate (decision 0218): the move keeps the rotation the body has when it is resolved.
    const keepRotation = entry.rotationRead !== undefined && sameRotation(entry.rotationRead, rotation);
    this.enqueue(entry, spanId, "move_character", { category: "characterMove", target: entry.ref, displacement, rotation, keepRotation }, [displacement, rotation]);
  }

  // ---- the tick ----

  /**
   * Step 2 of the tick: the queued commands, once, by category and issue order (`./commands.ts`). The character
   * moves of one body are one move: displacements summed, the last rotation, resolved where the first of them
   * stands in the order (after every kinematic target, which a move of the same body replaces).
   */
  applyCommands(): void {
    const batch = this.queue.take();
    const moves = new Map<BodyEntry, PendingMove>();
    for (const command of batch) {
      if (command.category !== "characterMove") continue;
      const entry = this.liveEntry(command.target);
      if (entry === undefined) continue;
      const pending = moves.get(entry);
      if (pending === undefined) {
        moves.set(entry, { displacement: command.displacement, rotation: command.rotation, keepRotation: command.keepRotation, applied: false });
      } else {
        const { displacement: sum } = pending;
        pending.displacement = frozenVec3(sum.x + command.displacement.x, sum.y + command.displacement.y, sum.z + command.displacement.z);
        pending.rotation = command.rotation;
        pending.keepRotation = command.keepRotation;
      }
    }
    for (const command of batch) {
      // The entity may have been destroyed (and its body removed at a flush) since the command was issued: it was
      // valid then, so it is dropped here without a diagnostic. A reused slot has a new generation.
      const entry = this.liveEntry(command.target);
      if (entry === undefined || entry.handle === undefined) continue;
      const handle = entry.handle;
      switch (command.category) {
        case "teleport":
          // The velocities a handler reads stay those of the last completed tick until the step has run.
          this.physics.teleport(handle, command.pose, command.keepVelocity);
          break;
        case "linearVelocity":
          this.physics.setLinearVelocity(handle, command.vector);
          break;
        case "kinematicTarget":
          // A character move of the same body in the same tick replaces it.
          if (!moves.has(entry)) this.physics.setKinematicTarget(handle, command.pose);
          break;
        case "characterMove": {
          const move = moves.get(entry);
          if (move !== undefined && !move.applied) {
            move.applied = true;
            this.resolveMove(entry, handle, move);
          }
          break;
        }
        case "impulse":
          this.physics.applyImpulse(handle, command.vector);
          break;
        case "force":
          this.physics.addForceForNextStep(handle, command.vector);
          break;
      }
    }
  }

  /** The entry of a body that still exists and is in the simulation, for a command aimed at `target`. */
  private liveEntry(target: EntityRef): BodyEntry | undefined {
    const entry = this.bodies[target.slot];
    return entry === undefined || entry.handle === undefined || entry.ref.gen !== target.gen ? undefined : entry;
  }

  /**
   * One character move (decision 0214, "Resolution of one move"): the adapter resolves the displacement from the
   * pose the body has now (after a teleport of this tick), and the resolved pose becomes the kinematic target the
   * step reaches. `grounded` and `ground_normal` are recorded for the reads.
   */
  private resolveMove(entry: BodyEntry, handle: BodyHandle, move: PendingMove): void {
    const settings = entry.character ?? CHARACTER_DEFAULTS;
    const from = this.physics.readPose(handle);
    const result = this.physics.moveCharacter?.(handle, move.displacement, {
      offset: settings.skin,
      maxSlope: settings.maxSlope,
      snapToGround: settings.snapToGround,
      stepHeight: settings.stepHeight,
      stepMinWidth: settings.stepMinWidth,
      carry: settings.carry,
      rotation: move.keepRotation ? from.rotation : move.rotation,
    });
    if (result === undefined) return;
    const position = frozenVec3(from.position.x + result.displacement.x, from.position.y + result.displacement.y, from.position.z + result.displacement.z);
    const rotation = result.rotation;
    if (!isFiniteVec3(position) || !isFiniteQuat(rotation)) {
      this.freeze(entry, { position, rotation });
      return;
    }
    this.physics.setKinematicTarget(handle, { position, rotation });
    entry.grounded = result.grounded;
    const normal = result.grounded ? result.ground?.normal : undefined;
    entry.groundNormal = normal === undefined || !isFiniteVec3(normal) ? ZERO : frozenVec3(normal.x, normal.y, normal.z);
  }

  /** Steps 4 to 6 of the tick: `step`, the write-back and the velocities, then the collision events. */
  stepAndDeliver(): void {
    this.physics.step();
    this.stepCount += 1;
    this.writeBack();
    this.deliverCollisions();
  }

  /** Step 5: the poses of dynamic and kinematic bodies go into the entity records (world = local for root bodies). */
  private writeBack(): void {
    const { world } = this.options;
    const setter = world.ctx as TransformSetter;
    for (const entry of this.bodies) {
      if (entry === undefined || entry.kind === "static" || entry.handle === undefined) continue;
      const pose = this.physics.readPose(entry.handle);
      if (!isFiniteVec3(pose.position) || !isFiniteQuat(pose.rotation)) {
        this.freeze(entry, pose);
        continue;
      }
      const record = world.recordAt(entry.ref.slot);
      if (record === undefined) continue;
      setter.setTransform(record, "position", frozenVec3(pose.position.x, pose.position.y, pose.position.z));
      const rotation = Object.freeze({ x: f32(pose.rotation.x), y: f32(pose.rotation.y), z: f32(pose.rotation.z), w: f32(pose.rotation.w) });
      setter.setTransform(record, "rotation", rotation);
      entry.rotationRead = rotation;
      const velocities = this.physics.readVelocities(entry.handle);
      entry.linear = frozenVec3(velocities.linear.x, velocities.linear.y, velocities.linear.z);
      entry.angular = frozenVec3(velocities.angular.x, velocities.angular.y, velocities.angular.z);
    }
  }

  /**
   * `E8103`: the solver produced a pose that is not finite. The body is taken out of the simulation (a NaN body
   * would poison its contacts), the entity keeps its last finite pose, reads zero velocities and ignores
   * commands, and the loop goes on. Reported once per body.
   */
  private freeze(entry: BodyEntry, pose: Pose): void {
    if (entry.handle === undefined) return;
    this.physics.removeBody(entry.handle);
    entry.handle = undefined;
    entry.linear = ZERO;
    entry.angular = ZERO;
    entry.grounded = false;
    entry.groundNormal = ZERO;
    this.frozenCount += 1;
    this.report(
      "E8103",
      entry.ref.slot,
      `The solver produced a pose that is not finite for '${entry.name}': position ${describeValue(pose.position)}, rotation ${describeValue(pose.rotation)}. The body is frozen: the entity keeps its last pose and no longer takes part in the simulation.`,
    );
  }

  /** Step 6: drain, sort (`spec/physics.md` section 6) and deliver. */
  private deliverCollisions(): void {
    const pairs: CollisionPair[] = [];
    this.physics.drainCollisions((a, b, started) => {
      pairs.push(collisionPair(a, b, started));
    });
    if (pairs.length === 0) return;
    const { world } = this.options;
    const live = (ref: EntityRef | undefined): ref is EntityRef => {
      if (ref === undefined) return false;
      const status = world.dynamic.status(ref);
      return status === "static" || status === "alive";
    };
    // Iterating the sorted snapshot is safe: a handler can only queue `destroy`, the bodies stay until the flush.
    for (const pair of sortCollisions(pairs)) {
      const kind: CollisionEventName = pair.started ? "collision_enter" : "collision_exit";
      const low = world.recordAt(pair.low)?.ref;
      const high = world.recordAt(pair.high)?.ref;
      // The lower slot's handler first; before each delivery both entities must still be alive, so an entity a
      // handler destroyed (itself or its partner) receives nothing more and is nothing more to others.
      if (live(low) && live(high)) this.options.deliver(kind, pair.low, high);
      if (live(low) && live(high)) this.options.deliver(kind, pair.high, low);
    }
  }

  // ---- introspection and lifetime ----

  inspect(): readonly BodyInspection[] {
    if (this.disposed) return [];
    return this.bodies.flatMap(entry => {
      if (entry === undefined) return [];
      const record = this.options.world.recordAt(entry.ref.slot);
      if (record === undefined || record.ref.gen !== entry.ref.gen || this.options.world.dynamic.status(entry.ref) === "pending-removal") return [];
      const pose = entry.handle === undefined ? record : this.physics.readPose(entry.handle);
      const contacts = entry.handle === undefined ? undefined : this.physics.contacts?.(entry.handle);
      return [{ slot: entry.ref.slot, generation: entry.ref.gen, kind: entry.kind, active: entry.handle !== undefined,
        collider: structuredClone(entry.collider), position: { ...pose.position }, rotation: { ...pose.rotation },
        ...(contacts === undefined ? {} : { contacts: structuredClone(contacts) }) }];
    });
  }

  /**
   * The spatial queries of the loaded adapter for the host API (decision 0217), in terms of body references. They
   * see the world as of the last completed tick (nothing here steps or moves a body); the host layer turns user ids
   * (entity slots) into entity IDs. @internal
   */
  get queries(): PhysicsQueries {
    const world = this.physics;
    return {
      adapter: this.options.backend.name,
      supports: (method) => !this.disposed && typeof world[method] === "function",
      handleOf: (slot, generation) => {
        const entry = this.bodies[slot];
        return entry === undefined || entry.ref.gen !== generation ? undefined : entry.handle;
      },
      castRay: (origin, direction, maxDistance, filter) => world.castRay?.(origin, direction, maxDistance, filter),
      castShape: (shape, pose, displacement, filter) => world.castShape?.(shape, pose, displacement, filter),
      contacts: (handle) => world.contacts?.(handle) ?? [],
      setCollisionGroups: (handle, memberships, filter) => {
        world.setCollisionGroups?.(handle, memberships, filter);
      },
    };
  }

  /** Bodies and colliders in the backend's world (both 0 after {@link dispose}). */
  counts(): { readonly bodies: number; readonly colliders: number } {
    return this.disposed ? { bodies: 0, colliders: 0 } : this.physics.counts();
  }

  /** Steps taken so far. */
  get steps(): number {
    return this.stepCount;
  }

  /** Bodies taken out of the simulation by `E8103`. */
  get frozenBodies(): number {
    return this.frozenCount;
  }

  /** The commands waiting for the next tick. */
  get pendingCommands(): number {
    return this.queue.size;
  }

  /** Frees the world, every body and collider and the event queue (`spec/physics.md` section 4). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopListening();
    this.queue.clear();
    this.bodies.length = 0;
    this.physics.dispose();
  }

  // ---- diagnostics ----

  private phase(): MtekRuntimePhase {
    return this.options.world.phase;
  }

  /** A diagnostic located at the declaration of the entity in `slot`. */
  private report(code: "E8103" | "E8104", slot: number, message: string): void {
    const symbol = this.options.world.resolvedAt(slot)?.symbol;
    const span = symbol === undefined ? undefined : spanOfSymbol(this.options.manifest, symbol);
    this.options.report(
      makeRuntimeDiagnostic(code, {
        phase: code === "E8103" ? "runtime:tick" : this.phase(),
        message,
        source: span === undefined ? null : resolveSpan(this.options.manifest, span),
      }),
    );
  }

  /** A diagnostic located at the command or property of the program that caused it (`spanId` of `ctx.body`). */
  private reportAt(code: "E8101" | "E8104" | "E8105", spanId: number, message: string, notes: readonly string[]): void {
    this.options.report(makeRuntimeDiagnostic(code, { phase: this.phase(), message, notes, source: resolveSpan(this.options.manifest, spanId) }));
  }
}

/**
 * The value `ctx.body(target, spanId)` returns: the commands and readable velocities of `spec/physics.md` section 3.
 * A command validates its target and arguments and queues itself for the next tick; it never throws for a target
 * that is gone (`W8031`), has the wrong kind (`E8101`) or gets a value that is not finite (`E8104`).
 */
class BodyHandleImpl {
  constructor(
    private readonly system: PhysicsSystem,
    private readonly ref: EntityRef,
    private readonly span: number,
  ) {}

  applyImpulse(impulse: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "apply_impulse");
    if (entry === undefined) return;
    const vector = this.vec3(impulse, "apply_impulse");
    this.system.enqueue(entry, this.span, "apply_impulse", { category: "impulse", target: entry.ref, vector }, [vector]);
  }

  applyForce(force: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "apply_force");
    if (entry === undefined) return;
    const vector = this.vec3(force, "apply_force");
    this.system.enqueue(entry, this.span, "apply_force", { category: "force", target: entry.ref, vector }, [vector]);
  }

  setLinearVelocity(velocity: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "set_linear_velocity");
    if (entry === undefined) return;
    const vector = this.vec3(velocity, "set_linear_velocity");
    this.system.enqueue(entry, this.span, "set_linear_velocity", { category: "linearVelocity", target: entry.ref, vector }, [vector]);
  }

  setKinematicTarget(position: unknown, rotation: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "set_kinematic_target");
    if (entry === undefined) return;
    const pose = this.pose(position, rotation, "set_kinematic_target");
    this.system.enqueue(entry, this.span, "set_kinematic_target", { category: "kinematicTarget", target: entry.ref, pose }, [pose.position, pose.rotation]);
  }

  moveCharacter(displacement: unknown, rotation: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "move_character");
    if (entry === undefined) return;
    const vector = this.vec3(displacement, "move_character");
    if (!isQuat(rotation)) throw new RuntimeInternalError(`ctx.body(..) move_character got ${describeValue(rotation)} for the rotation; expected a quat.`);
    this.system.enqueueMove(entry, this.span, vector, rotation);
  }

  teleport(position: unknown, rotation: unknown, keepVelocity: unknown): void {
    const entry = this.system.entryFor(this.ref, this.span, "teleport");
    if (entry === undefined) return;
    if (typeof keepVelocity !== "boolean") throw new RuntimeInternalError(`ctx.body(..).teleport got ${describeValue(keepVelocity)} for keep_velocity; expected a bool.`);
    const pose = this.pose(position, rotation, "teleport");
    this.system.enqueue(entry, this.span, "teleport", { category: "teleport", target: entry.ref, pose, keepVelocity }, [pose.position, pose.rotation]);
  }

  get linearVelocity(): Vec3 {
    return this.system.entryForRead(this.ref, this.span, "linear_velocity")?.linear ?? ZERO;
  }

  get angularVelocity(): Vec3 {
    return this.system.entryForRead(this.ref, this.span, "angular_velocity")?.angular ?? ZERO;
  }

  get grounded(): boolean {
    return this.system.entryForRead(this.ref, this.span, "grounded")?.grounded ?? false;
  }

  get groundNormal(): Vec3 {
    return this.system.entryForRead(this.ref, this.span, "ground_normal")?.groundNormal ?? ZERO;
  }

  private vec3(value: unknown, command: string): Vec3 {
    if (!isVec3(value)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(value)}; expected a vec3.`);
    return value;
  }

  private pose(position: unknown, rotation: unknown, command: string): Pose {
    if (!isVec3(position)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(position)} for the position; expected a vec3.`);
    if (!isQuat(rotation)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(rotation)} for the rotation; expected a quat.`);
    return { position, rotation };
  }
}
