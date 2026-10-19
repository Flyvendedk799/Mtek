// The scene definitions of the seven workloads, as pure functions of the numbers in each `workload.json`.
//
// The three implementations of a workload (an Mtek program, the direct-WebGPU reference, the three.js baseline) must
// show the same scene, so every position, angle, scale, phase and colour is computed here once: the direct and three.js
// implementations call these functions at run time, and `tools/gen-mtek.ts` calls them to print the literals of the
// Mtek program. The module is part of the frozen definitions (FROZEN.json): changing a formula changes the tree hash.
//
// Units are metres and radians, +Y is up. Everything is computed in binary64; the generated Mtek program prints each
// number rounded to binary32 (`f32Literal`), because Mtek's `f32` is what it computes with.

export type Vec3 = readonly [number, number, number];

export const TAU = 2 * Math.PI;

/** 0.6180339887498949: the fractional part of `i * golden ratio` spreads phases evenly over any run of indices. */
export function goldenPhase(index: number): number {
  return ((index * 0.6180339887498949) % 1) * TAU;
}

/** The exact sRGB EOTF of `spec/language.md` section 5.4, in binary64. */
export function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` to linear RGB, as Mtek's colour literal does. */
export function hexToLinear(hex: string): Vec3 {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`expected a colour like "#6b5cff", got ${JSON.stringify(hex)}`);
  const channel = (offset: number): number => srgbToLinear(parseInt(hex.slice(offset, offset + 2), 16));
  return [channel(1), channel(3), channel(5)];
}

/** The shortest decimal that reads back as the same binary32 value, always with a decimal point (an Mtek float literal). */
export function f32Literal(value: number): string {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) throw new Error(`cannot print ${String(value)} as a literal`);
  let digits = 1;
  let text = rounded.toPrecision(digits);
  while (Math.fround(Number(text)) !== rounded && digits < 12) {
    digits += 1;
    text = rounded.toPrecision(digits);
  }
  let number = String(Number(text));
  if (/e/i.test(number)) {
    // Mtek has `2.5e-3` but not `1e-7`: a mantissa needs a decimal point.
    const [mantissa = "0", exponent = "0"] = number.toLowerCase().split("e");
    number = `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}e${exponent}`;
  } else if (!number.includes(".")) {
    number = `${number}.0`;
  }
  return number;
}

// ---- constant scene ---------------------------------------------------------------------------------------------

export interface ConstantSceneDefinition {
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  readonly boxSize: number;
  readonly yawStepRad: number;
  readonly yawCycle: number;
  readonly palette: readonly string[];
  readonly paletteStride: readonly [number, number];
}

export interface PlacedBox {
  readonly index: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly scale: number;
  readonly colorIndex: number;
  readonly phase: number;
}

/** A columns x rows grid on the plane y = 0 centred on the origin; the colour index is `(col * a + row * b) mod palette size`. */
export function constantScene(def: ConstantSceneDefinition): PlacedBox[] {
  const out: PlacedBox[] = [];
  for (let index = 0; index < def.columns * def.rows; index += 1) {
    const col = index % def.columns;
    const row = Math.floor(index / def.columns);
    out.push({
      index,
      position: [(col - (def.columns - 1) / 2) * def.spacing, 0, (row - (def.rows - 1) / 2) * def.spacing],
      yaw: (index % def.yawCycle) * def.yawStepRad,
      scale: 1,
      colorIndex: (col * def.paletteStride[0] + row * def.paletteStride[1]) % def.palette.length,
      phase: 0,
    });
  }
  return out;
}

// ---- 1,000 changing transforms ---------------------------------------------------------------------------------

export interface ChangingTransformsDefinition {
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  readonly boxSize: number;
  readonly amplitude: number;
  readonly frequency: number;
  readonly spin: number;
  readonly color: string;
}

export function changingTransforms(def: ChangingTransformsDefinition): PlacedBox[] {
  const out: PlacedBox[] = [];
  for (let index = 0; index < def.columns * def.rows; index += 1) {
    const col = index % def.columns;
    const row = Math.floor(index / def.columns);
    out.push({
      index,
      position: [(col - (def.columns - 1) / 2) * def.spacing, 0, (row - (def.rows - 1) / 2) * def.spacing],
      yaw: 0,
      scale: 1,
      colorIndex: 0,
      phase: goldenPhase(index),
    });
  }
  return out;
}

/** Position and yaw of box `box` at active time `t` seconds: bobbing along y and turning about +Y. */
export function transformAt(def: ChangingTransformsDefinition, box: PlacedBox, t: number): { position: Vec3; yaw: number } {
  return {
    position: [box.position[0], box.position[1] + def.amplitude * Math.sin(t * def.frequency + box.phase), box.position[2]],
    yaw: t * def.spin + box.phase,
  };
}

// ---- 500 changing material params -------------------------------------------------------------------------------

export interface ChangingMaterialsDefinition {
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  readonly boxSize: number;
  readonly colorFrequency: number;
  readonly colorOffsets: readonly [number, number, number];
}

export function changingMaterials(def: ChangingMaterialsDefinition): PlacedBox[] {
  const out: PlacedBox[] = [];
  for (let index = 0; index < def.columns * def.rows; index += 1) {
    const col = index % def.columns;
    const row = Math.floor(index / def.columns);
    out.push({
      index,
      position: [(col - (def.columns - 1) / 2) * def.spacing, 0, (row - (def.rows - 1) / 2) * def.spacing],
      yaw: 0,
      scale: 1,
      colorIndex: 0,
      phase: goldenPhase(index),
    });
  }
  return out;
}

/** The linear colour of box `box` at active time `t`: three phase-shifted sines mapped to [0, 1]. */
export function colorAt(def: ChangingMaterialsDefinition, box: PlacedBox, t: number): Vec3 {
  const channel = (offset: number): number => 0.5 + 0.5 * Math.sin(t * def.colorFrequency + box.phase + offset);
  return [channel(def.colorOffsets[0]), channel(def.colorOffsets[1]), channel(def.colorOffsets[2])];
}

// ---- 2,000 repeated meshes ------------------------------------------------------------------------------------

export interface RepeatedMeshesDefinition {
  readonly lattice: readonly [number, number, number];
  readonly spacing: number;
  readonly boxSize: number;
  readonly scaleMin: number;
  readonly scaleSpan: number;
  readonly yawStepRad: number;
  readonly color: string;
}

export function repeatedMeshes(def: RepeatedMeshesDefinition): PlacedBox[] {
  const [nx, ny, nz] = def.lattice;
  const out: PlacedBox[] = [];
  for (let index = 0; index < nx * ny * nz; index += 1) {
    const a = index % nx;
    const b = Math.floor(index / nx) % ny;
    const c = Math.floor(index / (nx * ny));
    out.push({
      index,
      position: [(a - (nx - 1) / 2) * def.spacing, (b - (ny - 1) / 2) * def.spacing, (c - (nz - 1) / 2) * def.spacing],
      yaw: (index * def.yawStepRad) % TAU,
      scale: def.scaleMin + (def.scaleSpan * ((index * 7) % 10)) / 10,
      colorIndex: 0,
      phase: 0,
    });
  }
  return out;
}

// ---- 300 physics bodies ---------------------------------------------------------------------------------------

export interface PhysicsBodiesDefinition {
  readonly columns: number;
  readonly rows: number;
  readonly layers: number;
  readonly spacing: number;
  readonly jitter: number;
  readonly baseHeight: number;
  readonly layerHeight: number;
  readonly boxSize: number;
  readonly mass: number;
  readonly friction: number;
  readonly floorSize: Vec3;
  readonly forceAmplitude: number;
  readonly forceFrequency: readonly [number, number];
  readonly layerColors: readonly string[];
}

/** A deterministic number in [0, 1) for an index and a salt: the fractional part of a sine product, never a random source. */
export function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function physicsBodies(def: PhysicsBodiesDefinition): PlacedBox[] {
  const out: PlacedBox[] = [];
  const perLayer = def.columns * def.rows;
  for (let index = 0; index < perLayer * def.layers; index += 1) {
    const layer = Math.floor(index / perLayer);
    const col = index % def.columns;
    const row = Math.floor((index % perLayer) / def.columns);
    const jitterX = (hash01(index, 1) - 0.5) * 2 * def.jitter;
    const jitterZ = (hash01(index, 2) - 0.5) * 2 * def.jitter;
    out.push({
      index,
      position: [
        (col - (def.columns - 1) / 2) * def.spacing + jitterX,
        def.baseHeight + layer * def.layerHeight,
        (row - (def.rows - 1) / 2) * def.spacing + jitterZ,
      ],
      yaw: 0,
      scale: 1,
      colorIndex: layer % def.layerColors.length,
      phase: goldenPhase(index),
    });
  }
  return out;
}

/** The horizontal force (newtons) the benchmark applies to body `box` while the active time is `t`; it keeps every body awake. */
export function forceAt(def: PhysicsBodiesDefinition, box: PlacedBox, t: number): Vec3 {
  return [
    def.forceAmplitude * Math.sin(t * def.forceFrequency[0] + box.phase),
    0,
    def.forceAmplitude * Math.cos(t * def.forceFrequency[1] + 2 * box.phase),
  ];
}

// ---- asset-heavy startup ----------------------------------------------------------------------------------------

export interface AssetHeavyDefinition {
  readonly meshes: number;
  readonly textures: number;
  readonly textureSize: number;
  readonly sphereSegments: number;
  readonly sphereRings: number;
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  readonly radius: number;
}

export interface PlacedAsset {
  readonly index: number;
  readonly position: Vec3;
  readonly meshIndex: number;
  readonly textureIndex: number;
}

export function assetHeavy(def: AssetHeavyDefinition): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  for (let index = 0; index < def.columns * def.rows; index += 1) {
    const col = index % def.columns;
    const row = Math.floor(index / def.columns);
    out.push({
      index,
      position: [(col - (def.columns - 1) / 2) * def.spacing, 0, (row - (def.rows - 1) / 2) * def.spacing],
      meshIndex: col % def.meshes,
      textureIndex: (col * 3 + row) % def.textures,
    });
  }
  return out;
}

// ---- mount, reload and dispose cycles ---------------------------------------------------------------------------

export interface CyclesDefinition {
  readonly columns: number;
  readonly rows: number;
  readonly spacing: number;
  readonly boxSize: number;
  readonly palette: readonly string[];
  /** The reload applies an edit of the program: the palette is read shifted by this many entries. */
  readonly reloadPaletteShift: number;
}

export function cycleScene(def: CyclesDefinition, paletteShift: number): PlacedBox[] {
  const out: PlacedBox[] = [];
  for (let index = 0; index < def.columns * def.rows; index += 1) {
    const col = index % def.columns;
    const row = Math.floor(index / def.columns);
    out.push({
      index,
      position: [(col - (def.columns - 1) / 2) * def.spacing, 0, (row - (def.rows - 1) / 2) * def.spacing],
      yaw: (index % 5) * 0.3,
      scale: 1,
      colorIndex: (col + row * 3 + paletteShift) % def.palette.length,
      phase: 0,
    });
  }
  return out;
}
