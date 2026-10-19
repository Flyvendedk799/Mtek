import { Scene, Mesh } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  sphereMesh,
  srgb,
} from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PointLight, AmbientLight, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();

  // Camera at (0, 3, 9) looking at (0, 0.5, 0) with fovY = 0.8 radians
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Ball: sphere at (0, 1, 0), radius 1.0, white (#f3f4f6), roughness 0.7
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Floor: 12x12 flat square facing up, at y=0, centered at origin
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide = 0, BackSide = 1, DoubleSide = 2; using 1 for one-sided
  });
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  scene.add(floor);

  // Point light calibration:
  // For a white light at distance 3 units from a perfectly matte white surface whose normal points at it:
  // outgoing radiance = albedo * I / (π * d²)
  // For this to be 1.0 (white): I / (π * 9) = 1, so I = 9π ≈ 28.27
  const pointLightIntensity = 9 * Math.PI;

  // LampLeft at (-3, 2.5, 2), colour #ff3030
  const lampLeft = new PointLight(srgb("#ff3030"), pointLightIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // LampRight at (3, 2.5, 2), colour #3050ff
  const lampRight = new PointLight(srgb("#3050ff"), pointLightIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light: colour #6070a0 at 10% of the calibrated strength
  // The calibrated ambient intensity would be 1.0 (same calibration as point lights)
  // At 10% strength: intensity = 0.1
  const ambientLight = new AmbientLight(srgb("#6070a0"), 0.1);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
