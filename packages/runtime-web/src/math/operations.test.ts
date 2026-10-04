/**
 * The `rt` surface against the standard library registry: every pure intrinsic and namespace
 * function of `spec/stdlib-schema.json` (generated from the Rust registry), instantiated over its
 * type classes, has exactly one `rt` helper of the right arity, and every `rt` export is accounted
 * for. Also checks that the runtime bundle's entry module re-exports `rt` for `import * as rt`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as runtime from "../index.js";
import { RT_OPERATIONS, RT_STRUCTURAL_EXPORTS, signature } from "./operations.js";
import * as rt from "./rt.js";

interface SchemaFunction {
  readonly name: string;
  readonly kind?: string;
  readonly signatures: readonly string[];
  readonly domain: "both" | "cpu" | "gpu";
  readonly constEligible: boolean;
}

interface Schema {
  readonly intrinsics: readonly SchemaFunction[];
  readonly namespaces: readonly { readonly name: string; readonly members: readonly SchemaFunction[] }[];
  readonly typeClasses: readonly { readonly name: string; readonly members: readonly string[] }[];
}

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../spec/stdlib-schema.json", import.meta.url)), "utf8"),
) as Schema;

const classes = new Map(schema.typeClasses.map((c) => [c.name, c.members]));

/** `"(x: T, lo: T, hi: T) -> T"` → every concrete `"(f32, f32, f32) -> f32"`, … */
function instantiate(text: string): string[] {
  const match = /^\((.*)\) -> (.+)$/.exec(text);
  if (match === null) throw new Error(`unparsable signature ${text}`);
  const params = (match[1] ?? "").length === 0 ? [] : (match[1] ?? "").split(", ").map((p) => p.split(": ")[1] ?? "");
  const result = match[2] ?? "";
  const used = [...new Set([...params, result].filter((t) => classes.has(t)))];
  let bindings: Map<string, string>[] = [new Map<string, string>()];
  for (const cls of used) {
    bindings = bindings.flatMap((b) => (classes.get(cls) ?? []).map((member) => new Map<string, string>([...b, [cls, member]])));
  }
  return bindings.map((b) => signature(params.map((p) => b.get(p) ?? p), b.get(result) ?? result));
}

/** The pure functions `rt` must implement: domain `both` (GPU-only and CPU-only ones are not `rt`'s). */
function pureFunctions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of schema.intrinsics) {
    if (f.domain === "both") out.set(f.name, f.signatures.flatMap(instantiate));
  }
  for (const ns of schema.namespaces) {
    for (const member of ns.members) {
      if (member.kind === "function" && member.domain === "both") {
        out.set(`${ns.name}.${member.name}`, member.signatures.flatMap(instantiate));
      }
    }
  }
  return out;
}

const exported = rt as unknown as Readonly<Record<string, unknown>>;

describe("the rt surface", () => {
  it("covers every pure intrinsic and namespace function of the registry, every instantiation", () => {
    const pure = pureFunctions();
    // The 37 math intrinsics of spec/language.md 10 and the 10 quat/mat4/color functions of stdlib.md 2.
    expect(pure.size).toBe(37 + 10);
    for (const [callee, signatures] of pure) {
      const helpers = RT_OPERATIONS[callee];
      expect(helpers, `${callee} has no rt helpers`).toBeDefined();
      for (const sig of signatures) {
        const helper = helpers?.[sig];
        expect(helper, `${callee} ${sig} has no rt helper`).toBeDefined();
        const fn = exported[helper ?? ""];
        expect(typeof fn, `${callee} ${sig}: rt.${helper} is not a function`).toBe("function");
        const arity = (/^\((.*)\)/.exec(sig)?.[1] ?? "").split(", ").filter((p) => p.length > 0).length;
        expect((fn as (...args: unknown[]) => unknown).length, `rt.${helper} arity`).toBe(arity);
      }
      // No helper for a signature the registry does not have.
      expect(Object.keys(helpers ?? {}).sort()).toEqual([...new Set(signatures)].sort());
    }
  });

  it("maps only registry functions, constructors, conversions and operators", () => {
    const pure = pureFunctions();
    const other = new Set(["vec2", "vec3", "vec4", "f32", "i32", "u32", "+", "-", "*", "/", "%", "neg"]);
    for (const callee of Object.keys(RT_OPERATIONS)) {
      expect(pure.has(callee) || other.has(callee), `unexpected callee ${callee}`).toBe(true);
    }
    // CPU-only intrinsics are context members (spec/runtime-abi.md 4.2), GPU-only ones never run here.
    for (const name of ["random", "print", "is_key_down", "spawn", "destroy", "alive", "sample", "lighting.pbr"]) {
      expect(RT_OPERATIONS[name]).toBeUndefined();
    }
  });

  it("has a function of the right arity for every table entry", () => {
    for (const [callee, entries] of Object.entries(RT_OPERATIONS)) {
      for (const [sig, helper] of Object.entries(entries)) {
        const fn = exported[helper];
        expect(typeof fn, `${callee} ${sig}: rt.${helper}`).toBe("function");
        const arity = (/^\((.*)\)/.exec(sig)?.[1] ?? "").split(", ").filter((p) => p.length > 0).length;
        expect((fn as (...args: unknown[]) => unknown).length, `rt.${helper}`).toBe(arity);
      }
    }
  });

  it("exports nothing the table and the structural list do not account for", () => {
    const named = new Set([...Object.values(RT_OPERATIONS).flatMap((e) => Object.values(e)), ...RT_STRUCTURAL_EXPORTS]);
    expect(Object.keys(exported).filter((name) => !named.has(name))).toEqual([]);
    expect(RT_STRUCTURAL_EXPORTS.filter((name) => !(name in exported))).toEqual([]);
  });

  it("is re-exported by the runtime bundle's entry module for `import * as rt`", () => {
    const entry = runtime as unknown as Readonly<Record<string, unknown>>;
    for (const [name, value] of Object.entries(exported)) {
      expect(entry[name], `runtime entry module lacks rt.${name}`).toBe(value);
    }
    expect(entry["mountMtek"]).toBeTypeOf("function");
  });
});
