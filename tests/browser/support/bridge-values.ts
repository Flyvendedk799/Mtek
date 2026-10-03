// The Node-side oracle of the bridge tests: sample values for a layout record, the 32-bit words
// the GPU probe must read back for them (computed from the JS values alone, in leaf order, never
// from the generated writers), the JSON transport into the page and the CPU sRGB encoding of the
// rendered-colour test. Free of Node and DOM APIs.
import {
  type LayoutNode,
  type LayoutRecord,
  type ScalarKind,
  componentNames,
  elementType,
} from "./bridge-layout.ts";

/**
 * The CPU value representation of `spec/runtime-abi.md` section 4.1: numbers for `f32`/`i32`/`u32`,
 * booleans for `bool`, objects with numeric components for vectors, colours and quaternions, a
 * 16-element column-major `Float32Array` for `mat4`, plain objects for structs and arrays for arrays.
 */
export type CpuValue =
  | number
  | boolean
  | Float32Array
  | readonly CpuValue[]
  | { readonly [name: string]: CpuValue };

/** A value after transport through JSON: a `Float32Array` becomes a plain number array. */
export type JsonValue = number | boolean | readonly JsonValue[] | { readonly [name: string]: JsonValue };

// ---------------------------------------------------------------------------------------------
// Bit patterns

const scratch = new ArrayBuffer(4);
const scratchF32 = new Float32Array(scratch);
const scratchU32 = new Uint32Array(scratch);
const scratchI32 = new Int32Array(scratch);

/** The IEEE-754 binary32 bit pattern of `value` (rounded to binary32 first), as an unsigned integer. */
export function f32Bits(value: number): number {
  scratchF32[0] = value;
  return scratchU32[0] ?? 0;
}

function f32FromBits(bits: number): number {
  scratchU32[0] = bits >>> 0;
  return scratchF32[0] ?? 0;
}

/** The two's complement bit pattern of an `i32`, as an unsigned integer. */
function i32Bits(value: number): number {
  scratchI32[0] = value;
  return scratchU32[0] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Value access

function expectNumber(value: CpuValue | undefined, where: string): number {
  if (typeof value !== "number") throw new Error(`${where}: expected a number`);
  return value;
}

function expectBoolean(value: CpuValue | undefined, where: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${where}: expected a boolean`);
  return value;
}

function property(value: CpuValue | undefined, name: string, where: string): CpuValue {
  if (typeof value !== "object" || Array.isArray(value) || value instanceof Float32Array) {
    throw new Error(`${where}: expected an object holding \`${name}\``);
  }
  const found = (value as { readonly [key: string]: CpuValue | undefined })[name];
  if (found === undefined) throw new Error(`${where}: missing \`${name}\``);
  return found;
}

function element(value: CpuValue | undefined, index: number, where: string): CpuValue {
  if (value instanceof Float32Array) {
    const entry = value[index];
    if (entry === undefined) throw new Error(`${where}: index ${index} out of range`);
    return entry;
  }
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  const entry = (value as readonly CpuValue[])[index];
  if (entry === undefined) throw new Error(`${where}: index ${index} out of range`);
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Expected words

/** One leaf of a block value: its path (as the probe names it), scalar kind and expected word. */
export interface ExpectedLeaf {
  readonly path: string;
  readonly kind: ScalarKind;
  readonly word: number;
}

const AXES = ["x", "y", "z", "w"] as const;

function child(parent: string, name: string): string {
  return parent === "" ? name : `${parent}.${name}`;
}

function scalarWord(kind: ScalarKind, value: CpuValue | undefined, where: string): number {
  switch (kind) {
    case "f32":
      return f32Bits(expectNumber(value, where));
    case "i32":
      return i32Bits(expectNumber(value, where));
    case "u32":
      return expectNumber(value, where) >>> 0;
    case "bool32":
      return expectBoolean(value, where) ? 1 : 0;
  }
}

function walk(
  node: LayoutNode,
  mtekType: string,
  value: CpuValue | undefined,
  path: string,
  out: ExpectedLeaf[],
): void {
  const where = path === "" ? "(block)" : path;
  switch (node.kind) {
    case "scalar":
      out.push({ path, kind: node.scalar, word: scalarWord(node.scalar, value, where) });
      return;
    case "vector": {
      const names = componentNames(mtekType, node.components);
      names.forEach((name, index) => {
        const axis = AXES[index] ?? "x";
        out.push({
          path: child(path, axis),
          kind: node.scalar,
          word: scalarWord(node.scalar, property(value, name, where), `${where}.${name}`),
        });
      });
      return;
    }
    case "matrix":
      // Column-major: entry `column * rows + row`, leaves run columns then rows.
      for (let column = 0; column < node.columns; column++) {
        for (let row = 0; row < node.rows; row++) {
          const at = `${path}[${column}].${AXES[row] ?? "x"}`;
          out.push({
            path: at,
            kind: "f32",
            word: f32Bits(expectNumber(element(value, column * node.rows + row, at), at)),
          });
        }
      }
      return;
    case "struct":
      for (const member of node.members) {
        walk(
          member.node,
          member.mtekType,
          property(value, member.name, where),
          child(path, member.name),
          out,
        );
      }
      return;
    case "array": {
      const inner = elementType(mtekType);
      for (let index = 0; index < node.length; index++) {
        walk(node.element, inner, element(value, index, where), `${path}[${index}]`, out);
      }
      return;
    }
  }
}

/**
 * Every 32-bit leaf of `value` in leaf order (declaration order, depth first, array elements in
 * index order, vector components `x y z w`, matrix columns then rows) with the word the GPU must
 * read for it. Throws when `value` does not have the shape of `record`.
 */
export function expectedLeaves(record: LayoutRecord, value: CpuValue): ExpectedLeaf[] {
  const out: ExpectedLeaf[] = [];
  walk(record.root, record.root.name, value, "", out);
  return out;
}

/** The probe's output words for `value`: the leaf words, zero-filled up to `width * 4` words. */
export function expectedWords(record: LayoutRecord, value: CpuValue, width: number): number[] {
  const words = expectedLeaves(record, value).map((leaf) => leaf.word);
  const total = width * 4;
  if (words.length > total) {
    throw new Error(`${record.id}: ${words.length} leaf words do not fit a target of ${width} pixels`);
  }
  while (words.length < total) words.push(0);
  return words;
}

// ---------------------------------------------------------------------------------------------
// Transport

/** The JSON form of a value: `Float32Array` becomes a number array, everything else is unchanged. */
export function toJson(value: CpuValue): JsonValue {
  if (value instanceof Float32Array) return Array.from(value);
  if (Array.isArray(value)) return (value as readonly CpuValue[]).map(toJson);
  if (typeof value === "object") {
    const object: Record<string, JsonValue> = {};
    for (const [name, entry] of Object.entries(value as { readonly [name: string]: CpuValue })) {
      object[name] = toJson(entry);
    }
    return object;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Sample values

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

/** FNV-1a hash of a string: derives a per-test seed so samples do not depend on test order. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export type SampleMode = "random" | "edge";

// Extreme f32 values (all normal): largest and smallest magnitudes, +-1, and 0.1f.
const EDGE_F32 = [0x7f7fffff, 0xff7fffff, 0x00800000, 0x80800000, 0x3f800000, 0xbf800000, 0x3dcccccd];
const EDGE_I32 = [-2147483648, 2147483647, -1, 1, 0, -2147483647];
const EDGE_U32 = [0xffffffff, 0, 0x80000000, 0x7fffffff, 1, 0x80000001];

/**
 * Random samples use finite normal f32 values (never zero, subnormal, infinite or NaN) whose bit
 * patterns are distinct within one value, so a swapped, dropped or duplicated field cannot go
 * unnoticed; i32 and u32 cover the full range and booleans alternate. Edge samples cycle through
 * the extreme values of each scalar kind instead.
 */
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
    if (this.mode === "edge") return f32FromBits(EDGE_F32[this.edgeF32++ % EDGE_F32.length] ?? 0);
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

// ---------------------------------------------------------------------------------------------
// sRGB

/**
 * The exact sRGB opto-electronic transfer function in `f64`: a linear value in `[0, 1]` (clamped)
 * to its encoded value in `[0, 1]`.
 */
export function srgbEncode(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/** The 8-bit channel value of a linear value stored in an `rgba8unorm-srgb` target. */
export function srgbEncode8(linear: number): number {
  return Math.round(srgbEncode(linear) * 255);
}
