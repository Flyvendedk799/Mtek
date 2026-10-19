// 1,000 changing transforms, direct WebGPU: one instance buffer of model matrices rewritten every frame with one
// `writeBuffer` (64 KB), one instanced draw call.
import { changingTransforms, hexToLinear, transformAt, type ChangingTransformsDefinition } from "../../common/layout.ts";
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
  const def = workload.definition as unknown as ChangingTransformsDefinition;
  const boxes = changingTransforms(def);
  const context = await createDirectContext();
  const scene = new InstancedBoxes(context, boxes.length, def.boxSize, workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const color = hexToLinear(def.color);
  boxes.forEach((box, i) => setColor(scene.colors, i, color));
  scene.uploadColors();
  let time = 0;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(dt: number): void {
      const t0 = performance.now();
      time += dt;
      for (const box of boxes) {
        const pose = transformAt(def, box, time);
        writeModel(scene.matrices, box.index * 16, pose.position, pose.yaw, 1);
      }
      const t1 = performance.now();
      scene.uploadMatrices();
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
