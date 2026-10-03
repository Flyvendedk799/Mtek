/// <reference types="vite/client" />
/**
 * Runtime diagnostics are "JavaScript objects of exactly this shape" (spec/diagnostics.md section 2.3):
 * every diagnostic the mount code delivers must validate against spec/diagnostic.schema.json. The schema is
 * compiled with Ajv 2020 (a devDependency of this package, decision 0007), the same validator that
 * compiles the manifest schema.
 */
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { MtekMountError, makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { FakeHost, MANIFEST_URL } from "../test-support/fake-host.js";
import { BROKEN_WGSL, SHADER_URL, healthyHost, installProgram, mountOn } from "../test-support/mount-fixture.js";

const schemaFiles = import.meta.glob<string>("../../../../spec/diagnostic.schema.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const schemaText = Object.values(schemaFiles)[0];
if (schemaText === undefined) throw new Error("spec/diagnostic.schema.json is missing");

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(JSON.parse(schemaText) as object);

function problems(diagnostic: MtekDiagnostic): string[] {
  // The schema describes JSON documents: validate what a JSON round trip of the object would carry.
  const document: unknown = JSON.parse(JSON.stringify(diagnostic));
  return validate(document) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ""}`);
}

async function mountFailure(host: FakeHost): Promise<MtekMountError> {
  try {
    await mountOn(host);
  } catch (error) {
    if (error instanceof MtekMountError) return error;
    throw error;
  }
  throw new Error("expected the mount to fail");
}

describe("runtime diagnostics validate against spec/diagnostic.schema.json", () => {
  it("rejects a source span with line 0 (the validator is not vacuous)", () => {
    const bad = makeRuntimeDiagnostic("E8051", {
      phase: "runtime:mount",
      message: "x",
      source: { file: "a.mtek", startByte: 0, endByte: 1, startLine: 0, startColumn: 1, endLine: 1, endColumn: 2 },
    });
    expect(problems(bad)).not.toEqual([]);
  });

  it("accepts the diagnostics of a mount that fails in each way", async () => {
    const failing: Array<[string, () => FakeHost]> = [
      ["no WebGPU adapter", () => new FakeHost({ adapter: null })],
      ["no navigator.gpu", () => new FakeHost({ noGpu: true })],
      ["device below profile", () => {
        const host = new FakeHost();
        installProgram(host, (m) => {
          m["requiredCapabilities"] = { features: ["timestamp-query"], limits: { maxBufferSize: 999_999_999_999 }, wgslLanguageFeatures: [] };
        });
        return host;
      }],
      ["incompatible program", () => {
        const host = new FakeHost();
        installProgram(host, (m) => {
          m["runtimeAbi"] = 2;
        });
        return host;
      }],
      ["invalid manifest", () => {
        const host = healthyHost();
        host.files.set(MANIFEST_URL, JSON.stringify({ manifestSchema: 1, runtimeAbi: 1, languageVersion: "0.1" }));
        return host;
      }],
      ["manifest not found", () => {
        const host = healthyHost();
        host.files.delete(MANIFEST_URL);
        return host;
      }],
      ["shader error mapped through the span map", () => {
        const host = healthyHost();
        host.files.set(SHADER_URL, BROKEN_WGSL);
        return host;
      }],
      ["shader file missing", () => {
        const host = healthyHost();
        host.files.delete(SHADER_URL);
        return host;
      }],
      ["out of memory", () => {
        const host = new FakeHost({ adapter: { failAllocations: 1 } });
        installProgram(host);
        return host;
      }],
    ];
    for (const [name, make] of failing) {
      const error = await mountFailure(make());
      expect(error.diagnostics.length, name).toBeGreaterThan(0);
      for (const diagnostic of error.diagnostics) expect(problems(diagnostic), `${name}: ${diagnostic.code}`).toEqual([]);
    }
  });

  it("accepts the shader diagnostic with a resolved source: file, byte range and line/column range", async () => {
    const host = healthyHost();
    host.files.set(SHADER_URL, BROKEN_WGSL);
    const error = await mountFailure(host);
    const source = error.diagnostics[0]?.source;
    expect(source).toEqual({ file: "src/main.mtek", startByte: 40, endByte: 58, startLine: 2, startColumn: 1, endLine: 2, endColumn: 19 });
  });

  it("accepts the diagnostics delivered after a successful mount (inputs, uncaptured error, device loss)", async () => {
    const host = healthyHost();
    const seen: MtekDiagnostic[] = [];
    const app = await mountOn<{ tint: string }>(host, { inputs: { tint: "#ff0000" }, onDiagnostic: (d) => seen.push(d) });
    host.device.raiseValidation("bind group mismatch");
    host.device.loseDevice("unknown", "gpu crashed");
    await Promise.resolve();
    await Promise.resolve();
    expect(seen.map((d) => d.code)).toEqual(["MTEK-E8040", "MTEK-E8050", "MTEK-W8060"]);
    for (const diagnostic of seen) expect(problems(diagnostic), diagnostic.code).toEqual([]);
    app.dispose();
  });
});
