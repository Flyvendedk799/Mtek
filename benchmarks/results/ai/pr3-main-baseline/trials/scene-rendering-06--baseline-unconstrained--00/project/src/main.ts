import { Scene, Mesh, DirectionalLight, AmbientLight, FrontSide } from "three/webgpu";
import { BoxGeometry, PlaneGeometry, MeshStandardMaterial, Vector3 } from "three/webgpu";
import { lookAtCamera, startTask, srgb, boxMesh } from "@mtek/benchmarks/baseline-support";

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
  
  // Create cube
  const cubeGeometry = new BoxGeometry(2.0, 2.0, 2.0);
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0,
  });
  const cube = new Mesh(cubeGeometry, cubeMaterial);
  cube.position.set(0, 0, 0);
  cube.name = "Cube";
  scene.add(cube);
  
  // Create floor
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: FrontSide,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  floor.name = "Floor";
  scene.add(floor);
  
  // Create directional light (Sun)
  // Direction: (0, -0.6, -0.8) normalized
  const directionMagnitude = Math.sqrt(0 * 0 + 0.6 * 0.6 + 0.8 * 0.8); // = 1.0
  const lightDirection = new Vector3(0, -0.6, -0.8).normalize();
  
  // The light travels in direction (0, -0.6, -0.8), so position should be opposite
  const lightPosition = new Vector3(0, 0.6, 0.8).normalize().multiplyScalar(10);
  
  // Intensity calibrated so white matte surface facing it is white: E = pi
  const sunIntensity = Math.PI;
  const sun = new DirectionalLight(0xffffff, sunIntensity);
  sun.position.copy(lightPosition);
  sun.target.position.set(0, 0, 0);
  sun.name = "Sun";
  scene.add(sun);
  scene.add(sun.target);
  
  // Create ambient light (10% of directional light strength)
  const ambientIntensity = sunIntensity * 0.1;
  const ambient = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambient);
  
  return {
    scene,
    camera,
    clearColor,
  };
});
