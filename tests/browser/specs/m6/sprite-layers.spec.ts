// Decision 0173: translucent draws are ordered back to front by view-space depth, which is the only ordering an orthographic
// camera has (its clip w is 1 everywhere). `fixtures/m6/sprite_layers` is two overlapping 2 x 2 Sprites under an orthographic
// camera of height 4 on a 64 x 64 target (so one world unit is 16 pixels): Near (red, alpha 128/255) at z = 1 covers x in
// [-1.5, 0.5], Far (blue, the same alpha) at z = 0 covers x in [-0.5, 1.5], on a black clear colour. Near is declared first, so
// the draw-list order is the opposite of the order the pass must draw in.
//
// The expectations are worked out from the blend equation, not read back from the runtime. With a = 128/255 in linear light
// (the target is sRGB, so blending happens before the encode): drawn far to near, the overlap is Far over black, (0, 0, a),
// then Near over that, (a, 0, a(1 - a)); drawn in declaration order it would be (a(1 - a), 0, a), a visibly different pixel.
import { expect, test } from "../../support/fixtures.ts";
import { linearRgbToSrgb8 } from "../../support/reference-shading.ts";

const SIZE = 64;
const A = 128 / 255;
/** Bytes of tolerance per channel against the f64 oracle. */
const TOLERANCE = 2;

/** The pixel at world (x, 0): one unit is 16 pixels, the centre column is x = 0. */
const pixelAt = (x: number): [number, number] => [Math.round(SIZE / 2 + x * 16), SIZE / 2];

const SAMPLES = {
  outside: pixelAt(-1.9),
  nearOnly: pixelAt(-1),
  overlap: pixelAt(0),
  farOnly: pixelAt(1),
} as const;

interface Run {
  reported: Array<{ code?: string }>;
  state: string;
  pixels: Record<keyof typeof SAMPLES, [number, number, number]>;
}

test.describe("sprite layers under an orthographic camera (decision 0173)", () => {
  test("the nearer sprite is drawn over the farther one whatever the order of the declarations", async ({ page, gpu }) => {
    void gpu;
    await page.goto("/m6/sprite_layers/index.html");
    const run = await page.evaluate(
      async ({ samples, size }): Promise<Run> => {
        const w = window as unknown as {
          __mtekMount(options: Record<string, unknown>): Promise<{
            state: string;
            dispose(): void;
            debug: { step(frames: number, dt: number): void; readPixels(): Promise<{ width: number; data: Uint8Array }> };
          }>;
        };
        const reported: Array<{ code?: string }> = [];
        const app = await w.__mtekMount({
          test: { manualClock: true, renderTarget: { width: size, height: size } },
          onDiagnostic: (d: { code?: string }) => reported.push(d),
        });
        // The blended pipeline exists from the first frame (decision 0173), but give the page a few frames anyway.
        app.debug.step(3, 1 / 60);
        const frame = await app.debug.readPixels();
        const at = ([x, y]: [number, number]): [number, number, number] => {
          const i = (y * frame.width + x) * 4;
          return [frame.data[i] ?? -1, frame.data[i + 1] ?? -1, frame.data[i + 2] ?? -1];
        };
        const pixels = Object.fromEntries(Object.entries(samples).map(([name, point]) => [name, at(point)])) as Run["pixels"];
        const state = app.state;
        app.dispose();
        return { reported, state, pixels };
      },
      { samples: SAMPLES, size: SIZE },
    );
    expect(run.reported).toEqual([]);
    expect(run.state).toBe("running");

    const want: Record<keyof typeof SAMPLES, [number, number, number]> = {
      outside: [0, 0, 0],
      nearOnly: linearRgbToSrgb8([A, 0, 0]),
      farOnly: linearRgbToSrgb8([0, 0, A]),
      overlap: linearRgbToSrgb8([A, 0, A * (1 - A)]),
    };
    // The wrong order is far from the right one, so the tolerance cannot hide it.
    const wrongOrder = linearRgbToSrgb8([A * (1 - A), 0, A]);
    expect(Math.abs(want.overlap[0] - wrongOrder[0])).toBeGreaterThan(20);

    for (const name of Object.keys(want) as Array<keyof typeof SAMPLES>) {
      want[name].forEach((byte, channel) => {
        const got = run.pixels[name][channel] ?? -1000;
        expect(Math.abs(got - byte), `${name} channel ${String(channel)}: GPU ${String(got)}, oracle ${String(byte)}`).toBeLessThanOrEqual(TOLERANCE);
      });
    }
  });
});
