// What `fixtures/m4/assets_scene` must look like (task M4-06, decision 0060), derived by hand from the numbers that
// `tests/assets/tools/make-glb.mjs` writes into the GLB and the PNGs, and sharing no code with the compiler or the runtime.
//
// The camera is orthographic (height 6, so 16 pixels per unit) on a 96 x 96 target, looking down -Z from z = 6, with the
// origin in the middle of the target: a point (x, y, 0) lies at pixel centre (48 + 16 x, 48 - 16 y), and the pixel (px, py)
// has its centre at world ((px + 0.5 - 48) / 16, (48 - (py + 0.5)) / 16). The scene is a 3 x 3 grid of cells 2 units
// (32 pixels) wide; cell (i, j) is centred at pixel (16 + 32 i, 16 + 32 j). Every mesh is a figure inside [-0.8, 0.8]²
// (+-12.8 pixels) around its cell centre.
import { linearRgbToSrgb8, shadePbr, type Vec3 } from "./reference-shading.ts";
import { sunDirection } from "./pbr-scene.ts";

export type Rgb = readonly [number, number, number];

export const TARGET_SIZE = 96;
export const PIXELS_PER_UNIT = 16;
export const CELL = 32;

/** The pixel at the centre of cell `(i, j)`. */
export function cellCentre(i: number, j: number): readonly [number, number] {
  return [CELL / 2 + CELL * i, CELL / 2 + CELL * j];
}

/** The world position of the centre of pixel `(px, py)` in the z = 0 plane. */
export function pixelToWorld(px: number, py: number): Vec3 {
  return [(px + 0.5 - TARGET_SIZE / 2) / PIXELS_PER_UNIT, (TARGET_SIZE / 2 - (py + 0.5)) / PIXELS_PER_UNIT, 0];
}

/** The scene's `clear_color: #102030`. */
export const CLEAR: Rgb = [0x10, 0x20, 0x30];

/**
 * Sample offsets (pixels from the cell centre) of the four quadrants of a panel, in texel order: top left, top right,
 * bottom left, bottom right. Each lies 6 pixels from both texel edges' boundary lines and 6.8 from the panel's rim.
 */
export const QUADRANTS: ReadonlyArray<readonly [number, number]> = [
  [-6, -6],
  [6, -6],
  [-6, 6],
  [6, 6],
];

/** The 2 x 2 images, texel by texel (top row first), exactly as `make-glb.mjs` writes them. */
export const CHECKER_TEXELS: readonly Rgb[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
];
export const WOOD_TEXELS: readonly Rgb[] = [
  [139, 90, 43],
  [160, 110, 60],
  [120, 75, 35],
  [150, 100, 50],
];
export const MASK_TEXELS: readonly Rgb[] = [
  [255, 255, 255],
  [128, 128, 128],
  [64, 64, 64],
  [0, 0, 0],
];
/** The JPEG is one flat grey: an 8 x 8 block with the DC coefficient 36 and quantiser 16, 36 * 16 / 8 + 128 = 200. */
export const GREY_LEVEL = 200;

/**
 * An `-srgb` colour texture (wood, checker, grey) sampled with nearest filtering returns the texel as a linear value, and the
 * `-srgb` target encodes it again: the bytes come back unchanged. A `linear` texture (the mask) returns `byte / 255` as it is,
 * and the target encodes that: sRGB(128 / 255) = 1.055 * 0.50196^(1 / 2.4) - 0.055 = 0.7366, so 188; sRGB(64 / 255) =
 * 1.055 * 0.25098^(1 / 2.4) - 0.055 = 0.5381, so 137; 255 and 0 map to themselves. Read as sRGB data they would show 128
 * and 64: a colour-space mistake is a difference of 60 and 73 bytes.
 */
export const MASK_PIXELS: readonly Rgb[] = [
  [255, 255, 255],
  [188, 188, 188],
  [137, 137, 137],
  [0, 0, 0],
];

/**
 * Base colour factors of the GLB (linear, as glTF stores them) and the bytes the sRGB target holds for them, worked out by
 * hand with sRGB(c) = 1.055 c^(1 / 2.4) - 0.055 (c above 0.0031308), times 255, rounded:
 *   Oak   (0.6, 0.3, 0.1):  0.7978 -> 203.4,  0.5840 -> 148.9,  0.3492 -> 89.0
 *   Slate (0.2, 0.4, 0.8):  0.4846 -> 123.6,  0.6651 -> 169.6,  0.9063 -> 231.1
 */
export const OAK_LINEAR: Rgb = [0.6, 0.3, 0.1];
export const OAK_PIXEL: Rgb = [203, 149, 89];
export const SLATE_LINEAR: Rgb = [0.2, 0.4, 0.8];
export const SLATE_PIXEL: Rgb = [124, 170, 231];

/** Where the figures of the cells without a texture are, as pixel offsets from the cell centre: (dx, dy) with y down. */
export const FIGURE_HALF = 12.8;

/**
 * Corner (cell 1, 0): the right angle is at the bottom left, so the figure is the part of the square below the diagonal
 * from the bottom right (+12.8, +12.8) to the top left (-12.8, -12.8), i.e. `dy > dx`. (-6, +6) is 8.5 pixels inside it,
 * (+6, -6) is 8.5 pixels outside.
 */
export const CORNER_INSIDE: readonly [number, number] = [-6, 6];
export const CORNER_OUTSIDE: readonly [number, number] = [6, -6];

/**
 * Square (cell 0, 1) fills the square: its corner (-10, -10) is inside. Roof (cell 1, 1) is the triangle with the base
 * from (-12.8, +12.8) to (+12.8, +12.8) and the apex (0, -12.8): at dy the half width is 12.8 (dy + 12.8) / 25.6, which is
 * 20.8 / 2 = 10.4 at dy = +8 (so (-6, +8) is inside), 11.4 at dy = +10, and 1.4 at dy = -10 (so (-10, -10) is outside).
 */
export const SQUARE_INSIDE: ReadonlyArray<readonly [number, number]> = [
  [-10, -10],
  [10, 10],
];
export const ROOF_INSIDE: ReadonlyArray<readonly [number, number]> = [
  [0, 6],
  [-6, 8],
];
export const ROOF_OUTSIDE: ReadonlyArray<readonly [number, number]> = [
  [-10, -10],
  [10, -10],
];

// ---- Lacquer (cell 2, 0): Pbr under a sun and an ambient term, shaded by the oracle ----

/** The GLB material "Lacquer" and the scene's lights, as the manifest states them. */
export const LACQUER = { baseColor: [0.8, 0.2, 0.1] as Vec3, metallic: 0, roughness: 0.5 };
export const SUN = { pitch: -0.9, yaw: 0.4, intensity: 3, color: [1, 1, 1] as Vec3 };
export const AMBIENT_COLOR: Vec3 = [1, 1, 1];
export const AMBIENT_INTENSITY = 0.2;
export const CAMERA_POSITION: Vec3 = [0, 0, 6];

/** Sample offsets in the Lacquer cell. */
export const LACQUER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-8, -8],
  [8, -8],
  [-8, 8],
  [8, 8],
];

/** The oracle's linear colour of the Lacquer panel at pixel `(px, py)`: N = +Z, V towards the camera, one sun, ambient. */
export function lacquerLinear(px: number, py: number): Vec3 {
  const position = pixelToWorld(px, py);
  return shadePbr({
    N: [0, 0, 1],
    V: [CAMERA_POSITION[0] - position[0], CAMERA_POSITION[1] - position[1], CAMERA_POSITION[2] - position[2]],
    position,
    lights: [{ kind: "directional", direction: sunDirection(SUN.pitch, SUN.yaw), color: SUN.color, intensity: SUN.intensity }],
    baseColor: LACQUER.baseColor,
    metallic: LACQUER.metallic,
    roughness: LACQUER.roughness,
    ambientColor: AMBIENT_COLOR,
    ambientIntensity: AMBIENT_INTENSITY,
  });
}

/** The bytes of the target at pixel `(px, py)` of the Lacquer panel. */
export function lacquerPixel(px: number, py: number): readonly [number, number, number] {
  return linearRgbToSrgb8(lacquerLinear(px, py));
}
