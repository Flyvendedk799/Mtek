// M4-03: the documented PBR subset (spec/materials.md section 8) on the real adapter, compared with the CPU oracle
// `shadePbr` (support/reference-shading.ts). `fixtures/m4/pbr` is a unit sphere lit through the prelude `Pbr` material by
// up to three lights (a directional light, a point light with range 5 and a point light without a range) and a coloured
// ambient term, everything varied through host inputs. The target is a 256 x 256 `rgba8unorm-srgb` image.
//
// For each chosen pixel the test derives N, V and the surface point from the pixel's ray (support/pbr-scene.ts, analytic;
// the sphere has 256 x 128 segments so its facets are well below a pixel), builds the oracle's input for the case, and
// compares the GPU bytes with `linearRgbToSrgb8(shadePbr(..))`, channel by channel, within 3 / 255. Cases: metallic 0 and 1
// with roughness 0.2 and 0.8 under the directional light; a point light with range with the surface inside, partly inside
// and outside the window; a point light without range; ambient only; all three lights together; and saturation (a light so
// intense that channels clip, with no tone mapping: an unclipped channel keeps its value).
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { srgbToLinear } from "../../support/m1-reference.ts";
import { PBR } from "../../support/m4-fixtures.ts";
import { CAMERA_POSITION, TARGET_SIZE, sunDirection, surfaceAt, type SurfacePoint } from "../../support/pbr-scene.ts";
import { linearRgbToSrgb8, shadePbr, type Light, type Vec3 } from "../../support/reference-shading.ts";

/** Bytes of tolerance per channel against the f64 oracle (the acceptance criterion of M4-03). */
const TOLERANCE = 3;

/** The fixture's constants: its `ambient_color: #ffc080`, `ambient_intensity: 0.15`, the `Free` light's colour `#ffe0c0` and the `Lamp` range. */
const hexLinear = (r: number, g: number, b: number): Vec3 => [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
const AMBIENT_COLOR = hexLinear(0xff, 0xc0, 0x80);
const AMBIENT_INTENSITY = 0.15;
const FREE_COLOR = hexLinear(0xff, 0xe0, 0xc0);
const LAMP_RANGE = 5;

/** The sampled pixels: the middle, the neighbourhood of the specular peak of the sun, bright, mid, grazing and dark sides. */
const PIXELS: ReadonlyArray<readonly [number, number]> = [
  [128, 128],
  [155, 101],
  [160, 88],
  [83, 148],
  [183, 163],
  [108, 73],
  [188, 118],
  [100, 190],
  [75, 175],
  [135, 175],
];

interface Scenario {
  readonly label: string;
  readonly metallic: number;
  readonly roughness: number;
  /** Linear base colour. */
  readonly base: Vec3;
  readonly sun?: { readonly pitch: number; readonly yaw: number; readonly intensity: number; readonly color: Vec3 };
  readonly lamp?: { readonly position: Vec3; readonly intensity: number };
  readonly free?: { readonly position: Vec3; readonly intensity: number };
}

const BASE: Vec3 = [0.9, 0.55, 0.25];
const SUN = { pitch: -0.5, yaw: 0.6, intensity: 3, color: [1, 0.95, 0.85] } as const;

/** Host inputs of a scenario: every input is set, lights not in the scenario at intensity 0. */
function inputsOf(scenario: Scenario): Record<string, unknown> {
  const sun = scenario.sun;
  return {
    metal: scenario.metallic,
    rough: scenario.roughness,
    base: [...scenario.base],
    sun_pitch: sun?.pitch ?? SUN.pitch,
    sun_yaw: sun?.yaw ?? SUN.yaw,
    sun_intensity: sun?.intensity ?? 0,
    sun_color: [...(sun?.color ?? [1, 1, 1])],
    lamp_pos: [...(scenario.lamp?.position ?? [1.2, 1.6, 2])],
    lamp_intensity: scenario.lamp?.intensity ?? 0,
    free_pos: [...(scenario.free?.position ?? [-2, 1, 3])],
    free_intensity: scenario.free?.intensity ?? 0,
  };
}

function lightsOf(scenario: Scenario): Light[] {
  const lights: Light[] = [];
  if (scenario.sun !== undefined) {
    lights.push({ kind: "directional", direction: sunDirection(scenario.sun.pitch, scenario.sun.yaw), color: scenario.sun.color, intensity: scenario.sun.intensity });
  }
  if (scenario.lamp !== undefined) {
    lights.push({ kind: "point", position: scenario.lamp.position, color: [1, 1, 1], intensity: scenario.lamp.intensity, range: LAMP_RANGE });
  }
  if (scenario.free !== undefined) {
    lights.push({ kind: "point", position: scenario.free.position, color: FREE_COLOR, intensity: scenario.free.intensity });
  }
  return lights;
}

/** The oracle's linear colour of `point` in `scenario`. */
function oracle(scenario: Scenario, point: SurfacePoint): Vec3 {
  return shadePbr({
    N: point.N,
    V: point.V,
    position: point.position,
    lights: lightsOf(scenario),
    baseColor: scenario.base,
    metallic: scenario.metallic,
    roughness: scenario.roughness,
    ambientColor: AMBIENT_COLOR,
    ambientIntensity: AMBIENT_INTENSITY,
  });
}

interface AppLike {
  setInput(name: string, value: unknown): { ok: boolean };
  state: string;
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
  };
}

interface Rendered {
  readonly rgb: Array<Array<[number, number, number]>>;
  readonly counters: Record<string, number>[];
  readonly reported: Array<{ code?: string }>;
  readonly state: string;
}

/** Mounts the fixture and renders every scenario in turn: all inputs set, one frame, the listed pixels read back. */
async function render(page: Page, inputs: ReadonlyArray<Record<string, unknown>>): Promise<Rendered> {
  await page.goto(`/m4/${PBR}/index.html`);
  return page.evaluate(
    async ({ cases, pixels, size }): Promise<Rendered> => {
      const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike> };
      const reported: Array<{ code?: string }> = [];
      const app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: { width: size, height: size } },
        onDiagnostic: (d: { code?: string }) => reported.push(d),
      });
      const rgb: Array<Array<[number, number, number]>> = [];
      const counters: Record<string, number>[] = [];
      for (const values of cases) {
        for (const [name, value] of Object.entries(values)) {
          if (!app.setInput(name, value).ok) throw new Error(`input ${name} = ${JSON.stringify(value)} was rejected`);
        }
        app.debug.step(1, 1 / 60);
        const frame = await app.debug.readPixels();
        rgb.push(
          pixels.map(([x, y]) => {
            const i = (y * frame.width + x) * 4;
            return [frame.data[i] ?? -1, frame.data[i + 1] ?? -1, frame.data[i + 2] ?? -1] as [number, number, number];
          }),
        );
        counters.push({ ...app.debug.counters() });
      }
      const state = app.state;
      app.dispose();
      return { rgb, counters, reported, state };
    },
    { cases: [...inputs], pixels: PIXELS.map(([x, y]) => [x, y] as [number, number]), size: TARGET_SIZE },
  );
}

interface Comparison {
  readonly maxError: number;
  readonly worst: string;
  /** Expected linear values per pixel. */
  readonly expectedLinear: Vec3[];
  readonly expected: Array<[number, number, number]>;
}

/** Compares the GPU bytes of a scenario with the oracle; fails with the pixel, channel and both values on a miss. */
function compare(scenario: Scenario, actual: ReadonlyArray<readonly number[]>, points: readonly SurfacePoint[]): Comparison {
  let maxError = 0;
  let worst = "";
  const expectedLinear: Vec3[] = [];
  const expected: Array<[number, number, number]> = [];
  points.forEach((point, index) => {
    const linear = oracle(scenario, point);
    const bytes = linearRgbToSrgb8(linear);
    expectedLinear.push(linear);
    expected.push(bytes);
    for (let channel = 0; channel < 3; channel += 1) {
      const got = actual[index]?.[channel] ?? -1000;
      const error = Math.abs(got - (bytes[channel] ?? 0));
      if (error > maxError) {
        maxError = error;
        worst = `pixel ${PIXELS[index]?.join(",") ?? "?"} channel ${String(channel)}: GPU ${String(got)}, oracle ${String(bytes[channel])} (linear ${linear[channel]?.toFixed(5) ?? "?"})`;
      }
      expect(error, `${scenario.label}: pixel ${PIXELS[index]?.join(",") ?? "?"} channel ${String(channel)}: GPU ${String(got)}, oracle ${String(bytes[channel])} (linear ${linear[channel]?.toFixed(5) ?? "?"})`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
  return { maxError, worst, expectedLinear, expected };
}

/** How many of the compared channels carry information: not clipped to black or white by the 8-bit target. */
function informative(expected: ReadonlyArray<readonly number[]>): number {
  return expected.flat().filter((byte) => byte > 8 && byte < 247).length;
}

const POINTS: SurfacePoint[] = PIXELS.map(([x, y]) => {
  const point = surfaceAt(x, y);
  if (point === undefined) throw new Error(`pixel ${String(x)},${String(y)} misses the sphere`);
  return point;
});

const distanceTo = (position: Vec3, point: SurfacePoint): number => Math.hypot(position[0] - point.position[0], position[1] - point.position[1], position[2] - point.position[2]);

test.describe("the PBR material against the CPU oracle (M4-03)", () => {
  test("the chosen pixels all see the sphere and the camera geometry matches the fixture", () => {
    expect(CAMERA_POSITION).toEqual([0, 0, 3.5]);
    for (const point of POINTS) {
      expect(Math.hypot(...point.position)).toBeCloseTo(1, 12);
      expect(point.N[2]).toBeGreaterThan(0.2);
    }
    // The pixels cover the lit side, grazing incidence and the side facing away from the sun (N . L <= 0, where the
    // light term is exactly 0 and only ambient light remains).
    const toSun = sunDirection(SUN.pitch, SUN.yaw).map((c) => -c);
    const nl = POINTS.map((point) => point.N[0] * (toSun[0] ?? 0) + point.N[1] * (toSun[1] ?? 0) + point.N[2] * (toSun[2] ?? 0));
    expect(Math.max(...nl)).toBeGreaterThan(0.9);
    expect(nl.filter((value) => value > 0 && value < 0.25).length, "grazing pixels").toBeGreaterThanOrEqual(1);
    expect(nl.filter((value) => value <= 0).length, "pixels facing away from the sun").toBeGreaterThanOrEqual(1);
  });

  test("the directional light for metallic 0 and 1 and roughness 0.2 and 0.8", async ({ page, gpu }, testInfo) => {
    void gpu;
    const scenarios: Scenario[] = [];
    for (const metallic of [0, 1]) {
      for (const roughness of [0.2, 0.8]) {
        scenarios.push({ label: `sun, metallic ${String(metallic)}, roughness ${String(roughness)}`, metallic, roughness, base: BASE, sun: SUN });
      }
    }
    const result = await render(page, scenarios.map(inputsOf));
    expect(result.reported).toEqual([]);
    expect(result.state).toBe("running");
    const notes: string[] = [];
    scenarios.forEach((scenario, index) => {
      const comparison = compare(scenario, result.rgb[index] ?? [], POINTS);
      expect(informative(comparison.expected), `${scenario.label}: the compared values are not mostly clipped`).toBeGreaterThanOrEqual(10);
      notes.push(`${scenario.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"})`);
    });
    testInfo.annotations.push({ type: "m4-pbr-max-error", description: notes.join("; ") });
    // The four renderings differ from each other: metallic and roughness are not ignored.
    const flat = (index: number): string => JSON.stringify(result.rgb[index]);
    expect(new Set([0, 1, 2, 3].map(flat)).size).toBe(4);
  });

  test("a point light with a range: inside the window, across its edge and outside it", async ({ page, gpu }, testInfo) => {
    void gpu;
    const lampAt = (position: Vec3, label: string, metallic: number, roughness: number): Scenario => ({
      label,
      metallic,
      roughness,
      base: [0.7, 0.6, 0.5],
      lamp: { position, intensity: 8 },
    });
    const inside = [lampAt([1.2, 1.6, 2], "lamp inside the window, dielectric", 0, 0.5), lampAt([1.2, 1.6, 2], "lamp inside the window, metal", 1, 0.3)];
    const across = lampAt([4.5, 1.5, 1.5], "lamp across the window edge, dielectric", 0, 0.4);
    const outside = lampAt([3.5, 4.5, 3], "lamp outside the window", 0, 0.4);
    const scenarios = [...inside, across, outside];

    // The geometry of the cases is what their names say.
    const inDistances = POINTS.map((point) => distanceTo([1.2, 1.6, 2], point));
    expect(Math.max(...inDistances)).toBeLessThan(LAMP_RANGE);
    expect(Math.max(...inDistances) / LAMP_RANGE, "the window actually attenuates inside it").toBeGreaterThan(0.5);
    const acrossDistances = POINTS.map((point) => distanceTo([4.5, 1.5, 1.5], point));
    expect(Math.min(...acrossDistances)).toBeLessThan(LAMP_RANGE);
    expect(Math.max(...acrossDistances)).toBeGreaterThan(LAMP_RANGE);
    expect(Math.min(...POINTS.map((point) => distanceTo([3.5, 4.5, 3], point)))).toBeGreaterThan(LAMP_RANGE);

    const result = await render(page, [...scenarios.map(inputsOf), inputsOf({ label: "ambient", metallic: 0, roughness: 0.4, base: [0.7, 0.6, 0.5] })]);
    expect(result.reported).toEqual([]);
    const notes: string[] = [];
    scenarios.forEach((scenario, index) => {
      const comparison = compare(scenario, result.rgb[index] ?? [], POINTS);
      notes.push(`${scenario.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"})`);
      if (scenario !== outside) expect(informative(comparison.expected), `${scenario.label}: the compared values are not mostly clipped`).toBeGreaterThanOrEqual(10);
    });
    testInfo.annotations.push({ type: "m4-pbr-max-error", description: notes.join("; ") });
    // Outside the window the light contributes exactly nothing: the image is the ambient-only image.
    expect(result.rgb[scenarios.indexOf(outside)]).toEqual(result.rgb[scenarios.length]);
    // Across the edge the window cuts the light: it differs from both the ambient image and the unwindowed neighbours.
    expect(result.rgb[scenarios.indexOf(across)]).not.toEqual(result.rgb[scenarios.length]);
  });

  test("a point light without a range falls off with the square of the distance", async ({ page, gpu }, testInfo) => {
    void gpu;
    const scenarios: Scenario[] = [
      { label: "free lamp, metallic 0.3, roughness 0.4", metallic: 0.3, roughness: 0.4, base: [0.6, 0.7, 0.8], free: { position: [-2, 1, 3], intensity: 10 } },
      // The same light twice as far away shows a quarter of the radiance on a surface it meets at the same angle: here
      // only checked through the oracle at the new place.
      { label: "free lamp far away", metallic: 0, roughness: 0.6, base: [0.6, 0.7, 0.8], free: { position: [-6, 3, 9], intensity: 90 } },
    ];
    const result = await render(page, scenarios.map(inputsOf));
    expect(result.reported).toEqual([]);
    const notes: string[] = [];
    scenarios.forEach((scenario, index) => {
      const comparison = compare(scenario, result.rgb[index] ?? [], POINTS);
      expect(informative(comparison.expected), `${scenario.label}: the compared values are not mostly clipped`).toBeGreaterThanOrEqual(10);
      notes.push(`${scenario.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"})`);
    });
    testInfo.annotations.push({ type: "m4-pbr-max-error", description: notes.join("; ") });
  });

  test("ambient light only: base colour times the ambient colour, independent of metallic and roughness", async ({ page, gpu }, testInfo) => {
    void gpu;
    const scenarios: Scenario[] = [
      { label: "ambient, dielectric, rough 0.8", metallic: 0, roughness: 0.8, base: BASE },
      { label: "ambient, metal, rough 0.2", metallic: 1, roughness: 0.2, base: BASE },
      { label: "ambient, black base", metallic: 0.5, roughness: 0.5, base: [0, 0, 0] },
    ];
    const result = await render(page, scenarios.map(inputsOf));
    expect(result.reported).toEqual([]);
    const notes: string[] = [];
    scenarios.forEach((scenario, index) => {
      const comparison = compare(scenario, result.rgb[index] ?? [], POINTS);
      notes.push(`${scenario.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"})`);
      // The value is the closed form c * ambient_color * ambient_intensity at every pixel.
      for (const linear of comparison.expectedLinear) {
        scenario.base.forEach((c, channel) => expect(linear[channel]).toBeCloseTo(c * (AMBIENT_COLOR[channel] ?? 0) * AMBIENT_INTENSITY, 12));
      }
    });
    testInfo.annotations.push({ type: "m4-pbr-max-error", description: notes.join("; ") });
    // Flat: every sphere pixel has the same colour, and ambient does not depend on metallic or roughness.
    const first = result.rgb[0] ?? [];
    expect(new Set(first.map(String)).size).toBe(1);
    expect(result.rgb[1]).toEqual(first);
    expect(first[0]?.[0], "the red channel of the ambient colour dominates the blue one").toBeGreaterThan(first[0]?.[2] ?? 255);
    for (const rgb of result.rgb[2] ?? []) expect(rgb).toEqual([0, 0, 0]);
  });

  test("all three lights together, with a coloured sun", async ({ page, gpu }, testInfo) => {
    void gpu;
    const scenario: Scenario = {
      label: "three lights, metallic 0.5, roughness 0.35",
      metallic: 0.5,
      roughness: 0.35,
      base: [0.55, 0.65, 0.9],
      sun: { pitch: -0.9, yaw: -0.7, intensity: 1.5, color: [1, 0.8, 0.6] },
      lamp: { position: [1.5, 0.5, 2.2], intensity: 5 },
      free: { position: [-2, 1, 3], intensity: 6 },
    };
    const result = await render(page, [inputsOf(scenario)]);
    expect(result.reported).toEqual([]);
    const comparison = compare(scenario, result.rgb[0] ?? [], POINTS);
    expect(informative(comparison.expected)).toBeGreaterThanOrEqual(10);
    testInfo.annotations.push({ type: "m4-pbr-max-error", description: `${scenario.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"})` });
  });

  test("saturation: a very bright light clips and nothing is tone mapped", async ({ page, gpu }, testInfo) => {
    void gpu;
    const warm: Scenario = { label: "saturating sun, warm base", metallic: 0, roughness: 0.5, base: [0.9, 0.2, 0.05], sun: { ...SUN, intensity: 12, color: [1, 1, 1] } };
    const blinding: Scenario = { label: "blinding sun", metallic: 0, roughness: 0.5, base: [0.9, 0.2, 0.05], sun: { ...SUN, intensity: 5000, color: [1, 1, 1] } };
    const result = await render(page, [inputsOf(warm), inputsOf(blinding)]);
    expect(result.reported).toEqual([]);
    const comparison = compare(warm, result.rgb[0] ?? [], POINTS);
    const clipped = comparison.expectedLinear.map((linear, index) => ({ linear, index })).filter(({ linear }) => linear[0] > 1 && linear[1] < 0.95 && linear[2] < 0.95);
    // Pixels where red is above 1 and the others are not: red is clipped at 255, green and blue keep the values they
    // would have without red being there (no tone mapping, no rescale of the colour by its largest channel).
    expect(clipped.length, "pixels with a clipped channel and unclipped others").toBeGreaterThanOrEqual(2);
    for (const { index, linear } of clipped) {
      const pixel = result.rgb[0]?.[index] ?? [];
      expect(pixel[0], `pixel ${PIXELS[index]?.join(",") ?? "?"}: red ${linear[0].toFixed(3)} clips`).toBe(255);
      expect(Math.abs((pixel[1] ?? -1000) - (linearRgbToSrgb8(linear)[1] ?? 0))).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs((pixel[2] ?? -1000) - (linearRgbToSrgb8(linear)[2] ?? 0))).toBeLessThanOrEqual(TOLERANCE);
    }
    // 5000 lux saturates every channel that the light reaches with any cosine.
    const bright = compare(blinding, result.rgb[1] ?? [], POINTS);
    const reached = bright.expectedLinear.map((linear, index) => ({ linear, index })).filter(({ linear }) => Math.min(...linear) > 1);
    expect(reached.length).toBeGreaterThanOrEqual(3);
    for (const { index } of reached) expect(result.rgb[1]?.[index]).toEqual([255, 255, 255]);
    testInfo.annotations.push({
      type: "m4-pbr-max-error",
      description: `${warm.label}: max error ${String(comparison.maxError)}/255 (${comparison.worst || "exact"}); ${blinding.label}: max error ${String(bright.maxError)}/255; clipped pixels ${String(clipped.length)}, all-white pixels ${String(reached.length)}`,
    });
  });

  test("no resource is created after mount while the cases change every input", async ({ page, gpu }) => {
    void gpu;
    const base: Scenario = { label: "a", metallic: 0, roughness: 0.5, base: BASE, sun: SUN };
    const other: Scenario = { label: "b", metallic: 1, roughness: 0.2, base: [0.2, 0.3, 0.4], lamp: { position: [1, 1, 2], intensity: 3 }, free: { position: [-1, 2, 2], intensity: 2 } };
    const result = await render(page, [inputsOf(base), inputsOf(other), inputsOf(base)]);
    for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "texturesAllocated"]) {
      expect(new Set(result.counters.map((counters) => counters[name])).size, `${name} is constant`).toBe(1);
    }
    expect(result.counters[0]?.["pipelinesCreated"]).toBe(1);
    expect(result.rgb[2]).toEqual(result.rgb[0]);
  });
});
