import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE, hexToBytes, parseFixture } from "./fixture.ts";

describe("parseFixture", () => {
  it("reads every step kind and applies the default tolerance", () => {
    const fixture = parseFixture(
      `name = "all"
steps = [
  { step = 2, dt = 0.5 },
  { press = "Space" },
  { release = "Space" },
  { set_input = { tint = "#ff8800" } },
  { expect_state = { speed = -0.7 } },
  { expect_pixel = { x = 1, y = 2, color = "#ABCDEF" } },
  { expect_pixel = { x = 3, y = 4, color = "#000000", tolerance = 0 } },
]
`,
      "all.test.toml",
    );
    expect(fixture.name).toBe("all");
    expect(fixture.steps).toEqual([
      { kind: "step", frames: 2, dt: 0.5 },
      { kind: "press", code: "Space" },
      { kind: "release", code: "Space" },
      { kind: "set_input", name: "tint", value: "#ff8800" },
      { kind: "expect_state" },
      { kind: "expect_pixel", x: 1, y: 2, color: "#abcdef", tolerance: DEFAULT_TOLERANCE },
      { kind: "expect_pixel", x: 3, y: 4, color: "#000000", tolerance: 0 },
    ]);
  });

  it.each([
    ['name = "x"\nsteps = [ { tap = "A" } ]\n', /step 1: unknown step 'tap'/],
    ['name = "x"\nsteps = [ { step = 1 } ]\n', /step needs exactly step and dt/],
    ['name = "x"\nsteps = [ { step = 1.5, dt = 0.1 } ]\n', /step must be an integer/],
    ['name = "x"\nsteps = [ { set_input = { a = 1, b = 2 } } ]\n', /exactly one entry/],
    ['name = "x"\nsteps = [ { expect_pixel = { x = 1, y = 1, color = "red" } } ]\n', /color must be "#rrggbb"/],
    ['steps = []\n', /name must be a non-empty string/],
    ['name = "x"\n', /steps must be an array/],
  ])("rejects %j", (text, message) => {
    expect(() => parseFixture(text, "bad.test.toml")).toThrow(message);
  });
});

describe("hexToBytes", () => {
  it("splits #rrggbb into bytes", () => {
    expect(hexToBytes("#6b5cff")).toEqual([107, 92, 255]);
  });
});
