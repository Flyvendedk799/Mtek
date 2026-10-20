// Sampled CPU/constant-folding differential audit, seed 4421 (no dependencies or browser).
// Usage: node scripts/audit-numeric-differential.mjs [path/to/mtek]
// Build the CLI/runtime first. Generated source and results remain in the reported temp directory.
// This is selected finite-case coverage, not an exhaustive proof or a GPU conformance test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = resolve(process.argv[2] ?? join(repo, "target/debug/mtek"));
const directory = mkdtempSync(join(tmpdir(), "mtek-numeric-differential-"));
mkdirSync(join(directory, "src"));
writeFileSync(join(directory, "mtek.toml"), '[project]\nname = "numeric-audit"\nlanguage = "0.1"\n');
writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');

const operations = {
  add: "a+b", sub: "a-b", mul: "a*b", div: "a/b", rem: "a%b", neg: "-a",
  association: "a-(b-c)", sum: "a+(b+c)", product: "(a*b)*c",
  min: "min(a,b)", max: "max(a,b)", clamp: "clamp(a,b,c)", mix: "mix(a,b,c)",
  step: "step(a,b)", smoothstep: "smoothstep(a,b,c)", abs: "abs(a)",
  floor: "floor(a)", ceil: "ceil(a)", trunc: "trunc(a)", round: "round(a)",
  fract: "fract(a)", sign: "sign(a)", saturate: "saturate(a)",
  radians: "radians(a)", degrees: "degrees(a)", distance: "distance(a,b)",
  dot: "dot(vec3(a,b,c),vec3(c,a,b))", cross: "cross(vec3(a,b,c),vec3(c,a,b)).y",
  normalize: "normalize(vec3(a,b,c)).x", reflect: "reflect(vec3(a,b,c),vec3(c,a,b)).y",
  matrix: "(mat4.columns(vec4(a,b,c,0.0),vec4(c,a,b,0.0),vec4(b,c,a,0.0),vec4(0.0))*vec4(c,a,b,0.0)).x",
  sqrt: "sqrt(abs(a))", length: "length(vec3(a,b,c))",
};
const seed = 4421;
let state = seed;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
}
const edges = [
  -0, 0, -1, 1, -0.5, 0.5, -1.5, 1.5, -2.5, 2.5, 8388607.5, 8388608,
  16777216, 16777218, -16777216, Math.fround(2 ** -149), -Math.fround(2 ** -149),
  Math.fround(2 ** -126), -Math.fround(2 ** -126),
];
function value() {
  return random() < 0.6
    ? edges[Math.floor(random() * edges.length)]
    : Math.fround((random() * 2 - 1) * 2 ** Math.floor(random() * 61 - 30));
}
function literal(x) {
  return Object.is(x, -0) ? "-0.0" : Number.isInteger(x) ? `${x}.0` : String(x);
}
const cases = [];
let excludedNonfiniteDivisions = 0;
for (let i = 0; i < 300; i++) {
  const a = value();
  let b = value();
  const c = value();
  if (b === 0) b = Math.fround(0.1);
  const args = [a, b, c];
  for (const [name, expression] of Object.entries(operations)) {
    // Mandatory constant folding intentionally rejects these, rather than returning infinity.
    if (name === "div" && !Number.isFinite(Math.fround(a / b))) {
      excludedNonfiniteDivisions++;
      continue;
    }
    const constant = expression.replace(/\b(a|b|c)\b/g, (key) => `(${literal(args["abc".indexOf(key)])})`);
    cases.push({ name, expression, args, constant });
  }
}
assert.equal(cases.length, 9881);
assert.equal(excludedNonfiniteDivisions, 19);
const functions = Object.entries(operations).map(([name, expression]) =>
  `cpu fn run_${name}(a:f32,b:f32,c:f32)->f32{return ${expression};}`,
).join("\n");
const source = `${functions}\ncpu fn folded()->array<f32,${cases.length}>{return [${cases.map((c) => c.constant).join(",")}];}\nscene Audit { camera Main {} }\n`;
writeFileSync(join(directory, "src/main.mtek"), source);
const preserveZero = (_key, value) => Object.is(value, -0) ? "-0" : value;
writeFileSync(join(directory, "cases.json"), JSON.stringify(cases, preserveZero));
const built = spawnSync(compiler, ["build", directory, "--format", "json"], { cwd: repo, encoding: "utf8" });
writeFileSync(join(directory, "build.json"), built.stdout ?? "");
assert.equal(built.status, 0, built.error?.message ?? built.stderr + built.stdout);
// Verify that the reference really is a source-folded literal array, not another runtime
// evaluation of the same expression. JSON parsing accepts only literal numeric array values.
const app = readFileSync(join(directory, "dist/app.js"), "utf8");
const literalReturn = /function f_[a-f0-9]+_folded\(ctx\) \{\s*return (\[[^;]*\]);\s*\}/.exec(app);
assert.ok(literalReturn, "folded must emit only a literal-array return");
const emittedConstants = JSON.parse(literalReturn[1]);
assert.equal(emittedConstants.length, cases.length);
assert.ok(emittedConstants.every((value) => typeof value === "number" && Number.isFinite(value)));
const { functions: generated } = await import(pathToFileURL(join(directory, "dist/app.js")).href);
const folded = generated["src/main.mtek::folded"]({});
const failures = [];
let nonfiniteRuntimeResults = 0;
for (const [index, row] of cases.entries()) {
  const actual = generated[`src/main.mtek::run_${row.name}`]({}, ...row.args);
  const expected = folded[index];
  assert.ok(Object.is(expected, emittedConstants[index]), "folded function changed its literal value");
  if (!Number.isFinite(actual)) nonfiniteRuntimeResults++;
  // Exact equality includes the sign of zero. Neither side is a handwritten math implementation:
  // the independent Rust folder and generated JavaScript/runtime take separate execution paths.
  if (!Object.is(actual, expected)) failures.push({ index, ...row, actual, expected });
}
const report = { seed, triples: 300, operations: Object.keys(operations), tested: cases.length, excludedNonfiniteDivisions, nonfiniteRuntimeResults, failures };
writeFileSync(join(directory, "results.json"), JSON.stringify(report, preserveZero, 2));
console.log(JSON.stringify({ directory, seed, operations: Object.keys(operations).length, tested: cases.length, excludedNonfiniteDivisions, nonfiniteRuntimeResults, failures: failures.length }));
assert.equal(nonfiniteRuntimeResults, 0);
assert.deepEqual(failures, []);
