/**
 * Candidate-based hot reload (`spec/runtime-abi.md` section 11): structural detection, migration,
 * replaceProgram validation, and the "failed candidate never changes the running scene" rule.
 */
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { FakeHost } from "../test-support/fake-host.js";
import {
  BROKEN_WGSL,
  SHADER_URL,
  healthyHost,
  installProgram,
  mountOn,
  spanMapJson,
  SHADER_MAP_URL,
} from "../test-support/mount-fixture.js";
import { minimalManifestJson, minimalSceneInit, MINIMAL_SCENE_COLOR, BASE_URL, MANIFEST_URL } from "../test-support/fake-host.js";
import { syntheticProgram } from "../test-support/program.js";
import { findStructuralChange, prefabNames } from "./reload.js";
import type { MtekApp } from "./types.js";

function debugOf(app: MtekApp): NonNullable<MtekApp["debug"]> {
  if (app.debug === undefined) throw new Error("missing debug");
  return app.debug;
}

function cloneManifest(edit?: (manifest: Record<string, unknown>) => void): Record<string, unknown> {
  const manifest = minimalManifestJson();
  (manifest["symbols"] as unknown[]).push({ id: "std/materials.mtek::Unlit", kind: "material", span: 3 });
  edit?.(manifest);
  return manifest;
}

function programFor(manifestJson: Record<string, unknown>, init: (ctx: object) => void = minimalSceneInit) {
  const parsed = checkManifest(manifestJson);
  if (!parsed.ok) throw new Error(`manifest invalid: ${JSON.stringify(parsed.failures)}`);
  return syntheticProgram(parsed.manifest, init, BASE_URL);
}

describe("findStructuralChange", () => {
  it("returns undefined when the entity set, hierarchy and bodies match", () => {
    const parsed = checkManifest(minimalManifestJson());
    if (!parsed.ok) throw new Error("minimal");
    const scene = parsed.manifest.scene;
    expect(findStructuralChange(scene, scene, new Set(), new Set())).toBeUndefined();
  });

  it("names an added entity", () => {
    const parsed = checkManifest(minimalManifestJson());
    if (!parsed.ok) throw new Error("minimal");
    const previous = parsed.manifest.scene;
    const next = {
      ...previous,
      entities: [
        ...previous.entities,
        {
          ...previous.entities[0]!,
          index: 1,
          name: "Extra",
          symbol: "src/main.mtek::Demo.Extra",
          parent: null,
        },
      ],
    };
    const change = findStructuralChange(previous, next, new Set(), new Set());
    expect(change).toEqual({ symbol: "src/main.mtek::Demo.Extra", reason: "entity 'Extra' was added" });
  });

  it("names a body change", () => {
    const parsed = checkManifest(minimalManifestJson());
    if (!parsed.ok) throw new Error("minimal");
    const previous = parsed.manifest.scene;
    const next = {
      ...previous,
      entities: previous.entities.map((entity) => ({ ...entity, body: { kind: "static" as const } })),
    };
    const change = findStructuralChange(previous, next, new Set(), new Set());
    expect(change?.symbol).toBe("src/main.mtek::Demo.Cube");
    expect(change?.reason).toContain("changed body");
  });

  it("names a prefab addition", () => {
    const parsed = checkManifest(minimalManifestJson());
    if (!parsed.ok) throw new Error("minimal");
    const change = findStructuralChange(parsed.manifest.scene, parsed.manifest.scene, new Set(), new Set(["src/main.mtek::Box"]));
    expect(change).toEqual({ symbol: "src/main.mtek::Box", reason: "prefab 'src/main.mtek::Box' was added" });
  });
});

describe("prefabNames", () => {
  it("reads keys of the prefabs table", () => {
    expect([...prefabNames({ "src/a.mtek::P": {} })]).toEqual(["src/a.mtek::P"]);
    expect(prefabNames(null).size).toBe(0);
  });
});

describe("replaceProgram", () => {
  it("is present on a mounted app", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } });
    expect(typeof app.replaceProgram).toBe("function");
    app.dispose();
  });

  it("a colour-only candidate applies the new colour and does not create pipelines", async () => {
    const host = healthyHost();
    const app = await mountOn(host, { test: { manualClock: true, renderTarget: { width: 8, height: 8 } } });
    debugOf(app).step(1, 0.016);
    const before = debugOf(app).counters()["pipelinesCreated"];

    const newColor = { r: 1, g: 0, b: 0, a: 1 };
    const manifest = cloneManifest();
    host.files.set(MANIFEST_URL, JSON.stringify(manifest));
    const candidate = programFor(manifest, (ctx) => {
      minimalSceneInit(ctx);
      const c = ctx as { e: readonly object[]; setParam: (e: object, n: string, v: unknown) => void };
      for (const entity of c.e) c.setParam(entity, "color", newColor);
    });

    const result = await app.replaceProgram!(candidate);
    expect(result).toEqual({ ok: true });
    debugOf(app).step(1, 0.016);

    expect(debugOf(app).counters()["pipelinesCreated"]).toBe(before);
    const entity = debugOf(app).scene().entities[0] as { mat?: { p: { color?: unknown } } };
    expect(entity?.mat?.p.color).toEqual(newColor);
    expect(entity?.mat?.p.color).not.toEqual(MINIMAL_SCENE_COLOR);
    app.dispose();
  });

  it("a failed candidate (broken shader) leaves the running scene and pipelines unchanged", async () => {
    const reported: string[] = [];
    const host = healthyHost();
    const app = await mountOn(host, {
      test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
      onDiagnostic: (d) => {
        reported.push(d.code);
      },
    });
    debugOf(app).step(1, 0.016);
    const beforePipelines = debugOf(app).counters()["pipelinesCreated"];
    const beforeEntities = debugOf(app).scene().entities.map((e) => e.name);
    const beforePosition = debugOf(app).scene().entities[0]?.position;

    // Corrupt the WGSL the candidate will fetch (same URL / hash — test-only corruption).
    host.files.set(SHADER_URL, BROKEN_WGSL);
    host.files.set(SHADER_MAP_URL, spanMapJson());

    const manifest = cloneManifest();
    // Force a "new" shader hash so loadCandidateShaders does not reuse the healthy module.
    const shaders = manifest["shaders"] as Array<Record<string, unknown>>;
    const materials = manifest["materials"] as Array<Record<string, unknown>>;
    const brokenHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    shaders[0] = { ...shaders[0], hash: brokenHash, url: "shaders/aaaaaaaaaaaaaaaa.wgsl", map: "shaders/aaaaaaaaaaaaaaaa.mtek-map.json" };
    materials[0] = { ...materials[0], shader: brokenHash };
    host.files.set(`${BASE_URL}shaders/aaaaaaaaaaaaaaaa.wgsl`, BROKEN_WGSL);
    host.files.set(`${BASE_URL}shaders/aaaaaaaaaaaaaaaa.mtek-map.json`, spanMapJson(brokenHash));
    host.files.set(MANIFEST_URL, JSON.stringify(manifest));

    const candidate = programFor(manifest);
    const result = await app.replaceProgram!(candidate);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.diagnostics.some((d) => d.code === "MTEK-E8051")).toBe(true);
    expect(reported.some((code) => code === "MTEK-E8051")).toBe(true);

    // Old scene still runs.
    expect(app.state).toBe("running");
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).counters()["pipelinesCreated"]).toBe(beforePipelines);
    expect(debugOf(app).scene().entities.map((e) => e.name)).toEqual(beforeEntities);
    expect(debugOf(app).scene().entities[0]?.position).toEqual(beforePosition);
    app.dispose();
  });

  it("preserves scene state across a rename-free state-compatible reload", async () => {
    const host = new FakeHost();
    const manifest = cloneManifest((m) => {
      const scene = m["scene"] as Record<string, unknown>;
      scene["state"] = [{ name: "speed", type: "f32", symbol: "src/main.mtek::Demo.speed" }];
      (m["symbols"] as unknown[]).push({ id: "src/main.mtek::Demo.speed", kind: "state", span: 4 });
    });
    installProgram(host, () => {
      /* use custom below */
    });
    host.files.set(MANIFEST_URL, JSON.stringify(manifest));
    // Re-install shader files after installProgram
    const { VALID_WGSL } = await import("../test-support/mount-fixture.js");
    host.files.set(SHADER_URL, VALID_WGSL);
    host.files.set(SHADER_MAP_URL, spanMapJson());

    const initWithSpeed = (ctx: object): void => {
      minimalSceneInit(ctx);
      (ctx as { /* world state is on the World, not ctx in M1 */ });
    };
    // Mount with a program whose init also sets scene state through a side channel is hard in M1
    // because ctx has no state setter yet. Write state after mount via the world exposed by debug...
    // debug.scene().state is a copy. We'll set state through a custom path: after mount, mutate via
    // replaceProgram migration from a world that had state written.
    // Simpler: use HostInputs — add a host input targeting speed.
    const withInput = cloneManifest((m) => {
      const scene = m["scene"] as Record<string, unknown>;
      scene["state"] = [{ name: "speed", type: "f32", symbol: "src/main.mtek::Demo.speed" }];
      scene["hostInputs"] = [{ name: "speed", target: { kind: "state", name: "speed" }, type: "f32", codec: "f32" }];
      (m["symbols"] as unknown[]).push({ id: "src/main.mtek::Demo.speed", kind: "state", span: 4 });
    });
    host.files.set(MANIFEST_URL, JSON.stringify(withInput));

    const app = await mountOn(host, {
      test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
      inputs: { speed: 3.5 },
    });
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).scene().state["speed"]).toBe(Math.fround(3.5));

    // Candidate: same structure, different clear colour (non-structural).
    const candidateManifest = cloneManifest((m) => {
      const scene = m["scene"] as Record<string, unknown>;
      scene["state"] = [{ name: "speed", type: "f32", symbol: "src/main.mtek::Demo.speed" }];
      scene["hostInputs"] = [{ name: "speed", target: { kind: "state", name: "speed" }, type: "f32", codec: "f32" }];
      const fields = scene["fields"] as Record<string, unknown>;
      fields["clearColor"] = [0.1, 0.2, 0.3, 1];
      (m["symbols"] as unknown[]).push({ id: "src/main.mtek::Demo.speed", kind: "state", span: 4 });
    });
    host.files.set(MANIFEST_URL, JSON.stringify(candidateManifest));
    const candidate = programFor(candidateManifest);

    const result = await app.replaceProgram!(candidate);
    expect(result).toEqual({ ok: true });
    debugOf(app).step(1, 0.016);
    expect(debugOf(app).scene().state["speed"]).toBe(Math.fround(3.5));
    app.dispose();
  });

  it("adding an entity restarts with W8070 naming the declaration", async () => {
    const reported: Array<{ code: string; message: string; notes: readonly string[] }> = [];
    const host = healthyHost();
    const app = await mountOn(host, {
      test: { manualClock: true, renderTarget: { width: 8, height: 8 } },
      onDiagnostic: (d) => {
        reported.push({ code: d.code, message: d.message, notes: d.notes });
      },
    });
    debugOf(app).step(1, 0.016);

    const candidateManifest = cloneManifest((m) => {
      const scene = m["scene"] as Record<string, unknown>;
      const entities = scene["entities"] as Array<Record<string, unknown>>;
      const instances = scene["materialInstances"] as Array<Record<string, unknown>>;
      entities.push({
        index: 1,
        name: "Extra",
        symbol: "src/main.mtek::Demo.Extra",
        parent: null,
        mesh: "mesh:0",
        material: { id: "std/materials.mtek::Unlit", instance: 1 },
        light: null,
        body: null,
        collider: null,
        state: [],
        update: false,
        fixedUpdate: false,
      });
      instances.push({
        index: 1,
        material: "std/materials.mtek::Unlit",
        entity: 1,
        params: [{ name: "color", class: "initial" }],
        shareable: true,
      });
      (m["symbols"] as unknown[]).push({ id: "src/main.mtek::Demo.Extra", kind: "entity", span: 5 });
      // meshes maxEntities etc. stay; need another mesh id or reuse mesh:0
    });
    host.files.set(MANIFEST_URL, JSON.stringify(candidateManifest));
    const candidate = programFor(candidateManifest);

    const result = await app.replaceProgram!(candidate);
    expect(result).toEqual({ ok: true });
    debugOf(app).step(1, 0.016);

    const w8070 = reported.find((d) => d.code === "MTEK-W8070");
    expect(w8070).toBeDefined();
    expect(w8070?.message).toContain("Extra");
    expect(w8070?.notes.some((n) => n.includes("src/main.mtek::Demo.Extra"))).toBe(true);
    expect(debugOf(app).scene().entities.map((e) => e.name)).toEqual(["Cube", "Extra"]);
    app.dispose();
  });
});
