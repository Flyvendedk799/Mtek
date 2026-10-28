/**
 * Loading the animation module: every way it can fail is `E8114` (decision 0225, `spec/runtime-abi.md` section 6.1: the
 * mount fails with `animation-failed`), and the module is only ever requested for a program whose manifest asks for it.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { MtekMountError, mountErrorKindForCode } from "../diagnostics/types.js";
import type { SceneStructure } from "../scene/structure.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import type { AnimationBackend } from "./backend.js";
import { createAnimationBackend } from "./entry.js";
import { animationMismatch, animationModuleUrl, loadAnimationBackend, needsAnimation } from "./load.js";

const BASE = new URL("https://example.test/app/");
const MODULE_PATH = "animation/0123456789abcdef.js";
const URL_OF_MODULE = "https://example.test/app/animation/0123456789abcdef.js";

function manifest(animation: boolean): MtekManifest {
  const json = minimalManifestJson();
  json["subsystems"] = animation ? { physics: false, animation: true, animationModule: MODULE_PATH } : { physics: false };
  const checked = checkManifest(json);
  if (!checked.ok) throw new Error(JSON.stringify(checked.failures));
  return checked.manifest;
}

function load(importModule: (url: string) => Promise<unknown>, m: MtekManifest = manifest(true)): ReturnType<typeof loadAnimationBackend> {
  return loadAnimationBackend({ manifest: m, baseUrl: BASE, importModule, phase: "runtime:mount" });
}

/** A backend of the right shape that does nothing. */
function fakeBackend(): AnimationBackend {
  const real = createAnimationBackend();
  return { name: "fake", createPlayers: () => real.createPlayers(), createCommands: (host) => real.createCommands(host), retargetHumanoid: (_source, target) => target };
}

describe("animationModuleUrl", () => {
  it("resolves the manifest's module against the program's directory, and only for a program with skeletal animation", () => {
    expect(animationModuleUrl(manifest(true), BASE)).toBe(URL_OF_MODULE);
    expect(animationModuleUrl(manifest(false), BASE)).toBeUndefined();
  });
});

describe("loadAnimationBackend", () => {
  it("imports the module, calls its default export and resolves to the backend", async () => {
    const backend = fakeBackend();
    const imported: string[] = [];
    const result = await load((url) => {
      imported.push(url);
      return Promise.resolve({ default: () => Promise.resolve(backend) });
    });
    expect(result).toEqual({ ok: true, backend, url: URL_OF_MODULE });
    expect(imported).toEqual([URL_OF_MODULE]);
  });

  it("accepts a default export that answers synchronously", async () => {
    const backend = fakeBackend();
    expect(await load(() => Promise.resolve({ default: () => backend }))).toEqual({ ok: true, backend, url: URL_OF_MODULE });
  });

  it("the real module entry loads: a backend that makes players, commands and retargets", async () => {
    const entry = await import("./entry.js");
    const result = await load(() => Promise.resolve(entry));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.backend.name).toBe("mtek-animation");
  });

  it("E8114 when the import fails (a missing file, a network error, a syntax error), with the browser's message", async () => {
    const result = await load(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("MTEK-E8114");
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
  ])("E8114 for %s", async (_name, module) => {
    const result = await load(() => Promise.resolve(module));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8114" }] });
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain("default export");
  });

  it("E8114 when initialising the module fails", async () => {
    const result = await load(() => Promise.resolve({ default: () => Promise.reject(new Error("out of memory")) }));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8114" }] });
    if (!result.ok) {
      expect(result.diagnostics[0]?.message).toContain("initialising it failed");
      expect(result.diagnostics[0]?.notes).toContain("browser message: Error: out of memory");
    }
  });

  const complete = fakeBackend();
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "backend"],
    ["an object without a name", { ...complete, name: undefined }],
    ["an object without createPlayers", { ...complete, createPlayers: undefined }],
    ["an object without createCommands", { ...complete, createCommands: undefined }],
    ["an object without retargetHumanoid", { ...complete, retargetHumanoid: undefined }],
  ])("E8114 when the default export resolves to %s (the wrong shape)", async (_name, backend) => {
    const result = await load(() => Promise.resolve({ default: () => Promise.resolve(backend) }));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8114" }] });
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain("animation backend");
  });

  it("E8114 for a manifest that declares animation but names no module (never produced by the compiler)", async () => {
    const edited: MtekManifest = { ...manifest(true), subsystems: { physics: false, animation: true } };
    const result = await load(() => Promise.reject(new Error("must not be called")), edited);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "MTEK-E8114" }] });
  });

  it("reports the phase it was asked for (a reload)", async () => {
    const result = await loadAnimationBackend({ manifest: manifest(true), baseUrl: BASE, importModule: () => Promise.reject(new Error("x")), phase: "runtime:reload" });
    expect(result).toMatchObject({ ok: false, diagnostics: [{ phase: "runtime:reload" }] });
  });
});

/** A structure with only what `needsAnimation` reads. */
function structure(parts: { skin?: boolean; entityClipsFrom?: boolean; prefabClipsFrom?: boolean; plainAsset?: boolean }): SceneStructure {
  const meshes = [
    { id: "box", descriptor: { kind: "builtin" } },
    ...(parts.plainAsset === true ? [{ id: "tree", descriptor: { kind: "asset" } }] : []),
    ...(parts.skin === true ? [{ id: "man", descriptor: { kind: "asset", skin: {} } }] : []),
  ];
  return {
    meshes,
    entities: [{ name: "A", ...(parts.entityClipsFrom === true ? { clipsFrom: {} } : {}) }],
    prefabs: [{ name: "P", ...(parts.prefabClipsFrom === true ? { clipsFrom: {} } : {}) }],
  } as unknown as SceneStructure;
}

describe("needsAnimation and animationMismatch", () => {
  it("a skinned mesh, an entity's clips_from or a prefab's clips_from needs the module; nothing else does", () => {
    expect(needsAnimation(structure({}))).toBe(false);
    expect(needsAnimation(structure({ plainAsset: true }))).toBe(false);
    expect(needsAnimation(structure({ skin: true }))).toBe(true);
    expect(needsAnimation(structure({ entityClipsFrom: true }))).toBe(true);
    expect(needsAnimation(structure({ prefabClipsFrom: true }))).toBe(true);
  });

  it("E8114 for a manifest that does not announce the module its scene needs", () => {
    const diagnostic = animationMismatch(manifest(false), structure({ skin: true }), "runtime:mount");
    expect(diagnostic?.code).toBe("MTEK-E8114");
    expect(diagnostic?.message).toContain("does not declare the module");
    expect(animationMismatch(manifest(true), structure({ skin: true }), "runtime:mount")).toBeUndefined();
    expect(animationMismatch(manifest(false), structure({}), "runtime:mount")).toBeUndefined();
  });
});

describe("the mount error kind", () => {
  it("E8114 is animation-failed", () => {
    expect(mountErrorKindForCode("E8114")).toBe("animation-failed");
    expect(new MtekMountError("animation-failed", []).kind).toBe("animation-failed");
  });
});
