import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { hardwareLaunchArgs, softwareLaunchArgs, browserChannel } from "../../tests/browser/support/launch-args.ts";
import { buildExample, serveExample } from "./serve.mjs";

const backend = process.argv[2] ?? "hardware";
assert(process.argv[4] === undefined || process.argv[4] === "structured", "Unknown vertex contract");
const structured = process.argv[4] === "structured";
const project = structured ? "structured" : "scene", outDir = structured ? ".structured-out" : ".out";
assert(["hardware", "software"].includes(backend), "Choose hardware or software");
const output = resolve(process.argv[3] ?? `target/vertex-verification-${Date.now()}`);
await mkdir(output, { recursive: true });
const reportPath = resolve(output, `${backend}.json`);
// An existing run is evidence, including failed attempts.
const reportHandle = await import("node:fs/promises").then(fs => fs.open(reportPath, "wx"));
await reportHandle.close();
const launchArgs = backend === "hardware" ? hardwareLaunchArgs() : softwareLaunchArgs();
let browser, server;
const report = { contract: structured ? "structured vertex outputs and typed varyings" : "position-only vertex", backend, launchArgs, startedAt: new Date().toISOString(), status: "running" };
try {
  if (structured) {
    buildExample();
    const repo = resolve(import.meta.dirname, "../..");
    execFileSync(resolve(repo, "target/debug", process.platform === "win32" ? "mtek.exe" : "mtek"),
      ["build", "--mode", "test", "--out", resolve(import.meta.dirname, outDir), resolve(import.meta.dirname, project)],
      { stdio: "inherit", windowsHide: true });
  } else buildExample();
  server = await serveExample(0);
  browser = await chromium.launch({ channel: browserChannel(), headless: true, args: launchArgs });
  report.browser = browser.version();
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${server.url}/probe.html`);
  await page.waitForFunction(() => window.vertexProbe !== undefined);
  const result = await page.evaluate(async structured => {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) throw new Error("No WebGPU adapter");
    const info = adapter.info;
    const adapterInfo = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
    const loaded = structured ? await import(new URL("/.structured-out/app.js", location.href).href) : undefined;
    const { program, mountMtek } = loaded === undefined ? window.vertexProbe : { program: loaded.default, mountMtek: loaded.mountMtek };
    const canvas = document.querySelector("canvas"), cases = [], diagnostics = [], disposal = [], recovery = [], replacements = [], unshadowed = new Map();
    for (const shadows of [false, true]) for (const disableInstancing of [false, true]) {
      const app = await mountMtek(canvas, program, {
        ...(shadows ? { rendering: { shadows: { light: "Sun", quality: "low" } } } : {}),
        test: { manualClock: true, disableInstancing, renderTarget: { width: 97, height: 97 }, recovery: { delaysMs: [0, 0, 0] } },
        onDiagnostic: diagnostic => diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`),
      });
      try {
        for (const scenario of [{ crowd: false, x: -10, y: 1.1, angle: 0 }, { crowd: false, x: -9.5, y: 2, angle: -0.45 }, { crowd: true, x: -10, y: 1.1, angle: 0.65 }]) {
          const shot = async authored => {
            for (const [name, value] of Object.entries({ authored, reference: !authored, crowd: scenario.crowd, shift_x: scenario.x, shift_y: scenario.y, ...(structured ? { angle: scenario.angle } : {}) })) {
              const result = app.setInput(name, value); if (!result.ok) throw new Error(JSON.stringify(result));
            }
            app.debug.step(1, 1 / 60);
            const pixels = await app.debug.readPixels();
            return { pixels: pixels.data, counters: app.debug.counters() };
          };
          const authored = await shot(true), reference = await shot(false);
          let maxError = 0, differingPixels = 0, litPixels = 0;
          for (let i = 0; i < authored.pixels.length; i += 4) {
            let error = 0;
            for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(authored.pixels[i + c] - reference.pixels[i + c]));
            maxError = Math.max(maxError, error); if (error > 2) differingPixels++;
            if (authored.pixels[i] > 20) litPixels++;
          }
          app.setInput("reference", false); app.debug.step(1, 1 / 60);
          const floor = (await app.debug.readPixels()).data;
          let geometryChangedPixels = 0, shadowChangedPixels = 0;
          const key = JSON.stringify([disableInstancing, scenario]), previous = unshadowed.get(key);
          for (let i = 0; i < floor.length; i += 4) {
            if (Math.abs(floor[i] - reference.pixels[i]) > 10) geometryChangedPixels++;
            if (shadows && previous !== undefined && Math.abs(previous[i] - reference.pixels[i]) > 10) shadowChangedPixels++;
          }
          if (!shadows) unshadowed.set(key, reference.pixels);
          cases.push({ shadows, disableInstancing, ...scenario, maxError, differingPixels, litPixels, geometryChangedPixels, shadowChangedPixels,
            authored: authored.counters, reference: reference.counters });
        }
        if (structured) {
          const recoveryInputs = { authored: true, reference: false, crowd: false, shift_x: -9.5, shift_y: 2, angle: -0.45 };
          for (const [name, value] of Object.entries(recoveryInputs)) app.setInput(name, value);
          app.debug.step(1, 1 / 60);
          const before = (await app.debug.readPixels()).data;
          app.debug.loseDevice();
          const deadline = performance.now() + 10000;
          while (app.state !== "running" || app.debug.counters().deviceRecoveries !== 1) {
            if (performance.now() > deadline || app.state === "failed") throw new Error(`Recovery failed: ${app.state}`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          app.debug.step(1, 1 / 60);
          const after = (await app.debug.readPixels()).data;
          let error = 0; for (let i = 0; i < before.length; i++) error = Math.max(error, Math.abs(before[i] - after[i]));
          recovery.push({ shadows, disableInstancing, inputs: recoveryInputs, maxError: error, counters: app.debug.counters() });
          const counts = counters => Object.fromEntries(["liveBuffers", "liveTextures", "livePipelines", "liveBindGroups", "liveShaderModules"].map(key => [key, counters[key]]));
          for (let round = 0; round < 3; round++) for (const profile of ["legacy", "structured"]) {
            const next = profile === "legacy" ? window.vertexProbe.program : program;
            const result = await app.replaceProgram(next);
            if (!result.ok) throw new Error(JSON.stringify(result));
            app.debug.step(1, 1 / 60);
            for (const [name, value] of Object.entries({ authored: true, reference: false, crowd: true, shift_x: -10, shift_y: 1.1 })) app.setInput(name, value);
            app.debug.step(1, 1 / 60);
            const actual = (await app.debug.readPixels()).data;
            const live = counts(app.debug.counters());
            app.setInput("authored", false); app.setInput("reference", true); app.debug.step(1, 1 / 60);
            const expected = (await app.debug.readPixels()).data;
            let maxError = 0; for (let i = 0; i < actual.length; i++) maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
            replacements.push({ shadows, disableInstancing, round, profile, maxError, live });
          }
        }
      } finally { app.dispose(); disposal.push(app.debug.counters()); }
    }
    return { adapter: adapterInfo, cases, diagnostics, disposal, recovery, replacements };
  }, structured);
  Object.assign(report, result, { errors });
  const adapterText = JSON.stringify(result.adapter);
  if (backend === "hardware") assert(!/swiftshader|software|llvmpipe/i.test(adapterText), `Hardware run selected software: ${adapterText}`);
  else assert(/swiftshader/i.test(adapterText), `Software run did not select SwiftShader: ${adapterText}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.diagnostics.filter(message => !structured || !/^MTEK-(W8060|W8061|W8070):/.test(message)), []);
  if (structured) {
    assert.equal(result.recovery.length, 4);
    for (const item of result.recovery) { assert.equal(item.maxError, 0); assert.equal(item.counters.deviceLosses, 1); assert.equal(item.counters.deviceRecoveries, 1); }
    assert.equal(result.replacements.length, 24);
    const previous = new Map();
    for (const item of result.replacements) {
      assert(item.maxError <= 2, JSON.stringify(item));
      const key = JSON.stringify([item.shadows, item.disableInstancing, item.profile]);
      // Round 0 warms both profiles and their lazy shared binding groups.
      if (item.round > 0) {
        if (previous.has(key)) assert.deepEqual(item.live, previous.get(key), `Resources did not plateau for ${key}`);
        previous.set(key, item.live);
      }
    }
  }
  for (const item of result.cases) {
    assert.equal(item.differingPixels, 0, JSON.stringify(item));
    assert(item.litPixels > 1000, "Scene rendered no useful pixels");
    assert(item.geometryChangedPixels > 50, "Geometry did not affect the rendered image");
    if (item.shadows) assert(item.shadowChangedPixels > 20, "Shadows did not affect the rendered image");
    assert.equal(item.authored.culledObjects, 0, "Unbounded vertex deformation was culled");
    if (item.crowd) assert.equal(item.authored.instancedDraws > 0, !item.disableInstancing, "Instanced entry did not execute");
  }
  for (const counters of result.disposal) {
    assert.equal(counters.liveBuffers, 0); assert.equal(counters.liveTextures, 0); assert.equal(counters.livePipelines, 0);
  }
  const manifest = await readFile(new URL(`./${outDir}/program.manifest.json`, import.meta.url));
  report.manifestSha256 = createHash("sha256").update(manifest).digest("hex");
  report.manifest = JSON.parse(manifest.toString("utf8"));
  report.files = [];
  async function collect(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`, url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await collect(url, path + "/");
      else {
        const bytes = await readFile(url);
        report.files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await collect(new URL(`./${outDir}/`, import.meta.url), `${outDir}/`);
  if (structured) await collect(new URL("./.out/", import.meta.url), ".out/");
  report.sources = [];
  for (const path of [`${project}/src/main.mtek`, `${project}/mtek.toml`, "verify.mjs", "serve.mjs", ...(structured ? ["scene/src/main.mtek", "scene/mtek.toml"] : [])]) {
    const bytes = await readFile(new URL(`./${path}`, import.meta.url));
    report.sources.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  report.status = "passed";
  console.log(`${backend}: ${result.cases.length} matched authored/reference cases passed`);
} catch (error) { report.status = "failed"; report.failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  await browser?.close(); await server?.close(); report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
