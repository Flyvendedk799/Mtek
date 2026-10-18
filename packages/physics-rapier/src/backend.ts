/**
 * The Rapier implementation of the physics adapter contract (`spec/physics.md` section 5; the
 * mapping rows of section 5.1 are numbered in the comments below). Decision 0063.
 *
 * Nothing here knows about scenes, entities or the scheduler: the runtime (M5-05) owns command
 * ordering, pose write-back and event ordering. The adapter is a thin, faithful translation of the
 * backend-neutral calls into `@dimforge/rapier3d-compat`, plus the two pieces of bookkeeping the
 * mapping table asks for: the collider-handle to user-id map, and the forces that must last for
 * exactly one step.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type {
  BodyDesc,
  BodyHandle,
  ColliderDesc,
  PhysicsBackend,
  PhysicsWorld,
  Pose,
  Quat,
  Vec3,
} from "../../runtime-web/src/physics/types.js";

/**
 * Reported as `PhysicsBackend.name`. A test compares it with the version npm installed, so the
 * pinned dependency and this string cannot drift apart.
 */
export const BACKEND_NAME = "rapier3d-compat@0.21.0";

/** What the adapter remembers about one body. */
interface BodyRecord {
  readonly body: RAPIER.RigidBody;
  readonly colliderHandle: number;
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`physics: ${what} must be finite, got ${value}`);
}

function requireNonNegative(value: number, what: string): void {
  if (!(Number.isFinite(value) && value >= 0)) throw new RangeError(`physics: ${what} must be non-negative and finite, got ${value}`);
}

function requirePositive(value: number, what: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`physics: ${what} must be positive and finite, got ${value}`);
}

function requireVec3(v: Vec3, what: string): void {
  requireFinite(v.x, `${what}.x`);
  requireFinite(v.y, `${what}.y`);
  requireFinite(v.z, `${what}.z`);
}

function requirePose(pose: Pose, what: string): void {
  requireVec3(pose.position, `${what}.position`);
  const q = pose.rotation;
  requireFinite(q.x, `${what}.rotation.x`);
  requireFinite(q.y, `${what}.rotation.y`);
  requireFinite(q.z, `${what}.rotation.z`);
  requireFinite(q.w, `${what}.rotation.w`);
}

/** A fresh plain vector, so callers never see (or keep) an object owned by the WebAssembly side. */
function toVec3(v: RAPIER.Vector): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function toQuat(q: RAPIER.Rotation): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

class RapierWorld implements PhysicsWorld {
  private readonly world: RAPIER.World;
  /** One queue per world; `true` drains it automatically before each step (section 5.1, "events"). */
  private readonly events = new RAPIER.EventQueue(true);
  /** Section 5.1, "collider handle -> entity": the user id of every live collider. */
  private readonly userIds = new Map<number, number>();
  private readonly bodies = new Map<number, BodyRecord>();
  /** Bodies that got `addForceForNextStep` since the last step: their forces are cleared after it. */
  private readonly forced = new Set<number>();
  private disposed = false;

  constructor(gravity: Vec3, fixedStep: number) {
    requireVec3(gravity, "gravity");
    requirePositive(fixedStep, "the fixed step");
    this.world = new RAPIER.World(gravity);
    this.world.timestep = fixedStep;
  }

  addBody(desc: BodyDesc, collider: ColliderDesc, pose: Pose, userId: number): BodyHandle {
    this.alive();
    requirePose(pose, "the pose");

    // Section 5.1, rows "Static", "Dynamic" and "Kinematic".
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (desc.kind) {
      case "static":
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
        break;
      case "kinematic":
        bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        break;
      case "dynamic":
        requirePositive(desc.mass, "a dynamic body's mass");
        requireNonNegative(desc.linearDamping, "linearDamping");
        requireNonNegative(desc.angularDamping, "angularDamping");
        bodyDesc = RAPIER.RigidBodyDesc.dynamic().setLinearDamping(desc.linearDamping).setAngularDamping(desc.angularDamping);
        break;
    }
    bodyDesc.setTranslation(pose.position.x, pose.position.y, pose.position.z).setRotation(pose.rotation);

    // Section 5.1, rows "BoxCollider" (full extents become half-extents) and "SphereCollider".
    let colliderDesc: RAPIER.ColliderDesc;
    switch (collider.shape.kind) {
      case "box": {
        const size = collider.shape.size;
        requirePositive(size.x, "the box size x");
        requirePositive(size.y, "the box size y");
        requirePositive(size.z, "the box size z");
        colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
        break;
      }
      case "sphere":
        requirePositive(collider.shape.radius, "the sphere radius");
        colliderDesc = RAPIER.ColliderDesc.ball(collider.shape.radius);
        break;
    }

    // Row "sensor, friction, restitution".
    requireNonNegative(collider.friction, "friction");
    requireNonNegative(collider.restitution, "restitution");
    colliderDesc.setSensor(collider.sensor).setFriction(collider.friction).setRestitution(collider.restitution);
    // Row "Dynamic": the mass goes on the collider, and Rapier derives a consistent inertia from the shape.
    if (desc.kind === "dynamic") colliderDesc.setMass(desc.mass);
    // Row "events": both flags on every collider. Without ALL, kinematic-fixed and sensor-fixed pairs are
    // never even tested, so a kinematic body entering a fixed sensor would raise nothing.
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);

    const body = this.world.createRigidBody(bodyDesc);
    const created = this.world.createCollider(colliderDesc, body);
    this.userIds.set(created.handle, userId);
    this.bodies.set(body.handle, { body, colliderHandle: created.handle });
    return body.handle as BodyHandle;
  }

  removeBody(h: BodyHandle): void {
    this.alive();
    const record = this.record(h);
    // Removing the body removes its collider. A "stopped" event the removal makes the engine raise at the next
    // step has an unmapped collider and is dropped by `drainCollisions`: events of removed entities are not
    // delivered (`spec/physics.md` section 6).
    this.world.removeRigidBody(record.body);
    this.userIds.delete(record.colliderHandle);
    this.bodies.delete(h);
    this.forced.delete(h);
  }

  applyImpulse(h: BodyHandle, v: Vec3): void {
    this.alive();
    requireVec3(v, "the impulse");
    this.record(h).body.applyImpulse(v, true);
  }

  addForceForNextStep(h: BodyHandle, v: Vec3): void {
    this.alive();
    requireVec3(v, "the force");
    // Row "force for next step": `addForce` accumulates in the body until it is reset, so it is cleared
    // after the next step (see `step`); several calls before that step add up.
    this.record(h).body.addForce(v, true);
    this.forced.add(h);
  }

  setLinearVelocity(h: BodyHandle, v: Vec3): void {
    this.alive();
    requireVec3(v, "the velocity");
    this.record(h).body.setLinvel(v, true);
  }

  setKinematicTarget(h: BodyHandle, pose: Pose): void {
    this.alive();
    requirePose(pose, "the target");
    const body = this.record(h).body;
    // Row "Kinematic": targets go through the position-based API, so the solver derives the velocity.
    body.setNextKinematicTranslation(pose.position);
    body.setNextKinematicRotation(pose.rotation);
  }

  teleport(h: BodyHandle, pose: Pose, keepVelocity: boolean): void {
    this.alive();
    requirePose(pose, "the pose");
    const body = this.record(h).body;
    // Row "teleport". For a position-based kinematic body `setTranslation` also updates the pose its next
    // step starts from, so the body does not sweep from the old pose to the new one.
    body.setTranslation(pose.position, true);
    body.setRotation(pose.rotation, true);
    if (!keepVelocity) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  step(): void {
    this.alive();
    this.world.step(this.events);
    // Row "force for next step": the forces added since the previous step have been integrated by this one.
    for (const h of this.forced) this.bodies.get(h)?.body.resetForces(true);
    this.forced.clear();
  }

  readPose(h: BodyHandle): Pose {
    this.alive();
    const body = this.record(h).body;
    return { position: toVec3(body.translation()), rotation: toQuat(body.rotation()) };
  }

  readVelocities(h: BodyHandle): { linear: Vec3; angular: Vec3 } {
    this.alive();
    const body = this.record(h).body;
    return { linear: toVec3(body.linvel()), angular: toVec3(body.angvel()) };
  }

  drainCollisions(sink: (a: number, b: number, started: boolean) => void): void {
    this.alive();
    this.events.drainCollisionEvents((first, second, started) => {
      const a = this.userIds.get(first);
      const b = this.userIds.get(second);
      // A collider removed since the step has no user id any more: the pair involves a removed entity.
      if (a !== undefined && b !== undefined) sink(a, b, started);
    });
  }

  counts(): { bodies: number; colliders: number } {
    if (this.disposed) return { bodies: 0, colliders: 0 };
    return { bodies: this.world.bodies.len(), colliders: this.world.colliders.len() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Frees the world with every body and collider in it, then the event queue (spec section 4).
    this.world.free();
    this.events.free();
    this.userIds.clear();
    this.bodies.clear();
    this.forced.clear();
  }

  private alive(): void {
    if (this.disposed) throw new Error("physics: the world was disposed");
  }

  private record(h: BodyHandle): BodyRecord {
    const record = this.bodies.get(h);
    if (record === undefined) throw new Error(`physics: unknown body handle ${h}`);
    return record;
  }
}

/** The Rapier backend. Construct it only after `RAPIER.init()` resolved (see `loadPhysics`). */
export const rapierBackend: PhysicsBackend = {
  name: BACKEND_NAME,
  createWorld: (gravity, fixedStep) => new RapierWorld(gravity, fixedStep),
};
