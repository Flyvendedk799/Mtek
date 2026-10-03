// Unit tests of the evidence sanitiser: machine-specific paths in a Playwright JSON report or an
// environment record become repo-relative POSIX paths or stable placeholders; everything else
// (timestamps, durations, ids, statuses, annotations) is unchanged.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeReport, sanitizeReportText } from "./sanitize-report.ts";

const WINDOWS_REPO = "C:\\Users\\dev\\Mtek\\.claude\\worktrees\\agent-1";
const WINDOWS_RESULTS = "C:\\Users\\dev\\AppData\\Local\\Temp\\run 1\\results";

/** A report shaped like Playwright's JSON reporter output, run from a Windows worktree. */
function windowsReport(): Record<string, unknown> {
  return {
    config: {
      configFile: `${WINDOWS_REPO}\\tests\\browser\\playwright.config.ts`,
      rootDir: "C:/Users/dev/Mtek/.claude/worktrees/agent-1/tests/browser/specs",
      globalSetup: `${WINDOWS_REPO}\\tests\\browser\\support\\global-setup.ts`,
      forbidOnly: false,
      workers: 1,
      reporter: [
        ["list"],
        ["json", { outputFile: `${WINDOWS_RESULTS}\\test-results.json` }],
        [`${WINDOWS_REPO}\\tests\\browser\\support\\not-run-reporter.ts`],
      ],
      projects: [
        {
          name: "hardware",
          outputDir: "C:/Users/dev/AppData/Local/Temp/run 1/results/artifacts",
          testDir: "C:/Users/dev/Mtek/.claude/worktrees/agent-1/tests/browser/specs",
        },
      ],
    },
    argv: ["C:\\Program Files\\nodejs\\node.exe", `${WINDOWS_REPO}\\node_modules\\@playwright\\test\\cli.js`],
    stats: { startTime: "2026-10-03T04:14:47.441Z", duration: 19989.09, expected: 74, unexpected: 0 },
    suites: [
      {
        title: "bridge/probe.spec.ts",
        file: "bridge/probe.spec.ts",
        specs: [
          {
            title: "mixed: random values are read back bit-exactly",
            ok: true,
            tests: [
              {
                annotations: [{ type: "seed", description: "123 (MTEK_TEST_SEED=default, mixed)" }],
                results: [
                  {
                    status: "passed",
                    duration: 245,
                    startTime: "2026-10-03T04:14:50.000Z",
                    errors: [
                      {
                        message: `Error: ENOENT ${WINDOWS_REPO}\\tests\\browser\\.out\\bridge\\mixed.probe.wgsl:12:3 (see ${WINDOWS_RESULTS}\\artifacts\\error-context.md)`,
                      },
                    ],
                    attachments: [{ name: "trace", path: `${WINDOWS_RESULTS}\\artifacts\\trace.zip` }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function leaks(text: string): string[] {
  return text.match(/[A-Za-z]:[\\/]|Users|AppData|\/home\/|\/tmp\/|worktrees/g) ?? [];
}

describe("sanitizeReport on a Windows report", () => {
  const sanitized = sanitizeReport(windowsReport()) as ReturnType<typeof windowsReport>;
  const config = sanitized["config"] as Record<string, unknown>;

  it("rewrites paths under the repo root to repo-relative POSIX paths, in both spellings", () => {
    expect(config["configFile"]).toBe("tests/browser/playwright.config.ts");
    expect(config["rootDir"]).toBe("tests/browser/specs");
    expect(config["globalSetup"]).toBe("tests/browser/support/global-setup.ts");
    const projects = config["projects"] as { testDir: string }[];
    expect(projects[0]?.testDir).toBe("tests/browser/specs");
    expect((config["reporter"] as unknown[][])[2]).toEqual(["tests/browser/support/not-run-reporter.ts"]);
    expect((sanitized["argv"] as string[])[1]).toBe("node_modules/@playwright/test/cli.js");
  });

  it("maps the results directory to <results> and other outside paths to <external>", () => {
    const projects = config["projects"] as { outputDir: string }[];
    expect(projects[0]?.outputDir).toBe("<results>/artifacts");
    expect((config["reporter"] as unknown[][])[1]).toEqual(["json", { outputFile: "<results>/test-results.json" }]);
    // A path with spaces that is the whole string is replaced whole.
    expect((sanitized["argv"] as string[])[0]).toBe("<external>");
  });

  it("rewrites paths embedded in messages and keeps line and column suffixes", () => {
    const suites = sanitized["suites"] as { specs: { tests: { results: { errors: { message: string }[] }[] }[] }[] }[];
    const error = suites[0]?.specs[0]?.tests[0]?.results[0]?.errors[0]?.message;
    expect(error).toBe(
      "Error: ENOENT tests/browser/.out/bridge/mixed.probe.wgsl:12:3 (see <results>/artifacts/error-context.md)",
    );
  });

  it("leaves timestamps, durations, ids, statuses and annotations unchanged", () => {
    const original = windowsReport();
    expect(sanitized["stats"]).toEqual(original["stats"]);
    const text = JSON.stringify(sanitized);
    expect(text).toContain('"startTime":"2026-10-03T04:14:47.441Z"');
    expect(text).toContain('"duration":19989.09');
    expect(text).toContain('"description":"123 (MTEK_TEST_SEED=default, mixed)"');
    expect(text).toContain('"file":"bridge/probe.spec.ts"');
    expect(text).toContain('"status":"passed"');
  });

  it("leaves no machine-specific path behind", () => {
    expect(leaks(JSON.stringify(sanitized))).toEqual([]);
  });

  it("is idempotent", () => {
    expect(sanitizeReport(sanitized)).toEqual(sanitized);
  });

  it("does not modify its input", () => {
    const input = windowsReport();
    sanitizeReport(input);
    expect(input).toEqual(windowsReport());
  });
});

describe("sanitizeReport on a POSIX report", () => {
  it("handles any checkout root and a results directory inside the repo", () => {
    const root = "/home/ci/work/mtek";
    const sanitized = sanitizeReport({
      config: {
        configFile: `${root}/tests/browser/playwright.config.ts`,
        rootDir: `${root}/tests/browser/specs`,
        reporter: [["json", { outputFile: `${root}/tests/browser/results/2026-10-03/test-results.json` }]],
        projects: [{ outputDir: `${root}/tests/browser/results/2026-10-03/artifacts` }],
      },
      errors: [{ message: `at ${root}/crates/x.rs:1 and /home/ci/.cargo/bin/cargo and /tmp/xyz/file` }],
    }) as { config: Record<string, unknown>; errors: { message: string }[] };
    expect(sanitized.config["configFile"]).toBe("tests/browser/playwright.config.ts");
    expect((sanitized.config["reporter"] as unknown[][])[0]).toEqual([
      "json",
      { outputFile: "<results>/test-results.json" },
    ]);
    expect((sanitized.config["projects"] as { outputDir: string }[])[0]?.outputDir).toBe("<results>/artifacts");
    expect(sanitized.errors[0]?.message).toBe("at crates/x.rs:1 and <external> and <external>");
  });

  it("does not touch URL paths or names that merely resemble roots", () => {
    const value = {
      url: "/bridge.html",
      full: "http://127.0.0.1:41234/bridge.html",
      sibling: "/home/ci/work/mtek-other/file.ts",
      relative: "tests/browser/specs",
    };
    const sanitized = sanitizeReport(
      { config: { configFile: "/home/ci/work/mtek/tests/browser/playwright.config.ts" }, ...value },
    ) as Record<string, unknown>;
    expect(sanitized["url"]).toBe("/bridge.html");
    expect(sanitized["full"]).toBe("http://127.0.0.1:41234/bridge.html");
    expect(sanitized["sibling"]).toBe("<external>");
    expect(sanitized["relative"]).toBe("tests/browser/specs");
  });
});

describe("sanitizeReport without a Playwright config", () => {
  it("leaves an environment record without paths unchanged", () => {
    const record = {
      schemaVersion: 1,
      project: "hardware",
      recordedAt: "2026-10-03T04:13:51.454Z",
      browser: { launchArgs: ["--enable-unsafe-webgpu"], version: "153.0.8010.12" },
      source: { gitCommit: "42befdc9b03d8587ad2818339aa7af7e20a896c0", gitDirty: false },
    };
    expect(sanitizeReport(record)).toEqual(record);
  });

  it("takes extra roots from the options", () => {
    const sanitized = sanitizeReport(
      { path: "D:\\build\\mtek\\crates\\a.rs", other: "D:\\elsewhere\\b.rs" },
      { repoRoots: ["D:/build/mtek"] },
    ) as Record<string, string>;
    expect(sanitized["path"]).toBe("crates/a.rs");
    expect(sanitized["other"]).toBe("<external>");
  });

  it("matches a Windows drive letter in either case", () => {
    const sanitized = sanitizeReport({ path: "c:\\build\\mtek\\a.rs" }, { repoRoots: ["C:/build/mtek"] }) as Record<
      string,
      string
    >;
    expect(sanitized["path"]).toBe("a.rs");
  });
});

describe("sanitizeReportText", () => {
  it("keeps the two-space indentation and the final newline", () => {
    const input = `${JSON.stringify({ a: { b: "C:\\x\\y" } }, null, 2)}\n`;
    expect(sanitizeReportText(input)).toBe(`${JSON.stringify({ a: { b: "<external>" } }, null, 2)}\n`);
    expect(sanitizeReportText(JSON.stringify({ a: 1 }, null, 2))).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("rejects text that is not JSON", () => {
    expect(() => sanitizeReportText("not json")).toThrow(/not valid JSON/);
  });
});

describe("command line", () => {
  let dir: string;
  const script = join(import.meta.dirname, "sanitize-report.ts");

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mtek-sanitize-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the sanitised report and prints what it did", () => {
    const input = join(dir, "in.json");
    const output = join(dir, "out.json");
    writeFileSync(input, `${JSON.stringify(windowsReport(), null, 2)}\n`);
    const stdout = execFileSync(process.execPath, [script, input, output], { encoding: "utf8" });
    expect(stdout).toContain("out.json");
    const written = readFileSync(output, "utf8");
    expect(leaks(written)).toEqual([]);
    expect(written).toContain('"configFile": "tests/browser/playwright.config.ts"');
    expect(written.endsWith("\n")).toBe(true);
  });

  it("fails with a usage message without two arguments", () => {
    const result = spawnSync(process.execPath, [script, "only-one.json"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });

  it("fails on a missing input file and leaves no output", () => {
    const output = join(dir, "never.json");
    const result = spawnSync(process.execPath, [script, join(dir, "missing.json"), output], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing.json");
  });
});
