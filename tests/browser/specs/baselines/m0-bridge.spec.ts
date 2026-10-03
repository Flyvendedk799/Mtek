// M0-09: the M0 bridge scenario implemented with three.js WebGPU + TSL
// (benchmarks/baselines/m0-bridge), measured in the hardware project.
//
// Measured here: pixels of both materials before and after uniform updates (including that the
// untouched material is unaffected), the number of pipeline / shader-module creations observed on
// the GPUDevice during each update (the device methods are wrapped before three.js creates its
// device), and the source size of the baseline. The measurements are written to
// `$MTEK_RESULTS_DIR/m0-bridge-measurements-<project>.json`.
import { existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { BROWSER_ROOT } from "../../support/environment.ts";
import { startStaticServer, type StaticServer } from "../../support/serve.ts";
import { measureDirectory } from "../../../../benchmarks/baselines/m0-bridge/tools/count-lines.ts";

const BASELINE_ROOT = resolve(BROWSER_ROOT, "..", "..", "benchmarks", "baselines", "m0-bridge");
const DIST = join(BASELINE_ROOT, "dist");
const SIZE = 128;

interface Params {
  a: number;
  b: [number, number, number];
  c: number;
  d: [number, number];
  e: boolean;
  f: [number, number, number];
}

interface GpuCounts {
  createRenderPipeline: number;
  createRenderPipelineAsync: number;
  createShaderModule: number;
  createComputePipeline: number;
  createBuffer: number;
  createBindGroup: number;
  writeBufferCalls: number;
  writeBufferBytes: number;
  createdDevices: number;
}

interface BaselineHandle {
  create(a: Params, b: Params): Promise<void>;
  renderAndRead(): Promise<number[]>;
  update(which: "A" | "B", params: Partial<Params>): void;
}

const A0: Params = { a: 0.5, b: [0.1, 0.05, 0], c: 10, d: [0.05, 0.1], e: true, f: [0.8, 0.4, 0.2] };
const B0: Params = { a: 0.25, b: [0, 0, 0.1], c: 50, d: [0.2, 0], e: false, f: [0.2, 0.6, 0.9] };
const A_COLOUR_ONLY: Partial<Params> = { f: [0.2, 0.8, 0.4] };
const A_ALL: Params = { a: 0.5, b: [0, 0.1, 0.2], c: 20, d: [0, 0.05], e: false, f: [0.1, 0.2, 0.3] };
const B_ALL: Params = { a: 1, b: [0.1, 0, 0], c: 30, d: [0, 0.2], e: true, f: [0.3, 0.1, 0.05] };

/** CPU reference of the shader: rgb = (e ? f * a : f) + b * (c / 100) + (d.x, d.y, 0), in f64. */
function expectedLinear(p: Params): [number, number, number] {
  const scale = p.e ? p.a : 1;
  const k = p.c / 100;
  return [
    p.f[0] * scale + p.b[0] * k + p.d[0],
    p.f[1] * scale + p.b[1] * k + p.d[1],
    p.f[2] * scale + p.b[2] * k,
  ];
}

function encodeSrgb(linear: number): number {
  const x = Math.min(1, Math.max(0, linear));
  const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function expectedBytes(p: Params): [number, number, number, number] {
  const [r, g, b] = expectedLinear(p);
  return [encodeSrgb(r), encodeSrgb(g), encodeSrgb(b), 255];
}

/** Largest per-channel deviation of every pixel of a half of the target from `expected`. */
function maxDeviation(
  pixels: readonly number[],
  half: "left" | "right",
  expected: readonly number[],
): number {
  let worst = 0;
  const xStart = half === "left" ? 0 : SIZE / 2;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = xStart; x < xStart + SIZE / 2; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const actual = pixels[(y * SIZE + x) * 4 + channel] ?? -1000;
        worst = Math.max(worst, Math.abs(actual - (expected[channel] ?? 0)));
      }
    }
  }
  return worst;
}

function pixelAt(pixels: readonly number[], x: number, y: number): number[] {
  const offset = (y * SIZE + x) * 4;
  return pixels.slice(offset, offset + 4);
}

function diff(before: GpuCounts, after: GpuCounts): GpuCounts {
  const result = { ...after };
  for (const key of Object.keys(after) as (keyof GpuCounts)[]) {
    result[key] = after[key] - before[key];
  }
  return result;
}

/** Wraps GPUAdapter.requestDevice before any page script runs, so three.js receives a wrapped device. */
function installDeviceCounters(): void {
  const counts = {
    createRenderPipeline: 0,
    createRenderPipelineAsync: 0,
    createShaderModule: 0,
    createComputePipeline: 0,
    createBuffer: 0,
    createBindGroup: 0,
    writeBufferCalls: 0,
    writeBufferBytes: 0,
    createdDevices: 0,
  };
  (window as unknown as { __mtekGpuCounts: typeof counts }).__mtekGpuCounts = counts;
  const adapterPrototype = (globalThis as unknown as { GPUAdapter?: typeof GPUAdapter }).GPUAdapter?.prototype;
  if (adapterPrototype === undefined) return;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked below with the right `this`
  const original = adapterPrototype.requestDevice;
  adapterPrototype.requestDevice = async function (
    this: GPUAdapter,
    ...args: Parameters<GPUAdapter["requestDevice"]>
  ): Promise<GPUDevice> {
    const device = await original.apply(this, args);
    counts.createdDevices += 1;
    const wrapCounter = (name: keyof typeof counts & keyof GPUDevice): void => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked below with `this` = device
      const method = device[name] as (...methodArgs: unknown[]) => unknown;
      Object.defineProperty(device, name, {
        configurable: true,
        value: (...methodArgs: unknown[]): unknown => {
          counts[name as "createRenderPipeline"] += 1;
          return method.apply(device, methodArgs);
        },
      });
    };
    wrapCounter("createRenderPipeline");
    wrapCounter("createRenderPipelineAsync");
    wrapCounter("createShaderModule");
    wrapCounter("createComputePipeline");
    wrapCounter("createBuffer");
    wrapCounter("createBindGroup");
    const queue = device.queue;
    const writeBuffer = queue.writeBuffer.bind(queue);
    queue.writeBuffer = (
      buffer: GPUBuffer,
      bufferOffset: number,
      data: GPUAllowSharedBufferSource,
      dataOffset?: number,
      size?: number,
    ): undefined => {
      counts.writeBufferCalls += 1;
      // `dataOffset` and `size` count elements for typed arrays and bytes for ArrayBuffer/DataView.
      const elementSize = (data as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
      const available = data.byteLength / elementSize - (dataOffset ?? 0);
      counts.writeBufferBytes += (size ?? available) * elementSize;
      writeBuffer(buffer, bufferOffset, data, dataOffset, size);
      return undefined;
    };
    return device;
  };
}

async function counts(page: Page): Promise<GpuCounts> {
  return page.evaluate(
    () => ({ ...(window as unknown as { __mtekGpuCounts: GpuCounts }).__mtekGpuCounts }),
  );
}

function handle(page: Page) {
  return {
    create: (a: Params, b: Params) =>
      page.evaluate(
        ([pa, pb]) =>
          (window as unknown as { mtekBaseline: BaselineHandle }).mtekBaseline.create(pa, pb),
        [a, b] as const,
      ),
    render: () =>
      page.evaluate(() =>
        (window as unknown as { mtekBaseline: BaselineHandle }).mtekBaseline.renderAndRead(),
      ),
    update: (which: "A" | "B", params: Partial<Params>) =>
      page.evaluate(
        ([w, p]) =>
          (window as unknown as { mtekBaseline: BaselineHandle }).mtekBaseline.update(w, p),
        [which, params] as const,
      ),
  };
}

let server: StaticServer;

test.beforeAll(async () => {
  if (!existsSync(join(DIST, "baseline.js"))) {
    throw new Error(`${DIST} is missing; run \`npm run build\` first`);
  }
  server = await startStaticServer(DIST);
});

test.afterAll(async () => {
  await server.close();
});

test("three.js baseline: update correctness, instance isolation and pipeline counts", async ({
  page,
  gpu,
}, testInfo) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  // The static server has no favicon; answer it so it does not show up as a console error.
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.addInitScript(installDeviceCounters);
  await page.goto(`${server.url}/index.html`);
  const baseline = handle(page);

  const phases: Record<string, unknown> = {};
  const afterLoad = await counts(page);
  expect(afterLoad.createdDevices, "wrapper installed before the device was created").toBe(0);

  await baseline.create(A0, B0);
  const afterInit = await counts(page);
  expect(afterInit.createdDevices).toBe(1);

  // Phase 1: first render.
  const first = await baseline.render();
  const afterFirst = await counts(page);
  expect(first).toHaveLength(SIZE * SIZE * 4);
  expect(afterFirst.createShaderModule, "device wrapper observes three.js").toBeGreaterThan(0);
  expect(afterFirst.createRenderPipeline + afterFirst.createRenderPipelineAsync).toBeGreaterThan(0);

  const check = (
    name: string,
    pixels: readonly number[],
    a: Params,
    b: Params,
  ): { expectedA: number[]; expectedB: number[]; deviationA: number; deviationB: number } => {
    const expectedA = expectedBytes(a);
    const expectedB = expectedBytes(b);
    const deviationA = maxDeviation(pixels, "left", expectedA);
    const deviationB = maxDeviation(pixels, "right", expectedB);
    expect(deviationA, `${name}: material A, centre ${pixelAt(pixels, 32, 64).join(",")} expected ${expectedA.join(",")}`).toBeLessThanOrEqual(1);
    expect(deviationB, `${name}: material B, centre ${pixelAt(pixels, 96, 64).join(",")} expected ${expectedB.join(",")}`).toBeLessThanOrEqual(1);
    return { expectedA, expectedB, deviationA, deviationB };
  };
  phases["initial"] = {
    centreA: pixelAt(first, 32, 64),
    centreB: pixelAt(first, 96, 64),
    ...check("initial", first, A0, B0),
    counts: diff(afterInit, afterFirst),
  };

  // Phase 2: render again without changing anything (control).
  const control = await baseline.render();
  const afterControl = await counts(page);
  phases["unchangedRerender"] = {
    ...check("unchanged re-render", control, A0, B0),
    counts: diff(afterFirst, afterControl),
  };

  // Phase 3: update only the colour of A, render again.
  await baseline.update("A", A_COLOUR_ONLY);
  const aColour = { ...A0, ...A_COLOUR_ONLY };
  const colourPixels = await baseline.render();
  const afterColour = await counts(page);
  phases["updateColourOfA"] = {
    centreA: pixelAt(colourPixels, 32, 64),
    centreB: pixelAt(colourPixels, 96, 64),
    bUnchangedFromBefore: maxDeviation(colourPixels, "right", expectedBytes(B0)),
    ...check("A colour update", colourPixels, aColour, B0),
    counts: diff(afterControl, afterColour),
  };
  expect(pixelAt(colourPixels, 32, 64)).not.toEqual(pixelAt(control, 32, 64));
  expect(pixelAt(colourPixels, 96, 64)).toEqual(pixelAt(control, 96, 64));

  // Phase 4: update all six uniforms of A.
  await baseline.update("A", A_ALL);
  const allPixels = await baseline.render();
  const afterAll = await counts(page);
  phases["updateAllOfA"] = {
    centreA: pixelAt(allPixels, 32, 64),
    centreB: pixelAt(allPixels, 96, 64),
    ...check("A all-uniform update", allPixels, A_ALL, B0),
    counts: diff(afterColour, afterAll),
  };
  expect(pixelAt(allPixels, 96, 64)).toEqual(pixelAt(control, 96, 64));

  // Phase 5: update all six uniforms of B only; A must keep the values of phase 4.
  await baseline.update("B", B_ALL);
  const bPixels = await baseline.render();
  const afterB = await counts(page);
  phases["updateAllOfB"] = {
    centreA: pixelAt(bPixels, 32, 64),
    centreB: pixelAt(bPixels, 96, 64),
    ...check("B all-uniform update", bPixels, A_ALL, B_ALL),
    counts: diff(afterAll, afterB),
  };
  expect(pixelAt(bPixels, 32, 64)).toEqual(pixelAt(allPixels, 32, 64));

  // No pipeline or shader-module creation may be caused by value updates (measured: see JSON).
  for (const name of ["unchangedRerender", "updateColourOfA", "updateAllOfA", "updateAllOfB"]) {
    const phaseCounts = (phases[name] as { counts: GpuCounts }).counts;
    expect(phaseCounts.createRenderPipeline, `${name}: createRenderPipeline`).toBe(0);
    expect(phaseCounts.createRenderPipelineAsync, `${name}: createRenderPipelineAsync`).toBe(0);
    expect(phaseCounts.createShaderModule, `${name}: createShaderModule`).toBe(0);
  }
  expect(consoleMessages, "no console errors or warnings").toEqual([]);

  const size = measureDirectory(join(BASELINE_ROOT, "src"));
  const measurements = {
    task: "M0-09",
    project: testInfo.project.name,
    environmentRecord: basename(gpu.recordPath),
    adapter: gpu.record.gpu.adapter?.info ?? null,
    browser: gpu.record.browser,
    targetSize: SIZE,
    parameters: { A0, B0, A_COLOUR_ONLY, A_ALL, B_ALL },
    countsAfterInit: afterInit,
    countsAfterFirstRender: afterFirst,
    phases,
    totalCounts: afterB,
    sourceLinesOfTypeScript: size,
  };
  const resultsDir = process.env["MTEK_RESULTS_DIR"];
  if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set");
  writeFileSync(join(resultsDir, `m0-bridge-measurements-${testInfo.project.name}.json`), `${JSON.stringify(measurements, null, 2)}\n`);
});

// Values that TypeScript accepts for the unsigned uniform (type `number`) but that are not valid u32
// values (type-experiments.ts, cases 09 to 11). The model checked here is JavaScript's ToUint32
// (`value >>> 0`: wrap-around of out-of-range values, truncation of fractions); the "mathematical"
// expectation, which uses the number as written, is recorded next to it.
test("three.js baseline: out-of-range values written to the unsigned uniform", async ({ page, gpu }, testInfo) => {
  void gpu;
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.goto(`${server.url}/index.html`);
  const baseline = handle(page);
  const base: Params = { a: 1, b: [10, 5, 2.5], c: 0, d: [0, 0], e: false, f: [0, 0, 0] };
  await baseline.create(base, base);
  await baseline.render();

  const observations: Record<string, unknown>[] = [];
  for (const c of [1.5, -1, 4294967296, 100]) {
    await baseline.update("A", { c });
    const pixels = await baseline.render();
    const wrapped = expectedBytes({ ...base, c: c >>> 0 });
    const asWritten = expectedBytes({ ...base, c });
    const centreA = pixelAt(pixels, 32, 64);
    observations.push({ c, centreA, expectedToUint32Model: wrapped, expectedNumberAsWritten: asWritten });
    expect(maxDeviation(pixels, "left", wrapped), `c = ${String(c)}: ToUint32 model ${wrapped.join(",")}, observed ${centreA.join(",")}`).toBeLessThanOrEqual(1);
  }
  const resultsDir = process.env["MTEK_RESULTS_DIR"];
  if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set");
  writeFileSync(
    join(resultsDir, `m0-bridge-uint-measurements-${testInfo.project.name}.json`),
    `${JSON.stringify({ task: "M0-09", project: testInfo.project.name, base, observations }, null, 2)}\n`,
  );
});

// Shader-graph mistakes that TypeScript accepts (type-experiments.ts, cases 15, 17 and 18): what
// three.js does with them at run time. Console output is recorded; the pixels are recorded.
test("three.js baseline: run-time behaviour of shader-graph type mismatches that tsc accepts", async ({ page, gpu }, testInfo) => {
  void gpu;
  const observations: Record<string, unknown>[] = [];
  for (const kind of ["vec3-add-vec2", "float-as-colour", "vec2-as-colour"] as const) {
    const messages: string[] = [];
    const onConsole = (message: import("@playwright/test").ConsoleMessage): void => {
      if (message.type() === "error" || message.type() === "warning") messages.push(`${message.type()}: ${message.text()}`);
    };
    const onPageError = (error: Error): void => void messages.push(`pageerror: ${error.message}`);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await page.goto(`${server.url}/misuse.html`);
    let outcome: { pixel: number[] } | { threw: string };
    try {
      const pixel = await page.evaluate(
        (k) => (window as unknown as { mtekMisuse: { run(kind: string): Promise<number[]> } }).mtekMisuse.run(k),
        kind,
      );
      outcome = { pixel };
    } catch (error) {
      outcome = { threw: String(error) };
    }
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    observations.push({ kind, ...outcome, consoleMessages: messages });
  }
  // Observed with three 0.186.1 on the recorded machine (the render target has no colour-space
  // conversion here, so bytes are the shader result times 255): all three build and render without
  // any console error or warning, and the result is a silently converted value.
  expect(observations).toEqual([
    // (0.1, 0.2, 0.3) + vec2(0.25, 0.5): the vec2 is added to the first two components only
    { kind: "vec3-add-vec2", pixel: [89, 178, 76, 255], consoleMessages: [] },
    // float 0.5 used as the colour: broadcast to r, g, b
    { kind: "float-as-colour", pixel: [128, 128, 128, 255], consoleMessages: [] },
    // vec2(0.25, 0.5) used as the colour: (0.25, 0.5, 0, 1)
    { kind: "vec2-as-colour", pixel: [64, 128, 0, 255], consoleMessages: [] },
  ]);
  const resultsDir = process.env["MTEK_RESULTS_DIR"];
  if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set");
  writeFileSync(
    join(resultsDir, `m0-bridge-misuse-measurements-${testInfo.project.name}.json`),
    `${JSON.stringify({ task: "M0-09", project: testInfo.project.name, observations }, null, 2)}\n`,
  );
});
