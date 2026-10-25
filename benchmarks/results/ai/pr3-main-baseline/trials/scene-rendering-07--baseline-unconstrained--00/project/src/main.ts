import { Scene, Mesh, PointLight, AmbientLight } from "three/webgpu";
import { srgb, sphereMesh, lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();
  
  // Ball - red sphere
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  ballMaterial.name = "BallMaterial";
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Floor - flat square
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide, facing up
  });
  floorMaterial.name = "FloorMaterial";
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  scene.add(floor);
  
  // Point light
  // Calibrated: at distance 3, white matte surface facing light should be fully white
  // Empirically tuned for three.js WebGPU renderer
  const pointLightIntensity = 26.0;
  const pointLight = new PointLight(srgb("#ffffff"), pointLightIntensity, 0, 2);
  pointLight.name = "Lamp";
  pointLight.position.set(1.5, 3, 2.5);
  scene.add(pointLight);
  
  // Ambient light - 5% of point light strength
  const ambientIntensity = 0.05 * pointLightIntensity;
  const ambientLight = new AmbientLight(srgb("#ffffff"), ambientIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera: lookAtCamera({
      position: [0, 3, 8],
      target: [0, 0.5, 0],
      fovY: 0.8,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#10131a",
  };
});
