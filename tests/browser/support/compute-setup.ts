import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT } from "./environment.ts";
import { buildComputeAcceptance } from "./compute-fixtures.ts";
import { startStaticServer } from "./serve.ts";

/** Focused setup: no CLI rebuild and no unrelated example/benchmark preparation. */
export default async function setup(): Promise<() => Promise<void>> {
  const out = join(BROWSER_ROOT, ".out"); mkdirSync(out, { recursive: true });
  const results = process.env["MTEK_RESULTS_DIR"]; if (results === undefined) throw new Error("MTEK_RESULTS_DIR is missing");
  mkdirSync(results, { recursive: true });
  const provenance = await buildComputeAcceptance();
  writeFileSync(join(results, "compute-package.json"), JSON.stringify(provenance, null, 2) + "\n");
  await build({ entryPoints: [join(BROWSER_ROOT, "support/env-probe.ts")], outfile: join(out, "env-probe.js"), bundle: true, format: "esm", target: "es2022", logLevel: "warning" });
  copyFileSync(join(BROWSER_ROOT, "pages/env.html"), join(out, "env.html"));
  const server = await startStaticServer(out); process.env["MTEK_SERVER_URL"] = server.url;
  return () => server.close();
}
