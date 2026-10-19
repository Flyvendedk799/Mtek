# Reference: three.js r186 (WebGPU, TSL) and the project's support module

This is the documentation given to the model on the three.js side of the AI/token benchmark
(`spec/ai-and-benchmarks.md` section 6.3, decision 0108). It is the counterpart of the compiler context
(`mtek context`) that the Mtek side receives; its tokens are counted like the context's. It is the same text
for every task. Everything in it is checked by `benchmarks/baselines/docs/docs.test.ts` against the installed
packages (three 0.186.1).

## How a project works

The project is TypeScript (`strict`, `noUncheckedIndexedAccess`) with one entry, `src/main.ts`, bundled for a browser.
It imports three.js from `three/webgpu` (all classes) and `three/tsl` (the node shading language) and the support module
from `@mtek/benchmarks/baseline-support`. The entry calls `startTask` exactly once:

```ts
import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();
  const cube = boxMesh([1, 1, 1], unlit("#22c55e"));
  cube.name = "Cube";
  scene.add(cube);
  host.onKeyDown("Space", () => { /* runs in the input phase of the next frame */ });
  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 6], target: [0, 0, 0] }),
    clearColor: "#202020",
    update(dt) { cube.rotation.y += dt; },
  };
});
```

`startTask` owns the renderer, a square 128 x 128 sRGB render target and the clock. Tests drive the application
frame by frame; the picture they read is the render target. A frame runs in this order: host inputs, key
transitions (down/up handlers), fixed ticks (`fixedUpdate`, 0 to 4 per frame of 1/60 s each), `update(dt)`, then the
render. Keys are named by `KeyboardEvent.code` (`"Space"`, `"KeyA"`, `"Enter"`, `"ArrowLeft"`).

Objects the task names are found by their `name` property (`mesh.name = "Cube"`, `material.name = "Sweep"`); give each
named thing exactly the name the task uses.

## The support module (`@mtek/benchmarks/baseline-support`)

```ts
type Vec3 = readonly [number, number, number];
function srgb(hex: string): Color;                       // "#rrggbb" sRGB colour -> three.js linear working colour
function unlit(hex: string): MeshBasicMaterial;          // flat colour, no lighting
function boxMesh(size: Vec3, material: Material): Mesh;  // full edge lengths along x, y, z
function sphereMesh(radius: number, material: Material, segments = 32, rings = 16): Mesh;
function lookAtCamera(o: { position: Vec3; target: Vec3; fovY?: number /* radians, full vertical, default 0.9 */; near?: number /* 0.1 */; far?: number /* 1000 */ }): PerspectiveCamera;  // square aspect
function orthographicCamera(o: { position: Vec3; target: Vec3; height?: number /* visible world height = width, default 10 */; near?: number; far?: number }): OrthographicCamera;
function startTask(build: (host: TaskHost) => TaskApp | Promise<TaskApp>): Promise<void>;

interface TaskHost {
  onKeyDown(code: string, handler: () => void): void;   // after the key went down
  onKeyUp(code: string, handler: () => void): void;     // after the key went up
  isKeyDown(code: string): boolean;                     // as of the current frame
  onInput(name: string, handler: (value: unknown) => void): void; // declares a host input; the page sets it, the handler gets the value in the next frame's input phase
}
interface TaskApp {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly clearColor: string;                          // "#rrggbb" (sRGB)
  fixedUpdate?(dt: number): void;                       // once per fixed tick, dt = 1/60
  update?(dt: number): void;                            // once per frame, dt in seconds (clamped to 0.1)
}

// Textures (an image the project provides as assets/<name>, loaded before the scene is built):
function loadTexture(url: string, o: { colorSpace?: "srgb" | "linear" /* default srgb */; filter: "nearest" | "linear"; wrap: "repeat" | "clamp" }): Promise<Texture>;
function configureTexture<T extends Texture>(texture: T, o: { colorSpace?: "srgb" | "linear"; filter: "nearest" | "linear"; wrap: "repeat" | "clamp" }): T;
// build may be async: `void startTask(async (host) => { const t = await loadTexture("assets/swatch.png", { filter: "nearest", wrap: "repeat" }); ... })`
```

The camera helpers and primitives use the defaults above; plain three.js objects work as well.

## three.js r186 essentials

Units are metres and radians; the coordinate system is right-handed with +Y up, the camera looks down -Z until it is
told otherwise; colours given as `"#rrggbb"` or hex numbers are sRGB and are converted to the linear working space
(`new Color(0x22c55e)`, `new Color().setStyle("#22c55e")`, or `srgb("#22c55e")`).

**Scene graph.** `Object3D` (base of `Scene`, `Group`, `Mesh`, lights, cameras): `name`, `position` (`Vector3`: `set(x,y,z)`,
`x`, `y`, `z`), `rotation` (`Euler`, radians, order XYZ: `rotation.y += a`), `quaternion`, `scale` (`Vector3`), `visible`,
`add(...children)`, `remove(...children)`, `children`, `parent`, `getObjectByName(name)`, `traverse(fn)`,
`lookAt(x, y, z)`, `rotateX/Y/Z(angle)`. A child's transform is relative to its parent; `new Group()` is an empty
node used to move several objects together.

**Meshes and geometry.** `new Mesh(geometry, material)`. Geometries (all dimensions are full sizes unless it says radius):
`BoxGeometry(width, height, depth)`, `SphereGeometry(radius, widthSegments = 32, heightSegments = 16)`,
`PlaneGeometry(width, height)` (lies in the XY plane facing +Z; `rotation.x = -Math.PI / 2` lays it flat facing +Y),
`CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)`, `ConeGeometry(radius, height, radialSegments)`,
`CircleGeometry(radius, segments)`, `TorusGeometry(radius, tube, radialSegments, tubularSegments)`.

**Materials.** `MeshBasicMaterial({ color, map?, side? })`: unlit flat colour. `MeshStandardMaterial({ color, roughness,
metalness, map? })`: physically based, needs lights. `material.color` is a `Color` (`material.color.set("#ff0000")`,
`.copy(srgb("#ff0000"))`, `.setRGB(r, g, b)` in linear values); `material.name` is a string; `material.map` a `Texture`;
`material.side` is `FrontSide` (default), `BackSide` or `DoubleSide`. A material is shared by every mesh that uses it.
Changing `color` of a built material takes effect on the next frame; nothing has to be rebuilt.

**Lights** (physical units): `AmbientLight(color, intensity)`; `DirectionalLight(color, intensity)` shines from its
`position` toward its `target` (default the origin); `PointLight(color, intensity, distance = 0, decay = 2)` with
`distance` 0 meaning no range limit; `SpotLight`, `HemisphereLight` exist too. A matte surface of colour `albedo` facing a
point light of intensity `I` at distance `d` (decay 2) has the outgoing radiance `albedo * I / (pi * d * d)`; a surface
facing a directional light of intensity `E` squarely has `albedo * E / pi`; ambient light adds `albedo * intensity / pi`
(each multiplied by the light colour). Lights are `Object3D`s: add them to the scene.

**Cameras.** `PerspectiveCamera(fovDegrees, aspect, near, far)` (field of view in DEGREES, vertical), `OrthographicCamera(left, right,
top, bottom, near, far)`; place with `position.set(...)` and `lookAt(...)`.

**Math.** `Vector3` (`set`, `add`, `sub`, `multiplyScalar`, `length`, `normalize`, `lerp`, `clone`), `Color`, `Euler`,
`Quaternion` (`setFromAxisAngle(axis, angle)`), `MathUtils.degToRad`, `MathUtils.clamp`, `MathUtils.lerp`, `MathUtils.mapLinear`.

## TSL (`three/tsl`): shader logic as node expressions

A node material replaces fixed material parameters by node graphs; the shader is built once when the material is first
used, so animate through uniforms, not by replacing the material.

```ts
import { uniform, vec3, color, mix, sin, positionLocal, uv, texture, float, clamp, smoothstep } from "three/tsl";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";

const level = uniform(0.25);                 // a node with a mutable `.value` (number, Color, Vector3, ...)
const material = new MeshBasicNodeMaterial(); // unlit; MeshStandardNodeMaterial for lit materials
material.name = "Shade";
material.colorNode = vec3(level);            // per-pixel colour; the result is displayed as it is
level.value = 0.5;                           // updates the shader's input, no rebuild
```

- Constructors: `float(x)`, `vec2(...)`, `vec3(...)` (`vec3(s)` fills all three), `vec4(...)`, `color(colorOrHex)`.
- Arithmetic on nodes: `a.add(b)`, `a.sub(b)`, `a.mul(b)`, `a.div(b)`, `a.oneMinus()`, `a.negate()`; numbers are accepted
  where a node is expected. Components: `v.x`, `v.y`, `v.z`, `v.xyz`.
- Functions (each also a method): `mix(a, b, t)`, `clamp(x, lo, hi)`, `smoothstep(lo, hi, x)`, `step(edge, x)`, `sin`, `cos`,
  `abs`, `pow`, `fract`, `min`, `max`, `length`, `normalize`, `dot`, `saturate`.
- Inputs: `positionLocal` (object-space position of the surface point, a vec3), `positionWorld`, `normalLocal`,
  `normalWorld`, `uv()` (texture coordinates, a vec2), `texture(tex, uv?)` (a sampled vec4), `time` (seconds of the
  renderer's own real-time clock, not of the application's frame clock).
- Node material slots: `colorNode` (base colour; for `MeshBasicNodeMaterial` the final colour), `opacityNode`, `roughnessNode`,
  `metalnessNode`, `emissiveNode` (on `MeshStandardNodeMaterial`).
- `color(c)` makes a colour node from a three.js `Color` (for an sRGB hex colour pass `srgb("#rrggbb")`). Node arithmetic on
  colours is done in linear light, and the result is displayed as it is.
- Conditionals: `select(condition, a, b)`; `If(cond, () => { ... })` inside `Fn(() => { ... })`.

## Conventions of the tests

Tests press keys, set host inputs, step frames of a given duration and compare pixels of the render target with
colours. Nothing else is observable: motion shows as pixels, state shows as colours. A project that does not type-check,
throws on start or writes to the console (errors or warnings) fails.
