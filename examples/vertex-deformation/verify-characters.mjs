import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { browserChannel, hardwareLaunchArgs, softwareLaunchArgs } from "../../tests/browser/support/launch-args.ts";
import { prepareCharacters } from "./prepare-characters.mjs";

const here = import.meta.dirname, repo = resolve(here, "../.."), backend = process.argv[2] ?? "hardware";
assert(["hardware", "software"].includes(backend), "Choose hardware or software");
const output = resolve(process.argv[3] ?? `target/character-vertex-${Date.now()}`);
await mkdir(output, { recursive: true });
const reportPath = join(output, `${backend}.json`), handle = await open(reportPath, "wx"); await handle.close();
const launchArgs = backend === "hardware" ? hardwareLaunchArgs() : softwareLaunchArgs();
const report = { contract: "authored deformation after production-character skinning", backend, launchArgs, startedAt: new Date().toISOString(), status: "running" };
let browser, server, page;
try {
  report.originalAssets = await prepareCharacters();
  const bundle = await build({ entryPoints: [join(here, "characters-probe.ts")], bundle: true, write: false, format: "iife", globalName: "characterProbe", target: "es2022" });
  const files = new Map(), root = join(here, ".characters-out"); let referenceCount = 0;
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      if (pathname === "/probe.html") { response.writeHead(200, { "content-type": "text/html" }); response.end('<canvas width="97" height="97"></canvas>'); return; }
      if (pathname === "/cpu-reference" && request.method === "POST") {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; assert(size <= 8 * 1024 * 1024, "CPU reference payload too large"); chunks.push(chunk); }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")), prefix = `/cpu/${++referenceCount}/`;
        files.set(prefix + "program.manifest.json", Buffer.from(JSON.stringify(payload.manifest)));
        for (const file of payload.files) { assert(/^assets\/[0-9a-f]{16}\.bin$/.test(file.url)); files.set(prefix + file.url, Buffer.from(file.bytes, "base64")); }
        response.writeHead(200, { "content-type": "text/plain" }); response.end(prefix); return;
      }
      const cached = files.get(pathname), relative = pathname.replace(/^\/cpu\/\d+\//, "/");
      const path = resolve(root, `.${relative}`); assert(path.startsWith(root + sep), "Path outside example output");
      const bytes = cached ?? await readFile(path);
      response.writeHead(200, { "content-type": ({ ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" })[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }); response.end(bytes);
    } catch (error) { response.writeHead(404); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: browserChannel(), headless: true, args: launchArgs }); report.browser = browser.version();
  page = await browser.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "probe.html"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(base => window.characterProbe.runCharacterProbe(base), base);
  Object.assign(report, result, { errors, cpuReferencePrograms: referenceCount });
  assert.deepEqual(errors, []); assert.equal(result.cases.length, 32); assert.equal(result.boundsCases.length, 16); assert.equal(result.recovery.length, 4); assert.equal(result.replacements.length, 12);
  assert.equal(referenceCount, 34);
  assert.equal(result.assetMaterialCases.length, 2);
  assert.equal(result.samplers.cases.length, 36); assert.equal(result.samplers.sensitivity.length, 4);
  const adapter = JSON.stringify(result.adapter);
  if (backend === "hardware") assert(!result.adapter.isFallbackAdapter && !/swiftshader|software|llvmpipe/i.test(adapter), `Expected hardware: ${adapter}`);
  else assert(/swiftshader/i.test(adapter), `Expected SwiftShader: ${adapter}`);
  report.manifest = JSON.parse(await readFile(join(root, "program.manifest.json"), "utf8"));
  report.files = [];
  async function collect(dir, prefix) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name), label = prefix + item.name;
      if (item.isDirectory()) await collect(path, label + "/");
      else { const bytes = await readFile(path); report.files.push({ path: label, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }); }
    }
  }
  await collect(root, ".characters-out/");
  report.sources = [];
  for (const path of ["examples/vertex-deformation/characters/src/main.mtek", "examples/vertex-deformation/characters/mtek.toml", "examples/vertex-deformation/characters-probe.ts", "examples/vertex-deformation/mixed-sampler-probe.ts", "examples/vertex-deformation/prepare-characters.mjs", "examples/vertex-deformation/verify-characters.mjs", "packages/runtime-web/src/mesh/skinning.ts", "packages/runtime-web/src/render/resources.ts"]) {
    const bytes = await readFile(join(repo, path)); report.sources.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  report.status = "passed"; console.log(`${backend}: 32 CPU/GPU-reference character cases plus 2 native-material cases, 16 bounds transitions, 4 recoveries and 12 replacements passed`);
} catch (error) {
  report.status = "failed"; report.failure = String(error);
  try { report.partial = await page?.evaluate(() => window.__characterProgress); } catch { /* The original failure is authoritative. */ }
  process.exitCode = 1; console.error(error);
} finally {
  await browser?.close(); if (server !== undefined) await new Promise(resolve => server.close(resolve));
  report.finishedAt = new Date().toISOString(); await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
