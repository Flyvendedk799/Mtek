// `startTask`: the baseline counterpart of Mtek's runtime in test mode (decision 0018, section 6).
// It owns the renderer, a 128 x 128 `RGBA8` sRGB render target with a depth buffer, a manual clock,
// key transitions, host inputs and pixel readback; the application supplies a scene, a camera, a clear
// colour, an optional `update(dt)` and its input handlers.
import {
  type Camera,
  RenderTarget,
  type Scene,
  SRGBColorSpace,
  WebGPURenderer,
} from "three/webgpu";
import { srgb } from "./helpers.ts";
import type { InputResult, Pixels, TaskHooks } from "./hooks.ts";

export const TARGET_SIZE = 128;

/** What an application can register while it is being built. */
export interface TaskHost {
  /** Runs `handler` in the input phase of the frame after the key with this `KeyboardEvent.code` went down. */
  onKeyDown(code: string, handler: () => void): void;
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
  /** Called once per frame with the frame time in seconds, after the frame's input. */
  update?(dt: number): void;
}

type Transition = { readonly kind: "down" | "up"; readonly code: string };
type QueuedInput = { readonly name: string; readonly value: unknown };

/**
 * Builds the application and exposes it to the test as `window.mtekTask`. On failure it sets
 * `window.mtekTaskError` instead, so the test can report the reason.
 */
export async function startTask(build: (host: TaskHost) => TaskApp): Promise<void> {
  try {
    window.mtekTask = await createHooks(build);
  } catch (error) {
    window.mtekTaskError = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}

async function createHooks(build: (host: TaskHost) => TaskApp): Promise<TaskHooks> {
  const keyHandlers = new Map<string, Array<() => void>>();
  const inputHandlers = new Map<string, (value: unknown) => void>();
  const app = build({
    onKeyDown(code, handler) {
      keyHandlers.set(code, [...(keyHandlers.get(code) ?? []), handler]);
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

  const held = new Set<string>();
  const transitions: Transition[] = [];
  const inputs: QueuedInput[] = [];

  /** Phase 1 of a frame: queued key transitions and host inputs, in arrival order within each kind. */
  const applyInput = (): void => {
    for (const transition of transitions.splice(0)) {
      if (transition.kind === "down") {
        for (const handler of keyHandlers.get(transition.code) ?? []) handler();
      }
    }
    for (const input of inputs.splice(0)) inputHandlers.get(input.name)?.(input.value);
  };

  return {
    size: TARGET_SIZE,
    async step(frames, dtSeconds) {
      for (let frame = 0; frame < frames; frame += 1) {
        applyInput();
        app.update?.(dtSeconds);
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
      if (held.has(code)) return;
      held.add(code);
      transitions.push({ kind: "down", code });
    },
    releaseKey(code) {
      if (!held.delete(code)) return;
      transitions.push({ kind: "up", code });
    },
    setInput(name, value): InputResult {
      if (!inputHandlers.has(name)) {
        return { ok: false, error: { code: "unknown-input", message: `no host input named '${name}'` } };
      }
      inputs.push({ name, value });
      return { ok: true };
    },
  };
}
