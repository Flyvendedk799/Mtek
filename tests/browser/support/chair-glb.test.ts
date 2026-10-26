// M4-10: the GLB of `examples/material-configurator` is not a download: it is written from explicit data by
// tests/assets/tools/make-glb.mjs, byte for byte the same every time. This test regenerates the whole generator output into two
// scratch directories and compares the chair and its two variants with the committed files (`npm run check:assets` does the same
// for every generated file, in place).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./environment.ts";
import { parseGlb } from "./configurator-scene.ts";

const GENERATOR = join(REPO_ROOT, "tests", "assets", "tools", "make-glb.mjs");
/** The generated files of the configurator, as repository-relative paths. */
const FILES = [
  "examples/material-configurator/models/chair.glb",
  "tests/browser/fixtures/m4-variants/chair_normal_texture.glb",
  "tests/browser/fixtures/m4-variants/chair_required_extension.glb",
] as const;

const scratch: string[] = [];

function regenerate(): string {
  const dir = mkdtempSync(join(tmpdir(), "mtek-glb-"));
  scratch.push(dir);
  execFileSync(process.execPath, [GENERATOR, "--out", dir], { cwd: REPO_ROOT, stdio: "pipe" });
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("examples/material-configurator/models/chair.glb is reproducible from the generator", () => {
  const first = regenerate();
  const second = regenerate();

  for (const file of FILES) {
    it(`${file}: a fresh run writes the committed bytes, and two runs write the same bytes`, () => {
      const committed = readFileSync(join(REPO_ROOT, file));
      const a = readFileSync(join(first, file));
      const b = readFileSync(join(second, file));
      expect(a.equals(committed), "the regenerated file equals the committed file").toBe(true);
      expect(a.equals(b), "two runs agree").toBe(true);
      expect(a.length).toBeGreaterThan(2000);
    });
  }

  it("is a binary glTF 2.0 file whose generator is named in its asset record", () => {
    const glb = parseGlb(readFileSync(join(REPO_ROOT, FILES[0])));
    const asset = (glb.json as unknown as { asset: { version: string; generator: string } }).asset;
    expect(asset.version).toBe("2.0");
    expect(asset.generator).toBe("mtek tests/assets/tools/make-glb.mjs");
  });

  it("differs from its variants exactly where the variant breaks the profile", () => {
    const chair = parseGlb(readFileSync(join(REPO_ROOT, FILES[0])));
    const normal = parseGlb(readFileSync(join(REPO_ROOT, FILES[1]))).json as unknown as { materials: Array<{ name: string; normalTexture?: unknown }>; images?: unknown[] };
    const extension = parseGlb(readFileSync(join(REPO_ROOT, FILES[2]))).json as unknown as { extensionsRequired?: string[] };
    expect((chair.json as unknown as { images?: unknown }).images).toBeUndefined();
    expect(normal.materials.find((m) => m.name === "Fabric")?.normalTexture).toEqual({ index: 0, texCoord: 1 });
    expect(normal.materials.filter((m) => m.normalTexture !== undefined)).toHaveLength(1);
    expect(normal.images).toHaveLength(1);
    expect(extension.extensionsRequired).toEqual(["KHR_draco_mesh_compression"]);
  });
});
