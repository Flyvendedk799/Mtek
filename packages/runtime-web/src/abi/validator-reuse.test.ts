/// <reference types="vite/client" />
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import generated from "./generated/validate-manifest.js";

// Compare with the original inline strategy, including failure order/messages.
// Ajv remains a development dependency; the shipped validator imports nothing.
const require = createRequire(import.meta.url);
const ajvModule = require("ajv/dist/2020") as { default: new (options: object) => { compile(schema: object): { (value: unknown): boolean; errors?: readonly object[] | null } } };
const Ajv = ajvModule.default;
const schema = Object.values(import.meta.glob<string>("../../../../spec/manifest.schema.json",{query:"?raw",import:"default",eager:true}))[0]!;
const fixtures = import.meta.glob<string>("../../../../tests/abi/manifests/{valid,invalid}/*.json",{query:"?raw",import:"default",eager:true});

describe("shared manifest validators", () => {
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
  });
});
