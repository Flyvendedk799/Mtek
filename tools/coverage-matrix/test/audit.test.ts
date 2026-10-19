// The audit against the real compiler and the real repository: the matrix holds, the committed
// `docs/coverage-matrix.md` is current, and the tool fails when a fixture, a code or a mark is taken
// away. The compiler is `target/debug/mtek` (built by `npm run build`) and the helper `coverage-uses`
// (built by cargo here). Without them the tests are skipped, unless CI is set: the node job of CI
// builds both, and a missing compiler there is a failure, not a skip.
import { beforeAll, describe, expect, it } from "vitest";
import { assemble, collect, committed, DOCUMENT, type Audit, type Inputs } from "../src/audit.ts";
import { runCli } from "../src/cli.ts";
import { AREAS } from "../src/guards.ts";
import { findMtek, findUses } from "../src/tools.ts";
import { REPO_ROOT } from "./helpers.ts";

const mtek = findMtek();
const uses = mtek === null ? null : findUses();
const available = mtek !== null && uses !== null;
const required = process.env["CI"] !== undefined && process.env["CI"] !== "";

describe.skipIf(!available && !required)("the audit of the repository", () => {
  let inputs: Inputs;
  let result: Audit;

  beforeAll(async () => {
    if (mtek === null || uses === null) throw new Error("no mtek executable or no coverage-uses helper: run `npm run build` first");
    inputs = await collect(REPO_ROOT, { mtek, uses });
    result = assemble(REPO_ROOT, inputs);
  }, 240_000);

  it("holds: every assertion of M7-02", () => {
    expect(result.matrix.problems).toEqual([]);
    expect(result.matrix.codes.uncovered).toEqual([]);
  });

  it("is what docs/coverage-matrix.md says (regenerate with `npm run generate -w @mtek/coverage-matrix`)", () => {
    const current = committed(REPO_ROOT);
    expect(current, `${DOCUMENT} does not exist`).not.toBeNull();
    expect(current === result.text, `${DOCUMENT} is stale`).toBe(true);
  });

  it("derives the features from the compiler's own list, all of them", () => {
    expect(result.matrix.features.filter((f) => f.layer === "registry").map((f) => f.id)).toEqual(inputs.supported.features);
    expect(inputs.supported.features.length).toBeGreaterThan(150);
  });

  it("has a demonstration-only feature for each of the three release demonstrations", () => {
    for (const row of result.matrix.distinct) expect(row.unique.length, row.demonstration).toBeGreaterThan(0);
    expect(result.matrix.distinct).toHaveLength(3);
  });

  it("leaves no area, and no code of an area, without a negative test", () => {
    for (const row of result.matrix.areas) {
      expect(row.features, row.area.id).toBeGreaterThan(0);
      for (const code of row.codes) expect(code.evidence, `${row.area.id} ${code.code}`).not.toBe("none");
    }
    expect(result.matrix.areas).toHaveLength(AREAS.length);
  });

  describe("fails when the repository is made worse", () => {
    it("loses the only positive fixture of a feature", () => {
      const without = inputs.projects.filter((p) => p.id !== "tests/semantics/pass/host_inputs_every_codec");
      const worse = assemble(REPO_ROOT, { ...inputs, projects: without });
      expect(worse.matrix.problems).toContain("no demonstration and no positive fixture exercises the feature project/host-input-codec:u32");
      expect(worse.matrix.problems).toContain("no demonstration and no positive fixture exercises the feature project/host-input-codec:string");
    });

    it("loses the only fixture of a diagnostic code", () => {
      const fixtureCodes = new Map(inputs.fixtureCodes);
      fixtureCodes.delete("MTEK-E2035");
      const worse = assemble(REPO_ROOT, { ...inputs, fixtureCodes });
      expect(worse.matrix.codes.uncovered).toEqual(["E2035"]);
      expect(worse.matrix.problems.some((p) => p.includes("E2035 has no fail fixture"))).toBe(true);
    });

    it("loses the mark of a reserved code in the catalogue", () => {
      const catalogue = inputs.catalogue.map((e) => (e.code === "E5901" ? { ...e, mark: null } : e));
      const worse = assemble(REPO_ROOT, { ...inputs, catalogue });
      expect(worse.matrix.problems.some((p) => p.includes("E5901 is listed as reserved, but its row"))).toBe(true);
    });

    it("keeps a code on the allow-list after it gained a fixture", () => {
      const fixtureCodes = new Map(inputs.fixtureCodes);
      fixtureCodes.set("MTEK-E5901", [{ file: "x", fixture: "x", suite: "semantics-fail", messages: [] }]);
      const worse = assemble(REPO_ROOT, { ...inputs, fixtureCodes });
      expect(worse.matrix.problems.some((p) => p.includes("E5901 now has a fixture"))).toBe(true);
    });

    it("loses a demonstration's own feature", () => {
      const projects = inputs.projects.map((p) =>
        p.id === "examples/modular-scene" ? { ...p, ir: new Set([...p.ir].filter((f) => !f.startsWith("module/"))), uses: new Set<string>() } : p,
      );
      const worse = assemble(REPO_ROOT, { ...inputs, projects });
      expect(worse.matrix.problems.some((p) => p.includes("does not exercise module/cross-file-prefab"))).toBe(true);
    });
  });

  it("exits 0 and prints its summary when the document is current", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli([], { out: (t) => out.push(t), err: (t) => err.push(t) });
    expect(err.join("")).toBe("");
    expect(code).toBe(0);
    expect(out.join("")).toContain("every assertion holds");
  }, 240_000);
});
