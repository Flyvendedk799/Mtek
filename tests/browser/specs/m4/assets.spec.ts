// M4-06 (decision 0060): assets on the real adapter. `fixtures/m4/assets_scene` is a GLB (three meshes, one with two primitives,
// five materials, a PNG and a JPEG) and two standalone textures (one sRGB, one linear) drawn in a 3 x 3 grid by an orthographic
// camera into a 96 x 96 `rgba8unorm-srgb` target. The files are generated from explicit data (tests/assets/tools/make-glb.mjs),
// so every expected pixel is derived by hand from that data (support/asset-scene.ts), never from what the renderer draws:
//   - texel and factor colours are the bytes in the files (the sRGB textures round-trip, the linear mask shows the sRGB encoding
//     of byte / 255: 128 -> 188, 64 -> 137), and the base colour factors of "Oak" and "Slate" are worked out with the sRGB
//     transfer function;
//   - the figures are located from the vertex positions (16 pixels per unit): a triangle's corner is outside it, a square's is in;
//   - the Pbr panel "Lacquer" is shaded by the oracle `shadePbr` (reference-shading.ts) for its normal (+Z), the view vector of
//     each pixel, one sun and the ambient term, within the 3 / 255 tolerance of the PBR spec.
// Failures use the same fixture with the server's answers changed by the browser (a 404, an aborted request, an altered or a
// truncated body) and `fixtures/m4/assets_corrupt`, whose PNG has a valid header and undecodable pixels. Each must reject the
// mount with `asset-failed`, and the overlay must name the file and the declaration.
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import {
  CHECKER_TEXELS,
  CLEAR,
  CORNER_INSIDE,
  CORNER_OUTSIDE,
  GREY_LEVEL,
  LACQUER_OFFSETS,
  MASK_PIXELS,
  OAK_PIXEL,
  QUADRANTS,
  ROOF_INSIDE,
  ROOF_OUTSIDE,
  SLATE_PIXEL,
  SQUARE_INSIDE,
  TARGET_SIZE,
  WOOD_TEXELS,
  cellCentre,
  lacquerPixel,
  type Rgb,
} from "../../support/asset-scene.ts";
import { ASSET_CORRUPT, ASSET_SCENE, assetOfFile, builtAssetPath, builtManifest, locationOf, meshDataAsset } from "../../support/m4-assets.ts";
import { readFileSync } from "node:fs";

const DT = 1 / 60;
/** Tolerance in bytes per channel for pixels that go through texture sampling or the sRGB encoding on the GPU. */
const TOLERANCE = 1;
/** The Pbr panel: the PBR spec's tolerance against the f64 oracle. */
const PBR_TOLERANCE = 3;

interface Diag {
  code: string;
  severity: string;
  phase: string;
  message: string;
  notes: string[];
  expected?: string;
  actual?: string;
  source: { file: string; startLine: number; startColumn: number } | null;
}

interface AssetEvent {
  url: string;
  kind: string;
  state: string;
  t: number;
}

interface MountOutcome {
  ok: boolean;
  kind?: string;
  diagnostics: Diag[];
  reported: Diag[];
  events: AssetEvent[];
  /** `performance.now()` when the mount promise settled, and how many events had happened by then. */
  settledAt: number;
  startedAt: number;
  eventsAtSettle: number;
  overlay: { text: string; role: string | null; codes: string[] } | null;
}

interface Frame {
  width: number;
  height: number;
  data: number[];
}

interface AppLike {
  state: string;
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
    loseDevice(): void;
    assets(): Array<{ url: string; kind: string; state: string; bytes: number }>;
  };
}

interface Harness {
  app: AppLike | undefined;
  mount(options: Record<string, unknown>): Promise<MountOutcome>;
}

/** Runs in the page: `window.__h`, a mount that records diagnostics and asset states and describes a rejection. */
function installHarness(): void {
  const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike>; __h: Harness };
  const harness: Harness = {
    app: undefined,
    async mount(options) {
      const reported: Diag[] = [];
      const events: AssetEvent[] = [];
      const startedAt = performance.now();
      const test = {
        ...(options["test"] as Record<string, unknown>),
        onAssetState: (event: { url: string; kind: string; state: string }) => events.push({ ...event, t: performance.now() }),
      };
      let outcome: Pick<MountOutcome, "ok" | "kind" | "diagnostics">;
      try {
        harness.app = await w.__mtekMount({ ...options, test, onDiagnostic: (d: Diag) => reported.push(d) });
        outcome = { ok: true, diagnostics: [] };
      } catch (error) {
        const failed = error as { kind?: string; diagnostics?: Diag[] };
        harness.app = undefined;
        outcome = { ok: false, ...(failed.kind === undefined ? {} : { kind: failed.kind }), diagnostics: failed.diagnostics ?? [] };
      }
      const element = document.querySelector("[data-mtek-overlay]");
      return {
        ...outcome,
        reported,
        events,
        startedAt,
        settledAt: performance.now(),
        eventsAtSettle: events.length,
        overlay:
          element === null
            ? null
            : {
                text: element.textContent ?? "",
                role: element.getAttribute("role"),
                codes: [...element.querySelectorAll("[data-mtek-diagnostic]")].map((e) => e.getAttribute("data-mtek-diagnostic") ?? ""),
              },
      };
    },
  };
  w.__h = harness;
}

async function open(page: Page, fixture: string): Promise<void> {
  await page.goto(`/m4/${fixture}/index.html`);
  await page.evaluate(installHarness);
}

function mount(page: Page, test: Record<string, unknown> = { manualClock: true, renderTarget: { width: TARGET_SIZE, height: TARGET_SIZE } }): Promise<MountOutcome> {
  return page.evaluate((options) => (window as unknown as { __h: Harness }).__h.mount(options), { test });
}

async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate(({ n, dt }) => (window as unknown as { __h: Harness }).__h.app?.debug.step(n, dt), { n: frames, dt: DT });
}

async function capture(page: Page): Promise<Frame> {
  return page.evaluate(async () => {
    const app = (window as unknown as { __h: Harness }).__h.app;
    if (app === undefined) throw new Error("no app");
    const frame = await app.debug.readPixels();
    return { width: frame.width, height: frame.height, data: Array.from(frame.data) };
  });
}

async function counters(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as { __h: Harness }).__h.app?.debug.counters() ?? {});
}

async function dispose(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __h: Harness }).__h;
    h.app?.dispose();
    h.app = undefined;
  });
}

function pixel(frame: Frame, x: number, y: number): Rgb {
  const i = (y * frame.width + x) * 4;
  return [frame.data[i] ?? -1, frame.data[i + 1] ?? -1, frame.data[i + 2] ?? -1];
}

function expectPixel(frame: Frame, x: number, y: number, expected: Rgb, tolerance: number, what: string): void {
  const actual = pixel(frame, x, y);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(actual[channel]! - expected[channel]!), `${what} at pixel (${String(x)}, ${String(y)}): GPU ${actual.join(",")}, expected ${expected.join(",")} (+-${String(tolerance)})`).toBeLessThanOrEqual(tolerance);
  }
}

/** Checks the samples `offsets` of cell `(i, j)` against `expected(k)`. */
function expectCell(frame: Frame, cell: readonly [number, number], offsets: ReadonlyArray<readonly [number, number]>, expected: (index: number) => Rgb, tolerance: number, what: string): void {
  const [cx, cy] = cellCentre(cell[0], cell[1]);
  offsets.forEach(([dx, dy], index) => {
    expectPixel(frame, cx + dx, cy + dy, expected(index), tolerance, `${what} sample ${String(index)}`);
  });
}

const SCENE_ORIGIN = `/m4/${ASSET_SCENE}/`;

test.describe("assets on the real adapter", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await open(page, ASSET_SCENE);
  });

  test("a supported GLB, its images and two standalone textures render with the colours derived by hand", async ({ page }) => {
    const outcome = await mount(page);
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.reported).toEqual([]);
    await step(page, 2);
    const frame = await capture(page);
    expect([frame.width, frame.height]).toEqual([TARGET_SIZE, TARGET_SIZE]);

    // (0, 0) Checker: the GLB's PNG with the GLB's nearest / clamp sampler; every quadrant shows its texel.
    expectCell(frame, [0, 0], QUADRANTS, (k) => CHECKER_TEXELS[k]!, TOLERANCE, "Checker");
    // (2, 1) Wood and (2, 2) Wood2: standalone sRGB texture: the stored bytes come back.
    expectCell(frame, [2, 1], QUADRANTS, (k) => WOOD_TEXELS[k]!, TOLERANCE, "Wood");
    expectCell(frame, [2, 2], QUADRANTS, (k) => WOOD_TEXELS[k]!, TOLERANCE, "Wood2");
    // (0, 2) Mask: standalone linear texture: 128 -> 188, 64 -> 137.
    expectCell(frame, [0, 2], QUADRANTS, (k) => MASK_PIXELS[k]!, TOLERANCE, "Mask");
    // (1, 2) Grey: the GLB's JPEG, one flat grey, everywhere on the panel.
    expectCell(frame, [1, 2], [[0, 0], ...QUADRANTS], () => [GREY_LEVEL, GREY_LEVEL, GREY_LEVEL], 2, "Grey");

    // (1, 0) Corner: a non-indexed triangle in the colour of Oak; the other half of its square is the clear colour.
    expectCell(frame, [1, 0], [CORNER_INSIDE], () => OAK_PIXEL, TOLERANCE, "Corner inside");
    expectCell(frame, [1, 0], [CORNER_OUTSIDE], () => CLEAR, TOLERANCE, "Corner outside");
    // (0, 1) Square is primitive 0 of "Pair" (Slate), (1, 1) Roof primitive 1 (Oak): a mix-up of the two primitives or of
    // their offsets would draw the wrong figure.
    expectCell(frame, [0, 1], SQUARE_INSIDE, () => SLATE_PIXEL, TOLERANCE, "Square");
    expectCell(frame, [1, 1], ROOF_INSIDE, () => OAK_PIXEL, TOLERANCE, "Roof inside");
    expectCell(frame, [1, 1], ROOF_OUTSIDE, () => CLEAR, TOLERANCE, "Roof outside");
    // The gaps between the cells are the clear colour.
    for (const [x, y] of [[0, 0], [95, 95], [32, 16], [64, 48]] as const) expectPixel(frame, x, y, CLEAR, TOLERANCE, "background");

    // (2, 0) Lacquer: Pbr from the GLB's material, a sun and ambient light, against the oracle.
    const [lx, ly] = cellCentre(2, 0);
    LACQUER_OFFSETS.forEach(([dx, dy], k) => {
      expectPixel(frame, lx + dx, ly + dy, lacquerPixel(lx + dx, ly + dy), PBR_TOLERANCE, `Lacquer sample ${String(k)}`);
    });
    // The lighting is not flat: a constant colour would mean the light was ignored.
    const lit = LACQUER_OFFSETS.map(([dx, dy]) => pixel(frame, lx + dx, ly + dy)[0]);
    expect(Math.max(...lit) - Math.min(...lit)).toBeGreaterThanOrEqual(2);

    // Nine entities, eight draw calls: Wood and Wood2 share mesh, pipeline and parameter block (one instanced draw).
    const c = await counters(page);
    expect(c["drawCalls"]).toBe(8);
    expect(c["instancedDraws"]).toBe(1);
    expect(c["culledObjects"]).toBe(0);
    // Wood/Wood2 and Corner/Roof (same Oak colour) each share a block.
    expect(c["sharedParamBlocks"]).toBe(2);
    await dispose(page);
  });

  test("mount resolves only when every asset is ready, and the states are observable: pending, then ready", async ({ page }) => {
    // The server is slow for one image: the mount waits for it.
    const wood = assetOfFile(ASSET_SCENE, "textures/wood.png");
    await page.route(`**${SCENE_ORIGIN}${wood.url}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    const outcome = await mount(page);
    expect(outcome.ok).toBe(true);
    const manifest = builtManifest(ASSET_SCENE);
    expect(manifest.assets.map((a) => a.kind)).toEqual(["mesh-data", "image", "image", "image", "image"]);
    // Every file was pending before anything was ready, and each ended ready; nothing failed.
    const states = outcome.events.map((e) => e.state);
    expect(states.slice(0, 5)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
    expect(states.slice(5).sort()).toEqual(["ready", "ready", "ready", "ready", "ready"]);
    expect(new Set(outcome.events.map((e) => e.url))).toEqual(new Set(manifest.assets.map((a) => a.url)));
    // The mount settled after the slowest asset became ready, which took the server's delay.
    const woodEvents = outcome.events.filter((e) => e.url === wood.url);
    expect(woodEvents.map((e) => e.state)).toEqual(["pending", "ready"]);
    expect(woodEvents[1]!.t - woodEvents[0]!.t).toBeGreaterThanOrEqual(350);
    expect(outcome.eventsAtSettle).toBe(10);
    expect(outcome.settledAt).toBeGreaterThanOrEqual(Math.max(...outcome.events.map((e) => e.t)));
    expect(outcome.settledAt - outcome.startedAt).toBeGreaterThanOrEqual(350);
    const listed = await page.evaluate(() => (window as unknown as { __h: Harness }).__h.app?.debug.assets());
    expect(listed?.map((a) => `${a.kind} ${a.state}`)).toEqual(manifest.assets.map((a) => `${a.kind} ready`));
    expect(listed?.map((a) => a.bytes)).toEqual(manifest.assets.map((a) => a.bytes));
    await dispose(page);
  });

  test("an instanced draw of an asset mesh renders exactly what one draw call per entity renders", async ({ page }) => {
    await mount(page);
    await step(page, 2);
    const instanced = await capture(page);
    await dispose(page);
    const outcome = await mount(page, { manualClock: true, renderTarget: { width: TARGET_SIZE, height: TARGET_SIZE }, disableInstancing: true });
    expect(outcome.ok).toBe(true);
    await step(page, 2);
    const plain = await capture(page);
    const c = await counters(page);
    expect(c["drawCalls"]).toBe(9);
    expect(c["instancedDraws"]).toBe(0);
    expect(plain.data).toEqual(instanced.data);
    // Both really drew something: the two Wood panels differ from the background.
    expectCell(plain, [2, 2], QUADRANTS, (k) => WOOD_TEXELS[k]!, TOLERANCE, "Wood2 without instancing");
    await dispose(page);
  });

  test("culling with the manifest's bounding spheres removes nothing that is in view", async ({ page }) => {
    // The camera is fixed by the program, so the whole grid is in view: culling must give the frame of `disableCulling`.
    // (Where the sphere is centred is covered by the unit tests of the renderer and the frustum.)
    await mount(page);
    await step(page, 2);
    const culled = await capture(page);
    expect((await counters(page))["culledObjects"]).toBe(0);
    await dispose(page);
    await mount(page, { manualClock: true, renderTarget: { width: TARGET_SIZE, height: TARGET_SIZE }, disableCulling: true });
    await step(page, 2);
    expect((await capture(page)).data).toEqual(culled.data);
    await dispose(page);
  });

  test("buffers and textures are created once at mount and released on dispose, over repeated mounts", async ({ page }) => {
    await mount(page);
    await step(page, 2);
    const first = await counters(page);
    await step(page, 5);
    const later = await counters(page);
    // A frame creates nothing: no buffer, texture, bind group or pipeline after the first frames.
    for (const name of ["buffersAllocated", "texturesAllocated", "bindGroupsCreated", "pipelinesCreated", "shaderModulesCreated"]) {
      expect(later[name], name).toBe(first[name]);
    }
    // Four image textures, three buffers for the mesh file's attributes ... all live.
    expect(first["liveTextures"]).toBeGreaterThanOrEqual(4);
    await dispose(page);
    for (let round = 0; round < 5; round += 1) {
      const outcome = await mount(page);
      expect(outcome.ok).toBe(true);
      await step(page, 1);
      await dispose(page);
    }
    // After a dispose the registry holds nothing: the last app's counters.
    const final = await page.evaluate(async () => {
      const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike>; __h: Harness };
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: { width: 96, height: 96 } } });
      app.debug.step(1, 1 / 60);
      app.dispose();
      return app.debug.counters();
    });
    expect(final["liveBuffers"]).toBe(0);
    expect(final["liveTextures"]).toBe(0);
    expect(final["liveSamplers"]).toBe(0);
    expect(final["liveBindGroups"]).toBe(0);
  });

  test("the device recovers with its assets: no asset is requested again and the frame is identical", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`${SCENE_ORIGIN}assets/`)) requests.push(request.url());
    });
    await mount(page, { manualClock: true, renderTarget: { width: TARGET_SIZE, height: TARGET_SIZE }, recovery: { delaysMs: [20, 20, 20] } });
    await step(page, 2);
    const before = await capture(page);
    const countersBefore = await counters(page);
    expect(requests).toHaveLength(5);
    requests.length = 0;

    await page.evaluate(async () => {
      const app = (window as unknown as { __h: Harness }).__h.app;
      if (app === undefined) throw new Error("no app");
      app.debug.loseDevice();
      while (app.state !== "recovering") await new Promise((resolve) => setTimeout(resolve, 1));
      while (app.state === "recovering") await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const state = await page.evaluate(() => (window as unknown as { __h: Harness }).__h.app?.state);
    expect(state).toBe("running");
    await step(page, 2);
    const after = await capture(page);
    const countersAfter = await counters(page);

    // Nothing was fetched for the rebuild: the verified bytes were retained.
    expect(requests).toEqual([]);
    // The new device holds what the lost one held: the same pixels, the same live objects, doubled totals.
    expect(after.data).toEqual(before.data);
    for (const name of ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups"]) {
      expect(countersAfter[name], name).toBe(countersBefore[name]);
    }
    expect(countersAfter["deviceRecoveries"]).toBe(1);
    expect(countersAfter["texturesAllocated"]).toBeGreaterThan(countersBefore["texturesAllocated"]!);
    // The recovered frame is the specified one, not merely the same as before: spot-check a textured and a Pbr pixel.
    expectCell(after, [2, 1], QUADRANTS, (k) => WOOD_TEXELS[k]!, TOLERANCE, "Wood after recovery");
    const [lx, ly] = cellCentre(2, 0);
    expectPixel(after, lx, ly, lacquerPixel(lx, ly), PBR_TOLERANCE, "Lacquer after recovery");
    const states = await page.evaluate(() => (window as unknown as { __h: Harness }).__h.app?.debug.assets().map((a) => a.state));
    expect(states).toEqual(["ready", "ready", "ready", "ready", "ready"]);
    const codes = await page.evaluate(() => (window as unknown as { __h: Harness }).__h.app?.state);
    expect(codes).toBe("running");
    await dispose(page);
  });
});

test.describe("a failed asset rejects the mount with asset-failed and says which file and which declaration", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await open(page, ASSET_SCENE);
  });

  const glbLiteral = '"../models/scene.glb"';
  const woodLiteral = '"../textures/wood.png"';

  /** Expectations every failed mount shares: the kind, the overlay in the DOM with the code, and a page that is still usable. */
  async function expectFailure(page: Page, outcome: MountOutcome, code: string, file: string, declaration: string, mention: string[]): Promise<Diag> {
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("asset-failed");
    expect(outcome.diagnostics.map((d) => d.code)).toEqual([`MTEK-${code}`]);
    const diagnostic = outcome.diagnostics[0]!;
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.phase).toBe("runtime:mount");
    // The message names the packaged file; the source location is the declaration in the Mtek source.
    expect(diagnostic.message).toContain(file);
    for (const text of mention) expect(diagnostic.message).toContain(text);
    expect(`${diagnostic.source?.file ?? "?"}:${String(diagnostic.source?.startLine)}:${String(diagnostic.source?.startColumn)}`).toBe(declaration);
    expect(outcome.reported.map((d) => d.code)).toEqual([`MTEK-${code}`]);
    // The overlay is on the page, accessible, with the code, the file and the declaration.
    expect(outcome.overlay?.role).toBe("alert");
    expect(outcome.overlay?.codes).toEqual([`MTEK-${code}`]);
    expect(outcome.overlay?.text).toContain(`MTEK-${code}`);
    expect(outcome.overlay?.text).toContain(file);
    expect(outcome.overlay?.text).toContain(declaration);
    for (const text of mention) expect(outcome.overlay?.text).toContain(text);
    // Nothing was left running: the page can mount the program again once the file is served properly.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const again = await mount(page);
    expect(again.ok, JSON.stringify(again.diagnostics)).toBe(true);
    expect(again.overlay).toBeNull();
    await dispose(page);
    return diagnostic;
  }

  test("a missing mesh file (HTTP 404)", async ({ page }) => {
    const mesh = meshDataAsset(ASSET_SCENE);
    await page.route(`**${SCENE_ORIGIN}${mesh.url}`, (route) => route.fulfill({ status: 404, body: "not found" }));
    const outcome = await mount(page);
    await expectFailure(page, outcome, "E7030", mesh.url, locationOf(ASSET_SCENE, glbLiteral), ["models/scene.glb", "HTTP 404"]);
  });

  test("a missing image (HTTP 404) is reported at its own declaration", async ({ page }) => {
    const wood = assetOfFile(ASSET_SCENE, "textures/wood.png");
    await page.route(`**${SCENE_ORIGIN}${wood.url}`, (route) => route.fulfill({ status: 404, body: "not found" }));
    const outcome = await mount(page);
    await expectFailure(page, outcome, "E7030", wood.url, locationOf(ASSET_SCENE, woodLiteral), ["HTTP 404"]);
  });

  test("a request that fails (the connection is dropped)", async ({ page }) => {
    const mesh = meshDataAsset(ASSET_SCENE);
    await page.route(`**${SCENE_ORIGIN}${mesh.url}`, (route) => route.abort("connectionreset"));
    const outcome = await mount(page);
    await expectFailure(page, outcome, "E7030", mesh.url, locationOf(ASSET_SCENE, glbLiteral), ["models/scene.glb"]);
  });

  test("a body of the wrong length is E7030 with both lengths", async ({ page }) => {
    const mesh = meshDataAsset(ASSET_SCENE);
    const bytes = readFileSync(builtAssetPath(ASSET_SCENE, mesh));
    await page.route(`**${SCENE_ORIGIN}${mesh.url}`, (route) => route.fulfill({ status: 200, body: bytes.subarray(0, bytes.length - 4) }));
    const outcome = await mount(page);
    const diagnostic = await expectFailure(page, outcome, "E7030", mesh.url, locationOf(ASSET_SCENE, glbLiteral), [`has ${String(mesh.bytes - 4)} bytes`]);
    expect(diagnostic.expected).toBe(`${String(mesh.bytes)} bytes`);
    expect(diagnostic.actual).toBe(`${String(mesh.bytes - 4)} bytes`);
  });

  test("an altered image of the right length fails the SHA-256 check with the expected and the actual digest", async ({ page }) => {
    const wood = assetOfFile(ASSET_SCENE, "textures/wood.png");
    const altered = Buffer.from(readFileSync(builtAssetPath(ASSET_SCENE, wood)));
    // Flip one bit in the pixel data (the image still decodes to something; only the digest can tell).
    altered[altered.length - 20] = altered[altered.length - 20]! ^ 1;
    await page.route(`**${SCENE_ORIGIN}${wood.url}`, (route) => route.fulfill({ status: 200, body: altered }));
    const outcome = await mount(page);
    const diagnostic = await expectFailure(page, outcome, "E7030", wood.url, locationOf(ASSET_SCENE, woodLiteral), ["does not match the SHA-256"]);
    expect(diagnostic.expected).toBe(wood.sha256);
    expect(diagnostic.actual).toBe(createHash("sha256").update(altered).digest("hex"));
    expect(diagnostic.actual).not.toBe(diagnostic.expected);
  });

  test("an image that cannot be decoded is E7031 at its declaration", async ({ page }) => {
    await open(page, ASSET_CORRUPT);
    const broken = assetOfFile(ASSET_CORRUPT, "textures/broken.png");
    const outcome = await mount(page);
    // E7031: the file arrived intact (length and digest are right) and the browser rejected it.
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("asset-failed");
    expect(outcome.diagnostics.map((d) => d.code)).toEqual(["MTEK-E7031"]);
    const diagnostic = outcome.diagnostics[0]!;
    expect(diagnostic.message).toContain(broken.url);
    expect(diagnostic.message).toContain("could not decode");
    const declaration = locationOf(ASSET_CORRUPT, '"../textures/broken.png"');
    expect(`${diagnostic.source?.file ?? "?"}:${String(diagnostic.source?.startLine)}:${String(diagnostic.source?.startColumn)}`).toBe(declaration);
    expect(outcome.events.map((e) => e.state)).toEqual(["pending", "failed"]);
    expect(outcome.overlay?.role).toBe("alert");
    expect(outcome.overlay?.codes).toEqual(["MTEK-E7031"]);
    expect(outcome.overlay?.text).toContain(broken.url);
    expect(outcome.overlay?.text).toContain(declaration);
  });
});
