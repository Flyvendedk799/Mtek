// `coverage-matrix [--write] [--print]`: derive the matrix, judge the assertions of M7-02 and compare
// the result with `docs/coverage-matrix.md`.
//
//   (no flag)  fail (exit 1) if an assertion fails or the committed document is stale
//   --write    write the document, then judge the assertions
//   --print    print the document to standard output instead of comparing it
//
// Exit codes: 0 every assertion holds and the document is current; 1 an assertion fails or the document
// is stale; 3 the compiler or its helper cannot be found.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, committed, DOCUMENT } from "./audit.ts";
import { findMtek, findUses, repoRoot } from "./tools.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** What is wrong with the committed document, or null when it is what the tool would write. */
export function staleness(current: string | null, generated: string): string | null {
  if (current === null) return `${DOCUMENT} does not exist; run \`npm run generate -w @mtek/coverage-matrix\``;
  if (current !== generated) return `${DOCUMENT} is stale; run \`npm run generate -w @mtek/coverage-matrix\` and commit the result`;
  return null;
}

export async function runCli(
  argv: readonly string[],
  io: Io,
  root: string = repoRoot(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const flags = new Set(argv);
  for (const flag of flags) {
    if (!["--write", "--print"].includes(flag)) {
      io.err(`error: unknown argument ${flag}\nusage: coverage-matrix [--write] [--print]\n`);
      return 3;
    }
  }
  const mtek = findMtek(env);
  if (mtek === null) {
    io.err("error: no mtek executable: build one (npm run build), or name it with MTEK_BIN\n");
    return 3;
  }
  const uses = findUses(env);
  if (uses === null) {
    io.err("error: no coverage-uses helper: `cargo build -p mtek-coverage-uses --locked` failed, or name one with MTEK_COVERAGE_USES\n");
    return 3;
  }
  const { matrix, text } = await audit(root, { mtek, uses });
  if (flags.has("--print")) {
    io.out(text);
    for (const problem of matrix.problems) io.err(`  - ${problem}\n`);
    return matrix.problems.length === 0 ? 0 : 1;
  }
  if (flags.has("--write")) {
    mkdirSync(dirname(join(root, DOCUMENT)), { recursive: true });
    writeFileSync(join(root, DOCUMENT), text, "utf8");
    io.out(`wrote ${DOCUMENT}\n`);
  }
  const problems = [...matrix.problems];
  if (!flags.has("--write")) {
    const stale = staleness(committed(root), text);
    if (stale !== null) problems.push(stale);
  }
  const features = matrix.features.length;
  io.out(
    `coverage-matrix: ${features} features, ${matrix.positive} positive fixture programs, ${matrix.codes.catalogue.length} diagnostic codes ` +
      `(${matrix.codes.uncovered.length} without a negative test)\n`,
  );
  if (problems.length > 0) {
    io.err(`coverage-matrix: ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
    for (const problem of problems) io.err(`  - ${problem}\n`);
    return 1;
  }
  io.out("coverage-matrix: every assertion holds\n");
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runCli(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
  process.exitCode = code;
}
