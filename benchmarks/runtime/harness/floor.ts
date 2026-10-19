// The measurement floor: an application that clears the target and draws nothing. Run through exactly the same passes as
// the workloads, it shows what the harness itself costs per frame (the submit and the `onSubmittedWorkDone` round trip, the
// promise allocations of the frame loop), so a reader can see how much of a workload's frame time is the floor.
import { createDirectContext, destroyDirectContext, readTarget } from "./kit/direct.ts";
import type { BenchApp, Create, FrameSplit } from "./types.ts";

export const create: Create = async (): Promise<BenchApp> => {
  const context = await createDirectContext();
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      const { device, colorView, depthView, clear } = context;
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: colorView, clearValue: clear, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readTarget(context),
    dispose(): void {
      destroyDirectContext(context);
    },
  };
};
