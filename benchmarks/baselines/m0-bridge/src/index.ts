// Browser entry: exposes the scenario to the Playwright spec as `window.mtekBaseline`.
import type { MixedParams } from "./mixed.ts";
import { createScenario, TARGET_SIZE, type MaterialName, type Scenario } from "./scenario.ts";

export interface BaselineApi {
  readonly targetSize: number;
  create(a: MixedParams, b: MixedParams): Promise<void>;
  /** Renders and returns the RGBA8 bytes of the render target as a plain array. */
  renderAndRead(): Promise<number[]>;
  update(which: MaterialName, params: Partial<MixedParams>): void;
  dispose(): Promise<void>;
}

declare global {
  interface Window {
    mtekBaseline: BaselineApi;
  }
}

let scenario: Scenario | null = null;

function current(): Scenario {
  if (scenario === null) throw new Error("create() has not been called");
  return scenario;
}

window.mtekBaseline = {
  targetSize: TARGET_SIZE,
  async create(a, b) {
    scenario = await createScenario(a, b);
  },
  async renderAndRead() {
    return [...(await current().renderAndRead())];
  },
  update(which, params) {
    current().update(which, params);
  },
  async dispose() {
    await current().dispose();
    scenario = null;
  },
};
