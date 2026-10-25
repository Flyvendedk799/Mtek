import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry, PlaneGeometry, MeshStandardMaterial, DirectionalLight, AmbientLight, Color, FrontSide } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Set background color
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
  cube.position.set(0, 0, 0);
  scene.add(cube);
  
  // Create floor - PlaneGeometry lies in XY plane facing +Z by default
  // We need it to face +Y and lie in the XZ plane at y = -1
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: FrontSide
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing +Y
  scene.add(floor);
  
  // Create directional light (Sun)
  // Light travels in direction (0, -0.6, -0.8)
  // Position the light opposite to this direction so rays travel in (0, -0.6, -0.8)
  // Normalized: (0, -0.6, -0.8) / sqrt(0.36 + 0.64) = (0, -0.6, -0.8) / 1 = (0, -0.6, -0.8)
  // Light position should be at negative of travel direction, scaled up: (0, 0.6, 0.8) * some distance
  const sunLight = new DirectionalLight(new Color(0xffffff), Math.PI);
  sunLight.name = "Sun";
  sunLight.position.set(0, 0.6, 0.8).multiplyScalar(10); // Position far away
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(sunLight.target);
  
  // Create ambient light (10% of directional strength)
  const ambientLight = new AmbientLight(new Color(0xffffff), Math.PI * 0.1);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor
  };
});
