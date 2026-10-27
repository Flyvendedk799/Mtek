import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT } from "./environment.ts";
import { startStaticServer } from "./serve.ts";

/** Probe pages bundle current runtime modules directly; no CLI or unrelated fixture build. */
export default async function setup(): Promise<() => Promise<void>> {
  const out = join(BROWSER_ROOT, ".out"); mkdirSync(out, { recursive: true });
  const results = process.env["MTEK_RESULTS_DIR"]; if (results === undefined) throw new Error("MTEK_RESULTS_DIR is missing");
  mkdirSync(results, { recursive: true });
  await build({ entryPoints: [join(BROWSER_ROOT, "support/env-probe.ts")], outfile: join(out, "env-probe.js"), bundle: true, format: "esm", target: "es2022", logLevel: "warning" });
  copyFileSync(join(BROWSER_ROOT, "pages/env.html"), join(out, "env.html"));
  const server = await startStaticServer(out); process.env["MTEK_SERVER_URL"] = server.url;
  return () => server.close();
}
