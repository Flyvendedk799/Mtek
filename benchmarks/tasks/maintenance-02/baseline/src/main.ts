import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

const COLUMNS = 5;
const SPACING = 1.5;
const FIRST_ROW_Y = 2.0;
const ROW_DROP = 2.5;

void startTask((host) => {
  const scene = new Scene();

  // The shelf below the rows; it never changes.
  const rail = boxMesh([8, 0.4, 1], unlit("#475569"));
  rail.name = "Rail";
  rail.position.set(0, -3, 0);
  scene.add(rail);

  // How many rows Space has placed so far.
  let rows = 0;
  host.onKeyDown("Space", () => {
    const y = FIRST_ROW_Y - ROW_DROP * rows;
    for (let i = 1; i < COLUMNS; i += 1) {
      const marker = boxMesh([0.8, 0.8, 0.8], unlit("#facc15"));
      marker.name = "Marker";
      marker.position.set(SPACING * (i - 2), y, 0);
      scene.add(marker);
    }
    rows += 1;
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 8], target: [0, 0, 0] }),
    clearColor: "#202020",
  };
});
