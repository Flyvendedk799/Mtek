import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const here = import.meta.dirname, repo = resolve(here, "../..");
export function buildExample() {
  execFileSync(join(repo, "target/debug", process.platform === "win32" ? "mtek.exe" : "mtek"),
    ["build", "--mode", "test", "--out", join(here, ".out"), join(here, "scene")], { cwd: repo, stdio: "inherit", windowsHide: true });
}
export async function serveExample(port = 5187) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/probe.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<canvas width="97" height="97"></canvas><script type="module">import program,{mountMtek} from "./.out/app.js";window.vertexProbe={program,mountMtek};</script>');
      return;
    }
    const path = resolve(here, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
    if (!path.startsWith(here + sep)) { response.writeHead(404); response.end(); return; }
    try {
      const bytes = await readFile(path);
      response.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".json": "application/json" })[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && resolve(process.argv[1]) === join(here, "serve.mjs")) {
  buildExample();
  const server = await serveExample();
  console.log(`Authored vertex example: ${server.url}`);
  process.on("SIGINT", () => { void server.close(); });
}
