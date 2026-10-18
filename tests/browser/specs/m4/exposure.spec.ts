// M4-12: the default camera exposure (decision 0081). A camera that declares no `exposure` uses EV100 = -log2(1.2 pi), the
// exposure scale 1 / (1.2 * 2^EV100) is pi, and a white surface under one lux of light facing it renders as white: the
// physical light units stay (the light is 1 lux, not 3.14) and the picture is not dark. The expected pixel comes from the
// CPU oracle (`shadePbr`, f64) times the scale derived here from the formula, not from the runtime.
import { expect, test } from "../../support/fixtures.ts";
import { EXPOSURE } from "../../support/m4-fixtures.ts";
import { TARGET_SIZE, surfaceAt } from "../../support/pbr-scene.ts";
import { linearToSrgb8, shadePbr, type Vec3 } from "../../support/reference-shading.ts";

/** Bytes of tolerance per channel against the f64 oracle. */
const TOLERANCE = 3;

const DEFAULT_EV100 = -Math.log2(1.2 * Math.PI);
/** `1 / (1.2 * 2^EV100)`: the factor the runtime applies to lit radiance (decision 0081). */
const EXPOSURE_SCALE = 1 / (1.2 * 2 ** DEFAULT_EV100);

interface AppLike {
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
  };
  state: string;
}

test.describe("the default camera exposure (M4-12)", () => {
  test("a white surface under one lux renders white with the default exposure", async ({ page, gpu }) => {
    void gpu;
    const x = TARGET_SIZE / 2;
    const y = TARGET_SIZE / 2;
    const point = surfaceAt(x, y);
    if (point === undefined) throw new Error("the centre pixel misses the sphere");

    // The default exposure scale is pi up to rounding: 1 / (1.2 * 2^(-log2(1.2 pi))) = pi.
    expect(EXPOSURE_SCALE).toBeCloseTo(Math.PI, 12);

    const linear = shadePbr({
      N: point.N,
      V: point.V,
      position: point.position,
      // The sun's entity has the identity rotation: it shines along world -Z, onto the +Z side the camera sees.
      lights: [{ kind: "directional", direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 }],
      baseColor: [1, 1, 1],
      metallic: 0,
      roughness: 1,
      ambientColor: [0, 0, 0],
      ambientIntensity: 0,
    });
    const scaled = linear.map((c) => c * EXPOSURE_SCALE) as unknown as Vec3;
    const expected = scaled.map((c) => linearToSrgb8(c));
    // The claim of the decision, derived by hand: head-on, the diffuse part is (1 - 0.04) / pi, the specular part at roughness 1
    // is below 0.004 / pi, and times the exposure scale pi the result is about 0.97 linear, which the sRGB encoding makes 252.
    for (const value of expected) expect(value).toBeGreaterThanOrEqual(250);
    for (const value of expected) expect(value).toBeLessThanOrEqual(254);

    await page.goto(`/m4/${EXPOSURE}/index.html`);
    const pixel = await page.evaluate(
      async ({ size, px, py }) => {
        const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike> };
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: { width: size, height: size } } });
        app.debug.step(1, 1 / 60);
        const frame = await app.debug.readPixels();
        const i = (py * frame.width + px) * 4;
        return { rgb: [frame.data[i], frame.data[i + 1], frame.data[i + 2]], state: app.state };
      },
      { size: TARGET_SIZE, px: x, py: y },
    );
    expect(pixel.state).toBe("running");
    pixel.rgb.forEach((got, channel) => {
      expect(Math.abs((got ?? -1000) - (expected[channel] ?? 1000)), `channel ${String(channel)}: GPU ${String(got)}, oracle ${String(expected[channel])}`).toBeLessThanOrEqual(TOLERANCE);
    });
    // And it is white: every channel at least 250.
    for (const got of pixel.rgb) expect(got ?? 0).toBeGreaterThanOrEqual(250);
  });
});
