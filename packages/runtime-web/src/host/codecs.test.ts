/**
 * Unit tests per host-input codec (`spec/runtime-abi.md` section 6.3) and agreement with the
 * TypeScript declaration shapes of section 6.4.
 */
import { describe, expect, it } from "vitest";
import { decodeColorHex, decodeHostInput, srgb8ToLinear } from "./codecs.js";

describe("host input codecs", () => {
  it("f32 accepts finite numbers and rounds to binary32", () => {
    expect(decodeHostInput("f32", 0.1)).toEqual({ ok: true, value: Math.fround(0.1) });
    expect(decodeHostInput("f32", Number.NaN).ok).toBe(false);
    const wrong = decodeHostInput("f32", "1");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("MTEK-E8041");
  });

  it("i32 and u32 accept only integers in range", () => {
    expect(decodeHostInput("i32", -1)).toEqual({ ok: true, value: -1 });
    expect(decodeHostInput("i32", 1.5).ok).toBe(false);
    expect(decodeHostInput("u32", 0)).toEqual({ ok: true, value: 0 });
    expect(decodeHostInput("u32", -1).ok).toBe(false);
  });

  it("bool accepts only booleans", () => {
    expect(decodeHostInput("bool", true)).toEqual({ ok: true, value: true });
    expect(decodeHostInput("bool", 1).ok).toBe(false);
  });

  it("vecN accepts finite number arrays of the right length", () => {
    expect(decodeHostInput("vec2", [1, 2])).toEqual({ ok: true, value: { x: 1, y: 2 } });
    expect(decodeHostInput("vec3", [1, 2, 3])).toEqual({ ok: true, value: { x: 1, y: 2, z: 3 } });
    expect(decodeHostInput("vec4", [1, 2, 3, 4])).toEqual({ ok: true, value: { x: 1, y: 2, z: 3, w: 4 } });
    expect(decodeHostInput("vec3", [1, 2]).ok).toBe(false);
    expect(decodeHostInput("vec2", [1, Number.NaN]).ok).toBe(false);
  });

  it("string accepts strings up to 64 KiB", () => {
    expect(decodeHostInput("string", "hi")).toEqual({ ok: true, value: "hi" });
    expect(decodeHostInput("string", 1).ok).toBe(false);
  });

  it("color-hex converts like a colour literal", () => {
    const result = decodeColorHex("#ff0000", false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const c = result.value as { r: number; g: number; b: number; a: number };
      expect(c.r).toBe(srgb8ToLinear(255));
      expect(c.g).toBe(0);
      expect(c.b).toBe(0);
      expect(c.a).toBe(1);
    }
    const withAlpha = decodeColorHex("#ff000080", false);
    expect(withAlpha.ok).toBe(true);
    if (withAlpha.ok) {
      expect((withAlpha.value as { a: number }).a).toBe(Math.fround(0x80 / 255));
    }
    expect(decodeColorHex("#fff", false).ok).toBe(false);
  });

  it("color-hex-opaque rejects non-opaque alpha with MTEK-E8100", () => {
    expect(decodeColorHex("#ff0000", true).ok).toBe(true);
    expect(decodeColorHex("#ff0000ff", true).ok).toBe(true);
    const bad = decodeColorHex("#ff000080", true);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("MTEK-E8100");
  });

  it("decoder accepts exactly what the Inputs declaration allows", () => {
    // `#${string}` → color-hex / color-hex-opaque
    expect(decodeHostInput("color-hex-opaque", "#aabbcc").ok).toBe(true);
    expect(decodeHostInput("color-hex-opaque", 1).ok).toBe(false);
    // number → f32 / i32 / u32
    expect(decodeHostInput("f32", 1.25).ok).toBe(true);
    expect(decodeHostInput("f32", true).ok).toBe(false);
    // boolean → bool
    expect(decodeHostInput("bool", false).ok).toBe(true);
    // number[] → vecN
    expect(decodeHostInput("vec2", [0, 1]).ok).toBe(true);
    expect(decodeHostInput("vec2", { x: 0, y: 1 }).ok).toBe(false);
    // string → string
    expect(decodeHostInput("string", "ok").ok).toBe(true);
  });
});
