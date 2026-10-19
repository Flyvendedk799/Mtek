// The release notes draft is hand-written from evidence, and this check holds it to that (decision 0104).
//
// A *claim* is a bullet or a table row of the document outside the preface and the section "About this
// draft". Every claim must either
//   * link to at least one file that exists and is evidence (under `evidence/`, `spec/`, `tests/`, a
//     `test` or `tests` directory, or a `*.test.*` / `*.spec.*` file), and every number in it must occur
//     in one of the files it links to; or
//   * be a placeholder: it starts with `**Pending: not yet measured.**`, names the evidence files that
//     will replace it in code spans, contains no number (a number there would be invented), and is stale
//     the moment one of those files exists.
import { posix } from "node:path";
import { mismatch, type Mismatch } from "./model.ts";

export const RELEASE_NOTES = "docs/release-notes-v0.1.md";
export const PENDING_MARK = "**Pending: not yet measured.**";
/** The work items whose results do not exist yet; a placeholder must name each. */
export const REQUIRED_PENDING = ["M7-03", "M7-04", "M7-05", "M7-07"] as const;

export interface NotesIo {
  exists: (path: string) => boolean;
  read: (path: string) => string | null;
}

export interface Claim {
  line: number;
  text: string;
  section: string;
}

const EXEMPT_SECTIONS = [/^about this draft/i];

/** The claims of the document: bullets and table rows outside the preface and exempt sections. */
export function claimsOf(markdown: string): Claim[] {
  const claims: Claim[] = [];
  let section = "";
  let fenced = false;
  const lines = markdown.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? "";
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^##+ (.*)$/.exec(line);
    if (heading !== null) {
      section = heading[1] ?? "";
      continue;
    }
    if (section === "" || EXEMPT_SECTIONS.some((re) => re.test(section))) continue;
    const bullet = /^\s*(?:[-*]|\d+\.) (.*)$/.exec(line);
    if (bullet !== null) {
      claims.push({ line: n + 1, text: bullet[1] ?? "", section });
      continue;
    }
    if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|?$/.test(line)) continue;
      const rows = lines[n + 1] ?? "";
      // the header row is followed by the separator row
      if (/^\|[\s:|-]+\|?$/.test(rows)) continue;
      claims.push({ line: n + 1, text: line.replace(/^\|\s*|\s*\|\s*$/g, ""), section });
    }
  }
  return claims;
}

export function linksOf(text: string): { label: string; target: string }[] {
  return [...text.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({ label: m[1] ?? "", target: m[2] ?? "" }));
}

export function isEvidencePath(path: string): boolean {
  return (
    /^(evidence|spec|tests)\//.test(path) ||
    /(^|\/)tests?\//.test(path) ||
    /\.(test|spec)\.[a-z]+$/.test(path) ||
    /^benchmarks\/baselines\/[^/]+\/RESULTS\.md$/.test(path)
  );
}

/** Digit groups of a text with the thousands separators of the evidence removed: `1 590` and `1,590` are 1590. */
export function numbersOf(text: string): string[] {
  const joined = text.replace(/(\d)[\s,](?=\d{3}(?!\d))/g, "$1");
  return [...joined.matchAll(/\d+/g)].map((m) => m[0]);
}

/** The text of a claim without what is not a statement of a measurement: code spans, link labels and targets, task ids. */
function prose(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, " ")
    .replace(/\bM\d-\d{2}\b/g, " ")
    .replace(/\bM\d\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(decisions?|section|sections|item|items|ADR) (\d+)/gi, " ")
    .replace(/\b(v|language|ABI|Node|Rust|version|mtek) ?\d+(\.\d+)*/gi, " ");
}

export function resolveTarget(target: string): string | null {
  if (/^[a-z]+:/.test(target) || target.startsWith("#")) return null;
  const path = target.split("#")[0] ?? "";
  return posix.normalize(posix.join("docs", path));
}

export function checkReleaseNotes(markdown: string, io: NotesIo): Mismatch[] {
  const found: Mismatch[] = [];
  const doc = RELEASE_NOTES;
  const claims = claimsOf(markdown);
  if (claims.length === 0) {
    found.push(mismatch("release-notes/claims", { where: doc, value: "no claim at all" }, { where: "tools/release-docs", value: "a draft with claims to check" }));
  }
  const pendingIds = new Set<string>();
  for (const claim of claims) {
    const at = `${doc} line ${String(claim.line)}`;
    const shown = claim.text.length > 90 ? `${claim.text.slice(0, 87)}...` : claim.text;
    if (claim.text.replace(/^\*\*[^*]*\*\*\s*/, "").startsWith(PENDING_MARK) || claim.text.includes(PENDING_MARK)) {
      const rest = claim.text;
      const specs = [...rest.matchAll(/`((?:evidence|tests|docs)\/[^`]+)`/g)].map((m) => m[1] ?? "");
      if (specs.length === 0) {
        found.push(mismatch("release-notes/pending", { where: at, value: `a placeholder: ${shown}` }, { where: doc, value: "no `evidence/...` path in code spans naming what will replace it" }));
      }
      for (const path of specs) {
        if (io.exists(path)) {
          found.push(mismatch("release-notes/pending-stale", { where: at, value: `still pending, waiting for ${path}` }, { where: path, value: "the file exists now: replace the placeholder with the result" }));
        }
      }
      if (/\d/.test(prose(rest))) {
        found.push(mismatch("release-notes/pending-number", { where: at, value: `a placeholder with a number: ${shown}` }, { where: "evidence/", value: "no measurement exists yet" }));
      }
      for (const id of rest.matchAll(/\bM\d-\d{2}\b/g)) pendingIds.add(id[0]);
      continue;
    }
    const links = linksOf(claim.text);
    const files: { target: string; path: string; text: string }[] = [];
    let hasEvidence = false;
    for (const link of links) {
      const path = resolveTarget(link.target);
      if (path === null) continue;
      if (!io.exists(path)) {
        found.push(mismatch("release-notes/link", { where: at, value: `links to ${link.target}` }, { where: path, value: "no such file" }));
        continue;
      }
      if (isEvidencePath(path)) hasEvidence = true;
      files.push({ target: link.target, path, text: io.read(path) ?? "" });
    }
    if (!hasEvidence) {
      found.push(mismatch("release-notes/claim-without-evidence", { where: at, value: `the claim "${shown}"` }, { where: doc, value: "no link to a file under evidence/, spec/ or tests/ (or a test file)" }));
      continue;
    }
    const haystack = new Set(files.flatMap((f) => numbersOf(f.text)));
    for (const number of new Set(numbersOf(prose(claim.text)))) {
      if (number.length < 2) continue;
      if (!haystack.has(number)) {
        found.push(
          mismatch("release-notes/number", { where: at, value: `the number ${number} in "${shown}"` }, { where: files.map((f) => f.path).join(", "), value: `nothing about ${number}` }),
        );
      }
    }
  }
  for (const id of REQUIRED_PENDING) {
    if (!pendingIds.has(id)) {
      found.push(mismatch("release-notes/pending-required", { where: "the work plan (M7)", value: `${id} has no result yet` }, { where: doc, value: `no placeholder for ${id}` }));
    }
  }
  return found;
}

/** The bold lead-ins of the bullets of "Unsupported / remaining" in an evidence report. */
export function remainingLeads(report: string): string[] {
  const start = report.indexOf("## Unsupported / remaining");
  if (start < 0) return [];
  const rest = report.slice(start + 1);
  const end = rest.indexOf("\n## ");
  const part = end < 0 ? rest : rest.slice(0, end);
  return [...part.matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => (m[1] ?? "").replace(/:$/, "").trim());
}

/** The known issues of the M6 report must all be in the notes, by their lead-in. */
export function checkKnownIssues(markdown: string, m6Report: string): Mismatch[] {
  const found: Mismatch[] = [];
  const flat = markdown.replace(/\s+/g, " ");
  for (const lead of remainingLeads(m6Report)) {
    if (!flat.includes(lead.replace(/\s+/g, " "))) {
      found.push(
        mismatch(
          "release-notes/known-issues",
          { where: "evidence/M6/report.md (Unsupported / remaining)", value: `lists "${lead}"` },
          { where: RELEASE_NOTES, value: "does not mention it" },
        ),
      );
    }
  }
  if (!/dev-overlay/.test(markdown)) {
    found.push(mismatch("release-notes/known-issues", { where: "evidence/M6/report.md (Unsupported / remaining)", value: "a red CI job: the dev-overlay spec" }, { where: RELEASE_NOTES, value: "does not mention dev-overlay" }));
  }
  return found;
}
