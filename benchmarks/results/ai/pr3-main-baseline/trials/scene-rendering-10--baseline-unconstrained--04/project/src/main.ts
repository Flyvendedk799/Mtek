import { Scene, Mesh } from "three/webgpu";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PointLight, AmbientLight, PlaneGeometry } from "three/webgpu";

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
  
  // Ball (sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Floor (flat square 12x12, facing up)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide (facing +Y)
  });
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat facing +Y
  scene.add(floor);
  
  // Point lights with inverse-square falloff
  // Calibrated so that at distance 3, a perpendicular Lambertian white surface is white
  // For rendering equation: radiance = albedo * irradiance / π
  // At distance d from a point light with intensity I: irradiance = I / d²
  // We want: 1 = 1 * I / (π * 9), so I = 9π
  const pointLightIntensity = 9 * Math.PI;
  
  const lampLeft = new PointLight(srgb("#ff3030"), pointLightIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);
  
  const lampRight = new PointLight(srgb("#3050ff"), pointLightIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);
  
  // Ambient light at 10% of the calibrated strength
  // The task says: adds to every surface 10% of (surface's diffuse colour * ambient colour)
  // For a calibrated light intensity of 9π and an ambient at 10%:
  // ambient intensity = 0.1
  const ambientLight = new AmbientLight(srgb("#6070a0"), 0.1);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor: "#0a0a0f",
  };
});
