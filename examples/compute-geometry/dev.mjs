import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url)), repo = resolve(root, "../..");
execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: join(repo, "packages/runtime-web"), stdio: "inherit", windowsHide: true });
execFileSync("cargo", ["build", "--locked", "-p", "mtek-cli", "--jobs", "2"], { cwd: repo, stdio: "inherit", windowsHide: true });
const cli = join(repo, "target/debug", process.platform === "win32" ? "mtek.exe" : "mtek");
execFileSync(cli, ["build", "--out", join(root, ".out"), join(root, "scene")], { cwd: repo, stdio: "inherit", windowsHide: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wgsl": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(path)).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" }); response.end(await readFile(path));
  } catch { response.writeHead(404); response.end(); }
});
server.listen(5185, "127.0.0.1", () => process.stdout.write("Compute geometry: http://127.0.0.1:5185/\n"));
process.on("SIGINT", () => server.close());
