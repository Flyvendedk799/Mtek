import { expect, it } from "vitest";
import { GamepadInput, type GamepadSnapshot } from "./gamepad.js";

it("copies one sample per frame and clears disconnected and missing controls", () => {
  let pads: (GamepadSnapshot | null)[] = [{ connected: true, axes: [0.5, -2], buttons: [{ value: 0.75 }] }, null];
  const input = new GamepadInput(() => pads);
  expect(input.connected(0)).toBe(false);
  input.poll();
  expect(input.axis(0, 0)).toBe(0.5);
  expect(input.axis(0, 1)).toBe(-1);
  expect(input.button(0, 0)).toBe(0.75);
  expect(input.axis(-1, 0)).toBe(0);
  expect(input.axis(0, 0.5)).toBe(0);
  expect(input.button(0, 20)).toBe(0);
  pads = [];
  expect(input.connected(0)).toBe(true);
  input.poll();
  expect(input.connected(0)).toBe(false);
  expect(input.axis(0, 0)).toBe(0);
});

it("treats blocked browser access and nonfinite control values as neutral", () => {
  const denied = new GamepadInput(() => { throw new Error("blocked"); });
  expect(() => denied.poll()).not.toThrow();
  expect(denied.button(0, 0)).toBe(0);
  const invalid = new GamepadInput(() => [{ connected: true, axes: [NaN], buttons: [{ value: Infinity }] }]);
  invalid.poll();
  expect(invalid.axis(0, 0)).toBe(0);
  expect(invalid.button(0, 0)).toBe(0);
});
