// A CPU model of `examples/material-configurator` (task M4-10) for the pixel assertions of the browser specs: a small ray tracer
// that decides, for every pixel of a target of any size, which entity is in front, with which surface normal and uv, and what
// colour the documented PBR model (the oracle `shadePbr`, reference-shading.ts) gives it. It is independent of the compiler,
// the runtime and the GPU:
//   - the geometry is read from the GLB file itself (a tiny container parser below, no code of the packager), placed with
//     world matrices written down by hand from the node transforms in tests/assets/tools/make-glb.mjs (a consistency test
//     compares them with the file's nodes);
//   - the surface normal of a hit is the geometric normal of the world-space triangle (the meshes are flat-shaded), so it
//     does not depend on any normal matrix: a renderer that transforms normals wrongly (non-uniform scale, instancing)
//     disagrees with it;
//   - the camera is a pinhole whose rays are built from the camera position, target and vertical field of view
//     (spec/scenes.md); the projection matrices of m1-reference.ts are used only to check the rays;
//   - a pixel is only asserted when its expectation is robust: the nine rays through its centre, corners and edge midpoints
//     (a one pixel wide footprint) must all hit the same surface of the same entity (and, for the stripes, the same band), or
//     all miss everything. Edge pixels, where rasterisation rules decide, are never asserted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./environment.ts";
import { multiply, quatAxisAngle, quatEuler, rotation, scaling, srgbToLinear, transform4, translation, transformPoint, type Mat4, type Vec3 } from "./m1-reference.ts";
import { sunDirection } from "./pbr-scene.ts";
import { linearRgbToSrgb8, shadePbr, type Light } from "./reference-shading.ts";

export type { Vec3 };

// ---------------------------------------------------------------------------
// GLB reading
// ---------------------------------------------------------------------------

interface GltfAccessor {
  readonly bufferView: number;
  readonly byteOffset?: number;
  readonly count: number;
  readonly componentType: number;
  readonly type: string;
}
interface GltfBufferView {
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride?: number;
}
export interface GltfNode {
  readonly name?: string;
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
}
export interface GltfJson {
  readonly nodes: readonly GltfNode[];
  readonly scenes: ReadonlyArray<{ readonly nodes: readonly number[] }>;
  readonly meshes: ReadonlyArray<{ readonly name: string; readonly primitives: ReadonlyArray<{ readonly attributes: Readonly<Record<string, number>>; readonly indices?: number; readonly material?: number }> }>;
  readonly materials: ReadonlyArray<{ readonly name: string; readonly pbrMetallicRoughness: { readonly baseColorFactor: readonly number[]; readonly metallicFactor: number; readonly roughnessFactor: number } }>;
  readonly accessors: readonly GltfAccessor[];
  readonly bufferViews: readonly GltfBufferView[];
}

export interface Glb {
  readonly json: GltfJson;
  readonly bin: Buffer;
}

/** Splits a binary glTF into its JSON and BIN chunks (spec: 12 byte header, then chunks of length, type and data). */
export function parseGlb(bytes: Buffer): Glb {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("not a binary glTF 2.0 file");
  let json: GltfJson | undefined;
  let bin: Buffer = Buffer.alloc(0);
  for (let offset = 12; offset < bytes.length; ) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")) as GltfJson;
    else if (type === 0x004e4942) bin = data;
    offset += 8 + length;
  }
  if (json === undefined) throw new Error("the file has no JSON chunk");
  return { json, bin };
}

/** The floats of an accessor (`FLOAT` only), as arrays of `components` numbers, honouring the buffer view's stride. */
function floats(glb: Glb, accessorIndex: number, components: number): number[][] {
  const accessor = glb.json.accessors[accessorIndex];
  const view = accessor === undefined ? undefined : glb.json.bufferViews[accessor.bufferView];
  if (accessor === undefined || view === undefined || accessor.componentType !== 5126) throw new Error(`accessor ${String(accessorIndex)} is not a float accessor`);
  const stride = view.byteStride ?? components * 4;
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const at = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride;
    out.push(Array.from({ length: components }, (_, c) => glb.bin.readFloatLE(at + c * 4)));
  }
  return out;
}

function indicesOf(glb: Glb, accessorIndex: number): number[] {
  const accessor = glb.json.accessors[accessorIndex];
  const view = accessor === undefined ? undefined : glb.json.bufferViews[accessor.bufferView];
  if (accessor === undefined || view === undefined) throw new Error(`accessor ${String(accessorIndex)} is missing`);
  const size = accessor.componentType === 5123 ? 2 : accessor.componentType === 5125 ? 4 : 1;
  const out: number[] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const at = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * size;
    out.push(size === 2 ? glb.bin.readUInt16LE(at) : size === 4 ? glb.bin.readUInt32LE(at) : glb.bin.readUInt8(at));
  }
  return out;
}

/** The object-space triangles of one primitive of a named mesh: positions and uv per corner, in the file's winding. */
export interface LocalTriangle {
  readonly p: readonly [Vec3, Vec3, Vec3];
  readonly uv: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
}

export function primitiveTriangles(glb: Glb, meshName: string, primitive: number): LocalTriangle[] {
  const mesh = glb.json.meshes.find((candidate) => candidate.name === meshName);
  const prim = mesh?.primitives[primitive];
  if (prim === undefined || prim.indices === undefined) throw new Error(`mesh ${meshName} primitive ${String(primitive)} is missing or not indexed`);
  const positions = floats(glb, prim.attributes["POSITION"] ?? -1, 3);
  const uvs = floats(glb, prim.attributes["TEXCOORD_0"] ?? -1, 2);
  const indices = indicesOf(glb, prim.indices);
  const triangles: LocalTriangle[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const corner = (k: number): number => {
      const index = indices[i + k];
      if (index === undefined) throw new Error("index out of range");
      return index;
    };
    const point = (k: number): Vec3 => {
      const p = positions[corner(k)];
      if (p === undefined) throw new Error("position out of range");
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
    };
    const uv = (k: number): readonly [number, number] => {
      const t = uvs[corner(k)];
      if (t === undefined) throw new Error("uv out of range");
      return [t[0] ?? 0, t[1] ?? 0];
    };
    triangles.push({ p: [point(0), point(1), point(2)], uv: [uv(0), uv(1), uv(2)] });
  }
  return triangles;
}

export const CHAIR_GLB_PATH = join(REPO_ROOT, "examples", "material-configurator", "models", "chair.glb");

export function loadChair(): Glb {
  return parseGlb(readFileSync(CHAIR_GLB_PATH));
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export type Shading =
  | { readonly kind: "pbr"; readonly baseColor: Vec3; readonly metallic: number; readonly roughness: number }
  | { readonly kind: "stripes"; readonly a: Vec3; readonly b: Vec3; readonly bands: number; readonly metallic: number; readonly roughness: number };

export interface Placement {
  readonly name: string;
  /** glTF mesh name and primitive index in the model. */
  readonly mesh: string;
  readonly primitive: number;
  /** Object-to-world matrix, column-major (`T · R · S`). */
  readonly world: Mat4;
  readonly shading: Shading;
}

export interface SceneModel {
  readonly camera: { readonly position: Vec3; readonly target: Vec3; readonly fovY: number };
  /** The scene's `clear_color` as the bytes the target holds. */
  readonly clear: readonly [number, number, number];
  readonly lights: readonly Light[];
  readonly ambientColor: Vec3;
  readonly ambientIntensity: number;
  readonly placements: readonly Placement[];
}

/** An opaque `#rrggbb` literal as linear RGB. */
export function hexLinear(hex: string): Vec3 {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (match === null) throw new Error(`not an opaque #rrggbb colour: ${hex}`);
  const channel = (index: number): number => srgbToLinear(Number.parseInt(match[index] ?? "", 16) / 255);
  return [channel(1), channel(2), channel(3)];
}

/** The bytes an `-srgb` target holds for a `#rrggbb` clear colour. */
export function hexBytes(hex: string): readonly [number, number, number] {
  return linearRgbToSrgb8(hexLinear(hex));
}

/** The inputs a host sets (`mtek.toml [host.inputs]`), as the linear/plain values the shaders see. */
export interface ConfiguratorInputs {
  readonly seat: { readonly baseColor: Vec3; readonly metallic: number; readonly roughness: number };
  readonly frame: { readonly baseColor: Vec3; readonly metallic: number; readonly roughness: number };
  readonly stripeA: Vec3;
  readonly stripeB: Vec3;
  readonly backRoughness: number;
  readonly sunIntensity: number;
}

/** The scene state before any input is set: the factors of the GLB's "Fabric" and "Steel" and the literals of main.mtek. */
export const DEFAULT_INPUTS: ConfiguratorInputs = {
  seat: { baseColor: [0.55, 0.12, 0.1], metallic: 0, roughness: 0.85 },
  frame: { baseColor: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3 },
  stripeA: hexLinear("#e8e2d0"),
  stripeB: hexLinear("#2a3f5f"),
  backRoughness: 0.6,
  sunIntensity: 3,
};

/** The names of the host inputs and the values `setInput` takes for `inputs` (colours as `#rrggbb`). */
export type HostInput = string | number;

export const STRIPE_BANDS = 6;
/** The camera and lights of main.mtek. */
export const CONFIGURATOR_CAMERA = { position: [0, 1.15, 2.6] as Vec3, target: [0, 0.45, 0] as Vec3, fovY: Math.fround(0.8) };
export const CONFIGURATOR_CLEAR_HEX = "#1b1f27";
const SUN = { pitch: -0.8, yaw: 0.5, colorHex: "#fff4e0" };
const LAMP = { position: [-1.4, 1.8, 1.2] as Vec3, intensity: 5, range: 6 };

export function configuratorLights(sunIntensity: number): Light[] {
  return [
    { kind: "directional", direction: sunDirection(SUN.pitch, SUN.yaw), color: hexLinear(SUN.colorHex), intensity: sunIntensity },
    { kind: "point", position: LAMP.position, color: [1, 1, 1], intensity: LAMP.intensity, range: LAMP.range },
  ];
}

/** The chair node "Chair" turns by this about +Y; the Back leans by CHAIR_LEAN about +X (make-glb.mjs). */
export const CHAIR_YAW = 0.5;
export const CHAIR_LEAN = -0.15;

/** World matrix of a child of the node "Chair": `Ry(yaw) · T(local) · R(local rotation)`; the scale is 1 everywhere. */
function chairChild(local: Vec3, leanAboutX = 0): Mat4 {
  return multiply(
    rotation(quatAxisAngle([0, 1, 0], CHAIR_YAW)),
    multiply(translation(local), rotation(quatAxisAngle([1, 0, 0], leanAboutX))),
  );
}

/** The world matrices of the entities of main.mtek, written down from the node table in make-glb.mjs. */
export const NODE_WORLD: Readonly<Record<string, Mat4>> = {
  Floor: translation([0, 0, 0]),
  Seat: chairChild([0, 0.45, 0]),
  Back: chairChild([0, 0.74, -0.23], CHAIR_LEAN),
  LegFL: chairChild([0.2, 0.21, 0.2]),
  LegFR: chairChild([-0.2, 0.21, 0.2]),
  LegBL: chairChild([0.2, 0.21, -0.2]),
  LegBR: chairChild([-0.2, 0.21, -0.2]),
  Rails: chairChild([0, 0.14, 0]),
  // On top of the Back: 0.24 up the Back's own +Y axis, which the lean turns to (0, cos, sin).
  Crest: chairChild([0, 0.74 + 0.24 * Math.cos(CHAIR_LEAN), -0.23 + 0.24 * Math.sin(CHAIR_LEAN)], CHAIR_LEAN),
};

const STONE: Shading = { kind: "pbr", baseColor: [0.3, 0.3, 0.32], metallic: 0, roughness: 0.9 };
const OAK: Shading = { kind: "pbr", baseColor: [0.45, 0.25, 0.1], metallic: 0, roughness: 0.55 };

/** The example's scene for the given inputs. */
export function configuratorScene(inputs: ConfiguratorInputs = DEFAULT_INPUTS): SceneModel {
  const stripes: Shading = { kind: "stripes", a: inputs.stripeA, b: inputs.stripeB, bands: STRIPE_BANDS, metallic: 0, roughness: inputs.backRoughness };
  const seat: Shading = { kind: "pbr", baseColor: inputs.seat.baseColor, metallic: inputs.seat.metallic, roughness: inputs.seat.roughness };
  const frame: Shading = { kind: "pbr", baseColor: inputs.frame.baseColor, metallic: inputs.frame.metallic, roughness: inputs.frame.roughness };
  const at = (name: string): Mat4 => {
    const world = NODE_WORLD[name];
    if (world === undefined) throw new Error(`no world matrix for ${name}`);
    return world;
  };
  return {
    camera: CONFIGURATOR_CAMERA,
    clear: hexBytes(CONFIGURATOR_CLEAR_HEX),
    lights: configuratorLights(inputs.sunIntensity),
    ambientColor: [1, 1, 1],
    ambientIntensity: 0.12,
    placements: [
      { name: "Floor", mesh: "Floor", primitive: 0, world: at("Floor"), shading: STONE },
      { name: "Seat", mesh: "Seat", primitive: 0, world: at("Seat"), shading: seat },
      { name: "Back", mesh: "Back", primitive: 0, world: at("Back"), shading: stripes },
      { name: "LegFL", mesh: "Leg", primitive: 0, world: at("LegFL"), shading: OAK },
      { name: "LegFR", mesh: "Leg", primitive: 0, world: at("LegFR"), shading: OAK },
      { name: "LegBL", mesh: "Leg", primitive: 0, world: at("LegBL"), shading: OAK },
      { name: "LegBR", mesh: "Leg", primitive: 0, world: at("LegBR"), shading: OAK },
      { name: "RailFront", mesh: "Rails", primitive: 0, world: at("Rails"), shading: frame },
      { name: "RailBack", mesh: "Rails", primitive: 1, world: at("Rails"), shading: frame },
      { name: "Crest", mesh: "Crest", primitive: 0, world: at("Crest"), shading: OAK },
    ],
  };
}

// ---------------------------------------------------------------------------
// The repeated-object scene: many copies of the chair's meshes with a transform of their own each
// ---------------------------------------------------------------------------

export interface Instance {
  readonly name: string;
  readonly kind: "Leg" | "Seat" | "Rail" | "Crest" | "Odd";
  readonly position: Vec3;
  /** `quat.euler(pitch, yaw, 0)`. */
  readonly pitch: number;
  readonly yaw: number;
  readonly scale: Vec3;
}

export const REPEAT_COLUMNS = 10;
export const REPEAT_ROWS = 8;
/** The cell that holds the one entity whose parameters differ (it cannot join a group). */
export const ODD_CELL = { column: 5, row: 4 };

/** The grid of copies. Every cell has its own rotation and a non-uniform scale: the meshes' slanted faces (the legs) change direction differently under the normal matrix than under the model matrix. */
export function repeatedInstances(): Instance[] {
  const out: Instance[] = [];
  for (let row = 0; row < REPEAT_ROWS; row += 1) {
    for (let column = 0; column < REPEAT_COLUMNS; column += 1) {
      const index = row * REPEAT_COLUMNS + column;
      const odd = column === ODD_CELL.column && row === ODD_CELL.row;
      const kind = odd ? "Odd" : (["Leg", "Seat", "Rail", "Crest"] as const)[(column + row) % 4];
      if (kind === undefined) throw new Error("unreachable");
      out.push({
        name: `I${String(index).padStart(2, "0")}`,
        kind,
        position: [round2((column - (REPEAT_COLUMNS - 1) / 2) * 1.1), round2((row - (REPEAT_ROWS - 1) / 2) * 0.95), 0],
        pitch: round2(0.3 * ((2 * column + 3 * row) % 5) - 0.6),
        yaw: round2(0.35 * ((3 * column + 5 * row) % 7) - 0.9),
        scale: [round2(1.2 + 0.3 * ((column + row) % 4)), round2(0.9 + 0.4 * ((2 * column + row) % 3)), round2(1.4 + 0.15 * ((column + 2 * row) % 3))],
      });
    }
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** What each kind of copy looks like: the model's own materials for legs and rails, explicit `Pbr` values for the seats. */
export const REPEAT_SEAT_HEX = "#c8793a";
export const REPEAT_SEAT = { metallic: 0, roughness: 0.4 };
export const REPEAT_ODD = { metallic: 0, roughness: 0.2 };
const STEEL: Shading = { kind: "pbr", baseColor: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3 };

export const REPEAT_CAMERA = { position: [0, 0, 9] as Vec3, target: [0, 0, 0] as Vec3, fovY: Math.fround(0.8) };

export function repeatedScene(): SceneModel {
  const seatColor = hexLinear(REPEAT_SEAT_HEX);
  return {
    camera: REPEAT_CAMERA,
    clear: hexBytes(CONFIGURATOR_CLEAR_HEX),
    lights: configuratorLights(3),
    ambientColor: [1, 1, 1],
    ambientIntensity: 0.12,
    placements: repeatedInstances().map((instance): Placement => {
      const world = multiply(
        translation(instance.position),
        multiply(rotation(quatEuler(instance.pitch, instance.yaw, 0)), scaling(instance.scale)),
      );
      switch (instance.kind) {
        case "Leg":
          return { name: instance.name, mesh: "Leg", primitive: 0, world, shading: OAK };
        case "Rail":
          return { name: instance.name, mesh: "Rails", primitive: 0, world, shading: STEEL };
        case "Crest":
          return { name: instance.name, mesh: "Crest", primitive: 0, world, shading: OAK };
        case "Seat":
          return { name: instance.name, mesh: "Seat", primitive: 0, world, shading: { kind: "pbr", baseColor: seatColor, ...REPEAT_SEAT } };
        case "Odd":
          return { name: instance.name, mesh: "Seat", primitive: 0, world, shading: { kind: "pbr", baseColor: seatColor, ...REPEAT_ODD } };
      }
    }),
  };
}

/** The Mtek source of the repeated scene: `src/main.mtek` of the instancing variant of the example. */
export function repeatedSource(): string {
  const num = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));
  const vec = (v: Vec3): string => `vec3(${num(v[0])}, ${num(v[1])}, ${num(v[2])})`;
  const lines: string[] = [];
  for (const instance of repeatedInstances()) {
    const mesh =
      instance.kind === "Rail"
        ? 'CHAIR.primitive("Rails", 0)'
        : instance.kind === "Leg"
          ? 'CHAIR.mesh("Leg")'
          : instance.kind === "Crest"
            ? 'CHAIR.mesh("Crest")'
            : 'CHAIR.mesh("Seat")';
    const material =
      instance.kind === "Leg" || instance.kind === "Crest"
        ? 'CHAIR.material("Oak")'
        : instance.kind === "Rail"
          ? 'CHAIR.material("Steel")'
          : `Pbr { base_color: ${REPEAT_SEAT_HEX}; metallic: 0.0; roughness: ${num(instance.kind === "Odd" ? REPEAT_ODD.roughness : REPEAT_SEAT.roughness)}; }`;
    lines.push(
      `    entity ${instance.name} { mesh: ${mesh}; position: ${vec(instance.position)}; rotation: quat.euler(${num(instance.pitch)}, ${num(instance.yaw)}, 0.0); scale: ${vec(instance.scale)}; material: ${material}; }`,
    );
  }
  return `import { CHAIR } from "./model.mtek";

// Repeated objects (task M4-10, generated by tests/browser/support/configurator-scene.ts): ${String(REPEAT_COLUMNS * REPEAT_ROWS)} copies of the chair's
// meshes in a grid, each with its own rotation and a non-uniform scale. The legs and the crests (both the model's "Oak": one
// parameter block, two meshes), the seats (explicit Pbr values) and the rails (the model's "Steel") are four groups of
// compatible draws; one seat has another roughness and is drawn on its own.
scene Repeated {
    clear_color: ${CONFIGURATOR_CLEAR_HEX};
    ambient_color: #ffffff;
    ambient_intensity: 0.12;

    camera Main {
        position: ${vec(REPEAT_CAMERA.position)};
        target: ${vec(REPEAT_CAMERA.target)};
        projection: Perspective { fov_y: 0.8; near: 0.1; far: 40.0 };
    }

    entity Sun {
        rotation: quat.euler(${num(SUN.pitch)}, ${num(SUN.yaw)}, 0.0);
        light: DirectionalLight { color: ${SUN.colorHex}; intensity: 3.0 };
    }
    entity Lamp {
        position: ${vec(LAMP.position)};
        light: PointLight { color: #ffffff; intensity: ${num(LAMP.intensity)}; range: ${num(LAMP.range)} };
    }

${lines.join("\n")}
}
`;
}

// ---------------------------------------------------------------------------
// Ray casting
// ---------------------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};

interface WorldTriangle {
  readonly p0: Vec3;
  readonly e1: Vec3;
  readonly e2: Vec3;
  readonly normal: Vec3;
  /** What a renderer that transformed normals by the model matrix instead of its inverse transpose would use (a mutation for the sensitivity tests). */
  readonly modelMatrixNormal: Vec3;
  readonly uv: LocalTriangle["uv"];
}

interface PlacedMesh {
  readonly placement: Placement;
  readonly triangles: readonly WorldTriangle[];
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Hit {
  /** Index into `placements`. */
  readonly entity: number;
  readonly distance: number;
  readonly position: Vec3;
  /** Unit geometric normal of the world-space triangle, pointing at the viewer. */
  readonly normal: Vec3;
  readonly modelMatrixNormal: Vec3;
  readonly uv: readonly [number, number];
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** A scene prepared for casting: world-space triangles and bounding boxes of every placement. */
export class Tracer {
  readonly scene: SceneModel;
  private readonly meshes: PlacedMesh[];
  private readonly forward: Vec3;
  private readonly right: Vec3;
  private readonly up: Vec3;
  private readonly tanHalf: number;

  constructor(scene: SceneModel, glb: Glb = loadChair()) {
    this.scene = scene;
    this.meshes = scene.placements.map((placement) => {
      const triangles: WorldTriangle[] = primitiveTriangles(glb, placement.mesh, placement.primitive).map((local) => {
        const [p0, p1, p2] = local.p.map((p) => transformPoint(placement.world, p)) as [Vec3, Vec3, Vec3];
        const e1 = sub(p1, p0);
        const e2 = sub(p2, p0);
        const localNormal = unit(cross(sub(local.p[1], local.p[0]), sub(local.p[2], local.p[0])));
        const [mx, my, mz] = transform4(placement.world, localNormal, 0);
        return { p0, e1, e2, normal: unit(cross(e1, e2)), modelMatrixNormal: unit([mx, my, mz]), uv: local.uv };
      });
      const corners = triangles.flatMap((t) => [t.p0, [t.p0[0] + t.e1[0], t.p0[1] + t.e1[1], t.p0[2] + t.e1[2]] as Vec3, [t.p0[0] + t.e2[0], t.p0[1] + t.e2[1], t.p0[2] + t.e2[2]] as Vec3]);
      const min = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a] ?? 0))) as unknown as Vec3;
      const max = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a] ?? 0))) as unknown as Vec3;
      return { placement, triangles, min, max };
    });
    const { position, target, fovY } = scene.camera;
    this.forward = unit(sub(target, position));
    this.right = unit(cross(this.forward, [0, 1, 0]));
    this.up = cross(this.right, this.forward);
    this.tanHalf = Math.tan(fovY / 2);
  }

  /** The ray through the point `(x, y)` of a `width x height` target, in pixels from the top left (the pixel centre is `+ 0.5`). */
  rayAt(width: number, height: number, x: number, y: number): Ray {
    const u = (2 * x) / width - 1;
    const v = 1 - (2 * y) / height;
    const s = u * this.tanHalf * (width / height);
    const t = v * this.tanHalf;
    return {
      origin: this.scene.camera.position,
      direction: unit([
        this.forward[0] + s * this.right[0] + t * this.up[0],
        this.forward[1] + s * this.right[1] + t * this.up[1],
        this.forward[2] + s * this.right[2] + t * this.up[2],
      ]),
    };
  }

  /** The nearest front-facing surface along `ray` (back faces are culled, as the renderer does), or `undefined`. */
  cast(ray: Ray): Hit | undefined {
    let best: Hit | undefined;
    this.meshes.forEach((mesh, entity) => {
      if (!hitsBox(ray, mesh.min, mesh.max, best?.distance ?? Infinity)) return;
      for (const t of mesh.triangles) {
        // Moeller-Trumbore. det > 0 exactly when the ray meets the counter-clockwise (front) side.
        const pvec = cross(ray.direction, t.e2);
        const det = dot(t.e1, pvec);
        if (det < 1e-12) continue;
        const tvec = sub(ray.origin, t.p0);
        const a = dot(tvec, pvec) / det;
        if (a < 0 || a > 1) continue;
        const qvec = cross(tvec, t.e1);
        const b = dot(ray.direction, qvec) / det;
        if (b < 0 || a + b > 1) continue;
        const distance = dot(t.e2, qvec) / det;
        if (distance <= 0 || distance >= (best?.distance ?? Infinity)) continue;
        const w = 1 - a - b;
        best = {
          entity,
          distance,
          position: [ray.origin[0] + distance * ray.direction[0], ray.origin[1] + distance * ray.direction[1], ray.origin[2] + distance * ray.direction[2]],
          normal: t.normal,
          modelMatrixNormal: t.modelMatrixNormal,
          uv: [w * t.uv[0][0] + a * t.uv[1][0] + b * t.uv[2][0], w * t.uv[0][1] + a * t.uv[1][1] + b * t.uv[2][1]],
        };
      }
    });
    return best;
  }

  /** The colour (bytes of the sRGB target) of a hit, by the documented PBR model. */
  shade(hit: Hit, wrongNormals = false): [number, number, number] {
    const placement = this.scene.placements[hit.entity]?.shading;
    if (placement === undefined) throw new Error("hit on an unknown entity");
    const camera = this.scene.camera.position;
    const shading = placement;
    const baseColor =
      shading.kind === "pbr" ? shading.baseColor : stripeBand(hit.uv[1], shading.bands) === 0 ? shading.a : shading.b;
    return linearRgbToSrgb8(
      shadePbr({
        N: wrongNormals ? hit.modelMatrixNormal : hit.normal,
        V: sub(camera, hit.position),
        position: hit.position,
        lights: this.scene.lights,
        baseColor,
        metallic: shading.metallic,
        roughness: shading.roughness,
        ambientColor: this.scene.ambientColor,
        ambientIntensity: this.scene.ambientIntensity,
      }),
    );
  }
}

/** The `step(0.5, fract(v * bands))` of materials.mtek: 0 for the first half of each band, 1 for the second. */
export function stripeBand(v: number, bands: number): 0 | 1 {
  const scaled = v * bands;
  return scaled - Math.floor(scaled) >= 0.5 ? 1 : 0;
}

function hitsBox(ray: Ray, min: Vec3, max: Vec3, limit: number): boolean {
  let near = 0;
  let far = limit;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis] ?? 0;
    const direction = ray.direction[axis] ?? 0;
    const lo = (min[axis] ?? 0) - 1e-9;
    const hi = (max[axis] ?? 0) + 1e-9;
    if (Math.abs(direction) < 1e-15) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    let t0 = (lo - origin) / direction;
    let t1 = (hi - origin) / direction;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The expected image
// ---------------------------------------------------------------------------

/** The footprint of a pixel: its centre, corners and edge midpoints. */
const FOOTPRINT: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0.5, 0],
  [0.5, 1],
  [0, 0.5],
  [1, 0.5],
];

export const MISS = -1;
export const UNSTABLE = -2;

export interface ExpectedImage {
  readonly width: number;
  readonly height: number;
  /** Per pixel: the index of the entity in front, `MISS` when nothing is hit, `UNSTABLE` when the footprint is not uniform. */
  readonly entity: Int16Array;
  /** Per pixel, RGB bytes (the clear colour for `MISS`; zeros for `UNSTABLE`). */
  readonly rgb: Uint8Array;
  readonly names: readonly string[];
}

/** The key that must agree across a pixel's footprint: the entity, the face it meets and, for stripes, the band. */
function footprintKey(tracer: Tracer, hit: Hit | undefined): string {
  if (hit === undefined) return "miss";
  const shading = tracer.scene.placements[hit.entity]?.shading;
  const band = shading?.kind === "stripes" ? String(stripeBand(hit.uv[1], shading.bands)) : "-";
  return `${String(hit.entity)}/${hit.normal.map((c) => c.toFixed(6)).join(",")}/${band}`;
}

/** Renders the scene on the CPU for a target of `width x height`: which entity each stable pixel shows and its colour. */
export function expectedImage(scene: SceneModel, width: number, height: number, options: { glb?: Glb; wrongNormals?: boolean } = {}): ExpectedImage {
  const glb = options.glb ?? loadChair();
  const tracer = new Tracer(scene, glb);
  const entity = new Int16Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const hits = FOOTPRINT.map(([dx, dy]) => tracer.cast(tracer.rayAt(width, height, x + dx, y + dy)));
      const keys = new Set(hits.map((hit) => footprintKey(tracer, hit)));
      const centre = hits[0];
      if (keys.size !== 1) {
        entity[index] = UNSTABLE;
        continue;
      }
      if (centre === undefined) {
        entity[index] = MISS;
        rgb.set(scene.clear, index * 3);
        continue;
      }
      entity[index] = centre.entity;
      rgb.set(tracer.shade(centre, options.wrongNormals === true), index * 3);
    }
  }
  return { width, height, entity, rgb, names: scene.placements.map((p) => p.name) };
}

export interface Comparison {
  /** Stable pixels compared. */
  readonly compared: number;
  readonly maxError: number;
  /** Where the largest error is and what both sides hold. */
  readonly worst: string;
  /** How many compared pixels differ by more than `tolerance` in some channel. */
  readonly outside: number;
  /** Compared pixels per entity name (`"clear"` for the background). */
  readonly perEntity: Readonly<Record<string, number>>;
}

/** Compares a read-back RGBA8 frame with the expected image over its stable pixels. */
export function compareImage(expected: ExpectedImage, frame: ArrayLike<number>, tolerance: number): Comparison {
  let compared = 0;
  let maxError = 0;
  let worst = "none";
  let outside = 0;
  const perEntity: Record<string, number> = {};
  for (let i = 0; i < expected.width * expected.height; i += 1) {
    const entity = expected.entity[i] ?? UNSTABLE;
    if (entity === UNSTABLE) continue;
    compared += 1;
    const name = entity === MISS ? "clear" : (expected.names[entity] ?? "?");
    perEntity[name] = (perEntity[name] ?? 0) + 1;
    let pixelError = 0;
    for (let c = 0; c < 3; c += 1) pixelError = Math.max(pixelError, Math.abs((frame[i * 4 + c] ?? -1000) - (expected.rgb[i * 3 + c] ?? 0)));
    if (pixelError > tolerance) outside += 1;
    if (pixelError > maxError) {
      maxError = pixelError;
      const x = i % expected.width;
      const y = Math.floor(i / expected.width);
      worst = `pixel ${String(x)},${String(y)} (${name}): GPU ${[0, 1, 2].map((c) => String(frame[i * 4 + c])).join(",")}, oracle ${[0, 1, 2].map((c) => String(expected.rgb[i * 3 + c])).join(",")}`;
    }
  }
  return { compared, maxError, worst, outside, perEntity };
}

// ---------------------------------------------------------------------------
// Host inputs
// ---------------------------------------------------------------------------

/** The values a host sets with `setInput`, under the names of mtek.toml `[host.inputs]` (colours as `#rrggbb`). */
export interface HostValues {
  seat_color?: string;
  seat_metallic?: number;
  seat_roughness?: number;
  frame_color?: string;
  frame_metallic?: number;
  frame_roughness?: number;
  stripe_a?: string;
  stripe_b?: string;
  back_roughness?: number;
  sun_intensity?: number;
}

/** The scene's inputs after the host set `values` on top of `base` (what the shaders see: colours linear). */
export function applyHostValues(values: HostValues, base: ConfiguratorInputs = DEFAULT_INPUTS): ConfiguratorInputs {
  return {
    seat: {
      baseColor: values.seat_color === undefined ? base.seat.baseColor : hexLinear(values.seat_color),
      metallic: values.seat_metallic ?? base.seat.metallic,
      roughness: values.seat_roughness ?? base.seat.roughness,
    },
    frame: {
      baseColor: values.frame_color === undefined ? base.frame.baseColor : hexLinear(values.frame_color),
      metallic: values.frame_metallic ?? base.frame.metallic,
      roughness: values.frame_roughness ?? base.frame.roughness,
    },
    stripeA: values.stripe_a === undefined ? base.stripeA : hexLinear(values.stripe_a),
    stripeB: values.stripe_b === undefined ? base.stripeB : hexLinear(values.stripe_b),
    backRoughness: values.back_roughness ?? base.backRoughness,
    sunIntensity: values.sun_intensity ?? base.sunIntensity,
  };
}

/** Pixels whose expected entity is `name` (stable ones only). */
export function pixelsOf(expected: ExpectedImage, name: string): number[] {
  const index = expected.names.indexOf(name);
  const out: number[] = [];
  expected.entity.forEach((entity, i) => {
    if (entity === index) out.push(i);
  });
  return out;
}
