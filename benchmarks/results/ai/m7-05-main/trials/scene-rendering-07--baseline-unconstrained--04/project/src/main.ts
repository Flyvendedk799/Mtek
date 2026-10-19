import { Scene, Mesh, PointLight, AmbientLight } from "three/webgpu";
import { PlaneGeometry, SphereGeometry, MeshStandardMaterial } from "three";
import { lookAtCamera, startTask, srgb, sphereMesh } from "@mtek/benchmarks/baseline-support";

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

  // Create ball (sphere)
  const ballMaterial = new MeshStandardMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  ballMaterial.name = "Ball";
  const ball = new Mesh(new SphereGeometry(1.0, 32, 16), ballMaterial);
  ball.name = "Ball";
  ball.position.set(0, 1, 0);
  scene.add(ball);

  // Create floor (flat square plane)
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide (facing up, +Y)
  });
  floorMaterial.name = "Floor";
  const floorGeom = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeom, floorMaterial);
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing +Y
  floor.position.set(0, 0, 0);
  scene.add(floor);

  // Create point light
  // Intensity calculation: for white surface at distance 3 with decay=2
  // Irradiance from point light: I / (d * d) = I / 9
  // For diffuse surface (Lambertian): outgoing = albedo * irradiance / π
  // For white surface to be white: 1 = 1 * (I/9) / π, so I = 9π
  const pointLightIntensity = 9 * Math.PI;
  const pointLight = new PointLight(0xffffff, pointLightIntensity, 0, 2);
  pointLight.name = "Lamp";
  pointLight.position.set(1.5, 3, 2.5);
  scene.add(pointLight);

  // Create ambient light (5% of point light strength)
  // The ambient intensity should be 5% of the reference intensity
  const ambientLightIntensity = 0.05;
  const ambientLight = new AmbientLight(0xffffff, ambientLightIntensity);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor,
  };
});
