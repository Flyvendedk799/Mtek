import {describe, expect, it} from "vitest";
import type {MtekExtension} from "@mtek/runtime-web";
import {InspectorController} from "../src/index.js";
import {healthyHost, mountOn} from "../../runtime-web/src/test-support/mount-fixture.js";

describe("mounted extension API contract (fake GPU, no hardware work)", () => {
  it("edits and undoes actual mounted transforms without private runtime access in the extension", async () => {
    const inspector = new InspectorController({interval:0}), host = healthyHost();
    const app = await mountOn(host,{test:{manualClock:true},extensions:[inspector.extension]});
    const id = inspector.snapshot().entities[0]!.id; inspector.select(id); inspector.edit([{id,position:{x:4,y:2,z:1}}]);
    app.debug!.step(1,0); expect(inspector.snapshot().entities[0]!.position).toEqual({x:4,y:2,z:1});
    inspector.undo(); app.debug!.step(1,0); expect(inspector.snapshot().entities[0]!.position.x).toBe(0);
    app.dispose(); expect(inspector.snapshot().status).toBe("detached"); expect(host.pendingFrames).toBe(0); expect(host.device.destroyed).toBe(true);
  });
  it("rolls back a previously installed inspector after another extension fails setup", async () => {
    const inspector = new InspectorController(), host = healthyHost();
    await expect(mountOn(host,{extensions:[inspector.extension,{id:"broken",apiVersion:1,setup(){throw new Error("setup rejected");}}]})).rejects.toThrow(/setup rejected/);
    expect(inspector.snapshot().status).toBe("detached"); expect(host.device.destroyed).toBe(true);
  });
  it("rejects an unsupported extension version before inspector setup", async () => {
    const inspector = new InspectorController(), host = healthyHost();
    await expect(mountOn(host,{extensions:[{...inspector.extension,apiVersion:2} as unknown as MtekExtension]})).rejects.toThrow(/unsupported.*version/i);
    expect(inspector.snapshot().status).toBe("detached"); expect(host.pendingFrames).toBe(0);
  });
});
