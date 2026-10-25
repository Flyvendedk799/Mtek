import { Scene, Mesh } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  boxMesh,
  srgb,
} from "@mtek/benchmarks/baseline-support";
import {
  MeshStandardMaterial,
  DirectionalLight,
  AmbientLight,
  PlaneGeometry,
} from "three/webgpu";

void startTask(() => {
  const scene = new Scene();

  // Camera at (2.5, 2.5, 5) looking at origin with FOV 0.9 radians
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000,
  });

  // Cube: 2x2x2 at origin, color #c8a27a, roughness 0.8, metalness 0
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0,
  });
  const cube = boxMesh([2.0, 2.0, 2.0], cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);

  // Floor: 10x10 at y=-1, color #8a929c, roughness 0.9, metalness 0, one-sided facing up
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  scene.add(floor);

  // Directional light (Sun): direction (0, -0.6, -0.8)
  // For Lambertian white surface facing light: albedo * E / pi = 1
  // So E = pi
  const sunIntensity = Math.PI;
  const sun = new DirectionalLight(srgb("#ffffff"), sunIntensity);
  sun.name = "Sun";
  // Light travels in direction (0, -0.6, -0.8), so it comes from direction (0, 0.6, 0.8)
  // Place light at a far distance in that direction
  sun.position.set(0, 0.6, 0.8).normalize().multiplyScalar(100);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // Ambient light: 10% of sun strength
  // Ambient formula is: albedo * ambientIntensity / pi
  // Directional formula is: albedo * E * cos(angle) / pi
  // For 10% of directional on a white surface: ambientIntensity = 0.1 * E
  const ambientLight = new AmbientLight(srgb("#ffffff"), 0.1 * sunIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0b0d12",
  };
});
