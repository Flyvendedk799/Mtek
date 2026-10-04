// The emitter and the runtime math library cannot drift apart (decisions 0037 and 0040): the
// compiler's copy of the operation index (`emit_js/rt_ops.rs`, dumped by the global setup) equals
// the runtime's `RT_OPERATIONS`, the structural helpers it uses are runtime exports, and every
// `rt.<name>` any generated app.js calls is a function exported by the real runtime bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RT_OPERATIONS,
  RT_STRUCTURAL_EXPORTS,
} from "../../packages/runtime-web/src/math/operations.js";
import { outDir } from "./support/fixtures.js";
import { codegenFixtures, loadProgram, record } from "./support/programs.js";

interface Dump {
  readonly operations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly structural: readonly string[];
}

const dump = JSON.parse(readFileSync(resolve(outDir, "rt-operations.json"), "utf8")) as Dump;

describe("the rt helpers generated code calls", () => {
  it("are looked up in a copy of RT_OPERATIONS that equals the runtime's", () => {
    expect(dump.operations).toEqual(RT_OPERATIONS);
  });

  it("include only structural helpers the runtime lists", () => {
    expect(dump.structural.length).toBeGreaterThan(0);
    for (const name of dump.structural) expect(RT_STRUCTURAL_EXPORTS).toContain(name);
  });

  for (const name of codegenFixtures()) {
    it(`${name}: every rt.<name> in app.js is a function of the real runtime bundle`, async () => {
      const program = await loadProgram(name);
      const bundleUrl = pathToFileURL(resolve(program.dir, program.runtimeFile)).href;
      const bundle = record(await import(/* @vite-ignore */ bundleUrl), "runtime bundle");
      const used = new Set(
        [...program.appText.matchAll(/\brt\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? ""),
      );
      for (const helper of used) expect(typeof bundle[helper], helper).toBe("function");
      if (name === "cpu_functions" || name === "numeric_cpu_table") {
        expect(used.size).toBeGreaterThan(10);
      }
    });
  }
});
