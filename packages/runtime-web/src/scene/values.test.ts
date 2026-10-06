import { describe, expect, it } from "vitest";
import { paramValueProblem } from "./values.js";

describe("paramValueProblem", () => {
  const accepted: Array<[string, unknown]> = [
    ["f32", 0.5],
    ["f32", -0],
    ["i32", -(2 ** 31)],
    ["i32", 2 ** 31 - 1],
    ["u32", 0],
    ["u32", 2 ** 32 - 1],
    ["bool", false],
    ["vec2", { x: 1, y: 2 }],
    ["vec3", { x: 1, y: 2, z: 3 }],
    ["vec4", { x: 1, y: 2, z: 3, w: 4 }],
    ["quat", { x: 0, y: 0, z: 0, w: 1 }],
    ["color", { r: 0.1, g: 0.2, b: 0.3, a: 1 }],
    ["mat4", new Float32Array(16)],
    ["struct Light", { intensity: 1 }],
    ["array<f32, 2>", [1, 2]],
  ];
  it.each(accepted)("accepts a valid %s", (type, value) => {
    expect(paramValueProblem(type, value)).toBeUndefined();
  });

  const rejected: Array<[string, unknown]> = [
    ["f32", Number.NaN],
    ["f32", Number.POSITIVE_INFINITY],
    ["f32", "1"],
    ["i32", 0.5],
    ["i32", 2 ** 31],
    ["u32", -1],
    ["u32", 2 ** 32],
    ["bool", 1],
    ["vec2", { x: 1 }],
    ["vec3", { x: 1, y: 2, z: Number.NaN }],
    ["vec4", { x: 1, y: 2, z: 3 }],
    ["quat", { x: 0, y: 0, z: 0 }],
    ["color", { x: 1, y: 1, z: 1 }],
    ["color", null],
    ["mat4", new Float32Array(9)],
    ["mat4", [1, 2, 3]],
    ["struct Light", 5],
    ["struct Light", null],
  ];
  it.each(rejected)("rejects an invalid %s", (type, value) => {
    expect(paramValueProblem(type, value)).toEqual(expect.any(String));
  });
});
