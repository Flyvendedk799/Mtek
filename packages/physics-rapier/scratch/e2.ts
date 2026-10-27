import * as H from "../src/movement-harness.ts";
const b = await H.loadBackend();
const [shape, riserS, shS, treadS, dtS] = process.argv.slice(2);
const riser = Number(riserS), sh = Number(shS), tread = Number(treadS), dt = Number(dtS ?? 1 / 60);
const spec = H.CHARACTERS[shape as H.ShapeName];
const rig = H.createRig(b, shape as H.ShapeName, H.v3(-1.5, H.standY(spec, 0), 0), { dt, options: { stepHeight: sh, snapToGround: Number(process.env.SNAP ?? 0.2), stepMinWidth: Number(process.env.MINW ?? 0.1) } });
H.solid(rig, H.v3(-8, -1, -3), H.v3(0, 0, 3));
for (let i = 1; i <= 6; i++) H.solid(rig, H.v3((i - 1) * tread, -1, -3), H.v3(i * tread, i * riser, 3));
H.solid(rig, H.v3(6 * tread, -1, -3), H.v3(6 * tread + 6, 6 * riser, 3));
for (let i = 0; i < 160; i++) {
  const m = H.tick(rig, H.v3(2 * dt));
  const p = H.poseOf(rig).position;
  if (i % Number(process.env.EVERY ?? 3) === 0) console.log(i, "x", p.x.toFixed(9), "y", p.y.toFixed(9), "disp", m.displacement.x.toFixed(4), m.displacement.y.toFixed(4), "g", m.grounded, "gr", m.ground?.userId);
}
