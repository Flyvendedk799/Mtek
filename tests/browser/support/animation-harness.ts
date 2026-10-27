// Decision 0224: the shared page harness of the composable-animation specs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ANIMATION_URL } from "./animation-example.ts";
import { drive, type DriveArgs, type DriveResult, type Sample } from "./animation-drive.ts";
import { plan, type PatternName, type Step } from "./movement-drive.ts";

export const TARGET = { width: 160, height: 120 } as const;
export const RELEASED_COUNTERS = ["liveBuffers", "liveTextures", "livePipelines", "liveBindGroups", "liveShaderModules", "liveListeners", "physicsBodies", "physicsColliders"] as const;
/** The nodes the continuity and goal checks read from the Hero's figure (every node is read when `"all"`). */
export const TRACKED = ["Hips", "Spine1", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot", "LeftLeg", "RightLeg", "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg", "LeftArm", "RightArm", "Tail1", "Tail4", "Root"] as const;

export interface RunOptions {
  pattern?: PatternName;
  sample?: "every" | "boundary";
  seed?: number;
  model?: readonly string[] | "all";
  ghost?: readonly string[] | "all";
  guest?: readonly string[] | "all";
  final?: DriveArgs["final"];
  target?: { width: number; height: number };
}

/** Mounts the example on `page`, runs `steps` under a frame-time pattern, and checks what every run must satisfy. */
export async function run(page: Page, steps: readonly Step[], options: RunOptions = {}): Promise<DriveResult> {
  await page.goto(ANIMATION_URL);
  const result = await page.evaluate(drive, {
    frames: plan(steps, options.pattern ?? "tick", options.seed ?? 1),
    target: options.target ?? TARGET,
    sample: options.sample ?? "every",
    nodes: { model: options.model ?? TRACKED, ghost: options.ghost ?? TRACKED, guest: options.guest ?? [] },
    ...(options.final === undefined ? {} : { final: options.final }),
  });
  expect(result.diagnostics, "no runtime diagnostics").toEqual([]);
  expect(result.stateAfter).toBe("running");
  for (const key of RELEASED_COUNTERS) expect(result.disposed[key], `${key} after dispose`).toBe(0);
  return result;
}

/** Collects page errors and console errors of a test; `check()` asserts there are none. */
export function collectProblems(page: Page): { check(): void } {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  return { check: () => expect(problems, "no page errors and no console errors").toEqual([]) };
}

/** Writes a measurement record next to the run's results (`results/<run>/animation-composition/<name>.json`). */
export function writeProbe(name: string, record: unknown): void {
  const dir = join(process.env["MTEK_RESULTS_DIR"] ?? ".", "animation-composition");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}-${test.info().project.name}.json`), JSON.stringify(record, null, 1));
}

export const figure = (s: Sample, which: "model" | "ghost" | "guest", name: string): readonly [number, number, number] => {
  const v = s[which].nodes[name];
  if (v === undefined) throw new Error(`no node ${name} in ${which}`);
  return v;
};
