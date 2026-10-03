// The encoder cross-check (spec/testing.md section 4.2): for every layout fixture the generated
// JavaScript writers and the independent DataView encoder must produce identical bytes, padding
// must stay zero, and per-field writers may only touch the bytes of their own field.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { copyRanges, dirtyPadding, firstDifference } from "./support/bytes.js";
import { type CpuValue, property } from "./support/cpu-value.js";
import { encodeBlock } from "./support/encoder.js";
import {
  type Fixture,
  dumpedFixtureNames,
  goldenWritersDir,
  loadFixture,
  makeViews,
} from "./support/fixtures.js";
import { type LayoutRecord, leafRanges } from "./support/layout.js";
import { createRng, hashString, resolveSeed, sampleValue } from "./support/values.js";

/** The fixtures spec/testing.md section 4.2 requires. */
const REQUIRED = [
  "all_types",
  "array_bool",
  "array_f32",
  "array_of_structs",
  "array_vec2",
  "builtin_frame",
  "builtin_object",
  "mat4_and_quat",
  "mixed",
  "nested_struct_in_array",
  "scalar_f32",
  "struct_then_scalar",
  "vec3",
  "vec3_then_f32",
];

const RANDOM_TRIALS = 8;
const EDGE_TRIALS = 2;
/** Byte offsets the block is written at; all multiples of 4 but not all of 16. */
const BASES = [0, 4, 20];
/** Bytes of untouched room on both sides of the block when it is written at a non-zero base. */
const MARGIN = 32;

const seed = resolveSeed(process.env);
console.info(`[codegen] MTEK_TEST_SEED=${seed} (set MTEK_TEST_SEED to reproduce a run)`);

const names = dumpedFixtureNames();
const fixtures: Fixture[] = await Promise.all(names.map((name) => loadFixture(name)));

interface Sample {
  readonly label: string;
  readonly value: CpuValue;
}

/** Deterministic samples for a fixture; independent of the order the fixtures run in. */
function samplesOf(record: LayoutRecord): Sample[] {
  const rng = createRng((seed ^ hashString(record.id)) >>> 0);
  const samples: Sample[] = [];
  for (let trial = 0; trial < RANDOM_TRIALS; trial++) {
    samples.push({
      label: `random trial ${trial}`,
      value: sampleValue(record, rng, "random", trial),
    });
  }
  for (let trial = 0; trial < EDGE_TRIALS; trial++) {
    samples.push({ label: `edge trial ${trial}`, value: sampleValue(record, rng, "edge", trial) });
  }
  return samples;
}

/** The writer naming rule of spec/gpu-layout.md section 7 (`<qual>` of `w_<qual>`). */
function qualifierOf(record: LayoutRecord): string {
  if (record.id.startsWith("fixture:")) return `fixture_${record.id.slice("fixture:".length)}`;
  if (record.id.startsWith("builtin:")) return `builtin_${record.wgslStruct}`;
  throw new Error(`unexpected layout id ${record.id}`);
}

function entryOf(fixture: Fixture) {
  const entry = fixture.table[fixture.record.id];
  if (entry === undefined) throw new Error(`no table entry for ${fixture.record.id}`);
  return entry;
}

describe("fixture dump", () => {
  it("contains every required fixture", () => {
    expect(names).toEqual(REQUIRED);
  });

  it("holds the same records as the hand-maintained layout goldens", () => {
    for (const fixture of fixtures) {
      expect(fixture.record, fixture.name).toEqual(fixture.golden);
    }
  });

  it("holds the same writer text as the checked-in golden writer files", () => {
    for (const fixture of fixtures) {
      const golden = readFileSync(resolve(goldenWritersDir, `${fixture.name}.js`), "utf8");
      expect(fixture.source === golden, `${fixture.name}: dump differs from its golden`).toBe(true);
    }
  });
});

for (const fixture of fixtures) {
  const { record } = fixture;

  describe(`fixture ${fixture.name}`, () => {
    it("exposes a writers table entry and named functions for the block and every field", () => {
      const entry = entryOf(fixture);
      const qual = qualifierOf(record);
      expect(Object.keys(fixture.table)).toEqual([record.id]);
      expect(entry.all).toBe(fixture.exports[`w_${qual}`]);
      const memberNames = record.root.members.map((member) => member.name);
      expect(Object.keys(entry.fields)).toEqual(memberNames);
      for (const name of memberNames) {
        expect(entry.fields[name], name).toBe(fixture.exports[`w_${qual}_${name}`]);
      }
      // Only the writer functions and the table are exported: no helpers, nothing else.
      expect(Object.keys(fixture.exports).sort()).toEqual(
        [`w_${qual}`, ...memberNames.map((name) => `w_${qual}_${name}`), "writers"].sort(),
      );
    });

    it("writes exactly the bytes the independent encoder writes, padding zero", () => {
      const entry = entryOf(fixture);
      for (const sample of samplesOf(record)) {
        const where = `${fixture.name} / ${sample.label} / seed ${seed}`;
        const buffer = new ArrayBuffer(record.size);
        entry.all(makeViews(buffer), 0, sample.value);
        const written = new Uint8Array(buffer);
        const expected = encodeBlock(record, sample.value);
        expect(firstDifference(expected, written), where).toBeNull();
        expect(dirtyPadding(record, written), `${where}: padding bytes written`).toEqual([]);
        expect(dirtyPadding(record, expected), `${where}: encoder wrote padding`).toEqual([]);
      }
    });

    it("writes at any 4-byte aligned base and never outside the block", () => {
      const entry = entryOf(fixture);
      for (const sample of samplesOf(record)) {
        for (const base of BASES) {
          const where = `${fixture.name} / ${sample.label} / base ${base} / seed ${seed}`;
          const bytes = new Uint8Array(base + record.size + MARGIN);
          entry.all(makeViews(bytes.buffer), base, sample.value);
          const expected = new Uint8Array(bytes.length);
          expected.set(encodeBlock(record, sample.value), base);
          expect(firstDifference(expected, bytes), where).toBeNull();
        }
      }
    });

    it("per-field writers update only the bytes of their field", () => {
      const entry = entryOf(fixture);
      const samples = samplesOf(record);
      for (const [index, first] of samples.entries()) {
        const second = samples[(index + 1) % samples.length];
        if (second === undefined) continue;
        const encodedFirst = encodeBlock(record, first.value);
        const encodedSecond = encodeBlock(record, second.value);
        for (const member of record.root.members) {
          const where = `${fixture.name}.${member.name} / ${first.label} then ${second.label} / seed ${seed}`;
          const writeField = entry.fields[member.name];
          if (writeField === undefined) throw new Error(`${where}: no field writer`);
          const ranges = leafRanges(member.node);
          const newValue = property(second.value, member.name, where);

          // Over a block written with the first sample: only this field changes.
          const overwritten = new Uint8Array(record.size);
          entry.all(makeViews(overwritten.buffer), 0, first.value);
          writeField(makeViews(overwritten.buffer), 0, newValue);
          const expectedOverwrite = encodedFirst.slice();
          copyRanges(expectedOverwrite, encodedSecond, ranges);
          expect(firstDifference(expectedOverwrite, overwritten), where).toBeNull();

          // Over a zeroed block: nothing but this field is written.
          const alone = new Uint8Array(record.size);
          writeField(makeViews(alone.buffer), 0, newValue);
          const expectedAlone = new Uint8Array(record.size);
          copyRanges(expectedAlone, encodedSecond, ranges);
          expect(firstDifference(expectedAlone, alone), `${where} (alone)`).toBeNull();
        }
      }
    });

    it("keeps overwriting consistent: writing a second value fully replaces the first", () => {
      const entry = entryOf(fixture);
      const samples = samplesOf(record);
      const [first, second] = samples;
      if (first === undefined || second === undefined) throw new Error("no samples");
      const bytes = new Uint8Array(record.size);
      entry.all(makeViews(bytes.buffer), 0, first.value);
      entry.all(makeViews(bytes.buffer), 0, second.value);
      expect(
        firstDifference(encodeBlock(record, second.value), bytes),
        `${fixture.name} / seed ${seed}`,
      ).toBeNull();
    });
  });
}
