// 2,000 repeated meshes, direct WebGPU: one mesh, one colour, 2,000 model matrices written once into an instance buffer;
// every frame one pass with one instanced draw call. Nothing is uploaded after startup.
import { hexToLinear, repeatedMeshes, type RepeatedMeshesDefinition } from "../../common/layout.ts";
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
  const def = workload.definition as unknown as RepeatedMeshesDefinition;
  const boxes = repeatedMeshes(def);
  const context = await createDirectContext();
  const scene = new InstancedBoxes(context, boxes.length, def.boxSize, workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const color = hexToLinear(def.color);
  for (const box of boxes) {
    writeModel(scene.matrices, box.index * 16, box.position, box.yaw, box.scale);
    setColor(scene.colors, box.index, color);
  }
  scene.uploadMatrices();
  scene.uploadColors();
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      scene.render();
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readTarget(context),
    dispose(): void {
      scene.destroy();
      destroyDirectContext(context);
    },
  };
};
