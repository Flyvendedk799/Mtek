import { Scene, Mesh } from "three/webgpu";
import { 
  lookAtCamera, 
  startTask, 
  srgb,
  sphereMesh,
  boxMesh
} from "@mtek/benchmarks/baseline-support";
import { MeshStandardMaterial, PointLight, AmbientLight } from "three/webgpu";
import { PlaneGeometry } from "three";

void startTask(() => {
  const scene = new Scene();
  
  // Camera setup
  const camera = lookAtCamera({
    position: [0, 3, 9],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000
  });
  
  // Materials
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#f3f4f6"),
    roughness: 0.7,
    metalness: 0
  });
  
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#e5e7eb"),
    roughness: 0.9,
    metalness: 0
  });
  
  // Ball (sphere)
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Floor (plane)
  const floorGeometry = new PlaneGeometry(12, 12);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.set(0, 0, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  scene.add(floor);
  
  // Point lights
  // Calibrated so that at distance 3, a white Lambertian surface pointing at the light renders as white
  // For inverse-square decay (decay=2): irradiance = intensity / (distance^2)
  // For Lambertian: radiance = albedo * irradiance / pi = albedo * intensity / (pi * distance^2)
  // We want radiance = 1.0 at distance=3 with albedo=1.0
  // So: intensity / (pi * 9) = 1.0, thus intensity = 9*pi ≈ 28.274
  const calibratedIntensity = 9 * Math.PI;
  
  const lampLeft = new PointLight(srgb("#ff3030"), calibratedIntensity, 0, 2);
  lampLeft.name = "LampLeft";
  lampLeft.position.set(-3, 2.5, 2);
  scene.add(lampLeft);
  
  const lampRight = new PointLight(srgb("#3050ff"), calibratedIntensity, 0, 2);
  lampRight.name = "LampRight";
  lampRight.position.set(3, 2.5, 2);
  scene.add(lampRight);
  
  // Ambient light
  // 10% of what the calibrated point light gives at its reference distance
  // Point light at distance 3: intensity / (pi * 9)
  // Ambient should add: 0.1 * intensity / (pi * 9)
  // Since ambient is: albedo * ambientIntensity / pi, we get:
  // ambientIntensity = 0.1 * intensity / 9
  const ambientLight = new AmbientLight(srgb("#6070a0"), calibratedIntensity * 0.1 / 9);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor: "#0a0a0f"
  };
});
