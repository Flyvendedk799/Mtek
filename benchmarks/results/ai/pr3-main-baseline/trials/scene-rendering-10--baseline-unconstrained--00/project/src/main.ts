import { Scene, Mesh, PointLight, AmbientLight } from "three/webgpu";
import {
  lookAtCamera,
  startTask,
  srgb,
} from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PlaneGeometry, SphereGeometry } from "three";

void startTask(() => {
  const scene = new Scene();

  // Camera
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Clear color
  const clearColor = "#0a0a0f";

  // Materials
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  ballMaterial.name = "BallMaterial";

  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide (default is 0)
  });
  floorMaterial.name = "FloorMaterial";

  // Ball (sphere)
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.position.set(0, 1, 0);
  ball.name = "Ball";
  scene.add(ball);

  // Floor (plane, 12x12, lying flat at y=0)
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  floor.position.y = 0;
  floor.name = "Floor";
  scene.add(floor);

  // Point light calibration: for decay=2, to get white (1.0) at distance 3:
  // radiance = color * intensity / (π * d²)
  // 1.0 = intensity / (π * 9)
  // intensity = 9π ≈ 28.274
  const pointLightIntensity = 9 * Math.PI;

  // LampLeft at (-3, 2.5, 2), red light
  const lampLeft = new PointLight(srgb("#ff3030"), pointLightIntensity, 0, 2);
  lampLeft.position.set(-3, 2.5, 2);
  lampLeft.name = "LampLeft";
  scene.add(lampLeft);

  // LampRight at (3, 2.5, 2), blue light
  const lampRight = new PointLight(srgb("#3050ff"), pointLightIntensity, 0, 2);
  lampRight.position.set(3, 2.5, 2);
  lampRight.name = "LampRight";
  scene.add(lampRight);

  // Ambient light: 10% of white calibration
  // ambient adds: albedo * intensity / π
  // For 10% of white calibration: intensity = 0.1 * π ≈ 0.3142
  const ambientIntensity = 0.1 * Math.PI;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor,
  };
});
