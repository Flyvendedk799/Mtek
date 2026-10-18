// `startTask` without a GPU: the renderer is replaced by a fake, so these tests cover what the support module itself does:
// building the application (synchronously, as every task before the textured one does, or asynchronously, so that images can be
// loaded first), reporting a failed build, and driving the frame loop. What the pixels look like is the Playwright side's business.
import { Scene } from "three/webgpu";
import type { TaskApp } from "../src/index.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ constructed: 0, renders: 0, clearColors: [] as unknown[] }));

vi.mock("three/webgpu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/webgpu")>();
  class FakeRenderer {
    constructor() {
      fake.constructed += 1;
    }
    setPixelRatio(): void {}
    setSize(): void {}
    setClearColor(color: unknown): void {
      fake.clearColors.push(color);
    }
    init(): Promise<void> {
      return Promise.resolve();
    }
    setRenderTarget(): void {}
    render(): void {
      fake.renders += 1;
    }
    readRenderTargetPixelsAsync(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(128 * 128 * 4).fill(7));
    }
  }
  return { ...actual, WebGPURenderer: FakeRenderer };
});

// Imported after the mock is declared (vitest hoists `vi.mock`).
const { lookAtCamera, startTask } = await import("../src/index.ts");
type Hooks = NonNullable<Window["mtekTask"]>;

function simpleApp(extra: { update?: (dt: number) => void } = {}): TaskApp {
  return { scene: new Scene(), camera: lookAtCamera({ position: [0, 0, 5], target: [0, 0, 0] }), clearColor: "#102030", ...extra };
}

beforeEach(() => {
  fake.constructed = 0;
  fake.renders = 0;
  fake.clearColors.length = 0;
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startTask", () => {
  it("still takes a build function that returns the application directly", async () => {
    const updates: number[] = [];
    await startTask(() => simpleApp({ update: (dt) => updates.push(dt) }));
    const hooks = window.mtekTask as Hooks;
    expect(window.mtekTaskError).toBeUndefined();
    expect(hooks.size).toBe(128);
    await hooks.step(3, 0.016);
    expect(updates).toEqual([0.016, 0.016, 0.016]);
    expect(fake.renders).toBe(3);
  });

  it("waits for a build function that returns a promise before it creates the renderer", async () => {
    const events: string[] = [];
    await startTask(async (host) => {
      events.push("build starts");
      host.onKeyDown("Space", () => events.push("space"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("build ends");
      return simpleApp();
    });
    expect(window.mtekTaskError).toBeUndefined();
    expect(fake.constructed).toBe(1);
    expect(fake.clearColors).toHaveLength(1);
    const hooks = window.mtekTask as Hooks;
    // A handler registered by the asynchronous build works like one registered by a synchronous build.
    hooks.pressKey("Space");
    await hooks.step(1, 0);
    expect(events).toEqual(["build starts", "build ends", "space"]);
    const pixels = await hooks.readPixels();
    expect([pixels.width, pixels.height, pixels.data.length, pixels.data[0]]).toEqual([128, 128, 128 * 128 * 4, 7]);
  });

  it("reports a build that rejects through window.mtekTaskError, without creating a renderer", async () => {
    await startTask(async () => {
      await Promise.resolve();
      throw new Error("cannot load the image 'assets/swatch.png': HTTP 404");
    });
    expect(window.mtekTask).toBeUndefined();
    expect(window.mtekTaskError).toContain("cannot load the image 'assets/swatch.png': HTTP 404");
    expect(fake.constructed).toBe(0);
  });

  it("reports a build that throws synchronously the same way", async () => {
    await startTask(() => {
      throw new Error("no scene");
    });
    expect(window.mtekTask).toBeUndefined();
    expect(window.mtekTaskError).toContain("no scene");
  });
});
