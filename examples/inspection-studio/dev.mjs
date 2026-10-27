import {execFileSync} from "node:child_process";
import {resolve,join,sep,extname} from "node:path";
import {readFile,stat} from "node:fs/promises";
import {createServer} from "node:http";
import {prepareInspectionStudio} from "./prepare.mjs";
const here = import.meta.dirname, repo = resolve(here,"../..");
execFileSync(process.execPath,["scripts/build.mjs"],{cwd:join(repo,"packages/runtime-web"),stdio:"inherit",windowsHide:true});
execFileSync("cargo",["build","-p","mtek-cli","--locked","-j","2"],{cwd:repo,stdio:"inherit",windowsHide:true});
await prepareInspectionStudio(join(repo,"target/debug",process.platform === "win32" ? "mtek.exe" : "mtek"));
const server = createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/","http://localhost").pathname), path = resolve(here,`.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(here+sep) || !(await stat(path)).isFile()) {response.writeHead(404); response.end(); return;}
    response.writeHead(200,{"content-type":({".html":"text/html",".js":"text/javascript",".json":"application/json",".wasm":"application/wasm"})[extname(path)] ?? "application/octet-stream","cache-control":"no-store"}); response.end(await readFile(path));
  } catch {response.writeHead(404); response.end();}
});
server.listen(5186,"127.0.0.1",() => process.stdout.write("Inspection studio: http://127.0.0.1:5186/\n"));
process.on("SIGINT",() => server.close());
