// The WGSL f32 accuracy rules of `tests/semantics/numeric/tolerances.json` as interval arithmetic
// (task M2-08, decision 0043): for the exact inputs of a CPU table case, the interval of every value
// WGSL [S5] section 15.7.4 allows a GPU to return. Inherited bounds evaluate the quoted WGSL
// expression with each sub-operation's own accuracy, letting the GPU round either way, reassociate
// sums and products, fuse, and flush subnormal inputs and outputs to zero. Inputs outside the range
// an accuracy statement is made for raise `OutsideAccuracyDomain` (WGSL: "the accuracy is undefined
// for input values outside that range"), and so does a possible overflow.
//
// Every interval endpoint is a binary32 value. Endpoint arithmetic is binary64 with explicit directed
// rounding (two-sum) or a stated slack where binary64 itself rounds (transcendental functions,
// quotients, sums of more than two terms); the slack is far below one binary32 ULP.
import {
  F32_MAX,
  F32_MIN_NORMAL,
  type Json,
  nextF32Down,
  nextF32Up,
  roundDownF32,
  roundUpF32,
  ulpF32,
} from "./numeric-values.ts";

// --- tolerances.json ---------------------------------------------------------------------------------

/** A condition on one parameter (`where` of an accuracy statement, `domain` of an entry). */
export type Condition =
  | { readonly param: string; readonly in: readonly [number | string, number | string] }
  | { readonly param: string; readonly absIn: readonly [number, number] }
  | { readonly param: string; readonly normal: true }
  | { readonly param: string; readonly nonZeroVector: true };

export type UlpCount = number | { readonly base: number; readonly perAbsOf: string; readonly factor: number };

export type Accuracy =
  | { readonly kind: "correct" }
  | { readonly kind: "noOperation" }
  | { readonly kind: "conversion" }
  | { readonly kind: "correctlyRounded" }
  | { readonly kind: "ulp"; readonly ulp: UlpCount; readonly where?: readonly Condition[] }
  | { readonly kind: "absolute"; readonly abs: number; readonly where?: readonly Condition[] }
  | {
      readonly kind: "piecewise";
      readonly inside: readonly Condition[];
      readonly then: Accuracy;
      readonly else: Accuracy;
    }
  | { readonly kind: "worseOf"; readonly of: readonly Accuracy[] }
  | { readonly kind: "inherited"; readonly expr: string; readonly lets?: readonly string[] };

export interface Citation {
  readonly section: string;
  readonly anchor: string;
  readonly quote: string;
}

export interface ToleranceEntry {
  readonly key: string;
  readonly wgsl: string;
  /** The WGSL operator or built-in name an inherited expression refers to this entry by. */
  readonly wgslOp?: string;
  /** The generated helper (decision 0041 item 8) whose body `accuracy.expr` transcribes. */
  readonly helper?: string;
  readonly helperCheck?: "manual";
  readonly params: readonly string[];
  readonly compare: "exact" | "tolerance";
  readonly componentwise?: boolean;
  readonly accuracy: Accuracy;
  readonly domain?: readonly Condition[];
  readonly cite: readonly Citation[];
  readonly note?: string;
}

export interface Rule extends Citation {
  readonly id: string;
  readonly use: string;
}

/** A measured GPU deviation from the WGSL bound, recorded in a decision (spec/testing.md section 5). */
export interface KnownDeviation {
  readonly id: string;
  readonly decision: string;
  readonly observed: string;
  readonly cause: string;
}

export interface Tolerances {
  readonly format: string;
  readonly source: { readonly ref: string; readonly url: string; readonly status: string; readonly retrieved: string };
  readonly cpuRoundingUlp: number;
  readonly knownDeviations: readonly KnownDeviation[];
  readonly rules: readonly Rule[];
  readonly entries: readonly ToleranceEntry[];
}

export function parseTolerances(text: string): Tolerances {
  const parsed = JSON.parse(text) as Tolerances & { readonly [key: string]: Json };
  if (parsed.format !== "mtek-numeric-tolerances/1") {
    throw new Error(`tolerances.json: unexpected format ${JSON.stringify(parsed.format)}`);
  }
  return parsed;
}

// --- intervals --------------------------------------------------------------------------------------

/** A closed interval of binary32 values (`lo <= hi`; `-0` and `+0` are the same point). */
export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/** A value: one interval per component (`mat4`: 16, column-major). */
export interface Value {
  readonly shape: "scalar" | "vector" | "matrix";
  readonly comps: readonly Interval[];
}

/** WGSL does not bound the result for these inputs (or the evaluation may overflow). */
export class OutsideAccuracyDomain extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "OutsideAccuracyDomain";
  }
}

const point = (value: number): Interval => ({ lo: value, hi: value });
const scalar = (interval: Interval): Value => ({ shape: "scalar", comps: [interval] });
const hull = (a: Interval, b: Interval): Interval => ({ lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) });
const magnitude = (interval: Interval): number => Math.max(Math.abs(interval.lo), Math.abs(interval.hi));

/** 2^-126: what flushing one subnormal intermediate to zero can change at most (15.7.2). */
const FLUSH_SLACK = F32_MIN_NORMAL;
/** Relative slack for a binary64 evaluation of an exactly specified function (a few binary64 ULPs). */
const BINARY64_SLACK = 2 ** -50;

/** The value as an interval of exact inputs (a table argument). */
export function exactValue(components: readonly number[], shape: Value["shape"]): Value {
  return { shape, comps: components.map(point) };
}

/** 15.7.2: inputs and outputs of the operations of 15.7.4 may be flushed to zero. */
function flush(interval: Interval): Interval {
  let { lo, hi } = interval;
  if (lo > 0 && lo < F32_MIN_NORMAL) lo = 0;
  if (hi < 0 && hi > -F32_MIN_NORMAL) hi = 0;
  return { lo, hi };
}

/** Fails when the real interval may leave the finite range (15.7.3: the result is then indeterminate). */
function checkOverflow(lo: number, hi: number, what: string): void {
  if (!(lo >= -F32_MAX && hi <= F32_MAX)) throw new OutsideAccuracyDomain(`${what} may overflow the binary32 range`);
}

/** The binary32 values in the real interval [lo, hi], with flushing; fails on possible overflow. */
function settle(lo: number, hi: number, what: string): Interval {
  checkOverflow(lo, hi, what);
  let down = roundUpF32(lo);
  let up = roundDownF32(hi);
  if (down > up) {
    // An empty intersection cannot happen for a non-empty allowed range of width >= one ULP; keep
    // the outward rounding rather than invent a point.
    down = roundDownF32(lo);
    up = roundUpF32(hi);
  }
  return flush({ lo: down, hi: up });
}

/** Exact `a + b` of two binary64 values as [round down, round up] to binary32. */
function addRounded(a: number, b: number): Interval {
  const sum = a + b;
  const bb = sum - a;
  const error = a - (sum - bb) + (b - bb);
  if (error === 0) return { lo: roundDownF32(sum), hi: roundUpF32(sum) };
  if (Math.fround(sum) === sum) {
    return error > 0 ? { lo: sum, hi: nextF32Up(sum) } : { lo: nextF32Down(sum), hi: sum };
  }
  return { lo: roundDownF32(sum), hi: roundUpF32(sum) };
}

/** [min, max] of `f` over the corners of the argument intervals (f monotone in each argument). */
function corners(args: readonly Interval[], f: (xs: readonly number[]) => number): Interval {
  let lo = Infinity;
  let hi = -Infinity;
  const count = 1 << args.length;
  for (let mask = 0; mask < count; mask++) {
    const xs = args.map((arg, index) => ((mask >> index) & 1) === 0 ? arg.lo : arg.hi);
    const value = f(xs);
    if (Number.isNaN(value)) throw new OutsideAccuracyDomain("an intermediate value is not a number");
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  return { lo, hi };
}

function slackOf(value: number): number {
  return Math.abs(value) * BINARY64_SLACK + Number.MIN_VALUE * 16;
}

// --- exactly specified functions ----------------------------------------------------------------------

const roundTiesEven = (x: number): number => {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
};

/** Correctly rounded scalar built-ins: the exact real result for binary32 arguments. */
const EXACT: Readonly<Record<string, (xs: readonly number[]) => number>> = {
  neg: ([x = 0]) => -x,
  abs: ([x = 0]) => Math.abs(x),
  floor: ([x = 0]) => Math.floor(x),
  ceil: ([x = 0]) => Math.ceil(x),
  trunc: ([x = 0]) => Math.trunc(x),
  round: ([x = 0]) => roundTiesEven(x),
  sign: ([x = 0]) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  saturate: ([x = 0]) => Math.min(Math.max(x, 0), 1),
  step: ([edge = 0, x = 0]) => (edge <= x ? 1 : 0),
  min: ([x = 0, y = 0]) => (y < x ? y : x),
  max: ([x = 0, y = 0]) => (x < y ? y : x),
  clamp: ([x = 0, low = 0, high = 0]) => Math.min(Math.max(x, low), high),
};

function correctlyRounded(op: string, args: readonly Interval[]): Interval {
  const [a = point(0), b = point(0)] = args;
  if (op === "+") return sumOf([a, b]);
  if (op === "-") return sumOf([a, { lo: -b.hi, hi: -b.lo }]);
  if (op === "*") return productOf([a, b]);
  const f = EXACT[op];
  if (f === undefined) throw new Error(`no exact definition of the correctly rounded operation '${op}'`);
  let range = corners(args, f);
  // `abs` is not monotone: an argument interval across zero reaches 0.
  if (op === "abs" && (args[0]?.lo ?? 0) < 0 && (args[0]?.hi ?? 0) > 0) range = { lo: 0, hi: range.hi };
  return flush({ lo: roundDownF32(range.lo), hi: roundUpF32(range.hi) });
}

// --- reference functions of the ULP and absolute bounds ------------------------------------------------

/** The real range of a ULP- or absolute-bounded scalar function over argument intervals (binary64). */
function referenceRange(op: string, args: readonly Interval[]): Interval {
  const x = args[0] ?? point(0);
  let range: Interval;
  switch (op) {
    case "exp":
      range = { lo: Math.exp(x.lo), hi: Math.exp(x.hi) };
      break;
    case "exp2":
      range = { lo: 2 ** x.lo, hi: 2 ** x.hi };
      break;
    case "log":
    case "log2": {
      if (x.lo <= 0) throw new OutsideAccuracyDomain(`${op} of a value <= 0 is not finite`);
      const f = op === "log" ? Math.log : Math.log2;
      range = { lo: f(x.lo), hi: f(x.hi) };
      break;
    }
    case "inverseSqrt":
      if (x.lo <= 0) throw new OutsideAccuracyDomain("inverseSqrt of a value <= 0 is not finite");
      range = { lo: 1 / Math.sqrt(x.hi), hi: 1 / Math.sqrt(x.lo) };
      break;
    case "atan":
      range = { lo: Math.atan(x.lo), hi: Math.atan(x.hi) };
      break;
    case "asin":
    case "acos":
      if (x.lo < -1 || x.hi > 1) throw new OutsideAccuracyDomain(`${op} of a value outside [-1, 1]`);
      range = op === "asin" ? { lo: Math.asin(x.lo), hi: Math.asin(x.hi) } : { lo: Math.acos(x.hi), hi: Math.acos(x.lo) };
      break;
    case "sin":
    case "cos":
      range = periodicRange(op, x);
      break;
    case "atan2": {
      const [y = point(0), xs = point(0)] = args;
      if (y.lo <= 0 && y.hi >= 0 && xs.lo < 0) throw new OutsideAccuracyDomain("atan2 across its branch cut");
      range = corners([y, xs], ([yy = 0, xx = 0]) => Math.atan2(yy, xx));
      break;
    }
    case "/": {
      const [n = point(0), d = point(1)] = args;
      if (d.lo <= 0 && d.hi >= 0) throw new OutsideAccuracyDomain("division by an interval containing zero");
      range = corners([n, d], ([a = 0, b = 1]) => a / b);
      break;
    }
    default:
      throw new Error(`no reference function for '${op}'`);
  }
  return { lo: range.lo - slackOf(range.lo), hi: range.hi + slackOf(range.hi) };
}

/** Range of sin or cos over an interval, including interior extrema. */
function periodicRange(op: "sin" | "cos", x: Interval): Interval {
  const f = op === "sin" ? Math.sin : Math.cos;
  let lo = Math.min(f(x.lo), f(x.hi));
  let hi = Math.max(f(x.lo), f(x.hi));
  // Extrema of sin at pi/2 + k pi, of cos at k pi.
  const offset = op === "sin" ? Math.PI / 2 : 0;
  const first = Math.ceil((x.lo - offset) / Math.PI);
  const last = Math.floor((x.hi - offset) / Math.PI);
  for (let k = first; k <= last; k++) {
    if (f(offset + k * Math.PI) > 0) hi = 1;
    else lo = -1;
  }
  return { lo, hi };
}

// --- conditions -------------------------------------------------------------------------------------

function bound(raw: number | string): number {
  if (raw === "Infinity") return Infinity;
  if (raw === "-Infinity") return -Infinity;
  if (typeof raw !== "number") throw new Error(`bad bound ${JSON.stringify(raw)}`);
  return raw;
}

function describe(condition: Condition): string {
  if ("in" in condition) return `${condition.param} in [${String(condition.in[0])}, ${String(condition.in[1])}]`;
  if ("absIn" in condition) return `|${condition.param}| in [2^-126, 2^126]`;
  if ("normal" in condition) return `${condition.param} finite and normal`;
  return `${condition.param} not the zero vector`;
}

/** True when the condition holds for every point of the value (all components). */
function holds(condition: Condition, value: Value): boolean {
  if ("nonZeroVector" in condition) return value.comps.some((c) => c.lo > 0 || c.hi < 0);
  return value.comps.every((c) => {
    if ("in" in condition) return c.lo >= bound(condition.in[0]) && c.hi <= bound(condition.in[1]);
    if ("absIn" in condition) {
      const [min, max] = condition.absIn;
      return (c.lo >= min && c.hi <= max) || (c.hi <= -min && c.lo >= -max);
    }
    return (c.lo >= F32_MIN_NORMAL && c.hi <= F32_MAX) || (c.hi <= -F32_MIN_NORMAL && c.lo >= -F32_MAX);
  });
}

/** True when the condition fails for every point (used by `piecewise` to pick one side). */
function failsEverywhere(condition: Condition, value: Value): boolean {
  if (!("in" in condition)) return !holds(condition, value);
  const [min, max] = [bound(condition.in[0]), bound(condition.in[1])];
  return value.comps.every((c) => c.hi < min || c.lo > max);
}

// --- WGSL expressions -------------------------------------------------------------------------------

type Expr =
  | { readonly k: "num"; readonly value: number }
  | { readonly k: "id"; readonly name: string }
  | { readonly k: "call"; readonly name: string; readonly args: readonly Expr[] }
  | { readonly k: "member"; readonly base: Expr; readonly field: string }
  | { readonly k: "neg"; readonly arg: Expr }
  | { readonly k: "bin"; readonly op: "+" | "-" | "*" | "/"; readonly l: Expr; readonly r: Expr }
  | { readonly k: "cmp"; readonly op: "<" | "<=" | ">" | ">=" | "==" | "!="; readonly l: Expr; readonly r: Expr };

const TOKEN = /\s*(?:(\d+\.\d*(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)|([A-Za-z_]\w*(?:<f32>)?)|(<=|>=|==|!=|[-+*/(),.<>=]))/y;

/** Parses the WGSL expression subset of tolerances.json (literals, names, calls, members, + - * /, comparisons). */
export function parseExpr(text: string): Expr {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const match = TOKEN.exec(text);
    if (match === null) throw new Error(`cannot parse ${JSON.stringify(text)} at ${TOKEN.lastIndex}`);
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (expected?: string): string => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`in ${JSON.stringify(text)}: expected ${expected ?? "a token"}, found ${token ?? "the end"}`);
    }
    return token;
  };
  const primary = (): Expr => {
    const token = take();
    if (token === "(") {
      const inner = comparison();
      take(")");
      return inner;
    }
    if (/^\d/.test(token)) return { k: "num", value: Number(token) };
    if (!/^[A-Za-z_]/.test(token)) throw new Error(`in ${JSON.stringify(text)}: unexpected ${token}`);
    if (peek() === "(") {
      take("(");
      const args: Expr[] = [];
      if (peek() !== ")") {
        args.push(comparison());
        while (peek() === ",") {
          take(",");
          args.push(comparison());
        }
      }
      take(")");
      return { k: "call", name: token, args };
    }
    return { k: "id", name: token };
  };
  const postfix = (): Expr => {
    let base = primary();
    while (peek() === ".") {
      take(".");
      base = { k: "member", base, field: take() };
    }
    return base;
  };
  const unary = (): Expr => {
    if (peek() === "-") {
      take("-");
      return { k: "neg", arg: unary() };
    }
    return postfix();
  };
  const multiplicative = (): Expr => {
    let left = unary();
    for (let op = peek(); op === "*" || op === "/"; op = peek()) {
      take();
      left = { k: "bin", op, l: left, r: unary() };
    }
    return left;
  };
  const additive = (): Expr => {
    let left = multiplicative();
    for (let op = peek(); op === "+" || op === "-"; op = peek()) {
      take();
      left = { k: "bin", op, l: left, r: multiplicative() };
    }
    return left;
  };
  const comparison = (): Expr => {
    const left = additive();
    const op = peek();
    if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "==" || op === "!=") {
      take();
      return { k: "cmp", op, l: left, r: additive() };
    }
    return left;
  };
  const expr = comparison();
  if (at !== tokens.length) throw new Error(`in ${JSON.stringify(text)}: unexpected ${tokens[at] ?? ""}`);
  return expr;
}

/** A three-valued comparison result over intervals. */
type Truth = true | false | "unknown";

/** Evaluates expressions and entries of one tolerance file. */
export class AccuracyEvaluator {
  private readonly byKey = new Map<string, ToleranceEntry>();
  private readonly byOp = new Map<string, ToleranceEntry>();
  private readonly parsed = new Map<string, Expr>();
  readonly tolerances: Tolerances;

  constructor(tolerances: Tolerances) {
    this.tolerances = tolerances;
    for (const entry of tolerances.entries) {
      if (this.byKey.has(entry.key)) throw new Error(`tolerances.json: duplicate key ${entry.key}`);
      this.byKey.set(entry.key, entry);
      for (const name of [entry.wgslOp, entry.helper]) {
        if (name === undefined) continue;
        if (this.byOp.has(name)) throw new Error(`tolerances.json: two entries are '${name}'`);
        this.byOp.set(name, entry);
      }
    }
  }

  entry(key: string): ToleranceEntry | undefined {
    return this.byKey.get(key);
  }

  /** The entry an inherited expression means by an operator or call name. */
  private op(name: string): ToleranceEntry {
    const entry = this.byOp.get(name);
    if (entry === undefined) throw new Error(`tolerances.json: no entry for the WGSL operation '${name}'`);
    return entry;
  }

  private parse(text: string): Expr {
    let expr = this.parsed.get(text);
    if (expr === undefined) {
      expr = parseExpr(text);
      this.parsed.set(text, expr);
    }
    return expr;
  }

  /**
   * The interval WGSL allows for `entry` applied to `args` (exact values), without the CPU rounding
   * allowance. Throws `OutsideAccuracyDomain` when WGSL states no bound for these inputs.
   */
  allowed(entry: ToleranceEntry, args: readonly Value[]): Value {
    return this.apply(entry, args);
  }

  /**
   * `allowed` widened by `cpuRoundingUlp` binary32 steps at each end (spec/testing.md section 5: the
   * CPU reference is itself rounded once, decision 0037 item 5). A step, not the minimum-gap ULP of
   * 15.7.4, so that the allowance is one representable value on both sides of a power of two.
   */
  allowedWithCpuRounding(entry: ToleranceEntry, args: readonly Value[]): Value {
    const value = this.allowed(entry, args);
    const widen = (c: Interval): Interval => {
      let { lo, hi } = c;
      for (let step = 0; step < this.tolerances.cpuRoundingUlp; step++) {
        lo = nextF32Down(lo);
        hi = nextF32Up(hi);
      }
      return { lo, hi };
    };
    return { shape: value.shape, comps: value.comps.map(widen) };
  }

  private apply(entry: ToleranceEntry, args: readonly Value[]): Value {
    if (args.length !== entry.params.length) {
      throw new Error(`${entry.key}: ${entry.params.length} arguments expected, ${args.length} given`);
    }
    const flushed = args.map((arg) => ({ shape: arg.shape, comps: arg.comps.map(flush) }));
    for (const condition of entry.domain ?? []) {
      const arg = flushed[entry.params.indexOf(condition.param)];
      if (arg === undefined) throw new Error(`${entry.key}: domain names unknown parameter ${condition.param}`);
      if (!holds(condition, arg)) throw new OutsideAccuracyDomain(`${entry.key}: outside the domain (${describe(condition)})`);
    }
    if (entry.componentwise === true) {
      const width = Math.max(...flushed.map((arg) => arg.comps.length));
      const shape = flushed.find((arg) => arg.shape !== "scalar")?.shape ?? "scalar";
      const comps: Interval[] = [];
      for (let index = 0; index < width; index++) {
        const scalars = flushed.map((arg) => scalar(arg.comps[arg.comps.length === 1 ? 0 : index] ?? point(0)));
        const result = this.accuracy(entry, entry.accuracy, scalars);
        comps.push(result.comps[0] ?? point(0));
      }
      return { shape, comps };
    }
    return this.accuracy(entry, entry.accuracy, flushed);
  }

  private accuracy(entry: ToleranceEntry, accuracy: Accuracy, args: readonly Value[]): Value {
    const param = (name: string): Value => {
      const value = args[entry.params.indexOf(name)];
      if (value === undefined) throw new Error(`${entry.key}: unknown parameter ${name}`);
      return value;
    };
    const intervals = (): Interval[] => args.map((arg) => {
      const only = arg.comps[0];
      if (arg.comps.length !== 1 || only === undefined) throw new Error(`${entry.key}: a scalar bound applied to a vector`);
      return only;
    });
    const op = entry.wgslOp ?? entry.key;
    switch (accuracy.kind) {
      case "correct":
      case "noOperation":
      case "conversion":
        throw new Error(`${entry.key}: '${accuracy.kind}' has no interval (exact comparison)`);
      case "correctlyRounded":
        return scalar(correctlyRounded(op, intervals()));
      case "ulp":
      case "absolute": {
        for (const condition of accuracy.where ?? []) {
          if (!holds(condition, param(condition.param))) {
            throw new OutsideAccuracyDomain(`${entry.key}: accuracy is stated only for ${describe(condition)}`);
          }
        }
        const range = referenceRange(op, intervals());
        if (accuracy.kind === "absolute") {
          return scalar(settle(range.lo - accuracy.abs, range.hi + accuracy.abs, entry.key));
        }
        const n = typeof accuracy.ulp === "number"
          ? accuracy.ulp
          : accuracy.ulp.base + accuracy.ulp.factor * magnitude(param(accuracy.ulp.perAbsOf).comps[0] ?? point(0));
        checkOverflow(range.lo, range.hi, entry.key);
        return scalar(settle(range.lo - n * ulpF32(range.lo), range.hi + n * ulpF32(range.hi), entry.key));
      }
      case "piecewise": {
        const inside = accuracy.inside.every((c) => holds(c, param(c.param)));
        const outside = accuracy.inside.some((c) => failsEverywhere(c, param(c.param)));
        if (inside) return this.accuracy(entry, accuracy.then, args);
        if (outside) return this.accuracy(entry, accuracy.else, args);
        return joinValues(this.accuracy(entry, accuracy.then, args), this.accuracy(entry, accuracy.else, args));
      }
      case "worseOf": {
        const results = accuracy.of.map((part) => this.accuracy(entry, part, args));
        return results.reduce(joinValues);
      }
      case "inherited": {
        const env = new Map<string, Value>();
        entry.params.forEach((name, index) => {
          const value = args[index];
          if (value !== undefined) env.set(name, value);
        });
        for (const binding of accuracy.lets ?? []) {
          const eq = binding.indexOf("=");
          env.set(binding.slice(0, eq).trim(), this.evaluate(this.parse(binding.slice(eq + 1)), env));
        }
        return this.evaluate(this.parse(accuracy.expr), env);
      }
    }
  }

  /** Evaluates a parsed WGSL expression over interval values. */
  private evaluate(expr: Expr, env: ReadonlyMap<string, Value>): Value {
    switch (expr.k) {
      case "num":
        return scalar(constant(expr.value));
      case "id": {
        const value = env.get(expr.name);
        if (value === undefined) throw new Error(`unknown name ${expr.name}`);
        return value;
      }
      case "member": {
        const base = this.evaluate(expr.base, env);
        const comps = [...expr.field].map((letter) => {
          const component = base.comps["xyzw".indexOf(letter)];
          if (component === undefined) throw new Error(`no component .${letter}`);
          return component;
        });
        return comps.length === 1 ? scalar(comps[0] ?? point(0)) : { shape: "vector", comps };
      }
      case "neg":
        return this.apply(this.op("neg"), [this.evaluate(expr.arg, env)]);
      case "cmp":
        throw new Error("a comparison is only allowed as the condition of select");
      case "bin": {
        if (expr.op === "+" || expr.op === "-") return this.sum(expr, env);
        if (expr.op === "/") return this.apply(this.op("/"), [this.evaluate(expr.l, env), this.evaluate(expr.r, env)]);
        return this.product(expr, env);
      }
      case "call":
        return this.call(expr, env);
    }
  }

  private call(expr: Extract<Expr, { k: "call" }>, env: ReadonlyMap<string, Value>): Value {
    const args = (): Value[] => expr.args.map((arg) => this.evaluate(arg, env));
    switch (expr.name) {
      case "vec2<f32>":
      case "vec3<f32>":
      case "vec4<f32>": {
        const width = Number(expr.name[3]);
        const parts = args();
        const comps = parts.length === 1 && parts[0]?.shape === "scalar"
          ? Array.from({ length: width }, () => parts[0]?.comps[0] ?? point(0))
          : parts.flatMap((part) => part.comps);
        if (comps.length !== width) throw new Error(`${expr.name} with ${comps.length} components`);
        return { shape: "vector", comps };
      }
      case "mat4x4<f32>": {
        const comps = args().flatMap((part) => part.comps);
        if (comps.length !== 16) throw new Error(`mat4x4 with ${comps.length} components`);
        return { shape: "matrix", comps };
      }
      case "select": {
        const [onFalse, onTrue, condition] = expr.args;
        if (onFalse === undefined || onTrue === undefined || condition?.k !== "cmp") throw new Error("select(f, t, a op b) expected");
        const truth = this.compare(condition, env);
        if (truth === true) return this.evaluate(onTrue, env);
        if (truth === false) return this.evaluate(onFalse, env);
        return joinValues(this.evaluate(onFalse, env), this.evaluate(onTrue, env));
      }
      case "sum_of_products": {
        const [x, y] = args();
        if (x === undefined || y === undefined || x.comps.length !== y.comps.length) throw new Error("sum_of_products(x, y) of equal widths expected");
        return scalar(this.dot(x.comps, y.comps));
      }
      default:
        return this.apply(this.op(expr.name), args());
    }
  }

  private compare(expr: Extract<Expr, { k: "cmp" }>, env: ReadonlyMap<string, Value>): Truth {
    const l = this.evaluate(expr.l, env).comps[0] ?? point(0);
    const r = this.evaluate(expr.r, env).comps[0] ?? point(0);
    const decide = (always: boolean, never: boolean): Truth => (always ? true : never ? false : "unknown");
    switch (expr.op) {
      case "<":
        return decide(l.hi < r.lo, l.lo >= r.hi);
      case "<=":
        return decide(l.hi <= r.lo, l.lo > r.hi);
      case ">":
        return decide(l.lo > r.hi, l.hi <= r.lo);
      case ">=":
        return decide(l.lo >= r.hi, l.hi < r.lo);
      case "==":
        return decide(l.lo === l.hi && r.lo === r.hi && l.lo === r.lo, l.hi < r.lo || l.lo > r.hi);
      case "!=":
        return decide(l.hi < r.lo || l.lo > r.hi, l.lo === l.hi && r.lo === r.hi && l.lo === r.lo);
    }
  }

  /** A chain of + and - (reassociation, 15.7.5): terms with their signs, evaluated componentwise. */
  private sum(expr: Expr, env: ReadonlyMap<string, Value>): Value {
    const terms: { sign: 1 | -1; value: Value }[] = [];
    const collect = (node: Expr, sign: 1 | -1): void => {
      if (node.k === "bin" && (node.op === "+" || node.op === "-")) {
        collect(node.l, sign);
        collect(node.r, node.op === "+" ? sign : sign === 1 ? -1 : 1);
      } else {
        terms.push({ sign, value: this.evaluate(node, env) });
      }
    };
    collect(expr, 1);
    const width = Math.max(...terms.map((term) => term.value.comps.length));
    const shape = terms.find((term) => term.value.shape !== "scalar")?.value.shape ?? "scalar";
    const comps: Interval[] = [];
    for (let index = 0; index < width; index++) {
      const parts = terms.map(({ sign, value }) => {
        const c = flush(value.comps[value.comps.length === 1 ? 0 : index] ?? point(0));
        return sign === 1 ? c : { lo: -c.hi, hi: -c.lo };
      });
      comps.push(sumOf(parts));
    }
    return { shape, comps };
  }

  /** A chain of products: matrix products by dot products (8.8), otherwise componentwise. */
  private product(expr: Extract<Expr, { k: "bin" }>, env: ReadonlyMap<string, Value>): Value {
    const factors: Value[] = [];
    const collect = (node: Expr): void => {
      if (node.k === "bin" && node.op === "*") {
        collect(node.l);
        collect(node.r);
      } else {
        factors.push(this.evaluate(node, env));
      }
    };
    collect(expr);
    if (factors.some((factor) => factor.shape === "matrix")) {
      return factors.reduce((left, right) => this.matrixProduct(left, right));
    }
    const width = Math.max(...factors.map((factor) => factor.comps.length));
    const shape = factors.find((factor) => factor.shape !== "scalar")?.shape ?? "scalar";
    const comps: Interval[] = [];
    for (let index = 0; index < width; index++) {
      comps.push(productOf(factors.map((factor) => flush(factor.comps[factor.comps.length === 1 ? 0 : index] ?? point(0)))));
    }
    return { shape, comps };
  }

  private matrixProduct(left: Value, right: Value): Value {
    if (left.shape !== "matrix") throw new Error("only mat4 * vec4 and mat4 * mat4 products are supported");
    const row = (i: number): Interval[] => [0, 1, 2, 3].map((k) => left.comps[k * 4 + i] ?? point(0));
    if (right.shape === "vector" && right.comps.length === 4) {
      return { shape: "vector", comps: [0, 1, 2, 3].map((i) => this.dot(row(i), right.comps)) };
    }
    if (right.shape === "matrix") {
      const comps: Interval[] = [];
      for (let j = 0; j < 4; j++) {
        const column = right.comps.slice(j * 4, j * 4 + 4);
        for (let i = 0; i < 4; i++) comps.push(this.dot(row(i), column));
      }
      return { shape: "matrix", comps };
    }
    throw new Error("unsupported matrix product");
  }

  /** "sum of x[i] * y[i]": correctly rounded products, summed under the reassociation rule. */
  private dot(x: readonly Interval[], y: readonly Interval[]): Interval {
    const products = x.map((xi, i) => productOf([flush(xi), flush(y[i] ?? point(0))]));
    return sumOf(products);
  }
}

/** A numeric literal of an inherited expression: an AbstractFloat converted to f32 (either neighbour, 15.7.6). */
function constant(value: number): Interval {
  const nearest = Math.fround(value);
  if (nearest === value) return point(value);
  return { lo: roundDownF32(value), hi: roundUpF32(value) };
}

function joinValues(a: Value, b: Value): Value {
  if (a.comps.length !== b.comps.length) throw new Error("cannot join values of different widths");
  return { shape: a.shape, comps: a.comps.map((c, i) => hull(c, b.comps[i] ?? c)) };
}

/**
 * The sum of terms (already binary32 intervals). Two terms: one correctly rounded addition. More
 * terms: any association order (15.7.5), so the exact sum widened by one rounding of at most
 * ULP(sum of the term magnitudes) — or a flushed subnormal, 2^-126 — per addition.
 */
function sumOf(terms: readonly Interval[]): Interval {
  if (terms.length === 1) return terms[0] ?? point(0);
  if (terms.length === 2) {
    const [a = point(0), b = point(0)] = terms;
    const lo = addRounded(a.lo, b.lo).lo;
    const hi = addRounded(a.hi, b.hi).hi;
    checkOverflow(lo, hi, "a sum");
    return flush({ lo, hi });
  }
  let lo = 0;
  let hi = 0;
  let total = 0;
  for (const term of terms) {
    lo += term.lo;
    hi += term.hi;
    total += magnitude(term);
  }
  checkOverflow(-total, total, "a partial sum");
  const roundings = terms.length - 1;
  const error = roundings * (ulpF32(total) + FLUSH_SLACK) + terms.length * total * 2 ** -52;
  return settle(lo - error, hi + error, "a sum");
}

/**
 * The product of factors (binary32 intervals). Two factors: one correctly rounded product. More:
 * any association order, each rounding a relative error below 2^-23 of a normal partial product,
 * plus 2^-126 (scaled by the remaining factors) for a flushed or subnormal one.
 */
function productOf(factors: readonly Interval[]): Interval {
  if (factors.length === 1) return factors[0] ?? point(0);
  if (factors.length === 2) {
    const [a = point(0), b = point(0)] = factors;
    // A product of two binary32 values is exact in binary64.
    const range = corners([a, b], ([x = 0, y = 0]) => x * y);
    checkOverflow(range.lo, range.hi, "a product");
    return flush({ lo: roundDownF32(range.lo), hi: roundUpF32(range.hi) });
  }
  const range = corners(factors, (xs) => xs.reduce((p, x) => p * x, 1));
  const largest = factors.reduce((p, f) => p * Math.max(1, magnitude(f)), 1);
  checkOverflow(-largest, largest, "a partial product");
  const roundings = factors.length - 1;
  const exactMagnitude = Math.max(Math.abs(range.lo), Math.abs(range.hi));
  const error = exactMagnitude * ((1 + 2 ** -23) ** roundings - 1) * (1 + 2 ** -40)
    + roundings * FLUSH_SLACK * largest
    + exactMagnitude * 2 ** -50;
  return settle(range.lo - error, range.hi + error, "a product");
}
