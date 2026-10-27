# Character Movement

The demonstration of decision 0218 (acceptance item 8 of [decision 0214](../../spec/decisions/0214-complete-character-movement.md)): a capsule that walks, jumps, climbs stairs and slopes, stops at ledges, steep slopes, walls and corners, and rides a sliding platform, a lift and a turntable. It is Mtek source only: gravity, jumping, input and the camera are the program's own code, and the host does nothing but mount it.

```
examples/character-movement/
  mtek.toml          the project and its scene (Course)
  src/main.mtek      the whole program (about 400 lines, mostly the geometry of the course)
```

## Controls

| Key | What happens |
|---|---|
| Arrows or WASD | walk at 4 m/s in the world's x and z |
| Space | jump (5 m/s up, 1.27 m high) while `grounded` |
| R | back to the start (-6, 0, 0) |
| 1 | station 1: the foot of the stairs |
| 2 | station 2: in front of the ledge |
| 3 | station 3: the foot of the slope of 30 degrees |
| 4 | station 4: the foot of the slope of 60 degrees |
| 5 | station 5: on the sliding platform |
| 6 | station 6: on the lift |
| 7 | station 7: on the turntable |
| 8 | station 8: near the corner of the arena |

Each station is a `teleport` of the character, so a station is also what a test starts from. Falling into the chasm (below y = -8) starts again.

## What it shows

| Feature | Where |
|---|---|
| A `Kinematic` body with a `CapsuleCollider` and character settings | `Player`: `body: Kinematic { max_slope: 0.7853982; step_height: 0.3; }`, a capsule of radius 0.3 m and height 1.8 m |
| Collide-and-slide, walls and corners | `Player.fixed_update` calls `move_character(velocity * dt, rotation)`; the walls of the arena stop it a skin (0.01 m) away |
| Gravity and jumping in the program | `Player.vy`: integrated every tick, zeroed when `grounded`, set to 5 m/s by Space |
| `grounded` and `ground_normal` | read at the top of `fixed_update`; the HUD says "on the ground" or "in the air", and `ground_up` (the y of the normal) is 0.866 on the slope of 30 degrees |
| Stairs under `step_height` | six steps of 0.2 m (lane at z = -9): climbed at walking speed |
| A ledge above `step_height` | 0.6 m (lane at z = -3): the character stops at its face and has to jump |
| Slope limit | a ramp of 30 degrees (z = 3), walkable up to the landing 3 m high, and one of 60 degrees (z = 9), which the character cannot climb (`max_slope` is 45 degrees) |
| Platform carry | `Slider` (horizontal, over a chasm), `Lift` (vertical, 0.2 m to 3.2 m) and `Turntable` (yaw at 0.5 rad/s) are kinematic bodies that call `set_kinematic_target` every tick; the character on them is carried, and on the turntable it also turns with it (the white nose shows the facing) |
| Display-rate independence | everything moves in `fixed_update`; `update` only moves the camera, which follows the character at a fixed offset |

The platforms keep their own time in an entity state (`clock`, advanced by the fixed `dt`), not `frame.time`, so a run is the same at every display rate.

## Run

```bash
mtek check examples/character-movement      # 0 errors, 0 warnings
mtek build examples/character-movement      # writes examples/character-movement/dist, including physics/<hash>.js
mtek dev examples/character-movement        # serves it
```

## Tests

- `tests/browser/specs/movement/character.spec.ts` (hardware and software adapters, manual clock, scripted keys): the stairs are climbed and the ledge is not; the slope of 30 degrees is climbed and the one of 60 degrees is not; `grounded` is true standing and false mid-jump; the character stays on the sliding platform, the lift and the turntable for several seconds with a drift well under a millimetre; the same script under frame times of 1/30, 1/60 and 1/144 s and a jittery pattern gives positions that are bit-for-bit equal; from the page, `app.physics.castRay` hits the expected entity, `contacts` lists the floor and `setCollisionGroups` changes what a cast sees; resources are released after `dispose`. The measured values are in [decision 0218](../../spec/decisions/0218-character-movement-demonstration.md).
- `tests/browser/support/movement-drive.test.ts`: the scripted-input plans against a model of the runtime's accumulator, and the example's source against the lines the spec's model transcribes.
- `crates/mtek-cli/tests/cli.rs`: every example under `examples/` checks clean, this one included.
- `budgets/small-games.json`: the size budget of the game package.
