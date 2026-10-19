// The generated documents: what the generator writes, and whether the committed files are what it
// would write.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { GUIDE_DOC, renderGuide } from "./guide.ts";
import { LIMITATIONS_DOC, renderLimitations } from "./limitations.ts";
import { mismatch, type Mismatch } from "./model.ts";
import { renderPages } from "./pages.ts";
import { REFERENCE_DOC, renderReference } from "./reference.ts";

export const GENERATED_DOCS = [GUIDE_DOC, REFERENCE_DOC, LIMITATIONS_DOC] as const;

/** Every generated document, by path: the three named above and every page written from `templates/pages` (decision 0116). */
export function generateDocs(ctx: Ctx): Map<string, string> {
  const docs = new Map<string, string>();
  docs.set(GUIDE_DOC, renderGuide(ctx));
  docs.set(REFERENCE_DOC, renderReference(ctx));
  docs.set(LIMITATIONS_DOC, renderLimitations(ctx));
  for (const [path, text] of renderPages(ctx)) docs.set(path, text);
  return docs;
}

/** A committed file with line endings normalised, or null when there is none. */
export function committedDoc(root: string, path: string): string | null {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, "utf8").replace(/\r\n/g, "\n") : null;
}

export function writeDocs(root: string, docs: ReadonlyMap<string, string>): void {
  for (const [path, text] of docs) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, "utf8");
  }
}

/** The first line at which two texts differ, for the message of a stale document. */
export function firstDifference(committed: string, generated: string): { line: number; committed: string; generated: string } {
  const a = committed.split("\n");
  const b = generated.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { line: i + 1, committed: a[i] ?? "(end of file)", generated: b[i] ?? "(end of file)" };
  }
  return { line: 0, committed: "", generated: "" };
}

function clip(text: string): string {
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

/** One finding per document that is missing or differs from what the generator writes. */
export function staleDocs(root: string, docs: ReadonlyMap<string, string>): Mismatch[] {
  const found: Mismatch[] = [];
  for (const [path, generated] of docs) {
    const current = committedDoc(root, path);
    if (current === null) {
      found.push(
        mismatch("docs/stale", { where: "tools/release-docs (the generator)", value: `writes ${path}` }, { where: path, value: "no such file" }, "run `npm run generate -w @mtek/release-docs`"),
      );
    } else if (current !== generated) {
      const d = firstDifference(current, generated);
      found.push(
        mismatch(
          "docs/stale",
          { where: "tools/release-docs (the generator)", value: `line ${String(d.line)} is ${JSON.stringify(clip(d.generated))}` },
          { where: path, value: `line ${String(d.line)} is ${JSON.stringify(clip(d.committed))}` },
          "run `npm run generate -w @mtek/release-docs` and commit the result",
        ),
      );
    }
  }
  return found;
}
