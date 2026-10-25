import { Scene, Mesh } from "three/webgpu";
import { BoxGeometry, PlaneGeometry, MeshStandardMaterial, DirectionalLight, AmbientLight, Color } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

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
  cube.position.set(0, 0, 0);
  scene.add(cube);
  
  // Create floor
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: 1 // FrontSide
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  scene.add(floor);
  
  // Create directional light (Sun)
  // Direction is (0, -0.6, -0.8), meaning light comes FROM the opposite direction
  // For a Lambertian surface facing the light squarely, this intensity renders white
  const sunIntensity = 2.0;
  const sunLight = new DirectionalLight(new Color(1, 1, 1), sunIntensity);
  sunLight.name = "Sun";
  // Light travels in direction (0, -0.6, -0.8)
  // DirectionalLight shines FROM position toward target, so position is opposite to the travel direction
  sunLight.position.set(0, 0.6, 0.8);
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight);
  
  // Create ambient light (10% of directional light strength)
  const ambientLight = new AmbientLight(new Color(1, 1, 1), 0.1 * sunIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor
  };
});
