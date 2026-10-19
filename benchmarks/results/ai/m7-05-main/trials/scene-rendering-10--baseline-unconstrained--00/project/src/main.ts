import { Scene, Mesh, PointLight, AmbientLight } from "three/webgpu";
import { MeshStandardMaterial } from "three/webgpu";
import { PlaneGeometry, SphereGeometry } from "three";
import {
  srgb,
  sphereMesh,
  lookAtCamera,
  startTask,
} from "@mtek/benchmarks/baseline-support";

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

  // Floor: 12x12 square at y=0, facing up (+Y)
  const floorGeometry = new PlaneGeometry(12, 12);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 0, // FrontSide
  });
  floorMaterial.name = "FloorMaterial";
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to face +Y
  floor.position.y = 0;
  scene.add(floor);

  // Ball: sphere at (0, 1, 0), radius 1.0
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  ballMaterial.name = "BallMaterial";
  const ball = sphereMesh(1.0, ballMaterial, 32, 16);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Point lights
  // Calibration: intensity I such that at distance d=3, a white Lambertian surface
  // perpendicular to the light renders as white (radiance = 1)
  // Radiance = albedo * I / (π * d²)
  // 1 = 1 * I / (π * 9) => I = 9π
  const pointLightIntensity = 9 * Math.PI;

  const lampLeft = new PointLight(
    srgb("#ff3030"),
    pointLightIntensity,
    0, // no range limit
    2 // decay = 2 (inverse square)
  );
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  const lampRight = new PointLight(
    srgb("#3050ff"),
    pointLightIntensity,
    0, // no range limit
    2 // decay = 2 (inverse square)
  );
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light: 10% of the calibration intensity
  // ambient adds albedo * intensity / π, so for 10% we need intensity = 0.1 * π
  const ambientIntensity = 0.1 * Math.PI;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
