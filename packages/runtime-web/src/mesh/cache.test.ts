import { describe, expect, it } from "vitest";
import { MeshCache, meshKey } from "./cache.js";
import type { MeshDescriptor } from "./cache.js";
import { generateBox, generatePlane, generateSphere } from "./primitives.js";

describe("meshKey", () => {
  it("is the same for equal descriptor values and different otherwise", () => {
    const box: MeshDescriptor = { kind: "box", size: [1, 2, 3] };
    expect(meshKey(box)).toBe(meshKey({ kind: "box", size: [1, 2, 3] }));
    expect(meshKey(box)).not.toBe(meshKey({ kind: "box", size: [1, 2, 4] }));
    expect(meshKey(box)).not.toBe(meshKey({ kind: "box", size: [3, 2, 1] }));
  });

  it("does not depend on property order", () => {
    const a = meshKey({ kind: "sphere", radius: 0.5, segments: 32, rings: 16 });
    const b = meshKey({ rings: 16, segments: 32, radius: 0.5, kind: "sphere" });
    expect(a).toBe(b);
  });

  it("separates kinds even when the numbers coincide", () => {
    expect(meshKey({ kind: "box", size: [1, 1, 1] })).not.toBe(meshKey({ kind: "sphere", radius: 1, segments: 1, rings: 1 }));
    expect(meshKey({ kind: "plane", size: [1, 1] })).not.toBe(meshKey({ kind: "box", size: [1, 1, 1] }));
  });

  it("distinguishes sphere segments from rings", () => {
    expect(meshKey({ kind: "sphere", radius: 1, segments: 8, rings: 4 })).not.toBe(
      meshKey({ kind: "sphere", radius: 1, segments: 4, rings: 8 }),
    );
  });

  it("keys numbers by exact value (no lossy rounding) and treats -0 like 0", () => {
    expect(meshKey({ kind: "plane", size: [0.1, 1] })).not.toBe(meshKey({ kind: "plane", size: [0.1 + 1e-12, 1] }));
    expect(meshKey({ kind: "plane", size: [-0, 1] })).toBe(meshKey({ kind: "plane", size: [0, 1] }));
  });
});

describe("MeshCache", () => {
  it("shares one immutable mesh between identical descriptors", () => {
    const cache = new MeshCache();
    const a = cache.get({ kind: "box", size: [1, 1, 1] });
    const b = cache.get({ kind: "box", size: [1, 1, 1] });
    expect(b).toBe(a);
    expect(b.positions).toBe(a.positions);
    expect(cache.size).toBe(1);
    expect(cache.generated).toBe(1);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("generates separate meshes for different descriptors", () => {
    const cache = new MeshCache();
    const a = cache.get({ kind: "box", size: [1, 1, 1] });
    const b = cache.get({ kind: "box", size: [2, 1, 1] });
    const c = cache.get({ kind: "plane", size: [1, 1] });
    const d = cache.get({ kind: "sphere", radius: 0.5, segments: 32, rings: 16 });
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(cache.size).toBe(4);
    expect(cache.generated).toBe(4);
  });

  it("returns the same data as calling the generators directly", () => {
    const cache = new MeshCache();
    expect(Array.from(cache.get({ kind: "box", size: [1, 2, 3] }).positions)).toEqual(Array.from(generateBox([1, 2, 3]).positions));
    expect(Array.from(cache.get({ kind: "plane", size: [2, 5] }).positions)).toEqual(Array.from(generatePlane([2, 5]).positions));
    const sphere = cache.get({ kind: "sphere", radius: 2, segments: 8, rings: 4 });
    const direct = generateSphere(2, 8, 4);
    expect(Array.from(sphere.indices)).toEqual(Array.from(direct.indices));
    expect(sphere.boundingRadius).toBe(direct.boundingRadius);
  });

  it("regenerates after clear()", () => {
    const cache = new MeshCache();
    const first = cache.get({ kind: "plane", size: [1, 1] });
    cache.clear();
    expect(cache.size).toBe(0);
    const second = cache.get({ kind: "plane", size: [1, 1] });
    expect(second).not.toBe(first);
    expect(cache.generated).toBe(2);
  });

  it("does not cache descriptors that fail validation", () => {
    const cache = new MeshCache();
    expect(() => cache.get({ kind: "box", size: [0, 1, 1] })).toThrow(RangeError);
    expect(cache.size).toBe(0);
  });

  it("keeps independent caches independent", () => {
    const a = new MeshCache();
    const b = new MeshCache();
    expect(a.get({ kind: "box", size: [1, 1, 1] })).not.toBe(b.get({ kind: "box", size: [1, 1, 1] }));
  });
});
