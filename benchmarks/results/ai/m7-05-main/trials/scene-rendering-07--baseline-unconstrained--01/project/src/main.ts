import { Scene, PointLight, Mesh } from "three/webgpu";
import { sphereMesh, lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, AmbientLight, PlaneGeometry } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();
  
  // Clear color
  const clearColor = "#10131a";
  
  // Camera
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });
  
  // Materials
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 2, // DoubleSide, but we only need FrontSide (1); use 1 for one-sided facing up
  });
  floorMaterial.side = 1; // FrontSide
  
  // Ball (sphere)
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Floor (flat square 14x14)
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  scene.add(floor);
  
  // Point light
  // Calibrated: at distance 3, a matte white surface facing the light should be white (1,1,1)
  // With decay=2: intensity / d² gives the light strength
  // At d=3: intensity / 9 should equal π (to account for Lambertian diffuse which divides by π)
  // So intensity = 9π
  const pointLightIntensity = 9 * Math.PI;
  const pointLight = new PointLight(
    srgb("#ffffff"),
    pointLightIntensity,
    0, // distance = 0 means no range limit
    2  // decay = 2 for inverse square
  );
  pointLight.name = "Lamp";
  pointLight.position.set(1.5, 3, 2.5);
  scene.add(pointLight);
  
  // Ambient light (5% of point light strength)
  // Should contribute 5% of what a white surface at distance 3 facing the light receives
  // That's 5% * 1 = 0.05 for a white surface
  // Ambient contribution to a white surface: intensity / π = 0.05
  // So intensity = 0.05π
  const ambientLight = new AmbientLight(
    srgb("#ffffff"),
    0.05 * Math.PI
  );
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor,
  };
});
