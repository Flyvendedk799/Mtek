import { Scene, DirectionalLight, AmbientLight, Mesh } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  boxMesh,
  srgb,
} from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();

  // Set clear color
  const clearColor = "#0b0d12";

  // Camera setup
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000,
  });

  // Cube: 2x2x2 at origin
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0,
  });
  const cube = boxMesh([2, 2, 2], cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);

  // Floor: 10x10 at y = -1, facing up
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
  });
  const floorGeometry = new PlaneGeometry(10, 10);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing up
  scene.add(floor);

  // Directional light (Sun)
  // Light shines in direction (0, -0.6, -0.8)
  // Position light opposite to direction, targeting origin
  const sunLight = new DirectionalLight(srgb("#ffffff"), Math.PI);
  sunLight.name = "Sun";
  sunLight.position.set(0, 0.6, 0.8);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Ambient light: 10% of sun strength
  const ambientLight = new AmbientLight(srgb("#ffffff"), Math.PI * 0.1);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor,
  };
});
