// Byte-compare every packaged file from separately built compiler revisions.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";

const [, , before, after, directory, suite = "synthetic"] = process.argv;
if (!directory || !before || !after) throw new Error("before-executable after-executable output-directory required");
mkdirSync(directory, { recursive: true });
function files(root, at = root) {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(root, join(at, entry.name)) : [relative(root, join(at, entry.name)).replaceAll("\\", "/")]).sort();
}
const records = [];
const shapes = suite === "projects" ? [
  ...["pulse-cube", "modular-scene", "material-configurator", "physics-playground", "product-configurator"].map((name) => `project:examples/${name}`),
  ...["changing-transforms", "changing-material-params", "repeated-meshes"].map((name) => `project:benchmarks/runtime/${name}/mtek`),
] : ["independent", "chain", "fanout", "diamond", "dense", "mesh-identical", "mesh-reuse", "mesh-unique"];
for (const shape of shapes) {
  for (const count of suite === "projects" ? [0] : [128, 512, 8192]) {
    const name = shape.replaceAll(/[:/]/g, "_");
    const roots = ["before", "after"].map((revision) => resolve(directory, `${name}-${count}-${revision}`));
    for (const [index, executable] of [before, after].entries()) {
      const result = spawnSync(resolve(executable), [shape, String(count), "0", "emit", roots[index]], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    }
    const names = roots.map((root) => files(root));
    if (JSON.stringify(names[0]) !== JSON.stringify(names[1])) throw new Error(`different filenames: ${shape} ${count}`);
    const hash = createHash("sha256");
    let bytes = 0;
    for (const name of names[0]) {
      const a = readFileSync(join(roots[0], name));
      const b = readFileSync(join(roots[1], name));
      if (!a.equals(b)) throw new Error(`different bytes: ${shape} ${count} ${name}`);
      hash.update(name).update("\0").update(a);
      bytes += a.length;
    }
    const record = { shape, count, files: names[0].length, bytes, sha256: hash.digest("hex") };
    records.push(record);
    console.log(shape, count, "identical", record.files, "files");
  }
}
writeFileSync(join(directory, "comparison.json"), JSON.stringify(records, null, 2) + "\n");
