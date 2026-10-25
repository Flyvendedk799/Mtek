import { Scene, MeshBasicNodeMaterial } from "three/webgpu";
import { Mesh, PlaneGeometry } from "three/webgpu";
import { uv, texture } from "three/tsl";
import { lookAtCamera, startTask, loadTexture } from "@mtek/benchmarks/baseline-support";

void startTask(async () => {
  // Load textures with different filtering modes
  const plainTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  const tiledTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "repeat",
  });

  const smoothTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "linear",
    wrap: "clamp",
  });

  const scene = new Scene();

  // Create unlit materials using TSL that sample textures
  const plainMaterial = new MeshBasicNodeMaterial();
  plainMaterial.name = "Plain";
  plainMaterial.colorNode = texture(plainTexture, uv());

  const tiledMaterial = new MeshBasicNodeMaterial();
  tiledMaterial.name = "Tiled";
  tiledMaterial.colorNode = texture(tiledTexture, uv().mul(2)); // 2x2 tiling

  const smoothMaterial = new MeshBasicNodeMaterial();
  smoothMaterial.name = "Smooth";
  smoothMaterial.colorNode = texture(smoothTexture, uv());

  // Create plane geometry (3.6 x 3.6)
  const geometry = new PlaneGeometry(3.6, 3.6);

  // Plain square at (-2, 0, -2)
  const plainMesh = new Mesh(geometry, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  plainMesh.rotation.x = -Math.PI / 2; // Lay flat, facing +Y
  scene.add(plainMesh);

  // Tiled square at (0, 0, 2)
  const tiledMesh = new Mesh(geometry, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  tiledMesh.rotation.x = -Math.PI / 2; // Lay flat, facing +Y
  scene.add(tiledMesh);

  // Smooth square at (2, 0, -2)
  const smoothMesh = new Mesh(geometry, smoothMaterial);
  smoothMesh.name = "Smooth";
  smoothMesh.position.set(2, 0, -2);
  smoothMesh.rotation.x = -Math.PI / 2; // Lay flat, facing +Y
  scene.add(smoothMesh);

  return {
    scene,
    camera: lookAtCamera({
      position: [0, 11, 3],
      target: [0, 0, 0],
      fovY: 0.72,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#1b2430",
  };
});
