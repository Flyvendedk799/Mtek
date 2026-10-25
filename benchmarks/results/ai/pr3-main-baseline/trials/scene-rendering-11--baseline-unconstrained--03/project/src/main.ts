import { Scene, Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import { PlaneGeometry } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  loadTexture,
} from "@mtek/benchmarks/baseline-support";
import {
  uv,
  texture,
  vec2,
  floor,
  fract,
} from "three/tsl";

void startTask(async () => {
  // Load textures with appropriate filtering
  const swatchNearest = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  const swatchLinear = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "linear",
    wrap: "clamp",
  });

  const scene = new Scene();

  // Helper to create a square
  const createSquare = (
    x: number,
    z: number,
    name: string,
    material: MeshBasicNodeMaterial
  ) => {
    const geom = new PlaneGeometry(3.6, 3.6);
    const mesh = new Mesh(geom, material);
    mesh.name = name;
    // Rotate to lie flat facing +Y
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 0, z);
    scene.add(mesh);
  };

  // Plain: 1x picture, hard edges
  const plainMat = new MeshBasicNodeMaterial();
  plainMat.name = "Plain";
  // Sample at pixel centers for hard-edged appearance
  // Invert Y: top of picture at small Z
  plainMat.colorNode = texture(
    swatchNearest,
    uv().mul(4).floor().add(0.5).div(4)
  );
  createSquare(-2, -2, "Plain", plainMat);

  // Tiled: 2x2 picture, hard edges
  const tiledMat = new MeshBasicNodeMaterial();
  tiledMat.name = "Tiled";
  // Repeat the texture 2x2
  tiledMat.colorNode = texture(
    swatchNearest,
    uv().mul(2).fract().mul(4).floor().add(0.5).div(4)
  );
  createSquare(0, 2, "Tiled", tiledMat);

  // Smooth: 1x picture, bilinear filtering
  const smoothMat = new MeshBasicNodeMaterial();
  smoothMat.name = "Smooth";
  smoothMat.colorNode = texture(swatchLinear, uv());
  createSquare(2, -2, "Smooth", smoothMat);

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
