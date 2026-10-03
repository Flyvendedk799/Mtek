// M0 bridge test 1 (spec/testing.md section 6.2, spec/gpu-layout.md section 9.4): values written by
// the generated JavaScript writers into a production uniform arena are read by the generated probe
// shader through typed WGSL paths, and the 32-bit words read back equal, bit for bit, the words
// computed in Node from the same JS values in leaf order. A writer/reader offset disagreement
// cannot pass.
import { fixtureNames, loadFixture, wordMismatches } from "../../support/bridge-driver.ts";
import { createRng, expectedLeaves, expectedWords, sampleValue, toJson } from "../../support/bridge-values.ts";
import { expect, test, testSeed } from "../../support/bridge-fixtures.ts";

const CASES = [
  { label: "random values", mode: "random", trial: 0 },
  { label: "random values with the other boolean phase", mode: "random", trial: 1 },
  { label: "edge values", mode: "edge", trial: 0 },
] as const;

for (const name of fixtureNames()) {
  for (const { label, mode, trial } of CASES) {
    test(`${name}: ${label} are read back bit-exactly`, async ({ bridge }, testInfo) => {
      const { record, manifest } = loadFixture(name);
      const value = sampleValue(record, createRng(testSeed(testInfo, `${name}:${label}`)), mode, trial);
      const expected = expectedLeaves(record, value);

      // The probe's leaf list (written by the generator from the layout record) and the Node-side
      // walk of the value must agree on every leaf, its kind and its order.
      expect(manifest.leaves.map((leaf) => `${leaf.path}:${leaf.kind}`)).toEqual(
        expected.map((leaf) => `${leaf.path}:${leaf.kind}`),
      );
      expect(manifest.leafWords).toBe(expected.length);

      const result = await bridge.runProbe(name, toJson(value));
      expect(result.width).toBe(manifest.width);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0] ?? [];
      expect(row).toHaveLength(manifest.width * 4);
      expect(wordMismatches(expected, row)).toEqual([]);
      expect(row).toEqual(expectedWords(record, value, manifest.width));
    });
  }
}
