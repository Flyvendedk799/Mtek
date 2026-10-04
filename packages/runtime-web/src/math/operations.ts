/**
 * Which `rt` helper implements which Mtek operation (decision 0037): the contract between the CPU
 * emitter (M2-07) and the runtime math library, and the index the conformance tests use to run
 * `tests/semantics/numeric/cpu.json` against `rt`.
 *
 * `RT_OPERATIONS[callee][signature]` is the name of an `rt` export. `callee` is what Mtek source
 * calls or writes: an intrinsic (`"round"`), a namespace function (`"quat.axis_angle"`), a vector
 * constructor (`"vec3"`), a conversion (`"i32"`), a binary operator (`"+"`, `"%"`) or `"neg"` for
 * unary minus. `signature` is the concrete signature `"(vec3, f32) -> vec3"` with every type class
 * of `spec/stdlib.md` 6 substituted. The helper takes the operands in source order.
 *
 * Naming scheme: a type prefix (`f32` none — `f` for the arithmetic operators —, `vec2` `v2`,
 * `vec3` `v3`, `vec4` `v4`, `i32` `i`, `u32` `u`, `quat` `q`, `color` `c`, `mat4` `m4`) followed by
 * the Mtek name in lower camel case (`inverse_sqrt` → `v3inverseSqrt`). A vector form taking a
 * scalar where the scalar form takes the vector type ends in `s` (`v3mixs`, `v3divs`).
 */

/** The Mtek types `rt` operates on, as spelled in signatures. */
export const NUMERIC_TYPES = ["bool", "f32", "i32", "u32", "vec2", "vec3", "vec4", "quat", "color", "mat4"] as const;
export type NumericType = (typeof NUMERIC_TYPES)[number];

type Table = Record<string, Record<string, string>>;

const FLOAT_TYPES = ["f32", "vec2", "vec3", "vec4"] as const;
const VECTOR_TYPES = ["vec2", "vec3", "vec4"] as const;
const INT_TYPES = ["i32", "u32"] as const;

const PREFIX: Readonly<Record<string, string>> = {
  f32: "",
  vec2: "v2",
  vec3: "v3",
  vec4: "v4",
  i32: "i",
  u32: "u",
};

/** `"(a, b) -> r"`. */
export function signature(params: readonly string[], result: string): string {
  return `(${params.join(", ")}) -> ${result}`;
}

/** `inverse_sqrt` → `inverseSqrt`. */
function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function add(table: Table, callee: string, params: readonly string[], result: string, helper: string): void {
  const entries = (table[callee] ??= {});
  const key = signature(params, result);
  if (entries[key] !== undefined && entries[key] !== helper) {
    throw new Error(`RT_OPERATIONS: ${callee} ${key} is mapped twice`);
  }
  entries[key] = helper;
}

function build(): Table {
  const t: Table = {};

  // Component-wise intrinsics over T = f32 | vec2 | vec3 | vec4.
  const unary = [
    "abs", "saturate", "sqrt", "inverse_sqrt", "exp", "exp2", "log", "log2", "sin", "cos", "tan",
    "asin", "acos", "atan", "floor", "ceil", "trunc", "fract", "sign", "round", "radians", "degrees",
  ];
  const binary = ["min", "max", "pow", "atan2", "step"];
  const ternary = ["clamp", "smoothstep", "mix"];
  for (const ty of FLOAT_TYPES) {
    const p = PREFIX[ty] ?? "";
    for (const name of unary) add(t, name, [ty], ty, `${p}${camel(name)}`);
    for (const name of binary) add(t, name, [ty, ty], ty, `${p}${name}`);
    for (const name of ternary) add(t, name, [ty, ty, ty], ty, `${p}${name}`);
    add(t, "mix", [ty, ty, "f32"], ty, ty === "f32" ? "mix" : `${p}mixs`);
    add(t, "length", [ty], "f32", `${p}length`);
    add(t, "distance", [ty, ty], "f32", `${p}distance`);
  }
  // Integer forms (type class I).
  for (const ty of INT_TYPES) {
    const p = PREFIX[ty] ?? "";
    add(t, "abs", [ty], ty, `${p}abs`);
    add(t, "min", [ty, ty], ty, `${p}min`);
    add(t, "max", [ty, ty], ty, `${p}max`);
    add(t, "clamp", [ty, ty, ty], ty, `${p}clamp`);
  }
  // Vector-only intrinsics (type class V) and the fixed-type ones.
  for (const ty of VECTOR_TYPES) {
    const p = PREFIX[ty] ?? "";
    add(t, "dot", [ty, ty], "f32", `${p}dot`);
    add(t, "normalize", [ty], ty, `${p}normalize`);
    add(t, "reflect", [ty, ty], ty, `${p}reflect`);
  }
  add(t, "cross", ["vec3", "vec3"], "vec3", "v3cross");
  add(t, "transpose", ["mat4"], "mat4", "m4transpose");

  // Namespace functions (`spec/stdlib.md` 2).
  add(t, "quat.identity", [], "quat", "qidentity");
  add(t, "quat.axis_angle", ["vec3", "f32"], "quat", "qaxisAngle");
  add(t, "quat.euler", ["f32", "f32", "f32"], "quat", "qeuler");
  add(t, "mat4.identity", [], "mat4", "m4identity");
  add(t, "mat4.translation", ["vec3"], "mat4", "m4translation");
  add(t, "mat4.rotation", ["quat"], "mat4", "m4rotation");
  add(t, "mat4.scale", ["vec3"], "mat4", "m4scale");
  add(t, "mat4.columns", ["vec4", "vec4", "vec4", "vec4"], "mat4", "m4columns");
  add(t, "color.linear", ["vec3", "f32"], "color", "clinear");
  add(t, "color.srgb", ["vec3", "f32"], "color", "csrgb");

  // Vector constructors (`spec/language.md` 6.7).
  add(t, "vec2", ["f32", "f32"], "vec2", "v2");
  add(t, "vec2", ["f32"], "vec2", "v2splat");
  add(t, "vec3", ["f32", "f32", "f32"], "vec3", "v3");
  add(t, "vec3", ["f32"], "vec3", "v3splat");
  add(t, "vec3", ["vec2", "f32"], "vec3", "v3fromV2");
  add(t, "vec4", ["f32", "f32", "f32", "f32"], "vec4", "v4");
  add(t, "vec4", ["f32"], "vec4", "v4splat");
  add(t, "vec4", ["vec3", "f32"], "vec4", "v4fromV3");
  add(t, "vec4", ["vec2", "f32", "f32"], "vec4", "v4fromV2");

  // Conversions (`spec/language.md` 6.5). Same-type conversions are the identity and need no helper.
  add(t, "f32", ["i32"], "f32", "i2f");
  add(t, "f32", ["u32"], "f32", "u2f");
  add(t, "i32", ["f32"], "i32", "f2i");
  add(t, "i32", ["u32"], "i32", "u2i");
  add(t, "u32", ["f32"], "u32", "f2u");
  add(t, "u32", ["i32"], "u32", "i2u");

  // Operators (`spec/language.md` 6.2).
  const scalarOps: Readonly<Record<string, string>> = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem" };
  for (const [op, name] of Object.entries(scalarOps)) {
    add(t, op, ["f32", "f32"], "f32", `f${name}`);
    add(t, op, ["i32", "i32"], "i32", `i${name}`);
    add(t, op, ["u32", "u32"], "u32", `u${name}`);
  }
  add(t, "neg", ["f32"], "f32", "fneg");
  add(t, "neg", ["i32"], "i32", "ineg");
  for (const ty of VECTOR_TYPES) {
    const p = PREFIX[ty] ?? "";
    add(t, "+", [ty, ty], ty, `${p}add`);
    add(t, "-", [ty, ty], ty, `${p}sub`);
    add(t, "*", [ty, ty], ty, `${p}mul`);
    add(t, "/", [ty, ty], ty, `${p}div`);
    add(t, "*", [ty, "f32"], ty, `${p}scale`);
    add(t, "*", ["f32", ty], ty, `${p}smul`);
    add(t, "/", [ty, "f32"], ty, `${p}divs`);
    add(t, "neg", [ty], ty, `${p}neg`);
  }
  add(t, "*", ["mat4", "mat4"], "mat4", "m4mul");
  add(t, "*", ["mat4", "vec4"], "vec4", "m4mulv");
  add(t, "*", ["quat", "quat"], "quat", "qmul");
  add(t, "*", ["quat", "vec3"], "vec3", "qrotate");

  return t;
}

/** `RT_OPERATIONS[callee][signature]`: the `rt` helper of a Mtek operation (module doc above). */
export const RT_OPERATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = build();

/**
 * `rt` exports that implement no callee of {@link RT_OPERATIONS}: constructors of values the
 * emitter builds from components, swizzles, component replacement, column and channel access, index
 * clamping, the colour transfer function of one channel, and integer limits.
 */
export const RT_STRUCTURAL_EXPORTS: readonly string[] = [
  "quat",
  "color",
  "swizzle2",
  "swizzle3",
  "swizzle4",
  "v2with",
  "v3with",
  "v4with",
  "crgb",
  "m4col",
  "clampIndex",
  "srgbChannelToLinear",
  "I32_MIN",
  "I32_MAX",
  "U32_MAX",
];
