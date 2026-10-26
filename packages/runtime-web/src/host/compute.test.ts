/** Real compiler package through mountMtek; CPU fake callbacks do not execute WGSL. */
import { describe, expect, it, vi } from "vitest";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { loadGoldenProgram } from "../test-support/program.js";
import { FakeHost, asDom, type FakeHostDevice } from "../test-support/fake-host.js";
import { checkProgram } from "../scene/program.js";
import { checkManifest } from "../abi/validate.js";
import { mountMtekWith } from "./mount.js";

const id = "src/main.mtek::Required", transform = "src/main.mtek::Transform";
async function setup() {
  const golden = await loadGoldenProgram("compute-contract");
  const host = new FakeHost(); for (const [url, text] of golden.files) host.files.set(url, text);
  const reports: MtekDiagnostic[] = [];
  const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), golden.program, {
    test: { manualClock: true, renderTarget: { width: 8, height: 8 } }, onDiagnostic: (diagnostic) => reports.push(diagnostic),
  });
  return { host, app, golden, reports };
}
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
