import { describe, expect, it } from "vitest";
import {
  ALGORITHM,
  checkFrozen,
  definitionFiles,
  hashFiles,
  readFrozen,
  treeHashOf,
  validateFrozenFile,
  type FrozenFile,
} from "./freeze.ts";

const entryFor = (files: Record<string, string>, rationale: string): FrozenFile["entries"][number] => ({
  treeHash: treeHashOf(files),
  recordedAt: "2026-10-19T00:00:00.000Z",
  rationale,
  files,
});

describe("the tree hash", () => {
  it("depends on every path and every file hash, and on nothing else", () => {
    const base = { "a.ts": "1".repeat(64), "b.ts": "2".repeat(64) };
    expect(treeHashOf(base)).toBe(treeHashOf({ "b.ts": "2".repeat(64), "a.ts": "1".repeat(64) }));
    expect(treeHashOf(base)).not.toBe(treeHashOf({ ...base, "b.ts": "3".repeat(64) }));
    expect(treeHashOf(base)).not.toBe(treeHashOf({ ...base, "c.ts": "2".repeat(64) }));
    expect(treeHashOf(base)).not.toBe(treeHashOf({ "a.ts": "1".repeat(64) }));
    expect(treeHashOf({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers the protocol, the formulas, every workload definition and implementation, the kits and the generators", () => {
    const files = definitionFiles();
    for (const required of [
      "protocol.json",
      "common/layout.ts",
      "harness/kit/direct.ts",
      "harness/kit/three.ts",
      "harness/mtek-adapter.ts",
      "tools/gen-mtek.ts",
      "tools/assets.ts",
      "constant-scene/workload.json",
      "constant-scene/mtek/src/main.mtek",
      "constant-scene/direct/main.ts",
      "constant-scene/three/main.ts",
      "mount-reload-dispose/three/main.ts",
      "physics-bodies/mtek/src/main.mtek",
    ]) {
      expect(files).toContain(required);
    }
  });

  it("does not cover generated files, tests, the measurement page or the runner", () => {
    const files = definitionFiles();
    expect(files.some((f) => f.includes(".out/"))).toBe(false);
    expect(files.some((f) => f.endsWith(".test.ts"))).toBe(false);
    expect(files).not.toContain("harness/page.ts");
    expect(files).not.toContain("tools/run.ts");
    expect(files).not.toContain("tools/report.ts");
    expect(files.some((f) => f.startsWith("asset-heavy-startup/mtek/models/") || f.startsWith("asset-heavy-startup/mtek/textures/"))).toBe(false);
  });
});

describe("checkFrozen", () => {
  const files = { "a.ts": "1".repeat(64), "b.ts": "2".repeat(64) };
  const frozen: FrozenFile = { schemaVersion: 1, algorithm: ALGORITHM, entries: [entryFor(files, "initial freeze of the definitions")] };

  it("accepts the recorded tree", () => {
    expect(checkFrozen(frozen, files)).toMatchObject({ ok: true, problems: [] });
  });

  it("fails, naming the file, when a definition changed without a new entry", () => {
    const status = checkFrozen(frozen, { ...files, "b.ts": "9".repeat(64) });
    expect(status.ok).toBe(false);
    expect(status.problems).toEqual(["changed: b.ts"]);
  });

  it("fails for an added file and for a removed file", () => {
    expect(checkFrozen(frozen, { ...files, "c.ts": "3".repeat(64) }).problems).toEqual(["added: c.ts"]);
    expect(checkFrozen(frozen, { "a.ts": files["a.ts"] }).problems).toEqual(["removed: b.ts"]);
  });

  it("passes again once the change is recorded with a rationale (the last entry counts)", () => {
    const changed = { ...files, "b.ts": "9".repeat(64) };
    const rerecorded: FrozenFile = { ...frozen, entries: [...frozen.entries, entryFor(changed, "b.ts: the scale was wrong in all three implementations")] };
    expect(checkFrozen(rerecorded, changed).ok).toBe(true);
    expect(checkFrozen(rerecorded, files).ok).toBe(false);
  });

  it("fails when nothing was ever recorded", () => {
    expect(checkFrozen(null, files)).toMatchObject({ ok: false, recordedHash: null });
  });
});

describe("validateFrozenFile", () => {
  const files = { "a.ts": "1".repeat(64) };

  it("accepts a chain whose every entry has a rationale and a consistent hash", () => {
    const second = { ...files, "a.ts": "2".repeat(64) };
    const frozen: FrozenFile = {
      schemaVersion: 1,
      algorithm: ALGORITHM,
      entries: [entryFor(files, "initial freeze of the definitions"), entryFor(second, "a.ts changed: the camera was inside the grid")],
    };
    expect(validateFrozenFile(frozen)).toEqual([]);
  });

  it("rejects an entry without a rationale, a forged hash and an entry that repeats the one before", () => {
    const bad: FrozenFile = {
      schemaVersion: 1,
      algorithm: ALGORITHM,
      entries: [entryFor(files, "x"), { ...entryFor(files, "initial freeze of the definitions"), treeHash: "0".repeat(64) }, entryFor(files, "initial freeze again, nothing changed")],
    };
    const problems = validateFrozenFile(bad);
    expect(problems.some((p) => p.includes("entry 0 has no rationale"))).toBe(true);
    expect(problems.some((p) => p.includes("entry 1: the tree hash does not follow"))).toBe(true);
    expect(validateFrozenFile({ schemaVersion: 1, algorithm: ALGORITHM, entries: [entryFor(files, "initial freeze of the definitions"), entryFor(files, "initial freeze again, nothing changed")] })).toEqual([
      "entry 1 repeats the tree hash of the entry before it",
    ]);
  });
});

describe("the workload definitions of this checkout", () => {
  it("are the frozen ones: a change needs a new entry in FROZEN.json with a rationale (node tools/freeze.ts --record)", () => {
    const frozen = readFrozen();
    expect(frozen, "FROZEN.json must exist: run `node tools/freeze.ts --record \"initial freeze\"`").not.toBeNull();
    expect(validateFrozenFile(frozen as FrozenFile)).toEqual([]);
    const status = checkFrozen(frozen, hashFiles());
    expect(status.problems).toEqual([]);
    expect(status.ok).toBe(true);
  });
});
