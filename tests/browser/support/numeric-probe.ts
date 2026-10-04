// The GPU numeric probe (task M2-08, decision 0043; spec/testing.md section 5), generated from the
// CPU table by the real compiler:
//
// 1. A Mtek project: the function library of the codegen fixture `tests/codegen/numeric_cpu_table`
//    (one pure function per operation and signature of cpu.json, generated and kept fresh by
//    `crates/mtek-compiler/tests/codegen_cpu_table.rs`; the CPU execution tests run the same
//    functions) plus a material `Probe` whose fragment stage calls every function, so that the shader
//    lowering (decision 0041) emits all of them.
// 2. `mtek build --mode test` of that project; the WGSL of `Probe` is read from the build output.
// 3. A test-only harness appended to that WGSL, unchanged otherwise: a full-screen triangle and a
//    fragment entry point that, per pixel ("slot"), reads the case's arguments from a storage buffer
//    of 32-bit words (`bitcast`, so no value is a constant the GPU compiler could fold), calls the
//    compiled `u_fn_<hash8>_<name>` function and writes the result's words with `bitcast<u32>` to an
//    `rgba32uint` target. Only argument decoding and result encoding are hand-written; every operation
//    under test is the compiler's output.
//
// `.out/numeric/probe.wgsl` and `.out/numeric/probe.json` (the slot plan) are what the probe page runs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./environment.ts";
import { runCli } from "./m1-fixtures.ts";
import {
  type CpuTable,
  type TableCase,
  type ValueType,
  VALUE_TYPES,
  argTypes,
  componentCount,
  decodeTyped,
  parseCpuTable,
  typedWords,
} from "./numeric-values.ts";

export const CPU_TABLE_PATH = join(REPO_ROOT, "tests", "semantics", "numeric", "cpu.json");
export const TOLERANCES_PATH = join(REPO_ROOT, "tests", "semantics", "numeric", "tolerances.json");
export const LIBRARY_PATH = join(REPO_ROOT, "tests", "codegen", "numeric_cpu_table", "src", "main.mtek");

/** Width of the probe target in pixels (one slot = one pixel = four words). */
export const PROBE_WIDTH = 64;
/** The material whose shader carries the probe functions. */
export const PROBE_MATERIAL = "Probe";
/** Slot table entry of an unused pixel. */
export const NO_FUNCTION = 0xffffffff;

/** One function of the library. */
export interface LibraryFunction {
  readonly name: string;
  readonly params: readonly ValueType[];
  readonly result: ValueType;
}

/** One case of the plan. */
export interface PlannedCase {
  readonly id: string;
  /** Index into `functions`. */
  readonly fn: number;
  /** Word offset of the first argument in `words`. */
  readonly argAt: number;
  /** The slots (pixels, row-major) holding the result: four words each, `mat4` four slots. */
  readonly slots: readonly number[];
}

export interface ProbePlan {
  readonly format: "mtek-numeric-probe/1";
  readonly width: number;
  readonly height: number;
  readonly functions: readonly LibraryFunction[];
  readonly cases: readonly PlannedCase[];
  /** Argument words of every case. */
  readonly words: readonly number[];
  /** Four words per slot: function index (or NO_FUNCTION), argument offset, result part, 0. */
  readonly slotTable: readonly number[];
  /** The compiled module's function prefix (`u_fn_<hash8>_`). */
  readonly prefix: string;
}

const OPERATORS: Readonly<Record<string, string>> = {
  "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "rem",
  "<": "lt", "<=": "le", ">": "gt", ">=": "ge", "==": "eq", "!=": "ne",
};

/** The library function of a case: the naming rule of `codegen_cpu_table.rs`. */
export function functionName(row: TableCase): string {
  const operator = OPERATORS[row.fn];
  let stem: string;
  if (operator !== undefined) stem = operator;
  else if (row.fn === "neg") stem = "neg";
  else if (row.fn === "f32" || row.fn === "i32" || row.fn === "u32") stem = `to_${row.fn}`;
  else if (row.fn === "vec2" || row.fn === "vec3" || row.fn === "vec4") stem = `make_${row.fn}`;
  else stem = row.fn.replace(".", "_");
  return [stem, ...argTypes(row)].join("_");
}

function valueType(text: string, where: string): ValueType {
  if (!(VALUE_TYPES as readonly string[]).includes(text)) throw new Error(`${where}: unsupported type ${text}`);
  return text as ValueType;
}

/** The pure functions of the library source, in source order. */
export function libraryFunctions(source: string): LibraryFunction[] {
  const functions: LibraryFunction[] = [];
  for (const match of source.matchAll(/^fn (\w+)\(([^)]*)\) -> (\w+) \{$/gm)) {
    const [, name = "", params = "", result = ""] = match;
    functions.push({
      name,
      params: params === "" ? [] : params.split(", ").map((param) => valueType(param.split(": ")[1] ?? "", name)),
      result: valueType(result, name),
    });
  }
  return functions;
}

/** An argument of each type for the calls that make the functions reachable from the stage. */
const DUMMY: Readonly<Record<ValueType, string>> = {
  f32: "0.5",
  i32: "1",
  u32: "1",
  bool: "false",
  vec2: "vec2(0.5)",
  vec3: "vec3(0.5)",
  vec4: "vec4(0.5)",
  quat: "quat.identity()",
  color: "color.linear(vec3(0.5), 1.0)",
  mat4: "mat4.identity()",
};

/**
 * The probe project's `src/main.mtek`: the library without its scene, a material whose fragment stage
 * calls every function once (decision 0041 item 4 emits only what the stage reaches), and a scene that
 * uses the material so that the build lowers it.
 */
export function probeProjectSource(library: string): string {
  const sceneAt = library.indexOf("\nscene ");
  if (sceneAt < 0) throw new Error("the numeric_cpu_table library has no scene to replace");
  const functions = libraryFunctions(library);
  const calls = functions.map((f) => `        ${f.name}(${f.params.map((type) => DUMMY[type]).join(", ")});`);
  return [
    library.slice(0, sceneAt).trimEnd(),
    "",
    "// M2-08 (tests/browser/support/numeric-probe.ts): reaches every function above from a fragment",
    "// stage so that the shader lowering emits them; the GPU probe calls them with the table's inputs.",
    `material ${PROBE_MATERIAL} {`,
    "    fragment(surface: SurfaceInput) -> color {",
    ...calls,
    "        return color.linear(vec3(0.0), 1.0);",
    "    }",
    "}",
    "",
    "scene NumericProbe {",
    "    camera Main {}",
    "    entity Quad {",
    "        mesh: Box {};",
    `        material: ${PROBE_MATERIAL} {};`,
    "    }",
    "}",
    "",
  ].join("\n");
}

/** Lays out every case of the table (portable or not) on the probe target. */
export function planProbe(table: CpuTable, functions: readonly LibraryFunction[], prefix: string): ProbePlan {
  const index = new Map(functions.map((f, i) => [f.name, i]));
  const words: number[] = [];
  const slotTable: number[] = [];
  const cases: PlannedCase[] = [];
  for (const row of table.cases) {
    const name = functionName(row);
    const fn = index.get(name);
    if (fn === undefined) throw new Error(`${row.id}: the library has no function ${name} (stale numeric_cpu_table fixture?)`);
    const argAt = words.length;
    row.args.forEach((arg, i) => words.push(...typedWords(decodeTyped(arg, `${row.id} argument ${i}`))));
    const parts = Math.ceil(componentCount(decodeTyped(row.expect, `${row.id} expect`).type) / 4);
    const slots: number[] = [];
    for (let part = 0; part < parts; part++) {
      slots.push(slotTable.length / 4);
      slotTable.push(fn, argAt, part, 0);
    }
    cases.push({ id: row.id, fn, argAt, slots });
  }
  const height = Math.ceil(slotTable.length / 4 / PROBE_WIDTH);
  while (slotTable.length < PROBE_WIDTH * height * 4) slotTable.push(NO_FUNCTION, 0, 0, 0);
  return { format: "mtek-numeric-probe/1", width: PROBE_WIDTH, height, functions, cases, words, slotTable, prefix };
}

/** WGSL type of a Mtek value type in the compiled shader (spec/gpu-layout.md section 3). */
function wgslType(type: ValueType): string {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
    case "bool":
      return type;
    case "vec2":
      return "vec2<f32>";
    case "vec3":
      return "vec3<f32>";
    case "vec4":
    case "quat":
    case "color":
      return "vec4<f32>";
    case "mat4":
      return "mat4x4<f32>";
  }
}

/** The harness expression reading an argument of `type` at word offset `at` (a WGSL expression). */
function readArg(type: ValueType, at: string): string {
  const f = (offset: number): string => `bitcast<f32>(probe_words[${at} + ${offset}u])`;
  switch (type) {
    case "f32":
      return f(0);
    case "i32":
      return `bitcast<i32>(probe_words[${at}])`;
    case "u32":
      return `probe_words[${at}]`;
    case "bool":
      return `(probe_words[${at}] != 0u)`;
    case "mat4":
      return `mat4x4<f32>(${Array.from({ length: 16 }, (_, i) => f(i)).join(", ")})`;
    default:
      return `${wgslType(type)}(${Array.from({ length: componentCount(type) }, (_, i) => f(i)).join(", ")})`;
  }
}

/** The harness expression encoding a result `r` of `type` as `vec4<u32>` (`part` selects a mat4 column). */
function writeResult(type: ValueType): string {
  switch (type) {
    case "f32":
    case "i32":
      return "vec4<u32>(bitcast<u32>(r), 0u, 0u, 0u)";
    case "u32":
      return "vec4<u32>(r, 0u, 0u, 0u)";
    case "bool":
      return "vec4<u32>(select(0u, 1u, r), 0u, 0u, 0u)";
    case "vec2":
      return "vec4<u32>(bitcast<vec2<u32>>(r), 0u, 0u)";
    case "vec3":
      return "vec4<u32>(bitcast<vec3<u32>>(r), 0u)";
    case "vec4":
    case "quat":
    case "color":
      return "bitcast<vec4<u32>>(r)";
    case "mat4":
      return "bitcast<vec4<u32>>(r[min(part, 3u)])";
  }
}

/** The compiled module's function prefix `u_fn_<hash8>_`, found through the first library function. */
export function compiledPrefix(wgsl: string, functions: readonly LibraryFunction[]): string {
  const first = functions[0];
  if (first === undefined) throw new Error("the library has no functions");
  const match = new RegExp(`^fn (u_fn_[0-9a-f]{8}_)${first.name}\\(`, "m").exec(wgsl);
  if (match?.[1] === undefined) throw new Error(`the compiled shader has no function ${first.name}`);
  return match[1];
}

/** The harness appended to the compiled module (test-only WGSL; identifiers `probe_*`). */
export function probeHarness(plan: ProbePlan): string {
  const lines = [
    "",
    "// ---- M2-08 numeric probe harness: test-only, appended by tests/browser/support/numeric-probe.ts.",
    "// Everything above this line is the compiler's output for the material, unchanged.",
    "@group(3) @binding(0) var<storage, read> probe_words: array<u32>;",
    "@group(3) @binding(1) var<storage, read> probe_slots: array<vec4<u32>>;",
    "",
    "@vertex",
    "fn probe_vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {",
    "    let x = f32((index << 1u) & 2u);",
    "    let y = f32(index & 2u);",
    "    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);",
    "}",
    "",
  ];
  plan.functions.forEach((f, index) => {
    let at = 0;
    const args = f.params.map((type) => {
      const expr = readArg(type, `at + ${at}u`);
      at += componentCount(type);
      return expr;
    });
    lines.push(
      `fn probe_case_${index}(at: u32, part: u32) -> vec4<u32> {`,
      `    let r = ${plan.prefix}${f.name}(${args.join(", ")});`,
      `    return ${writeResult(f.result)};`,
      "}",
      "",
    );
  });
  lines.push(
    "@fragment",
    "fn probe_fs(@builtin(position) position: vec4<f32>) -> @location(0) vec4<u32> {",
    `    let slot = probe_slots[u32(position.y) * ${plan.width}u + u32(position.x)];`,
    "    switch slot.x {",
    ...plan.functions.map((_, index) => `        case ${index}u: { return probe_case_${index}(slot.y, slot.z); }`),
    "        default: { return vec4<u32>(0xffffffffu); }",
    "    }",
    "}",
    "",
  );
  return lines.join("\n");
}

/** The result words of planned case `index` from the target's words (four per slot). */
export function caseWords(plan: ProbePlan, words: readonly number[], index: number): number[] {
  const planned = plan.cases[index];
  if (planned === undefined) throw new Error(`no planned case ${index}`);
  return planned.slots.flatMap((slot) => words.slice(slot * 4, slot * 4 + 4));
}

/** A built program's shader list entry (spec/runtime-abi.md section 3). */
interface ManifestShader {
  readonly url: string;
  readonly material: string;
}

/**
 * Generates the project, builds it with the CLI and writes `probe.wgsl`, `probe.json` and the
 * compiled material WGSL (`material.wgsl`, for the helper checks) into `outDir`.
 */
export function buildNumericProbe(cli: string, outDir: string): ProbePlan {
  rmSync(outDir, { recursive: true, force: true });
  const project = join(outDir, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  const library = readFileSync(LIBRARY_PATH, "utf8");
  writeFileSync(join(project, "mtek.toml"), '[project]\nname = "numeric-probe"\nlanguage = "0.1"\n');
  writeFileSync(join(project, "src", "main.mtek"), probeProjectSource(library));
  const dist = join(outDir, "dist");
  const run = runCli(cli, ["build", "--mode", "test", "--out", dist, project]);
  if (run.status !== 0) throw new Error(`mtek build of the numeric probe failed (exit ${run.status}):\n${run.stdout}${run.stderr}`);
  const manifest = JSON.parse(readFileSync(join(dist, "program.manifest.json"), "utf8")) as { shaders?: ManifestShader[] };
  const shader = (manifest.shaders ?? []).find((s) => s.material === `src/main.mtek::${PROBE_MATERIAL}`);
  if (shader === undefined) throw new Error(`the numeric probe build has no shader for ${PROBE_MATERIAL}`);
  const wgsl = readFileSync(join(dist, ...shader.url.split("/")), "utf8");
  const functions = libraryFunctions(library);
  const plan = planProbe(parseCpuTable(readFileSync(CPU_TABLE_PATH, "utf8")), functions, compiledPrefix(wgsl, functions));
  writeFileSync(join(outDir, "material.wgsl"), wgsl);
  writeFileSync(join(outDir, "probe.wgsl"), `${wgsl}${probeHarness(plan)}`);
  writeFileSync(join(outDir, "probe.json"), `${JSON.stringify(plan)}\n`);
  return plan;
}
