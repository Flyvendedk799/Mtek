/**
 * The physics adapter contract of `spec/physics.md` section 5, without any Rapier type.
 *
 * The runtime core depends only on these types. A backend (`packages/physics-rapier`) is bundled
 * to `physics/<h16>.js`, and the runtime loads it with a dynamic `import()` during mount, only when
 * the manifest's `subsystems.physics` is true (decision 0063). This file has no runtime code, so
 * importing it never pulls a backend into the runtime bundle.
 *
 * Vectors and quaternions are the CPU values of `spec/runtime-abi.md` 4.1 (`../math/types.ts`).
 * The descriptors mirror the registry schemas of `spec/physics.md` section 2 field for field:
 * `Static`/`Dynamic`/`Kinematic` and `BoxCollider`/`SphereCollider`; sizes are full extents (the
 * backend converts them to whatever its shape constructors take).
 */
import type { Quat, Vec3 } from "../math/types.js";

export type { Quat, Vec3 };

/** A position and a rotation in world space (bodies are root entities: world = local). */
export interface Pose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/**
 * A body of `spec/physics.md` section 2. `mass` is positive and finite, in kilograms; the damping
 * rates are non-negative. `Static` and `Kinematic` have no tunable fields.
 */
export type BodyDesc =
  | { readonly kind: "static" }
  | { readonly kind: "kinematic" }
  | {
      readonly kind: "dynamic";
      readonly mass: number;
      readonly linearDamping: number;
      readonly angularDamping: number;
      readonly continuousCollision?:boolean;
    };

/**
 * The collider of a body (`BoxCollider { size }` with full extents, or `SphereCollider { radius }`),
 * with the fields both schemas share.
 */
export interface ColliderDesc {
  readonly shape:
    | { readonly kind: "box"; readonly size: Vec3 }
    | { readonly kind: "sphere"; readonly radius: number };
  readonly sensor: boolean;
  readonly friction: number;
  readonly restitution: number;
}

declare const bodyHandleBrand: unique symbol;

/** An opaque handle of a body in one world, returned by `addBody`; valid until `removeBody` or `dispose`. */
export type BodyHandle = number & { readonly [bodyHandleBrand]: true };

export interface PhysicsBackend {
  readonly name: string; // "rapier3d-compat@0.21.0"
  createWorld(gravity: Vec3, fixedStep: number): PhysicsWorld;
}

export interface PhysicsWorld {
  /** Optional spatial-query capability; alternative adapters may omit it. Displacement is swept over [0,1]. */
  castShape?(shape:ColliderDesc["shape"],pose:Pose,displacement:Vec3,filter?:PhysicsQueryFilter):ShapeHit|undefined;
  /** Computes safe kinematic movement; caller owns applying the returned displacement. */
  moveCharacter?(body:BodyHandle,displacement:Vec3,options?:CharacterMoveOptions):CharacterMovement;
  contacts?(body:BodyHandle):readonly PhysicsContact[];
  setCollisionGroups?(body:BodyHandle,memberships:number,filter:number):void;
  addBody(desc: BodyDesc, collider: ColliderDesc, pose: Pose, userId: number): BodyHandle;
  removeBody(h: BodyHandle): void;
  applyImpulse(h: BodyHandle, v: Vec3): void;
  addForceForNextStep(h: BodyHandle, v: Vec3): void;
  setLinearVelocity(h: BodyHandle, v: Vec3): void;
  setKinematicTarget(h: BodyHandle, pose: Pose): void;
  teleport(h: BodyHandle, pose: Pose, keepVelocity: boolean): void;
  step(): void;
  readPose(h: BodyHandle): Pose;
  readVelocities(h: BodyHandle): { linear: Vec3; angular: Vec3 };
  drainCollisions(sink: (a: number, b: number, started: boolean) => void): void; // userIds
  counts(): { bodies: number; colliders: number };
  dispose(): void;
}

export interface PhysicsQueryFilter {readonly exclude?:BodyHandle;readonly groups?:number;readonly includeSensors?:boolean}
export interface ShapeHit {readonly userId:number;readonly fraction:number;readonly normal:Vec3;readonly point:Vec3}
export interface PhysicsContact {readonly userId:number;readonly normal:Vec3;readonly point:Vec3;readonly distance:number}
export interface CharacterMoveOptions extends PhysicsQueryFilter {
  readonly offset?:number;readonly maxSlope?:number;readonly snapToGround?:number;
  readonly stepHeight?:number;readonly stepMinWidth?:number;
}
export interface CharacterMovement {readonly displacement:Vec3;readonly grounded:boolean;readonly contacts:readonly ShapeHit[]}

/** The default export of `physics/<h16>.js`. */
export type LoadPhysics = () => Promise<PhysicsBackend>;
