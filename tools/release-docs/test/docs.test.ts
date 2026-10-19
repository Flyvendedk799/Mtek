// The documentation pages (decisions 0116 to 0118): the directives, the code-block forms and the page checks, with
// synthetic pages and a fake compiler, so that none of this needs a built `mtek`. The same checks against the real
// pages and the real compiler are in live.test.ts.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCatalogue } from "../../coverage-matrix/src/diagnostics.ts";
import { repoRoot, type RunResult, type Runner } from "../../coverage-matrix/src/tools.ts";
import {
  applyDiff,
  checkDocCode,
  checkForm,
  checkFrom,
  extractFences,
  fullCode,
  parseInfo,
  proseOf,
  sceneName,
  sourceOf,
  wrapFragment,
  type Fence,
} from "../src/doccode.ts";
import { checkDocPages, GUIDE_MAX_BYTES, headingsOf, slug, type DocPageInputs } from "../src/docpages.ts";
import {
  bodyCommandsTable,
  catalogueEntry,
  citedCodes,
  citedCodesTable,
  defaultExposureHolds,
  enumMembers,
  eventsTable,
  exposureForLux,
  fieldDefault,
  fieldList,
  fieldRange,
  fieldsTable,
  intrinsicsOf,
  membersTable,
  methodsTable,
  projectDefault,
  signatures,
  typeFields,
} from "../src/facts.ts";
import { expandDirective, renderTemplate, rootPrefix } from "../src/guide.ts";
import { readRegistry } from "../src/registry.ts";

const root = repoRoot();
const registry = readRegistry(root);
const catalogue = readCatalogue(root);

describe("directives that read the registry", () => {
  it("prints the fields of a schema with their defaults and update words", () => {
    const table = fieldsTable(registry, "Camera");
    expect(table).toContain("| `exposure` | `f32` | `-1.9145305` | fixed at construction |");
    expect(table).toContain("| `position` | `vec3` | `vec3(0.0, 0.0, 5.0)` | assignable, bindable |");
    expect(fieldsTable(registry, "Static")).toContain("has no fields");
    expect(fieldDefault(registry, "Camera.exposure")).toBe("`-1.9145305`");
    expect(fieldDefault(registry, "Camera.target")).toBe("none");
    expect(fieldRange(registry, "Dynamic.mass")).toBe("> 0, finite");
    expect(fieldList(registry, "Unlit")).toBe("`Unlit { color: color = #ffffff }`");
    expect(fieldList(registry, "Pbr")).toContain("base_color_texture*: texture = texture.white()");
  });

  it("refuses a schema, field, enum, type, namespace or signature that does not exist", () => {
    expect(() => fieldsTable(registry, "Nope")).toThrow(/no schema "Nope"/);
    expect(() => fieldDefault(registry, "Camera.nope")).toThrow(/no field "nope"/);
    expect(() => enumMembers(registry, "Nope", false)).toThrow(/no enum/);
    expect(() => signatures(registry, "nope")).toThrow(/no function/);
    expect(() => typeFields(registry, "vec3")).toThrow(/no fields/);
    expect(() => methodsTable(registry, "vec3")).toThrow(/with methods/);
    expect(() => membersTable(registry, "nope")).toThrow(/no namespace/);
    expect(() => intrinsicsOf(registry, "tpu")).toThrow(/both, cpu or gpu/);
    expect(() => catalogueEntry(catalogue, "E0000", "t")).toThrow(/not a code of the catalogue/);
  });

  it("folds the runs of the key enum and lists every member in full on request", () => {
    const compact = enumMembers(registry, "Key", false);
    expect(compact).toContain("`Key.A` to `Key.Z`");
    expect(compact).toContain("`Key.Digit0` to `Key.Digit9`");
    expect(compact).toContain("`Key.ArrowLeft`");
    expect(compact).not.toContain("`Key.B`");
    expect(enumMembers(registry, "Key", true)).toContain("`Key.B`");
  });

  it("prints signatures, events, commands, members and the functions of a domain", () => {
    expect(signatures(registry, "lighting.pbr")).toBe("`lighting.pbr(surface: SurfaceInput, base_color: color, metallic: f32, roughness: f32) -> color`");
    expect(signatures(registry, "mix")).toContain("`mix(a: T, b: T, t: f32) -> T`<br>");
    expect(signatures(registry, "body.teleport")).toBe("`body.teleport(position: vec3, rotation: quat, keep_velocity: bool)`");
    expect(eventsTable(registry)).toContain("| `on collision_enter(...)` | one parameter of type `entity_ref` | entity, prefab (with a collider) |");
    expect(bodyCommandsTable(registry)).toContain("`body.linear_velocity: vec3`");
    expect(membersTable(registry, "sampler")).toContain("`sampler.nearest_clamp`");
    expect(methodsTable(registry, "glb_asset")).toContain("`.node_position`");
    expect(typeFields(registry, "SurfaceInput")).toContain("`uv: vec2`");
    expect(intrinsicsOf(registry, "gpu")).toBe("`lighting.pbr`, `sample`");
    expect(intrinsicsOf(registry, "cpu")).toContain("`random`");
    expect(intrinsicsOf(registry, "cpu")).toContain("`texture.white`");
  });

  it("derives project defaults from the compiler source and the exposure from the formula", () => {
    const config = readFileSync(join(root, "crates/mtek-compiler/src/project/config.rs"), "utf8");
    expect(projectDefault(config, "MAX_FRAME_DELTA")).toBe("0.1");
    expect(projectDefault(config, "FIXED_STEP")).toBe("0.016666668");
    expect(projectDefault(config, "MAX_ENTITIES")).toBe("16384");
    expect(() => projectDefault(config, "NOPE")).toThrow(/no "pub const DEFAULT_NOPE"/);
    expect(exposureForLux(500)).toBe("7.1");
    expect(exposureForLux(100000)).toBe("14.7");
    const holds = defaultExposureHolds(registry);
    expect(Math.fround(Number(holds.text))).toBe(holds.expected);
  });

  it("collects the codes a page mentions and tabulates them from the catalogue", () => {
    expect(citedCodes("MTEK-E5070 and MTEK-W5101, MTEK-E5070 again, E5071 alone")).toEqual(["E5070", "W5101"]);
    const table = citedCodesTable(catalogue, ["E5070", "E5074"], "../../");
    expect(table).toContain("[`MTEK-E5070`](../../spec/diagnostics.md#mtek-e5070)");
    expect(table).toContain("field access through entity_ref");
    expect(citedCodesTable(catalogue, [], "")).toContain("cites no diagnostic code");
    expect(() => citedCodesTable(catalogue, ["E0000"], "")).toThrow(/not a code/);
  });
});

describe("templates", () => {
  const ctx = {
    root,
    registry,
    catalogue,
    decisionFiles: ["0100-release-documentation-generated-from-the-sources.md"],
    compiler: { contextLanguage: "0.1", versionLine: "mtek x", features: ["a", "b"], subcommands: ["check"] },
    text: (path: string) => (path === "crates/mtek-compiler/src/project/config.rs" ? "pub const DEFAULT_PORT: u16 = 5_173;\n" : ""),
  } as never;
  const page = { doc: "docs/concepts/x.md", template: "tools/release-docs/templates/pages/concepts/x.md" };

  it("expands directives, resolves a decision link from the depth of the page and ends with the cited codes", () => {
    const out = renderTemplate(
      ctx,
      "{{default Camera.exposure}} {{project-default PORT}} {{decision 0100}}\nMTEK-E5070\n{{cited-codes}}\n{{features nothing}}|{{feature-count}}",
      page,
    );
    expect(out).toContain("`-1.9145305` 5173 [0100](../../spec/decisions/0100-release-documentation-generated-from-the-sources.md)");
    expect(out).toContain("| [`MTEK-E5070`](../../spec/diagnostics.md#mtek-e5070) | write to bound field |");
    expect(out).toContain("(none)|2");
    expect(rootPrefix("docs/language-guide.md")).toBe("../");
    expect(rootPrefix("docs/concepts/x.md")).toBe("../../");
  });

  it("names the template in the error for an unknown directive or a code that is not in the catalogue", () => {
    expect(() => expandDirective(ctx, "nope", page)).toThrow(/templates\/pages\/concepts\/x.md: unknown directive/);
    expect(() => expandDirective(ctx, "diagnostic E0000", page)).toThrow(/not a code of the catalogue/);
    expect(expandDirective(ctx, "diagnostic E5074", page)).toBe("`MTEK-E5074` (field access through entity_ref)");
  });
});

describe("the forms of a fence", () => {
  const fence = (info: string, body = "", page = "docs/p.md", line = 1): Fence => ({ page, line, ...parseInfo(info), body });

  it("parses an info string into language, attributes and flags", () => {
    const info = parseInfo("mtek wrong=MTEK-E5070,MTEK-E5071 wrap=entity nofmt");
    expect(info.lang).toBe("mtek");
    expect(info.attrs.get("wrong")).toBe("MTEK-E5070,MTEK-E5071");
    expect(info.attrs.get("wrap")).toBe("entity");
    expect([...info.flags]).toEqual(["nofmt"]);
    expect(parseInfo("").lang).toBe("");
  });

  it("extracts fences, including a fence of three inside one of four, and the prose outside them", () => {
    const text = "intro\n```mtek x=1\nfn f() {}\n```\nmiddle\n````md\n```mtek\ninner\n```\n````\nend\n";
    const fences = extractFences("docs/p.md", text);
    expect(fences.map((f) => [f.lang, f.line, f.body])).toEqual([
      ["mtek", 2, "fn f() {}"],
      ["md", 6, "```mtek\ninner\n```"],
    ]);
    expect(proseOf(text)).toBe("intro\nmiddle\nend\n");
  });

  it("wraps fragments in a scene with a camera and adds a scene to a program without one", () => {
    expect(wrapFragment("scene", "state a: i32 = 0;")).toContain("scene Demo {\n    camera Main {");
    expect(wrapFragment("scene", "state a: i32 = 0;")).toContain("    state a: i32 = 0;\n}");
    expect(wrapFragment("entity", "mesh: Box {};")).toContain("    entity Thing {\n        mesh: Box {};\n    }");
    expect(wrapFragment("update", "let x = dt;")).toContain("    update(dt: f32) {\n        let x = dt;\n    }");
    expect(() => wrapFragment("nope", "")).toThrow(/unknown wrap=nope/);
    expect(sourceOf(fence("mtek", "fn f() {}"))).toContain("scene Docs {");
    expect(sourceOf(fence("mtek", "scene Own {}"))).toBe("scene Own {}\n");
    expect(sceneName("export scene Own {}")).toBe("Own");
    expect(sceneName("fn f() {}")).toBeNull();
    expect(fullCode("E5070")).toBe("MTEK-E5070");
    expect(fullCode("MTEK-E5070")).toBe("MTEK-E5070");
  });

  it("applies a diff only when its context and removed lines occur exactly once", () => {
    const file = "a\nb\nc\nb\nd\n";
    expect(applyDiff(file, " a\n-b\n+x\n c")).toBe("a\nx\nc\nb\nd\n");
    expect(applyDiff(file, " c\n-b\n+y")).toBe("a\nb\nc\ny\nd\n");
    expect(applyDiff(file, "-b\n+x")).toBeNull();
    expect(applyDiff(file, " nothing\n+x")).toBeNull();
    expect(applyDiff(file, "x without a mark")).toBeNull();
    expect(applyDiff("a\n\nb\n", " a\n\n-b\n+c")).toBe("a\n\nc\n");
  });

  it("rejects the forms that are not documented", () => {
    expect(checkForm(fence("")).map((m) => m.message)).toEqual([expect.stringContaining("a fence without a language")]);
    expect(checkForm(fence("mtek colour=red")).length).toBe(1);
    expect(checkForm(fence("mtek frobnicate")).length).toBe(1);
    expect(checkForm(fence("mtek wrap=scene project=a file=x")).length).toBe(1);
    expect(checkForm(fence("mtek file=x")).length).toBe(1);
    expect(checkForm(fence("mtek project=a")).length).toBe(1);
    expect(checkForm(fence("diff")).length).toBe(1);
    expect(checkForm(fence("toml")).length).toBe(1);
    for (const ok of ["mtek", "mtek wrong=MTEK-E5070 wrap=update", "mtek nofmt", "mtek from=a.mtek", "mtek project=a file=src/main.mtek", "diff project=a", "toml manifest", "toml from=a.toml", "text", "console"]) {
      expect(checkForm(fence(ok)), ok).toEqual([]);
    }
  });

  it("holds a from= block to the repository file it names", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs-from-"));
    try {
      mkdirSync(join(dir, "ex"));
      writeFileSync(join(dir, "ex", "a.mtek"), "line one\r\nline two\r\nline three\r\n");
      expect(checkFrom(dir, fence("mtek from=ex/a.mtek", "line two\nline three"))).toEqual([]);
      expect(checkFrom(dir, fence("mtek from=ex/a.mtek", "line two\nline four")).map((m) => m.message)).toEqual([
        expect.stringContaining("does not contain the block"),
      ]);
      expect(checkFrom(dir, fence("mtek from=ex/missing.mtek", "x")).map((m) => m.message)).toEqual([expect.stringContaining("no such file")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A compiler that judges a source by its text: BAD is an error E3014, WARN a warning W5101, UGLY a layout the formatter changes. */
const fakeCompiler: Runner = (_command, args, options) => {
  const file = (name: string): string => {
    try {
      return readFileSync(join(options?.cwd ?? ".", name), "utf8");
    } catch {
      return "";
    }
  };
  const source = [file("src/main.mtek"), file("src/lib.mtek")].join("\n");
  const done = (stdout: string, code = 0): Promise<RunResult> => Promise.resolve({ code, stdout, stderr: "" });
  if (args[0] === "check") {
    const diagnostics = [
      ...(source.includes("BAD") ? [{ code: "MTEK-E3014", severity: "error", message: "the operator is not defined" }] : []),
      ...(source.includes("WARN") ? [{ code: "MTEK-W5101", severity: "warning", message: "alpha is ignored" }] : []),
    ];
    return done(JSON.stringify({ diagnostics }), diagnostics.some((d) => d.severity === "error") ? 1 : 0);
  }
  if (args[0] === "fmt" && args[1] === "--check") return done("would reformat src/main.mtek\n", source.includes("UGLY") ? 1 : 0);
  return done("");
};

describe("compiling the blocks", () => {
  const run = (text: string) => checkDocCode({ root, mtek: "fake", language: "0.1", runner: fakeCompiler }, [{ path: "docs/p.md", text }], 2);
  const messages = async (text: string): Promise<string[]> => (await run(text)).map((m) => m.message);

  it("passes a program that compiles and a wrong block that raises exactly its code", async () => {
    expect(await messages("```mtek\nscene A {}\n```\n```mtek wrong=MTEK-E3014\nBAD\n```\n```mtek warn=MTEK-W5101\nWARN\n```\n")).toEqual([]);
  });

  it("fails a program that does not compile, and names the compiler's code", async () => {
    const found = await messages("```mtek\nBAD\n```\n");
    expect(found).toEqual([expect.stringContaining("docs/p.md line 1 says a program that compiles, but mtek check says MTEK-E3014")]);
  });

  it("fails a wrong block that stopped being wrong, or is wrong in another way", async () => {
    expect((await messages("```mtek wrong=MTEK-E3014\nfine\n```\n"))[0]).toContain("errors exactly MTEK-E3014");
    expect((await messages("```mtek wrong=MTEK-E5070\nBAD\n```\n"))[0]).toContain("missing MTEK-E5070");
    expect((await messages("```mtek wrong=MTEK-E3014\nBAD\n```\n```mtek wrong=MTEK-E3014,MTEK-E5070\nBAD\n```\n")).length).toBe(1);
  });

  it("fails a warning nobody listed, and a listed warning that did not occur", async () => {
    expect((await messages("```mtek\nWARN\n```\n"))[0]).toContain("list an intended warning as warn=CODE");
    expect((await messages("```mtek warn=MTEK-W5101\nquiet\n```\n"))[0]).toContain("warning MTEK-W5101");
  });

  it("holds whole programs to the canonical layout, and excuses fragments and nofmt blocks", async () => {
    expect((await messages("```mtek\nUGLY\n```\n"))[0]).toContain("canonical layout (mtek fmt)");
    expect(await messages("```mtek nofmt\nUGLY\n```\n```mtek wrap=update\nUGLY\n```\n")).toEqual([]);
  });

  it("checks the steps of a project in order and fails a diff that does not apply", async () => {
    const ok = "```mtek project=p file=src/main.mtek\nscene A {\n    x\n}\n```\n```diff project=p\n scene A {\n-    x\n+    y\n }\n```\n";
    expect(await messages(ok)).toEqual([]);
    const bad = "```mtek project=p file=src/main.mtek\nscene A {}\n```\n```diff project=p\n-nothing like it\n+x\n```\n";
    expect((await messages(bad))[0]).toContain("a diff that applies to src/main.mtek");
    const broken = "```mtek project=p file=src/main.mtek\nscene A {}\n```\n```diff project=p wrong=MTEK-E3014\n scene A {}\n+BAD\n```\n";
    expect(await messages(broken)).toEqual([]);
  });

  it("does not compile a from= block, a manifest-less toml or an unchecked language", async () => {
    expect(await messages("```text\nBAD\n```\n```console\nBAD\n```\n```mtek from=README.md\n# Mtek\n```\n")).toEqual([]);
  });

  it("reports a fence in a form that is not documented", async () => {
    expect((await messages("```\nplain\n```\n"))[0]).toContain("a fence without a language");
  });
});

describe("the checks of the pages", () => {
  const concept = (extra = ""): string =>
    [
      "# Title",
      "",
      "## Rules",
      "",
      "1. A rule.",
      "",
      "## Why",
      "",
      "Because.",
      "",
      "## Examples",
      "",
      "```mtek",
      "scene A {}",
      "```",
      "",
      "## Common mistakes",
      "",
      "```mtek wrong=MTEK-E5070",
      "BAD",
      "```",
      "",
      "It raises `MTEK-E5070`.",
      "",
      "## See also",
      "",
      "- [index](../README.md)",
      extra,
      "",
    ].join("\n");
  const base = (): DocPageInputs => ({
    pages: [
      { path: "docs/README.md", text: "# Docs\n\n[c](concepts/c.md) [g](language-guide.md)\n" },
      { path: "docs/concepts/c.md", text: concept() },
      { path: "docs/language-guide.md", text: "# Guide\n" },
    ],
    linkable: [],
    catalogue,
    indexPath: "docs/README.md",
    indexedPages: ["docs/concepts/c.md", "docs/language-guide.md"],
    guidePath: "docs/language-guide.md",
    exposure: { text: "-1.9145305", expected: Math.fround(-Math.log2(1.2 * Math.PI)) },
  });
  const withPage = (i: DocPageInputs, path: string, text: string): DocPageInputs => ({ ...i, pages: i.pages.map((p) => (p.path === path ? { path, text } : p)) });
  const checks = (i: DocPageInputs): string[] => checkDocPages(i).map((m) => m.check);

  it("accepts a well formed set of pages", () => {
    expect(checkDocPages(base()).map((m) => m.message)).toEqual([]);
  });

  it("fails a concept page that lacks a section, or has no wrong example under the common mistakes", () => {
    const missing = concept().replace("## Why\n\nBecause.\n\n", "");
    expect(checkDocPages(withPage(base(), "docs/concepts/c.md", missing)).map((m) => m.message)).toEqual([
      expect.stringContaining('a section "## Why"'),
    ]);
    const noWrong = concept().replace("mtek wrong=MTEK-E5070", "mtek");
    expect(checks(withPage(base(), "docs/concepts/c.md", noWrong))).toContain("docs/structure");
    expect(checks(withPage(base(), "docs/concepts/c.md", concept().replace("# Title", "Title")))).toContain("docs/structure");
  });

  it("fails a wrong block whose code the prose never names, and a code that is not in the catalogue", () => {
    const silent = concept().replace("It raises `MTEK-E5070`.", "It fails.");
    expect(checks(withPage(base(), "docs/concepts/c.md", silent))).toEqual(["docs/wrong-cited"]);
    expect(checks(withPage(base(), "docs/concepts/c.md", concept("See MTEK-E0000.")))).toContain("docs/cited-codes");
  });

  it("fails words that make a claim about speed, cost or the benchmark", () => {
    for (const word of ["It is faster.", "The benchmark shows it.", "Good performance.", "Reads benchmarks/tasks/x.", "Saves token cost."]) {
      expect(checks(withPage(base(), "docs/concepts/c.md", concept(word))), word).toContain("docs/claims");
    }
    expect(checks(withPage(base(), "docs/concepts/c.md", concept("Tokens are lexical items.")))).not.toContain("docs/claims");
  });

  it("fails an index that leaves a page out", () => {
    const found = checkDocPages(withPage(base(), "docs/README.md", "# Docs\n\n[g](language-guide.md)\n"));
    expect(found.map((m) => m.check)).toEqual(["docs/index"]);
    expect(found[0]?.message).toContain("docs/concepts/c.md");
  });

  it("fails a guide above the size limit, naming both numbers", () => {
    const big = `# Guide\n${"x".repeat(GUIDE_MAX_BYTES)}\n`;
    const found = checkDocPages(withPage(base(), "docs/language-guide.md", big));
    expect(found.map((m) => m.check)).toEqual(["docs/guide-size"]);
    expect(found[0]?.message).toContain(`at most ${String(GUIDE_MAX_BYTES)} bytes`);
    expect(checks(withPage(base(), "docs/language-guide.md", `# Guide\n${"x".repeat(GUIDE_MAX_BYTES - 9)}\n`))).toEqual([]);
  });

  it("fails an anchor that no heading has, in the page itself and in another page", () => {
    const own = concept("[x](#nowhere) [y](#why)");
    expect(checkDocPages(withPage(base(), "docs/concepts/c.md", own)).map((m) => m.message)).toEqual([expect.stringContaining("#nowhere")]);
    const other = withPage(base(), "docs/README.md", "# Docs\n\n[c](concepts/c.md#common-mistakes) [d](concepts/c.md#nothing) [g](language-guide.md)\n");
    expect(checkDocPages(other).map((m) => m.message)).toEqual([expect.stringContaining("concepts/c.md#nothing")]);
  });

  it("fails a formula that does not give the registry's default exposure", () => {
    expect(checks({ ...base(), exposure: { text: "-1.5", expected: base().exposure.expected } })).toEqual(["docs/exposure-formula"]);
  });

  it("makes GitHub anchors from headings, with code and punctuation dropped", () => {
    expect(slug("Part C. Features of this build (168)")).toBe("part-c-features-of-this-build-168");
    expect(slug("`bind` and state")).toBe("bind-and-state");
    expect(headingsOf("# A\n```text\n# not a heading\n```\n## B\n")).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
  });
});
