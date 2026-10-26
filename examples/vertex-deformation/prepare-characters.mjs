import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const here = import.meta.dirname, repo = resolve(here, "../..");
const original = join(repo, "benchmarks/runtime/animation/assets");

/** Reuse unmodified pinned assets; never edit the frozen animation benchmark suite. */
export async function prepareCharacters() {
  const provenance = JSON.parse(await readFile(join(original, "provenance.json"), "utf8"));
  const destination = join(here, "characters/models");
  await mkdir(destination, { recursive: true });
  const records = [];
  for (const name of ["Fox", "CesiumMan"]) {
    const record = provenance.models.find(model => model.model === name).files[`${name}.glb`];
    const bytes = await readFile(join(original, name, `${name}.glb`));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), record.sha256);
    await writeFile(join(destination, `${name}.glb`), bytes);
    records.push({ model: name, commit: provenance.commit, ...record });
  }
  execFileSync(join(repo, "target/debug", process.platform === "win32" ? "mtek.exe" : "mtek"),
    ["build", "--mode", "test", "--out", join(here, ".characters-out"), join(here, "characters")],
    { cwd: repo, stdio: "inherit", windowsHide: true, env: { ...process.env, RAYON_NUM_THREADS: "1" } });
  return records;
}

if (process.argv[1] && resolve(process.argv[1]) === join(here, "prepare-characters.mjs")) await prepareCharacters();
