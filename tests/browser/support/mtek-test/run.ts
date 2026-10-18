// Runs a plan: serves the test build, opens each fixture in a fresh page of Chromium and reports
// per fixture (decision 0074). Whatever is missing on the machine (Playwright, the browser, a WebGPU
// adapter) makes every fixture NOT-RUN with the reason; nothing that did not run is ever reported as
// passed. Playwright is loaded dynamically (through `RunnerDeps`) so that its absence is a reason, not
// a crash, and so that this logic is tested with fakes.
import type { Browser, BrowserType } from "@playwright/test";
import { browserChannel, hardwareLaunchArgs, isHeadless } from "../launch-args.ts";
import { mount, PageDriver, probeAdapter, waitForMount } from "./driver.ts";
import { executeSteps } from "./execute.ts";
import {
  SCHEMA_VERSION,
  type Environment,
  type Failure,
  type FixtureResult,
  type Plan,
  type PlanFixture,
  type RunnerReport,
} from "./plan.ts";

/** The longest a fixture may take, mount included. */
export const DEFAULT_FIXTURE_TIMEOUT_MS = 120_000;
/** The longest the page of a test build may take to define `window.__mtekMount`. */
const PAGE_READY_TIMEOUT_MS = 15_000;

export interface RunnerDeps {
  /** Loads Playwright; rejects when it is not installed. */
  loadPlaywright(): Promise<{ chromium: Pick<BrowserType, "launch" | "name"> }>;
  /** Serves `root` over HTTP on the loopback interface. */
  startServer(root: string): Promise<{ url: string; close(): Promise<void> }>;
  env: Readonly<Record<string, string | undefined>>;
  now(): number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every fixture of the plan did not run, for `reason`. */
function allNotRun(plan: Plan, reason: string, environment: Environment | null): RunnerReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    environment,
    fixtures: plan.fixtures.map(
      (fixture): FixtureResult => ({
        file: fixture.file,
        status: "not-run",
        reason,
        failure: null,
        stepsRun: 0,
        durationMs: 0,
      }),
    ),
  };
}

function timeoutFrom(env: RunnerDeps["env"]): number {
  const parsed = Number(env["MTEK_TEST_TIMEOUT_MS"]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_FIXTURE_TIMEOUT_MS;
}

/** Runs one fixture in a fresh page. */
async function runFixture(
  browser: Browser,
  baseUrl: string,
  plan: Plan,
  fixture: PlanFixture,
  deps: RunnerDeps,
): Promise<FixtureResult> {
  const started = deps.now();
  const context = await browser.newContext();
  const finish = (status: "pass" | "fail", stepsRun: number, failure: Failure | null): FixtureResult => ({
    file: fixture.file,
    status,
    reason: null,
    failure,
    stepsRun,
    durationMs: Math.max(0, Math.round(deps.now() - started)),
  });
  const failed = (failure: Failure, stepsRun = 0): FixtureResult => finish("fail", stepsRun, failure);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(messageOf(error)));
    const work = (async (): Promise<FixtureResult> => {
      await page.goto(`${baseUrl}/index.html`);
      const notReady = await waitForMount(page, PAGE_READY_TIMEOUT_MS);
      if (notReady !== null) {
        return failed({ kind: "mount", step: null, line: null, message: notReady });
      }
      const mounted = await mount(page, {
        seed: fixture.seed,
        width: plan.renderTarget.width,
        height: plan.renderTarget.height,
      });
      if (!mounted.ok) {
        return failed({
          kind: "mount",
          step: null,
          line: null,
          message: `the program did not mount (${mounted.kind}): ${mounted.message}`,
          ...(mounted.details.length === 0 ? {} : { details: mounted.details }),
        });
      }
      const driver = new PageDriver(page, pageErrors, plan.renderTarget);
      const outcome = await executeSteps(driver, fixture.steps);
      return finish(outcome.status, outcome.stepsRun, outcome.failure);
    })();
    const limit = timeoutFrom(deps.env);
    const expired = new Promise<FixtureResult>((resolve) => {
      timer = setTimeout(() => {
        resolve(
          failed({
            kind: "timeout",
            step: null,
            line: null,
            message: `the fixture did not finish within ${String(limit)} ms`,
          }),
        );
      }, limit);
    });
    return await Promise.race([work, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Closing the context also ends a page that is still stepping after a timeout.
    await context.close().catch(() => undefined);
  }
}

/** Runs the plan and returns the report; throws only on a defect of the runner itself. */
export async function runPlan(plan: Plan, deps: RunnerDeps): Promise<RunnerReport> {
  let playwright: Awaited<ReturnType<RunnerDeps["loadPlaywright"]>>;
  try {
    playwright = await deps.loadPlaywright();
  } catch (error) {
    return allNotRun(
      plan,
      `Playwright is not installed (${messageOf(error)}); run "npm ci" in the repository`,
      null,
    );
  }
  const channel = browserChannel(deps.env);
  const headless = isHeadless(deps.env);
  const launchArgs = hardwareLaunchArgs(deps.env);
  let browser: Browser;
  try {
    browser = await playwright.chromium.launch({ channel, headless, args: launchArgs });
  } catch (error) {
    return allNotRun(
      plan,
      `Chromium could not be launched (${messageOf(error).split("\n")[0] ?? ""}); install it with "npx playwright install chromium"`,
      null,
    );
  }
  const server = await deps.startServer(plan.root);
  try {
    const environmentBase = {
      name: playwright.chromium.name(),
      channel,
      version: browser.version(),
      headless,
      launchArgs,
    };
    // The probe page: any page of the test build is a secure context with `navigator.gpu`.
    const probeContext = await browser.newContext();
    let probe: Awaited<ReturnType<typeof probeAdapter>>;
    try {
      const page = await probeContext.newPage();
      await page.goto(`${server.url}/index.html`);
      probe = await probeAdapter(page);
    } finally {
      await probeContext.close().catch(() => undefined);
    }
    const environment: Environment = {
      browser: environmentBase,
      gpu: probe.available
        ? { available: true, reason: null, adapter: probe.adapter }
        : { available: false, reason: probe.reason, adapter: null },
    };
    if (!probe.available) {
      return allNotRun(plan, `no WebGPU adapter: ${probe.reason}`, environment);
    }
    const fixtures: FixtureResult[] = [];
    for (const fixture of plan.fixtures) {
      fixtures.push(await runFixture(browser, server.url, plan, fixture, deps));
    }
    return { schemaVersion: SCHEMA_VERSION, environment, fixtures };
  } finally {
    await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
