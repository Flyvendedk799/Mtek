/**
 * A program with assets for host tests (decision 0060): the minimal manifest with its one entity drawing an asset
 * mesh and sampling an asset texture, and the two asset files on the fake server. Every value is written out so
 * tests can state the expected GPU bytes and texels by hand.
 *
 * `mesh-data` (`assets/00000000000000a1.bin`, 68 bytes): one primitive, three vertices.
 *   bytes  0..36  position  (0, 0, 0), (2, 0, 0), (0, 2, 0)           f32 x 3 each
 *   bytes 36..60  uv        (0, 0), (1, 0), (0, 1)                    f32 x 2 each
 *   bytes 60..66  indices   0, 1, 2                                   uint16, then 2 bytes of padding
 *   bounding sphere: centre (1, 1, 0), radius 1.5 (a bound that holds; the compiler's would be tighter)
 * `image` (`assets/00000000000000b1.png`): a 2 x 2 image, texels (row by row) red, green, blue, white.
 */
import { createHash } from "node:crypto";
import type { MtekManifest } from "../abi/manifest-types.js";
import { checkManifest } from "../abi/validate.js";
import { BASE_URL, FakeHost, fakeImage, fakeProgram, minimalSceneInit } from "./fake-host.js";
import { SHADER_URL, SHADER_MAP_URL, MATERIAL, VALID_WGSL, spanMapJson, validManifest } from "./mount-fixture.js";

export const MESH_URL = "assets/00000000000000a1.bin";
export const IMAGE_URL = "assets/00000000000000b1.png";

/** The packaged mesh file: see the layout in the file comment. */
export function meshBytes(): Uint8Array {
  const bytes = new Uint8Array(68);
  const view = new DataView(bytes.buffer);
  [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 1].forEach((value, i) => view.setFloat32(i * 4, value, true));
  [0, 1, 2].forEach((index, i) => view.setUint16(60 + i * 2, index, true));
  return bytes;
}

/** The decoded texels of the image, row by row, RGBA. */
export const TEXELS = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255];

export function imageBytes(): Uint8Array {
  return fakeImage(2, 2, TEXELS);
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface AssetProgramOptions {
  /** `"linear"` for a data texture; default `"srgb"`. */
  readonly colorSpace?: "srgb" | "linear";
  /** Other bytes for the image file: the manifest records (and the server serves) their length and digest. */
  readonly image?: Uint8Array;
  /** The primitive's bounding sphere in the manifest; default centre (1, 1, 0), radius 1.5. */
  readonly boundingSphere?: { readonly center: readonly [number, number, number]; readonly radius: number };
}

/** The manifest of the asset program: the mesh and the texture are used by the one entity. */
export function assetManifestJson(options: AssetProgramOptions = {}): Record<string, unknown> {
  const manifest = validManifest();
  const mesh = meshBytes();
  const image = options.image ?? imageBytes();
  manifest["assets"] = [
    {
      url: MESH_URL,
      sha256: sha256(mesh),
      bytes: mesh.byteLength,
      kind: "mesh-data",
      primitives: [
        {
          source: { file: "models/tri.glb", mesh: "Tri", primitive: 0 },
          vertexCount: 3,
          indexCount: 3,
          indexFormat: "uint16",
          attributes: ["position", "uv"],
          offsets: { position: 0, uv: 36, indices: 60 },
          boundingSphere: options.boundingSphere ?? { center: [1, 1, 0], radius: 1.5 },
        },
      ],
      preprocessing: [],
      span: 3,
    },
    { url: IMAGE_URL, sha256: sha256(image), bytes: image.byteLength, kind: "image", colorSpace: options.colorSpace ?? "srgb", preprocessing: [], span: 3 },
  ];
  manifest["meshes"] = [{ id: "mesh:0", kind: "asset", asset: MESH_URL, primitive: 0 }];
  // The material samples a texture (binding 1) with a sampler (binding 2) and so reads position and uv.
  const material = (manifest["materials"] as Record<string, unknown>[])[0] ?? {};
  material["resources"] = [
    { name: "map", kind: "texture", binding: 1 },
    { name: "filter", kind: "sampler", binding: 2 },
  ];
  (material["params"] as unknown[]).push({ name: "map", type: "texture", span: 3 }, { name: "filter", type: "sampler", span: 3 });
  ((manifest["shaders"] as Record<string, unknown>[])[0] ?? {})["vertexAttributes"] = ["position", "uv"];
  const scene = manifest["scene"] as { materialInstances: { params: unknown[] }[] };
  scene.materialInstances[0]?.params.push(
    { name: "map", class: "resource", value: { kind: "asset", asset: IMAGE_URL } },
    { name: "filter", class: "resource", value: { kind: "builtin", name: "sampler.nearest_clamp" } },
  );
  return manifest;
}

/** Puts the manifest, the shader files and the asset files of the asset program on the fake server. */
export function installAssetProgram(host: FakeHost, options: AssetProgramOptions = {}, edit?: (manifest: Record<string, unknown>) => void): Record<string, unknown> {
  const manifest = assetManifestJson(options);
  edit?.(manifest);
  host.files.set(`${BASE_URL}program.manifest.json`, JSON.stringify(manifest));
  host.files.set(SHADER_URL, VALID_WGSL);
  host.files.set(SHADER_MAP_URL, spanMapJson());
  host.files.set(`${BASE_URL}${MESH_URL}`, meshBytes());
  host.files.set(`${BASE_URL}${IMAGE_URL}`, options.image ?? imageBytes());
  return manifest;
}

/** The program module for the asset manifest (its writers come from the manifest's layouts). */
export function assetProgram(manifest: Record<string, unknown>, init: (ctx: object) => void = minimalSceneInit): ReturnType<typeof fakeProgram> {
  const parsed = checkManifest(manifest);
  if (!parsed.ok) throw new Error(`the asset manifest is not valid: ${JSON.stringify(parsed.failures)}`);
  return fakeProgram(init, parsed.manifest as MtekManifest);
}

export { MATERIAL };
