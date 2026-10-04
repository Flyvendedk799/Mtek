// Values of the CPU conformance table `tests/semantics/numeric/cpu.json` (format: decision 0037 item
// 10) as 32-bit words, and the binary32 helpers the GPU comparison needs (task M2-08, decision 0043).
// Shared by the probe generator (Node), the probe page (browser) and the comparison (Node): no Node
// imports here.

/** A JSON value as `JSON.parse` returns it. */
export type Json = number | string | boolean | null | Json[] | { [key: string]: Json };

/** The Mtek types a table value can have. */
export type ValueType = "f32" | "i32" | "u32" | "bool" | "vec2" | "vec3" | "vec4" | "quat" | "color" | "mat4";

export const VALUE_TYPES: readonly ValueType[] = ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "quat", "color", "mat4"];

/** A typed table value as written in the table: `{"f32": 1.5}`, `{"vec3": [1, 2, 3]}`. */
export type RawTyped = Readonly<Record<string, Json>>;

/** One case of the CPU table. */
export interface TableCase {
  readonly id: string;
  readonly fn: string;
  readonly args: readonly RawTyped[];
  readonly expect: RawTyped;
  readonly portable: boolean;
  readonly note?: string;
}

export interface CpuTable {
  readonly format: string;
  readonly cases: readonly TableCase[];
}

/** A decoded value: its type and its components (one number per 32-bit word; `bool` is 0 or 1). */
export interface Typed {
  readonly type: ValueType;
  /** `f32` components as numbers (`-0`, `NaN`, `±Infinity` included); integers as numbers. */
  readonly components: readonly number[];
}

/** Number of 32-bit words (components) of a value of `type`. */
export function componentCount(type: ValueType): number {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
    case "bool":
      return 1;
    case "vec2":
      return 2;
    case "vec3":
      return 3;
    case "vec4":
    case "quat":
    case "color":
      return 4;
    case "mat4":
      return 16;
  }
}

/** True when the components of `type` are `f32`. */
export function isFloatType(type: ValueType): boolean {
  return type !== "i32" && type !== "u32" && type !== "bool";
}

export function isIntegerType(type: ValueType): boolean {
  return type === "i32" || type === "u32";
}

function isValueType(tag: string): tag is ValueType {
  return (VALUE_TYPES as readonly string[]).includes(tag);
}

/** Decodes one `f32` table number (`"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` or an exact binary32 number). */
export function decodeF32(raw: Json, where: string): number {
  if (raw === "NaN") return NaN;
  if (raw === "Infinity") return Infinity;
  if (raw === "-Infinity") return -Infinity;
  if (raw === "-0") return -0;
  if (typeof raw !== "number") throw new Error(`${where}: bad f32 ${JSON.stringify(raw)}`);
  if (Math.fround(raw) !== raw) throw new Error(`${where}: ${raw} is not a binary32 value`);
  return raw;
}

function decodeInteger(raw: Json, type: "i32" | "u32", where: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error(`${where}: bad ${type} ${JSON.stringify(raw)}`);
  const [min, max] = type === "i32" ? [-2147483648, 2147483647] : [0, 4294967295];
  if (raw < min || raw > max) throw new Error(`${where}: ${raw} is out of range for ${type}`);
  return raw;
}

/** Decodes a typed table value. */
export function decodeTyped(raw: RawTyped, where: string): Typed {
  const tags = Object.keys(raw);
  const tag = tags[0];
  if (tags.length !== 1 || tag === undefined || !isValueType(tag)) {
    throw new Error(`${where}: not a typed value: ${JSON.stringify(raw)}`);
  }
  const value = raw[tag] ?? null;
  switch (tag) {
    case "f32":
      return { type: tag, components: [decodeF32(value, where)] };
    case "i32":
    case "u32":
      return { type: tag, components: [decodeInteger(value, tag, where)] };
    case "bool":
      if (typeof value !== "boolean") throw new Error(`${where}: bad bool ${JSON.stringify(value)}`);
      return { type: tag, components: [value ? 1 : 0] };
    default: {
      if (!Array.isArray(value) || value.length !== componentCount(tag)) {
        throw new Error(`${where}: ${tag} needs ${componentCount(tag)} components: ${JSON.stringify(value)}`);
      }
      return { type: tag, components: value.map((component, index) => decodeF32(component, `${where}[${index}]`)) };
    }
  }
}

const scratch = new DataView(new ArrayBuffer(4));

/** The binary32 bit pattern of `value` (which must be a binary32 value, or NaN). */
export function f32Bits(value: number): number {
  scratch.setFloat32(0, value, true);
  return scratch.getUint32(0, true);
}

/** The binary32 value of a bit pattern. */
export function bitsF32(bits: number): number {
  scratch.setUint32(0, bits >>> 0, true);
  return scratch.getFloat32(0, true);
}

/** The 32-bit word of one component of a value of `type`. */
export function componentWord(type: ValueType, component: number): number {
  if (isFloatType(type)) return f32Bits(component);
  if (type === "i32") return component >>> 0;
  return component >>> 0;
}

/** The component a word stands for in a value of `type` (inverse of `componentWord`). */
export function wordComponent(type: ValueType, word: number): number {
  if (isFloatType(type)) return bitsF32(word);
  if (type === "i32") return word | 0;
  return word >>> 0;
}

/** The words of a value, in component order (`mat4` column-major). */
export function typedWords(value: Typed): number[] {
  return value.components.map((component) => componentWord(value.type, component));
}

/** The type tags of a case's arguments. */
export function argTypes(row: TableCase): ValueType[] {
  return row.args.map((arg, index) => decodeTyped(arg, `${row.id} argument ${index}`).type);
}

/** Parses and checks the CPU table text. */
export function parseCpuTable(text: string): CpuTable {
  const table = JSON.parse(text) as CpuTable;
  if (table.format !== "mtek-numeric-cpu/1") throw new Error(`cpu.json: unexpected format ${JSON.stringify(table.format)}`);
  const ids = new Set<string>();
  for (const row of table.cases) {
    if (ids.has(row.id)) throw new Error(`cpu.json: duplicate id ${row.id}`);
    ids.add(row.id);
    row.args.forEach((arg, index) => decodeTyped(arg, `${row.id} argument ${index}`));
    decodeTyped(row.expect, `${row.id} expect`);
  }
  return table;
}

// --- binary32 arithmetic on binary64 numbers -------------------------------------------------------

/** The largest finite binary32 value. */
export const F32_MAX = 3.4028234663852886e38;
/** The smallest positive normal binary32 value, 2^-126. */
export const F32_MIN_NORMAL = 1.1754943508222875e-38;
/** The smallest positive subnormal binary32 value, 2^-149. */
export const F32_MIN_SUBNORMAL = 1.401298464324817e-45;

/** True when `value` is a binary32 value (finite or infinite; not NaN). */
export function isF32(value: number): boolean {
  return !Number.isNaN(value) && Math.fround(value) === value;
}

/** True when `value` is a non-zero binary32 subnormal (or a real number in the subnormal range). */
export function isSubnormal(value: number): boolean {
  return value !== 0 && Math.abs(value) < F32_MIN_NORMAL;
}

/** The next binary32 value above `value` (a binary32 value). */
export function nextF32Up(value: number): number {
  if (Number.isNaN(value) || value === Infinity) return value;
  if (value === 0) return F32_MIN_SUBNORMAL;
  const bits = f32Bits(value);
  return bitsF32(value > 0 ? bits + 1 : bits - 1);
}

/** The next binary32 value below `value` (a binary32 value). */
export function nextF32Down(value: number): number {
  return -nextF32Up(-value);
}

/** The largest binary32 value `<= x` (round toward negative infinity). */
export function roundDownF32(x: number): number {
  if (Number.isNaN(x)) return x;
  const nearest = Math.fround(x);
  return nearest <= x ? nearest : nextF32Down(nearest);
}

/** The smallest binary32 value `>= x` (round toward positive infinity). */
export function roundUpF32(x: number): number {
  if (Number.isNaN(x)) return x;
  const nearest = Math.fround(x);
  return nearest >= x ? nearest : nextF32Up(nearest);
}

/**
 * ULP(x) for binary32 as WGSL 15.7.4 defines it [S5]: the minimum distance between two non-equal
 * finite binary32 values a <= x <= b; outside the finite range, the distance between the largest
 * and second-largest finite values.
 */
export function ulpF32(x: number): number {
  const magnitude = Math.abs(x);
  if (!Number.isFinite(magnitude) || magnitude > F32_MAX) return F32_MAX - nextF32Down(F32_MAX);
  const below = roundDownF32(magnitude);
  const above = roundUpF32(magnitude);
  if (below !== above) return above - below;
  // `magnitude` is a binary32 value: the smaller of the gaps on either side.
  const up = magnitude === F32_MAX ? Infinity : nextF32Up(magnitude) - magnitude;
  const down = magnitude === 0 ? Infinity : magnitude - nextF32Down(magnitude);
  return Math.min(up, down, magnitude === 0 ? F32_MIN_SUBNORMAL : Infinity);
}

/**
 * The distance between two binary32 values in units of representable values (the number of
 * binary32 values strictly between them, plus one); `+0` and `-0` are the same point.
 */
export function f32Steps(a: number, b: number): number {
  const ordinal = (value: number): number => {
    const bits = f32Bits(value);
    return bits >= 0x80000000 ? -(bits - 0x80000000) : bits;
  };
  return Math.abs(ordinal(a) - ordinal(b));
}
