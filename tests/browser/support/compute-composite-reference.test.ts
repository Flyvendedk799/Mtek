import { describe, expect, it } from "vitest";
import { compositeCases, compositeMismatches, compositeReference } from "./compute-composite-reference.ts";

describe("independent composite acceptance contracts", () => {
  it("transforms vector/bool fields and nested padded samples without copying padding", () => {
    const probe = compositeCases().find(probe => probe.name === "Transform")!;
    const output = compositeReference(probe, [17, 1, 1]), floats = new Float32Array(output), words = new Uint32Array(output);
    expect([...floats.slice(0, 3)]).toEqual([-0.75, 0.625, 3.5]);
    expect(words[3]).toBe(0); expect(floats[8]).toBe(3);
    expect(new Uint32Array(compositeReference(probe, [17, 1, 1], true))[3]).toBe(1);
    expect([floats[4], floats[12], floats[16], ...floats.slice(20, 24)]).toEqual([1, 3, 4, 5, 5.25, 5.5, 5.75]);
    expect(floats[16 * 24]).toBe(63.25); expect(floats[16 * 24 + 8]).toBe(13);
    expect(words[5]).toBe(0); expect(new Uint32Array(probe.input)[5]).toBe(0xdeadbeef);
  });
  it("preserves every logical scalar, vector, matrix and nested-array element", () => {
    for (const probe of compositeCases().filter(probe => probe.kind <= 4)) {
      const output = new Uint32Array(compositeReference(probe, [17, 1, 1])), input = new Uint32Array(probe.input);
      for (let i = 0; i < 17; i++) for (const field of probe.fields) expect(output[i * probe.strideWords + field]).toBe(input[i * probe.strideWords + field]);
      expect(compositeMismatches(output.buffer, probe.input, probe, [17, 1, 1])).toBe(0);
    }
    const required = compositeCases().find(probe => probe.name === "Required")!;
    const values = new Float32Array(compositeReference(required, [17, 1, 1]));
    expect(values[0]).toBe(1.5); expect(values[16]).toBe(17.5);
  });
  it("ignores active padding while detecting corrupt fields and any nonzero tail word", () => {
    const probe = compositeCases().find(probe => probe.name === "Transform")!, domain = [2, 2, 4] as const;
    const expected = compositeReference(probe, domain), changed = expected.slice(0), words = new Uint32Array(changed);
    words[5] = 123; expect(compositeMismatches(changed, expected, probe, domain)).toBe(0);
    words[8] = 123; expect(compositeMismatches(changed, expected, probe, domain)).toBe(1);
    words[16 * 24 + 5] = 123; expect(compositeMismatches(changed, expected, probe, domain)).toBe(2);
    expect([...new Uint32Array(expected).slice(16 * 24)].every(word => word === 0)).toBe(true);
    expect(() => compositeReference(probe, [18, 1, 1])).toThrow(RangeError);
  });
});
