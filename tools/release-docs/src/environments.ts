// The supported-environments page lists only what has stored evidence (decision 0107, M7-03).
//
// `docs/supported-environments.md` is written by hand from the summaries of the stored runs, and this check
// holds it to that, as `releasenotes.ts` holds the release notes (decision 0104). A *claim* is a bullet or a
// table row outside the section "How to read this page". Every claim must
//   * link to at least one file under `evidence/M7/environments/`, and every link to a file of the repository
//     must resolve;
//   * contain only numbers (two digits or more) that occur in at least one file it links to;
// and every environment record (`environment-*.json`) stored under `evidence/M7/environments/` must be linked
// from some claim, so that the page lists everything that was recorded and nothing that was not.
import { mismatch, type Mismatch } from "./model.ts";
import { claimsOf, linksOf, numbersOf, prose, resolveTarget, type NotesIo } from "./releasenotes.ts";

export const ENVIRONMENTS_DOC = "docs/supported-environments.md";
export const ENVIRONMENTS_DIR = "evidence/M7/environments/";
const EXEMPT = [/^how to read/i];

export interface EnvironmentsIo extends NotesIo {
  /** Repository paths of every `environment-*.json` below `evidence/M7/environments/`. */
  records: () => string[];
}

export function checkSupportedEnvironments(markdown: string | null, io: EnvironmentsIo): Mismatch[] {
  const found: Mismatch[] = [];
  const doc = ENVIRONMENTS_DOC;
  if (markdown === null) {
    found.push(mismatch("environments/missing", { where: ENVIRONMENTS_DIR, value: `${String(io.records().length)} environment records` }, { where: doc, value: "no such page" }));
    return found;
  }
  const claims = claimsOf(markdown, EXEMPT);
  if (claims.length === 0) {
    found.push(mismatch("environments/claims", { where: doc, value: "no claim at all" }, { where: ENVIRONMENTS_DIR, value: "stored runs to list" }));
  }
  const linked = new Set<string>();
  for (const claim of claims) {
    const at = `${doc} line ${String(claim.line)}`;
    const shown = claim.text.length > 90 ? `${claim.text.slice(0, 87)}...` : claim.text;
    const files: { path: string; text: string }[] = [];
    let hasEnvironmentEvidence = false;
    for (const link of linksOf(claim.text)) {
      const path = resolveTarget(link.target);
      if (path === null) continue;
      if (!io.exists(path)) {
        found.push(mismatch("environments/link", { where: at, value: `links to ${link.target}` }, { where: path, value: "no such file" }));
        continue;
      }
      linked.add(path);
      if (path.startsWith(ENVIRONMENTS_DIR)) hasEnvironmentEvidence = true;
      files.push({ path, text: io.read(path) ?? "" });
    }
    if (!hasEnvironmentEvidence) {
      found.push(mismatch("environments/claim-without-evidence", { where: at, value: `the claim "${shown}"` }, { where: ENVIRONMENTS_DIR, value: "no link to a stored run" }));
      continue;
    }
    const haystack = new Set(files.flatMap((f) => numbersOf(f.text)));
    for (const number of new Set(numbersOf(prose(claim.text)))) {
      if (number.length < 2) continue;
      if (!haystack.has(number)) {
        found.push(mismatch("environments/number", { where: at, value: `the number ${number} in "${shown}"` }, { where: files.map((f) => f.path).join(", "), value: `nothing about ${number}` }));
      }
    }
  }
  for (const record of io.records()) {
    if (!linked.has(record)) {
      found.push(mismatch("environments/unlisted", { where: record, value: "a stored environment record" }, { where: doc, value: "does not list it" }));
    }
  }
  return found;
}
