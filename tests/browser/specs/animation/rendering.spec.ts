import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { test, expect } from "../../support/fixtures.ts";
import type { runRenderingProbe } from "../../support/rendering-probe.ts";
import type { runMipSamplingProbe } from "../../support/mip-sampling-probe.ts";
import type {
  MtekApp,
  MtekMountOptions,
} from "../../../../packages/runtime-web/src/host/types.js";

test("minified sampling selects mip levels while base-only glTF samplers retain level zero", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../support/mip-sampling-probe.ts", import.meta.url))], bundle: true,
    write: false, format: "iife", globalName: "mipProbe", target: "es2022" });
  await page.goto("/env.html");
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = await page.evaluate(() => (window as unknown as { mipProbe: { runMipSamplingProbe: typeof runMipSamplingProbe } }).mipProbe.runMipSamplingProbe());
  expect(result.error).toBeNull();
  expect(result.live).toBe(0);
  for (const index of [0, 2]) {
    expect(result.pixels[index]).toEqual([0, 0, 0, 255]);
    for (const channel of result.pixels[index + 1]!.slice(0, 3)) expect(Math.abs(channel - 128)).toBeLessThanOrEqual(1);
  }
});

test("mounted post effects survive device recovery and reject invalid WGSL", async ({
  page,
  gpu,
}) => {
  expect(gpu.available).toBe(true);
  await page.goto("/mount.html");
  await page.waitForFunction(() => "__mtek" in window);
  const initial = await page.evaluate(async () => {
    const w = window as unknown as {
      __mtek: {
        mountMtek(
          canvas: HTMLCanvasElement,
          program: unknown,
          options: MtekMountOptions,
        ): Promise<MtekApp>;
        program: unknown;
      };
      __post?: { app: MtekApp; diagnostics: string[] };
    };
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const diagnostics: string[] = [];
    const app = await w.__mtek.mountMtek(canvas, w.__mtek.program, {
      failureDisplay: "none",
      test: {
        manualClock: true,
        renderTarget: { width: 8, height: 8 },
        recovery: { delaysMs: [0, 0, 0] },
      },
      onDiagnostic: (d) => diagnostics.push(d.code),
      rendering: {
        postProcessing: [
          {
            id: "fixed",
            wgsl: "fn effect(c:vec4f,uv:vec2f)->vec4f{return vec4f(0.5,0.25,0.0,1.0);}",
          },
        ],
      },
    });
    w.__post = { app, diagnostics };
    app.debug!.step(1, 1 / 60);
    const pixel = Array.from((await app.debug!.readPixels()).data.slice(0, 4));
    app.debug!.loseDevice();
    return pixel;
  });
  expect(initial).toEqual([188, 137, 0, 255]);
  await page.waitForFunction(() => {
    const h = (
      window as unknown as { __post: { app: MtekApp; diagnostics: string[] } }
    ).__post;
    return h.diagnostics.includes("MTEK-W8060") && h.app.state === "running";
  });
  const restored = await page.evaluate(async () => {
    const h = (window as unknown as { __post: { app: MtekApp } }).__post;
    h.app.debug!.step(1, 1 / 60);
    const pixel = Array.from(
      (await h.app.debug!.readPixels()).data.slice(0, 4),
    );
    h.app.dispose();
    return { pixel, counters: h.app.debug!.counters() };
  });
  expect(restored.pixel).toEqual(initial);
  expect(restored.counters["liveTextures"]).toBe(0);
  expect(restored.counters["livePipelines"]).toBe(0);
  const invalid = await page.evaluate(async () => {
    const w = window as unknown as {
      __mtek: {
        mountMtek(
          canvas: HTMLCanvasElement,
          program: unknown,
          options: MtekMountOptions,
        ): Promise<MtekApp>;
        program: unknown;
      };
    };
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    try {
      await w.__mtek.mountMtek(canvas, w.__mtek.program, {
        failureDisplay: "none",
        rendering: {
          postProcessing: [{ id: "broken", wgsl: "fn effect( BROKEN" }],
        },
      });
      return "accepted";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalid).toMatch(/WGSL|pipeline/i);
});

test("linear-light NPOT mipmaps and ordered post effects run without leaked resources", async ({
  page,
  gpu,
}) => {
  expect(gpu.available).toBe(true);
  const bundle = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../../support/rendering-probe.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "renderProbe",
    target: "es2022",
  });
  await page.goto("/env.html");
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const result = await page.evaluate(() =>
    (
      window as unknown as {
        renderProbe: { runRenderingProbe: typeof runRenderingProbe };
      }
    ).renderProbe.runRenderingProbe(),
  );
  expect(result.validation).toBeNull();
  expect(result.live).toBe(0);
  expect(result.mipLinear).toEqual([85, 85, 85, 255]);
  for (const c of result.mipSrgb.slice(0, 3))
    expect(Math.abs(c - 156)).toBeLessThanOrEqual(1);
  expect(result.post[0]).toBe(0);
  for (const c of result.post.slice(1, 3))
    expect(Math.abs(c - 188)).toBeLessThanOrEqual(1);
});
