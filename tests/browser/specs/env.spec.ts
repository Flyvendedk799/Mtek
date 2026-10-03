// Smoke spec: records the environment and performs the first real GPU readback.
import { readFileSync } from "node:fs";
import { expect, test } from "../support/fixtures.ts";
import { validateEnvironment } from "../support/environment.ts";

interface ReadbackResult {
  width: number;
  height: number;
  bytesPerRow: number;
  /** Tightly packed RGBA bytes, row by row. */
  pixels: number[];
  validationError: string | null;
}

test("environment record is written and valid", ({ gpu }, testInfo) => {
  const written = JSON.parse(readFileSync(gpu.recordPath, "utf8")) as unknown;
  expect(validateEnvironment(written)).toEqual([]);
  expect(gpu.record.project).toBe(testInfo.project.name);
  expect(gpu.record.gpu.navigatorGpu).toBe(true);
  expect(gpu.record.gpu.adapter).not.toBeNull();
  expect(gpu.record.renderTargetSize).toEqual({ width: 128, height: 128 });
  expect(gpu.record.gpu.wgslLanguageFeatures.length).toBeGreaterThan(0);
});

/** Clears a 4x4 rgba8unorm texture, copies it to a buffer (bytesPerRow 256) and reads it back. */
async function clearAndReadBack(
  page: import("@playwright/test").Page,
  clear: { r: number; g: number; b: number; a: number },
): Promise<ReadbackResult> {
  return page.evaluate(async (clearValue): Promise<ReadbackResult> => {
    const width = 4;
    const height = 4;
    const bytesPerRow = 256;
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) throw new Error("no adapter");
    const device = await adapter.requestDevice();
    device.pushErrorScope("validation");

    const texture = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: clearValue,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow }, { width, height });
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(readback.getMappedRange());
    const pixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width * 4; x += 1) pixels.push(mapped[y * bytesPerRow + x] ?? -1);
    }
    readback.unmap();

    const error = await device.popErrorScope();
    texture.destroy();
    readback.destroy();
    device.destroy();
    return { width, height, bytesPerRow, pixels, validationError: error?.message ?? null };
  }, clear);
}

function expectedByte(value: number): number {
  return Math.round(value * 255);
}

for (const clear of [
  { r: 1, g: 0.5, b: 0.25, a: 1 },
  { r: 0, g: 0.25, b: 1, a: 0.5 },
]) {
  test(`clears and reads back rgba8unorm ${JSON.stringify(clear)}`, async ({ page, gpu }) => {
    void gpu;
    await page.goto("/env.html");
    const result = await clearAndReadBack(page, clear);
    expect(result.validationError).toBeNull();
    expect(result.pixels).toHaveLength(4 * 4 * 4);
    const expected = [clear.r, clear.g, clear.b, clear.a].map(expectedByte);
    for (let pixel = 0; pixel < 16; pixel += 1) {
      const actual = result.pixels.slice(pixel * 4, pixel * 4 + 4);
      for (let channel = 0; channel < 4; channel += 1) {
        // The clear value is converted to unorm8 by the driver: allow one step of rounding.
        expect(
          Math.abs((actual[channel] ?? -1) - (expected[channel] ?? 0)),
          `pixel ${pixel} channel ${channel} = ${actual.join(",")}, expected ${expected.join(",")}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
}
