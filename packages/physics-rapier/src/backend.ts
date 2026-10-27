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
  PhysicsQueryFilter,ShapeHit,CharacterMoveOptions,CharacterMovement,PhysicsContact,
} from "../../runtime-web/src/physics/types.js";

/**
 * Reported as `PhysicsBackend.name`. A test compares it with the version npm installed, so the
 * pinned dependency and this string cannot drift apart.
 */
export const BACKEND_NAME = "rapier3d-compat@0.21.0";

/**
 * The allowed linear error (m) of a world that has continuous bodies, decision 0216. Rapier 0.21 defaults to 5 mm and
 * its CCD uses that value twice: a swept body is stopped 5 mm INSIDE the obstacle, and a pair whose surfaces are less
 * than prediction distance + 5 mm apart is left to the discrete contact test, which only sees the pair below the
 * prediction distance (0.02 m). A box that starts a step in that 5 mm band before a thin obstacle is therefore seen by
 * neither (measured with the default: 5 % of the start phases of a cube against a plate at 6 m/s, 1.5 % at 20 m/s,
 * with CCD on), and a 240 m/s ball that the sweep stops 5 mm inside a 1 cm heavy plate is carried through by the
 * contact step that follows. Both shrink with the value; 0.1 mm leaves a 0.1 mm band (the measured residual is the
 * fine scan of `spec/physics.md` section 7.1). The setting has no measurable effect on resting contacts (a stack of
 * four crates and a resting ball settle to the same poses, `ccd-matrix.test.ts`) and is applied only when a
 * continuous body is created, so a world without continuous collision keeps Rapier's defaults.
 */
const CCD_ALLOWED_LINEAR_ERROR = 0.0001;

/**
 * How far past its own smallest half-extent (m) a body moves in one step before it gets the sweep flag (decision
 * 0216). Two requirements meet in this one number, for obstacles that move up to about 1 m/s (1.7 cm per step):
 *  - a body without the flag must not be able to skip an obstacle: the contact window of a thin plate is
 *    `plate half-thickness + own half-extent + prediction distance (2 cm)` and the obstacle's own advance eats into it,
 *    so the margin must stay under about 2.5 cm minus that advance;
 *  - an obstacle with the flag is never swept against (see `updateContinuousFlags`), so a 1 cm plate (half-extent
 *    5 mm) that moves 1 m/s must stay under `5 mm + margin`: the margin must exceed about 1.2 cm.
 * Measured on a dense speed scan (1.5 to 14 m/s in steps of 0.125, then to 260 m/s) against obstacles at rest and
 * moving 0.5 and 1 m/s: 11.5 mm lets 1 m/s dynamic plates through at shot speeds of 3.75 to 14 m/s, 13 mm lets 1 m/s
 * walls through at 3.75 m/s, and 12 mm and 12.5 mm leave only the speeds above 250 m/s in the table of
 * `spec/physics.md` section 7.1. The window is narrow; `ccd-matrix.test.ts` asserts the scan.
 */
const CCD_FLAG_MARGIN = 0.0125;

/**
 * What the adapter remembers about a body that asked for continuous collision (decision 0216): the two lengths the
 * engine's own "moves fast" test uses, taken from the body's single collider.
 */
interface ContinuousShape {
  /** The smallest half-extent (box) or the radius (ball, capsule): Rapier's CCD thickness. */
  readonly thickness: number;
  /** The farthest point of the shape from its centre: a rotation of `w` rad/s moves it `w * reach` m/s. */
  readonly reach: number;
}

/** What the adapter remembers about one body. */
interface BodyRecord {
  readonly body: RAPIER.RigidBody;
  readonly colliderHandle: number;
  /** Set only for a dynamic body created with `continuousCollision`. */
  readonly continuous?: ContinuousShape;
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
  /** The dynamic bodies that asked for continuous collision (decision 0216): their sweep flag is set before each step. */
  private readonly continuous = new Set<number>();
  private readonly dt: number;
  private disposed = false;

  constructor(gravity: Vec3, fixedStep: number) {
    requireVec3(gravity, "gravity");
    requirePositive(fixedStep, "the fixed step");
    this.world = new RAPIER.World(gravity);
    this.world.timestep = fixedStep;
    this.dt = fixedStep;
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
        // Decision 0216: the sweep flag is not fixed at creation. Rapier skips a pair in which the obstacle has the flag
        // too (a flagged obstacle that is not itself moving fast is never swept against), so `step` sets the flag only
        // on the bodies that move fast enough to need it.
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
      case "capsule":
        colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight(collider.shape), collider.shape.radius);
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
    const continuous = desc.kind === "dynamic" && desc.continuousCollision === true ? continuousShape(collider.shape) : undefined;
    this.bodies.set(body.handle, continuous === undefined ? { body, colliderHandle: created.handle } : { body, colliderHandle: created.handle, continuous });
    if (continuous !== undefined) {
      this.continuous.add(body.handle);
      // Decision 0216: a world that uses continuous collision gets the small allowed linear error (see the constant).
      this.world.integrationParameters.normalizedAllowedLinearError = CCD_ALLOWED_LINEAR_ERROR;
    }
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
    this.continuous.delete(h);
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

  /**
   * Decision 0216. Rapier sweeps only a body whose CCD flag is set, and it skips a pair in which the obstacle has the
   * flag too (measured: a ball with the flag flies through a plate with the flag that a flag-free plate stops, so
   * enabling the flag on every dynamic body, as the host option used to, left every dynamic-against-dynamic pair
   * unswept). The flag is therefore set only on a body that can skip something: one that moves more than its own
   * smallest half-extent plus `CCD_FLAG_MARGIN` in one step. The test is longer than Rapier's own "moves fast" test
   * (a tenth of the thickness), so a flagged body is always one the engine sweeps.
   */
  private updateContinuousFlags(): void {
    for (const h of this.continuous) {
      const record = this.bodies.get(h);
      const shape = record?.continuous;
      if (record === undefined || shape === undefined) continue;
      const body = record.body;
      let fast = false;
      if (!body.isSleeping()) {
        const v = body.linvel();
        const w = body.angvel();
        const moved = (Math.hypot(v.x, v.y, v.z) + Math.hypot(w.x, w.y, w.z) * shape.reach) * this.dt;
        fast = moved > shape.thickness + CCD_FLAG_MARGIN;
      }
      if (body.isCcdEnabled() !== fast) body.enableCcd(fast);
    }
  }

  step(): void {
    this.alive();
    this.updateContinuousFlags();
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

  private refreshQueries():void {this.world.propagateModifiedBodyPositionsToColliders();}
  setCollisionGroups(h:BodyHandle,memberships:number,filter:number):void {
    this.alive();for(const value of [memberships,filter])if(!Number.isInteger(value)||value<0||value>0xffff)throw new RangeError("physics: collision memberships and filters must be 16-bit masks");
    this.world.getCollider(this.record(h).colliderHandle).setCollisionGroups(((memberships<<16)|filter)>>>0);
  }
  private queryFlags(filter:PhysicsQueryFilter):RAPIER.QueryFilterFlags|undefined {
    if(filter.groups!==undefined&&(!Number.isInteger(filter.groups)||filter.groups<0||filter.groups>0xffffffff))throw new RangeError("physics: collision groups must be an unsigned 32-bit mask");
    return filter.includeSensors===true?undefined:RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  }
  castShape(shape:ColliderDesc["shape"],pose:Pose,displacement:Vec3,filter:PhysicsQueryFilter={}):ShapeHit|undefined {
    this.alive();requirePose(pose,"query pose");requireVec3(displacement,"query displacement");
    let query:RAPIER.Shape;
    if(shape.kind==="sphere"){requirePositive(shape.radius,"query radius");query=new RAPIER.Ball(shape.radius);}
    else if(shape.kind==="capsule")query=new RAPIER.Capsule(capsuleHalfHeight(shape),shape.radius);
    else {requirePositive(shape.size.x,"query size x");requirePositive(shape.size.y,"query size y");requirePositive(shape.size.z,"query size z");query=new RAPIER.Cuboid(shape.size.x/2,shape.size.y/2,shape.size.z/2);}
    const flags=this.queryFlags(filter),exclude=filter.exclude===undefined?undefined:this.record(filter.exclude).body;
    this.refreshQueries();
    const hit=this.world.castShape(pose.position,pose.rotation,displacement,query,0,1,true,flags,filter.groups,undefined,exclude);
    if(hit===null)return undefined;
    return {userId:this.userIds.get(hit.collider.handle)!,fraction:hit.time_of_impact,normal:toVec3(hit.normal1),point:toVec3(hit.witness1)};
  }
  moveCharacter(h:BodyHandle,displacement:Vec3,options:CharacterMoveOptions={}):CharacterMovement {
    this.alive();requireVec3(displacement,"character displacement");const record=this.record(h);
    if(!record.body.isKinematic())throw new RangeError("physics: character movement requires a kinematic body");
    const offset=options.offset??.01,slope=options.maxSlope??Math.PI/4,snap=options.snapToGround??0,step=options.stepHeight??0,width=options.stepMinWidth??.1;
    requirePositive(offset,"character offset");requireNonNegative(snap,"ground snap");requireNonNegative(step,"step height");requirePositive(width,"step width");
    if(!Number.isFinite(slope)||slope<0||slope>Math.PI/2)throw new RangeError("physics: slope angle must be in [0, pi/2]");
    const flags=this.queryFlags(options),exclude=options.exclude===undefined?undefined:this.record(options.exclude).colliderHandle;
    this.refreshQueries();const controller=this.world.createCharacterController(offset);
    try {
      controller.setMaxSlopeClimbAngle(slope);controller.setMinSlopeSlideAngle(slope);
      if(snap>0)controller.enableSnapToGround(snap);if(step>0)controller.enableAutostep(step,width,false);
      controller.computeColliderMovement(this.world.getCollider(record.colliderHandle),displacement,flags,options.groups,collider=>collider.handle!==exclude);
      const contacts:ShapeHit[]=[];
      for(let i=0;i<controller.numComputedCollisions();i++) {const hit=controller.computedCollision(i);if(hit?.collider===null||hit===null)continue;contacts.push({userId:this.userIds.get(hit.collider.handle)!,fraction:hit.toi,normal:toVec3(hit.normal1),point:toVec3(hit.witness1)});}
      // Support, carry and rotation (decision 0214 steps 1-2) are decision 0215 work: no carry yet.
      return {displacement:toVec3(controller.computedMovement()),grounded:controller.computedGrounded(),contacts,carried:{x:0,y:0,z:0},carriedYaw:0,rotation:options.rotation??toQuat(record.body.rotation())};
    }finally{this.world.removeCharacterController(controller);}
  }
  contacts(h:BodyHandle):readonly PhysicsContact[] {
    this.alive();const collider=this.world.getCollider(this.record(h).colliderHandle),result:PhysicsContact[]=[];
    this.world.contactPairsWith(collider,other=>this.world.contactPair(collider,other,(manifold,flipped)=>{
      const n=manifold.normal(),normal={x:n.x*(flipped?-1:1),y:n.y*(flipped?-1:1),z:n.z*(flipped?-1:1)};
      for(let i=0;i<manifold.numSolverContacts();i++){const point=manifold.solverContactPoint(i);if(point!==null)result.push({userId:this.userIds.get(other.handle)!,normal,point:toVec3(point),distance:manifold.solverContactDist(i)});}
    }));return result;
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
    this.continuous.clear();
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

/** The lengths of Rapier's "moves fast" test for a collider shape (decision 0216). */
function continuousShape(shape: ColliderDesc["shape"]): ContinuousShape {
  switch (shape.kind) {
    case "sphere":
      return { thickness: shape.radius, reach: shape.radius };
    case "capsule":
      return { thickness: shape.radius, reach: shape.height / 2 };
    case "box": {
      const hx = shape.size.x / 2;
      const hy = shape.size.y / 2;
      const hz = shape.size.z / 2;
      return { thickness: Math.min(hx, hy, hz), reach: Math.hypot(hx, hy, hz) };
    }
  }
}

/** Rapier's capsule half-height: the cylindrical half-segment of a capsule whose full height includes both caps. */
function capsuleHalfHeight(shape:{readonly radius:number;readonly height:number}):number {
  requirePositive(shape.radius,"the capsule radius");requirePositive(shape.height,"the capsule height");
  if(!(shape.height>2*shape.radius))throw new RangeError("physics: a capsule height must exceed twice its radius");
  return shape.height/2-shape.radius;
}

/** The Rapier backend. Construct it only after `RAPIER.init()` resolved (see `loadPhysics`). */
export const rapierBackend: PhysicsBackend = {
  name: BACKEND_NAME,
  createWorld: (gravity, fixedStep) => new RapierWorld(gravity, fixedStep),
};
