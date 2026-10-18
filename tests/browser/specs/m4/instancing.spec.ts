// M4-08: compatible instancing is measured, not merely labelled (spec/runtime-abi.md section 8.4, decision 0059).
// Every scene is rendered on the real GPU twice: with instancing and with `test.disableInstancing` (one draw call per
// entity), read back from the offscreen render target. The counters must show the draw calls dropping to the number
// of groups, and the two pictures must agree within one 8-bit step (the matrices come from an instance vertex buffer
// instead of a uniform block; both are binary32, so in practice they agree exactly).
//
//  - `instancing_grid`: 500 boxes with the same mesh and the same parameters, each with its own rotation and scale
//    (the material reads the world normal and the world position, so a wrong model or normal matrix shows).
//  - `instancing_mixed`: 17 entities in groups that must stay apart (another mesh, another parameter block, another
//    material, a lone entity), one of which moves.
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { INSTANCING_GRID, INSTANCING_MIXED } from "../../support/m4-fixtures.ts";

const TARGET = { width: 256, height: 128 } as const;
const CLEAR = [0x20, 0x28, 0x30] as const;

interface Step {
  /** Host inputs set before the frame. */
  inputs?: Record<string, number>;
  /** `debug.setParam(entity, param, value)` before the frame. */
  setParam?: { entity: string; param: string; value: unknown };
}

interface Shot {
  counters: Record<string, number>;
  /** RGBA, top row first. */
  pixels: Uint8Array;
}

interface AppLike {
  setInput(name: string, value: unknown): { ok: boolean };
  dispose(): void;
  readonly state: string;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
    setParam(entity: string, param: string, value: unknown): void;
    loseDevice(): void;
  };
}

/** Mounts a fixture with `test`, runs the steps (one frame each) and reads the counters and the frame after every one. */
async function render(page: Page, fixture: string, test: Record<string, unknown>, steps: readonly Step[]): Promise<Shot[]> {
  await page.goto(`/m4/${fixture}/index.html`);
  const raw = await page.evaluate(
    async ({ target, test: testOptions, plan }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target, ...testOptions } });
      const toBase64 = (bytes: Uint8Array): string => {
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const shots: { counters: Record<string, number>; pixels: string }[] = [];
      for (const step of plan) {
        for (const [name, value] of Object.entries(step.inputs ?? {})) {
          if (!app.setInput(name, value).ok) throw new Error(`${name} = ${String(value)} was rejected`);
        }
        if (step.setParam !== undefined) app.debug.setParam(step.setParam.entity, step.setParam.param, step.setParam.value);
        app.debug.step(1, 1 / 60);
        const counters = { ...app.debug.counters() };
        const frame = await app.debug.readPixels();
        shots.push({ counters, pixels: toBase64(frame.data) });
      }
      app.dispose();
      return shots;
    },
    { target: TARGET, test, plan: [...steps] },
  );
  return raw.map((shot) => ({ counters: shot.counters, pixels: new Uint8Array(Buffer.from(shot.pixels, "base64")) }));
}

/** Largest per-channel difference between two frames and the number of pixels that differ at all. */
function compare(a: Uint8Array, b: Uint8Array): { maxDiff: number; differing: number } {
  expect(a.length).toBe(b.length);
  let maxDiff = 0;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixel = 0;
    for (let c = 0; c < 4; c++) pixel = Math.max(pixel, Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)));
    maxDiff = Math.max(maxDiff, pixel);
    if (pixel > 0) differing += 1;
  }
  return { maxDiff, differing };
}

/** Pixels that are not the clear colour, and the number of distinct colours among them. */
function content(pixels: Uint8Array): { drawn: number; colours: number } {
  const colours = new Set<number>();
  let drawn = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (CLEAR.some((channel, c) => Math.abs((pixels[i + c] ?? 0) - channel) > 2)) {
      drawn += 1;
      colours.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0));
    }
  }
  return { drawn, colours: colours.size };
}

const ON = {};
const OFF = { disableInstancing: true };
const FRAME = [{}] as const;

test.describe("compatible instancing (M4-08)", () => {
  test("500 identical boxes: one instanced draw instead of 500, and the same picture", async ({ page, gpu }, testInfo) => {
    void gpu;
    const [instanced] = await render(page, INSTANCING_GRID, ON, FRAME);
    const [individual] = await render(page, INSTANCING_GRID, OFF, FRAME);
    if (instanced === undefined || individual === undefined) throw new Error("missing shots");

    // The counters: 500 entities in one group (same mesh, same pipeline key, same parameter block).
    expect(instanced.counters).toMatchObject({ drawCalls: 1, instancedDraws: 1, culledObjects: 0, sharedParamBlocks: 1, ownedParamBlocks: 0, liveEntities: 500 });
    expect(individual.counters).toMatchObject({ drawCalls: 500, instancedDraws: 0, culledObjects: 0, sharedParamBlocks: 1, ownedParamBlocks: 0 });
    // The instanced scene created exactly one more pipeline (the instanced variant) and one more buffer (the instance buffer).
    expect((instanced.counters["pipelinesCreated"] ?? 0) - (individual.counters["pipelinesCreated"] ?? 0)).toBe(1);
    expect((instanced.counters["buffersAllocated"] ?? 0) - (individual.counters["buffersAllocated"] ?? 0)).toBe(1);

    // The picture is real: the boxes cover a large part of the target in many shades.
    const seen = content(instanced.pixels);
    expect(seen.drawn).toBeGreaterThan(8000);
    expect(seen.colours).toBeGreaterThan(30);

    // And identical to the one-draw-per-entity picture (within 1/255 per channel; ties of equal depth resolve alike
    // because both draw in the same order).
    const difference = compare(instanced.pixels, individual.pixels);
    testInfo.annotations.push({
      type: "m4-instancing",
      description: `500 boxes: drawCalls ${String(individual.counters["drawCalls"])} -> ${String(instanced.counters["drawCalls"])}, instancedDraws ${String(instanced.counters["instancedDraws"])}, max channel difference ${String(difference.maxDiff)}/255, ${String(difference.differing)} of ${String(TARGET.width * TARGET.height)} pixels differ, ${String(seen.drawn)} drawn in ${String(seen.colours)} colours`,
    });
    expect(difference.maxDiff, `${String(difference.differing)} pixels differ`).toBeLessThanOrEqual(1);
  });

  test("the instanced and the individual path agree while the camera moves and culling removes entities", async ({ page, gpu }) => {
    void gpu;
    // Camera x = 30: the left edge of the view on z = 0 is 30 - 25.1 = 4.9 (a 2:1 target, fov 0.9, distance 26), so about the
    // columns x >= 4 (9 of 25, 180 boxes) are in view and about 320 are culled. The three runs differ only in the options.
    const steps: Step[] = [{ inputs: { camera_x: 0 } }, { inputs: { camera_x: 30 } }];
    const both = await render(page, INSTANCING_GRID, ON, steps);
    const noInstancing = await render(page, INSTANCING_GRID, OFF, steps);
    const neither = await render(page, INSTANCING_GRID, { disableInstancing: true, disableCulling: true }, steps);
    const [, culledOn] = both;
    const [, culledOff] = noInstancing;
    const [, unculled] = neither;
    if (culledOn === undefined || culledOff === undefined || unculled === undefined) throw new Error("missing shots");

    const culled = culledOn.counters["culledObjects"] ?? -1;
    expect(culled).toBeGreaterThan(300);
    expect(culled).toBeLessThan(340);
    // Culling is applied to entities before they are grouped: the survivors are still one group of 500 - culled.
    expect(culledOn.counters).toMatchObject({ drawCalls: 1, instancedDraws: 1, culledObjects: culled });
    expect(culledOff.counters).toMatchObject({ drawCalls: 500 - culled, instancedDraws: 0, culledObjects: culled });
    expect(unculled.counters).toMatchObject({ drawCalls: 500, instancedDraws: 0, culledObjects: 0 });
    expect(content(culledOn.pixels).drawn).toBeGreaterThan(2000);

    expect(compare(culledOn.pixels, culledOff.pixels).maxDiff).toBeLessThanOrEqual(1);
    // The M4-07 equivalence still holds on top of instancing: the culled frame equals the frame of everything drawn.
    expect(compare(culledOn.pixels, unculled.pixels).maxDiff).toBeLessThanOrEqual(1);
    expect(compare(both[0]?.pixels ?? new Uint8Array(), noInstancing[0]?.pixels ?? new Uint8Array()).maxDiff).toBeLessThanOrEqual(1);
  });

  test("a mixed scene groups only compatible draws", async ({ page, gpu }) => {
    void gpu;
    const [instanced] = await render(page, INSTANCING_MIXED, ON, FRAME);
    const [individual] = await render(page, INSTANCING_MIXED, OFF, FRAME);
    if (instanced === undefined || individual === undefined) throw new Error("missing shots");

    // 17 entities: the six boxes A (one group), the four spheres S (another mesh), the three boxes C (another parameter block),
    // the three boxes U (another material) are four instanced draws; the lone bigger box E is drawn alone: 5 draw calls.
    // The parameter blocks: A, S and E share the Shade block with the default tint, C has its own tint, U has the Unlit block.
    expect(instanced.counters).toMatchObject({ drawCalls: 5, instancedDraws: 4, sharedParamBlocks: 3, ownedParamBlocks: 0, liveEntities: 17 });
    expect(individual.counters).toMatchObject({ drawCalls: 17, instancedDraws: 0, sharedParamBlocks: 3, ownedParamBlocks: 0 });
    expect(content(instanced.pixels).drawn).toBeGreaterThan(300);
    expect(compare(instanced.pixels, individual.pixels).maxDiff).toBeLessThanOrEqual(1);
  });

  test("a parameter that differs takes its entity out of its group, and the picture stays right", async ({ page, gpu }) => {
    void gpu;
    // A1 gets another tint: it leaves the A group (five boxes remain, one instanced draw) and is drawn alone. The groups S, C,
    // U stay; E stays alone: 4 instanced draws (A, S, C, U), 2 individual (A1, E) = 6 draw calls. The Shade block with the
    // default tint is still shared by A0, A2..A5, S0..S3 and E0; A1 owns a block of its own now.
    const steps: Step[] = [{}, { setParam: { entity: "A1", param: "tint", value: { r: 0.1, g: 0.2, b: 1, a: 1 } } }];
    const on = await render(page, INSTANCING_MIXED, ON, steps);
    const off = await render(page, INSTANCING_MIXED, OFF, steps);
    const [before, after] = on;
    const [, afterOff] = off;
    if (before === undefined || after === undefined || afterOff === undefined) throw new Error("missing shots");
    expect(before.counters).toMatchObject({ drawCalls: 5, instancedDraws: 4 });
    expect(after.counters).toMatchObject({ drawCalls: 6, instancedDraws: 4, sharedParamBlocks: 3, ownedParamBlocks: 1 });
    expect(afterOff.counters).toMatchObject({ drawCalls: 17, instancedDraws: 0 });
    // The tint change is visible, and the same in both paths.
    expect(compare(before.pixels, after.pixels).differing).toBeGreaterThan(20);
    expect(compare(after.pixels, afterOff.pixels).maxDiff).toBeLessThanOrEqual(1);
  });

  test("moving one instance changes only that instance's output and uploads only its matrix", async ({ page, gpu }) => {
    void gpu;
    // A5 follows mover_x along y = 4. At 0 and at 3 its box (half-diagonal 0.87) stays within x in [-1, 4], y in [3.1, 4.9]; on the
    // 256 x 128 target (half-height 16 tan(0.45) = 7.73, half-width 15.46) that is columns 117..164 and rows 22..40. The
    // rectangle below adds a margin; everything outside it must be bit-identical between the two frames.
    const steps: Step[] = [{ inputs: { mover_x: 0 } }, { inputs: { mover_x: 3 } }];
    const on = await render(page, INSTANCING_MIXED, ON, steps);
    const off = await render(page, INSTANCING_MIXED, OFF, steps);
    const [still, moved] = on;
    const [stillOff, movedOff] = off;
    if (still === undefined || moved === undefined || stillOff === undefined || movedOff === undefined) throw new Error("missing shots");

    const rect = { x0: 110, x1: 172, y0: 16, y1: 46 };
    let inside = 0;
    for (let y = 0; y < TARGET.height; y++) {
      for (let x = 0; x < TARGET.width; x++) {
        const i = (y * TARGET.width + x) * 4;
        const same = [0, 1, 2, 3].every((c) => still.pixels[i + c] === moved.pixels[i + c]);
        const inRect = x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1;
        if (!same && inRect) inside += 1;
        if (!same && !inRect) throw new Error(`pixel (${String(x)}, ${String(y)}) changed outside the mover's rectangle`);
      }
    }
    expect(inside, "pixels that changed where the mover was and is").toBeGreaterThan(20);

    // Still one instanced group: the move did not regroup anything (the mover stays visible and compatible).
    expect(moved.counters).toMatchObject({ drawCalls: 5, instancedDraws: 4 });
    // What was uploaded for the move: the object block of the mover (MtekObject is 128 bytes) and, of its instance record, the
    // one float that changed (model column 3, x): two uploads, 132 bytes, nothing else.
    expect((moved.counters["uploads"] ?? 0) - (still.counters["uploads"] ?? 0)).toBe(2);
    expect((moved.counters["uploadBytes"] ?? 0) - (still.counters["uploadBytes"] ?? 0)).toBe(128 + 4);
    // With instancing disabled the same move uploads the object block alone.
    expect((movedOff.counters["uploads"] ?? 0) - (stillOff.counters["uploads"] ?? 0)).toBe(1);
    expect((movedOff.counters["uploadBytes"] ?? 0) - (stillOff.counters["uploadBytes"] ?? 0)).toBe(128);

    expect(compare(still.pixels, stillOff.pixels).maxDiff).toBeLessThanOrEqual(1);
    expect(compare(moved.pixels, movedOff.pixels).maxDiff).toBeLessThanOrEqual(1);
  });

  test("instancing survives a device loss: the instance buffer is rebuilt and the picture is the same", async ({ page, gpu }) => {
    void gpu;
    await page.goto(`/m4/${INSTANCING_MIXED}/index.html`);
    const result = await page.evaluate(
      async ({ target }) => {
        const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
        const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target, recovery: { delaysMs: [30, 30, 30] } } });
        app.setInput("mover_x", 2);
        app.debug.step(2, 1 / 60);
        const read = async (): Promise<{ counters: Record<string, number>; pixels: number[] }> => {
          const counters = { ...app.debug.counters() };
          return { counters, pixels: Array.from((await app.debug.readPixels()).data) };
        };
        const before = await read();
        app.debug.loseDevice();
        while (app.state !== "recovering") await new Promise((resolve) => setTimeout(resolve, 1));
        while (app.state === "recovering") await new Promise((resolve) => setTimeout(resolve, 5));
        const state: string = (app as { state: string }).state;
        app.debug.step(1, 1 / 60);
        const after = await read();
        app.dispose();
        return { before, after, state };
      },
      { target: TARGET },
    );
    expect(result.state).toBe("running");
    expect(result.before.counters).toMatchObject({ drawCalls: 5, instancedDraws: 4 });
    expect(result.after.counters).toMatchObject({ drawCalls: 5, instancedDraws: 4, deviceLosses: 1, deviceRecoveries: 1, sharedParamBlocks: 3 });
    // Every GPU object exists again, the instance buffer and the instanced pipelines among them.
    for (const name of ["liveBuffers", "livePipelines", "liveShaderModules"]) expect(result.after.counters[name], name).toBe(result.before.counters[name]);
    expect(result.after.counters["pipelinesCreated"]).toBe((result.before.counters["pipelinesCreated"] ?? 0) * 2);
    expect(compare(Uint8Array.from(result.after.pixels), Uint8Array.from(result.before.pixels))).toEqual({ maxDiff: 0, differing: 0 });
    expect(content(Uint8Array.from(result.after.pixels)).drawn).toBeGreaterThan(300);
  });
});
