import { describe, expect, it } from "vitest";
import { PARTICLE_CAPACITY, ParticleSim } from "./particles.js";

describe("particle emitters", () => {
  it("spawns rate * dt with a fractional accumulator and stops at the cap", () => {
    const sim = new ParticleSim();
    sim.add({ slot: 0, rate: 24, lifetime: 0.8, speed: 1.6, size: 0.12, gravity: 3, meshId: null, materialId: null, instanceIndex: null });
    const random = () => 0.25;
    for (let frame = 0; frame < 8; frame += 1) sim.advance(0.0625, random, () => ({ x: 1.2, y: 0, z: 0 }));
    expect(sim.count()).toBe(12);
    expect(sim.draws()).toEqual([]);
    const capped = new ParticleSim();
    capped.add({ slot: 1, rate: 10_000, lifetime: 10, speed: 0, size: 0.1, gravity: 0, meshId: "mesh:0", materialId: "Unlit", instanceIndex: 0 });
    capped.advance(1, random, () => ({ x: 0, y: 0, z: 0 }));
    expect(capped.count()).toBe(PARTICLE_CAPACITY);
    expect(capped.draws()[0]?.points).toHaveLength(PARTICLE_CAPACITY);
  });
});
