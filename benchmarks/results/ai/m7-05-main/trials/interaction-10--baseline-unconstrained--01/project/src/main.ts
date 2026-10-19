import { Scene, MathUtils } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const field = boxMesh([10, 10, 0.2], unlit("#303030"));
  field.name = "Field";
  field.position.set(0, 0, -1);
  scene.add(field);

  const ship = boxMesh([2, 2, 0.5], unlit("#38bdf8"));
  ship.name = "Ship";
  scene.add(ship);

  const keysHeld = new Set<string>();

  host.onKeyDown("ArrowRight", () => {
    keysHeld.add("ArrowRight");
  });
  host.onKeyUp("ArrowRight", () => {
    keysHeld.delete("ArrowRight");
  });

  host.onKeyDown("ArrowLeft", () => {
    keysHeld.add("ArrowLeft");
  });
  host.onKeyUp("ArrowLeft", () => {
    keysHeld.delete("ArrowLeft");
  });

  host.onKeyDown("ArrowUp", () => {
    keysHeld.add("ArrowUp");
  });
  host.onKeyUp("ArrowUp", () => {
    keysHeld.delete("ArrowUp");
  });

  host.onKeyDown("ArrowDown", () => {
    keysHeld.add("ArrowDown");
  });
  host.onKeyUp("ArrowDown", () => {
    keysHeld.delete("ArrowDown");
  });

  const SPEED = 8; // world units per second

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      let dx = 0;
      let dy = 0;

      if (keysHeld.has("ArrowRight")) {
        dx += SPEED * dt;
      }
      if (keysHeld.has("ArrowLeft")) {
        dx -= SPEED * dt;
      }
      if (keysHeld.has("ArrowUp")) {
        dy += SPEED * dt;
      }
      if (keysHeld.has("ArrowDown")) {
        dy -= SPEED * dt;
      }

      ship.position.x += dx;
      ship.position.y += dy;

      // Clamp position to [-4, 4] on both axes
      ship.position.x = MathUtils.clamp(ship.position.x, -4, 4);
      ship.position.y = MathUtils.clamp(ship.position.y, -4, 4);
    },
  };
});
