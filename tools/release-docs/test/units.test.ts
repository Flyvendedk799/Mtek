// Tests that need neither the compiler nor the runtime: the readers, the helpers and the release notes check.
import { describe, expect, it } from "vitest";
import { repoRoot } from "../../coverage-matrix/src/tools.ts";
import { compareAll } from "../src/compare.ts";
import { excerpt, expandDirective, renderGuide } from "../src/guide.ts";
import { checkSupportedEnvironments } from "../src/environments.ts";
import { checkDocLinks } from "../src/links.ts";
import { splitNotSupported, x9xxCodes } from "../src/limitations.ts";
import { compareSets, compareValue, duplicates, mismatch } from "../src/model.ts";
import { demoteHeadings } from "../src/md.ts";
import { languageBody, groupFeatures, featuresInReference } from "../src/reference.ts";
import { registryFeatures, type StdlibSchema } from "../src/registry.ts";
import {
  checkKnownIssues,
  checkReleaseNotes,
  claimsOf,
  isEvidencePath,
  numbersOf,
  PENDING_MARK,
  remainingLeads,
  REQUIRED_PENDING,
} from "../src/releasenotes.ts";
import { snakeCase, bodyHandleMembers, implementedCodecs } from "../src/runtimefacts.ts";
import {
  abiBodyHandleMethods,
  abiCodecIds,
  abiSpecConstants,
  languageWordLists,
  readText,
  section,
  stdlibEvents,
  stdlibIntrinsicNames,
  stdlibKeyCodes,
  tableRows,
} from "../src/spectext.ts";

const root = repoRoot();

describe("model", () => {
  it("names both sides in a message", () => {
    const m = mismatch("c/x", { where: "A", value: "1" }, { where: "B", value: "2" }, "why");
    expect(m.message).toBe("c/x: A says 1, but B says 2 (why)");
  });

  it("compares values", () => {
    expect(compareValue("c", { where: "A", value: "1" }, { where: "B", value: "1" })).toEqual([]);
    expect(compareValue("c", { where: "A", value: "1" }, { where: "B", value: "2" })).toHaveLength(1);
  });

  it("compares sets in both directions, one finding per name", () => {
    const found = compareSets("c", "thing", { where: "A", items: ["a", "b"] }, { where: "B", items: ["b", "c"] });
    expect(found.map((m) => m.message)).toEqual([
      'c: A says thing "a", but B says no such thing',
      'c: A says no such thing, but B says thing "c"',
    ]);
  });

  it("finds duplicates", () => {
    expect(duplicates(["a", "b", "a", "c", "c"])).toEqual(["a", "c"]);
  });

  it("compares all entries with the first and reports missing values as nothing", () => {
    const found = compareAll("c", [
      { where: "A", value: "1" },
      { where: "B", value: "1" },
      { where: "C", value: undefined },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("nothing (not found)");
  });
});

describe("readers of the specification", () => {
  const languageMd = readText(root, "spec/language.md");
  const stdlibMd = readText(root, "spec/stdlib.md");
  const abiMd = readText(root, "spec/runtime-abi.md");

  it("reads the keyword lists", () => {
    const { keywords, reserved } = languageWordLists(languageMd);
    expect(keywords).toContain("prefab");
    expect(reserved).toContain("while");
    expect(reserved).toHaveLength(30);
    expect(keywords.filter((k) => reserved.includes(k))).toEqual([]);
  });

  it("reads the events, the keys and the intrinsics of stdlib.md", () => {
    expect(stdlibEvents(stdlibMd)).toEqual(["key_down", "key_up", "pointer_down", "pointer_up", "pointer_move", "collision_enter", "collision_exit"]);
    const keys = stdlibKeyCodes(stdlibMd);
    expect(keys).toContain("KeyA");
    expect(keys).toContain("KeyZ");
    expect(keys).toContain("Digit9");
    expect(keys).toContain("ShiftRight");
    expect(keys).toContain("Space");
    expect(keys).toHaveLength(26 + 10 + 5 + 6 + 4);
    expect(stdlibIntrinsicNames(stdlibMd)).toContain("inverse_sqrt");
  });

  it("reads the codec table and the body handle of runtime-abi.md", () => {
    expect(abiCodecIds(abiMd)).toEqual(["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color-hex", "color-hex-opaque", "string"]);
    expect(abiBodyHandleMethods(abiMd)).toContain("applyImpulse");
    expect(abiBodyHandleMethods(abiMd)).toContain("linearVelocity");
  });

  it("reads the ABI constants it states", () => {
    const c = abiSpecConstants(abiMd);
    expect([c.headerAbi, c.exampleAbi, c.exactAbi]).toEqual(["1", "1", "1"]);
    expect([c.headerSchema, c.exampleSchema, c.exactSchema]).toEqual(["1", "1", "1"]);
    expect([c.exampleLanguage, c.exactLanguage]).toEqual(["0.1", "0.1"]);
    expect(c.exampleProfile).toBe("webgpu-core-2026");
  });

  it("throws, naming the place, when a heading is gone", () => {
    expect(() => section("# x\n", "## Missing", "a test")).toThrow(/Missing/);
  });

  it("splits table rows on unescaped pipes outside code", () => {
    const rows = tableRows("| a | b |\n|---|---|\n| `x | y` | z \\| w |\n\nafter");
    expect(rows).toEqual([["`x | y`", "z | w"]]);
  });
});

describe("snake case and the runtime readers", () => {
  it("converts method names to registry names", () => {
    expect(snakeCase("applyImpulse")).toBe("apply_impulse");
    expect(snakeCase("teleport")).toBe("teleport");
  });

  it("reads the public members of the body handle from source text", () => {
    const source = "class BodyHandleImpl {\n  constructor(private x: number) {}\n  applyForce(f: unknown): void {}\n  private vec3(): void {}\n  get linearVelocity(): number { return 1; }\n}\n";
    expect(bodyHandleMembers(source)).toEqual(["apply_force", "linear_velocity"]);
  });

  it("probes which codecs answer", () => {
    const decode = (codec: string): unknown => (codec === "f32" ? { ok: false } : undefined);
    expect(implementedCodecs(decode, ["f32", "nope"])).toEqual(["f32"]);
    expect(implementedCodecs(() => { throw new Error("x"); }, ["f32"])).toEqual([]);
  });
});

describe("registry features", () => {
  const registry = {
    types: [{ name: "vec3", since: "M1", methods: [{ name: "length", since: "M1" }, { name: "later", since: "M5" }] }],
    schemas: [{ name: "Box", since: "M1" }],
    sceneObjects: [{ keyword: "camera", since: "M1" }],
    events: [{ name: "key_down", since: "M1" }, { name: "pointer_down", since: "M3" }],
    enums: [{ name: "Key", since: "M1", members: [] }],
    namespaces: [{ name: "frame", since: "M1", members: [{ name: "time", kind: "value", since: "M1" }, { name: "now", kind: "function", since: "M1" }] }],
    intrinsics: [{ name: "abs", since: "M1" }],
    bodyCommands: [{ name: "teleport", since: "M1" }],
    bodyProperties: [{ name: "linear_velocity", since: "M1" }],
  } as unknown as StdlibSchema;

  it("names the rows as the compiler names them and drops what the milestone has not reached", () => {
    expect(registryFeatures(registry, "M1")).toEqual([
      "body-command:teleport",
      "body-property:linear_velocity",
      "enum:Key",
      "event:key_down",
      "function:abs",
      "function:frame.now",
      "method:vec3.length",
      "namespace:frame",
      "scene-object:camera",
      "schema:Box",
      "type:vec3",
      "value:frame.time",
    ]);
    expect(registryFeatures(registry, "M5")).toContain("event:pointer_down");
    expect(registryFeatures(registry, "M5")).toContain("method:vec3.later");
  });
});

describe("limitations helpers", () => {
  it("finds the x9xx codes and sets E9999 apart", () => {
    const entry = (code: string) => ({ code, title: "t", trigger: "", mark: null });
    const { unsupported, internal } = x9xxCodes([entry("E1901"), entry("E1001"), entry("E9999"), entry("E9010"), entry("W3901")]);
    expect(unsupported.map((e) => e.code)).toEqual(["E1901", "W3901"]);
    expect(internal.map((e) => e.code)).toEqual(["E9999"]);
  });

  it("splits what mtek context lists as not supported", () => {
    const split = splitNotSupported(["non-constant-initial-values", "while", "bitwise operators (& | ^ ~ << >>)", "x:y (planned for M5)"], ["while"]);
    expect(split).toEqual({ gates: ["non-constant-initial-values"], words: ["while"], phrases: ["bitwise operators (& | ^ ~ << >>)"], planned: ["x:y (planned for M5)"] });
  });
});

describe("reference helpers", () => {
  it("demotes headings but not code", () => {
    expect(demoteHeadings("## a\n```\n# not\n```\n### b", 1)).toBe("### a\n```\n# not\n```\n#### b");
  });

  it("drops the metadata block of the language reference and keeps the sections", () => {
    const body = languageBody(readText(root, "spec/language.md"));
    expect(body.startsWith("Conventions in this document")).toBe(true);
    expect(body).toContain("### 1. Source text");
    expect(body).not.toContain("Repository path");
  });

  it("groups features by prefix and reads them back from a rendered part", () => {
    const groups = groupFeatures(["imports", "type:f32", "event:key_up"]);
    expect(groups.map((g) => g.name)).toEqual(["construct", "event", "type"]);
    expect(featuresInReference("\n## Part C. x\n\n`imports`\n\n### E\n\n`event:key_up` `type:f32`\n\n## Part D. y")).toEqual(["imports", "event:key_up", "type:f32"]);
  });
});

describe("guide directives", () => {
  it("cuts an excerpt between two patterns and rejects a pattern that matches nothing", () => {
    const text = "a\nscene X {\n  b\n}\nc";
    expect(excerpt(text, "^scene", "^\\}$", "t")).toBe("scene X {\n  b\n}");
    expect(() => excerpt(text, "^nothing", "^\\}$", "t")).toThrow(/no line matches/);
    expect(() => excerpt(text, "^scene", "^nothing", "t")).toThrow(/no line after/);
  });

  it("rejects an unknown directive", () => {
    expect(() => expandDirective({} as never, "frobnicate")).toThrow(/unknown directive/);
  });

  it("expands an excerpt directive whose end pattern contains a brace", () => {
    const ctx = { text: () => "x\nfn f() {\n}\ny", root } as never;
    expect(renderGuide(ctx, "{{excerpt p.mtek :: ^fn f :: ^\\}$}}")).toBe("```mtek from=p.mtek\nfn f() {\n}\n```");
  });
});

describe("links", () => {
  it("resolves relative links against the page, skips URLs, anchors and code blocks", () => {
    const text = "[a](../spec/a.md#x) [b](https://example.com) [c](#top) [d](missing.md)\n```\n[e](nope.md)\n```\n";
    const found = checkDocLinks({ pages: [{ path: "docs/p.md", text }], exists: (p) => p === "spec/a.md" });
    expect(found.map((m) => m.message)).toEqual(["docs/links: docs/p.md line 1 says links to missing.md, but docs/missing.md says no such file"]);
  });
});

describe("release notes", () => {
  const files = new Map<string, string>([
    ["evidence/M9/report.md", "# report\n1 590 passed, 584 browser\n"],
    ["spec/a.md", "text"],
    ["docs/other.md", "docs only"],
  ]);
  const io = {
    exists: (p: string) => files.has(p) || p.startsWith("evidence/M7/exists"),
    read: (p: string) => files.get(p) ?? null,
  };
  const pending = REQUIRED_PENDING.map((id) => `- ${PENDING_MARK} Thing (${id}). Evidence that will replace this: \`evidence/M7/${id}.md\`.`).join("\n");
  const doc = (claims: string): string => `# T\n\npreface with 99 numbers\n\n## 1. Claims\n\n${claims}\n\n## 6. Pending\n\n${pending}\n`;

  it("accepts a claim with a link to evidence and numbers that the evidence contains", () => {
    expect(checkReleaseNotes(doc("- 1590 tests passed ([report](../evidence/M9/report.md))."), io)).toEqual([]);
  });

  it("rejects a claim without a link", () => {
    const found = checkReleaseNotes(doc("- It is fast."), io);
    expect(found.map((m) => m.check)).toEqual(["release-notes/claim-without-evidence"]);
    expect(found[0]?.message).toContain("docs/release-notes-v0.1.md line");
  });

  it("rejects a link that does not resolve, naming the target", () => {
    const found = checkReleaseNotes(doc("- It works ([x](../evidence/M9/missing.md))."), io);
    expect(found.map((m) => m.check)).toContain("release-notes/link");
    expect(found.find((m) => m.check === "release-notes/link")?.message).toContain("evidence/M9/missing.md");
  });

  it("rejects a link to a file that is not evidence", () => {
    const found = checkReleaseNotes(doc("- It works ([docs](other.md))."), io);
    expect(found.map((m) => m.check)).toEqual(["release-notes/claim-without-evidence"]);
  });

  it("rejects a number that the linked evidence does not contain", () => {
    const found = checkReleaseNotes(doc("- 1591 tests passed ([report](../evidence/M9/report.md))."), io);
    expect(found.map((m) => m.check)).toEqual(["release-notes/number"]);
    expect(found[0]?.message).toContain("1591");
  });

  it("does not count code spans, link labels, task ids, dates or decision numbers as measurements", () => {
    const claim = "- Decision 0070 and `E9010` in M6-01 on 2026-10-19 ([0070](../spec/a.md), version 0.1).";
    expect(checkReleaseNotes(doc(claim), io)).toEqual([]);
  });

  it("rejects a placeholder with a number, one that names no evidence and one whose evidence exists", () => {
    const bad = [
      `- ${PENDING_MARK} Takes 12 ms. Evidence that will replace this: \`evidence/M7/a.md\`.`,
      `- ${PENDING_MARK} Nothing named.`,
      `- ${PENDING_MARK} Already there. Evidence that will replace this: \`evidence/M7/exists.md\`.`,
    ].join("\n");
    const found = checkReleaseNotes(doc(bad), io).map((m) => m.check);
    expect(found).toContain("release-notes/pending-number");
    expect(found).toContain("release-notes/pending");
    expect(found).toContain("release-notes/pending-stale");
  });

  it("requires no placeholder once every M7 result exists", () => {
    // M7-03, -04, -05 and -07 all have their evidence: nothing is required to be pending any more.
    expect(REQUIRED_PENDING).toEqual([]);
    const only = `# T\n\n## 1. C\n\n- a claim ([s](../spec/a.md))\n`;
    const found = checkReleaseNotes(only, io).filter((m) => m.check === "release-notes/pending-required");
    expect(found).toEqual([]);
  });

  it("ignores the preface and the exempt section", () => {
    const text = "# T\n\n- preface bullet\n\n## About this draft\n\n- explains itself\n\n## 1. C\n\n- 7 ([s](../spec/a.md))\n";
    expect(claimsOf(text).map((c) => c.text)).toEqual(["7 ([s](../spec/a.md))"]);
  });

  it("reads table rows as claims, not their header or separator", () => {
    const text = "## 2. T\n\n| A | B |\n|---|---|\n| one | two ([s](../spec/a.md)) |\n";
    expect(claimsOf(text)).toHaveLength(1);
  });

  it("normalises thousands separators and knows evidence paths", () => {
    expect(numbersOf("1 590 and 2,048 and 584")).toEqual(["1590", "2048", "584"]);
    expect(isEvidencePath("evidence/M6/report.md")).toBe(true);
    expect(isEvidencePath("tools/coverage-matrix/test/audit.test.ts")).toBe(true);
    expect(isEvidencePath("crates/mtek-cli/tests/getting_started.rs")).toBe(true);
    expect(isEvidencePath("docs/limitations.md")).toBe(false);
  });

  it("requires every known issue of the M6 report, by its words, and the red job", () => {
    const report = readText(root, "evidence/M6/report.md");
    const leads = remainingLeads(report);
    expect(leads.length).toBeGreaterThanOrEqual(7);
    const all = `${leads.join("\n")}\ndev-overlay`;
    expect(checkKnownIssues(all, report)).toEqual([]);
    const missing = checkKnownIssues(all.replace(leads[1] ?? "", "gone"), report);
    expect(missing.map((m) => m.check)).toEqual(["release-notes/known-issues"]);
    expect(missing[0]?.message).toContain(leads[1] ?? "");
    expect(checkKnownIssues(leads.join("\n"), report).map((m) => m.message).join()).toContain("dev-overlay");
  });
});

describe("supported environments", () => {
  const files = new Map<string, string>([
    ["evidence/M7/environments/a/summary.md", "| hardware | 251 | 0 |\nAMD Radeon RX 7900 XTX\n"],
    ["evidence/M7/environments/a/environment-hardware.json", "{}"],
    ["evidence/M7/environments/b/summary.md", "| software | 236 | 2 |\n"],
    ["evidence/M7/environments/b/environment-software.json", "{}"],
    ["docs/other.md", "docs only"],
  ]);
  const records = ["evidence/M7/environments/a/environment-hardware.json", "evidence/M7/environments/b/environment-software.json"];
  const io = { exists: (p: string) => files.has(p), read: (p: string) => files.get(p) ?? null, records: () => records };
  const rowA = "| Windows, hardware | 251 passed ([summary](../evidence/M7/environments/a/summary.md), [record](../evidence/M7/environments/a/environment-hardware.json)) |";
  const rowB = "| Linux, software | 236 passed ([summary](../evidence/M7/environments/b/summary.md), [record](../evidence/M7/environments/b/environment-software.json)) |";
  const page = (rows: string[]): string => `# T\n\n## How to read this page\n\n- an explanation with 99 numbers\n\n## Environments\n\n| Environment | Result |\n|---|---|\n${rows.join("\n")}\n`;

  it("accepts rows that link to stored runs and use their numbers", () => {
    expect(checkSupportedEnvironments(page([rowA, rowB]), io)).toEqual([]);
  });

  it("rejects a row without a link to a stored run, and a link to a page that is not one", () => {
    const found = checkSupportedEnvironments(page([rowA, rowB, "| macOS | works |", "| Edge | 12 passed ([x](other.md)) |"]), io);
    expect(found.map((m) => m.check)).toEqual(["environments/claim-without-evidence", "environments/claim-without-evidence"]);
  });

  it("rejects a link that does not resolve", () => {
    const found = checkSupportedEnvironments(page([rowA, rowB, "| Edge | ([x](../evidence/M7/environments/c/summary.md)) |"]), io);
    expect(found.map((m) => m.check)).toContain("environments/link");
    expect(found.find((m) => m.check === "environments/link")?.message).toContain("evidence/M7/environments/c/summary.md");
  });

  it("rejects a number that the linked summary does not contain", () => {
    const found = checkSupportedEnvironments(page([rowA.replace("251", "252"), rowB]), io);
    expect(found.map((m) => m.check)).toEqual(["environments/number"]);
    expect(found[0]?.message).toContain("252");
  });

  it("rejects a stored environment record that the page does not list", () => {
    const found = checkSupportedEnvironments(page([rowA]), io);
    expect(found.map((m) => m.check)).toEqual(["environments/unlisted"]);
    expect(found[0]?.message).toContain("evidence/M7/environments/b/environment-software.json");
  });

  it("rejects a missing page and a page without claims", () => {
    expect(checkSupportedEnvironments(null, io).map((m) => m.check)).toEqual(["environments/missing"]);
    expect(checkSupportedEnvironments("# T\n\n## How to read this page\n\n- text\n", io).map((m) => m.check)).toContain("environments/claims");
  });
});
