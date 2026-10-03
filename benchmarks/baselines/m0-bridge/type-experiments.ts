// H2 experiment (spec/decisions/0001): deliberately wrong uniform usages, checked with
// `tsc --noEmit -p tsconfig.json`. A `// @ts-expect-error` marks a line where tsc really reports an
// error; TypeScript itself fails the file if such a line is NOT an error ("Unused '@ts-expect-error'
// directive"), so the directives cannot overstate what is caught. Lines without a directive are
// wrong usages that tsc accepts. The outcome table in RESULTS.md is generated from the output of
// that command (see `tools/type-experiment-report.ts`), not written by hand.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unused-expressions --
   the statements below are wrong on purpose */
import { float, uniform, vec3 } from "three/tsl";
import { Color, MeshBasicNodeMaterial, Vector2, Vector3 } from "three/webgpu";
import { applyParams, type MixedUniforms } from "./src/mixed.ts";

declare const uniforms: MixedUniforms;
declare const material: MeshBasicNodeMaterial;

/** A helper a careful developer would write: set a uniform by its record key. */
declare function uniformByKey(key: keyof MixedUniforms): MixedUniforms[keyof MixedUniforms];

export function experiments(): void {
  // CASE 01: a vec3 value assigned to a float uniform
  // @ts-expect-error rejected by tsc
  uniforms.a.value = new Vector3(1, 2, 3);

  // CASE 02: a colour assigned to a vec2 uniform
  // @ts-expect-error rejected by tsc
  uniforms.d.value = new Color(1, 0, 0);

  // CASE 03: a misspelled uniform name used as a property of the typed uniform record
  // @ts-expect-error rejected by tsc
  uniforms.colr.value = new Color(1, 0, 0);

  // CASE 04: a misspelled uniform name passed to a lookup helper typed with `keyof`
  // @ts-expect-error rejected by tsc
  uniformByKey("colr");

  // CASE 05: a misspelled uniform name given to three.js itself (`setName`, a plain string)
  uniforms.f.setName("colr");

  // CASE 06: a vec3 value assigned to a colour uniform
  // @ts-expect-error rejected by tsc
  uniforms.f.value = new Vector3(1, 0, 0);

  // CASE 07: a number assigned to the boolean uniform
  // @ts-expect-error rejected by tsc
  uniforms.e.value = 1;

  // CASE 08: a boolean assigned to a float uniform
  // @ts-expect-error rejected by tsc
  uniforms.a.value = true;

  // CASE 09: a negative number assigned to the unsigned uniform
  uniforms.c.value = -1;

  // CASE 10: a fractional number assigned to the unsigned uniform
  uniforms.c.value = 1.5;

  // CASE 11: a value beyond the u32 range assigned to the unsigned uniform
  uniforms.c.value = 4294967296;

  // CASE 12: a vec3 given to a uniform declared with the type string "float"
  // @ts-expect-error rejected by tsc
  uniform(new Vector3(1, 2, 3), "float");

  // CASE 13: a three-component array for the vec2 parameter of `applyParams`
  // @ts-expect-error rejected by tsc
  applyParams(uniforms, { d: [1, 2, 3] });

  // CASE 14: a wrong-length array for a vec3 parameter of `applyParams`
  // @ts-expect-error rejected by tsc
  applyParams(uniforms, { b: [1, 2] });

  // CASE 15: shader graph: a vec2 node added to a vec3 node
  vec3(1, 2, 3).add(uniforms.d);

  // CASE 16: shader graph: a vec2 uniform read through a swizzle that does not exist on vec2
  // @ts-expect-error rejected by tsc
  uniforms.d.xyz;

  // CASE 17: shader graph: a float node assigned where the material expects a vec4 colour node
  material.colorNode = float(0.5);

  // CASE 18: shader graph: a vec2 uniform assigned where the material expects a vec4 colour node
  material.colorNode = uniforms.d;

  // CASE 19: a Vector2 value assigned to a vec3 uniform
  // @ts-expect-error rejected by tsc
  uniforms.b.value = new Vector2(1, 2);
}
