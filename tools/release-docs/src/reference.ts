// docs/language-reference.md (decision 0100): nothing in it is typed by hand.
//
//   Part A  the normative text of spec/language.md, verbatim (headings demoted by one level)
//   Part B  the standard library, from the registry (spec/stdlib-schema.json)
//   Part C  the features this build supports, from `mtek context`
//   Part D  the diagnostic code ranges, from spec/diagnostics.md and its catalogue
import type { Ctx } from "./ctx.ts";
import { GENERATED_NOTE, code, demoteHeadings, repoLink, table } from "./md.ts";
import { section, tableRows } from "./spectext.ts";

export const REFERENCE_DOC = "docs/language-reference.md";

/** The normative sections of spec/language.md: everything after the metadata block. */
export function languageBody(languageMd: string): string {
  const marker = "\n---\n";
  const at = languageMd.indexOf(marker);
  if (at < 0) throw new Error("spec/language.md: no '---' line after the metadata block");
  const conventions = languageMd.split("\n").find((line) => line.startsWith("Conventions in this document")) ?? "";
  const body = languageMd.slice(at + marker.length).trim();
  return `${conventions}\n\n${demoteHeadings(body, 1)}`.trim();
}

function schemaFields(ctx: Ctx): string[] {
  const out: string[] = [];
  const categories = [...new Set(ctx.registry.schemas.map((s) => s.category))];
  for (const category of categories) {
    out.push(`#### Schemas of the category \`${category}\``, "");
    for (const schema of ctx.registry.schemas.filter((s) => s.category === category)) {
      out.push(`##### ${code(schema.name)}`, "", schema.doc, "");
      if (schema.fields.length === 0) {
        out.push("No fields.", "");
        continue;
      }
      out.push(
        table(
          ["Field", "Type", "Default", "Required", "Update", "Range", "Description"],
          schema.fields.map((f) => [
            code(f.name),
            code(f.type),
            f.default === null ? "none" : code(f.default),
            f.required ? "yes" : "no",
            f.constructionOnly ? "construction only" : [f.writable ? "writable" : "read-only", f.bindable ? "bindable" : ""].filter((x) => x !== "").join(", "),
            f.range ?? "",
            f.doc,
          ]),
        ),
        "",
      );
    }
  }
  return out;
}

function standardLibrary(ctx: Ctx): string[] {
  const r = ctx.registry;
  const out: string[] = [];
  out.push(
    "## Part B. The standard library",
    "",
    `Generated from ${repoLink("spec/stdlib-schema.json")} (registry version ${String(r.registryVersion)}, language version ${r.languageVersion}), the file the compiler is built from. The prose is ${repoLink("spec/stdlib.md")}.`,
    "",
    "### Types",
    "",
    table(
      ["Type", "Kind", "GPU", "Fields", "Methods", "Description"],
      r.types.map((t) => [
        code(t.name),
        t.kind,
        t.gpu ? "yes" : "no",
        t.fields.map((f) => `${f.name}: ${f.type}`).join("; "),
        t.methods.map((m) => m.name).join(", "),
        t.doc,
      ]),
    ),
    "",
    "Type classes used in signatures: " + r.typeClasses.map((c) => `${code(c.name)} = ${c.members.map((m) => code(m)).join(", ")}`).join("; ") + ".",
    "",
    "### Schemas",
    "",
    "Descriptor literals (`Name { field: value; }`) construct these. The *Update* column says how a field may change: *construction only* fields are constant data, *writable* fields can be assigned in handlers, *bindable* fields can be driven by `bind(...)`.",
    "",
    ...schemaFields(ctx),
    "### Scene objects",
    "",
    table(
      ["Keyword", "Schema", "Description"],
      r.sceneObjects.map((s) => [code(s.keyword), code(s.schema), s.doc]),
    ),
    "",
    "### Events",
    "",
    table(
      ["Event", "Form", "Argument", "Allowed in", "Needs a collider", "Description"],
      r.events.map((e) => [code(e.name), e.form, e.argumentType === null ? "none" : code(e.argumentType), e.allowedIn.join(", "), e.requiresCollider ? "yes" : "no", e.doc]),
    ),
    "",
    "### Enums",
    "",
  );
  for (const e of r.enums) {
    out.push(`#### ${code(e.name)}`, "", e.doc, "", table(["Member", "DOM `KeyboardEvent.code`"], e.members.map((m) => [code(`${e.name}.${m.name}`), code(m.code)])), "");
  }
  out.push("### Namespaces", "");
  for (const ns of r.namespaces) {
    out.push(
      `#### ${code(ns.name)}`,
      "",
      ns.doc,
      "",
      table(
        ["Member", "Kind", "Signatures", "Domain", "Constant", "Description"],
        ns.members.map((m) => [
          code(`${ns.name}.${m.name}`),
          m.kind,
          m.kind === "value" ? code(m.type ?? "?") : (m.signatures ?? []).map((s) => code(s)).join("<br>"),
          m.domain,
          m.constEligible === true ? "yes" : "no",
          m.doc,
        ]),
      ),
      "",
    );
  }
  out.push(
    "### Intrinsic functions",
    "",
    "Domain `both` runs on the CPU and the GPU, `cpu` only on the CPU, `gpu` only in material stages. *Constant* functions can be folded by the compiler. *Handlers only* functions can be called from handlers and lifecycle functions only.",
    "",
    table(
      ["Function", "Signatures", "Domain", "Constant", "Handlers only", "Description"],
      r.intrinsics.map((f) => [code(f.name), f.signatures.map((s) => code(s)).join("<br>"), f.domain, f.constEligible ? "yes" : "no", f.handlersOnly ? "yes" : "no", f.doc]),
    ),
    "",
    "### Body commands and properties",
    "",
    table(
      ["Command", "Parameters", "Applies to", "Description"],
      r.bodyCommands.map((c) => [code(c.name), c.params.map((p) => `${p.name}: ${p.type}`).join(", "), c.appliesTo.join(", "), c.doc]),
    ),
    "",
    table(
      ["Property", "Type", "Applies to", "Description"],
      r.bodyProperties.map((p) => [code(p.name), code(p.type), p.appliesTo.join(", "), p.doc]),
    ),
    "",
  );
  return out;
}

/** Group the features by prefix. The constructs of the resolver have no prefix. */
export function groupFeatures(features: readonly string[]): { name: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const feature of features) {
    const colon = feature.indexOf(":");
    const key = colon < 0 ? "construct" : feature.slice(0, colon);
    const list = groups.get(key) ?? [];
    list.push(feature);
    groups.set(key, list);
  }
  const order = ["construct", ...[...groups.keys()].filter((k) => k !== "construct").sort()];
  return order.map((name) => ({ name, items: groups.get(name) ?? [] }));
}

const GROUP_TITLES: Record<string, string> = {
  construct: "Language constructs",
  "body-command": "Body commands",
  "body-property": "Body properties",
  enum: "Enums",
  event: "Events",
  function: "Functions",
  method: "Type methods",
  namespace: "Namespaces",
  schema: "Schemas",
  "scene-object": "Scene objects",
  type: "Types",
  value: "Namespace values",
};

function featuresPart(ctx: Ctx): string[] {
  const features = ctx.compiler.features;
  const out: string[] = [
    `## Part C. Features of this build (${String(features.length)})`,
    "",
    "The list below is `supported.features` of `mtek context`, printed by the compiler this document was generated with. It is derived by the compiler from its construct table and from the registry, never typed in. A feature is supported when a test that would fail without it passes in a recorded environment (`spec/testing.md`); `docs/coverage-matrix.md` shows which program or fixture exercises each one.",
    "",
  ];
  for (const group of groupFeatures(features)) {
    out.push(`### ${GROUP_TITLES[group.name] ?? group.name} (${String(group.items.length)})`, "", group.items.map((f) => code(f)).join(" "), "");
  }
  out.push(
    "What the build does **not** support is on [limitations.md](limitations.md); `supported.notSupported` of `mtek context` has the same list.",
    "",
  );
  return out;
}

function diagnosticsPart(ctx: Ctx): string[] {
  const md = ctx.text("spec/diagnostics.md");
  const ranges = tableRows(section(md, "## 3. Code ranges"));
  const count = (digit: string): number => ctx.catalogue.filter((c) => c.code[1] === digit).length;
  return [
    `## Part D. Diagnostics (${String(ctx.catalogue.length)} codes)`,
    "",
    `Every diagnostic has a stable code: \`E\` for an error, \`W\` for a warning, then four digits; the first digit is the area. The full catalogue, the JSON form (\`mtek check --format json\`), the human rendering and the suggested edits are in ${repoLink("spec/diagnostics.md")}.`,
    "",
    table(
      ["Range", "Area", "Codes"],
      ranges.map((row) => {
        const digit = /(\d)xxx/.exec(row[0] ?? "")?.[1] ?? "";
        return [row[0] ?? "", row[1] ?? "", String(count(digit))];
      }),
    ),
    "",
    "Within each range the `x9xx` codes mean \"specified as not supported in v0.1\"; all of them are listed, with their reasons, on [limitations.md](limitations.md).",
    "",
  ];
}

export function renderReference(ctx: Ctx): string {
  const out: string[] = [
    "# Mtek language reference (v0.1)",
    "",
    GENERATED_NOTE(REFERENCE_DOC),
    "",
    "- Status: generated; `npm run check:release` fails when this file is stale or disagrees with the compiler (decisions 0100 and 0101).",
    `- Language version: ${ctx.compiler.contextLanguage}.`,
    `- Compiler: ${ctx.compiler.versionLine}.`,
    "- Companion pages: [language-guide.md](language-guide.md) (a tour with real programs), [limitations.md](limitations.md) (what v0.1 does not do), [coverage-matrix.md](coverage-matrix.md) (what exercises each feature).",
    "",
    "| Part | Source |",
    "|---|---|",
    `| A. The core language | ${repoLink("spec/language.md")}, verbatim |`,
    `| B. The standard library | ${repoLink("spec/stdlib-schema.json")}, the registry the compiler is built from |`,
    "| C. Features of this build | `mtek context`, `supported.features` |",
    `| D. Diagnostics | ${repoLink("spec/diagnostics.md")} |`,
    "",
    "## Part A. The core language",
    "",
    "The text below is the normative language reference of v0.1, copied from `spec/language.md` by the generator. The other specification documents (`scenes.md`, `materials.md`, `assets.md`, `physics.md`, `runtime-abi.md`) are in the [`spec/`](../spec/README.md) directory.",
    "",
    languageBody(ctx.text("spec/language.md")),
    "",
    ...standardLibrary(ctx),
    ...featuresPart(ctx),
    ...diagnosticsPart(ctx),
  ];
  return out.join("\n").replace(/\n\n\n+/g, "\n\n").trimEnd() + "\n";
}

/** The features listed in Part C of a rendered reference. */
export function featuresInReference(doc: string): string[] {
  const start = doc.indexOf("\n## Part C.");
  if (start < 0) return [];
  const end = doc.indexOf("\n## Part D.", start);
  const part = doc.slice(start, end < 0 ? undefined : end);
  const names: string[] = [];
  for (const line of part.split("\n")) {
    if (!/^`[^`]+`( `[^`]+`)*$/.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) names.push(m[1] ?? "");
  }
  return names;
}

/** The count in the heading of Part C of a rendered reference. */
export function featureCountInReference(doc: string): number | null {
  const m = /^## Part C\. Features of this build \((\d+)\)$/m.exec(doc);
  return m === null ? null : Number(m[1]);
}
