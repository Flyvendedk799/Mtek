// M5-01: static instances of prefabs, compiled by the CLI, render through WebGPU on the real adapter
// (spec/scenes.md section 5, decision 0062). The prefab's fields are evaluated over each instance's params
// (`position: origin`, `scale: vec3(edge, edge, edge)`, `Unlit { color: tint }`), a bound position follows the
// clock, and every pixel read back from the offscreen `rgba8unorm-srgb` target agrees with the independent CPU
// reference of support/m1-reference.ts, which is fed the values hand-derived from the params
// (support/m5-scenes.ts), not the compiler's output.
import { expect, test } from "../../support/fixtures.ts";
import { expectPixel, expectedColour, expectedRgb8, projectedCentre, type SceneSpec } from "../../support/m1-reference.ts";
import { CLIMBER_AT, CLIMBER_FRAMES, CLIMBER_STEP, SHOWROOM } from "../../support/m5-scenes.ts";
import { mountAndCapture, rgbAt, rgbClose, type Capture } from "../m1/support.ts";

const GRID_STRIDE = 4;

/** Pixels whose colour is the given RGB (±2/255), with their centroid. */
function footprint(capture: Capture, rgb: readonly number[]): { count: number; x: number; y: number } {
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < capture.height; y += 1) {
    for (let x = 0; x < capture.width; x += 1) {
      if (!rgbClose(rgbAt(capture, x, y), rgb)) continue;
      count += 1;
      sx += x + 0.5;
      sy += y + 0.5;
    }
  }
  return { count, x: sx / count, y: sy / count };
}

test.describe("static prefab instances render through WebGPU (M5-01)", () => {
  test.beforeEach(({ gpu }) => {
    void gpu;
  });

  test("each instance shows the entity its params make of it, and the bound one follows the clock", async ({ page }, testInfo) => {
    const scene = SHOWROOM;
    const capture = await mountAndCapture(page, scene.fixture, scene.renderTarget, {
      bucket: "m5",
      frames: CLIMBER_FRAMES,
      dt: CLIMBER_STEP,
    });
    expect(capture).toMatchObject({ ...scene.renderTarget, format: "rgba8unorm-srgb" });
    expect(capture.reported, "no runtime diagnostics").toEqual([]);
    expect(capture.overlayPresent).toBe(false);
    expect(capture.counters["drawCalls"], "one draw per instance").toBe(scene.entities.length);

    // The world holds the declared transforms: the instances are named entities with the prefab's fields.
    expect(capture.entities.map((entity) => entity.name)).toEqual(scene.entities.map((entity) => entity.name));
    capture.entities.forEach((entity, index) => {
      const declared = scene.entities[index]?.position ?? [NaN, NaN, NaN];
      expect(entity.position, scene.entities[index]?.name).toEqual({ x: declared[0], y: declared[1], z: declared[2] });
    });

    // The projected centre of every instance shows its own tint (not the prefab's default, not a neighbour's).
    for (const [index, entity] of scene.entities.entries()) {
      const centre = projectedCentre(scene, index);
      const px = Math.floor(centre.x);
      const py = Math.floor(centre.y);
      const expectation = expectPixel(scene, px, py);
      expect(expectation.kind, `${entity.name}: the centre pixel is robust`).toBe("entity");
      const expected = expectedColour(scene, expectation);
      const actual = rgbAt(capture, px, py);
      testInfo.annotations.push({
        type: "m5-pixel",
        description: `${entity.name} centre projects to (${centre.x.toFixed(2)}, ${centre.y.toFixed(2)}) -> pixel (${String(px)}, ${String(py)}): expected rgb(${expected.join(",")}) actual rgb(${actual.join(",")})`,
      });
      expect(rgbClose(actual, expected), `${entity.name} centre (${String(px)}, ${String(py)}): ${actual.join(",")} vs ${expected.join(",")}`).toBe(true);
    }

    // A grid over the whole target agrees with the reference, clear colour included.
    const mismatches: string[] = [];
    const counts = new Map<string, number>();
    for (let y = GRID_STRIDE / 2; y < scene.renderTarget.height; y += GRID_STRIDE) {
      for (let x = GRID_STRIDE / 2; x < scene.renderTarget.width; x += GRID_STRIDE) {
        const expectation = expectPixel(scene, x, y);
        if (expectation.kind === "ambiguous") continue;
        const key = expectation.kind === "clear" ? "clear" : (scene.entities[expectation.index]?.name ?? "?");
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const expected = expectedColour(scene, expectation);
        const actual = rgbAt(capture, x, y);
        if (!rgbClose(actual, expected)) mismatches.push(`(${String(x)}, ${String(y)}) ${key}: ${actual.join(",")} vs ${expected.join(",")}`);
      }
    }
    testInfo.annotations.push({
      type: "m5-pixel",
      description: `grid samples ${[...counts].map(([key, count]) => `${key} ${String(count)}`).join(", ")}; clear rgb(${expectedRgb8(scene.clearColor).join(",")})`,
    });
    expect(mismatches, "grid samples that differ from the CPU reference").toEqual([]);
    for (const entity of scene.entities) {
      expect(counts.get(entity.name) ?? 0, `${entity.name} has samples in the picture`).toBeGreaterThanOrEqual(10);
    }
  });

  test("the instance bound to the clock moves with it, by the amount the CPU projection predicts", async ({ page }, testInfo) => {
    const frames = (count: number): Promise<Capture> =>
      mountAndCapture(page, SHOWROOM.fixture, SHOWROOM.renderTarget, { bucket: "m5", frames: count, dt: CLIMBER_STEP });
    const early = await frames(CLIMBER_FRAMES / 2);
    const late = await frames(CLIMBER_FRAMES);
    const colour = expectedRgb8("#ffcc00");
    const a = footprint(early, colour);
    const b = footprint(late, colour);
    // frame.time is 0.5 s, then 1.0 s: the Climber's y is base.y + frame.time.
    const at = (time: number): SceneSpec => ({
      ...SHOWROOM,
      entities: SHOWROOM.entities.map((entity) => (entity.name === "Climber" ? { ...entity, position: [CLIMBER_AT[0], 0.5 + time, CLIMBER_AT[2]] as const } : entity)),
    });
    const climber = SHOWROOM.entities.findIndex((entity) => entity.name === "Climber");
    const from = projectedCentre(at(CLIMBER_FRAMES / 2 * CLIMBER_STEP), climber);
    const to = projectedCentre(at(CLIMBER_FRAMES * CLIMBER_STEP), climber);
    testInfo.annotations.push({
      type: "m5-pixel",
      description: `Climber footprint ${String(a.count)} px at centroid (${a.x.toFixed(2)}, ${a.y.toFixed(2)}) after 5 frames, ${String(b.count)} px at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}) after 10; CPU-predicted centre (${from.x.toFixed(2)}, ${from.y.toFixed(2)}) -> (${to.x.toFixed(2)}, ${to.y.toFixed(2)})`,
    });
    expect(a.count).toBeGreaterThan(40);
    expect(b.count).toBeGreaterThan(40);
    // It rises on the screen (y grows downwards in pixels) by what the projection of the two positions says.
    expect(to.y).toBeLessThan(from.y);
    expect(b.y).toBeLessThan(a.y);
    // Parts of the sphere may be hidden behind a cube, which moves the centroid of what is visible: two pixels.
    expect(Math.abs(b.y - a.y - (to.y - from.y))).toBeLessThan(2);
    expect(Math.abs(b.x - a.x)).toBeLessThan(1);
  });
});
