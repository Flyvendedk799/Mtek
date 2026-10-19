import { Scene } from "three/webgpu";
import { boxMesh, orthographicCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const rail = boxMesh([12, 0.2, 0.2], unlit("#404040"));
  rail.name = "Rail";
  rail.position.set(0, -1.1, 0);
  scene.add(rail);

  const stone = boxMesh([2, 2, 0.5], unlit("#ffd24a"));
  stone.name = "Stone";
  stone.position.set(-4, 0, 0);
  scene.add(stone);

  // The counter Power shows: its centre is at x = -5.5 + power.
  let power = 0;
  let spaceIsHeld = false;

  const stoneYellowMaterial = unlit("#ffd24a");
  stoneYellowMaterial.name = "StoneYellow";
  const stoneOrangeMaterial = unlit("#ff7a1a");
  stoneOrangeMaterial.name = "StoneOrange";

  const marker = boxMesh([1, 1, 0.5], unlit("#38bdf8"));
  marker.name = "Power";
  scene.add(marker);

  host.onKeyDown("Space", () => {
    spaceIsHeld = true;
    stone.material = stoneOrangeMaterial;
  });

  host.onKeyUp("Space", () => {
    spaceIsHeld = false;
    stone.material = stoneYellowMaterial;
    // Launch the stone
    const launchDistance = power * 2;
    const newX = stone.position.x + launchDistance;
    stone.position.x = Math.min(newX, 5);
    power = 0;
  });

  host.onKeyDown("ArrowUp", () => {
    if (spaceIsHeld && power < 5) {
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
