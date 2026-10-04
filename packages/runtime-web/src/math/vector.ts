/**
 * `vec2`, `vec3` and `vec4` constructors, operators and intrinsics of the runtime math library
 * `rt` (`spec/runtime-abi.md` 4.1, `spec/language.md` 6.2, 6.7 and 6.9, `spec/stdlib.md` 6,
 * decision 0037).
 *
 * Component-wise operations apply the scalar `f32` definition of `./scalar.ts` to each component.
 * Reductions (`dot`, `length`, `distance`) and the geometric functions round every operation and
 * sum left to right: `dot(a, b) = ((a.x*b.x + a.y*b.y) + a.z*b.z) + a.w*b.w`. Every result is a
 * new object; arguments are never modified.
 */
import * as s from "./scalar.js";
import type { Vec2, Vec3, Vec4, VecKey } from "./types.js";

const fr = Math.fround;

type Unary = (x: number) => number;
type Binary = (a: number, b: number) => number;
type Ternary = (a: number, b: number, c: number) => number;

// ---------------------------------------------------------------------------------------------
// Constructors (`spec/language.md` 6.7)

/** `vec2(x, y)`; the components are rounded to binary32. */
export function v2(x: number, y: number): Vec2 {
  return { x: fr(x), y: fr(y) };
}

/** `vec3(x, y, z)`. */
export function v3(x: number, y: number, z: number): Vec3 {
  return { x: fr(x), y: fr(y), z: fr(z) };
}

/** `vec4(x, y, z, w)`. */
export function v4(x: number, y: number, z: number, w: number): Vec4 {
  return { x: fr(x), y: fr(y), z: fr(z), w: fr(w) };
}

/** `vec2(s)`: splat. */
export function v2splat(value: number): Vec2 {
  const c = fr(value);
  return { x: c, y: c };
}

/** `vec3(s)`: splat. */
export function v3splat(value: number): Vec3 {
  const c = fr(value);
  return { x: c, y: c, z: c };
}

/** `vec4(s)`: splat. */
export function v4splat(value: number): Vec4 {
  const c = fr(value);
  return { x: c, y: c, z: c, w: c };
}

/** `vec3(xy, z)`. */
export function v3fromV2(xy: Vec2, z: number): Vec3 {
  return { x: xy.x, y: xy.y, z: fr(z) };
}

/** `vec4(xyz, w)`. */
export function v4fromV3(xyz: Vec3, w: number): Vec4 {
  return { x: xyz.x, y: xyz.y, z: xyz.z, w: fr(w) };
}

/** `vec4(xy, z, w)`. */
export function v4fromV2(xy: Vec2, z: number, w: number): Vec4 {
  return { x: xy.x, y: xy.y, z: fr(z), w: fr(w) };
}

// ---------------------------------------------------------------------------------------------
// Swizzles and component replacement (`spec/language.md` 6.9, 7.2)

/** Readable components of a vector or quaternion by name; `w` exists only on four components. */
type Swizzlable = Vec2 | Vec3 | Vec4;

function component(v: Swizzlable, key: VecKey): number {
  return (v as Partial<Record<VecKey, number>>)[key] ?? Number.NaN;
}

/** A two-component swizzle `v.ab` (repetition allowed): `swizzle2(v, "z", "x")` is `v.zx`. */
export function swizzle2(v: Swizzlable, a: VecKey, b: VecKey): Vec2 {
  return { x: component(v, a), y: component(v, b) };
}

/** A three-component swizzle `v.abc`. */
export function swizzle3(v: Swizzlable, a: VecKey, b: VecKey, c: VecKey): Vec3 {
  return { x: component(v, a), y: component(v, b), z: component(v, c) };
}

/** A four-component swizzle `v.abcd`. */
export function swizzle4(v: Swizzlable, a: VecKey, b: VecKey, c: VecKey, d: VecKey): Vec4 {
  return { x: component(v, a), y: component(v, b), z: component(v, c), w: component(v, d) };
}

/** `v` with component `key` replaced (`self.position.y = 0.0` builds a new vector). */
export function v2with(v: Vec2, key: "x" | "y", value: number): Vec2 {
  return key === "x" ? { x: fr(value), y: v.y } : { x: v.x, y: fr(value) };
}

/** `v` with component `key` replaced. */
export function v3with(v: Vec3, key: "x" | "y" | "z", value: number): Vec3 {
  const out = { x: v.x, y: v.y, z: v.z };
  out[key] = fr(value);
  return out;
}

/** `v` with component `key` replaced. */
export function v4with(v: Vec4, key: VecKey, value: number): Vec4 {
  const out = { x: v.x, y: v.y, z: v.z, w: v.w };
  out[key] = fr(value);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lifting scalar definitions to vectors

function map2(f: Unary): (v: Vec2) => Vec2 {
  return (v) => ({ x: f(v.x), y: f(v.y) });
}
function map3(f: Unary): (v: Vec3) => Vec3 {
  return (v) => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
}
function map4(f: Unary): (v: Vec4) => Vec4 {
  return (v) => ({ x: f(v.x), y: f(v.y), z: f(v.z), w: f(v.w) });
}
function zip2(f: Binary): (a: Vec2, b: Vec2) => Vec2 {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y) });
}
function zip3(f: Binary): (a: Vec3, b: Vec3) => Vec3 {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z) });
}
function zip4(f: Binary): (a: Vec4, b: Vec4) => Vec4 {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z), w: f(a.w, b.w) });
}
function zip2s(f: Binary): (a: Vec2, b: number) => Vec2 {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b) });
}
function zip3s(f: Binary): (a: Vec3, b: number) => Vec3 {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b), z: f(a.z, b) });
}
function zip4s(f: Binary): (a: Vec4, b: number) => Vec4 {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b), z: f(a.z, b), w: f(a.w, b) });
}
function tri2(f: Ternary): (a: Vec2, b: Vec2, c: Vec2) => Vec2 {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y) });
}
function tri3(f: Ternary): (a: Vec3, b: Vec3, c: Vec3) => Vec3 {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z) });
}
function tri4(f: Ternary): (a: Vec4, b: Vec4, c: Vec4) => Vec4 {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z), w: f(a.w, b.w, c.w) });
}
function tri2s(f: Ternary): (a: Vec2, b: Vec2, t: number) => Vec2 {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t) });
}
function tri3s(f: Ternary): (a: Vec3, b: Vec3, t: number) => Vec3 {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t), z: f(a.z, b.z, t) });
}
function tri4s(f: Ternary): (a: Vec4, b: Vec4, t: number) => Vec4 {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t), z: f(a.z, b.z, t), w: f(a.w, b.w, t) });
}

// ---------------------------------------------------------------------------------------------
// Operators (`spec/language.md` 6.2)

/** `a + b`. */
export const v2add = zip2(s.fadd);
/** `a - b`. */
export const v2sub = zip2(s.fsub);
/** `a * b`, component-wise. */
export const v2mul = zip2(s.fmul);
/** `a / b`, component-wise. */
export const v2div = zip2(s.fdiv);
/** `v * s`. */
export const v2scale = zip2s(s.fmul);
/** `s * v` (operands in source order, so the emitter keeps left-to-right evaluation). */
export function v2smul(scale: number, v: Vec2): Vec2 {
  return v2scale(v, scale);
}
/** `v / s`. */
export const v2divs = zip2s(s.fdiv);
/** `-v`. */
export const v2neg = map2(s.fneg);

/** `a + b`. */
export const v3add = zip3(s.fadd);
/** `a - b`. */
export const v3sub = zip3(s.fsub);
/** `a * b`, component-wise. */
export const v3mul = zip3(s.fmul);
/** `a / b`, component-wise. */
export const v3div = zip3(s.fdiv);
/** `v * s`. */
export const v3scale = zip3s(s.fmul);
/** `s * v`. */
export function v3smul(scale: number, v: Vec3): Vec3 {
  return v3scale(v, scale);
}
/** `v / s`. */
export const v3divs = zip3s(s.fdiv);
/** `-v`. */
export const v3neg = map3(s.fneg);

/** `a + b`. */
export const v4add = zip4(s.fadd);
/** `a - b`. */
export const v4sub = zip4(s.fsub);
/** `a * b`, component-wise. */
export const v4mul = zip4(s.fmul);
/** `a / b`, component-wise. */
export const v4div = zip4(s.fdiv);
/** `v * s`. */
export const v4scale = zip4s(s.fmul);
/** `s * v`. */
export function v4smul(scale: number, v: Vec4): Vec4 {
  return v4scale(v, scale);
}
/** `v / s`. */
export const v4divs = zip4s(s.fdiv);
/** `-v`. */
export const v4neg = map4(s.fneg);

// ---------------------------------------------------------------------------------------------
// Component-wise intrinsics (`spec/stdlib.md` 6, type class T)

export const v2abs = map2(s.abs);
export const v3abs = map3(s.abs);
export const v4abs = map4(s.abs);
export const v2min = zip2(s.min);
export const v3min = zip3(s.min);
export const v4min = zip4(s.min);
export const v2max = zip2(s.max);
export const v3max = zip3(s.max);
export const v4max = zip4(s.max);
export const v2clamp = tri2(s.clamp);
export const v3clamp = tri3(s.clamp);
export const v4clamp = tri4(s.clamp);
export const v2saturate = map2(s.saturate);
export const v3saturate = map3(s.saturate);
export const v4saturate = map4(s.saturate);
/** `mix(a, b, t)` with a vector `t`. */
export const v2mix = tri2(s.mix);
export const v3mix = tri3(s.mix);
export const v4mix = tri4(s.mix);
/** `mix(a, b, t)` with a scalar `t`. */
export const v2mixs = tri2s(s.mix);
export const v3mixs = tri3s(s.mix);
export const v4mixs = tri4s(s.mix);
/** `step(edge, x)`. */
export const v2step = zip2(s.step);
export const v3step = zip3(s.step);
export const v4step = zip4(s.step);
/** `smoothstep(e0, e1, x)`. */
export const v2smoothstep = tri2(s.smoothstep);
export const v3smoothstep = tri3(s.smoothstep);
export const v4smoothstep = tri4(s.smoothstep);
export const v2sqrt = map2(s.sqrt);
export const v3sqrt = map3(s.sqrt);
export const v4sqrt = map4(s.sqrt);
export const v2inverseSqrt = map2(s.inverseSqrt);
export const v3inverseSqrt = map3(s.inverseSqrt);
export const v4inverseSqrt = map4(s.inverseSqrt);
export const v2pow = zip2(s.pow);
export const v3pow = zip3(s.pow);
export const v4pow = zip4(s.pow);
export const v2exp = map2(s.exp);
export const v3exp = map3(s.exp);
export const v4exp = map4(s.exp);
export const v2exp2 = map2(s.exp2);
export const v3exp2 = map3(s.exp2);
export const v4exp2 = map4(s.exp2);
export const v2log = map2(s.log);
export const v3log = map3(s.log);
export const v4log = map4(s.log);
export const v2log2 = map2(s.log2);
export const v3log2 = map3(s.log2);
export const v4log2 = map4(s.log2);
export const v2sin = map2(s.sin);
export const v3sin = map3(s.sin);
export const v4sin = map4(s.sin);
export const v2cos = map2(s.cos);
export const v3cos = map3(s.cos);
export const v4cos = map4(s.cos);
export const v2tan = map2(s.tan);
export const v3tan = map3(s.tan);
export const v4tan = map4(s.tan);
export const v2asin = map2(s.asin);
export const v3asin = map3(s.asin);
export const v4asin = map4(s.asin);
export const v2acos = map2(s.acos);
export const v3acos = map3(s.acos);
export const v4acos = map4(s.acos);
export const v2atan = map2(s.atan);
export const v3atan = map3(s.atan);
export const v4atan = map4(s.atan);
/** `atan2(y, x)`. */
export const v2atan2 = zip2(s.atan2);
export const v3atan2 = zip3(s.atan2);
export const v4atan2 = zip4(s.atan2);
export const v2floor = map2(s.floor);
export const v3floor = map3(s.floor);
export const v4floor = map4(s.floor);
export const v2ceil = map2(s.ceil);
export const v3ceil = map3(s.ceil);
export const v4ceil = map4(s.ceil);
export const v2trunc = map2(s.trunc);
export const v3trunc = map3(s.trunc);
export const v4trunc = map4(s.trunc);
export const v2fract = map2(s.fract);
export const v3fract = map3(s.fract);
export const v4fract = map4(s.fract);
export const v2sign = map2(s.sign);
export const v3sign = map3(s.sign);
export const v4sign = map4(s.sign);
/** `round(v)`, halves to even. */
export const v2round = map2(s.round);
export const v3round = map3(s.round);
export const v4round = map4(s.round);
export const v2radians = map2(s.radians);
export const v3radians = map3(s.radians);
export const v4radians = map4(s.radians);
export const v2degrees = map2(s.degrees);
export const v3degrees = map3(s.degrees);
export const v4degrees = map4(s.degrees);

// ---------------------------------------------------------------------------------------------
// Geometric intrinsics

/** `dot(a, b)`: products rounded, summed left to right. */
export function v2dot(a: Vec2, b: Vec2): number {
  return fr(fr(a.x * b.x) + fr(a.y * b.y));
}

/** `dot(a, b)`. */
export function v3dot(a: Vec3, b: Vec3): number {
  return fr(fr(fr(a.x * b.x) + fr(a.y * b.y)) + fr(a.z * b.z));
}

/** `dot(a, b)`. */
export function v4dot(a: Vec4, b: Vec4): number {
  return fr(fr(fr(fr(a.x * b.x) + fr(a.y * b.y)) + fr(a.z * b.z)) + fr(a.w * b.w));
}

/** `length(v) = sqrt(dot(v, v))`. */
export function v2length(v: Vec2): number {
  return fr(Math.sqrt(v2dot(v, v)));
}

/** `length(v)`. */
export function v3length(v: Vec3): number {
  return fr(Math.sqrt(v3dot(v, v)));
}

/** `length(v)`. */
export function v4length(v: Vec4): number {
  return fr(Math.sqrt(v4dot(v, v)));
}

/** `distance(a, b) = length(a - b)`. */
export function v2distance(a: Vec2, b: Vec2): number {
  return v2length(v2sub(a, b));
}

/** `distance(a, b)`. */
export function v3distance(a: Vec3, b: Vec3): number {
  return v3length(v3sub(a, b));
}

/** `distance(a, b)`. */
export function v4distance(a: Vec4, b: Vec4): number {
  return v4length(v4sub(a, b));
}

/** `cross(a, b) = (a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x)`. */
export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: fr(fr(a.y * b.z) - fr(a.z * b.y)),
    y: fr(fr(a.z * b.x) - fr(a.x * b.z)),
    z: fr(fr(a.x * b.y) - fr(a.y * b.x)),
  };
}

/**
 * `normalize(v)`: each component divided by `length(v)`. When that length is `0` (the zero vector,
 * or a vector so small that the squared length underflows) the result is the zero vector on the
 * CPU; non-portable on the GPU.
 */
export function v2normalize(v: Vec2): Vec2 {
  const len = v2length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: fr(v.x / len), y: fr(v.y / len) };
}

/** `normalize(v)` (zero length gives the zero vector). */
export function v3normalize(v: Vec3): Vec3 {
  const len = v3length(v);
  return len === 0 ? { x: 0, y: 0, z: 0 } : { x: fr(v.x / len), y: fr(v.y / len), z: fr(v.z / len) };
}

/** `normalize(v)` (zero length gives the zero vector). */
export function v4normalize(v: Vec4): Vec4 {
  const len = v4length(v);
  return len === 0
    ? { x: 0, y: 0, z: 0, w: 0 }
    : { x: fr(v.x / len), y: fr(v.y / len), z: fr(v.z / len), w: fr(v.w / len) };
}

/** `reflect(i, n) = i - 2 * dot(n, i) * n`, evaluated as `t = 2 * dot(n, i)`, `i - t * n`. */
export function v2reflect(i: Vec2, n: Vec2): Vec2 {
  const t = fr(2 * v2dot(n, i));
  return { x: fr(i.x - fr(t * n.x)), y: fr(i.y - fr(t * n.y)) };
}

/** `reflect(i, n)`. */
export function v3reflect(i: Vec3, n: Vec3): Vec3 {
  const t = fr(2 * v3dot(n, i));
  return { x: fr(i.x - fr(t * n.x)), y: fr(i.y - fr(t * n.y)), z: fr(i.z - fr(t * n.z)) };
}

/** `reflect(i, n)`. */
export function v4reflect(i: Vec4, n: Vec4): Vec4 {
  const t = fr(2 * v4dot(n, i));
  return {
    x: fr(i.x - fr(t * n.x)),
    y: fr(i.y - fr(t * n.y)),
    z: fr(i.z - fr(t * n.z)),
    w: fr(i.w - fr(t * n.w)),
  };
}
