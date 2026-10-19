import { Scene, Mesh, BoxGeometry, PlaneGeometry, DirectionalLight, AmbientLight, MeshStandardMaterial, FrontSide } from "three/webgpu";
import { lookAtCamera, startTask, srgb } from "@mtek/benchmarks/baseline-support";

void startTask(() => {
  const scene = new Scene();

  // Camera setup
  const camera = lookAtCamera({
    position: [2.5, 2.5, 5],
    target: [0, 0, 0],
    fovY: 0.9,
    near: 0.1,
    far: 1000
  });

  // Cube
  const cubeGeometry = new BoxGeometry(2.0, 2.0, 2.0);
  const cubeMaterial = new MeshStandardMaterial({
    color: srgb("#c8a27a"),
    roughness: 0.8,
    metalness: 0
  });
  const cube = new Mesh(cubeGeometry, cubeMaterial);
  cube.name = "Cube";
  scene.add(cube);

  // Floor
  const floorGeometry = new PlaneGeometry(10, 10);
  const floorMaterial = new MeshStandardMaterial({
    color: srgb("#8a929c"),
    roughness: 0.9,
    metalness: 0,
    side: FrontSide
  });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "Floor";
  floor.position.y = -1;
  floor.rotation.x = -Math.PI / 2; // Lay it flat facing +Y
  scene.add(floor);

  // Directional light (Sun)
  // For a perfectly matte white surface facing the light to render as white,
  // intensity should be π (since formula is albedo * E / π)
  const sunIntensity = Math.PI;
  const sun = new DirectionalLight(0xffffff, sunIntensity);
  sun.name = "Sun";
  // Direction is (0, -0.6, -0.8), so position should be in that direction
  // The light shines from position toward target
  sun.position.set(0, 0.6, 0.8);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);

  // Ambient light (10% of sun strength)
  const ambientIntensity = 0.1 * sunIntensity;
  const ambient = new AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambient);

  return {
    scene,
    camera,
    clearColor: "#0b0d12"
  };
});
