/**
 * The CPU numeric conformance table `tests/semantics/numeric/cpu.json` (`spec/testing.md` 5, row
 * format in decision 0037) run against `rt`: every row is asserted **bit for bit** (a NaN
 * expectation accepts any NaN; `-0` and `+0` differ). The expected values are recomputed by an
 * independent Rust oracle in `crates/mtek-compiler/tests/numeric_cpu_table.rs`, so a row passing
 * here and there means JavaScript and Rust agree exactly.
 *
 * Each row is looked up in `RT_OPERATIONS` by callee and concrete signature, so the table also
 * tests the operation index the emitter uses. Scalar operators and comparisons are additionally
 * evaluated with the inline JavaScript patterns the emitter may emit instead of a helper call.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RT_OPERATIONS, signature, type NumericType } from "./operations.js";
import * as rt from "./rt.js";

type Json = number | string | boolean | null | Json[] | { [key: string]: Json };

interface Row {
  readonly id: string;
  readonly fn: string;
  readonly args: readonly Record<string, Json>[];
  readonly expect: Record<string, Json>;
  readonly portable: boolean;
  readonly note?: string;
}

interface Table {
  readonly format: string;
  readonly cases: readonly Row[];
}

/** A decoded value: its Mtek type and its JavaScript representation (`spec/runtime-abi.md` 4.1). */
interface Typed {
  readonly type: NumericType;
  readonly value: unknown;
}

const TABLE_PATH = fileURLToPath(new URL("../../../../tests/semantics/numeric/cpu.json", import.meta.url));
const table = JSON.parse(readFileSync(TABLE_PATH, "utf8")) as Table;

function decodeF32(raw: Json, context: string): number {
  if (raw === "NaN") return NaN;
  if (raw === "Infinity") return Infinity;
  if (raw === "-Infinity") return -Infinity;
  if (raw === "-0") return -0;
  if (typeof raw !== "number") throw new Error(`${context}: bad f32 ${JSON.stringify(raw)}`);
  if (Math.fround(raw) !== raw) throw new Error(`${context}: ${raw} is not a binary32 value`);
  return raw;
}

const KEYS: Readonly<Record<string, readonly string[]>> = {
  vec2: ["x", "y"],
  vec3: ["x", "y", "z"],
  vec4: ["x", "y", "z", "w"],
  quat: ["x", "y", "z", "w"],
  color: ["r", "g", "b", "a"],
};

function decode(raw: Record<string, Json>, context: string): Typed {
  const entries = Object.entries(raw);
  if (entries.length !== 1) throw new Error(`${context}: a typed value has one key`);
  const [type, inner] = entries[0] as [string, Json];
  switch (type) {
    case "bool":
      return { type, value: inner };
    case "i32":
    case "u32":
      return { type, value: inner };
    case "f32":
      return { type, value: decodeF32(inner, context) };
    case "mat4":
      return { type, value: new Float32Array((inner as Json[]).map((v) => decodeF32(v, context))) };
    default: {
      const keys = KEYS[type];
      if (keys === undefined) throw new Error(`${context}: unknown type ${type}`);
      const items = (inner as Json[]).map((v) => decodeF32(v, context));
      return { type: type as NumericType, value: Object.fromEntries(keys.map((k, i) => [k, items[i]])) };
    }
  }
}

/** Every number of a value with a label, in a fixed order. */
function components(t: Typed): [string, number | boolean][] {
  if (typeof t.value === "number" || typeof t.value === "boolean") return [["value", t.value]];
  if (t.value instanceof Float32Array) return [...t.value].map((v, i) => [`[${i}]`, v]);
  return Object.entries(t.value as Record<string, number>);
}

/** Bit-exact comparison of an actual result with the expected typed value; returns problems. */
function mismatches(actual: unknown, expected: Typed): string[] {
  const problems: string[] = [];
  const wanted = components(expected);
  let got: [string, unknown][];
  if (expected.type === "mat4") {
    if (!(actual instanceof Float32Array) || actual.length !== 16) return [`expected a Float32Array(16), got ${String(actual)}`];
    got = [...actual].map((v, i) => [`[${i}]`, v]);
  } else if (typeof actual === "object" && actual !== null) {
    got = Object.entries(actual);
    const keys = got.map(([k]) => k).join(",");
    if (keys !== wanted.map(([k]) => k).join(",")) problems.push(`keys ${keys}`);
  } else {
    got = [["value", actual]];
  }
  wanted.forEach(([key, want], i) => {
    const value = got[i]?.[1];
    const ok = typeof want === "number" && Number.isNaN(want) ? typeof value === "number" && Number.isNaN(value) : Object.is(value, want);
    if (!ok) problems.push(`${key}: got ${Object.is(value, -0) ? "-0" : String(value)}, expected ${Object.is(want, -0) ? "-0" : String(want)}`);
    // The representation invariants of spec/runtime-abi.md 4.1.
    if (typeof value === "number") {
      if (expected.type === "i32" && (value | 0) !== value) problems.push(`${key}: ${value} is not an i32`);
      if (expected.type === "u32" && value >>> 0 !== value) problems.push(`${key}: ${value} is not a u32`);
      if (expected.type !== "i32" && expected.type !== "u32" && !Number.isNaN(value) && Math.fround(value) !== value) {
        problems.push(`${key}: ${value} is not a binary32 value`);
      }
    }
  });
  return problems;
}

const helpers = rt as unknown as Readonly<Record<string, (...args: unknown[]) => unknown>>;

type Inline = (a: number, b: number) => number | boolean;

/** The inline JavaScript an emitter may write for scalar operators (`spec/compiler-architecture.md` 6). */
const INLINE: Readonly<Record<string, Readonly<Record<string, Inline>>>> = {
  f32: {
    "+": (a, b) => Math.fround(a + b),
    "-": (a, b) => Math.fround(a - b),
    "*": (a, b) => Math.fround(a * b),
    "/": (a, b) => Math.fround(a / b),
  },
  i32: { "+": (a, b) => (a + b) | 0, "-": (a, b) => (a - b) | 0, "*": (a, b) => Math.imul(a, b) },
  u32: { "+": (a, b) => (a + b) >>> 0, "-": (a, b) => (a - b) >>> 0, "*": (a, b) => Math.imul(a, b) >>> 0 },
};

const COMPARISONS: Readonly<Record<string, Inline>> = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

function run(row: Row): { result: unknown; inline?: unknown } {
  const args = row.args.map((a, i) => decode(a, `${row.id} arg ${i}`));
  const values = args.map((a) => a.value);
  const comparison = COMPARISONS[row.fn];
  if (comparison !== undefined) return { result: comparison(values[0] as number, values[1] as number) };
  const expected = decode(row.expect, `${row.id} expect`);
  const sig = signature(
    args.map((a) => a.type),
    expected.type,
  );
  const helper = RT_OPERATIONS[row.fn]?.[sig];
  if (helper === undefined) throw new Error(`${row.id}: no rt helper for ${row.fn} ${sig}`);
  const fn = helpers[helper];
  if (typeof fn !== "function") throw new Error(`${row.id}: rt.${helper} is missing`);
  const before = JSON.stringify(values.map((v) => (v instanceof Float32Array ? [...v] : v)));
  const result = fn(...values);
  const after = JSON.stringify(values.map((v) => (v instanceof Float32Array ? [...v] : v)));
  if (before !== after) throw new Error(`${row.id}: rt.${helper} modified its arguments`);
  const inline = INLINE[expected.type]?.[row.fn];
  return inline === undefined || args.length !== 2 ? { result } : { result, inline: inline(values[0] as number, values[1] as number) };
}

describe("tests/semantics/numeric/cpu.json", () => {
  it("is a well-formed table of the documented format", () => {
    expect(table.format).toBe("mtek-numeric-cpu/1");
    expect(table.cases.length).toBeGreaterThan(600);
    expect(new Set(table.cases.map((c) => c.id)).size).toBe(table.cases.length);
    for (const row of table.cases) {
      // Non-finite inputs or results are never portable (spec/testing.md 5).
      const values = [...row.args, row.expect].map((v, i) => decode(v, `${row.id} ${i}`));
      const finite = values.flatMap(components).every(([, v]) => typeof v !== "number" || Number.isFinite(v));
      if (!finite) expect(row.portable, `${row.id} has non-finite values`).toBe(false);
    }
  });

  it("every row holds bit for bit against rt", () => {
    const failures: string[] = [];
    for (const row of table.cases) {
      const expected = decode(row.expect, `${row.id} expect`);
      const { result, inline } = run(row);
      const problems = mismatches(result, expected);
      if (inline !== undefined) problems.push(...mismatches(inline, expected).map((p) => `inline: ${p}`));
      if (problems.length > 0) failures.push(`${row.id} ${row.fn}: ${problems.join("; ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("covers every rt operation of a numeric callee", () => {
    const covered = new Set<string>();
    for (const row of table.cases) {
      if (COMPARISONS[row.fn] !== undefined) continue;
      const args = row.args.map((a, i) => decode(a, `${row.id} ${i}`).type);
      const result = decode(row.expect, row.id).type;
      covered.add(`${row.fn} ${signature(args, result)}`);
    }
    const missing = Object.entries(RT_OPERATIONS).flatMap(([callee, entries]) =>
      Object.keys(entries)
        .map((sig) => `${callee} ${sig}`)
        .filter((key) => !covered.has(key)),
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property tests: + - * / are Math.fround of the binary64 operation, and that is correct rounding.

function fromBits(b: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, b >>> 0);
  return view.getFloat32(0);
}

function toBits(x: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, x);
  return view.getUint32(0);
}

/** A deterministic stream of binary32 values of every class (normal, subnormal, zero, inf, NaN). */
function* randomF32(count: number, seed: number): Generator<number> {
  let s = seed >>> 0;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  for (let i = 0; i < count; i++) {
    const r = next();
    // A quarter of the values come from a narrow exponent range, so sums are often exact in binary64.
    yield i % 4 === 0 ? fromBits((r & 0x807fffff) | 0x3f000000) : fromBits(r);
  }
}

/** Whether `r` is the binary32 value nearest the exactly representable binary64 value `exact`, ties to even. */
function isCorrectlyRounded(exact: number, r: number): boolean {
  if (!Number.isFinite(r) || r === 0) return Math.fround(exact) === r || (Number.isNaN(exact) && Number.isNaN(r));
  const bits = toBits(r);
  const up = fromBits(r > 0 ? bits + 1 : bits - 1);
  const down = fromBits(r > 0 ? bits - 1 : bits + 1);
  const err = Math.abs(exact - r);
  if (err > Math.abs(exact - up) || err > Math.abs(exact - down)) return false;
  // On a tie the even significand wins.
  if (err === Math.abs(exact - up) || err === Math.abs(exact - down)) return (bits & 1) === 0;
  return true;
}

describe("f32 arithmetic properties", () => {
  const ops: [string, (a: number, b: number) => number, (a: number, b: number) => number][] = [
    ["+", rt.fadd, (a, b) => a + b],
    ["-", rt.fsub, (a, b) => a - b],
    ["*", rt.fmul, (a, b) => a * b],
    ["/", rt.fdiv, (a, b) => a / b],
  ];

  for (const [symbol, helper, f64] of ops) {
    it(`${symbol} equals Math.fround of the binary64 operation (vector forms too)`, () => {
      const xs = [...randomF32(20000, 0x9e3779b9 ^ symbol.charCodeAt(0))];
      const ys = [...randomF32(20000, 0x7f4a7c15 ^ symbol.charCodeAt(0))];
      for (let i = 0; i < xs.length; i++) {
        const a = xs[i] as number;
        const b = ys[i] as number;
        const want = Math.fround(f64(a, b));
        const got = helper(a, b);
        if (!(Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want)))) {
          expect.fail(`${a} ${symbol} ${b}: ${got} vs ${want}`);
        }
      }
      const v = rt.v3(xs[0] as number, xs[1] as number, xs[2] as number);
      const w = rt.v3(ys[0] as number, ys[1] as number, ys[2] as number);
      const vector = { "+": rt.v3add, "-": rt.v3sub, "*": rt.v3mul, "/": rt.v3div }[symbol];
      const out = vector?.(v, w);
      expect(out?.y).toEqual(helper(v.y, w.y));
    });
  }

  it("+, - and * are correctly rounded whenever binary64 holds the exact result", () => {
    const xs = [...randomF32(20000, 12345)];
    const ys = [...randomF32(20000, 67890)];
    let checked = 0;
    for (let i = 0; i < xs.length; i++) {
      const a = xs[i] as number;
      const b = ys[i] as number;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      // The product of two binary32 values always fits binary64 exactly (48 significant bits).
      const product = a * b;
      if (Math.abs(product) >= 2 ** -1022 || product === 0) {
        expect(isCorrectlyRounded(product, rt.fmul(a, b)), `${a} * ${b}`).toBe(true);
        checked++;
      }
      // A sum is exact in binary64 when the exponents are close: a + b - a recovers b exactly.
      const sum = a + b;
      if (Number.isFinite(sum) && sum - a === b && sum - b === a) {
        expect(isCorrectlyRounded(sum, rt.fadd(a, b)), `${a} + ${b}`).toBe(true);
        expect(isCorrectlyRounded(a - b, rt.fsub(a, b)), `${a} - ${b}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
  });
});
