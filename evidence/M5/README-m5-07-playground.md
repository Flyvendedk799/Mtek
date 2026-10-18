# M5 evidence: task M5-07 (the physics playground)

This file records the run of task M5-07 only. It is **not** the M5 gate report and does not cover the other M5 work items' own runs.

- Commit under test: `0ccd476` (branch `task/m5-07-physics-playground`, `gitDirty: false` in the environment record). Windows 11, Node 24.18.1, Chromium through Playwright 1.63.
- Hardware adapter: AMD Radeon RX 7900 XTX (`isFallbackAdapter: false`), see `environment-m5-07-hardware.json`.
- `npm run evidence:sanitize` made the paths of the Playwright report repo-relative; the cargo and unit logs keep only their summary lines; the environment record, the counters, the lift record and the two pictures are the files the spec wrote, unchanged.

| File | Command | Result |
|---|---|---|
| `test-results-m5-07-hardware.json`, `environment-m5-07-hardware.json` | `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware` | **205 passed, 0 failed, 0 not-run** (the 202 of `main` and the 3 new specs) |
| `m5-playground-counters.json`, `m5-playground-lift.json`, `m5-playground-before.png`, `m5-playground-final.png` | written by `specs/m5/playground.spec.ts` in that run | the numbers quoted below; the picture before any press and after six presses and 900 ticks |
| `cargo-test-m5-07.txt` | `cargo test --workspace --locked` | **1231 passed, 0 failed, 1 ignored** |
| `unit-tests-m5-07.txt` | `npm run test:unit` | 1205 + 61 + 239 + 1059 + 74 (+1 skipped, as before) + 8 passed, 0 failed (includes the 10 tests of `tests/browser/support/m5-playground.test.ts`) |
| (not kept) | `npm run check` | passed: `cargo fmt --check`, clippy `-D warnings` (also with `packages/runtime-web/dist` moved away), `tsc -b`, eslint, naming, tasks, `check:assets` |

## What the spec measured (hardware, seed 166, manual clock, one fixed tick per frame)

Every expected value is derived by the model of `tests/browser/support/m5-playground.ts` from the program's constants, its geometry and the engine's documented integration (decision 0069 item 6); none is read back from the runtime.

| Claim | Derived | Measured |
|---|---|---|
| Space lifts `First` (10 N·s on 2 kg) | rise `v²/2g` = 1.2742 m, tolerance 2.5 cm (the four substeps lower the peak by about `v·dt/2`); apex 30.6 ticks after the impulse, tolerance 2 ticks | rise **1.2635 m** (10.7 mm under, as the substeps predict), apex at tick **29**; back at rest at y = 0.49993 with no sideways movement |
| Seeded crates appear where `random()` puts them | the model's xoshiro128** for seed 166: (5.964, 0.396), (-7.960, 0.915), (7.873, 1.852), (-0.232, -2.027), (2.550, 2.030), (-3.084, 2.479) | identical to 4 decimals; each created at y = 6 − 1.7 mm (`fallDistance(1)`); the same seed in two mounts gives the same crates, another seed others |
| Crates on the floor come to rest | y = 0.5 within 10 mm, still within 2 mm over ten ticks | y = **0.49993** for the four crates that stayed; each slid 1.5 cm in x and 1.0 cm in z at the impact (the engine's, identical for every crate; tolerance 3 cm) |
| The sensor counts exactly | the two crates whose footprint overlaps x in [2, 6] (x = 5.96 and 2.55) enter at tick `fallTicks(3)` = 47, delivered within two ticks; the other four never | `entered` rose 0 → 1 → 2 at tick **48** after each of the two presses and at no other time; `inside` = `entered` = **2** at the end |
| Crates that miss the floor are destroyed | x = -7.96 and 7.87 pass y = -10 at tick `fallTicks(16)` = 109; removal at tick 110 to 112; `physicsBodies` and `liveEntities` drop by one, `entitiesDestroyed` rises by one | both destroyed at tick **110**; at the end `entitiesSpawned` 6, `entitiesDestroyed` 2, `physicsBodies` 7 (Floor, First, Zone and four crates), `physicsFrozenBodies` 0, `pendingSpawns` 0, `pendingRemovals` 0, `physicsSteps` 960 |
| The meter shows the count | the columns of the eight corners of the bar projected through the camera, within 2 px | before any entry: columns 243 to 259; after two: 243 to 288 (left end fixed, +29 px) |
| No diagnostics | none reported by `onDiagnostic` in any run | none |

Sensitivity (by hand, each change reverted): halving the impulse in the example fails the lift spec (rise 0.96 m off); `sensor: false` fails the sensor spec at the first zone crate (`entered` stays 0); replacing `destroy(self)` fails the destroy spec at the first crate that misses the floor.

## Compile-time ownership

`tests/semantics/fail/e5071_playground_pose_writes` (three `E5071`, blessed) and the CLI test that edits the real example's source into two writes and requires exactly two `E5071` are in `cargo-test-m5-07.txt` (`cargo test -p mtek-compiler --test fixtures`, `cargo test -p mtek-cli --test cli`).

## Not covered

- Only this machine's adapter and driver; the software project ran the same specs only as informational runs and is not hardware evidence. Cross-adapter equality is not claimed.
- Manual-clock frames into an offscreen target; the on-screen loop and real keyboard input of `mtek dev` are not asserted here.
- A crate leaving the zone (an exit event) is not exercised by this example; a crate that straddles the floor's end, lands on another, or a long run of spawns are outside the derivation (the seed avoids them and the spec refuses a seed that does not).

## Defects found

None. No compiler or runtime change was needed (decision 0069 item 9).
