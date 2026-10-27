# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m4\scene-lighting.spec.ts >> lighting studio controls, local HDR loading and reset work without browser errors
- Location: specs\m4\scene-lighting.spec.ts:37:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#status')
Expected: "Live · directional shadows + HDR IBL"
Received: "Preparing lighting…"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('#status') with timeout 5000ms
  - waiting for locator('#status')
    14 × locator resolved to <span id="status" role="status">Preparing lighting…</span>
       - unexpected value "Preparing lighting…"

```

```yaml
- status: Preparing lighting…
```

# Test source

```ts
  1   | import { expect, test } from "../../support/fixtures.ts";
  2   | import { writeRecord } from "./configurator-support.ts";
  3   | import { linearRgbToSrgb8, type Vec3 } from "../../support/reference-shading.ts";
  4   | import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/host/types.js";
  5   | import type { LightingQuality } from "../../../../packages/runtime-web/src/render/options.js";
  6   | 
  7   | type Host = { __mtekMount(options: MtekMountOptions): Promise<MtekApp>; __lighting?: MtekApp; __lightingDiagnostics?: string[] };
  8   | const constant = { width: 2, height: 1, data: [0.2, 0.4, 0.8, 1, 0.2, 0.4, 0.8, 1] };
  9   | 
  10  | for (const boundary of ["lit_texture_boundary", "lit_sampler_boundary"]) {
  11  |   test(`scene lighting fits default resource limits at ${boundary}`, async ({ page, gpu }) => {
  12  |     expect(gpu.available).toBe(true); await page.goto(`/m4/${boundary}/index.html`);
  13  |     const result = await page.evaluate(async () => {
  14  |       const app = await (window as unknown as Host).__mtekMount({ test: { manualClock: true, renderTarget: { width: 16, height: 16 } } });
  15  |       app.debug!.step(1, 1 / 60); await app.debug!.readPixels(); const state = app.state; app.dispose(); return { state, counters: app.debug!.counters() };
  16  |     });
  17  |     expect(result.state).toBe("running"); expect(result.counters["liveTextures"]).toBe(0); expect(result.counters["livePipelines"]).toBe(0);
  18  |     writeRecord(`${boundary}-${test.info().project.name}.json`, result);
  19  |   });
  20  | }
  21  | 
  22  | test("unsupported shadow lights and malformed environments fail with actionable errors", async ({ page, gpu }) => {
  23  |   expect(gpu.available).toBe(true); await page.goto("/m4/scene_lighting/index.html");
  24  |   const failures = await page.evaluate(async () => {
  25  |     const host = window as unknown as Host, errors: string[] = [];
  26  |     for (const options of [{ rendering: { shadows: { light: "Floor" } } },
  27  |       { rendering: { environment: { width: 1, height: 1, data: new Float32Array([NaN, 0, 0, 1]) } } }]) {
  28  |       try { const app = await host.__mtekMount(options); app.dispose(); errors.push("unexpected success"); }
  29  |       catch (error) { const value = error as { message: string; diagnostics?: Array<{ code: string; message: string }> }; errors.push(value.diagnostics?.map(d => `${d.code}: ${d.message}`).join("\n") ?? value.message); }
  30  |     }
  31  |     return errors;
  32  |   });
  33  |   expect(failures[0]).toContain("MTEK-E8051"); expect(failures[0]).toContain("directional-light"); expect(failures[1]).toContain("Environment components");
  34  |   writeRecord(`lighting-input-errors-${test.info().project.name}.json`, { failures });
  35  | });
  36  | 
  37  | test("lighting studio controls, local HDR loading and reset work without browser errors", async ({ page, gpu }) => {
  38  |   expect(gpu.available).toBe(true);
  39  |   const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  40  |   await page.goto("/lighting-studio/index.html");
  41  |   const status = page.locator("#status");
> 42  |   await expect(status).toHaveText("Live · directional shadows + HDR IBL");
      |                        ^ Error: expect(locator).toHaveText(expected) failed
  43  |   await page.locator("#pause").click(); await expect(page.locator("#pause")).toHaveText("Resume motion");
  44  |   await page.screenshot({ path: test.info().outputPath("lighting-studio.png") });
  45  |   let revision = await status.getAttribute("data-revision");
  46  |   await page.locator("#shadow-quality").selectOption("high");
  47  |   await expect(status).not.toHaveAttribute("data-revision", revision!);
  48  |   revision = await status.getAttribute("data-revision");
  49  |   await page.locator("#environment").uncheck();
  50  |   await expect(status).toHaveText("Live · directional shadows");
  51  |   await page.locator("#environment").check();
  52  |   await expect(status).not.toHaveAttribute("data-revision", revision!);
  53  |   await expect(status).toHaveText("Live · directional shadows + HDR IBL");
  54  |   revision = await status.getAttribute("data-revision");
  55  |   const header = Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n");
  56  |   const pixels = Buffer.from(Array.from({ length: 8 }, () => [128, 72, 32, 129]).flat());
  57  |   await page.locator("#hdr").setInputFiles({ name: "test.hdr", mimeType: "application/octet-stream", buffer: Buffer.concat([header, pixels]) });
  58  |   await expect(status).not.toHaveAttribute("data-revision", revision!);
  59  |   await expect(page.locator("#diagnostics")).toBeHidden();
  60  |   await page.locator("#hdr").setInputFiles({ name: "invalid.hdr", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
  61  |   await expect(page.locator("#diagnostics")).toBeVisible();
  62  |   revision = await status.getAttribute("data-revision"); await page.locator("#reset").click();
  63  |   await expect(status).not.toHaveAttribute("data-revision", revision!); await expect(page.locator("#diagnostics")).toBeHidden();
  64  |   await page.locator("#pause").click(); await expect(page.locator("#pause")).toHaveText("Pause motion");
  65  |   expect(errors).toEqual([]);
  66  |   writeRecord(`lighting-studio-${test.info().project.name}.json`, { errors, localHdrLoaded: true, qualityChanged: true, reset: true });
  67  | });
  68  | 
  69  | test("an off-camera GPU skin animates its visible shadow", async ({ page, gpu }) => {
  70  |   expect(gpu.available).toBe(true); await page.goto("/m4/shadow_skin/index.html");
  71  |   const result = await page.evaluate(async () => {
  72  |     const app = await (window as unknown as Host).__mtekMount({ rendering: { shadows: { light: "Sun", quality: "low" } },
  73  |       test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
  74  |     app.debug!.step(1, 1 / 60); const first = (await app.debug!.readPixels()).data;
  75  |     app.debug!.step(30, 1 / 60); const second = (await app.debug!.readPixels()).data;
  76  |     let changed = 0;
  77  |     for (let i = 0; i < first.length; i += 4) if (Math.abs(first[i]! - second[i]!) > 40) changed++;
  78  |     const counters = app.debug!.counters(); app.dispose(); return { changed, counters, disposed: app.debug!.counters() };
  79  |   });
  80  |   expect(result.counters["culledObjects"]).toBeGreaterThan(0);
  81  |   expect(result.changed).toBeGreaterThan(70);
  82  |   expect(result.disposed["liveBuffers"]).toBe(0); expect(result.disposed["liveTextures"]).toBe(0);
  83  |   writeRecord(`shadow-skin-${test.info().project.name}.json`, result);
  84  | });
  85  | 
  86  | for (const quality of ["low", "medium", "high"] as const) {
  87  |   test(`directional shadows: ${quality}, animated light, off-camera caster and disposal`, async ({ page, gpu }) => {
  88  |     expect(gpu.available).toBe(true);
  89  |     await page.goto("/m4/scene_lighting/index.html");
  90  |     const result = await page.evaluate(async ({ quality }: { quality: LightingQuality }) => {
  91  |       const host = window as unknown as Host;
  92  |       const inputs = { caster_x: 5, caster_y: 3, caster_visible: true };
  93  |       const plain = await host.__mtekMount({ inputs, test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
  94  |       plain.debug!.step(1, 1 / 60); const unshadowed = (await plain.debug!.readPixels()).data;
  95  |       plain.dispose();
  96  |       const diagnostics: string[] = [];
  97  |       const app = await host.__mtekMount({ inputs, devOverlay: true, rendering: { shadows: { light: "Sun", quality, size: 20 } },
  98  |         onDiagnostic: d => diagnostics.push(`${d.code}: ${d.message}`), test: { manualClock: true, renderTarget: { width: 97, height: 97 } } });
  99  |       const shot = async () => { app.debug!.step(1, 1 / 60); return (await app.debug!.readPixels()).data; };
  100 |       const shadowed = await shot(), counters = app.debug!.counters();
  101 |       app.setInput("caster_visible", false); const hidden = await shot();
  102 |       app.setInput("caster_visible", true); app.setInput("sun_yaw", -1.5707963); const rotated = await shot();
  103 |       let darkened = 0, hiddenDifference = 0, rotatedDifference = 0;
  104 |       for (let i = 0; i < unshadowed.length; i += 4) {
  105 |         if (unshadowed[i]! - shadowed[i]! > 40) darkened++;
  106 |         if (Math.abs(hidden[i]! - unshadowed[i]!) > 2) hiddenDifference++;
  107 |         if (Math.abs(rotated[i]! - shadowed[i]!) > 20) rotatedDifference++;
  108 |       }
  109 |       app.dispose(); return { darkened, hiddenDifference, rotatedDifference, counters, disposed: app.debug!.counters(), diagnostics };
  110 |     }, { quality });
  111 |     expect(result.diagnostics.filter(x => x.startsWith("MTEK-E"))).toEqual([]);
  112 |     expect(result.counters["culledObjects"]).toBeGreaterThan(0);
  113 |     expect(result.darkened).toBeGreaterThan(70);
  114 |     expect(result.hiddenDifference).toBe(0);
  115 |     expect(result.rotatedDifference).toBeGreaterThan(70);
  116 |     expect(result.counters["drawCalls"]).toBeGreaterThan(1);
  117 |     for (const [key, value] of Object.entries(result.disposed)) if (key.startsWith("live") && !key.includes("Entities")) expect(value, key).toBe(0);
  118 |     writeRecord(`shadows-${quality}-${test.info().project.name}.json`, result);
  119 |   });
  120 | }
  121 | 
  122 | // Independent one-dimensional hemisphere quadrature at N=V. This integrates the
  123 | // declared correlated Smith-GGX BRDF, rather than repeating the GPU importance sampler.
  124 | function integratedSpecular(roughness: number): readonly [number, number] {
  125 |   let a = 0, b = 0; const count = 32768, a2 = roughness ** 4;
  126 |   for (let i = 0; i < count; i++) {
  127 |     const nl = (i + 0.5) / count, nh2 = (1 + nl) / 2, vh = Math.sqrt(nh2);
  128 |     const d = a2 / (Math.PI * ((1 - nh2) + nh2 * a2) ** 2);
  129 |     const vis = 0.5 / (nl + Math.sqrt(nl * nl * (1 - a2) + a2));
  130 |     const term = d * vis * nl * 2 * Math.PI / count, fc = (1 - vh) ** 5;
  131 |     a += term * (1 - fc); b += term * fc;
  132 |   }
  133 |   return [a, b];
  134 | }
  135 | 
  136 | test("constant HDR environment matches integrated diffuse/specular, metal and roughness factors", async ({ page, gpu }) => {
  137 |   expect(gpu.available).toBe(true);
  138 |   await page.goto("/m4/environment_lighting/index.html");
  139 |   const result = await page.evaluate(async constant => {
  140 |     const host = window as unknown as Host;
  141 |     const app = await host.__mtekMount({ rendering: { environment: { ...constant, data: new Float32Array(constant.data), quality: "low" } },
  142 |       test: { manualClock: true, renderTarget: { width: 65, height: 65 } } });
```