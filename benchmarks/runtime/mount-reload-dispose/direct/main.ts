// Mount, reload and dispose, direct WebGPU. Mount: adapter, device, targets, one pipeline and the scene's buffers and bind
// group. Reload (the edited program): the scene's buffers are released and built again from the edited definition on the same
// device, keeping the pipeline. Dispose: every buffer, both targets and the device are destroyed.
import { cycleScene, hexToLinear, type CyclesDefinition } from "../../common/layout.ts";
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
  const def = workload.definition as unknown as CyclesDefinition & { boxSize: number };
  const camera = workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] };
  const palette = def.palette.map(hexToLinear);
  const context = await createDirectContext();
  const pipeline = InstancedBoxes.createPipeline(context.device);
  const build = (paletteShift: number): InstancedBoxes => {
    const boxes = cycleScene(def, paletteShift);
    const scene = new InstancedBoxes(context, boxes.length, def.boxSize, camera, pipeline);
    for (const box of boxes) {
      writeModel(scene.matrices, box.index * 16, box.position, box.yaw, box.scale);
      setColor(scene.colors, box.index, palette[box.colorIndex] as [number, number, number]);
    }
    scene.uploadMatrices();
    scene.uploadColors();
    return scene;
  };
  let scene = build(0);
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      scene.render();
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readTarget(context),
    reload(): Promise<void> {
      const old = scene;
      scene = build(def.reloadPaletteShift);
      old.destroy();
      return Promise.resolve();
    },
    dispose(): void {
      scene.destroy();
      destroyDirectContext(context);
    },
  };
};
