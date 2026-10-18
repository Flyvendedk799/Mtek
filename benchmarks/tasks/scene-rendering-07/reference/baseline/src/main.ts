import { AmbientLight, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Scene } from "three/webgpu";
import { lookAtCamera, sphereMesh, srgb, startTask } from "@mtek/benchmarks/baseline-support";

/** A non-metal physically based material. */
function matte(hex: string, roughness: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: srgb(hex), roughness, metalness: 0 });
}

void startTask(() => {
  const scene = new Scene();

  // Physical units: a point light of intensity I gives a matte surface that faces it squarely at distance d
  // the radiance I / (pi * d^2) of its colour. Full brightness at d = 3 needs I = 9 * pi; `decay` 2 is the
  // inverse-square law and `distance` 0 means no range limit.
  const lamp = new PointLight(0xffffff, 9 * Math.PI, 0, 2);
  lamp.name = "Lamp";
  lamp.position.set(1.5, 3, 2.5);
  scene.add(lamp, new AmbientLight(0xffffff, 0.05 * Math.PI));

  // A PlaneGeometry lies in the XY plane facing +Z; turn it to lie flat facing +Y.
  const floor = new Mesh(new PlaneGeometry(14, 14), matte("#9aa5b1", 0.9));
  floor.name = "Floor";
  floor.rotation.x = -Math.PI / 2;

  const ball = sphereMesh(1, matte("#e11d48", 0.7));
  ball.name = "Ball";
  ball.position.set(0, 1, 0);

  scene.add(floor, ball);
  return {
    scene,
    camera: lookAtCamera({ position: [0, 3, 8], target: [0, 0.5, 0], fovY: 0.8 }),
    clearColor: "#10131a",
  };
});
