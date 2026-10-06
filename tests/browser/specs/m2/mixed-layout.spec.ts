// M2 exit gate, criterion 3 (task M2-12): the mixed-layout round trip in a real scene. The `Mixed` material of
// `fixtures/m2/mixed_layout` has the params of the `mixed` layout of spec/gpu-layout.md section 4.5 B
// (f32, vec3, u32, vec2, bool, color). The CPU writes them through the generated writers; the fragment reads
// every one through its typed WGSL path and compares it with the exact constant the CPU wrote, so the
// round trip is bit-exact or a channel goes black: red = a and b, green = c and d, blue = e and f.
// `Match` holds the checked values, `Mutated` holds other values for every param. The same values are then
// written again at run time through `app.debug.setParam` (one param at a time, and back) to prove the
// writers and the reader agree for each member, not only for the initial values.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { expectedRgb8 } from "../../support/m1-reference.ts";
import { MIXED_LAYOUT, readBuiltM2Manifest } from "../../support/m2-fixtures.ts";
import { runSession, type ParamWrite, type SessionStep } from "./support.ts";

const TARGET = { width: 64, height: 64 } as const;
/** Orthographic camera of height 4 over a 64 x 64 target: world x = -1.5 and +1.5 are pixels 16 and 48. */
const MATCH: readonly [number, number] = [16, 32];
const MUTATED: readonly [number, number] = [48, 32];
const OUTSIDE: readonly [number, number] = [32, 2];

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];
const CLEAR = expectedRgb8("#202830");

/** The checked values (the declared defaults), as the CPU representation of spec/runtime-abi.md section 4.1. */
const CHECKED = {
  a: 1.5,
  b: { x: 0.1, y: -2.5, z: 1234.5 },
  c: 3000000000,
  d: { x: 0.3, y: -0.7 },
  e: true,
  f: { r: 0.25, g: 0.5, b: 0.125, a: 1 },
};

/** Another value for every member (the values `Mutated` holds are different again). */
const CHANGED = {
  a: 9,
  b: { x: 1, y: 2, z: 3 },
  c: 1,
  d: { x: 4, y: 5 },
  e: false,
  f: { r: 1, g: 0, b: 0, a: 1 },
};

const write = (param: keyof typeof CHECKED, value: unknown): ParamWrite => ({ entity: "Match", param, value });

/** Each member changed alone (its channel goes black), then restored (white again). */
const STEPS: Array<SessionStep & { expect: [number, number, number] }> = [
  { label: "a changed", writes: [write("a", 2.5)], expect: [0, 255, 255] },
  { label: "a restored", writes: [write("a", CHECKED.a)], expect: WHITE },
  { label: "b.z changed by one binary32 step", writes: [write("b", { x: 0.1, y: -2.5, z: 1234.50012 })], expect: [0, 255, 255] },
  { label: "b restored", writes: [write("b", CHECKED.b)], expect: WHITE },
  { label: "c changed by one", writes: [write("c", 3000000001)], expect: [255, 0, 255] },
  { label: "c restored", writes: [write("c", CHECKED.c)], expect: WHITE },
  { label: "d changed", writes: [write("d", { x: 0.3, y: 0.7 })], expect: [255, 0, 255] },
  { label: "d restored", writes: [write("d", CHECKED.d)], expect: WHITE },
  { label: "e changed", writes: [write("e", false)], expect: [255, 255, 0] },
  { label: "e restored", writes: [write("e", CHECKED.e)], expect: WHITE },
  { label: "f changed", writes: [write("f", { r: 0.25, g: 0.5, b: 0.25, a: 1 })], expect: [255, 255, 0] },
  { label: "f restored", writes: [write("f", CHECKED.f)], expect: WHITE },
  { label: "all changed", writes: Object.entries(CHANGED).map(([k, v]) => write(k as keyof typeof CHECKED, v)), expect: BLACK },
  { label: "all restored", writes: Object.entries(CHECKED).map(([k, v]) => write(k as keyof typeof CHECKED, v)), expect: WHITE },
];

interface LayoutMember {
  name: string;
  mtekType: string;
  node: { kind: string; offset: number; size: number; align: number; scalar?: string; components?: number };
}
interface LayoutRecord {
  id: string;
  size: number;
  align: number;
  root: { members: LayoutMember[] };
}

test("the manifest's layout of the material is the mixed layout of spec/gpu-layout.md (size 64, align 16)", () => {
  const manifest = readBuiltM2Manifest(MIXED_LAYOUT) as { layouts: LayoutRecord[] };
  const layout = manifest.layouts.find((candidate) => candidate.id === "material:src/main.mtek::Mixed");
  if (layout === undefined) throw new Error("the built manifest has no layout for the Mixed material");
  const golden = JSON.parse(readFileSync(join(REPO_ROOT, "tests", "gpu-layout", "mixed.layout.json"), "utf8")) as LayoutRecord;
  expect(layout.size).toBe(golden.size);
  expect(layout.align).toBe(golden.align);
  expect(layout.root.members).toEqual(golden.root.members);
});

test("the Mixed material's params round-trip bit-exactly from the CPU writers to the typed WGSL reads, in a real scene", async ({ page, gpu }, testInfo) => {
  void gpu;
  const session = await runSession(page, MIXED_LAYOUT, TARGET, [MATCH, MUTATED, OUTSIDE], STEPS);
  expect(session.state).toBe("running");
  expect(session.overlayPresent).toBe(false);

  const [initial, ...frames] = session.frames;
  if (initial === undefined) throw new Error("no frames");
  // Initial values: every check passes for Match; Mutated fails all three; outside shows the clear colour.
  expect(initial.pixels[0], "Match: every param read back equal to the CPU value").toEqual(WHITE);
  expect(initial.pixels[1], "Mutated: other values in every param").toEqual(BLACK);
  expect(initial.pixels[2], "outside the boxes").toEqual(CLEAR);
  expect(initial.reported).toEqual([]);

  const lines = [`initial: Match rgb(${(initial.pixels[0] ?? []).join(",")}) Mutated rgb(${(initial.pixels[1] ?? []).join(",")})`];
  for (const [index, frame] of frames.entries()) {
    const step = STEPS[index];
    if (step === undefined) throw new Error("step missing");
    lines.push(`${frame.label}: Match rgb(${(frame.pixels[0] ?? []).join(",")}) expected rgb(${step.expect.join(",")})`);
    expect(frame.pixels[0], `Match after "${frame.label}"`).toEqual(step.expect);
    // The other entity is not affected by writes to Match (its own parameter block).
    expect(frame.pixels[1], `Mutated after "${frame.label}"`).toEqual(BLACK);
    expect(frame.reported, `${frame.label}: no runtime diagnostics`).toEqual([]);
  }
  testInfo.annotations.push({ type: "m2-roundtrip", description: lines.join("; ") });

  // One pipeline for both entities (one material, one shader); every write is an upload, nothing else is created.
  for (const name of ["pipelinesCreated", "shaderModulesCreated", "bindGroupsCreated"]) {
    expect(new Set(session.frames.map((frame) => frame.counters[name])).size, `${name} is constant`).toBe(1);
  }
  const allocated = session.frames.map((frame) => frame.counters["buffersAllocated"] ?? NaN);
  for (let i = 1; i < allocated.length; i += 1) expect(allocated[i], `frame ${String(i)}: one readback buffer, no arena growth`).toBe((allocated[i - 1] ?? NaN) + 1);
  expect(initial.counters["pipelinesCreated"]).toBe(1);
  // Two instances of one layout: two parameter blocks, none shared.
  expect(initial.counters["ownedParamBlocks"]).toBe(2);
});
