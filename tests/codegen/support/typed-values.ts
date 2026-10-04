// Typed values of `exec.json` rows (spec/testing.md section 4.1, decision 0040): the notation of
// the CPU conformance table (decision 0037 item 10: `{"f32": x}`, `{"i32": n}`, `{"u32": n}`,
// `{"bool": b}`, `{"vec2" | "vec3" | "vec4" | "quat" | "color": [...]}`, `{"mat4": [16
// column-major]}`, an `f32` being an exact binary32 number or "NaN", "Infinity", "-Infinity", "-0")
// plus `{"array": [typed...]}` and `{"struct": {"field": typed, ...}}`. `decode` turns one into the
// CPU representation of spec/runtime-abi.md section 4.1; `compare` checks a result against one bit
// for bit (any NaN matches a NaN; `-0` and `0` differ), or within a tolerance in ulps of binary32
// or absolutely, and checks that every `f32` the generated code returned is a binary32 value.

/** An optional tolerance of a row: in binary32 ulps, absolute, or either. */
export interface Tolerance {
  readonly ulp?: number;
  readonly abs?: number;
}

const COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  vec2: ["x", "y"],
  vec3: ["x", "y", "z"],
  vec4: ["x", "y", "z", "w"],
  quat: ["x", "y", "z", "w"],
  color: ["r", "g", "b", "a"],
};

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;

/** `-0` printed as such. */
export function show(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (value instanceof Float32Array) return `Float32Array[${Array.from(value, show).join(", ")}]`;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Float32Array)
  );
}

/** The single `[tag, payload]` of a typed value. */
export function tagged(value: unknown, where: string): [string, unknown] {
  if (!isPlainObject(value)) throw new Error(`${where}: not a typed value: ${show(value)}`);
  const entries = Object.entries(value);
  const first = entries[0];
  if (entries.length !== 1 || first === undefined) {
    throw new Error(`${where}: a typed value has exactly one key: ${show(value)}`);
  }
  return first;
}

/**
 * The number of an `f32` payload. With `exact` (the default) it must already be a binary32 value;
 * otherwise (the expectation of a row with a tolerance, which may be the exact mathematical value)
 * it is rounded to the nearest one.
 */
export function f32Value(raw: unknown, where: string, exact = true): number {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (raw === "NaN") value = Number.NaN;
  else if (raw === "Infinity") value = Number.POSITIVE_INFINITY;
  else if (raw === "-Infinity") value = Number.NEGATIVE_INFINITY;
  else if (raw === "-0") value = -0;
  else throw new Error(`${where}: not an f32: ${show(raw)}`);
  if (!Number.isNaN(value) && Math.fround(value) !== value) {
    if (exact) throw new Error(`${where}: ${show(value)} is not a binary32 value`);
    value = Math.fround(value);
  }
  return value;
}

function list(raw: unknown, length: number | null, where: string): readonly unknown[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array`);
  const items = raw as readonly unknown[];
  if (length !== null && items.length !== length) {
    throw new Error(`${where}: expected ${length} elements, found ${items.length}`);
  }
  return items;
}

function integer(raw: unknown, min: number, max: number, where: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`${where}: not an integer in [${min}, ${max}]: ${show(raw)}`);
  }
  return raw;
}

/** The CPU representation of an argument: a typed value, or a plain JSON number or boolean. */
export function decode(value: unknown, where: string): unknown {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const [tag, raw] = tagged(value, where);
  switch (tag) {
    case "f32":
      return f32Value(raw, where);
    case "i32":
      return integer(raw, I32_MIN, I32_MAX, where);
    case "u32":
      return integer(raw, 0, U32_MAX, where);
    case "bool":
      if (typeof raw !== "boolean") throw new Error(`${where}: not a bool: ${show(raw)}`);
      return raw;
    case "mat4":
      return Float32Array.from(list(raw, 16, where), (v, i) => f32Value(v, `${where}[${i}]`));
    case "array":
      return list(raw, null, where).map((item, i) => decode(item, `${where}[${i}]`));
    case "struct":
      if (!isPlainObject(raw)) throw new Error(`${where}: a struct is an object of fields`);
      return Object.fromEntries(
        Object.entries(raw).map(([name, field]) => [name, decode(field, `${where}.${name}`)]),
      );
    default: {
      const names = COMPONENTS[tag];
      if (names === undefined) throw new Error(`${where}: unknown type tag '${tag}'`);
      const values = list(raw, names.length, where);
      return Object.fromEntries(
        names.map((name, i) => [name, f32Value(values[i], `${where}.${name}`)]),
      );
    }
  }
}

/** The position of a binary32 value on the number line in ulps (`+0` and `-0` are both 0). */
function ordinal(value: number): number {
  const bits = new Int32Array(new Float32Array([value]).buffer)[0] ?? 0;
  return bits < 0 ? I32_MIN - bits : bits;
}

/** The distance in binary32 ulps between two finite binary32 values. */
export function ulpDistance(a: number, b: number): number {
  return Math.abs(ordinal(a) - ordinal(b));
}

function compareF32(
  actual: unknown,
  raw: unknown,
  tolerance: Tolerance | undefined,
  where: string,
  out: string[],
): void {
  const expected = f32Value(raw, where, tolerance === undefined);
  if (typeof actual !== "number") {
    out.push(`${where}: got ${show(actual)}, expected the f32 ${show(expected)}`);
    return;
  }
  if (!Number.isNaN(actual) && Math.fround(actual) !== actual) {
    out.push(`${where}: ${show(actual)} is not a binary32 value (missing rounding)`);
    return;
  }
  if (Number.isNaN(expected) ? Number.isNaN(actual) : Object.is(actual, expected)) return;
  if (tolerance !== undefined && Number.isFinite(actual) && Number.isFinite(expected)) {
    if (tolerance.abs !== undefined && Math.abs(actual - expected) <= tolerance.abs) return;
    if (tolerance.ulp !== undefined && ulpDistance(actual, expected) <= tolerance.ulp) return;
  }
  const allowed = tolerance === undefined ? "" : ` (tolerance ${JSON.stringify(tolerance)})`;
  out.push(`${where}: got ${show(actual)}, expected ${show(expected)}${allowed}`);
}

function sameKeys(actual: Readonly<Record<string, unknown>>, names: readonly string[]): boolean {
  const keys = Object.keys(actual).sort();
  const wanted = [...names].sort();
  return keys.length === wanted.length && keys.every((key, i) => key === wanted[i]);
}

/** Every difference between `actual` and the typed `expected` value (empty when they agree). */
export function compare(
  actual: unknown,
  expected: unknown,
  tolerance: Tolerance | undefined,
  where = "result",
): string[] {
  const out: string[] = [];
  const [tag, raw] = tagged(expected, where);
  switch (tag) {
    case "f32":
      compareF32(actual, raw, tolerance, where, out);
      break;
    case "i32":
      if (!Object.is(actual, raw) || ((actual as number) | 0) !== actual) {
        out.push(`${where}: got ${show(actual)}, expected the i32 ${show(raw)}`);
      }
      break;
    case "u32":
      if (!Object.is(actual, raw) || (actual as number) >>> 0 !== actual) {
        out.push(`${where}: got ${show(actual)}, expected the u32 ${show(raw)}`);
      }
      break;
    case "bool":
      if (actual !== raw) out.push(`${where}: got ${show(actual)}, expected ${show(raw)}`);
      break;
    case "mat4": {
      const values = list(raw, 16, where);
      if (!(actual instanceof Float32Array) || actual.length !== 16) {
        out.push(`${where}: got ${show(actual)}, expected a Float32Array(16)`);
        break;
      }
      values.forEach((value, i) => compareF32(actual[i], value, tolerance, `${where}[${i}]`, out));
      break;
    }
    case "array": {
      const items = list(raw, null, where);
      if (!Array.isArray(actual) || actual.length !== items.length) {
        out.push(`${where}: got ${show(actual)}, expected an array of ${items.length}`);
        break;
      }
      const elements = actual as readonly unknown[];
      items.forEach((item, i) => out.push(...compare(elements[i], item, tolerance, `${where}[${i}]`)));
      break;
    }
    case "struct": {
      if (!isPlainObject(raw)) throw new Error(`${where}: a struct is an object of fields`);
      if (!isPlainObject(actual) || !sameKeys(actual, Object.keys(raw))) {
        out.push(`${where}: got ${show(actual)}, expected the fields ${Object.keys(raw).join(", ")}`);
        break;
      }
      for (const [name, field] of Object.entries(raw)) {
        out.push(...compare(actual[name], field, tolerance, `${where}.${name}`));
      }
      break;
    }
    default: {
      const names = COMPONENTS[tag];
      if (names === undefined) throw new Error(`${where}: unknown type tag '${tag}'`);
      const values = list(raw, names.length, where);
      if (!isPlainObject(actual) || !sameKeys(actual, names)) {
        out.push(`${where}: got ${show(actual)}, expected a ${tag} {${names.join(", ")}}`);
        break;
      }
      names.forEach((name, i) =>
        compareF32(actual[name], values[i], tolerance, `${where}.${name}`, out),
      );
    }
  }
  return out;
}
