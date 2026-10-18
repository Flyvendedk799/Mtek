// `startTask`: the baseline counterpart of Mtek's runtime in test mode (decision 0021, section 6).
// It owns the renderer, a 128 x 128 `RGBA8` sRGB render target with a depth buffer, a manual clock,
// key transitions, host inputs, a fixed tick and pixel readback; the application supplies a scene, a camera,
// a clear colour, an optional `update(dt)` and `fixedUpdate(dt)` and its input handlers. The frame order is
// the one of `spec/scenes.md` section 10 (frame.ts): host inputs, key transitions, fixed ticks, update, render.
import {
  type Camera,
  RenderTarget,
  type Scene,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import { FrameClock } from "./frame.ts";
import { srgb } from "./helpers.ts";
import type { InputResult, Pixels, TaskHooks } from "./hooks.ts";

export const TARGET_SIZE = 128;

/** What an application can register while it is being built. */
export interface TaskHost {
  /** Runs `handler` in the input phase of the frame after the key with this `KeyboardEvent.code` went down. */
  onKeyDown(code: string, handler: () => void): void;
  /** Runs `handler` in the input phase of the frame after the key with this `KeyboardEvent.code` went up. */
  onKeyUp(code: string, handler: () => void): void;
  /**
   * Whether the key is down as of the current frame: a transition counts from the input phase of the frame
   * that applies it, like Mtek's `is_key_down`.
   */
  isKeyDown(code: string): boolean;
  /**
   * Declares a host input (the page sets it with `setInput`, like Mtek's `[host.inputs]`). The value is
   * handed to `handler` in the input phase of the next frame.
   */
  onInput(name: string, handler: (value: unknown) => void): void;
}

export interface TaskApp {
  readonly scene: Scene;
  readonly camera: Camera;
  /** Background colour as `#rrggbb` (sRGB), like Mtek's `clear_color`. */
  readonly clearColor: string;
  /** Called once per fixed tick (0 to 4 per frame, 1/60 s each), after the frame's input. */
  fixedUpdate?(dt: number): void;
  /** Called once per frame with the clamped frame time in seconds, after the frame's fixed ticks. */
  update?(dt: number): void;
}

/**
 * What `startTask` takes: a function that builds the application. It may be asynchronous, so that the application can load
 * its images (`loadTexture`) before it creates the scene, which is the baseline counterpart of Mtek resolving `mountMtek`
 * only when every asset of the startup scene is ready (`spec/assets.md` section 5). A function that returns the app directly,
 * as every task before the textured one does, works unchanged.
 */
export type BuildTaskApp = (host: TaskHost) => TaskApp | Promise<TaskApp>;

/**
 * Builds the application (waiting for the promise `build` returns, if it returns one) and exposes it to the test as
 * `window.mtekTask`. On failure, also of the asynchronous build, it sets `window.mtekTaskError` instead, so the test can report
 * the reason.
 */
export async function startTask(build: BuildTaskApp): Promise<void> {
  try {
    window.mtekTask = await createHooks(build);
  } catch (error) {
    window.mtekTaskError = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}

async function createHooks(build: BuildTaskApp): Promise<TaskHooks> {
  const clock = new FrameClock();
  const keyHandlers = new Map<string, Array<() => void>>();
  const keyUpHandlers = new Map<string, Array<() => void>>();
  const inputHandlers = new Map<string, (value: unknown) => void>();
  const app = await build({
    onKeyDown(code, handler) {
      keyHandlers.set(code, [...(keyHandlers.get(code) ?? []), handler]);
    },
    onKeyUp(code, handler) {
      keyUpHandlers.set(code, [...(keyUpHandlers.get(code) ?? []), handler]);
    },
    isKeyDown(code) {
      return clock.down.has(code);
    },
    onInput(name, handler) {
      if (inputHandlers.has(name)) throw new Error(`host input '${name}' is declared twice`);
      inputHandlers.set(name, handler);
    },
  });

  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(TARGET_SIZE, TARGET_SIZE, false);
  renderer.setClearColor(srgb(app.clearColor), 1);
  await renderer.init();
  const target = new RenderTarget(TARGET_SIZE, TARGET_SIZE, { depthBuffer: true });
  target.texture.colorSpace = SRGBColorSpace;

  const callbacks = {
    input: (name: string, value: unknown): void => inputHandlers.get(name)?.(value),
    keyDown: (code: string): void => {
      for (const handler of keyHandlers.get(code) ?? []) handler();
    },
    keyUp: (code: string): void => {
      for (const handler of keyUpHandlers.get(code) ?? []) handler();
    },
    fixedUpdate: (dt: number): void => app.fixedUpdate?.(dt),
    update: (dt: number): void => app.update?.(dt),
  };

  return {
    size: TARGET_SIZE,
    async step(frames, dtSeconds) {
      for (let frame = 0; frame < frames; frame += 1) {
        clock.frame(dtSeconds, callbacks);
        renderer.setRenderTarget(target);
        renderer.render(app.scene, app.camera);
        renderer.setRenderTarget(null);
      }
      await Promise.resolve();
    },
    async readPixels(): Promise<Pixels> {
      const bytes = await renderer.readRenderTargetPixelsAsync(target, 0, 0, TARGET_SIZE, TARGET_SIZE);
      const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: TARGET_SIZE, height: TARGET_SIZE, data: [...view] };
    },
    pressKey(code) {
      clock.pressKey(code);
    },
    releaseKey(code) {
      clock.releaseKey(code);
    },
    setInput(name, value): InputResult {
      if (!inputHandlers.has(name)) {
        return { ok: false, error: { code: "unknown-input", message: `no host input named '${name}'` } };
      }
      clock.setInput(name, value);
      return { ok: true };
    },
  };
}
