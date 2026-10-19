import { describe, expect, it } from "vitest";
import changingMaterialsFile from "../changing-material-params/workload.json" with { type: "json" };
import changingTransformsFile from "../changing-transforms/workload.json" with { type: "json" };
import constantFile from "../constant-scene/workload.json" with { type: "json" };
import cyclesFile from "../mount-reload-dispose/workload.json" with { type: "json" };
import physicsFile from "../physics-bodies/workload.json" with { type: "json" };
import repeatedFile from "../repeated-meshes/workload.json" with { type: "json" };
import assetsFile from "../asset-heavy-startup/workload.json" with { type: "json" };
import {
  assetHeavy,
  changingMaterials,
  changingTransforms,
  colorAt,
  constantScene,
  cycleScene,
  f32Literal,
  forceAt,
  goldenPhase,
  hash01,
  hexToLinear,
  physicsBodies,
  repeatedMeshes,
  srgbToLinear,
  transformAt,
  type AssetHeavyDefinition,
  type ChangingMaterialsDefinition,
  type ChangingTransformsDefinition,
  type ConstantSceneDefinition,
  type CyclesDefinition,
  type PhysicsBodiesDefinition,
  type RepeatedMeshesDefinition,
} from "./layout.ts";

describe("workload sizes (spec/ai-and-benchmarks.md section 7)", () => {
  it("constant scene: 400 boxes in 8 colours", () => {
    const boxes = constantScene(constantFile.definition as unknown as ConstantSceneDefinition);
    expect(boxes).toHaveLength(400);
    expect(new Set(boxes.map((b) => b.colorIndex)).size).toBe(8);
  });

  it("1,000 changing transforms", () => {
    expect(changingTransforms(changingTransformsFile.definition as unknown as ChangingTransformsDefinition)).toHaveLength(1000);
  });

  it("500 changing material params", () => {
    expect(changingMaterials(changingMaterialsFile.definition as unknown as ChangingMaterialsDefinition)).toHaveLength(500);
  });

  it("2,000 repeated meshes", () => {
    expect(repeatedMeshes(repeatedFile.definition as unknown as RepeatedMeshesDefinition)).toHaveLength(2000);
  });

  it("300 physics bodies", () => {
    expect(physicsBodies(physicsFile.definition as unknown as PhysicsBodiesDefinition)).toHaveLength(300);
  });

  it("asset-heavy startup: 12 entities over 4 meshes and 8 textures of 21,600 triangles and 512 x 512", () => {
    const def = assetsFile.definition as unknown as AssetHeavyDefinition;
    expect(assetHeavy(def)).toHaveLength(12);
    expect(def.meshes).toBe(4);
    expect(def.textures).toBe(8);
    expect(def.textureSize).toBe(512);
    expect(def.sphereSegments * def.sphereRings * 2).toBe(21_600);
  });

  it("mount-reload-dispose: 100 boxes, and the reload changes what is drawn", () => {
    const def = cyclesFile.definition as unknown as CyclesDefinition;
    const before = cycleScene(def, 0);
    const after = cycleScene(def, def.reloadPaletteShift);
    expect(before).toHaveLength(100);
    expect(after.map((b) => b.colorIndex)).not.toEqual(before.map((b) => b.colorIndex));
  });
});

describe("the scenes", () => {
  it("are centred on the origin and keep indices in order", () => {
    const boxes = constantScene(constantFile.definition as unknown as ConstantSceneDefinition);
    const sum = boxes.reduce<[number, number, number]>((s, b) => [s[0] + b.position[0], s[1] + b.position[1], s[2] + b.position[2]], [0, 0, 0]);
    expect(Math.abs(sum[0])).toBeLessThan(1e-9);
    expect(Math.abs(sum[2])).toBeLessThan(1e-9);
    expect(boxes.every((b, i) => b.index === i)).toBe(true);
  });

  it("changing transforms bob by the amplitude and turn at the spin rate", () => {
    const def = changingTransformsFile.definition as unknown as ChangingTransformsDefinition;
    const box = changingTransforms(def)[3];
    if (box === undefined) throw new Error("no box");
    const at0 = transformAt(def, box, 0);
    expect(at0.position[1]).toBeCloseTo(def.amplitude * Math.sin(box.phase), 12);
    expect(transformAt(def, box, 2).yaw - at0.yaw).toBeCloseTo(2 * def.spin, 12);
    for (let t = 0; t < 10; t += 0.37) expect(Math.abs(transformAt(def, box, t).position[1])).toBeLessThanOrEqual(def.amplitude + 1e-12);
  });

  it("changing colours stay inside [0, 1]", () => {
    const def = changingMaterialsFile.definition as unknown as ChangingMaterialsDefinition;
    for (const box of changingMaterials(def).slice(0, 20)) {
      for (const t of [0, 0.5, 3.3, 100]) for (const c of colorAt(def, box, t)) expect(c >= 0 && c <= 1).toBe(true);
    }
  });

  it("repeated meshes differ in scale and turn but share one mesh size", () => {
    const def = repeatedFile.definition as unknown as RepeatedMeshesDefinition;
    const boxes = repeatedMeshes(def);
    expect(new Set(boxes.map((b) => b.scale)).size).toBe(10);
    expect(Math.min(...boxes.map((b) => b.scale))).toBeCloseTo(def.scaleMin, 12);
    expect(boxes.every((b) => b.yaw >= 0 && b.yaw < 2 * Math.PI)).toBe(true);
  });

  it("physics bodies start apart (a gap between neighbours) above the floor, with a bounded periodic force", () => {
    const def = physicsFile.definition as unknown as PhysicsBodiesDefinition;
    const boxes = physicsBodies(def);
    expect(Math.min(...boxes.map((b) => b.position[1]))).toBeGreaterThan(def.boxSize / 2);
    const a = boxes[0];
    const b = boxes[1];
    if (a === undefined || b === undefined) throw new Error("no boxes");
    expect(Math.abs(a.position[0] - b.position[0])).toBeGreaterThan(def.boxSize);
    for (const t of [0, 1, 7.7]) {
      const f = forceAt(def, a, t);
      expect(f[1]).toBe(0);
      expect(Math.hypot(f[0], f[2])).toBeLessThanOrEqual(def.forceAmplitude * Math.SQRT2 + 1e-12);
    }
  });
});

describe("numeric helpers", () => {
  it("goldenPhase spreads phases over a full turn without repeating", () => {
    const phases = Array.from({ length: 500 }, (_, i) => goldenPhase(i));
    expect(Math.min(...phases)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...phases)).toBeLessThan(2 * Math.PI);
    expect(new Set(phases).size).toBe(500);
  });

  it("hash01 is deterministic and inside [0, 1)", () => {
    expect(hash01(5, 1)).toBe(hash01(5, 1));
    expect(hash01(5, 1)).not.toBe(hash01(5, 2));
    for (let i = 0; i < 100; i += 1) expect(hash01(i, 1)).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 100; i += 1) expect(hash01(i, 1)).toBeLessThan(1);
  });

  it("converts sRGB to linear with the exact EOTF of spec/language.md section 5.4", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 12);
    expect(srgbToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(hexToLinear("#6b5cff")[0]).toBeCloseTo(srgbToLinear(0x6b), 12);
    expect(() => hexToLinear("#fff")).toThrow();
  });

  it("f32Literal prints the shortest decimal that reads back as the same binary32, always as a float literal", () => {
    expect(f32Literal(1)).toBe("1.0");
    expect(f32Literal(0.1)).toBe("0.1");
    expect(f32Literal(-14.25)).toBe("-14.25");
    expect(f32Literal(1 / 3)).toBe("0.33333334");
    expect(f32Literal(1e-7)).toBe("1.0e-7");
    for (const v of [0.017, 123.456, -0.00031, 6.2831855, 1e10]) {
      expect(Math.fround(Number(f32Literal(v)))).toBe(Math.fround(v));
      expect(f32Literal(v)).toMatch(/^-?\d+\.\d+(e[+-]?\d+)?$/);
    }
    expect(() => f32Literal(Infinity)).toThrow();
  });
});
