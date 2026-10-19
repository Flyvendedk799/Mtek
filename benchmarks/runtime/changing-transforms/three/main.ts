// 1,000 changing transforms, three.js: 1,000 `Mesh` objects sharing one geometry and one material; every frame each
// mesh's position and rotation are assigned and `renderer.render` updates the matrices and draws.
import { changingTransforms, transformAt, type ChangingTransformsDefinition } from "../../common/layout.ts";
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
  const def = workload.definition as unknown as ChangingTransformsDefinition;
  const boxes = changingTransforms(def);
  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const geometry = boxGeometry(def.boxSize);
  const material = unlitMaterial(def.color);
  const meshes = boxes.map((box) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...box.position);
    context.scene.add(mesh);
    return mesh;
  });
  let time = 0;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(dt: number): void {
      const t0 = performance.now();
      time += dt;
      for (let i = 0; i < boxes.length; i += 1) {
        const pose = transformAt(def, boxes[i] as (typeof boxes)[number], time);
        const mesh = meshes[i] as Mesh;
        mesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
        mesh.rotation.y = pose.yaw;
      }
      const t1 = performance.now();
      renderThree(context);
      split = { updateMs: t1 - t0, renderPrepMs: performance.now() - t1 };
    },
    split: () => split,
    readPixels: () => readThree(context),
    async dispose(): Promise<void> {
      geometry.dispose();
      material.dispose();
      await disposeThree(context);
    },
  };
};
