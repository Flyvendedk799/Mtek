import { Scene, Mesh } from "three/webgpu";
import { PlaneGeometry, MeshBasicMaterial, RepeatWrapping, NearestFilter, LinearFilter, ClampToEdgeWrapping } from "three/webgpu";
import { lookAtCamera, startTask, loadTexture } from "@mtek/benchmarks/baseline-support";

void startTask(async () => {
  const scene = new Scene();
  
  // Load the swatch texture
  const swatchTexture = await loadTexture("assets/swatch.png", { 
    filter: "nearest", 
    wrap: "clamp" 
  });
  
  // Create the plain square (hard-edged, single copy)
  const plainGeom = new PlaneGeometry(3.6, 3.6);
  const plainMaterial = new MeshBasicMaterial({ map: swatchTexture });
  plainMaterial.name = "Plain";
  const plainMesh = new Mesh(plainGeom, plainMaterial);
  plainMesh.name = "Plain";
  plainMesh.rotation.x = -Math.PI / 2; // Lay flat facing +Y
  plainMesh.position.set(-2, 0, -2);
  scene.add(plainMesh);
  
  // Create the tiled square (hard-edged, 2x2 tiled)
  const tiledGeom = new PlaneGeometry(3.6, 3.6);
  // Create a separate material for tiled to have repeat wrapping
  const tiledMaterial = new MeshBasicMaterial({ map: await loadTexture("assets/swatch.png", { 
    filter: "nearest", 
    wrap: "repeat" 
  }) });
  tiledMaterial.name = "Tiled";
  tiledMaterial.map!.repeat.set(2, 2);
  const tiledMesh = new Mesh(tiledGeom, tiledMaterial);
  tiledMesh.name = "Tiled";
  tiledMesh.rotation.x = -Math.PI / 2;
  tiledMesh.position.set(0, 0, 2);
  scene.add(tiledMesh);
  
  // Create the smooth square (bilinear filtering, single copy)
  const smoothGeom = new PlaneGeometry(3.6, 3.6);
  const smoothMaterial = new MeshBasicMaterial({ map: await loadTexture("assets/swatch.png", { 
    filter: "linear", 
    wrap: "clamp" 
  }) });
  smoothMaterial.name = "Smooth";
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
      far: 1000
    }),
    clearColor: "#1b2430",
  };
});
