// Mount, reload and dispose, three.js. Mount: renderer (`init()` acquires the adapter and device), render target, the scene's
// meshes, geometry and materials. Reload (the edited program): the meshes are removed, their geometry and materials disposed
// and the scene is built again from the edited definition with the same renderer. Dispose: geometry, materials, render
// target and renderer are disposed (`renderer.dispose()` also destroys the GPU device three.js acquired).
import { cycleScene, type CyclesDefinition } from "../../common/layout.ts";
import { Mesh, boxGeometry, createThreeContext, disposeThree, readThree, renderThree, unlitMaterial, type ThreeContext } from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as CyclesDefinition & { boxSize: number };
  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  let content: { geometry: ReturnType<typeof boxGeometry>; materials: ReturnType<typeof unlitMaterial>[]; meshes: Mesh[] } | null = null;
  const build = (ctx: ThreeContext, paletteShift: number): void => {
    const geometry = boxGeometry(def.boxSize);
    const materials = def.palette.map(unlitMaterial);
    const meshes = cycleScene(def, paletteShift).map((box) => {
      const mesh = new Mesh(geometry, materials[box.colorIndex]);
      mesh.position.set(...box.position);
      mesh.rotation.y = box.yaw;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      ctx.scene.add(mesh);
      return mesh;
    });
    ctx.scene.updateMatrixWorld(true);
    content = { geometry, materials, meshes };
  };
  const release = (ctx: ThreeContext): void => {
    if (content === null) return;
    for (const mesh of content.meshes) ctx.scene.remove(mesh);
    content.geometry.dispose();
    for (const material of content.materials) material.dispose();
    content = null;
  };
  build(context, 0);
  // The scene is static between a mount and a reload.
  context.scene.matrixWorldAutoUpdate = false;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(): void {
      const t0 = performance.now();
      renderThree(context);
      split = { updateMs: 0, renderPrepMs: performance.now() - t0 };
    },
    split: () => split,
    readPixels: () => readThree(context),
    reload(): Promise<void> {
      release(context);
      build(context, def.reloadPaletteShift);
      return Promise.resolve();
    },
    async dispose(): Promise<void> {
      release(context);
      await disposeThree(context);
    },
  };
};
