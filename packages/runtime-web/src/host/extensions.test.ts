import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext, MtekExtension } from "./extensions.js";
import { healthyHost, mountOn } from "../test-support/mount-fixture.js";

describe("extension API v1", () => {
  it("installs external code, exposes copied scene snapshots and applies validated transform batches", async () => {
    const host = healthyHost(),
      dispose = vi.fn();
    let context: ExtensionContext | undefined;
    const app = await mountOn(host, {
      test: { manualClock: true },
      hostServices: { navigation: { find: () => 42 } },
      extensions: [
        {
          id: "external-navigation",
          apiVersion: 1,
          setup: (c) => {
            context = c;
            return dispose;
          },
          beforeFrame: (c) => {
            const [entity] = c.readTransforms();
            if (entity === undefined) throw new Error("no entity");
            c.writeTransforms([
              { id: entity.id, position: { x: 3, y: 2, z: 1 } },
            ]);
          },
        },
      ],
    });
    expect(context?.service<{ find(): number }>("navigation")?.find()).toBe(42);
    app.debug!.step(1, 1 / 60);
    const [entity] = context!.readTransforms();
    expect(entity?.position).toEqual({ x: 3, y: 2, z: 1 });
    expect(() =>
      context!.writeTransforms([
        { id: entity!.id, position: { x: 8, y: 0, z: 0 } },
        { id: "missing", scale: { x: 1, y: 1, z: 1 } },
      ]),
    ).toThrow(/stale/);
    expect(context!.readTransforms()[0]!.position.x).toBe(3);
    app.dispose();
    app.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(() => context!.readTransforms()).toThrow(/disposed/);
  });
  it("rolls back installed extensions and app resources when setup throws", async () => {
    const host = healthyHost(),
      dispose = vi.fn();
    await expect(
      mountOn(host, {
        extensions: [
          { id: "one", apiVersion: 1, setup: () => dispose },
          {
            id: "two",
            apiVersion: 1,
            setup: () => {
              throw new Error("broken setup");
            },
          },
        ],
      }),
    ).rejects.toThrow("broken setup");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.pendingFrames).toBe(0);
    expect(host.device.destroyed).toBe(true);
  });
  it("disables a failed extension once and continues rendering", async () => {
    const before = vi.fn(() => {
        throw new Error("plugin failed");
      }),
      dispose = vi.fn(),
      diagnostics: string[] = [];
    const app = await mountOn(healthyHost(), {
      test: { manualClock: true },
      onDiagnostic: (d) => diagnostics.push(d.message),
      extensions: [
        {
          id: "broken",
          apiVersion: 1,
          setup: () => dispose,
          beforeFrame: before,
        },
      ],
    });
    app.debug!.step(2, 1 / 60);
    expect(app.state).toBe("running");
    expect(before).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      diagnostics.some((d) => d.includes("broken") && d.includes("disabled")),
    ).toBe(true);
    app.dispose();
  });
  it("rejects unknown API versions and duplicate IDs with complete cleanup", async () => {
    const extension: MtekExtension = {
      id: "one",
      apiVersion: 1,
      setup: () => undefined,
    };
    await expect(
      mountOn(healthyHost(), { extensions: [extension, extension] }),
    ).rejects.toThrow(/duplicate/);
    await expect(
      mountOn(healthyHost(), {
        extensions: [
          { ...extension, apiVersion: 2 } as unknown as MtekExtension,
        ],
      }),
    ).rejects.toThrow(/version/);
  });
});
