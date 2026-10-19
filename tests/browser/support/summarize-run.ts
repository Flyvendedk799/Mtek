// Summarises one browser test run for the environment matrix (M7-03, decision 0107).
//
//   node tests/browser/support/summarize-run.ts DIR [--title TEXT]
//
// DIR holds what a run leaves: Playwright's `test-results.json` and one `environment-<project>.json` per
// project. The tool writes `DIR/summary.json` and `DIR/summary.md`: for every project the number of passed,
// failed, NOT-RUN and skipped tests (classified exactly as the run's own reporter does, `run-summary.ts`),
// the adapter, browser and operating system from the environment record, the failed tests with the first
// line of their error, and the reasons of the skips. Every number of a supported-environments row comes
// from such a summary, so the row can be checked against the file it links to. Exit code 0 when written,
// 2 for a usage error or a directory without a report.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EnvironmentRecord } from "./environment-types.ts";
import { classify, emptyCounts, addOutcome, type Counts, type TestFacts } from "./run-summary.ts";

interface JsonResult {
  status: TestFacts["status"];
  error?: { message?: string };
}
interface JsonTest {
  projectName: string;
  annotations?: { type: string; description?: string }[];
  results: JsonResult[];
}
interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tests: JsonTest[];
}
interface JsonSuite {
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
interface JsonReport {
  suites: JsonSuite[];
  stats?: { startTime?: string; duration?: number };
}

export interface ProjectSummary {
  project: string;
  counts: Counts;
  total: number;
  environment: {
    browser: string;
    browserVersion: string;
    channel: string;
    headless: boolean;
    os: string;
    osVersion: string;
    navigatorGpu: boolean;
    adapter: string | null;
    isFallbackAdapter: boolean | null;
    reason: string | null;
    gitCommit: string;
    recordedAt: string;
  } | null;
  failed: { file: string; title: string; error: string }[];
  skipReasons: { reason: string; count: number }[];
}

export interface RunSummary {
  schemaVersion: 1;
  startTime: string | null;
  durationSeconds: number | null;
  projects: ProjectSummary[];
  total: Counts & { tests: number };
}

function firstLine(text: string): string {
  // eslint-disable-next-line no-control-regex -- strips ANSI colour codes from Playwright's messages
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  return (plain.split("\n").find((line) => line.trim() !== "") ?? "").trim().slice(0, 300);
}

export function summarize(report: JsonReport, records: ReadonlyMap<string, EnvironmentRecord>): RunSummary {
  const byProject = new Map<string, ProjectSummary>();
  const projectOf = (name: string): ProjectSummary => {
    let summary = byProject.get(name);
    if (summary === undefined) {
      summary = { project: name, counts: emptyCounts(), total: 0, environment: null, failed: [], skipReasons: [] };
      byProject.set(name, summary);
    }
    return summary;
  };
  const reasons = new Map<string, Map<string, number>>();
  const visit = (suite: JsonSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const summary = projectOf(test.projectName);
        const last = test.results[test.results.length - 1];
        const status = last?.status ?? "skipped";
        const annotations = test.annotations ?? [];
        const outcome = classify({ project: test.projectName, status, annotations });
        addOutcome(summary.counts, outcome);
        summary.total += 1;
        if (outcome === "failed") {
          summary.failed.push({ file: spec.file, title: spec.title, error: firstLine(last?.error?.message ?? "") });
        }
        if (outcome === "skipped" || outcome === "not-run") {
          const reason = annotations.find((a) => a.type === "skip")?.description ?? "skipped without a stated reason";
          const map = reasons.get(test.projectName) ?? new Map<string, number>();
          const key = `${outcome === "not-run" ? "NOT-RUN: " : ""}${firstLine(reason)}`;
          map.set(key, (map.get(key) ?? 0) + 1);
          reasons.set(test.projectName, map);
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  const total = { ...emptyCounts(), tests: 0 };
  const projects = [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project));
  for (const summary of projects) {
    const record = records.get(summary.project);
    if (record !== undefined) {
      summary.environment = {
        browser: record.browser.name,
        browserVersion: record.browser.version,
        channel: record.browser.channel,
        headless: record.browser.headless,
        os: `${record.os.platform} ${record.os.arch}`,
        osVersion: `${record.os.version} (${record.os.release})`,
        navigatorGpu: record.gpu.navigatorGpu,
        adapter: record.gpu.adapter?.info.description ?? null,
        isFallbackAdapter: record.gpu.adapter?.info.isFallbackAdapter ?? null,
        reason: record.gpu.reason,
        gitCommit: record.source.gitCommit,
        recordedAt: record.recordedAt,
      };
    }
    summary.skipReasons = [...(reasons.get(summary.project) ?? new Map<string, number>())].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    total.passed += summary.counts.passed;
    total.failed += summary.counts.failed;
    total.notRun += summary.counts.notRun;
    total.skipped += summary.counts.skipped;
    total.tests += summary.total;
  }
  return {
    schemaVersion: 1,
    startTime: report.stats?.startTime ?? null,
    durationSeconds: report.stats?.duration === undefined ? null : Math.round(report.stats.duration / 100) / 10,
    projects,
    total,
  };
}

export function renderMarkdown(summary: RunSummary, title: string): string {
  const lines = [`# ${title}`, "", "Generated by `tests/browser/support/summarize-run.ts` from `test-results.json` and the environment records next to it.", ""];
  lines.push(`Run started ${summary.startTime ?? "at an unknown time"}${summary.durationSeconds === null ? "" : `, ${String(summary.durationSeconds)} s of test time`}.`, "");
  lines.push("| Project | Passed | Failed | NOT-RUN | Skipped | Total | Adapter |", "|---|---|---|---|---|---|---|");
  for (const p of summary.projects) {
    const e = p.environment;
    const adapter = e === null ? "no environment record" : e.adapter === null ? `none (${e.navigatorGpu ? "navigator.gpu present" : "navigator.gpu absent"})` : `${e.adapter}${e.isFallbackAdapter === true ? " (software fallback adapter)" : " (hardware adapter)"}`;
    lines.push(`| ${p.project} | ${String(p.counts.passed)} | ${String(p.counts.failed)} | ${String(p.counts.notRun)} | ${String(p.counts.skipped)} | ${String(p.total)} | ${adapter} |`);
  }
  lines.push("", `Total: ${String(summary.total.passed)} passed, ${String(summary.total.failed)} failed, ${String(summary.total.notRun)} NOT-RUN, ${String(summary.total.skipped)} skipped, ${String(summary.total.tests)} tests.`, "");
  for (const p of summary.projects) {
    const e = p.environment;
    lines.push(`## Project ${p.project}`, "");
    if (e !== null) {
      lines.push(
        `- Browser: ${e.browser} ${e.browserVersion}, channel \`${e.channel}\`, ${e.headless ? "headless" : "headed"}.`,
        `- Operating system: ${e.os}, ${e.osVersion}.`,
        `- Source commit of the run: \`${e.gitCommit}\`, recorded ${e.recordedAt}.`,
      );
      if (e.reason !== null) lines.push(`- No adapter: ${e.reason}.`);
    }
    if (p.failed.length > 0) {
      lines.push("", "Failed:");
      for (const f of p.failed) lines.push(`- ${f.file}: ${f.title} (${f.error})`);
    }
    if (p.skipReasons.length > 0) {
      lines.push("", "Skipped or NOT-RUN, by reason:");
      for (const r of p.skipReasons) lines.push(`- ${String(r.count)} x ${r.reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function readRecords(dir: string): Map<string, EnvironmentRecord> {
  const records = new Map<string, EnvironmentRecord>();
  for (const name of readdirSync(dir)) {
    const match = /^environment-(.+)\.json$/.exec(name);
    if (match === null) continue;
    const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as EnvironmentRecord;
    records.set(record.project, record);
  }
  return records;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const titleAt = args.indexOf("--title");
  const title = titleAt >= 0 ? (args[titleAt + 1] ?? "Browser test run") : "Browser test run";
  if (dir === undefined || !existsSync(join(dir, "test-results.json"))) {
    process.stderr.write("usage: node tests/browser/support/summarize-run.ts DIR [--title TEXT]  (DIR must hold test-results.json)\n");
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(join(dir, "test-results.json"), "utf8")) as JsonReport;
  const summary = summarize(report, readRecords(dir));
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(dir, "summary.md"), renderMarkdown(summary, title));
  process.stdout.write(`${join(dir, "summary.md")}: ${String(summary.total.passed)} passed, ${String(summary.total.failed)} failed, ${String(summary.total.notRun)} not-run, ${String(summary.total.skipped)} skipped\n`);
}
