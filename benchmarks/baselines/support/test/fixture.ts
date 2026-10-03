// `mtek test` fixtures (spec/tooling.md section 6 plus `set_input`, decision 0018) as typed data. The
// baseline tests run the very same fixtures as the Mtek side (decision 0018, section 8), so the
// expectations exist once.
import { isTable, parseToml, type TomlValue } from "../../../tools/toml-subset.mjs";

export type Step =
  | { readonly kind: "step"; readonly frames: number; readonly dt: number }
  | { readonly kind: "press"; readonly code: string }
  | { readonly kind: "release"; readonly code: string }
  | { readonly kind: "set_input"; readonly name: string; readonly value: TomlValue }
  | { readonly kind: "expect_state" }
  | {
      readonly kind: "expect_pixel";
      readonly x: number;
      readonly y: number;
      /** `#rrggbb`, lower case. */
      readonly color: string;
      /** Largest allowed absolute difference per channel; 2 when the fixture does not say. */
      readonly tolerance: number;
    };

export interface Fixture {
  readonly name: string;
  readonly steps: readonly Step[];
}

export const DEFAULT_TOLERANCE = 2;

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function integer(value: TomlValue | undefined, where: string, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(where, `${what} must be an integer`);
  return value;
}

function parseStep(raw: TomlValue, where: string): Step {
  if (!isTable(raw)) return fail(where, "a step must be an inline table");
  const keys = Object.keys(raw);
  if ("step" in raw) {
    const dt = raw["dt"];
    if (keys.length !== 2 || typeof dt !== "number") return fail(where, "a step needs exactly step and dt");
    return { kind: "step", frames: integer(raw["step"], where, "step"), dt };
  }
  const [action] = keys;
  if (keys.length !== 1 || action === undefined) return fail(where, "a step has exactly one action key");
  const value = raw[action];
  switch (action) {
    case "press":
    case "release":
      if (typeof value !== "string") return fail(where, `${action} must be a string`);
      return { kind: action, code: value };
    case "set_input": {
      const entries = isTable(value) ? Object.entries(value) : [];
      const [entry] = entries;
      if (entries.length !== 1 || entry === undefined) return fail(where, "set_input must have exactly one entry");
      return { kind: "set_input", name: entry[0], value: entry[1] };
    }
    case "expect_state":
      return { kind: "expect_state" };
    case "expect_pixel": {
      if (!isTable(value)) return fail(where, "expect_pixel must be a table");
      const color = value["color"];
      if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(where, 'color must be "#rrggbb"');
      const tolerance = value["tolerance"] === undefined ? DEFAULT_TOLERANCE : integer(value["tolerance"], where, "tolerance");
      return {
        kind: "expect_pixel",
        x: integer(value["x"], where, "x"),
        y: integer(value["y"], where, "y"),
        color: color.toLowerCase(),
        tolerance,
      };
    }
    default:
      return fail(where, `unknown step '${action}'`);
  }
}

/** Parses the text of a `*.test.toml` file. @throws {Error} on anything outside the step vocabulary. */
export function parseFixture(text: string, file: string): Fixture {
  const toml = parseToml(text);
  const name = toml["name"];
  const steps = toml["steps"];
  if (typeof name !== "string" || name === "") return fail(file, "name must be a non-empty string");
  if (!Array.isArray(steps)) return fail(file, "steps must be an array");
  return { name, steps: steps.map((step, index) => parseStep(step, `${file} step ${String(index + 1)}`)) };
}

/** `#rrggbb` as three bytes. */
export function hexToBytes(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
