// Node-side half of the environment record: OS, browser, launch arguments, git commit and the
// resolved toolchain versions, plus validation against `environment.schema.json`.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { arch, platform, release, version as osVersion } from "node:os";
import { resolve } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import type { EnvironmentRecord, PageEnvironment } from "./environment-types.ts";

const require = createRequire(import.meta.url);
const here = import.meta.dirname;
export const BROWSER_ROOT = resolve(here, "..");
export const REPO_ROOT = resolve(BROWSER_ROOT, "..", "..");

export function envFlag(name: string): boolean {
  return process.env[name] === "1";
}

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function packageVersion(path: string): string {
  const parsed = readJson(path);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const version = parsed.version;
    if (typeof version === "string") return version;
  }
  return "unknown";
}

/** The `naga` version resolved in Cargo.lock, or a note that the compiler does not depend on it yet. */
function nagaVersion(): string {
  let lock: string;
  try {
    lock = readFileSync(resolve(REPO_ROOT, "Cargo.lock"), "utf8");
  } catch {
    return "no Cargo.lock";
  }
  const match = /\[\[package\]\]\r?\nname = "naga"\r?\nversion = "([^"]+)"/.exec(lock);
  return match?.[1] ?? "not in Cargo.lock";
}

export interface BrowserDescription {
  name: string;
  channel: string;
  version: string;
  headless: boolean;
  launchArgs: string[];
}

export function buildEnvironmentRecord(
  project: string,
  page: PageEnvironment,
  browser: BrowserDescription,
): EnvironmentRecord {
  const status = run("git", ["status", "--porcelain"]);
  return {
    schemaVersion: 1,
    project,
    recordedAt: new Date().toISOString(),
    os: { platform: platform(), release: release(), version: osVersion(), arch: arch() },
    browser,
    userAgent: page.userAgent,
    devicePixelRatio: page.devicePixelRatio,
    renderTargetSize: page.renderTargetSize,
    gpu: page.gpu,
    source: {
      gitCommit: run("git", ["rev-parse", "HEAD"]) ?? "unknown",
      gitDirty: status === null ? true : status.length > 0,
    },
    toolchain: {
      rustc: run("rustc", ["--version"]) ?? "unavailable",
      naga: nagaVersion(),
      node: process.version,
      playwright: packageVersion(require.resolve("@playwright/test/package.json")),
      runtimeWeb: packageVersion(resolve(REPO_ROOT, "packages/runtime-web/package.json")),
    },
    settings: {
      requireGpu: envFlag("MTEK_REQUIRE_GPU"),
      acceptSoftware: envFlag("MTEK_ACCEPT_SOFTWARE"),
    },
  };
}

let validator: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (validator === undefined) {
    const ajv = new Ajv({ allErrors: true, strict: true });
    validator = ajv.compile(readJson(resolve(BROWSER_ROOT, "environment.schema.json")) as object);
  }
  return validator;
}

/** Returns the list of schema violations; empty when the record is valid. */
export function validateEnvironment(record: unknown): string[] {
  const validate = schemaValidator();
  if (validate(record)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath === "" ? "(root)" : error.instancePath} ${error.message ?? "invalid"}`,
  );
}

export function environmentFileName(project: string): string {
  return `environment-${project}.json`;
}
