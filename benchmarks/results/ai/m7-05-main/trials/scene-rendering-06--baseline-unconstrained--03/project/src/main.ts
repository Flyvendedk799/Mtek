import { Scene, DirectionalLight, AmbientLight } from "three/webgpu";
import { lookAtCamera, startTask, srgb, boxMesh } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, Mesh, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();
  
  // Set clear color
  const clearColor = "#0b0d12";
  
  // Camera positioned at (2.5, 2.5, 5) looking at origin
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9
  });
  
  // Create cube: 2.0 edge length, color #c8a27a, roughness 0.8
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0
  });
  const cube = boxMesh([2.0, 2.0, 2.0], cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);
  
  // Create floor: 10x10 plane at y=-1, facing up
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: 2 // FrontSide is default (0), BackSide is 1, DoubleSide is 2. We want front side facing up.
  });
  const floorGeometry = new PlaneGeometry(10, 10);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.y = -1;
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  scene.add(floor);
  
  // Create directional light (Sun)
  // Direction is (0, -0.6, -0.8), so position light in opposite direction
  // Intensity calibrated: for Lambertian white, E/pi = 1, so E = pi
  const sunIntensity = Math.PI;
  const sun = new DirectionalLight(srgb("#ffffff"), sunIntensity);
  sun.name = "Sun";
  // Position far along the opposite of travel direction
  sun.position.set(0, 0.6, 0.8);
  sun.position.multiplyScalar(100); // Far away for parallel light
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target); // Must add target to scene for proper updates
  
  // Create ambient light: 10% of sun strength
  const ambientIntensity = sunIntensity * 0.1;
  const ambient = new AmbientLight(srgb("#ffffff"), ambientIntensity);
  scene.add(ambient);
  
  return {
    scene,
    camera,
    clearColor
  };
});
