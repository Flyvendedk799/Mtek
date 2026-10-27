import { describe, expect, it } from "vitest";
import type { MtekMeshPrimitive } from "../abi/manifest-types.js";
import { meshRegions, regionProblem } from "./asset.js";

const primitive: MtekMeshPrimitive = {
  source: { file: "model.glb", mesh: "Quad", primitive: 0 },
  vertexCount: 4, indexCount: 6, indexFormat: "uint16",
  attributes: ["position", "normal", "uv", "tangent"],
  offsets: { position: 0, normal: 48, uv: 96, tangent: 128, indices: 192 },
  boundingSphere: { center: [0, 0, 0], radius: 1 },
};

describe("packed tangent regions", () => {
  it("reads the entire f32x4 stream and keeps old packages valid", () => {
    expect(regionProblem(primitive, 204)).toBeUndefined();
    expect(meshRegions(primitive).find(r => r.name === "tangent")).toEqual({ name: "tangent", offset: 128, byteLength: 64 });
    expect(regionProblem({ ...primitive, attributes: ["position", "normal", "uv"], offsets: { position: 0, normal: 48, uv: 96, indices: 128 } }, 140)).toBeUndefined();
  });
  it("rejects missing, undeclared or normal-less tangent storage", () => {
    expect(regionProblem({ ...primitive, offsets: { position: 0, normal: 48, uv: 96, indices: 192 } }, 204)).toContain("tangent' has no offset");
    expect(regionProblem({ ...primitive, attributes: ["position", "normal", "uv"] }, 204)).toContain("without declaring");
    expect(regionProblem({ ...primitive, attributes: ["position", "uv", "tangent"] }, 204)).toContain("no normal");
  });
  it("rejects truncated or misaligned frames and overlapping vertex/index regions", () => {
    expect(regionProblem({ ...primitive, offsets: { ...primitive.offsets, tangent: 144 } }, 204)).toContain("tangent data (bytes 144 to 208)");
    expect(regionProblem({ ...primitive, offsets: { ...primitive.offsets, tangent: 130 } }, 204)).toContain("not a multiple of 4");
    for (const tangent of [48, 96, 132, 192]) {
      expect(regionProblem({ ...primitive, offsets: { ...primitive.offsets, tangent } }, 300), String(tangent)).toContain("overlap");
    }
  });
});
