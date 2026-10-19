// 500 changing material params, direct WebGPU: the model matrices are written once; every frame the 500 colours are
// recomputed and rewritten with one `writeBuffer` of 8 KB, and one instanced draw call draws the scene.
import { changingMaterials, colorAt, type ChangingMaterialsDefinition } from "../../common/layout.ts";
import {
  InstancedBoxes,
  createDirectContext,
  destroyDirectContext,
  readTarget,
  setColor,
  writeModel,
} from "../../harness/kit/direct.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as ChangingMaterialsDefinition & { boxSize: number };
  const boxes = changingMaterials(def);
  const context = await createDirectContext();
  const scene = new InstancedBoxes(context, boxes.length, def.boxSize, workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  for (const box of boxes) writeModel(scene.matrices, box.index * 16, box.position, box.yaw, box.scale);
  scene.uploadMatrices();
  let time = 0;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(dt: number): void {
      const t0 = performance.now();
      time += dt;
      for (const box of boxes) setColor(scene.colors, box.index, colorAt(def, box, time));
      const t1 = performance.now();
      scene.uploadColors();
      scene.render();
      split = { updateMs: t1 - t0, renderPrepMs: performance.now() - t1 };
    },
    split: () => split,
    readPixels: () => readTarget(context),
    dispose(): void {
      scene.destroy();
      destroyDirectContext(context);
    },
  };
};
