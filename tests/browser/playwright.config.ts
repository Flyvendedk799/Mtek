import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import {
  browserChannel,
  extraBrowserArgs,
  hardwareLaunchArgs,
  isHeadless,
} from "./support/launch-args.ts";

const root = import.meta.dirname;

// One results directory per run, shared by the main process, the reporters and every worker:
// workers inherit the environment of the process that evaluated this file first.
process.env["MTEK_RESULTS_DIR"] ??= join(
  root,
  "results",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const resultsDir = resolve(process.env["MTEK_RESULTS_DIR"]);

// The hardware configuration is shared with `mtek test` (support/launch-args.ts): headless Chromium in its
// new mode, the WebGPU switches, and `MTEK_BROWSER_ARGS` for experiments and for simulating a machine
// without a GPU (`MTEK_BROWSER_ARGS=--disable-gpu`).
const headless = isHeadless();
const channel = browserChannel();
const linux = process.platform === "linux";
const extraArgs = extraBrowserArgs();
const hardwareArgs = hardwareLaunchArgs();

const softwareArgs = [
  "--enable-unsafe-webgpu",
  "--use-webgpu-adapter=swiftshader",
  "--enable-webgpu-developer-features",
  ...(linux ? ["--enable-features=Vulkan", "--use-vulkan=swiftshader"] : []),
  ...extraArgs,
];

export default defineConfig({
  testDir: "specs",
  testMatch: "**/*.spec.ts",
  outputDir: join(resultsDir, "artifacts"),
  globalSetup: "./support/global-setup.ts",
  // GPU projects never run in parallel: adapters and devices are shared machine state.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: process.env["CI"] !== undefined,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["json", { outputFile: join(resultsDir, "test-results.json") }],
    ["./support/not-run-reporter.ts"],
  ],
  projects: [
    {
      name: "hardware",
      use: { channel, headless, launchOptions: { args: hardwareArgs } },
    },
    {
      name: "software",
      use: { channel, headless, launchOptions: { args: softwareArgs } },
    },
    {
      // The benchmark tasks' three.js baselines (task M0-10, decision 0021): the task fixtures run
      // against each task's reference solution (or, with MTEK_BASELINE_SOURCE=starter, its starter) on
      // the hardware configuration. `npm run test:benchmarks` runs only this project.
      name: "benchmarks",
      testDir: "../../benchmarks",
      testMatch: ["tasks/*/baseline-tests/*.spec.ts", "holdout/*/baseline-tests/*.spec.ts"],
      use: { channel, headless, launchOptions: { args: hardwareArgs } },
    },
  ],
});
