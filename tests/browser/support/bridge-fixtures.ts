// Playwright fixtures of the bridge specs: `bridge` opens the bridge page (through the NOT-RUN
// aware `gpu` fixture, so a machine without an adapter reports NOT-RUN) and, after the test,
// fails it if the page saw an uncaptured GPU error or device loss, then destroys the GPU objects.
import type { TestInfo } from "@playwright/test";
import { type BridgeClient, openBridge } from "./bridge-driver.ts";
import { hashString, resolveSeed } from "./bridge-values.ts";
import { expect, test as gpuTest } from "./fixtures.ts";

interface BridgeFixtures {
  bridge: BridgeClient;
}

export const test = gpuTest.extend<BridgeFixtures>({
  bridge: async ({ page, gpu }, use) => {
    void gpu; // requested so the test is skipped as NOT-RUN without a WebGPU adapter
    const client = await openBridge(page);
    await use(client);
    const errors = await client.errors();
    await client.dispose();
    expect(errors, "uncaptured GPU errors or device loss during the test").toEqual([]);
  },
});

export { expect };

/**
 * The seed of one randomised test: the run's seed (`MTEK_TEST_SEED`, default fixed) mixed with the
 * test's label. It is recorded as a `seed` annotation so a failure can be reproduced.
 */
export function testSeed(testInfo: TestInfo, label: string): number {
  const seed = (resolveSeed(process.env) ^ hashString(label)) >>> 0;
  testInfo.annotations.push({ type: "seed", description: `${seed} (MTEK_TEST_SEED=${process.env["MTEK_TEST_SEED"] ?? "default"}, ${label})` });
  return seed;
}
