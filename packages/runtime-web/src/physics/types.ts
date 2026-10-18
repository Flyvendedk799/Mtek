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

/** The default export of `physics/<h16>.js`. */
export type LoadPhysics = () => Promise<PhysicsBackend>;
