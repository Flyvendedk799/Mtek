// Page-side helpers of the M2 specs: mount a built M2 fixture through the test-mode bootstrap
// (`window.__mtekMount`, spec/runtime-abi.md section 6.5), drive it with `app.debug` and report what happened.
import type { Page } from "@playwright/test";
import type { DiagnosticLike } from "../m1/support.ts";

export type { DiagnosticLike };

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

interface TestBootstrapWindow {
  __mtekMount(options: Record<string, unknown>): Promise<AppLike>;
}

/** One parameter write made through `app.debug.setParam` before a frame. */
export interface ParamWrite {
  entity: string;
  param: string;
  value: unknown;
}

/** What a session does for one frame: writes, then one frame of 1/60 s, then reads the listed pixels. */
export interface SessionStep {
  label: string;
  writes: readonly ParamWrite[];
}

export interface SessionFrame {
  label: string;
  /** RGB of every sampled pixel, in the order of `samples`. */
  pixels: Array<[number, number, number]>;
  counters: Record<string, number>;
  /** Diagnostics delivered so far (cumulative). */
  reported: DiagnosticLike[];
}

export interface Session {
  frames: SessionFrame[];
  /** Whether the failure overlay was present at the end. */
  overlayPresent: boolean;
  state: string;
}

/**
 * Mounts `fixture` on an offscreen target, renders one frame (`initial`), then runs `steps`: each applies its
 * writes through `debug.setParam`, renders a frame and samples `samples` (x, y in target pixels). Every frame
 * returns the sampled pixels and the counters. A rejected mount is an error naming the kind and diagnostics.
 */
export async function runSession(
  page: Page,
  fixture: string,
  target: { width: number; height: number },
  samples: ReadonlyArray<readonly [number, number]>,
  steps: readonly SessionStep[],
): Promise<Session> {
  await page.goto(`/m2/${fixture}/index.html`);
  return page.evaluate(
    async ({ renderTarget, points, script }) => {
      const w = window as unknown as TestBootstrapWindow;
      const reported: DiagnosticLike[] = [];
      let app: AppLike;
      try {
        app = await w.__mtekMount({ test: { manualClock: true, renderTarget }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
      } catch (error) {
        const failed = error as { kind?: string; diagnostics?: unknown };
        throw new Error(`mount rejected: ${String(failed.kind)} ${JSON.stringify(failed.diagnostics)}`, { cause: error });
      }
      const frames: SessionFrame[] = [];
      const capture = async (label: string): Promise<void> => {
        app.debug.step(1, 1 / 60);
        const pixels = await app.debug.readPixels();
        frames.push({
          label,
          pixels: points.map(([x, y]) => {
            const i = (y * pixels.width + x) * 4;
            return [pixels.data[i] ?? -1, pixels.data[i + 1] ?? -1, pixels.data[i + 2] ?? -1] as [number, number, number];
          }),
          counters: { ...app.debug.counters() },
          reported: [...reported],
        });
      };
      await capture("initial");
      for (const step of script) {
        for (const write of step.writes) app.debug.setParam(write.entity, write.param, write.value);
        await capture(step.label);
      }
      const result = { frames, overlayPresent: document.querySelector("[data-mtek-overlay]") !== null, state: app.state };
      app.dispose();
      return result;
    },
    { renderTarget: target, points: samples.map(([x, y]) => [x, y] as [number, number]), script: steps.map((s) => ({ label: s.label, writes: [...s.writes] })) },
  );
}

export interface MountFailure {
  kind: string | null;
  errorName: string | null;
  diagnostics: DiagnosticLike[];
  reported: DiagnosticLike[];
  overlayText: string | null;
  overlayRole: string | null;
}

/** Opens a built M2 fixture's test page and mounts it with default options; a rejection is the result. */
export async function mountExpectingFailure(page: Page, fixture: string): Promise<MountFailure | "mounted"> {
  await page.goto(`/m2/${fixture}/index.html`);
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
