/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { RUNTIME_ABI } from "../index.js";
import {
  MAX_SCHEMA_FAILURES,
  SUPPORTED_LANGUAGE_VERSION,
  SUPPORTED_MANIFEST_SCHEMA,
  SUPPORTED_RUNTIME_ABI,
  checkCompatibility,
  checkDeviceCapabilities,
  checkManifest,
  validateManifest,
  type DeviceCapabilities,
  type MtekManifest,
  type MtekProgram,
} from "./index.js";

// The shared examples: tests/abi/manifests (also used by the Rust round-trip tests of M1-17).
const files = import.meta.glob<string>("../../../../tests/abi/manifests/**/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const schemaText = Object.entries(
  import.meta.glob<string>("../../../../spec/manifest.schema.json", { query: "?raw", import: "default", eager: true }),
)[0]?.[1];
const generatedText = Object.entries(
  import.meta.glob<string>("./generated/validate-manifest.js", { query: "?raw", import: "default", eager: true }),
)[0]?.[1];

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function example(relativePath: string): unknown {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/tests/abi/manifests/${relativePath}`));
  if (entry === undefined) throw new Error(`missing shared example ${relativePath}`);
  return parseJson(entry[1]);
}

function examplePaths(directory: string): string[] {
  const marker = `/tests/abi/manifests/${directory}/`;
  return Object.keys(files)
    .filter((path) => path.includes(marker))
    .map((path) => path.slice(path.indexOf(marker) + "/tests/abi/manifests/".length))
    .sort();
}

interface Expectation {
  readonly code: "E8003" | "E8006";
  readonly field: string;
}

function expectations(): Readonly<Record<string, Expectation>> {
  const raw = example("expectations.json") as { cases: Record<string, Expectation> };
  return raw.cases;
}

/** Deep copy so tests never mutate the shared examples. */
function clone(value: unknown): Record<string, unknown> {
  return parseJson(JSON.stringify(value)) as Record<string, unknown>;
}

describe("constants", () => {
  it("match the specification and the runtime ABI constant", () => {
    expect(SUPPORTED_MANIFEST_SCHEMA).toBe(1);
    expect(SUPPORTED_RUNTIME_ABI).toBe(1);
    expect(SUPPORTED_RUNTIME_ABI).toBe(RUNTIME_ABI);
    expect(SUPPORTED_LANGUAGE_VERSION).toBe("0.1");
  });
});

// The manifests the compiler produces for the codegen fixtures (M1-17 goldens).
const compiled = import.meta.glob<string>("../../../../tests/codegen/*/expected/program.manifest.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("compiled manifests (tests/codegen/*/expected)", () => {
  const paths = Object.keys(compiled).sort();

  it("exist for the two M1 scene fixtures and the two function fixtures", () => {
    expect(paths.map((path) => path.split("/").at(-3))).toEqual([
      "cpu_functions",
      "numeric_cpu_table",
      "scene_a_target_camera_box",
      "scene_b_orthographic_nested",
    ]);
  });

  for (const path of paths) {
    it(`${path.split("/").at(-3) ?? path} is accepted by checkManifest`, () => {
      const manifest = parseJson(compiled[path] ?? "");
      expect(checkCompatibility(manifest)).toEqual([]);
      const accepted = checkManifest(manifest);
      expect(accepted.ok ? [] : accepted.failures).toEqual([]);
    });
  }
});

describe("shared valid examples", () => {
  const valid = examplePaths("valid");

  it("include a minimal and a full manifest", () => {
    expect(valid).toEqual(["valid/full.json", "valid/minimal.json"]);
  });

  for (const path of valid) {
    it(`${path} is compatible and validates`, () => {
      const manifest = example(path);
      expect(checkCompatibility(manifest)).toEqual([]);
      const schemaOnly = validateManifest(manifest);
      expect(schemaOnly.ok ? [] : schemaOnly.failures).toEqual([]);
      const accepted = checkManifest(manifest);
      expect(accepted.ok).toBe(true);
    });
  }

  it("the minimal example equals a manifest typed as MtekManifest (types follow the schema)", () => {
    const typed: MtekManifest = {
      manifestSchema: 1,
      runtimeAbi: 1,
      languageVersion: "0.1",
      compilerVersion: "0.1.0-dev",
      buildId: "0".repeat(64),
      targetProfile: "webgpu-core-2026",
      requiredCapabilities: { features: [], limits: {}, wgslLanguageFeatures: [] },
      subsystems: { physics: false },
      runtimeConfig: { fixedStep: 0.016666668, maxCatchUpSteps: 4, maxFrameDelta: 0.1, maxEntities: 16384, pauseWhenHidden: true },
      entryScene: "Demo",
      sources: [],
      spans: [],
      symbols: [],
      layouts: [],
      shaders: [],
      materials: [],
      meshes: [],
      assets: [],
      scene: {
        name: "Demo",
        symbol: "src/main.mtek::Demo",
        fields: { clearColor: [0, 0, 0, 1], ambientColor: [1, 1, 1, 1], ambientIntensity: 0, gravity: [0, -9.81, 0] },
        state: [],
        cameras: [],
        entities: [],
        materialInstances: [],
        bindings: [],
        hostInputs: [],
        lights: [],
      },
    };
    // Same top-level and scene keys, in the same order, as the shared minimal example.
    const minimal = example("valid/minimal.json") as MtekManifest;
    expect(Object.keys(typed)).toEqual(Object.keys(minimal));
    expect(Object.keys(typed.scene)).toEqual(Object.keys(minimal.scene));
    expect(Object.keys(typed.scene.fields)).toEqual(Object.keys(minimal.scene.fields));
    // The typed literal itself (no examples) is a valid manifest.
    expect(validateManifest(typed).ok).toBe(true);
  });

  it("the full example touches every property of the schema (except documented optional ones)", () => {
    interface SchemaNode {
      $ref?: string;
      properties?: Record<string, SchemaNode>;
      items?: SchemaNode;
      oneOf?: SchemaNode[];
      then?: SchemaNode;
      $defs?: Record<string, SchemaNode>;
    }
    if (schemaText === undefined) throw new Error("schema not found");
    const schema = parseJson(schemaText) as SchemaNode;
    const defs = schema.$defs ?? {};
    const schemaPaths = new Set<string>();
    const collect = (node: SchemaNode, path: string, stack: readonly string[]): void => {
      if (node.$ref !== undefined) {
        const name = node.$ref.replace("#/$defs/", "");
        const target = defs[name];
        if (target === undefined || stack.includes(name)) return;
        collect(target, path, [...stack, name]);
        return;
      }
      for (const branch of node.oneOf ?? []) collect(branch, path, stack);
      if (node.then !== undefined) collect(node.then, path, stack);
      if (node.items !== undefined) collect(node.items, `${path}[]`, stack);
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        schemaPaths.add(`${path}.${key}`);
        collect(child, `${path}.${key}`, stack);
      }
    };
    collect(schema, "", []);

    const dataPaths = new Set<string>();
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, `${path}[]`);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          dataPaths.add(`${path}.${key}`);
          walk(child, `${path}.${key}`);
        }
      }
    };
    walk(example("valid/full.json"), "");

    // Optional properties the spec shows omitted: the root of a layout block has no struct name.
    const documentedOptional = new Set([".layouts[].root.name"]);
    const missing = [...schemaPaths].filter((path) => !dataPaths.has(path) && !documentedOptional.has(path));
    expect(missing).toEqual([]);
  });
});

describe("shared invalid examples", () => {
  const invalid = examplePaths("invalid");
  const expected = expectations();

  it("every invalid example has an expectation and vice versa", () => {
    expect(Object.keys(expected).sort()).toEqual(invalid);
    expect(invalid.length).toBeGreaterThanOrEqual(40);
  });

  for (const path of invalid) {
    it(`${path} is rejected with the expected failure`, () => {
      const want = expected[path];
      if (want === undefined) throw new Error(`no expectation for ${path}`);
      const result = checkManifest(example(path));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const first = result.failures[0];
      expect(first).toBeDefined();
      expect({ code: first?.code, field: first?.field }).toEqual({ code: want.code, field: want.field });
      expect(first?.message.length).toBeGreaterThan(0);
    });
  }
});

describe("compatibility is checked before the schema (spec/runtime-abi.md section 5.1)", () => {
  const minimal = (): Record<string, unknown> => clone(example("valid/minimal.json"));

  it("an incompatible runtimeAbi yields E8003, not E8006", () => {
    const manifest = minimal();
    manifest["runtimeAbi"] = 2;
    const result = checkManifest(manifest);
    expect(result).toMatchObject({ ok: false, failures: [{ code: "E8003", field: "runtimeAbi" }] });
  });

  it("the schema itself accepts a future ABI, so only checkCompatibility can reject it", () => {
    const manifest = minimal();
    manifest["runtimeAbi"] = 2;
    manifest["manifestSchema"] = 7;
    manifest["languageVersion"] = "9.9";
    expect(validateManifest(manifest).ok).toBe(true);
    expect(checkCompatibility(manifest).map((failure) => failure.field)).toEqual([
      "manifestSchema",
      "runtimeAbi",
      "languageVersion",
    ]);
  });

  it("an incompatible program that is also malformed still yields E8003", () => {
    const manifest = minimal();
    manifest["manifestSchema"] = 2;
    delete manifest["scene"];
    manifest["somethingNew"] = {};
    const result = checkManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((failure) => failure.code)).toEqual(["E8003"]);
    }
  });

  it("reports E8003 before E8006 when both kinds of failure exist in the three fields", () => {
    const failures = checkCompatibility({ manifestSchema: "1", runtimeAbi: 3, languageVersion: "0.1" });
    expect(failures.map((failure) => [failure.code, failure.field])).toEqual([
      ["E8003", "runtimeAbi"],
      ["E8006", "manifestSchema"],
    ]);
  });

  it("reads only the three compatibility fields", () => {
    const trap = {
      manifestSchema: 1,
      runtimeAbi: 1,
      languageVersion: "0.1",
      get scene(): never {
        throw new Error("checkCompatibility must not read other fields");
      },
    };
    expect(checkCompatibility(trap)).toEqual([]);
  });

  it("rejects values that are not manifests with E8006", () => {
    for (const value of [null, undefined, 1, "text", [], true]) {
      expect(checkCompatibility(value)).toEqual([
        { code: "E8006", field: "manifest", message: "The manifest must be a JSON object." },
      ]);
    }
    expect(checkManifest(null)).toMatchObject({ ok: false, failures: [{ code: "E8006", field: "manifest" }] });
  });

  it("reports missing and mistyped compatibility fields as E8006", () => {
    expect(checkCompatibility({})).toMatchObject([
      { code: "E8006", field: "manifestSchema" },
      { code: "E8006", field: "runtimeAbi" },
      { code: "E8006", field: "languageVersion" },
    ]);
    expect(checkCompatibility({ manifestSchema: 1.5, runtimeAbi: 1, languageVersion: 0.1 })).toMatchObject([
      { code: "E8006", field: "manifestSchema" },
      { code: "E8006", field: "languageVersion" },
    ]);
  });

  it("names the mismatching field and both versions in the message", () => {
    const [failure] = checkCompatibility({ manifestSchema: 1, runtimeAbi: 2, languageVersion: "0.1" });
    expect(failure?.message).toContain("runtimeAbi");
    expect(failure?.message).toContain("2");
    expect(failure?.message).toContain("1");
  });
});

describe("validation failures", () => {
  it("are capped", () => {
    const manifest = clone(example("valid/minimal.json"));
    manifest["spans"] = Array.from({ length: MAX_SCHEMA_FAILURES * 3 }, () => ({ file: -1, start: -1, end: -1 }));
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures).toHaveLength(MAX_SCHEMA_FAILURES);
  });

  it("report every failing field with allErrors", () => {
    const manifest = clone(example("valid/minimal.json"));
    manifest["buildId"] = "short";
    manifest["entryScene"] = 3;
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((failure) => failure.field).sort()).toEqual(["buildId", "entryScene"]);
  });
});

describe("the schema file", () => {
  interface Node {
    type?: string | string[];
    properties?: Record<string, Node>;
    additionalProperties?: unknown;
    const?: unknown;
    [key: string]: unknown;
  }
  const schema = ((): Node => {
    if (schemaText === undefined) throw new Error("schema not found");
    return parseJson(schemaText) as Node;
  })();

  it("is JSON Schema draft 2020-12", () => {
    expect(schema["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("types the compatibility fields as plain integer/integer/string without const", () => {
    const props = schema.properties ?? {};
    expect(props["manifestSchema"]).toMatchObject({ type: "integer" });
    expect(props["runtimeAbi"]).toMatchObject({ type: "integer" });
    expect(props["languageVersion"]).toMatchObject({ type: "string" });
    for (const name of ["manifestSchema", "runtimeAbi", "languageVersion"]) {
      expect(props[name]).not.toHaveProperty("const");
      expect(props[name]).not.toHaveProperty("enum");
    }
  });

  it("closes every object schema with additionalProperties false (except the limits map)", () => {
    const open: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, `${path}[${String(index)}]`));
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const record = node as Node;
      const isObjectSchema =
        record.properties !== undefined && path.split(".").pop() !== "properties" && typeof record.properties === "object";
      if (isObjectSchema && record.additionalProperties !== false) open.push(path);
      for (const [key, child] of Object.entries(record)) visit(child, `${path}.${key}`);
    };
    visit(schema, "");
    expect(open).toEqual([]);
    // The one deliberate open map is not a `properties` schema at all.
    const limits = (schema["$defs"] as Record<string, Node>)["requiredCapabilities"]?.properties?.["limits"];
    expect(limits?.additionalProperties).toMatchObject({ type: "integer" });
  });
});

describe("the generated validator", () => {
  it("does not import Ajv (the schema is compiled at build time)", () => {
    expect(generatedText).toBeDefined();
    const text = generatedText ?? "";
    expect(text).not.toMatch(/from\s*["']ajv/);
    expect(text).not.toMatch(/import\s*\(?\s*["']ajv/);
    expect(text).not.toMatch(/require\(\s*["']ajv/);
    expect(text).not.toMatch(/ucs2length/);
  });
});

describe("checkDeviceCapabilities", () => {
  const device = (features: string[], wgsl: string[], limits: Record<string, number>): DeviceCapabilities => ({
    hasFeature: (name) => features.includes(name),
    hasWgslLanguageFeature: (name) => wgsl.includes(name),
    limit: (name) => limits[name],
  });
  const manifest = example("valid/full.json") as MtekManifest;

  it("accepts a device that satisfies the full example", () => {
    const ok = device(["timestamp-query"], ["readonly_and_readwrite_storage_textures"], {
      maxBindGroups: 8,
      minUniformBufferOffsetAlignment: 256,
    });
    expect(checkDeviceCapabilities(manifest.requiredCapabilities, ok)).toEqual([]);
  });

  it("accepts any device for the empty default profile", () => {
    const minimal = example("valid/minimal.json") as MtekManifest;
    expect(checkDeviceCapabilities(minimal.requiredCapabilities, device([], [], {}))).toEqual([]);
  });

  it("reports E8002 for each missing feature and limit, naming the field", () => {
    const weak = device([], [], { maxBindGroups: 4, minUniformBufferOffsetAlignment: 512 });
    const failures = checkDeviceCapabilities(manifest.requiredCapabilities, weak);
    expect(failures.map((failure) => [failure.code, failure.field])).toEqual([
      ["E8002", "requiredCapabilities.features[0]"],
      ["E8002", "requiredCapabilities.wgslLanguageFeatures[0]"],
      ["E8002", "requiredCapabilities.limits.maxBindGroups"],
      ["E8002", "requiredCapabilities.limits.minUniformBufferOffsetAlignment"],
    ]);
  });

  it("reports a limit the device does not report", () => {
    const failures = checkDeviceCapabilities(manifest.requiredCapabilities, device(["timestamp-query"], ["readonly_and_readwrite_storage_textures"], {}));
    expect(failures.map((failure) => failure.field)).toEqual([
      "requiredCapabilities.limits.maxBindGroups",
      "requiredCapabilities.limits.minUniformBufferOffsetAlignment",
    ]);
  });
});

describe("MtekProgram", () => {
  it("has the shape of the app.js default export", () => {
    const program: MtekProgram<{ tint: string }> = {
      abi: 1,
      baseUrl: new URL("http://localhost/"),
      manifestUrl: new URL("http://localhost/program.manifest.json"),
      writers: {
        "builtin:frame": { all: () => undefined, fields: { view_proj: () => undefined } },
      },
      functions: { "src/main.mtek::pulse": () => 0 },
      scenes: {
        Demo: {
          init: () => undefined,
          update: null,
          fixedUpdate: null,
          entityUpdate: [null],
          entityFixedUpdate: [null],
          events: { key_down: [{ key: "Space", owner: -1, fn: () => undefined }] },
          bindings: [() => 0],
        },
      },
      prefabs: {},
    };
    expect(program.abi).toBe(RUNTIME_ABI);
    expect(Object.keys(program.scenes)).toEqual(["Demo"]);
  });
});
