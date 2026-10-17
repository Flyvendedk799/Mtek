// M4-07: the development overlay, GPU time and the release boundary (spec/tooling.md sections 2 and 9,
// spec/runtime-abi.md section 10.1, decision 0055).
//
//  - `.out/m4/culling` is built in test mode, which embeds the development runtime (`runtime.dev.js`): with
//    `devOverlay: true` it shows the panel, with the counters of the frame just drawn.
//  - `.out/m4-release/culling` is built in release mode: its runtime has no overlay code, so even a page that asks
//    for the overlay gets none, and its counters still show culling working.
//  - GPU time is only reported when the adapter has `timestamp-query`; otherwise the panel says so and the counters
//    carry no value. The test checks whichever case the machine is in and records which one it was.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { M4_FIXTURES_DIR, M4_OUT_DIR, M4_RELEASE_OUT_DIR, CULLING } from "../../support/m4-fixtures.ts";

const TARGET = { width: 128, height: 64 } as const;
const SOURCE = readFileSync(join(M4_FIXTURES_DIR, CULLING, "src", "main.mtek"), "utf8");

interface AppLike {
  setInput(name: string, value: unknown): { ok: boolean };
  dispose(): void;
  state: string;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
  };
}

interface DevWindow {
  __mtekMount(options: object): Promise<AppLike>;
  __app?: AppLike;
}

/** The 1-based line of `entity <name>` in the fixture, found in the source text rather than assumed. */
function entityLine(name: string): number {
  const index = SOURCE.split("\n").findIndex((line) => line.trimStart().startsWith(`entity ${name} `));
  if (index < 0) throw new Error(`no entity ${name} in the fixture`);
  return index + 1;
}

async function mountDev(page: Page, options: object = {}): Promise<void> {
  await page.goto(`/m4/${CULLING}/index.html`);
  await page.evaluate(
    async ({ target, extra }) => {
      const w = window as unknown as DevWindow;
      w.__app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, ...extra });
    },
    { target: TARGET, extra: options },
  );
}

const panelText = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.querySelector("[data-mtek-dev-overlay]")?.textContent ?? null);

const step = (page: Page, frames = 1): Promise<void> =>
  page.evaluate((n) => {
    (window as unknown as DevWindow).__app?.debug.step(n, 1 / 60);
  }, frames);

const setCameraX = (page: Page, x: number): Promise<void> =>
  page.evaluate((value) => {
    (window as unknown as DevWindow).__app?.setInput("camera_x", value);
  }, x);

/** `label: value` fields of the panel, by line. */
function field(text: string, label: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}: `));
  if (line === undefined) throw new Error(`no '${label}' line in the panel:\n${text}`);
  return line.slice(label.length + 2);
}

test.describe("development overlay (M4-07)", () => {
  test("the test-mode page shows the panel with the counters of the frame just drawn", async ({ page, gpu }) => {
    void gpu;
    await mountDev(page, { devOverlay: true });
    expect(await panelText(page)).toBeNull();
    await step(page);
    const first = (await panelText(page)) ?? "";
    expect(field(first, "scene")).toBe("Culling");
    expect(field(first, "entity")).toBe(`S0 (1/9) src/main.mtek:${String(entityLine("S0"))}`);
    expect(field(first, "draw calls")).toBe("9  instanced draws: 0  culled objects: 0");
    expect(field(first, "errors")).toBe("none");

    // Moving the camera changes the counters the panel shows, from the next frame on.
    await setCameraX(page, 12);
    await step(page);
    const moved = (await panelText(page)) ?? "";
    expect(field(moved, "draw calls")).toBe("4  instanced draws: 0  culled objects: 5");

    // The panel is a DOM element beside the canvas: marked, not an alert, not exposed to assistive technology.
    const attributes = await page.evaluate(() => {
      const element = document.querySelector("[data-mtek-dev-overlay]");
      return {
        ariaHidden: element?.getAttribute("aria-hidden") ?? null,
        role: element?.getAttribute("role") ?? null,
        failure: document.querySelector("[data-mtek-overlay]") !== null,
        tag: element?.tagName ?? null,
      };
    });
    expect(attributes).toEqual({ ariaHidden: "true", role: null, failure: false, tag: "PRE" });
  });

  test("lists upload bytes, creation and live counts, discarded steps, and the frame time with p50 and p95", async ({ page, gpu }) => {
    void gpu;
    await mountDev(page, { devOverlay: true });
    await step(page, 10);
    const text = (await panelText(page)) ?? "";
    const counters = await page.evaluate(() => (window as unknown as DevWindow).__app?.debug.counters() ?? {});
    expect(field(text, "uploads")).toBe(`${String(counters["uploads"])}  upload bytes: ${String(counters["uploadBytes"])}`);
    expect(field(text, "created")).toContain(`pipelines ${String(counters["pipelinesCreated"])}`);
    expect(field(text, "live")).toContain(`buffers ${String(counters["liveBuffers"])}`);
    expect(field(text, "discarded steps")).toBe(String(counters["discardedSteps"]));

    // Frame time: from performance.now(), p50 <= p95, over the 10 frames so far.
    const match = /^(\d+\.\d\d) ms {2}p50 (\d+\.\d\d) {2}p95 (\d+\.\d\d) {2}\(last 10 frames\)$/.exec(field(text, "frame time"));
    expect(match, field(text, "frame time")).not.toBeNull();
    const [, last, p50, p95] = (match ?? []).map(Number);
    expect(last).toBeGreaterThanOrEqual(0);
    expect(p95).toBeGreaterThanOrEqual(p50 ?? Infinity);
    expect(counters["frameTimeMs"]).toBeGreaterThanOrEqual(0);
    expect(counters["frameTimeMs"]).toBeCloseTo(last ?? NaN, 1);
  });

  test("the backquote key hides and shows the panel; Shift+backquote selects the next entity and shows its source line", async ({ page, gpu }) => {
    void gpu;
    await mountDev(page, { devOverlay: true });
    await step(page);
    const key = (shiftKey: boolean): Promise<void> =>
      page.evaluate((shift) => {
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", key: "`", shiftKey: shift, bubbles: true }));
      }, shiftKey);
    const display = (): Promise<string | null> =>
      page.evaluate(() => document.querySelector<HTMLElement>("[data-mtek-dev-overlay]")?.style.display ?? null);

    expect(await display()).toBe("block");
    await key(false);
    expect(await display()).toBe("none");
    await key(false);
    expect(await display()).toBe("block");

    await key(true);
    expect(field((await panelText(page)) ?? "", "entity")).toBe(`S1 (2/9) src/main.mtek:${String(entityLine("S1"))}`);
    for (let i = 0; i < 7; i += 1) await key(true);
    expect(field((await panelText(page)) ?? "", "entity")).toBe(`S8 (9/9) src/main.mtek:${String(entityLine("S8"))}`);
    await key(true);
    expect(field((await panelText(page)) ?? "", "entity")).toBe(`S0 (1/9) src/main.mtek:${String(entityLine("S0"))}`);
  });

  test("the overlay never changes the pixels of a frame, and dispose removes it", async ({ page, gpu }) => {
    void gpu;
    const read = async (devOverlay: boolean): Promise<number[]> => {
      await mountDev(page, { devOverlay });
      await setCameraX(page, 12);
      await step(page, 2);
      return page.evaluate(async () => Array.from((await (window as unknown as DevWindow).__app!.debug.readPixels()).data));
    };
    const without = await read(false);
    expect(await panelText(page)).toBeNull();
    const withPanel = await read(true);
    expect(await panelText(page)).not.toBeNull();
    expect(withPanel.length).toBe(without.length);
    expect(withPanel.every((value, i) => value === without[i])).toBe(true);

    await page.evaluate(() => {
      (window as unknown as DevWindow).__app?.dispose();
    });
    expect(await panelText(page)).toBeNull();
  });

  test("GPU time comes from timestamp-query, or is reported as unavailable; it is never CPU time under another name", async ({ page, gpu }, testInfo) => {
    void gpu;
    await mountDev(page, { devOverlay: true });
    const hasFeature = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      return adapter?.features.has("timestamp-query") ?? false;
    });
    testInfo.annotations.push({ type: "timestamp-query", description: hasFeature ? "available: GPU time measured" : "unavailable: GPU time reported as unavailable" });

    if (!hasFeature) {
      await step(page, 3);
      const counters = await page.evaluate(() => (window as unknown as DevWindow).__app?.debug.counters() ?? {});
      expect(counters["gpuTimeAvailable"]).toBe(0);
      expect("gpuTimeMs" in counters).toBe(false);
      expect(await panelText(page)).toContain("GPU time unavailable");
      return;
    }

    // The mapping completes asynchronously, so step frame by frame until the first measurement arrives.
    let counters: Record<string, number> = {};
    for (let attempt = 0; attempt < 200 && counters["gpuTimeAvailable"] !== 1; attempt += 1) {
      await step(page);
      await page.waitForTimeout(10);
      counters = await page.evaluate(() => (window as unknown as DevWindow).__app?.debug.counters() ?? {});
    }
    expect(counters["gpuTimeAvailable"], "a measurement arrived within 200 frames").toBe(1);
    const gpuTime = counters["gpuTimeMs"] ?? Number.NaN;
    expect(Number.isFinite(gpuTime) && gpuTime >= 0).toBe(true);
    // 9 spheres on a 128 x 64 target cannot take a second of GPU time.
    expect(gpuTime).toBeLessThan(1000);
    await step(page);
    expect(await panelText(page)).toMatch(/GPU time: \d+\.\d\d ms/);
    expect(await panelText(page)).not.toContain("GPU time unavailable");
  });

  test("without the option the development runtime shows no panel and measures no GPU time", async ({ page, gpu }) => {
    void gpu;
    await mountDev(page);
    await step(page, 3);
    expect(await panelText(page)).toBeNull();
    const counters = await page.evaluate(() => (window as unknown as DevWindow).__app?.debug.counters() ?? {});
    expect(counters["gpuTimeAvailable"]).toBe(0);
    expect("gpuTimeMs" in counters).toBe(false);
  });
});

test.describe("the release build (M4-07)", () => {
  test("the runtime file of a release build has no overlay code, the test-mode one has", async ({ request, baseURL }) => {
    const text = async (root: string): Promise<{ name: string; source: string }> => {
      const page = await (await request.get(`${baseURL}/${root}/${CULLING}/index.html`)).text();
      const app = await (await request.get(`${baseURL}/${root}/${CULLING}/app.js`)).text();
      const name = /from "\.\/(runtime\.[0-9a-f]{16}\.js)"/.exec(app)?.[1];
      if (name === undefined) throw new Error(`app.js of ${root} imports no runtime file`);
      expect(page).toContain("mountMtek");
      return { name, source: await (await request.get(`${baseURL}/${root}/${CULLING}/${name}`)).text() };
    };
    const release = await text("m4-release");
    const dev = await text("m4");
    expect(dev.name).not.toBe(release.name);
    for (const marker of ["data-mtek-dev-overlay", "GPU time unavailable"]) {
      expect(dev.source, `test-mode runtime has ${marker}`).toContain(marker);
      expect(release.source, `release runtime has ${marker}`).not.toContain(marker);
    }
    // The files on disk are what was served.
    expect(readFileSync(join(M4_RELEASE_OUT_DIR, CULLING, release.name), "utf8")).toBe(release.source);
    expect(readFileSync(join(M4_OUT_DIR, CULLING, dev.name), "utf8")).toBe(dev.source);
  });

  test("a release page shows no overlay, even when mounted with devOverlay, and culling still works", async ({ page, gpu }) => {
    void gpu;
    await page.goto(`/m4-release/${CULLING}/index.html`);
    const result = await page.evaluate(async (target) => {
      // The page already mounted the program on its own canvas; mount it again on a second canvas of the same page.
      const module = (await import(`${location.pathname.replace(/index\.html$/, "")}app.js`)) as {
        default: object;
        mountMtek(canvas: HTMLCanvasElement, program: object, options: object): Promise<AppLike>;
      };
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      const app = await module.mountMtek(canvas, module.default, { devOverlay: true, test: { manualClock: true, renderTarget: target } });
      app.debug.step(1, 1 / 60);
      const full = { ...app.debug.counters() };
      app.setInput("camera_x", 100);
      app.debug.step(1, 1 / 60);
      const away = { ...app.debug.counters() };
      const panels = document.querySelectorAll("[data-mtek-dev-overlay]").length;
      app.dispose();
      return { full, away, panels };
    }, TARGET);
    expect(result.panels).toBe(0);
    expect(result.full).toMatchObject({ drawCalls: 9, culledObjects: 0, gpuTimeAvailable: 0 });
    expect(result.away).toMatchObject({ drawCalls: 0, culledObjects: 9, gpuTimeAvailable: 0 });
    expect("gpuTimeMs" in result.away).toBe(false);
  });
});
