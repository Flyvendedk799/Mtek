// What the built compiler says about itself: `mtek --version`, `mtek --help`, `mtek context` and the
// manifest of a real build. Nothing here is read from a document.
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSupported } from "../../coverage-matrix/src/registry.ts";
import { isObject, parseJson, str, type Json } from "../../coverage-matrix/src/json.ts";
import { run, type Runner } from "../../coverage-matrix/src/tools.ts";

export interface CompilerFacts {
  /** `mtek 0.1.0-dev (language 0.1, runtime ABI 1)`. */
  versionLine: string;
  versionLanguage: string | undefined;
  versionAbi: string | undefined;
  versionCompiler: string | undefined;
  /** The commands of `mtek --help`. */
  subcommands: string[];
  /** `supported.features` and `supported.notSupported` of `mtek context`. */
  features: string[];
  notSupported: string[];
  contextLanguage: string;
  /** The manifest of a real build of an example. */
  manifest: ManifestFacts;
}

export interface ManifestFacts {
  project: string;
  manifestSchema: Json | undefined;
  runtimeAbi: Json | undefined;
  languageVersion: Json | undefined;
  compilerVersion: Json | undefined;
  targetProfile: Json | undefined;
  requiredCapabilities: string;
  /** `export const abi = N;` of the generated `app.js`. */
  appAbi: string | undefined;
  /** The host input codecs of every example's manifest. */
  codecs: string[];
}

/** The commands listed in `mtek --help`. */
export function parseSubcommands(help: string): string[] {
  const lines = help.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    const m = /^ {2}([a-z]+)\s/.exec(line);
    if (m !== null) names.push(m[1] ?? "");
  }
  return names;
}

export async function readCompilerFacts(root: string, mtek: string, runner: Runner = run): Promise<CompilerFacts> {
  const version = await runner(mtek, ["--version"], { cwd: root });
  const versionLine = version.stdout.trim();
  const m = /^mtek (\S+) \(language (\S+), runtime ABI (\S+)\)$/.exec(versionLine);
  const help = await runner(mtek, ["--help"], { cwd: root });
  const supported = await readSupported(root, mtek, runner);
  const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "examples", entry.name, "mtek.toml")))
    .map((entry) => entry.name)
    .sort();
  const manifest = await readManifestFacts(root, mtek, examples, runner);
  return {
    versionLine,
    versionLanguage: m?.[2],
    versionAbi: m?.[3],
    versionCompiler: m?.[1],
    subcommands: parseSubcommands(help.stdout),
    features: supported.features,
    notSupported: supported.notSupported,
    contextLanguage: supported.languageVersion,
    manifest,
  };
}

async function readManifestFacts(root: string, mtek: string, examples: readonly string[], runner: Runner): Promise<ManifestFacts> {
  const codecs = new Set<string>();
  let first: ManifestFacts | undefined;
  for (const name of examples) {
    const out = mkdtempSync(join(tmpdir(), "release-docs-build-"));
    try {
      const built = await runner(mtek, ["build", "--out", out, join(root, "examples", name)], { cwd: root });
      if (built.code !== 0) throw new Error(`mtek build examples/${name} failed: ${built.stderr.trim()}`);
      const manifest = parseJson(readFileSync(join(out, "program.manifest.json"), "utf8"), `the manifest of examples/${name}`);
      if (!isObject(manifest)) throw new Error(`the manifest of examples/${name} is not an object`);
      const scene = manifest["scene"];
      const inputs = isObject(scene) && Array.isArray(scene["hostInputs"]) ? scene["hostInputs"] : [];
      for (const input of inputs) {
        const codec = str(input, "codec");
        if (codec !== undefined) codecs.add(codec);
      }
      first ??= {
        project: `examples/${name}`,
        manifestSchema: manifest["manifestSchema"],
        runtimeAbi: manifest["runtimeAbi"],
        languageVersion: manifest["languageVersion"],
        compilerVersion: manifest["compilerVersion"],
        targetProfile: manifest["targetProfile"],
        requiredCapabilities: JSON.stringify(manifest["requiredCapabilities"]),
        appAbi: /export const abi = (\d+);/.exec(readFileSync(join(out, "app.js"), "utf8"))?.[1],
        codecs: [],
      };
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  if (first === undefined) throw new Error("no example to build");
  return { ...first, codecs: [...codecs].sort() };
}
