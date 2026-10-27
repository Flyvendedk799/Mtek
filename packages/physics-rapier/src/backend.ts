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
  PhysicsQueryFilter,ShapeHit,RayHit,CharacterMoveOptions,CharacterMovement,PhysicsContact,
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
 * contact step that follows. Both shrink with the value; 0.1 mm leaves a 0.1 mm band, which `CCD_CONTACT_SKIN`
 * covers (the fine scan of `spec/physics.md` section 7.1). The setting alone has no measurable effect on resting
 * contacts (the rest poses of a stack of crates were identical for every value tried) and is applied only when a
 * continuous body is created, so a world without continuous collision keeps Rapier's defaults.
 */
const CCD_ALLOWED_LINEAR_ERROR = 0.0001;

/**
 * The contact skin (m) of the collider of a continuous body, decision 0216: twice the allowed linear error. A contact
 * skin widens the range in which the discrete test sees a pair by the skin, so the band of `CCD_ALLOWED_LINEAR_ERROR`
 * that the sweep leaves to the discrete test is covered by it (measured with the allowed error alone: 3 of 9 000 cube
 * lanes against a static wall at 20.0 to 20.1 mm; with this skin on the shot or on the wall, none). Every skin keeps
 * resting surfaces this far apart: 0.2 mm between a continuous body and static geometry, 0.4 mm between two continuous
 * bodies (a stack of four crates stands 1.4 mm higher, `ccd-matrix.test.ts`). A skin of the size of the old 5 mm error
 * would close the band too but would keep every resting body 1 cm off the ground.
 */
const CCD_CONTACT_SKIN = 0.0002;

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
  /** The collider's shape, kept for the support cast of `moveCharacter` (no allocation per call). */
  readonly shape: RAPIER.Shape;
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

/** The twist angle of `q` about +Y, in (-pi, pi]: the swing-twist decomposition of decision 0214, resolution step 2. */
function yawOf(q: Quat): number {
  const sign = q.w < 0 ? -1 : 1;
  return 2 * Math.atan2(sign * q.y, sign * q.w);
}

function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function normQuat(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return n > 0 && Number.isFinite(n) ? { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n } : { x: 0, y: 0, z: 0, w: 1 };
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w (u x v) + 2 u x (u x v), u = (q.x, q.y, q.z)
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

class RapierWorld implements PhysicsWorld {
  private readonly world: RAPIER.World;
  /** One character controller per world, configured on every `moveCharacter` call (creating one per call is the cost this avoids). */
  private controller: RAPIER.KinematicCharacterController | undefined;
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
    let shape: RAPIER.Shape;
    switch (collider.shape.kind) {
      case "box": {
        const size = collider.shape.size;
        requirePositive(size.x, "the box size x");
        requirePositive(size.y, "the box size y");
        requirePositive(size.z, "the box size z");
        colliderDesc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
        shape = new RAPIER.Cuboid(size.x / 2, size.y / 2, size.z / 2);
        break;
      }
      case "sphere":
        requirePositive(collider.shape.radius, "the sphere radius");
        colliderDesc = RAPIER.ColliderDesc.ball(collider.shape.radius);
        shape = new RAPIER.Ball(collider.shape.radius);
        break;
      case "capsule": {
        const half = capsuleHalfHeight(collider.shape);
        colliderDesc = RAPIER.ColliderDesc.capsule(half, collider.shape.radius);
        shape = new RAPIER.Capsule(half, collider.shape.radius);
        break;
      }
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

    const continuous = desc.kind === "dynamic" && desc.continuousCollision === true ? continuousShape(collider.shape) : undefined;
    // Decision 0216: the contact skin of a continuous body (see the constant) closes the band the allowed error leaves.
    if (continuous !== undefined) colliderDesc.setContactSkin(CCD_CONTACT_SKIN);

    const body = this.world.createRigidBody(bodyDesc);
    const created = this.world.createCollider(colliderDesc, body);
    this.userIds.set(created.handle, userId);
    this.bodies.set(body.handle, continuous === undefined ? { body, colliderHandle: created.handle, shape } : { body, colliderHandle: created.handle, shape, continuous });
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
  castRay(origin:Vec3,direction:Vec3,maxDistance:number,filter:PhysicsQueryFilter={}):RayHit|undefined {
    this.alive();requireVec3(origin,"ray origin");requireVec3(direction,"ray direction");requireNonNegative(maxDistance,"ray distance");
    const length=Math.hypot(direction.x,direction.y,direction.z);
    if(!(length>0&&Number.isFinite(length)))throw new RangeError("physics: the ray direction must have a finite, non-zero length");
    const unit={x:direction.x/length,y:direction.y/length,z:direction.z/length};
    const flags=this.queryFlags(filter),exclude=filter.exclude===undefined?undefined:this.record(filter.exclude).body;
    this.refreshQueries();
    const hit=this.world.castRayAndGetNormal(new RAPIER.Ray(origin,unit),maxDistance,true,flags,filter.groups,undefined,exclude);
    if(hit===null)return undefined;
    const distance=hit.timeOfImpact;
    return {userId:this.userIds.get(hit.collider.handle)!,distance,normal:toVec3(hit.normal),point:{x:origin.x+unit.x*distance,y:origin.y+unit.y*distance,z:origin.z+unit.z*distance}};
  }
  moveCharacter(h:BodyHandle,displacement:Vec3,options:CharacterMoveOptions={}):CharacterMovement {
    this.alive();requireVec3(displacement,"character displacement");const record=this.record(h);
    if(!record.body.isKinematic())throw new RangeError("physics: character movement requires a kinematic body");
    const offset=options.offset??.01,slope=options.maxSlope??Math.PI/4,snap=options.snapToGround??0,step=options.stepHeight??0,width=options.stepMinWidth??.1;
    requirePositive(offset,"character offset");requireNonNegative(snap,"ground snap");requireNonNegative(step,"step height");requirePositive(width,"step width");
    if(!Number.isFinite(slope)||slope<0||slope>Math.PI/2)throw new RangeError("physics: slope angle must be in [0, pi/2]");
    if(options.rotation!==undefined){const q=options.rotation;requirePose({position:{x:0,y:0,z:0},rotation:q},"character rotation");if(!(Math.hypot(q.x,q.y,q.z,q.w)>0))throw new RangeError("physics: character rotation must not have zero length");}
    const flags=this.queryFlags(options),excludeCollider=options.exclude===undefined?undefined:this.record(options.exclude).colliderHandle;
    this.refreshQueries();
    const body=record.body,position=body.translation(),current=toQuat(body.rotation());

    // Decision 0214, resolution step 1: the support is the first thing a downward cast of the character's own shape hits
    // within `offset + max(snap, 0.05)`, if its normal is within `maxSlope` of +Y. Sensors never support.
    const castLength=offset+Math.max(snap,.05);
    const supportHit=this.world.castShape(position,current,{x:0,y:-castLength,z:0},record.shape,0,1,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,options.groups,undefined,body,collider=>collider.handle!==excludeCollider);
    let ground:{userId:number;normal:Vec3}|undefined,supportBody:RAPIER.RigidBody|null=null;
    if(supportHit!==null){
      const n=toVec3(supportHit.normal1),length=Math.hypot(n.x,n.y,n.z);
      if(length>0&&n.y/length>=Math.cos(slope)-1e-6){ground={userId:this.userIds.get(supportHit.collider.handle)!,normal:{x:n.x/length,y:n.y/length,z:n.z/length}};supportBody=supportHit.collider.parent();}
    }

    // Step 2: carry by a kinematic support. The character is treated as a point attached to the support, which moves
    // from its current pose to its pending one; the yaw part of the rotation change turns the requested rotation.
    let carried:Vec3={x:0,y:0,z:0},carriedYaw=0,rotation=options.rotation??current;
    if(options.carry===true&&supportBody!==null&&supportBody.isKinematic()){
      const from=supportBody.translation(),to=supportBody.nextTranslation(),delta=normQuat(mulQuat(toQuat(supportBody.nextRotation()),conjugate(toQuat(supportBody.rotation()))));
      const arm=rotateVec(delta,{x:position.x-from.x,y:position.y-from.y,z:position.z-from.z});
      carried={x:to.x+arm.x-position.x,y:to.y+arm.y-position.y,z:to.z+arm.z-position.z};
      carriedYaw=yawOf(delta);
      rotation=normQuat(mulQuat(yawQuat(carriedYaw),rotation));
    }

    // Step 3: the controller resolves `displacement + carry`: slide on, autostep without dynamic bodies, slope climb and slide angle = `maxSlope`.
    // A kinematic support is left out of the sweep and resolved in step 3c: Rapier cancels the contact nudge against kinematic
    // bodies (a character resting within `offset` of one cannot slide along it: 20 time-of-impact-0 hits, no motion), adds the
    // body's velocity of the previous step to the motion (a second carry), and sees it at its stale pose.
    const supportCollider=supportBody!==null&&supportBody.isKinematic()&&supportHit!==null?supportHit.collider.handle:undefined;
    const controller=this.controller??=this.world.createCharacterController(offset);
    controller.setOffset(offset);controller.setSlideEnabled(true);controller.setMaxSlopeClimbAngle(slope);controller.setMinSlopeSlideAngle(slope);
    if(snap>0&&supportCollider===undefined)controller.enableSnapToGround(snap);else controller.disableSnapToGround();
    if(step>0)controller.enableAutostep(step,width,false);else controller.disableAutostep();
    controller.computeColliderMovement(this.world.getCollider(record.colliderHandle),{x:displacement.x+carried.x,y:displacement.y+carried.y,z:displacement.z+carried.z},flags,options.groups,collider=>collider.handle!==excludeCollider&&collider.handle!==supportCollider);
    const contacts:ShapeHit[]=[];
    for(let i=0;i<controller.numComputedCollisions();i++) {const hit=controller.computedCollision(i);if(hit===null||hit.collider===null)continue;contacts.push({userId:this.userIds.get(hit.collider.handle)!,fraction:hit.toi,normal:toVec3(hit.normal1),point:toVec3(hit.witness1)});}
    const moved=controller.computedMovement();let resolved:{x:number;y:number;z:number}={x:moved.x,y:moved.y,z:moved.z},grounded=controller.computedGrounded();

    // Step 3b: stair assist. Rapier's autostep has two measured failure modes (decision 0215): its upward cast starts exactly
    // `offset` from the wall the character rests against, so float noise alone decides whether a flight can be climbed, and it
    // advances a character only by what is left of this tick's displacement, which cannot put a round shape (a capsule or a
    // sphere, whose lowest point is its centre) over the edge. When the controller made (almost) no progress against a wall
    // while stepping is enabled and the character is supported, the adapter performs the same step itself: lift by
    // `stepHeight`, advance far enough to stand on the step, land within `offset` of it.
    if(step>0&&(grounded||ground!==undefined)){
      const want={x:displacement.x+carried.x,y:0,z:displacement.z+carried.z},wantLength=Math.hypot(want.x,want.z);
      if(wantLength>1e-6){
        const dir={x:want.x/wantLength,y:0,z:want.z/wantLength},progress=moved.x*dir.x+moved.z*dir.z;
        const wall=contacts.some(c=>c.normal.y<Math.cos(slope)&&c.normal.y>-.7&&c.normal.x*dir.x+c.normal.z*dir.z<-.1);
        if(wall&&progress<.25*wantLength){
          const hop=this.stairAssist(record,body,{x:position.x+moved.x,y:position.y+moved.y,z:position.z+moved.z},rotation,dir,{offset,step,width,slope},flags,options.groups,excludeCollider);
          if(hop!==undefined){resolved={x:resolved.x+hop.x,y:resolved.y+hop.y,z:resolved.z+hop.z};grounded=true;}
        }
      }
    }

    // Step 3c: the kinematic support, in its own (current) frame. The character's own motion there is the resolved motion
    // without the carry; it rests on the support's top (`offset` above it), snaps down to it by at most `snapToGround` when it
    // was not asked to rise, and is airborne above that. This is how a platform that descends is followed (the carry is the
    // whole vertical motion) and one that ascends keeps the character grounded.
    if(supportCollider!==undefined){
      const own={x:resolved.x-carried.x,y:resolved.y-carried.y,z:resolved.z-carried.z},lift=offset+.05;
      const from={x:position.x+own.x,y:position.y+Math.max(own.y,0)+lift,z:position.z+own.z};
      const rest=this.world.castShape(from,current,{x:0,y:-1,z:0},record.shape,offset,lift+snap+Math.max(0,-own.y),false,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,options.groups,undefined,body,collider=>collider.handle===supportCollider);
      grounded=false;
      if(rest!==null){
        const n=rest.normal1,length=Math.hypot(n.x,n.y,n.z),y=from.y-rest.time_of_impact-position.y;
        if(length>0&&n.y/length>=Math.cos(slope)-1e-6&&(own.y<=y+1e-6||(own.y-y<=snap+1e-6&&displacement.y<=1e-6))){
          resolved.y+=y-own.y;grounded=true;
          contacts.push({userId:this.userIds.get(supportCollider)!,fraction:0,normal:{x:n.x/length,y:n.y/length,z:n.z/length},point:toVec3(rest.witness1)});
        }
      }
    }
    // Step 3d: overlap guard. Rapier's shape casts are iterative and stop early for some shape pairs: a sphere walking over a large
    // box was left 2.9 cm inside it (measured, decision 0215). A resolved pose that overlaps geometry the start pose did not is
    // never returned: it is lifted by the smallest of a few small amounts that clears it, else the move is halved until it does.
    // The kinematic support is not tested (its collider is still at its pose from before the carry).
    const overlaps=(at:Vec3):boolean=>this.world.intersectionWithShape(at,rotation,record.shape,flags,options.groups,undefined,body,collider=>collider.handle!==excludeCollider&&collider.handle!==supportCollider)!==null;
    const at=(move:Vec3,dy=0):Vec3=>({x:position.x+move.x,y:position.y+move.y+dy,z:position.z+move.z});
    if(overlaps(at(resolved))&&!overlaps(position)){
      const lift=[.005,.01,.02,.04,.08].find(dy=>!overlaps(at(resolved,dy)));
      if(lift!==undefined)resolved={x:resolved.x,y:resolved.y+lift,z:resolved.z};
      else{
        let t=.5;while(t>.02&&overlaps(at({x:resolved.x*t,y:resolved.y*t,z:resolved.z*t})))t/=2;
        const k=t>.02?t:0;resolved={x:resolved.x*k,y:resolved.y*k,z:resolved.z*k};
      }
    }
    const result:{displacement:Vec3;grounded:boolean;contacts:ShapeHit[];carried:Vec3;carriedYaw:number;rotation:Quat;ground?:{userId:number;normal:Vec3}}={displacement:resolved,grounded,contacts,carried,carriedYaw,rotation};
    if(ground!==undefined)result.ground=ground;
    return result;
  }
  /**
   * The step of decision 0215: from `from` (the character against a wall), lift by `step`, advance by
   * `max(width, extent along dir) + offset` (so even a round shape's centre ends up over the step), then land within `offset`
   * of the surface below. Returns the displacement from `from`, or undefined when there is no room, no ground or the ground is too steep.
   */
  private stairAssist(record:BodyRecord,body:RAPIER.RigidBody,from:Vec3,rotation:Quat,dir:Vec3,p:{offset:number;step:number;width:number;slope:number},flags:RAPIER.QueryFilterFlags|undefined,groups:number|undefined,excludeCollider:number|undefined):Vec3|undefined {
    const solid=(flags??0)|RAPIER.QueryFilterFlags.EXCLUDE_SENSORS|RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    const keep=(collider:RAPIER.Collider)=>collider.handle!==excludeCollider;
    const cast=(at:Vec3,d:Vec3,target:number,max:number)=>this.world.castShape(at,rotation,d,record.shape,target,max,false,solid,groups,undefined,body,keep);
    const lift=p.step+p.offset;
    if(cast(from,{x:0,y:1,z:0},0,lift)!==null)return undefined;
    const lifted={x:from.x,y:from.y+lift,z:from.z};
    const reach=Math.max(p.width+p.offset,shapeExtent(record.shape,rotation,dir)+p.offset);
    if(cast(lifted,dir,0,reach)!==null)return undefined;
    const over={x:lifted.x+dir.x*reach,y:lifted.y,z:lifted.z+dir.z*reach};
    const down=cast(over,{x:0,y:-1,z:0},p.offset,lift);
    if(down===null)return undefined;
    const n=down.normal1,length=Math.hypot(n.x,n.y,n.z);
    if(!(length>0)||n.y/length<Math.cos(p.slope)-1e-6)return undefined;
    const drop=down.time_of_impact;
    // A landing that is not above the starting height is no step up (the character is at a ledge, not a stair).
    if(lift-drop<1e-4)return undefined;
    return {x:dir.x*reach,y:lift-drop,z:dir.z*reach};
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
    if (this.controller !== undefined) this.world.removeCharacterController(this.controller);
    this.controller = undefined;
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

/** The extent of `shape` (turned by `rotation`) from its centre along the horizontal unit vector `dir`. */
function shapeExtent(shape:RAPIER.Shape,rotation:Quat,dir:Vec3):number {
  if(shape instanceof RAPIER.Ball)return shape.radius;
  if(shape instanceof RAPIER.Capsule)return shape.radius;
  if(shape instanceof RAPIER.Cuboid){const l=rotateVec(conjugate(rotation),dir),h=shape.halfExtents;return h.x*Math.abs(l.x)+h.y*Math.abs(l.y)+h.z*Math.abs(l.z);}
  return 0;
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
