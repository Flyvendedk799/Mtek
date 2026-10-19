// Constant scene, direct WebGPU: the model matrices and colours of the 400 boxes are written once; every frame records one
// pass with one instanced draw call and submits it. Nothing is uploaded after startup.
import { constantScene, hexToLinear, type ConstantSceneDefinition } from "../../common/layout.ts";
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
  const def = workload.definition as unknown as ConstantSceneDefinition & { boxSize: number };
  const boxes = constantScene(def);
  const context = await createDirectContext();
  const scene = new InstancedBoxes(context, boxes.length, def.boxSize, workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const palette = def.palette.map(hexToLinear);
  for (const box of boxes) {
    writeModel(scene.matrices, box.index * 16, box.position, box.yaw, box.scale);
    setColor(scene.colors, box.index, palette[box.colorIndex] as [number, number, number]);
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
