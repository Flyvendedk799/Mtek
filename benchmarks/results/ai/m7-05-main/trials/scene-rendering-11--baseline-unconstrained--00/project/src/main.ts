import { Scene, Mesh } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  loadTexture,
} from "@mtek/benchmarks/baseline-support";
import {
  PlaneGeometry,
  MeshBasicNodeMaterial,
  DoubleSide,
  BufferAttribute,
} from "three/webgpu";
import { uv, texture } from "three/tsl";

void startTask(async () => {
  const scene = new Scene();

  // Load the swatch texture
  const swatchTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  const swatchTextureLinear = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "linear",
    wrap: "clamp",
  });

  // Create the three squares
  const squareSize = 3.6;
  const geometry = new PlaneGeometry(squareSize, squareSize);

  // Fix UV coordinates for proper orientation
  // PlaneGeometry lies in XY plane, we rotate it to XZ plane (facing +Y)
  // Default UV: (0,0) at bottom-left, (1,1) at top-right in the XY plane
  // After rotation to XZ plane: (0,0) should be at (x_min, z_max) - top-left from above
  // We need: top edge at smaller z, left edge at smaller x
  // This means: (0,0) -> (x_min, z_max), (1,0) -> (x_max, z_max), (0,1) -> (x_min, z_min), (1,1) -> (x_max, z_min)
  const uvAttribute = geometry.getAttribute("uv");
  const uvArray = uvAttribute.array as Float32Array;
  
  // Flip V coordinate to get the right orientation
  for (let i = 0; i < uvArray.length; i += 2) {
    const u = uvArray[i]!;
    const v = uvArray[i + 1]!;
    uvArray[i] = u; // Keep u as is (left-right)
    uvArray[i + 1] = 1 - v; // Flip v (up-down)
  }
  uvAttribute.needsUpdate = true;

  // Plain: hard-edged, single image
  const plainGeometry = geometry.clone();
  const plainMaterial = new MeshBasicNodeMaterial();
  plainMaterial.name = "Plain";
  plainMaterial.colorNode = texture(swatchTexture, uv());
  plainMaterial.side = DoubleSide;
  const plain = new Mesh(plainGeometry, plainMaterial);
  plain.name = "Plain";
  plain.position.set(-2, 0, -2);
  plain.rotation.x = -Math.PI / 2;
  scene.add(plain);

  // Tiled: hard-edged, tiled 2x2
  const tiledGeometry = geometry.clone();
  const tiledMaterial = new MeshBasicNodeMaterial();
  tiledMaterial.name = "Tiled";
  // Scale UV to repeat 2x2
  const tiledUV = uv().mul(2);
  tiledMaterial.colorNode = texture(swatchTexture, tiledUV);
  tiledMaterial.side = DoubleSide;
  const tiled = new Mesh(tiledGeometry, tiledMaterial);
  tiled.name = "Tiled";
  tiled.position.set(0, 0, 2);
  tiled.rotation.x = -Math.PI / 2;
  scene.add(tiled);

  // Smooth: bilinear filtered, single image
  const smoothGeometry = geometry.clone();
  const smoothMaterial = new MeshBasicNodeMaterial();
  smoothMaterial.name = "Smooth";
  smoothMaterial.colorNode = texture(swatchTextureLinear, uv());
  smoothMaterial.side = DoubleSide;
  const smooth = new Mesh(smoothGeometry, smoothMaterial);
  smooth.name = "Smooth";
  smooth.position.set(2, 0, -2);
  smooth.rotation.x = -Math.PI / 2;
  scene.add(smooth);

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
