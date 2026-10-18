// The browser runner of `mtek test` (decision 0074):
//
//   node tests/browser/support/mtek-test/main.ts <plan.json> <report.json>
//
// Reads the plan the CLI wrote, runs it (run.ts) and writes the report. The exit code is 0 whenever a
// report was written, whatever the fixtures did; a runner that dies leaves no report and the CLI
// exits 3. Playwright is imported only inside `loadPlaywright`, so a missing installation is a NOT-RUN.
import { readFileSync, writeFileSync } from "node:fs";
import { startStaticServer } from "../serve.ts";
import { SCHEMA_VERSION, type Plan } from "./plan.ts";
import { runPlan } from "./run.ts";

function readPlan(path: string): Plan {
  const plan = JSON.parse(readFileSync(path, "utf8")) as Partial<Plan>;
  if (plan.schemaVersion !== SCHEMA_VERSION || !Array.isArray(plan.fixtures) || typeof plan.root !== "string") {
    throw new Error(`'${path}' is not a plan of schema version ${String(SCHEMA_VERSION)}`);
  }
  return plan as Plan;
}

async function main(): Promise<void> {
  const [planPath, reportPath] = process.argv.slice(2);
  if (planPath === undefined || reportPath === undefined) {
    throw new Error("usage: main.ts <plan.json> <report.json>");
  }
  const report = await runPlan(readPlan(planPath), {
    loadPlaywright: async () => {
      const { chromium } = await import("@playwright/test");
      return { chromium };
    },
    startServer: startStaticServer,
    env: process.env,
    now: () => performance.now(),
  });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

main().then(
  () => {
    // Playwright can keep handles alive after the browser closed.
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  },
);
