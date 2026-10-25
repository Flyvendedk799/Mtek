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

  const keysHeld = {
    ArrowLeft: false,
    ArrowRight: false,
    ArrowUp: false,
    ArrowDown: false,
  };

  host.onKeyDown("ArrowLeft", () => {
    keysHeld.ArrowLeft = true;
  });
  host.onKeyUp("ArrowLeft", () => {
    keysHeld.ArrowLeft = false;
  });

  host.onKeyDown("ArrowRight", () => {
    keysHeld.ArrowRight = true;
  });
  host.onKeyUp("ArrowRight", () => {
    keysHeld.ArrowRight = false;
  });

  host.onKeyDown("ArrowUp", () => {
    keysHeld.ArrowUp = true;
  });
  host.onKeyUp("ArrowUp", () => {
    keysHeld.ArrowUp = false;
  });

  host.onKeyDown("ArrowDown", () => {
    keysHeld.ArrowDown = true;
  });
  host.onKeyUp("ArrowDown", () => {
    keysHeld.ArrowDown = false;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update(dt) {
      const speed = 8; // world units per second
      let deltaX = 0;
      let deltaY = 0;

      if (keysHeld.ArrowRight) {
        deltaX += speed * dt;
      }
      if (keysHeld.ArrowLeft) {
        deltaX -= speed * dt;
      }
      if (keysHeld.ArrowUp) {
        deltaY += speed * dt;
      }
      if (keysHeld.ArrowDown) {
        deltaY -= speed * dt;
      }

      ship.position.x += deltaX;
      ship.position.y += deltaY;

      // Clamp position to [-4, 4] on each axis
      ship.position.x = MathUtils.clamp(ship.position.x, -4, 4);
      ship.position.y = MathUtils.clamp(ship.position.y, -4, 4);
    },
  };
});
