// Playwright fixtures. `gpu` probes WebGPU once per worker, writes and validates
// `environment-<project>.json`, and marks tests NOT-RUN (skipped with a NOT-RUN reason) when no
// adapter exists. GPU tests must use `gpu`; they never pass silently without a GPU.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";
import type { EnvironmentRecord, PageEnvironment } from "./environment-types.ts";
import {
  buildEnvironmentRecord,
  environmentFileName,
  validateEnvironment,
} from "./environment.ts";
import { NOT_RUN_PREFIX } from "./run-summary.ts";

export interface GpuProbe {
  record: EnvironmentRecord;
  /** True when WebGPU has an adapter in this environment. */
  available: boolean;
  /** Absolute path of the environment record written for this project. */
  recordPath: string;
}

interface WorkerFixtures {
  gpuProbe: GpuProbe;
}

interface TestFixtures {
  /** The probe result; the test is skipped as NOT-RUN when there is no adapter. */
  gpu: GpuProbe;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set; run the tests through playwright.config.ts`);
  }
  return value;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
  baseURL: async ({}, use) => {
    await use(requiredEnv("MTEK_SERVER_URL"));
  },

  gpuProbe: [
    async ({ browser }, use, workerInfo) => {
      const project = workerInfo.project;
      const context = await browser.newContext({ baseURL: requiredEnv("MTEK_SERVER_URL") });
      let pageEnvironment: PageEnvironment;
      try {
        const page = await context.newPage();
        await page.goto("/env.html");
        pageEnvironment = await page.evaluate(() =>
          (
            window as unknown as { mtekCollectEnvironment: () => Promise<PageEnvironment> }
          ).mtekCollectEnvironment(),
        );
      } finally {
        await context.close();
      }
      const launchArgs = project.use.launchOptions?.args ?? [];
      const record = buildEnvironmentRecord(project.name, pageEnvironment, {
        name: browser.browserType().name(),
        channel: project.use.channel ?? "chromium",
        version: browser.version(),
        headless: project.use.headless ?? true,
        launchArgs: [...launchArgs],
      });
      const problems = validateEnvironment(record);
      if (problems.length > 0) {
        throw new Error(`environment record violates environment.schema.json: ${problems.join("; ")}`);
      }
      const resultsDir = requiredEnv("MTEK_RESULTS_DIR");
      mkdirSync(resultsDir, { recursive: true });
      const recordPath = join(resultsDir, environmentFileName(project.name));
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
      await use({ record, available: record.gpu.adapter !== null, recordPath });
    },
    { scope: "worker", timeout: 60_000 },
  ],

  gpu: async ({ gpuProbe }, use, testInfo) => {
    testInfo.skip(
      !gpuProbe.available,
      `${NOT_RUN_PREFIX}: no WebGPU adapter (see ${environmentFileName(testInfo.project.name)}): ${gpuProbe.record.gpu.reason ?? "unknown reason"}`,
    );
    await use(gpuProbe);
  },
});

export { expect } from "@playwright/test";
