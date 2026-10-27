import { test, expect } from "../../support/fixtures.ts";
import { writeRecord } from "../m4/configurator-support.ts";

test("the public compute example updates, detaches and recreates geometry without browser errors", async ({ page, gpu }) => {
  expect(gpu.available).toBe(true);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/compute/example/index.html");
  const status = page.locator("#status"); await expect(status).toHaveText("Live · compute geometry + shadows");
  await page.locator("#mode").selectOption("visible");
  await page.locator("#offset").fill("1.5"); await expect(page.locator("#offset-value")).toHaveText("1.5");
  await expect(status).toHaveText("Live · compute geometry + shadows");
  await page.screenshot({ path: test.info().outputPath("compute-example.png"), fullPage: true });
  await page.locator("#enabled").uncheck(); await expect(status).toHaveText("Original geometry");
  await page.locator("#enabled").check(); await expect(status).toHaveText("Live · compute geometry + shadows");
  await page.locator("#release").click(); await expect(status).toHaveText("Compute resources released");
  await page.locator("#enabled").check(); await expect(status).toHaveText("Live · compute geometry + shadows");
  // Release after requesting an update, then create a fresh owner.
  await page.locator("#offset").fill("-1.5"); await page.locator("#release").click();
  await expect(status).toHaveText("Compute resources released");
  await page.locator("#enabled").check(); await expect(status).toHaveText("Live · compute geometry + shadows");
  await expect(page.locator("#diagnostics")).toBeHidden(); expect(errors).toEqual([]);
  writeRecord(`compute-example-${test.info().project.name}.json`, { errors, changed: true, detached: true, recreated: true });
});
