/**
 * The cap on live timers (decision 0177, `W8205`): a timer started every frame, which the compiler warns about (`W5301`),
 * cannot grow the list without bound.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { resolveStructure } from "./structure.js";
import { MAX_TIMERS, TimerList } from "./timers.js";
import { World } from "./world.js";

const alive = (): boolean => true;

describe("TimerList cap", () => {
  it("starts timers up to the cap and reports the rest", () => {
    const full: number[] = [];
    const list = new TimerList((spanId) => full.push(spanId));
    for (let i = 0; i < MAX_TIMERS; i += 1) list.every(1, () => undefined, null, 7);
    expect(list.size).toBe(MAX_TIMERS);
    expect(full).toEqual([]);
    list.every(1, () => undefined, null, 7);
    list.after(1, () => undefined, null, 9);
    expect(list.size).toBe(MAX_TIMERS);
    expect(full).toEqual([7, 9]);
  });

  it("starts timers again once some have run", () => {
    const list = new TimerList();
    for (let i = 0; i < MAX_TIMERS; i += 1) list.after(0.5, () => undefined, null, 1);
    list.advance(1, alive);
    expect(list.size).toBe(0);
    list.after(1, () => undefined, null, 1);
    expect(list.size).toBe(1);
  });
});

describe("World and W8205", () => {
  it("reports a capped call site once and keeps running", () => {
    const parsed = checkManifest(minimalManifestJson());
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.failures));
    const structure = resolveStructure(parsed.manifest);
    if (!structure.ok) throw new Error(JSON.stringify(structure.diagnostics));
    const reported: MtekDiagnostic[] = [];
    const world = new World({
      manifest: parsed.manifest,
      structure: structure.structure,
      params: { writeParam: () => undefined },
      report: (diagnostic) => reported.push(diagnostic),
    });
    const ctx = world.ctx as unknown as { every(seconds: number, fn: () => void, owner: null, spanId: number): void };
    for (let i = 0; i < MAX_TIMERS + 10; i += 1) ctx.every(1, () => undefined, null, -1);
    expect(world.timers.size).toBe(MAX_TIMERS);
    expect(reported.map((d) => d.code)).toEqual(["MTEK-W8205"]);
  });
});
