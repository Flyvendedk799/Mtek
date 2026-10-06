// M2 exit gate, criterion 1 (task M2-12): the `Pulse` material runs with a changing parameter. The box of
// `fixtures/m2/pulse` fills the middle of the view and its material multiplies the tint by the pure function
// `pulse(phase) = 0.65 + 0.35 * sin(phase)`. `phase` is changed through `app.debug.setParam` (`bind` is M3),
// and every frame is read back from the offscreen `rgba8unorm-srgb` target (spec/testing.md section 6.3).
// The expectation is computed here, on the CPU, from the declared tint and the formula, within 3/255.
// Changing the parameter must create no shader module, pipeline or bind group.
import { expect, test } from "../../support/fixtures.ts";
import { linearToSrgb8, srgbToLinear } from "../../support/m1-reference.ts";
import { PULSE, m2Source } from "../../support/m2-fixtures.ts";
import { runSession, type SessionStep } from "./support.ts";

const TARGET = { width: 64, height: 64 } as const;
/** The centre of the box's front face and three more points well inside the silhouette, then two corners. */
const INSIDE: ReadonlyArray<readonly [number, number]> = [
  [32, 32],
  [26, 26],
  [38, 38],
  [32, 24],
];
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [2, 2],
  [61, 61],
];
const TINT = "#6b5cff";
const TOLERANCE = 3;

/** The 8-bit sRGB colour the target holds for `tint * pulse(phase)` (spec/language.md section 5.4 for the transfer). */
function expectedColour(phase: number): [number, number, number] {
  const scale = 0.65 + 0.35 * Math.sin(phase);
  const channel = (offset: number): number => linearToSrgb8(srgbToLinear(Number.parseInt(TINT.slice(offset, offset + 2), 16) / 255) * scale);
  return [channel(1), channel(3), channel(5)];
}

const PHASES = [0.5, Math.PI / 2, 2.0, Math.PI, 4.0, 5.5, 0.0];
const STEPS: SessionStep[] = PHASES.map((phase) => ({
  label: `phase ${phase.toFixed(4)}`,
  writes: [{ entity: "Cube", param: "phase", value: phase }],
}));

test("Pulse follows tint * (0.65 + 0.35 sin(phase)) while phase changes, and creates no pipeline or shader module", async ({ page, gpu }, testInfo) => {
  void gpu;
  // The fixture is the blueprint's Pulse: the declared formula and tint are the ones asserted below.
  const source = m2Source(PULSE);
  expect(source).toContain("return 0.65 + 0.35 * sin(t);");
  expect(source).toContain(`param tint: color = ${TINT};`);

  const session = await runSession(page, PULSE, TARGET, [...INSIDE, ...CORNERS], STEPS);
  expect(session.state).toBe("running");
  expect(session.overlayPresent).toBe(false);
  const first = session.frames[0];
  if (first === undefined) throw new Error("no frames");

  // The first frame (phase 0 from the declaration), then one frame per write.
  const expectations: Array<{ label: string; phase: number }> = [{ label: "initial", phase: 0 }, ...STEPS.map((s, i) => ({ label: s.label, phase: PHASES[i] ?? 0 }))];
  expect(session.frames.map((frame) => frame.label)).toEqual(expectations.map((e) => e.label));
  const lines: string[] = [];
  for (const [index, frame] of session.frames.entries()) {
    const { phase } = expectations[index] ?? { phase: 0 };
    const expected = expectedColour(phase);
    for (const [pointIndex, point] of INSIDE.entries()) {
      const actual = frame.pixels[pointIndex] ?? [-1, -1, -1];
      lines.push(`${frame.label} at (${point.join(", ")}): expected rgb(${expected.join(",")}) actual rgb(${actual.join(",")})`);
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          Math.abs((actual[channel] ?? -1000) - (expected[channel] ?? 0)),
          `${frame.label} at (${point.join(", ")}) channel ${String(channel)}: ${actual.join(",")} vs ${expected.join(",")}`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }
    // Outside the box the clear colour (black by default) is untouched.
    for (let k = 0; k < CORNERS.length; k += 1) expect(frame.pixels[INSIDE.length + k], `${frame.label} corner ${String(k)}`).toEqual([0, 0, 0]);
    expect(frame.reported, `${frame.label}: no runtime diagnostics`).toEqual([]);
    expect(frame.counters["drawCalls"]).toBe(1);
  }
  testInfo.annotations.push({ type: "m2-pixel", description: lines.join("; ") });

  // The parameter really changed the picture: the extreme phases are far apart.
  const brightest = expectedColour(Math.PI / 2);
  const dimmest = expectedColour(4.0);
  expect(Math.max(...brightest) - Math.max(...dimmest)).toBeGreaterThan(40);

  // One shader module, one pipeline, one material bind group, for every frame; each write is one upload.
  for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated", "livePipelines", "liveShaderModules", "liveBindGroups"]) {
    const values = new Set(session.frames.map((frame) => frame.counters[name]));
    expect([...values], `${name} is constant across ${String(session.frames.length)} frames`).toHaveLength(1);
  }
  // The only buffer a frame allocates is the staging buffer of its own `readPixels`; a parameter write grows no arena.
  const allocated = session.frames.map((frame) => frame.counters["buffersAllocated"] ?? NaN);
  for (let i = 1; i < allocated.length; i += 1) expect(allocated[i], `frame ${String(i)}: one readback buffer`).toBe((allocated[i - 1] ?? NaN) + 1);
  expect(first.counters["pipelinesCreated"]).toBe(1);
  expect(first.counters["shaderModulesCreated"]).toBe(1);
  const uploads = session.frames.map((frame) => frame.counters["uploads"] ?? NaN);
  // Writes of a changed value upload once; the last write restores phase 0, which differs from 5.5.
  for (let i = 1; i < uploads.length; i += 1) expect(uploads[i], `frame ${String(i)} uploaded the new phase`).toBe((uploads[i - 1] ?? NaN) + 1);
});
