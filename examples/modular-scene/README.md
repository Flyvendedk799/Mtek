# Modular Scene

The third release demonstration (decision 0002, task M7-01, [decision 0092](../../spec/decisions/0092-modular-scene-example.md)): a small showroom built from five files. A theme of constants, one material, two prefabs and a scene that only places things. The point is reuse across files: the same prefab instantiated with different params, a material imported by three modules, constants and a function imported by the files that need them, and a prefab of one file spawned from another.

```
examples/modular-scene/
  mtek.toml                  the project and its scene
  src/main.mtek              the entry: the Showroom scene (imports the other four)
  src/theme.mtek             the palette, the pillar width, the row P places pillars in, and the function half()
  src/materials.mtek         Matte, a flat colour scaled by a dim factor; imported by main, pillar and beacon
  src/props/pillar.mtek      the Pillar prefab: a box of a given height standing on the floor
  src/props/beacon.mtek      the Beacon prefab: a lamp that bobs and pulses with the clock and counts Space presses
  tests/*.test.toml          four `mtek test` fixtures
```

```
main.mtek ──► theme.mtek
    │  ╲
    │   ╲──► materials.mtek ──► theme.mtek
    ├──────► props/pillar.mtek ──► theme.mtek, materials.mtek
    └──────► props/beacon.mtek ──► theme.mtek, materials.mtek
```

## Controls

| Key | What happens |
|---|---|
| Space | each of the two `Beacon`s counts a flash; the gauge on the right grows by half a metre per flash (a metre per press) |
| P | the next `Pillar` of the back row is placed (the first at x = -2.4, then every 2.4 m, 1 m tall and half a metre taller each); at most four, a fifth press does nothing |

## What it shows

| Feature | Where |
|---|---|
| Five modules, imports in a chain and fan-in | the diagram above; `theme.mtek` is imported by four files |
| A material imported by three modules | `Matte` is declared in `materials.mtek` and used by `Pillar`, `Beacon` and the scene's `Floor` and `Gauge`; the build has one material and one shader |
| Constants and a function imported across files | `CLEAR`, `SLATE`, ... `MAX_PLACED` in `main.mtek`; `PILLAR_WIDTH`, `STONE` and `half()` in `pillar.mtek`; `GOLD` in `beacon.mtek` |
| Prefabs declared in another file | `Pillar` and `Beacon` are `export prefab`s, imported by `main.mtek` |
| Several instances of one prefab with different params | `Left` (every default), `Middle` (`height`, `tint`), `Right` (`height`, `width`, `tint`); `Lantern` and `Lamp` (`rate`, `tint`) |
| Param defaults taken from imported constants | `param width: f32 = PILLAR_WIDTH;`, `param tint: color = STONE;` |
| A prefab field computed from params by an imported function | `position: origin + vec3(0.0, half(height), 0.0);` |
| `bind` inside a prefab, over params and the clock | `Beacon`'s `position` and the `dim` of its material |
| Prefab state read from the scene file | `Gauge` is bound to `Lantern.flashes + Lamp.flashes`; the state and its handler (`on key_down(Key.Space)`) are in `beacon.mtek` |
| `spawn` of a prefab declared in another file, with run-time params | the P handler: `spawn(Pillar { origin: ..; height: ..; tint: .. })` |
| Compatible instancing across files | entities with one mesh and equal params share a parameter block and are one draw: `Left` and `Gauge`, and every teal or rose pillar |

The scene file declares no prefab and no material: everything reusable lives in the files it imports, and the scene only says where things go.

## Run

```bash
mtek check examples/modular-scene      # 0 errors, 0 warnings
mtek build examples/modular-scene      # writes examples/modular-scene/dist
mtek dev examples/modular-scene        # serves it
```

## Tests

- `tests/browser/specs/m7/modular-scene.spec.ts` (hardware adapter, manual clock): the manifest lists the five sources in load order, one material, one shader and the prefabs under the files that declare them; three pictures (at rest, after two presses of Space and five of P, and after the clock has run to one second) are compared on a grid with the CPU reference of `tests/browser/support/m1-reference.ts`, fed by the model in `tests/browser/support/m7-modular-scene.ts` (unit-tested in `m7-modular-scene.test.ts`, including the import graph read from the sources). The state, the live-entity and spawn counters, the positions of the named entities and of the spawned pillars, and the draw counters (`drawCalls`, `instancedDraws`, derived from the sharing rule of decision 0059) are asserted against the same model.
- `tests/semantics/fail/e2033_modular_scene_prefab_not_exported`: the example in three files with `export` missing from the prefab; `mtek check` reports exactly one `E2033`, at the name in the importing file, with the declaration in the other file as related span, and does not report the instances or the `spawn` again.
- `crates/mtek-cli/tests/cli.rs`: every example under `examples/` checks clean; the real source of this example with `export` taken off `Pillar` is rejected with exactly that `E2033`, and with `export` taken off `Matte` with one `E2033` in each of the three modules that import it.
- `tests/browser/specs/m6/mtek-test.spec.ts` runs the fixtures below through the real CLI, and two mutations of one expectation each (the gauge's centre, an instanced-draw count) fail at their step and line.

## `mtek test`

`tests/*.test.toml` are declarative fixtures that `mtek test examples/modular-scene` runs (decision 0074). The derivations are at the top of each file, and `tests/browser/support/mtek-test/example-fixtures.test.ts` recomputes them without a GPU from the example's sources and the CPU reference:

| Fixture | What it checks |
|---|---|
| `instances-and-defaults` | the five instances before any time has passed: centres from `origin` and `half(height)`, the tint of each, the beacons at rest, the pixel of each, 7 live entities and 6 draw calls (one instanced) |
| `beacons-bob-and-pulse` | `Lantern` (rate 1) and `Lamp` (rate 2) at t = pi/4, 3 pi/4, pi and 3 pi/2: the bob, the `dim` and the sphere's pixel |
| `space-grows-gauge` | three presses of Space: the gauge's centre and its pixels, with `flashes` read from the prefab's file |
| `p-places-pillars` | four presses of P place four pillars (pixels, `placed`, the spawn counter, the draw counters) and the fifth places none |

`expect_state` cannot address a scale or a spawned entity (decision 0074), so the gauge's length is checked through its centre and its pixels, and the placed pillars through their pixels; the browser spec reads both from `app.debug.scene()`.
