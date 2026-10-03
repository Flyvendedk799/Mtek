// Unit tests of the bridge oracle (no browser): the leaf order and word encoding the GPU probe is
// compared against, the sample values, the JSON transport and the CPU sRGB encoding. The layout
// records are the hand-checked goldens of `tests/gpu-layout/`.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type LayoutRecord, parseLayoutRecord, parseProbeManifest } from "./bridge-layout.ts";
import {
  type CpuValue,
  DEFAULT_SEED,
  createRng,
  expectedLeaves,
  expectedWords,
  f32Bits,
  hashString,
  resolveSeed,
  sampleValue,
  srgbEncode,
  srgbEncode8,
  toJson,
} from "./bridge-values.ts";

const gpuLayoutDir = resolve(import.meta.dirname, "..", "..", "gpu-layout");

function golden(name: string): LayoutRecord {
  return parseLayoutRecord(readFileSync(join(gpuLayoutDir, `${name}.layout.json`), "utf8"));
}

function goldenNames(): string[] {
  return readdirSync(gpuLayoutDir)
    .filter((file) => file.endsWith(".layout.json"))
    .map((file) => file.slice(0, -".layout.json".length))
    .sort();
}

describe("the fixture set", () => {
  it("has the 14 required layout fixtures", () => {
    expect(goldenNames()).toHaveLength(14);
  });
});

describe("expectedLeaves and expectedWords", () => {
  const mixed: CpuValue = {
    a: 1.5,
    b: { x: 1, y: 2, z: 3 },
    c: 0xdeadbeef,
    d: { x: -1, y: 0.5 },
    e: true,
    f: { r: 0.25, g: 0.75, b: 0, a: 1 },
  };

  it("walks the mixed block in leaf order with the bit patterns of its values", () => {
    const leaves = expectedLeaves(golden("mixed"), mixed);
    expect(leaves.map((leaf) => [leaf.path, leaf.kind, leaf.word])).toEqual([
      ["a", "f32", 0x3fc00000],
      ["b.x", "f32", 0x3f800000],
      ["b.y", "f32", 0x40000000],
      ["b.z", "f32", 0x40400000],
      ["c", "u32", 0xdeadbeef],
      ["d.x", "f32", 0xbf800000],
      ["d.y", "f32", 0x3f000000],
      ["e", "bool32", 1],
      ["f.x", "f32", 0x3e800000],
      ["f.y", "f32", 0x3f400000],
      ["f.z", "f32", 0],
      ["f.w", "f32", 0x3f800000],
    ]);
  });

  it("packs the words four to a pixel and zero-fills the last pixel", () => {
    const words = expectedWords(golden("mixed"), mixed, 3);
    expect(words).toHaveLength(12);
    const scalar = golden("scalar_f32");
    expect(expectedWords(scalar, { value: 2 }, 1)).toEqual([0x40000000, 0, 0, 0]);
  });

  it("writes a false bool as 0 and an i32 through its two's complement bits", () => {
    const record = golden("all_types");
    const value = sampleValue(record, createRng(1), "edge", 0) as Record<string, CpuValue>;
    const withInt: CpuValue = { ...value, b: false, i: -2147483648 };
    const leaves = expectedLeaves(record, withInt);
    expect(leaves[0]).toEqual({ path: "b", kind: "bool32", word: 0 });
    expect(leaves[1]).toEqual({ path: "i", kind: "i32", word: 0x80000000 });
    const withMinusOne = expectedLeaves(record, { ...withInt, i: -1 });
    expect(withMinusOne[1]?.word).toBe(0xffffffff);
  });

  it("names array elements, struct members and matrix entries like the probe", () => {
    const frame = (name: string, value: CpuValue): string[] =>
      expectedLeaves(golden(name), value).map((leaf) => leaf.path);
    expect(frame("array_f32", { weights: [1, 2, 3], bias: 4 })).toEqual([
      "weights[0]",
      "weights[1]",
      "weights[2]",
      "bias",
    ]);
    const lights = {
      lights: [
        { color: { x: 1, y: 2, z: 3 }, intensity: 4 },
        { color: { x: 5, y: 6, z: 7 }, intensity: 8 },
      ],
      count: 2,
    };
    expect(frame("array_of_structs", lights)).toEqual([
      "lights[0].color.x",
      "lights[0].color.y",
      "lights[0].color.z",
      "lights[0].intensity",
      "lights[1].color.x",
      "lights[1].color.y",
      "lights[1].color.z",
      "lights[1].intensity",
      "count",
    ]);
    const matrix = new Float32Array(16).map((_, index) => index + 1);
    const paths = expectedLeaves(golden("mat4_and_quat"), {
      m: matrix,
      q: { x: 0, y: 0, z: 0, w: 1 },
      s: 9,
    });
    expect(paths.slice(0, 5).map((leaf) => leaf.path)).toEqual([
      "m[0].x",
      "m[0].y",
      "m[0].z",
      "m[0].w",
      "m[1].x",
    ]);
    // Column-major: the second column starts at the fifth Float32Array entry.
    expect(paths[4]?.word).toBe(f32Bits(5));
    expect(paths[15]?.path).toBe("m[3].w");
    expect(paths[20]?.path).toBe("s");
  });

  it("reports a value that does not fit the record", () => {
    expect(() => expectedLeaves(golden("mixed"), { a: 1 })).toThrow(/missing `b`/);
    expect(() => expectedLeaves(golden("scalar_f32"), { value: true })).toThrow(/expected a number/);
    expect(() => expectedLeaves(golden("array_f32"), { weights: [1, 2], bias: 1 })).toThrow(
      /index 2 out of range/,
    );
  });

  it("counts the leaves of every fixture from the record alone", () => {
    const counts: Record<string, number> = {
      scalar_f32: 1,
      mixed: 12,
      array_f32: 4,
      all_types: 37,
      builtin_object: 32,
      builtin_frame: 72,
    };
    for (const [name, count] of Object.entries(counts)) {
      const record = golden(name);
      const value = sampleValue(record, createRng(7), "random", 0);
      expect(expectedLeaves(record, value), name).toHaveLength(count);
    }
  });
});

describe("sample values", () => {
  it("are deterministic for a seed and differ between seeds", () => {
    const record = golden("all_types");
    const first = toJson(sampleValue(record, createRng(42), "random", 0));
    expect(toJson(sampleValue(record, createRng(42), "random", 0))).toEqual(first);
    expect(toJson(sampleValue(record, createRng(43), "random", 0))).not.toEqual(first);
  });

  it("use distinct finite normal f32 bit patterns in random mode, in every fixture", () => {
    for (const name of goldenNames()) {
      const record = golden(name);
      const leaves = expectedLeaves(record, sampleValue(record, createRng(hashString(name)), "random", 0));
      const floats = leaves.filter((leaf) => leaf.kind === "f32").map((leaf) => leaf.word);
      expect(new Set(floats).size, name).toBe(floats.length);
      for (const bits of floats) {
        const exponent = (bits >>> 23) & 0xff;
        expect(exponent, `${name}: 0x${bits.toString(16)}`).toBeGreaterThan(0);
        expect(exponent, `${name}: 0x${bits.toString(16)}`).toBeLessThan(255);
      }
    }
  });

  it("cover both bool values over consecutive trials", () => {
    const record = golden("array_bool");
    const flags = (trial: number): boolean[] => {
      const value = sampleValue(record, createRng(5), "random", trial) as { flags?: boolean[] };
      return value.flags ?? [];
    };
    expect(flags(0)).not.toEqual(flags(1));
  });

  it("include the extreme values of every scalar kind in edge mode", () => {
    const record = golden("all_types");
    const value = sampleValue(record, createRng(1), "edge", 0) as Record<string, CpuValue>;
    expect(value["i"]).toBe(-2147483648);
    expect(value["u"]).toBe(0xffffffff);
    expect(f32Bits(value["f"] as number)).toBe(0x7f7fffff);
  });

  it("fill a mat4 as a 16-element Float32Array", () => {
    const value = sampleValue(golden("mat4_and_quat"), createRng(3), "random", 0) as Record<string, CpuValue>;
    expect(value["m"]).toBeInstanceOf(Float32Array);
    expect((value["m"] as Float32Array).length).toBe(16);
  });
});

describe("toJson", () => {
  it("turns a Float32Array into a plain array and keeps everything else", () => {
    const json = toJson({ m: new Float32Array([1, 2]), list: [true, { x: 3 }], n: 4 });
    expect(json).toEqual({ m: [1, 2], list: [true, { x: 3 }], n: 4 });
    expect(Array.isArray((json as { m: unknown }).m)).toBe(true);
  });
});

describe("resolveSeed", () => {
  it("defaults, parses decimal and hex, and rejects nonsense", () => {
    expect(resolveSeed({})).toBe(DEFAULT_SEED);
    expect(resolveSeed({ MTEK_TEST_SEED: "  " })).toBe(DEFAULT_SEED);
    expect(resolveSeed({ MTEK_TEST_SEED: "123" })).toBe(123);
    expect(resolveSeed({ MTEK_TEST_SEED: "0xff" })).toBe(255);
    expect(() => resolveSeed({ MTEK_TEST_SEED: "-1" })).toThrow(/MTEK_TEST_SEED/);
    expect(() => resolveSeed({ MTEK_TEST_SEED: "1.5" })).toThrow(/MTEK_TEST_SEED/);
    expect(() => resolveSeed({ MTEK_TEST_SEED: "abc" })).toThrow(/MTEK_TEST_SEED/);
  });
});

describe("srgbEncode", () => {
  it("is the exact sRGB OETF", () => {
    expect(srgbEncode(0)).toBe(0);
    expect(srgbEncode(1)).toBeCloseTo(1, 12);
    // Linear segment below the knee: 12.92 * c.
    expect(srgbEncode(0.002)).toBeCloseTo(0.02584, 10);
    // Power segment: 1.055 * c^(1/2.4) - 0.055; 0.5 -> 0.7353569830524495.
    expect(srgbEncode(0.5)).toBeCloseTo(0.7353569830524495, 12);
    // Continuous at the knee.
    expect(srgbEncode(0.0031308)).toBeCloseTo(12.92 * 0.0031308, 6);
  });

  it("clamps to the unit range and rounds to 8 bits", () => {
    expect(srgbEncode(-0.5)).toBe(0);
    expect(srgbEncode(2)).toBeCloseTo(1, 12);
    expect(srgbEncode8(0)).toBe(0);
    expect(srgbEncode8(1)).toBe(255);
    expect(srgbEncode8(0.5)).toBe(188);
    expect(srgbEncode8(0.002)).toBe(7);
  });
});

describe("parseProbeManifest", () => {
  it("accepts the generator's leaf list and rejects a malformed one", () => {
    const manifest = parseProbeManifest(
      JSON.stringify({
        id: "fixture:x",
        leafWords: 1,
        width: 1,
        leaves: [{ path: "value", kind: "f32", byteOffset: 0 }],
      }),
    );
    expect(manifest.leaves).toEqual([{ path: "value", kind: "f32", byteOffset: 0 }]);
    expect(() => parseProbeManifest(JSON.stringify({ id: "x" }))).toThrow(/leafWords/);
    expect(() =>
      parseProbeManifest(
        JSON.stringify({
          id: "x",
          leafWords: 1,
          width: 1,
          leaves: [{ path: "value", kind: "f64", byteOffset: 0 }],
        }),
      ),
    ).toThrow(/kind/);
  });
});
