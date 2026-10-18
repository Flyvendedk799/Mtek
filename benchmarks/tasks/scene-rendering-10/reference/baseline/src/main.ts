import { AmbientLight, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Scene } from "three/webgpu";
import { lookAtCamera, sphereMesh, srgb, startTask } from "@mtek/benchmarks/baseline-support";

/** A non-metal physically based material. */
function matte(hex: string, roughness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: srgb(hex), roughness, metalness: 0 });
}

/** A point light in physical units: intensity 9 * pi lights a matte surface that faces it squarely at 3 units to full brightness. */
function lamp(name: string, hex: string, x: number): PointLight {
  const light = new PointLight(srgb(hex), 9 * Math.PI, 0, 2);
  light.name = name;
  light.position.set(x, 2.5, 2);
  return light;
}

void startTask(() => {
  const scene = new Scene();
  scene.add(lamp("LampLeft", "#ff3030", -3), lamp("LampRight", "#3050ff", 3));
  scene.add(new AmbientLight(srgb("#6070a0"), 0.1 * Math.PI));

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(12, 12), matte("#e5e7eb", 0.9));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const ball = sphereMesh(1, matte("#f3f4f6", 0.7));
  ball.name = "Ball";
  ball.position.set(0, 1, 0);

  scene.add(floor, ball);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 3, 9], target: [0, 0.5, 0], fovY: 0.8 }),
    clearColor: "#0a0a0f",
  };
});
