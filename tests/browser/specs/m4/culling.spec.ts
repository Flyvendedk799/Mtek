// M4-07: frustum culling is observable (spec/runtime-abi.md sections 8.4 and 10.1, decision 0055).
// `fixtures/m4/culling` is a row of nine spheres (x = -8, -6, ..., 8; each with its own colour) seen by a camera
// that looks down -Z from z = 10 and is moved sideways through the host input `camera_x`.
//
// Moving the camera away from the objects must raise `culledObjects` and lower `drawCalls`, while the objects
// that remain in view render exactly the pixels they render with culling switched off (`test.disableCulling`).
// Nothing is mocked: the frames are read back from the offscreen render target of a real WebGPU device.
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { linearToSrgb8, srgbToLinear } from "../../support/m1-reference.ts";
import { CULLING } from "../../support/m4-fixtures.ts";

const TARGET = { width: 128, height: 64 } as const;
const CLEAR = "#202830";
const SPHERES = [
  { x: -8, colour: "#ff3030" },
  { x: -6, colour: "#ff9a30" },
  { x: -4, colour: "#f0e030" },
  { x: -2, colour: "#60e030" },
  { x: 0, colour: "#30e0c0" },
  { x: 2, colour: "#30a0ff" },
  { x: 4, colour: "#4050ff" },
  { x: 6, colour: "#b050ff" },
  { x: 8, colour: "#ff50c0" },
] as const;
const FOV_Y = Math.fround(0.9);
const DISTANCE = 10;

interface AppLike {
  setInput(name: string, value: unknown): { ok: boolean };
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
  };
}

interface Shot {
  cameraX: number;
  counters: Record<string, number>;
  /** RGBA bytes of the whole target. */
  pixels: number[];
}

/** Mounts the fixture, moves the camera to each x in turn, and reads back the counters and the frame. */
async function shoot(page: Page, cameraXs: readonly number[], disableCulling: boolean): Promise<Shot[]> {
  await page.goto(`/m4/${CULLING}/index.html`);
  return page.evaluate(
    async ({ target, xs, disable }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target, disableCulling: disable } });
      const shots: Shot[] = [];
      for (const x of xs) {
        if (!app.setInput("camera_x", x).ok) throw new Error(`camera_x = ${String(x)} was rejected`);
        app.debug.step(1, 1 / 60);
        const frame = await app.debug.readPixels();
        shots.push({ cameraX: x, counters: { ...app.debug.counters() }, pixels: Array.from(frame.data) });
      }
      app.dispose();
      return shots;
    },
    { target: TARGET, xs: [...cameraXs], disable: disableCulling },
  );
}

function rgbAt(shot: Shot, x: number, y: number): [number, number, number] {
  const i = (y * TARGET.width + x) * 4;
  return [shot.pixels[i] ?? -1, shot.pixels[i + 1] ?? -1, shot.pixels[i + 2] ?? -1];
}

function hex(colour: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(colour.slice(offset, offset + 2), 16)) as [number, number, number];
}

/** Where the centre of a sphere at world `x` lands in the target for a camera at `cameraX`: the pinhole projection, by hand. */
function projectedColumn(x: number, cameraX: number): number {
  const halfWidth = Math.tan(FOV_Y / 2) * (TARGET.width / TARGET.height) * DISTANCE;
  const ndc = (x - cameraX) / halfWidth;
  return Math.floor(((ndc + 1) / 2) * TARGET.width);
}

function expectColour(actual: [number, number, number], expected: [number, number, number], what: string): void {
  actual.forEach((channel, i) => {
    expect(Math.abs(channel - (expected[i] ?? 0)), `${what}: channel ${String(i)} is ${String(channel)}, expected ${String(expected[i])}`).toBeLessThanOrEqual(2);
  });
}

/** The 8-bit colour an unlit material of this sRGB hex colour leaves in the sRGB target. */
function rendered(colour: string): [number, number, number] {
  return hex(colour).map((byte) => linearToSrgb8(srgbToLinear(byte / 255))) as [number, number, number];
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

test.describe("frustum culling (M4-07)", () => {
  test("moving the camera away raises culledObjects, lowers drawCalls, and leaves the visible objects' pixels untouched", async ({ page, gpu }) => {
    void gpu;
    // Camera x = 0: every sphere is in view. x = 12: the view on z = 0 spans x in about [2.3, 21.7], so the spheres at
    // x = 2 (reaching in with its edge), 4, 6 and 8 are kept and the five at x <= 0 are culled. x = 100: all nine are.
    const culled = await shoot(page, [0, 12, 100], false);
    const unculled = await shoot(page, [12, 100], true);
    const [near, partial, far] = culled;
    const [partialReference, farReference] = unculled;
    if (near === undefined || partial === undefined || far === undefined || partialReference === undefined || farReference === undefined) {
      throw new Error("missing shots");
    }

    // The counters tell the story: culled up, draws down, and every drawable entity is accounted for.
    expect(near.counters).toMatchObject({ culledObjects: 0, drawCalls: 9 });
    expect(partial.counters).toMatchObject({ culledObjects: 5, drawCalls: 4 });
    expect(far.counters).toMatchObject({ culledObjects: 9, drawCalls: 0 });
    for (const shot of culled) expect(shot.counters["culledObjects"]! + shot.counters["drawCalls"]!).toBe(SPHERES.length);
    expect(partial.counters["culledObjects"]).toBeGreaterThan(near.counters["culledObjects"] ?? Infinity);
    expect(far.counters["culledObjects"]).toBeGreaterThan(partial.counters["culledObjects"] ?? Infinity);
    expect(partial.counters["drawCalls"]).toBeLessThan(near.counters["drawCalls"] ?? 0);
    expect(far.counters["drawCalls"]).toBeLessThan(partial.counters["drawCalls"] ?? 0);
    // The cumulative counters add up the three frames (0 + 5 + 9 culled, 9 + 4 + 0 drawn).
    expect(far.counters).toMatchObject({ culledObjectsTotal: 14, drawCallsTotal: 13 });

    // The unculled reference draws everything and counts nothing as culled.
    expect(partialReference.counters).toMatchObject({ culledObjects: 0, drawCalls: 9 });
    expect(farReference.counters).toMatchObject({ culledObjects: 0, drawCalls: 9 });

    // Identical pixels: culling removed only draws that could not reach the screen.
    expect(same(partial.pixels, partialReference.pixels), "x = 12: culled frame equals the unculled frame").toBe(true);
    expect(same(far.pixels, farReference.pixels), "x = 100: culled frame equals the unculled frame").toBe(true);

    // The frames are not trivially equal: the visible spheres are really there, in their own colours, at the
    // positions the projection puts them, and the far frame is nothing but clear colour.
    // (The sphere at x = 2 only reaches into the view with its edge, its centre is off screen: it is kept but not sampled.)
    for (const sphere of SPHERES.filter((s) => s.x >= 4)) {
      const column = projectedColumn(sphere.x, 12);
      expectColour(rgbAt(partial, column, TARGET.height / 2), rendered(sphere.colour), `sphere at x = ${String(sphere.x)}, culled frame`);
      expectColour(rgbAt(partialReference, column, TARGET.height / 2), rendered(sphere.colour), `sphere at x = ${String(sphere.x)}, reference frame`);
    }
    expect(new Set(partial.pixels.filter((_, i) => i % 4 !== 3).map(String)).size).toBeGreaterThan(8);
    const clear = rendered(CLEAR);
    const notClear: number[] = [];
    for (let i = 0; i < far.pixels.length; i += 4) {
      if (clear.some((channel, c) => Math.abs((far.pixels[i + c] ?? -1) - channel) > 2)) notClear.push(i / 4);
    }
    expect(notClear, "pixels of the far frame that are not the clear colour").toEqual([]);

    // And the full view (x = 0) shows all nine spheres.
    for (const sphere of SPHERES) {
      expectColour(rgbAt(near, projectedColumn(sphere.x, 0), TARGET.height / 2), rendered(sphere.colour), `sphere at x = ${String(sphere.x)}, full view`);
    }
  });

  test("a sphere whose centre is outside the view but whose radius reaches into it is kept", async ({ page, gpu }) => {
    void gpu;
    // The left edge of the view on z = 0 is cameraX - 9.66 and the left plane is tilted (the cosine of its angle to the
    // x axis is 0.719). From camera x = 18.5 the edge is at 8.84, so the centre of the sphere at x = 8 is 0.84 * 0.719 = 0.60
    // outside the plane: less than its radius 0.9, kept. From 19.2 the edge is at 9.54 and the centre is 1.1 outside:
    // more than the radius, culled. The spheres at x <= 6 are further out in both.
    const [kept, dropped] = await shoot(page, [18.5, 19.2], false);
    if (kept === undefined || dropped === undefined) throw new Error("missing shots");
    expect(kept.counters).toMatchObject({ culledObjects: 8, drawCalls: 1 });
    expect(dropped.counters).toMatchObject({ culledObjects: 9, drawCalls: 0 });
  });

  test("culling creates nothing: no pipeline, shader module, bind group, buffer or texture appears or disappears", async ({ page, gpu }) => {
    void gpu;
    const [near, partial, far] = await shoot(page, [0, 12, 100], false);
    if (near === undefined || partial === undefined || far === undefined) throw new Error("missing shots");
    // (`buffersAllocated` is left out: every `readPixels` allocates and releases a staging buffer.)
    for (const key of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "texturesAllocated", "liveBuffers", "livePipelines", "liveBindGroups"]) {
      expect(partial.counters[key], key).toBe(near.counters[key]);
      expect(far.counters[key], key).toBe(near.counters[key]);
    }
  });
});
