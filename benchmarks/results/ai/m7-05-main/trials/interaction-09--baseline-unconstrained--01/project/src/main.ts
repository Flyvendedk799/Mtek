import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const rail = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  rail.name = "Rail";
  rail.position.set(0, -1.1, 0);
  scene.add(rail);

  const stoneMaterial = unlit("#ffd24a");
  const stone = boxMesh([2, 2, 0.5], stoneMaterial);
  stone.name = "Stone";
  stone.position.set(-4, 0, 0);
  scene.add(stone);

  // The counter Power shows: its centre is at x = -5.5 + power.
  let power = 0;
  let spaceHeld = false;

  const marker = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  marker.name = "Power";
  scene.add(marker);

  host.onKeyDown("Space", () => {
    spaceHeld = true;
  });

  host.onKeyDown("ArrowUp", () => {
    if (spaceHeld && power < 5) {
      power += 1;
    }
  });

  host.onKeyUp("Space", () => {
    spaceHeld = false;
    // Launch the stone
    if (power > 0) {
      const moveDistance = power * 2;
      const newX = Math.min(stone.position.x + moveDistance, 5);
      stone.position.x = newX;
    }
    power = 0;
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      // Update stone color based on space held state
      if (spaceHeld) {
        stoneMaterial.color.setStyle("#ff7a1a");
      } else {
        stoneMaterial.color.setStyle("#ffd24a");
      }
      marker.position.set(-5.5 + power, 3.5, 0);
    },
  };
});
