// M0 bridge test 3 (spec/testing.md section 6.2, spec/gpu-layout.md section 8.2): changing a value
// creates no pipeline, shader module or bind group; only the upload counters grow, by exactly the
// one slot that changed. Writing bytes identical to the mirror uploads nothing.
import { fixtureNames, loadFixture } from "../../support/bridge-driver.ts";
import { createRng, sampleValue, toJson } from "../../support/bridge-values.ts";
import { expect, test, testSeed } from "../../support/bridge-fixtures.ts";

for (const name of fixtureNames()) {
  test(`${name}: value updates create no pipeline, shader module or bind group`, async ({ bridge }, testInfo) => {
    const { record } = loadFixture(name);
    const rng = createRng(testSeed(testInfo, `${name}:counters`));
    const a1 = sampleValue(record, rng, "random", 0);
    const b1 = sampleValue(record, rng, "random", 1);
    const b2 = sampleValue(record, rng, "random", 0);
    const a2 = sampleValue(record, rng, "random", 1);

    const probe = await bridge.runProbe(name, toJson(a1), toJson(b1));
    const before = await bridge.counters();
    // The counters are not vacuous: the first run created exactly one shader module and one
    // pipeline, uploaded both slots, and made one bind group per slot plus the empty group 0.
    expect(before.shaderModulesCreated).toBe(1);
    expect(before.pipelinesCreated).toBe(1);
    expect(before.bindGroupsCreated).toBe(3);
    expect(before.uploads).toBe(2);
    expect(before.uploadBytes).toBe(2 * record.size);

    const afterB = await bridge.updateAndRerun(name, probe.slots[1] ?? -1, toJson(b2));
    expect(afterB.changed).toBe(true);
    const countersB = await bridge.counters();
    expect(countersB.pipelinesCreated).toBe(before.pipelinesCreated);
    expect(countersB.shaderModulesCreated).toBe(before.shaderModulesCreated);
    expect(countersB.bindGroupsCreated).toBe(before.bindGroupsCreated);
    expect(countersB.buffersAllocated).toBe(before.buffersAllocated);
    expect(countersB.uploads).toBe(before.uploads + 1);
    expect(countersB.uploadBytes).toBe(before.uploadBytes + record.size);

    const afterA = await bridge.updateAndRerun(name, probe.slots[0] ?? -1, toJson(a2));
    expect(afterA.changed).toBe(true);
    const countersA = await bridge.counters();
    expect(countersA.pipelinesCreated).toBe(before.pipelinesCreated);
    expect(countersA.shaderModulesCreated).toBe(before.shaderModulesCreated);
    expect(countersA.bindGroupsCreated).toBe(before.bindGroupsCreated);
    expect(countersA.uploads).toBe(before.uploads + 2);
    expect(countersA.uploadBytes).toBe(before.uploadBytes + 2 * record.size);

    // The same values again: the arena sees identical bytes, so nothing is dirty or uploaded.
    const unchanged = await bridge.updateAndRerun(name, probe.slots[0] ?? -1, toJson(a2));
    expect(unchanged.changed).toBe(false);
    const countersSame = await bridge.counters();
    expect(countersSame.uploads).toBe(countersA.uploads);
    expect(countersSame.uploadBytes).toBe(countersA.uploadBytes);
    expect(countersSame.pipelinesCreated).toBe(before.pipelinesCreated);
    expect(countersSame.shaderModulesCreated).toBe(before.shaderModulesCreated);
  });
}
