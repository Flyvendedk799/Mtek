import { Scene, PointLight, AmbientLight, Mesh } from "three/webgpu";
import { 
  lookAtCamera, 
  startTask, 
  srgb, 
  sphereMesh,
} from "@mtek/benchmarks/baseline-support";
import { PlaneGeometry, MeshStandardMaterial, Vector3 } from "three/webgpu";

void startTask(() => {
  const scene = new Scene();
  
  // Camera: at (0, 3, 8) looking at (0, 0.5, 0), FOV 0.8 radians, near 0.1, far 1000
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });
  
  // Clear color
  const clearColor = "#10131a";
  
  // Ball: sphere at (0, 1, 0), radius 1.0, color #e11d48, roughness 0.7
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);
  
  // Floor: 14x14 square, one-sided facing up, in plane y=0, centered at origin
  // Color #9aa5b1, roughness 0.9
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide (default)
  });
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  // Rotate to face up (+Y) and position in y=0 plane
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);
  
  // Point light at (1.5, 3, 2.5)
  // Intensity calibrated: at distance 3, white surface facing it should be white
  // Lambertian: radiance = albedo * I / (π * d²)
  // For white (albedo=1): 1 = I / (π * 9), so I = 9π ≈ 28.274
  const pointLightIntensity = 4 * Math.PI;
  const pointLight = new PointLight(0xffffff, pointLightIntensity, 0, 2);
  pointLight.name = "Lamp";
  pointLight.position.set(1.5, 3, 2.5);
  scene.add(pointLight);
  
  // Ambient light: 5% of point light strength
  // Adds albedo * intensity / π to all surfaces
  // So: intensity_ambient = 0.05 * 4π / π = 0.2
  const ambientLightIntensity = 0.05 * 4;
  const ambientLight = new AmbientLight(0xffffff, ambientLightIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor,
  };
});
