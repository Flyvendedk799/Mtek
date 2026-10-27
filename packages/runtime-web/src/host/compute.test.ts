/** Real compiler package through mountMtek; CPU fake callbacks do not execute WGSL. */
import { describe, expect, it, vi } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { loadGoldenProgram } from "../test-support/program.js";
import { FakeHost, asDom, type FakeHostDevice } from "../test-support/fake-host.js";
import { checkProgram } from "../scene/program.js";
import { checkManifest } from "../abi/validate.js";
import { mountMtekWith } from "./mount.js";
import type { FakeBuffer } from "../test-support/fake-gpu.js";
import type { ExtensionContext } from "./extensions.js";

const id = "src/main.mtek::Required", transform = "src/main.mtek::Transform";
async function setup(instancing = false) {
  const golden = await loadGoldenProgram("compute-contract");
  const host = new FakeHost(); for (const [url, text] of golden.files) host.files.set(url, text);
  const reports: MtekDiagnostic[] = [];
  let context: ExtensionContext | undefined;
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
    test: { manualClock: true, disableInstancing: !instancing, renderTarget: { width: 8, height: 8 } }, onDiagnostic: (diagnostic) => reports.push(diagnostic),
    extensions: [{ id: "compute-test", apiVersion: 1, setup: (ctx) => { context = ctx; } }],
  });
  return { host, app, golden, reports, context: context! };
}
const positionsId = "src/main.mtek::Positions", shape = "src/main.mtek::Demo.Shape";
const sphere = { center: [0, 0, 0] as const, radius: 2 };
function positionKernel(device: FakeHostDevice): void {
  device.compute.kernel = (buffers) => {
    const shift = new Float32Array(buffers.get(1)!.contents.buffer)[0]!;
    const input = new Float32Array(buffers.get(2)!.contents.buffer), output = new Float32Array(buffers.get(3)!.contents.buffer);
    for (let i = 0; i < output.length; i++) output[i] = input[i]! + shift;
  };
}
const positionOutput = (device: FakeHostDevice): FakeBuffer => device.buffers.find((buffer) => !buffer.destroyed && buffer.label === `${positionsId} result`)!;
function cpuKernel(device: FakeHostDevice): void {
  device.compute.kernel = (buffers) => {
    const domain = new Uint32Array(buffers.get(0)!.contents.buffer);
    const bias = new Float32Array(buffers.get(1)!.contents.buffer)[0]!;
    const output = new Float32Array(buffers.get(2)!.contents.buffer);
    for (let i = 0; i < domain[0]! * domain[1]! * domain[2]!; i++) output[i] = bias + i;
  };
}
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise((resolve) => setTimeout(resolve, 0)); }
  throw new Error("mounted compute transition did not settle");
}

describe("mounted compute contract (CPU fake)", () => {
  it("separates attached geometry from shared-mesh instancing and regroups on detach", async () => {
    const { host, app } = await setup(true); positionKernel(host.latestDevice);
    app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws.map((draw) => draw.instanceCount)).toEqual([2]);
    const handle = await app.createCompute(positionsId); await handle.dispatch([72]);
    const attachment = handle.attachPositions(shape, sphere); app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws.map((draw) => draw.instanceCount)).toEqual([1, 1]);
    attachment.dispose(); app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws.map((draw) => draw.instanceCount)).toEqual([2]);
    app.dispose();
  });
  it("borrows completed positions per entity and restores the original mesh without releasing shared buffers", async () => {
    const { host, app } = await setup(); positionKernel(host.latestDevice);
    app.debug!.step(1, 1 / 60);
    const original = host.latestDevice.renderPasses.at(-1)!.draws[0]!.vertexBuffers[0]!;
    const handle = await app.createCompute(positionsId);
    expect(() => handle.attachPositions(shape, sphere)).toThrow("completed");
    handle.upload("source", original.contents); await handle.dispatch([72]);
    const output = positionOutput(host.latestDevice), attachment = handle.attachPositions(shape, sphere);
    Object.assign(attachment.inspect().bounds.center, { 0: 999 });
    expect(attachment.inspect().bounds.center).toEqual([0, 0, 0]);
    expect(() => handle.attachPositions(shape, sphere)).toThrow("already");
    app.debug!.step(1, 1 / 60);
    const draws = host.latestDevice.renderPasses.at(-1)!.draws;
    expect(draws.map((draw) => draw.vertexBuffers[0])).toEqual([output, original]);
    expect(draws[0]!.indexBuffer).toBe(draws[1]!.indexBuffer);
    expect(output.contents).toEqual(original.contents);
    attachment.dispose(); attachment.dispose();
    expect(attachment.state).toBe("disposed"); expect(output.destroyed).toBe(false);
    app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws.every((draw) => draw.vertexBuffers[0] === original)).toBe(true);
    handle.dispose(); expect(output.destroyed).toBe(true); expect(original.destroyed).toBe(false);
    app.dispose(); expect(host.latestDevice.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("hides pending or failed output and rejects partial dispatch while attached", async () => {
    const { host, app, reports } = await setup(); positionKernel(host.latestDevice);
    const handle = await app.createCompute(positionsId); await handle.dispatch([72]);
    const attachment = handle.attachPositions(shape, sphere);
    await expect(handle.dispatch([71])).rejects.toThrow("complete output");
    const pending = handle.dispatch([72]);
    app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(1);
    await pending; app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(2);
    host.latestDevice.compute.rejectDispatch = true;
    await expect(handle.dispatch([72])).rejects.toThrow("validation");
    app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(1);
    expect(reports.some((diagnostic) => diagnostic.code === "MTEK-E8050" && diagnostic.source !== null)).toBe(true);
    attachment.dispose(); app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(2);
    app.dispose();
  });

  it("uses explicit position bounds for culling and recomputes their centre after host transforms", async () => {
    const { host, app, context } = await setup(); positionKernel(host.latestDevice);
    const handle = await app.createCompute(positionsId, { shift: 10000 }); await handle.dispatch([72]);
    handle.attachPositions(shape, { center: [10000, 10000, 10000], radius: 2 });
    app.debug!.step(1, 1 / 60); expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(1);
    const entity = context.readTransforms().find((entity) => entity.name === "Shape")!;
    const outside = context.inspectScene!()!.entities.find(e => e.id === entity.id)!.bounds!;
    expect(outside.source).toBe("compute"); expect(outside.culled).toBe(true);
    expect(outside.sphere).toEqual({center:{x:10000,y:10000,z:10000},radius:2});
    context.writeTransforms([{ id: entity.id, position: { x: -10000, y: -10000, z: -10000 } }]);
    app.debug!.step(1, 1 / 60); expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(2);
    const inside = context.inspectScene!()!.entities.find(e => e.id === entity.id)!.bounds!;
    expect(inside.culled).toBe(false); expect(inside.sphere).toEqual({center:{x:0,y:0,z:0},radius:2});
    context.writeTransforms([{ id: entity.id, position: { x: 0, y: 0, z: 0 } }]);
    app.debug!.step(1, 1 / 60); expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(1);
    app.dispose();
  });

  it("rebinds attached positions after device recovery and invalidates leases on replacement", async () => {
    const { host, app, golden } = await setup(); positionKernel(host.latestDevice);
    const handle = await app.createCompute(positionsId); await handle.dispatch([72]);
    const attachment = handle.attachPositions(shape, sphere), old = positionOutput(host.latestDevice);
    app.debug!.step(1, 1 / 60); handle.setParam("shift", 1);
    host.latestDevice.loseDevice("unknown", "position recovery fixture"); await until(() => app.state === "recovering");
    const acquire = host.adapter!.requestDevice.bind(host.adapter);
    vi.spyOn(host.adapter!, "requestDevice").mockImplementation(async (descriptor) => { const device = await acquire(descriptor); positionKernel(device); return device; });
    host.timers.runNext(); await until(() => app.state !== "recovering");
    expect(app.state).toBe("running"); expect(attachment.state).toBe("attached");
    const recovered = positionOutput(host.latestDevice); expect(recovered).not.toBe(old); expect(old.destroyed).toBe(true);
    expect([...new Float32Array(recovered.contents.buffer)]).toEqual(new Array<number>(72).fill(0));
    app.debug!.step(1, 1 / 60); expect(host.latestDevice.renderPasses.at(-1)!.draws[0]!.vertexBuffers[0]).toBe(recovered);
    await handle.dispatch([72]); expect(new Float32Array(recovered.contents.buffer)[0]).toBe(1);
    expect((await app.replaceProgram!(golden.program)).ok).toBe(true); app.debug!.step(1, 1 / 60);
    expect(attachment.state).toBe("disposed"); expect(handle.state).toBe("disposed"); expect(recovered.destroyed).toBe(true);
    app.dispose();
  });

  it("rejects invalid spheres, missing targets and incompatible output before changing geometry", async () => {
    const { host, app } = await setup(); positionKernel(host.latestDevice);
    const handle = await app.createCompute(positionsId); await handle.dispatch([72]);
    for (const bounds of [{ center: [0, 0, 0] as const, radius: 0 }, { center: [Infinity, 0, 0] as const, radius: 1 }]) expect(() => handle.attachPositions(shape, bounds)).toThrow("sphere");
    expect(() => handle.attachPositions("missing", sphere)).toThrow("declared drawable");
    const wrong = await app.createCompute("src/main.mtek::VectorCopy");
    expect(() => wrong.attachPositions(shape, sphere)).toThrow("packed scalar");
    app.debug!.step(1, 1 / 60); expect(host.latestDevice.renderPasses.at(-1)!.draws).toHaveLength(2);
    app.dispose();
  });

  it("keeps program compute handles through scene reset while retiring scene-local attachments", async () => {
    const { host, app } = await setup(); positionKernel(host.latestDevice);
    const handle = await app.createCompute(positionsId); await handle.dispatch([72]);
    const attachment = handle.attachPositions(shape, sphere), output = positionOutput(host.latestDevice);
    app.debug!.pressKey("KeyR"); app.debug!.step(1, 1 / 60);
    await vi.waitFor(() => { app.debug!.step(1, 1 / 60); expect(attachment.state).toBe("disposed"); });
    expect(handle.state).toBe("ready"); expect(output.destroyed).toBe(false);
    const freshAttachment = handle.attachPositions(shape, sphere); app.debug!.step(1, 1 / 60);
    expect(host.latestDevice.renderPasses.at(-1)!.draws[0]!.vertexBuffers[0]).toBe(output);
    expect(freshAttachment.state).toBe("attached");
    app.dispose(); expect(freshAttachment.state).toBe("disposed"); expect(output.destroyed).toBe(true);
  });
  it("uses source defaults and generated writers byte-for-byte, including arrays/matrices/structs", async () => {
    const { host, app, golden } = await setup();
    const compute = golden.manifest.computePrograms!.find((compute) => compute.definition.id === transform)!;
    const checked = checkProgram(golden.program, golden.manifest); if (!checked.ok) throw new Error("program mismatch");
    const writer = checked.program.writers.get(compute.definition.uniforms!.id)!;
    const bytes = new Uint8Array(compute.defaults.length);
    writer.all({ f32: new Float32Array(bytes.buffer), u32: new Uint32Array(bytes.buffer), i32: new Int32Array(bytes.buffer) }, 0, {
      gain: 2, enabled: true, offset: { x: .25, y: 0, z: 0 }, table: [1, 2], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], settings: { value: 3 },
    });
    expect([...bytes]).toEqual(compute.defaults);
    const handle = await app.createCompute(transform);
    const uniforms = host.latestDevice.buffers.find((buffer) => buffer.label === `${transform} uniforms`)!;
    expect([...uniforms.contents]).toEqual(compute.defaults);
    handle.setParam("offset", [2, 3, 4]); handle.setParam("settings", { value: 7 }); handle.setParam("enabled", false);
    const copied = uniforms.contents.slice();
    expect(() => handle.setParam("gain", Infinity)).toThrow();
    expect(() => handle.setParam("offset", [1, 2])).toThrow();
    expect(() => handle.setParam("table", [1, NaN])).toThrow();
    expect(() => handle.setParam("settings", { wrong: 1 })).toThrow();
    expect([...uniforms.contents]).toEqual([...copied]);
    const snapshot = handle.inspect(); Object.assign(snapshot.output.layout, { size: 0 });
    expect(handle.inspect().output.bytes).toBeGreaterThan(0);
    handle.dispose(); app.dispose();
    expect(host.latestDevice.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("validates required parameters before allocation and exposes dispatch/readback while paused", async () => {
    const { host, app, reports } = await setup(); cpuKernel(host.latestDevice);
    const before = host.latestDevice.buffers.length;
    await expect(app.createCompute(id)).rejects.toThrow("required");
    await expect(app.createCompute(id, { missing: 3 })).rejects.toThrow("unknown");
    await expect(app.createCompute(id, { bias: 1e100 })).rejects.toThrow("finite");
    expect(host.latestDevice.buffers).toHaveLength(before);
    const handle = await app.createCompute(id, { bias: 3 });
    app.pause(); await handle.dispatch([3]);
    expect([...new Float32Array(await handle.readback())]).toEqual([3, 4, 5, ...new Array<number>(14).fill(0)]);
    handle.setParam("bias", 7); await handle.dispatch([1]);
    expect(new Float32Array(await handle.readback())[0]).toBe(7);
    expect(handle.inspect().completedDomain).toEqual([1, 1, 1]);
    app.dispose(); expect(handle.state).toBe("disposed");
    await expect(handle.dispatch([1])).rejects.toThrow("disposed");
    expect(reports.filter((report) => report.severity === "error")).toEqual([]);
  });

  it("keeps live compute state for a rejected candidate and invalidates handles at committed replacement", async () => {
    const { host, app, golden } = await setup(); cpuKernel(host.latestDevice);
    const handle = await app.createCompute(id, { bias: 3 }); await handle.dispatch([2]);
    const broken = structuredClone(golden.manifest);
    Object.assign(broken.computePrograms![0]!, { defaults: [999] });
    host.files.set(golden.program.manifestUrl.href, JSON.stringify(broken));
    expect((await app.replaceProgram!(golden.program)).ok).toBe(false);
    expect(handle.state).toBe("ready");
    host.files.set(golden.program.manifestUrl.href, JSON.stringify(golden.manifest));
    expect((await app.replaceProgram!(golden.program)).ok).toBe(true);
    app.debug!.step(1, 1 / 60); expect(handle.state).toBe("disposed");
    const fresh = await app.createCompute(id, { bias: 5 });
    expect(fresh.inspect().completedDomain).toBeUndefined();
    app.dispose();
  });

  it("recovers the completed dispatch through the mounted app, preserving staged parameter edits", async () => {
    const { host, app, reports } = await setup(); cpuKernel(host.latestDevice);
    const handle = await app.createCompute(id, { bias: 2 }); await handle.dispatch([4]);
    const completed = await handle.readback(); handle.setParam("bias", 9);
    host.latestDevice.loseDevice("unknown", "compute recovery fixture");
    await until(() => app.state === "recovering");
    expect(handle.state).toBe("lost");
    const acquire = host.adapter!.requestDevice.bind(host.adapter);
    vi.spyOn(host.adapter!, "requestDevice").mockImplementation(async (descriptor) => { const device = await acquire(descriptor); cpuKernel(device); return device; });
    expect(host.timers.runNext()).toBe(true);
    await until(() => app.state !== "recovering");
    expect(app.state).toBe("running"); expect(handle.state).toBe("ready");
    expect(await handle.readback()).toEqual(completed);
    await handle.dispatch([1]); expect(new Float32Array(await handle.readback())[0]).toBe(9);
    expect(reports.some((report) => report.code === "MTEK-W8061")).toBe(true);
    app.dispose();
  });

  it("rejects compute schema versions and malformed parameter metadata", async () => {
    const golden = await loadGoldenProgram("compute-contract");
    const invalid = structuredClone(golden.manifest); Object.assign(invalid.computePrograms![0]!, { api: 2 });
    expect(checkManifest(invalid).ok).toBe(false);
    const host = new FakeHost(); for (const [url, text] of golden.files) host.files.set(url, text);
    const wrong = structuredClone(golden.manifest);
    Object.assign(wrong.computePrograms!.find((compute) => compute.definition.id === transform)!.params[0]!, { name: "wrong" });
    host.files.set(golden.program.manifestUrl.href, JSON.stringify(wrong));
    await expect(mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, { test: { manualClock: true } })).rejects.toThrow();
    expect(host.latestDevice.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("retains a changed compute source map when reload reuses identical WGSL", async () => {
    const { host, app, golden } = await setup();
    const next = structuredClone(golden.manifest);
    const compute = next.computePrograms!.find((compute) => compute.definition.id === id)!;
    const map = "shaders/aaaaaaaaaaaaaaaa.mtek-map.json";
    Object.assign(compute.shader, { map });
    const url = new URL(map, golden.program.baseUrl).href;
    host.files.set(url, JSON.stringify({ shader: compute.shader.hash, entries: [] }));
    host.files.set(golden.program.manifestUrl.href, JSON.stringify(next));
    const before = host.latestDevice.shaderModules.length;
    expect((await app.replaceProgram!(golden.program)).ok).toBe(true);
    expect(host.latestDevice.shaderModules).toHaveLength(before);
    expect(host.fetched).toContain(url);
    app.debug!.step(1, 1 / 60); app.dispose();
  });
});
