// The runner is started by the CLI as `node main.ts`, where Node strips the types itself and rejects
// syntax that is more than types (parameter properties, enums, namespaces). Vitest transpiles with esbuild
// and would not notice, so the entry point is started for real.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const main = join(import.meta.dirname, "main.ts");

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [main, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

describe("the runner entry point", () => {
  it("loads under Node's type stripping and says how it is used", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage: main.ts <plan.json> <report.json>");
    expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });

  it("rejects a plan of another schema version without writing a report", () => {
    const dir = mkdtempSync(join(tmpdir(), "mtek-runner-"));
    try {
      writeFileSync(join(dir, "plan.json"), JSON.stringify({ schemaVersion: 2, root: dir, fixtures: [] }));
      const result = run([join(dir, "plan.json"), join(dir, "report.json")]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("schema version 1");
      expect(() => readFileSync(join(dir, "report.json"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
