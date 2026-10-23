// Decision 0177: `Wide.position = v` and `Wide.position.x` address the camera named Wide, not the active one.
// `fixtures/m6/camera_named` has two cameras (Main is active); its declarative fixture checks, through `mtek test` on the real
// CLI and runtime, that after `update` moved Wide, Wide reads back the new x and Main (still active) keeps its own.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "../../support/environment.ts";
import { expect, test } from "../../support/fixtures.ts";
import { cliPath } from "../../support/m1-fixtures.ts";
import { M6_FIXTURES_DIR } from "../../support/m6-fixtures.ts";

test("a write to a named camera moves that camera and not the active one", ({ gpu }) => {
  void gpu;
  test.setTimeout(240_000);
  const result = spawnSync(cliPath(), ["test", join(M6_FIXTURES_DIR, "camera_named"), "--format", "json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 240_000,
    windowsHide: true,
  });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  const report = JSON.parse(result.stdout) as { status: string; summary: { total: number; passed: number } };
  expect(report.status).toBe("pass");
  expect(report.summary.total).toBe(1);
  expect(report.summary.passed).toBe(1);
});
