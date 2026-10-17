// M4-04: texture and sampler params, end to end on the real adapter. The probe material of
// `fixtures/m4/texture_sampling` returns `sample(map, filter, at)` for a constant coordinate `at`, so each panel of the
// 64 x 64 offscreen `rgba8unorm-srgb` target shows one texel. The runtime replaces `texture.white()` by a generated
// 2 x 2 texture (`test.textures`), `at` is moved with `app.debug.setParam`, and every panel is compared with a CPU
// reference of the sampler (support/texture-reference.ts) that decodes sRGB by hand and shares no code with the
// runtime. Nearest filtering at exact texel centres returns exactly the texel; the other steps probe the edges
// between texels (nearest versus linear) and coordinates outside [0, 1] (clamp versus repeat).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { TEXTURE_SAMPLING, TEXTURE_SAMPLING_OUT, readTextureSamplingManifest, textureSamplingSource } from "../../support/m4-textures.ts";
import {
  GENERATED_TEXTURE_TEXELS,
  encodePixel,
  sampleReference,
  srgbByteToLinear,
  texelBytes,
  type Address,
  type Filter,
  type ReferenceTexture,
  type Rgb,
} from "../../support/texture-reference.ts";

/** The clear colour of the fixture, `#203040`, as bytes. */
const CLEAR: Rgb = [0x20, 0x30, 0x40];

interface Panel {
  readonly entity: string;
  readonly filter: Filter;
  readonly address: Address;
  /** The centre pixel of the panel in the 64 x 64 target (the view covers [-2, 2] x [-2, 2]). */
  readonly pixel: readonly [number, number];
}

const PANELS: readonly Panel[] = [
  { entity: "NearestClamp", filter: "nearest", address: "clamp", pixel: [16, 16] },
  { entity: "LinearClamp", filter: "linear", address: "clamp", pixel: [48, 16] },
  { entity: "NearestRepeat", filter: "nearest", address: "repeat", pixel: [16, 48] },
  { entity: "LinearRepeat", filter: "linear", address: "repeat", pixel: [48, 48] },
];
/** The small box in the middle keeps the built-in black texture. */
const DARK_PIXEL: readonly [number, number] = [32, 32];
const CORNER_PIXEL: readonly [number, number] = [1, 1];

interface Step {
  readonly label: string;
  readonly uv: readonly [number, number];
  /** Bytes of tolerance per channel for the linear panels (hardware filters with limited weight precision). */
  readonly linearTolerance: number;
}

const CENTRE_STEPS: readonly Step[] = [
  { label: "centre of the top left texel", uv: [0.25, 0.25], linearTolerance: 1 },
  { label: "centre of the top right texel", uv: [0.75, 0.25], linearTolerance: 1 },
  { label: "centre of the bottom left texel", uv: [0.25, 0.75], linearTolerance: 1 },
  { label: "centre of the bottom right texel", uv: [0.75, 0.75], linearTolerance: 1 },
];
const STEPS: readonly Step[] = [
  ...CENTRE_STEPS,
  { label: "just left of the edge between the top texels", uv: [0.49, 0.25], linearTolerance: 3 },
  { label: "just right of the edge between the top texels", uv: [0.51, 0.25], linearTolerance: 3 },
  { label: "on the edge between the top texels", uv: [0.5, 0.25], linearTolerance: 3 },
  { label: "beyond the right edge", uv: [1.25, 0.25], linearTolerance: 1 },
  { label: "beyond the left edge", uv: [-0.25, 0.75], linearTolerance: 1 },
];

interface SessionFrame {
  readonly label: string;
  /** RGB of the pixels, in the order `[...PANELS, DARK, CORNER]`. */
  readonly pixels: Array<[number, number, number]>;
  readonly counters: Record<string, number>;
}

interface Session {
  readonly frames: SessionFrame[];
  readonly reported: Array<{ code?: string }>;
  readonly state: string;
  readonly overlayPresent: boolean;
}

interface AppLike {
  state: string;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; format: string; data: Uint8Array }>;
    counters(): Record<string, number>;
    setParam(entityName: string, param: string, value: unknown): void;
  };
  dispose(): void;
}

interface SessionRequest {
  readonly texture: { readonly width: number; readonly height: number; readonly data: number[]; readonly colorSpace: "srgb" | "linear" } | null;
  readonly entities: readonly string[];
  readonly pixels: ReadonlyArray<readonly [number, number]>;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly uv: readonly [number, number] }>;
}

/**
 * Mounts the fixture with the generated texture (or none), renders a first frame and then one frame per step: `at` of
 * every panel entity is set to the step's coordinate, a frame is rendered, and the listed pixels and the counters are read.
 */
async function runSession(page: Page, request: SessionRequest): Promise<Session> {
  await page.goto(`/m4/${TEXTURE_SAMPLING}/index.html`);
  return page.evaluate(async ({ texture, entities, pixels: points, steps }): Promise<Session> => {
    const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike> };
    const reported: Array<{ code?: string }> = [];
    const test: Record<string, unknown> = { manualClock: true, renderTarget: { width: 64, height: 64 } };
    if (texture !== null) {
      test["textures"] = { "texture.white": { width: texture.width, height: texture.height, data: Uint8Array.from(texture.data), colorSpace: texture.colorSpace } };
    }
    let app: AppLike;
    try {
      app = await w.__mtekMount({ test, onDiagnostic: (d: { code?: string }) => reported.push(d) });
    } catch (error) {
      const failed = error as { kind?: string; diagnostics?: unknown };
      throw new Error(`mount rejected: ${String(failed.kind)} ${JSON.stringify(failed.diagnostics)}`, { cause: error });
    }
    const frames: SessionFrame[] = [];
    const capture = async (label: string): Promise<void> => {
      app.debug.step(1, 1 / 60);
      const target = await app.debug.readPixels();
      frames.push({
        label,
        pixels: points.map(([x, y]) => {
          const i = (y * target.width + x) * 4;
          return [target.data[i] ?? -1, target.data[i + 1] ?? -1, target.data[i + 2] ?? -1] as [number, number, number];
        }),
        counters: { ...app.debug.counters() },
      });
    };
    await capture("initial");
    for (const step of steps) {
      for (const entity of entities) app.debug.setParam(entity, "at", { x: step.uv[0], y: step.uv[1] });
      await capture(step.label);
    }
    const result = { frames, reported, state: app.state, overlayPresent: document.querySelector("[data-mtek-overlay]") !== null };
    app.dispose();
    return result;
  }, request);
}

const PIXELS: ReadonlyArray<readonly [number, number]> = [...PANELS.map((panel) => panel.pixel), DARK_PIXEL, CORNER_PIXEL];
const generated = (colorSpace: "srgb" | "linear"): ReferenceTexture => ({ width: 2, height: 2, texels: GENERATED_TEXTURE_TEXELS, colorSpace });

function expectPixel(actual: readonly number[] | undefined, expected: readonly number[], tolerance: number, what: string): void {
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs((actual?.[channel] ?? -1000) - (expected[channel] ?? 0)), `${what}: channel ${String(channel)} is ${String(actual?.[channel])}, expected ${String(expected[channel])} (+-${String(tolerance)})`).toBeLessThanOrEqual(tolerance);
  }
}

test("the fixture's group 1 has the texture at binding 1 and the sampler at binding 2, and every instance names its built-ins", () => {
  const source = textureSamplingSource();
  expect(source).toContain("param map: texture = texture.white();");
  const manifest = readTextureSamplingManifest() as {
    materials: Array<{ id: string; layout: string | null; shader: string; resources: unknown[]; params: Array<{ name: string; type: string }> }>;
    shaders: Array<{ hash: string; url: string }>;
    scene: { materialInstances: Array<{ entity: number; params: Array<{ name: string; class: string; value?: { kind: string; name: string } }> }>; entities: Array<{ name: string }> };
  };
  const material = manifest.materials[0];
  expect(manifest.materials).toHaveLength(1);
  expect(material?.resources).toEqual([
    { name: "map", kind: "texture", binding: 1 },
    { name: "filter", kind: "sampler", binding: 2 },
  ]);
  expect(material?.params.map((param) => [param.name, param.type])).toEqual([
    ["map", "texture"],
    ["filter", "sampler"],
    ["at", "vec2"],
  ]);
  const byEntity = new Map(manifest.scene.materialInstances.map((instance) => [manifest.scene.entities[instance.entity]?.name, instance]));
  const resources = (name: string): Array<string | undefined> => (byEntity.get(name)?.params ?? []).filter((p) => p.class === "resource").map((p) => p.value?.name);
  expect(resources("NearestClamp")).toEqual(["texture.white", "sampler.nearest_clamp"]);
  expect(resources("LinearClamp")).toEqual(["texture.white", "sampler.linear_clamp"]);
  expect(resources("NearestRepeat")).toEqual(["texture.white", "sampler.nearest_repeat"]);
  expect(resources("LinearRepeat")).toEqual(["texture.white", "sampler.linear_repeat"]);
  expect(resources("Dark")).toEqual(["texture.black", "sampler.nearest_clamp"]);
  // `at` is a value param (class initial), not a resource.
  expect(byEntity.get("Dark")?.params.find((p) => p.name === "at")?.class).toBe("initial");

  const wgsl = readFileSync(join(TEXTURE_SAMPLING_OUT, ...(manifest.shaders[0]?.url ?? "").split("/")), "utf8");
  expect(wgsl).toContain("@group(1) @binding(0) var<uniform> mtek_params");
  expect(wgsl).toContain("@group(1) @binding(1) var mtek_texture_map: texture_2d<f32>;");
  expect(wgsl).toContain("@group(1) @binding(2) var mtek_sampler_filter: sampler;");
  expect(wgsl).toContain("textureSampleLevel(mtek_texture_map, mtek_sampler_filter, mtek_params.u_at, 0.0)");
});

test("a generated 2x2 sRGB texture is sampled at exact texel centres and across edges as the reference says", async ({ page, gpu }, testInfo) => {
  void gpu;
  const entities = PANELS.map((panel) => panel.entity);
  const session = await runSession(page, {
    texture: { width: 2, height: 2, data: [...texelBytes(GENERATED_TEXTURE_TEXELS)], colorSpace: "srgb" },
    entities,
    pixels: PIXELS,
    steps: STEPS,
  });
  expect(session.state).toBe("running");
  expect(session.overlayPresent).toBe(false);
  expect(session.reported).toEqual([]);
  expect(session.frames.map((frame) => frame.label)).toEqual(["initial", ...STEPS.map((step) => step.label)]);

  const texture = generated("srgb");
  const lines: string[] = [];
  const check = (frame: SessionFrame, uv: readonly [number, number], linearTolerance: number): void => {
    for (const [index, panel] of PANELS.entries()) {
      const expectedLinear = sampleReference(texture, panel.filter, panel.address, uv[0], uv[1]);
      const expected = encodePixel(expectedLinear);
      const tolerance = panel.filter === "linear" ? linearTolerance : 1;
      const actual = frame.pixels[index];
      lines.push(`${frame.label} ${panel.entity}: expected ${expected.join(",")} (linear ${expectedLinear.map((v) => v.toFixed(5)).join(",")}) actual ${actual?.join(",") ?? "?"}`);
      expectPixel(actual, expected, tolerance, `${frame.label}, ${panel.entity}`);
      // The decoded pixel is the expected linear value up to the 8-bit quantisation of the target (half a code step
      // either side) plus the filter tolerance: the sampler delivered linear values, not encoded ones.
      const decoded = (actual ?? [0, 0, 0]).map((byte) => srgbByteToLinear(byte));
      for (let channel = 0; channel < 3; channel += 1) {
        const step = srgbByteToLinear(Math.min(255, (expected[channel] ?? 0) + tolerance + 1)) - srgbByteToLinear(Math.max(0, (expected[channel] ?? 0) - tolerance - 1));
        expect(Math.abs((decoded[channel] ?? 9) - (expectedLinear[channel] ?? 0)), `${frame.label}, ${panel.entity}: linear value of channel ${String(channel)}`).toBeLessThanOrEqual(step);
      }
    }
    // The black built-in stays black, and the clear colour shows outside the panels.
    expectPixel(frame.pixels[PANELS.length], [0, 0, 0], 0, `${frame.label}, Dark`);
    expectPixel(frame.pixels[PANELS.length + 1], CLEAR, 1, `${frame.label}, clear colour`);
  };
  // The first frame renders the declared `at` = (0.25, 0.25): the top left texel for every panel.
  check(session.frames[0] as SessionFrame, [0.25, 0.25], 1);
  STEPS.forEach((step, index) => {
    check(session.frames[index + 1] as SessionFrame, step.uv, step.linearTolerance);
  });
  testInfo.annotations.push({ type: "m4-texture-pixels", description: lines.join("; ") });

  // The exact texel centres give exactly the encoded texel bytes (decode then encode is the identity), on
  // every panel: nearest and linear, clamp and repeat.
  CENTRE_STEPS.forEach((step, index) => {
    const frame = session.frames[index + 1] as SessionFrame;
    const texel = GENERATED_TEXTURE_TEXELS[index] as readonly number[];
    for (const [panelIndex, panel] of PANELS.entries()) {
      expectPixel(frame.pixels[panelIndex], texel, 1, `${step.label}, ${panel.entity} is the texel bytes`);
    }
  });

  // The pictures differ where the presets differ: across the edge nearest keeps one texel and linear blends; beyond the
  // edge clamp holds the last texel and repeat wraps.
  const at = (label: string): SessionFrame => session.frames.find((frame) => frame.label === label) as SessionFrame;
  const nearEdge = at("just left of the edge between the top texels");
  expectPixel(nearEdge.pixels[0], [188, 64, 32], 1, "nearest keeps the top left texel");
  expect(Math.abs((nearEdge.pixels[1]?.[0] ?? 0) - 188), "linear has left the top left texel").toBeGreaterThan(8);
  const beyond = at("beyond the right edge");
  expectPixel(beyond.pixels[0], [255, 128, 0], 1, "clamp holds the right texel");
  expectPixel(beyond.pixels[2], [188, 64, 32], 1, "repeat wraps to the left texel");

  // Resources are created once at mount: no frame creates a texture, a sampler, a bind group, a pipeline or a shader module.
  for (const name of ["texturesAllocated", "liveTextures", "liveSamplers", "bindGroupsCreated", "liveBindGroups", "pipelinesCreated", "shaderModulesCreated"]) {
    const values = new Set(session.frames.map((frame) => frame.counters[name]));
    expect([...values], `${name} is constant across ${String(session.frames.length)} frames`).toHaveLength(1);
  }
  const first = session.frames[0]?.counters ?? {};
  // One sampler per preset in use (nearest/linear x clamp/repeat; Dark's nearest_clamp is shared), one pipeline for the one material.
  expect(first["liveSamplers"]).toBe(4);
  expect(first["pipelinesCreated"]).toBe(1);
  expect(first["shaderModulesCreated"]).toBe(1);
});

test("a linear-colour-space texture is sampled as stored, not decoded", async ({ page, gpu }) => {
  void gpu;
  const session = await runSession(page, {
    texture: { width: 2, height: 2, data: [...texelBytes(GENERATED_TEXTURE_TEXELS)], colorSpace: "linear" },
    entities: PANELS.map((panel) => panel.entity),
    pixels: PIXELS,
    steps: CENTRE_STEPS,
  });
  expect(session.reported).toEqual([]);
  const texture = generated("linear");
  CENTRE_STEPS.forEach((step, index) => {
    const frame = session.frames[index + 1] as SessionFrame;
    const texel = GENERATED_TEXTURE_TEXELS[index] as readonly number[];
    // The channel byte b is the linear value b / 255, which the target shows as the sRGB encoding of that value.
    const expected = encodePixel(sampleReference(texture, "nearest", "clamp", step.uv[0], step.uv[1]));
    for (const [panelIndex, panel] of PANELS.entries()) {
      expectPixel(frame.pixels[panelIndex], expected, panel.filter === "linear" ? 2 : 1, `${step.label}, ${panel.entity}`);
    }
    // And it is visibly not the encoded texel (the first channel of every texel but 255 changes a lot).
    const channel = texel[0] ?? 0;
    if (channel > 0 && channel < 255) expect(Math.abs((frame.pixels[0]?.[0] ?? channel) - channel), `${step.label}: not decoded`).toBeGreaterThan(8);
  });
});

test("without a test texture the built-in textures are 1x1 opaque white and black", async ({ page, gpu }) => {
  void gpu;
  const session = await runSession(page, { texture: null, entities: PANELS.map((panel) => panel.entity), pixels: PIXELS, steps: [{ label: "centre", uv: [0.75, 0.75] }] });
  expect(session.reported).toEqual([]);
  for (const frame of session.frames) {
    for (const [index, panel] of PANELS.entries()) expectPixel(frame.pixels[index], [255, 255, 255], 0, `${frame.label}, ${panel.entity} is white`);
    expectPixel(frame.pixels[PANELS.length], [0, 0, 0], 0, `${frame.label}, Dark is black`);
    expectPixel(frame.pixels[PANELS.length + 1], CLEAR, 1, `${frame.label}, clear colour`);
  }
});
