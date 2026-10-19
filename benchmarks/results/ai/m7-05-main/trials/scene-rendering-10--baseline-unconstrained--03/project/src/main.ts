import { Scene, Mesh, PerspectiveCamera, PointLight, AmbientLight } from "three/webgpu";
import { MeshStandardMaterial } from "three/webgpu";
import { sphereMesh, srgb, startTask } from "@mtek/benchmarks/baseline-support";
import { PlaneGeometry, BoxGeometry } from "three";

void startTask(() => {
  const scene = new Scene();

  // Camera: position (0, 3, 9), looking at (0, 0.5, 0), fovY = 0.8 radians
  const camera = new PerspectiveCamera(
    0.8 * (180 / Math.PI), // convert radians to degrees
    1, // square aspect
    0.1, // near
    1000 // far
  );
  camera.position.set(0, 3, 9);
  camera.lookAt(0, 0.5, 0);

  // Ball: sphere at (0, 1, 0), radius 1.0, color #f3f4f6, roughness 0.7
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Floor: flat square 12 x 12, facing up, y = 0, centered at origin
  // Use PlaneGeometry and rotate it to face +Y
  const floorGeometry = new PlaneGeometry(12, 12);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide = 0, BackSide = 1, DoubleSide = 2 - but we want one-sided facing up
  });
  floorMaterial.side = 0; // FrontSide
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to face +Y (lying flat)
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Point lights with inverse-square falloff
  // Intensity calibration: at distance 3 from a white perpendicular surface, should render as white
  // With decay=2, attenuation is 1/d². Three.js divides by 4π in some calculations.
  // For Lambertian: radiance = albedo * intensity / (4π * π * d²) or simplified by engine
  // Empirically calibrating to match expected output
  const lightIntensity = 9;

  // LampLeft: position (-3, 2.5, 2), color #ff3030
  const lampLeft = new PointLight(srgb("#ff3030"), lightIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // LampRight: position (3, 2.5, 2), color #3050ff
  const lampRight = new PointLight(srgb("#3050ff"), lightIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light: color #6070a0 at 10% strength
  // 10% of the point light intensity
  const ambientIntensity = 0.9;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
