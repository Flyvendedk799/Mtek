// 2,000 repeated meshes, three.js: one `InstancedMesh` of 2,000 instances (the three.js instancing path), the per-instance
// matrices written once; every frame only `renderer.render` runs.
import { Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { repeatedMeshes, type RepeatedMeshesDefinition } from "../../common/layout.ts";
import { InstancedMesh, boxGeometry, createThreeContext, disposeThree, readThree, renderThree, unlitMaterial } from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import workload from "../workload.json" with { type: "json" };

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as RepeatedMeshesDefinition;
  const boxes = repeatedMeshes(def);
  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const geometry = boxGeometry(def.boxSize);
  const material = unlitMaterial(def.color);
  const mesh = new InstancedMesh(geometry, material, boxes.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  for (const box of boxes) {
    rotation.setFromAxisAngle(yAxis, box.yaw);
    matrix.compose(new Vector3(...box.position), rotation, new Vector3(box.scale, box.scale, box.scale));
    mesh.setMatrixAt(box.index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  context.scene.add(mesh);
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
    async dispose(): Promise<void> {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      await disposeThree(context);
    },
  };
};
