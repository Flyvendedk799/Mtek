import { expect, it, vi } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { BASE_URL, MANIFEST_URL, fakeProgram, minimalSceneInit } from "../test-support/fake-host.js";
import { VALID_WGSL, healthyHost, installProgram, mountOn, spanMapJson } from "../test-support/mount-fixture.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for recovery");
}

it.each((["manifest", "shader", "pipeline"] as const).flatMap((stage) => (["dispose", "recover"] as const).map((ending) => [stage, ending] as const)))("abandons a reload paused at %s after %s", async (stage, ending) => {
  const host = healthyHost();
  const app = await mountOn(host, { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } });
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const manifest = installProgram(host, (json) => {
    Object.assign((json["shaders"] as object[])[0]!, { hash, url: "shaders/aaaaaaaaaaaaaaaa.wgsl", map: "shaders/aaaaaaaaaaaaaaaa.mtek-map.json" });
    (json["materials"] as Record<string, unknown>[])[0]!["shader"] = hash;
  });
  host.files.set(`${BASE_URL}shaders/aaaaaaaaaaaaaaaa.wgsl`, VALID_WGSL);
  host.files.set(`${BASE_URL}shaders/aaaaaaaaaaaaaaaa.mtek-map.json`, spanMapJson(hash));
  const parsed = checkManifest(manifest);
  if (!parsed.ok) throw new Error("invalid candidate");
  let initializations = 0;
  const candidate = fakeProgram((ctx) => { initializations += 1; minimalSceneInit(ctx); }, parsed.manifest);
  const gate = deferred();
  const entered = deferred();
  const originalFetch = host.environment.fetch.bind(host.environment);
  const fetchSpy = vi.spyOn(host.environment, "fetch").mockImplementation(async (url) => {
    const response = await originalFetch(url);
    if ((stage === "manifest" && url === MANIFEST_URL) || (stage === "shader" && url.endsWith("aaaaaaaaaaaaaaaa.wgsl"))) {
      entered.resolve();
      await gate.promise;
    }
    return response;
  });
  const originalPipeline = host.device.createRenderPipelineAsync.bind(host.device);
  const pipelineSpy = vi.spyOn(host.device, "createRenderPipelineAsync").mockImplementation(async (descriptor) => {
    const pipeline = await originalPipeline(descriptor);
    if (stage === "pipeline") { entered.resolve(); await gate.promise; }
    return pipeline;
  });
  const replacement = app.replaceProgram!(candidate);
  await entered.promise;
  if (ending === "dispose") app.dispose();
  else {
    host.latestDevice.loseDevice("unknown", "test loss while preparing a candidate");
    await until(() => app.state === "recovering");
    expect(host.timers.runNext()).toBe(true);
    await until(() => app.state === "running");
  }
  const counters = app.debug!.counters();
  gate.resolve();
  expect((await replacement).ok).toBe(false);
  expect(initializations).toBe(stage === "pipeline" ? 1 : 0);
  const after = app.debug!.counters();
  for (const key of ["liveBuffers", "liveTextures", "liveShaderModules", "livePipelines", "liveBindGroups", "buffersAllocated", "texturesAllocated", "pipelinesCreated"]) {
    expect(after[key], `${stage}/${ending}: ${key}`).toBe(counters[key]);
  }
  expect(app.state).toBe(ending === "dispose" ? "disposed" : "running");
  if (ending === "recover") { app.debug!.step(1, 0.016); expect(host.latestDevice.renderPasses.at(-1)?.draws).toHaveLength(1); }
  fetchSpy.mockRestore();
  pipelineSpy.mockRestore();
  app.dispose();
});
