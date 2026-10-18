import { Scene } from "three/webgpu";
import { boxMesh, lookAtCamera, startTask, unlit } from "@mtek/benchmarks/baseline-support";

/** One column: a box 1.2 wide and deep, `height` tall, standing on y = 0 at x. */
function column(name: string, x: number, height: number, tint: string) {
  const mesh = boxMesh([1.2, height, 1.2], unlit(tint));
  mesh.name = name;
  mesh.position.set(x, height / 2, 0);
  return mesh;
}

void startTask(() => {
  const scene = new Scene();
  scene.add(
    column("Column1", -4, 1, "#ef4444"),
    column("Column2", -2, 2, "#f59e0b"),
    column("Column3", 0, 3, "#22c55e"),
    column("Column4", 2, 2, "#3b82f6"),
    column("Column5", 4, 1, "#a855f7"),
  );
  return {
    scene,
    camera: lookAtCamera({ position: [0, 2.5, 14], target: [0, 1.5, 0], fovY: 0.8 }),
    clearColor: "#0f172a",
  };
});
