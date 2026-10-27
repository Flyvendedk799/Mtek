import RAPIER from "@dimforge/rapier3d-compat";
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
const riser = Number(process.argv[2] ?? 0.24);
const box = (x0: number, x1: number, y1: number) => {
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((x0 + x1) / 2, (y1 - 1) / 2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 + 1) / 2, 3), b);
};
box(-8, 0, 0);
for (let i = 1; i <= 6; i++) box((i - 1) * 0.6, i * 0.6, i * riser);
world.step();
const shape = new RAPIER.Cuboid(0.3, 0.9, 0.3);
const rot = { x: 0, y: 0, z: 0, w: 1 };
const off = 0.01, maxH = Number(process.env.SH ?? 0.4) + off, minW = 0.1 + off;
const pos = { x: Number(process.argv[3] ?? 0.2898), y: Number(process.argv[4] ?? 0.959777713), z: 0 };
const cast = (p: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxToi: number) =>
  world.castShape(p, rot, d, shape, off, maxToi, false);
const up = cast(pos, { x: 0, y: 1, z: 0 }, maxH);
console.log("up", up && up.time_of_impact);
const lifted = { x: pos.x, y: pos.y + maxH, z: 0 };
const fwd = cast(lifted, { x: 1, y: 0, z: 0 }, minW);
console.log("fwd", fwd && fwd.time_of_impact);
const ahead = { x: lifted.x + minW, y: lifted.y, z: 0 };
const down = cast(ahead, { x: 0, y: -1, z: 0 }, maxH);
console.log("down", down && [down.time_of_impact, down.normal1.x, down.normal1.y, down.normal1.z]);
