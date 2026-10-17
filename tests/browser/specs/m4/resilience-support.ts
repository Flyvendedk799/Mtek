// Page-side harness and Node-side helpers of the M4-09 resilience specs (decision 0056). The harness is
// installed once per page; it mounts a built fixture through the test-mode bootstrap
// (`window.__mtekMount`, spec/runtime-abi.md section 6.5), collects every diagnostic, and exposes what the
// specs drive: stepping, pixels, device loss, canvas size.
import type { Page } from "@playwright/test";

export interface DiagnosticLike {
  code: string;
  severity: string;
  phase: string;
  message: string;
  notes: string[];
}

export interface Counters {
  [name: string]: number;
}

export interface Capture {
  width: number;
  height: number;
  /** Tightly packed RGBA rows, top row first. */
  data: Uint8Array;
  base64: string;
}

export interface SceneSnapshot {
  state: Record<string, unknown>;
  entities: Array<{ name: string; position: unknown; rotation: unknown; mat?: { p: Record<string, unknown> } }>;
}

/** What the harness reports about the page: the application state and every diagnostic so far. */
export interface Status {
  state: string;
  reported: DiagnosticLike[];
  overlayText: string | null;
  overlayRole: string | null;
  counters: Counters;
}

interface AppLike {
  state: string;
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; format: string; data: Uint8Array }>;
    counters(): Counters;
    loseDevice(): void;
    failAllocation(): void;
    scene(): SceneSnapshot;
  };
}

interface HarnessWindow {
  __mtekMount(options: Record<string, unknown>): Promise<AppLike>;
  __h: Harness;
}

interface Harness {
  app: AppLike | undefined;
  reported: DiagnosticLike[];
  mount(options: Record<string, unknown>): Promise<void>;
  status(): Status;
}

/** Runs in the page: defines `window.__h`. */
export function installHarness(): void {
  const w = window as unknown as HarnessWindow;
  const harness: Harness = {
    app: undefined,
    reported: [],
    async mount(options) {
      harness.reported = [];
      try {
        harness.app = await w.__mtekMount({ ...options, onDiagnostic: (d: DiagnosticLike) => harness.reported.push(d) });
      } catch (error) {
        const failed = error as { kind?: string; diagnostics?: unknown };
        throw new Error(`mount rejected: ${String(failed.kind)} ${JSON.stringify(failed.diagnostics)}`, { cause: error });
      }
    },
    status() {
      const overlay = document.querySelector("[data-mtek-overlay]");
      const app = harness.app;
      return {
        state: app?.state ?? "unmounted",
        reported: [...harness.reported],
        overlayText: overlay?.textContent ?? null,
        overlayRole: overlay?.getAttribute("role") ?? null,
        counters: app === undefined || app.state === "disposed" ? {} : { ...app.debug.counters() },
      };
    },
  };
  w.__h = harness;
}

export async function openFixture(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.evaluate(installHarness);
}

export async function mount(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.evaluate((o) => (window as unknown as HarnessWindow).__h.mount(o), options);
}

export function status(page: Page): Promise<Status> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__h.status());
}

/** Runs `frames` frames of `dtSeconds` each (manual clock). */
export async function step(page: Page, frames: number, dtSeconds = 1 / 60): Promise<void> {
  await page.evaluate(({ n, dt }) => {
    const app = (window as unknown as HarnessWindow).__h.app;
    if (app === undefined) throw new Error("not mounted");
    app.debug.step(n, dt);
  }, { n: frames, dt: dtSeconds });
}

export function scene(page: Page): Promise<SceneSnapshot> {
  return page.evaluate(() => {
    const app = (window as unknown as HarnessWindow).__h.app;
    if (app === undefined) throw new Error("not mounted");
    return app.debug.scene();
  });
}

/** Reads the offscreen target back. A rejection (for instance at zero size) comes back as `{ error }`. */
export async function capture(page: Page): Promise<Capture | { error: string }> {
  const raw = await page.evaluate(async () => {
    const app = (window as unknown as HarnessWindow).__h.app;
    if (app === undefined) throw new Error("not mounted");
    try {
      const pixels = await app.debug.readPixels();
      let binary = "";
      for (let i = 0; i < pixels.data.length; i += 0x8000) binary += String.fromCharCode(...pixels.data.subarray(i, i + 0x8000));
      return { width: pixels.width, height: pixels.height, base64: btoa(binary), error: undefined };
    } catch (error) {
      return { width: 0, height: 0, base64: "", error: error instanceof Error ? error.message : String(error) };
    }
  });
  if (raw.error !== undefined) return { error: raw.error };
  return { width: raw.width, height: raw.height, base64: raw.base64, data: new Uint8Array(Buffer.from(raw.base64, "base64")) };
}

export async function captureOrThrow(page: Page): Promise<Capture> {
  const result = await capture(page);
  if ("error" in result) throw new Error(`readPixels failed: ${result.error}`);
  return result;
}

/** Resolves when the page's `condition` (an expression over `window.__h`) holds; fails after `timeoutMs`. */
export async function waitForState(page: Page, state: string, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    (wanted) => (window as unknown as HarnessWindow).__h.app?.state === wanted,
    state,
    { timeout: timeoutMs, polling: 10 },
  );
}

/** Sets the CSS size of the canvas and waits for the ResizeObserver callback (two animation frames). */
export async function setCanvasCssSize(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.getElementById("mtek") as HTMLCanvasElement;
      canvas.style.width = `${String(w)}px`;
      canvas.style.height = `${String(h)}px`;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    },
    { w: width, h: height },
  );
}

export function canvasBackingSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById("mtek") as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

/** The bounding box (inclusive pixel indices) of every pixel that differs from `clear`, or `null` when there is none. */
export function silhouette(pixels: Capture, clear: readonly number[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const i = (y * pixels.width + x) * 4;
      const differs = [0, 1, 2].some((c) => Math.abs((pixels.data[i + c] ?? 0) - (clear[c] ?? 0)) > 8);
      if (!differs) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}

/** Number of pixels that differ from `clear`. */
export function drawnPixels(pixels: Capture, clear: readonly number[]): number {
  let count = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if ([0, 1, 2].some((c) => Math.abs((pixels.data[i + c] ?? 0) - (clear[c] ?? 0)) > 8)) count += 1;
  }
  return count;
}
