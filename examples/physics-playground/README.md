# Physics Playground

The second release demonstration (decision 0002, task M5-07, [decision 0069](../../spec/decisions/0069-physics-playground.md)): a small interactive physics scene. A floor, a crate called `First`, crates that rain down when you ask, a sensor zone that counts them, and a bar that makes the count visible.

```
examples/physics-playground/
  mtek.toml          the project and its scene
  src/main.mtek      the whole program: the Crate prefab and the Playground scene (about 130 lines, commented)
```

## Controls

| Key | What happens |
|---|---|
| Space | `First` (the orange crate on the left) gets an impulse of 10 N·s straight up: it leaves the floor at 5 m/s, rises 1.27 m and comes back down |
| C | a crate appears 6 m above the floor at a random x in [-9, 9) and z in [-2.5, 2.5) and falls |

`random()` is seeded per application by the mount option `seed` (without one, from the time), so the same seed gives the same sequence of positions. The browser spec mounts with `seed: 166`.

## What it shows

| Feature | Where |
|---|---|
| A prefab with a body, a collider and a material | `prefab Crate` |
| A named instance of the prefab with its own params | `entity First: Crate { .. }` |
| Static bodies and colliders | `Floor`, `Zone` |
| A body command from a handler | `First.body.apply_impulse(..)` in the Space handler |
| `spawn` at a seeded random position | the C handler: `random()`, `spawn(Crate { origin: .. })` |
| `destroy` from a lifecycle function | `Crate.fixed_update`: a crate that falls below `KILL_HEIGHT` destroys itself, and its body leaves the physics world with it |
| A sensor and collision events | `Zone` has `sensor: true`; its `collision_enter` and `collision_exit` handlers keep `entered` and `inside`. `other` is an `entity_ref`: it can be compared with a named entity (`other != First`), not read |
| Single ownership of the pose | the solver owns `position` and `rotation` of every `Crate`: nothing here assigns them, and `mtek check` rejects a program that does (`E5071`, see below) |
| `bind` next to physics | `Meter`, a bar whose `position` and `scale` are bound to `entered` |

The floor is 14 units long and crates are spawned over 18, so some crates miss it: they fall past the floor, sink below `KILL_HEIGHT` (-10) and are destroyed. The green plate on the floor marks the sensor zone (x in [2, 6], z in [-3, 3]); the zone itself floats half a unit above the floor, so only crates touch it, and it has no mesh.

The state `entered` (crates that have entered the zone), `inside` (crates in it now) and `spawned` is what the browser spec reads with `app.debug.scene()`; the yellow bar at the top left is `entered`, 0.4 units long plus half a unit per crate.

## Run

```bash
mtek check examples/physics-playground      # 0 errors, 0 warnings
mtek build examples/physics-playground      # writes examples/physics-playground/dist, including physics/<hash>.js
mtek dev examples/physics-playground        # serves it
```

The physics engine is a separate, lazily loaded file (`dist/physics/<hash>.js`, named by `subsystems.physicsModule` in the manifest); a program without bodies never fetches it. To mount with a fixed seed from your own page:

```js
import program, { mountMtek } from "./dist/app.js";
mountMtek(document.getElementById("mtek"), program, { seed: 166 });
```

## Tests

- `tests/browser/specs/m5/playground.spec.ts` (hardware adapter, manual clock, one fixed tick per frame): Space lifts `First` by the height `v² / 2g` derived from the impulse, the mass and gravity; six seeded crates come to rest at the derived height; the sensor counts exactly the crates the geometry says enter and does so within two ticks of the derived time of arrival; the crates that miss the floor are destroyed at the derived tick and the body counters drop; the meter has the width the camera projection derives; the same seed gives the same crates. The model it compares with is `tests/browser/support/m5-playground.ts` (unit-tested in `m5-playground.test.ts`).
- `tests/semantics/fail/e5071_playground_pose_writes`: the playground-shaped program with the three mistakes its handlers avoid (assigning the position of a crate to lift it, assigning `self.position` to put a fallen crate back, assigning a rotation) is rejected with `E5071` at each write.
- `crates/mtek-cli/tests/cli.rs`: every example under `examples/` checks clean, and the real source of this example with two of those mistakes edited in is rejected with exactly two `E5071`.

Evidence of the hardware run is in `evidence/M5/`.

## `mtek test`

`tests/*.test.toml` are declarative fixtures that `mtek test examples/physics-playground` runs with seed 166 (decision 0074): `space-lifts-first` (the lift derived from the impulse, the return to rest, the step counter) and `crates-and-sensor` (the seeded crates, the sensor counts at the derived ticks, the destroyed crates, the meter pixels). The derivations are at the top of each file.
