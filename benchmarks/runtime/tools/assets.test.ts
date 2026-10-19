import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetHeavyDefinition } from "../common/layout.ts";
import workload from "../asset-heavy-startup/workload.json" with { type: "json" };
import { assetHashes, buildGlb, sphereMesh, texturePixels } from "./assets.ts";
import { decodePng, encodePng } from "./png.ts";
import { RUNTIME_ROOT } from "./paths.ts";

const def = workload.definition as unknown as AssetHeavyDefinition;

describe("the generated assets", () => {
  it("a mesh has 21,600 triangles over 11,011 vertices, indices inside the vertex range, counter-clockwise from outside", () => {
    const mesh = sphereMesh(def, 0);
    expect(mesh.indices.length / 3).toBe(21_600);
    expect(mesh.positions.length / 3).toBe(121 * 91);
    expect(Math.max(...mesh.indices)).toBe(mesh.positions.length / 3 - 1);
    // A triangle in the middle of the sphere (the rings next to the poles are degenerate): its normal points away from the centre.
    const p = (i: number): number[] => [mesh.positions[i * 3] as number, mesh.positions[i * 3 + 1] as number, mesh.positions[i * 3 + 2] as number];
    const first = (45 * 120 + 10) * 6;
    const a = p(mesh.indices[first] as number);
    const b = p(mesh.indices[first + 1] as number);
    const c = p(mesh.indices[first + 2] as number);
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    const centre = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3];
    expect(n[0]! * centre[0]! + n[1]! * centre[1]! + n[2]! * centre[2]!).toBeGreaterThan(0);
  });

  it("the GLB is a valid container with four named meshes", () => {
    const glb = buildGlb(def);
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength)) as { meshes: Array<{ name: string }> };
    expect(json.meshes.map((m) => m.name)).toEqual(["Rock0", "Rock1", "Rock2", "Rock3"]);
    expect(glb.readUInt32LE(20 + jsonLength + 4)).toBe(0x004e4942);
  });

  it("textures are 512 x 512 RGBA, opaque, different from each other, and survive a PNG round trip", () => {
    const a = texturePixels(def, 0);
    const b = texturePixels(def, 1);
    expect(a).toHaveLength(512 * 512 * 4);
    expect(a.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    const decoded = decodePng(encodePng(512, 512, a));
    expect(decoded.width).toBe(512);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(a))).toBe(true);
  });

  it("hash to the values recorded with the frozen definitions (the bytes of the GLB, the pixels of each texture)", () => {
    const recorded = join(RUNTIME_ROOT, "asset-heavy-startup", "assets.sha256.json");
    expect(existsSync(recorded), "assets.sha256.json is written by `node tools/assets.ts --record`").toBe(true);
    expect(assetHashes(def)).toEqual(JSON.parse(readFileSync(recorded, "utf8")));
  });
});
