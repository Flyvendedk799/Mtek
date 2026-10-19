import { Scene, Mesh } from "three/webgpu";
import { PlaneGeometry, MeshBasicMaterial } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture } from "@mtek/benchmarks/baseline-support";

void startTask(async () => {
  // Load the swatch image with different filter/wrap settings
  const textureNearest = await loadTexture("assets/swatch.png", {
    filter: "nearest",
    wrap: "clamp",
    colorSpace: "srgb"
  });

  const textureLinear = await loadTexture("assets/swatch.png", {
    filter: "linear",
    wrap: "clamp",
    colorSpace: "srgb"
  });

  const textureTiled = await loadTexture("assets/swatch.png", {
    filter: "nearest",
    wrap: "repeat",
    colorSpace: "srgb"
  });

  const scene = new Scene();

  // Create base geometry for plain and smooth squares
  const geometry = new PlaneGeometry(3.6, 3.6);

  // Plain square: hard-edged, centered at (-2, 0, -2)
  const materialPlain = new MeshBasicMaterial({ map: textureNearest });
  materialPlain.name = "Plain";
  const plainMesh = new Mesh(geometry, materialPlain);
  plainMesh.name = "Plain";
  plainMesh.position.set(-2, 0, -2);
  plainMesh.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing up
  scene.add(plainMesh);

  // Tiled square: 2x2 tiling with hard edges, centered at (0, 0, 2)
  const geometryTiled = new PlaneGeometry(3.6, 3.6);
  // Scale UV coordinates to [0, 2] for 2x2 tiling
  const uvAttribute = geometryTiled.getAttribute("uv");
  for (let i = 0; i < uvAttribute.count; i++) {
    const u = uvAttribute.getX(i);
    const v = uvAttribute.getY(i);
    uvAttribute.setXY(i, u * 2, v * 2);
  }
  uvAttribute.needsUpdate = true;
  
  const materialTiled = new MeshBasicMaterial({ map: textureTiled });
  materialTiled.name = "Tiled";
  const tiledMesh = new Mesh(geometryTiled, materialTiled);
  tiledMesh.name = "Tiled";
  tiledMesh.position.set(0, 0, 2);
  tiledMesh.rotation.x = -Math.PI / 2;
  scene.add(tiledMesh);

  // Smooth square: bilinear filtering, centered at (2, 0, -2)
  const materialSmooth = new MeshBasicMaterial({ map: textureLinear });
  materialSmooth.name = "Smooth";
  const smoothMesh = new Mesh(geometry, materialSmooth);
  smoothMesh.name = "Smooth";
  smoothMesh.position.set(2, 0, -2);
  smoothMesh.rotation.x = -Math.PI / 2;
  scene.add(smoothMesh);

  return {
    scene,
    camera: lookAtCamera({ 
      position: [0, 11, 3] as const, 
      target: [0, 0, 0] as const,
      fovY: 0.72
    }),
    clearColor: "#1b2430",
  };
});
