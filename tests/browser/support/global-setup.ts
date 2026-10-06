// Global setup: prepares `.out/` (the served root), starts the static server and creates the
// results directory. It builds the environment probe page, generates the bridge spike artifacts
// (shaders, writers and layout records of every layout fixture, `.out/bridge/`) with the
// compiler's `bridge_spike` example, bundles the bridge page and prepares the mount fixture. It builds
// the CLI (`cargo build -p mtek-cli --locked`) and every M1 fixture (`fixtures/m1/*`) with
// `mtek build --mode test` into `.out/m1/`, plus the post-build failure variants (support/m1-fixtures.ts),
// likewise the M2 fixtures (`fixtures/m2/*` into `.out/m2/`, support/m2-fixtures.ts),
// and the numeric probe (`.out/numeric/`, support/numeric-probe.ts) with its page.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { BROWSER_ROOT, REPO_ROOT } from "./environment.ts";
import { buildCli, buildM1Fixtures } from "./m1-fixtures.ts";
import { buildM2Fixtures } from "./m2-fixtures.ts";
import { buildPulseCube } from "./m3-fixtures.ts";
import { buildNumericProbe } from "./numeric-probe.ts";
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
  // The program module (M1-18): the compiler's golden app.js of codegen fixture A, whose generated
  // writers and init fit the minimal manifest's layouts and its one box entity. It re-exports mountMtek
  // from its hashed runtime file name, so the bundle is copied under that name too.
  const appJs = readFileSync(join(REPO_ROOT, "tests", "codegen", "scene_a_target_camera_box", "expected", "app.js"), "utf8");
  const runtimeName = /^export \{ mountMtek \} from "\.\/(runtime\.[0-9a-f]{16}\.js)";$/m.exec(appJs)?.[1];
  if (runtimeName === undefined) throw new Error("the golden app.js has no runtime re-export line");
  writeFileSync(join(mountOut, "fixture", "app.js"), appJs.replace(/^\/\/# sourceMappingURL=.*$/m, ""));
  if (existsSync(join(bundleDir, "runtime.js"))) copyFileSync(join(bundleDir, "runtime.js"), join(mountOut, "fixture", runtimeName));
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

  // M1 fixtures (M1-21). The CLI embeds the runtime bundle only when it existed at CLI build time
  // (decision 0032 item 10); without it every `mtek build` fails with E9030 and so does this setup.
  const cli = buildCli();
  process.env["MTEK_CLI"] = cli;
  buildM1Fixtures(cli);
  // M2 fixtures (M2-12): the Pulse material, the mixed layout and the shader-corruption variants, in `.out/m2/`.
  buildM2Fixtures(cli);
  buildPulseCube(cli);

  // The numeric probe (M2-08): the compiler's WGSL for every operation of cpu.json plus a test-only harness.
  buildNumericProbe(cli, join(out, "numeric"));
  await buildPage(out, join("pages", "numeric.ts"), "numeric.html", "numeric");

  const server = await startStaticServer(out);
  // Workers are started after global setup and inherit this variable.
  process.env["MTEK_SERVER_URL"] = server.url;
  return async () => {
    await server.close();
  };
}
