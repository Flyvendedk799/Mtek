/**
 * Input state and the transition queue (`spec/scenes.md` sections 7 and 10.3, `spec/runtime-abi.md`
 * section 7). The DOM listeners (`input/dom.ts`) and `debug.pressKey` feed it; the scheduler's phase 1
 * calls {@link InputState.deliver}.
 *
 *  - Two views of every key exist. The **arrival** view is what the browser has done so far and
 *    decides whether a transition is news (a second `keydown` without a `keyup` is auto-repeat). The
 *    **delivered** view is what generated code has been told, and is what `is_key_down` reads: the
 *    state as of the end of phase 1.
 *  - Transitions are delivered in arrival order, so a key pressed and released within one frame
 *    delivers both. `pointer_move` is the exception: it is coalesced to one event per frame with the
 *    latest position, delivered after the frame's other transitions.
 *  - Focus loss synthesises a release for everything held; they are delivered at the start of the next
 *    frame. Transitions that arrive while paused are discarded, and resuming re-synchronises exactly
 *    as focus loss does.
 */
import { isMappedKeyCode } from "./keys.js";

/** A pointer transition's position is in NDC (`x` right, `y` up, both in `[-1, 1]`). */
export type InputTransition =
  | { readonly kind: "key_down" | "key_up"; readonly code: string }
  | { readonly kind: "pointer_down" | "pointer_up" | "pointer_move"; readonly x: number; readonly y: number; readonly button: number };

/** Buttons the language knows: 0 primary, 1 middle, 2 secondary. */
function isKnownButton(button: number): boolean {
  return button === 0 || button === 1 || button === 2;
}

export class InputState {
  private queue: InputTransition[] = [];
  private pendingMove: { x: number; y: number } | null = null;
  private readonly arrivalKeys = new Set<string>();
  private readonly deliveredKeys = new Set<string>();
  private readonly arrivalButtons = new Map<number, { x: number; y: number }>();
  private readonly deliveredButtons = new Map<number, { x: number; y: number }>();
  private paused = false;

  /** `is_key_down(code)`: the delivered state, as of the end of phase 1 of the current frame. */
  isKeyDown(code: string): boolean {
    return this.deliveredKeys.has(code);
  }

  /** The number of transitions waiting for the next phase 1. */
  get pending(): number {
    return this.queue.length + (this.pendingMove === null ? 0 : 1);
  }

  /** A `keydown`. Returns whether it is a transition: unmapped codes, repeats and held keys are not. */
  keyDown(code: string, repeat = false): boolean {
    if (this.paused || repeat || !isMappedKeyCode(code) || this.arrivalKeys.has(code)) return false;
    this.arrivalKeys.add(code);
    this.queue.push({ kind: "key_down", code });
    return true;
  }

  /** A `keyup`. Returns whether it is a transition: only a key that arrived as down can be released. */
  keyUp(code: string): boolean {
    if (this.paused || !isMappedKeyCode(code) || !this.arrivalKeys.delete(code)) return false;
    this.queue.push({ kind: "key_up", code });
    return true;
  }

  pointerDown(x: number, y: number, button: number): boolean {
    if (this.paused || !isKnownButton(button) || this.arrivalButtons.has(button)) return false;
    this.arrivalButtons.set(button, { x, y });
    this.queue.push({ kind: "pointer_down", x, y, button });
    return true;
  }

  pointerUp(x: number, y: number, button: number): boolean {
    if (this.paused || !this.arrivalButtons.delete(button)) return false;
    this.queue.push({ kind: "pointer_up", x, y, button });
    return true;
  }

  /** Coalesced: only the latest position of the frame is kept. */
  pointerMove(x: number, y: number): boolean {
    if (this.paused) return false;
    this.pendingMove = { x, y };
    return true;
  }

  /** The document lost focus or became hidden: everything held is released at the next frame. */
  focusLost(): void {
    if (this.paused) return;
    for (const code of this.arrivalKeys) this.queue.push({ kind: "key_up", code });
    this.arrivalKeys.clear();
    this.pointerCancelled();
  }

  /** The browser cancelled the pointer (`pointercancel`): held buttons are released at the next frame. */
  pointerCancelled(): void {
    if (this.paused) return;
    for (const [button, at] of this.arrivalButtons) this.queue.push({ kind: "pointer_up", x: at.x, y: at.y, button });
    this.arrivalButtons.clear();
  }

  /** Stops accepting transitions and drops the ones not yet delivered. */
  pause(): void {
    this.paused = true;
    this.queue = [];
    this.pendingMove = null;
  }

  /**
   * Accepts transitions again. What generated code believes is held is released at the next frame,
   * because the key-up events of the paused interval were never seen.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.arrivalKeys.clear();
    for (const code of this.deliveredKeys) this.queue.push({ kind: "key_up", code });
    this.arrivalButtons.clear();
    for (const [button, at] of this.deliveredButtons) this.queue.push({ kind: "pointer_up", x: at.x, y: at.y, button });
  }

  /**
   * Phase 1: takes the queued transitions, updates the delivered state with them and returns them in
   * delivery order.
   */
  deliver(): readonly InputTransition[] {
    const out = this.queue;
    this.queue = [];
    if (this.pendingMove !== null) {
      // `pointer_move` reports the primary button state as 0 (spec/scenes.md section 7.1).
      out.push({ kind: "pointer_move", x: this.pendingMove.x, y: this.pendingMove.y, button: 0 });
      this.pendingMove = null;
    }
    for (const transition of out) {
      switch (transition.kind) {
        case "key_down":
          this.deliveredKeys.add(transition.code);
          break;
        case "key_up":
          this.deliveredKeys.delete(transition.code);
          break;
        case "pointer_down":
          this.deliveredButtons.set(transition.button, { x: transition.x, y: transition.y });
          break;
        case "pointer_up":
          this.deliveredButtons.delete(transition.button);
          break;
        case "pointer_move":
          break;
      }
    }
    return out;
  }
}
