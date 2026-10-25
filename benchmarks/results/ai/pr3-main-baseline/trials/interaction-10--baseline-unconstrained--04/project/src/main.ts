import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";
import { MathUtils } from "three/webgpu";

void startTask((host) => {
  const scene = new Scene();

  const field = boxMesh([10, 10, 0.2], unlit("#303030"));
  field.name = "Field";
  field.position.set(0, 0, -1);
  scene.add(field);

  const ship = boxMesh([2, 2, 0.5], unlit("#38bdf8"));
  ship.name = "Ship";
  scene.add(ship);

  const SPEED = 8; // world units per second
  const CLAMP_MIN = -4;
  const CLAMP_MAX = 4;

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt: number) {
      let vx = 0;
      let vy = 0;

      if (host.isKeyDown("ArrowRight")) vx += SPEED;
      if (host.isKeyDown("ArrowLeft")) vx -= SPEED;
      if (host.isKeyDown("ArrowUp")) vy += SPEED;
      if (host.isKeyDown("ArrowDown")) vy -= SPEED;

      ship.position.x += vx * dt;
      ship.position.y += vy * dt;

      // Clamp position to [-4, 4] on both axes
      ship.position.x = MathUtils.clamp(ship.position.x, CLAMP_MIN, CLAMP_MAX);
      ship.position.y = MathUtils.clamp(ship.position.y, CLAMP_MIN, CLAMP_MAX);
    },
  };
});
