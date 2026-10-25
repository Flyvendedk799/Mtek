import { Scene, DirectionalLight, AmbientLight } from "three/webgpu";
import { BoxGeometry, PlaneGeometry, Mesh, MeshStandardMaterial, Vector3, FrontSide } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();
  scene.background = srgb("#0b0d12");

  // Camera
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000,
  });

  // Cube
  const cubeGeometry = new BoxGeometry(2.0, 2.0, 2.0);
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0,
  });
  const cube = new Mesh(cubeGeometry, cubeMaterial);
  cube.position.set(0, 0, 0);
  cube.name = "Cube";
  scene.add(cube);

  // Floor
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: FrontSide,
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.set(0, -1, 0);
  floor.rotation.x = -Math.PI / 2; // Rotate to face up (+Y)
  floor.name = "Floor";
  scene.add(floor);

  // Directional Light (Sun)
  // Light travels in direction (0, -0.6, -0.8)
  // This means the light source is positioned opposite to this direction
  // For Lambertian: intensity = π so that a white surface facing the light renders as white
  const sunLight = new DirectionalLight(0xffffff, Math.PI);
  sunLight.position.set(0, 0.6, 0.8);
  sunLight.target.position.set(0, 0, 0);
  sunLight.name = "Sun";
  scene.add(sunLight);

  // Ambient Light (10% of directional light strength)
  const ambientLight = new AmbientLight(0xffffff, Math.PI * 0.1);
  scene.add(ambientLight);

  return {
    scene,
    camera,
    clearColor: "#0b0d12",
  };
});
