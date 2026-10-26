/// <reference types="vite/client" />
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import generated from "./generated/validate-manifest.js";
import { manifestValidationSchema } from "../../../../scripts/manifest-validation-schema.js";
import { compactStandaloneSchemaData } from "../../../../scripts/standalone-schema-data.js";

// Compare with the original inline strategy, including failure order/messages.
// Ajv remains a development dependency; the shipped validator imports nothing.
const require = createRequire(import.meta.url);
const ajvModule = require("ajv/dist/2020") as { default: new (options: object) => { compile(schema: object): { (value: unknown): boolean; errors?: readonly object[] | null } } };
const Ajv = ajvModule.default;
const schema = Object.values(import.meta.glob<string>("../../../../spec/manifest.schema.json",{query:"?raw",import:"default",eager:true}))[0]!;
const fixtures = import.meta.glob<string>("../../../../tests/abi/manifests/{valid,invalid}/*.json",{query:"?raw",import:"default",eager:true});

describe("shared manifest validators", () => {
  it("retains referenced enum data and falls back for unknown schema accesses", () => {
    const compact = compactStandaloneSchemaData('const schema1={"description":"unused","properties":{"kind":{"type":"string","enum":["a","b"]},"unused":{"type":"integer"}}}; export const allowed=schema1.properties.kind.enum;');
    expect(compact).not.toContain('"unused"');
    expect(compact).toContain('"enum":["a","b"]');
    const dynamic = 'const schema2={"a":1,"b":2}; export const value=schema2[key];';
    const bare = 'const schema3={"a":1,"b":2}; export const value=schema3;';
    expect(compactStandaloneSchemaData(dynamic)).toBe(dynamic);
    expect(compactStandaloneSchemaData(bare)).toBe(bare);
    expect(compactStandaloneSchemaData('const schema4={"enum":[{"title":"literal"}]}; export const value=schema4["enum"][0];')).toContain('"title":"literal"');
  });
  it("removes annotations while preserving property names and literal data", () => {
    const original = {
      title: "documentation", description: "documentation", $comment: "documentation",
      type: "object", additionalProperties: false, required: ["description", "title"],
      properties: {
        description: { description: "documentation", const: { description: "literal", title: "literal" } },
        title: { title: "documentation", enum: [{ description: "literal" }] },
      },
    };
    const transformed = manifestValidationSchema(original) as { properties: Record<string, unknown> };
    expect(transformed).not.toHaveProperty("description");
    expect(transformed.properties["description"]).toEqual({ const: { description: "literal", title: "literal" } });
    expect(transformed.properties["title"]).toEqual({ enum: [{ description: "literal" }] });
    expect(original.description).toBe("documentation");
  });
  it("preserves acceptance and ordered diagnostics against the previous inline validator", () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(40);
    const reference = new Ajv({ allErrors:true,strict:true,allowUnionTypes:true,discriminator:true,unicode:false,logger:false,inlineRefs:true }).compile(JSON.parse(schema) as object);
    for (const [name,text] of Object.entries(fixtures)) {
      const value: unknown = JSON.parse(text);
      expect(generated(value),name).toBe(reference(value));
      // $ref call boundaries can shorten schemaPath; it is private to validation.
      const failures = (errors: readonly object[] | null | undefined) => (errors??[]).map(error => Object.fromEntries(Object.entries(error).filter(([key])=>key!=="schemaPath")));
      expect(failures(generated.errors),name).toEqual(failures(reference.errors));
    }
    const computeFixture = Object.entries(fixtures).find(([name]) => name.endsWith("/valid/compute.json"))!;
    const mutate = (path: readonly (string | number)[], value: unknown): unknown => {
      const data = JSON.parse(computeFixture[1]) as Record<string, unknown>;
      let parent: unknown = data;
      for (const key of path.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[key];
      (parent as Record<string | number, unknown>)[path.at(-1)!] = value;
      return data;
    };
    for (const [path, value] of [
      [["computePrograms", 0, "api"], 2],
      [["computePrograms", 0, "defaults"], [256]],
      [["computePrograms", 0, "definition", "workgroupSize"], [0, 1, 1]],
      [["computePrograms", 0, "definition", "dispatch", "size"], 16],
      [["computePrograms", 0, "definition", "dispatch", "root", "members", 0, "node", "scalar"], "f32"],
      [["computePrograms", 0, "definition", "output", "layout", "element", "kind"], "unknown"],
      [["computePrograms", 0, "unexpected"], true],
    ] as const) {
      const valueToCheck = mutate(path, value);
      expect(generated(valueToCheck), path.join("/")).toBe(false);
      expect(reference(valueToCheck), path.join("/")).toBe(false);
      const publicErrors = (errors: readonly object[] | null | undefined) => (errors ?? []).map((error) => Object.fromEntries(Object.entries(error).filter(([key]) => key !== "schemaPath")));
      expect(publicErrors(generated.errors), path.join("/")).toEqual(publicErrors(reference.errors));
    }
  });
});
