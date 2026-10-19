// 500 changing material params, three.js: 500 `Mesh` objects, each with its own `MeshBasicMaterial`; every frame each
// material's colour is assigned. The boxes never move, so their matrices are computed once and not updated again.
import { changingMaterials, colorAt, type ChangingMaterialsDefinition } from "../../common/layout.ts";
import { Mesh, MeshBasicMaterial, boxGeometry, createThreeContext, disposeThree, readThree, renderThree } from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as ChangingMaterialsDefinition & { boxSize: number };
  const boxes = changingMaterials(def);
  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const geometry = boxGeometry(def.boxSize);
  const materials = boxes.map(() => new MeshBasicMaterial());
  boxes.forEach((box, i) => {
    const mesh = new Mesh(geometry, materials[i]);
    mesh.position.set(...box.position);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    context.scene.add(mesh);
  });
  context.scene.updateMatrixWorld(true);
  context.scene.matrixWorldAutoUpdate = false;
  let time = 0;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(dt: number): void {
      const t0 = performance.now();
      time += dt;
      for (let i = 0; i < boxes.length; i += 1) {
        const [r, g, b] = colorAt(def, boxes[i] as (typeof boxes)[number], time);
        (materials[i] as MeshBasicMaterial).color.setRGB(r, g, b);
      }
      const t1 = performance.now();
      renderThree(context);
      split = { updateMs: t1 - t0, renderPrepMs: performance.now() - t1 };
    },
    split: () => split,
    readPixels: () => readThree(context),
    async dispose(): Promise<void> {
      geometry.dispose();
      for (const material of materials) material.dispose();
      await disposeThree(context);
    },
  };
};
