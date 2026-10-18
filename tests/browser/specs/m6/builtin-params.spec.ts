// Decision 0087: the params of the built-in `Unlit` and `Pbr` are assigned by name from key handlers, read back by a handler,
// and every write reaches the picture on the real adapter. `fixtures/m6/builtin_params` is an `Unlit` box in the upper right
// corner and the unit sphere of the PBR fixture (support/pbr-scene.ts: camera on +Z at 3.5, fov 0.9, exposure scale 1) lit
// by one directional light and a white ambient term, in a 256 x 256 `rgba8unorm-srgb` target.
//
// The expectations are derived independently of the compiler and the runtime: the box's pixels are the bytes of the colour
// literals the handlers assign (an sRGB literal is stored linear and encoded back by the target), the sphere's pixels are the
// CPU oracle `shadePbr` (support/reference-shading.ts) for the param values the handlers assign, within 3 / 255 per channel
// as in the PBR spec, and the values read back into state are the literals (linear) and their binary32 sums.
import { expect, test } from "../../support/fixtures.ts";
import { srgbToLinear } from "../../support/m1-reference.ts";
import { BUILTIN_PARAMS } from "../../support/m6-fixtures.ts";
import { TARGET_SIZE, FOV_Y, CAMERA_DISTANCE, sunDirection, surfaceAt, type SurfacePoint } from "../../support/pbr-scene.ts";
import { linearRgbToSrgb8, shadePbr, type Vec3 } from "../../support/reference-shading.ts";

/** Bytes of tolerance per channel against the f64 oracle (as in the PBR spec). */
const TOLERANCE = 3;
const f = Math.fround;

/** The fixture's light: `quat.euler(-0.5, 0.6, 0)` applied to world -Z, white, 3 lux; ambient white at 0.1. */
const SUN_DIRECTION = sunDirection(-0.5, 0.6);
const SUN_INTENSITY = 3;
const AMBIENT_INTENSITY = 0.1;

/** The byte triple of a `#rrggbb` literal. */
const bytesOf = (rgb: number): [number, number, number] => [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
/** The linear value an sRGB literal is stored as, in binary32 (what reading the param back returns). */
const linearOf = (rgb: number): number[] => bytesOf(rgb).map((byte) => f(srgbToLinear(byte / 255)));

/**
 * The pixel at the centre of the front face of Badge (`Box { size: vec3(0.3) }` at (1.3, 1.0, 0)): the face is at z = 0.15,
 * 3.35 from the camera, so a point (x, y) of it is at NDC (x, y) / (3.35 tan(fov / 2)); the target is square.
 */
function badgePixel(): [number, number] {
  const scale = (CAMERA_DISTANCE - 0.15) * Math.tan(FOV_Y / 2);
  const u = 1.3 / scale;
  const v = 1.0 / scale;
  return [Math.floor(((u + 1) / 2) * TARGET_SIZE), Math.floor(((1 - v) / 2) * TARGET_SIZE)];
}

/** A 5 x 5 block around the badge's centre: the face is about 23 pixels wide, so every one of them sees it. */
function badgeBlock(): Array<[number, number]> {
  const [cx, cy] = badgePixel();
  const block: Array<[number, number]> = [];
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) block.push([cx + dx, cy + dy]);
  return block;
}

/** The pixel whose normal is closest to the half vector of the sun and the camera, and neighbours 8 and 14 pixels away. */
function specularPixels(): Array<[number, number]> {
  const toSun: Vec3 = [-SUN_DIRECTION[0], -SUN_DIRECTION[1], -SUN_DIRECTION[2]];
  let best: [number, number] = [128, 128];
  let bestScore = -Infinity;
  for (let y = 0; y < TARGET_SIZE; y += 1) {
    for (let x = 0; x < TARGET_SIZE; x += 1) {
      const point = surfaceAt(x, y);
      if (point === undefined) continue;
      const sum: Vec3 = [toSun[0] + point.V[0], toSun[1] + point.V[1], toSun[2] + point.V[2]];
      const score = (point.N[0] * sum[0] + point.N[1] * sum[1] + point.N[2] * sum[2]) / Math.hypot(...sum);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  const [px, py] = best;
  const around: Array<[number, number]> = [best, [px - 8, py], [px + 8, py], [px, py - 8], [px, py + 8], [px - 14, py], [px + 14, py]];
  return around.filter(([x, y]) => surfaceAt(x, y) !== undefined);
}

/** Sphere pixels: the specular neighbourhood, the middle, lit, grazing and dark sides. */
const SPHERE_PIXELS: Array<[number, number]> = [...specularPixels(), [128, 128], [155, 101], [160, 88], [83, 148], [183, 163], [108, 73], [188, 118], [100, 190], [75, 175]];
const POINTS: SurfacePoint[] = SPHERE_PIXELS.map(([x, y]) => {
  const point = surfaceAt(x, y);
  if (point === undefined) throw new Error(`pixel ${String(x)},${String(y)} misses the sphere`);
  return point;
});

interface Material {
  readonly label: string;
  readonly base: Vec3;
  readonly metallic: number;
  readonly roughness: number;
}

function oracleBytes(material: Material): Array<[number, number, number]> {
  return POINTS.map((point) =>
    linearRgbToSrgb8(
      shadePbr({
        N: point.N,
        V: point.V,
        position: point.position,
        lights: [{ kind: "directional", direction: SUN_DIRECTION, color: [1, 1, 1], intensity: SUN_INTENSITY }],
        baseColor: material.base,
        metallic: material.metallic,
        roughness: material.roughness,
        ambientColor: [1, 1, 1],
        ambientIntensity: AMBIENT_INTENSITY,
      }),
    ),
  );
}

interface AppLike {
  state: string;
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    pressKey(code: string): void;
    releaseKey(code: string): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    scene(): { state: Record<string, unknown> };
  };
}

interface Frame {
  readonly badge: Array<[number, number, number]>;
  readonly sphere: Array<[number, number, number]>;
}

interface Run {
  readonly frames: Frame[];
  readonly read: Record<string, unknown>;
  readonly reported: Array<{ code?: string }>;
  readonly state: string;
}

test.describe("the params of the built-in materials, assigned by name (decision 0087)", () => {
  test("the badge is where the geometry says and the sphere pixels see the sphere", () => {
    const [x, y] = badgePixel();
    expect(x).toBeGreaterThan(200);
    expect(y).toBeLessThan(80);
    // The box's front face spans x in [1.15, 1.45] and y in [0.85, 1.15] at z = 0.15: every pixel of the block is inside.
    const scale = (CAMERA_DISTANCE - 0.15) * Math.tan(FOV_Y / 2);
    for (const [px, py] of badgeBlock()) {
      const wx = ((2 * (px + 0.5)) / TARGET_SIZE - 1) * scale;
      const wy = (1 - (2 * (py + 0.5)) / TARGET_SIZE) * scale;
      expect(wx).toBeGreaterThan(1.16);
      expect(wx).toBeLessThan(1.44);
      expect(wy).toBeGreaterThan(0.86);
      expect(wy).toBeLessThan(1.14);
      expect(surfaceAt(px, py), "the badge is off the sphere").toBeUndefined();
    }
    expect(POINTS.length).toBeGreaterThanOrEqual(12);
  });

  test("an Unlit colour and the Pbr params written by key handlers change the pixels as the literals and the oracle say", async ({ page, gpu }, testInfo) => {
    void gpu;
    await page.goto(`/m6/${BUILTIN_PARAMS}/index.html`);
    const run = await page.evaluate(
      async ({ badge, sphere, size }): Promise<Run> => {
        const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike> };
        const reported: Array<{ code?: string }> = [];
        const app = await w.__mtekMount({
          test: { manualClock: true, renderTarget: { width: size, height: size } },
          onDiagnostic: (d: { code?: string }) => reported.push(d),
        });
        const frames: Frame[] = [];
        const capture = async (): Promise<void> => {
          app.debug.step(1, 1 / 60);
          const frame = await app.debug.readPixels();
          const at = ([x, y]: [number, number]): [number, number, number] => {
            const i = (y * frame.width + x) * 4;
            return [frame.data[i] ?? -1, frame.data[i + 1] ?? -1, frame.data[i + 2] ?? -1];
          };
          frames.push({ badge: badge.map(at), sphere: sphere.map(at) });
        };
        const press = async (code: string): Promise<void> => {
          app.debug.pressKey(code);
          await capture();
          app.debug.releaseKey(code);
        };
        await capture();
        await press("Space");
        await press("KeyM");
        await press("KeyU");
        app.debug.pressKey("KeyR");
        app.debug.step(1, 1 / 60);
        const read = { ...app.debug.scene().state };
        const state = app.state;
        app.dispose();
        return { frames, read, reported, state };
      },
      { badge: badgeBlock(), sphere: SPHERE_PIXELS, size: TARGET_SIZE },
    );
    expect(run.reported).toEqual([]);
    expect(run.state).toBe("running");
    expect(run.frames).toHaveLength(4);

    const initial: Material = { label: "initial (#ffffff, metallic 0, roughness 0.5)", base: [1, 1, 1], metallic: 0, roughness: 0.5 };
    const changed: Material = { label: "after M (base (0.9, 0.55, 0.25), metallic 0.5, roughness 0.3)", base: [f(0.9), f(0.55), f(0.25)], metallic: 0.5, roughness: f(0.3) };
    const added: Material = { ...changed, label: "after U (roughness += 0.4)", roughness: f(f(0.3) + f(0.4)) };
    // Frame by frame: the badge's literal and the sphere's material.
    const expected: Array<{ badge: number; material: Material }> = [
      { badge: 0x22c55e, material: initial },
      { badge: 0x3b82f6, material: initial },
      { badge: 0x3b82f6, material: changed },
      { badge: 0x3b82f6, material: added },
    ];
    const notes: string[] = [];
    run.frames.forEach((frame, index) => {
      const want = expected[index];
      if (want === undefined) throw new Error("no expectation");
      const literal = bytesOf(want.badge);
      for (const [i, pixel] of frame.badge.entries()) {
        pixel.forEach((got, channel) => {
          expect(Math.abs(got - (literal[channel] ?? -1000)), `frame ${String(index)}, badge pixel ${String(i)} channel ${String(channel)}: GPU ${String(got)}, literal ${String(literal[channel])}`).toBeLessThanOrEqual(1);
        });
      }
      const oracle = oracleBytes(want.material);
      let maxError = 0;
      oracle.forEach((bytes, i) => {
        bytes.forEach((byte, channel) => {
          const got = frame.sphere[i]?.[channel] ?? -1000;
          const error = Math.abs(got - byte);
          maxError = Math.max(maxError, error);
          expect(error, `frame ${String(index)} (${want.material.label}): pixel ${SPHERE_PIXELS[i]?.join(",") ?? "?"} channel ${String(channel)}: GPU ${String(got)}, oracle ${String(byte)}`).toBeLessThanOrEqual(TOLERANCE);
        });
      });
      // Most compared channels carry information (neither black nor clipped white).
      expect(oracle.flat().filter((byte) => byte > 8 && byte < 247).length, `${want.material.label}: informative channels`).toBeGreaterThan(oracle.length);
      notes.push(`frame ${String(index)} ${want.material.label}: max error ${String(maxError)} / 255 over ${String(oracle.length)} pixels`);
    });
    // The three materials give pictures that differ by far more than the tolerance: each write is visible.
    const differs = (a: Material, b: Material): number => {
      const x = oracleBytes(a).flat();
      const y = oracleBytes(b).flat();
      return Math.max(...x.map((value, i) => Math.abs(value - (y[i] ?? 0))));
    };
    expect(differs(initial, changed)).toBeGreaterThan(4 * TOLERANCE);
    expect(differs(changed, added)).toBeGreaterThan(4 * TOLERANCE);
    testInfo.annotations.push({ type: "builtin-params", description: notes.join("; ") });

    // R read the params back into state: what was written, as stored (linear binary32).
    const colour = (value: unknown): number[] => {
      const c = value as { r: number; g: number; b: number; a: number };
      return [c.r, c.g, c.b, c.a];
    };
    expect(colour(run.read["seen_color"])).toEqual([...linearOf(0x3b82f6), 1]);
    expect(colour(run.read["seen_base"])).toEqual([f(0.9), f(0.55), f(0.25), 1]);
    expect(run.read["seen_metallic"]).toBe(0.5);
    expect(run.read["seen_roughness"]).toBe(f(f(0.3) + f(0.4)));
  });
});
