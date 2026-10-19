import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORMS, IR_ENUMS, IR_VARIANTS } from "../src/forms.ts";
import { REPO_ROOT } from "./helpers.ts";

/** The variants of `pub enum <name>` in the IR model, read from its source: a drift guard, not a derivation. */
function variantsOf(source: string, name: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`pub enum ${name} {`));
  if (start < 0) return [];
  const variants: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === "}") break;
    const match = /^ {4}([A-Z][A-Za-z0-9]*)\b/.exec(line);
    if (match !== null) variants.push(match[1] ?? "");
  }
  return variants;
}

describe("the forms", () => {
  it("have unique ids, a group, a title and a reference", () => {
    const ids = FORMS.map((form) => form.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const form of FORMS) {
      expect(form.group, form.id).not.toBe("");
      expect(form.title, form.id).not.toBe("");
      expect(form.ref, form.id).toMatch(/^spec\//);
    }
  });

  it("do not reuse a registry id", () => {
    for (const form of FORMS) expect(form.id).toMatch(/\//);
  });
});

describe("the IR variants", () => {
  const model = readFileSync(join(REPO_ROOT, "crates", "mtek-compiler", "src", "ir", "model.rs"), "utf8").replace(/\r\n/g, "\n");

  it("account for every variant of the IR enums the facts read, and nothing else", () => {
    for (const name of IR_ENUMS) {
      const inSource = variantsOf(model, name).map((variant) => `${name}.${variant}`).sort();
      const inTable = Object.keys(IR_VARIANTS).filter((key) => key.startsWith(`${name}.`)).sort();
      expect(inTable, `the variants of ${name} in tools/coverage-matrix/src/forms.ts and in crates/mtek-compiler/src/ir/model.rs`).toEqual(inSource);
    }
  });

  it("feed a form, a registry id or nothing", () => {
    const forms = new Set(FORMS.map((form) => form.id));
    for (const [variant, feeds] of Object.entries(IR_VARIANTS)) {
      const known = feeds === "-" || forms.has(feeds) || /^[a-z-]+:[A-Za-z_.*]+$/.test(feeds) || /^[a-z-]+$/.test(feeds);
      expect(known, `${variant} feeds ${feeds}`).toBe(true);
    }
  });
});
