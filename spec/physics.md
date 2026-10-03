# Physics: Semantics, Adapter Contract and Rapier Mapping (v0.1, M5)

- Repository path: `spec/physics.md`
- Status: Normative for v0.1; implemented in M5. Implements blueprint §8.
- Source facts (verified 2026-10-03 against the published `.d.ts` of `@dimforge/rapier3d-compat` 0.21.0 and https://rapier.rs/docs/user_guides/javascript/getting_started_js/): the `-compat` package embeds its WebAssembly and must be initialised with `await RAPIER.init()`; `ColliderDesc.cuboid(hx, hy, hz)` takes **half-extents**; `setMass`, `setDensity`, `setSensor`, `setActiveEvents(ActiveEvents.COLLISION_EVENTS)` exist; collision events come from `world.step(eventQueue)` and `eventQueue.drainCollisionEvents((h1, h2, started) => …)`; kinematic position-based bodies take `setNextKinematicTranslation/Rotation`; `setTranslation(v, wakeUp)` teleports.

---

## 1. Principles

- Physics is a **runtime subsystem behind an adapter**, not keywords pretending to be a solver (blueprint §8). The public contract below is defined without Rapier types.
- Programs that declare no `body` never load physics code: the manifest's `subsystems.physics` is `false` and `physics/<h16>.js` is not emitted or fetched (M5 exit gate).
- **One pose authority.** A dynamic body's pose belongs to the solver; the language rejects competing writers statically (`spec/scenes.md` §8.2).
- No determinism promise across browsers or machines. Within one run, with a fixed step and fixed inputs, the order of commands and events is deterministic.

## 2. Language surface (registry schemas, `spec/stdlib.md` §3.7)

| Concept | v0.1 behaviour |
|---|---|
| `body: Static {}` | immovable collision geometry; pose fixed at creation from the entity transform |
| `body: Dynamic { mass; linear_damping; angular_damping }` | solver-controlled pose; forces/impulses/teleports are explicit commands |
| `body: Kinematic {}` | the program supplies a target pose with `set_kinematic_target` (position-based kinematic) |
| `collider: BoxCollider { size; sensor; friction; restitution }` | full extents (converted to half-extents by the adapter) |
| `collider: SphereCollider { radius; sensor; friction; restitution }` | |
| Mass | positive finite kilograms; the adapter sets it on the collider (`setMass`), letting the backend derive consistent inertia |
| Gravity | scene field `gravity`, default `vec3(0.0, -9.81, 0.0)` |
| Collision events | `collision_enter` / `collision_exit` on entities with colliders, delivered after each step |
| Teleport | explicit command with a velocity reset/preserve choice |

Rules checked by the compiler: a `collider` requires a `body` (`E5120`, "add `body: Static {}` for fixed geometry"); a `body` without a `collider` is `E5121`; bodies only on root entities (`E5091`); `scale` of a body entity is construction-only and must be `vec3(1.0)` for `Dynamic` and `Kinematic` bodies (`E5122`, scaled dynamic bodies are not in v0.1); a binding on a dynamic or kinematic body's `position`/`rotation` is `E5072`; assignment is `E5071`. Changing a visual material never touches the collider; collider dimensions are construction-only in v0.1 (a rebuild path is v0.2).

## 3. Body commands (CPU, handlers only)

Available as `Name.body.<command>(…)`, `self.body.<command>(…)` and `ref.body.<command>(…)` (`spec/scenes.md` §8.3):

| Command | Applies to | Semantics |
|---|---|---|
| `apply_impulse(impulse: vec3)` | Dynamic | instantaneous change of momentum (N·s), at the centre of mass, applied at the start of the next tick |
| `apply_force(force: vec3)` | Dynamic | force (N) applied for exactly the next tick, then cleared |
| `set_kinematic_target(position: vec3, rotation: quat)` | Kinematic | pose reached at the end of the next tick (velocity derived by the solver) |
| `teleport(position: vec3, rotation: quat, keep_velocity: bool)` | Dynamic, Kinematic | sets the pose before the next tick; velocities are zeroed unless `keep_velocity` |
| `set_linear_velocity(v: vec3)` | Dynamic | applied at the start of the next tick |

Readable (not writable) fields: `Name.body.linear_velocity: vec3`, `Name.body.angular_velocity: vec3` (Dynamic/Kinematic), as of the last completed tick. A command on the wrong body kind is `E5123` (static) or, through an `entity_ref` whose body kind is unknown statically, a runtime `E8101` (command dropped). Commands to a pending or dead entity are dropped with `W8031`.

## 4. Tick integration (`spec/scenes.md` §10 phase 2)

For each fixed tick:
1. Flush the lifecycle queue (spawned bodies are created; destroyed bodies are removed from the world).
2. Apply queued commands **grouped by category in this order** — teleports, linear velocities, kinematic targets, impulses, forces — and in issue order within each category (so a teleport issued after an impulse in the same tick still happens first, deterministically).
3. Run `fixed_update` handlers.
4. `world.step(eventQueue)` with `timestep = fixedStep`.
5. Read back authoritative poses of dynamic and kinematic bodies into entity records (world = local for root bodies).
6. Drain collision events and deliver them (§6). Commands issued here apply in the next tick.

Pause stops ticks; resume never steps the hidden interval (§10.2 of the scenes spec). Scene destruction and `dispose()` free the world, every body and collider, and the event queue (counters return to zero).

## 5. The adapter interface (`packages/runtime-web/src/physics/types.ts`)

```ts
export interface PhysicsBackend {
  readonly name: string;                             // "rapier3d-compat@0.21.0"
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
  drainCollisions(sink: (a: number, b: number, started: boolean) => void): void;  // userIds
  counts(): { bodies: number; colliders: number };
  dispose(): void;
}
export type LoadPhysics = () => Promise<PhysicsBackend>;   // default export of physics/<h16>.js
```

The runtime core depends only on these types. `packages/physics-rapier` implements them with `@dimforge/rapier3d-compat` (pinned exactly, initially 0.21.0) and is bundled by the build into `physics/<h16>.js`, loaded with a dynamic `import()` during mount only when `subsystems.physics` is true. A test asserts that a non-physics program performs no request for any `physics/` URL (M5 gate).

### 5.1 Rapier mapping
| Mtek | Rapier |
|---|---|
| `Static` | `RigidBodyDesc.fixed()` |
| `Dynamic` | `RigidBodyDesc.dynamic().setLinearDamping(…).setAngularDamping(…)`; collider `.setMass(mass)` |
| `Kinematic` | `RigidBodyDesc.kinematicPositionBased()`; targets via `setNextKinematicTranslation/Rotation` |
| `BoxCollider { size }` | `ColliderDesc.cuboid(size.x/2, size.y/2, size.z/2)` |
| `SphereCollider { radius }` | `ColliderDesc.ball(radius)` |
| `sensor`, `friction`, `restitution` | `setSensor`, `setFriction`, `setRestitution` |
| events | every collider gets `setActiveEvents(ActiveEvents.COLLISION_EVENTS)` **and** `setActiveCollisionTypes(ActiveCollisionTypes.ALL)` (otherwise kinematic–fixed and sensor–fixed pairs produce no events); one `EventQueue(true)` per world |
| teleport | `setTranslation(p, true)`, `setRotation(q, true)`, and unless `keep_velocity`: `setLinvel(0)`, `setAngvel(0)` |
| force for next step | `addForce(v, true)` before the step, `resetForces(true)` after it |
| collider handle → entity | a `Map<colliderHandle, userId>` maintained by the adapter |

## 6. Collision events

- After each step the adapter drains `started`/`stopped` pairs. The runtime converts each to two deliveries — `collision_enter(other)` (or `collision_exit`) on entity A with `other = B`, and on B with `other = A` — for entities that declare the handler.
- **Order:** sort pairs by `(min(slotA, slotB), max(slotA, slotB))`, enter events before exit events; within a pair, the lower slot's handler first. This makes handler order independent of the solver's internal order.
- Events involving an entity that is pending removal are not delivered. Destroying an entity inside a collision handler is safe: removal happens at the next flush (start of the next tick or end of the update phase), never during iteration (M5 exit gate).
- Sensors produce the same enter/exit events (`started` = intersection began).

## 7. Required tests (`tests/browser/specs/physics/`, manual clock, fixed step)

Resting contact (a box dropped on the floor comes to rest within 0.01 m of the expected height after 3 s simulated); impulse response (velocity change = impulse / mass within 1 %); high-speed limitation documented (a thin wall and a fast sphere: record whether tunnelling occurs — no CCD in v0.1 — as a known limitation); sensor enter/exit counts; authority conflicts rejected at compile time (fixtures for `E5071`/`E5072`/`E5122`); removal during collision callbacks; pause/resume (no simulated jump); scene destruction and 20 mount/dispose cycles return `bodies`/`colliders` to 0; spawn/destroy 1 000 crates in waves returns to a bounded plateau; non-physics program fetches no physics module.

## 8. Physics diagnostic codes

Compile time (added to `spec/diagnostics.md` §5.5 in M5): `E5120` collider without body · `E5121` body without collider · `E5122` scaled dynamic or kinematic body · `E5123` command not valid for this body kind. Runtime (§5.8): `E8101` command not valid for the target's body kind · `E8102` physics module failed to load (mount fails with the dedicated kind `"physics-failed"`, added to `MtekMountError.kind` in M5) · `E8103` non-finite pose produced by the solver (body frozen, reported once).
