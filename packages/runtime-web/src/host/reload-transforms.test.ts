/**
 * Hot reload carries the transforms of the running scene onto the new one (`spec/runtime-abi.md` section 11): after
 * `replaceProgram` the picture shows the entities where the running scene had them, not where the new `init` puts
 * them. The records are carried by assignment, so the world matrices must be recomputed from them (decision 0120).
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { FakeHost, asDom, fakeProgram, minimalSceneInit, type InitContext } from "../test-support/fake-host.js";
import { installProgram } from "../test-support/mount-fixture.js";
import { mountMtekWith } from "./mount.js";

const TARGET = { width: 16, height: 8 } as const;

describe("replaceProgram and the transforms of the running scene", () => {
  it("draws a moved entity where it was before the reload, not where the new init puts it", async () => {
    const host = new FakeHost();
    const json = installProgram(host);
    const parsed = checkManifest(json);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
    let saved: InitContext | undefined;
    const init = (context: object): void => {
      minimalSceneInit(context);
      saved = context as InitContext;
    };
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(init, parsed.manifest), {
      test: { manualClock: true, renderTarget: TARGET },
    });
    if (app.debug === undefined || saved === undefined) throw new Error("no debug API");
    app.debug.step(1, 0.016);
    saved.setTransform(saved.e[0], "position", { x: 3, y: 0.5, z: 0 });
    app.debug.step(1, 0.016);

    const result = await (app as unknown as { replaceProgram(candidate: unknown): Promise<{ ok: boolean }> }).replaceProgram(fakeProgram(init, parsed.manifest));
    expect(result.ok).toBe(true);
    app.debug.step(1, 0.016);

    expect(app.debug.scene().entities[0]?.position).toEqual({ x: 3, y: 0.5, z: 0 });
    const object = host.device.buffers.find((buffer) => buffer.label === "mtek:uniform-arena:builtin:object" && !buffer.destroyed);
    if (object === undefined) throw new Error("no object arena");
    // The model matrix of entity 0 is the first thing in its block: its translation is elements 12 to 14.
    const model = new Float32Array(object.contents.buffer.slice(0, 64));
    expect([model[12], model[13], model[14]]).toEqual([3, 0.5, 0]);
    app.dispose();
  });
});
