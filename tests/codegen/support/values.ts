// Deterministic sample values for a layout record, from a seeded PRNG.
//
// Random samples use finite *normal* f32 values (never zero, subnormal, infinite or NaN) whose
// bit patterns are distinct within one sample, so a writer that swaps, drops or duplicates a
// field cannot go unnoticed; i32/u32 cover the full range and booleans take both values.
// Edge samples cycle through the extreme values of each scalar kind instead.
import type { CpuValue } from "./cpu-value.js";
import {
  type LayoutNode,
  type LayoutRecord,
  type ScalarKind,
  componentNames,
  elementType,
} from "./layout.js";

/** The seed used when `MTEK_TEST_SEED` is not set. */
export const DEFAULT_SEED = 0x4d54454b; // "MTEK"

/** The seed of this run: `MTEK_TEST_SEED` (decimal or 0x-prefixed hex) or the default. */
export function resolveSeed(environment: Readonly<Record<string, string | undefined>>): number {
  const text = environment["MTEK_TEST_SEED"];
  if (text === undefined || text.trim() === "") return DEFAULT_SEED;
  const parsed = Number(text.trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error(`MTEK_TEST_SEED must be an integer in 0..4294967295, got "${text}"`);
  }
  return parsed;
}

/** A source of 32-bit unsigned integers. */
export interface Rng {
  nextU32(): number;
}

/** mulberry32: small, fast and fully determined by its 32-bit seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextU32(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}

/** FNV-1a hash of a string: derives a per-fixture seed so samples do not depend on test order. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type SampleMode = "random" | "edge";

const scratch = new DataView(new ArrayBuffer(4));

function f32FromBits(bits: number): number {
  scratch.setUint32(0, bits >>> 0, true);
  return scratch.getFloat32(0, true);
}

export function f32Bits(value: number): number {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
}

// Extreme f32 values (all normal): largest and smallest magnitudes, +-1, and 0.1f.
const EDGE_F32 = [0x7f7fffff, 0xff7fffff, 0x00800000, 0x80800000, 0x3f800000, 0xbf800000, 0x3dcccccd];
const EDGE_I32 = [-2147483648, 2147483647, -1, 1, 0, -2147483647];
const EDGE_U32 = [0xffffffff, 0, 0x80000000, 0x7fffffff, 1, 0x80000001];

class Sampler {
  private readonly used = new Set<number>();
  private edgeF32 = 0;
  private edgeI32 = 0;
  private edgeU32 = 0;
  private flag: boolean;

  constructor(
    private readonly rng: Rng,
    private readonly mode: SampleMode,
    trial: number,
  ) {
    this.flag = trial % 2 === 1;
  }

  private f32(): number {
    if (this.mode === "edge") {
      const bits = EDGE_F32[this.edgeF32++ % EDGE_F32.length];
      return f32FromBits(bits ?? 0x3f800000);
    }
    for (;;) {
      const sign = this.rng.nextU32() & 1;
      const exponent = 1 + (this.rng.nextU32() % 254); // 1..254: finite and normal
      const mantissa = this.rng.nextU32() & 0x7fffff;
      const bits = ((sign << 31) | (exponent << 23) | mantissa) >>> 0;
      if (this.used.has(bits)) continue;
      this.used.add(bits);
      return f32FromBits(bits);
    }
  }

  private i32(): number {
    if (this.mode === "edge") return EDGE_I32[this.edgeI32++ % EDGE_I32.length] ?? 0;
    return this.rng.nextU32() | 0;
  }

  private u32(): number {
    if (this.mode === "edge") return EDGE_U32[this.edgeU32++ % EDGE_U32.length] ?? 0;
    return this.rng.nextU32() >>> 0;
  }

  private bool(): boolean {
    const value = this.flag;
    this.flag = !this.flag;
    return value;
  }

  private scalar(kind: ScalarKind): number | boolean {
    switch (kind) {
      case "f32":
        return this.f32();
      case "i32":
        return this.i32();
      case "u32":
        return this.u32();
      case "bool32":
        return this.bool();
    }
  }

  value(node: LayoutNode, mtekType: string): CpuValue {
    switch (node.kind) {
      case "scalar":
        return this.scalar(node.scalar);
      case "vector": {
        const vector: Record<string, CpuValue> = {};
        for (const name of componentNames(mtekType, node.components)) {
          vector[name] = this.scalar(node.scalar);
        }
        return vector;
      }
      case "matrix": {
        const matrix = new Float32Array(node.columns * node.rows);
        for (let index = 0; index < matrix.length; index++) matrix[index] = this.f32();
        return matrix;
      }
      case "struct": {
        const struct: Record<string, CpuValue> = {};
        for (const member of node.members) {
          struct[member.name] = this.value(member.node, member.mtekType);
        }
        return struct;
      }
      case "array": {
        const inner = elementType(mtekType);
        const list: CpuValue[] = [];
        for (let index = 0; index < node.length; index++) {
          list.push(this.value(node.element, inner));
        }
        return list;
      }
    }
  }
}

/**
 * A sample value for `record`. `trial` flips which boolean comes first, so consecutive trials
 * cover both values of every boolean leaf.
 */
export function sampleValue(
  record: LayoutRecord,
  rng: Rng,
  mode: SampleMode,
  trial: number,
): CpuValue {
  return new Sampler(rng, mode, trial).value(record.root, record.root.name);
}
