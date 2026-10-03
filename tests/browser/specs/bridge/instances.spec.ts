// M0 bridge test 2 (spec/testing.md section 6.2): two instances A and B live in ONE uniform arena;
// the probe of each is drawn into its own row of a two-row target. Changing only B leaves A's words
// unchanged and B's equal to the new values, and the other way round.
import { fixtureNames, loadFixture, wordMismatches } from "../../support/bridge-driver.ts";
import { createRng, expectedLeaves, expectedWords, sampleValue, toJson } from "../../support/bridge-values.ts";
import { expect, test, testSeed } from "../../support/bridge-fixtures.ts";

for (const name of fixtureNames()) {
  test(`${name}: two instances in one arena do not disturb each other`, async ({ bridge }, testInfo) => {
    const { record, manifest } = loadFixture(name);
    const rng = createRng(testSeed(testInfo, `${name}:instances`));
    // Trial 0 and 1 flip the boolean phase, so A and B also differ in every boolean leaf.
    const a1 = sampleValue(record, rng, "random", 0);
    const b1 = sampleValue(record, rng, "random", 1);
    const b2 = sampleValue(record, rng, "random", 0);
    const a2 = sampleValue(record, rng, "random", 1);
    const words = (value: typeof a1): number[] => expectedWords(record, value, manifest.width);
    expect(words(b2)).not.toEqual(words(b1));
    expect(words(a2)).not.toEqual(words(a1));

    // Both instances in one arena: two live slots of one block layout, lowest slots first.
    const first = await bridge.runProbe(name, toJson(a1), toJson(b1));
    expect(first.slots).toEqual([0, 1]);
    expect(first.arena.id).toBe(record.id);
    expect(first.arena.liveSlots).toBe(2);
    expect(first.arena.slotStride % 256).toBe(0);
    expect(first.arena.slotStride).toBeGreaterThanOrEqual(record.size);
    expect(first.rows).toHaveLength(2);
    expect(wordMismatches(expectedLeaves(record, a1), first.rows[0] ?? [])).toEqual([]);
    expect(wordMismatches(expectedLeaves(record, b1), first.rows[1] ?? [])).toEqual([]);

    // Change only B: A is bit-identical to before, B reads the new values.
    const afterB = await bridge.updateAndRerun(name, first.slots[1] ?? -1, toJson(b2));
    expect(afterB.changed).toBe(true);
    expect(afterB.arena.liveSlots).toBe(2);
    expect(afterB.rows[0]).toEqual(first.rows[0]);
    expect(wordMismatches(expectedLeaves(record, a1), afterB.rows[0] ?? [])).toEqual([]);
    expect(wordMismatches(expectedLeaves(record, b2), afterB.rows[1] ?? [])).toEqual([]);

    // And the other way round: change only A, B keeps the values it just got.
    const afterA = await bridge.updateAndRerun(name, first.slots[0] ?? -1, toJson(a2));
    expect(afterA.changed).toBe(true);
    expect(afterA.rows[1]).toEqual(afterB.rows[1]);
    expect(wordMismatches(expectedLeaves(record, a2), afterA.rows[0] ?? [])).toEqual([]);
    expect(wordMismatches(expectedLeaves(record, b2), afterA.rows[1] ?? [])).toEqual([]);
  });
}
