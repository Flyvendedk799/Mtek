// Constant scene, three.js: 400 `Mesh` objects sharing one geometry and eight materials (one per colour). The scene never
// changes, so the matrices are computed once and automatic matrix updates are switched off, as the three.js manual
// recommends for static objects; every frame only `renderer.render` runs.
import { constantScene, type ConstantSceneDefinition } from "../../common/layout.ts";
import {
  Mesh,
  boxGeometry,
  createThreeContext,
  disposeThree,
  readThree,
  renderThree,
  unlitMaterial,
} from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as ConstantSceneDefinition & { boxSize: number };
  const boxes = constantScene(def);
  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const geometry = boxGeometry(def.boxSize);
  const materials = def.palette.map(unlitMaterial);
  for (const box of boxes) {
    const mesh = new Mesh(geometry, materials[box.colorIndex]);
    mesh.position.set(...box.position);
    mesh.rotation.y = box.yaw;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    context.scene.add(mesh);
  }
  context.scene.updateMatrixWorld(true);
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
    dispose(): void {
      geometry.dispose();
      for (const material of materials) material.dispose();
      disposeThree(context);
    },
  };
};
