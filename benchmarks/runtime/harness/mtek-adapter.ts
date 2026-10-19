// The Mtek side of every workload: mounts the built program (`mtek build`) into an offscreen render target of the protocol's
// size under a manual clock, so a frame is `debug.step(1, dt)` and the picture can be read back. The program module and the
// runtime come from the build output (`.out/site/mtek/<workload>/app.js`), loaded as a production page loads them.
import protocol from "../protocol.json" with { type: "json" };
import type { BenchApp, BenchContext, Create, FrameSplit, PixelsRgba } from "./types.ts";

interface MountedApp {
  readonly state: string;
  readonly debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Readonly<Record<string, number>>;
    scene(): { entities: Array<{ name: string; position: unknown }> };
  };
  dispose(): void;
  replaceProgram?(candidate: unknown): Promise<{ ok: true } | { ok: false; diagnostics: Array<{ code: string; message: string }> }>;
}

interface ProgramModule {
  default: unknown;
  mountMtek(canvas: HTMLCanvasElement, program: unknown, options: object): Promise<MountedApp>;
}

export const create: Create = async (context: BenchContext): Promise<BenchApp> => {
  const module = (await import(/* @vite-ignore */ context.programUrl)) as ProgramModule;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("style", "width:64px;height:64px;position:fixed;left:0;top:0");
  document.body.append(canvas);
  const diagnostics: string[] = [];
  let app: MountedApp;
  try {
    app = await module.mountMtek(canvas, module.default, {
      failureDisplay: "none",
      pauseWhenHidden: false,
      seed: 1,
      onDiagnostic: (d: { code: string; severity?: string; message: string }) => {
        diagnostics.push(`${d.code}: ${d.message}`);
      },
      test: { manualClock: true, renderTarget: { width: protocol.target.width, height: protocol.target.height } },
    });
  } catch (error) {
    canvas.remove();
    throw new Error(`mountMtek failed: ${error instanceof Error ? error.message : String(error)}; diagnostics: ${diagnostics.join(" | ")}`, {
      cause: error,
    });
  }
  let disposed = false;
  return {
    frame(dt: number): void {
      app.debug.step(1, dt);
    },
    split(): FrameSplit {
      const counters = app.debug.counters();
      return { updateMs: counters["cpuUpdateMs"] ?? NaN, renderPrepMs: counters["renderPrepMs"] ?? NaN };
    },
    async readPixels(): Promise<PixelsRgba> {
      const frame = await app.debug.readPixels();
      return { width: frame.width, height: frame.height, data: frame.data };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      app.dispose();
      canvas.remove();
    },
    runtimeCounters(): Readonly<Record<string, number>> {
      return { ...app.debug.counters() };
    },
    async reload(): Promise<void> {
      if (context.editedProgramUrl === null) throw new Error("this workload has no edited program");
      if (app.replaceProgram === undefined) throw new Error("this runtime build has no replaceProgram (development builds only)");
      const edited = (await import(/* @vite-ignore */ context.editedProgramUrl)) as ProgramModule;
      const outcome = await app.replaceProgram(edited.default);
      if (!outcome.ok) throw new Error(`replaceProgram was refused: ${outcome.diagnostics.map((d) => `${d.code} ${d.message}`).join(" | ")}`);
    },
    info(): Record<string, unknown> {
      const entities = app.debug.scene().entities;
      return { entityCount: entities.length, sample: entities.slice(0, 10), diagnostics };
    },
  };
};
