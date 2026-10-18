/**
 * Loading the physics module: every way it can fail is `E8102` (decision 0066, `spec/runtime-abi.md` section 6.1: the
 * mount fails with `physics-failed`), and the module is only ever requested for a program whose manifest asks for it.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { MtekMountError, mountErrorKindForCode } from "../diagnostics/types.js";
import { FakePhysicsBackend } from "../test-support/fake-physics.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { loadPhysicsBackend, physicsModuleUrl } from "./load.js";

const BASE = new URL("https://example.test/app/");
const URL_OF_MODULE = "https://example.test/app/physics/0123456789abcdef.js";

function manifest(physics: boolean): MtekManifest {
  const json = minimalManifestJson();
  json["subsystems"] = physics ? { physics: true, physicsModule: "physics/0123456789abcdef.js" } : { physics: false };
  const checked = checkManifest(json);
  if (!checked.ok) throw new Error(JSON.stringify(checked.failures));
  return checked.manifest;
}

function load(importModule: (url: string) => Promise<unknown>, m: MtekManifest = manifest(true)): ReturnType<typeof loadPhysicsBackend> {
  return loadPhysicsBackend({ manifest: m, baseUrl: BASE, importModule, phase: "runtime:mount" });
}

describe("physicsModuleUrl", () => {
  it("resolves the manifest's module against the program's directory, and only for a physics program", () => {
    expect(physicsModuleUrl(manifest(true), BASE)).toBe(URL_OF_MODULE);
    expect(physicsModuleUrl(manifest(false), BASE)).toBeUndefined();
  });
});

describe("loadPhysicsBackend", () => {
  it("imports the module, calls its default export and resolves to the backend", async () => {
    const backend = new FakePhysicsBackend();
    const imported: string[] = [];
    const result = await load((url) => {
      imported.push(url);
      return Promise.resolve(backend.module);
    });
    expect(result).toEqual({ ok: true, backend, url: URL_OF_MODULE });
    expect(imported).toEqual([URL_OF_MODULE]);
  });

  it("E8102 when the import fails (a missing file, a network error, a syntax error), with the browser's message", async () => {
    const result = await load(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("MTEK-E8102");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.phase).toBe("runtime:mount");
    expect(diagnostic?.message).toContain("importing it failed");
    expect(diagnostic?.notes).toContain(`module: ${URL_OF_MODULE}`);
    expect(diagnostic?.notes).toContain("browser message: TypeError: Failed to fetch dynamically imported module");
  });

  it.each([
    ["a module without a default export", {}],
    ["a default export that is not a function", { default: 42 }],
    ["a module that is not an object", "nope"],
  ])("E8102 for %s", async (_name, module) => {
    const result = await load(() => Promise.resolve(module));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8102" }] });
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain("default export");
  });

  it("E8102 when initialising the engine fails", async () => {
    const result = await load(() => Promise.resolve({ default: () => Promise.reject(new Error("WebAssembly.instantiate(): out of memory")) }));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8102" }] });
    if (!result.ok) {
      expect(result.diagnostics[0]?.message).toContain("initialising the physics engine failed");
      expect(result.diagnostics[0]?.notes).toContain("browser message: Error: WebAssembly.instantiate(): out of memory");
    }
  });

  it.each([
    ["undefined", undefined],
    ["an object without createWorld", { name: "x" }],
    ["an object without a name", { createWorld: () => undefined }],
  ])("E8102 when the default export resolves to %s", async (_name, backend) => {
    const result = await load(() => Promise.resolve({ default: () => Promise.resolve(backend) }));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8102" }] });
  });

  it("E8102 for a manifest that declares physics but names no module (never produced by the compiler)", async () => {
    const edited: MtekManifest = { ...manifest(true), subsystems: { physics: true } };
    const result = await load(() => Promise.reject(new Error("must not be called")), edited);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8102" }] });
  });

  it("reports the phase it was asked for (a reload)", async () => {
    const result = await loadPhysicsBackend({ manifest: manifest(true), baseUrl: BASE, importModule: () => Promise.reject(new Error("x")), phase: "runtime:reload" });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ phase: "runtime:reload" }] });
  });
});

describe("the mount error kind", () => {
  it("E8102 is physics-failed", () => {
    expect(mountErrorKindForCode("E8102")).toBe("physics-failed");
    expect(new MtekMountError("physics-failed", []).kind).toBe("physics-failed");
  });
});
