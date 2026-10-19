// Mtek with a document of `docs/` added to the compiler context (a second Mtek condition, decision 0108): the context export
// alone gives a cold-start task no schema and no example, so the benchmark can also ask what the language costs when its own
// guide is in the prompt. The two Mtek conditions are never mixed: different trial ids, different condition ids, different cells.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, variantOf } from "../src/report.ts";
import { mtekSide, mtekSideWithDocs, sideByName, type Side } from "../src/side.ts";
import { GOOD_EDIT, harness, REPO_ROOT, reply, validateRecord } from "./helpers.ts";

describe("Mtek with a document added", () => {
  it("is the Mtek side with the document after the compiler context, counted in the documentation bytes and hashed into the condition", async () => {
    const side = mtekSideWithDocs(["docs/language-guide.md"]);
    expect(side.kind).toBe("mtek");
    expect(side.label).toBe("mtek-guide");
    expect(side.documentationId()).toMatch(/^context-export\+docs\/language-guide\.md:[0-9a-f]{12}$/);
    expect(mtekSide.documentationId()).toBe("context-export");
    expect(mtekSideWithDocs([])).toBe(mtekSide);
    const h = harness([reply(GOOD_EDIT)]);
    const result = await h.run({ side });
    expect(result.trialId).toBe("demo-01--mtek-guide-unconstrained--00");
    const first = h.client.requests[0]?.messages[0]?.content ?? "";
    const at = (text: string): number => first.indexOf(text);
    expect(at("# Compiler context")).toBeGreaterThanOrEqual(0);
    expect(at("# Document: docs/language-guide.md")).toBeGreaterThan(at("# Compiler context"));
    expect(at("# Document: docs/language-guide.md")).toBeLessThan(at("# Project files"));
    expect(first).not.toContain("\r");
    const start = h.recorder.records.find((r) => r["type"] === "trial-start");
    expect((start?.["condition"] as Record<string, unknown>)["documentation"]).toBe(side.documentationId());
    expect(start?.["contextBytes"]).toBeGreaterThan(readFileSync(join(REPO_ROOT, "docs", "language-guide.md")).length);
    for (const line of h.recorder.lines) expect(validateRecord(JSON.parse(line) as unknown), line).toEqual([]);
  });

  it("is looked up by its label, refuses a file that is not on the list, and is another condition than plain Mtek", async () => {
    expect(sideByName("mtek-guide").label).toBe("mtek-guide");
    expect(sideByName("mtek-reference").label).toBe("mtek-reference");
    expect(sideByName("mtek-getting-started").label).toBe("mtek-getting-started");
    expect(() => mtekSideWithDocs(["spec/language.md"])).toThrow(/not a document that can be added/);
    expect(() => sideByName("mtek-everything")).toThrow(/unknown side/);
    const ids: string[] = [];
    for (const side of [mtekSide, mtekSideWithDocs(["docs/language-guide.md"])]) {
      const h = harness([reply("nothing")]);
      await h.run({ side, maxRepairs: 0 });
      ids.push(String(h.recorder.records.find((r) => r["type"] === "trial-start")?.["conditionId"]));
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("is reported as its own cell and its own comparison with the baseline", async () => {
    const run = async (side: Side): Promise<string[]> => {
      const h = harness([reply(GOOD_EDIT)]);
      await h.run({ side });
      return h.recorder.lines;
    };
    const plain = await run(mtekSide);
    const guide = await run(mtekSideWithDocs(["docs/language-guide.md"]));
    const records = [...plain, ...guide].map((line, i) => ({ ...(JSON.parse(line) as Record<string, unknown>), runId: i < plain.length ? "plain" : "guide" }));
    const { markdown, trials } = buildReport({ records });
    expect(trials.map((t) => t.variant)).toEqual(["", "+guide"]);
    expect(markdown).toContain("| mtek unconstrained |");
    expect(markdown).toContain("| mtek unconstrained+guide |");
    expect(markdown).toContain("with the document guide added");
    expect(markdown).toMatch(/\| mtek\+guide \| [\d,]+ \|/);
  });

  it("derives the variant from the recorded documentation id", () => {
    expect(variantOf("context-export")).toBe("");
    expect(variantOf("")).toBe("");
    expect(variantOf("baseline-reference:abcdef123456")).toBe("");
    expect(variantOf("context-export+docs/language-guide.md:abcdef123456")).toBe("+guide");
    expect(variantOf("context-export+docs/getting-started.md+docs/language-reference.md:abcdef123456")).toBe("+getting-started+reference");
  });
});
