// Decision 0175: a pause menu in a real browser. The fixture (`fixtures/m6/pause_menu`) counts the frames `update` ran (`ticks`) and
// the frames `ui` ran (`ui_frames`); Escape pauses the game, and its `ui` draws the "Paused" text and a "Resume" button.
//
//   running   `update` and `ui` both run, no menu is on the page
//   paused    `update` stands still (`ticks` does not move), `ui` goes on, the HUD layer shows the menu
//   clicking  a real click on the button is heard by the next frame, which resumes the game: `update` runs again
//             and the menu is gone
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";

interface AppLike {
  debug: { pressKey(code: string): void; releaseKey(code: string): void; step(frames: number, dt: number): void; scene(): { state: Record<string, number> } };
  dispose(): void;
}

const state = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => (window as unknown as { __app: AppLike }).__app.debug.scene().state);

const step = (page: Page, frames: number): Promise<void> =>
  page.evaluate((count) => {
    (window as unknown as { __app: AppLike }).__app.debug.step(count, 1 / 60);
  }, frames);

test.describe("a pause menu drawn by ui(dt) (decision 0175)", () => {
  test("keeps the HUD up while paused and a click on Resume resumes the game", async ({ page, gpu }) => {
    void gpu;
    await page.goto("/m6/pause_menu/index.html");
    const reported = await page.evaluate(async () => {
      const w = window as unknown as { __mtekMount(options: object): Promise<AppLike>; __app: AppLike; __reported: string[] };
      w.__reported = [];
      w.__app = await w.__mtekMount({
        test: { manualClock: true, renderTarget: { width: 64, height: 64 } },
        onDiagnostic: (d: { code: string }) => {
          w.__reported.push(d.code);
        },
      });
      return w.__reported;
    });
    expect(reported).toEqual([]);

    await step(page, 3);
    const running = await state(page);
    expect(running["ticks"]).toBe(3);
    expect(running["ui_frames"]).toBe(3);
    await expect(page.locator("[data-mtek-hud-button]")).toHaveCount(0);

    // Escape pauses: the next frames run `ui` only.
    await page.evaluate(() => {
      (window as unknown as { __app: AppLike }).__app.debug.pressKey("Escape");
    });
    await step(page, 4);
    const paused = await state(page);
    expect(paused["ticks"]).toBe(3);
    expect(paused["ui_frames"]).toBe(7);
    const resume = page.locator("[data-mtek-hud-button]", { hasText: "Resume" });
    await expect(resume).toBeVisible();
    await expect(page.locator("[data-mtek-hud-text]", { hasText: "Paused" })).toBeVisible();

    // The button is on the page for as long as the game is held, and nothing resumes it by itself.
    await step(page, 5);
    expect((await state(page))["ticks"]).toBe(3);
    await expect(resume).toBeVisible();

    await resume.click();
    await step(page, 1);
    // The frame that hears the click resumes the game; the frames after it update again and no longer draw the menu.
    await step(page, 3);
    const after = await state(page);
    expect(after["resumed"]).toBe(1);
    expect(after["ticks"]).toBeGreaterThan(3);
    await expect(page.locator("[data-mtek-hud-button]")).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __app: AppLike }).__app.dispose();
    });
  });
});
