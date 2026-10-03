// Playwright reporter that prints passed / failed / not-run separately and enforces
// MTEK_REQUIRE_GPU=1 (spec/testing.md section 6.1).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { envFlag, environmentFileName, validateEnvironment } from "./environment.ts";
import {
  addOutcome,
  classify,
  emptyCounts,
  evaluateGate,
  formatSummary,
  type Counts,
  type ProjectEnvironment,
} from "./run-summary.ts";

/** Projects that run on a software adapter by design (never hardware evidence). */
const SOFTWARE_PROJECTS: ReadonlySet<string> = new Set(["software"]);

function readEnvironment(resultsDir: string, project: string): ProjectEnvironment | null {
  const path = join(resultsDir, environmentFileName(project));
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    return { problems: [`unreadable: ${String(error)}`], isFallbackAdapter: null };
  }
  const problems = validateEnvironment(parsed);
  let isFallbackAdapter: boolean | null = null;
  if (problems.length === 0) {
    const record = parsed as { gpu: { adapter: { info: { isFallbackAdapter: boolean } } | null } };
    isFallbackAdapter = record.gpu.adapter?.info.isFallbackAdapter ?? null;
  }
  return { problems, isFallbackAdapter };
}

export default class NotRunReporter implements Reporter {
  private readonly counts = new Map<string, Counts>();

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "unknown";
    let counts = this.counts.get(project);
    if (counts === undefined) {
      counts = emptyCounts();
      this.counts.set(project, counts);
    }
    addOutcome(
      counts,
      classify({ project, status: result.status, annotations: test.annotations }),
    );
  }

  onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    const resultsDir = process.env["MTEK_RESULTS_DIR"] ?? "";
    const perProject = new Map<string, { counts: Counts; environment: ProjectEnvironment | null }>();
    for (const [project, counts] of [...this.counts].sort(([a], [b]) => a.localeCompare(b))) {
      perProject.set(project, { counts, environment: readEnvironment(resultsDir, project) });
    }
    const failures = evaluateGate({
      requireGpu: envFlag("MTEK_REQUIRE_GPU"),
      acceptSoftware: envFlag("MTEK_ACCEPT_SOFTWARE"),
      softwareProjects: SOFTWARE_PROJECTS,
      perProject,
    });
    process.stdout.write(`\n${formatSummary(perProject, failures)}\n`);
    if (resultsDir !== "") process.stdout.write(`  results: ${resultsDir}\n`);
    if (failures.length > 0 && result.status === "passed") return Promise.resolve({ status: "failed" });
    return Promise.resolve(undefined);
  }
}
