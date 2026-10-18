// Mutation check of the three.js side of interaction-09 .. interaction-11 (decision 0088): wrong-but-plausible
// baseline solutions and alternate correct ones, run against the same fixtures through the Playwright interpreter.
//
//   node evidence/M6/benchmark-input-hooks/mutation/baseline-mutants.mjs [task filter] > baseline-results.json
//
// A MUTANT is the baseline reference with one plausible mistake and must FAIL at least one fixture; an ALTERNATE is a
// different correct solution and must pass every fixture. A candidate is written to `<task>/zz-candidate/` (removed
// afterwards), built by the suite with `MTEK_BASELINE_DIR`, and run on the hardware adapter. `MTEK_GPU_LOCK` (a
// directory name) is taken with mkdir around each run when set.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCK = process.env["MTEK_GPU_LOCK"];
const filter = process.argv[2] ?? "";

const reference = (task) => readFileSync(join(REPO, "benchmarks", "tasks", task, "reference", "baseline", "src", "main.ts"), "utf8");

function edit(task, edits) {
  let text = reference(task);
  for (const [from, to] of edits) {
    if (!text.includes(from)) throw new Error(`${task}: '${from}' is not in the reference`);
    text = text.replace(from, to);
  }
  return text;
}

const LAUNCH_09 = "    stone.position.x = Math.min(stone.position.x + 2 * power, RIGHT_LIMIT);\n    power = 0;\n";
const HANDLERS_09 = (() => {
  const text = reference("interaction-09");
  const start = text.indexOf('  host.onKeyDown("Space"');
  const end = text.indexOf("  return {");
  return text.slice(start, end);
})();

const SHIP_UPDATE = (() => {
  const text = reference("interaction-10");
  const start = text.indexOf("    update(dt) {");
  const end = text.indexOf("  };\n});");
  return text.slice(start, end);
})();

const candidates = [
  // ---- interaction-09
  {
    task: "interaction-09",
    name: "launch-on-press",
    kind: "mutant",
    source: edit("interaction-09", [
      ["    pulled = true;\n    stoneMaterial.color.copy(srgb(ORANGE));\n", `    pulled = true;\n    stoneMaterial.color.copy(srgb(ORANGE));\n${LAUNCH_09}`],
      [`    stoneMaterial.color.copy(srgb(YELLOW));\n${LAUNCH_09}`, "    stoneMaterial.color.copy(srgb(YELLOW));\n"],
    ]),
  },
  { task: "interaction-09", name: "up-without-space", kind: "mutant", source: edit("interaction-09", [["    if (pulled) power = Math.min", "    power = Math.min"]]) },
  { task: "interaction-09", name: "no-right-limit", kind: "mutant", source: edit("interaction-09", [["Math.min(stone.position.x + 2 * power, RIGHT_LIMIT)", "stone.position.x + 2 * power"]]) },
  { task: "interaction-09", name: "power-not-reset", kind: "mutant", source: edit("interaction-09", [["    power = 0;\n  });", "  });"]]) },
  {
    task: "interaction-09",
    name: "polling-edges-in-update",
    kind: "mutant",
    source: edit("interaction-09", [
      [HANDLERS_09, "  let wasSpace = false;\n  let wasUp = false;\n\n"],
      [
        "    update() {\n",
        `    update() {
      const space = host.isKeyDown("Space");
      const up = host.isKeyDown("ArrowUp");
      if (space && !wasSpace) {
        pulled = true;
        stoneMaterial.color.copy(srgb(ORANGE));
      }
      if (up && !wasUp && pulled) power = Math.min(power + 1, MAX_POWER);
      if (!space && wasSpace) {
        pulled = false;
        stoneMaterial.color.copy(srgb(YELLOW));
${LAUNCH_09}      }
      wasSpace = space;
      wasUp = up;
`,
      ],
    ]),
  },
  { task: "interaction-09", name: "isKeyDown-in-the-up-handler", kind: "mutant", source: edit("interaction-09", [["    if (pulled) power", '    if (host.isKeyDown("Space")) power']]) },
  {
    task: "interaction-09",
    name: "alt-colour-in-update",
    kind: "alternate",
    source: edit("interaction-09", [
      ["    pulled = true;\n    stoneMaterial.color.copy(srgb(ORANGE));\n", "    pulled = true;\n"],
      ["    stoneMaterial.color.copy(srgb(YELLOW));\n", ""],
      ["    update() {\n", "    update() {\n      stoneMaterial.color.copy(srgb(pulled ? ORANGE : YELLOW));\n"],
    ]),
  },
  // ---- interaction-10
  {
    task: "interaction-10",
    name: "move-once-per-press",
    kind: "mutant",
    source: edit("interaction-10", [
      [SHIP_UPDATE, "  };\n".slice(0, 0)],
    ]).replace(
      "  return {",
      `  host.onKeyDown("ArrowRight", () => ship.position.set(clamp(ship.position.x + 0.5), ship.position.y, 0));
  host.onKeyDown("ArrowLeft", () => ship.position.set(clamp(ship.position.x - 0.5), ship.position.y, 0));
  host.onKeyDown("ArrowUp", () => ship.position.set(ship.position.x, clamp(ship.position.y + 0.5), 0));
  host.onKeyDown("ArrowDown", () => ship.position.set(ship.position.x, clamp(ship.position.y - 0.5), 0));

  return {`,
    ),
  },
  { task: "interaction-10", name: "half-a-unit-per-frame", kind: "mutant", source: edit("interaction-10", [["const SPEED = 8;", "const SPEED = 8;\nconst PER_FRAME = 0.5;"], ["SPEED * dt", "PER_FRAME"], ["SPEED * dt", "PER_FRAME"], ["SPEED * dt", "PER_FRAME"], ["SPEED * dt", "PER_FRAME"]]) },
  { task: "interaction-10", name: "moves-in-fixedUpdate", kind: "mutant", source: edit("interaction-10", [["    update(dt) {", "    fixedUpdate(dt) {"]]) },
  {
    task: "interaction-10",
    name: "release-ignored",
    kind: "mutant",
    source: edit("interaction-10", [
      [SHIP_UPDATE, ""],
    ]).replace(
      "  return {",
      `  let vx = 0;
  let vy = 0;
  host.onKeyDown("ArrowRight", () => (vx = 1));
  host.onKeyDown("ArrowLeft", () => (vx = -1));
  host.onKeyDown("ArrowUp", () => (vy = 1));
  host.onKeyDown("ArrowDown", () => (vy = -1));

  return {`,
    ).replace(
      '    clearColor: "#202020",\n',
      '    clearColor: "#202020",\n    update(dt) {\n      ship.position.set(clamp(ship.position.x + vx * SPEED * dt), clamp(ship.position.y + vy * SPEED * dt), 0);\n    },\n',
    ),
  },
  {
    task: "interaction-10",
    name: "else-if-chains",
    kind: "mutant",
    source: edit("interaction-10", [
      ['      if (host.isKeyDown("ArrowLeft"))', '      else if (host.isKeyDown("ArrowLeft"))'],
      ['      if (host.isKeyDown("ArrowDown"))', '      else if (host.isKeyDown("ArrowDown"))'],
    ]),
  },
  {
    task: "interaction-10",
    name: "previous-frame-state",
    kind: "mutant",
    source: edit("interaction-10", [
      ["void startTask((host) => {", 'const previous = new Set<string>();\n\nvoid startTask((host) => {'],
      ['host.isKeyDown("ArrowRight")', 'previous.has("ArrowRight")'],
      ['host.isKeyDown("ArrowLeft")', 'previous.has("ArrowLeft")'],
      ['host.isKeyDown("ArrowUp")', 'previous.has("ArrowUp")'],
      ['host.isKeyDown("ArrowDown")', 'previous.has("ArrowDown")'],
      [
        "      ship.position.set(clamp(ship.position.x + dx), clamp(ship.position.y + dy), 0);\n",
        '      ship.position.set(clamp(ship.position.x + dx), clamp(ship.position.y + dy), 0);\n      previous.clear();\n      for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) if (host.isKeyDown(key)) previous.add(key);\n',
      ],
    ]),
  },
  {
    task: "interaction-10",
    name: "alt-handler-flags",
    kind: "alternate",
    source: edit("interaction-10", [
      ["  return {", `  const down = new Set<string>();
  for (const code of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
    host.onKeyDown(code, () => down.add(code));
    host.onKeyUp(code, () => down.delete(code));
  }

  return {`],
      ['host.isKeyDown("ArrowRight")', 'down.has("ArrowRight")'],
      ['host.isKeyDown("ArrowLeft")', 'down.has("ArrowLeft")'],
      ['host.isKeyDown("ArrowUp")', 'down.has("ArrowUp")'],
      ['host.isKeyDown("ArrowDown")', 'down.has("ArrowDown")'],
    ]),
  },
  // ---- interaction-11
  {
    task: "interaction-11",
    name: "one-tick-per-frame",
    kind: "mutant",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      ["      glide += 6 * dt;\n", "      glide += 6 * dt;\n      ticks += 1;\n"],
    ]),
  },
  {
    task: "interaction-11",
    name: "whole-steps-of-this-frame-only",
    kind: "mutant",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      ["      glide += 6 * dt;\n", "      glide += 6 * dt;\n      ticks += Math.floor(dt * 60);\n"],
    ]),
  },
  {
    task: "interaction-11",
    name: "glider-moves-per-tick",
    kind: "mutant",
    source: edit("interaction-11", [
      ["      ticks += 1;\n", "      ticks += 1;\n      glide += 0.1;\n"],
      ["      glide += 6 * dt;\n", ""],
    ]),
  },
  {
    task: "interaction-11",
    name: "glider-moves-per-frame",
    kind: "mutant",
    source: edit("interaction-11", [["glide += 6 * dt;", "glide += 0.1;"]]),
  },
  {
    task: "interaction-11",
    name: "own-clock-no-cap",
    kind: "mutant",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      ["      glide += 6 * dt;\n", "      glide += 6 * dt;\n      acc += dt;\n      const whole = Math.floor(acc / STEP);\n      ticks += whole;\n      acc -= whole * STEP;\n"],
      ["  let ticks = 0;\n", "  let ticks = 0;\n  let acc = 0;\n"],
      ["void startTask(", "const STEP = 1 / 60;\n\nvoid startTask("],
    ]),
  },
  {
    task: "interaction-11",
    name: "own-clock-keeps-the-backlog",
    kind: "mutant",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      ["      glide += 6 * dt;\n", "      glide += 6 * dt;\n      acc += dt;\n      const run = Math.min(Math.floor(acc / STEP), 4);\n      ticks += run;\n      acc -= run * STEP;\n"],
      ["  let ticks = 0;\n", "  let ticks = 0;\n  let acc = 0;\n"],
      ["void startTask(", "const STEP = 1 / 60;\n\nvoid startTask("],
    ]),
  },
  {
    task: "interaction-11",
    name: "own-clock-drops-the-fraction-too",
    kind: "mutant",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      [
        "      glide += 6 * dt;\n",
        "      glide += 6 * dt;\n      acc += dt;\n      const whole = Math.floor(acc / STEP);\n      ticks += Math.min(whole, 4);\n      acc = whole > 4 ? 0 : acc - whole * STEP;\n",
      ],
      ["  let ticks = 0;\n", "  let ticks = 0;\n  let acc = 0;\n"],
      ["void startTask(", "const STEP = 1 / 60;\n\nvoid startTask("],
    ]),
  },
  {
    task: "interaction-11",
    name: "alt-own-clock-in-update",
    kind: "alternate",
    source: edit("interaction-11", [
      ["    fixedUpdate() {\n      ticks += 1;\n    },\n", ""],
      [
        "      glide += 6 * dt;\n",
        "      glide += 6 * dt;\n      acc += dt;\n      const whole = Math.floor(acc / STEP);\n      ticks += Math.min(whole, 4);\n      acc -= whole * STEP;\n",
      ],
      ["  let ticks = 0;\n", "  let ticks = 0;\n  let acc = 0;\n"],
      ["void startTask(", "const STEP = 1 / 60;\n\nvoid startTask("],
    ]),
  },
];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(action) {
  if (LOCK === undefined) return action();
  for (let attempt = 0; ; attempt += 1) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      if (attempt > 360) throw new Error("the GPU lock was not released");
      sleep(5000);
    }
  }
  try {
    return action();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

const results = [];
for (const candidate of candidates) {
  if (!candidate.task.includes(filter)) continue;
  const directory = join(REPO, "benchmarks", "tasks", candidate.task, "zz-candidate");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, "src"), { recursive: true });
  cpSync(join(REPO, "benchmarks", "tasks", candidate.task, "reference", "baseline", "tsconfig.json"), join(directory, "tsconfig.json"));
  writeFileSync(join(directory, "src", "main.ts"), candidate.source);
  try {
    const run = withLock(() =>
      spawnSync("npm", ["run", "test:benchmarks", "--", "--grep", `${candidate.task} `], {
        cwd: REPO,
        encoding: "utf8",
        shell: true,
        maxBuffer: 1 << 26,
        env: { ...process.env, MTEK_REQUIRE_GPU: "1", MTEK_BASELINE_DIR: directory },
      }),
    );
    const output = `${run.stdout}\n${run.stderr}`;
    const summary = /benchmarks: (\d+) passed \/ (\d+) failed \/ (\d+) not-run/.exec(output);
    const passed = summary === null ? -1 : Number(summary[1]);
    const failed = summary === null ? -1 : Number(summary[2]);
    const expectFail = candidate.kind === "mutant";
    results.push({
      task: candidate.task,
      name: candidate.name,
      kind: candidate.kind,
      passed,
      failed,
      ok: summary !== null && (expectFail ? failed > 0 : failed === 0 && passed > 0),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const summary = {
  total: results.length,
  ok: results.filter((r) => r.ok).length,
  unexpected: results.filter((r) => !r.ok).map((r) => `${r.task}/${r.name}`),
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = summary.unexpected.length === 0 ? 0 : 1;
