// scripts/game-budgets.mjs (decision 0137): the frame-evidence check refuses anything that is not hardware evidence
// of a game that ran, and every example directory needs a size budget.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./environment.ts";

interface GameBudgets {
  frameProblems(evidence: unknown): string[];
  missingBudgets(examples: string[], size?: Record<string, unknown>): string[];
  budgets: { size: Record<string, unknown> };
}
const script = (await import(pathToFileURL(join(REPO_ROOT, "scripts", "game-budgets.mjs")).href)) as GameBudgets;

const run = { frames: 600, p50Ms: 8.3, p95Ms: 9, maxMs: 12, failure: null as string | null };
function evidence(adapter: Record<string, unknown>, example: Record<string, unknown> = run): unknown {
  return { format: "mtek-frame-evidence/1", adapter, examples: { "lane-runner": example } };
}
const radeon = { vendor: "amd", architecture: "rdna-3", device: "", description: "Radeon RX 7900 XTX", isFallbackAdapter: false };

describe("game-budgets frames", () => {
  it("accepts a hardware adapter and a game that ran", () => {
    expect(script.frameProblems(evidence(radeon))).toEqual([]);
  });

  it("rejects an adapter that does not say whether it is a fallback", () => {
    expect(script.frameProblems(evidence({ ...radeon, isFallbackAdapter: null }))).toEqual([expect.stringContaining("does not say")]);
    const missing: Record<string, unknown> = { ...radeon };
    delete missing.isFallbackAdapter;
    expect(script.frameProblems(evidence(missing))).toEqual([expect.stringContaining("does not say")]);
  });

  it("rejects a fallback adapter", () => {
    expect(script.frameProblems(evidence({ ...radeon, isFallbackAdapter: true }))).toEqual([expect.stringContaining("software fallback")]);
  });

  it.each(["SwiftShader Device (Subzero)", "llvmpipe (LLVM 15)", "Microsoft Basic Render Driver"])("rejects the software description %s", (description) => {
    const problems = script.frameProblems(evidence({ ...radeon, vendor: "", architecture: "", description }));
    expect(problems).toEqual([expect.stringContaining("software renderer")]);
  });

  it("rejects an example whose game failed to run, and one with no failure field", () => {
    expect(script.frameProblems(evidence(radeon, { ...run, failure: "E5401 physics failed" }))).toEqual([expect.stringContaining("failed to run")]);
    const missing: Record<string, unknown> = { ...run };
    delete missing.failure;
    expect(script.frameProblems(evidence(radeon, missing))).toEqual([expect.stringContaining("failed to run")]);
  });

  it("rejects too few frames and a p95 over budget", () => {
    expect(script.frameProblems(evidence(radeon, { ...run, frames: 10 }))).toEqual([expect.stringContaining("frames <")]);
    expect(script.frameProblems(evidence(radeon, { ...run, p95Ms: 40 }))).toEqual([expect.stringContaining("p95")]);
  });
});

describe("game-budgets size", () => {
  it("reports an example directory without a budget entry", () => {
    expect(script.missingBudgets(["pulse-cube", "brand-new"], { "pulse-cube": {} })).toEqual([expect.stringContaining("brand-new")]);
  });

  it("has a budget for every directory under examples/", () => {
    const examples = readdirSync(join(REPO_ROOT, "examples"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(script.missingBudgets(examples, script.budgets.size)).toEqual([]);
  });
});
