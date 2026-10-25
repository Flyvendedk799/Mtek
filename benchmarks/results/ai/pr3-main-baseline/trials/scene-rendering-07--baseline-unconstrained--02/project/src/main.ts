import { Scene, MeshStandardNodeMaterial, PointLight, AmbientLight } from "three/webgpu";
import { Mesh, PlaneGeometry } from "three";
import { lookAtCamera, startTask, sphereMesh, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  
  // Clear color
  const clearColor = "#10131a";
  
  // Camera: position (0, 3, 8), looking at (0, 0.5, 0), fovY 0.8 radians
  const camera = lookAtCamera({
    position: [0, 3, 8],
    target: [0, 0.5, 0],
    fovY: 0.8,
    near: 0.1,
    far: 1000,
  });
  
  // Ball (red sphere): center (0, 1, 0), radius 1.0, roughness 0.7, base color #e11d48
  const ballMaterial = new MeshStandardNodeMaterial({
    color: srgb("#e11d48"),
    roughness: 0.7,
    metalness: 0,
  });
  const ball = sphereMesh(1.0, ballMaterial);
  ball.position.set(0, 1, 0);
  ball.name = "Ball";
  scene.add(ball);
  
  // Floor (flat square): 14x14, y=0, facing +Y, base color #9aa5b1, roughness 0.9, one-sided
  const floorMaterial = new MeshStandardNodeMaterial({
    color: srgb("#9aa5b1"),
    roughness: 0.9,
    metalness: 0,
    side: 1, // FrontSide
  });
  const floorGeometry = new PlaneGeometry(14, 14);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; // Rotate to lie flat in XZ plane, facing +Y
  floor.position.set(0, 0, 0);
  floor.name = "Floor";
  scene.add(floor);
  
  // Point light (white): at (1.5, 3, 2.5)
  // Calibrated so a matte white surface 3 units away facing the light is exactly white
  const pointLightIntensity = 9.0;
  const pointLight = new PointLight(0xffffff, pointLightIntensity, 0, 2);
  pointLight.position.set(1.5, 3, 2.5);
  pointLight.name = "Lamp";
  scene.add(pointLight);
  
  // Ambient light: 5% of point light strength
  const ambientLightIntensity = 0.05 * pointLightIntensity;
  const ambientLight = new AmbientLight(0xffffff, ambientLightIntensity);
  scene.add(ambientLight);
  
  return {
    scene,
    camera,
    clearColor,
  };
});
