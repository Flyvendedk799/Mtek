import { Scene, PointLight, AmbientLight, Mesh, SphereGeometry, PlaneGeometry, MeshStandardMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Set clear color
  const clearColor = "#10131a";
  
  // Create camera with specified parameters
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000
  });
  
  // Create ball (red sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0
  });
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.position.set(0, 1, 0);
  ball.name = "Ball";
  scene.add(ball);
  
  // Create floor (gray square plane)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 0 // FrontSide - one-sided, facing up
  });
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Rotate to lay flat in XZ plane, facing +Y
  floor.position.set(0, 0, 0);
  floor.name = "Floor";
  scene.add(floor);
  
  // Create point light
  // Intensity calibrated so a perfectly matte white surface 3 units away renders as white
  // With inverse square falloff and Lambertian BRDF: radiance = albedo * intensity / (π * distance²)
  // We want radiance = 1 for white (albedo=1) at distance=3
  // So: 1 = intensity / (π * 9), thus intensity = 9π
  const pointLightIntensity = 1;
  const pointLight = new PointLight(srgb("#ffffff"), pointLightIntensity);
  pointLight.position.set(1.5, 3, 2.5);
  pointLight.name = "Lamp";
  scene.add(pointLight);
  
  // Create ambient light (5% of point light strength)
  const ambientLightIntensity = pointLightIntensity * 0.05;
  const ambientLight = new AmbientLight(srgb("#ffffff"), ambientLightIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor
  };
});
