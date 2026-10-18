# Material Configurator

The first release demonstration (decision 0002, task M4-10): a chair that a host page re-colours at run time. It is a multi-file Mtek program that loads a model, shades it with the documented PBR subset, takes its material inputs from the host, and runs one custom fragment material.

```
examples/material-configurator/
  mtek.toml              project, the scene, and [host.inputs]: the ten inputs the host may set
  models/chair.glb       the model (generated, see below)
  src/model.mtek         declares the GLB once (asset.glb) and exports constants read from its materials
  src/materials.mtek     the custom fragment material `Striped` (stripes from the mesh's uv, lit by lighting.pbr)
  src/main.mtek          the scene: camera, a directional and a point light, and the entities
  host/configurator.html a host page: mounts dist/app.js and forwards its controls to app.setInput
```

## What it shows

| Feature | Where |
|---|---|
| Several modules, `import` and `export` of constants and a material | `src/main.mtek` imports from `model.mtek` and `materials.mtek` |
| A static GLB, used through accessors by name | `CHAIR.mesh("Seat")`, `CHAIR.primitive("Rails", 1)`, `CHAIR.node_position("LegFL")`, `CHAIR.node_rotation(..)`, `CHAIR.material("Oak")`, `CHAIR.material_base_color("Fabric")` |
| Built-in `Pbr` with inputs bound to scene state | the seat (`seat_color`, `seat_metallic`, `seat_roughness`) and the rails (`frame_*`) |
| Host inputs | `[host.inputs]` in `mtek.toml`; `app.setInput("seat_color", "#2e7d32")` |
| A custom fragment material | `Striped`: two colours and a band count, `fract(uv.y * bands)`, lit by `lighting.pbr` |
| Lights and ambient light | `Sun` (directional, `sun_intensity` is an input), `Lamp` (point, with a range), `ambient_*` |
| Compatible instancing | the four legs are one mesh with the model's constant `Oak` material: one parameter block, one instanced draw |

## The model

`models/chair.glb` is not a download and not exported from an authoring tool. It is written from explicit data (a seat, a back, a crest rail, four tapered legs, two rails as the two primitives of one mesh, a floor, a node hierarchy with a turn of the whole chair and a lean of the back) by the generator of the asset fixtures:

```bash
node tests/assets/tools/make-glb.mjs           # writes every generated file, this model included
node tests/assets/tools/make-glb.mjs --check   # fails if a committed file differs (part of `npm run check`)
```

The output is byte-for-byte reproducible; `tests/browser/support/chair-glb.test.ts` regenerates it into a scratch directory and compares the bytes with the committed file. The numbers (dimensions, transforms, materials) are the comment at the top of the "material configurator" section of `make-glb.mjs`, and the browser specs derive every expected pixel from them.

**This is one supported model, not a claim of broad glTF support.** The compiler accepts the profile in `spec/assets.md` section 3 and rejects everything else with an error that names the feature (a normal texture is `E7016`, a required extension `E7004`, a skin `E7019`, and so on); the specs build this example with a normal texture and with a required extension in its GLB and check that `mtek check` and `mtek build` fail at the path of `asset.glb(..)`, and a consistency test checks that every row of the profile table has a failing fixture.

## Run

```bash
mtek check examples/material-configurator      # 0 errors, 0 warnings
mtek build examples/material-configurator      # writes examples/material-configurator/dist
mtek inspect --assets examples/material-configurator
```

`mtek dev` serves the generated `index.html`, which mounts the program with its defaults. To use the host page, serve the project directory (any static server on `localhost`; WebGPU needs a secure context) after building, and open `host/configurator.html`:

```bash
npx serve examples/material-configurator       # then http://localhost:3000/host/configurator.html
```

## The host page

`host/configurator.html` imports `../dist/app.js` and mounts it on its canvas. Each control carries the name of an input in `data-input`; moving it calls `app.setInput(name, value)` and shows the error of a rejected value. A colour is a `"#rrggbb"` string (sRGB, converted like a colour literal; a translucent `"#rrggbbaa"` is rejected with `MTEK-E8100`), a number is a number:

```js
app.setInput("seat_color", "#2e7d32");
app.setInput("seat_metallic", 0.7);
app.setInput("sun_intensity", 5.5);
```

| Input | State | Type | Default (from the GLB / the scene) |
|---|---|---|---|
| `seat_color`, `seat_metallic`, `seat_roughness` | `Configurator.seat_*` | colour, f32, f32 | the factors of the model's "Fabric" |
| `frame_color`, `frame_metallic`, `frame_roughness` | `Configurator.frame_*` | colour, f32, f32 | the factors of the model's "Steel" (the rails) |
| `stripe_a`, `stripe_b`, `back_roughness` | `Configurator.stripe_*`, `back_roughness` | colour, colour, f32 | `#e8e2d0`, `#2a3f5f`, 0.6 |
| `sun_intensity` | `Configurator.sun_intensity` | f32 | 3.0 |

A change of an input is a parameter upload at the next frame: no shader, pipeline or bind group is created.

## Tests

On the hardware adapter (`MTEK_REQUIRE_GPU=1 npm run test:browser:hardware -- specs/m4/configurator`):

- `specs/m4/configurator.spec.ts`: the model loads and the picture is the one a CPU model predicts; the inputs change exactly the colours they drive; resize, aspect and pixel ratio; byte-identical captures from two independent mounts; the host page.
- `specs/m4/configurator-variants.spec.ts`: unsupported asset features fail at compile time; an 80-copy variant of the scene shows the instancing path in counters and in equal output.

The expected pixels come from `tests/browser/support/configurator-scene.ts`: a ray tracer over the geometry in the GLB file with the PBR oracle of `reference-shading.ts`. It shares no code with the compiler, the runtime or the GPU, and asserts only pixels whose whole one-pixel footprint sees the same surface of the same entity.
