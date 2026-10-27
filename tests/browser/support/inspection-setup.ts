import {execFileSync} from "node:child_process";
import {copyFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {build} from "esbuild";
import {BROWSER_ROOT,REPO_ROOT} from "./environment.ts";
import {buildInspectionStudio} from "./inspection-studio.ts";
import {buildLightingStudio} from "./lighting-studio.ts";
import {startStaticServer} from "./serve.ts";

export default async function setup(): Promise<() => Promise<void>> {
  const out = join(BROWSER_ROOT,".out"), results = process.env["MTEK_RESULTS_DIR"];
  if (results === undefined) throw new Error("MTEK_RESULTS_DIR is missing");
  mkdirSync(out,{recursive:true}); mkdirSync(results,{recursive:true});
  execFileSync("cargo",["build","-p","mtek-cli","--locked","-j","2"],{cwd:REPO_ROOT,stdio:"inherit",windowsHide:true});
  const cli = join(REPO_ROOT,"target/debug",process.platform === "win32" ? "mtek.exe" : "mtek");
  await buildInspectionStudio(cli); buildLightingStudio(cli);
  await build({entryPoints:[join(BROWSER_ROOT,"support/env-probe.ts")],outfile:join(out,"env-probe.js"),bundle:true,format:"esm",target:"es2022",logLevel:"warning"});
  copyFileSync(join(BROWSER_ROOT,"pages/env.html"),join(out,"env.html"));
  const server = await startStaticServer(out); process.env["MTEK_SERVER_URL"] = server.url;
  return () => server.close();
}
