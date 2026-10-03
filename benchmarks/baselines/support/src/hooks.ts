// The contract between a baseline application and the browser test (decision 0018, section 6).
// `startTask` (task.ts) installs an object of this shape as `window.mtekTask`; the Playwright side
// (../test) drives it. It is the baseline counterpart of Mtek's `app.debug` test control
// (spec/runtime-abi.md section 10.2).

/** RGBA8 pixels of the render target, row 0 at the top, colours sRGB-encoded (`rgba8unorm-srgb`). */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** `width * height * 4` bytes as plain numbers (so they cross the Playwright boundary as JSON). */
  readonly data: readonly number[];
}

export type InputResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface TaskHooks {
  /** Side length of the square render target in pixels. */
  readonly size: number;
  /**
   * Runs `frames` frames of `dtSeconds` each. Per frame: queued key transitions and host inputs are
   * applied (input phase), then `update(dt)` runs, then the scene is rendered into the target.
   */
  step(frames: number, dtSeconds: number): Promise<void>;
  /** Reads the render target as left by the last rendered frame. */
  readPixels(): Promise<Pixels>;
  /** Queues a key-down transition (a `KeyboardEvent.code`); ignored if the key is already down. */
  pressKey(code: string): void;
  /** Queues a key-up transition; ignored if the key is not down. */
  releaseKey(code: string): void;
  /** Queues a host input; it is applied at the start of the next frame. */
  setInput(name: string, value: unknown): InputResult;
}

declare global {
  interface Window {
    /** Present once the application has started. */
    mtekTask?: TaskHooks;
    /** Set instead of `mtekTask` when the application failed to start. */
    mtekTaskError?: string;
  }
}
