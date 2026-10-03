// Global setup: prepares `.out/` (the served root), starts the static server and creates the
// results directory. Mtek fixtures are built into `.out/` by later tasks (M0-08); the environment
// probe page is built here.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT } from "./environment.ts";
import { startStaticServer } from "./serve.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const out = join(BROWSER_ROOT, ".out");
  mkdirSync(out, { recursive: true });
  const resultsDir = process.env["MTEK_RESULTS_DIR"];
  if (resultsDir === undefined) throw new Error("MTEK_RESULTS_DIR is not set (playwright.config.ts sets it)");
  mkdirSync(resultsDir, { recursive: true });

  await build({
    entryPoints: [join(BROWSER_ROOT, "support", "env-probe.ts")],
    outfile: join(out, "env-probe.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: true,
    logLevel: "warning",
  });
  copyFileSync(join(BROWSER_ROOT, "pages", "env.html"), join(out, "env.html"));

  const server = await startStaticServer(out);
  // Workers are started after global setup and inherit this variable.
  process.env["MTEK_SERVER_URL"] = server.url;
  return async () => {
    await server.close();
  };
}
