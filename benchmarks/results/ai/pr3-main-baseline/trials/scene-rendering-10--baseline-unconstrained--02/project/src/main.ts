import { Scene, Mesh, PointLight, AmbientLight, MeshStandardMaterial } from "three/webgpu";
import { PlaneGeometry, SphereGeometry } from "three";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Create the ball (sphere)
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create the floor (flat square)
  const floorGeometry = new PlaneGeometry(12, 12);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
  });
  floorMaterial.side = 2; // DoubleSide
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Point lights calibrated for inverse-square falloff
  // For perfectly matte white surface at distance 3 to render as white (1.0):
  // intensity = 9 * π ≈ 28.27
  const lightIntensity = 9 * Math.PI;

  // LampLeft: red light at (-3, 2.5, 2)
  const lampLeft = new PointLight(srgb("#ff3030"), lightIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // LampRight: blue light at (3, 2.5, 2)
  const lampRight = new PointLight(srgb("#3050ff"), lightIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light at 10% strength
  // For a point light at distance 3: contribution = I / (π * 9)
  // To have ambient at 10% of that: intensity / π = 0.1, so intensity = 0.1π
  const ambientIntensity = 0.1 * Math.PI;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  // Camera setup
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
