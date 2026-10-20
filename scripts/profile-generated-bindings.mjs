// CPU-only execution of bindings from the frozen runtime workloads; no renderer/GPU claims.
// Build a workload with mtek build, then: node scripts/profile-generated-bindings.mjs <dist> [profile.json]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Session } from "node:inspector";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

const [, , directory, profilePath] = process.argv;
if (!directory) throw new Error("built program directory required");
const program = await import(pathToFileURL(resolve(directory, "app.js")).href);
const manifest = JSON.parse(readFileSync(resolve(directory, "program.manifest.json"), "utf8"));
const bindings = Object.values(program.scenes)[0].bindings;
const context = { frame: { time: 0, delta: Math.fround(1 / 60), index: 0 } };
const values = new Array(bindings.length);
function frames(count) {
  for (let frame = 0; frame < count; frame++) {
    context.frame.time = Math.fround(frame / 60);
    context.frame.index = frame;
    for (let index = 0; index < bindings.length; index++) values[index] = bindings[index](context);
  }
}
function checksum() {
  let sum = 0;
  for (const value of values) for (const component of Object.values(value)) sum += component;
  if (!Number.isFinite(sum)) throw new Error("non-finite workload output");
  return sum;
}
frames(12000);
const session = new Session();
const post = (method, parameters = {}) => new Promise((yes, no) => session.post(method, parameters, (error, result) => error ? no(error) : yes(result)));
if (profilePath) {
  session.connect();
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 1000 });
  await post("Profiler.start");
}
const samples = [];
for (let sample = 0; sample < 9; sample++) {
  const start = performance.now();
  frames(1200);
  samples.push({ milliseconds: performance.now() - start, checksum: checksum() });
}
if (samples.some((sample) => sample.checksum !== samples[0].checksum)) throw new Error("unstable outputs");
if (profilePath) {
  const { profile } = await post("Profiler.stop");
  session.disconnect();
  // Keep raw samples and call graph, but remove machine-specific absolute source paths.
  for (const node of profile.nodes) {
    const frame = node.callFrame;
    if (frame.url.startsWith("file:")) frame.url = relative(process.cwd(), fileURLToPath(frame.url)).replaceAll("\\", "/");
  }
  const raw = JSON.stringify(profile) + "\n";
  writeFileSync(profilePath, profilePath.endsWith(".gz") ? gzipSync(raw) : raw);
}
console.log(JSON.stringify({ node: process.version, workload: manifest.project?.name ?? "runtime-bench",
  bindings: bindings.length, warmupFrames: 12000, framesPerSample: 1200,
  profileEnabled: Boolean(profilePath), samples }, null, 2));
