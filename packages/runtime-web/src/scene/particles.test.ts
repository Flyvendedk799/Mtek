import { describe, expect, it } from "vitest";
import { PARTICLE_CAPACITY, ParticleSim } from "./particles.js";

describe("particle emitters", () => {
  it("spawns rate * dt with a fractional accumulator and stops at the cap", () => {
    const sim = new ParticleSim();
    sim.add({ slot: 0, rate: 24, lifetime: 0.8, speed: 1.6, size: 0.12, gravity: 3, meshId: null, materialId: null, instanceIndex: null });
    const random = () => 0.25;
    for (let frame = 0; frame < 8; frame += 1) sim.advance(0.0625, () => ({ x: 1.2, y: 0, z: 0 }), random);
    expect(sim.count()).toBe(12);
    expect(sim.draws()).toEqual([]);
    const capped = new ParticleSim();
    capped.add({ slot: 1, rate: 10_000, lifetime: 10, speed: 0, size: 0.1, gravity: 0, meshId: "mesh:0", materialId: "Unlit", instanceIndex: 0 });
    capped.advance(1, () => ({ x: 0, y: 0, z: 0 }), random);
    expect(capped.count()).toBe(PARTICLE_CAPACITY);
    expect(capped.draws()[0]?.points).toHaveLength(PARTICLE_CAPACITY);
  });

  it("draws from a stream of its own, the same in every run (decision 0173)", () => {
    const run = (): { x: number; y: number; z: number }[] => {
      const sim = new ParticleSim();
      sim.add({ slot: 0, rate: 8, lifetime: 5, speed: 2, size: 0.1, gravity: 0, meshId: "mesh:0", materialId: "Unlit", instanceIndex: 0 });
      sim.advance(1, () => ({ x: 0, y: 0, z: 0 }));
      sim.advance(0.5, () => ({ x: 0, y: 0, z: 0 }));
      return sim.draws()[0]?.points.map(({ x, y, z }) => ({ x, y, z })) ?? [];
    };
    const first = run();
    expect(first.length).toBeGreaterThan(8);
    expect(run()).toEqual(first);
    // Not all alike: the stream moves.
    expect(new Set(first.map((p) => p.x)).size).toBeGreaterThan(1);
  });

  it("hands out the same draw records while the emitter lives", () => {
    const sim = new ParticleSim();
    sim.add({ slot: 0, rate: 10, lifetime: 5, speed: 1, size: 0.1, gravity: 0, meshId: "mesh:0", materialId: "Unlit", instanceIndex: 0 });
    sim.advance(1, () => ({ x: 0, y: 0, z: 0 }));
    const first = sim.draws();
    const record = first[0];
    sim.advance(0.5, () => ({ x: 0, y: 0, z: 0 }));
    expect(sim.draws()).toBe(first);
    expect(sim.draws()[0]).toBe(record);
    expect(record?.points.length).toBe(sim.count());
  });
});
