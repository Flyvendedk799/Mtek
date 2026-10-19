// Asset-heavy startup, three.js: `GLTFLoader` reads the GLB; each PNG is fetched and decoded with `createImageBitmap` (no
// colour conversion, no premultiplication) into a `Texture` configured like Mtek's `sampler.linear_repeat()` (bilinear, repeat,
// no mip-maps, sRGB); a `MeshBasicMaterial` per texture; 12 meshes. The loader, the decoding and `renderer.init()` run
// concurrently.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LinearFilter, RepeatWrapping, SRGBColorSpace, Texture } from "three/webgpu";
import { assetHeavy, type AssetHeavyDefinition } from "../../common/layout.ts";
import { Mesh, MeshBasicMaterial, createThreeContext, disposeThree, readThree, renderThree } from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

async function loadTexture(url: string): Promise<Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot load ${url}: HTTP ${String(response.status)}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const texture = new Texture(bitmap);
  // glTF texture coordinates have their origin at the top left, like the unflipped bitmap.
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export const create: Create = async (context): Promise<BenchApp> => {
  const def = workload.definition as unknown as AssetHeavyDefinition;
  const placed = assetHeavy(def);
  const base = context.assetBase;
  const [gltf, textures, three] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}rocks.glb`),
    Promise.all(Array.from({ length: def.textures }, (_, i) => loadTexture(`${base}t${String(i)}.png`))),
    createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] }),
  ]);
  const materials = textures.map((map) => new MeshBasicMaterial({ map }));
  const sources = Array.from({ length: def.meshes }, (_, i) => {
    const node = gltf.scene.getObjectByName(`Rock${String(i)}`) as Mesh | undefined;
    if (node === undefined) throw new Error(`the GLB has no mesh Rock${String(i)}`);
    return node.geometry;
  });
  const meshes = placed.map((entity) => {
    const mesh = new Mesh(sources[entity.meshIndex], materials[entity.textureIndex]);
    mesh.position.set(...entity.position);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    three.scene.add(mesh);
    return mesh;
  });
  three.scene.updateMatrixWorld(true);
  three.scene.matrixWorldAutoUpdate = false;
  void meshes;

  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      renderThree(three);
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readThree(three),
    dispose(): void {
      for (const geometry of sources) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      disposeThree(three);
    },
  };
};
