// Runs the integration suite (src/integration/suite.ts) in a real VS Code: downloads that VS Code
// (cached in target/vscode-test/), opens a temporary project as the workspace folder, points
// `mtek.server.path` at the binary `npm run build` made, and checks the suite's own record of what
// it ran. Nothing is "skipped": a VS Code that cannot be downloaded or started is a failure here
// (exit 1, and the message says NOT-RUN), never a pass.
//
//   npm run test:integration -w mtek-vscode
//
// Environment: MTEK_BIN (the binary; default target/debug/mtek beside this checkout),
// VSCODE_VERSION (default: the pinned one below), VSCODE_TEST_EXECUTABLE (an installed VS Code to
// use instead of downloading one).
//
// On a machine without a display (Linux CI) run it under `xvfb-run -a`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { PROJECT_FILES } from "../src/integration/fixture.ts";

/** The VS Code the suite is run on. Exact, so that a run is reproducible; the engine floor is ^1.91.0. */
const PINNED_VSCODE = "1.142.0";
const EXPECTED_TESTS = 10;

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");

function notRun(reason: string): never {
  console.error(`NOT-RUN: the VS Code integration tests did not run: ${reason}`);
  process.exit(1);
}

for (const built of ["dist/extension.cjs", "dist/test/suite.cjs"]) {
  if (!existsSync(join(packageRoot, built))) notRun(`${built} does not exist: run \`npm run build\` first`);
}
const binary =
  process.env["MTEK_BIN"] ??
  join(repoRoot, "target", "debug", process.platform === "win32" ? "mtek.exe" : "mtek");
if (!existsSync(binary)) notRun(`${binary} does not exist: run \`npm run build\` (or set MTEK_BIN)`);
// the binary must start before VS Code is blamed for anything
const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
if (probe.status !== 0) notRun(`${binary} --version exited with ${String(probe.status)}`);

const scratch = mkdtempSync(join(tmpdir(), "mtek-vscode-it-"));
try {
  const project = join(scratch, "project");
  for (const [relative, text] of Object.entries(PROJECT_FILES)) {
    const file = join(project, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  const userData = join(scratch, "user-data");
  mkdirSync(join(userData, "User"), { recursive: true });
  writeFileSync(
    join(userData, "User", "settings.json"),
    JSON.stringify(
      {
        "mtek.server.path": binary,
        "security.workspace.trust.enabled": false,
        "update.mode": "none",
        "telemetry.telemetryLevel": "off",
        "workbench.startupEditor": "none",
        "extensions.autoUpdate": false,
      },
      null,
      2,
    ),
    "utf8",
  );
  const results = join(scratch, "results.json");

  const executable = process.env["VSCODE_TEST_EXECUTABLE"];
  let exitCode: number;
  try {
    exitCode = await runTests({
      ...(executable === undefined ? { version: process.env["VSCODE_VERSION"] ?? PINNED_VSCODE } : { vscodeExecutablePath: executable }),
      cachePath: join(repoRoot, "target", "vscode-test"),
      extensionDevelopmentPath: packageRoot,
      extensionTestsPath: join(packageRoot, "dist", "test", "suite.cjs"),
      extensionTestsEnv: { MTEK_TEST_RESULTS: results },
      launchArgs: [
        project,
        `--user-data-dir=${userData}`,
        `--extensions-dir=${join(scratch, "extensions")}`,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--disable-gpu",
        "--no-sandbox",
        "--skip-welcome",
        "--skip-release-notes",
      ],
    });
  } catch (error) {
    // `runTests` rejects when VS Code could not be downloaded or started, and also when the
    // suite's tests failed (VS Code exits non-zero): the record below tells which.
    if (!existsSync(results)) notRun(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  }

  if (!existsSync(results)) notRun("VS Code ran but the suite wrote no results");
  const outcomes = JSON.parse(readFileSync(results, "utf8")) as { name: string; ok: boolean; error?: string }[];
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? "ok  " : "FAIL"} ${outcome.name}`);
    if (!outcome.ok) console.log(outcome.error ?? "");
  }
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  console.log(`${outcomes.length - failed} passed, ${failed} failed, of ${outcomes.length} (VS Code exit code ${exitCode})`);
  if (outcomes.length !== EXPECTED_TESTS) {
    console.error(`expected ${EXPECTED_TESTS} integration tests, the suite ran ${outcomes.length}`);
    process.exit(1);
  }
  if (failed > 0 || exitCode !== 0) process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
