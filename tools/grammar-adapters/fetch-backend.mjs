// Download, verify and prepare the pinned grammar-constrained backend (decision 0073):
//
//   node tools/grammar-adapters/fetch-backend.mjs [--validator] [--backend] [--model] [--all]
//                                                [--cache-dir DIR] [--cmake PATH]
//
// Without a selection it prepares the validator and the backend binaries (not the 1.1 GB model).
//
// * --validator: the llama.cpp source at the pinned commit (SHA-256 checked), built with CMake
//   for the one target `test-gbnf-validator` (the release archives do not contain it). Needs CMake
//   and a C++ compiler (on Windows the Visual Studio Build Tools; CMake is found on PATH, in
//   $CMAKE, or the copy bundled with Visual Studio).
// * --backend: the pinned release archive for this platform (SHA-256 checked), extracted; it
//   contains the generator `llama-completion`.
// * --model: the pinned GGUF model (SHA-256 checked).
//
// Everything goes to tools/grammar-adapters/.cache/ (ignored by git) or --cache-dir /
// $MTEK_GRAMMAR_ADAPTER_DIR, and install.json there records what was prepared. A download whose
// hash differs from the pin is deleted and the script fails; nothing unverified is kept.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pins = JSON.parse(readFileSync(join(here, "pins.json"), "utf8"));

function usage(message) {
  console.error(`fetch-backend: ${message}`);
  console.error("usage: node tools/grammar-adapters/fetch-backend.mjs [--validator] [--backend] [--model] [--all] [--cache-dir DIR] [--cmake PATH]");
  process.exit(2);
}

const args = process.argv.slice(2);
const want = new Set();
let cacheDir = process.env.MTEK_GRAMMAR_ADAPTER_DIR || join(here, ".cache");
let cmakeArg = process.env.CMAKE || "";
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--validator" || arg === "--backend" || arg === "--model") want.add(arg.slice(2));
  else if (arg === "--all") ["validator", "backend", "model"].forEach((w) => want.add(w));
  else if (arg === "--cache-dir") cacheDir = args[++i] ?? usage("--cache-dir needs a directory");
  else if (arg === "--cmake") cmakeArg = args[++i] ?? usage("--cmake needs a path");
  else usage(`unknown argument ${arg}`);
}
if (want.size === 0) ["validator", "backend"].forEach((w) => want.add(w));
cacheDir = resolve(cacheDir);

const platform = `${process.platform}-${process.arch}`;
const releaseDir = join(cacheDir, `llama.cpp-${pins.release}`);
const installPath = join(cacheDir, "install.json");

function readInstall() {
  try {
    const install = JSON.parse(readFileSync(installPath, "utf8"));
    // A record of another pin is stale: start again.
    return install.release === pins.release && install.commit === pins.commit ? install : {};
  } catch {
    return {};
  }
}

function writeInstall(install) {
  writeFileSync(installPath, `${JSON.stringify({ ...install, release: pins.release, commit: pins.commit }, null, 2)}\n`);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Download `url` to `path` unless a file with the pinned hash is already there. */
async function download(url, path, sha256) {
  if (existsSync(path) && (await sha256File(path)) === sha256) {
    console.log(`verified (cached): ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  console.log(`downloading ${url}`);
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "mtek-grammar-adapters" } });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  const hash = createHash("sha256");
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(partial));
  const actual = hash.digest("hex");
  if (actual !== sha256) {
    rmSync(partial, { force: true });
    throw new Error(`SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}; the file was deleted`);
  }
  renameSync(partial, path);
  console.log(`verified: ${path} (sha256 ${actual})`);
}

/** Extract an archive with the system tar (on Windows the bsdtar of System32, which reads zip). */
function extract(archive, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const result = spawnSync(tar, ["-xf", archive, "-C", into], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`extracting ${archive} failed (${tar} exit ${result.status})`);
}

function findCmake() {
  const candidates = [];
  if (cmakeArg) candidates.push(cmakeArg);
  candidates.push("cmake");
  if (process.platform === "win32") {
    const vswhere = join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (existsSync(vswhere)) {
      const found = spawnSync(vswhere, ["-latest", "-products", "*", "-find", "Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe"], { encoding: "utf8" });
      for (const line of (found.stdout || "").split(/\r?\n/)) if (line.trim()) candidates.push(line.trim());
    }
  }
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("CMake not found: put cmake on PATH, set CMAKE, or pass --cmake PATH");
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) return path;
  }
  return null;
}

async function prepareValidator(install) {
  const archive = join(cacheDir, "downloads", `llama.cpp-${pins.commit}.tar.gz`);
  await download(pins.source.url, archive, pins.source.sha256);
  const src = join(releaseDir, "src");
  extract(archive, join(releaseDir, "src-extract"));
  rmSync(src, { recursive: true, force: true });
  renameSync(join(releaseDir, "src-extract", pins.source.topDirectory), src);
  rmSync(join(releaseDir, "src-extract"), { recursive: true, force: true });

  const cmake = findCmake();
  const build = join(releaseDir, "b");
  const configure = [
    "-S", src, "-B", build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DLLAMA_BUILD_TESTS=ON",
    "-DLLAMA_BUILD_COMMON=ON",
    "-DLLAMA_BUILD_TOOLS=OFF",
    "-DLLAMA_BUILD_EXAMPLES=OFF",
    "-DLLAMA_BUILD_SERVER=OFF",
    "-DLLAMA_BUILD_APP=OFF",
    "-DLLAMA_OPENSSL=OFF",
    "-DGGML_NATIVE=OFF",
    "-DLLAMA_BUILD_IS_DEV=OFF",
  ];
  if (process.platform === "win32") configure.push("-A", "x64");
  console.log(`configuring the validator build with ${cmake}`);
  let result = spawnSync(cmake, configure, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`cmake configure failed (exit ${result.status})`);
  result = spawnSync(cmake, ["--build", build, "--config", "Release", "--target", pins.source.validatorTarget, "-j", "8"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`cmake build failed (exit ${result.status})`);
  const exe = process.platform === "win32" ? `${pins.source.validatorTarget}.exe` : pins.source.validatorTarget;
  const built = findFile(join(build, "bin"), exe);
  if (!built) throw new Error(`the build did not produce ${exe}`);
  const target = join(releaseDir, "validator", exe);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(built, target);
  install.validator = {
    path: `llama.cpp-${pins.release}/validator/${exe}`,
    builtFrom: pins.source.url,
    sourceSha256: pins.source.sha256,
    // Informational: a local build is not bit-reproducible, so this is not a pin.
    sha256: await sha256File(target),
  };
  console.log(`validator: ${target}`);
}

async function prepareBackend(install) {
  const asset = pins.binaries[platform];
  if (!asset) throw new Error(`no pinned llama.cpp binaries for ${platform} (pinned: ${Object.keys(pins.binaries).join(", ")})`);
  const name = asset.url.split("/").pop();
  const archive = join(cacheDir, "downloads", name);
  await download(asset.url, archive, asset.sha256);
  const bin = join(releaseDir, "bin");
  extract(archive, bin);
  const generator = findFile(bin, asset.generator);
  if (!generator) throw new Error(`the release archive has no ${asset.generator}`);
  const relative = generator.slice(cacheDir.length + 1).split("\\").join("/");
  install.backend = { platform, archive: name, archiveSha256: asset.sha256, generator: relative };
  console.log(`generator: ${generator}`);
}

async function prepareModel(install) {
  const m = pins.model;
  const path = join(cacheDir, "models", m.file);
  await download(m.url, path, m.sha256);
  if (statSync(path).size !== m.size) throw new Error(`${path} has ${statSync(path).size} bytes, the pin says ${m.size}`);
  install.model = { id: m.id, revision: m.revision, path: `models/${m.file}`, sha256: m.sha256, size: m.size };
}

mkdirSync(cacheDir, { recursive: true });
const install = readInstall();
try {
  if (want.has("validator")) await prepareValidator(install);
  if (want.has("backend")) await prepareBackend(install);
  if (want.has("model")) await prepareModel(install);
} finally {
  writeInstall(install);
}
console.log(`recorded ${installPath}`);
