// Global setup: prepares `.out/` (the served root), starts the static server and creates the
// results directory. It builds the environment probe page, generates the bridge spike artifacts
// (shaders, writers and layout records of every layout fixture, `.out/bridge/`) with the
// compiler's `bridge_spike` example, bundles the bridge page and prepares the mount fixture.
// Mtek fixtures are built into `.out/` by later tasks.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { startStaticServer } from "./serve.ts";

/** Bundles one page script into `.out/<name>.js` and copies its HTML next to it. */
async function buildPage(out: string, script: string, html: string, name: string): Promise<void> {
  await build({
    entryPoints: [join(BROWSER_ROOT, script)],
    outfile: join(out, `${name}.js`),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    sourcemap: true,
    logLevel: "warning",
  });
  copyFileSync(join(BROWSER_ROOT, "pages", html), join(out, html));
}

/** Runs the `bridge_spike` generator into `.out/bridge/`, rebuilt from scratch; a failure fails the run. */
function generateBridgeArtifacts(out: string): void {
  const bridgeDir = join(out, "bridge");
  rmSync(bridgeDir, { recursive: true, force: true });
  execFileSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "mtek-compiler", "--example", "bridge_spike", "--", bridgeDir],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
}

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

  await buildPage(out, join("support", "env-probe.ts"), "env.html", "env-probe");
  generateBridgeArtifacts(out);
  await buildPage(out, join("pages", "bridge.ts"), "bridge.html", "bridge");

  prepareMountFixture(out);

  const server = await startStaticServer(out);
  // Workers are started after global setup and inherit this variable.
  process.env["MTEK_SERVER_URL"] = server.url;
  return async () => {
    await server.close();
  };
}
