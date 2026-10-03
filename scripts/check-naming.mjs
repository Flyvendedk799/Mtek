// Naming check (decision 0017): the language is called Mtek. The retired placeholder name must not
// appear in any tracked file except the two records that explain the rename.
//
// The pattern is assembled from two halves so that this file does not match itself.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = new RegExp("au" + "ra", "i");
const EXEMPT = new Set([
  "spec/decisions/0017-language-name.md",
  "spec/decisions/sources.md",
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tracked files plus new files that are not ignored (so the check also works before a commit).
const listing = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const files = [...new Set(listing.split("\0").filter((name) => name.length > 0))].sort();

const violations = [];
for (const file of files) {
  if (EXEMPT.has(file)) continue;
  let data;
  try {
    data = readFileSync(resolve(root, file));
  } catch (error) {
    // A file deleted in the working tree but still listed by the index is not a violation.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }
  if (data.includes(0)) continue; // binary file
  const lines = data.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (FORBIDDEN.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error("Naming check failed: the language is called Mtek. Offending lines:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`Naming check passed (${files.length} files scanned).`);
