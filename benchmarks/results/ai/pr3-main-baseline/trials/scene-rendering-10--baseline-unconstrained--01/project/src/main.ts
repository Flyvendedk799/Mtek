import { Scene, Mesh } from "three/webgpu";
import { srgb, lookAtCamera, startTask, sphereMesh } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PointLight, AmbientLight, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();

  // Create materials
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });

  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide
  });

  // Create ball
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create floor
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Point lights calibrated so that a perfectly matte white surface 3 units away
  // facing the light renders as white. For a point light with decay 2:
  // diffuse = (color * intensity / (pi * distance²)) * dot(normal, lightDir) * albedo
  // For white surface at distance 3 to render white:
  // 1 = intensity / (pi * 9)
  // intensity = 9 * pi
  const intensity = 9 * Math.PI;

  // Red point light
  const lampLeft = new PointLight(srgb("#ff3030"), intensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);

  // Blue point light
  const lampRight = new PointLight(srgb("#3050ff"), intensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);

  // Ambient light at 10% strength
  // For 10% of the point light calibration: intensity = 0.1 * 9 * pi = 0.9 * pi
  const ambientIntensity = 0.1 * 9 * Math.PI;
  const ambientLight = new AmbientLight(srgb("#6070a0"), ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera: lookAtCamera({
      position: [0, 3, 9],
      target: [0, 0.5, 0],
      fovY: 0.8,
      near: 0.1,
      far: 1000,
    }),
    clearColor: "#0a0a0f",
  };
});
