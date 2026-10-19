// 300 physics bodies, direct WebGPU: Rapier 0.21.0 used directly (a dynamic body and a box collider per crate, a static floor,
// no collision events), the crates and the floor drawn with one instanced draw call whose instance buffer is rewritten
// from the bodies' poses every frame.
//
// Tick order matches the frame order of spec/scenes.md section 10: the forces computed by the previous tick are applied,
// this tick's forces are computed (they apply in the next tick), the world steps, the forces are cleared, poses are read.
import RAPIER from "@dimforge/rapier3d-compat";
import { forceAt, hexToLinear, physicsBodies, type PhysicsBodiesDefinition, type Vec3 } from "../../common/layout.ts";
import {
  InstancedBoxes,
  createDirectContext,
  destroyDirectContext,
  readTarget,
  setColor,
  writeModel,
  writeModelQuat,
} from "../../harness/kit/direct.ts";
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

  const context = await createDirectContext();
  const floorIndex = boxes.length;
  const scene = new InstancedBoxes(context, boxes.length + 1, def.boxSize, workload.camera as unknown as { position: [number, number, number]; target: [number, number, number] });
  const layerColors = def.layerColors.map(hexToLinear);
  for (const box of boxes) setColor(scene.colors, box.index, layerColors[box.colorIndex] as Vec3);
  setColor(scene.colors, floorIndex, hexToLinear(FLOOR_COLOR));
  writeModel(scene.matrices, floorIndex * 16, [0, -fy / 2, 0], 0, [fx, fy, fz]);
  scene.uploadColors();

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
        writeModelQuat(scene.matrices, i * 16, [p.x, p.y, p.z], q);
      }
      const t1 = performance.now();
      scene.uploadMatrices();
      scene.render();
      split = { updateMs: t1 - t0, renderPrepMs: performance.now() - t1 };
    },
    split: () => split,
    readPixels: () => readTarget(context),
    info(): Record<string, unknown> {
      return {
        entityCount: bodies.length + 1,
        sleepingBodies: bodies.filter((b) => b.isSleeping()).length,
        sample: bodies.slice(0, 8).map((b, i) => ({ name: `C${String(i).padStart(3, "0")}`, position: b.translation() })),
      };
    },
    dispose(): void {
      scene.destroy();
      destroyDirectContext(context);
      world.free();
    },
  };
};
