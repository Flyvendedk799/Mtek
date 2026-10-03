// Runs the `mtek-tests/*.test.toml` fixtures of a benchmark task against the task's three.js baseline,
// one Playwright test per fixture (decision 0018, section 8). A task's `baseline-tests/*.spec.ts` is
// one line: `defineFixtureSuite(import.meta.dirname)`.
//
// Which baseline runs:
//   MTEK_BASELINE_SOURCE=reference (default)  the task's `reference/baseline`
//   MTEK_BASELINE_SOURCE=starter              the task's `baseline` (an edit task's starter must fail)
//   MTEK_BASELINE_DIR=<dir>                   any project directory with `src/main.ts` (a candidate)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../../../tests/browser/support/fixtures.ts";
import { startStaticServer, type StaticServer } from "../../../../tests/browser/support/serve.ts";
import type { Pixels, TaskHooks } from "../src/hooks.ts";
import { buildBaseline } from "./build.ts";
import { hexToBytes, parseFixture, type Fixture, type Step } from "./fixture.ts";

interface BaselineChoice {
  readonly directory: string;
  readonly label: string;
}

export function chooseBaseline(taskDir: string): BaselineChoice {
  const override = process.env["MTEK_BASELINE_DIR"];
  if (override !== undefined && override !== "") return { directory: resolve(override), label: "custom" };
  const source = process.env["MTEK_BASELINE_SOURCE"] ?? "reference";
  if (source === "reference") return { directory: join(taskDir, "reference", "baseline"), label: "reference" };
  if (source === "starter") return { directory: join(taskDir, "baseline"), label: "starter" };
  throw new Error(`MTEK_BASELINE_SOURCE must be 'reference' or 'starter', got '${source}'`);
}

function loadFixtures(taskDir: string): Fixture[] {
  const directory = join(taskDir, "mtek-tests");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".test.toml"))
    .sort()
    .map((name) => parseFixture(readFileSync(join(directory, name), "utf8"), `mtek-tests/${name}`));
}

/** The baseline application opened in a page, with the calls a fixture needs. */
class OpenBaseline {
  private pixels: Pixels | null = null;
  readonly consoleMessages: string[] = [];

  constructor(private readonly page: Page) {
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        this.consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => this.consoleMessages.push(`pageerror: ${error.message}`));
  }

  async open(url: string): Promise<void> {
    // The static server has no favicon; answer it so it does not show up as a console error.
    await this.page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await this.page.goto(url);
    await this.page.waitForFunction(() => window.mtekTask !== undefined || window.mtekTaskError !== undefined);
    const error = await this.page.evaluate(() => window.mtekTaskError);
    if (error !== undefined) throw new Error(`the baseline application failed to start: ${error}`);
  }

  async step(frames: number, dt: number): Promise<void> {
    this.pixels = null;
    await this.page.evaluate(([f, d]) => (window.mtekTask as TaskHooks).step(f, d), [frames, dt] as const);
  }

  async press(code: string): Promise<void> {
    await this.page.evaluate((c) => (window.mtekTask as TaskHooks).pressKey(c), code);
  }

  async release(code: string): Promise<void> {
    await this.page.evaluate((c) => (window.mtekTask as TaskHooks).releaseKey(c), code);
  }

  async setInput(name: string, value: unknown): Promise<{ ok: boolean; message: string }> {
    const result = await this.page.evaluate(([n, v]) => (window.mtekTask as TaskHooks).setInput(n, v), [name, value] as const);
    return result.ok ? { ok: true, message: "" } : { ok: false, message: `${result.error.code}: ${result.error.message}` };
  }

  async pixelAt(x: number, y: number): Promise<[number, number, number]> {
    this.pixels ??= await this.page.evaluate(() => (window.mtekTask as TaskHooks).readPixels());
    const { width, height, data } = this.pixels;
    if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`pixel (${String(x)}, ${String(y)}) is outside the ${String(width)} x ${String(height)} target`);
    const offset = (y * width + x) * 4;
    return [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
  }
}

async function runStep(app: OpenBaseline, step: Step, where: string): Promise<void> {
  switch (step.kind) {
    case "step":
      await app.step(step.frames, step.dt);
      return;
    case "press":
      await app.press(step.code);
      return;
    case "release":
      await app.release(step.code);
      return;
    case "set_input": {
      const result = await app.setInput(step.name, step.value);
      expect(result.ok, `${where}: setInput('${step.name}') was rejected: ${result.message}`).toBe(true);
      return;
    }
    case "expect_state":
      throw new Error(`${where}: expect_state is a Mtek-only step; the baseline has no declared scene state`);
    case "expect_pixel": {
      const actual = await app.pixelAt(step.x, step.y);
      const expected = hexToBytes(step.color);
      const worst = Math.max(...actual.map((value, channel) => Math.abs(value - (expected[channel] ?? 0))));
      expect(
        worst,
        `${where}: pixel (${String(step.x)}, ${String(step.y)}) is rgb(${actual.join(", ")}), expected ${step.color} within ${String(step.tolerance)}`,
      ).toBeLessThanOrEqual(step.tolerance);
      return;
    }
  }
}

/**
 * Registers one test per fixture of the task whose `baseline-tests` directory is `baselineTestsDir`.
 * The baseline is built once per file into `$MTEK_RESULTS_DIR/benchmarks/`.
 */
export function defineFixtureSuite(baselineTestsDir: string): void {
  const taskDir = dirname(resolve(baselineTestsDir));
  const taskId = basename(taskDir);
  const choice = chooseBaseline(taskDir);
  const fixtures = loadFixtures(taskDir);
  let server: StaticServer | null = null;

  test.beforeAll(async () => {
    const resultsDir = process.env["MTEK_RESULTS_DIR"];
    if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set (playwright.config.ts sets it)");
    if (!existsSync(join(choice.directory, "src", "main.ts"))) {
      throw new Error(`${choice.directory}/src/main.ts does not exist (${choice.label} baseline of ${taskId})`);
    }
    const out = join(resultsDir, "benchmarks", `${taskId}-${choice.label}`);
    await buildBaseline(choice.directory, out);
    server = await startStaticServer(out);
  });

  test.afterAll(async () => {
    await server?.close();
  });

  for (const fixture of fixtures) {
    test(`${taskId} (${choice.label} baseline): ${fixture.name}`, async ({ page, gpu }) => {
      void gpu;
      if (server === null) throw new Error("the static server did not start");
      const app = new OpenBaseline(page);
      await app.open(`${server.url}/index.html`);
      for (const [index, step] of fixture.steps.entries()) {
        await runStep(app, step, `${fixture.name}, step ${String(index + 1)} (${step.kind})`);
      }
      expect(app.consoleMessages, "no console errors or warnings").toEqual([]);
    });
  }
}
