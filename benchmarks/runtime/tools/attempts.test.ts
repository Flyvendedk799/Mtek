import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, chooseAttempts, groupAttempts, needsRetry, preferredAttempt } from "./attempts.ts";
import { DISTURBED_DURING_PERCENT, isDisturbed } from "./host-load.ts";
import type { RawJob } from "./raw-types.ts";

const load = (before: number, during: number): RawJob["hostLoad"] => ({ busyBeforePercent: before, busyDuringPercent: during, waitedForQuietMs: 0, noisy: before > 30, logicalCpus: 20 });
const job = (run: number, attempt: number, before: number, during: number, status: "ok" | "error" = "ok"): RawJob => ({
  pass: "timing",
  run,
  attempt,
  startedAt: "2026-10-19T00:00:00.000Z",
  durationMs: 1,
  hostLoad: load(before, during),
  gpuLockWaitedMs: 0,
  status,
  pageErrors: [],
  consoleWarnings: 0,
});

describe("disturbed passes", () => {
  it("a pass is disturbed by load before it above the quiet limit or by load during it above 50 percent", () => {
    expect(DISTURBED_DURING_PERCENT).toBe(50);
    expect(isDisturbed(load(5, 20))).toBe(false);
    expect(isDisturbed(load(31, 20))).toBe(true);
    expect(isDisturbed(load(5, 51))).toBe(true);
    expect(isDisturbed(load(30, 50))).toBe(false);
  });

  it("the attempt that counts is the first undisturbed one: chosen by load, never by the result", () => {
    const attempts = [job(0, 1, 5, 93), job(0, 2, 6, 7), job(0, 3, 5, 6)];
    expect(preferredAttempt(attempts).attempt).toBe(2);
  });

  it("without a calm attempt the last successful attempt counts", () => {
    expect(preferredAttempt([job(0, 1, 40, 10), job(0, 2, 60, 80)]).attempt).toBe(2);
    expect(preferredAttempt([job(0, 1, 5, 6, "error"), job(0, 2, 60, 80)]).attempt).toBe(2);
    expect(preferredAttempt([job(0, 1, 5, 6, "error")]).attempt).toBe(1);
  });

  it("a pass without a repeat counts as it is, and attempts are grouped per pass and run", () => {
    const jobs = [job(0, 1, 5, 5), job(1, 1, 5, 99), job(1, 2, 5, 5), job(2, 1, 5, 5)];
    expect(groupAttempts(jobs).map((g) => g.length)).toEqual([1, 2, 1]);
    expect(chooseAttempts(jobs).map((j) => `${String(j.run)}:${String(j.attempt)}`)).toEqual(["0:1", "1:2", "2:1"]);
  });

  it("a pass is repeated while the counted attempt is disturbed and attempts remain", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(needsRetry([job(0, 1, 5, 5)])).toBe(false);
    expect(needsRetry([job(0, 1, 5, 99)])).toBe(true);
    expect(needsRetry([job(0, 1, 5, 99), job(0, 2, 5, 5)])).toBe(false);
    expect(needsRetry([job(0, 1, 5, 99), job(0, 2, 5, 99)])).toBe(true);
    expect(needsRetry([job(0, 1, 5, 99), job(0, 2, 5, 99), job(0, 3, 5, 99)])).toBe(false);
  });

  it("an old raw file without attempt numbers still works (attempt defaults to 1)", () => {
    const { attempt: _unused, ...rest } = job(0, 1, 5, 5);
    void _unused;
    expect(chooseAttempts([rest as RawJob])).toHaveLength(1);
  });
});
