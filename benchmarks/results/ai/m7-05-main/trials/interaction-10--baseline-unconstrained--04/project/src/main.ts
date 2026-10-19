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

  const heldKeys = new Set<string>();

  host.onKeyDown("ArrowRight", () => {
    heldKeys.add("ArrowRight");
  });

  host.onKeyUp("ArrowRight", () => {
    heldKeys.delete("ArrowRight");
  });

  host.onKeyDown("ArrowLeft", () => {
    heldKeys.add("ArrowLeft");
  });

  host.onKeyUp("ArrowLeft", () => {
    heldKeys.delete("ArrowLeft");
  });

  host.onKeyDown("ArrowUp", () => {
    heldKeys.add("ArrowUp");
  });

  host.onKeyUp("ArrowUp", () => {
    heldKeys.delete("ArrowUp");
  });

  host.onKeyDown("ArrowDown", () => {
    heldKeys.add("ArrowDown");
  });

  host.onKeyUp("ArrowDown", () => {
    heldKeys.delete("ArrowDown");
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt: number) {
      const speed = 8; // world units per second
      let dx = 0;
      let dy = 0;

      if (heldKeys.has("ArrowRight")) {
        dx += speed * dt;
      }
      if (heldKeys.has("ArrowLeft")) {
        dx -= speed * dt;
      }
      if (heldKeys.has("ArrowUp")) {
        dy += speed * dt;
      }
      if (heldKeys.has("ArrowDown")) {
        dy -= speed * dt;
      }

      ship.position.x += dx;
      ship.position.y += dy;

      // Clamp to [-4, 4] on both axes
      ship.position.x = MathUtils.clamp(ship.position.x, -4, 4);
      ship.position.y = MathUtils.clamp(ship.position.y, -4, 4);
    },
  };
});
