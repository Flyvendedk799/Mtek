// How the expectations of a fixture are compared with what the program shows (decision 0074).
// Pure functions: every one returns the lines that describe a mismatch, none when the expectation
// holds. They never throw on a value of an unexpected kind; that is a mismatch too.
import type { CounterEntry, StateEntry } from "./plan.ts";

/** One binary32 rounding step relative to the expected value, added to every numeric tolerance. */
export const F32_RELATIVE_STEP = 2 ** -23;

/**
 * Whether `actual` is within `tolerance` of `expected`, plus one binary32 rounding step of `expected`
 * (`spec/testing.md` section 5: "plus 1 ULP for CPU rounding"): state is stored as `f32`, so `0.7` in a
 * fixture is within rounding of the stored value even with a tolerance of 0.
 */
export function withinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance + Math.abs(expected) * F32_RELATIVE_STEP;
}

/** A number as text without binary32 noise (`0.699999988` for the `f32` nearest 0.7). */
export function formatNumber(value: number): string {
  return String(Number(value.toPrecision(9)));
}

const VECTOR_KEYS = ["x", "y", "z", "w"] as const;
const COLOR_KEYS = ["r", "g", "b", "a"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The labelled components of a vector, a quaternion or a colour as the runtime shows them, or null. */
function components(value: unknown): { labels: readonly string[]; values: number[] } | null {
  if (!isRecord(value)) return null;
  for (const keys of [COLOR_KEYS, VECTOR_KEYS]) {
    const values: number[] = [];
    for (const key of keys) {
      const component = value[key];
      if (typeof component !== "number") break;
      values.push(component);
    }
    // A vector has its first n keys (x, y[, z[, w]]); a colour all four of r, g, b, a.
    const complete = keys === COLOR_KEYS ? values.length === 4 : values.length >= 2;
    if (complete && values.length === Object.keys(value).length) return { labels: keys, values };
  }
  return null;
}

/** A value of the program's state as short text. */
export function describeValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  const parts = components(value);
  if (parts !== null) return `(${parts.values.map(formatNumber).join(", ")})`;
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;

/** `#rrggbb[aa]` as the linear components of a colour literal (`spec/runtime-abi.md` section 6.3). */
export function hexToLinear(hex: string): [number, number, number, number] | null {
  const match = HEX_COLOR.exec(hex);
  if (match === null) return null;
  const channel = (digits: string | undefined): number => {
    const c = Number.parseInt(digits ?? "ff", 16) / 255;
    return Math.fround(c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  };
  return [
    channel(match[1]),
    channel(match[2]),
    channel(match[3]),
    Math.fround(Number.parseInt(match[4] ?? "ff", 16) / 255),
  ];
}

/** The tolerance of a colour state compared with a `#rrggbb` string. */
export const COLOR_STATE_TOLERANCE = 1e-5;

/** What `app.debug.scene()` shows that a fixture can address: the scene state and the named entities. */
export interface SceneView {
  state: Record<string, unknown>;
  entities: ReadonlyArray<{
    name: string;
    position: unknown;
    rotation: unknown;
    mat?: { p: Record<string, unknown> };
  }>;
}

type Lookup = { ok: true; value: unknown; label: string } | { ok: false; message: string };

function listed(names: readonly string[]): string {
  return names.length === 0 ? "none" : [...names].sort().join(", ");
}

/**
 * The value an `expect_state` key addresses: `name` is scene state; `Entity.position`, `Entity.rotation`
 * and `Entity.material.param` are the pose and the material parameters of a named entity (decision 0074).
 */
export function lookup(scene: SceneView, key: string): Lookup {
  const parts = key.split(".");
  const [first, second, third] = parts;
  if (parts.length === 1) {
    if (!(key in scene.state)) {
      return {
        ok: false,
        message: `there is no scene state '${key}' (state: ${listed(Object.keys(scene.state))})`,
      };
    }
    return { ok: true, value: scene.state[key], label: `state '${key}'` };
  }
  const entity = scene.entities.find((candidate) => candidate.name === first);
  if (entity === undefined) {
    return {
      ok: false,
      message: `there is no named entity '${first ?? ""}' (entities: ${listed(scene.entities.map((e) => e.name))})`,
    };
  }
  if (parts.length === 2 && (second === "position" || second === "rotation")) {
    return { ok: true, value: entity[second], label: `'${key}'` };
  }
  if (parts.length === 3 && second === "material" && third !== undefined) {
    const params = entity.mat?.p;
    if (params === undefined || !(third in params)) {
      return {
        ok: false,
        message: `entity '${entity.name}' has no material parameter '${third}' (parameters: ${listed(Object.keys(params ?? {}))})`,
      };
    }
    return { ok: true, value: params[third], label: `'${key}'` };
  }
  return {
    ok: false,
    message: `'${key}' addresses nothing: use a state name, Entity.position, Entity.rotation or Entity.material.param`,
  };
}

/**
 * The index of the first component of `actual` that differs from `expected`, or -1. For a rotation
 * (`signless`) `-expected` is the same rotation and matches too.
 */
function firstDifference(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  signless: boolean,
): number {
  const differing = (wanted: readonly number[]): number =>
    actual.findIndex((value, index) => !withinTolerance(value, wanted[index] ?? NaN, tolerance));
  const direct = differing(expected);
  if (direct < 0 || !signless) return direct;
  return differing(expected.map((value) => -value)) < 0 ? -1 : direct;
}

/** The mismatch of one state entry, or null. */
function compareStateEntry(scene: SceneView, entry: StateEntry): string | null {
  const found = lookup(scene, entry.name);
  if (!found.ok) return found.message;
  const actual = found.value;
  const { expected } = entry;
  const shown = `${found.label} is ${describeValue(actual)}`;
  const tolerance = entry.tolerance ?? 0;
  if (typeof expected === "number") {
    if (typeof actual !== "number") return `${shown}, expected the number ${formatNumber(expected)}`;
    if (withinTolerance(actual, expected, tolerance)) return null;
    return `${shown}, expected ${formatNumber(expected)} (tolerance ${formatNumber(tolerance)})`;
  }
  if (typeof expected === "boolean") {
    return actual === expected ? null : `${shown}, expected ${String(expected)}`;
  }
  if (typeof expected === "string") {
    const colour = hexToLinear(expected);
    const parts = components(actual);
    if (colour !== null && parts !== null && parts.labels === COLOR_KEYS) {
      const differs = parts.values.findIndex(
        (value, index) => !withinTolerance(value, colour[index] ?? NaN, COLOR_STATE_TOLERANCE),
      );
      if (differs < 0) return null;
      return `${shown} (linear), expected the colour ${expected} (${colour.map(formatNumber).join(", ")} linear)`;
    }
    return actual === expected ? null : `${shown}, expected ${JSON.stringify(expected)}`;
  }
  const parts = components(actual);
  const wanted = `(${expected.map(formatNumber).join(", ")})`;
  if (parts === null) return `${shown}, expected the vector ${wanted}`;
  if (parts.values.length !== expected.length) {
    return `${shown}, expected a vector of ${String(expected.length)} components ${wanted}`;
  }
  const differs = firstDifference(parts.values, expected, tolerance, entry.name.endsWith(".rotation"));
  if (differs < 0) return null;
  return `${shown}, expected ${wanted}: component ${parts.labels[differs] ?? String(differs)} differs (tolerance ${formatNumber(tolerance)})`;
}

/** The mismatches of the entries of an `expect_state` step against the scene. */
export function compareState(scene: SceneView, entries: readonly StateEntry[]): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const line = compareStateEntry(scene, entry);
    if (line !== null) lines.push(line);
  }
  return lines;
}

/** The mismatches of the entries of an `expect_counter` step against the counters. */
export function compareCounters(
  counters: Readonly<Record<string, number>>,
  entries: readonly CounterEntry[],
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const actual = counters[entry.name];
    if (actual === undefined) {
      lines.push(
        `there is no counter '${entry.name}' (counters: ${Object.keys(counters).sort().join(", ")})`,
      );
      continue;
    }
    const shown = `counter '${entry.name}' is ${formatNumber(actual)}`;
    if (entry.equals !== null) {
      if (actual !== entry.equals) lines.push(`${shown}, expected ${formatNumber(entry.equals)}`);
      continue;
    }
    const below = entry.min !== null && actual < entry.min;
    const above = entry.max !== null && actual > entry.max;
    if (below || above) {
      const range = [
        entry.min === null ? null : `at least ${formatNumber(entry.min)}`,
        entry.max === null ? null : `at most ${formatNumber(entry.max)}`,
      ]
        .filter((part) => part !== null)
        .join(" and ");
      lines.push(`${shown}, expected ${range}`);
    }
  }
  return lines;
}

/** `#rrggbb` of three bytes. */
export function toHex(bytes: readonly number[]): string {
  return `#${bytes
    .slice(0, 3)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The mismatch of one pixel (red, green, blue, alpha bytes) against `#rrggbb`, or null. Alpha is not compared. */
export function comparePixel(
  x: number,
  y: number,
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): string | null {
  let worst = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    worst = Math.max(worst, Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)));
  }
  if (worst <= tolerance) return null;
  return `pixel (${String(x)}, ${String(y)}) is ${toHex(actual)}, expected ${toHex(expected)} within ${String(tolerance)} per channel; it differs by ${String(worst)}`;
}
