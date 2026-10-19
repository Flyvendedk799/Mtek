import { Scene, PointLight, AmbientLight } from "three/webgpu";
import { Mesh, SphereGeometry, PlaneGeometry, MeshStandardMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Clear color
  const clearColor = "#10131a";

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
  const ball = sphereMesh(1.0, ballMaterial, 32, 16);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create Floor (flat square)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide
  });
  floorMaterial.name = "Floor";
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Create Point Light (Lamp)
  // Calibrated so that a perfectly matte white surface 3 units away with normal pointing at it renders white.
  // For a Lambertian surface: L = albedo * I / (π * d²)
  // We want L = 1 when albedo = 1, d = 3
  // So: 1 = 1 * I / (π * 9)
  // I = 9π ≈ 28.274
  const lampIntensity = 9 * Math.PI;
  const lamp = new PointLight(0xffffff, lampIntensity, 0, 2);
  lamp.name = "Lamp";
  lamp.position.set(1.5, 3, 2.5);
  scene.add(lamp);

  // Create Ambient Light (5% of lamp strength)
  // The point light has intensity 9π which gives reference radiance of 1 at 3 units.
  // We want ambient to add 5% of that: 0.05 units of radiance.
  // Three.js ambient light formula: albedo * intensity / π
  // So for white (albedo=1): intensity / π = 0.05, thus intensity = 0.05π
  // But actually, we need to match the lamp's calibration directly.
  // The lamp intensity 9π is set so the diffuse radiance is 1.
  // For ambient to be 5%, we use intensity = 0.05 (it gets divided by π internally).
  const ambientIntensity = 0.05;
  const ambientLight = new AmbientLight(0xffffff, ambientIntensity);
  ambientLight.name = "Ambient";
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor,
  };
});
