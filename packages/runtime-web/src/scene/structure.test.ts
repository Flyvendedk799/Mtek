import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { CODEGEN_FIXTURES, loadGoldenProgram, syntheticProgram } from "../test-support/program.js";
import { checkProgram } from "./program.js";
import { resolveStructure } from "./structure.js";

type Json = Record<string, unknown>;

function manifestWith(edit: (json: Json, scene: Json & { entities: Json[]; materialInstances: Json[]; cameras: Json[] }) => void): MtekManifest {
  const json = minimalManifestJson();
  edit(json, json["scene"] as Json & { entities: Json[]; materialInstances: Json[]; cameras: Json[] });
  const result = checkManifest(json);
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return result.manifest;
}

function problems(manifest: MtekManifest): string[] {
  const result = resolveStructure(manifest);
  if (result.ok) return [];
  return result.diagnostics.map((d) => `${d.code} ${d.notes[0] ?? ""}`);
}

describe("resolveStructure", () => {
  it("resolves the minimal manifest", () => {
    const result = resolveStructure(manifestWith(() => undefined));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { structure } = result;
    expect(structure.frameLayout.id).toBe("builtin:frame");
    expect(structure.objectLayout.id).toBe("builtin:object");
    expect(structure.camera.name).toBe("Main");
    expect(structure.materials.map((m) => [m.id, m.layout?.id, m.shader.vertexAttributes])).toEqual([
      ["std/materials.mtek::Unlit", "material:std/materials.mtek::Unlit", ["position"]],
    ]);
    expect(structure.entities).toHaveLength(1);
    expect(structure.entities[0]?.mesh?.descriptor).toEqual({ id: "mesh:0", kind: "box", size: [1, 1, 1] });
    expect(structure.entities[0]?.instance?.index).toBe(0);
    expect(structure.instances[0]?.material).toBe(structure.materials[0]);
  });

  it.each(CODEGEN_FIXTURES)("resolves the golden manifest of %s", async (name) => {
    const golden = await loadGoldenProgram(name);
    expect(resolveStructure(golden.manifest).ok).toBe(true);
  });

  it("reports every broken reference as E8006 naming the field", () => {
    expect(problems(manifestWith((json) => (json["entryScene"] = "Other")))).toEqual(["MTEK-E8006 field: entryScene"]);
    expect(
      problems(
        manifestWith((json) => {
          json["layouts"] = (json["layouts"] as Json[]).filter((l) => l["id"] !== "builtin:object");
        }),
      ),
    ).toEqual(["MTEK-E8006 field: layouts"]);
    expect(problems(manifestWith((_, scene) => ((scene.cameras[0] ?? {})["active"] = false)))).toEqual(["MTEK-E8006 field: scene.cameras"]);
    expect(problems(manifestWith((_, scene) => ((scene.entities[0] ?? {})["mesh"] = "mesh:9")))).toEqual(["MTEK-E8006 field: scene.entities[0].mesh"]);
    expect(problems(manifestWith((_, scene) => ((scene.entities[0] ?? {})["parent"] = 0)))).toEqual(["MTEK-E8006 field: scene.entities[0].parent"]);
    expect(problems(manifestWith((_, scene) => ((scene.entities[0] ?? {})["index"] = 3)))).toEqual(["MTEK-E8006 field: scene.entities[0].index"]);
    expect(
      problems(manifestWith((_, scene) => ((scene.entities[0] ?? {})["material"] = { id: "std/materials.mtek::Unlit", instance: 4 }))),
    ).toEqual(["MTEK-E8006 field: scene.entities[0].material"]);
    expect(problems(manifestWith((_, scene) => ((scene.materialInstances[0] ?? {})["material"] = "src/x.mtek::Nope")))).toEqual([
      "MTEK-E8006 field: scene.materialInstances[0].material",
    ]);
    expect(
      problems(
        manifestWith((json) => {
          ((json["materials"] as Json[])[0] ?? {})["shader"] = "f".repeat(64);
        }),
      ),
    ).toEqual(["MTEK-E8006 field: materials[0].shader"]);
    expect(
      problems(
        manifestWith((json) => {
          ((json["materials"] as Json[])[0] ?? {})["layout"] = "material:src/x.mtek::Nope";
        }),
      ),
    ).toEqual(["MTEK-E8006 field: materials[0].layout"]);
    expect(
      problems(
        manifestWith((json) => {
          ((json["shaders"] as Json[])[0] ?? {})["vertexAttributes"] = ["uv", "position"];
        }),
      ),
    ).toEqual(["MTEK-E8006 field: shaders.vertexAttributes"]);
  });

  it("reports what this runtime build cannot render as E8003", () => {
    const assetMesh = manifestWith((json) => {
      json["meshes"] = [{ id: "mesh:0", kind: "asset", asset: "assets/0000000000000000.bin", primitive: 0 }];
    });
    expect(problems(assetMesh)).toEqual(["MTEK-E8003 field: meshes[0]"]);
  });
});

describe("checkProgram", () => {
  it("accepts the golden programs and a synthetic program", async () => {
    for (const name of CODEGEN_FIXTURES) {
      const golden = await loadGoldenProgram(name);
      const result = checkProgram(golden.program, golden.manifest);
      expect(result.ok, name).toBe(true);
      if (result.ok) expect([...result.program.writers.keys()]).toEqual(golden.manifest.layouts.map((l) => l.id));
    }
    const manifest = manifestWith(() => undefined);
    expect(checkProgram(syntheticProgram(manifest, () => undefined, "https://example.test/"), manifest).ok).toBe(true);
  });

  it("rejects a program from another build as E8003 naming the member", () => {
    const manifest = manifestWith(() => undefined);
    const program = syntheticProgram(manifest, () => undefined, "https://example.test/");
    const codes = (parts: { writers: unknown; scenes: unknown }): string[] => {
      const result = checkProgram(parts, manifest);
      return result.ok ? [] : result.diagnostics.map((d) => `${d.code} ${d.notes[0] ?? ""}`);
    };
    expect(codes({ writers: program.writers, scenes: {} })).toEqual(["MTEK-E8003 field: scenes.Demo"]);
    expect(codes({ writers: program.writers, scenes: { Demo: { init: 1 } } })).toEqual(["MTEK-E8003 field: scenes.Demo"]);
    expect(codes({ writers: null, scenes: program.scenes })).toEqual(["MTEK-E8003 field: writers"]);
    const writers = { ...(program.writers as Record<string, unknown>) };
    delete writers["builtin:frame"];
    expect(codes({ writers, scenes: program.scenes })).toEqual(['MTEK-E8003 field: writers["builtin:frame"]']);
    const noField = { ...(program.writers as Record<string, { all: unknown; fields: Record<string, unknown> }>) };
    const object = noField["builtin:object"];
    if (object !== undefined) noField["builtin:object"] = { all: object.all, fields: { model: object.fields["model"] } };
    expect(codes({ writers: noField, scenes: program.scenes })).toEqual(['MTEK-E8003 field: writers["builtin:object"].fields.normal_matrix']);
  });
});
