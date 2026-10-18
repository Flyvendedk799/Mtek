import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, srgb, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const YELLOW = "#ffd24a";
const ORANGE = "#ff7a1a";
const MAX_POWER = 5;
const RIGHT_LIMIT = 5;

void startTask((host) => {
  const scene = new Scene();

  const rail = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  rail.name = "Rail";
  rail.position.set(0, -1.1, 0);
  scene.add(rail);

  const stoneMaterial = unlit(YELLOW);
  const stone = boxMesh([2, 2, 0.5], stoneMaterial);
  stone.name = "Stone";
  stone.position.set(-4, 0, 0);
  scene.add(stone);

  // The counter Power shows: its centre is at x = -5.5 + power.
  let power = 0;
  let pulled = false;

  const marker = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  marker.name = "Power";
  scene.add(marker);

  host.onKeyDown("Space", () => {
    pulled = true;
    stoneMaterial.color.copy(srgb(ORANGE));
  });
  host.onKeyDown("ArrowUp", () => {
    if (pulled) power = Math.min(power + 1, MAX_POWER);
  });
  host.onKeyUp("Space", () => {
    pulled = false;
    stoneMaterial.color.copy(srgb(YELLOW));
    stone.position.x = Math.min(stone.position.x + 2 * power, RIGHT_LIMIT);
    power = 0;
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
