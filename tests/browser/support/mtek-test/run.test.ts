import { describe, expect, it } from "vitest";
import { runPlan, type RunnerDeps } from "./run.ts";
import { SCHEMA_VERSION, type Plan } from "./plan.ts";

const plan: Plan = {
  schemaVersion: SCHEMA_VERSION,
  root: "/dist",
  renderTarget: { width: 128, height: 128 },
  fixtures: [
    {
      file: "tests/a.test.toml",
      name: "a",
      seed: 0,
      steps: [{ kind: "step", frames: 1, dt: 0.016, line: 3 }],
    },
    {
      file: "tests/b.test.toml",
      name: "b",
      seed: 5,
      steps: [{ kind: "step", frames: 1, dt: 0.016, line: 3 }],
    },
  ],
};

const ADAPTER = {
  available: true,
  adapter: { vendor: "nvidia", architecture: "ada", device: "RTX", description: "", isFallbackAdapter: false },
};

interface Fakes {
  deps: RunnerDeps;
  closed: { browser: number; server: number };
  served: string[];
}

/**
 * A fake Playwright. `answers` are what successive `page.evaluate` calls resolve to (the adapter probe
 * first, then one mount per fixture); `waitFails` makes `waitForFunction` reject.
 */
function fakes(options: {
  load?: () => Promise<never>;
  launch?: () => Promise<never>;
  answers?: unknown[];
  waitFails?: boolean;
  env?: Record<string, string>;
}): Fakes {
  const closed = { browser: 0, server: 0 };
  const served: string[] = [];
  const answers = [...(options.answers ?? [])];
  const page = {
    on: () => undefined,
    goto: () => Promise.resolve(null),
    waitForFunction: () =>
      options.waitFails === true ? Promise.reject(new Error("timeout")) : Promise.resolve(null),
    evaluate: () => Promise.resolve(answers.shift()),
  };
  const context = { newPage: () => Promise.resolve(page), close: () => Promise.resolve() };
  const browser = {
    version: () => "150.0.0.0",
    newContext: () => Promise.resolve(context),
    close: () => {
      closed.browser += 1;
      return Promise.resolve();
    },
  };
  let clock = 0;
  const deps: RunnerDeps = {
    loadPlaywright:
      options.load ??
      (() =>
        Promise.resolve({
          chromium: {
            name: () => "chromium",
            launch: options.launch ?? (() => Promise.resolve(browser)),
          },
        } as never)),
    startServer: (root) => {
      served.push(root);
      return Promise.resolve({
        url: "http://127.0.0.1:1",
        close: () => {
          closed.server += 1;
          return Promise.resolve();
        },
      });
    },
    env: options.env ?? {},
    now: () => (clock += 10),
  };
  return { deps, closed, served };
}

describe("runPlan without a working browser setup", () => {
  it("reports every fixture NOT-RUN when Playwright is not installed", async () => {
    const { deps, served } = fakes({ load: () => Promise.reject(new Error("Cannot find package '@playwright/test'")) });
    const report = await runPlan(plan, deps);
    expect(report.environment).toBeNull();
    expect(report.fixtures.map((f) => [f.file, f.status])).toEqual([
      ["tests/a.test.toml", "not-run"],
      ["tests/b.test.toml", "not-run"],
    ]);
    expect(report.fixtures[0]?.reason).toContain("Playwright is not installed");
    expect(report.fixtures[0]?.reason).toContain("@playwright/test");
    expect(report.fixtures[0]?.failure).toBeNull();
    expect(served).toEqual([]);
  });

  it("reports every fixture NOT-RUN when Chromium cannot be launched", async () => {
    const { deps, served } = fakes({
      launch: () => Promise.reject(new Error("Executable doesn't exist at /x\nmore lines")),
    });
    const report = await runPlan(plan, deps);
    expect(report.fixtures.every((f) => f.status === "not-run")).toBe(true);
    expect(report.fixtures[0]?.reason).toContain("Chromium could not be launched (Executable doesn't exist at /x)");
    expect(report.fixtures[0]?.reason).toContain("playwright install chromium");
    expect(served).toEqual([]);
  });

  it("reports every fixture NOT-RUN without a WebGPU adapter, and records the environment", async () => {
    const { deps, closed } = fakes({
      answers: [{ available: false, reason: "navigator.gpu.requestAdapter() resolved to null" }],
    });
    const report = await runPlan(plan, deps);
    expect(report.fixtures.map((f) => f.status)).toEqual(["not-run", "not-run"]);
    expect(report.fixtures[1]?.reason).toBe(
      "no WebGPU adapter: navigator.gpu.requestAdapter() resolved to null",
    );
    expect(report.environment?.gpu).toEqual({
      available: false,
      reason: "navigator.gpu.requestAdapter() resolved to null",
      adapter: null,
    });
    expect(report.environment?.browser).toMatchObject({ name: "chromium", version: "150.0.0.0", headless: true });
    expect(report.environment?.browser.launchArgs).toContain("--enable-unsafe-webgpu");
    // The browser and the server are shut down.
    expect(closed).toEqual({ browser: 1, server: 1 });
  });

  it("launches with the arguments of MTEK_BROWSER_ARGS", async () => {
    const { deps } = fakes({
      env: { MTEK_BROWSER_ARGS: "--disable-gpu" },
      answers: [{ available: false, reason: "none" }],
    });
    const report = await runPlan(plan, deps);
    expect(report.environment?.browser.launchArgs.at(-1)).toBe("--disable-gpu");
  });
});

describe("runPlan with an adapter", () => {
  it("fails a fixture whose program does not mount, with the kind and the diagnostics", async () => {
    const mountFailure = {
      ok: false,
      kind: "shader-failed",
      message: "a shader did not compile",
      details: ["MTEK-E8051: shader error"],
    };
    const { deps } = fakes({ answers: [ADAPTER, mountFailure, mountFailure] });
    const report = await runPlan(plan, deps);
    expect(report.environment?.gpu.adapter?.device).toBe("RTX");
    expect(report.fixtures.map((f) => f.status)).toEqual(["fail", "fail"]);
    expect(report.fixtures[0]?.failure).toEqual({
      kind: "mount",
      step: null,
      line: null,
      message: "the program did not mount (shader-failed): a shader did not compile",
      details: ["MTEK-E8051: shader error"],
    });
    expect(report.fixtures[0]?.reason).toBeNull();
  });

  it("fails a page that is not a test build, instead of waiting for it", async () => {
    const { deps } = fakes({ answers: [ADAPTER], waitFails: true });
    const report = await runPlan(plan, deps);
    expect(report.fixtures[0]?.status).toBe("fail");
    expect(report.fixtures[0]?.failure?.message).toContain("window.__mtekMount");
    expect(report.fixtures[0]?.failure?.message).toContain("--mode test");
  });
});
