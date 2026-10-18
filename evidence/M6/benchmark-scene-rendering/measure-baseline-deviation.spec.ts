// Measurement, not a test of the task set: copy this file to benchmarks/tasks/scene-rendering-06/baseline-tests/ (the
// `benchmarks` Playwright project only matches there), run `MTEK_REQUIRE_GPU=1 npm run test:benchmarks -- measure-baseline-deviation`
// and delete it again. It prints the worst per-channel deviation of the baseline reference from the fixture
// for the lit tasks, printed per pixel.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "../../../../tests/browser/support/fixtures.ts";
import { startStaticServer } from "../../../../tests/browser/support/serve.ts";
import type { TaskHooks } from "../../../baselines/support/src/hooks.ts";
import { buildBaseline } from "../../../baselines/support/test/build.ts";
import { hexToBytes, parseFixture } from "../../../baselines/support/test/fixture.ts";

for (const id of ["scene-rendering-06", "scene-rendering-07", "scene-rendering-10"]) {
  test(`measure ${id}`, async ({ page, gpu }) => {
    void gpu;
    const taskDir = resolve(import.meta.dirname, "..", "..", id);
    const out = join(process.env["MTEK_RESULTS_DIR"] ?? ".", "measure", id);
    await buildBaseline(join(taskDir, "reference", "baseline"), out);
    const server = await startStaticServer(out);
    await page.goto(`${server.url}/index.html`);
    await page.waitForFunction(() => window.mtekTask !== undefined || window.mtekTaskError !== undefined);
    const fixture = parseFixture(readFileSync(join(taskDir, "mtek-tests", "scene.test.toml"), "utf8"), "scene.test.toml");
    await page.evaluate(() => (window.mtekTask as TaskHooks).step(1, 0.016666668));
    const pixels = await page.evaluate(() => (window.mtekTask as TaskHooks).readPixels());
    let worst = 0;
    const lines: string[] = [];
    for (const step of fixture.steps) {
      if (step.kind !== "expect_pixel") continue;
      const want = hexToBytes(step.color);
      const o = (step.y * pixels.width + step.x) * 4;
      const got = [pixels.data[o] ?? 0, pixels.data[o + 1] ?? 0, pixels.data[o + 2] ?? 0];
      const d = Math.max(...got.map((v, i) => Math.abs(v - (want[i] ?? 0))));
      worst = Math.max(worst, d);
      lines.push(`${String(step.x)},${String(step.y)} want ${want.join(",")} got ${got.join(",")} d=${String(d)}`);
    }
    console.log(`MEASURE ${id} worst=${String(worst)}\n${lines.join("\n")}`);
    await server.close();
    expect(worst).toBeGreaterThanOrEqual(0);
  });
}
