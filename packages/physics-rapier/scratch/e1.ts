import * as H from "../src/movement-harness.ts";
const b = await H.loadBackend();
const snap = Number(process.env.SNAP ?? 0.2);
for (const shape of H.SHAPES) {
  console.log("== stairs", shape, "snap", snap);
  for (const stepHeight of [0.2, 0.3, 0.4]) for (const tread of [0.15, 0.3, 0.6]) {
    const row: string[] = [];
    for (let k = 1; k <= 10; k++) { const riser = k * 0.05; const r = H.stairsUp(b, shape, { riser, tread, stepHeight, snapToGround: snap }); row.push(r.climbed ? (r.timeRatio < 1.3 ? "Y" : r.timeRatio < 2 ? "y" : "s") : "n"); }
    console.log(`sh=${stepHeight} tread=${tread}: ${row.join("")}`);
  }
}
