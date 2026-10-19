// Shared test machinery: the repository root, synthetic programs, and a scratch directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";
import type { Analysed } from "../src/projects.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const dirs: string[] = [];
export function tempDir(prefix = "coverage-matrix-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A compiled program that uses exactly `facts`. */
export function program(id: string, kind: Analysed["kind"], facts: readonly string[], ok = true): Analysed {
  return { id, kind, dir: `/x/${id}`, ok, note: ok ? null : "does not check", ir: new Set(facts), manifest: new Set(), uses: new Set() };
}
