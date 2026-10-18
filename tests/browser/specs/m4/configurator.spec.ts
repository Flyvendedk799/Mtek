// M4-10, the M4 exit gate on the material configurator (examples/material-configurator): the multi-file program loads a supported
// GLB model, changes its material inputs, survives resize and produces repeatable captures, on the hardware adapter.
//
// Every expected pixel comes from the CPU model of support/configurator-scene.ts: a ray tracer over the geometry read from the
// GLB file itself, the camera and lights written down from main.mtek, and the PBR oracle `shadePbr` (reference-shading.ts). It
// shares no code with the compiler, the runtime or the GPU. A pixel is only asserted where its whole footprint sees the same
// surface of the same entity; edge pixels are never asserted. The renders are 8-bit `rgba8unorm-srgb` readbacks; the tolerance
// is the 3/255 of the PBR spec (decision 0057). The compile-time failure of an unsupported asset feature and the instancing
// of a repeated-object scene are in configurator-variants.spec.ts.
import { expect, test } from "../../support/fixtures.ts";
import {
  DEFAULT_INPUTS,
  NODE_WORLD,
  UNSTABLE,
  applyHostValues,
  configuratorLights,
  configuratorScene,
  expectedImage,
  hexBytes,
  pixelsOf,
  type ExpectedImage,
  type HostValues,
} from "../../support/configurator-scene.ts";
import { rotation, type Quat } from "../../support/m1-reference.ts";
import { CONFIGURATOR_HOST_URL, CONFIGURATOR_URL } from "../../support/m4-configurator.ts";
import { linearRgbToSrgb8, shadePbr } from "../../support/reference-shading.ts";
import { changedPixels, digest, expectMatches, inputsOf, runPlan, writeRecord, type PlanStep } from "./configurator-support.ts";
import { canvasBackingSize, captureOrThrow, mount, openFixture, setCanvasCssSize, status, step } from "./resilience-support.ts";

const TARGET = { width: 320, height: 240 } as const;
const ENTITIES = ["Floor", "Seat", "Back", "Crest", "LegFL", "LegFR", "LegBL", "LegBR", "RailFront", "RailBack"] as const;
/** Every entity of the example must own at least this many stable pixels in the 320 x 240 image (the rails are the smallest). */
const MIN_STABLE = 60;

/** The oracle's image is deterministic in (inputs, size): computed once per key. */
const cache = new Map<string, ExpectedImage>();
function expectedFor(values: HostValues, width: number, height: number): ExpectedImage {
  const key = `${JSON.stringify(values)}@${String(width)}x${String(height)}`;
  let image = cache.get(key);
  if (image === undefined) {
    image = expectedImage(configuratorScene(applyHostValues(values)), width, height);
    cache.set(key, image);
  }
  return image;
}

const record: Record<string, unknown> = {};

test.afterAll(() => {
  writeRecord("m4-configurator-counters.json", record);
});

test.describe("the material configurator on the hardware adapter (M4-10)", () => {
  test("loads the model: assets ready, entities placed by the node accessors, counters, and the picture the oracle predicts", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(120_000);
    const result = await runPlan(page, CONFIGURATOR_URL, { renderTarget: TARGET }, [{ label: "first frame" }]);
    expect(result.reported, "no runtime diagnostics").toEqual([]);
    expect(result.state).toBe("running");

    // The assets: one packaged mesh file, ready before mount resolved.
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ kind: "mesh-data", state: "ready" });
    expect(result.assetEvents.map((e) => e.state)).toEqual(["pending", "ready"]);

    // The entities sit where the node accessors put them: the hand-derived world matrices of the oracle (translation and rotation).
    const placed = new Map(result.mounted.scene.entities.map((e) => [e.name, e]));
    const entityNodes: ReadonlyArray<readonly [string, string]> = [
      ["Floor", "Floor"], ["Seat", "Seat"], ["Back", "Back"], ["Crest", "Crest"], ["LegFL", "LegFL"], ["LegFR", "LegFR"],
      ["LegBL", "LegBL"], ["LegBR", "LegBR"], ["RailFront", "Rails"], ["RailBack", "Rails"],
    ];
    for (const [entity, node] of entityNodes) {
      const snapshot = placed.get(entity);
      expect(snapshot, `entity ${entity}`).toBeDefined();
      const world = NODE_WORLD[node];
      if (snapshot === undefined || world === undefined) continue;
      const position = vectorOf(snapshot.position);
      [world[12], world[13], world[14]].forEach((expected, i) => expect(position[i], `${entity} position[${String(i)}]`).toBeCloseTo(expected ?? NaN, 5));
      const turned = rotation(quatOf(snapshot.rotation));
      for (let i = 0; i < 12; i += 1) {
        if (i % 4 === 3) continue;
        expect(turned[i], `${entity} rotation element ${String(i)}`).toBeCloseTo(world[i] ?? NaN, 5);
      }
    }

    // The picture, pixel by pixel, against the oracle with the inputs at their defaults (the factors of the GLB's materials).
    const shot = result.shots[0];
    if (shot === undefined) throw new Error("no shot");
    const expected = expectedFor({}, TARGET.width, TARGET.height);
    const comparison = expectMatches(shot, expected, Object.fromEntries(ENTITIES.map((name) => [name, MIN_STABLE])));
    expect(comparison.compared).toBeGreaterThan(40000);
    expect(comparison.perEntity["clear"]).toBeGreaterThan(5000);

    // Hand-derived pixels. The corner of the target sees the clear colour #1b1f27. The middle of the target is the ray through the
    // camera target: it meets the top of the seat (the plane y = 0.48) at (0, 0.48, 2.6 (1 - 0.67/0.7)) with the normal +Y.
    const at = (x: number, y: number): number[] => [0, 1, 2].map((c) => shot.data[(y * shot.width + x) * 4 + c] ?? -1);
    expect(at(0, 0)).toEqual([...hexBytes("#1b1f27")]);
    const z = 2.6 * (1 - 0.67 / 0.7);
    const centre = at(TARGET.width / 2, TARGET.height / 2);
    const hand = linearRgbToSrgb8(
      shadePbr({
        N: [0, 1, 0],
        V: [0, 1.15 - 0.48, 2.6 - z],
        position: [0, 0.48, z],
        lights: configuratorLights(DEFAULT_INPUTS.sunIntensity),
        baseColor: DEFAULT_INPUTS.seat.baseColor,
        metallic: DEFAULT_INPUTS.seat.metallic,
        roughness: DEFAULT_INPUTS.seat.roughness,
        ambientColor: [1, 1, 1],
        ambientIntensity: 0.12,
      }),
    );
    centre.forEach((value, i) => expect(Math.abs(value - (hand[i] ?? 0)), `centre pixel channel ${String(i)}: GPU ${String(value)}, hand ${String(hand[i])}`).toBeLessThanOrEqual(3));

    // Counters. 12 entities are alive: 10 drawn and the two lights. The four legs are one instanced draw (one mesh, one pipeline,
    // one constant "Oak" parameter block), so the 10 drawn entities need 7 draw calls; the seat, the back, the two rails and the
    // floor own their blocks (five), and the Oak block of the legs and the crest is the one shared block. Pipelines: Pbr, the
    // custom Striped material and the instanced variant of Pbr; shader modules: the two materials.
    const counters = shot.counters;
    record["load"] = { counters, mounted: result.mounted.counters, comparison, digest: digest(shot.data) };
    testInfo.annotations.push({ type: "m4-configurator-load", description: `${String(comparison.compared)} pixels compared, max error ${String(comparison.maxError)}/255; counters ${JSON.stringify({ drawCalls: counters["drawCalls"], instancedDraws: counters["instancedDraws"], culledObjects: counters["culledObjects"], liveEntities: counters["liveEntities"], sharedParamBlocks: counters["sharedParamBlocks"], ownedParamBlocks: counters["ownedParamBlocks"], pipelinesCreated: counters["pipelinesCreated"] })}` });
    expect(counters).toMatchObject({
      liveEntities: 12,
      drawCalls: 7,
      instancedDraws: 1,
      culledObjects: 0,
      sharedParamBlocks: 1,
      ownedParamBlocks: 5,
      pipelinesCreated: 3,
      shaderModulesCreated: 2,
      failedMaterials: 0,
      framesRendered: 1,
    });
  });

  test("changing host inputs changes exactly the colours they drive, and the picture follows the oracle after every change", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(120_000);
    // Each step sets some inputs on top of the previous ones. `affected` are the entities whose pixels may change; a null means
    // the whole picture may (the sun lights everything).
    const steps: Array<{ label: string; values: HostValues; affected: readonly string[] | null }> = [
      { label: "defaults", values: {}, affected: null },
      { label: "seat green and rough", values: { seat_color: "#2e7d32", seat_metallic: 0, seat_roughness: 0.5 }, affected: ["Seat"] },
      { label: "seat gold metal", values: { seat_color: "#d4af37", seat_metallic: 1, seat_roughness: 0.25 }, affected: ["Seat"] },
      { label: "rails copper", values: { frame_color: "#b87333", frame_metallic: 0, frame_roughness: 0.7 }, affected: ["RailFront", "RailBack"] },
      { label: "back stripes red and white", values: { stripe_a: "#ffffff", stripe_b: "#c0392b", back_roughness: 0.2 }, affected: ["Back"] },
      { label: "sun off", values: { sun_intensity: 0 }, affected: null },
      { label: "sun blinding", values: { sun_intensity: 8 }, affected: null },
    ];
    const plan: PlanStep[] = steps.map((s) => ({ label: s.label, inputs: inputsOf(s.values) }));
    const result = await runPlan(page, CONFIGURATOR_URL, { renderTarget: TARGET }, plan);
    expect(result.reported).toEqual([]);

    let accumulated: HostValues = {};
    const notes: string[] = [];
    const images: ExpectedImage[] = [];
    result.shots.forEach((shot, index) => {
      const spec = steps[index];
      if (spec === undefined) throw new Error("step");
      expect(shot.inputs.every((input) => input.ok), `${spec.label}: every setInput was accepted`).toBe(true);
      accumulated = { ...accumulated, ...spec.values };
      const expected = expectedFor(accumulated, TARGET.width, TARGET.height);
      images.push(expected);
      const comparison = expectMatches(shot, expected, Object.fromEntries(ENTITIES.map((name) => [name, spec.label === "sun off" ? 20 : MIN_STABLE])));
      notes.push(`${spec.label}: ${String(comparison.compared)} px, max ${String(comparison.maxError)}/255`);
    });

    // Isolation: a step that changes the inputs of some entities changes only their pixels (the stable pixels of every other
    // entity, and the background, are byte-identical to the previous frame), and every one of them really changes.
    for (let index = 1; index < result.shots.length; index += 1) {
      const spec = steps[index];
      const before = result.shots[index - 1];
      const after = result.shots[index];
      const expected = images[index];
      if (spec === undefined || before === undefined || after === undefined || expected === undefined) throw new Error("step");
      const changed = new Set(changedPixels(before.data, after.data));
      if (spec.affected === null) {
        expect(changed.size, `${spec.label}: the picture changes`).toBeGreaterThan(10000);
        continue;
      }
      const owners = new Set(spec.affected.map((name) => expected.names.indexOf(name)));
      for (const i of changed) {
        const owner = expected.entity[i] ?? UNSTABLE;
        expect(owner === UNSTABLE || owners.has(owner), `${spec.label}: pixel ${String(i % expected.width)},${String(Math.floor(i / expected.width))} changed but belongs to ${expected.names[owner] ?? "the background"}`).toBe(true);
      }
      for (const name of spec.affected) {
        const own = pixelsOf(expected, name);
        const moved = own.filter((i) => changed.has(i)).length;
        expect(moved / own.length, `${spec.label}: share of ${name}'s pixels that changed`).toBeGreaterThan(0.9);
      }
    }

    // A change of inputs is not a rebuild: no shader, pipeline, bind group or texture is created and no buffer is left alive (the readback
    // buffer of each step is allocated and released again, so the running total of allocated buffers is not asked).
    for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "texturesAllocated", "liveBuffers", "liveTextures"]) {
      expect(new Set(result.shots.map((shot) => shot.counters[name])).size, `${name} is constant across the changes`).toBe(1);
    }
    // Both stripe colours and both metals are really different pictures: the frames are pairwise distinct.
    expect(new Set(result.shots.map((shot) => digest(shot.data))).size).toBe(result.shots.length);
    testInfo.annotations.push({ type: "m4-configurator-inputs", description: notes.join("; ") });
    record["inputs"] = { steps: notes, digests: result.shots.map((shot) => digest(shot.data)), counters: result.shots.map((shot) => ({ label: shot.label, pipelinesCreated: shot.counters["pipelinesCreated"], uploads: shot.counters["uploads"], uploadBytes: shot.counters["uploadBytes"] })) };
  });

  test("rejected inputs leave the picture as it was: wrong type, translucent colour, unknown name", async ({ page, gpu }) => {
    void gpu;
    const result = await runPlan(page, CONFIGURATOR_URL, { renderTarget: TARGET }, [
      { label: "defaults" },
      {
        label: "rejected",
        inputs: [
          ["seat_color", "not-a-colour"],
          ["seat_color", "#11223344"],
          ["seat_metallic", "high"],
          ["no_such_input", 1],
        ],
      },
    ]);
    const [first, second] = result.shots;
    if (first === undefined || second === undefined) throw new Error("missing shots");
    expect(second.inputs).toEqual([
      { name: "seat_color", ok: false, code: "MTEK-E8041" },
      { name: "seat_color", ok: false, code: "MTEK-E8100" },
      { name: "seat_metallic", ok: false, code: "MTEK-E8041" },
      { name: "no_such_input", ok: false, code: "MTEK-E8040" },
    ]);
    expect(digest(second.data), "a rejected input changes nothing").toBe(digest(first.data));
    expect(result.state).toBe("running");
  });

  test("survives resize: at every size and aspect the picture is the one the oracle predicts, the inputs persist and the same size gives the same bytes", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(180_000);
    const values: HostValues = { seat_color: "#d4af37", seat_metallic: 1, seat_roughness: 0.25, stripe_b: "#c0392b" };
    await openFixture(page, CONFIGURATOR_URL);
    await setCanvasCssSize(page, 320, 240);
    await mount(page, { test: { manualClock: true, canvasRenderTarget: true } });
    for (const [name, value] of Object.entries(values)) {
      const ok = await page.evaluate(([n, v]) => (window as unknown as { __h: { app: { setInput(a: string, b: unknown): { ok: boolean } } } }).__h.app.setInput(n, v).ok, [name, value] as const);
      expect(ok, `setInput ${name}`).toBe(true);
    }

    const notes: string[] = [];
    const bytes = new Map<string, string>();
    const sizes = [[320, 240], [480, 240], [240, 480], [200, 200], [400, 300], [96, 72], [320, 240]] as const;
    const seatPixels = new Map<string, number>();
    for (const [width, height] of sizes) {
      await setCanvasCssSize(page, width, height);
      await step(page, 2);
      const pixels = await captureOrThrow(page);
      expect(await canvasBackingSize(page)).toEqual({ width, height });
      const label = `${String(width)}x${String(height)}`;
      const small = width * height < 20000;
      const comparison = expectMatches(
        { label, counters: {}, width: pixels.width, height: pixels.height, data: pixels.data, inputs: [] },
        expectedFor(values, width, height),
        small ? { Seat: 1, Floor: 1 } : { Seat: 40, Back: 40, Floor: 100 },
      );
      notes.push(`${label}: ${String(comparison.compared)} px, max ${String(comparison.maxError)}/255`);
      seatPixels.set(label, comparison.perEntity["Seat"] ?? 0);
      const previous = bytes.get(label);
      if (previous !== undefined) expect(digest(pixels.data), `${label} again: the same bytes as the first time`).toBe(previous);
      bytes.set(label, digest(pixels.data));
    }
    // The vertical field of view is fixed, so the size of the chair in pixels depends on the height of the canvas only (a stale aspect
    // ratio would stretch it): the seat covers as many pixels on a canvas 1.5 times wider and the same height, and about four times
    // as many on a canvas twice as tall (more, since fewer of its pixels are edge pixels the oracle leaves out).
    const normal = seatPixels.get("320x240") ?? NaN;
    expect((seatPixels.get("480x240") ?? NaN) / normal, "seat pixels, 480x240 against 320x240").toBeGreaterThan(0.95);
    expect((seatPixels.get("480x240") ?? NaN) / normal).toBeLessThan(1.05);
    expect((seatPixels.get("240x480") ?? NaN) / normal, "seat pixels, 240x480 against 320x240").toBeGreaterThan(3.6);
    expect((seatPixels.get("240x480") ?? NaN) / normal).toBeLessThan(4.8);

    const after = await status(page);
    expect(after.state).toBe("running");
    expect(after.reported, "no runtime diagnostics").toEqual([]);
    expect(after.overlayText).toBeNull();
    expect(after.counters["liveTextures"], "depth, render target and the built-in white texture").toBe(3);
    expect(after.counters["framesSkipped"]).toBe(0);
    expect(after.counters["pipelinesCreated"], "a resize creates no pipeline").toBe(3);
    testInfo.annotations.push({ type: "m4-configurator-resize", description: notes.join("; ") });
    record["resize"] = { sizes: notes, counters: after.counters };
  });

  test("a change of the pixel ratio resizes the backing store and the picture follows the oracle", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(120_000);
    await openFixture(page, CONFIGURATOR_URL);
    await setCanvasCssSize(page, 200, 150);
    await mount(page, { test: { manualClock: true, canvasRenderTarget: true } });
    await step(page, 1);
    const notes: string[] = [];
    const compare = async (width: number, height: number, label: string): Promise<void> => {
      const pixels = await captureOrThrow(page);
      const comparison = expectMatches({ label, counters: {}, width: pixels.width, height: pixels.height, data: pixels.data, inputs: [] }, expectedFor({}, width, height), { Seat: 20, Floor: 100 });
      notes.push(`${label}: ${String(comparison.compared)} px, max ${String(comparison.maxError)}/255`);
    };
    await compare(200, 150, "ratio 1");

    const cdp = await page.context().newCDPSession(page);
    // Chromium re-evaluates media queries at the next lifecycle update, which a changed window size forces (as in the resilience spec).
    let width = 1280;
    const metrics = (deviceScaleFactor: number): Promise<unknown> => {
      width += 1;
      return cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 720, deviceScaleFactor, mobile: false });
    };
    await metrics(2);
    await page.waitForFunction(() => (document.getElementById("mtek") as HTMLCanvasElement).width === 400, undefined, { timeout: 10_000 });
    expect(await canvasBackingSize(page)).toEqual({ width: 400, height: 300 });
    await step(page, 1);
    await compare(400, 300, "ratio 2");
    await metrics(1);
    await page.waitForFunction(() => (document.getElementById("mtek") as HTMLCanvasElement).width === 200, undefined, { timeout: 10_000 });
    await step(page, 1);
    await compare(200, 150, "ratio 1 again");
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    const after = await status(page);
    expect(after.state).toBe("running");
    expect(after.reported).toEqual([]);
    testInfo.annotations.push({ type: "m4-configurator-dpr", description: notes.join("; ") });
  });

  test("captures are repeatable: two independent mounts with the manual clock read back byte-identical frames", async ({ browser, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(120_000);
    const plan: PlanStep[] = [
      { label: "defaults", frames: 3 },
      { label: "seat and stripes", inputs: inputsOf({ seat_color: "#2e7d32", seat_metallic: 0.5, seat_roughness: 0.4, stripe_a: "#f1c40f" }), frames: 30 },
      { label: "sun", inputs: inputsOf({ sun_intensity: 6 }), frames: 1 },
    ];
    const runOnce = async (steps: readonly PlanStep[]): Promise<string[]> => {
      const context = await browser.newContext({ baseURL: process.env["MTEK_SERVER_URL"] ?? "" });
      try {
        const page = await context.newPage();
        const result = await runPlan(page, CONFIGURATOR_URL, { renderTarget: TARGET }, steps);
        expect(result.reported).toEqual([]);
        return result.shots.map((shot) => digest(shot.data));
      } finally {
        await context.close();
      }
    };
    const first = await runOnce(plan);
    const second = await runOnce(plan);
    expect(second, "the second mount reads back the same bytes at every step").toEqual(first);
    expect(new Set(first).size, "and the steps differ from each other (the captures are not blank)").toBe(3);
    // A different sequence is a different picture: the equality above is not a constant.
    const other = await runOnce([{ label: "defaults", frames: 3 }, { label: "other", inputs: inputsOf({ seat_color: "#2e7d32", seat_metallic: 0.5, seat_roughness: 0.4, stripe_a: "#00ff00" }), frames: 30 }]);
    expect(other[0]).toBe(first[0]);
    expect(other[1]).not.toBe(first[1]);
    testInfo.annotations.push({ type: "m4-configurator-capture-digests", description: first.map((d) => d.slice(0, 16)).join(" ") });
    record["repeatable"] = { digestsMountA: first, digestsMountB: second, differentSequence: other };
  });

  test("the host page drives the program with setInput: its controls change the colours the oracle predicts", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(120_000);
    await page.addInitScript((target) => {
      (window as unknown as { mtekHostOptions: unknown }).mtekHostOptions = { test: { manualClock: true, renderTarget: target } };
    }, TARGET);
    await page.goto(CONFIGURATOR_HOST_URL);
    await page.waitForFunction(() => (window as unknown as { mtekApp?: unknown }).mtekApp !== undefined, undefined, { timeout: 20_000 });

    interface HostApp {
      debug: { step(frames: number, dt: number): void; readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>; counters(): Record<string, number> };
    }
    const frame = async (): Promise<{ width: number; height: number; data: Uint8Array }> => {
      const raw = await page.evaluate(async () => {
        const app = (window as unknown as { mtekApp: HostApp }).mtekApp;
        app.debug.step(1, 1 / 60);
        const pixels = await app.debug.readPixels();
        let text = "";
        for (let i = 0; i < pixels.data.length; i += 0x8000) text += String.fromCharCode(...pixels.data.subarray(i, i + 0x8000));
        return { width: pixels.width, height: pixels.height, base64: btoa(text) };
      });
      return { width: raw.width, height: raw.height, data: new Uint8Array(Buffer.from(raw.base64, "base64")) };
    };

    // What the page shows when it opens: the values of its controls (hex colours), applied to the program at the first frame.
    const initial: HostValues = {
      seat_color: "#c46159", seat_metallic: 0, seat_roughness: 0.85,
      frame_color: "#e7e7ea", frame_metallic: 1, frame_roughness: 0.3,
      stripe_a: "#e8e2d0", stripe_b: "#2a3f5f", back_roughness: 0.6, sun_intensity: 3,
    };
    const first = await frame();
    const notes: string[] = [];
    const check = (label: string, pixels: { width: number; height: number; data: Uint8Array }, values: HostValues): void => {
      const comparison = expectMatches({ label, counters: {}, width: pixels.width, height: pixels.height, data: pixels.data, inputs: [] }, expectedFor(values, TARGET.width, TARGET.height), Object.fromEntries(ENTITIES.map((name) => [name, MIN_STABLE])));
      notes.push(`${label}: ${String(comparison.compared)} px, max ${String(comparison.maxError)}/255`);
    };
    check("page as opened", first, initial);

    // Drive the real controls.
    const set = async (input: string, value: string): Promise<void> => {
      const control = page.locator(`[data-input="${input}"]`);
      if ((await control.getAttribute("type")) === "range") {
        await control.evaluate((element, v) => {
          (element as HTMLInputElement).value = v;
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
      } else {
        await control.fill(value);
      }
    };
    await set("seat_color", "#2e7d32");
    await set("seat_metallic", "0.7");
    await set("seat_roughness", "0.35");
    await set("stripe_b", "#c0392b");
    await set("sun_intensity", "5.5");
    const changed: HostValues = { ...initial, seat_color: "#2e7d32", seat_metallic: 0.7, seat_roughness: 0.35, stripe_b: "#c0392b", sun_intensity: 5.5 };
    const second = await frame();
    check("after the controls", second, changed);
    expect(digest(second.data)).not.toBe(digest(first.data));
    await expect(page.locator("#status")).toHaveText("");
    const counters = await page.evaluate(() => (window as unknown as { mtekApp: HostApp }).mtekApp.debug.counters());
    expect(counters["pipelinesCreated"]).toBe(3);
    testInfo.annotations.push({ type: "m4-configurator-host-page", description: notes.join("; ") });
    record["hostPage"] = { notes };
  });
});

function vectorOf(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    return [Number(v["x"]), Number(v["y"]), Number(v["z"])];
  }
  throw new Error(`not a vector: ${JSON.stringify(value)}`);
}

function quatOf(value: unknown): Quat {
  if (Array.isArray(value)) return value.map(Number) as unknown as Quat;
  const v = value as Record<string, unknown>;
  return [Number(v["x"]), Number(v["y"]), Number(v["z"]), Number(v["w"])];
}
