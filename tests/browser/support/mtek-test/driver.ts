// The page side of `mtek test`: mounts the test build of a project with the manual clock and drives
// it through Playwright. Every `page.evaluate` callback below runs in the page, so it can use only
// its argument and the page's own globals.
import type { Page } from "@playwright/test";
import type { SceneView } from "./compare.ts";
import type { AppDriver, InputResult } from "./execute.ts";
import type { AdapterInfo } from "./plan.ts";

/** The part of the application the driver uses (`MtekApp` with `debug`, `spec/runtime-abi.md` section 6.2 and 10.2). */
interface PageApp {
  setInput(name: string, value: unknown): InputResult;
  debug: {
    step(frames: number, dt: number): void;
    pressKey(code: string): void;
    releaseKey(code: string): void;
    scene(): SceneView;
    counters(): Record<string, number>;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
  };
}

interface PageDiagnostic {
  code: string;
  severity: string;
  message: string;
}

interface PageWindow {
  /** Defined by the `index.html` of a test build (`spec/runtime-abi.md` section 6.5). */
  __mtekMount?: (options: object) => Promise<PageApp>;
  __mtekApp?: PageApp;
  /** Error diagnostics the program reported, as `code: message`. */
  __mtekErrors?: string[];
}

export type MountResult =
  | { ok: true }
  | { ok: false; kind: string; message: string; details: string[] };

export type AdapterProbe =
  | { available: true; adapter: AdapterInfo }
  | { available: false; reason: string };

/** Whether the page of a test build offers `window.__mtekMount`. */
export async function waitForMount(page: Page, timeoutMs: number): Promise<string | null> {
  try {
    await page.waitForFunction(
      () => typeof (window as unknown as PageWindow).__mtekMount === "function",
      undefined,
      { timeout: timeoutMs },
    );
    return null;
  } catch {
    return "the page does not define window.__mtekMount: it is not a build in test mode (mtek build --mode test)";
  }
}

/** Asks the page for a WebGPU adapter the way the runtime does (`spec/runtime-abi.md` section 8.1). */
export async function probeAdapter(page: Page): Promise<AdapterProbe> {
  return page.evaluate(async (): Promise<AdapterProbe> => {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (gpu === undefined) return { available: false, reason: "navigator.gpu is undefined" };
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (adapter === null) {
        return { available: false, reason: "navigator.gpu.requestAdapter() resolved to null" };
      }
      const { vendor, architecture, device, description, isFallbackAdapter } = adapter.info;
      return {
        available: true,
        adapter: { vendor, architecture, device, description, isFallbackAdapter },
      };
    } catch (error) {
      return { available: false, reason: `requestAdapter threw: ${String(error)}` };
    }
  });
}

/** Mounts the program on the page with the manual clock and a render target of `width` x `height`. */
export async function mount(
  page: Page,
  options: { seed: number; width: number; height: number },
): Promise<MountResult> {
  return page.evaluate(async (arg): Promise<MountResult> => {
    const w = window as unknown as PageWindow;
    if (w.__mtekMount === undefined) {
      return { ok: false, kind: "page", message: "window.__mtekMount is not defined", details: [] };
    }
    const errors: string[] = [];
    w.__mtekErrors = errors;
    try {
      w.__mtekApp = await w.__mtekMount({
        seed: arg.seed,
        test: { manualClock: true, renderTarget: { width: arg.width, height: arg.height } },
        onDiagnostic: (diagnostic: PageDiagnostic) => {
          if (diagnostic.severity === "error") errors.push(`${diagnostic.code}: ${diagnostic.message}`);
        },
      });
      return { ok: true };
    } catch (error) {
      const failure = error as { kind?: unknown; message?: unknown; diagnostics?: unknown };
      const diagnostics = Array.isArray(failure.diagnostics)
        ? (failure.diagnostics as PageDiagnostic[]).map((d) => `${d.code}: ${d.message}`)
        : [];
      return {
        ok: false,
        kind: typeof failure.kind === "string" ? failure.kind : "unknown",
        message: typeof failure.message === "string" ? failure.message : String(error),
        details: diagnostics,
      };
    }
  }, options);
}

/** The driver of the application that `mount` created on `page`. */
export class PageDriver implements AppDriver {
  /**
   * @param pageErrors Uncaught exceptions of the page, collected by the caller from `pageerror`.
   * @param target The size of the render target, to check the readback against.
   */
  private readonly page: Page;
  private readonly pageErrors: readonly string[];
  private readonly target: { width: number; height: number };

  constructor(page: Page, pageErrors: readonly string[], target: { width: number; height: number }) {
    this.page = page;
    this.pageErrors = pageErrors;
    this.target = target;
  }

  async step(frames: number, dt: number): Promise<void> {
    await this.page.evaluate(
      (arg) => {
        const app = (window as unknown as PageWindow).__mtekApp;
        if (app === undefined) throw new Error("the application is not mounted");
        app.debug.step(arg.frames, arg.dt);
      },
      { frames, dt },
    );
  }

  async press(code: string): Promise<void> {
    await this.page.evaluate((key) => {
      const app = (window as unknown as PageWindow).__mtekApp;
      if (app === undefined) throw new Error("the application is not mounted");
      app.debug.pressKey(key);
    }, code);
  }

  async release(code: string): Promise<void> {
    await this.page.evaluate((key) => {
      const app = (window as unknown as PageWindow).__mtekApp;
      if (app === undefined) throw new Error("the application is not mounted");
      app.debug.releaseKey(key);
    }, code);
  }

  async setInput(name: string, value: unknown): Promise<InputResult> {
    return this.page.evaluate(
      (arg): InputResult => {
        const app = (window as unknown as PageWindow).__mtekApp;
        if (app === undefined) throw new Error("the application is not mounted");
        return app.setInput(arg.name, arg.value);
      },
      { name, value },
    );
  }

  async scene(): Promise<SceneView> {
    return this.page.evaluate(() => {
      const app = (window as unknown as PageWindow).__mtekApp;
      if (app === undefined) throw new Error("the application is not mounted");
      const { state, entities } = app.debug.scene();
      return { state, entities };
    });
  }

  async counters(): Promise<Record<string, number>> {
    return this.page.evaluate(() => {
      const app = (window as unknown as PageWindow).__mtekApp;
      if (app === undefined) throw new Error("the application is not mounted");
      return { ...app.debug.counters() };
    });
  }

  async pixel(x: number, y: number): Promise<readonly number[]> {
    const read = await this.page.evaluate(
      async (arg) => {
        const app = (window as unknown as PageWindow).__mtekApp;
        if (app === undefined) throw new Error("the application is not mounted");
        const frame = await app.debug.readPixels();
        const at = (arg.y * frame.width + arg.x) * 4;
        return {
          width: frame.width,
          height: frame.height,
          rgba: [frame.data[at] ?? 0, frame.data[at + 1] ?? 0, frame.data[at + 2] ?? 0, frame.data[at + 3] ?? 0],
        };
      },
      { x, y },
    );
    if (read.width !== this.target.width || read.height !== this.target.height) {
      throw new Error(
        `the render target is ${String(read.width)} x ${String(read.height)}, not ${String(this.target.width)} x ${String(this.target.height)}`,
      );
    }
    return read.rgba;
  }

  async runtimeErrors(): Promise<string[]> {
    const reported = await this.page.evaluate(
      () => [...((window as unknown as PageWindow).__mtekErrors ?? [])],
    );
    return [...reported, ...this.pageErrors.map((message) => `uncaught exception: ${message}`)];
  }
}
