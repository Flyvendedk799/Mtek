/**
 * M6-11: the browser half of the new-user walkthrough (`docs/getting-started.md`, decision 0091).
 *
 * `crates/mtek-cli/tests/getting_started.rs` follows the document's commands and checks the text the tool prints; it opens no
 * browser. This spec takes the document's edit, break and fix (its `diff` blocks) and its overlay text and runs them against a
 * real page served by `mtek dev` from a project created by `mtek new`:
 *
 * - the page runs, and the `edit` makes the cube wider without reloading the page (hot reload);
 * - the document's claim about state: a changed initial value of `state speed` does not reach the running scene (the cube keeps
 *   turning), and does after a reload (it stands still);
 * - the `break` shows the overlay, and its text is exactly the document's overlay block;
 * - the `fix` removes the overlay, again without a reload.
 *
 * Needs a WebGPU adapter (`gpu` fixture; NOT-RUN without one, never a silent pass). The cube's size is read from screenshots:
 * the extent of the pixels that are not the (black) background, with the statistics panel hidden.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { cliPath } from "../../support/m1-fixtures.ts";

interface Fence {
  info: string;
  body: string[];
}

/** The fenced blocks of a Markdown document (three backticks at the start of a line, possibly indented). */
function fences(markdown: string): Fence[] {
  const result: Fence[] = [];
  let open: { info: string; indent: number; body: string[] } | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (open !== undefined) {
      if (trimmed.trimEnd() === "```") {
        result.push({ info: open.info, body: open.body });
        open = undefined;
      } else {
        open.body.push(line.slice(Math.min(open.indent, line.length)));
      }
    } else if (trimmed.startsWith("```") && !trimmed.startsWith("````")) {
      open = { info: trimmed.slice(3).trim(), indent: line.length - trimmed.length, body: [] };
    }
  }
  return result;
}

/** Applies a `diff` block: the lines it removes and keeps must occur once; they are replaced by the lines it adds and keeps. */
function applyDiff(text: string, body: readonly string[]): string {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of body) {
    const mark = line.charAt(0);
    if (mark === "-") removed.push(line.slice(1));
    else if (mark === "+") added.push(line.slice(1));
    else if (mark === " " || mark === "") {
      removed.push(line.slice(1));
      added.push(line.slice(1));
    } else throw new Error(`bad diff line: ${line}`);
  }
  const old = `${removed.join("\n")}\n`;
  const count = text.split(old).length - 1;
  if (count !== 1) throw new Error(`the diff's old text must occur once, found ${String(count)}:\n${old}`);
  return text.replace(old, () => `${added.join("\n")}\n`);
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });
}

/** Horizontal extent in pixels of what is not background, from a screenshot of the page. */
async function cubeWidth(page: Page): Promise<number> {
  const png = (await page.screenshot()).toString("base64");
  return await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = Number.POSITIVE_INFINITY;
    let right = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const at = (y * canvas.width + x) * 4;
        if ((pixels[at] ?? 0) + (pixels[at + 1] ?? 0) + (pixels[at + 2] ?? 0) > 30) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    return right < 0 ? 0 : right - left;
  }, png);
}

/** Widths of `count` screenshots, `gapMs` apart. */
async function widths(page: Page, count: number, gapMs: number): Promise<number[]> {
  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push(await cubeWidth(page));
    await page.waitForTimeout(gapMs);
  }
  return result;
}

const overlayText = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.getElementById("mtek-dev-overlay")?.textContent ?? null);

/** Preserve presentation and runtime evidence without replacing the original test failure if the page has closed. */
async function attachFailureDiagnostics(page: Page, testInfo: TestInfo, browserMessages: readonly string[], devOutput: string): Promise<void> {
  const [screenshot, state] = await Promise.allSettled([
    page.screenshot({ timeout: 5000 }),
    page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const panel = document.querySelector("[data-mtek-dev-overlay]");
      const bounds = canvas?.getBoundingClientRect();
      return {
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        devicePixelRatio: window.devicePixelRatio,
        navigatorGpu: navigator.gpu !== undefined,
        canvas: canvas === null ? null : {
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight,
          bounds: bounds?.toJSON() as unknown,
          display: getComputedStyle(canvas).display,
          visibility: getComputedStyle(canvas).visibility,
        },
        buildOverlay: document.getElementById("mtek-dev-overlay")?.textContent ?? null,
        runtimeOverlay: document.querySelector("[data-mtek-overlay]")?.textContent ?? null,
        devPanel: panel?.textContent ?? null,
        devPanelDisplay: panel === null ? null : getComputedStyle(panel).display,
      };
    }),
  ]);
  if (screenshot.status === "fulfilled") {
    await testInfo.attach("getting-started-page", { body: screenshot.value, contentType: "image/png" });
  }
  await testInfo.attach("getting-started-diagnostics", {
    body: JSON.stringify({
      url: page.url(),
      browserVersion: page.context().browser()?.version() ?? null,
      browserMessages,
      devOutput,
      page: state.status === "fulfilled" ? state.value : { captureError: String(state.reason) },
      screenshotError: screenshot.status === "rejected" ? String(screenshot.reason) : null,
    }, null, 2),
    contentType: "application/json",
  });
}

test.describe("getting started (docs/getting-started.md), in a browser", () => {
  test("edit, break and fix of the document on a real page", async ({ page, gpu }, testInfo) => {
    void gpu;
    test.setTimeout(240_000);
    const doc = fences(readFileSync(join(REPO_ROOT, "docs", "getting-started.md"), "utf8"));
    const diff = (role: string): string[] => {
      const found = doc.filter((f) => f.info.startsWith("diff") && f.info.includes(`role=${role}`));
      if (found.length !== 1) throw new Error(`the document needs exactly one diff with role=${role}`);
      return found[0]?.body ?? [];
    };
    const overlayBlock = doc.filter((f) => f.info.split(/\s+/).includes("overlay"));
    expect(overlayBlock).toHaveLength(1);
    const documentedOverlay = (overlayBlock[0]?.body ?? []).join("\n");

    const work = mkdtempSync(join(tmpdir(), "mtek-getting-started-"));
    let dev: ChildProcess | undefined;
    let printed = "";
    const browserMessages: string[] = [];
    page.on("console", (message) => {
      browserMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      browserMessages.push(`pageerror: ${error.message}`);
    });
    try {
      const cli = cliPath();
      execFileSync(cli, ["new", "hello-mtek"], { cwd: work, stdio: "pipe", windowsHide: true });
      const project = join(work, "hello-mtek");
      const source = join(project, "src", "main.mtek");
      const original = readFileSync(source, "utf8");
      const port = await freePort();
      dev = spawn(cli, ["dev", "--port", String(port)], { cwd: project, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      dev.stdout?.on("data", (chunk: Buffer) => {
        printed += chunk.toString();
      });
      dev.stderr?.on("data", (chunk: Buffer) => {
        printed += chunk.toString();
      });
      await expect.poll(() => printed, { timeout: 60_000, message: "mtek dev did not finish its first build" }).toMatch(/^built /m);
      const url = /mtek dev: serving (http:\/\/127\.0\.0\.1:\d+\/)/.exec(printed)?.[1];
      if (url === undefined) throw new Error(`no serving line in:\n${printed}`);

      let navigations = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations += 1;
      });
      const edit = (text: string): void => {
        writeFileSync(source, text);
      };

      await page.setViewportSize({ width: 800, height: 600 });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector("canvas") !== null);
      await page.waitForTimeout(1500);
      await page.keyboard.press("`"); // hide the statistics panel
      await page.waitForTimeout(300);
      expect(await overlayText(page)).toBeNull();
      const before = await widths(page, 8, 150);
      expect(Math.max(...before), "the cube is on the page").toBeGreaterThan(20);

      // Section 7: the edit, hot reloaded.
      const edited = applyDiff(original, diff("edit"));
      edit(edited);
      await expect
        .poll(async () => Math.max(...(await widths(page, 4, 100))), { timeout: 30_000, message: "the cube did not get wider" })
        .toBeGreaterThan(Math.max(...before) * 1.25);
      expect(navigations, "the edit did not reload the page").toBe(1);

      // The state remark of section 7.
      edit(edited.replace("state speed: f32 = 0.7;", "state speed: f32 = 0.0;"));
      await page.waitForTimeout(2500);
      await expect
        .poll(
          async () => {
            const turning = await widths(page, 8, 200);
            return Math.max(...turning) - Math.min(...turning);
          },
          { timeout: 30_000, message: "the cube does not keep turning after the edit of the initial speed" },
        )
        .toBeGreaterThan(8);
      expect(navigations).toBe(1);
      await page.reload(); // the file still says 0.0: the new scene starts from it
      await page.waitForTimeout(1500);
      await page.keyboard.press("`");
      await page.waitForTimeout(300);
      const still = await widths(page, 6, 200);
      expect(Math.max(...still) - Math.min(...still), "after a reload the cube stands still").toBeLessThanOrEqual(2);
      edit(edited);
      await page.waitForTimeout(2500);

      // Section 8 and 9: the break, the overlay of the document.
      navigations = 0;
      edit(applyDiff(edited, diff("break")));
      await expect.poll(() => overlayText(page), { timeout: 30_000, message: "no overlay after the break" }).not.toBeNull();
      expect(await overlayText(page)).toBe(documentedOverlay);
      expect(navigations, "the break did not reload the page").toBe(0);

      // Section 10: the fix.
      edit(applyDiff(applyDiff(edited, diff("break")), diff("fix")));
      await expect.poll(() => overlayText(page), { timeout: 30_000, message: "the overlay did not go away" }).toBeNull();
      expect(navigations, "the fix did not reload the page").toBe(0);
      const after = await widths(page, 8, 150);
      expect(Math.max(...after), "the wide cube is still on the page").toBeGreaterThan(Math.max(...before) * 1.25);
    } catch (error) {
      try {
        await attachFailureDiagnostics(page, testInfo, browserMessages, printed);
      } catch {
        // A closed page or failed attachment must not hide the assertion that failed.
      }
      throw error;
    } finally {
      if (dev !== undefined) {
        dev.kill();
        await new Promise((done) => setTimeout(done, 300));
      }
      rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});
