import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";
import { MathUtils } from "three/webgpu";

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
    stoneMaterial.color.setStyle("#ff7a1a");
  });

  host.onKeyUp("Space", () => {
    spaceHeld = false;
    stoneMaterial.color.setStyle("#ffd24a");
    
    // Launch the stone
    if (power > 0) {
      const newX = stone.position.x + power * 2;
      stone.position.x = Math.min(newX, 5);
    }
    
    power = 0;
  });

  host.onKeyDown("ArrowUp", () => {
    if (spaceHeld && power < 5) {
      power += 1;
    }
  });

  return {
    scene,
    camera: orthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 12.8 }),
    clearColor: "#202020",
    update() {
      marker.position.set(-5.5 + power, 3.5, 0);
    },
  };
});
