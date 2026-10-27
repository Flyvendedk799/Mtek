import { describe, expect, it } from "vitest";
import { invocationReference, positionInput, positionReference, mismatchWords, pixelDifference } from "./compute-reference.ts";

describe("independent compute acceptance references", () => {
  it("rounds f32 arithmetic and leaves undispatched tail slots zero", () => {
    const input = positionInput(), output = positionReference(input, 0.25, [3, 1, 1]);
    expect([...output.slice(0, 4)]).toEqual([Math.fround(-0.8 + 0.25), Math.fround(-0.55 + 0.25), 0.25, 0]);
    expect([...output.slice(3)].every((value) => value === 0)).toBe(true);
    expect(input[0]).toBe(Math.fround(-0.8));
  });
  it("records independently calculated 3D coordinates, groups and local indexes", () => {
    const words = invocationReference([5, 3, 3]);
    // Last logical slot (4,2,2), in workgroup (1,1,1), at local (0,0,0).
    expect([...words.slice(44 * 14, 45 * 14)]).toEqual([44, 4, 2, 2, 0, 0, 0, 1, 1, 1, 2, 2, 2, 0]);
    expect(words[29 * 14 + 13]).toBe(8); // global (4,2,1), local (0,0,1)
    expect([...words.slice(45 * 14)].every((value) => value === 0)).toBe(true);
  });
  it("detects a corrupted value, wrong flattening and changed pixels", () => {
    const expected = invocationReference([5, 3, 3]), changed = expected.slice(); changed[44 * 14] = 999;
    expect(mismatchWords(changed.buffer, expected.buffer)).toBe(1);
    const image = new Uint8Array([0, 0, 0, 255, 20, 30, 40, 255]);
    expect(pixelDifference(image, image.slice())).toBe(0);
    expect(pixelDifference(image, new Uint8Array([0, 0, 0, 255, 20, 30, 90, 255]))).toBe(1);
  });
});
