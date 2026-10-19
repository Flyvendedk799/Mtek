// The frozen workload definitions (spec/ai-and-benchmarks.md section 7, decision 0097).
//
// The definitions are everything that says WHAT is measured: the protocol, the scene formulas, each workload's
// description, its Mtek program, its direct-WebGPU and three.js implementations and the kits they share, and the
// generators of the Mtek programs and the generated assets. Their tree hash is recorded in `FROZEN.json` before any
// reported number is produced; a change is allowed only with a new entry that carries a rationale. The measurement tools
// (page, instrument, runner, report) are not definitions and are not hashed: a fix there is a normal commit, and every
// raw result records the commit it was produced by.
//
//   node tools/freeze.ts                    print the tree hash and the files it covers
//   node tools/freeze.ts --check            exit 1 unless the tree hash is the last one recorded in FROZEN.json
//   node tools/freeze.ts --record "<why>"   append an entry for the current tree (the first entry says "initial freeze")
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_ROOT, WORKLOADS } from "./paths.ts";

export const FROZEN_FILE = join(RUNTIME_ROOT, "FROZEN.json");

export const ALGORITHM =
  "sha256 over the lines `<path>\\0<sha256 of the file with CRLF turned into LF>\\n`, files sorted by path (bytewise), paths relative to benchmarks/runtime with forward slashes";

/** Files below the workload directories that are generated at preparation time and not part of the definition. */
const GENERATED = [/(^|\/)\.out(\/|$)/, /^asset-heavy-startup\/mtek\/(models|textures)\//, /(^|\/)dist(\/|$)/];

const FIXED_PATHS = ["protocol.json", "harness/kit", "harness/mtek-adapter.ts", "harness/floor.ts", "tools/gen-mtek.ts", "tools/assets.ts", "common"];

function listFiles(path: string, out: string[] = []): string[] {
  const full = join(RUNTIME_ROOT, path);
  if (!existsSync(full)) return out;
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    out.push(path);
    return out;
  }
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) listFiles(child, out);
    else out.push(child);
  }
  return out;
}

/** The paths (relative to `benchmarks/runtime`) that make up the frozen definitions, sorted bytewise. */
export function definitionFiles(): string[] {
  const files: string[] = [];
  for (const path of FIXED_PATHS) listFiles(path, files);
  for (const workload of WORKLOADS) listFiles(workload, files);
  return [...new Set(files)]
    .filter((p) => !GENERATED.some((pattern) => pattern.test(p)))
    .filter((p) => !p.endsWith(".test.ts"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function fileHash(path: string): string {
  const text = readFileSync(join(RUNTIME_ROOT, path), "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface FileHashes {
  readonly [path: string]: string;
}

export function hashFiles(paths: readonly string[] = definitionFiles()): FileHashes {
  return Object.fromEntries(paths.map((p) => [p, fileHash(p)]));
}

export function treeHashOf(files: FileHashes): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) hash.update(`${path}\0${files[path] as string}\n`, "utf8");
  return hash.digest("hex");
}

export interface FrozenEntry {
  readonly treeHash: string;
  readonly recordedAt: string;
  readonly rationale: string;
  /** The file hashes the tree hash was computed from, so a mismatch can name the files that changed. */
  readonly files: FileHashes;
}

export interface FrozenFile {
  readonly schemaVersion: 1;
  readonly algorithm: string;
  readonly entries: readonly FrozenEntry[];
}

export function readFrozen(): FrozenFile | null {
  if (!existsSync(FROZEN_FILE)) return null;
  return JSON.parse(readFileSync(FROZEN_FILE, "utf8")) as FrozenFile;
}

export interface FreezeStatus {
  readonly ok: boolean;
  readonly treeHash: string;
  readonly recordedHash: string | null;
  readonly problems: readonly string[];
}

/** Compares the current definitions with the last recorded entry. */
export function checkFrozen(frozen: FrozenFile | null = readFrozen(), files: FileHashes = hashFiles()): FreezeStatus {
  const treeHash = treeHashOf(files);
  const last = frozen?.entries[frozen.entries.length - 1];
  if (last === undefined) {
    return { ok: false, treeHash, recordedHash: null, problems: ["FROZEN.json has no entry: the definitions have not been frozen"] };
  }
  if (last.treeHash === treeHash) return { ok: true, treeHash, recordedHash: last.treeHash, problems: [] };
  const problems: string[] = [];
  for (const path of Object.keys(files)) {
    if (last.files[path] === undefined) problems.push(`added: ${path}`);
    else if (last.files[path] !== files[path]) problems.push(`changed: ${path}`);
  }
  for (const path of Object.keys(last.files)) if (files[path] === undefined) problems.push(`removed: ${path}`);
  if (problems.length === 0) problems.push("the tree hash differs although every file hash matches: the hashing algorithm changed");
  return { ok: false, treeHash, recordedHash: last.treeHash, problems };
}

/** The chain of entries is well formed: each has a rationale, a tree hash that follows from its file hashes, and no two are equal in a row. */
export function validateFrozenFile(frozen: FrozenFile): string[] {
  const problems: string[] = [];
  if (frozen.schemaVersion !== 1) problems.push(`unknown schemaVersion ${String(frozen.schemaVersion)}`);
  if (frozen.algorithm !== ALGORITHM) problems.push("the recorded algorithm is not the one this tool implements");
  frozen.entries.forEach((entry, index) => {
    if (entry.rationale.trim().length < 12) problems.push(`entry ${String(index)} has no rationale`);
    if (treeHashOf(entry.files) !== entry.treeHash) problems.push(`entry ${String(index)}: the tree hash does not follow from its file hashes`);
    const previous = frozen.entries[index - 1];
    if (previous !== undefined && previous.treeHash === entry.treeHash) problems.push(`entry ${String(index)} repeats the tree hash of the entry before it`);
  });
  return problems;
}

export function recordEntry(rationale: string, now: Date = new Date()): FrozenFile {
  const existing = readFrozen();
  const files = hashFiles();
  const entry: FrozenEntry = { treeHash: treeHashOf(files), recordedAt: now.toISOString(), rationale, files };
  const frozen: FrozenFile = { schemaVersion: 1, algorithm: ALGORITHM, entries: [...(existing?.entries ?? []), entry] };
  const problems = validateFrozenFile(frozen);
  if (problems.length > 0) throw new Error(`cannot record: ${problems.join("; ")}`);
  writeFileSync(FROZEN_FILE, `${JSON.stringify(frozen, null, 2)}\n`);
  return frozen;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const status = checkFrozen();
    if (!status.ok) {
      process.stderr.write(
        `the workload definitions differ from the frozen ones (${status.recordedHash ?? "none recorded"} recorded, ${status.treeHash} now):\n${status.problems.map((p) => `  ${p}`).join("\n")}\nrecord the change with a rationale: node tools/freeze.ts --record "<why>"\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(`frozen: ${status.treeHash}\n`);
    }
  } else if (args[0] === "--record") {
    const rationale = args[1];
    if (rationale === undefined || rationale.trim().length < 12) {
      process.stderr.write('give a rationale of at least 12 characters: node tools/freeze.ts --record "<why>"\n');
      process.exitCode = 2;
    } else {
      const frozen = recordEntry(rationale);
      process.stdout.write(`recorded entry ${String(frozen.entries.length)}: ${(frozen.entries[frozen.entries.length - 1] as FrozenEntry).treeHash}\n`);
    }
  } else {
    const files = hashFiles();
    process.stdout.write(`${treeHashOf(files)}\n${Object.keys(files).map((p) => `  ${p}`).join("\n")}\n`);
  }
}
