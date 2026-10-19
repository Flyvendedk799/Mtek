import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, staleness } from "../src/cli.ts";
import { findMtek } from "../src/tools.ts";
import { tempDir } from "./helpers.ts";

function sink(): { out: string[]; err: string[]; io: { out: (t: string) => void; err: (t: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t) => out.push(t), err: (t) => err.push(t) } };
}

describe("runCli", () => {
  it("refuses an unknown argument with exit code 3", async () => {
    const s = sink();
    expect(await runCli(["--frobnicate"], s.io, tempDir(), {})).toBe(3);
    expect(s.err.join("")).toContain("unknown argument --frobnicate");
  });

  it("says how to get a compiler, and exits 3, when there is none", async () => {
    const s = sink();
    const missing = join(tempDir(), "no-such-mtek");
    expect(await runCli([], s.io, tempDir(), { MTEK_BIN: missing })).toBe(3);
    expect(s.err.join("")).toContain("no mtek executable");
  });

  it("says how to get the helper, and exits 3, when there is none", async () => {
    const s = sink();
    const mtek = findMtek();
    if (mtek === null) return; // nothing to point MTEK_BIN at; the previous test covers the message
    expect(await runCli([], s.io, tempDir(), { MTEK_BIN: mtek, MTEK_COVERAGE_USES: join(tempDir(), "no-such-helper") })).toBe(3);
    expect(s.err.join("")).toContain("no coverage-uses helper");
  });

  it("calls the committed document missing, stale or current", () => {
    expect(staleness(null, "a")).toContain("does not exist");
    expect(staleness("a", "b")).toContain("is stale");
    expect(staleness("a", "a")).toBeNull();
  });

  it("names a file as the compiler only if it exists", () => {
    const dir = tempDir();
    const fake = join(dir, "mtek");
    writeFileSync(fake, "");
    expect(findMtek({ MTEK_BIN: fake })).toBe(fake);
    expect(findMtek({ MTEK_BIN: join(dir, "other") })).toBeNull();
  });
});
