/**
 * A recording stand-in for the physics backend (`spec/physics.md` section 5), for the tests of the runtime's
 * integration (decision 0066): it does no physics. Every call is appended to one chronological `log` (which a test
 * program's handlers can write to as well, so the order of a whole tick is one list), poses and velocities are
 * whatever the test scripted, and collisions are the pairs the test queued for the next `drainCollisions`.
 *
 * What it keeps of the real adapter's contract (`packages/physics-rapier`): handles are opaque numbers, `step`
 * does not drain, events of a removed body are dropped, an unknown handle throws, and a disposed world only
 * answers `counts()`.
 */
import type {
  BodyDesc,
  BodyHandle,
  ColliderDesc,
  PhysicsBackend,
  PhysicsWorld,
  Pose,
  Vec3,
} from "../physics/types.js";

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
export const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A body the fake world holds. `pose`, `linear` and `angular` are what `readPose`/`readVelocities` answer. */
export interface FakeBody {
  readonly handle: BodyHandle;
  readonly userId: number;
  readonly desc: BodyDesc;
  readonly collider: ColliderDesc;
  pose: Pose;
  linear: Vec3;
  angular: Vec3;
}

function text(v: Vec3): string {
  return `${String(v.x)},${String(v.y)},${String(v.z)}`;
}

export class FakePhysicsWorld implements PhysicsWorld {
  /** Every call, oldest first: `addBody:<userId>:<kind>`, `impulse:<userId>:x,y,z`, `step`, ... */
  readonly log: string[];
  readonly bodies = new Map<number, FakeBody>();
  /** Pairs `[userIdA, userIdB, started]` the next `drainCollisions` reports (in this order, whatever the order the runtime delivers in). */
  readonly collisions: [number, number, boolean][] = [];
  /** Runs inside every `step`, after it is logged: scripts what the solver did (poses, velocities, events). */
  onStep: ((world: FakePhysicsWorld) => void) | undefined;
  steps = 0;
  disposed = false;
  private next = 1;

  constructor(
    readonly gravity: Vec3,
    readonly fixedStep: number,
    log: string[],
  ) {
    this.log = log;
  }

  body(userId: number): FakeBody {
    for (const body of this.bodies.values()) if (body.userId === userId) return body;
    throw new Error(`the fake world has no body for user id ${String(userId)}`);
  }

  /** Whether a body exists for `userId`. */
  has(userId: number): boolean {
    return [...this.bodies.values()].some((body) => body.userId === userId);
  }

  addBody(desc: BodyDesc, collider: ColliderDesc, pose: Pose, userId: number): BodyHandle {
    this.alive();
    const handle = this.next++ as BodyHandle;
    this.bodies.set(handle, { handle, userId, desc, collider, pose, linear: ORIGIN, angular: ORIGIN });
    this.log.push(`addBody:${String(userId)}:${desc.kind}:${text(pose.position)}`);
    return handle;
  }

  removeBody(h: BodyHandle): void {
    this.alive();
    const body = this.known(h);
    this.bodies.delete(h);
    this.log.push(`removeBody:${String(body.userId)}`);
  }

  applyImpulse(h: BodyHandle, v: Vec3): void {
    this.alive();
    this.log.push(`impulse:${String(this.known(h).userId)}:${text(v)}`);
  }

  addForceForNextStep(h: BodyHandle, v: Vec3): void {
    this.alive();
    this.log.push(`force:${String(this.known(h).userId)}:${text(v)}`);
  }

  setLinearVelocity(h: BodyHandle, v: Vec3): void {
    this.alive();
    this.log.push(`linvel:${String(this.known(h).userId)}:${text(v)}`);
  }

  setKinematicTarget(h: BodyHandle, pose: Pose): void {
    this.alive();
    this.log.push(`kinematic:${String(this.known(h).userId)}:${text(pose.position)}`);
  }

  teleport(h: BodyHandle, pose: Pose, keepVelocity: boolean): void {
    this.alive();
    this.log.push(`teleport:${String(this.known(h).userId)}:${text(pose.position)}:${keepVelocity ? "keep" : "reset"}`);
  }

  step(): void {
    this.alive();
    this.steps += 1;
    this.log.push("step");
    this.onStep?.(this);
  }

  readPose(h: BodyHandle): Pose {
    this.alive();
    const body = this.known(h);
    this.log.push(`readPose:${String(body.userId)}`);
    return body.pose;
  }

  readVelocities(h: BodyHandle): { linear: Vec3; angular: Vec3 } {
    this.alive();
    const body = this.known(h);
    return { linear: body.linear, angular: body.angular };
  }

  drainCollisions(sink: (a: number, b: number, started: boolean) => void): void {
    this.alive();
    this.log.push("drain");
    const reported = this.collisions.splice(0);
    const live = new Set([...this.bodies.values()].map((body) => body.userId));
    for (const [a, b, started] of reported) if (live.has(a) && live.has(b)) sink(a, b, started);
  }

  counts(): { bodies: number; colliders: number } {
    return this.disposed ? { bodies: 0, colliders: 0 } : { bodies: this.bodies.size, colliders: this.bodies.size };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.log.push("dispose");
    this.bodies.clear();
  }

  private alive(): void {
    if (this.disposed) throw new Error("fake physics: the world was disposed");
  }

  private known(h: BodyHandle): FakeBody {
    const body = this.bodies.get(h);
    if (body === undefined) throw new Error(`fake physics: unknown body handle ${String(h)}`);
    return body;
  }
}

/** A backend that records into one log and keeps every world it made. */
export class FakePhysicsBackend implements PhysicsBackend {
  readonly name = "fake-physics@0";
  readonly worlds: FakePhysicsWorld[] = [];

  /** @param log The chronological log every world appends to; tests share it with their handlers. */
  constructor(readonly log: string[] = []) {}
  /** Makes `createWorld` throw, like an engine that cannot start. */
  failCreateWorld: Error | undefined;

  createWorld(gravity: Vec3, fixedStep: number): PhysicsWorld {
    if (this.failCreateWorld !== undefined) throw this.failCreateWorld;
    this.log.push(`createWorld:${text(gravity)}:${String(fixedStep)}`);
    const world = new FakePhysicsWorld(gravity, fixedStep, this.log);
    this.worlds.push(world);
    return world;
  }

  /** The world of the (only or latest) mount. */
  get world(): FakePhysicsWorld {
    const world = this.worlds.at(-1);
    if (world === undefined) throw new Error("no physics world was created");
    return world;
  }

  /** What `import()` of `physics/<h16>.js` resolves to: a module whose default export loads this backend. */
  get module(): { readonly default: () => Promise<PhysicsBackend> } {
    return { default: () => Promise.resolve(this) };
  }
}
