// The frame order of `spec/scenes.md` section 10, without any rendering, so that it can be tested without
// a browser: host inputs, key transitions, fixed ticks, update. `startTask` (task.ts) renders after it.

/** The fixed step, the largest catch-up and the clamp of a frame delta (Mtek's defaults, `spec/scenes.md` section 10). */
export const FIXED_STEP = 1 / 60;
export const MAX_CATCH_UP_STEPS = 4;
export const MAX_FRAME_DELTA = 0.1;

type Transition = { readonly kind: "down" | "up"; readonly code: string };
type QueuedInput = { readonly name: string; readonly value: unknown };

/** What a frame calls, in order. */
export interface FrameCallbacks {
  input(name: string, value: unknown): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  fixedUpdate(dt: number): void;
  update(dt: number): void;
}

export class FrameClock {
  /** The keys that are down as of the last applied input phase (what `is_key_down` answers). */
  readonly down = new Set<string>();
  private readonly held = new Set<string>();
  private readonly transitions: Transition[] = [];
  private readonly inputs: QueuedInput[] = [];
  private accumulator = 0;

  /** A key goes down; a repeat of a key that is already held is ignored, as a real keyboard's auto-repeat is. */
  pressKey(code: string): void {
    if (this.held.has(code)) return;
    this.held.add(code);
    this.transitions.push({ kind: "down", code });
  }

  releaseKey(code: string): void {
    if (!this.held.delete(code)) return;
    this.transitions.push({ kind: "up", code });
  }

  setInput(name: string, value: unknown): void {
    this.inputs.push({ name, value });
  }

  /** One frame of `dtSeconds`, without rendering. Returns the number of fixed ticks it ran. */
  frame(dtSeconds: number, callbacks: FrameCallbacks): number {
    // 1. Input: host inputs in arrival order, then key transitions in arrival order.
    for (const input of this.inputs.splice(0)) callbacks.input(input.name, input.value);
    for (const transition of this.transitions.splice(0)) {
      if (transition.kind === "down") {
        this.down.add(transition.code);
        callbacks.keyDown(transition.code);
      } else {
        this.down.delete(transition.code);
        callbacks.keyUp(transition.code);
      }
    }
    // 2. Fixed ticks: at most MAX_CATCH_UP_STEPS, the surplus of the accumulator is dropped.
    const delta = Math.min(dtSeconds, MAX_FRAME_DELTA);
    this.accumulator += delta;
    let ticks = 0;
    while (this.accumulator >= FIXED_STEP && ticks < MAX_CATCH_UP_STEPS) {
      callbacks.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      ticks += 1;
    }
    if (this.accumulator >= FIXED_STEP) this.accumulator %= FIXED_STEP;
    // 3. Update with the clamped frame delta.
    callbacks.update(delta);
    return ticks;
  }
}
