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
| `body: Dynamic { mass; linear_damping; angular_damping; continuous }` | solver-controlled pose; forces/impulses/teleports are explicit commands; `continuous: bool = false` asks the adapter for continuous collision detection for this body (the host option `physics: { continuousCollision: true }` still enables it for every dynamic body) |
| `body: Kinematic { max_slope; step_height; step_min_width; snap_to_ground; skin; carry }` | the program supplies a target pose with `set_kinematic_target` (position-based kinematic), or moves the body with collisions with `move_character`; the six optional fields tune `move_character` only (table below) |
| `collider: BoxCollider { size; sensor; friction; restitution }` | full extents (converted to half-extents by the adapter) |
| `collider: SphereCollider { radius; sensor; friction; restitution }` | |
| `collider: CapsuleCollider { radius; height; sensor; friction; restitution }` | a cylinder along local Y with a hemisphere on each end; `height` is the full height including both caps and exceeds `2 * radius` (`E5124`); the usual shape of a character (decision 0217) |
| Mass | positive finite kilograms; the adapter sets it on the collider (`setMass`), letting the backend derive consistent inertia |
| Gravity | scene field `gravity`, default `vec3(0.0, -9.81, 0.0)` |
| Collision events | `collision_enter` / `collision_exit` on entities and prefabs with a collider (`E5062` otherwise), delivered after each step |
| Teleport | explicit command with a velocity reset/preserve choice |

The character settings of a `Kinematic` body (decisions 0214 and 0217; all construction-only constants, a value outside its range is `E5006`):

| Field | Type | Default | Range |
|---|---|---|---|
| `max_slope` | f32 radians | 0.7853982 (45°) | 0 to 1.5707964 |
| `step_height` | f32 m | 0.25 | ≥ 0 (0 disables stepping) |
| `step_min_width` | f32 m | 0.1 | > 0 |
| `snap_to_ground` | f32 m | 0.2 | ≥ 0 (0 disables snapping) |
| `skin` | f32 m | 0.01 | > 0 |
| `carry` | bool | true | |

The manifest carries them as a `character` object (all six, defaults filled) only when the program wrote at least one of them; the runtime applies the defaults above otherwise, so both spellings of "all defaults" behave alike.

Rules checked by the compiler (decision 0065 records the details; every rule has a fixture): a `collider` requires a `body` (`E5120`, "add `body: Static {}` for fixed geometry"); a `body` without a `collider` is `E5121`; bodies only on root entities (`E5091`; a static instance of a prefab with a body counts as an entity with a body); `scale` of a body entity is construction-only (`E5073` on an assignment, `E5004` on a `bind`) and must be the constant `vec3(1.0)` for `Dynamic` and `Kinematic` bodies (`E5122`, scaled dynamic bodies are not in v0.1; a `Static` body may have any positive scale, which is visual only because the collider is sized by its own descriptor); a `bind` on the `position` or `rotation` of any entity with a body (`Static`, `Dynamic` or `Kinematic`) is `E5072`, an assignment to them `E5071`, naming the operation that is allowed (`apply_impulse`, `set_kinematic_target`, `move_character`, `teleport`, or "static bodies cannot move"); a `CapsuleCollider` whose `height` is not greater than `2 * radius` is `E5124` (help: increase `height` or decrease `radius`). Values of the descriptors are constants in the ranges of `spec/stdlib.md` section 3.7 (`E5006`; mass, damping, friction, sizes and radius are finite). Changing a visual material never touches the collider; collider dimensions are construction-only in v0.1 (a rebuild path is v0.2).

## 3. Body commands (CPU, handlers only)

Available as `Name.body.<command>(…)`, `self.body.<command>(…)` and `ref.body.<command>(…)` (`spec/scenes.md` §8.3):

| Command | Applies to | Semantics |
|---|---|---|
| `apply_impulse(impulse: vec3)` | Dynamic | instantaneous change of momentum (N·s), at the centre of mass, applied at the start of the next tick |
| `apply_force(force: vec3)` | Dynamic | force (N) applied for exactly the next tick, then cleared |
| `set_kinematic_target(position: vec3, rotation: quat)` | Kinematic | pose reached at the end of the next tick (velocity derived by the solver) |
| `teleport(position: vec3, rotation: quat, keep_velocity: bool)` | Dynamic, Kinematic | sets the pose before the next tick; velocities are zeroed unless `keep_velocity` |
| `set_linear_velocity(v: vec3)` | Dynamic | applied at the start of the next tick |
| `move_character(displacement: vec3, rotation: quat)` | Kinematic | moves the body by `displacement` metres for this tick (for example `velocity * dt` in `fixed_update`) with collide-and-slide, stair stepping, the slope limit, ground snapping and platform carry (decision 0214); `rotation` is the orientation wanted, to which the yaw of a carrying platform is added. Gravity is not applied: the program adds its own vertical motion. Applied at the start of the next tick in its own category (below); several calls for one body in one tick sum their displacements and the last rotation wins; a `move_character` replaces a `set_kinematic_target` of the same body in the same tick, and a `teleport` of the tick applies first, so the move starts from the teleported pose |

Readable (not writable) fields: `Name.body.linear_velocity: vec3`, `Name.body.angular_velocity: vec3` (Dynamic/Kinematic), as of the last completed tick (zero before the first tick), and `Name.body.grounded: bool`, `Name.body.ground_normal: vec3` (Kinematic), as of the last completed character move (false and zero before the first and for a body never moved with `move_character`; `ground_normal` is the normal of the ground the move found and zero when not grounded). A handler running in a tick reads the result of the move applied at the start of that tick. Assigning one is `E5071` (with help naming `move_character`); a binding cannot depend on one (`E5005`: the manifest has no dependency kind for it), and a state initialiser cannot read one (`E5081`). A command or velocity on a named entity (or `self`, or a static prefab instance) whose body kind does not support it, or that has no body, is `E5123`; through an `entity_ref` the body kind is unknown statically, so the runtime reports `E8101` and drops the command. Commands run only in lifecycle functions and event handlers (`E5080` in a function, `E5005` in a `bind`). A command with the wrong number or types of arguments is `E3002`/`E3001`. Commands to a pending or dead entity are dropped with `W8031`. A `move_character` for a body whose loaded adapter has no `moveCharacter` is dropped with `E8105`, once per body. A command argument that is not finite (a rotation of zero length counts) is dropped with `E8104`; a command whose entity was destroyed after it was issued is dropped silently when it would apply. The code a handler compiles to is `ctx.body(target, spanId).<command>(..)` and `ctx.body(target, spanId).<property>` (`spec/runtime-abi.md` section 4.2); the runtime's handling of every case is decision 0066.

## 4. Tick integration (`spec/scenes.md` §10 phase 2)

For each fixed tick:
1. Flush the lifecycle queue (spawned bodies are created; destroyed bodies are removed from the world).
2. Apply queued commands **grouped by category in this order** — teleports, linear velocities, kinematic targets, character moves, impulses, forces — and in issue order within each category (so a teleport issued after an impulse in the same tick still happens first, deterministically). The character moves of one body are one move: the displacements are summed, the last rotation wins, and it is resolved where the first of them stands in the order, after every kinematic target (a platform's target of the same tick is therefore already known) and in place of a kinematic target of the same body. Resolving a move is `moveCharacter(handle, displacement, { offset: skin, maxSlope, snapToGround, stepHeight, stepMinWidth, carry, rotation })` from the pose the body has now (after the tick's teleports), followed by `setKinematicTarget(handle, { current position + result.displacement, result.rotation })`; `result.grounded` and `result.ground.normal` are kept for the reads. A result that is not finite freezes the body (`E8103`).
3. Run `fixed_update` handlers.
4. `world.step(eventQueue)` with `timestep = fixedStep`.
5. Read back authoritative poses of dynamic and kinematic bodies into entity records (world = local for root bodies).
6. Drain collision events and deliver them (§6). Commands issued here apply in the next tick.

Pause stops ticks; resume never steps the hidden interval (§10.2 of the scenes spec). Scene destruction and `dispose()` free the world, every body and collider, and the event queue (counters return to zero).

Decision `spec/decisions/0066-physics-integration.md` fixes what this list leaves open: the commands are taken once at the start of the tick and ones issued later (in `fixed_update`, in a collision handler) land in the next batch, each applied once; a command whose entity was destroyed since is dropped silently and a reused slot never receives it (generations); write-back covers dynamic and kinematic bodies only and goes through the same setter as a script's write; the velocities a handler reads are those of the last completed tick; a spawn is created at the flush point after it and gets its body there; a pose the solver makes non-finite freezes that body (`E8103`: it leaves the world, the entity keeps its last finite pose, once per body); the hot-reload swap makes a new world at the carried poses and starts at rest (velocities, queued commands and `grounded` / `ground_normal` are gone; the character settings are read again from the new manifest). Decision [0217](decisions/0217-character-movement-language-and-host.md) adds the character-move category, the host queries and the adapter limitation that a collider added in a tick (a spawn) is not seen by `moveCharacter` or the queries until the next `step`: spawned geometry is visible to character moves from the next tick.

## 5. The adapter interface (`packages/runtime-web/src/physics/types.ts`)

```ts
export interface PhysicsBackend {
  readonly name: string;                             // "rapier3d-compat@0.21.0"
  createWorld(gravity: Vec3, fixedStep: number): PhysicsWorld;
}
export interface PhysicsWorld {
  // Optional capabilities (decisions 0193, 0214, 0217); an adapter may omit any of them.
  castRay?(origin: Vec3, direction: Vec3, maxDistance: number, filter?: PhysicsQueryFilter): RayHit | undefined;
  castShape?(shape: ColliderDesc["shape"], pose: Pose, displacement: Vec3, filter?: PhysicsQueryFilter): ShapeHit | undefined;
  moveCharacter?(h: BodyHandle, displacement: Vec3, options?: CharacterMoveOptions): CharacterMovement;
  contacts?(h: BodyHandle): readonly PhysicsContact[];
  setCollisionGroups?(h: BodyHandle, memberships: number, filter: number): void;
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

The optional methods are used as follows (decision 0217). The runtime calls `moveCharacter` for `move_character` (section 4); without it the command is dropped with `E8105`. The host API (`app.physics`, `ExtensionContext.physics`, `docs/platform-runtime.md`) calls `castRay`, `castShape`, `contacts` and `setCollisionGroups`; a host that calls a method the adapter lacks gets a `MtekPhysicsUnsupportedError` naming it. The collision groups are two 16-bit masks, `memberships` and `filter`; a query's `groups` option is the packed 32-bit word `((memberships << 16) | filter) >>> 0`. `BodyDesc.continuousCollision` is set for a dynamic body whose manifest entry says `continuous` and, with the host option `physics: { continuousCollision: true }`, for every dynamic body. A capsule collider reaches the adapter as `{ kind: "capsule", radius, height }` with the full height. A collider added during a tick (a spawn) is not seen by `moveCharacter` or the queries before the next `step`.

The descriptor types the listing uses (`Vec3`, `Quat`, `Pose`, `BodyHandle`, `BodyDesc`, `ColliderDesc`), the Rapier adapter (M5-04), the engine behaviours the integration must account for (collision events lag the poses by one step, undrained events are discarded at the next step, events of removed entities are dropped, the 5 mm contact skin, averaged friction and restitution), the bundle and the rule for when the compiler writes it (`subsystems.physics` only: true when any body exists, decision 0065; the library-only option `force_physics_subsystem` forces it for the packaging tests) are decision 0063. The runtime integration (stepping, commands, event delivery, loading the bundle at mount) is M5-05, decision 0066. The runtime learns the file name from the manifest: `subsystems.physicsModule` is `physics/<h16>.js` exactly when `subsystems.physics` is true (`spec/runtime-abi.md` section 5.2); a module that cannot be imported, initialised or used is `E8102` and the mount fails with `physics-failed`.

### 5.1 Rapier mapping
| Mtek | Rapier |
|---|---|
| `Static` | `RigidBodyDesc.fixed()` |
| `Dynamic` | `RigidBodyDesc.dynamic().setLinearDamping(…).setAngularDamping(…)`; collider `.setMass(mass)` |
| `Kinematic` | `RigidBodyDesc.kinematicPositionBased()`; targets via `setNextKinematicTranslation/Rotation` |
| `BoxCollider { size }` | `ColliderDesc.cuboid(size.x/2, size.y/2, size.z/2)` |
| `SphereCollider { radius }` | `ColliderDesc.ball(radius)` |
| `CapsuleCollider { radius, height }` | `ColliderDesc.capsule((height - 2 * radius) / 2, radius)` |
| `continuous` (or the host option) | `RigidBodyDesc.setCcdEnabled(true)` |
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

Resting contact (a box dropped on the floor comes to rest within 0.01 m of the expected height after 3 s simulated; `tests/browser/specs/m5/physics.spec.ts`, M5-05); impulse response (velocity change = impulse / mass within 1 %); high-speed limitation documented (a thin wall and a fast sphere: record whether tunnelling occurs, with continuous collision off by default and on as a host option, as a known limitation; measured, see §7.1); sensor enter/exit counts; authority conflicts rejected at compile time (fixtures for `E5071`/`E5072`/`E5122`); removal during collision callbacks; pause/resume (no simulated jump); scene destruction and 20 mount/dispose cycles return `bodies`/`colliders` to 0; spawn/destroy 1 000 crates in waves returns to a bounded plateau; non-physics program fetches no physics module (`tests/browser/specs/m5/physics.spec.ts`, M5-05). The order of a tick, command categories, event order, removal during callbacks, pause/resume and the diagnostics `E8101`–`E8104` are unit-tested against a recording fake backend (`packages/runtime-web/src/physics/*.test.ts`, decision 0066).

The engine-level evidence of M5-06 (decision `spec/decisions/0068-physics-behaviour-evidence.md`, all in `tests/browser/specs/m5/`): `physics-sensor.spec.ts` (four balls through a sensor zone: exact enter and exit counts at both sides, in the derived ticks, a static body inside the zone makes no event), `physics-tunnelling.spec.ts` and `packages/physics-rapier/src/tunnelling.test.ts` (§7.1), `physics-callbacks.spec.ts` (handlers that destroy themselves, their partner or both and that spawn bodies, inside the delivery of one tick: no lost or doubled event, a consistent world), `physics-pause.spec.ts` (manual and real clock: a paused interval is never stepped), `physics-combinations.spec.ts` (the combinations of `spec/scenes.md` §10.3 around a real collision) and `physics-resources.spec.ts` (twenty mount/dispose cycles with live crates: bodies, colliders, buffers, bind groups, listeners at zero; 1 000 crates in waves of 50, then waves of 100: a bounded plateau that the largest wave sets and nothing else moves).

### 7.1 Known limitation: high-speed bodies (measured)

A dynamic body that moves farther in one fixed step than a thin obstacle is deep can skip it. The adapter has two modes: **continuous collision off**, the default, and **continuous collision on**, the host option `physics: { continuousCollision: true }` (decision [0193](decisions/0193-platform-runtime-extensions.md); coverage and mechanism in decision [0216](decisions/0216-continuous-collision-coverage.md)). Everything below is measured on the real engine (`rapier3d-compat@0.21.0`) at the fixed step 1/60 s. The table is generated by `npm run ccd:write` from `packages/physics-rapier/src/ccd-lanes.ts` into `evidence/movement/ccd-lanes.json` and between the markers below; `packages/physics-rapier/src/ccd-matrix.test.ts` asserts it, and `npm run ccd:check` fails when either file differs from a fresh measurement.

**Continuous collision on: the envelope.** Inside it no lane tunnels:

- *Shots:* a dynamic body of 1 kg whose radius or smallest half-extent is 0.05 m (a sphere of r 0.05 m, a cube of 0.1 m, a capsule of r 0.05 m and 0.3 m height flying broadside) that flies along the plate's normal at 3, 6, 9, 12, 20, 40, 60, 120 or 240 m/s, and at every 0.25 m/s from 1.5 to 14 m/s (the edge scan), in 16 start phases (500 in the fine scan).
- *Obstacles:* a plate of 4 m × 4 m and 0.01, 0.05 or 0.1 m thickness that is a static wall; a kinematic wall that moves 1 m/s toward the shot, or away from it at 1, 3 or 6 m/s; or a dynamic plate of 1 kg or 10 000 kg, at rest or (the 10 000 kg plate at 0.5 and 1 m/s, the 1 kg plate at 1 m/s) moving toward the shot.
- *Speed:* a plate at rest is not passed at any speed measured, up to 3 000 m/s; an obstacle that moves (the speeds above) is not passed at the nine matrix speeds and at 250 m/s.
- *Lanes D00 to D16 of the fixture* `physics_tunnel`, with the flag on every dynamic body as the mounted host sets it, are all stopped, D06 (9 m/s from 3.065 m) and D08 (12 m/s from 3.24 m) included (`ccd-matrix.test.ts` on the adapter, `tests/browser/specs/m5/physics-tunnelling.spec.ts` on the mounted host).

Outside it, measured and not fixed:

- *Obstacles that move faster on their own.* A kinematic wall moving 3 m/s toward the shot is still passed in some lanes (0 to 19 %, against 10 to 100 % with the flag off), one moving 12 m/s in 90 to 100 %; a dynamic plate moving 2 m/s toward the shot is passed in 4 to 35 % of the lanes, and one moving 6 or 12 m/s gains under 1 % of its lanes from continuous collision at shot speeds of 6 m/s and above. The engine sweeps a flagged body against the other body's pose at the start of the step, so the other body's own advance in that step is not covered; and a dynamic obstacle that itself moves more than its smallest half-extent plus 12.5 mm per step carries the flag and the engine does not sweep against a flagged obstacle. Where between 1 and 2 m/s the limit lies is not located.
- *Speed above 250 m/s against a moving obstacle:* a sphere passes a plate that moves 1 m/s toward it in every phase from 255 m/s (0.01 m plate) and from 400 m/s (0.05 m plate; 300 m/s is clean), and none up to 3 000 m/s through a 0.1 m plate; a cube and a capsule did not in the same lanes (table "Speeds above the matrix"). This is consistent with the contact step carrying a freshly stopped sphere a distance proportional to its speed into the plate (measured with Rapier's default parameters: 5.1 cm at 240 m/s, 2.5 cm at 120 m/s, 1.2 cm at 60 m/s; not re-derived for these lanes).
- *The prediction-distance band is closed, not proven absent.* The fine scan (last table) finds no tunnelled lane with the flag on in 36 000 lanes of the static wall and the 10 000 kg plate. Before the contact skin was added to the adapter, 3 of every 6 000 cube lanes started a step 20.0 to 20.1 mm in front of the plate, where neither the sweep nor the contact test looks (no sphere or capsule lane ever did); a band that narrow can hide from any finite scan.
- *Not measured:* other fixed steps, shots smaller than 0.05 m, oblique, spinning or tumbling shots, two fast bodies meeting, several obstacles in one step, bodies under gravity. The window model says smaller shots and larger steps skip more.
- *Teleports are not swept.* A body moved by `teleport(position, rotation, keep_velocity)` appears at its new pose; nothing between the two poses is tested, with the flag on or off (`ccd-matrix.test.ts`).

**Why lanes D06 and D08 tunnelled, and what the adapter does now.** The host set the flag on every dynamic body, the plate included. Rapier 0.21 does not sweep a body against an obstacle that has the flag too (measured: a flagged ball passes a flagged plate at rest, or one moving 0.05 m/s, that stops it when the plate has no flag), so the pairs that needed the sweep, a fast ball against a dynamic plate, were exactly the ones left to the discrete test; the one isolated adapter regression of decision 0193 flagged only the ball. The adapter now sets the flag before every step only on the bodies that move more than their smallest half-extent plus 12.5 mm (a body that moves less cannot skip anything), and clears it otherwise; and a world with a continuous body gets an allowed linear error of 0.1 mm instead of Rapier's 5 mm, which is both how deep a swept body was left inside the obstacle (a 240 m/s ball was carried through a 0.01 m heavy plate) and the width of a band beyond the 20 mm prediction distance that neither test covered (5 % of the start phases of a cube at 6 m/s); the colliders of continuous bodies get a contact skin of 0.2 mm, which widens the discrete test over what is left of that band. The skin keeps resting surfaces apart: 0.2 mm between a continuous body and static geometry, 0.4 mm between two continuous bodies (a stack of four crates stands 1.4 mm higher). Worlds without continuous collision keep Rapier's parameters and no skin. (Also tried and not adopted: more CCD substeps made a 240 m/s ball against a 0.01 m plate worse, more solver iterations helped only partly, and a skin of 5 mm closes the band but lifts every resting body 1 cm.)

<!-- ccd-lanes:begin -->
Generated by `npm run ccd:write` from `evidence/movement/ccd-lanes.json` (rapier3d-compat@0.21.0, fixed step 0.016666668 s, 16 start phases). Each entry is the share of lanes, in percent, in which the shot ended beyond the obstacle's centre: **continuous collision off / on**. A lane is one shot shape (sphere r 0.05 m, cube 0.1 m, capsule r 0.05 m and 0.3 m high), one thickness (0.01, 0.05, 0.1 m) and one start phase: 144 lanes per entry. "-" means the shot is not faster than the obstacle moving away.

**The published envelope** (continuous collision on: 0 tunnelled of 6480 lanes):

| Obstacle | 3 m/s | 6 m/s | 9 m/s | 12 m/s | 20 m/s | 40 m/s | 60 m/s | 120 m/s | 240 m/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| static wall | 0 / 0 | 1 / 0 | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| kinematic wall, 1 m/s toward the shot | 0 / 0 | 19 / 0 | 42 / 0 | 54 / 0 | 75 / 0 | 85 / 0 | 92 / 0 | 94 / 0 | 100 / 0 |
| kinematic wall, 1 m/s away from the shot | 0 / 0 | 4 / 0 | 29 / 0 | 48 / 0 | 69 / 0 | 85 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 10 000 kg, at rest | 0 / 0 | 10 / 0 | 35 / 0 | 50 / 0 | 69 / 0 | 85 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 1 kg, at rest | 0 / 0 | 10 / 0 | 35 / 0 | 50 / 0 | 69 / 0 | 85 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |

**Obstacles that move on their own, around the edge of the envelope:** an obstacle moving 1 m/s or less toward the shot (or away from it at any speed tested) is inside; faster ones are outside, with the result shown.

| Obstacle | 3 m/s | 6 m/s | 9 m/s | 12 m/s | 20 m/s | 40 m/s | 60 m/s | 120 m/s | 240 m/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| kinematic wall, 3 m/s toward the shot | 10 / 10 | 35 / 19 | 50 / 13 | 60 / 13 | 75 / 6 | 85 / 2 | 92 / 4 | 94 / 0 | 100 / 2 |
| kinematic wall, 6 m/s toward the shot | 35 / 48 | 50 / 46 | 60 / 38 | 69 / 32 | 77 / 21 | 85 / 19 | 92 / 20 | 94 / 13 | 100 / 27 |
| kinematic wall, 12 m/s toward the shot | 60 / 96 | 69 / 98 | 75 / 100 | 75 / 97 | 81 / 94 | 90 / 94 | 92 / 90 | 94 / 90 | 100 / 90 |
| kinematic wall, 3 m/s away from the shot | - / - | 0 / 0 | 10 / 0 | 35 / 0 | 67 / 0 | 85 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |
| kinematic wall, 6 m/s away from the shot | - / - | - / - | 0 / 0 | 10 / 0 | 58 / 0 | 83 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 10 000 kg, 0.5 m/s toward the shot | 0 / 0 | 15 / 0 | 38 / 0 | 54 / 0 | 71 / 0 | 85 / 0 | 90 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 10 000 kg, 1 m/s toward the shot | 0 / 0 | 19 / 0 | 42 / 0 | 54 / 0 | 75 / 0 | 85 / 0 | 92 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 10 000 kg, 2 m/s toward the shot | 4 / 4 | 29 / 23 | 48 / 23 | 58 / 25 | 75 / 31 | 85 / 29 | 92 / 33 | 94 / 31 | 100 / 35 |
| dynamic plate, 10 000 kg, 3 m/s toward the shot | 10 / 10 | 35 / 35 | 50 / 42 | 60 / 48 | 75 / 54 | 85 / 58 | 92 / 63 | 94 / 63 | 100 / 69 |
| dynamic plate, 10 000 kg, 6 m/s toward the shot | 35 / 19 | 50 / 50 | 60 / 60 | 69 / 69 | 77 / 77 | 85 / 85 | 92 / 92 | 94 / 94 | 100 / 100 |
| dynamic plate, 10 000 kg, 12 m/s toward the shot | 60 / 13 | 69 / 69 | 75 / 73 | 75 / 75 | 81 / 81 | 90 / 90 | 92 / 92 | 94 / 94 | 100 / 100 |
| dynamic plate, 1 kg, 1 m/s toward the shot | 0 / 0 | 19 / 0 | 42 / 0 | 54 / 0 | 75 / 0 | 85 / 0 | 92 / 0 | 94 / 0 | 100 / 0 |
| dynamic plate, 1 kg, 3 m/s toward the shot | 10 / 10 | 35 / 35 | 50 / 42 | 60 / 48 | 75 / 54 | 85 / 58 | 92 / 63 | 94 / 63 | 100 / 69 |
| dynamic plate, 1 kg, 12 m/s toward the shot | 60 / 13 | 69 / 69 | 75 / 73 | 75 / 75 | 81 / 81 | 90 / 90 | 92 / 92 | 94 / 94 | 100 / 100 |

**Edge scan** (continuous collision on): the speeds between the nine of the matrix, 1.5 to 14 m/s in steps of 0.25 m/s, against the obstacles of 1 m/s or less (a dynamic plate of 10 000 kg at rest, a kinematic wall toward or away, dynamic plates of 10 000 kg and 1 kg moving 0.5 or 1 m/s toward the shot), every shape and thickness, 16 phases: 0 tunnelled of 43920 lanes.

**Speeds above the matrix** (continuous collision on; tunnelled share of 144 lanes, in percent):

| Obstacle | 250 m/s | 255 m/s | 260 m/s | 300 m/s | 400 m/s | 1000 m/s | 3000 m/s |
|---|---:|---:|---:|---:|---:|---:|---:|
| static wall | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dynamic plate, 10 000 kg, at rest | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dynamic plate, 1 kg, at rest | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| kinematic wall, 1 m/s toward the shot | 0 | 11 | 11 | 11 | 22 | 22 | 22 |
| dynamic plate, 10 000 kg, 1 m/s toward the shot | 0 | 11 | 11 | 11 | 22 | 22 | 22 |

Shape and thickness of the rows with a tunnelled lane: sphere against kinematic wall, 1 m/s toward the shot, 0.01 m; sphere against kinematic wall, 1 m/s toward the shot, 0.05 m; sphere against dynamic plate, 10 000 kg, 1 m/s toward the shot, 0.01 m; sphere against dynamic plate, 10 000 kg, 1 m/s toward the shot, 0.05 m.

**Fine scan:** 500 start phases per cell instead of 16, at 6 m/s, 12 m/s, 60 m/s, 240 m/s, every thickness; tunnelled lanes of 6000 per shape. The last column is the gap between the shot's front and the obstacle's near face one step before the shot was past it, over the tunnelled lanes (the discrete contact test sees a pair closer than 20 mm).

| Continuous collision | Obstacle | Sphere | Capsule | Cube | Gap of the tunnelled lanes |
|---|---|---:|---:|---:|---|
| off | static wall | 0 | 0 | 97 | 20.0 to 25.0 mm |
| off | dynamic plate, 10 000 kg, at rest | 3744 | 3743 | 3743 | 20.0 to 3989.0 mm |
| on | static wall | 0 | 0 | 0 | - |
| on | dynamic plate, 10 000 kg, at rest | 0 | 0 | 0 | - |
<!-- ccd-lanes:end -->

**Continuous collision off (the default): unchanged.** The engine looks for contacts once per fixed step on the poses the previous step left. For a small ball (radius *r*) flying at a thin obstacle (thickness *t*) the ball is **stopped exactly when one of the poses the engine samples, `x₀ + k·v·dt`, lies within the window `t/2 + r + 0.02 m` before the obstacle's midplane** (0.02 m is the prediction distance, decision 0063 item 5), and flies through otherwise. Consequences, measured on the real engine at the 1/60 s step with a ball of radius 0.05 m and a wall of 0.1 m (window 0.12 m):

- A body that moves at most the window per step (`v·dt ≤ t/2 + r + 0.02`, here **7.2 m/s**) **cannot tunnel** whatever its phase. Above it a body tunnels in the share `1 − window / (v·dt)` of the phases (0.2 at 9 m/s, 0.4 at 12 m/s, 0.88 at 60 m/s; a ball that is not stopped keeps its speed). The first table above (left number of every entry) repeats this for plates of 0.01, 0.05 and 0.1 m, and a kinematic wall that moves toward or away from the shot behaves like a dynamic plate.
- This holds for a **dynamic body against a thin dynamic plate** and for a kinematic wall. Against a **static** wall a ball or a capsule was never seen to pass, from 3 to 100 000 m/s (1 667 m per step), through walls of 1 mm to 0.1 m: the engine protects the pair of a dynamic body and a fixed one. **A cube is not protected in one band:** it passes a static wall when it starts a step 20 to 25 mm in front of it, just beyond the prediction distance (fine scan above, continuous collision off: 97 of 6 000 cube lanes, no sphere or capsule lane). That narrows an earlier statement of this section, which was measured on balls only.
- What a program can do: keep thin walls static; for thin moving obstacles keep `v·dt` within the window or make the obstacle thicker (the window grows by half the thickness); clamp speeds in `fixed_update` with `set_linear_velocity`; or turn continuous collision on for the envelope above.

The numbers per lane and the derivations are in decision 0068 item 3; the continuous-collision matrix, its mechanism and the residuals are in decision [0216](decisions/0216-continuous-collision-coverage.md).

The second release demonstration, `examples/physics-playground/`, exercises impulses, spawn and destroy, sensor counts and the ownership rule together on the real engine (`tests/browser/specs/m5/playground.spec.ts`, and the failing fixture `tests/semantics/fail/e5071_playground_pose_writes`); see decision 0069.

### 7.2 Character movement operating ranges

Decision [0215](decisions/0215-character-movement-corpus.md) measures the character movement of decision 0214 (`moveCharacter`: support, carry, collide-and-slide, stairs, slopes, snapping) on the real Rapier adapter, for a capsule, a sphere and a box character, CPU only, driven exactly like the runtime tick (platform targets, `moveCharacter`, the character's kinematic target, `world.step()`). The corpus is `packages/physics-rapier/src/movement-corpus.test.ts`; the sweeps are `movement-harness.ts`, `movement-scenarios.ts` and `movement-ranges.ts` in the same directory. `npm run ranges -w @mtek/physics-rapier` writes `evidence/movement/operating-ranges.json` and regenerates the tables below; `npm run ranges:check -w @mtek/physics-rapier` fails when either differs from a fresh run, and the corpus tests fail on the same difference, so a behaviour change of the adapter or of the engine cannot pass unnoticed. Timings are never part of the document.

<!-- movement-ranges:begin -->
Generated from `evidence/movement/operating-ranges.json` (adapter rapier3d-compat@0.21.0, decision 0215) by `npm run ranges -w @mtek/physics-rapier`; do not edit by hand. Fixed step 1/60 s unless stated; options are the decision 0214 defaults (skin 0.01 m, snap 0.2 m, max slope 45 degrees, step height 0.25 m, minimum step width 0.1 m, carry on) unless a row varies them. Characters: capsule (radius 0.3 m, height 1.8 m), sphere (radius 0.5 m), box (0.6 x 1.8 x 0.6 m).

**Stairs, ascending.** Six steps, walking 2 m/s. Each cell lists risers 0.05 to 0.50 m by 0.05: `C` reaches the landing within 1.3 times the unobstructed time, `S` reaches it more slowly, `-` does not. The last column is the largest riser that climbs cleanly with every smaller riser also clean, and the largest riser that climbs at all.

| character | stepHeight (m) | tread 0.15 m | tread 0.30 m | tread 0.60 m | clean / any riser per tread (m) |
|---|---|---|---|---|---|
| capsule | 0.20 | `CC--------` | `CCCCC-----` | `CCCCC-----` | 0.10/0.10, 0.25/0.25, 0.25/0.25 |
| capsule | 0.30 | `CCS-------` | `CCCCCCC---` | `CCCCCCC---` | 0.10/0.15, 0.35/0.35, 0.35/0.35 |
| capsule | 0.40 | `CCC-------` | `CCCCCCCCC-` | `CCCCCCCCC-` | 0.15/0.15, 0.45/0.45, 0.45/0.45 |
| sphere | 0.20 | `CC--------` | `CCCCCS----` | `CCCCCC----` | 0.10/0.10, 0.25/0.30, 0.30/0.30 |
| sphere | 0.30 | `CC--------` | `CCCCCS----` | `CCCCCC----` | 0.10/0.10, 0.25/0.30, 0.30/0.30 |
| sphere | 0.40 | `CCS-------` | `CCCCCC----` | `CCCCCCCC--` | 0.10/0.15, 0.30/0.30, 0.40/0.40 |
| box | 0.20 | `CCCC------` | `CCCC------` | `CCCC------` | 0.20/0.20, 0.20/0.20, 0.20/0.20 |
| box | 0.30 | `CCCCCC----` | `CCCCCC----` | `CCCCCC----` | 0.30/0.30, 0.30/0.30, 0.30/0.30 |
| box | 0.40 | `CCCCCCCC--` | `CCCCCCCC--` | `CCCCCCCC--` | 0.40/0.40, 0.40/0.40, 0.40/0.40 |

**Stairs, minimum step width** (stepHeight 0.3 m, risers 0.05 to 0.40 m).

| character | tread (m) | stepMinWidth 0.10 m | stepMinWidth 0.30 m | stepMinWidth 0.60 m |
|---|---|---|---|---|
| capsule | 0.15 | `CCS-----` | `CS------` | `C-------` |
| capsule | 0.30 | `CCCCCCC-` | `CC------` | `CC------` |
| capsule | 0.60 | `CCCCCCC-` | `CCCCCC--` | `CC------` |
| sphere | 0.15 | `CC------` | `CC------` | `CC------` |
| sphere | 0.30 | `CCCCCS--` | `CCC-----` | `CCC-----` |
| sphere | 0.60 | `CCCCCC--` | `CCCCCC--` | `CCC-----` |
| box | 0.15 | `CCCCCC--` | `CCS-----` | `C-------` |
| box | 0.30 | `CCCCCC--` | `CCC-SS--` | `CCS-----` |
| box | 0.60 | `CCCCCC--` | `CCCCCC--` | `CCC-S---` |

**Stairs, stepping disabled and descending.** `stepHeight` 0 on risers 0.05 to 0.50 m (tread 0.6 m); descending a flight (tread 0.4 m, stepHeight 0.25 m) with `G` grounded on every tick and `a` airborne on some tick, with snap-to-ground 0.2 m and 0.

| character | stepHeight 0, climbed | descend, snap 0.2 m | descend, snap 0 |
|---|---|---|---|
| capsule | `CS--------` | `GGGGGGGGaa` | `aaaaaaaaaa` |
| sphere | `CCC-------` | `GGGGGGGGGG` | `aaaaaaaaaa` |
| box | `----------` | `GGGGaaaaaa` | `aaaaaaaaaa` |

**Slopes.** A ramp rising along the walk; the character walks at 2 m/s for 3.5 s (climb) or is pushed down at 3 m/s for 1 s on it (slide). Angles 5 to 85 degrees by 5; `C` climbs, `S` slides 0.5 m or more downhill. The fine columns are measured on a 0.25 degree grid around the limit.

| character | maxSlope (deg) | climbs (5..85) | slides (5..85) | climbs up to (deg) | slides from (deg) | height gained / predicted, 10 deg below limit |
|---|---|---|---|---|---|---|
| capsule | 30 | `CCCCC------------` | `......SSSSSSSSSSS` | 29.75 | 30.25 | 1.01 |
| capsule | 45 | `CCCCCCCCC--------` | `.........SSSSSSSS` | 45 | 45.25 | 1.0177 |
| capsule | 60 | `CCCCCCCCCCCC-----` | `............SSSSS` | 60 | 60.25 | 1.0262 |
| sphere | 30 | `CCCCC------------` | `......SSSSSSSSSSS` | 29.75 | 30.25 | 1.0163 |
| sphere | 45 | `CCCCCCCCC--------` | `.........SSSSSSSS` | 45 | 45.25 | 1.0292 |
| sphere | 60 | `CCCCCCCCCCCC-----` | `............SSSSS` | 60 | 60.25 | 1.0432 |
| box | 30 | `CCCCC------------` | `......SSSSSSSSSSS` | 29.75 | 30.25 | 1.0548 |
| box | 45 | `CCCCCCCCC--------` | `.........SSSSSSSS` | 45 | 45.25 | 1.055 |
| box | 60 | `CCCCCCCCCCCC-----` | `............SSSSS` | 60 | 60.25 | 1.0554 |

| character | descent grounded, snap 0.2 m (5, 15, 25, 35, 45 deg) | descent grounded, snap 0 | largest ground-normal error (rad) |
|---|---|---|---|
| capsule | `GGGGG` | `aaaaa` | 0.0004 |
| sphere | `GGGGG` | `aaaaa` | 0.0003 |
| box | `GGGGG` | `aaaaa` | 0.0001 |

**Walls and corners.** Walking at 3 m/s for 3 s into a wall whose normal is 0, 15, 45 or 75 degrees off the walking direction; then into an inside corner of 90, 45 and 30 degrees for 8 s (straight and 20 degrees to either side). Penetration is measured against the wall planes with the shape's own extent.

| character | largest penetration | slide ratio at 0, 15, 45, 75 deg | jitter in the last 2 s at 90, 45, 30 deg |
|---|---|---|---|
| capsule | 0.0 mm | 0, 0.9812, 0.9982, 0.9987 | 1.7 mm, 0.0 mm, 0.0 mm |
| sphere | 0.0 mm | 0, 1.0004, 0.9938, 0.9997 | 3.1 mm, 0.0 mm, 0.0 mm |
| box | 0.0 mm | 0, 0.9741, 0.9874, 1 | 1.2 mm, 0.0 mm, 0.0 mm |

**Ceilings, gaps, thin walls and bumps.** Passable thresholds are the smallest margin on a 5 mm grid over the character's height (ceiling) or width (gap). Thin walls are 0.01 m thick; the character is asked for the given distance per tick towards one, head-on and at 45 degrees, from eight phases each (16 runs); a pass is the centre ending beyond the wall. Bumps are 0.3 m deep blocks of 0.05 to 0.35 m (stepHeight 0.25 m) with gravity applied by the program.

| character | ceiling passable from (m over height) | gap passable from (m over width) | no thin-wall pass up to (m per tick) | thin-wall passes at 2, 5, 25, 100 m per tick | bumps 0.05..0.35 (P passes) |
|---|---|---|---|---|---|
| capsule | 0.02 | 0.025 | 1 | 1/16, 0/16, 0/16, 1/16 | `PPPPPP-` |
| sphere | 0.02 | 0.02 | 50 | 0/16, 0/16, 0/16, 2/16 | `PPPPPP-` |
| box | 0.025 | 0.025 | 100 | 0/16, 0/16, 0/16, 0/16 | `PPPPP--` |

**Moving platforms** (kinematic 12 x 12 m deck, carry on). The platform moves for 1.5 s and then rests for 1.5 s, so each run measures an abrupt start and an abrupt stop. Drift is the largest distance, in the platform's frame, between where the character stands and where it should stand (0 means exact to 0.1 mm). Horizontal 0.5 to 10 m/s, vertical up and down 0.5 to 5 m/s, yaw 0.1 to 3 rad/s with the character 0 to 4 m from the centre; walking runs add a character walking 1 to 1.5 m/s on the deck (and, for the vertical run, program gravity).

| character | horizontal drift | vertical drift | yaw drift | walking drift | airborne ticks (all runs) | carry false: character moved while the platform moved 3 m |
|---|---|---|---|---|---|---|
| capsule | 0.0 mm | 0.0 mm | 0.1 mm | 0.1 mm | 0 | 0 m |
| sphere | 0.0 mm | 0.0 mm | 0.2 mm | 0.2 mm | 0 | 0 m |
| box | 0.0 mm | 0.0 mm | 0.0 mm | 0.0 mm | 0 | 0 m |

**Variable fixed step.** The same velocity-driven course for 3 s at 1/30, 1/60, 1/120 and 1/144 s (displacement = velocity x step): flat walk at 4 m/s, a six-step flight at 2 m/s (riser 0.15 m, tread 0.3 m), a 25 degree ramp at 2 m/s, a platform at 2 m/s carrying a character walking 1 m/s. The spread is the largest difference between the four final positions.

| character | flat | stairs | slope | platform |
|---|---|---|---|---|
| capsule | 1.0 mm | 346 mm | 0.0 mm | 0.0 mm |
| sphere | 9.0 mm | 79 mm | 1.0 mm | 0.0 mm |
| box | 5.0 mm | 327 mm | 2.0 mm | 0.0 mm |
<!-- movement-ranges:end -->

What the tables establish (each statement is asserted by the corpus tests):

- **Stairs.** A box character climbs a flight cleanly exactly when `riser <= stepHeight` (measured on a 0.05 m grid of risers, treads 0.15, 0.3 and 0.6 m, stepHeight 0.2, 0.3 and 0.4 m), at about full walking speed. A capsule or a sphere climbs cleanly every riser up to `stepHeight` whose incline `atan(riser / tread)` is at most 40 degrees; it may also climb up to 0.10 m more (it rolls over the nosing) and never more than that. Where the incline of the flight exceeds the maximum slope (a 0.15 m tread is narrower than both rounded characters), these characters climb only risers of 0.05 to 0.15 m: they stand on the nosings like on a ramp. The minimum step width counts the risers inside it: a box climbs cleanly exactly when `(1 + floor((stepMinWidth + skin) / tread)) * riser <= stepHeight`, so a flight whose treads are narrower than `stepMinWidth` needs proportionally smaller risers. `stepHeight` 0 disables stepping for the box; round characters still roll over a riser of up to `radius * (1 - cos(maxSlope))` (about 0.09 m for the capsule, 0.15 m for the sphere) because that is a slope, not a step. Without `snapToGround` a character descending stairs or a slope is airborne on some tick; with 0.2 m it stays grounded for every riser up to 0.2 m (the box) or more (round characters roll).
- **Slopes.** The limit is `maxSlope` within 0.25 degrees: walkable below it, no height gained above it, and a downward push slides the character down from just above it. The reported ground normal matches the slope within 0.4 mrad. Climbing keeps the horizontal request projected onto the slope, so the height gained is `sin * cos` of the walked distance (the measured ratio to that prediction is 1.01 to 1.06).
- **Obstacles.** No character penetrated a wall or an inside corner (90, 45 and 30 degrees) at any tested approach; the worst jitter in the last 2 s of pushing into a corner is 3.1 mm. A ceiling or a gap is passable from twice the skin (0.02 m) plus at most 5 mm over the character's height or width. A 0.01 m static wall stops every character asked for up to **1 m per tick** (60 m/s at 1/60 s) head-on and at 45 degrees. Above that the document records occasional passes (capsule: 1 of 16 runs at 2 m and at 100 m per tick; sphere: 2 of 16 at 100 m): the cause was not isolated (in the capsule case the controller returned a whole diagonal move with no contact from a pose 9.92 mm from the wall, 0.08 mm inside the skin, the second tick after first contact; the same pose with other displacements is blocked) and no claim is made above 1 m per tick.
- **Platforms.** A character on a kinematic platform is carried by its translation and yaw with drift below 1 mm (0.2 mm at most in the measurements; horizontal 0.5 to 10 m/s, up and down 0.5 to 5 m/s, yaw 0.1 to 3 rad/s at 0 to 4 m from the centre, with abrupt starts and stops, and while walking), never leaves the ground and is never left behind; with `carry` false it is not carried.
- **Variable fixed step.** Flat walking, a slope and a platform agree within 10 mm, 5 mm and 1 mm across 1/30, 1/60, 1/120 and 1/144 s (3 s of velocity-driven walking); a flight of stairs agrees within 0.4 m only (see below).

Not claimed (excluded from the envelope, with the measured cause): stairs final position across fixed steps agrees only within 0.35 m after 3 s (six risers): every riser costs the character the part of the tick it is blocked in, and a coarser step loses more of it. Resting height over flat ground varies by up to 9 mm between steps (the sphere at 1/30 s): Rapier's iterative shape casts stop early for some shape pairs, which the adapter's overlap guard bounds but cannot remove. Characters are not pushed by kinematic bodies that are not their support, and a collider added in a tick is not seen by `moveCharacter` until the next `step` (queries see the world as of the last completed step).

Cost (informative, not a published range; Windows 11, Node 24, this development machine): 100 characters in one world cost 8 to 14 microseconds per `moveCharacter` call and 9 to 16 per character and tick including `world.step`, so 100 characters use about 1.5 ms of a 16.7 ms tick. Rapier's own controller call is 5 microseconds of that; keeping one controller per world instead of one per call saves about 1.5 microseconds per call. `npm run ranges -w @mtek/physics-rapier -- --cost` prints it.

## 8. Physics diagnostic codes

Compile time (in `spec/diagnostics.md` §5.5, added by M5-03): `E5120` collider without body · `E5121` body without collider · `E5122` scaled dynamic or kinematic body · `E5123` command not valid for this body kind · `E5124` capsule collider not taller than its caps (decision 0217). Runtime (§5.8, catalogued by M5-03, reported by M5-05): `E8101` command not valid for the target's body kind · `E8102` physics module failed to load (mount fails with the dedicated kind `"physics-failed"`, added to `MtekMountError.kind` in M5) · `E8103` non-finite pose produced by the solver (body frozen, reported once) · `E8104` non-finite value given to a body (a command argument, or the initial pose of a body; decision 0066) · `E8105` physics adapter cannot move characters (a `move_character` for a body whose loaded adapter has no `moveCharacter`; dropped, once per body; decision 0217).
