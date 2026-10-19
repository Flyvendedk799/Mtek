// docs/limitations.md (decision 0103).
//
// Derived: the `x9xx` codes (from the diagnostics catalogue), the gates and the reserved words (from
// `mtek context`), the codes that are specified but never produced (from the catalogue marks and
// tests/semantics/code-coverage-exceptions.json), and for each code its negative fixture (the same
// reader as tools/coverage-matrix).
// Hand-written, in tools/release-docs/data/limitations.json and anchored there: the reasons, and the
// documented restrictions of decisions 0015 and 0016 and of the specification.
import type { CatalogueEntry } from "../../coverage-matrix/src/diagnostics.ts";
import type { Ctx, LimitationsData, Restriction } from "./ctx.ts";
import { mismatch, type Mismatch } from "./model.ts";
import { languageWordLists } from "./spectext.ts";
import { GENERATED_NOTE, code, decisionLink, repoLink, table } from "./md.ts";

export const LIMITATIONS_DOC = "docs/limitations.md";

const X9XX = /^[EW]\d9\d\d$/;

/** The `x9xx` codes of the catalogue, in catalogue order, with the internal error `E9999` apart. */
export function x9xxCodes(catalogue: readonly CatalogueEntry[]): { unsupported: CatalogueEntry[]; internal: CatalogueEntry[] } {
  const matching = catalogue.filter((entry) => X9XX.test(entry.code));
  return {
    unsupported: matching.filter((entry) => entry.code !== "E9999"),
    internal: matching.filter((entry) => entry.code === "E9999"),
  };
}

/** What `mtek context` lists under `notSupported`, split by kind. */
export function splitNotSupported(
  notSupported: readonly string[],
  reservedWords: readonly string[],
): { gates: string[]; words: string[]; phrases: string[]; planned: string[] } {
  const words = notSupported.filter((item) => reservedWords.includes(item));
  const rest = notSupported.filter((item) => !reservedWords.includes(item));
  const planned = rest.filter((item) => /\(planned for M\d+\)$/.test(item));
  const gates = rest.filter((item) => /^[a-z]+(-[a-z]+)+$/.test(item));
  const phrases = rest.filter((item) => !planned.includes(item) && !gates.includes(item));
  return { gates, words, phrases, planned };
}

function sourceLine(file: string, quote: string): string {
  return `${repoLink(file)}: "${quote}"`;
}

function decisions(ctx: Ctx, numbers: readonly string[]): string {
  return numbers.map((n) => decisionLink(n, ctx.decisionFiles)).join(", ");
}

function fixtureCell(ctx: Ctx, entry: CatalogueEntry): string {
  const fixtures = ctx.fixtures.get(`MTEK-${entry.code}`);
  const first = fixtures?.[0];
  if (first === undefined) return "none: no program produces it";
  const extra = (fixtures?.length ?? 1) - 1;
  return `${repoLink(first.fixture, first.fixture)}${extra > 0 ? ` and ${String(extra)} more` : ""}`;
}

export function renderLimitations(ctx: Ctx): string {
  const { unsupported, internal } = x9xxCodes(ctx.catalogue);
  const reserved = languageWordLists(ctx.text("spec/language.md")).reserved;
  const split = splitNotSupported(ctx.compiler.notSupported, reserved);
  const data: LimitationsData = ctx.limits;
  const out: string[] = [];
  out.push("# Limitations of Mtek v0.1", "", GENERATED_NOTE(LIMITATIONS_DOC), "");
  out.push(
    "- Status: generated; `npm run check:release` fails when this file is stale or disagrees with the diagnostics catalogue or with `mtek context` (decisions 0101 and 0103).",
    `- Language version: ${ctx.compiler.contextLanguage}.`,
    `- Compiler: ${ctx.compiler.versionLine}.`,
    "",
  );
  out.push(
    "## 1. What this page is",
    "",
    "The release contract of v0.1 is what the specification promises **and** a test proves. Everything on this page is excluded from that contract: it is rejected on purpose, it is specified but not built, or it is a measured weakness. Nothing here is hidden behind a softer word, and nothing on this page works \"almost\".",
    "",
    "- Section 2 lists every `x9xx` diagnostic: the features that v0.1 refuses by name.",
    "- Section 3 lists what this compiler build rejects with `E9010` although the specification describes it.",
    "- Section 4 lists the reserved words.",
    "- Section 5 lists the diagnostics that are in the catalogue but that no program of v0.1 can produce.",
    "- Section 6 lists the documented restrictions of the specification and of decisions 0015 and 0016, by area.",
    "- Section 7 is the list `mtek context` gives to AI agents, verbatim.",
    "",
    "The reasons and the restrictions of sections 2, 3 and 6 are written by hand in `tools/release-docs/data/limitations.json`; each is anchored to a quotation of the specification that a test looks for, so a reason cannot outlive the sentence it rests on. Where the specification gives no reason beyond \"not in v0.1\", the entry says so.",
    "",
  );

  out.push(
    `## 2. Unsupported features: the \`x9xx\` diagnostics (${String(unsupported.length)})`,
    "",
    "`spec/diagnostics.md` section 3: within each range of codes, the `x9xx` codes mean \"specified as not supported in v0.1\". They are different from `E9010` (section 3 of this page) on purpose: a limit of the language is not a gap of the build.",
    "",
    table(
      ["Code", "Feature", "What triggers it", "Why", "Negative test"],
      unsupported.map((entry) => {
        const info = data.unsupportedCodes[entry.code];
        const reason = info === undefined ? "(no reason recorded)" : info.reason;
        return [code(entry.code), entry.title, entry.trigger.replace(/\*\*Reserved:\*\*\s*/, "Reserved: "), reason, fixtureCell(ctx, entry)];
      }),
    ),
    "",
  );
  for (const entry of internal) {
    out.push(
      `\`${entry.code}\` ("${entry.title}") also matches the pattern but is not an unsupported feature: ${data.internalErrorCodes[entry.code] ?? ""}`,
      "",
    );
  }

  out.push(
    "## 3. Gates of this build: specified, not implemented",
    "",
    "`E9010` means \"specified for v0.1 but not implemented by this compiler build yet\". These are the gates the build has; `mtek context` lists each under `notSupported`.",
    "",
  );
  for (const gate of split.gates) {
    const info = data.hardGates[gate];
    out.push(`### ${code(gate)}`, "");
    if (info === undefined) {
      out.push("(no description recorded)", "");
      continue;
    }
    out.push(
      `- Diagnostic: ${code(info.code)}.`,
      `- What is rejected: ${info.restriction}`,
      `- Why: ${info.reason}`,
      `- Records: ${decisions(ctx, info.decisions)}.`,
      `- Source: ${sourceLine(info.source.file, info.source.quote)}`,
      "",
    );
  }
  if (split.planned.length > 0) {
    out.push("Rows of the registry that the build has not reached yet (planned, hence not supported):", "", ...split.planned.map((p) => `- ${code(p)}`), "");
  }

  out.push(
    `## 4. Reserved words (${String(split.words.length)})`,
    "",
    `${data.reservedWords.reason} (${sourceLine(data.reservedWords.source.file, data.reservedWords.source.quote)})`,
    "",
    split.words.map((w) => code(w)).join(" "),
    "",
  );

  const neverProduced = ctx.exceptions.reserved;
  out.push(
    `## 5. Specified, but no program can produce the diagnostic (${String(neverProduced.length)})`,
    "",
    "These codes are in the catalogue and are marked there. Each stays in the catalogue so that the number is not reused; none has a negative test, because no program of v0.1 can reach it. `tests/semantics/code-coverage-exceptions.json` holds the reasons, and a test fails when one of these codes gains a fixture without leaving the list.",
    "",
    table(
      ["Code", "Title", "Mark in the catalogue", "Why no program produces it"],
      neverProduced.map((entry) => {
        const row = ctx.catalogue.find((c) => c.code === entry.code);
        return [code(entry.code), row?.title ?? "?", row?.mark === "not-implemented" ? "Not implemented" : "Reserved", entry.reason];
      }),
    ),
    "",
    ...(neverProduced.some((e) => e.code === "W0030")
      ? [
          "`W0030` is the one that the language reference used to promise: the formatter's naming lint. `spec/language.md` section 3.3 now says that the lint is not part of v0.1, and the catalogue keeps the code (decisions 0070 item 11 and 0102). The naming conventions of that section are conventions only; nothing checks them.",
          "",
        ]
      : []),
  );

  out.push("## 6. Documented restrictions", "");
  const areas = [...new Set(data.restrictions.map((r) => r.area))];
  for (const area of areas) {
    const rows: Restriction[] = data.restrictions.filter((r) => r.area === area);
    out.push(
      `### ${area}`,
      "",
      table(
        ["Restriction", "Why", "Diagnostics", "Records and source"],
        rows.map((r) => [
          r.restriction,
          r.reason,
          r.codes.length === 0 ? "none" : r.codes.map((c) => code(c)).join(", "),
          [...(r.decisions.length === 0 ? [] : [`decisions ${decisions(ctx, r.decisions)}`]), sourceLine(r.source.file, r.source.quote)].join("; "),
        ]),
      ),
      "",
    );
  }

  out.push(
    "## 7. The list `mtek context` gives to agents",
    "",
    "`supported.notSupported` of `mtek context`, in the order the compiler prints it. The consistency check compares this list with this page.",
    "",
    ...ctx.compiler.notSupported.map((item) => `- ${code(item)}`),
    "",
  );
  return out.join("\n");
}

/** The codes of the form `E1234` or `W1234` in a document. */
export function codesIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\b([EW]\d{4})\b/g)].map((m) => m[1] ?? ""))];
}

/** The part of a rendered limitations page between `heading` and the next `## `. */
export function limitationsSection(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}`);
  if (start < 0) return "";
  const next = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
}

/** Validate the hand-written data against the sources it is anchored to. */
export function validateLimitationsData(ctx: Ctx): Mismatch[] {
  const found: Mismatch[] = [];
  const known = new Set(ctx.catalogue.map((c) => c.code));
  const where = "tools/release-docs/data/limitations.json";
  const { unsupported } = x9xxCodes(ctx.catalogue);
  const derived = unsupported.map((u) => u.code);
  const written = Object.keys(ctx.limits.unsupportedCodes);
  for (const c of derived) {
    if (!written.includes(c)) {
      found.push(
        mismatch(
          "limitations/x9xx-reason",
          { where: "spec/diagnostics.md (catalogue)", value: `${c} is an unsupported-feature code` },
          { where, value: "no reason for it" },
        ),
      );
    }
  }
  for (const c of written) {
    if (!derived.includes(c)) {
      found.push(
        mismatch(
          "limitations/x9xx-reason",
          { where, value: `a reason for ${c}` },
          { where: "spec/diagnostics.md (catalogue)", value: `${c} is not an x9xx code` },
        ),
      );
    }
  }
  const check = (id: string, source: { file: string; quote: string }, codes: readonly string[], decisions: readonly string[]): void => {
    let text: string | null;
    try {
      text = ctx.text(source.file);
    } catch {
      text = null;
    }
    if (text === null) {
      found.push(mismatch("limitations/anchor", { where, value: `${id} cites ${source.file}` }, { where: source.file, value: "no such file" }));
    } else if (!text.includes(source.quote)) {
      found.push(
        mismatch("limitations/anchor", { where, value: `${id} quotes ${JSON.stringify(source.quote)}` }, { where: source.file, value: "no such sentence" }),
      );
    }
    for (const c of codes) {
      if (!known.has(c)) {
        found.push(mismatch("limitations/code", { where, value: `${id} cites ${c}` }, { where: "spec/diagnostics.md (catalogue)", value: `no code ${c}` }));
      }
    }
    for (const d of decisions) {
      if (!ctx.decisionFiles.some((f) => f.startsWith(`${d}-`))) {
        found.push(mismatch("limitations/decision", { where, value: `${id} cites decision ${d}` }, { where: "spec/decisions", value: `no decision ${d}` }));
      }
    }
  };
  for (const [c, info] of Object.entries(ctx.limits.unsupportedCodes)) {
    check(`unsupportedCodes.${c}`, info.source, [c], []);
    if (info.reason.trim() === "") found.push(mismatch("limitations/reason", { where, value: `${c} has an empty reason` }, { where: LIMITATIONS_DOC, value: "every code has a reason" }));
  }
  for (const [name, gate] of Object.entries(ctx.limits.hardGates)) {
    check(`hardGates.${name}`, gate.source, [gate.code], gate.decisions);
  }
  check("reservedWords", ctx.limits.reservedWords.source, [ctx.limits.reservedWords.code], []);
  const ids = new Set<string>();
  for (const r of ctx.limits.restrictions) {
    if (ids.has(r.id)) found.push(mismatch("limitations/restriction-id", { where, value: `id ${r.id}` }, { where, value: "the same id again" }));
    ids.add(r.id);
    check(r.id, r.source, r.codes, r.decisions);
    if (r.reason.trim() === "" || r.restriction.trim() === "") {
      found.push(mismatch("limitations/reason", { where, value: `${r.id} has an empty restriction or reason` }, { where: LIMITATIONS_DOC, value: "every restriction has a reason" }));
    }
  }
  return found;
}
