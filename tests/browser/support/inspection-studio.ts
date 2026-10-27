import {prepareInspectionStudio} from "../../../examples/inspection-studio/prepare.mjs";
import {BROWSER_ROOT,REPO_ROOT} from "./environment.ts";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";

/** Actual public example and optional inspector package, with pinned asset/build provenance. */
export async function buildInspectionStudio(cli: string): Promise<void> {
  const destination = join(BROWSER_ROOT,".out/inspection-studio"), asset = await prepareInspectionStudio(cli,destination);
  const hashes: Record<string,string> = {};
  const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
  function collect(directory: string, prefix = ""): void {
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const path = join(directory,entry.name), name = prefix+entry.name;
      if (entry.isDirectory()) collect(path,name+"/"); else hashes[name] = hash(path);
    }
  }
  collect(destination);
  const result = process.env["MTEK_RESULTS_DIR"];
  if (result !== undefined) writeFileSync(join(result,"inspection-build.json"),JSON.stringify({format:"mtek-inspection-studio-build/1",asset,
    sourceSha256:hash(join(REPO_ROOT,"examples/inspection-studio/scene/src/main.mtek")),files:hashes},null,2)+"\n");
}
