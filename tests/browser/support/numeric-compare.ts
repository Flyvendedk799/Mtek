// Compares GPU results of the numeric probe with the CPU table (task M2-08, decision 0043): bit-exact
// rows exactly (with the differences a quoted WGSL rule permits, each reported), tolerance rows
// against the interval `numeric-accuracy.ts` computes from tolerances.json. No Node imports: the
// probe page does not use it, but the unit tests and the spec do.
import {
  AccuracyEvaluator,
  OutsideAccuracyDomain,
  type ToleranceEntry,
  type Value,
} from "./numeric-accuracy.ts";
import {
  type TableCase,
  type Typed,
  type ValueType,
  decodeTyped,
  f32Bits,
  f32Steps,
  isFloatType,
  isIntegerType,
  isSubnormal,
  roundDownF32,
  roundUpF32,
  wordComponent,
} from "./numeric-values.ts";

/** How a row ended. */
export type RowStatus =
  /** Exact row: every word equal. */
  | "match"
  /** Exact row: differs only where a quoted WGSL rule permits it (`permissions`). */
  | "permitted"
  /** Tolerance row: every component inside the allowed interval. */
  | "within"
  /** A failing row listed in tolerances.json `knownDeviations` (a measured platform deviation, decision-recorded). */
  | "known-deviation"
  /** Exact row where WGSL specifies a different result than the CPU: the GPU equals the WGSL value. */
  | "spec-disagreement"
  /** Not compared: non-portable in cpu.json or outside the WGSL accuracy domain (`reason`). */
  | "not-compared"
  | "fail";

/** A WGSL rule that permits an exact row to differ (tolerances.json `rules`). */
export type Permission = "zero-sign" | "flush-to-zero" | "conversion-neighbour";

export interface ComponentResult {
  readonly cpu: number;
  readonly gpu: number;
  /** Allowed interval including the CPU rounding allowance (tolerance rows). */
  readonly lo?: number;
  readonly hi?: number;
  /** |gpu - cpu| for f32 components. */
  readonly absError?: number;
  /** Representable binary32 steps between gpu and cpu (f32 components). */
  readonly steps?: number;
}

export interface RowResult {
  readonly id: string;
  readonly fn: string;
  readonly key: string;
  readonly portable: boolean;
  readonly compare: "exact" | "tolerance";
  readonly status: RowStatus;
  readonly reason?: string;
  readonly permissions?: readonly Permission[];
  /** Tolerance rows: whether every component is inside the WGSL interval without the CPU allowance. */
  readonly withinWgslBound?: boolean;
  /** Set when the CPU expectation itself lies outside the interval (a CPU or tolerance defect). */
  readonly cpuOutside?: boolean;
  /** The value WGSL specifies where it differs from the CPU expectation (spec-disagreement rows). */
  readonly wgslExpect?: readonly number[];
  readonly components: readonly ComponentResult[];
}

const INTEGER_TYPES: ReadonlySet<ValueType> = new Set(["i32", "u32"]);

/** The tolerances.json key of a case: concrete signature, then argument class, then the bare callee. */
export function candidateKeys(row: TableCase): string[] {
  const types = row.args.map((arg, index) => decodeTyped(arg, `${row.id} argument ${index}`).type);
  const integer = types.length > 0 && types.every((type) => INTEGER_TYPES.has(type));
  return [`${row.fn} (${types.join(", ")})`, `${row.fn} (${integer ? "integer" : "float"})`, row.fn];
}

export function resolveEntry(row: TableCase, evaluator: AccuracyEvaluator): ToleranceEntry {
  for (const key of candidateKeys(row)) {
    const entry = evaluator.entry(key);
    if (entry !== undefined) return entry;
  }
  throw new Error(`${row.id}: no tolerances.json entry for ${candidateKeys(row).join(" / ")}`);
}

/** The shape of an argument value for the evaluator. */
function shapeOf(type: ValueType): Value["shape"] {
  if (type === "mat4") return "matrix";
  return type.startsWith("vec") || type === "quat" || type === "color" ? "vector" : "scalar";
}

export function argValues(row: TableCase): Value[] {
  return row.args.map((arg, index) => {
    const typed = decodeTyped(arg, `${row.id} argument ${index}`);
    return { shape: shapeOf(typed.type), comps: typed.components.map((c) => ({ lo: c, hi: c })) };
  });
}

/**
 * The result WGSL 15.7.6 specifies for converting a binary32 value to i32/u32: exactly representable
 * values unchanged, otherwise the value of the target type closest to trunc(x) that is also a binary32
 * value — so out-of-range inputs clamp to [-2^31, 2147483520] and [0, 4294967040].
 */
export function wgslFloatToInt(x: number, type: "i32" | "u32"): number {
  const [min, max] = type === "i32" ? [-2147483648, 2147483520] : [0, 4294967040];
  return Math.min(Math.max(Math.trunc(x), min), max);
}

function hasSubnormal(row: TableCase, expect: Typed): boolean {
  const floats = (typed: Typed): readonly number[] => (isFloatType(typed.type) ? typed.components : []);
  const args = row.args.map((arg, index) => decodeTyped(arg, `${row.id} argument ${index}`));
  return [...args.flatMap(floats), ...floats(expect)].some(isSubnormal);
}

function sameWord(type: ValueType, a: number, b: number): boolean {
  return isFloatType(type) ? f32Bits(a) === f32Bits(b) : a === b;
}

function floatMetrics(cpu: number, gpu: number): Pick<ComponentResult, "absError" | "steps"> {
  if (!Number.isFinite(cpu) || !Number.isFinite(gpu)) return {};
  return { absError: Math.abs(gpu - cpu), steps: f32Steps(gpu, cpu) };
}

/** Compares one case: `words` are the GPU's words for the result, in component order. */
/**
 * Compares one case: `words` are the GPU's words for the result, in component order. A GPU-side
 * failure of a case listed in tolerances.json `knownDeviations` is reported as `known-deviation` with
 * its decision; a CPU expectation outside its own interval always fails.
 */
export function compareRow(row: TableCase, words: readonly number[], evaluator: AccuracyEvaluator): RowResult {
  const result = compareRowAgainstBounds(row, words, evaluator);
  if (result.status !== "fail" || result.cpuOutside === true) return result;
  const known = evaluator.tolerances.knownDeviations.find((deviation) => deviation.id === row.id);
  if (known === undefined) return result;
  return { ...result, status: "known-deviation", reason: `${result.reason ?? ""}; known deviation (decision ${known.decision}): ${known.cause}` };
}

function compareRowAgainstBounds(row: TableCase, words: readonly number[], evaluator: AccuracyEvaluator): RowResult {
  const entry = resolveEntry(row, evaluator);
  const expect = decodeTyped(row.expect, `${row.id} expect`);
  const type = expect.type;
  const gpu = expect.components.map((_, index) => wordComponent(type, words[index] ?? 0));
  const base = { id: row.id, fn: row.fn, key: entry.key, portable: row.portable, compare: entry.compare } as const;
  const plain = (): ComponentResult[] =>
    expect.components.map((cpu, index) => {
      const value = gpu[index] ?? NaN;
      return { cpu, gpu: value, ...(isFloatType(type) ? floatMetrics(cpu, value) : {}) };
    });

  if (!row.portable) {
    return { ...base, status: "not-compared", reason: `non-portable in cpu.json${row.note === undefined ? "" : `: ${row.note}`}`, components: plain() };
  }

  if (entry.compare === "exact") {
    const components = plain();
    if (expect.components.every((cpu, index) => sameWord(type, cpu, gpu[index] ?? NaN))) {
      return { ...base, status: "match", components };
    }
    // f32 -> integer conversions WGSL clamps differently from the CPU (decision 0043).
    if (entry.accuracy.kind === "conversion" && isIntegerType(type)) {
      const x = argValues(row)[0]?.comps[0]?.lo ?? NaN;
      const wgsl = wgslFloatToInt(x, type === "i32" ? "i32" : "u32");
      if (wgsl !== expect.components[0]) {
        return {
          ...base,
          status: gpu[0] === wgsl ? "spec-disagreement" : "fail",
          reason: `WGSL 15.7.6 specifies ${wgsl}, the CPU ${String(expect.components[0])} (decision 0043)`,
          wgslExpect: [wgsl],
          components,
        };
      }
    }
    const permissions = new Set<Permission>();
    const allowed = permittedValues(row, entry, expect, evaluator);
    for (let index = 0; index < expect.components.length; index++) {
      const cpu = expect.components[index] ?? NaN;
      const value = gpu[index] ?? NaN;
      if (sameWord(type, cpu, value)) continue;
      const permission = isFloatType(type) ? permitted(cpu, value, allowed?.comps[index], entry, row) : undefined;
      if (permission === undefined) {
        return { ...base, status: "fail", reason: `component ${index}: GPU ${String(value)}, CPU ${String(cpu)}`, components };
      }
      permissions.add(permission);
    }
    return { ...base, status: "permitted", permissions: [...permissions].sort(), components };
  }

  let wide: Value;
  let narrow: Value;
  try {
    wide = evaluator.allowedWithCpuRounding(entry, argValues(row));
    narrow = evaluator.allowed(entry, argValues(row));
  } catch (error) {
    if (error instanceof OutsideAccuracyDomain) {
      return { ...base, status: "not-compared", reason: `outside the WGSL accuracy domain: ${error.reason}`, components: plain() };
    }
    throw error;
  }
  const components = expect.components.map((cpu, index): ComponentResult => {
    const value = gpu[index] ?? NaN;
    const interval = wide.comps[index];
    return { cpu, gpu: value, lo: interval?.lo ?? NaN, hi: interval?.hi ?? NaN, ...floatMetrics(cpu, value) };
  });
  const cpuOutside = components.findIndex((c) => !(c.cpu >= (c.lo ?? NaN) && c.cpu <= (c.hi ?? NaN)));
  if (cpuOutside >= 0) {
    const c = components[cpuOutside];
    return { ...base, status: "fail", cpuOutside: true, reason: `the CPU expectation of component ${cpuOutside} (${String(c?.cpu)}) is outside its own interval [${String(c?.lo)}, ${String(c?.hi)}]`, components };
  }
  const outside = components.findIndex((c) => !(c.gpu >= (c.lo ?? NaN) && c.gpu <= (c.hi ?? NaN)));
  const withinWgslBound = components.every((c, index) => {
    const interval = narrow.comps[index];
    return interval !== undefined && c.gpu >= interval.lo && c.gpu <= interval.hi;
  });
  if (outside >= 0) {
    const c = components[outside];
    return { ...base, status: "fail", reason: `component ${outside}: GPU ${String(c?.gpu)} outside [${String(c?.lo)}, ${String(c?.hi)}] (CPU ${String(c?.cpu)})`, withinWgslBound, components };
  }
  return { ...base, status: "within", withinWgslBound, components };
}

/** The interval of a correctly rounded exact entry, used for the flush-to-zero permission. */
function permittedValues(row: TableCase, entry: ToleranceEntry, expect: Typed, evaluator: AccuracyEvaluator): Value | undefined {
  if (entry.accuracy.kind !== "correctlyRounded" || !hasSubnormal(row, expect)) return undefined;
  try {
    return evaluator.allowed(entry, argValues(row));
  } catch (error) {
    if (error instanceof OutsideAccuracyDomain) return undefined;
    throw error;
  }
}

function permitted(
  cpu: number,
  gpu: number,
  flushInterval: { lo: number; hi: number } | undefined,
  entry: ToleranceEntry,
  row: TableCase,
): Permission | undefined {
  if (cpu === 0 && gpu === 0) return "zero-sign";
  if (flushInterval !== undefined && gpu >= flushInterval.lo && gpu <= flushInterval.hi) return "flush-to-zero";
  if (entry.accuracy.kind === "conversion") {
    const n = argValues(row)[0]?.comps[0]?.lo ?? NaN;
    if (gpu === roundDownF32(n) || gpu === roundUpF32(n)) return "conversion-neighbour";
  }
  return undefined;
}

/** One case the GPU comparison does not compare, with the reason (gpu-not-compared.json). */
export interface NotCompared {
  readonly id: string;
  readonly expression: string;
  readonly reason: string;
}

/** The Mtek expression of a case, for listings (`a + b`, `sqrt(x)`, `-x`). */
export function caseExpression(row: TableCase): string {
  const number = (x: number): string => (Object.is(x, -0) ? "-0.0" : Number.isInteger(x) && Math.abs(x) < 1e21 ? `${x}.0` : String(x));
  const literal = (typed: Typed): string => {
    if (typed.type === "i32") return String(typed.components[0]);
    if (typed.type === "u32") return `${String(typed.components[0])}u`;
    if (typed.type === "f32") return number(typed.components[0] ?? NaN);
    return `${typed.type}(${typed.components.map(number).join(", ")})`;
  };
  const args = row.args.map((arg, index) => literal(decodeTyped(arg, `${row.id} argument ${index}`)));
  if (row.fn === "neg") return `-(${args[0] ?? ""})`;
  if (/^[-+*/%<>=!]+$/.test(row.fn) && args.length === 2) return `${args[0] ?? ""} ${row.fn} ${args[1] ?? ""}`;
  return `${row.fn}(${args.join(", ")})`;
}

/**
 * Every case of the table the GPU comparison does not compare: non-portable cases of cpu.json and
 * portable cases outside a WGSL accuracy domain. Independent of any GPU result.
 */
export function notComparedCases(rows: readonly TableCase[], evaluator: AccuracyEvaluator): NotCompared[] {
  const listed: NotCompared[] = [];
  for (const row of rows) {
    const expect = decodeTyped(row.expect, `${row.id} expect`);
    const words = expect.components.map((c) => (isFloatType(expect.type) ? f32Bits(c) : c >>> 0));
    const result = compareRow(row, words, evaluator);
    if (result.status === "not-compared") listed.push({ id: row.id, expression: caseExpression(row), reason: result.reason ?? "" });
  }
  return listed;
}

/** Aggregates per tolerances.json key. */
export interface KeySummary {
  readonly key: string;
  readonly compare: "exact" | "tolerance";
  rows: number;
  match: number;
  permitted: number;
  within: number;
  withinWgslBound: number;
  specDisagreement: number;
  knownDeviation: number;
  notCompared: number;
  failed: number;
  maxAbsError: number;
  maxSteps: number;
}

export interface Summary {
  readonly exact: { total: number; match: number; permitted: number; specDisagreement: number; failed: number };
  readonly tolerance: { total: number; within: number; withinWgslBound: number; knownDeviation: number; failed: number };
  readonly notCompared: { nonPortable: number; outsideDomain: number };
  readonly permissions: Readonly<Record<Permission, number>>;
  readonly byKey: readonly KeySummary[];
}

export function summarize(results: readonly RowResult[]): Summary {
  const exact = { total: 0, match: 0, permitted: 0, specDisagreement: 0, failed: 0 };
  const tolerance = { total: 0, within: 0, withinWgslBound: 0, knownDeviation: 0, failed: 0 };
  const notCompared = { nonPortable: 0, outsideDomain: 0 };
  const permissions: Record<Permission, number> = { "zero-sign": 0, "flush-to-zero": 0, "conversion-neighbour": 0 };
  const byKey = new Map<string, KeySummary>();
  for (const result of results) {
    let summary = byKey.get(result.key);
    if (summary === undefined) {
      summary = {
        key: result.key, compare: result.compare, rows: 0, match: 0, permitted: 0, within: 0, withinWgslBound: 0,
        specDisagreement: 0, knownDeviation: 0, notCompared: 0, failed: 0, maxAbsError: 0, maxSteps: 0,
      };
      byKey.set(result.key, summary);
    }
    summary.rows++;
    if (result.status === "not-compared") {
      summary.notCompared++;
      if (result.portable) notCompared.outsideDomain++;
      else notCompared.nonPortable++;
      continue;
    }
    // Maximum errors over the rows that agree; failures and known deviations are listed individually.
    const agrees = result.status === "match" || result.status === "permitted" || result.status === "within";
    for (const c of agrees ? result.components : []) {
      summary.maxAbsError = Math.max(summary.maxAbsError, c.absError ?? 0);
      summary.maxSteps = Math.max(summary.maxSteps, c.steps ?? 0);
    }
    for (const permission of result.permissions ?? []) permissions[permission]++;
    if (result.compare === "exact") {
      exact.total++;
      if (result.status === "match") { exact.match++; summary.match++; }
      else if (result.status === "permitted") { exact.permitted++; summary.permitted++; }
      else if (result.status === "spec-disagreement") { exact.specDisagreement++; summary.specDisagreement++; }
      else { exact.failed++; summary.failed++; }
    } else {
      tolerance.total++;
      if (result.status === "within") { tolerance.within++; summary.within++; }
      else if (result.status === "known-deviation") { tolerance.knownDeviation++; summary.knownDeviation++; }
      else { tolerance.failed++; summary.failed++; }
      if (result.withinWgslBound === true) { tolerance.withinWgslBound++; summary.withinWgslBound++; }
    }
  }
  return { exact, tolerance, notCompared, permissions, byKey: [...byKey.values()] };
}
