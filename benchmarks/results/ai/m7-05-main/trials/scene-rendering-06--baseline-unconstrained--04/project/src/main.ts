import { Scene, Mesh, DirectionalLight, AmbientLight, MeshStandardMaterial, BoxGeometry, PlaneGeometry, Vector3 } from "three/webgpu";
import { srgb, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Set clear color
  const clearColor = "#0b0d12";
  
  // Create camera
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000
  });
  
  // Create cube
  const cubeGeometry = new BoxGeometry(2.0, 2.0, 2.0);
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0
  });
  const cube = new Mesh(cubeGeometry, cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);
  
  // Create floor (10x10 square at y=-1, facing up)
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0
  });
  floorMaterial.name = "Floor";
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2;  // Rotate to face +Y
  scene.add(floor);
  
  // Create directional light (Sun)
  // Light travels in direction (0, -0.6, -0.8)
  // In three.js, DirectionalLight shines FROM position TOWARD target
  // So we position it opposite to the direction and have it look at origin
  const sunIntensity = Math.PI;  // Calibrated for Lambertian white surface
  const sun = new DirectionalLight(0xffffff, sunIntensity);
  sun.name = "Sun";
  // Position opposite to direction vector
  sun.position.set(0, 0.6, 0.8).multiplyScalar(10);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  
  // Create ambient light (10% of sun's strength)
  const ambientIntensity = sunIntensity * 0.1;
  const ambientLight = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor
  };
});
