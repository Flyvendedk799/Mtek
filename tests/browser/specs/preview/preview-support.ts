// Shared by the untrusted-preview specs of M6-10 (decision 0075): the page-side shape of a mounted application, a way
// to look at the application of an *unmodified* preview page, a heartbeat that tells whether the main thread ever stood
// still, and the helpers that derive expected source locations from the fixture's own source text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { PREVIEW_FIXTURES_DIR, PREVIEW_OUT_DIR } from "../../support/preview-fixtures.ts";

export interface DiagnosticLike {
  code: string;
  severity: string;
  title: string;
  message: string;
  phase: string;
  source: { file: string; startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  notes: string[];
}

export interface PreviewAppLike {
  state: string;
  debug: {
    pressKey(code: string): void;
    releaseKey(code: string): void;
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    scene(): { state: Record<string, number>; entities: Array<{ name: string; position: { x: number; y: number; z: number } }> };
  };
  dispose(): void;
}

/** What the page script installed by {@link exposeApp} keeps on `window.__mtek`. */
export interface PageMtek {
  app: PreviewAppLike | null;
  error: { kind: string; codes: string[]; message: string } | null;
  diagnostics: DiagnosticLike[];
}

export const pageMtek = (): PageMtek => (window as unknown as { __mtek: PageMtek }).__mtek;

/**
 * Replaces `bootstrap.js` of the preview build `name` by a module that mounts exactly like the generated one and also
 * keeps the application, the mount error and every diagnostic on `window.__mtek`. Only that one file differs: `index.html`
 * (with its policy), `app.js`, the runtime and the manifest are the build's own, and the replacement is served from the
 * page's own directory like the original, so the policy treats it the same way. Call before `page.goto`.
 */
export async function exposeApp(page: Page, name: string, options: object): Promise<void> {
  const body = [
    'import program, { mountMtek } from "./app.js";',
    "window.__mtek = { app: null, error: null, diagnostics: [] };",
    `const options = ${JSON.stringify(options)};`,
    "options.onDiagnostic = (diagnostic) => { window.__mtek.diagnostics.push(diagnostic); };",
    'mountMtek(document.getElementById("mtek"), program, options).then(',
    "  (app) => { window.__mtek.app = app; },",
    "  (error) => { window.__mtek.error = { kind: error.kind, codes: (error.diagnostics || []).map((d) => d.code), message: String(error.message) }; },",
    ");",
    "",
  ].join("\n");
  await page.route(`**/preview/${name}/bootstrap.js`, (route) => route.fulfill({ contentType: "text/javascript; charset=utf-8", body }));
}

/** Starts a heartbeat in every page of `page`: `window.__beat.max` is the longest gap between two 10 ms timer ticks. */
export async function installHeartbeat(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const beat = { last: performance.now(), max: 0 };
    (window as unknown as { __beat: typeof beat }).__beat = beat;
    setInterval(() => {
      const now = performance.now();
      beat.max = Math.max(beat.max, now - beat.last);
      beat.last = now;
    }, 10);
  });
}

/** The longest time, in milliseconds, the main thread of the page went without running a 10 ms timer. */
export function longestStall(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __beat: { max: number } }).__beat.max);
}

/** `promise`, or `"timeout"` when it has not settled after `ms` (a hung page never answers `page.evaluate`). */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A fresh browser context that serves the specs' fixtures (`baseURL` is the static server of global setup). */
export function newContext(browser: Browser): Promise<BrowserContext> {
  const baseURL = process.env["MTEK_SERVER_URL"];
  if (baseURL === undefined) throw new Error("MTEK_SERVER_URL is not set; run the tests through playwright.config.ts");
  return browser.newContext({ baseURL });
}

/** The text of the fixture's `src/main.mtek`. */
export function fixtureSource(name: string): string {
  return readFileSync(join(PREVIEW_FIXTURES_DIR, name, "src", "main.mtek"), "utf8");
}

/** The 1-based line and column of the first occurrence of `needle` in the fixture's source. */
export function locate(name: string, needle: string): { line: number; column: number } {
  const text = fixtureSource(name);
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`${name}: '${needle}' is not in the source`);
  const before = text.slice(0, at);
  const line = before.split("\n").length;
  return { line, column: at - (before.lastIndexOf("\n") + 1) + 1 };
}

/** `program.manifest.json` of a built fixture. */
export function manifestOf(name: string): { preview?: { loopBudget: number }; subsystems: { physics: boolean; physicsModule?: string }; spans: unknown[] } {
  return JSON.parse(readFileSync(join(PREVIEW_OUT_DIR, name, "program.manifest.json"), "utf8")) as ReturnType<typeof manifestOf>;
}
