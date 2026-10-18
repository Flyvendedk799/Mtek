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
| Collision events | `collision_enter` / `collision_exit` on entities and prefabs with a collider (`E5062` otherwise), delivered after each step |
| Teleport | explicit command with a velocity reset/preserve choice |

Rules checked by the compiler (decision 0065 records the details; every rule has a fixture): a `collider` requires a `body` (`E5120`, "add `body: Static {}` for fixed geometry"); a `body` without a `collider` is `E5121`; bodies only on root entities (`E5091`; a static instance of a prefab with a body counts as an entity with a body); `scale` of a body entity is construction-only (`E5073` on an assignment, `E5004` on a `bind`) and must be the constant `vec3(1.0)` for `Dynamic` and `Kinematic` bodies (`E5122`, scaled dynamic bodies are not in v0.1; a `Static` body may have any positive scale, which is visual only because the collider is sized by its own descriptor); a `bind` on the `position` or `rotation` of any entity with a body (`Static`, `Dynamic` or `Kinematic`) is `E5072`, an assignment to them `E5071`, naming the operation that is allowed (`apply_impulse`, `set_kinematic_target`, `teleport`, or "static bodies cannot move"). Values of the descriptors are constants in the ranges of `spec/stdlib.md` section 3.7 (`E5006`; mass, damping, friction, sizes and radius are finite). Changing a visual material never touches the collider; collider dimensions are construction-only in v0.1 (a rebuild path is v0.2).

## 3. Body commands (CPU, handlers only)

Available as `Name.body.<command>(…)`, `self.body.<command>(…)` and `ref.body.<command>(…)` (`spec/scenes.md` §8.3):

| Command | Applies to | Semantics |
|---|---|---|
| `apply_impulse(impulse: vec3)` | Dynamic | instantaneous change of momentum (N·s), at the centre of mass, applied at the start of the next tick |
| `apply_force(force: vec3)` | Dynamic | force (N) applied for exactly the next tick, then cleared |
| `set_kinematic_target(position: vec3, rotation: quat)` | Kinematic | pose reached at the end of the next tick (velocity derived by the solver) |
| `teleport(position: vec3, rotation: quat, keep_velocity: bool)` | Dynamic, Kinematic | sets the pose before the next tick; velocities are zeroed unless `keep_velocity` |
| `set_linear_velocity(v: vec3)` | Dynamic | applied at the start of the next tick |

Readable (not writable) fields: `Name.body.linear_velocity: vec3`, `Name.body.angular_velocity: vec3` (Dynamic/Kinematic), as of the last completed tick (zero before the first tick). Assigning one is `E5071`; a binding cannot depend on one (`E5005`: the manifest has no dependency kind for it), and a state initialiser cannot read one (`E5081`). A command or velocity on a named entity (or `self`, or a static prefab instance) whose body kind does not support it, or that has no body, is `E5123`; through an `entity_ref` the body kind is unknown statically, so the runtime reports `E8101` and drops the command. Commands run only in lifecycle functions and event handlers (`E5080` in a function, `E5005` in a `bind`). A command with the wrong number or types of arguments is `E3002`/`E3001`. Commands to a pending or dead entity are dropped with `W8031`. A command argument that is not finite (a rotation of zero length counts) is dropped with `E8104`; a command whose entity was destroyed after it was issued is dropped silently when it would apply. The code a handler compiles to is `ctx.body(target, spanId).<command>(..)` and `ctx.body(target, spanId).<property>` (`spec/runtime-abi.md` section 4.2); the runtime's handling of every case is decision 0066.

## 4. Tick integration (`spec/scenes.md` §10 phase 2)

For each fixed tick:
1. Flush the lifecycle queue (spawned bodies are created; destroyed bodies are removed from the world).
2. Apply queued commands **grouped by category in this order** — teleports, linear velocities, kinematic targets, impulses, forces — and in issue order within each category (so a teleport issued after an impulse in the same tick still happens first, deterministically).
3. Run `fixed_update` handlers.
4. `world.step(eventQueue)` with `timestep = fixedStep`.
5. Read back authoritative poses of dynamic and kinematic bodies into entity records (world = local for root bodies).
6. Drain collision events and deliver them (§6). Commands issued here apply in the next tick.

Pause stops ticks; resume never steps the hidden interval (§10.2 of the scenes spec). Scene destruction and `dispose()` free the world, every body and collider, and the event queue (counters return to zero).

Decision `spec/decisions/0066-physics-integration.md` fixes what this list leaves open: the commands are taken once at the start of the tick and ones issued later (in `fixed_update`, in a collision handler) land in the next batch, each applied once; a command whose entity was destroyed since is dropped silently and a reused slot never receives it (generations); write-back covers dynamic and kinematic bodies only and goes through the same setter as a script's write; the velocities a handler reads are those of the last completed tick; a spawn is created at the flush point after it and gets its body there; a pose the solver makes non-finite freezes that body (`E8103`: it leaves the world, the entity keeps its last finite pose, once per body); the hot-reload swap makes a new world at the carried poses and starts at rest.

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

The descriptor types the listing uses (`Vec3`, `Quat`, `Pose`, `BodyHandle`, `BodyDesc`, `ColliderDesc`), the Rapier adapter (M5-04), the engine behaviours the integration must account for (collision events lag the poses by one step, undrained events are discarded at the next step, events of removed entities are dropped, the 5 mm contact skin, averaged friction and restitution), the bundle and the rule for when the compiler writes it (`subsystems.physics` only: true when any body exists, decision 0065; the library-only option `force_physics_subsystem` forces it for the packaging tests) are decision 0063. The runtime integration (stepping, commands, event delivery, loading the bundle at mount) is M5-05, decision 0066. The runtime learns the file name from the manifest: `subsystems.physicsModule` is `physics/<h16>.js` exactly when `subsystems.physics` is true (`spec/runtime-abi.md` section 5.2); a module that cannot be imported, initialised or used is `E8102` and the mount fails with `physics-failed`.

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
- **Order:** sort pairs by `(min(slotA, slotB), max(slotA, slotB))`, enter events before exit events; within a pair, the lower slot's handler first. This makes handler order independent of the solver's internal order. A pair is reported as started or as stopped in one step, never both, so "enter before exit" can only mean that **all enter events precede all exit events** and each group is sorted by the pair (decision 0066 item 8).
- Events involving an entity that is pending removal are not delivered. Destroying an entity inside a collision handler is safe: removal happens at the next flush (start of the next tick or end of the update phase), never during iteration (M5 exit gate). Whether an entity is pending removal is checked before **each** delivery, also between the two deliveries of one pair: the entity a handler destroyed, and its partner, receive nothing more (decision 0066 item 8).
- Sensors produce the same enter/exit events (`started` = intersection began).

## 7. Required tests (`tests/browser/specs/physics/`, manual clock, fixed step)

Resting contact (a box dropped on the floor comes to rest within 0.01 m of the expected height after 3 s simulated; `tests/browser/specs/m5/physics.spec.ts`, M5-05); impulse response (velocity change = impulse / mass within 1 %); high-speed limitation documented (a thin wall and a fast sphere: record whether tunnelling occurs — no CCD in v0.1 — as a known limitation; measured, see §7.1); sensor enter/exit counts; authority conflicts rejected at compile time (fixtures for `E5071`/`E5072`/`E5122`); removal during collision callbacks; pause/resume (no simulated jump); scene destruction and 20 mount/dispose cycles return `bodies`/`colliders` to 0; spawn/destroy 1 000 crates in waves returns to a bounded plateau; non-physics program fetches no physics module (`tests/browser/specs/m5/physics.spec.ts`, M5-05). The order of a tick, command categories, event order, removal during callbacks, pause/resume and the diagnostics `E8101`–`E8104` are unit-tested against a recording fake backend (`packages/runtime-web/src/physics/*.test.ts`, decision 0066).

The engine-level evidence of M5-06 (decision `spec/decisions/0068-physics-behaviour-evidence.md`, all in `tests/browser/specs/m5/`): `physics-sensor.spec.ts` (four balls through a sensor zone: exact enter and exit counts at both sides, in the derived ticks, a static body inside the zone makes no event), `physics-tunnelling.spec.ts` and `packages/physics-rapier/src/tunnelling.test.ts` (§7.1), `physics-callbacks.spec.ts` (handlers that destroy themselves, their partner or both and that spawn bodies, inside the delivery of one tick: no lost or doubled event, a consistent world), `physics-pause.spec.ts` (manual and real clock: a paused interval is never stepped), `physics-combinations.spec.ts` (the combinations of `spec/scenes.md` §10.3 around a real collision) and `physics-resources.spec.ts` (twenty mount/dispose cycles with live crates: bodies, colliders, buffers, bind groups, listeners at zero; 1 000 crates in waves of 50, then waves of 100: a bounded plateau that the largest wave sets and nothing else moves).

### 7.1 Known limitation: high-speed bodies (measured)

The adapter enables no continuous collision detection (a measurement with `setCcdEnabled(true)` on dynamic bodies changed nothing for two moving bodies, so it is not a mitigation either). The engine looks for contacts once per fixed step on the poses the previous step left. For a small ball (radius *r*) flying at a thin obstacle (thickness *t*) the ball is **stopped exactly when one of the poses the engine samples, `x₀ + k·v·dt`, lies within the window `t/2 + r + 0.02 m` before the obstacle's midplane** (0.02 m is the prediction distance, decision 0063 item 5), and flies through otherwise. Consequences, measured on the real engine at the 1/60 s step with a ball of radius 0.05 m and a wall of 0.1 m (window 0.12 m):

- A body that moves at most the window per step (`v·dt ≤ t/2 + r + 0.02`, here **7.2 m/s**) **cannot tunnel** whatever its phase. Above it a body tunnels in the share `1 − window / (v·dt)` of the phases (0.2 at 9 m/s, 0.4 at 12 m/s, 0.88 at 60 m/s; a ball that is not stopped keeps its speed).
- This holds for a **dynamic body against a thin dynamic plate** (and, in a scratch experiment, a kinematic wall onto a resting ball). Against a **static** wall nothing was ever seen to pass, from 3 to 100 000 m/s (1 667 m per step), through walls of 1 mm to 0.1 m: the engine protects the pair of a dynamic body and a fixed one.
- What a program can do: keep thin walls static; for thin moving obstacles keep `v·dt` within the window or make the obstacle thicker (the window grows by half the thickness); clamp speeds in `fixed_update` with `set_linear_velocity`.

The numbers per lane and the derivations are in decision 0068 item 3.

## 8. Physics diagnostic codes

Compile time (in `spec/diagnostics.md` §5.5, added by M5-03): `E5120` collider without body · `E5121` body without collider · `E5122` scaled dynamic or kinematic body · `E5123` command not valid for this body kind. Runtime (§5.8, catalogued by M5-03, reported by M5-05): `E8101` command not valid for the target's body kind · `E8102` physics module failed to load (mount fails with the dedicated kind `"physics-failed"`, added to `MtekMountError.kind` in M5) · `E8103` non-finite pose produced by the solver (body frozen, reported once) · `E8104` non-finite value given to a body (a command argument, or the initial pose of a body; decision 0066).
