import { Scene, Mesh } from "three/webgpu";
import { PointLight, MeshStandardMaterial, SphereGeometry, PlaneGeometry } from "three/webgpu";
import { AmbientLight } from "three/webgpu";
import { lookAtCamera, startTask, sphereMesh, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Create camera with specified parameters
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Create Ball (sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = new Mesh(new SphereGeometry(1.0, 32, 16), ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create Floor (plane)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
  });
  const floor = new Mesh(new PlaneGeometry(12, 12), floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2; // Lay it flat, facing up
  scene.add(floor);

  // Point light calibration: for a perfectly matte white surface 3 units away
  // with normal pointing at light to be white: I / (π * 9) = 1, so I = 9π
  // Three.js scales this differently, so we use a calibrated value
  const lightIntensity = 1.0;

  // LampLeft at (-3, 2.5, 2), red light
  const lampLeft = new PointLight(srgb("#ff3030"), lightIntensity);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // LampRight at (3, 2.5, 2), blue light
  const lampRight = new PointLight(srgb("#3050ff"), lightIntensity);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light: 10% of the calibration intensity
  const ambientIntensity = 0.1;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
