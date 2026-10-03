// Tests of the test support itself: the independent encoder against hand-computed bytes, the
// value generator's guarantees, and proof that the comparison would catch a broken writer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dirtyPadding, firstDifference, paddingOffsets } from "./bytes.js";
import type { CpuValue } from "./cpu-value.js";
import { encodeBlock } from "./encoder.js";
import { gpuLayoutDir, makeViews } from "./fixtures.js";
import {
  type LayoutNode,
  type LayoutRecord,
  componentNames,
  elementType,
  parseLayoutRecord,
} from "./layout.js";
import {
  DEFAULT_SEED,
  createRng,
  f32Bits,
  hashString,
  resolveSeed,
  sampleValue,
} from "./values.js";

function golden(name: string): LayoutRecord {
  return parseLayoutRecord(readFileSync(resolve(gpuLayoutDir, `${name}.layout.json`), "utf8"));
}

describe("independent encoder", () => {
  it("writes the mixed record at the offsets of spec/gpu-layout.md section 4.5 B", () => {
    const record = golden("mixed");
    const value: CpuValue = {
      a: 1.5,
      b: { x: 1, y: 2, z: 3 },
      c: 0xdeadbeef,
      d: { x: 0.5, y: -2 },
      e: true,
      f: { r: 1, g: 0, b: 0.25, a: -1 },
    };
    // Hand-written expectation: literal offsets from the specification table.
    const expected = new Uint8Array(64);
    const view = new DataView(expected.buffer);
    view.setFloat32(0, 1.5, true);
    view.setFloat32(16, 1, true);
    view.setFloat32(20, 2, true);
    view.setFloat32(24, 3, true);
    view.setUint32(28, 0xdeadbeef, true);
    view.setFloat32(32, 0.5, true);
    view.setFloat32(36, -2, true);
    view.setUint32(40, 1, true);
    view.setFloat32(48, 1, true);
    view.setFloat32(52, 0, true);
    view.setFloat32(56, 0.25, true);
    view.setFloat32(60, -1, true);
    expect(firstDifference(expected, encodeBlock(record, value))).toBeNull();
  });

  it("reads mat4 column-major and quaternions as x y z w", () => {
    const record = golden("mat4_and_quat");
    const matrix = new Float32Array(16).map((_, index) => index + 1);
    const value: CpuValue = {
      m: matrix,
      q: { x: 1, y: 2, z: 3, w: 4 },
      s: 0.5,
    };
    const bytes = encodeBlock(record, value);
    const view = new DataView(bytes.buffer);
    const matrixMember = record.root.members.find((member) => member.name === "m");
    const quatMember = record.root.members.find((member) => member.name === "q");
    expect(matrixMember?.node.offset).toBeDefined();
    expect(quatMember?.node.offset).toBeDefined();
    const matrixAt = matrixMember?.node.offset ?? 0;
    const quatAt = quatMember?.node.offset ?? 0;
    for (let index = 0; index < 16; index++) {
      expect(view.getFloat32(matrixAt + 4 * index, true)).toBe(index + 1);
    }
    expect([0, 1, 2, 3].map((k) => view.getFloat32(quatAt + 4 * k, true))).toEqual([1, 2, 3, 4]);
  });

  it("rejects values that do not fit the record", () => {
    const record = golden("mixed");
    expect(() => encodeBlock(record, { a: 1 })).toThrow(/missing `b`/);
    expect(() => encodeBlock(record, 3)).toThrow(/expected an object/);
  });

  it("leaves exactly the padding of the specification uncovered", () => {
    // gpu-layout.md section 4.5 B: bytes 4-15 and 44-47 of the mixed record are padding.
    const expected = [...range(4, 16), ...range(44, 48)];
    expect(paddingOffsets(golden("mixed"))).toEqual(expected);
  });
});

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, index) => start + index);
}

describe("layout parsing helpers", () => {
  it("extracts array element types", () => {
    expect(elementType("array<f32, 3>")).toBe("f32");
    expect(elementType("array<array<f32, 2>, 3>")).toBe("array<f32, 2>");
    expect(elementType("array<Inner, 16>")).toBe("Inner");
    expect(elementType("vec3")).toBe("");
  });

  it("names vector components by Mtek type", () => {
    expect(componentNames("color", 4)).toEqual(["r", "g", "b", "a"]);
    expect(componentNames("quat", 4)).toEqual(["x", "y", "z", "w"]);
    expect(componentNames("vec3", 3)).toEqual(["x", "y", "z"]);
  });

  it("rejects malformed records with a path", () => {
    expect(() => parseLayoutRecord("{}")).toThrow(/\$\.id/);
    expect(() =>
      parseLayoutRecord(
        '{"id":"x","wgslStruct":"y","size":4,"align":4,"root":{"kind":"scalar","offset":0,"size":4,"align":4,"scalar":"f32"}}',
      ),
    ).toThrow(/\$\.root\.name/);
  });
});

describe("seeded values", () => {
  it("the PRNG is deterministic per seed and differs between seeds", () => {
    const take = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 6 }, () => rng.nextU32());
    };
    expect(take(1)).toEqual(take(1));
    expect(take(1)).not.toEqual(take(2));
    expect(hashString("fixture:mixed")).not.toBe(hashString("fixture:vec3"));
  });

  it("MTEK_TEST_SEED overrides the default and is validated", () => {
    expect(resolveSeed({})).toBe(DEFAULT_SEED);
    expect(resolveSeed({ MTEK_TEST_SEED: "" })).toBe(DEFAULT_SEED);
    expect(resolveSeed({ MTEK_TEST_SEED: "42" })).toBe(42);
    expect(resolveSeed({ MTEK_TEST_SEED: "0xff" })).toBe(255);
    expect(() => resolveSeed({ MTEK_TEST_SEED: "-1" })).toThrow(/MTEK_TEST_SEED/);
    expect(() => resolveSeed({ MTEK_TEST_SEED: "abc" })).toThrow(/MTEK_TEST_SEED/);
  });

  it("the same seed gives the same sample and f32 values are distinct finite normals", () => {
    const record = golden("builtin_frame");
    const sample = (seed: number) => sampleValue(record, createRng(seed), "random", 0);
    expect(encodeBlock(record, sample(7))).toEqual(encodeBlock(record, sample(7)));
    expect(encodeBlock(record, sample(7))).not.toEqual(encodeBlock(record, sample(8)));

    const bits = new Set<number>();
    let count = 0;
    const visit = (value: CpuValue, node: LayoutNode): void => {
      if (node.kind === "scalar" && node.scalar === "f32") {
        count++;
        bits.add(f32Bits(value as number));
      }
      if (node.kind === "matrix") {
        for (const entry of value as Float32Array) {
          count++;
          bits.add(f32Bits(entry));
        }
      }
    };
    // Walk the whole frame sample with the record's own shape.
    const walk = (value: CpuValue, node: LayoutNode): void => {
      visit(value, node);
      if (node.kind === "vector") {
        for (const entry of Object.values(value as Record<string, number>)) {
          count++;
          bits.add(f32Bits(entry));
        }
      } else if (node.kind === "struct") {
        for (const member of node.members) {
          walk((value as Record<string, CpuValue>)[member.name] as CpuValue, member.node);
        }
      } else if (node.kind === "array") {
        for (const entry of value as CpuValue[]) walk(entry, node.element);
      }
    };
    walk(sample(7), record.root);
    expect(count).toBeGreaterThan(40);
    expect(bits.size).toBe(count);
    for (const pattern of bits) {
      const exponent = (pattern >>> 23) & 0xff;
      expect(exponent).toBeGreaterThan(0);
      expect(exponent).toBeLessThan(255);
    }
  });

  it("covers both booleans and the full integer range across trials", () => {
    const record = golden("mixed");
    const seen = new Set<unknown>();
    let negativeInt = false;
    for (let trial = 0; trial < 4; trial++) {
      const value = sampleValue(record, createRng(trial + 1), "random", trial) as Record<
        string,
        CpuValue
      >;
      seen.add(value["e"]);
      if ((value["c"] as number) > 0x7fffffff) negativeInt = true;
    }
    expect(seen).toEqual(new Set([true, false]));
    expect(negativeInt).toBe(true);
    const edge = sampleValue(record, createRng(1), "edge", 0) as Record<string, CpuValue>;
    expect(edge["c"]).toBe(0xffffffff);
  });
});

describe("the comparison catches broken writers", () => {
  const record = golden("mixed");
  const value = sampleValue(record, createRng(99), "random", 1); // trial 1: `e` is true
  const expected = encodeBlock(record, value);

  interface Mixed {
    a: number;
    b: { x: number; y: number; z: number };
    c: number;
    d: { x: number; y: number };
    e: boolean;
    f: { r: number; g: number; b: number; a: number };
  }

  /** A correct hand-written writer for the mixed record, the baseline for the mutations. */
  const good = (m: ReturnType<typeof makeViews>, base: number, v: CpuValue): void => {
    const w = base >>> 2;
    const s = v as unknown as Mixed;
    m.f32[w] = s.a;
    m.f32[w + 4] = s.b.x;
    m.f32[w + 5] = s.b.y;
    m.f32[w + 6] = s.b.z;
    m.u32[w + 7] = s.c;
    m.f32[w + 8] = s.d.x;
    m.f32[w + 9] = s.d.y;
    m.u32[w + 10] = s.e ? 1 : 0;
    m.f32[w + 12] = s.f.r;
    m.f32[w + 13] = s.f.g;
    m.f32[w + 14] = s.f.b;
    m.f32[w + 15] = s.f.a;
  };

  const run = (writer: typeof good): Uint8Array => {
    const buffer = new ArrayBuffer(record.size);
    writer(makeViews(buffer), 0, value);
    return new Uint8Array(buffer);
  };

  it("accepts a correct hand-written writer", () => {
    const bytes = run(good);
    expect(firstDifference(expected, bytes)).toBeNull();
    expect(dirtyPadding(record, bytes)).toEqual([]);
  });

  it("flags a writer that dirties padding", () => {
    const bytes = run((m, base, v) => {
      good(m, base, v);
      m.u32[1] = 1; // byte 4 is padding
    });
    expect(firstDifference(expected, bytes)).toBe(
      `byte 4: got 0x01, expected 0x00`,
    );
    expect(dirtyPadding(record, bytes)).toEqual([4]);
  });

  it("flags a writer that uses the wrong offset or the wrong view", () => {
    expect(
      firstDifference(
        expected,
        run((m, base, v) => {
          good(m, base, v);
          m.f32[7] = (v as unknown as Mixed).a;
        }),
      ),
    ).not.toBeNull();
    expect(
      firstDifference(
        expected,
        run((m, base, v) => {
          good(m, base, v);
          m.f32[10] = (v as unknown as Mixed).e ? 1 : 0; // right slot, wrong view
        }),
      ),
    ).not.toBeNull();
  });
});
