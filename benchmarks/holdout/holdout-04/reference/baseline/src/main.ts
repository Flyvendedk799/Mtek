import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, sphereMesh, startTask, unlit } from "@mtek/benchmarks/baseline-support";

void startTask((host) => {
  const scene = new Scene();

  const slotX = [-3, -1, 1, 3];
  slotX.forEach((x, index) => {
    const slot = boxMesh([1.2, 1.2, 1.2], unlit("#475569"));
    slot.name = `Slot${String(index)}`;
    slot.position.set(x, 0, 0);
    scene.add(slot);
  });

  const cursor = sphereMesh(0.3, unlit("#facc15"));
  cursor.name = "Cursor";
  cursor.position.set(-3, 1, 0);
  scene.add(cursor);

  let selected = 0;
  const select = (index: number): void => {
    selected = (index + slotX.length) % slotX.length;
    cursor.position.set(slotX[selected] ?? 0, 1, 0);
  };
  host.onKeyDown("ArrowRight", () => {
    select(selected + 1);
  });
  host.onKeyDown("ArrowLeft", () => {
    select(selected - 1);
  });

  return {
    scene,
    camera: lookAtCamera({ position: [0, 0, 7], target: [0, 0, 0] }),
    clearColor: "#111827",
  };
});
