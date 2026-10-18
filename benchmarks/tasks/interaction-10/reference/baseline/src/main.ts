import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const SPEED = 8;
const LIMIT = 4;

const clamp = (value: number): number => Math.max(-LIMIT, Math.min(LIMIT, value));

void startTask((host) => {
  const scene = new Scene();

  const field = boxMesh([10, 10, 0.2], unlit("#303030"));
  field.name = "Field";
  field.position.set(0, 0, -1);
  scene.add(field);

  const ship = boxMesh([2, 2, 0.5], unlit("#38bdf8"));
  ship.name = "Ship";
  scene.add(ship);

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      let dx = 0;
      let dy = 0;
      if (host.isKeyDown("ArrowRight")) dx += SPEED * dt;
      if (host.isKeyDown("ArrowLeft")) dx -= SPEED * dt;
      if (host.isKeyDown("ArrowUp")) dy += SPEED * dt;
      if (host.isKeyDown("ArrowDown")) dy -= SPEED * dt;
      ship.position.set(clamp(ship.position.x + dx), clamp(ship.position.y + dy), 0);
    },
  };
});
