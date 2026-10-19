// Builds everything a benchmark run serves into `.out/site/`:
//   mtek/<workload>/            the built Mtek program (`mtek build`; release flavour, the development flavour for the
//                               reload workload, whose `replaceProgram` exists only there) and `mtek/<workload>-edited/`
//   assets/<workload>/          the generated GLB and PNG files the direct and three.js implementations load
//   pages/<workload>/<impl>.js  the measurement page bundled with one implementation (minified), and its HTML
//   env-probe.js, env.html      the environment probe of the browser test harness
//   sizes.json                  bundle sizes (raw and gzip) of every workload and implementation
//   prepared.json               what was built, with versions
//
//   node tools/prepare.ts [--skip-cli-build] [--only=<workload,...>]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { build, transform } from "esbuild";
import { buildCli, runCli } from "../../../tests/browser/support/m1-fixtures.ts";
import type { AssetHeavyDefinition } from "../common/layout.ts";
import { mtekProject, readWorkload } from "./gen-mtek.ts";
import { assetHashes, writeAssets } from "./assets.ts";
import { REPO_ROOT, RUNTIME_ROOT, SITE_DIR, WORKLOADS, WORK_DIR, type WorkloadName } from "./paths.ts";

export interface FileSize {
  readonly path: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

export interface SizeGroup {
  readonly files: readonly FileSize[];
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

export interface BundleSizes {
  readonly workload: string;
  readonly implementation: "mtek" | "direct" | "three";
  /** The JavaScript that runs on the page, as shipped (Mtek: unminified, v0.1) or as bundled unminified (direct, three.js). */
  readonly javascript: SizeGroup;
  /** The same JavaScript after esbuild's minifier (an upper bound on what a production build would send). */
  readonly javascriptMinified: SizeGroup;
  /** Mtek only: the program data the page fetches (manifest, shader files, packaged assets). */
  readonly programData: SizeGroup | null;
  /** Mtek only: JavaScript loaded lazily (the physics module); included in the totals above. */
  readonly lazy: readonly string[];
}

function gzipLevel9(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: 9 }).length;
}

function group(files: ReadonlyArray<{ path: string; bytes: Uint8Array }>): SizeGroup {
  const sized = files.map((f) => ({ path: f.path, rawBytes: f.bytes.length, gzipBytes: gzipLevel9(f.bytes) }));
  return {
    files: sized,
    rawBytes: sized.reduce((sum, f) => sum + f.rawBytes, 0),
    gzipBytes: sized.reduce((sum, f) => sum + f.gzipBytes, 0),
  };
}

function walk(dir: string, base: string = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

async function mtekSizes(workload: WorkloadName): Promise<BundleSizes> {
  const dir = join(SITE_DIR, "mtek", workload);
  const all = walk(dir);
  const javascript = all.filter((p) => p.endsWith(".js"));
  const data = all.filter((p) => !p.endsWith(".js") && !p.endsWith(".map") && !p.endsWith(".html") && !p.endsWith(".d.ts") && !p.endsWith(".mtek-map.json"));
  const bytesOf = (p: string): Uint8Array => readFileSync(join(dir, p));
  const minified = await Promise.all(
    javascript.map(async (p) => ({ path: p, bytes: Buffer.from((await transform(readFileSync(join(dir, p), "utf8"), { minify: true, loader: "js", target: "es2022", legalComments: "none" })).code) })),
  );
  return {
    workload,
    implementation: "mtek",
    javascript: group(javascript.map((p) => ({ path: p, bytes: bytesOf(p) }))),
    javascriptMinified: group(minified),
    programData: group(data.map((p) => ({ path: p, bytes: bytesOf(p) }))),
    lazy: javascript.filter((p) => p.startsWith("physics/")),
  };
}

async function bundledSizes(workload: WorkloadName, implementation: "direct" | "three"): Promise<BundleSizes> {
  const entry = join(RUNTIME_ROOT, workload, implementation, "main.ts");
  const output = async (minify: boolean): Promise<SizeGroup> => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2022",
      platform: "browser",
      minify,
      legalComments: "none",
      logLevel: "silent",
    });
    return group(result.outputFiles.map((f) => ({ path: `${workload}/${implementation}/main.js`, bytes: f.contents })));
  };
  return {
    workload,
    implementation,
    javascript: await output(false),
    javascriptMinified: await output(true),
    programData: null,
    lazy: [],
  };
}

async function bundlePage(workload: string, implementation: string, entry: string): Promise<void> {
  const outDir = join(SITE_DIR, "pages", workload);
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [join(RUNTIME_ROOT, "harness", "page.ts")],
    outfile: join(outDir, `${implementation}.js`),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: true,
    legalComments: "none",
    logLevel: "warning",
    alias: { "@implementation": entry },
  });
  writeFileSync(
    join(outDir, `${implementation}.html`),
    `<!doctype html><meta charset="utf-8"><title>runtime benchmark: ${workload} ${implementation}</title><script type="module" src="./${implementation}.js"></script>\n`,
  );
}

/** The runtime bundles and the physics bundle, which the mtek command line tool embeds when it is built. */
function buildRuntimeBundles(): void {
  const dir = join(REPO_ROOT, "packages", "runtime-web");
  execFileSync(process.execPath, [join(REPO_ROOT, "scripts", "gen-manifest-validator.mjs")], { cwd: dir, stdio: "inherit" });
  execFileSync(process.execPath, [join(dir, "scripts", "build.mjs")], { cwd: dir, stdio: "inherit" });
  const physics = join(REPO_ROOT, "packages", "physics-rapier");
  execFileSync(process.execPath, [join(physics, "scripts", "build.mjs")], { cwd: physics, stdio: "inherit" });
}

function mtekBuild(cli: string, workload: string, projectDir: string, mode: "release" | "dev"): void {
  const out = join(SITE_DIR, "mtek", workload);
  rmSync(out, { recursive: true, force: true });
  const run = runCli(cli, ["build", "--mode", mode, "--format", "json", "--out", out, projectDir]);
  if (run.status !== 0 || !existsSync(join(out, "app.js"))) {
    throw new Error(`mtek build --mode ${mode} of ${workload} failed (exit ${String(run.status)}):\n${run.stdout.slice(0, 4000)}${run.stderr.slice(0, 4000)}`);
  }
}

export interface PreparedSite {
  readonly builtAt: string;
  readonly workloads: readonly string[];
  readonly mtekVersion: string;
  readonly threeVersion: string;
  readonly rapierVersion: string;
  readonly runtimeVersion: string;
}

function packageVersion(path: string): string {
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

export async function prepareSite(options: { skipCliBuild?: boolean; only?: readonly WorkloadName[] } = {}): Promise<PreparedSite> {
  const only = options.only ?? WORKLOADS;
  mkdirSync(SITE_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });

  buildRuntimeBundles();
  const cli = options.skipCliBuild === true ? (process.env["MTEK_CLI"] ?? "") : buildCli();
  if (cli === "") throw new Error("--skip-cli-build needs MTEK_CLI to name the mtek executable");

  // The environment probe of the browser test harness.
  await build({
    entryPoints: [join(REPO_ROOT, "tests", "browser", "support", "env-probe.ts")],
    outfile: join(SITE_DIR, "env-probe.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    logLevel: "warning",
  });
  copyFileSync(join(REPO_ROOT, "tests", "browser", "pages", "env.html"), join(SITE_DIR, "env.html"));

  const sizes: BundleSizes[] = [];
  for (const workload of only) {
    // Generated sources must be what the generator prints (the frozen definition).
    for (const [path, text] of mtekProject(workload)) {
      const target = join(RUNTIME_ROOT, workload, "mtek", path);
      const current = existsSync(target) ? readFileSync(target, "utf8") : null;
      if (current !== text) throw new Error(`${workload}/mtek/${path} is not what tools/gen-mtek.ts prints; run \`node tools/gen-mtek.ts\``);
    }
    const definition = readWorkload(workload);
    if (workload === "asset-heavy-startup") {
      const def = definition.definition as unknown as AssetHeavyDefinition;
      writeAssets(def, join(RUNTIME_ROOT, workload, "mtek"), "project");
      rmSync(join(SITE_DIR, "assets", workload), { recursive: true, force: true });
      writeAssets(def, join(SITE_DIR, "assets", workload), "flat");
      writeFileSync(join(SITE_DIR, "assets", workload, "hashes.json"), `${JSON.stringify(assetHashes(def), null, 2)}\n`);
    }
    const projectDir = join(RUNTIME_ROOT, workload, "mtek");
    mtekBuild(cli, workload, projectDir, workload === "mount-reload-dispose" ? "dev" : "release");
    if (workload === "mount-reload-dispose") {
      const edited = join(WORK_DIR, `${workload}-edited`);
      rmSync(edited, { recursive: true, force: true });
      for (const [path, text] of mtekProject(workload, "edited")) {
        const target = join(edited, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
      }
      mtekBuild(cli, `${workload}-edited`, edited, "dev");
    }
    await bundlePage(workload, "mtek", join(RUNTIME_ROOT, "harness", "mtek-adapter.ts"));
    await bundlePage(workload, "direct", join(RUNTIME_ROOT, workload, "direct", "main.ts"));
    await bundlePage(workload, "three", join(RUNTIME_ROOT, workload, "three", "main.ts"));
    sizes.push(await mtekSizes(workload), await bundledSizes(workload, "direct"), await bundledSizes(workload, "three"));
  }
  await bundlePage("floor", "floor", join(RUNTIME_ROOT, "harness", "floor.ts"));
  writeFileSync(join(SITE_DIR, "sizes.json"), `${JSON.stringify(sizes, null, 2)}\n`);

  const prepared: PreparedSite = {
    builtAt: new Date().toISOString(),
    workloads: only,
    mtekVersion: execFileSync(cli, ["--version"], { encoding: "utf8" }).trim(),
    threeVersion: packageVersion(join(REPO_ROOT, "node_modules", "three", "package.json")),
    rapierVersion: packageVersion(join(REPO_ROOT, "node_modules", "@dimforge", "rapier3d-compat", "package.json")),
    runtimeVersion: packageVersion(join(REPO_ROOT, "packages", "runtime-web", "package.json")),
  };
  writeFileSync(join(SITE_DIR, "prepared.json"), `${JSON.stringify(prepared, null, 2)}\n`);
  return prepared;
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg === undefined ? undefined : (onlyArg.slice("--only=".length).split(",") as WorkloadName[]);
  const prepared = await prepareSite({ skipCliBuild: args.includes("--skip-cli-build"), ...(only === undefined ? {} : { only }) });
  process.stdout.write(`prepared ${prepared.workloads.join(", ")} with ${prepared.mtekVersion}\n`);
}
