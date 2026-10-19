// Repeats the passes of a published run that the machine disturbed (decision 0095 item 12).
//
//   node tools/retry.ts --run=<run-id> [--max-attempts=3]
//
// A pass is disturbed when the machine's CPU was busier than the quiet limit just before it, or busier than 50 % while it ran
// (another process on the shared workstation). Such a pass is run again, up to the attempt limit, on the same prepared site,
// under the same frozen definitions; the new attempt is appended to the raw results, nothing is removed, and the statistics
// use the first undisturbed attempt (`attempts.ts`): the choice depends on the machine's load, never on a result.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { sanitizeReport } from "../../../tests/browser/support/sanitize-report.ts";
import { browserChannel, hardwareLaunchArgs, isHeadless } from "../../../tests/browser/support/launch-args.ts";
import { startStaticServer } from "../../../tests/browser/support/serve.ts";
import type { EnvironmentRecord } from "../../../tests/browser/support/environment-types.ts";
import { assessAdapter } from "./adapter.ts";
import { MAX_ATTEMPTS, groupAttempts, needsRetry } from "./attempts.ts";
import { checkFrozen } from "./freeze.ts";
import { readWorkload } from "./gen-mtek.ts";
import { withGpuLock } from "./gpu-lock.ts";
import { waitForQuiet } from "./host-load.ts";
import { roundTimings, stringifyCompact } from "./json.ts";
import { RAW_DIR, REPO_ROOT, SITE_DIR, WORKLOADS } from "./paths.ts";
import type { Job } from "./plan.ts";
import type { RawJob, RawPairFile, RawRunMeta } from "./raw-types.ts";
import { QUIET_LIMIT_PERCENT, describeJob, executeJob, logLine, type WorkloadInfo } from "./run.ts";
import { execFileSync } from "node:child_process";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const id = args.find((a) => a.startsWith("--run="))?.slice("--run=".length);
  if (id === undefined) {
    process.stderr.write("usage: node tools/retry.ts --run=<run-id> [--max-attempts=3]\n");
    return 2;
  }
  const maxAttempts = Number(args.find((a) => a.startsWith("--max-attempts="))?.slice("--max-attempts=".length) ?? MAX_ATTEMPTS);
  const dir = join(RAW_DIR, id);
  const meta = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RawRunMeta;
  if (meta.status !== "complete" || meta.smoke) {
    process.stderr.write("only a complete, non-smoke run can be completed with retries\n");
    return 2;
  }
  const frozen = checkFrozen();
  if (!frozen.ok || frozen.treeHash !== meta.frozen.treeHash) {
    process.stderr.write("the workload definitions are not the ones this run was taken under; refusing to add passes to it\n");
    return 4;
  }
  if ((git(["status", "--porcelain", "--", ".", ":(exclude)benchmarks/results/runtime"]) ?? "x").length > 0) {
    process.stderr.write("refusing: the working tree has uncommitted changes\n");
    return 5;
  }

  const files = new Map<string, RawPairFile>();
  for (const name of readdirSync(dir)) {
    if (name === "floor.json") files.set("floor--floor", JSON.parse(readFileSync(join(dir, name), "utf8")) as RawPairFile);
    else if (name.includes("--") && name.endsWith(".json")) files.set(name.slice(0, -".json".length), JSON.parse(readFileSync(join(dir, name), "utf8")) as RawPairFile);
  }
  const workloadInfo: WorkloadInfo[] = WORKLOADS.map((name) => {
    const file = readWorkload(name);
    return { name, kind: file.kind, parityFrames: file.parityFrames };
  });

  const server = await startStaticServer(SITE_DIR, 0, { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
  const environment = JSON.parse(readFileSync(join(dir, "environment.json"), "utf8")) as EnvironmentRecord;
  const launchArgs = environment.browser.launchArgs;
  const browser = await chromium.launch({ channel: browserChannel(), headless: isHeadless(), args: launchArgs.length > 0 ? launchArgs : hardwareLaunchArgs() });
  try {
    // The same hardware-only rule as the run: the browser must still see the recorded adapter.
    const probe = await browser.newContext();
    try {
      const page = await probe.newPage();
      await page.goto(`${server.url}/env.html`);
      const now = await page.evaluate(() => (window as unknown as { mtekCollectEnvironment: () => Promise<{ gpu: EnvironmentRecord["gpu"] }> }).mtekCollectEnvironment());
      const verdict = assessAdapter({ gpu: now.gpu });
      if (verdict.status === "not-run" || now.gpu.adapter?.info.description !== environment.gpu.adapter?.info.description) {
        process.stderr.write(`NOT-RUN: the adapter is not the recorded hardware (${verdict.status === "not-run" ? verdict.reason : "a different adapter"})\n`);
        return 3;
      }
    } finally {
      await probe.close();
    }

    const repeated: string[] = [];
    for (;;) {
      const candidates: Array<{ key: string; job: Job; attempts: RawJob[] }> = [];
      for (const [key, file] of files) {
        for (const attempts of groupAttempts(file.jobs)) {
          if (!needsRetry(attempts, maxAttempts)) continue;
          const first = attempts[0] as RawJob;
          candidates.push({ key, job: { workload: file.workload, implementation: file.implementation, pass: first.pass, run: first.run }, attempts });
        }
      }
      if (candidates.length === 0) break;
      process.stdout.write(`${String(candidates.length)} disturbed pass(es) to repeat\n`);
      for (let i = 0; i < candidates.length; i += 10) {
        const group = candidates.slice(i, i + 10);
        const quiet = await waitForQuiet(QUIET_LIMIT_PERCENT, 45_000);
        await withGpuLock(async (lock) => {
          for (const candidate of group) {
            const attempt = candidate.attempts.length + 1;
            const raw = await executeJob(browser, server.url, candidate.job, meta.protocol, workloadInfo, dir, {
              lockWaitedMs: lock.dir === null ? null : lock.waitedMs,
              waitedForQuietMs: quiet.waitedForQuietMs,
              attempt,
            });
            const file = files.get(candidate.key) as RawPairFile;
            files.set(candidate.key, { ...file, jobs: [...file.jobs, raw] });
            repeated.push(`${describeJob(candidate.job)} attempt ${String(attempt)}`);
            process.stdout.write(logLine(i + 1, candidates.length, candidate.job, raw));
          }
        });
      }
    }

    for (const [key, file] of files) {
      const name = file.workload === "floor" ? "floor.json" : `${key}.json`;
      writeFileSync(join(dir, name), stringifyCompact(sanitizeReport(roundTimings(file))));
    }
    const updated: RawRunMeta = {
      ...meta,
      order: [...meta.order, ...repeated],
      retries: [...(meta.retries ?? []), { at: new Date().toISOString(), gitCommit: git(["rev-parse", "HEAD"]) ?? "unknown", passes: repeated }],
    };
    writeFileSync(join(dir, "run.json"), stringifyCompact(sanitizeReport(updated)));
    process.stdout.write(`${String(repeated.length)} pass(es) repeated; results in ${existsSync(dir) ? id : ""}\n`);
    return 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) process.exitCode = await main();
