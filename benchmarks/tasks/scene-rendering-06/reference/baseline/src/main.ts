import { AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial, PlaneGeometry, Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, srgb, startTask } from "@mtek/benchmarks/baseline-support";

/** A non-metal physically based material. */
function matte(hex: string, roughness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: srgb(hex), roughness, metalness: 0 });
}

void startTask(() => {
  const scene = new Scene();

  // three.js lights are in physical units where a light of intensity I gives a matte surface that faces it
  // squarely the radiance I / pi of its colour, so full brightness needs intensity pi.
  const sun = new DirectionalLight(0xffffff, Math.PI);
  sun.name = "Sun";
  // The light travels from its position towards its target (the origin): along (0, -0.6, -0.8).
  sun.position.set(0, 0.6, 0.8).multiplyScalar(10);
  scene.add(sun, new AmbientLight(0xffffff, 0.1 * Math.PI));

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(10, 10), matte("#8a929c", 0.9));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -1, 0);

  const cube = boxMesh([2, 2, 2], matte("#c8a27a", 0.8));
  cube.name = "Cube";

  scene.add(floor, cube);
  return {
    scene,
    camera: lookAtCamera({ position: [2.5, 2.5, 5], target: [0, 0, 0], fovY: 0.9 }),
    clearColor: "#0b0d12",
  };
});
