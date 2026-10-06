/**
 * The `Key` enum's DOM side (`spec/scenes.md` section 7.2, `spec/stdlib.md` section 5): the physical
 * `KeyboardEvent.code` values a program can name. Any other code is never reported to generated code
 * and never has its default action suppressed.
 */
const LETTERS = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`);
const DIGITS = Array.from({ length: 10 }, (_, i) => `Digit${String(i)}`);

export const MAPPED_KEY_CODES: readonly string[] = Object.freeze([
  ...LETTERS,
  ...DIGITS,
  "Space",
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const MAPPED = new Set(MAPPED_KEY_CODES);

/** Whether `code` is the DOM code of a `Key` member. */
export function isMappedKeyCode(code: unknown): code is string {
  return typeof code === "string" && MAPPED.has(code);
}
