import { Scene, Mesh } from "three/webgpu";
import { PlaneGeometry, ClampToEdgeWrapping, RepeatWrapping, LinearFilter, NearestFilter } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture } from "@mtek/benchmarks/baseline-support";
import { texture, uv } from "three/tsl";

void startTask(async () => {
  const scene = new Scene();

  // Load the 4x4 swatch texture
  const baseTexture = await loadTexture("assets/swatch.png", {
    colorSpace: "srgb",
    filter: "nearest",
    wrap: "clamp",
  });

  // Plain: hard-edged, single copy, centered at (-2, 0, -2)
  const plainGeom = new PlaneGeometry(3.6, 3.6);
  const plainTexture = baseTexture.clone();
  plainTexture.magFilter = NearestFilter;
  plainTexture.minFilter = NearestFilter;
  plainTexture.wrapS = ClampToEdgeWrapping;
  plainTexture.wrapT = ClampToEdgeWrapping;
  
  const plainMaterial = new MeshBasicNodeMaterial();
  plainMaterial.name = "Plain";
  plainMaterial.colorNode = texture(plainTexture);
  
  const plainMesh = new Mesh(plainGeom, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.rotation.x = -Math.PI / 2;
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);

  // Tiled: hard-edged, 2x2 tiled, centered at (0, 0, 2)
  const tiledGeom = new PlaneGeometry(3.6, 3.6);
  const tiledTexture = baseTexture.clone();
  tiledTexture.magFilter = NearestFilter;
  tiledTexture.minFilter = NearestFilter;
  tiledTexture.wrapS = RepeatWrapping;
  tiledTexture.wrapT = RepeatWrapping;
  tiledTexture.repeat.set(2, 2);
  
  const tiledMaterial = new MeshBasicNodeMaterial();
  tiledMaterial.name = "Tiled";
  tiledMaterial.colorNode = texture(tiledTexture);
  
  const tiledMesh = new Mesh(tiledGeom, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.rotation.x = -Math.PI / 2;
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);

  // Smooth: bilinear filtered, centered at (2, 0, -2)
  const smoothGeom = new PlaneGeometry(3.6, 3.6);
  const smoothTexture = baseTexture.clone();
  smoothTexture.magFilter = LinearFilter;
  smoothTexture.minFilter = LinearFilter;
  smoothTexture.wrapS = ClampToEdgeWrapping;
  smoothTexture.wrapT = ClampToEdgeWrapping;
  
  const smoothMaterial = new MeshBasicNodeMaterial();
  smoothMaterial.name = "Smooth";
  smoothMaterial.colorNode = texture(smoothTexture);
  
  const smoothMesh = new Mesh(smoothGeom, smoothMaterial);
  smoothMesh.name = "Smooth";
  smoothMesh.rotation.x = -Math.PI / 2;
  smoothMesh.position.set(2, 0, -2);
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
