import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { buildCli } from "./m1-fixtures.ts";
import { buildM4Fixtures, M4_FIXTURES_DIR, M4_OUT_DIR } from "./m4-fixtures.ts";
import { startStaticServer } from "./serve.ts";

function hashes(directory: string, prefix = ""): { path: string; bytes: number; sha256: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) return hashes(path, name + "/");
    const bytes = readFileSync(path); return [{ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  });
}
export default async function setup(): Promise<() => Promise<void>> {
  const cli = process.env["MTEK_BIN"] ?? buildCli(), out = join(BROWSER_ROOT, ".out"), results = process.env["MTEK_RESULTS_DIR"];
  if (results === undefined) throw new Error("MTEK_RESULTS_DIR is missing"); mkdirSync(results, { recursive: true });
  buildM4Fixtures(cli);
  const fixtures = readdirSync(M4_FIXTURES_DIR).filter(name => name.startsWith("pbr_tangent_")).map(name => ({ name, source: hashes(join(M4_FIXTURES_DIR, name)), package: hashes(join(M4_OUT_DIR, name)) }));
  writeFileSync(join(results, "tangent-package.json"), JSON.stringify({ format: "mtek-tangent-material-package/1", cli: relative(REPO_ROOT, cli).replaceAll("\\", "/"), cliSha256: createHash("sha256").update(readFileSync(cli)).digest("hex"), fixtures }, null, 2) + "\n");
  await build({ entryPoints: [join(BROWSER_ROOT, "support/env-probe.ts")], outfile: join(out, "env-probe.js"), bundle: true, format: "esm", target: "es2022", logLevel: "warning" });
  copyFileSync(join(BROWSER_ROOT, "pages/env.html"), join(out, "env.html"));
  const server = await startStaticServer(out); process.env["MTEK_SERVER_URL"] = server.url; return () => server.close();
}
