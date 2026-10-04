// Page-side helpers of the M1 specs: mount a built fixture through the test-mode bootstrap
// (`window.__mtekMount`, spec/runtime-abi.md section 6.5) and report what happened.
import type { Page } from "@playwright/test";

export interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
  phase: string;
  notes: string[];
  source: { file: string; startByte: number; endByte: number; startLine: number; startColumn: number } | null;
}

interface AppLike {
  state: string;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; format: string; data: Uint8Array }>;
    counters(): Record<string, number>;
    scene(): { entities: Array<{ name: string; position: unknown }> };
  };
  dispose(): void;
}

interface TestBootstrapWindow {
  __mtekMount(options: Record<string, unknown>): Promise<AppLike>;
}

export interface Capture {
  width: number;
  height: number;
  format: string;
  /** Tightly packed RGBA rows, top row first. */
  data: Uint8Array;
  counters: Record<string, number>;
  entities: Array<{ name: string; position: unknown }>;
  reported: DiagnosticLike[];
  overlayPresent: boolean;
}

/** Opens a built fixture's test page, mounts it with a fixed offscreen target, steps one frame and reads it back. */
export async function mountAndCapture(page: Page, fixture: string, target: { width: number; height: number }): Promise<Capture> {
  await page.goto(`/m1/${fixture}/index.html`);
  const raw = await page.evaluate(async (renderTarget) => {
    const w = window as unknown as TestBootstrapWindow;
    const reported: DiagnosticLike[] = [];
    let app: AppLike;
    try {
      app = await w.__mtekMount({ test: { manualClock: true, renderTarget }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
    } catch (error) {
      const failed = error as { kind?: string; diagnostics?: unknown };
      throw new Error(`mount rejected: ${String(failed.kind)} ${JSON.stringify(failed.diagnostics)}`, { cause: error });
    }
    app.debug.step(1, 1 / 60);
    const pixels = await app.debug.readPixels();
    let binary = "";
    for (let i = 0; i < pixels.data.length; i += 0x8000) binary += String.fromCharCode(...pixels.data.subarray(i, i + 0x8000));
    const result = {
      width: pixels.width,
      height: pixels.height,
      format: pixels.format,
      base64: btoa(binary),
      counters: { ...app.debug.counters() },
      entities: app.debug.scene().entities.map((entity) => ({ name: entity.name, position: entity.position })),
      reported,
      overlayPresent: document.querySelector("[data-mtek-overlay]") !== null,
    };
    app.dispose();
    return result;
  }, target);
  const { base64, ...rest } = raw;
  return { ...rest, data: new Uint8Array(Buffer.from(base64, "base64")) };
}

/** RGB of pixel (x, y). */
export function rgbAt(capture: Capture, x: number, y: number): [number, number, number] {
  const i = (y * capture.width + x) * 4;
  return [capture.data[i] ?? -1, capture.data[i + 1] ?? -1, capture.data[i + 2] ?? -1];
}

/** True when every channel is within `tolerance` (8-bit units). */
export function rgbClose(actual: readonly number[], expected: readonly number[], tolerance = 2): boolean {
  return [0, 1, 2].every((c) => Math.abs((actual[c] ?? -1000) - (expected[c] ?? 0)) <= tolerance);
}

export interface MountFailure {
  kind: string | null;
  errorName: string | null;
  diagnostics: DiagnosticLike[];
  reported: DiagnosticLike[];
  overlayText: string | null;
  overlayRole: string | null;
}

/** Opens a built fixture's test page and mounts it with default options; a rejection is the result. */
export async function mountExpectingFailure(page: Page, fixture: string): Promise<MountFailure | "mounted"> {
  await page.goto(`/m1/${fixture}/index.html`);
  return page.evaluate(async (): Promise<MountFailure | "mounted"> => {
    const w = window as unknown as TestBootstrapWindow;
    const reported: DiagnosticLike[] = [];
    try {
      const app = await w.__mtekMount({ onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
      app.dispose();
      return "mounted";
    } catch (error) {
      const failed = error as { name?: unknown; kind?: unknown; diagnostics?: unknown };
      const overlay = document.querySelector("[data-mtek-overlay]");
      return {
        kind: typeof failed.kind === "string" ? failed.kind : null,
        errorName: typeof failed.name === "string" ? failed.name : null,
        diagnostics: Array.isArray(failed.diagnostics) ? (failed.diagnostics as DiagnosticLike[]) : [],
        reported,
        overlayText: overlay?.textContent ?? null,
        overlayRole: overlay?.getAttribute("role") ?? null,
      };
    }
  });
}
