import { describe, expect, it } from "vitest";
import { identity } from "../math/mat4.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { referenceTangentFrame } from "../test-support/tangent-reference.js";
import { deformSkin } from "./skinning.js";

const skin = { ...animatedSkin(), indices: [[0, 1, 2, 0]], weights: [[1, 0, 0, 0]] };
const positions = new Float32Array([1, 2, 3]);
function run(palette: Float32Array, normal: number[], tangent: number[], weights = skin.weights[0]!): { p: Float32Array; n: Float32Array; t: Float32Array } {
  const p = new Float32Array(3), n = new Float32Array(3), t = new Float32Array(4);
  deformSkin({ ...skin, weights: [weights] }, palette, positions, Float32Array.from(normal), p, n, Float32Array.from(tangent), t);
  return { p, n, t };
}
function close(actual: ArrayLike<number>, expected: number[]): void {
  for (let k = 0; k < expected.length; k++) expect(actual[k]).toBeCloseTo(expected[k]!, 6);
}

describe("authored tangent deformation foundation", () => {
  it("uses the linear tangent transform under nonuniform scale, rather than the normal matrix", () => {
    const palette = identity(); palette[0] = 2; palette[5] = 1; palette[10] = 3;
    const { p, n, t } = run(palette, [Math.SQRT1_2, Math.SQRT1_2, 0], [Math.SQRT1_2, -Math.SQRT1_2, 0, 1]);
    close(p, [2, 2, 9]); close(n, [1 / Math.sqrt(5), 2 / Math.sqrt(5), 0]); close(t, [2 / Math.sqrt(5), -1 / Math.sqrt(5), 0, 1]);
  });

  it("preserves both UV handedness signs and flips them only for a reflected transform", () => {
    for (const reflected of [false, true]) for (const sign of [-1, 1]) {
      const palette = identity(); palette[0] = reflected ? -2 : 2;
      close(run(palette, [0, 0, 1], [1, 0, 0, sign]).t, [reflected ? -1 : 1, 0, 0, reflected ? -sign : sign]);
    }
  });

  it("orthogonalizes a frame against its final inverse-transpose normal", () => {
    const palette = identity(); palette[4] = 0.7; palette[5] = 1.5; palette[8] = 0.4;
    const result = run(palette, [0, 0, 1], [1, 0, 0.01, 1]);
    close(result.t, [1, 0, 0, 1]); close(result.n, [0, 0, 1]);
  });

  it("matches a pivoted inversion oracle for blended, sheared and reflected frames", () => {
    const palette = new Float32Array(48);
    for (let j = 0; j < 3; j++) {
      const m = identity(), angle = 0.3 + j * 0.2;
      m[0] = -Math.cos(angle) * (1 + j); m[1] = -Math.sin(angle) * (1 + j);
      m[4] = -Math.sin(angle) * 0.5; m[5] = Math.cos(angle) * 0.5; m[8] = 0.3;
      palette.set(m, j * 16);
    }
    for (const weights of [[0.25, 0.5, 0.25, 0], [0.5, 0.5, 0, 0], [1, 0, 0, 0]]) {
      const normal = [Math.SQRT1_2, Math.SQRT1_2, 0], tangent = [Math.SQRT1_2, -Math.SQRT1_2, 0, -1];
      const expected = referenceTangentFrame(palette, skin.indices[0]!, weights, normal, tangent), actual = run(palette, normal, tangent, weights);
      close(actual.n, expected.normal); close(actual.t, expected.tangent); expect(actual.t[3]).toBe(1);
    }
  });

  it("emits an unavailable-frame sentinel for missing or collapsed tangents and singular transforms", () => {
    close(run(identity(), [0, 0, 1], [1, 0, 0, 0]).t, [0, 0, 0, 0]);
    close(run(identity(), [0, 0, 1], [0, 0, 1, 1]).t, [0, 0, 0, 0]);
    const singular = identity(); singular[0] = 0;
    close(run(singular, [0, 0, 1], [1, 0, 0, 1]).t, [0, 0, 0, 0]);
  });

  it("rejects incomplete tangent storage before writing any output", () => {
    const p = new Float32Array([99, 99, 99]), n = new Float32Array(3), t = new Float32Array(4);
    for (const [normal, input, output] of [[undefined, t, t], [n, t, undefined], [n, undefined, t], [n, new Float32Array(3), t], [n, t, new Float32Array(3)]] as const) {
      expect(() => deformSkin(skin, identity(), positions, normal, p, n, input, output)).toThrow(RangeError);
      expect(Array.from(p)).toEqual([99, 99, 99]);
    }
  });
});
