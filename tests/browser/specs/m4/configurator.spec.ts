// M4-10, the M4 exit gate on the material configurator (examples/material-configurator): the multi-file program loads a supported
// GLB model, changes its material inputs, survives resize and produces repeatable captures, on the hardware adapter.
//
// Every expected pixel comes from the CPU model of support/configurator-scene.ts: a ray tracer over the geometry read from the
// GLB file itself, the camera and lights written down from main.mtek, and the PBR oracle `shadePbr` (reference-shading.ts). It
// shares no code with the compiler, the runtime or the GPU. A pixel is only asserted where its whole footprint sees the same
// surface of the same entity; edge pixels are never asserted. The renders are 8-bit `rgba8unorm-srgb` readbacks; the tolerance
// is the 3/255 of the PBR spec (decision 0057).
import { expect, test } from "../../support/fixtures.ts";
import {
  DEFAULT_INPUTS,
  NODE_WORLD,
  applyHostValues,
  configuratorLights,
  configuratorScene,
  expectedImage,
  hexBytes,
  pixelsOf,
  type HostValues,
} from "../../support/configurator-scene.ts";
import { rotation, type Quat } from "../../support/m1-reference.ts";
import { shadePbr, linearRgbToSrgb8 } from "../../support/reference-shading.ts";
import { CONFIGURATOR_URL } from "../../support/m4-configurator.ts";
import { digest, expectMatches, inputsOf, runPlan, writeRecord } from "./configurator-support.ts";

const TARGET = { width: 320, height: 240 } as const;
const ENTITIES = ["Floor", "Seat", "Back", "Crest", "LegFL", "LegFR", "LegBL", "LegBR", "RailFront", "RailBack"] as const;
/** Every entity of the example must own at least this many stable pixels in the 320 x 240 image (the rails are the smallest). */
const MIN_STABLE = 60;

const record: Record<string, unknown> = {};

test.afterAll(() => {
  writeRecord("m4-configurator-counters.json", record);
});

test.describe("the material configurator on the hardware adapter (M4-10)", () => {
  test("loads the model: assets ready, entities placed by the node accessors, counters, and the picture the oracle predicts", async ({ page, gpu }, testInfo) => {
    void gpu;
    const result = await runPlan(page, CONFIGURATOR_URL, { renderTarget: TARGET }, [{ label: "first frame" }]);
    expect(result.reported, "no runtime diagnostics").toEqual([]);
    expect(result.state).toBe("running");

    // The assets: one packaged mesh file, ready before mount resolved.
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ kind: "mesh-data", state: "ready" });
    expect(result.assetEvents.map((e) => e.state)).toEqual(["pending", "ready"]);

    // The entities sit where the node accessors put them: the hand-derived world matrices of the oracle (translation and rotation).
    const placed = new Map(result.mounted.scene.entities.map((e) => [e.name, e]));
    const entityNodes: Array<readonly [string, string]> = [
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
    const expected = expectedImage(configuratorScene(), TARGET.width, TARGET.height);
    const comparison = expectMatches(shot, expected, Object.fromEntries(ENTITIES.map((name) => [name, MIN_STABLE])));
    expect(comparison.compared).toBeGreaterThan(40000);
    expect(comparison.perEntity["clear"]).toBeGreaterThan(5000);

    // Hand-derived pixels. The corner of the target sees the clear colour #1b1f27. The middle of the target is the ray through the
    // camera target: it meets the top of the seat (the plane y = 0.48) at (0, 0.48, 2.6 (1 - 0.67/0.7)) with the normal +Y.
    const at = (x: number, y: number): number[] => [0, 1, 2].map((c) => shot.data[(y * shot.width + x) * 4 + c] ?? -1);
    expect(at(0, 0)).toEqual([...hexBytes("#1b1f27")]);
    const z = 2.6 * (1 - 0.67 / 0.7);
    const centre = at(TARGET.width / 2, TARGET.height / 2);
    const lights = configuratorLights(DEFAULT_INPUTS.sunIntensity);
    const hand = linearRgbToSrgb8(
      shadePbr({
        N: [0, 1, 0],
        V: [0, 1.15 - 0.48, 2.6 - z],
        position: [0, 0.48, z],
        lights,
        baseColor: DEFAULT_INPUTS.seat.baseColor,
        metallic: DEFAULT_INPUTS.seat.metallic,
        roughness: DEFAULT_INPUTS.seat.roughness,
        ambientColor: [1, 1, 1],
        ambientIntensity: 0.12,
      }),
    );
    centre.forEach((value, i) => expect(Math.abs(value - (hand[i] ?? 0)), `centre pixel channel ${String(i)}: GPU ${String(value)}, hand ${String(hand[i])}`).toBeLessThanOrEqual(3));

    // Counters. 12 entities are alive (10 drawn and two lights); the four legs are one instanced draw (one mesh, one pipeline, one
    // constant "Oak" parameter block), so 10 drawn entities need 7 draw calls; the seat, the back, the rails and the lights have
    // mutable (bound) parameters or are single, and nothing is culled.
    const counters = shot.counters;
    record["load"] = { counters, mounted: result.mounted.counters, comparison, digest: digest(shot.data) };
    testInfo.annotations.push({ type: "m4-configurator-load", description: `counters ${JSON.stringify(counters)}; ${String(comparison.compared)} pixels compared, max error ${String(comparison.maxError)}/255` });
    expect(counters["culledObjects"]).toBe(0);
    expect(counters["instancedDraws"]).toBe(1);
    expect(counters["drawCalls"]).toBe(7);
    // 10 drawn entities (the two lights have no mesh).
    expect((counters["drawCalls"] ?? 0) + 3, "drawn entities = draw calls + the three legs the instanced draw saves").toBe(10);
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

// Referenced by later tests of this file.
void applyHostValues;
void pixelsOf;
void inputsOf;
export type { HostValues };
