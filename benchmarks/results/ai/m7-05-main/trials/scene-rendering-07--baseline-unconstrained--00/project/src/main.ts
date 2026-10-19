import { Scene, Mesh } from "three/webgpu";
import { AmbientLight, PointLight, PlaneGeometry, SphereGeometry, MeshStandardMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Set clear color
  const clearColorHex = "#10131a";
  
  // Create camera
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });
  
  // Create Ball (red sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  ballMaterial.name = "Ball";
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Create Floor (gray square)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide by default, but explicitly front-facing
  });
  floorMaterial.name = "Floor";
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  floor.position.set(0, 0, 0);
  scene.add(floor);
  
  // Create Point Light
  // Calibrated: white surface 3 units away at normal incidence should render as white
  // For three.js PointLight with decay=2: intensity is applied directly
  // A matte white at 3 units normal-facing should be white (1.0)
  const pointLightIntensity = 15.3;
  const pointLight = new PointLight(0xffffff, pointLightIntensity, 0, 2);
  pointLight.name = "Lamp";
  pointLight.position.set(1.5, 3, 2.5);
  scene.add(pointLight);
  
  // Create Ambient Light (5% of point light strength)
  const ambientIntensity = 0.05 * pointLightIntensity;
  const ambientLight = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor: clearColorHex,
  };
});
