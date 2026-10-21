// Records frame-time evidence for the small-game budgets (decision 0137) on THIS machine's GPU.
// It must run on real hardware (NVIDIA, Intel or Apple, see TESTING-codey2.md section 8); CI has none, so CI
// never runs it. It records exactly what it measured, adapter included. scripts/game-budgets.mjs frames
// refuses a software adapter, so a SwiftShader run can never pass as evidence.
//
//   node scripts/record-frame-evidence.mjs <out.json> [example ...] [--mtek target/debug/mtek] [--frames 600]
//
// For each example: `mtek build --release` into a scratch folder, serve it on 127.0.0.1, open it in
// Chromium with the hardware WebGPU flags of tests/browser/support/launch-args.ts, wait for the loading
// screen to go, skip 60 warm-up frames, then time `--frames` requestAnimationFrame intervals. The interval is
// what a player sees; it is capped by the display's refresh rate, which is recorded too.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const positional = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const [out, ...named] = positional;
if (!out) throw new Error("usage: record-frame-evidence.mjs <out.json> [example ...]");
const mtek = resolve(option("--mtek", join(root, "target/debug/mtek")));
const frames = Number(option("--frames", "600"));
const budgets = JSON.parse(readFileSync(join(root, "budgets/small-games.json"), "utf8"));
const examples = named.length > 0 ? named : Object.keys(budgets.size);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wgsl": "text/plain", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
function serve(dir) {
  const server = createServer((request, response) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(request.url, "http://x").pathname).replace(/\/$/, "/index.html")));
    if (!path.startsWith(dir)) return response.writeHead(403).end();
    try {
      response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

const linux = platform() === "linux";
const browser = await chromium.launch({
  headless: process.env.MTEK_HEADLESS !== "0",
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--enable-webgpu-developer-features",
    ...(linux ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"] : [])],
});
const scratch = mkdtempSync(join(tmpdir(), "mtek-frames-"));
const evidence = {
  format: "mtek-frame-evidence/1",
  recordedAt: new Date().toISOString(),
  machine: { platform: platform(), os: release(), cpu: cpus()[0]?.model ?? null },
  browser: `chromium ${browser.version()}`,
  adapter: null,
  examples: {},
};
try {
  for (const name of examples) {
    const dir = join(scratch, name);
    const built = spawnSync(mtek, ["build", "--release", "--out", dir, join(root, "examples", name)], { encoding: "utf8" });
    if (built.status !== 0) throw new Error(`${name}: build failed\n${built.stderr}`);
    const server = await serve(dir);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector("#mtek-loading", { state: "detached", timeout: 60_000 });
    const run = await page.evaluate(async (count) => {
      const adapter = await navigator.gpu?.requestAdapter();
      const info = adapter?.info ?? {};
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      for (let i = 0; i < 60; i++) await frame();
      const deltas = [];
      let last = await frame();
      for (let i = 0; i < count; i++) {
        const now = await frame();
        deltas.push(now - last);
        last = now;
      }
      deltas.sort((a, b) => a - b);
      const at = (q) => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
      return {
        adapter: adapter ? { vendor: info.vendor ?? "", architecture: info.architecture ?? "", device: info.device ?? "", description: info.description ?? "", isFallbackAdapter: Boolean(info.isFallbackAdapter ?? adapter.isFallbackAdapter) } : null,
        frames: deltas.length,
        p50Ms: Number(at(0.5).toFixed(3)),
        p95Ms: Number(at(0.95).toFixed(3)),
        maxMs: Number(deltas[deltas.length - 1].toFixed(3)),
        failure: document.querySelector("[data-mtek-overlay]")?.textContent ?? null,
      };
    }, frames);
    evidence.adapter ??= run.adapter;
    const { adapter: _adapter, ...measured } = run;
    evidence.examples[name] = measured;
    console.log(`${name.padEnd(24)} p50 ${measured.p50Ms} ms  p95 ${measured.p95Ms} ms  max ${measured.maxMs} ms  (${measured.frames} frames)`);
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(`wrote ${out} (adapter: ${JSON.stringify(evidence.adapter)})`);
