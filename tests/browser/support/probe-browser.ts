// Probes one browser for WebGPU and writes its environment record (M7-03, decision 0107).
//
//   node tests/browser/support/probe-browser.ts --browser chromium|firefox|webkit --name NAME --out DIR
//        [--channel chrome|msedge|...] [--arg SWITCH]... [--firefox-pref NAME=VALUE]... [--headed]
//
// It does what the `gpuProbe` fixture does for a Playwright project (the same page-side probe, the same
// record writer, the same schema check) for a browser that the Playwright projects do not launch: Firefox
// and WebKit, or an installed Chrome or Edge with other switches. The record is written to
// `DIR/environment-NAME.json`; a browser without `navigator.gpu` is a result (`gpu.navigatorGpu: false` and
// the reason), not an error. Exit code 0 when a record was written, 2 for a usage error, 3 when the browser
// could not be launched (nothing is written then).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";
import type { PageEnvironment } from "./environment-types.ts";
import { BROWSER_ROOT, buildEnvironmentRecord, environmentFileName, validateEnvironment } from "./environment.ts";
import { startStaticServer } from "./serve.ts";

export interface ProbeOptions {
  browser: "chromium" | "firefox" | "webkit";
  name: string;
  out: string;
  channel: string | null;
  args: string[];
  firefoxPrefs: Record<string, string | number | boolean>;
  headed: boolean;
}

/** Parses the command line; returns a message for a usage error. */
export function parseArguments(argv: readonly string[]): ProbeOptions | string {
  const options: ProbeOptions = { browser: "chromium", name: "", out: "", channel: null, args: [], firefoxPrefs: {}, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const value = (): string | undefined => argv[++i];
    if (arg === "--browser") {
      const v = value();
      if (v !== "chromium" && v !== "firefox" && v !== "webkit") return "--browser is chromium, firefox or webkit";
      options.browser = v;
    } else if (arg === "--name") options.name = value() ?? "";
    else if (arg === "--out") options.out = value() ?? "";
    else if (arg === "--channel") options.channel = value() ?? "";
    else if (arg === "--arg") options.args.push(value() ?? "");
    else if (arg === "--firefox-pref") {
      const pair = value() ?? "";
      const at = pair.indexOf("=");
      if (at <= 0) return "--firefox-pref needs NAME=VALUE";
      const raw = pair.slice(at + 1);
      options.firefoxPrefs[pair.slice(0, at)] = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
    } else if (arg === "--headed") options.headed = true;
    else return `unknown argument ${arg}`;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.name)) return "--name is required (lower-case letters, digits, hyphens)";
  if (options.out === "") return "--out is required";
  if (options.browser !== "chromium" && options.channel !== null) return "--channel is for chromium only";
  if (options.browser !== "firefox" && Object.keys(options.firefoxPrefs).length > 0) return "--firefox-pref is for firefox only";
  return options;
}

function typeOf(browser: ProbeOptions["browser"]): BrowserType {
  return browser === "firefox" ? firefox : browser === "webkit" ? webkit : chromium;
}

export async function probe(options: ProbeOptions): Promise<{ path: string; navigatorGpu: boolean; adapter: boolean; reason: string | null }> {
  const work = mkdtempSync(join(tmpdir(), "mtek-probe-"));
  const server = await (async () => {
    await build({
      entryPoints: [join(BROWSER_ROOT, "support", "env-probe.ts")],
      outfile: join(work, "env-probe.js"),
      bundle: true,
      format: "esm",
      target: "es2022",
      platform: "browser",
      logLevel: "warning",
    });
    copyFileSync(join(BROWSER_ROOT, "pages", "env.html"), join(work, "env.html"));
    return startStaticServer(work);
  })();
  try {
    const launchArgs = [...options.args, ...Object.entries(options.firefoxPrefs).map(([k, v]) => `pref:${k}=${String(v)}`)];
    const browser = await typeOf(options.browser).launch({
      headless: !options.headed,
      ...(options.channel === null ? {} : { channel: options.channel }),
      args: options.args,
      ...(options.browser === "firefox" ? { firefoxUserPrefs: options.firefoxPrefs } : {}),
    });
    try {
      const context = await browser.newContext({ baseURL: server.url });
      const page = await context.newPage();
      await page.goto("/env.html");
      const pageEnvironment = await page.evaluate(() =>
        (window as unknown as { mtekCollectEnvironment: () => Promise<PageEnvironment> }).mtekCollectEnvironment(),
      );
      await context.close();
      const record = buildEnvironmentRecord(options.name, pageEnvironment, {
        name: browser.browserType().name(),
        channel: options.channel ?? options.browser,
        version: browser.version(),
        headless: !options.headed,
        launchArgs,
      });
      const problems = validateEnvironment(record);
      if (problems.length > 0) throw new Error(`environment record violates environment.schema.json: ${problems.join("; ")}`);
      mkdirSync(options.out, { recursive: true });
      const path = join(options.out, environmentFileName(options.name));
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
      return { path, navigatorGpu: record.gpu.navigatorGpu, adapter: record.gpu.adapter !== null, reason: record.gpu.reason };
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const parsed = parseArguments(process.argv.slice(2));
  if (typeof parsed === "string") {
    process.stderr.write(`probe-browser: ${parsed}\n`);
    process.exit(2);
  }
  try {
    const result = await probe(parsed);
    process.stdout.write(
      `${parsed.name}: navigator.gpu ${result.navigatorGpu ? "present" : "absent"}, adapter ${result.adapter ? "present" : "absent"}${result.reason === null ? "" : ` (${result.reason})`}\nrecord: ${result.path}\n`,
    );
  } catch (error) {
    process.stderr.write(`probe-browser: the browser could not be probed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(3);
  }
}
