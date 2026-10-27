import { readFileSync } from "node:fs";
import { it } from "vitest";
import { skinFromGlb } from "./test-support/glb-skin.js";
import { mapHumanoid } from "./scene/humanoid.js";
import { CONVENTION_IDS, buildHumanoid, expectedBones, type Frame, type Rest } from "./test-support/humanoid-fixtures.js";

const files = {
  cesium: "../../benchmarks/runtime/animation/assets/CesiumMan/CesiumMan.glb",
  fox: "../../benchmarks/runtime/animation/assets/Fox/Fox.glb",
};
it("prints", () => {
  for (const [k, f] of Object.entries(files)) {
    const skin = skinFromGlb(readFileSync(f));
    const m = mapHumanoid(skin);
    console.log(k, "error" in m ? m.error : JSON.stringify(m.bones), "error" in m ? "" : m.confidence);
  }
  let bad = 0, total = 0;
  for (const convention of CONVENTION_IDS) for (const rest of ["T", "A", "Abent"] as Rest[]) for (const frame of ["yup", "zup", "back"] as Frame[]) for (const axes of ["world", "bone"] as const) {
    const rig = buildHumanoid({ convention, rest, frame, axes, extras: { props: true, twists: true, tail: true, fingers: true, face: true } });
    const m = mapHumanoid(rig.skin);
    total++;
    const want = expectedBones(rig);
    if ("error" in m) { bad++; console.log(convention, rest, frame, axes, "ERR", m.error); continue; }
    const diff = Object.keys(want).filter((b) => (m.bones as Record<string, string>)[b] !== want[b]);
    const extra = Object.keys(m.bones).filter((b) => want[b] === undefined);
    if (diff.length || extra.length) { bad++; console.log(convention, rest, frame, axes, "DIFF", diff.map((b) => `${b}: ${(m.bones as Record<string, string>)[b]} != ${want[b]}`).join("; "), "extra", extra); }
  }
  console.log("bad", bad, "of", total);
});
