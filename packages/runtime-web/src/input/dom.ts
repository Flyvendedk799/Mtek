/**
 * The DOM side of input (`spec/scenes.md` section 7): keyboard events on the canvas's document,
 * pointer events on the canvas, and the focus signals that release everything held. Every listener is
 * added through the resource registry, so `dispose()` removes them and `liveListeners` counts them.
 */
import type { ResourceRegistry } from "../gpu/registry.js";
import type { InputState } from "./input.js";
import { isMappedKeyCode } from "./keys.js";

export interface InputTargets {
  readonly canvas: HTMLCanvasElement;
  /** `undefined` without a document: there is then no keyboard input. */
  readonly document: EventTarget | undefined;
  /** `blur` of the window is a focus loss; `undefined` outside a browser. */
  readonly window: EventTarget | undefined;
  readonly registry: ResourceRegistry;
  /** The DOM codes some `key_down`/`key_up` handler names: only these have their default action suppressed. */
  readonly handledKeys: ReadonlySet<string>;
}

interface KeyboardLike extends Event {
  readonly code: string;
  readonly repeat: boolean;
}

interface PointerLike extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly pointerId: number;
  readonly isPrimary: boolean;
}

/** NDC of a client position over the canvas: `x` right, `y` up, both in `[-1, 1]`, rounded to binary32. */
export function pointerPosition(
  canvas: { getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  const clamp = (v: number): number => Math.fround(Math.min(1, Math.max(-1, v)));
  return { x: clamp(((clientX - rect.left) / width) * 2 - 1), y: clamp(1 - ((clientY - rect.top) / height) * 2) };
}

/** Wires `input` to the DOM. */
export function attachInputListeners(input: InputState, targets: InputTargets): void {
  const { canvas, registry, handledKeys } = targets;

  if (targets.document !== undefined) {
    registry.addEventListener(targets.document, "keydown", (event) => {
      const key = event as KeyboardLike;
      if (!isMappedKeyCode(key.code)) return;
      if (handledKeys.has(key.code)) key.preventDefault();
      input.keyDown(key.code, key.repeat);
    });
    registry.addEventListener(targets.document, "keyup", (event) => {
      const key = event as KeyboardLike;
      if (!isMappedKeyCode(key.code)) return;
      if (handledKeys.has(key.code)) key.preventDefault();
      input.keyUp(key.code);
    });
  }
  if (targets.window !== undefined) {
    registry.addEventListener(targets.window, "blur", () => {
      input.focusLost();
    });
  }

  const at = (event: Event): { x: number; y: number; button: number } => {
    const pointer = event as PointerLike;
    return { ...pointerPosition(canvas, pointer.clientX, pointer.clientY), button: pointer.button };
  };
  registry.addEventListener(canvas, "pointerdown", (event) => {
    const pointer = event as PointerLike;
    if (!pointer.isPrimary) return;
    const where = at(event);
    if (input.pointerDown(where.x, where.y, where.button)) {
      // Keeps the matching pointerup coming even when the pointer leaves the canvas.
      try {
        (canvas as Partial<HTMLCanvasElement>).setPointerCapture?.(pointer.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; its release arrives as pointercancel.
      }
    }
  });
  registry.addEventListener(canvas, "pointerup", (event) => {
    if (!(event as PointerLike).isPrimary) return;
    const where = at(event);
    input.pointerUp(where.x, where.y, where.button);
  });
  registry.addEventListener(canvas, "pointercancel", () => {
    input.pointerCancelled();
  });
  registry.addEventListener(canvas, "pointermove", (event) => {
    if (!(event as PointerLike).isPrimary) return;
    const where = at(event);
    input.pointerMove(where.x, where.y);
  });
}
