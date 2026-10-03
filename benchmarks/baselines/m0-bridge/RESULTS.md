# M0 bridge baseline: three.js WebGPU + TSL

Task M0-09. A competent TypeScript implementation of the M0 bridge scenario with three.js `0.186.1`
(`three/webgpu`, `three/tsl`), measured on real hardware WebGPU. It is the baseline of decision 0001
(hypotheses H1 and H2; baseline rules of `spec/ai-and-benchmarks.md` section 6.3). This file states what
was measured or directly observed and names the file or command each statement comes from. It contains
no comparison with Mtek (Mtek's side is measured at M2/M3) and no performance benchmarking (M7).

## Environment

Source of every number below: the hardware run `MTEK_REQUIRE_GPU=1 npm run test:browser:hardware`
(6 passed, 0 failed, 0 not-run; the reporter confirmed a hardware adapter). The environment record of
that run is [`evidence/environment-hardware.json`](evidence/environment-hardware.json); the machine and
configuration are those of [decision 0012](../../../spec/decisions/0012-browser-test-environment.md)
and its record [`evidence/environments/2026-10-03-windows11-rx7900xtx.json`](../../../evidence/environments/2026-10-03-windows11-rx7900xtx.json).

| Item | Value (from `evidence/environment-hardware.json`) |
|---|---|
| OS | Windows 11 Pro 10.0.26200, x64 |
| Adapter | AMD Radeon RX 7900 XTX (`vendor` amd, `architecture` rdna-3), `isFallbackAdapter` false |
| Browser | Chromium 153.0.8010.12, new headless (`channel: "chromium"`), flags `--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-webgpu-developer-features` |
| Node / Playwright | v24.18.1 / 1.63.0 |
| Working tree of the run | commit `72b63a0c1a30dca1c253e8c1067540fc782999cf`, `gitDirty` false |

Pinned versions (`package.json`, recorded in [decision 0007](../../../spec/decisions/0007-toolchain.md)):
`three` 0.186.1, `@types/three` 0.186.0, `typescript` 6.0.3. The render target is 128 x 128 `RGBA8` with
the sRGB colour space, depth buffer off, one `WebGPURenderer` (`await renderer.init()`), pixel ratio 1.

## The scenario as implemented

Two `MeshBasicNodeMaterial`s, each with the six uniforms of the `mixed` block (`spec/gpu-layout.md`
example B): a float `a`, a vec3 `b`, a uint `c`, a vec2 `d`, a bool `e` and a colour `f`, created with
TSL `uniform(value, type)` (`src/mixed.ts`). Output colour:
`rgb = (e ? f * a : f) + b * (c / 100) + (d.x, d.y, 0)`, alpha 1. Material A is applied to a plane
covering the left half of the render target, material B to a plane covering the right half
(`src/scenario.ts`). The scene is rendered into the render target and read back with
`renderer.readRenderTargetPixelsAsync`. An update writes `.value` of one material's uniform nodes
(`applyParams`).

Representation notes, as implemented:

- Boolean: TSL has a `bool` uniform type; the value is a JavaScript `boolean`. It was exercised with both
  `true` and `false` (see the pixel results).
- Unsigned: the uniform is declared with type string `"uint"`; its `.value` has TypeScript type `number`.
- Colour: three.js `Color` has three channels (r, g, b). Mtek's `color` is linear RGBA (spec/gpu-layout.md
  example B); the baseline colour has no alpha, and the output alpha is the constant 1.

## Pixel results

Source: `evidence/m0-bridge-measurements-hardware.json`, written by the first test in
`tests/browser/specs/baselines/m0-bridge.spec.ts`. Expected bytes are computed on the CPU in f64 from
the formula above plus the sRGB encoding of the target; the test asserts that every one of the 64 x 128
pixels of each half deviates by at most 1 from the expected value in every channel. The observed
deviation was 0 in every phase for both halves. Pixels shown are `RGBA` bytes at the centre of each half.

| Phase | Material A centre | Material B centre |
|---|---|---|
| first render (A0, B0) | 181, 150, 89, 255 | 170, 203, 249, 255 |
| render again, nothing changed | identical to the first render | identical to the first render |
| update only the colour `f` of A | 111, 188, 124, 255 | 170, 203, 249, 255 (unchanged, deviation from before 0) |
| update all six uniforms of A | 89, 142, 158, 255 | 170, 203, 249, 255 |
| update all six uniforms of B | 89, 142, 158, 255 (unchanged) | 155, 149, 63, 255 |

The parameter values of every phase are in the `parameters` object of the JSON file. The test asserts
byte equality for the untouched material (B after the updates of A, A after the update of B).

## Pipeline, shader-module and upload counts

Method: `GPUAdapter.prototype.requestDevice` is wrapped in an init script before any page script runs, so
the device that three.js receives has counting wrappers around `createRenderPipeline`,
`createRenderPipelineAsync`, `createShaderModule`, `createComputePipeline`, `createBuffer`,
`createBindGroup` and `queue.writeBuffer` (`installDeviceCounters` in the spec). The test asserts the
wrapper saw exactly one device and, after the first render, a non-zero number of shader-module and
pipeline creations (so the wrapper really observes three.js). Counts are per phase (differences between
two snapshots, each taken after the render and readback of the phase). Source:
`evidence/m0-bridge-measurements-hardware.json`.

| Phase | createRenderPipeline | createRenderPipelineAsync | createShaderModule | createComputePipeline | createBuffer | createBindGroup | writeBuffer calls | writeBuffer bytes |
|---|---|---|---|---|---|---|---|---|
| `init()` (before any render) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| first render | 1 | 0 | 2 | 0 | 6 | 3 | 7 | 352 |
| unchanged re-render | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| update colour of A, render | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 12 |
| update all six of A, render | 0 | 0 | 0 | 0 | 1 | 0 | 3 | 40 |
| update all six of B, render | 0 | 0 | 0 | 0 | 1 | 0 | 2 | 44 |

Observed: with the render pipeline and shader-module counts as the measure, none of the four
render-after-update phases created any pipeline or shader module (the test asserts 0 for
`createRenderPipeline`, `createRenderPipelineAsync` and `createShaderModule` in each). The first render of
the two-material scene made one `createRenderPipeline` call and two `createShaderModule` calls. One
`createBuffer` call occurred in every render including the unchanged re-render; it was not attributed to
a cause (the readback path was not separated from the render path). `createdDevices` was 1.

The `writeBuffer` columns are what the wrapper observed in this run; the partition of update bytes
over calls was not analysed further.

## Source size of the baseline

Source: `evidence/source-size.json`, produced by `npm run size -w @mtek/baseline-m0-bridge`
(`tools/count-lines.ts`; counts lines that are neither blank nor comment-only in the `.ts` files directly
in `src/`). Total 148 lines: `mixed.ts` 46 (the six uniforms, the shader graph, the update function),
`scenario.ts` 67 (renderer, render target, scene, readback) and `index.ts` 35 (exposes the scenario to
the test page as `window.mtekBaseline`, which exists only for the browser test). The type experiment, the
misuse page, the tools and the browser spec are outside `src/` and not counted.

## Type-checking experiment (H2)

Source: `type-experiments.ts`, checked with `npm run check:types -w @mtek/baseline-m0-bridge`
(`tsc --noEmit -p tsconfig.json`, TypeScript 6.0.3, `strict`, `@types/three` 0.186.0), which passes.
`// @ts-expect-error` marks a line only where tsc reports an error (an unused directive would itself be an
error, so the file cannot overstate what tsc catches). The table below is the output of
`npm run type-report -w @mtek/baseline-m0-bridge` (`tools/type-experiment-report.ts`), which compiles
a copy of the file with the directives removed and attributes each diagnostic to its case. Saved:
`evidence/type-experiment-table.md`.

| Case | Wrong usage | tsc | First diagnostic |
|---|---|---|---|
| 01 | a vec3 value assigned to a float uniform | rejected | TS2322: Type 'Vector3' is not assignable to type 'number'. |
| 02 | a colour assigned to a vec2 uniform | rejected | TS2740: Type 'Color' is missing the following properties from type 'Vector2': x, y, width, height, and 36 more. |
| 03 | a misspelled uniform name used as a property of the typed uniform record | rejected | TS2339: Property 'colr' does not exist on type 'MixedUniforms'. |
| 04 | a misspelled uniform name passed to a lookup helper typed with `keyof` | rejected | TS2345: Argument of type '"colr"' is not assignable to parameter of type 'keyof MixedUniforms'. |
| 05 | a misspelled uniform name given to three.js itself (`setName`, a plain string) | NOT rejected | - |
| 06 | a vec3 value assigned to a colour uniform | rejected | TS2740: Type 'Vector3' is missing the following properties from type 'Color': isColor, r, g, b, and 20 more. |
| 07 | a number assigned to the boolean uniform | rejected | TS2322: Type 'number' is not assignable to type 'boolean'. |
| 08 | a boolean assigned to a float uniform | rejected | TS2322: Type 'boolean' is not assignable to type 'number'. |
| 09 | a negative number assigned to the unsigned uniform | NOT rejected | - |
| 10 | a fractional number assigned to the unsigned uniform | NOT rejected | - |
| 11 | a value beyond the u32 range assigned to the unsigned uniform | NOT rejected | - |
| 12 | a vec3 given to a uniform declared with the type string "float" | rejected | TS2769: No overload matches this call. |
| 13 | a three-component array for the vec2 parameter of `applyParams` | rejected | TS2322: Type 'number' is not assignable to type 'undefined'. |
| 14 | a wrong-length array for a vec3 parameter of `applyParams` | rejected | TS2322: Type '[number, number]' is not assignable to type 'readonly [number, number, number]'. |
| 15 | shader graph: a vec2 node added to a vec3 node | NOT rejected | - |
| 16 | shader graph: a vec2 uniform read through a swizzle that does not exist on vec2 | rejected | TS2339: Property 'xyz' does not exist on type 'UniformNode<"vec2", Vector2>'. |
| 17 | shader graph: a float node assigned where the material expects a vec4 colour node | NOT rejected | - |
| 18 | shader graph: a vec2 uniform assigned where the material expects a vec4 colour node | NOT rejected | - |
| 19 | a Vector2 value assigned to a vec3 uniform | rejected | TS2740: Type 'Vector2' is missing the following properties from type 'Vector3': z, isVector3, setZ, multiplyVectors, and 23 more. |
| 20 | not a mistake: converting a colour uniform node with the vec3() constructor | rejected | TS2769: No overload matches this call. |
| 21 | not a mistake: adding a vec3 to the result of select() over colour-times-float branches | rejected | TS2345: Argument of type 'VarNode<"vec3", ConstNode<"vec3", Vector3>>' is not assignable to parameter of type 'Number<"float">'. |

Tally: 12 of 19 wrong usages are rejected by tsc; 7 are not (cases 05, 09, 10, 11, 15, 17, 18).
Cases 20 and 21 are valid-looking TSL expressions that tsc with the pinned `@types/three` rejects (false
positives); they are listed so the table does not hide them and are not counted in the 12 of 19.

Most cases (01 to 04, 06 to 08, 13, 14, 19) operate on the `MixedUniforms` record of `src/mixed.ts`
(or on `applyParams`, case 13 and 14), whose member types are three.js's own
`ReturnType<typeof uniform<"float", number>>` and so on, spelled out by hand. Case 05 and cases 15, 17
and 18 (shader-graph typing) are not rejected.

### Run-time behaviour of mistakes that tsc accepts

Source: `evidence/m0-bridge-uint-measurements-hardware.json` and
`evidence/m0-bridge-misuse-measurements-hardware.json`, written by the second and third tests of the
spec. The misuse page (`experiments/misuse.ts`) builds the shader-graph cases 15, 17 and 18 and renders
one pixel each.

Unsigned uniform (cases 09 to 11). Base values: `a` 1, `b` (10, 5, 2.5), `d` (0, 0), `e` false, `f` black.
Centre pixel of A after `c` is written:

| Value written to `c` | Observed RGBA | If the number were taken as written | If `value >>> 0` (JavaScript ToUint32) |
|---|---|---|---|
| 1.5 | 89, 63, 44, 255 | 108, 77, 54, 255 | 89, 63, 44, 255 |
| -1 | 255, 255, 255, 255 | 0, 0, 0, 255 | 255, 255, 255, 255 |
| 4294967296 | 0, 0, 0, 255 | 255, 255, 255, 255 | 0, 0, 0, 255 |
| 100 (valid) | 255, 255, 255, 255 | 255, 255, 255, 255 | 255, 255, 255, 255 |

The test asserts the observed pixels match the `value >>> 0` model within 1 byte. Observed: no console
error or warning, and no thrown exception, for any of these writes.

Shader-graph mismatches (cases 15, 17, 18). Each builds, compiles and renders without any console
error or warning and without a thrown exception (the test asserts empty console output). The misuse page
renders into a 16 x 16 target without sRGB conversion, so a byte is the shader value times 255:

| Case | Observed pixel (RGBA) | Observed meaning |
|---|---|---|
| 15 `vec3 + vec2` with (0.1, 0.2, 0.3) + (0.25, 0.5) | 89, 178, 76, 255 | the vec2 is added to the first two components only |
| 17 float 0.5 as the colour node | 128, 128, 128, 255 | the float is broadcast to r, g and b |
| 18 vec2 (0.25, 0.5) as the colour node | 64, 128, 0, 255 | components (0.25, 0.5, 0, 1) |

## What had to be written by hand

- No uniform layout code and no buffer upload code: three.js lays out and uploads the uniforms (the
  device wrapper observed its `writeBuffer` calls; nothing in `src/` calls them). No WGSL was written;
  the shader is the TSL graph in `src/mixed.ts`.
- By hand: the `MixedUniforms` type annotation, the TSL expression of the output colour, the
  `applyParams` update function, and the scene, camera, render target and readback calls.
- The browser spec holds an independent CPU reference of the formula and sRGB encoding; this is test
  code and is not part of the baseline size.

## Limitations observed

- One machine, one browser build, one three.js release; counts are from one run of the test.
  Timing was not measured.
- The counts come from wrapping `GPUDevice` methods and `queue.writeBuffer`. Other WebGPU entry points
  (for example `writeTexture`, `copyBufferToBuffer`, command encoding) are not counted.
- The reason for one `createBuffer` per render and for the single render pipeline of the two-material
  scene was not investigated.
- The colour uniform has no alpha channel (see above), so the baseline does not reproduce the 16-byte
  `color` of the Mtek `mixed` record exactly.
- Two valid-looking TSL expressions are rejected by tsc with `@types/three` 0.186.0 (cases 20, 21);
  whether this is a defect of the typings or a deliberate limit was not investigated.
- The type experiment is a fixed list of 19 wrong usages chosen by the baseline author; it is not a
  statistical sample of the mistakes a developer makes.

## Reproduce

```text
npm ci
npm run build
MTEK_REQUIRE_GPU=1 npm run test:browser:hardware     # writes tests/browser/results/<timestamp>/ (not committed)
npm run check:types -w @mtek/baseline-m0-bridge
npm run type-report -w @mtek/baseline-m0-bridge
npm run size -w @mtek/baseline-m0-bridge
```

The `evidence/` files are copies of the hardware run's `m0-bridge-*-hardware.json` and
`environment-hardware.json`, and of the outputs of the last three commands.
