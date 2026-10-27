import * as H from "../src/movement-harness.ts";
const b = await H.loadBackend();
const shape = (process.argv[2] ?? "capsule") as H.ShapeName;
const sh = Number(process.argv[3] ?? 0.4), tread = Number(process.argv[4] ?? 0.6);
const snap = Number(process.env.SNAP ?? 0.2);
const minw = Number(process.env.MINW ?? 0.1);
const row: string[] = [];
for (let k = 1; k <= 10; k++) {
  const riser = k * 0.05;
  const r = H.stairsUp(b, shape, { riser, tread, stepHeight: sh, snapToGround: snap, stepMinWidth: minw });
  row.push(`${riser.toFixed(2)}:${r.climbed ? "Y" : "n"}${r.timeRatio}`);
}
console.log(shape, "sh", sh, "tread", tread, "minw", minw, "snap", snap, row.join(" "));
