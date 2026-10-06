/**
 * Host-input codecs of `spec/runtime-abi.md` section 6.3: decode a JS value into the
 * CPU representation of section 4.1, or reject it with `MTEK-E8041` / `MTEK-E8100`.
 */
import type { MtekHostInputCodec } from "../abi/manifest-types.js";
import type { Color } from "../scene/values.js";

export type CodecOk = { readonly ok: true; readonly value: unknown };
export type CodecErr = { readonly ok: false; readonly code: "MTEK-E8041" | "MTEK-E8100"; readonly message: string };
export type CodecResult = CodecOk | CodecErr;

const MAX_STRING_BYTES = 64 * 1024;
const fr = Math.fround;

function wrongType(codec: string, expected: string, value: unknown): CodecErr {
  return {
    ok: false,
    code: "MTEK-E8041",
    message: `Host input codec '${codec}' expected ${expected}, got ${describe(value)}.`,
  };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `string ${JSON.stringify(value)}`;
  if (typeof value === "number") return Number.isFinite(value) ? `number ${value}` : `number ${String(value)}`;
  if (typeof value === "boolean") return `boolean ${value}`;
  if (Array.isArray(value)) return `array of length ${value.length}`;
  if (typeof value === "object") return "object";
  return typeof value;
}

function decodeF32(value: unknown): CodecResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return wrongType("f32", "a finite number", value);
  }
  return { ok: true, value: fr(value) };
}

function decodeI32(value: unknown): CodecResult {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    return wrongType("i32", "an integer number in i32 range", value);
  }
  return { ok: true, value };
}

function decodeU32(value: unknown): CodecResult {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    return wrongType("u32", "an integer number in u32 range", value);
  }
  return { ok: true, value };
}

function decodeBool(value: unknown): CodecResult {
  if (typeof value !== "boolean") return wrongType("bool", "a boolean", value);
  return { ok: true, value };
}

function decodeVec(codec: "vec2" | "vec3" | "vec4", n: number, value: unknown): CodecResult {
  if (!Array.isArray(value) || value.length !== n || !value.every((c) => typeof c === "number" && Number.isFinite(c))) {
    return wrongType(codec, `a number[] of length ${n} with finite components`, value);
  }
  const comps = (value as number[]).map((c) => fr(c));
  if (n === 2) return { ok: true, value: { x: comps[0], y: comps[1] } };
  if (n === 3) return { ok: true, value: { x: comps[0], y: comps[1], z: comps[2] } };
  return { ok: true, value: { x: comps[0], y: comps[1], z: comps[2], w: comps[3] } };
}

function decodeString(value: unknown): CodecResult {
  if (typeof value !== "string") return wrongType("string", "a string", value);
  if (new TextEncoder().encode(value).length > MAX_STRING_BYTES) {
    return {
      ok: false,
      code: "MTEK-E8041",
      message: `Host input codec 'string' rejects strings longer than ${MAX_STRING_BYTES} bytes.`,
    };
  }
  return { ok: true, value };
}

/**
 * Exact sRGB EOTF of one 8-bit channel for colour literals (`spec/language.md` §5.4):
 * `f64` transfer, rounded once to `f32`.
 */
export function srgb8ToLinear(channel: number): number {
  const c = channel / 255;
  const linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return fr(linear);
}

const HEX = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;

/** Decode `#rrggbb` / `#rrggbbaa` exactly as a colour literal (`spec/language.md` §5.4). */
export function decodeColorHex(value: unknown, opaque: boolean): CodecResult {
  const codec = opaque ? "color-hex-opaque" : "color-hex";
  if (typeof value !== "string") return wrongType(codec, "a hex colour string (#rrggbb or #rrggbbaa)", value);
  const match = HEX.exec(value);
  if (match === null) {
    return {
      ok: false,
      code: "MTEK-E8041",
      message: `Host input codec '${codec}' expected "#rrggbb" or "#rrggbbaa", got ${JSON.stringify(value)}.`,
    };
  }
  const rgb = match[1]!;
  const alphaHex = match[2];
  if (opaque && alphaHex !== undefined && alphaHex.toLowerCase() !== "ff") {
    return {
      ok: false,
      code: "MTEK-E8100",
      message: `Host input codec 'color-hex-opaque' rejects non-opaque colour ${JSON.stringify(value)}: alpha must be ff or omitted.`,
    };
  }
  const r8 = Number.parseInt(rgb.slice(0, 2), 16);
  const g8 = Number.parseInt(rgb.slice(2, 4), 16);
  const b8 = Number.parseInt(rgb.slice(4, 6), 16);
  const a8 = alphaHex === undefined ? 255 : Number.parseInt(alphaHex, 16);
  const color: Color = {
    r: srgb8ToLinear(r8),
    g: srgb8ToLinear(g8),
    b: srgb8ToLinear(b8),
    a: fr(a8 / 255),
  };
  return { ok: true, value: color };
}

/** Decode `value` with the manifest codec id. */
export function decodeHostInput(codec: MtekHostInputCodec, value: unknown): CodecResult {
  switch (codec) {
    case "f32":
      return decodeF32(value);
    case "i32":
      return decodeI32(value);
    case "u32":
      return decodeU32(value);
    case "bool":
      return decodeBool(value);
    case "vec2":
      return decodeVec("vec2", 2, value);
    case "vec3":
      return decodeVec("vec3", 3, value);
    case "vec4":
      return decodeVec("vec4", 4, value);
    case "string":
      return decodeString(value);
    case "color-hex":
      return decodeColorHex(value, false);
    case "color-hex-opaque":
      return decodeColorHex(value, true);
  }
}
