// Validates the benchmark tasks (spec/ai-and-benchmarks.md section 6, decision 0018).
//
//   node benchmarks/tools/validate-tasks.mjs            validate this repository (npm run check:tasks)
//   node benchmarks/tools/validate-tasks.mjs --root DIR validate the repository rooted at DIR
//
// Checks, for every task under benchmarks/tasks/ and benchmarks/holdout/:
//   - task.toml: exactly the keys of decision 0018, category and mode values, budgets, id equal to
//     the directory name, ids unique across both directories;
//   - the six parts of the task format exist (mtek/, mtek-tests/, baseline/, baseline-tests/,
//     reference/mtek/, reference/baseline/) with their entry files;
//   - every mtek-tests/*.test.toml parses and uses only the fixture steps of spec/tooling.md
//     section 6 plus `set_input` (decision 0018), and asserts something;
//   - Mtek reference sources carry the UNVERIFIED header (the Mtek side cannot be compiled before M6);
//   - required_symbols occur in the Mtek reference (and in the starter of edit tasks).
// And for the benchmark set as a whole:
//   - no file under spec/, tools/, packages/, crates/, scripts/, docs/ or benchmarks/tools/ mentions
//     the id of a holdout task;
//   - benchmarks/holdout.sha256 equals the tree hash computed by hash-holdout.mjs.
//
// Dependency-free (Node built-ins only). Output is sorted and contains no timestamps or absolute paths.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { computeHoldoutHash, readRecordedHash } from "./hash-holdout.mjs";
import { isTable, parseToml, TomlError } from "./toml-subset.mjs";

/** @typedef {import("./toml-subset.mjs").TomlValue} TomlValue */
/** @typedef {import("./toml-subset.mjs").TomlTable} TomlTable */

export const CATEGORIES = ["scene-rendering", "interaction", "shader-bridge", "maintenance"];
export const MODES = ["cold", "edit"];
export const MTEK_SIDE_STATUSES = ["unverified-until-M6", "verified"];
const REQUIRED_KEYS = [
  "id",
  "category",
  "mode",
  "title",
  "prompt",
  "required_symbols",
  "mtek_side_status",
  "budgets",
];
const OPTIONAL_KEYS = ["starter_diagnostics"];
const BUDGET_KEYS = ["max_repairs", "max_output_tokens", "max_wall_seconds"];
/** Directories whose files must not mention a holdout id (paths relative to the repository root). */
export const HOLDOUT_SCAN_DIRS = [
  "spec",
  "tools",
  "packages",
  "crates",
  "scripts",
  "docs",
  "benchmarks/tools",
];
const SCAN_SKIPPED_DIRS = new Set(["node_modules", "dist", "target", ".out"]);
const TARGET_SIZE = 128;
const GITATTRIBUTES_RULE = "benchmarks/holdout/** text eol=lf";

/** @param {string} path @returns {string} the path with "/" separators */
function posix(path) {
  return path.split(sep).join("/");
}

/** @param {string} path @returns {boolean} */
function isDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/** @param {string} path @returns {boolean} */
function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** @param {string} directory @returns {string[]} sorted entry names */
function listNames(directory) {
  return readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/** @param {string} directory @returns {string[]} sorted paths of all files below it, "/"-separated and relative to it */
function listFilesRecursive(directory) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current @param {string} prefix */
  const walk = (current, prefix) => {
    for (const name of listNames(current)) {
      const absolute = join(current, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(absolute).isDirectory()) walk(absolute, path);
      else files.push(path);
    }
  };
  walk(directory, "");
  return files;
}

/** @param {TomlValue | undefined} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** @param {TomlValue | undefined} value @returns {value is number} */
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Checks the keys of a table against allowed sets.
 * @param {TomlTable} table
 * @param {readonly string[]} required
 * @param {readonly string[]} optional
 * @param {string} where
 * @returns {string[]}
 */
function checkKeys(table, required, optional, where) {
  /** @type {string[]} */
  const errors = [];
  for (const key of required) if (!(key in table)) errors.push(`${where}: missing key '${key}'`);
  for (const key of Object.keys(table).sort()) {
    if (!required.includes(key) && !optional.includes(key)) errors.push(`${where}: unknown key '${key}'`);
  }
  return errors;
}

/**
 * @typedef {{
 *   id: string,
 *   category: string,
 *   mode: string,
 *   mtekSideStatus: string,
 *   requiredSymbols: string[],
 * }} TaskInfo
 */

/**
 * Validates task.toml. Returns the task facts needed by later checks, or null when there is no usable id.
 * @param {string} taskDir
 * @param {string} name directory name
 * @param {"tasks" | "holdout"} kind
 * @param {string} label path used in messages
 * @param {string[]} errors
 * @returns {TaskInfo | null}
 */
function validateTaskToml(taskDir, name, kind, label, errors) {
  const file = join(taskDir, "task.toml");
  if (!isFile(file)) {
    errors.push(`${label}/task.toml: missing`);
    return null;
  }
  /** @type {TomlTable} */
  let toml;
  try {
    toml = parseToml(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${label}/task.toml: ${error instanceof TomlError ? error.message : String(error)}`);
    return null;
  }
  const where = `${label}/task.toml`;
  errors.push(...checkKeys(toml, REQUIRED_KEYS, OPTIONAL_KEYS, where));

  const { id, category, mode, title, prompt, required_symbols: symbols, budgets } = toml;
  if (!isNonEmptyString(id)) {
    errors.push(`${where}: 'id' must be a non-empty string`);
  } else {
    if (id !== name) errors.push(`${where}: id '${id}' must equal the directory name '${name}'`);
    if (kind === "tasks") {
      if (!/^[a-z]+(?:-[a-z]+)*-\d{2}$/.test(id)) errors.push(`${where}: id '${id}' must look like <category>-NN`);
      else if (isNonEmptyString(category) && id !== `${category}-${id.slice(-2)}`) {
        errors.push(`${where}: id '${id}' must start with its category '${category}'`);
      }
    } else if (!/^holdout-\d{2}$/.test(id)) {
      errors.push(`${where}: a holdout id must look like holdout-NN, found '${id}'`);
    }
  }
  if (typeof category !== "string" || !CATEGORIES.includes(category)) {
    errors.push(`${where}: 'category' must be one of ${CATEGORIES.join(", ")}`);
  }
  if (typeof mode !== "string" || !MODES.includes(mode)) {
    errors.push(`${where}: 'mode' must be one of ${MODES.join(", ")}`);
  }
  if (!isNonEmptyString(title)) errors.push(`${where}: 'title' must be a non-empty string`);
  if (!isNonEmptyString(prompt)) errors.push(`${where}: 'prompt' must be a non-empty string`);
  if (typeof toml["mtek_side_status"] !== "string" || !MTEK_SIDE_STATUSES.includes(toml["mtek_side_status"])) {
    errors.push(`${where}: 'mtek_side_status' must be one of ${MTEK_SIDE_STATUSES.join(", ")}`);
  }
  /** @type {string[]} */
  const requiredSymbols = [];
  if (!Array.isArray(symbols) || symbols.length === 0) {
    errors.push(`${where}: 'required_symbols' must be a non-empty array of strings`);
  } else {
    for (const symbol of symbols) {
      if (typeof symbol === "string" && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(symbol)) {
        requiredSymbols.push(symbol);
      } else {
        errors.push(`${where}: required_symbols entries must be dotted identifiers, found ${JSON.stringify(symbol)}`);
      }
    }
  }
  const diagnostics = toml["starter_diagnostics"];
  if (diagnostics !== undefined) {
    if (!Array.isArray(diagnostics) || diagnostics.some((code) => typeof code !== "string" || !/^MTEK-E\d{4}$/.test(code))) {
      errors.push(`${where}: 'starter_diagnostics' must be an array of codes like "MTEK-E3102"`);
    }
  }
  if (budgets === undefined) {
    // already reported as a missing key
  } else if (!isTable(budgets)) {
    errors.push(`${where}: 'budgets' must be a table`);
  } else {
    errors.push(...checkKeys(budgets, BUDGET_KEYS, [], `${where} [budgets]`));
    for (const key of BUDGET_KEYS) {
      const value = budgets[key];
      if (value !== undefined && (!isNonNegativeInteger(value) || (key !== "max_repairs" && value === 0))) {
        errors.push(`${where} [budgets]: '${key}' must be ${key === "max_repairs" ? "a non-negative" : "a positive"} integer`);
      }
    }
  }
  if (!isNonEmptyString(id)) return null;
  // Problems found above were reported already; the remaining checks run on what is usable.
  return {
    id,
    category: typeof category === "string" ? category : "",
    mode: typeof mode === "string" ? mode : "",
    mtekSideStatus: typeof toml["mtek_side_status"] === "string" ? toml["mtek_side_status"] : "",
    requiredSymbols,
  };
}

/** @param {TomlValue | undefined} value @returns {value is number} */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates one step of a fixture (spec/tooling.md section 6 plus `set_input`, decision 0018).
 * @param {TomlValue} step
 * @param {string} where
 * @returns {{ errors: string[], asserts: boolean }}
 */
function validateStep(step, where) {
  /** @type {string[]} */
  const errors = [];
  if (!isTable(step)) return { errors: [`${where}: a step must be an inline table`], asserts: false };
  const keys = Object.keys(step).sort();
  if (keys.includes("step")) {
    if (keys.length !== 2 || !keys.includes("dt")) errors.push(`${where}: a 'step' needs exactly the keys step and dt`);
    const frames = step["step"];
    const dt = step["dt"];
    if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 1) errors.push(`${where}: step must be a positive integer`);
    if (!isFiniteNumber(dt) || dt <= 0) errors.push(`${where}: dt must be a positive number of seconds`);
    return { errors, asserts: false };
  }
  if (keys.length !== 1) return { errors: [`${where}: a step has exactly one action key, found ${keys.join(", ") || "none"}`], asserts: false };
  const [action] = keys;
  const value = step[/** @type {string} */ (action)];
  switch (action) {
    case "press":
    case "release":
      if (!isNonEmptyString(value)) errors.push(`${where}: ${action} must name a KeyboardEvent.code string`);
      return { errors, asserts: false };
    case "set_input":
      if (!isTable(value) || Object.keys(value).length !== 1) errors.push(`${where}: set_input must be a table with exactly one entry`);
      return { errors, asserts: false };
    case "expect_state":
      if (!isTable(value) || Object.keys(value).length === 0) errors.push(`${where}: expect_state must be a non-empty table`);
      return { errors, asserts: true };
    case "expect_pixel": {
      if (!isTable(value)) return { errors: [`${where}: expect_pixel must be a table`], asserts: true };
      errors.push(...checkKeys(value, ["x", "y", "color"], ["tolerance"], `${where} expect_pixel`));
      for (const axis of ["x", "y"]) {
        const coordinate = value[axis];
        if (coordinate !== undefined && (typeof coordinate !== "number" || !Number.isInteger(coordinate) || coordinate < 0 || coordinate >= TARGET_SIZE)) {
          errors.push(`${where}: expect_pixel.${axis} must be an integer in 0..${String(TARGET_SIZE - 1)}`);
        }
      }
      if (value["color"] !== undefined && (typeof value["color"] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value["color"]))) {
        errors.push(`${where}: expect_pixel.color must be "#rrggbb"`);
      }
      const tolerance = value["tolerance"];
      if (tolerance !== undefined && (typeof tolerance !== "number" || !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255)) {
        errors.push(`${where}: expect_pixel.tolerance must be an integer in 0..255`);
      }
      return { errors, asserts: true };
    }
    default:
      return { errors: [`${where}: unknown step '${String(action)}' (known: step, press, release, set_input, expect_state, expect_pixel)`], asserts: false };
  }
}

/**
 * @param {string} file absolute path of a fixture
 * @param {string} label path used in messages
 * @returns {string[]}
 */
function validateFixture(file, label) {
  /** @type {TomlTable} */
  let toml;
  try {
    toml = parseToml(readFileSync(file, "utf8"));
  } catch (error) {
    return [`${label}: ${error instanceof TomlError ? error.message : String(error)}`];
  }
  const errors = checkKeys(toml, ["name", "steps"], [], label);
  if (!isNonEmptyString(toml["name"])) errors.push(`${label}: 'name' must be a non-empty string`);
  const steps = toml["steps"];
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(`${label}: 'steps' must be a non-empty array`);
    return errors;
  }
  let asserts = false;
  for (const [index, step] of steps.entries()) {
    const result = validateStep(step, `${label} step ${String(index + 1)}`);
    errors.push(...result.errors);
    asserts ||= result.asserts;
  }
  if (!asserts) errors.push(`${label}: the fixture asserts nothing (no expect_pixel or expect_state step)`);
  return errors;
}

/**
 * Directories of the task format and the files that must exist in them.
 * @param {string} taskDir
 * @param {string} label
 * @param {TaskInfo} info
 * @param {string[]} errors
 */
function validateTaskTree(taskDir, label, info, errors) {
  const directories = ["mtek", "mtek-tests", "baseline", "baseline-tests", "reference/mtek", "reference/baseline"];
  for (const directory of directories) {
    const absolute = join(taskDir, ...directory.split("/"));
    if (!isDirectory(absolute)) errors.push(`${label}/${directory}/: missing directory`);
    else if (listNames(absolute).length === 0) errors.push(`${label}/${directory}/: empty directory`);
  }
  const entryFiles = [
    "mtek/mtek.toml",
    "mtek/src/main.mtek",
    "reference/mtek/mtek.toml",
    "reference/mtek/src/main.mtek",
    "baseline/src/main.ts",
    "reference/baseline/src/main.ts",
  ];
  for (const entry of entryFiles) {
    if (!isFile(join(taskDir, ...entry.split("/")))) errors.push(`${label}/${entry}: missing file`);
  }

  const fixtures = isDirectory(join(taskDir, "mtek-tests")) ? listNames(join(taskDir, "mtek-tests")) : [];
  if (fixtures.length > 0 && !fixtures.some((file) => file.endsWith(".test.toml"))) {
    errors.push(`${label}/mtek-tests/: no *.test.toml fixture`);
  }
  for (const file of fixtures) {
    if (file.endsWith(".test.toml")) errors.push(...validateFixture(join(taskDir, "mtek-tests", file), `${label}/mtek-tests/${file}`));
    else errors.push(`${label}/mtek-tests/${file}: only *.test.toml fixtures belong here`);
  }
  const specs = isDirectory(join(taskDir, "baseline-tests")) ? listNames(join(taskDir, "baseline-tests")) : [];
  if (specs.length > 0 && !specs.some((file) => file.endsWith(".spec.ts"))) {
    errors.push(`${label}/baseline-tests/: no *.spec.ts test`);
  }

  // Mtek references are unverified until M6-07: every source carries the header.
  const referenceDir = join(taskDir, "reference", "mtek");
  const referenceSources = isDirectory(referenceDir) ? listFilesRecursive(referenceDir).filter((file) => file.endsWith(".mtek")) : [];
  for (const file of referenceSources) {
    const firstLine = readFileSync(join(referenceDir, ...file.split("/")), "utf8").split("\n")[0] ?? "";
    if (info.mtekSideStatus === "unverified-until-M6" && !firstLine.startsWith("// UNVERIFIED")) {
      errors.push(`${label}/reference/mtek/${file}: the first line must be an '// UNVERIFIED ...' comment while mtek_side_status is unverified-until-M6`);
    }
  }
  const sourceText = (/** @type {string} */ directory) => {
    const absolute = join(taskDir, ...directory.split("/"));
    if (!isDirectory(absolute)) return "";
    return listFilesRecursive(absolute)
      .filter((file) => file.endsWith(".mtek"))
      .map((file) => readFileSync(join(absolute, ...file.split("/")), "utf8"))
      .join("\n");
  };
  const checkSymbols = (/** @type {string} */ where, /** @type {string} */ text) => {
    for (const symbol of info.requiredSymbols) {
      for (const part of symbol.split(".")) {
        if (!new RegExp(`\\b${part}\\b`).test(text)) {
          errors.push(`${label}/${where}: required symbol '${symbol}' is not declared (no '${part}' in the Mtek sources)`);
          break;
        }
      }
    }
  };
  checkSymbols("reference/mtek", sourceText("reference/mtek"));
  if (info.mode === "edit") checkSymbols("mtek", sourceText("mtek"));
}

/**
 * Every file below the scanned directories must not contain a holdout id.
 * @param {string} repoRoot
 * @param {readonly string[]} ids
 * @param {string[]} errors
 * @returns {number} the number of files scanned
 */
function scanForHoldoutIds(repoRoot, ids, errors) {
  if (ids.length === 0) return 0;
  const needles = ids.map((id) => ({ id, bytes: Buffer.from(id, "utf8") }));
  let scanned = 0;
  /** @param {string} directory */
  const walk = (directory) => {
    for (const name of listNames(directory)) {
      const absolute = join(directory, name);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        if (!SCAN_SKIPPED_DIRS.has(name)) walk(absolute);
        continue;
      }
      const bytes = readFileSync(absolute);
      if (bytes.includes(0)) continue; // binary
      scanned += 1;
      for (const needle of needles) {
        if (bytes.includes(needle.bytes)) {
          errors.push(`${posix(relative(repoRoot, absolute))}: mentions the holdout id '${needle.id}' (holdout ids must not appear in design material)`);
        }
      }
    }
  };
  for (const directory of HOLDOUT_SCAN_DIRS) {
    const absolute = join(repoRoot, ...directory.split("/"));
    if (isDirectory(absolute)) walk(absolute);
  }
  return scanned;
}

/**
 * @typedef {{ errors: string[], lines: string[] }} ValidationResult
 * @param {string} repoRoot
 * @returns {ValidationResult} errors (empty when valid) and report lines
 */
export function validateBenchmarks(repoRoot) {
  const benchmarks = join(repoRoot, "benchmarks");
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string, string>} */
  const idOwners = new Map();
  /** @type {string[]} */
  const holdoutIds = [];
  /** @type {string[]} */
  const taskLines = [];
  let taskCount = 0;
  let holdoutCount = 0;

  for (const kind of /** @type {const} */ (["tasks", "holdout"])) {
    const root = join(benchmarks, kind);
    if (!isDirectory(root)) {
      errors.push(`benchmarks/${kind}/: missing directory`);
      continue;
    }
    for (const name of listNames(root)) {
      const taskDir = join(root, name);
      const label = `benchmarks/${kind}/${name}`;
      if (!isDirectory(taskDir)) {
        errors.push(`${label}: only task directories belong in benchmarks/${kind}/`);
        continue;
      }
      if (kind === "tasks") taskCount += 1;
      else holdoutCount += 1;
      const info = validateTaskToml(taskDir, name, kind, label, errors);
      if (info === null) continue;
      const owner = idOwners.get(info.id);
      if (owner !== undefined) errors.push(`${label}/task.toml: id '${info.id}' is already used by ${owner}`);
      else idOwners.set(info.id, label);
      if (kind === "holdout") holdoutIds.push(info.id);
      validateTaskTree(taskDir, label, info, errors);
      taskLines.push(`  ${info.id}  ${info.category}  ${info.mode}  mtek_side_status=${info.mtekSideStatus}`);
    }
  }
  if (holdoutCount === 0) errors.push("benchmarks/holdout/: no holdout task (M0 requires at least one)");
  lines.push(`benchmarks: ${String(taskCount)} task${taskCount === 1 ? "" : "s"}, ${String(holdoutCount)} holdout task${holdoutCount === 1 ? "" : "s"}`);
  lines.push(...taskLines.sort());

  // The holdout tree hash (decision 0018).
  const holdoutDir = join(benchmarks, "holdout");
  const hashFile = join(benchmarks, "holdout.sha256");
  if (isDirectory(holdoutDir)) {
    try {
      const computed = computeHoldoutHash(holdoutDir);
      const recorded = readRecordedHash(hashFile);
      if (recorded === null) {
        errors.push("benchmarks/holdout.sha256: missing (create it with `node benchmarks/tools/hash-holdout.mjs --write`)");
      } else if (recorded !== computed) {
        errors.push(
          `benchmarks/holdout.sha256: recorded ${recorded} but the holdout tree hashes to ${computed}; ` +
            "the holdout changed (if intended: node benchmarks/tools/hash-holdout.mjs --write, and say why in the commit)",
        );
      } else {
        lines.push(`holdout hash: ${computed} (matches benchmarks/holdout.sha256)`);
      }
    } catch (error) {
      errors.push(`benchmarks/holdout: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The .gitattributes rule that makes the hash platform independent.
  const attributes = join(repoRoot, ".gitattributes");
  if (!isFile(attributes) || !readFileSync(attributes, "utf8").split("\n").includes(GITATTRIBUTES_RULE)) {
    errors.push(`.gitattributes: missing the line '${GITATTRIBUTES_RULE}' (LF checkout of the holdout tree)`);
  }

  const scanned = scanForHoldoutIds(repoRoot, holdoutIds, errors);
  if (holdoutIds.length > 0) lines.push(`holdout id scan: ${String(scanned)} files in ${HOLDOUT_SCAN_DIRS.join(", ")}`);
  return { errors, lines };
}

/** @param {string[]} argv @returns {number} the process exit code */
function main(argv) {
  let repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (argv.length === 2 && argv[0] === "--root" && argv[1] !== undefined) repoRoot = resolve(argv[1]);
  else if (argv.length > 0) {
    process.stderr.write("usage: validate-tasks.mjs [--root DIR]\n");
    return 2;
  }
  const { errors, lines } = validateBenchmarks(repoRoot);
  for (const line of lines) process.stdout.write(`${line}\n`);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`error: ${error}\n`);
    process.stderr.write(`validate-tasks: ${String(errors.length)} error${errors.length === 1 ? "" : "s"}\n`);
    return 1;
  }
  process.stdout.write("validate-tasks: OK\n");
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
