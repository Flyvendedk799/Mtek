// Reduces a SANITISED Playwright JSON report (`npm run evidence:sanitize -- in.json out.json`) of the `benchmarks`
// project to the record committed as evidence (the shape of benchmarks/evidence/baseline-*-results.json).
//   node summarise-playwright.mjs <sanitised.json> <reference|starter> <command text> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [input, source, command, output] = process.argv.slice(2);
const report = JSON.parse(readFileSync(input, "utf8"));
const tests = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.[test.results.length - 1];
      const status = result?.status === "passed" ? "passed" : result?.status === "skipped" ? "skipped" : "failed";
      const message = result?.error?.message ?? "";
      const firstErrorLine = message.split("\n").map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim()).find((l) => l !== "");
      tests.push({
        title: spec.title,
        project: test.projectName,
        status,
        durationMs: result?.duration ?? 0,
        ...(status === "failed" && firstErrorLine !== undefined ? { firstErrorLine } : {}),
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);
tests.sort((a, b) => a.title.localeCompare(b.title));
const counts = { passed: tests.filter((t) => t.status === "passed").length, failed: tests.filter((t) => t.status === "failed").length };
writeFileSync(output, `${JSON.stringify({ baselineSource: source, command, counts, tests }, null, 2)}\n`);
console.log(`${source}: ${counts.passed} passed, ${counts.failed} failed`);
