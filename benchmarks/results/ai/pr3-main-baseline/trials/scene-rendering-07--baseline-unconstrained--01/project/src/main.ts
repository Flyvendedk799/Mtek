import { Scene, Mesh, SphereGeometry, PlaneGeometry, PointLight, AmbientLight, MeshStandardMaterial } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Camera at (0, 3, 8) looking at (0, 0.5, 0)
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Clear color
  const clearColor = "#10131a";

  // Ball (sphere) - red, at (0, 1, 0), radius 1.0
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Floor (square plane) - gray, 14x14, at y=0, one-sided facing up
  const floorGeometry = new PlaneGeometry(14, 14);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing +Y
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Point light - white, at (1.5, 3, 2.5)
  // Calibrated so that a perfectly matte white surface 3 units away renders as white
  // With inverse-square decay (decay=2): intensity / (π * d²) = 1
  // intensity = π * 9 ≈ 28.27
  const lampIntensity = Math.PI * 9;
  const lamp = new PointLight(0xffffff, lampIntensity, 0, 2);
  lamp.name = "Lamp";
  lamp.position.set(1.5, 3, 2.5);
  scene.add(lamp);

  // Ambient light - white, 5% of the point light strength
  // Point light contribution to Lambertian white at 3 units: intensity / (π * d²) = 9π / (π * 9) = 1
  // Ambient should add 5% of surface color: albedo * intensity / π = 0.05 * albedo
  // So intensity = 0.05π
  const ambientIntensity = 0.05 * Math.PI;
  const ambient = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambient);

  return {
    scene,
    camera,
    clearColor,
  };
});
