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
  /**
   * The DOM codes whose default action is suppressed: those some `key_down`/`key_up` handler names and those the
   * program polls. Asked at every key event, so the application can change the answer (a scene switch, a hot reload).
   */
  readonly handledKeys: { has(code: string): boolean };
}

interface KeyboardLike extends Event {
  readonly code: string;
  readonly repeat: boolean;
}

interface PointerLike extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons?: number;
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

  // A drag on a touch screen must reach the game instead of panning or zooming the page, and must not start a text
  // selection (decision 0176). The CSS of a game package says the same; this covers every other page.
  const style: CSSStyleDeclaration | undefined = (canvas as Partial<HTMLCanvasElement>).style;
  if (style !== undefined) {
    style.touchAction = "none";
    style.userSelect = "none";
    (style as unknown as Record<string, string>)["webkitUserSelect"] = "none";
  }

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
  // The pointer that pressed: the events of any other pointer (a second finger) never touch the primary's state.
  let pressing: number | null = null;
  const ofPressing = (pointer: PointerLike): boolean => pointer.isPrimary && (pressing === null || pointer.pointerId === pressing);
  // Pointer Events emit down/up only when entering/leaving the active-buttons
  // state. Additional button transitions arrive as pointermove with button >= 0.
  const syncButtons = (pointer: PointerLike, where: { x: number; y: number }): void => {
    if (pointer.buttons === undefined) return;
    const masks = [1, 4, 2]; // DOM button indices: left, middle, right.
    for (let button = 0; button < masks.length; button++) {
      if ((pointer.buttons & masks[button]!) !== 0) input.pointerDown(where.x, where.y, button);
      else input.pointerUp(where.x, where.y, button);
    }
  };
  registry.addEventListener(canvas, "pointerdown", (event) => {
    const pointer = event as PointerLike;
    if (!pointer.isPrimary) return;
    const where = at(event);
    if (input.pointerDown(where.x, where.y, where.button)) {
      pressing = pointer.pointerId;
      // Keeps the matching pointerup coming even when the pointer leaves the canvas.
      try {
        (canvas as Partial<HTMLCanvasElement>).setPointerCapture?.(pointer.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; its release arrives as pointercancel.
      }
    }
  });
  registry.addEventListener(canvas, "pointerup", (event) => {
    if (!ofPressing(event as PointerLike)) return;
    const where = at(event);
    input.pointerUp(where.x, where.y, where.button);
    syncButtons(event as PointerLike, where);
  });
  registry.addEventListener(canvas, "pointercancel", (event) => {
    if (!ofPressing(event as PointerLike)) return;
    pressing = null;
    input.pointerCancelled();
  });
  registry.addEventListener(canvas, "pointermove", (event) => {
    const pointer = event as PointerLike;
    if (!ofPressing(pointer)) return;
    const where = at(event);
    if (pointer.button >= 0) syncButtons(pointer, where);
    input.pointerMove(where.x, where.y);
  });
}
