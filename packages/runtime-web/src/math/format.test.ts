import { describe, expect, it } from "vitest";

import { fmt, formatF32 } from "./format.js";

describe("rt.fmt (decision 0133)", () => {
  it("formats f32 as the shortest round-trip decimal", () => {
    expect(formatF32(Math.fround(0.1))).toBe("0.1");
    expect(formatF32(3)).toBe("3.0");
    expect(formatF32(-0)).toBe("-0.0");
    expect(formatF32(Math.fround(1.5))).toBe("1.5");
    expect(formatF32(Infinity)).toBe("inf");
    expect(formatF32(NaN)).toBe("NaN");
  });
  it("applies a .N spec", () => {
    expect(fmt(Math.fround(3.14159), "f32", 2)).toBe("3.14");
    expect(fmt(2, "f32", 0)).toBe("2");
    expect(fmt({ x: 1, y: Math.fround(0.5) }, "vec2", 1)).toBe("(1.0, 0.5)");
  });
  it("formats the other types", () => {
    expect(fmt(42, "i32", -1)).toBe("42");
    expect(fmt(true, "bool", -1)).toBe("true");
    expect(fmt("hi", "string", -1)).toBe("hi");
    expect(fmt({ x: 1, y: 2, z: Math.fround(0.25) }, "vec3", -1)).toBe(
      "(1.0, 2.0, 0.25)",
    );
  });
});
