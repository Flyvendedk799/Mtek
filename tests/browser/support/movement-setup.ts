// Global setup of `movement.config.ts`: only what the character movement acceptance needs (the environment probe,
// the CLI and `examples/character-movement`), so the spec can run without building every other fixture.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT } from "./environment.ts";
import { buildCli } from "./m1-fixtures.ts";
import { buildMovementExample } from "./movement-example.ts";
import { startStaticServer } from "./serve.ts";

export default async function setup(): Promise<() => Promise<void>> {
  const out = join(BROWSER_ROOT, ".out");
  const results = process.env["MTEK_RESULTS_DIR"];
  if (results === undefined) throw new Error("MTEK_RESULTS_DIR is not set (playwright.config.ts sets it)");
  mkdirSync(out, { recursive: true });
  mkdirSync(results, { recursive: true });
  buildMovementExample(process.env["MTEK_BIN"] ?? buildCli());
  await build({ entryPoints: [join(BROWSER_ROOT, "support", "env-probe.ts")], outfile: join(out, "env-probe.js"), bundle: true, format: "esm", target: "es2022", platform: "browser", sourcemap: true, logLevel: "warning" });
  copyFileSync(join(BROWSER_ROOT, "pages", "env.html"), join(out, "env.html"));
  const server = await startStaticServer(out);
  process.env["MTEK_SERVER_URL"] = server.url;
  return () => server.close();
}
