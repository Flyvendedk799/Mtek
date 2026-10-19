import { Scene, Mesh, DirectionalLight, AmbientLight, Vector3, Color, BoxGeometry, PlaneGeometry, MeshStandardMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  scene.background = srgb("#0b0d12");
  
  // Camera setup
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000
  });
  
  // Cube (non-metallic, base colour #c8a27a, roughness 0.8)
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0
  });
  const cubeGeometry = new BoxGeometry(2.0, 2.0, 2.0);
  const cube = new Mesh(cubeGeometry, cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);
  
  // Floor (10x10, one-sided, facing up, at y = -1, base colour #8a929c, roughness 0.9)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0
  });
  const floorGeometry = new PlaneGeometry(10, 10);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.y = -1;
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  scene.add(floor);
  
  // Directional light (Sun)
  // The light travels in direction (0, -0.6, -0.8) - meaning light rays go in that direction
  // This is equivalent to the light coming from the opposite direction
  const travelDirection = new Vector3(0, -0.6, -0.8).normalize();
  // For a white Lambertian surface perpendicular to the light direction to render as white,
  // we need intensity = 1 (this is the standard three.js convention)
  const sunIntensity = 1.0;
  const sun = new DirectionalLight(new Color(1, 1, 1), sunIntensity);
  sun.name = "Sun";
  // Position the light opposite to the travel direction (light comes from there)
  sun.position.set(-travelDirection.x * 100, -travelDirection.y * 100, -travelDirection.z * 100);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);
  
  // Ambient light (10% of directional light strength)
  const ambientIntensity = sunIntensity * 0.1;
  const ambient = new AmbientLight(new Color(1, 1, 1), ambientIntensity);
  scene.add(ambient);
  
  return {
    scene,
    camera,
    clearColor: "#0b0d12"
  };
});
