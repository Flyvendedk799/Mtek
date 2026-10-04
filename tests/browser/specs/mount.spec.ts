// M1-14: mountMtek in a real browser. The unit tests prove the logic against fakes; these specs prove
// the parts a fake can only model: the real canvas configuration with the sRGB view format, depth and
// offscreen textures, copyTextureToBuffer with padded rows, real shader compilation info and the overlay
// in a real DOM. Failure fixtures follow spec/testing.md section 6.7.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { BROWSER_ROOT } from "../support/environment.ts";
import { expect, test } from "../support/fixtures.ts";

interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
  phase: string;
  source: { file: string; startByte: number; endByte: number; startLine: number; startColumn: number } | null;
}

interface DebugLike {
  step(frames: number, dtSeconds: number): void;
  readPixels(): Promise<{ width: number; height: number; format: string; data: Uint8Array }>;
  counters(): Record<string, number>;
}

interface AppLike {
  state: string;
  debug: DebugLike;
  dispose(): void;
}

/** What `pages/mount.html` and `mountFixture` leave on `window`. */
interface MountWindow {
  __mtek: {
    mountMtek(canvas: HTMLCanvasElement, program: unknown, options: unknown): Promise<AppLike>;
    MtekMountError: new (...args: never[]) => Error & { kind: string; diagnostics: DiagnosticLike[] };
    /** The golden program with its box hidden: the M1-14 specs see the clear colour only. */
    program: unknown;
    /** The same program drawing its box (M1-18). */
    drawingProgram: unknown;
  };
  __app?: AppLike;
  __canvas?: HTMLCanvasElement;
  __reported?: DiagnosticLike[];
}

interface MountOutcome {
  /** True when the mount resolved. */
  ok: boolean;
  state: string | null;
  /** Set when it rejected with an MtekMountError. */
  kind: string | null;
  errorDiagnostics: DiagnosticLike[];
  /** Everything delivered through onDiagnostic. */
  reported: DiagnosticLike[];
  overlayRole: string | null;
  overlayText: string | null;
}

const SHADER_URL = "**/mount/fixture/shaders/0051ea5af5b8066c.wgsl";
const MANIFEST_URL = "**/mount/fixture/program.manifest.json";

test.beforeAll(() => {
  if (!existsSync(join(BROWSER_ROOT, ".out", "mount", "runtime.js"))) {
    throw new Error(
      "The runtime bundle is missing from .out/mount. Run `npm run build -w @mtek/runtime-web` first (`npm run test:browser` does).",
    );
  }
});

/** Linear to sRGB, 0..1 to a byte, as the hardware does for an -srgb attachment. */
function encodeSrgb(linear: number): number {
  const c = Math.min(Math.max(linear, 0), 1);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

/** Serves the fixture manifest with `edit` applied. */
async function patchManifest(page: Page, edit: (manifest: Record<string, unknown>) => void): Promise<void> {
  await page.route(MANIFEST_URL, async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    edit(manifest);
    await route.fulfill({ response, json: manifest });
  });
}

/** Mounts the fixture program on a fresh canvas (`style` sizes it) and reports what happened. A rejected mount is an outcome, not an exception. */
async function mountFixture(
  page: Page,
  canvasStyle: string,
  options: Record<string, unknown>,
  programName: "program" | "drawingProgram" = "program",
): Promise<MountOutcome> {
  return page.evaluate(
    async ({ style, mountOptions, which }): Promise<MountOutcome> => {
      const w = window as unknown as MountWindow;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("style", style);
      document.body.append(canvas);
      const reported: DiagnosticLike[] = [];
      w.__canvas = canvas;
      w.__reported = reported;
      const overlay = (): { role: string | null; text: string | null } => {
        const element = document.querySelector("[data-mtek-overlay]");
        return { role: element?.getAttribute("role") ?? null, text: element?.textContent ?? null };
      };
      try {
        const app = await w.__mtek.mountMtek(canvas, w.__mtek[which], {
          ...(mountOptions as object),
          onDiagnostic: (d: DiagnosticLike) => reported.push(d),
        });
        w.__app = app;
        const o = overlay();
        return { ok: true, state: app.state, kind: null, errorDiagnostics: [], reported, overlayRole: o.role, overlayText: o.text };
      } catch (error) {
        if (!(error instanceof w.__mtek.MtekMountError)) throw error;
        const o = overlay();
        return {
          ok: false,
          state: null,
          kind: error.kind,
          errorDiagnostics: error.diagnostics,
          reported,
          overlayRole: o.role,
          overlayText: o.text,
        };
      }
    },
    { style: canvasStyle, mountOptions: options, which: programName },
  );
}

async function step(page: Page, frames: number): Promise<void> {
  await page.evaluate((count) => {
    (window as unknown as MountWindow).__app?.debug.step(count, 0.016);
  }, frames);
}

async function counters(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as MountWindow).__app?.debug.counters() ?? {});
}

interface PixelResult {
  width: number;
  height: number;
  format: string;
  length: number;
  /** Distinct RGBA values in the image, as "r,g,b,a" strings. */
  distinct: string[];
}

async function readPixels(page: Page): Promise<PixelResult> {
  return page.evaluate(async (): Promise<PixelResult> => {
    const app = (window as unknown as MountWindow).__app;
    if (app === undefined) throw new Error("no mounted app");
    const pixels = await app.debug.readPixels();
    const distinct = new Set<string>();
    for (let i = 0; i < pixels.data.length; i += 4) distinct.add(Array.from(pixels.data.subarray(i, i + 4)).join(","));
    return { width: pixels.width, height: pixels.height, format: pixels.format, length: pixels.data.length, distinct: [...distinct] };
  });
}

const CLEAR_LINEAR = [0.5, 0.2, 0.05, 1] as const;
const LIVE_COUNTERS = ["liveBuffers", "liveTextures", "liveSamplers", "liveShaderModules", "livePipelines", "liveBindGroups", "liveListeners"];

test.describe("mountMtek on a real WebGPU device", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await page.goto("/mount.html");
  });

  for (const width of [32, 100]) {
    // 32 px = 128 bytes per row and 100 px = 400 bytes per row; both are padded (256 / 512) for the copy.
    test(`renders the linear clear colour through the hardware sRGB view, ${String(width)} px wide (padded rows)`, async ({ page }) => {
      await patchManifest(page, (manifest) => {
        (manifest["scene"] as { fields: { clearColor: number[] } }).fields.clearColor = [...CLEAR_LINEAR];
      });
      const outcome = await mountFixture(page, "width:64px;height:64px", {
        test: { manualClock: true, renderTarget: { width, height: 7 } },
      });
      expect(outcome.ok, JSON.stringify(outcome.errorDiagnostics)).toBe(true);
      await step(page, 1);
      const pixels = await readPixels(page);
      expect(pixels).toMatchObject({ width, height: 7, format: "rgba8unorm-srgb", length: width * 7 * 4 });
      // One value everywhere: tightly packed rows, no padding bytes in the image.
      expect(pixels.distinct).toHaveLength(1);
      const actual = (pixels.distinct[0] ?? "").split(",").map(Number);
      const expected = [...CLEAR_LINEAR.slice(0, 3).map(encodeSrgb), 255];
      for (let channel = 0; channel < 4; channel += 1) {
        // 0.5 linear is 188 in sRGB (not 128): the encoding happened, exactly once.
        expect(
          Math.abs((actual[channel] ?? -1000) - (expected[channel] ?? 0)),
          `channel ${String(channel)}: ${actual.join(",")} vs ${expected.join(",")}`,
        ).toBeLessThanOrEqual(1);
      }
      expect(outcome.reported).toEqual([]);
    });
  }

  test("configures and renders to the canvas without a validation error and sizes the backing store", async ({ page }) => {
    const outcome = await mountFixture(page, "width:200px;height:100px", { devicePixelRatio: 1.5, test: { manualClock: true } });
    expect(outcome.ok).toBe(true);
    expect(outcome.state).toBe("running");
    await step(page, 3);
    // Uncaptured validation errors are delivered asynchronously.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const size = await page.evaluate(() => {
      const canvas = (window as unknown as MountWindow).__canvas;
      return [canvas?.width, canvas?.height];
    });
    expect(size).toEqual([300, 150]);
    const result = await counters(page);
    expect(result["framesRendered"]).toBe(3);
    expect(result["liveTextures"]).toBe(1); // the depth texture
    expect(result["liveShaderModules"]).toBe(1);
    const reported = await page.evaluate(() => (window as unknown as MountWindow).__reported);
    expect(reported).toEqual([]);
  });

  test("draws the golden program's box in its material colour over the clear colour, with one cached pipeline (M1-18)", async ({ page }) => {
    const outcome = await mountFixture(page, "width:64px;height:64px", { test: { manualClock: true, renderTarget: { width: 32, height: 32 } } }, "drawingProgram");
    expect(outcome.ok, JSON.stringify(outcome.errorDiagnostics)).toBe(true);
    await step(page, 2);
    const samples = await page.evaluate(async () => {
      const app = (window as unknown as MountWindow).__app;
      if (app === undefined) throw new Error("no mounted app");
      const pixels = await app.debug.readPixels();
      const at = (x: number, y: number): number[] => Array.from(pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4));
      return { centre: at(16, 16), corner: at(0, 0) };
    });
    // Linear colours from the golden app.js (material) and the minimal manifest (clear), sRGB-encoded.
    const material = [0.14702726900577545, 0.10702310502529144, 1.0].map(encodeSrgb);
    const clear = [0.0052, 0.007, 0.0091].map(encodeSrgb);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(Math.abs((samples.centre[channel] ?? -1000) - (material[channel] ?? 0)), `centre ${samples.centre.join(",")}`).toBeLessThanOrEqual(1);
      expect(Math.abs((samples.corner[channel] ?? -1000) - (clear[channel] ?? 0)), `corner ${samples.corner.join(",")}`).toBeLessThanOrEqual(1);
    }
    const result = await counters(page);
    expect(result["drawCalls"]).toBe(1);
    expect(result["pipelinesCreated"]).toBe(1);
    expect(outcome.reported).toEqual([]);
  });

  test("skips rendering on a zero-sized canvas and renders once it has a size (ResizeObserver)", async ({ page }) => {
    const outcome = await mountFixture(page, "width:0;height:0", { test: { manualClock: true } });
    expect(outcome.ok).toBe(true);
    await step(page, 2);
    expect((await counters(page))["framesSkipped"]).toBe(2);

    await page.evaluate(() => {
      (window as unknown as MountWindow).__canvas?.setAttribute("style", "width:80px;height:40px");
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as MountWindow).__canvas?.width ?? 0)).toBeGreaterThan(0);
    await step(page, 1);
    const result = await counters(page);
    expect(result["framesRendered"]).toBe(1);
    expect(result["liveTextures"]).toBe(1);
  });

  test("mount/dispose 20 times leaves every live counter at 0 and no overlay", async ({ page }) => {
    const cycles = await page.evaluate(async () => {
      const w = window as unknown as MountWindow;
      const results: Array<Record<string, number>> = [];
      for (let cycle = 0; cycle < 20; cycle += 1) {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("style", "width:64px;height:64px");
        document.body.append(canvas);
        const app = await w.__mtek.mountMtek(canvas, w.__mtek.program, {
          test: { manualClock: true, renderTarget: { width: 16, height: 16 } },
        });
        app.debug.step(2, 0.016);
        app.dispose();
        results.push(app.debug.counters());
        canvas.remove();
      }
      return { results, overlays: document.querySelectorAll("[data-mtek-overlay]").length };
    });
    expect(cycles.overlays).toBe(0);
    expect(cycles.results).toHaveLength(20);
    for (const result of cycles.results) {
      for (const name of LIVE_COUNTERS) expect(result[name], name).toBe(0);
    }
  });
});

test.describe("mountMtek failures in a real browser (spec/testing.md section 6.7)", () => {
  test.beforeEach(async ({ page, gpu }) => {
    void gpu;
    await page.goto("/mount.html");
  });

  test("a shader that fails to compile rejects with shader-failed, E8051 mapped through the span map, and the overlay", async ({ page }) => {
    await page.route(SHADER_URL, (route) =>
      route.fulfill({ contentType: "text/plain", body: "fn mtek_vs() -> vec4f { return not_defined_anywhere; }\n" }),
    );
    const outcome = await mountFixture(page, "width:100px;height:50px", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("shader-failed");
    const first = outcome.errorDiagnostics[0];
    expect(first?.code).toBe("MTEK-E8051");
    expect(first?.message).toContain("not_defined_anywhere");
    // The narrowest span-map entry covering the WGSL position of the error wins (manifest span 2).
    expect(first?.source?.file).toBe("src/main.mtek");
    expect(first?.source?.startByte).toBe(40);
    expect([first?.source?.startLine, first?.source?.startColumn]).toEqual([2, 1]); // copied from the manifest span
    expect(outcome.reported.map((d) => d.code)).toEqual(["MTEK-E8051"]);
    expect(outcome.overlayRole).toBe("alert");
    expect(outcome.overlayText).toContain("MTEK-E8051");
    expect(outcome.overlayText).toContain("not_defined_anywhere");
    const box = await page.locator("[data-mtek-overlay]").boundingBox();
    expect(box?.width).toBeGreaterThan(0);
  });

  test("an incompatible program rejects with incompatible-program and shows the overlay", async ({ page }) => {
    await patchManifest(page, (manifest) => {
      manifest["runtimeAbi"] = 2;
    });
    const outcome = await mountFixture(page, "width:100px;height:50px", {});
    expect(outcome.kind).toBe("incompatible-program");
    expect(outcome.errorDiagnostics[0]?.code).toBe("MTEK-E8003");
    expect(outcome.overlayText).toContain("MTEK-E8003");
  });

  test("an invalid manifest rejects with manifest-invalid and shows the overlay", async ({ page }) => {
    await patchManifest(page, (manifest) => {
      delete manifest["scene"];
    });
    const outcome = await mountFixture(page, "width:100px;height:50px", {});
    expect(outcome.kind).toBe("manifest-invalid");
    expect(outcome.overlayText).toContain("MTEK-E8006");
  });

  test("a device below the profile (an unsupported required limit) rejects with device-failed", async ({ page }) => {
    await patchManifest(page, (manifest) => {
      manifest["requiredCapabilities"] = {
        features: [],
        limits: { maxBufferSize: Number.MAX_SAFE_INTEGER },
        wgslLanguageFeatures: [],
      };
    });
    const outcome = await mountFixture(page, "width:100px;height:50px", {});
    expect(outcome.kind).toBe("device-failed");
    expect(outcome.errorDiagnostics[0]?.code).toBe("MTEK-E8002");
    expect(outcome.overlayText).toContain("MTEK-E8002");
  });

  test("failureDisplay none rejects and reports but shows no overlay", async ({ page }) => {
    await patchManifest(page, (manifest) => {
      manifest["runtimeAbi"] = 2;
    });
    const outcome = await mountFixture(page, "width:100px;height:50px", { failureDisplay: "none" });
    expect(outcome.kind).toBe("incompatible-program");
    expect(outcome.overlayText).toBeNull();
    expect(outcome.reported.map((d) => d.code)).toEqual(["MTEK-E8003"]);
  });
});

test("without navigator.gpu the mount rejects with webgpu-unavailable (E8004) and shows the overlay", async ({ page, gpu }) => {
  void gpu;
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });
  });
  await page.goto("/mount.html");
  const outcome = await mountFixture(page, "width:100px;height:50px", {});
  expect(outcome.kind).toBe("webgpu-unavailable");
  expect(outcome.errorDiagnostics[0]?.code).toBe("MTEK-E8004");
  expect(outcome.overlayText).toContain("MTEK-E8004");
});
