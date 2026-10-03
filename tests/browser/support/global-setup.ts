// Global setup: prepares `.out/` (the served root), starts the static server and creates the
// results directory. Mtek fixtures are built into `.out/` by later tasks (M0-08); the environment
// probe page is built here.
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { startStaticServer } from "./serve.ts";

/**
 * The mount fixture (M1-14): the runtime bundle built by `npm run build -w @mtek/runtime-web`, a program
 * manifest (the shared minimal valid example) and its startup shader. The bundle is copied when it exists;
 * `specs/mount.spec.ts` fails with the build command when it does not.
 */
function prepareMountFixture(out: string): void {
  const mountOut = join(out, "mount");
  mkdirSync(join(mountOut, "fixture"), { recursive: true });
  const bundleDir = join(REPO_ROOT, "packages", "runtime-web", "dist");
  for (const file of ["runtime.js", "runtime.js.map"]) {
    if (existsSync(join(bundleDir, file))) copyFileSync(join(bundleDir, file), join(mountOut, file));
  }
  copyFileSync(join(BROWSER_ROOT, "pages", "mount.html"), join(out, "mount.html"));
  copyFileSync(
    join(REPO_ROOT, "tests", "abi", "manifests", "valid", "minimal.json"),
    join(mountOut, "fixture", "program.manifest.json"),
  );
  cpSync(join(BROWSER_ROOT, "pages", "mount", "shaders"), join(mountOut, "fixture", "shaders"), { recursive: true });
}

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

  prepareMountFixture(out);

  const server = await startStaticServer(out);
  // Workers are started after global setup and inherit this variable.
  process.env["MTEK_SERVER_URL"] = server.url;
  return async () => {
    await server.close();
  };
}
