// Counts the lines of TypeScript source of the baseline, excluding blank lines and comment-only
// lines (`//` lines and `/* ... */` blocks). Usage: `node tools/count-lines.ts` (prints JSON).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Number of lines of `text` that contain code (neither blank nor inside/only a comment). */
export function countCodeLines(text: string): number {
  let inBlock = false;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw;
    let hasCode = false;
    while (rest.length > 0) {
      if (inBlock) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          rest = "";
        } else {
          inBlock = false;
          rest = rest.slice(end + 2);
        }
        continue;
      }
      const trimmed = rest.trimStart();
      if (trimmed.length === 0) break;
      if (trimmed.startsWith("//")) break;
      if (trimmed.startsWith("/*")) {
        inBlock = true;
        rest = trimmed.slice(2);
        continue;
      }
      hasCode = true;
      break;
    }
    if (hasCode) count += 1;
  }
  return count;
}

export interface SizeReport {
  readonly files: Readonly<Record<string, number>>;
  readonly total: number;
}

/** Counts every `.ts` file directly inside `dir`, keyed by file name (sorted). */
export function measureDirectory(dir: string): SizeReport {
  const files: Record<string, number> = {};
  let total = 0;
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".ts")).sort()) {
    const lines = countCodeLines(readFileSync(join(dir, name), "utf8"));
    files[name] = lines;
    total += lines;
  }
  return { files, total };
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const root = join(import.meta.dirname, "..");
  console.log(JSON.stringify(measureDirectory(join(root, "src")), null, 2));
}
