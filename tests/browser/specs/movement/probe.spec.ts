import { writeFileSync } from "node:fs";
import { expect, test } from "../../support/fixtures.ts";
import { drive, hold, plan, tap, wait, type Step } from "../../support/movement-drive.ts";
import { MOVEMENT_URL } from "../../support/movement-example.ts";

const OUT = process.env["PROBE_OUT"] ?? "probe.json";
const scenarios: Record<string, Step[]> = {
  jump: [wait(60), hold(["Space"], 1), wait(100)],
  stairs: [wait(30), tap("Digit1"), wait(30), hold(["ArrowRight"], 150), wait(30)],
  ledge: [wait(30), tap("Digit2"), wait(30), hold(["ArrowRight"], 150), wait(30)],
  gentle: [wait(30), tap("Digit3"), wait(30), hold(["ArrowRight"], 240), wait(30)],
  steep: [wait(30), tap("Digit4"), wait(30), hold(["ArrowRight"], 240), wait(30)],
  slider: [wait(30), tap("Digit5"), wait(660)],
  lift: [wait(30), tap("Digit6"), wait(780)],
  turn: [wait(30), tap("Digit7"), wait(760)],
  corner: [wait(30), tap("Digit8"), wait(30), hold(["ArrowRight", "ArrowDown"], 240), wait(30)],
};

test("probe", async ({ page, gpu }) => {
  void gpu;
  test.setTimeout(240_000);
  const all: Record<string, unknown> = {};
  for (const [name, steps] of Object.entries(scenarios)) {
    await page.goto(MOVEMENT_URL);
    const result = await page.evaluate(drive, { frames: plan(steps, "tick"), target: { width: 160, height: 80 }, everyFrame: true, idNames: ["Player"] });
    all[name] = { diagnostics: result.diagnostics, state: result.stateAfter, samples: result.samples.filter((_, i) => i % 5 === 0) };
  }
  writeFileSync(OUT, JSON.stringify(all));
  expect(true).toBe(true);
});
