/**
 * The animation module at mount and on a hot reload (decision 0225), against the fake host: a program without skeletal
 * animation never requests `animation/`; one that declares the module imports it exactly once, before the scene starts;
 * a module that cannot be loaded rejects the mount with `animation-failed`; a reload that needs another module loads it
 * or is refused, like the physics module (decision 0066).
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { MtekMountError, type MtekDiagnostic } from "../diagnostics/types.js";
import { BASE_URL, FakeHost, fakeProgram, minimalSceneInit } from "../test-support/fake-host.js";
import { healthyHost, installProgram, mountOn } from "../test-support/mount-fixture.js";
import { createAnimationBackend } from "./entry.js";
import type { AnimationBackend } from "./backend.js";

const MODULE_PATH = "animation/0123456789abcdef.js";
const MODULE_URL = new URL(MODULE_PATH, BASE_URL).href;
const OTHER_PATH = "animation/fedcba9876543210.js";
const OTHER_URL = new URL(OTHER_PATH, BASE_URL).href;

/** A backend that counts the worlds it makes players for. */
function countingBackend(): { backend: AnimationBackend; worlds: () => number; module: { default: () => AnimationBackend } } {
  let worlds = 0;
  const real = createAnimationBackend();
  const backend: AnimationBackend = {
    ...real,
    createPlayers: () => {
      worlds += 1;
      return real.createPlayers();
    },
  };
  return { backend, worlds: () => worlds, module: { default: () => backend } };
}

function withAnimation(path: string): (manifest: Record<string, unknown>) => void {
  return (manifest) => {
    manifest["subsystems"] = { physics: false, animation: true, animationModule: path };
  };
}

const TEST = { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } } as const;

describe("mounting", () => {
  it("a program without skeletal animation never requests the module", async () => {
    const host = healthyHost();
    const app = await mountOn(host, TEST);
    expect(host.imported).toEqual([]);
    expect(host.fetched.filter((url) => url.includes("animation/"))).toEqual([]);
    app.debug?.step(2, 1 / 60);
    app.dispose();
  });

  it("a program that declares the module imports it exactly once, from the URL the manifest names, and gives it to the world", async () => {
    const host = new FakeHost();
    installProgram(host, withAnimation(MODULE_PATH));
    const counting = countingBackend();
    host.modules.set(MODULE_URL, counting.module);
    const app = await mountOn(host, TEST);
    expect(host.imported).toEqual([MODULE_URL]);
    expect(counting.worlds()).toBe(1);
    app.debug?.step(2, 1 / 60);
    app.dispose();
  });

  it("a module that cannot be imported rejects the mount with animation-failed (E8114) and reports it", async () => {
    const host = new FakeHost();
    installProgram(host, withAnimation(MODULE_PATH));
    const reported: string[] = [];
    const error = await mountOn(host, { ...TEST, onDiagnostic: (d: MtekDiagnostic) => reported.push(d.code) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MtekMountError);
    expect((error as MtekMountError).kind).toBe("animation-failed");
    expect((error as MtekMountError).diagnostics.map((d) => d.code)).toEqual(["MTEK-E8114"]);
    expect(reported).toEqual(["MTEK-E8114"]);
    expect(host.imported).toEqual([MODULE_URL]);
  });

  it("a module with the wrong shape rejects the mount the same way", async () => {
    const host = new FakeHost();
    installProgram(host, withAnimation(MODULE_PATH));
    host.modules.set(MODULE_URL, { default: () => ({ name: "half" }) });
    const error = await mountOn(host, TEST).catch((e: unknown) => e);
    expect((error as MtekMountError).kind).toBe("animation-failed");
  });
});

describe("a hot reload", () => {
  function candidate(host: ReturnType<typeof healthyHost>, edit?: (manifest: Record<string, unknown>) => void): ReturnType<typeof fakeProgram> {
    const manifest = installProgram(host, edit);
    const parsed = checkManifest(manifest);
    if (!parsed.ok) throw new Error("invalid candidate");
    return fakeProgram(minimalSceneInit, parsed.manifest);
  }

  it("that newly needs the module imports it, and keeps it for the next reload of the same file", async () => {
    const host = healthyHost();
    const app = await mountOn(host, TEST);
    const counting = countingBackend();
    host.modules.set(MODULE_URL, counting.module);
    expect(await app.replaceProgram?.(candidate(host, withAnimation(MODULE_PATH)))).toEqual({ ok: true });
    app.debug?.step(1, 1 / 60);
    expect(host.imported).toEqual([MODULE_URL]);
    expect(counting.worlds()).toBe(1);
    expect(await app.replaceProgram?.(candidate(host, withAnimation(MODULE_PATH)))).toEqual({ ok: true });
    app.debug?.step(1, 1 / 60);
    expect(host.imported).toEqual([MODULE_URL]);
    expect(counting.worlds()).toBe(2);
    app.dispose();
  });

  it("that names another file imports that one", async () => {
    const host = new FakeHost();
    installProgram(host, withAnimation(MODULE_PATH));
    const first = countingBackend();
    const second = countingBackend();
    host.modules.set(MODULE_URL, first.module);
    host.modules.set(OTHER_URL, second.module);
    const app = await mountOn(host, TEST);
    expect(await app.replaceProgram?.(candidate(host, withAnimation(OTHER_PATH)))).toEqual({ ok: true });
    app.debug?.step(1, 1 / 60);
    expect(host.imported).toEqual([MODULE_URL, OTHER_URL]);
    expect(second.worlds()).toBe(1);
    app.dispose();
  });

  it("whose module does not load is refused with E8114 in the reload phase; the old program keeps running", async () => {
    const host = healthyHost();
    const reported: MtekDiagnostic[] = [];
    const app = await mountOn(host, { ...TEST, onDiagnostic: (d: MtekDiagnostic) => reported.push(d) });
    const result = await app.replaceProgram?.(candidate(host, withAnimation(MODULE_PATH)));
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8114"]);
      expect(result.diagnostics[0]?.phase).toBe("runtime:reload");
    }
    expect(reported.map((d) => d.code)).toEqual(["MTEK-E8114"]);
    app.debug?.step(2, 1 / 60);
    expect(app.state).toBe("running");
    app.dispose();
  });

  it("that no longer needs the module drops it", async () => {
    const host = new FakeHost();
    installProgram(host, withAnimation(MODULE_PATH));
    const counting = countingBackend();
    host.modules.set(MODULE_URL, counting.module);
    const app = await mountOn(host, TEST);
    expect(await app.replaceProgram?.(candidate(host))).toEqual({ ok: true });
    app.debug?.step(1, 1 / 60);
    expect(counting.worlds()).toBe(1);
    app.dispose();
  });
});
