// Tree hash of the benchmark holdout set (spec/ai-and-benchmarks.md section 6.2, decision 0021).
//
//   node benchmarks/tools/hash-holdout.mjs           print the hash of benchmarks/holdout/
//   node benchmarks/tools/hash-holdout.mjs --check   compare with benchmarks/holdout.sha256 (exit 1 on a difference)
//   node benchmarks/tools/hash-holdout.mjs --write   (re)write benchmarks/holdout.sha256
//
// Algorithm, identical on Windows and POSIX:
//   1. every regular file below the holdout directory, at any depth, except the file names in
//      IGNORED_FILE_NAMES; a symbolic link or any other non-regular entry is an error;
//   2. path = relative to the holdout directory, "/" as separator on every platform;
//   3. files sorted by the UTF-8 bytes of the path (never by locale);
//   4. one line per file: "<sha256 of the raw bytes, lowercase hex>  <path>\n" (the sha256sum format);
//   5. hash = SHA-256 of the UTF-8 bytes of all lines concatenated, lowercase hex.
// File bytes are hashed as stored. `.gitattributes` forces LF checkouts for the holdout tree, and for
// the text file types in TEXT_EXTENSIONS a carriage return is an error rather than something that is
// silently normalised: a CRLF file means the checkout rules were bypassed.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
export const TEXT_EXTENSIONS = new Set([
  ".toml",
  ".ts",
  ".mtek",
  ".md",
  ".json",
  ".html",
  ".txt",
  ".wgsl",
  ".js",
  ".mjs",
  ".css",
]);

/** @param {Uint8Array | string} data @returns {string} lowercase hex SHA-256 */
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** @param {string} a @param {string} b @returns {number} UTF-8 byte order of two strings */
function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** @param {string} path @returns {string} the lowercase extension including the dot, or "" */
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * @typedef {{ path: string, absolute: string }} HoldoutFile
 * @param {string} holdoutDir
 * @returns {HoldoutFile[]} every file of the tree in hashing order
 */
export function listHoldoutFiles(holdoutDir) {
  const root = resolve(holdoutDir);
  /** @type {HoldoutFile[]} */
  const files = [];
  /** @param {string} directory @param {string} prefix */
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, path);
      } else if (entry.isFile()) {
        if (!IGNORED_FILE_NAMES.has(entry.name)) files.push({ path, absolute });
      } else {
        throw new Error(`${path}: not a regular file or directory (symbolic links are not allowed in the holdout tree)`);
      }
    }
  };
  walk(root, "");
  return files.sort((a, b) => compareUtf8(a.path, b.path));
}

/**
 * @param {string} holdoutDir
 * @returns {string} the 64-digit lowercase hex tree hash
 * @throws {Error} when the directory is unreadable, a file is not regular, or a text file has CR bytes
 */
export function computeHoldoutHash(holdoutDir) {
  let lines = "";
  for (const file of listHoldoutFiles(holdoutDir)) {
    const bytes = readFileSync(file.absolute);
    if (TEXT_EXTENSIONS.has(extensionOf(file.path)) && bytes.includes(0x0d)) {
      throw new Error(
        `${file.path}: contains a carriage return; the holdout tree must be checked out with LF line endings (.gitattributes)`,
      );
    }
    lines += `${sha256(bytes)}  ${file.path}\n`;
  }
  return sha256(lines);
}

/** @param {string} hash @returns {string} the content of holdout.sha256 */
export function formatHashFile(hash) {
  return `${hash}\n`;
}

/**
 * @param {string} file path of holdout.sha256
 * @returns {string | null} the recorded hash, or null when the file does not exist
 * @throws {Error} when the file does not consist of 64 lowercase hex digits and a newline
 */
export function readRecordedHash(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  if (!/^[0-9a-f]{64}\n$/.test(text)) {
    throw new Error(`${file}: expected 64 lowercase hex digits followed by a newline`);
  }
  return text.slice(0, 64);
}

/** @returns {{ holdoutDir: string, hashFile: string }} the repository's locations */
export function defaultLocations() {
  const benchmarks = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return { holdoutDir: join(benchmarks, "holdout"), hashFile: join(benchmarks, "holdout.sha256") };
}

/** @param {string[]} argv @returns {number} the process exit code */
function main(argv) {
  const { holdoutDir, hashFile } = defaultLocations();
  const modes = argv.filter((arg) => arg === "--check" || arg === "--write");
  if (argv.length > 1 || modes.length !== argv.length) {
    process.stderr.write("usage: hash-holdout.mjs [--check | --write]\n");
    return 2;
  }
  const hash = computeHoldoutHash(holdoutDir);
  if (modes[0] === "--write") {
    writeFileSync(hashFile, formatHashFile(hash));
    process.stdout.write(`wrote ${hash}\n`);
    return 0;
  }
  if (modes[0] === "--check") {
    const recorded = readRecordedHash(hashFile);
    if (recorded === hash) {
      process.stdout.write(`holdout hash ok: ${hash}\n`);
      return 0;
    }
    process.stderr.write(
      `holdout hash differs: recorded ${recorded ?? "(no holdout.sha256)"}, computed ${hash}\n` +
        "The holdout tree changed. If that was intended, run `node benchmarks/tools/hash-holdout.mjs --write` and say why in the commit message.\n",
    );
    return 1;
  }
  process.stdout.write(`${hash}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
}
