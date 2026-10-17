import { describe, expect, it } from "vitest";
import type { Mat4 } from "../math/mat4.js";
import type { ResolvedLight } from "../scene/structure.js";
import type { LightRecord } from "../scene/world.js";
import { LIGHT_KIND, emptyPackedLights, packLights, type LightSource } from "./lights.js";

const fr = Math.fround;

/**
 * A column-major world matrix written out by hand from a rotation about +Y by `angle`, a scale and a
 * translation: columns are (R*sx, R*sy, R*sz, t) with R_y = [[c, 0, s], [0, 1, 0], [-s, 0, c]], so column
 * 0 = (c, 0, -s) * sx, column 1 = (0, 1, 0) * sy, column 2 = (s, 0, c) * sz. This shares no code with the
 * runtime's matrix library.
 */
function worldAboutY(angle: number, scale: readonly [number, number, number], translate: readonly [number, number, number]): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [sx, sy, sz] = scale;
  const [tx, ty, tz] = translate;
  return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, tx, ty, tz, 1]);
}

function sourceOf(records: LightRecord[], matrices: Mat4[]): LightSource {
  return {
    light: (entity) => {
      const record = records[entity];
      if (record === undefined) throw new Error(`no light on ${String(entity)}`);
      return record;
    },
    worldMatrix: (entity) => {
      const matrix = matrices[entity];
      if (matrix === undefined) throw new Error(`no matrix of ${String(entity)}`);
      return matrix;
    },
  };
}

describe("packLights", () => {
  it("premultiplies the colour by the intensity", () => {
    const records: LightRecord[] = [{ color: { r: 1, g: 0.5, b: 0.25, a: 0.1 }, intensity: 3, range: 0 }];
    const declared: ResolvedLight[] = [{ index: 0, entity: 0, kind: "directional", range: 0 }];
    const out = emptyPackedLights(4);
    const count = packLights(declared, sourceOf(records, [worldAboutY(0, [1, 1, 1], [0, 0, 0])]), out);
    expect(count).toBe(1);
    // 1*3, 0.5*3, 0.25*3; the alpha (0.1) plays no part.
    expect(out[0]?.color).toEqual({ x: 3, y: 1.5, z: 0.75 });
  });

  it("aims a light along the entity's -Z axis: rotating about +Y by theta gives (-sin theta, 0, -cos theta)", () => {
    const theta = 0.9;
    const records: LightRecord[] = [{ color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 }];
    const declared: ResolvedLight[] = [{ index: 0, entity: 0, kind: "directional", range: 0 }];
    const out = emptyPackedLights(4);
    packLights(declared, sourceOf(records, [worldAboutY(theta, [1, 1, 1], [0, 0, 0])]), out);
    const direction = out[0]?.direction;
    expect(direction?.x).toBeCloseTo(-Math.sin(theta), 6);
    expect(direction?.y).toBeCloseTo(0, 6);
    expect(direction?.z).toBeCloseTo(-Math.cos(theta), 6);
  });

  it("an unrotated entity points down -Z, a quarter turn about +Y points down -X", () => {
    const records: LightRecord[] = [
      { color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 },
      { color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 },
    ];
    const declared: ResolvedLight[] = [
      { index: 0, entity: 0, kind: "directional", range: 0 },
      { index: 1, entity: 1, kind: "directional", range: 0 },
    ];
    const out = emptyPackedLights(4);
    packLights(declared, sourceOf(records, [worldAboutY(0, [1, 1, 1], [0, 0, 0]), worldAboutY(Math.PI / 2, [1, 1, 1], [0, 0, 0])]), out);
    expect(out[0]?.direction.x).toBeCloseTo(0, 6);
    expect(out[0]?.direction.y).toBeCloseTo(0, 6);
    expect(out[0]?.direction.z).toBeCloseTo(-1, 6);
    expect(out[1]?.direction.x).toBeCloseTo(-1, 6);
    expect(out[1]?.direction.y).toBeCloseTo(0, 6);
    expect(out[1]?.direction.z).toBeCloseTo(0, 6);
  });

  it("normalises the direction: a non-uniform scale does not change where the entity points", () => {
    const theta = -0.4;
    const records: LightRecord[] = [{ color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 }];
    const declared: ResolvedLight[] = [{ index: 0, entity: 0, kind: "directional", range: 0 }];
    const out = emptyPackedLights(4);
    packLights(declared, sourceOf(records, [worldAboutY(theta, [2, 3, 0.25], [0, 0, 0])]), out);
    const d = out[0]?.direction;
    expect(d?.x).toBeCloseTo(-Math.sin(theta), 6);
    expect(d?.z).toBeCloseTo(-Math.cos(theta), 6);
    expect(Math.hypot(d?.x ?? 0, d?.y ?? 0, d?.z ?? 0)).toBeCloseTo(1, 6);
  });

  it("writes the world position, the kind and the range of a point light", () => {
    const records: LightRecord[] = [{ color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, intensity: 10, range: 6.5 }];
    const declared: ResolvedLight[] = [{ index: 0, entity: 0, kind: "point", range: 6.5 }];
    const out = emptyPackedLights(4);
    packLights(declared, sourceOf(records, [worldAboutY(0.3, [1, 1, 1], [1, 2, 3])]), out);
    expect(out[0]?.kind).toBe(1);
    expect(out[0]?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(out[0]?.range).toBe(6.5);
    expect(out[0]?.color).toEqual({ x: 5, y: 5, z: 5 });
  });

  it("numbers the kinds 0 = directional, 1 = point (spec/gpu-layout.md section 6.1)", () => {
    expect(LIGHT_KIND).toEqual({ directional: 0, point: 1 });
  });

  it("returns the light count, fills slots in scene.lights order and leaves the others zero", () => {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    const records: LightRecord[] = [
      { color: white, intensity: 1, range: 0 },
      { color: white, intensity: 2, range: 5 },
      { color: white, intensity: 4, range: 0 },
    ];
    const matrices = [worldAboutY(0, [1, 1, 1], [0, 0, 0]), worldAboutY(0, [1, 1, 1], [7, 8, 9]), worldAboutY(0, [1, 1, 1], [0, 0, 0])];
    // Lights 0..2 sit on entities 2, 0 and 1.
    const declared: ResolvedLight[] = [
      { index: 0, entity: 2, kind: "directional", range: 0 },
      { index: 1, entity: 0, kind: "directional", range: 0 },
      { index: 2, entity: 1, kind: "point", range: 5 },
    ];
    const out = emptyPackedLights(4);
    expect(packLights(declared, sourceOf(records, matrices), out)).toBe(3);
    expect(out.map((light) => light.color.x)).toEqual([4, 1, 2, 0]);
    expect(out[3]).toEqual({ color: { x: 0, y: 0, z: 0 }, kind: 0, position: { x: 0, y: 0, z: 0 }, range: 0, direction: { x: 0, y: 0, z: 0 }, reserved: 0 });
  });

  it("follows a change of the colour or the intensity on the next call", () => {
    const record: LightRecord = { color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 };
    const declared: ResolvedLight[] = [{ index: 0, entity: 0, kind: "directional", range: 0 }];
    const source = sourceOf([record], [worldAboutY(0, [1, 1, 1], [0, 0, 0])]);
    const out = emptyPackedLights(4);
    packLights(declared, source, out);
    expect(out[0]?.color).toEqual({ x: 1, y: 1, z: 1 });
    record.color = { r: 0.5, g: 0, b: 1, a: 1 };
    record.intensity = fr(2.5);
    packLights(declared, source, out);
    expect(out[0]?.color).toEqual({ x: 1.25, y: 0, z: 2.5 });
  });

  it("refuses more lights than the frame block holds", () => {
    const record: LightRecord = { color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 1, range: 0 };
    const declared: ResolvedLight[] = [0, 1, 2].map((index) => ({ index, entity: 0, kind: "directional", range: 0 }));
    expect(() => packLights(declared, sourceOf([record], [worldAboutY(0, [1, 1, 1], [0, 0, 0])]), emptyPackedLights(2))).toThrow(RangeError);
  });
});
