// Mutation check of the fixture of scene-rendering-11 (decision 0089) against BOTH stacks: each mutant is a plausible wrong solution made
// from a reference by one textual edit (a wrong colour space, a flipped v, a mirrored u, a transposed or rotated picture, a wrong filter,
// a wrong wrapping, no tiling). A mutant must FAIL the fixture; the alternative solutions must PASS (they show the fixture does not
// depend on the support helper or on how the Mtek material is written).
//
//   node evidence/M6/benchmark-texture/run-mutants.mjs [--only ID] [--out FILE]
//
// It needs a hardware adapter and Playwright's Chromium, so run it while holding the GPU lock. It writes `mutants.json` (next to
// this file by default): per mutant, the Mtek verdict with the first failing pixel and the baseline outcome with the first failing
// pixel, without absolute paths.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TASK = "benchmarks/tasks/scene-rendering-11";
const SCRATCH = join(root, "tests", "browser", "results", "texture-mutants");

/** An edit replaces `from` (which must occur exactly `count` times, default 1) by `to`. */
const edit = (from, to, count = 1) => ({ from, to, count });

const THREE_ALTERNATIVE = `import { Mesh, MeshBasicMaterial, PlaneGeometry, Scene, SRGBColorSpace, NearestFilter, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, TextureLoader, type Texture } from "three/webgpu";
import { lookAtCamera, startTask } from "@mtek/benchmarks/baseline-support";

// Alternative solution: no use of the support texture helper, plain three.js (a TextureLoader, colour space and filters set by hand).
async function load(nearest: boolean, repeat: boolean): Promise<Texture> {
  const texture = await new TextureLoader().loadAsync("assets/swatch.png");
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = nearest ? NearestFilter : LinearFilter;
  texture.minFilter = nearest ? NearestFilter : LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  return texture;
}
function square(name: string, x: number, z: number, map: Texture): Mesh {
  const mesh = new Mesh(new PlaneGeometry(3.6, 3.6), new MeshBasicMaterial({ map }));
  mesh.name = name;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0, z);
  return mesh;
}
void startTask(async () => {
  const [plain, tiled, smooth] = await Promise.all([load(true, false), load(true, true), load(false, false)]);
  tiled.repeat.set(2, 2);
  const scene = new Scene();
  scene.add(square("Plain", -2, -2, plain), square("Tiled", 0, 2, tiled), square("Smooth", 2, -2, smooth));
  return { scene, camera: lookAtCamera({ position: [0, 11, 3], target: [0, 0, 0], fovY: 0.72 }), clearColor: "#1b2430" };
});
`;

const MTEK_UV = "input.uv * tiles";

/** @type {Array<{ id: string, description: string, mtek?: object[], baseline?: object[], baselineFile?: string, expect: "fail" | "pass" }>} */
export const MUTANTS = [
  {
    id: "colour-space-linear",
    description: "the picture is declared/tagged as linear data instead of sRGB colour",
    mtek: [edit('asset.texture("../assets/swatch.png")', 'asset.linear_texture("../assets/swatch.png")')],
    baseline: [edit("{ filter:", '{ colorSpace: "linear", filter:', 3)],
    expect: "fail",
  },
  {
    id: "flipped-v",
    description: "the picture is upside down (v flipped)",
    mtek: [edit(MTEK_UV, "vec2(input.uv.x, 1.0 - input.uv.y) * tiles")],
    baseline: [edit("  const scene = new Scene();", "  for (const t of [plain, smooth]) {\n    t.repeat.y = -1;\n    t.offset.y = 1;\n  }\n  tiled.repeat.y = -2;\n  const scene = new Scene();")],
    expect: "fail",
  },
  {
    id: "mirrored-u",
    description: "the picture is mirrored left to right (u flipped)",
    mtek: [edit(MTEK_UV, "vec2(1.0 - input.uv.x, input.uv.y) * tiles")],
    baseline: [edit("  const scene = new Scene();", "  for (const t of [plain, smooth]) {\n    t.repeat.x = -1;\n    t.offset.x = 1;\n  }\n  tiled.repeat.x = -2;\n  const scene = new Scene();")],
    expect: "fail",
  },
  {
    id: "transposed-or-rotated",
    description: "the texel order is wrong: u and v swapped (Mtek), the picture turned by 90 degrees (three.js; a transposition is a turn plus a flip)",
    mtek: [edit(MTEK_UV, "vec2(input.uv.y, input.uv.x) * tiles")],
    baseline: [edit("  const scene = new Scene();", "  for (const t of [plain, tiled, smooth]) {\n    t.center.set(0.5, 0.5);\n    t.rotation = Math.PI / 2;\n  }\n  const scene = new Scene();")],
    expect: "fail",
  },
  {
    id: "plain-linear",
    description: "Plain is smoothed (linear filtering) instead of hard-edged",
    mtek: [edit("Picture { image: SWATCH; filter: sampler.nearest_clamp() }", "Picture { image: SWATCH; filter: sampler.linear_clamp() }")],
    baseline: [edit('{ filter: "nearest", wrap: "clamp" }', '{ filter: "linear", wrap: "clamp" }')],
    expect: "fail",
  },
  {
    id: "tiled-linear",
    description: "Tiled is smoothed (linear filtering) instead of hard-edged",
    mtek: [edit("filter: sampler.nearest_repeat(); tiles: 2.0", "filter: sampler.linear_repeat(); tiles: 2.0")],
    baseline: [edit('{ filter: "nearest", wrap: "repeat" }', '{ filter: "linear", wrap: "repeat" }')],
    expect: "fail",
  },
  {
    id: "smooth-nearest",
    description: "Smooth is hard-edged (nearest filtering) instead of smoothed",
    mtek: [edit("filter: sampler.linear_clamp() }", "filter: sampler.nearest_clamp() }")],
    baseline: [edit('{ filter: "linear", wrap: "clamp" }', '{ filter: "nearest", wrap: "clamp" }')],
    expect: "fail",
  },
  {
    id: "smooth-repeat",
    description: "Smooth wraps around at the picture's edge instead of holding the edge texel",
    mtek: [edit("filter: sampler.linear_clamp() }", "filter: sampler.linear_repeat() }")],
    baseline: [edit('{ filter: "linear", wrap: "clamp" }', '{ filter: "linear", wrap: "repeat" }')],
    expect: "fail",
  },
  {
    id: "tiled-clamp",
    description: "Tiled clamps instead of repeating",
    mtek: [edit("filter: sampler.nearest_repeat(); tiles: 2.0", "filter: sampler.nearest_clamp(); tiles: 2.0")],
    baseline: [edit('{ filter: "nearest", wrap: "repeat" }', '{ filter: "nearest", wrap: "clamp" }')],
    expect: "fail",
  },
  {
    id: "no-tiling",
    description: "Tiled shows the picture once",
    mtek: [edit("tiles: 2.0", "tiles: 1.0")],
    baseline: [edit("tiled.repeat.set(2, 2);", "tiled.repeat.set(1, 1);")],
    expect: "fail",
  },
  {
    id: "alternative-three-without-helper",
    description: "ALTERNATIVE (must pass): the three.js solution without the support texture helper (TextureLoader, colour space and filters by hand)",
    baselineFile: THREE_ALTERNATIVE,
    expect: "pass",
  },
  {
    id: "alternative-mtek-texture-in-material",
    description: "ALTERNATIVE (must pass): the Mtek scene written with two materials (the tiling inside the shader as a vec2) and the sampler left to the default or set per entity",
    mtekFile: "alternative",
    expect: "pass",
  },
];

const MTEK_ALTERNATIVE = `const SWATCH = asset.texture("../assets/swatch.png");

material Once {
    param image: texture = texture.white();
    param filter: sampler = sampler.nearest_clamp();
    fragment(input: SurfaceInput) -> color {
        return color.linear(sample(image, filter, input.uv).xyz, 1.0);
    }
}

material Twice {
    param image: texture = texture.white();
    param filter: sampler = sampler.nearest_repeat();
    fragment(input: SurfaceInput) -> color {
        return color.linear(sample(image, filter, input.uv * vec2(2.0, 2.0)).xyz, 1.0);
    }
}

scene Demo {
    clear_color: #1b2430;
    camera Main {
        position: vec3(0.0, 11.0, 3.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Perspective { fov_y: 0.72; near: 0.1; far: 1000.0 };
    }
    entity Plain {
        position: vec3(-2.0, 0.0, -2.0);
        mesh: Plane { size: vec2(3.6, 3.6) };
        material: Once { image: SWATCH };
    }
    entity Tiled {
        position: vec3(0.0, 0.0, 2.0);
        mesh: Plane { size: vec2(3.6, 3.6) };
        material: Twice { image: SWATCH };
    }
    entity Smooth {
        position: vec3(2.0, 0.0, -2.0);
        mesh: Plane { size: vec2(3.6, 3.6) };
        material: Once { image: SWATCH; filter: sampler.linear_clamp() };
    }
}
`;

function applyEdits(text, edits, id) {
  let out = text;
  for (const { from, to, count } of edits) {
    const found = out.split(from).length - 1;
    if (found !== count) throw new Error(`${id}: expected ${String(count)} occurrence(s) of ${JSON.stringify(from)}, found ${String(found)}`);
    out = out.split(from).join(to);
  }
  return out;
}

function prepare(id, side, edits, whole) {
  const dir = join(SCRATCH, id, side);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(join(root, TASK, "reference", side), dir, { recursive: true });
  const file = join(dir, "src", side === "mtek" ? "main.mtek" : "main.ts");
  writeFileSync(file, whole ?? applyEdits(readFileSync(file, "utf8"), edits ?? [], id));
  return dir;
}

const scrub = (text) => text.replaceAll(root, "<repo>").replaceAll(root.replaceAll("\\", "/"), "<repo>").replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>");

function runMtek(dir) {
  const run = spawnSync(process.execPath, ["tools/ai-eval/src/cli.ts", "validate", "--task", TASK, "--project", dir], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    return { verdict: "error", detail: scrub(`${run.stdout}${run.stderr}`).slice(0, 400) };
  }
  const fixture = report.testReport?.fixtures?.[0];
  const detail = fixture?.failure ?? report.diagnostics?.[0]?.message ?? null;
  return { verdict: report.verdict, layers: Object.fromEntries(Object.entries(report.layers).map(([k, v]) => [k, v.outcome])), firstFailure: detail === null ? null : scrub(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) };
}

function runBaseline(dir) {
  const run = spawnSync("npm", ["run", "test:benchmarks", "--", "scene-rendering-11"], {
    cwd: root,
    encoding: "utf8",
    shell: true,
    maxBuffer: 1 << 26,
    env: { ...process.env, MTEK_BASELINE_DIR: dir, MTEK_REQUIRE_GPU: "1" },
  });
  const text = `${run.stdout}${run.stderr}`;
  const failure = /pixel \((\d+), (\d+)\) is rgb\(([\d, ]+)\), expected (#[0-9a-f]{6}) within (\d+)/.exec(text);
  const passed = /\b1 passed\b/.test(text);
  return {
    outcome: passed ? "pass" : /\b1 failed\b/.test(text) ? "fail" : "error",
    firstFailure: failure === null ? null : `pixel (${failure[1]}, ${failure[2]}) is rgb(${failure[3]}), expected ${failure[4]} within ${failure[5]}`,
    ...(passed || failure !== null ? {} : { detail: scrub(text).slice(-400) }),
  };
}

function main(argv) {
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  const outFile = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]) : join(dirname(fileURLToPath(import.meta.url)), "mutants.json");
  const results = [];
  for (const mutant of MUTANTS.filter((m) => only === null || m.id === only)) {
    const record = { id: mutant.id, description: mutant.description, expect: mutant.expect };
    if (mutant.mtek !== undefined || mutant.mtekFile !== undefined) {
      const dir = prepare(mutant.id, "mtek", mutant.mtek, mutant.mtekFile === undefined ? undefined : MTEK_ALTERNATIVE);
      record.mtek = runMtek(dir);
    }
    if (mutant.baseline !== undefined || mutant.baselineFile !== undefined) {
      const dir = prepare(mutant.id, "baseline", mutant.baseline, mutant.baselineFile);
      record.baseline = runBaseline(dir);
    }
    const mtekOk = record.mtek === undefined || (mutant.expect === "pass" ? record.mtek.verdict === "pass" : record.mtek.verdict === "fail");
    const baselineOk = record.baseline === undefined || (mutant.expect === "pass" ? record.baseline.outcome === "pass" : record.baseline.outcome === "fail");
    record.asExpected = mtekOk && baselineOk;
    results.push(record);
    process.stdout.write(`${record.asExpected ? "ok  " : "FAIL"} ${mutant.id}: mtek ${record.mtek?.verdict ?? "-"}, baseline ${record.baseline?.outcome ?? "-"}\n`);
  }
  writeFileSync(outFile, `${JSON.stringify({ task: "scene-rendering-11", mutants: results }, null, 2)}\n`);
  return results.every((r) => r.asExpected) ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
