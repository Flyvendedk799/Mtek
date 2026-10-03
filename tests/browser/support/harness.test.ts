// Unit tests of the harness: NOT-RUN classification and the GPU gate, the environment schema and
// the static server. These run without a browser (`npm run test:unit`).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EnvironmentRecord } from "./environment-types.ts";
import { validateEnvironment } from "./environment.ts";
import {
  addOutcome,
  classify,
  emptyCounts,
  evaluateGate,
  formatSummary,
  type Counts,
  type ProjectEnvironment,
} from "./run-summary.ts";
import { mimeTypeFor, resolveRequestPath, startStaticServer, type StaticServer } from "./serve.ts";

function counts(partial: Partial<Counts>): Counts {
  return { ...emptyCounts(), ...partial };
}

describe("classify", () => {
  it("counts a NOT-RUN skip as not-run, never as passed", () => {
    expect(
      classify({
        project: "hardware",
        status: "skipped",
        annotations: [{ type: "skip", description: "NOT-RUN: no WebGPU adapter (see environment.json)" }],
      }),
    ).toBe("not-run");
  });
  it("keeps other skips separate from not-run", () => {
    expect(classify({ project: "p", status: "skipped", annotations: [{ type: "skip" }] })).toBe("skipped");
  });
  it("maps passed and every failing status", () => {
    expect(classify({ project: "p", status: "passed", annotations: [] })).toBe("passed");
    for (const status of ["failed", "timedOut", "interrupted"] as const) {
      expect(classify({ project: "p", status, annotations: [] })).toBe("failed");
    }
  });
  it("accumulates outcomes", () => {
    const c = emptyCounts();
    for (const outcome of ["passed", "failed", "not-run", "skipped", "not-run"] as const) {
      addOutcome(c, outcome);
    }
    expect(c).toEqual({ passed: 1, failed: 1, notRun: 2, skipped: 1 });
  });
});

describe("evaluateGate", () => {
  const hardware: ProjectEnvironment = { problems: [], isFallbackAdapter: false };
  const fallback: ProjectEnvironment = { problems: [], isFallbackAdapter: true };
  const base = { acceptSoftware: false, softwareProjects: new Set(["software"]) };

  it("tolerates NOT-RUN without MTEK_REQUIRE_GPU", () => {
    const perProject = new Map([["hardware", { counts: counts({ notRun: 3 }), environment: null }]]);
    expect(evaluateGate({ ...base, requireGpu: false, perProject })).toEqual([]);
  });
  it("fails on NOT-RUN with MTEK_REQUIRE_GPU=1", () => {
    const perProject = new Map([["hardware", { counts: counts({ notRun: 1 }), environment: fallback }]]);
    const failures = evaluateGate({ ...base, requireGpu: true, perProject });
    expect(failures.some((f) => f.includes("NOT-RUN"))).toBe(true);
  });
  it("fails on a fallback adapter in a hardware project unless software is accepted", () => {
    const perProject = new Map([["hardware", { counts: counts({ passed: 2 }), environment: fallback }]]);
    expect(evaluateGate({ ...base, requireGpu: true, perProject })).toHaveLength(1);
    expect(evaluateGate({ ...base, requireGpu: true, acceptSoftware: true, perProject })).toEqual([]);
  });
  it("does not require a hardware adapter from the software project", () => {
    const perProject = new Map([["software", { counts: counts({ passed: 2 }), environment: fallback }]]);
    expect(evaluateGate({ ...base, requireGpu: true, perProject })).toEqual([]);
  });
  it("passes a hardware adapter with no NOT-RUN", () => {
    const perProject = new Map([["hardware", { counts: counts({ passed: 4 }), environment: hardware }]]);
    expect(evaluateGate({ ...base, requireGpu: true, perProject })).toEqual([]);
  });
  it("fails when tests ran but no environment record exists under MTEK_REQUIRE_GPU=1", () => {
    const perProject = new Map([["hardware", { counts: counts({ passed: 1 }), environment: null }]]);
    expect(evaluateGate({ ...base, requireGpu: true, perProject })).toHaveLength(1);
  });
  it("always fails on an invalid environment record", () => {
    const perProject = new Map([
      [
        "hardware",
        { counts: counts({ passed: 1 }), environment: { problems: ["(root) must have required property 'gpu'"], isFallbackAdapter: null } },
      ],
    ]);
    expect(evaluateGate({ ...base, requireGpu: false, perProject })).toHaveLength(1);
  });
  it("prints passed, failed and not-run separately", () => {
    const perProject = new Map([["hardware", { counts: counts({ passed: 2, notRun: 1 }), environment: null }]]);
    const text = formatSummary(perProject, []);
    expect(text).toContain("2 passed / 0 failed / 1 not-run");
    expect(text).toContain("not counted as passed");
  });
});

function sampleRecord(adapter: EnvironmentRecord["gpu"]["adapter"], reason: string | null): EnvironmentRecord {
  return {
    schemaVersion: 1,
    project: "hardware",
    recordedAt: "2026-10-03T00:00:00.000Z",
    os: { platform: "win32", release: "10.0.26200", version: "Windows 11 Pro", arch: "x64" },
    browser: { name: "chromium", channel: "chromium", version: "153.0.8010.12", headless: true, launchArgs: [] },
    userAgent: "ua",
    devicePixelRatio: 1,
    renderTargetSize: { width: 128, height: 128 },
    gpu: { navigatorGpu: true, reason, adapter, wgslLanguageFeatures: [] },
    source: { gitCommit: "abc", gitDirty: false },
    toolchain: { rustc: "rustc 1.99.0", naga: "not in Cargo.lock", node: "v24.18.1", playwright: "1.63.0", runtimeWeb: "0.1.0-dev" },
    settings: { requireGpu: false, acceptSoftware: false },
  };
}

describe("environment.schema.json", () => {
  const adapter = {
    info: { vendor: "amd", architecture: "rdna-3", device: "", description: "", isFallbackAdapter: false },
    adapterFeatures: [],
    deviceFeatures: [],
    limits: { maxBindGroups: 4 },
  };
  it("accepts a record with an adapter", () => {
    expect(validateEnvironment(sampleRecord(adapter, null))).toEqual([]);
  });
  it("accepts a record without an adapter when it says why", () => {
    expect(validateEnvironment(sampleRecord(null, "navigator.gpu is undefined"))).toEqual([]);
  });
  it("rejects a record without an adapter and without a reason", () => {
    expect(validateEnvironment(sampleRecord(null, null)).length).toBeGreaterThan(0);
  });
  it("rejects missing and unknown fields", () => {
    const missing: Record<string, unknown> = { ...sampleRecord(adapter, null) };
    delete missing["toolchain"];
    expect(validateEnvironment(missing).length).toBeGreaterThan(0);
    expect(validateEnvironment({ ...sampleRecord(adapter, null), extra: 1 }).length).toBeGreaterThan(0);
  });
  it("rejects a non-boolean isFallbackAdapter", () => {
    const bad = sampleRecord({ ...adapter, info: { ...adapter.info, isFallbackAdapter: "no" as unknown as boolean } }, null);
    expect(validateEnvironment(bad).length).toBeGreaterThan(0);
  });
});

describe("static server", () => {
  let root: string;
  let server: StaticServer;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "mtek-serve-"));
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    writeFileSync(join(root, "a.js"), "export {};");
    writeFileSync(join(root, "m.wasm"), new Uint8Array([0, 97, 115, 109]));
    writeFileSync(join(root, "data.json"), "{}");
    writeFileSync(join(root, "s.wgsl"), "@vertex fn v() {}");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "x.txt"), "x");
    server = await startStaticServer(root);
  });
  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("serves the required MIME types with no caching", async () => {
    const expected: Record<string, string> = {
      "/index.html": "text/html",
      "/a.js": "text/javascript",
      "/m.wasm": "application/wasm",
      "/data.json": "application/json",
      "/s.wgsl": "text/plain",
    };
    for (const [path, type] of Object.entries(expected)) {
      const response = await fetch(server.url + path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(type);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await response.arrayBuffer();
    }
  });
  it("serves the directory index and nested files", async () => {
    expect(await (await fetch(server.url + "/")).text()).toBe("<!doctype html>");
    expect(await (await fetch(server.url + "/sub/x.txt")).text()).toBe("x");
  });
  it("returns 404 for a missing file and 405 for POST", async () => {
    expect((await fetch(server.url + "/missing.js")).status).toBe(404);
    expect((await fetch(server.url + "/a.js", { method: "POST" })).status).toBe(405);
  });
  it("binds to 127.0.0.1", () => {
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
  });
  it("rejects paths that leave the root", () => {
    expect(resolveRequestPath(root, "/../secret")).toBeNull();
    expect(resolveRequestPath(root, "/%2e%2e/secret")).toBeNull();
    expect(resolveRequestPath(root, "/a%00.js")).toBeNull();
    expect(resolveRequestPath(root, "/sub/x.txt")).toBe(join(root, "sub", "x.txt"));
    expect(mimeTypeFor("unknown.xyz")).toBe("application/octet-stream");
  });
});
