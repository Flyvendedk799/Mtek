import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../test-support/program.js";
import { InputState, type InputTransition } from "./input.js";
import { MAPPED_KEY_CODES, isMappedKeyCode } from "./keys.js";

function kinds(transitions: readonly InputTransition[]): string[] {
  return transitions.map((t) => ("code" in t ? `${t.kind}:${t.code}` : `${t.kind}:${String(t.button)}@${String(t.x)},${String(t.y)}`));
}

describe("the Key mapping", () => {
  it("has the letters, digits and 15 named keys of spec/scenes.md section 7.2", () => {
    expect(MAPPED_KEY_CODES).toHaveLength(26 + 10 + 15);
    expect(isMappedKeyCode("KeyW")).toBe(true);
    expect(isMappedKeyCode("Digit7")).toBe(true);
    expect(isMappedKeyCode("ArrowLeft")).toBe(true);
    expect(isMappedKeyCode("F5")).toBe(false);
    expect(isMappedKeyCode("w")).toBe(false);
    expect(isMappedKeyCode(undefined)).toBe(false);
  });

  it("is exactly the codes of the compiler's Key enum (spec/stdlib-schema.json)", () => {
    const schema = JSON.parse(readFileSync(resolve(REPO_ROOT, "spec", "stdlib-schema.json"), "utf8")) as {
      enums: { name: string; members: { code: string }[] }[];
    };
    const codes = schema.enums.find((e) => e.name === "Key")?.members.map((m) => m.code) ?? [];
    expect([...MAPPED_KEY_CODES].sort()).toEqual([...codes].sort());
  });
});

describe("keys", () => {
  it("delivers a press and a release within one frame, both, in order", () => {
    const input = new InputState();
    input.keyDown("Space");
    input.keyUp("Space");
    expect(input.isKeyDown("Space")).toBe(false); // nothing delivered yet
    expect(kinds(input.deliver())).toEqual(["key_down:Space", "key_up:Space"]);
    expect(input.isKeyDown("Space")).toBe(false);
  });

  it("reads is_key_down from the delivered state, as of the end of phase 1", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    expect(input.isKeyDown("KeyW")).toBe(false);
    input.deliver();
    expect(input.isKeyDown("KeyW")).toBe(true);
    input.keyUp("KeyW");
    expect(input.isKeyDown("KeyW")).toBe(true);
    input.deliver();
    expect(input.isKeyDown("KeyW")).toBe(false);
  });

  it("ignores auto-repeat, by flag and by state", () => {
    const input = new InputState();
    expect(input.keyDown("KeyA")).toBe(true);
    expect(input.keyDown("KeyA", true)).toBe(false);
    expect(input.keyDown("KeyA")).toBe(false); // already down, even without the flag
    expect(kinds(input.deliver())).toEqual(["key_down:KeyA"]);
    expect(input.keyDown("KeyA", true)).toBe(false);
    expect(input.deliver()).toEqual([]);
  });

  it("ignores unmapped codes and releases of keys that were never down", () => {
    const input = new InputState();
    expect(input.keyDown("F5")).toBe(false);
    expect(input.keyUp("F5")).toBe(false);
    expect(input.keyUp("Space")).toBe(false);
    expect(input.pending).toBe(0);
  });

  it("keeps arrival order across different keys", () => {
    const input = new InputState();
    input.keyDown("KeyB");
    input.keyDown("KeyA");
    input.keyUp("KeyB");
    expect(kinds(input.deliver())).toEqual(["key_down:KeyB", "key_down:KeyA", "key_up:KeyB"]);
  });
});

describe("focus loss", () => {
  it("releases every held key at the next delivery, never leaving one stuck", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.keyDown("Space");
    input.deliver();
    input.focusLost();
    expect(input.isKeyDown("KeyW")).toBe(true); // delivered at the start of the next frame
    expect(kinds(input.deliver())).toEqual(["key_up:KeyW", "key_up:Space"]);
    expect(input.isKeyDown("KeyW")).toBe(false);
    expect(input.isKeyDown("Space")).toBe(false);
  });

  it("lets a key pressed again after the loss register as a fresh press", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.deliver();
    input.focusLost();
    input.deliver();
    expect(input.keyDown("KeyW")).toBe(true);
    expect(kinds(input.deliver())).toEqual(["key_down:KeyW"]);
  });

  it("releases held pointer buttons at their last position", () => {
    const input = new InputState();
    input.pointerDown(0.5, -0.25, 0);
    input.deliver();
    input.focusLost();
    expect(kinds(input.deliver())).toEqual(["pointer_up:0@0.5,-0.25"]);
  });

  it("a cancelled pointer releases only the pointer", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.pointerDown(0, 0, 0);
    input.deliver();
    input.pointerCancelled();
    expect(kinds(input.deliver())).toEqual(["pointer_up:0@0,0"]);
    expect(input.isKeyDown("KeyW")).toBe(true);
  });
});

describe("pause and resume", () => {
  it("discards transitions that arrive while paused and those not yet delivered", () => {
    const input = new InputState();
    input.keyDown("KeyA"); // queued, never delivered
    input.pause();
    expect(input.pending).toBe(0);
    expect(input.keyDown("KeyB")).toBe(false);
    expect(input.keyUp("KeyB")).toBe(false);
    expect(input.pointerDown(0, 0, 0)).toBe(false);
    expect(input.pointerMove(0.1, 0.1)).toBe(false);
    input.focusLost();
    input.resume();
    expect(input.deliver()).toEqual([]);
  });

  it("re-synchronises on resume as on focus loss: what generated code saw as held is released", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.pointerDown(0.25, 0.25, 2);
    input.deliver();
    input.pause();
    input.resume();
    expect(kinds(input.deliver())).toEqual(["key_up:KeyW", "pointer_up:2@0.25,0.25"]);
    expect(input.isKeyDown("KeyW")).toBe(false);
  });

  it("a key held through the pause is not pressed again by its auto-repeat", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.deliver();
    input.pause();
    input.resume();
    input.deliver();
    expect(input.keyDown("KeyW", true)).toBe(false);
    expect(input.deliver()).toEqual([]);
  });

  it("resume without pause changes nothing", () => {
    const input = new InputState();
    input.keyDown("KeyW");
    input.deliver();
    input.resume();
    expect(input.deliver()).toEqual([]);
    expect(input.isKeyDown("KeyW")).toBe(true);
  });
});

describe("pointer", () => {
  it("delivers down and up in arrival order with their own positions and buttons", () => {
    const input = new InputState();
    input.pointerDown(-1, 1, 0);
    input.pointerUp(0.5, 0.5, 0);
    input.pointerDown(0, 0, 2);
    expect(kinds(input.deliver())).toEqual(["pointer_down:0@-1,1", "pointer_up:0@0.5,0.5", "pointer_down:2@0,0"]);
  });

  it("coalesces moves to one per frame with the latest position, after the other transitions", () => {
    const input = new InputState();
    input.pointerMove(0.1, 0.1);
    input.pointerDown(0.2, 0.2, 0);
    input.pointerMove(0.3, 0.3);
    input.pointerMove(0.4, 0.4);
    expect(kinds(input.deliver())).toEqual(["pointer_down:0@0.2,0.2", "pointer_move:0@0.4,0.4"]);
    expect(input.deliver()).toEqual([]);
  });

  it("reports the primary button (0) for moves", () => {
    const input = new InputState();
    input.pointerDown(0, 0, 2);
    input.pointerMove(0.5, 0.5);
    expect(kinds(input.deliver()).at(-1)).toBe("pointer_move:0@0.5,0.5");
  });

  it("ignores unknown buttons, duplicate downs and releases of buttons that are not down", () => {
    const input = new InputState();
    expect(input.pointerDown(0, 0, 3)).toBe(false);
    expect(input.pointerDown(0, 0, 0)).toBe(true);
    expect(input.pointerDown(0, 0, 0)).toBe(false);
    expect(input.pointerUp(0, 0, 1)).toBe(false);
    expect(input.pointerUp(0, 0, 0)).toBe(true);
  });
});
