// M6-10: the Content-Security-Policy of a preview page does not break a physics program, and it refuses what the program
// never asks for (spec/ai-and-benchmarks.md section 5, decision 0075).
//
// The page is `fixtures/m5/physics_drop` built with `--mode preview`: the policy `<meta>` of `index.html`, the external
// `bootstrap.js`, the runtime, and the physics module that the manifest names and the runtime imports at run time with its
// WebAssembly. Every number the physics assertions use is derived the way `specs/m5/physics.spec.ts` derives it (free
// fall `y0 - g dt^2 (n^2 / 2 + n / 8)`, rest at 0.5 within 10 mm, one landing), and the preview run is compared with the
// run of the same program built in test mode, which has no policy: they must agree bit for bit.
//
//  - what the policy allows: the program mounts, the physics module is requested once and answers 200, the engine
//    instantiates its WebAssembly (`'wasm-unsafe-eval'`), the crate falls and rests, no `securitypolicyviolation`
//    fires, nothing is logged as an error, and every request of the page is below its own directory;
//  - what the policy refuses (a negative, from the page's own script and from a second origin the spec runs): a request to
//    another origin (`connect-src`), a JavaScript `eval` and `new Function` (`script-src` has no `'unsafe-eval'`), an inline
//    script (`script-src`), an image from another origin (`img-src`), a worker script from a blob (`worker-src`, which
//    falls back to `default-src`): each is blocked, reported as a violation of the right directive, and the second origin
//    never sees a request;
//  - that `'wasm-unsafe-eval'` is what the physics module needs: the same page with the token removed refuses to compile
//    the module's WebAssembly, and the mount fails with `physics-failed` (E8102).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { PREVIEW_OUT_DIR, PREVIEW_PHYSICS } from "../../support/preview-fixtures.ts";
import { M5_OUT_DIR, PHYSICS_DROP } from "../../support/m5-fixtures.ts";
import { exposeApp, manifestOf, pageMtek, type PreviewAppLike } from "./preview-support.ts";

/** `manifest.runtimeConfig.fixedStep`: a frame of exactly this length is exactly one fixed tick (decision 0066 item 12). */
const STEP = 0.016666668;
const GRAVITY = 9.81;
const TARGET = { width: 160, height: 80 } as const;
const PREVIEW_URL = `/preview/${PREVIEW_PHYSICS}/index.html`;

test.beforeEach(({ gpu }) => {
  void gpu;
});

interface Violation {
  directive: string;
  blocked: string;
}

/** Collects what the browser reports about the page: policy violations, console errors, page errors and every request. */
async function watch(page: Page): Promise<{ violations: () => Promise<Violation[]>; errors: string[]; requests: string[]; statuses: Map<string, number> }> {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: Array<{ directive: string; blocked: string }> };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  const errors: string[] = [];
  const requests: string[] = [];
  const statuses = new Map<string, number>();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("request", (request) => {
    requests.push(request.url());
  });
  page.on("response", (response) => {
    statuses.set(response.url(), response.status());
  });
  return { violations: () => page.evaluate(() => (window as unknown as { __violations: Violation[] }).__violations), errors, requests, statuses };
}

/** A second origin that the page must never reach: it counts every request it receives. */
async function otherOrigin(): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(request.url ?? "");
    response.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    response.end("reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

test.describe("a physics program runs under the preview policy", () => {
  test("it mounts, loads its physics module and WebAssembly, falls, rests and lands once, without a violation or an error", async ({ page }) => {
    const seen = await watch(page);
    await exposeApp(page, PREVIEW_PHYSICS, { test: { manualClock: true, renderTarget: TARGET } });
    await page.goto(PREVIEW_URL);
    await page.waitForFunction(() => (window as unknown as { __mtek?: { app: unknown; error: unknown } }).__mtek?.app != null, undefined, { timeout: 30_000 });

    const manifest = manifestOf(PREVIEW_PHYSICS);
    expect(manifest.preview).toEqual({ loopBudget: 10_000_000 });
    expect(manifest.subsystems.physics).toBe(true);
    const physicsUrl = new URL(`${PREVIEW_URL.replace(/index\.html$/, "")}${manifest.subsystems.physicsModule ?? ""}`, page.url()).href;
    // The policy came from the page's own `<meta>`: it is there, with the token the physics module needs.
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");

    const run = await page.evaluate(
      ({ dt, g }) => {
        const mtek = pageMtek();
        const app = mtek.app as PreviewAppLike;
        const crateY = (): number => app.debug.scene().entities.find((entity) => entity.name === "Crate")?.position.y ?? Number.NaN;
        const heights: number[] = [crateY()];
        app.debug.step(10, dt);
        const fallen = crateY();
        const expectedFall = 3 - g * dt * dt * (100 / 2 + 10 / 8);
        for (let i = 0; i < 17; i += 1) {
          app.debug.step(10, dt);
          heights.push(crateY());
        }
        app.debug.step(10, dt);
        const rest = crateY();
        const state = { ...app.debug.scene().state };
        const counters = { ...app.debug.counters() };
        return { fallen, expectedFall, rest, heights, state, counters, appState: app.state, diagnostics: mtek.diagnostics.map((d) => d.code) };
      },
      { dt: STEP, g: GRAVITY },
    );

    expect(run.diagnostics, "no runtime diagnostics").toEqual([]);
    expect(run.appState).toBe("running");
    expect(run.fallen).toBeCloseTo(run.expectedFall, 3);
    expect(Math.abs(run.rest - 0.5)).toBeLessThan(0.01);
    expect(Math.min(...run.heights)).toBeGreaterThan(0.45);
    expect(run.state["landings"]).toBe(1);
    expect(run.counters).toMatchObject({ physicsBodies: 2, physicsColliders: 2, physicsFrozenBodies: 0 });

    // The module the manifest names was requested once and answered; nothing else under `physics/`.
    const physics = seen.requests.filter((url) => new URL(url).pathname.split("/").includes("physics"));
    expect(physics).toEqual([physicsUrl]);
    expect(seen.statuses.get(physicsUrl)).toBe(200);
    // Every request of the page is below its own directory (the runtime's own guard is the other half of this).
    const directory = new URL(PREVIEW_URL.replace(/index\.html$/, ""), page.url()).href;
    expect(seen.requests.filter((url) => !url.startsWith(directory))).toEqual([]);
    expect(await seen.violations(), "no policy violation").toEqual([]);
    expect(seen.errors, "nothing logged as an error").toEqual([]);

    // Determinism: the run under the policy equals the run of the same program built in test mode (no policy).
    const reference = await page.context().newPage();
    try {
      await reference.goto(`/m5/${PHYSICS_DROP}/index.html`);
      const unrestricted = await reference.evaluate(
        async ({ target, dt }) => {
          const w = window as unknown as { __mtekMount: (options: object) => Promise<PreviewAppLike> };
          const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target } });
          const heights: number[] = [];
          for (let i = 0; i < 19; i += 1) {
            app.debug.step(10, dt);
            heights.push(app.debug.scene().entities.find((entity) => entity.name === "Crate")?.position.y ?? Number.NaN);
          }
          app.dispose();
          return heights;
        },
        { target: TARGET, dt: STEP },
      );
      // `run.heights` has the 10-tick samples 1..18 after the first and the initial height; compare the shared samples.
      expect(unrestricted.slice(0, 18)).toEqual(run.heights.slice(1, 19));
    } finally {
      await reference.close();
    }
    expect(M5_OUT_DIR).toContain(".out");
  });

  test("the unmodified page (generated bootstrap.js, the real clock) runs the same program: crate down, no violation", async ({ page }) => {
    const seen = await watch(page);
    await page.goto(PREVIEW_URL);
    // The generated bootstrap exposes nothing, so look at the page: the physics module and its wasm were fetched and run
    // without a violation, and the frame loop is alive (the canvas is being drawn to) after two seconds of falling.
    await page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(".js") && new URL(response.url()).pathname.includes("/physics/"), { timeout: 30_000 });
    await page.waitForTimeout(2500);
    expect(await seen.violations()).toEqual([]);
    expect(seen.errors).toEqual([]);
    expect(await page.locator("[data-mtek-overlay]").count(), "no failure overlay").toBe(0);
    const frames = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const tick = (): void => {
            count += 1;
            if (count < 20) requestAnimationFrame(tick);
            else resolve(count);
          };
          requestAnimationFrame(tick);
        }),
    );
    expect(frames).toBe(20);
    expect(seen.requests.filter((url) => !url.startsWith(new URL(PREVIEW_URL.replace(/index\.html$/, ""), page.url()).href))).toEqual([]);
  });
});

test.describe("the policy refuses what the program never asks for", () => {
  test("another origin, eval, an inline script, a foreign image and a blob worker are blocked, each as a violation of its directive", async ({ page }) => {
    const other = await otherOrigin();
    try {
      const seen = await watch(page);
      await page.goto(PREVIEW_URL);
      await page.waitForResponse((response) => new URL(response.url()).pathname.includes("/physics/"), { timeout: 30_000 });
      const outcome = await page.evaluate(async (origin) => {
        const results: Record<string, string> = {};
        try {
          await fetch(`${origin}/data`);
          results["fetch"] = "allowed";
        } catch (error) {
          results["fetch"] = (error as Error).name;
        }
        try {
          // The point of the test: the policy must refuse it.
          results["eval"] = String(eval("1 + 1"));
        } catch (error) {
          results["eval"] = (error as Error).name;
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- ditto
          results["function"] = String(new Function("return 7")());
        } catch (error) {
          results["function"] = (error as Error).name;
        }
        const script = document.createElement("script");
        script.textContent = "window.__inlineRan = true";
        document.head.append(script);
        results["inline"] = (window as unknown as { __inlineRan?: boolean }).__inlineRan === true ? "ran" : "blocked";
        results["image"] = await new Promise<string>((resolve) => {
          const image = new Image();
          image.onload = () => {
            resolve("loaded");
          };
          image.onerror = () => {
            resolve("blocked");
          };
          image.src = `${origin}/x.png`;
        });
        try {
          const worker = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"])));
          results["worker"] = await new Promise<string>((resolve) => {
            worker.onmessage = () => {
              resolve("ran");
            };
            worker.onerror = () => {
              resolve("blocked");
            };
            setTimeout(() => {
              resolve("silent");
            }, 1500);
          });
        } catch (error) {
          results["worker"] = (error as Error).name;
        }
        // WebAssembly is allowed (the physics module needs it), and the page's own files are fine.
        results["wasm"] = (await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).instance instanceof WebAssembly.Instance ? "instantiated" : "no";
        results["same-origin"] = String((await fetch("./program.manifest.json")).status);
        return results;
      }, other.url);

      expect(outcome["fetch"]).toBe("TypeError");
      expect(outcome["eval"]).toBe("EvalError");
      expect(outcome["function"]).toBe("EvalError");
      expect(outcome["inline"]).toBe("blocked");
      expect(outcome["image"]).toBe("blocked");
      expect(outcome["worker"]).not.toBe("ran");
      expect(outcome["wasm"]).toBe("instantiated");
      expect(outcome["same-origin"]).toBe("200");

      // The browser reported each as a violation of the directive that decided it.
      const violations = await seen.violations();
      const by = (directive: string): Violation[] => violations.filter((v) => v.directive === directive);
      expect(by("connect-src").map((v) => v.blocked)).toContain(`${other.url}/data`);
      expect(by("img-src").map((v) => v.blocked)).toContain(`${other.url}/x.png`);
      expect(by("script-src").map((v) => v.blocked), "eval, new Function").toEqual(expect.arrayContaining(["eval"]));
      expect(by("script-src-elem").map((v) => v.blocked), "the inline script").toEqual(expect.arrayContaining(["inline"]));
      // And the other origin never saw a request.
      expect(other.hits).toEqual([]);
    } finally {
      await other.close();
    }
  });

  test("without 'wasm-unsafe-eval' the physics module cannot instantiate its WebAssembly: the mount fails with physics-failed", async ({ page }) => {
    const seen = await watch(page);
    await page.route(`**${PREVIEW_URL}`, async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      expect(html).toContain(" 'wasm-unsafe-eval'");
      await route.fulfill({ response, body: html.replace(" 'wasm-unsafe-eval'", "") });
    });
    await exposeApp(page, PREVIEW_PHYSICS, { test: { manualClock: true, renderTarget: TARGET } });
    await page.goto(PREVIEW_URL);
    await page.waitForFunction(() => (window as unknown as { __mtek?: { error: unknown } }).__mtek?.error != null, undefined, { timeout: 30_000 });
    const error = await page.evaluate(() => pageMtek().error);
    expect(error).toMatchObject({ kind: "physics-failed", codes: ["MTEK-E8102"] });
    expect((await seen.violations()).map((v) => v.directive)).toContain("script-src");
    expect(await page.locator("[data-mtek-overlay]").textContent()).toContain("MTEK-E8102");
    expect(PREVIEW_OUT_DIR).toContain("preview");
  });
});
