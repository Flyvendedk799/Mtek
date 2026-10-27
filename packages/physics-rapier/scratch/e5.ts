import * as H from "../src/movement-harness.ts";
const b = await H.loadBackend();
const spec = H.CHARACTERS.box;
for (const riser of [0.1,0.15,0.2,0.22,0.23,0.235,0.24,0.245,0.25,0.26,0.28,0.3]) {
  const rig = H.createRig(b, "box", H.v3(-0.31, H.standY(spec, 0), 0), { options: { stepHeight: Number(process.env.SH ?? 0.3), snapToGround: Number(process.env.SNAP ?? 0.2), offset: Number(process.env.OFF ?? 0.01) } });
  H.solid(rig, H.v3(-8, -1, -3), H.v3(0, 0, 3));
  for (let i = 1; i <= 6; i++) H.solid(rig, H.v3((i - 1) * 0.3, -1, -3), H.v3(2.0, i * riser, 3));
  rig.world.step();
  const out: string[] = [];
  for (const dx of [0.0333, 0.1, 0.2]) {
    const m = rig.world.moveCharacter!(rig.body, H.v3(dx), { ...rig.options, rotation: H.IDENTITY });
    out.push(`dx=${dx}: (${m.displacement.x.toFixed(4)},${m.displacement.y.toFixed(4)})`);
  }
  console.log(riser, out.join("  "));
}
