import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve, extname, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url)), repo = resolve(root, "../..");
execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: join(repo, "packages/runtime-web"), stdio: "inherit" });
execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: join(repo, "packages/inspector"), stdio: "inherit" });
execFileSync("cargo", ["build", "--locked", "-p", "mtek-cli", "--jobs", "2"], { cwd: repo, stdio: "inherit" });
const cli = join(repo, "target", "debug", process.platform === "win32" ? "mtek.exe" : "mtek");
execFileSync(cli, ["build", "--out", join(root, ".out"), join(root, "scene")], { cwd: repo, stdio: "inherit" });
const runtimes = readdirSync(join(root, ".out")).filter(name => /^runtime\.[a-f0-9]{16}\.js$/.test(name));
if (runtimes.length !== 1) throw new Error("Expected one compiled runtime bundle");
writeFileSync(join(root, ".out/lighting-api.js"), `export {decodeRadiance} from "./${runtimes[0]}";\n`);
await bundle({entryPoints:[join(repo,"packages/inspector/dist/index.js")],outfile:join(root,".out/inspector.js"),bundle:true,format:"esm",platform:"browser",target:"es2022"});
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wgsl": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(path)).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }); response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
server.listen(5184, "127.0.0.1", () => process.stdout.write("Lighting studio: http://127.0.0.1:5184/\n"));
process.on("SIGINT", () => server.close());
