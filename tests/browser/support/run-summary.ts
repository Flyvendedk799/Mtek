// Pure logic of the NOT-RUN reporter: classification of test outcomes and the GPU gate.
// "Could not run" is never "passed" (spec/testing.md section 6.1).

export const NOT_RUN_PREFIX = "NOT-RUN";

export type Outcome = "passed" | "failed" | "not-run" | "skipped";

export interface TestFacts {
  project: string;
  /** Final result status of the last attempt, as reported by Playwright. */
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  /** Playwright annotations of the test (`skip` annotations carry the reason). */
  annotations: ReadonlyArray<{ type: string; description?: string | undefined }>;
}

export function classify(test: TestFacts): Outcome {
  switch (test.status) {
    case "passed":
      return "passed";
    case "skipped": {
      const notRun = test.annotations.some(
        (annotation) =>
          annotation.type === "skip" && (annotation.description ?? "").startsWith(NOT_RUN_PREFIX),
      );
      return notRun ? "not-run" : "skipped";
    }
    default:
      return "failed";
  }
}

export interface Counts {
  passed: number;
  failed: number;
  notRun: number;
  skipped: number;
}

export function emptyCounts(): Counts {
  return { passed: 0, failed: 0, notRun: 0, skipped: 0 };
}

export function addOutcome(counts: Counts, outcome: Outcome): void {
  switch (outcome) {
    case "passed":
      counts.passed += 1;
      break;
    case "failed":
      counts.failed += 1;
      break;
    case "not-run":
      counts.notRun += 1;
      break;
    case "skipped":
      counts.skipped += 1;
      break;
  }
}

/** What the gate needs to know about one project's environment record (null: no valid record). */
export interface ProjectEnvironment {
  /** Schema violations of the record file; empty when valid. */
  problems: string[];
  /** `adapter.info.isFallbackAdapter`, or null when there is no adapter / no record. */
  isFallbackAdapter: boolean | null;
}

export interface GateInput {
  requireGpu: boolean;
  acceptSoftware: boolean;
  /** Projects whose adapters are software by design and so exempt from the fallback check. */
  softwareProjects: ReadonlySet<string>;
  perProject: ReadonlyMap<string, { counts: Counts; environment: ProjectEnvironment | null }>;
}

/** Returns the reasons the run must fail on top of failed tests; empty when the gate is satisfied. */
export function evaluateGate(input: GateInput): string[] {
  const failures: string[] = [];
  for (const [project, { counts, environment }] of input.perProject) {
    if (environment !== null && environment.problems.length > 0) {
      failures.push(
        `project ${project}: environment record violates environment.schema.json: ${environment.problems.join("; ")}`,
      );
    }
    if (!input.requireGpu) continue;
    if (counts.notRun > 0) {
      failures.push(
        `project ${project}: ${counts.notRun} test(s) NOT-RUN and MTEK_REQUIRE_GPU=1 (no WebGPU adapter)`,
      );
    }
    const total = counts.passed + counts.failed + counts.notRun + counts.skipped;
    if (total > 0 && environment === null) {
      failures.push(`project ${project}: no environment record was written and MTEK_REQUIRE_GPU=1`);
    }
    if (
      environment?.isFallbackAdapter === true &&
      !input.acceptSoftware &&
      !input.softwareProjects.has(project)
    ) {
      failures.push(
        `project ${project}: adapter reports isFallbackAdapter === true; set MTEK_ACCEPT_SOFTWARE=1 to accept software evidence`,
      );
    }
  }
  return failures;
}

export function formatSummary(
  perProject: ReadonlyMap<string, { counts: Counts; environment: ProjectEnvironment | null }>,
  failures: readonly string[],
): string {
  const total = emptyCounts();
  const lines: string[] = [];
  for (const [project, { counts, environment }] of perProject) {
    total.passed += counts.passed;
    total.failed += counts.failed;
    total.notRun += counts.notRun;
    total.skipped += counts.skipped;
    const adapter =
      environment === null
        ? "no environment record"
        : environment.isFallbackAdapter === null
          ? "no adapter"
          : environment.isFallbackAdapter
            ? "software (fallback) adapter"
            : "hardware adapter";
    lines.push(
      `  ${project}: ${counts.passed} passed / ${counts.failed} failed / ${counts.notRun} not-run` +
        (counts.skipped > 0 ? ` / ${counts.skipped} skipped` : "") +
        `  [${adapter}]`,
    );
  }
  const header =
    `Mtek browser tests: ${total.passed} passed / ${total.failed} failed / ${total.notRun} not-run` +
    (total.skipped > 0 ? ` / ${total.skipped} skipped` : "");
  const notice =
    total.notRun > 0 ? ["  NOT-RUN tests did not run and are not counted as passed."] : [];
  const gate = failures.map((failure) => `  GATE FAILURE: ${failure}`);
  return [header, ...lines, ...notice, ...gate].join("\n");
}
