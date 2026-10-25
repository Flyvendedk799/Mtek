import { Scene, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, PointLight, AmbientLight, FrontSide } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Set clear color
  const clearColor = "#10131a";

  // Create camera
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });

  // Create Ball (red sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  const ballGeometry = new SphereGeometry(1.0, 32, 16);
  const ball = new Mesh(ballGeometry, ballMaterial);
  ball.position.set(0, 1, 0);
  ball.name = "Ball";
  scene.add(ball);

  // Create Floor (flat square plane)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: FrontSide,
  });
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  floor.position.y = 0;
  floor.name = "Floor";
  scene.add(floor);

  // Create point light
  // Intensity calibrated: for white Lambertian surface at distance 3 pointing at light,
  // radiance = I / (π * d²) = 1.0, so I = 9π
  // But accounting for the GGX model and how three.js applies it
  const pointLightIntensity = Math.PI;
  const pointLight = new PointLight(0xffffff, pointLightIntensity);
  pointLight.position.set(1.5, 3, 2.5);
  pointLight.name = "Lamp";
  scene.add(pointLight);

  // Create ambient light at 5% of point light strength
  const ambientIntensity = 0.05 * pointLightIntensity;
  const ambientLight = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor,
  };
});
