import type { Page } from "@playwright/test";
import type { MtekApp, MtekMountOptions } from "../../../../packages/runtime-web/src/runtime.js";
import { expect, test } from "../../support/fixtures.ts";
import { PRODUCT_HOST_URL, PRODUCT_RELEASE_URL } from "../../support/product-configurator.ts";

type Host = Window & { mtekApp?: MtekApp; mtekHostOptions?: MtekMountOptions; retired?: MtekApp | undefined };
async function step(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = (window as Host).mtekApp;
    if (!app?.debug) throw new Error("test-mode app did not mount");
    app.debug.step(1, 1 / 60);
  });
}
async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as Host).mtekHostOptions = { devicePixelRatio: 1, test: { manualClock: true, renderTarget: { width: 480, height: 400 } } };
  });
  await page.goto(PRODUCT_HOST_URL);
  await page.waitForFunction(() => (window as Host).mtekApp?.state === "running");
  await step(page);
}

test.describe("a production-style embedded product configurator", () => {
  test("the release embed works without the debug API", async ({ page, gpu }, testInfo) => {
    void gpu;
    await page.goto(PRODUCT_RELEASE_URL);
    await expect(page.locator("#preview-status")).toHaveText("Live 3D preview");
    expect(await page.evaluate(() => (window as Host).mtekApp?.debug)).toBeUndefined();
    await page.getByRole("button", { name: "Warm clay", exact: true }).click();
    await expect(page.locator("#total-price")).toHaveText("$380");
    await page.locator("#mtek").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#finish-name")).toHaveText("Midnight");
    await expect(page.locator("#total-price")).toHaveText("$400");
    await testInfo.attach("product-configurator", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });

  test("typed host inputs and scene outputs agree; two complete assemblies keep independent state", async ({ page, gpu }) => {
    void gpu;
    await open(page);
    await expect(page.locator("#total-price")).toHaveText("$340");
    const before = await page.evaluate(async () => {
      const debug = (window as Host).mtekApp?.debug;
      if (!debug) throw new Error("no debug");
      return { counters: debug.counters(), pixels: Array.from((await debug.readPixels()).data) };
    });
    await page.getByRole("button", { name: "Warm clay", exact: true }).click();
    await page.getByRole("button", { name: /Walnut/ }).click();
    await page.locator("#quantity").fill("3");
    await page.locator("#quantity").dispatchEvent("change");
    await step(page);
    await expect(page.locator("#total-price")).toHaveText("$1,245");
    await expect(page.locator("#configuration")).toHaveText("3 × Warm clay / Walnut");
    const snapshot = await page.evaluate(async () => {
      const debug = (window as Host).mtekApp?.debug;
      if (!debug) throw new Error("no debug");
      const image = await debug.readPixels();
      return { scene: debug.scene(), counters: debug.counters(), pixels: Array.from(image.data) };
    });
    expect(snapshot.scene.entities).toHaveLength(19); // 3 room entities + 2 × (root + seven parts)
    const names = snapshot.scene.entities.map(entity => entity.name);
    expect(names).toContain("YourChair.Seat");
    expect(names).toContain("Reference.Seat");
    expect(names).toContain("YourChair");
    expect(names).toContain("Reference");
    // A real rendered image, rather than only successful state updates or a clear-color canvas.
    expect(new Set(snapshot.pixels.filter((_, index) => index % 4 !== 3)).size).toBeGreaterThan(20);
    const changed = snapshot.pixels.filter((value, index) => index % 4 !== 3 && Math.abs(value - (before.pixels[index] ?? value)) > 3).length;
    expect(changed, "fabric and frame bindings change visible pixels").toBeGreaterThan(100);
    for (const key of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated"]) {
      expect(before.counters[key], key).toBeDefined();
      expect(snapshot.counters[key], key).toBe(before.counters[key]);
    }
  });

  test("scene keyboard selection updates the website; form keys stay with the form", async ({ page, gpu }) => {
    void gpu;
    await open(page);
    await page.locator("#mtek").focus();
    await page.keyboard.press("ArrowRight");
    await step(page);
    await expect(page.locator("#finish-name")).toHaveText("Warm clay");
    await expect(page.locator("#total-price")).toHaveText("$380");
    await page.keyboard.press("Space");
    await step(page);
    await expect(page.locator("#rotate")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#quantity").focus();
    await page.keyboard.press("ArrowRight");
    await step(page);
    await expect(page.locator("#finish-name")).toHaveText("Warm clay");
    // A key pressed on canvas may be released after focus has moved into the website.
    await page.locator("#mtek").focus();
    await page.keyboard.down("ArrowRight");
    await step(page);
    await expect(page.locator("#finish-name")).toHaveText("Midnight");
    await page.locator("#quantity").focus();
    await page.keyboard.up("ArrowRight");
    await step(page);
    await page.locator("#mtek").focus();
    await page.keyboard.press("ArrowRight");
    await step(page);
    await expect(page.locator("#finish-name")).toHaveText("Sea glass");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await step(page);
    await expect(page.locator("#total-price")).toHaveText("$340");
    await expect(page.locator("#rotate")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#rotate").click();
    await page.locator("#rotate").click();
    await step(page);
    await expect(page.locator("#rotate")).toHaveAttribute("aria-pressed", "false");
  });

  test("closing disposes; repeated reopen preserves configuration without duplicate listeners", async ({ page, gpu }) => {
    void gpu;
    await open(page);
    await page.getByRole("button", { name: "Midnight", exact: true }).click();
    await step(page);
    const baseline = await page.evaluate(() => (window as Host).mtekApp?.debug?.counters()["liveListeners"]);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await page.evaluate(() => { (window as Host).retired = (window as Host).mtekApp; });
      // Space retains native button activation instead of reaching the scene's Space handler.
      await page.locator("#preview-toggle").focus();
      await page.keyboard.press("Space");
      expect(await page.evaluate(() => (window as Host).retired?.state)).toBe("disposed");
      await expect(page.locator("#preview-placeholder")).toBeVisible();
      await page.locator("#open-preview").focus();
      await page.keyboard.press("Space");
      await page.waitForFunction(() => (window as Host).mtekApp?.state === "running");
      await step(page);
      await expect(page.locator("#total-price")).toHaveText("$400");
      await expect(page.locator("#rotate")).toHaveAttribute("aria-pressed", "false");
      expect(await page.evaluate(() => (window as Host).mtekApp?.debug?.counters()["liveListeners"])).toBe(baseline);
    }
    await page.locator("#mtek").focus();
    await page.keyboard.press("ArrowRight");
    await step(page);
    await expect(page.locator("#finish-name")).toHaveText("Sea glass");
  });

  test("closing and reopening during a pending mount cannot lose the new canvas context", async ({ page, gpu }) => {
    void gpu;
    let releaseManifest: () => void = () => {};
    let sawManifest: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseManifest = resolve; });
    const requested = new Promise<void>(resolve => { sawManifest = resolve; });
    let intercepted = false;
    await page.route("**/product-configurator/dist/program.manifest.json", async route => {
      if (!intercepted) { intercepted = true; sawManifest(); await gate; }
      await route.continue();
    });
    await page.addInitScript(() => {
      // Exercise the live GPUCanvasContext, not the offscreen readPixels target.
      (window as Host).mtekHostOptions = { test: { manualClock: true } };
    });
    await page.goto(PRODUCT_HOST_URL);
    await requested;
    try {
      await page.locator("#preview-toggle").click();
      await page.locator("#open-preview").click();
    } finally { releaseManifest(); }
    await page.waitForFunction(() => (window as Host).mtekApp?.state === "running");
    await step(page);
    await expect(page.locator("#preview-status")).toHaveText("Live 3D preview");
    await expect(page.locator("#total-price")).toHaveText("$340");
    expect(await page.evaluate(() => (window as Host).mtekApp?.state)).toBe("running");
    expect(await page.evaluate(() => (window as Host).mtekApp?.debug?.counters()["framesRendered"])).toBeGreaterThan(0);
    await expect(page.locator("#status")).toBeEmpty();
  });

  test("a terminal runtime failure disables controls and permits an explicit restart", async ({ page, gpu }) => {
    void gpu;
    await open(page);
    await page.evaluate(() => (window as Host).mtekApp?.debug?.failAllocation());
    await expect(page.locator("#preview-status")).toHaveText("Preview unavailable");
    expect(await page.locator("#controls").evaluate(form => (form as HTMLFormElement).inert)).toBe(true);
    await page.locator("#preview-toggle").click();
    await page.locator("#open-preview").click();
    await page.waitForFunction(() => (window as Host).mtekApp?.state === "running");
    await step(page);
    await expect(page.locator("#preview-status")).toHaveText("Live 3D preview");
    await expect(page.locator("#status")).toBeEmpty();
  });

});
