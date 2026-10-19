// 300 physics bodies, three.js: Rapier 0.21.0 used directly (the same bodies, colliders and tick order as the direct
// implementation), 300 crate `Mesh` objects (three materials, one per layer) and a floor mesh; every frame each mesh takes
// the pose of its body and `renderer.render` draws.
import RAPIER from "@dimforge/rapier3d-compat";
import { forceAt, physicsBodies, type PhysicsBodiesDefinition, type Vec3 } from "../../common/layout.ts";
import { BoxGeometry, Mesh, MeshBasicMaterial, boxGeometry, createThreeContext, disposeThree, readThree, renderThree, unlitMaterial } from "../../harness/kit/three.ts";
import type { BenchApp, Create, FrameSplit } from "../../harness/types.ts";
import protocol from "../../protocol.json" with { type: "json" };
import workload from "../workload.json" with { type: "json" };

const FLOOR_COLOR = "#2a3342";

export const create: Create = async (): Promise<BenchApp> => {
  const def = workload.definition as unknown as PhysicsBodiesDefinition;
  const boxes = physicsBodies(def);
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = protocol.frameDeltaSeconds;
  const [fx, fy, fz] = def.floorSize;
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -fy / 2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(fx / 2, fy / 2, fz / 2).setFriction(def.friction), floorBody);
  const half = def.boxSize / 2;
  const bodies = boxes.map((box) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(...box.position).setLinearDamping(0).setAngularDamping(0.05),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setMass(def.mass).setFriction(def.friction).setRestitution(0), body);
    return body;
  });

  const context = await createThreeContext(workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const geometry = boxGeometry(def.boxSize);
  const materials = def.layerColors.map(unlitMaterial);
  const meshes = boxes.map((box) => {
    const mesh = new Mesh(geometry, materials[box.colorIndex]);
    mesh.position.set(...box.position);
    context.scene.add(mesh);
    return mesh;
  });
  const floorGeometry = new BoxGeometry(fx, fy, fz);
  const floorMaterial: MeshBasicMaterial = unlitMaterial(FLOOR_COLOR);
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.set(0, -fy / 2, 0);
  floor.matrixAutoUpdate = false;
  floor.updateMatrix();
  context.scene.add(floor);

  let time = 0;
  let pending: Vec3[] | null = null;
  let split: FrameSplit = { updateMs: 0, renderPrepMs: 0 };
  return {
    frame(dt: number): void {
      const t0 = performance.now();
      time += dt;
      if (pending !== null) {
        for (let i = 0; i < bodies.length; i += 1) {
          const force = pending[i] as Vec3;
          (bodies[i] as RAPIER.RigidBody).addForce({ x: force[0], y: force[1], z: force[2] }, true);
        }
      }
      pending = boxes.map((box) => forceAt(def, box, time));
      world.step();
      for (const body of bodies) body.resetForces(true);
      for (let i = 0; i < bodies.length; i += 1) {
        const body = bodies[i] as RAPIER.RigidBody;
        const p = body.translation();
        const q = body.rotation();
        const mesh = meshes[i] as Mesh;
        mesh.position.set(p.x, p.y, p.z);
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }
      const t1 = performance.now();
      renderThree(context);
      split = { updateMs: t1 - t0, renderPrepMs: performance.now() - t1 };
    },
    split: () => split,
    readPixels: () => readThree(context),
    info(): Record<string, unknown> {
      return {
        entityCount: bodies.length + 1,
        sleepingBodies: bodies.filter((b) => b.isSleeping()).length,
        sample: bodies.slice(0, 8).map((b, i) => ({ name: `C${String(i).padStart(3, "0")}`, position: b.translation() })),
      };
    },
    async dispose(): Promise<void> {
      geometry.dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
      for (const material of materials) material.dispose();
      await disposeThree(context);
      world.free();
    },
  };
};
