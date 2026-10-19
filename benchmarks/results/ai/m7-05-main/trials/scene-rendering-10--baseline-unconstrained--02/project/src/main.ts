import { Scene, Mesh, PointLight, AmbientLight } from "three/webgpu";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PlaneGeometry } from "three";

void startTask(() => {
  const scene = new Scene();

  // Camera at (0, 3, 9) looking at (0, 0.5, 0)
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Create ball (sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial, 32, 16);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create floor (plane)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
  });
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing +Y
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Point light calibration:
  // A perfectly matte white surface at distance 3 units with normal pointing at the light
  // should render as white (intensity 1.0).
  // With inverse square falloff and Lambertian diffuse: intensity / (pi * d^2) = 1
  // So intensity = pi * d^2 = pi * 9 = 9 * pi
  const pointLightIntensity = Math.PI * 9;

  // LampLeft at (-3, 2.5, 2), light colour #ff3030
  const lampLeft = new PointLight(srgb("#ff3030"), pointLightIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // LampRight at (3, 2.5, 2), light colour #3050ff
  const lampRight = new PointLight(srgb("#3050ff"), pointLightIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light: colour #6070a0 at 10% strength
  // Ambient light formula: albedo * intensity / pi
  // We want 10% contribution, so intensity = 0.1 * pi
  const ambientLight = new AmbientLight(srgb("#6070a0"), 0.1 * Math.PI);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
