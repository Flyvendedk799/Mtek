// The runtime benchmark runner (decisions 0095 and 0096).
//
//   node tools/run.ts [--workload=a,b] [--impl=mtek,direct,three] [--smoke] [--publish] [--out=<dir>] [--seed=<n>] [--no-floor]
//
// It probes the browser's WebGPU adapter first and REFUSES to measure (status NOT-RUN, exit code 3, never a pass) unless
// the adapter is real hardware (`isFallbackAdapter === false`). Every pass runs in its own page load inside a fresh browser
// context, under the machine's GPU lock when `MTEK_GPU_LOCK_DIR` names one. `--smoke` runs the same passes with a handful
// of frames to prove the machinery; its output goes to `.out/runs/` and is never accepted as a result.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { chromium, type Browser, type CDPSession } from "@playwright/test";
import { buildEnvironmentRecord, validateEnvironment } from "../../../tests/browser/support/environment.ts";
import type { PageEnvironment } from "../../../tests/browser/support/environment-types.ts";
import { browserChannel, hardwareLaunchArgs, isHeadless } from "../../../tests/browser/support/launch-args.ts";
import { startStaticServer } from "../../../tests/browser/support/serve.ts";
import { sanitizeReport } from "../../../tests/browser/support/sanitize-report.ts";
import protocolFile from "../protocol.json" with { type: "json" };
import type { BenchContext, BenchGate, PassSpec } from "../harness/types.ts";
import { assessAdapter } from "./adapter.ts";
import { checkFrozen } from "./freeze.ts";
import { readWorkload } from "./gen-mtek.ts";
import { readCpuTimes, busyPercent, sampleBusy, waitForQuiet, type HostLoad } from "./host-load.ts";
import { withGpuLock } from "./gpu-lock.ts";
import { roundTimings, stringifyCompact } from "./json.ts";
import { OUT_DIR, RAW_DIR, REPO_ROOT, SITE_DIR, WORKLOADS, IMPLEMENTATIONS, isImplementation, isWorkload, type ImplementationName, type WorkloadName } from "./paths.ts";
import { encodePng } from "./png.ts";
import { planJobs, shuffle, smokeProtocol, specFor, type Job, type Protocol } from "./plan.ts";
import { prepareSite, type PreparedSite } from "./prepare.ts";
import type { RawJob, RawPairFile, RawRunMeta } from "./raw-types.ts";

/** A pass starts only when the machine is at most this busy (percent of all logical CPUs), measured over a quarter second. */
export const QUIET_LIMIT_PERCENT = 30;
const QUIET_MAX_WAIT_MS = 45_000;
/** Passes per lock acquisition (see the comment at the loop). */
const GROUP_SIZE = 10;
const PASS_TIMEOUT_MS = 10 * 60_000;
const BENCH_FLAGS = ["--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"];

interface Options {
  readonly workloads: readonly WorkloadName[];
  readonly implementations: readonly ImplementationName[];
  readonly smoke: boolean;
  readonly publish: boolean;
  readonly out: string | null;
  readonly seed: number;
  readonly floor: boolean;
  readonly prepare: boolean;
  /** Overrides of protocol numbers (`--set=cycles=50,timingFrames=300`); smoke runs only. */
  readonly overrides: Readonly<Record<string, number>>;
}

function parseArgs(args: readonly string[]): Options {
  const value = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const workloads = (value("workload")?.split(",") ?? [...WORKLOADS]).map((name) => {
    if (!isWorkload(name)) throw new Error(`unknown workload '${name}' (${WORKLOADS.join(", ")})`);
    return name;
  });
  const implementations = (value("impl")?.split(",") ?? [...IMPLEMENTATIONS]).map((name) => {
    if (!isImplementation(name)) throw new Error(`unknown implementation '${name}' (${IMPLEMENTATIONS.join(", ")})`);
    return name;
  });
  return {
    workloads,
    implementations,
    smoke: args.includes("--smoke"),
    publish: args.includes("--publish"),
    out: value("out") ?? null,
    seed: Number(value("seed") ?? 20261019),
    floor: !args.includes("--no-floor"),
    prepare: args.includes("--prepare"),
    overrides: Object.fromEntries(
      (value("set")?.split(",") ?? []).map((pair) => {
        const [key, number] = pair.split("=");
        return [key ?? "", Number(number)];
      }),
    ),
  };
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function runId(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not finish within ${String(ms / 1000)} s`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Strips what differs from machine to machine out of a message: the server's port. */
function neutral(text: string): string {
  return text.replace(/http:\/\/127\.0\.0\.1:\d+/g, "http://127.0.0.1:<port>");
}

interface PassOutcome {
  readonly status: "ok" | "error";
  readonly error?: string;
  readonly pageErrors: string[];
  readonly consoleWarnings: number;
  readonly result?: unknown;
  readonly allocation?: RawJob["allocation"];
}

async function runPass(browser: Browser, serverUrl: string, job: Job, spec: PassSpec, context: BenchContext): Promise<PassOutcome> {
  const browserContext = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  let consoleWarnings = 0;
  let cdp: CDPSession | undefined;
  let allocation: RawJob["allocation"] | undefined;
  const emitted: unknown[] = [];
  try {
    const page = await browserContext.newPage();
    page.on("pageerror", (error) => {
      if (pageErrors.length < 20) pageErrors.push(neutral(error.message));
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        if (pageErrors.length < 20) pageErrors.push(`console: ${neutral(message.text())}`);
      } else if (message.type() === "warning") {
        consoleWarnings += 1;
      }
    });
    if (job.pass === "allocation") {
      cdp = await browserContext.newCDPSession(page);
      await cdp.send("HeapProfiler.enable");
      const samplingInterval = 4096;
      const gate: BenchGate = async (stage) => {
        if (cdp === undefined) return;
        if (stage === "begin") {
          await cdp.send("HeapProfiler.startSampling", { samplingInterval, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        } else {
          const { profile } = await cdp.send("HeapProfiler.stopSampling");
          let total = 0;
          let nodes = 0;
          const sites = new Map<string, number>();
          const stack = [profile.head];
          while (stack.length > 0) {
            const node = stack.pop();
            if (node === undefined) continue;
            total += node.selfSize;
            nodes += 1;
            if (node.selfSize > 0) {
              const frame = node.callFrame;
              const file = frame.url.split("/").pop() ?? "";
              const site = `${frame.functionName === "" ? "(anonymous)" : frame.functionName} ${file}:${String(frame.lineNumber + 1)}`;
              sites.set(site, (sites.get(site) ?? 0) + node.selfSize);
            }
            stack.push(...node.children);
          }
          const topSites = [...sites.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .slice(0, 8)
            .map(([site, bytes]) => ({ site, sampledBytes: bytes }));
          allocation = { sampledBytes: total, profileNodes: nodes, samplingIntervalBytes: samplingInterval, topSites };
        }
      };
      await page.exposeFunction("__benchGate", gate);
    }
    if (job.pass === "cycles" || job.pass === "cycles-long") {
      cdp = await browserContext.newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("HeapProfiler.enable");
      await page.exposeFunction("__benchEmit", (record: unknown): void => {
        emitted.push(record);
      });
      await page.exposeFunction("__benchSample", async (): Promise<Record<string, number>> => {
        if (cdp === undefined) return {};
        await cdp.send("HeapProfiler.collectGarbage");
        const heap = await cdp.send("Runtime.getHeapUsage");
        const { metrics } = await cdp.send("Performance.getMetrics");
        const wanted = new Set(["Nodes", "JSEventListeners", "Documents", "Frames", "LayoutObjects", "JSHeapUsedSize", "JSHeapTotalSize"]);
        const out: Record<string, number> = { heapUsedBytes: heap.usedSize, heapTotalBytes: heap.totalSize };
        for (const metric of metrics) if (wanted.has(metric.name)) out[metric.name] = metric.value;
        return out;
      });
    }
    await page.goto(`${serverUrl}/pages/${job.workload}/${job.implementation}.html`);
    await page.waitForFunction(() => (window as unknown as { __bench?: { ready: boolean } }).__bench?.ready === true, undefined, { timeout: 30_000 });
    const result = await withTimeout(
      page.evaluate(
        ({ spec: s, context: c }) => (window as unknown as { __bench: { run(spec: unknown, context: unknown): Promise<unknown> } }).__bench.run(s, c),
        { spec, context },
      ),
      PASS_TIMEOUT_MS,
      `${job.workload}/${job.implementation}/${job.pass}`,
    );
    if (emitted.length > 0) (result as { records: unknown[] }).records = emitted;
    const problems = (result as { problems?: string[] } | null)?.problems ?? [];
    if (problems.length > 0) {
      return { status: "error", error: `GPU device problems: ${problems.map(neutral).join(" | ")}`, pageErrors, consoleWarnings, result, ...(allocation === undefined ? {} : { allocation }) };
    }
    return { status: "ok", pageErrors, consoleWarnings, result, ...(allocation === undefined ? {} : { allocation }) };
  } catch (error) {
    return { status: "error", error: neutral(error instanceof Error ? error.message : String(error)), pageErrors, consoleWarnings };
  } finally {
    await browserContext.close().catch(() => undefined);
  }
}

function describeJob(job: Job): string {
  return `${job.workload}/${job.implementation}/${job.pass}#${String(job.run)}`;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const started = new Date();
  const id = (options.smoke ? "smoke-" : "") + runId(started);
  if (Object.keys(options.overrides).length > 0 && !options.smoke) throw new Error("--set changes the protocol and is allowed in smoke runs only");
  const protocol: Protocol = options.smoke ? ({ ...smokeProtocol(protocolFile), ...options.overrides }) : protocolFile;
  const outDir = options.out !== null ? join(process.cwd(), options.out) : options.publish ? join(RAW_DIR, id) : join(OUT_DIR, "runs", id);
  if (options.publish && options.smoke) throw new Error("a smoke run is never published");
  mkdirSync(join(outDir, "parity"), { recursive: true });

  // The frozen definitions must be what was recorded (smoke runs may differ: they are not results).
  const frozen = checkFrozen();
  if (!frozen.ok && !options.smoke) {
    process.stderr.write(`refusing to run: ${frozen.problems.join("; ")}\n(record the change with a rationale: node tools/freeze.ts --record "<why>")\n`);
    return 4;
  }

  const gitCommit = git(["rev-parse", "HEAD"]) ?? "unknown";
  // The results directory is not code: a run must not count the files it is about to write (or an earlier run's) as changes.
  const gitDirty = (git(["status", "--porcelain", "--", ".", ":(exclude)benchmarks/results/runtime"]) ?? "x").length > 0;
  if (options.publish && gitDirty) {
    process.stderr.write(
      "refusing to publish: the working tree has uncommitted changes, so the commit recorded in the results would not describe the code that ran; commit first\n",
    );
    return 5;
  }

  let prepared: PreparedSite;
  if (options.prepare || !existsSync(join(SITE_DIR, "prepared.json"))) {
    prepared = await prepareSite({});
  } else {
    prepared = JSON.parse(readFileSync(join(SITE_DIR, "prepared.json"), "utf8")) as PreparedSite;
  }

  const server = await startStaticServer(SITE_DIR, 0, {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  const launchArgs = [...hardwareLaunchArgs(), ...BENCH_FLAGS];
  const channel = browserChannel();
  const headless = isHeadless();
  const browser = await chromium.launch({ channel, headless, args: launchArgs });
  try {
    // ---- the environment record and the hardware-only rule ------------------------------------------------------
    const probeContext = await browser.newContext();
    let pageEnvironment: PageEnvironment;
    try {
      const page = await probeContext.newPage();
      await page.goto(`${server.url}/env.html`);
      pageEnvironment = await page.evaluate(() =>
        (window as unknown as { mtekCollectEnvironment: () => Promise<PageEnvironment> }).mtekCollectEnvironment(),
      );
    } finally {
      await probeContext.close();
    }
    const record = buildEnvironmentRecord("runtime-benchmark", pageEnvironment, {
      name: browser.browserType().name(),
      channel,
      version: browser.version(),
      headless,
      launchArgs,
    });
    const problems = validateEnvironment(record);
    if (problems.length > 0) throw new Error(`environment record violates environment.schema.json: ${problems.join("; ")}`);
    writeFileSync(join(outDir, "environment.json"), stringifyCompact(sanitizeReport(record)));

    const verdict = assessAdapter(record);
    const baseMeta = {
      schemaVersion: 1 as const,
      runId: id,
      smoke: options.smoke,
      startedAt: started.toISOString(),
      gitCommit,
      gitDirty,
      frozen: { treeHash: frozen.treeHash, recordedHash: frozen.recordedHash, matches: frozen.ok },
      protocol,
      seed: options.seed,
      workloads: options.workloads,
      implementations: options.implementations,
      versions: { mtek: prepared.mtekVersion, three: prepared.threeVersion, rapier: prepared.rapierVersion, runtimeWeb: prepared.runtimeVersion },
      gpuLockConfigured: (process.env["MTEK_GPU_LOCK_DIR"] ?? "") !== "",
      quietLimitPercent: QUIET_LIMIT_PERCENT,
      arguments: process.argv.slice(2),
    };
    if (verdict.status === "not-run") {
      const meta: RawRunMeta = { ...baseMeta, status: "not-run", notRunReason: verdict.reason, finishedAt: new Date().toISOString(), order: [] };
      writeFileSync(join(outDir, "run.json"), stringifyCompact(meta));
      process.stderr.write(`${verdict.reason}\nNOT-RUN: no numbers were produced; this is not a pass.\n`);
      return 3;
    }
    process.stdout.write(`adapter: ${verdict.description} (timestamp-query ${verdict.timestampQuery ? "available" : "NOT available: GPU time will be labelled unavailable"})\n`);

    // ---- the plan --------------------------------------------------------------------------------------------------
    const workloadInfo = options.workloads.map((name) => {
      const file = readWorkload(name);
      return { name, kind: file.kind, parityFrames: file.parityFrames };
    });
    const jobs = planJobs(workloadInfo, options.implementations, protocol, options.seed);
    if (options.floor) {
      const floorWorkload = { name: "floor", kind: "frames" as const, parityFrames: 5 };
      const floorJobs = planJobs([floorWorkload], ["floor"], protocol, options.seed).filter((j) => ["timing", "gpu-time", "allocation"].includes(j.pass));
      jobs.push(...shuffle(floorJobs, options.seed));
    }
    const order = shuffle(jobs, options.seed + 1);
    const pairs = new Map<string, RawJob[]>();
    const done: string[] = [];
    let index = 0;
    // The GPU lock is taken once per group of passes (about a minute of GPU use), not once per pass: on a machine shared
    // with other GPU users a pass-by-pass lock was lost to them for minutes at a time. A pass that takes long (the cycle
    // runs) is a group of its own. Within a group the passes keep the pseudo-random order, and each pass samples the
    // machine's load itself before it starts.
    const groups: Job[][] = [];
    for (const job of order) {
      const last = groups[groups.length - 1];
      const long = job.pass === "cycles-long" || job.pass === "cycles";
      if (last === undefined || long || last.length >= GROUP_SIZE || last.some((j) => j.pass === "cycles" || j.pass === "cycles-long")) groups.push([job]);
      else last.push(job);
    }
    for (const group of groups) {
      const quiet = await waitForQuiet(QUIET_LIMIT_PERCENT, QUIET_MAX_WAIT_MS);
      await withGpuLock(async (lock) => {
        for (const job of group) {
          index += 1;
          const label = describeJob(job);
          const workloadInfoFor = workloadInfo.find((w) => w.name === job.workload) ?? { name: "floor", kind: "frames" as const, parityFrames: 5 };
          const spec = specFor(job.pass, protocol, workloadInfoFor);
          const context: BenchContext = {
            workload: job.workload,
            implementation: job.implementation as BenchContext["implementation"],
            assetBase: `/assets/${job.workload}/`,
            programUrl: `/mtek/${job.workload}/app.js`,
            editedProgramUrl: job.workload === "mount-reload-dispose" ? `/mtek/${job.workload}-edited/app.js` : null,
          };
          const busyBefore = await sampleBusy(250);
          const jobStarted = new Date();
          const t0 = Date.now();
          const cpuBefore = readCpuTimes();
          const outcome = { ...(await runPass(browser, server.url, job, spec, context)), waited: lock.dir === null ? null : lock.waitedMs };
          const hostLoad: HostLoad = {
            busyBeforePercent: busyBefore,
            busyDuringPercent: busyPercent(cpuBefore, readCpuTimes()),
            waitedForQuietMs: quiet.waitedForQuietMs,
            noisy: busyBefore > QUIET_LIMIT_PERCENT,
            logicalCpus: (await import("node:os")).cpus().length,
          };
          let result = outcome.result;
          if (job.pass === "parity" && outcome.status === "ok") {
            const parity = result as { rgba: string; width: number; height: number } & Record<string, unknown>;
            const png = encodePng(parity.width, parity.height, Buffer.from(parity.rgba, "base64"));
            writeFileSync(join(outDir, "parity", `${job.workload}--${job.implementation}.png`), png);
            const { rgba: _dropped, ...rest } = parity;
            void _dropped;
            result = rest;
          }
          const raw: RawJob = {
            pass: job.pass,
            run: job.run,
            startedAt: jobStarted.toISOString(),
            durationMs: Date.now() - t0,
            hostLoad,
            gpuLockWaitedMs: outcome.waited,
            status: outcome.status,
            ...(outcome.error === undefined ? {} : { error: outcome.error }),
            pageErrors: outcome.pageErrors,
            consoleWarnings: outcome.consoleWarnings,
            ...(result === undefined ? {} : { result }),
            ...(outcome.allocation === undefined ? {} : { allocation: outcome.allocation }),
          };
          const key = `${job.workload}--${job.implementation}`;
          const list = pairs.get(key) ?? [];
          list.push(raw);
          pairs.set(key, list);
          done.push(label);
          process.stdout.write(
            `[${String(index)}/${String(order.length)}] ${label}: ${outcome.status}${outcome.error === undefined ? "" : ` (${outcome.error.slice(0, 160)})`} in ${String(raw.durationMs)} ms, busy ${hostLoad.busyBeforePercent.toFixed(0)}%${hostLoad.noisy ? " NOISY" : ""}\n`,
          );
        }
      });
    }

    // ---- write ------------------------------------------------------------------------------------------------------
    for (const [key, list] of pairs) {
      const [workload, implementation] = key.split("--") as [string, string];
      const file: RawPairFile = { schemaVersion: 1, runId: id, workload, implementation, jobs: list.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
      const name = workload === "floor" ? "floor.json" : `${key}.json`;
      writeFileSync(join(outDir, name), stringifyCompact(sanitizeReport(roundTimings(file))));
    }
    const sizesPath = join(SITE_DIR, "sizes.json");
    if (existsSync(sizesPath)) writeFileSync(join(outDir, "sizes.json"), stringifyCompact(JSON.parse(readFileSync(sizesPath, "utf8"))));
    const meta: RawRunMeta = { ...baseMeta, status: "complete", finishedAt: new Date().toISOString(), order: done };
    writeFileSync(join(outDir, "run.json"), stringifyCompact(sanitizeReport(meta)));
    process.stdout.write(`results: ${relative(REPO_ROOT, outDir).replace(/\\/g, "/")}\n`);
    return [...pairs.values()].some((list) => list.some((j) => j.status === "error")) ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  process.exitCode = await main();
}
