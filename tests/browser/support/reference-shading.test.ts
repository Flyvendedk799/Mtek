// The PBR CPU reference (`reference-shading.ts`) checked against values derived by hand from
// spec/materials.md section 8. Every expectation below is an arithmetic expression whose derivation is
// written in the comment above it; none was read off the implementation.
//
// Rule numbers refer to the numbered list of section 8: (1) clamps, (2) GGX D, (3) height-correlated
// Smith visibility, (4) Schlick Fresnel, (5) specular and diffuse, (6) light radiance, (7) the sum.
//
// FORMULA REVIEW (task M4-01 part 3) AND ITS RESOLUTION (task M4-11, decision 0080). The M4-01 review
// compared section 8 rule by rule with the glTF Sample Renderer (`brdf.glsl`, `punctual.glsl`,
// `pbr.frag`) and Filament (`surface_light_punctual.fs`) and recorded the discrepancies as operator
// questions. The owner chose glTF / KHR_lights_punctual, keeping physical light units (camera exposure is
// task M4-12). Section 8 now reads:
//
//   Rule 2  GGX D                        f = (1 − NH²) + NH²·α² (the same value as NH²(α²−1)+1, without its
//                                        cancellation at NH ≈ 1 for small α², review note (e)).
//   Rule 3  Smith visibility             unchanged; the zero-denominator case is unreachable under the
//                                        clamps (>= 2.025e-7, see the test) and documented as such (f).
//   Rule 5  diffuse                      (1 − m)(1 − F_d)·c/π with the dielectric Fresnel F_d =
//                                        Schlick(0.04): glTF's mix(dielectric, metal, m) exactly (a).
//   Rule 6  point window                 clamp(1 − (d/range)⁴, 0, 1), not squared (KHR_lights_punctual), with
//                                        the 1e-4 floor of d² kept (b).
//   Rule 7  ambient                      (1 − m)·c·ambient: a metal gets no diffuse ambient (c).
//   Rule 8  no NaN                       a light term is 0 when NL <= 0 or L + V = 0 (g).
//
// The "formula review pins" below pin each resolved point against the glTF expression.
import { describe, expect, it } from "vitest";
import { linearRgbToSrgb8, linearToSrgb8, shadePbr, type Light, type ShadeInput, type Vec3 } from "./reference-shading.ts";

const PI = Math.PI;

/** Within `rel` of `expected` (relative, with an absolute floor of `rel` for expectations near 0). */
function expectClose(actual: number, expected: number, rel = 1e-12): void {
  expect(Math.abs(actual - expected), `${String(actual)} vs ${String(expected)}`).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));
}

function expectRgb(actual: Vec3, expected: Vec3, rel = 1e-12): void {
  expectClose(actual[0], expected[0], rel);
  expectClose(actual[1], expected[1], rel);
  expectClose(actual[2], expected[2], rel);
}

const WHITE: Vec3 = [1, 1, 1];
const NONE: Vec3 = [0, 0, 0];
const UP: Vec3 = [0, 0, 1];

/** A directional light that arrives from `toLight` (travelling along `−toLight`). */
function sun(toLight: Vec3, intensity = 1, color: Vec3 = WHITE): Light {
  return { kind: "directional", direction: [-toLight[0], -toLight[1], -toLight[2]], color, intensity };
}

/** Shading input with no ambient light; overrides come last. */
function scene(overrides: Partial<ShadeInput> & Pick<ShadeInput, "lights">): ShadeInput {
  return { N: UP, V: UP, baseColor: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5, ambientColor: WHITE, ambientIntensity: 0, ...overrides };
}

// Off-axis light: N = V = +Z, L = (0.6, 0, 0.8), dielectric, roughness 0.5, one white light of intensity 1.
// L + V = (0.6, 0, 1.8), |L+V|² = 0.36 + 3.24 = 3.6, so NH = 1.8/sqrt(3.6), NH² = 3.24/3.6 = 0.9, and
// VH = V·H = NH (V = N). NL = 0.8, NV = 1.
// Roughness 0.5: α² = 1/16. Rule 2: f = 0.9(1/16 − 1) + 1 = 1 − 0.84375 = 0.15625, D = (1/16)/(π · 0.15625²)
// = 0.0625/(π · 0.0244140625) = 2.56/π. Rule 3: sqrt(NV²(1−α²)+α²) = 1, and
// sqrt(0.64 · 0.9375 + 0.0625) = sqrt(0.6625); Vis = 0.5/(0.8·1 + 1·sqrt(0.6625)).
// Rule 4: VH = 1.8/sqrt(3.6) = 3/sqrt(10); F = 0.04 + 0.96 (1 − VH)⁵. Rule 7: ((1−F)c/π + D·Vis·F) · NL.
function offAxis(c: number): number {
  const vh = 3 / Math.sqrt(10);
  const f = 0.04 + 0.96 * (1 - vh) ** 5;
  const vis = 0.5 / (0.8 + Math.sqrt(0.6625));
  return (((1 - f) * c) / PI + (2.56 / PI) * vis * f) * 0.8;
}

describe("normal incidence, N = V = L = +Z, white light of intensity 1", () => {
  // NL = NV = NH = VH = 1, so (1−VH)⁵ = 0 and F = F0.
  // Rule 2 with NH = 1: f = α²−1+1 = α², D = α²/(π α⁴) = 1/(π α²).
  // Rule 3 with NL = NV = 1: sqrt(1·(1−α²)+α²) = 1 for every α, Vis = 0.5/(1+1) = 1/4.
  // So specular = F0/(4π α²) and the radiance is (diffuse + specular)·E·NL with E = NL = 1.

  it("roughness 0.5, metallic 0: α = 0.25, α² = 1/16, D = 16/π", () => {
    // Specular = (16/π)·(1/4)·0.04 = 0.16/π for every channel. Diffuse = (1−0.04)·c/π = 0.96c/π.
    // c = 0.5 → (0.16+0.48)/π = 0.64/π; c = 0.25 → (0.16+0.24)/π = 0.40/π; c = 1 → 1.12/π.
    const rgb = shadePbr(scene({ lights: [sun(UP)], baseColor: [0.5, 0.25, 1] }));
    expectRgb(rgb, [0.64 / PI, 0.4 / PI, 1.12 / PI]);
  });

  it("roughness 0.5, metallic 1: F0 = c, no diffuse, specular = c/(4π α²) = 4c/π", () => {
    // 1/(4π·(1/16)) = 4/π. c = (1, 0.5, 0.25) → (4/π, 2/π, 1/π).
    const rgb = shadePbr(scene({ lights: [sun(UP)], baseColor: [1, 0.5, 0.25], metallic: 1 }));
    expectRgb(rgb, [4 / PI, 2 / PI, 1 / PI]);
  });

  it("roughness 1: α² = 1, D = 1/π for any NH, Vis = 1/4", () => {
    // Metallic 1, c = 1: F = 1, specular = (1/π)(1/4) = 0.25/π.
    expectRgb(shadePbr(scene({ lights: [sun(UP)], baseColor: WHITE, metallic: 1, roughness: 1 })), [0.25 / PI, 0.25 / PI, 0.25 / PI]);
    // Metallic 0, c = 0.5: (0.04·0.25 + 0.96·0.5)/π = (0.01 + 0.48)/π = 0.49/π.
    expectRgb(shadePbr(scene({ lights: [sun(UP)], roughness: 1 })), [0.49 / PI, 0.49 / PI, 0.49 / PI]);
  });

  it("roughness 0.045 (the clamp floor): α = 0.045² = 0.002025, α² = 0.045⁴ = 4.100625e-6", () => {
    // Metallic 1, c = 1: F = 1, specular = 1/(4π α²) = 1/(4π · 4.100625e-6) ≈ 19 4xx. A huge but finite
    // value, which is why the sphere highlight of a mirror-like material clips to white.
    // Tolerance 1e-9 (not 1e-12): rule 2 forms f = NH²(α²−1) + 1, which at NH = 1 cancels to α² = 4.1e-6
    // and so loses about log10(1/4.1e-6) ≈ 5.4 of the 16 digits an f64 holds (observed: 1.5e-12 relative).
    // In binary32 the same cancellation leaves only about 2 digits (review note (e), a shader-side concern).
    const alpha2 = 0.045 ** 4;
    const expected = 1 / (4 * PI * alpha2);
    expectRgb(shadePbr(scene({ lights: [sun(UP)], baseColor: WHITE, metallic: 1, roughness: 0.045 })), [expected, expected, expected], 1e-9);
    // Away from the peak the same material is almost black. N = V = +Z, L = (0.6, 0, 0.8) (see `offAxis`):
    // NH² = 0.9, so D = α²/(π (0.9(α²−1)+1)²) = α²/(π (0.1+0.9α²)²) ≈ 4.1e-6/(π · 0.01) ≈ 1.3e-4.
    // Vis = 0.5/(0.8 + sqrt(0.64(1−α²)+α²)) ≈ 0.31, F = 1 (metal, c = 1), and rule 7 multiplies by NL = 0.8.
    const off = shadePbr(scene({ lights: [sun([0.6, 0, 0.8])], baseColor: WHITE, metallic: 1, roughness: 0.045 }));
    const D = alpha2 / (PI * (0.1 + 0.9 * alpha2) ** 2);
    const vis = 0.5 / (0.8 + Math.sqrt(0.64 * (1 - alpha2) + alpha2));
    expectClose(off[0], D * vis * 0.8, 1e-9);
    expect(off[0]).toBeLessThan(1e-3);
  });

  it("clamps roughness to [0.045, 1] and metallic to [0, 1] (rule 1)", () => {
    // roughness 0, −3 and 0.01 all clamp to 0.045; roughness 7 clamps to 1; metallic −1 → 0 and 2 → 1.
    // So each equals the value of the clamped parameter, which the tests above derived by hand.
    const metal = (roughness: number): Vec3 => shadePbr(scene({ lights: [sun(UP)], baseColor: WHITE, metallic: 1, roughness }));
    const floor = 1 / (4 * PI * 0.045 ** 4);
    for (const r of [0, -3, 0.01]) expectRgb(metal(r), [floor, floor, floor], 1e-9);
    expectRgb(metal(7), [0.25 / PI, 0.25 / PI, 0.25 / PI]);
    expectRgb(shadePbr(scene({ lights: [sun(UP)], metallic: -1 })), [0.64 / PI, 0.64 / PI, 0.64 / PI]);
    expectRgb(shadePbr(scene({ lights: [sun(UP)], metallic: 2, baseColor: [1, 0.5, 0.25] })), [4 / PI, 2 / PI, 1 / PI]);
  });

  it("intermediate metallic follows rule 5: m = 0.5, c = 0.5, roughness 0.5", () => {
    // F0 = mix(0.04, 0.5, 0.5) = 0.27 and F = F0. Specular = (16/π)(1/4)(0.27) = 1.08/π.
    // Diffuse = (1−m)(1−F_d)c/π with F_d = 0.04 (VH = 1) = 0.5 · 0.96 · 0.5/π = 0.24/π. Sum = 1.32/π.
    expectRgb(shadePbr(scene({ lights: [sun(UP)], metallic: 0.5 })), [1.32 / PI, 1.32 / PI, 1.32 / PI]);
  });
});

describe("oblique geometry", () => {
  // The mirror configuration: N = +Z, V = (0.96, 0, 0.28) (unit: 0.9216 + 0.0784 = 1), L = (−0.96, 0, 0.28).
  // L + V = (0, 0, 0.56), so H = +Z: NH = 1, VH = V·H = 0.28, and NL = NV = 0.28.
  // Schlick: (1 − 0.28)⁵ = 0.72⁵ = 0.5184 · 0.5184 · 0.72 = 0.2687385600 · 0.72 = 0.19349176320 (0.72² = 0.5184,
  // 0.72⁴ = 0.26873856, 0.72⁵ = 0.1934917632). For dielectric c: F = 0.04 + 0.96 · 0.1934917632.
  const V: Vec3 = [0.96, 0, 0.28];
  const light = sun([-0.96, 0, 0.28]);
  const w5 = 0.72 ** 5;
  const F = 0.04 + 0.96 * w5;

  it("grazing mirror, roughness 1: D = 1/π, Vis = 0.5/(0.28+0.28) = 25/28", () => {
    // sqrt(NV²(1−α²)+α²) = sqrt(1) = 1 with α² = 1. Radiance = (diffuse + specular)·NL with
    // diffuse = (1−F)·0.5/π, specular = (1/π)(25/28)·F, NL = 0.28.
    const expected = (((1 - F) * 0.5) / PI + ((25 / 28) * F) / PI) * 0.28;
    const rgb = shadePbr(scene({ V, lights: [light], roughness: 1 }));
    expectRgb(rgb, [expected, expected, expected]);
  });

  it("grazing mirror, roughness 0.5: D = 16/π, Vis = 0.5/(2·0.28·sqrt(0.28²·0.9375 + 0.0625))", () => {
    // α² = 1/16 so 1−α² = 0.9375; 0.28² = 0.0784; 0.0784·0.9375 = 0.0735; + 0.0625 = 0.136.
    const vis = 0.5 / (2 * 0.28 * Math.sqrt(0.136));
    const expected = (((1 - F) * 0.5) / PI + ((16 / PI) * vis * F)) * 0.28;
    const rgb = shadePbr(scene({ V, lights: [light] }));
    expectRgb(rgb, [expected, expected, expected]);
  });

  it("off-axis directional light, L = (0.6, 0, 0.8) (derivation at `offAxis`)", () => {
    const rgb = shadePbr(scene({ lights: [sun([0.6, 0, 0.8])], baseColor: [0.8, 0.8, 0.8] }));
    expectRgb(rgb, [offAxis(0.8), offAxis(0.8), offAxis(0.8)]);
  });

  it("V perpendicular to N: NV clamps to 1e-4 (roughness 1, L = N = +Z)", () => {
    // V = +X: NV = 0 → 1e-4. H = (1,0,1)/√2: NH = VH = √½ (so VH is not clamped), NL = 1.
    // α² = 1: D = 1/π; Vis = 0.5/(1·1 + 1e-4·1) = 0.5/1.0001. F = 0.04 + 0.96(1−√½)⁵. c = 0.5.
    const f = 0.04 + 0.96 * (1 - Math.SQRT1_2) ** 5;
    const expected = ((1 - f) * 0.5) / PI + ((1 / PI) * (0.5 / 1.0001)) * f;
    const rgb = shadePbr(scene({ V: [1, 0, 0], lights: [sun(UP)], roughness: 1 }));
    expectRgb(rgb, [expected, expected, expected]);
  });

  it("normalises N and V (a scaled input equals the unit input)", () => {
    // |(0,0,5)| = 5 and |(0,0,0.25)| = 0.25 normalise to +Z, so the result is the 0.64/π of the
    // normal-incidence test.
    const rgb = shadePbr(scene({ N: [0, 0, 5], V: [0, 0, 0.25], lights: [sun(UP)] }));
    expectRgb(rgb, [0.64 / PI, 0.64 / PI, 0.64 / PI]);
  });
});

describe("lights that contribute nothing, and the zero-denominator rule", () => {
  it("a light at or behind the horizon contributes exactly nothing but ambient", () => {
    // Rule 7 multiplies by NL = max(N·L, 0) = 0 for L = (0.6, 0, −0.8) (N·L = −0.8) and for L = +X (N·L = 0).
    // Ambient: c · ambient_color · intensity = 0.5 · 1 · 0.5 = 0.25.
    for (const toLight of [[0.6, 0, -0.8], [1, 0, 0]] as const) {
      const rgb = shadePbr(scene({ lights: [sun(toLight)], roughness: 0.045, ambientIntensity: 0.5 }));
      expectRgb(rgb, [0.25, 0.25, 0.25]);
    }
  });

  it("L = −V exactly (no half vector) is still just the ambient term: the light term is 0 by NL = 0", () => {
    // N = V = +Z, light travelling along +Z, so L = −Z = −V and L + V = 0. N·L = −1 → NL = 0 → term 0.
    expectRgb(shadePbr(scene({ lights: [sun([0, 0, -1])], ambientIntensity: 0.5 })), [0.25, 0.25, 0.25]);
  });

  it("the Vis denominator never reaches 0 with the specified clamps, so rule 3's zero case is unreachable", () => {
    // Denominator = NL·sqrt(NV²(1−α²)+α²) + NV·sqrt(NL²(1−α²)+α²). With NL = 0 it is NV·α >= 1e-4 · 0.002025
    // = 2.025e-7 > 0, so Vis = 0.5/2.025e-7 ≈ 2.5e6 (finite), and rule 7's NL = 0 factor makes the term 0.
    // The result is therefore the finite ambient value and never NaN. The oracle skips NL = 0 lights, so
    // this runs the full formula with NL = 1e-9 instead: Vis ≈ 0.5/(NV·α) ≈ 2.5e6, D(NH ≈ 5e-10) ≈ α²/π ≈ 1.3e-6,
    // the light term is about 0.15·NL ≈ 1.5e-10 per channel, so the result is the ambient value to 1e-6.
    const rgb = shadePbr(scene({ V: [1, 0, 0], lights: [sun([1, 0, 1e-9])], roughness: 0, ambientIntensity: 1, baseColor: [0.2, 0.4, 0.6] }));
    expectRgb(rgb, [0.2, 0.4, 0.6], 1e-6);
  });
});

describe("light radiance (rule 6) and the sum (rule 7)", () => {
  // Base value for N = V = +Z, c = 0.5, metallic 0, roughness 0.5, NL = 1, E = 1: 0.64/π.
  const unit = 0.64 / PI;

  it("a coloured light scales each channel: colour (1, 0.5, 0) × intensity 3 → E = (3, 1.5, 0)", () => {
    const rgb = shadePbr(scene({ lights: [sun(UP, 3, [1, 0.5, 0])] }));
    expectRgb(rgb, [3 * unit, 1.5 * unit, 0]);
  });

  it("lights add: two identical lights give twice one light, plus ambient once", () => {
    // Ambient: c · ambient_color · intensity = 0.5 · (1, 0.5, 0.25) · 0.5 = (0.25, 0.125, 0.0625).
    const rgb = shadePbr(scene({ lights: [sun(UP), sun(UP)], ambientColor: [1, 0.5, 0.25], ambientIntensity: 0.5 }));
    expectRgb(rgb, [2 * unit + 0.25, 2 * unit + 0.125, 2 * unit + 0.0625]);
  });

  it("with no lights the result is the ambient term only, scaled by (1 − m)", () => {
    // c = (0.2, 0.4, 0.6), ambient colour (1, 0.5, 0.25), intensity 0.5:
    // (0.2·1·0.5, 0.4·0.5·0.5, 0.6·0.25·0.5) = (0.1, 0.1, 0.075) times (1 − m): m = 0 → all of it,
    // m = 0.5 → half, m = 1 → black.
    for (const [metallic, k] of [[0, 1], [0.5, 0.5], [1, 0]] as const) {
      const rgb = shadePbr(scene({ lights: [], baseColor: [0.2, 0.4, 0.6], metallic, ambientColor: [1, 0.5, 0.25], ambientIntensity: 0.5 }));
      expectRgb(rgb, [0.1 * k, 0.1 * k, 0.075 * k]);
    }
  });

  it("values above 1 are not clipped: no tone mapping", () => {
    // Intensity 10 at normal incidence: 10 · 0.64/π ≈ 2.037 per channel.
    expectClose(shadePbr(scene({ lights: [sun(UP, 10)] }))[0], (10 * 0.64) / PI);
  });

  describe("point lights", () => {
    // Surface at the origin, light on the +Z axis at height h: L = +Z, d = h, NL = 1. Radiance is
    // 0.64/π · I/h² · w.
    const at = (h: number, intensity: number, range?: number): Vec3 =>
      shadePbr(scene({ lights: [{ kind: "point", position: [0, 0, h], color: WHITE, intensity, ...(range === undefined ? {} : { range }) }] }));

    it("unlimited range: E = I/d² (d = 2, I = 8 → E = 2)", () => {
      expectRgb(at(2, 8), [2 * unit, 2 * unit, 2 * unit]);
      expectRgb(at(2, 8, 0), [2 * unit, 2 * unit, 2 * unit]);
    });

    it("inside the range the window is 1 − (d/range)⁴ (KHR_lights_punctual, not squared)", () => {
      // d = 2, range 4: 1 − 0.5⁴ = 0.9375.
      expectRgb(at(2, 8, 4), [2 * unit * 0.9375, 2 * unit * 0.9375, 2 * unit * 0.9375]);
      // d = 2, range 3: (2/3)⁴ = 16/81, 1 − 16/81 = 65/81.
      const w = 65 / 81;
      expectRgb(at(2, 8, 3), [2 * unit * w, 2 * unit * w, 2 * unit * w]);
    });

    it("at and beyond the range the light is exactly 0", () => {
      // d = range: 1 − 1 = 0. d = 2, range 1: 1 − 16 = −15 → clamped to 0.
      for (const range of [2, 1, 0.5]) expectRgb(at(2, 8, range), NONE);
    });

    it("d² has a floor of 1e-4: a light 0.001 away with I = 1e-6 gives E = 1e-6/1e-4 = 0.01, not 1", () => {
      expectRgb(at(0.001, 1e-6), [0.01 * unit, 0.01 * unit, 0.01 * unit]);
    });

    it("direction and distance come from the surface point: P = (1,2,3), light at (4,2,7)", () => {
      // The vector is (3, 0, 4): d = 5, L = (0.6, 0, 0.8). I = 25 gives E = 25/25 = 1, so the result is the
      // directional off-axis result.
      const rgb = shadePbr(
        scene({ position: [1, 2, 3], baseColor: [0.8, 0.8, 0.8], lights: [{ kind: "point", position: [4, 2, 7], color: WHITE, intensity: 25 }] }),
      );
      expectRgb(rgb, [offAxis(0.8), offAxis(0.8), offAxis(0.8)]);
    });
  });
});

describe("formula review pins (resolved in favour of glTF, decision 0080)", () => {
  // Normal incidence, roughness 0.5, c = 0.5, m = 0.5: S = D·Vis = (16/π)(1/4) = 4/π, VH = 1, so the
  // dielectric Fresnel is Fd = 0.04 and the metal Fresnel is Fc = c = 0.5.
  it("(a) the diffuse term equals glTF's mix(dielectric, metal) at every m", () => {
    // glTF (pbr.frag): (1−m)[(1−Fd)·c/π + Fd·S] + m·Fc·S
    //   = 0.5 [0.96 · 0.5/π + 0.04 · 4/π] + 0.5 · 0.5 · 4/π = 0.5 · (0.48 + 0.16)/π + 1/π = 1.32/π.
    // The previous rule ((1−F)(1−m)c/π with the metal-mixed F) gave 1.2625/π.
    for (const m of [0, 0.25, 0.5, 0.75, 1]) {
      const gltf = (1 - m) * ((0.96 * 0.5) / PI + (0.04 * 4) / PI) + (m * 0.5 * 4) / PI;
      expectClose(shadePbr(scene({ lights: [sun(UP)], metallic: m }))[0], gltf);
    }
  });

  it("(b) the range window is glTF's un-squared one: at d = 2, range 4 the weight is 0.9375", () => {
    // glTF getRangeAttenuation: max(min(1 − (d/range)⁴, 1), 0) = 1 − (2/4)⁴ = 0.9375 (Filament's squared
    // window would give 0.87890625).
    const lit = (range: number): number =>
      shadePbr(scene({ lights: [{ kind: "point", position: [0, 0, 2], color: WHITE, intensity: 8, range }] }))[0];
    expectClose(lit(4) / lit(0), 0.9375);
  });

  it("(b) the d² floor of 1e-4 is kept with the window", () => {
    // d = 0.001, range 1: window 1 − 1e-12 (≈ 1), E = 1e-6 / 1e-4 · window.
    const rgb = shadePbr(scene({ lights: [{ kind: "point", position: [0, 0, 0.001], color: WHITE, intensity: 1e-6, range: 1 }] }));
    expectClose(rgb[0], 0.01 * (1 - 1e-12) * (0.64 / PI));
  });

  it("(c) a metal receives no ambient, a dielectric all of it", () => {
    expectRgb(shadePbr(scene({ lights: [], metallic: 1, ambientIntensity: 1 })), NONE);
    expectRgb(shadePbr(scene({ lights: [], metallic: 0, ambientIntensity: 1 })), [0.5, 0.5, 0.5]);
  });

  it("(e) the stable GGX form keeps the peak exact at the roughness floor", () => {
    // At NH = 1, f = (1 − 1) + 1·α² = α² exactly, so D = 1/(π α²) with no cancellation: metal, c = 1, the
    // specular is 1/(4π α²) to f64 rounding (tolerance 1e-14, where the old form needed 1e-9).
    const expected = 1 / (4 * PI * 0.045 ** 4);
    expectClose(shadePbr(scene({ lights: [sun(UP)], baseColor: WHITE, metallic: 1, roughness: 0.045 }))[0], expected, 1e-14);
  });

  it("(g) L + V = 0 with NL > 0 (back-facing normal, light behind the viewer) contributes 0, not NaN", () => {
    // N = +Z, V = −Z (NV clamps to 1e-4), light from +Z: L = +Z = −V, NL = 1, L + V = 0.
    const rgb = shadePbr(scene({ V: [0, 0, -1], lights: [sun(UP)], ambientIntensity: 0.5 }));
    expectRgb(rgb, [0.25, 0.25, 0.25]);
  });
});

describe("linearToSrgb8: the exact sRGB OETF rounded to 8 bits", () => {
  it("fixes the end points and clamps", () => {
    // 0 → 0 and 1 → 1.055 − 0.055 = 1 → 255. Out-of-range input saturates like a normalised target.
    expect(linearToSrgb8(0)).toBe(0);
    expect(linearToSrgb8(1)).toBe(255);
    expect(linearToSrgb8(-0.5)).toBe(0);
    expect(linearToSrgb8(3.7)).toBe(255);
  });

  it("uses the linear segment 12.92·c up to 0.0031308", () => {
    // 0.001 → 0.01292 → ·255 = 3.2946 → 3. 0.0003 → 0.003876 → 0.98838 → 1. 0.00001 → 0.0328 → 0.
    // 0.0031308 → 12.92 · 0.0031308 = 0.04045 → 10.31 → 10.
    expect(linearToSrgb8(0.001)).toBe(3);
    expect(linearToSrgb8(0.0003)).toBe(1);
    expect(linearToSrgb8(0.00001)).toBe(0);
    expect(linearToSrgb8(0.0031308)).toBe(10);
  });

  it("uses 1.055·c^(1/2.4) − 0.055 above it", () => {
    // 0.5: 0.5^(1/2.4) = 2^(−0.41667) = 0.74915; 1.055 · 0.74915 − 0.055 = 0.73536; ·255 = 187.52 → 188.
    // 0.25: 2^(−0.83333) = 0.56123; 1.055 · 0.56123 − 0.055 = 0.53710; ·255 = 136.96 → 137.
    // 0.18: 0.18^(1/2.4) = e^(−0.71450) = 0.48945; 1.055 · 0.48945 − 0.055 = 0.46137; ·255 = 117.65 → 118.
    // 0.9: 0.9^(1/2.4) = e^(−0.043902) = 0.95705; 1.055 · 0.95705 − 0.055 = 0.95469; ·255 = 243.45 → 243.
    expect(linearToSrgb8(0.5)).toBe(188);
    expect(linearToSrgb8(0.25)).toBe(137);
    expect(linearToSrgb8(0.18)).toBe(118);
    expect(linearToSrgb8(0.9)).toBe(243);
  });

  it("is the inverse of the sRGB EOTF at every 8-bit code", () => {
    // Decode k/255 with c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4 (spec/language.md section 5.4);
    // encoding it must give k back, because the two transfer functions are exact inverses and the
    // rounding error (< 0.5) is far below one code step.
    for (let k = 0; k <= 255; k += 1) {
      const c = k / 255;
      const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      expect(linearToSrgb8(linear), `code ${String(k)}`).toBe(k);
    }
  });

  it("is monotonic", () => {
    let previous = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const code = linearToSrgb8(i / 1000);
      expect(code).toBeGreaterThanOrEqual(previous);
      previous = code;
    }
  });

  it("encodes a colour channel-wise and rejects NaN", () => {
    expect(linearRgbToSrgb8([0, 0.5, 1])).toEqual([0, 188, 255]);
    expect(() => linearToSrgb8(Number.NaN)).toThrow(RangeError);
  });
});

describe("undefined configurations throw instead of returning a number", () => {
  it("a zero-length N or V, a non-finite number, a negative range", () => {
    expect(() => shadePbr(scene({ N: NONE, lights: [] }))).toThrow(RangeError);
    expect(() => shadePbr(scene({ V: NONE, lights: [] }))).toThrow(RangeError);
    expect(() => shadePbr(scene({ roughness: Number.NaN, lights: [] }))).toThrow(RangeError);
    expect(() => shadePbr(scene({ lights: [{ kind: "point", position: [0, 0, 1], color: WHITE, intensity: 1, range: -1 }] }))).toThrow(RangeError);
  });

  it("a point light on the surface has no direction", () => {
    expect(() => shadePbr(scene({ lights: [{ kind: "point", position: [0, 0, 0], color: WHITE, intensity: 1 }] }))).toThrow(RangeError);
  });
});
