// Reproducible builds and clean-install verification (M7-07, decision 0106).
//
//   node scripts/verify-reproducible-build.mjs [--root DIR] [--out FILE] [--suite] [--gpu-lock DIR]
//                                              [--skip-benchmark-workloads] [--reuse]
//
// 1. Makes two fresh `git clone`s of this repository at its current HEAD commit, into two different
//    directories (`<root>/a` and `<root>/b-longer-path`: different names and different lengths, so
//    that a path that leaks into an output shows up as a difference).
// 2. In each clone, from nothing: `npm ci`, `npm run build`, then every project of `examples/`
//    built with the freshly built `mtek` in all four modes (the release build into the project's own
//    `dist/`, the others into `.repro-out/`), then the runtime benchmark's own preparation step
//    (`benchmarks/runtime/tools/prepare.ts`), which builds the seven generated benchmark programs,
//    their generated assets and the measurement pages into `benchmarks/runtime/.out/site/`.
// 3. Lists every file of the output trees of both clones (path relative to the clone, size, SHA-256)
//    and compares them byte for byte; scans every output file for the clone paths, the shared root
//    and the home directory, which must not occur in any output.
// 4. Writes a machine-readable report (`--out`, default `<root>/reproducible-builds.json`) in which
//    no absolute path occurs (`<clone-a>`, `<clone-b>`, `<root>`, `<source-repo>`, `<home>` stand for them).
// 5. With `--suite`: runs the full test suite from clone A (the clean install of step 2).
//
// What it proves: two clones of one commit, on this machine and this operating system, with this
// toolchain, produce byte-identical outputs. It says nothing about other machines or operating
// systems (the Rust binary in `target/` is compared too, but only as information: see
// `EXECUTABLES`).
//
// `--reuse` compares clones that an earlier run left in place (no cloning, building or removal).
//
// Needs `git`, `node` 24, `npm` and `cargo` on PATH and network access for `npm ci`. Nothing is
// written to this repository. Exit code 0 when the compared trees are identical and no path leaks,
// 1 when not, 2 for a usage error or a step that failed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

/** The output trees compared byte for byte, relative to a clone. Missing ones are reported, not skipped. */
const TREES = [
  "packages/runtime-web/dist",
  "packages/physics-rapier/dist",
  "packages/editor-vscode/dist",
  ".repro-out",
];
const BENCHMARK_TREES = [
  "benchmarks/runtime/.out/site",
  "benchmarks/runtime/asset-heavy-startup/mtek/models",
  "benchmarks/runtime/asset-heavy-startup/mtek/textures",
];
/** Built executables: compared and reported, never decisive (a Rust debug build on Windows is not a distribution artefact). */
const EXECUTABLES = [`target/debug/${WINDOWS ? "mtek.exe" : "mtek"}`];
const MODES = ["release", "dev", "test", "preview"];

/** Files that carry a build timestamp by design: compared after removing that one field. */
const NORMALISED = new Map([["benchmarks/runtime/.out/site/prepared.json", "builtAt"]]);

// ---------------------------------------------------------------------------------------------
// arguments

const args = process.argv.slice(2);
function usage(message) {
  process.stderr.write(`verify-reproducible-build: ${message}\n`);
  process.stderr.write(
    "usage: node scripts/verify-reproducible-build.mjs [--root DIR] [--out FILE] [--suite] [--gpu-lock DIR] [--skip-benchmark-workloads] [--reuse]\n",
  );
  process.exit(2);
}
let root = join(homedir(), "mtek-repro");
let outFile = null;
let runSuite = false;
let gpuLock = null;
let withBenchmarks = true;
let reuse = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--root") root = resolve(args[++i] ?? usage("--root needs a directory"));
  else if (arg === "--out") outFile = resolve(args[++i] ?? usage("--out needs a file"));
  else if (arg === "--suite") runSuite = true;
  else if (arg === "--gpu-lock") gpuLock = resolve(args[++i] ?? usage("--gpu-lock needs a directory"));
  else if (arg === "--skip-benchmark-workloads") withBenchmarks = false;
  else if (arg === "--reuse") reuse = true;
  else usage(`unknown argument ${arg}`);
}
root = resolve(root);
outFile ??= join(root, "reproducible-builds.json");
const logs = join(root, "logs");
const cloneDirs = { a: join(root, "a"), b: join(root, "b-longer-path") };

// ---------------------------------------------------------------------------------------------
// running commands

/** Quotes one argument for a shell line (only used on Windows, where npm and cargo shims need a shell). */
function quote(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Runs a command, appending stdout and stderr to a log file. Resolves with the exit code (never throws on a
 * non-zero exit). Output is not echoed: the logs are the record.
 */
function run(label, command, commandArgs, options = {}) {
  const log = join(logs, `${label}.log`);
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `$ ${[command, ...commandArgs].join(" ")}\n# cwd: ${options.cwd ?? process.cwd()}\n`);
  const started = Date.now();
  process.stdout.write(`[${new Date().toISOString()}] ${label} ...\n`);
  return new Promise((resolvePromise) => {
    const child = WINDOWS
      ? spawn([command, ...commandArgs].map(quote).join(" "), { cwd: options.cwd, env: { ...process.env, ...options.env }, shell: true, windowsHide: true })
      : spawn(command, commandArgs, { cwd: options.cwd, env: { ...process.env, ...options.env } });
    const append = (chunk) => writeFileSync(log, chunk, { flag: "a" });
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(`spawn error: ${error.message}\n`);
      resolvePromise({ label, code: 127, seconds: (Date.now() - started) / 1000, log });
    });
    child.on("close", (code) => {
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      process.stdout.write(`[${new Date().toISOString()}] ${label}: exit ${String(code)} (${String(seconds)} s)\n`);
      resolvePromise({ label, code: code ?? 1, seconds, log });
    });
  });
}

function capture(command, commandArgs, cwd) {
  return new Promise((resolvePromise) => {
    const child = WINDOWS
      ? spawn([command, ...commandArgs].map(quote).join(" "), { cwd, shell: true, windowsHide: true })
      : spawn(command, commandArgs, { cwd });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, text: text.trim() }));
    child.on("error", () => resolvePromise({ code: 127, text: "" }));
  });
}

// ---------------------------------------------------------------------------------------------
// trees

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** path (POSIX, relative to the clone) -> { size, sha256 } for every file of the given trees. */
function listTrees(clone, trees) {
  const files = new Map();
  const missing = [];
  for (const tree of trees) {
    const dir = join(clone, tree);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      missing.push(tree);
      continue;
    }
    for (const full of walk(dir)) {
      const path = relative(clone, full).replace(/\\/g, "/");
      let bytes = readFileSync(full);
      const dropped = NORMALISED.get(path);
      let normalisedField = null;
      if (dropped !== undefined) {
        const parsed = JSON.parse(bytes.toString("utf8"));
        delete parsed[dropped];
        bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
        normalisedField = dropped;
      }
      files.set(path, { size: bytes.length, sha256: sha256(bytes), bytes, full, normalisedField });
    }
  }
  return { files, missing };
}

function pathForms(dir) {
  const slash = dir.replace(/\\/g, "/");
  const forms = new Set([slash, dir, dir.replace(/\\/g, "\\\\"), `file:///${slash}`, slash.replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`)]);
  return [...forms].filter((form) => form.length > 3);
}

function describe(bytes, offset, forms, label) {
  const from = Math.max(0, offset - 60);
  let text = bytes.subarray(from, Math.min(bytes.length, offset + 100)).toString("utf8");
  for (const [needle, placeholder] of forms) text = text.split(needle).join(placeholder);
  return `${label}: …${text.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}…`;
}

// ---------------------------------------------------------------------------------------------
// the work

const commit = (await capture("git", ["rev-parse", "HEAD"], REPO)).text;
const dirty = (await capture("git", ["status", "--porcelain"], REPO)).text;
const tool = {};
for (const [name, command, commandArgs] of [
  ["node", "node", ["--version"]],
  ["npm", "npm", ["--version"]],
  ["cargo", "cargo", ["--version"]],
  ["rustc", "rustc", ["--version"]],
  ["git", "git", ["--version"]],
]) {
  const result = await capture(command, commandArgs, REPO);
  tool[name] = result.code === 0 ? result.text.split(/\r?\n/)[0] : "unavailable";
}
if (tool.cargo === "unavailable" || tool.node === "unavailable" || tool.npm === "unavailable") usage("node, npm and cargo must be on PATH");

if (!reuse) rmSync(root, { recursive: true, force: true });
mkdirSync(logs, { recursive: true });
process.stdout.write(`commit ${commit}${dirty === "" ? "" : " (the working tree has uncommitted changes; they are NOT part of the clones)"}\n`);

const steps = [];
async function step(label, command, commandArgs, options) {
  const result = await run(label, command, commandArgs, options);
  steps.push({ step: label, command: [command, ...commandArgs].join(" "), exitCode: result.code, seconds: result.seconds });
  return result.code === 0;
}

let projects = [];
for (const side of ["a", "b"]) {
  const dir = cloneDirs[side];
  const ok =
    reuse ||
    (await step(`${side}-clone`, "git", ["clone", "--quiet", "--no-hardlinks", REPO, dir])) &&
    (await step(`${side}-checkout`, "git", ["-C", dir, "checkout", "--quiet", "--detach", commit])) &&
    (await step(`${side}-npm-ci`, "npm", ["ci"], { cwd: dir })) &&
    (await step(`${side}-npm-run-build`, "npm", ["run", "build"], { cwd: dir }));
  if (!ok) {
    process.stderr.write(`clone ${side}: a step failed; see ${logs}\n`);
    writeReport(null);
    process.exit(2);
  }
  const mtek = join(dir, ...EXECUTABLES[0].split("/"));
  const found = readdirSync(join(dir, "examples"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, "examples", entry.name, "mtek.toml")))
    .map((entry) => entry.name)
    .sort();
  if (side === "a") projects = found;
  else if (found.join(",") !== projects.join(",")) throw new Error("the two clones list different examples");
  for (const project of reuse ? [] : found) {
    for (const mode of MODES) {
      const buildArgs = ["build", "--mode", mode, ...(mode === "release" ? [] : ["--out", join(dir, ".repro-out", `${project}-${mode}`)]), join(dir, "examples", project)];
      const built = await step(`${side}-build-${project}-${mode}`, mtek, buildArgs, { cwd: dir });
      if (!built) {
        writeReport(null);
        process.exit(2);
      }
    }
  }
  // The release build of an example goes to the project's own dist/; it is part of the compared trees.
  if (!reuse && withBenchmarks && !(await step(`${side}-benchmark-prepare`, process.execPath, ["benchmarks/runtime/tools/prepare.ts"], { cwd: dir }))) {
    writeReport(null);
    process.exit(2);
  }
}

const trees = [...TREES, ...projects.map((p) => `examples/${p}/dist`), ...(withBenchmarks ? BENCHMARK_TREES : [])];
const listing = { a: listTrees(cloneDirs.a, trees), b: listTrees(cloneDirs.b, trees) };
const exe = {};
for (const side of ["a", "b"]) {
  const path = join(cloneDirs[side], ...EXECUTABLES[0].split("/"));
  exe[side] = existsSync(path) ? { size: statSync(path).size, sha256: sha256(readFileSync(path)), bytes: readFileSync(path) } : null;
}

// Differences.
const placeholders = [
  ...pathForms(cloneDirs.a).map((form) => [form, "<clone-a>"]),
  ...pathForms(cloneDirs.b).map((form) => [form, "<clone-b>"]),
];
const onlyA = [];
const onlyB = [];
const differing = [];
for (const [path, a] of listing.a.files) {
  const b = listing.b.files.get(path);
  if (b === undefined) onlyA.push(path);
  else if (a.sha256 !== b.sha256) {
    let offset = 0;
    while (offset < a.bytes.length && offset < b.bytes.length && a.bytes[offset] === b.bytes[offset]) offset++;
    differing.push({
      path,
      sizeA: a.size,
      sizeB: b.size,
      sha256A: a.sha256,
      sha256B: b.sha256,
      firstDifferingByte: offset,
      contextA: describe(a.bytes, offset, placeholders, "a"),
      contextB: describe(b.bytes, offset, placeholders, "b"),
    });
  }
}
for (const path of listing.b.files.keys()) if (!listing.a.files.has(path)) onlyB.push(path);
const missingTrees = { a: listing.a.missing, b: listing.b.missing };

// Path leaks: the clone directories, their shared root and the home directory must occur in no output.
const needles = [
  ...Object.entries(cloneDirs).flatMap(([side, dir]) => pathForms(dir).map((form) => ({ form, name: `clone-${side}` }))),
  ...pathForms(root).map((form) => ({ form, name: "root" })),
  ...pathForms(homedir()).map((form) => ({ form, name: "home" })),
];
function scan(files, clone) {
  const leaks = [];
  for (const [path, entry] of files) {
    const haystack = entry.bytes.toString("latin1").toLowerCase();
    const found = new Set();
    for (const { form, name } of needles) if (haystack.includes(form.toLowerCase())) found.add(name);
    if (found.size > 0) leaks.push({ clone, path, found: [...found].sort() });
  }
  return leaks;
}
const leaks = [...scan(listing.a.files, "a"), ...scan(listing.b.files, "b")];
const exeLeaks = [];
for (const side of ["a", "b"]) {
  if (exe[side] === null) continue;
  const haystack = exe[side].bytes.toString("latin1").toLowerCase();
  const found = needles.filter(({ form }) => haystack.includes(form.toLowerCase())).map(({ name }) => name);
  exeLeaks.push({ clone: side, found: [...new Set(found)].sort() });
}

const identical = onlyA.length === 0 && onlyB.length === 0 && differing.length === 0 && listing.a.files.size > 0 && missingTrees.a.length === 0 && missingTrees.b.length === 0;
const clean = leaks.length === 0;

function writeReport(extra) {
  const sanitize = (text) => {
    let result = text;
    for (const [needle, placeholder] of [
      ...pathForms(cloneDirs.a).map((form) => [form, "<clone-a>"]),
      ...pathForms(cloneDirs.b).map((form) => [form, "<clone-b>"]),
      ...pathForms(root).map((form) => [form, "<root>"]),
      ...pathForms(process.execPath).map((form) => [form, "node"]),
      ...pathForms(REPO).map((form) => [form, "<source-repo>"]),
      ...pathForms(homedir()).map((form) => [form, "<home>"]),
    ]) result = result.split(needle).join(placeholder);
    return result;
  };
  const report =
    extra === null
      ? { commit, tool, steps, failed: true }
      : extra;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, sanitize(`${JSON.stringify(report, null, 2)}\n`));
}

const fileTable = (files) => [...files].map(([path, e]) => ({ path, size: e.size, sha256: e.sha256 })).sort((x, y) => (x.path < y.path ? -1 : 1));

const suite = [];
const report = {
  schemaVersion: 1,
  commit,
  workingTreeClean: dirty === "",
  machine: { platform: process.platform, arch: process.arch },
  tool,
  clones: { a: "<clone-a>", b: "<clone-b>", note: "two directories with different names and different lengths, under one root" },
  trees,
  normalised: [...NORMALISED].map(([path, field]) => ({ path, droppedField: field })),
  steps,
  result: {
    identical,
    filesA: listing.a.files.size,
    filesB: listing.b.files.size,
    bytesA: [...listing.a.files.values()].reduce((sum, e) => sum + e.size, 0),
    onlyInA: onlyA,
    onlyInB: onlyB,
    differing,
    missingTrees,
    pathLeaks: leaks,
    noPathLeaks: clean,
  },
  executables: {
    path: EXECUTABLES[0],
    note: "information only: a Rust debug executable is not a distribution artefact and does not decide the result",
    a: exe.a === null ? null : { size: exe.a.size, sha256: exe.a.sha256 },
    b: exe.b === null ? null : { size: exe.b.size, sha256: exe.b.sha256 },
    identical: exe.a !== null && exe.b !== null && exe.a.sha256 === exe.b.sha256,
    pathsFound: exeLeaks,
  },
  files: fileTable(listing.a.files),
  suite,
};

process.stdout.write(
  `compared ${String(listing.a.files.size)} files of clone a and ${String(listing.b.files.size)} of clone b: ` +
    `${identical ? "IDENTICAL" : "DIFFERENT"} (${String(differing.length)} differing, ${String(onlyA.length)} only in a, ${String(onlyB.length)} only in b); ` +
    `${clean ? "no path leaks" : `${String(leaks.length)} files contain a path`}\n`,
);
for (const d of differing) process.stdout.write(`  differs: ${d.path} (${String(d.sizeA)} / ${String(d.sizeB)} bytes)\n    ${d.contextA}\n    ${d.contextB}\n`);
for (const path of onlyA) process.stdout.write(`  only in a: ${path}\n`);
for (const path of onlyB) process.stdout.write(`  only in b: ${path}\n`);
for (const leak of leaks) process.stdout.write(`  path in output: ${leak.clone}/${leak.path} (${leak.found.join(", ")})\n`);

// ---------------------------------------------------------------------------------------------
// the full suite from clone A (the clean install)

if (runSuite) {
  const dir = cloneDirs.a;
  const stage = async (label, command, commandArgs, env, needsGpu = false) => {
    let locked = false;
    if (needsGpu && gpuLock !== null) {
      while (!locked) {
        try {
          mkdirSync(gpuLock);
          locked = true;
        } catch {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    try {
      const result = await run(`suite-${label}`, command, commandArgs, { cwd: dir, env });
      suite.push({ stage: label, command: [command, ...commandArgs].join(" "), env: env ?? {}, exitCode: result.code, seconds: result.seconds });
    } finally {
      if (locked) rmSync(gpuLock, { recursive: true, force: true });
    }
  };
  const backend = { MTEK_REQUIRE_GBNF_VALIDATOR: "1", MTEK_REQUIRE_GBNF_BACKEND: "1" };
  const adapter = join("target", "debug", WINDOWS ? "grammar-adapter.exe" : "grammar-adapter");
  await stage("check", "npm", ["run", "check"]);
  await stage("cargo-test-without-backend", "cargo", ["test", "--workspace", "--locked"]);
  await stage("fetch-backend", process.execPath, ["tools/grammar-adapters/fetch-backend.mjs", "--all"]);
  await stage("build-grammar-adapter", "cargo", ["build", "-p", "mtek-grammar-adapters", "--locked"]);
  await stage("grammar-capability", join(dir, adapter), ["check", "--format", "json"]);
  await stage("cargo-test-with-backend", "cargo", ["test", "--workspace", "--locked"], backend);
  await stage("test-unit", "npm", ["run", "test:unit"]);
  await stage("check-coverage", "npm", ["run", "check:coverage"]);
  await stage("check-release", "npm", ["run", "check:release"]);
  await stage("test-browser", "npm", ["run", "test:browser"], { MTEK_REQUIRE_GPU: "1", MTEK_RESULTS_DIR: join(root, "results", "browser-full") }, true);
  await stage("vscode-integration", "npm", ["run", "test:integration", "-w", "mtek-vscode"]);
  report.suite = suite;
  for (const entry of suite) process.stdout.write(`suite ${entry.stage}: exit ${String(entry.exitCode)}\n`);
}

writeReport(report);
process.stdout.write(`report: ${outFile}\n`);
process.exit(identical && clean && suite.every((s) => s.exitCode === 0) ? 0 : 1);
