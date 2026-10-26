import { expect, test } from "../../support/fixtures.ts";
import { writeRecord } from "./configurator-support.ts";
import { linearRgbToSrgb8, type Vec3 } from "../../support/reference-shading.ts";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";
import type { LightingQuality } from "../../../../packages/runtime-web/src/render/options.js";

type Host = { __mtekMount(options: MtekMountOptions): Promise<MtekApp>; __lighting?: MtekApp; __lightingDiagnostics?: string[] };
const constant = { width: 2, height: 1, data: [0.2, 0.4, 0.8, 1, 0.2, 0.4, 0.8, 1] };

for (const boundary of ["lit_texture_boundary", "lit_sampler_boundary"]) {
  test(`scene lighting fits default resource limits at ${boundary}`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true); await page.goto(`/m4/${boundary}/index.html`);
    const result = await page.evaluate(async () => {
      const app = await (window as unknown as Host).__mtekMount({ test: { manualClock: true, renderTarget: { width: 16, height: 16 } } });
      app.debug!.step(1, 1 / 60); await app.debug!.readPixels(); const state = app.state; app.dispose(); return { state, counters: app.debug!.counters() };
    });
    expect(result.state).toBe("running"); expect(result.counters["liveTextures"]).toBe(0); expect(result.counters["livePipelines"]).toBe(0);
    writeRecord(`${boundary}-${test.info().project.name}.json`, result);
  });
}

test("unsupported shadow lights and malformed environments fail with actionable errors", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true); await page.goto("/m4/scene_lighting/index.html");
  const failures = await page.evaluate(async () => {
    const host = window as unknown as Host, errors: string[] = [];
    for (const options of [{ rendering: { shadows: { light: "Floor" } } },
      { rendering: { environment: { width: 1, height: 1, data: new Float32Array([NaN, 0, 0, 1]) } } }]) {
      try { const app = await host.__mtekMount(options); app.dispose(); errors.push("unexpected success"); }
      catch (error) { const value = error as { message: string; diagnostics?: Array<{ code: string; message: string }> }; errors.push(value.diagnostics?.map(d => `${d.code}: ${d.message}`).join("\n") ?? value.message); }
    }
    return errors;
  });
  expect(failures[0]).toContain("MTEK-E8051"); expect(failures[0]).toContain("directional-light"); expect(failures[1]).toContain("Environment components");
  writeRecord(`lighting-input-errors-${test.info().project.name}.json`, { failures });
});

test("lighting studio controls, local HDR loading and reset work without browser errors", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/lighting-studio/index.html");
  const status = page.locator("#status");
  await expect(status).toHaveText("Live · directional shadows + HDR IBL");
  await page.locator("#pause").click(); await expect(page.locator("#pause")).toHaveText("Resume motion");
  await page.screenshot({ path: test.info().outputPath("lighting-studio.png") });
  let revision = await status.getAttribute("data-revision");
  await page.locator("#shadow-quality").selectOption("high");
  await expect(status).not.toHaveAttribute("data-revision", revision!);
  revision = await status.getAttribute("data-revision");
  await page.locator("#environment").uncheck();
  await expect(status).toHaveText("Live · directional shadows");
  await page.locator("#environment").check();
  await expect(status).not.toHaveAttribute("data-revision", revision!);
  await expect(status).toHaveText("Live · directional shadows + HDR IBL");
  revision = await status.getAttribute("data-revision");
  const header = Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n");
  const pixels = Buffer.from(Array.from({ length: 8 }, () => [128, 72, 32, 129]).flat());
  await page.locator("#hdr").setInputFiles({ name: "test.hdr", mimeType: "application/octet-stream", buffer: Buffer.concat([header, pixels]) });
  await expect(status).not.toHaveAttribute("data-revision", revision!);
  await expect(page.locator("#diagnostics")).toBeHidden();
  await page.locator("#hdr").setInputFiles({ name: "invalid.hdr", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
  await expect(page.locator("#diagnostics")).toBeVisible();
  revision = await status.getAttribute("data-revision"); await page.locator("#reset").click();
  await expect(status).not.toHaveAttribute("data-revision", revision!); await expect(page.locator("#diagnostics")).toBeHidden();
  await page.locator("#pause").click(); await expect(page.locator("#pause")).toHaveText("Pause motion");
  expect(errors).toEqual([]);
  writeRecord(`lighting-studio-${test.info().project.name}.json`, { errors, localHdrLoaded: true, qualityChanged: true, reset: true });
});

test("an off-camera GPU skin animates its visible shadow", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true); await page.goto("/m4/shadow_skin/index.html");
  const result = await page.evaluate(async () => {
    const app = await (window as unknown as Host).__mtekMount({ rendering: { shadows: { light: "Sun", quality: "low" } },
      test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
    app.debug!.step(1, 1 / 60); const first = (await app.debug!.readPixels()).data;
    app.debug!.step(30, 1 / 60); const second = (await app.debug!.readPixels()).data;
    let changed = 0;
    for (let i = 0; i < first.length; i += 4) if (Math.abs(first[i]! - second[i]!) > 40) changed++;
    const counters = app.debug!.counters(); app.dispose(); return { changed, counters, disposed: app.debug!.counters() };
  });
  expect(result.counters["culledObjects"]).toBeGreaterThan(0);
  expect(result.changed).toBeGreaterThan(70);
  expect(result.disposed["liveBuffers"]).toBe(0); expect(result.disposed["liveTextures"]).toBe(0);
  writeRecord(`shadow-skin-${test.info().project.name}.json`, result);
});

for (const quality of ["low", "medium", "high"] as const) {
  test(`directional shadows: ${quality}, animated light, off-camera caster and disposal`, async ({ page, gpu }) => {
    expect(gpu.available).toBe(true);
    await page.goto("/m4/scene_lighting/index.html");
    const result = await page.evaluate(async ({ quality }: { quality: LightingQuality }) => {
      const host = window as unknown as Host;
      const inputs = { caster_x: 5, caster_y: 3, caster_visible: true };
      const plain = await host.__mtekMount({ inputs, test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
      plain.debug!.step(1, 1 / 60); const unshadowed = (await plain.debug!.readPixels()).data;
      plain.dispose();
      const diagnostics: string[] = [];
      const app = await host.__mtekMount({ inputs, devOverlay: true, rendering: { shadows: { light: "Sun", quality, size: 20 } },
        onDiagnostic: d => diagnostics.push(`${d.code}: ${d.message}`), test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
      const shot = async () => { app.debug!.step(1, 1 / 60); return (await app.debug!.readPixels()).data; };
      const shadowed = await shot(), counters = app.debug!.counters();
      app.setInput("caster_visible", false); const hidden = await shot();
      app.setInput("caster_visible", true); app.setInput("sun_yaw", -1.5707963); const rotated = await shot();
      let darkened = 0, hiddenDifference = 0, rotatedDifference = 0;
      for (let i = 0; i < unshadowed.length; i += 4) {
        if (unshadowed[i]! - shadowed[i]! > 40) darkened++;
        if (Math.abs(hidden[i]! - unshadowed[i]!) > 2) hiddenDifference++;
        if (Math.abs(rotated[i]! - shadowed[i]!) > 20) rotatedDifference++;
      }
      app.dispose(); return { darkened, hiddenDifference, rotatedDifference, counters, disposed: app.debug!.counters(), diagnostics };
    }, { quality });
    expect(result.diagnostics.filter(x => x.startsWith("MTEK-E"))).toEqual([]);
    expect(result.counters["culledObjects"]).toBeGreaterThan(0);
    expect(result.darkened).toBeGreaterThan(70);
    expect(result.hiddenDifference).toBe(0);
    expect(result.rotatedDifference).toBeGreaterThan(70);
    expect(result.counters["drawCalls"]).toBeGreaterThan(1);
    for (const [key, value] of Object.entries(result.disposed)) if (key.startsWith("live") && !key.includes("Entities")) expect(value, key).toBe(0);
    writeRecord(`shadows-${quality}-${test.info().project.name}.json`, result);
  });
}

// Independent one-dimensional hemisphere quadrature at N=V. This integrates the
// declared correlated Smith-GGX BRDF, rather than repeating the GPU importance sampler.
function integratedSpecular(roughness: number): readonly [number, number] {
  let a = 0, b = 0; const count = 32768, a2 = roughness ** 4;
  for (let i = 0; i < count; i++) {
    const nl = (i + 0.5) / count, nh2 = (1 + nl) / 2, vh = Math.sqrt(nh2);
    const d = a2 / (Math.PI * ((1 - nh2) + nh2 * a2) ** 2);
    const vis = 0.5 / (nl + Math.sqrt(nl * nl * (1 - a2) + a2));
    const term = d * vis * nl * 2 * Math.PI / count, fc = (1 - vh) ** 5;
    a += term * (1 - fc); b += term * fc;
  }
  return [a, b];
}

test("constant HDR environment matches integrated diffuse/specular, metal and roughness factors", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  await page.goto("/m4/environment_lighting/index.html");
  const result = await page.evaluate(async constant => {
    const host = window as unknown as Host;
    const app = await host.__mtekMount({ rendering: { environment: { ...constant, data: new Float32Array(constant.data), quality: "low" } },
      test: { manualClock: true, renderTarget: { width: 65, height: 65 } } });
    const rows: Array<{ metal: number; rough: number; pixel: number[] }> = [];
    for (const [metal, rough] of [[0, 0.5], [1, 0.25], [1, 0.8], [0.5, 0.6]]) {
      app.setInput("metal", metal!); app.setInput("rough", rough!); app.debug!.step(1, 1 / 60);
      const image = await app.debug!.readPixels(); rows.push({ metal: metal!, rough: rough!, pixel: Array.from(image.data.slice((32 * 65 + 32) * 4, (32 * 65 + 32) * 4 + 3)) });
    }
    app.dispose(); return { rows, counters: app.debug!.counters() };
  }, constant);
  const base = ((128 / 255 + 0.055) / 1.055) ** 2.4;
  const records = result.rows.map(row => {
    const [a, b] = integratedSpecular(row.rough), f0 = 0.04 * (1 - row.metal) + base * row.metal;
    const expected = linearRgbToSrgb8([0.2, 0.4, 0.8].map(light => light * ((1 - f0) * base * (1 - row.metal) + f0 * a + b)) as unknown as Vec3);
    for (let c = 0; c < 3; c++) expect(Math.abs(row.pixel[c]! - expected[c]!), `${JSON.stringify(row)} vs ${expected.join(",")}`).toBeLessThanOrEqual(3);
    return { ...row, expected };
  });
  expect(result.counters["liveTextures"]).toBe(0);
  writeRecord(`environment-constant-${test.info().project.name}.json`, { records, counters: result.counters });
});

test("environment yaw rotates reflections and roughness filters a bright lobe", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  await page.goto("/m4/environment_lighting/index.html");
  const result = await page.evaluate(async () => {
    const host = window as unknown as Host, width = 64, height = 32;
    const image = (kind: "hemispheres" | "lobe") => {
      const data = new Float32Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const phi = ((x + 0.5) / width - 0.5) * Math.PI * 2, theta = (y + 0.5) / height * Math.PI;
        const bright = Math.sin(phi) * Math.sin(theta) > 0.95 ? 1 : 0.005;
        const rgb = kind === "lobe" ? [bright, bright, bright] : Math.cos(phi) > 0 ? [1, 0.01, 0.01] : [0.01, 0.01, 1];
        data.set([...rgb, 1], (y * width + x) * 4);
      }
      return data;
    };
    const capture = async (rotation: number, kind: "hemispheres" | "lobe", rough: number) => {
      const app = await host.__mtekMount({ inputs: { metal: 1, rough }, rendering: { environment: { width, height, data: image(kind), rotation, quality: "low" } },
        test: { manualClock: true, renderTarget: { width: 65, height: 65 } } });
      app.debug!.step(1, 1 / 60); const data = (await app.debug!.readPixels()).data;
      app.dispose(); return Array.from(data.slice((32 * 65 + 32) * 4, (32 * 65 + 32) * 4 + 3));
    };
    return { red: await capture(Math.PI / 2, "hemispheres", 0.1), blue: await capture(-Math.PI / 2, "hemispheres", 0.1),
      sharp: await capture(0, "lobe", 0.05), blurred: await capture(0, "lobe", 1) };
  });
  expect(result.red[0]!).toBeGreaterThan(result.red[2]! + 60);
  expect(result.blue[2]!).toBeGreaterThan(result.blue[0]! + 60);
  expect(result.sharp[0]!).toBeGreaterThan(result.blurred[0]! + 50);
  writeRecord(`environment-directions-${test.info().project.name}.json`, result);
});

test("shadow and HDR environment resources recover with identical pixels and dispose", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true); await page.goto("/m4/scene_lighting/index.html");
  const before = await page.evaluate(async constant => {
    const host = window as unknown as Host;
    const diagnostics: string[] = []; host.__lightingDiagnostics = diagnostics;
    const app = await host.__mtekMount({ onDiagnostic: d => diagnostics.push(d.code), rendering: { shadows: { light: "Sun", quality: "low" }, environment: { ...constant, data: new Float32Array(constant.data), quality: "low" } },
      test: { manualClock: true, renderTarget: { width: 65, height: 65 }, recovery: { delaysMs: [0, 0, 0] } } });
    host.__lighting = app; app.debug!.step(1, 1 / 60); const pixels = Array.from((await app.debug!.readPixels()).data);
    app.debug!.loseDevice(); return pixels;
  }, constant);
  await page.waitForFunction(() => { const host = window as unknown as Host; return host.__lighting!.state === "running" && host.__lightingDiagnostics!.includes("MTEK-W8061"); });
  const after = await page.evaluate(async () => {
    const app = (window as unknown as Host).__lighting!; app.debug!.step(1, 1 / 60);
    const pixels = Array.from((await app.debug!.readPixels()).data); app.dispose(); return { pixels, counters: app.debug!.counters() };
  });
  expect(after.pixels).toEqual(before);
  for (const name of ["liveBuffers", "liveTextures", "liveSamplers", "livePipelines", "liveShaderModules", "liveBindGroups", "liveListeners"]) expect(after.counters[name], name).toBe(0);
  writeRecord(`lighting-recovery-${test.info().project.name}.json`, { identicalPixels: true, counters: after.counters });
});
