import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { buildComputeAcceptance } from "./compute-fixtures.ts";

describe("CPU-only acceptance fixture preparation", () => {
  it("exports a real content-addressed package and bundles probes without acquiring a GPU", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mtek-compute-acceptance-"));
    const absolute = resolve(directory), parent = resolve(tmpdir());
    if (!absolute.startsWith(parent + sep) || !basename(absolute).startsWith("mtek-compute-acceptance-")) throw new Error("refusing cleanup outside the verified test directory");
    try {
      const report = await buildComputeAcceptance(directory);
      expect(report.developmentSourceGateBypass).toBe("none: ordinary public analysis");
      expect(report.shadow?.developmentSourceGateBypass).toBe("none: ordinary public analysis");
      const manifest = JSON.parse(readFileSync(join(directory, "program/program.manifest.json"), "utf8")) as { computePrograms: { definition: { id: string; output: { layout: { stride: number; size: number } } } }[] };
      expect(manifest.computePrograms).toHaveLength(8);
      const invocation = manifest.computePrograms.find((entry) => entry.definition.id.endsWith("::InvocationProbe"))!;
      expect(invocation.definition.output.layout.stride).toBe(56); expect(invocation.definition.output.layout.size).toBe(257 * 56);
      const page = readFileSync(join(directory, "index.html"), "utf8");
      expect(page).toContain("No GPU requested yet");
      const bundle = readFileSync(join(directory, "acceptance.js"), "utf8");
      expect(bundle).toContain("__computeAcceptance");
      expect(bundle).toContain("requestAdapter"); // It is retained inside explicit actions, never executed by preparation.
      for (const name of ["positions", "invocation", "quad", "composite"]) expect(readFileSync(join(directory, "reference", `${name}.wgsl`), "utf8")).toContain("@group(0)");
    } finally {
      rmSync(absolute, { recursive: true, force: true });
    }
  }, 120_000);
});
