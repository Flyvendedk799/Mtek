import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest } from "../abi/manifest-types.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { CODEGEN_FIXTURES, loadGoldenProgram, syntheticProgram } from "../test-support/program.js";
import { checkProgram } from "./program.js";
import { resolveStructure } from "./structure.js";

type Json = Record<string, unknown>;

/** The update classes of a light's fields (decision 0067); the structure checks do not look at them. */
const CLASSES = { color: "initial", intensity: "initial" } as const;

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

  it("resolves the lights and reads the frame block's capacity from the layout", () => {
    const result = resolveStructure(
      manifestWith((_, scene) => {
        const entity = scene.entities[0] ?? {};
        entity["light"] = 0;
        scene["lights"] = [{ index: 0, entity: 0, kind: "point", range: 6.5, classes: CLASSES }];
      }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.structure.lights).toEqual([{ index: 0, entity: 0, kind: "point", range: 6.5 }]);
    expect(result.structure.lightCapacity).toBe(4);
    expect(
      resolveStructure(manifestWith(() => undefined)),
    ).toMatchObject({ ok: true, structure: { lights: [], lightCapacity: 4 } });
  });

  it("reports lights that do not fit the frame block or do not match their entities as E8006", () => {
    const five = manifestWith((_, scene) => {
      const template = scene.entities[0] ?? {};
      scene.entities = [0, 1, 2, 3, 4].map((index) => ({ ...template, index, name: `L${String(index)}`, symbol: `src/main.mtek::Demo.L${String(index)}`, mesh: null, material: null, light: index }));
      scene.materialInstances = [];
      scene["lights"] = [0, 1, 2, 3, 4].map((index) => ({ index, entity: index, kind: "directional", classes: CLASSES }));
    });
    expect(problems(five)).toEqual(["MTEK-E8006 field: scene.lights"]);
    // The light names an entity that does not name it back.
    expect(
      problems(
        manifestWith((_, scene) => {
          scene["lights"] = [{ index: 0, entity: 0, kind: "directional", classes: CLASSES }];
        }),
      ),
    ).toEqual(["MTEK-E8006 field: scene.lights[0].entity"]);
    // The entity names a light that another entity carries (and that entity does not name it back).
    expect(
      problems(
        manifestWith((_, scene) => {
          const template = scene.entities[0] ?? {};
          scene.entities = [
            { ...template, light: 0 },
            { ...template, index: 1, name: "Other", symbol: "src/main.mtek::Demo.Other", mesh: null, material: null, light: null },
          ];
          scene["lights"] = [{ index: 0, entity: 1, kind: "directional", classes: CLASSES }];
        }),
      ),
    ).toEqual(["MTEK-E8006 field: scene.lights[0].entity", "MTEK-E8006 field: scene.entities[0].light"]);
    expect(
      problems(
        manifestWith((_, scene) => {
          (scene.entities[0] ?? {})["light"] = 0;
          scene["lights"] = [{ index: 1, entity: 0, kind: "directional", classes: CLASSES }];
        }),
      ),
    ).toEqual(["MTEK-E8006 field: scene.lights[0].index"]);
    // The frame layout's `lights` is not an array.
    expect(
      problems(
        manifestWith((json) => {
          const frame = (json["layouts"] as Json[]).find((layout) => layout["id"] === "builtin:frame");
          const root = (frame ?? {})["root"] as { members: Json[] };
          const lights = root.members.find((member) => member["name"] === "lights");
          if (lights !== undefined) lights["node"] = { kind: "scalar", offset: 96, size: 4, align: 4, scalar: "f32" };
        }),
      ),
    ).toContain("MTEK-E8006 field: layouts");
  });

});

describe("resolveStructure: asset meshes", () => {
  const BIN = "assets/0000000000000001.bin";
  /** One primitive: 3 vertices with position (bytes 0 to 36) and uv (36 to 60), 3 `uint16` indices (60 to 66); a 68-byte file. */
  const PRIMITIVE = {
    source: { file: "models/tri.glb", mesh: "Tri", primitive: 0 },
    vertexCount: 3,
    indexCount: 3,
    indexFormat: "uint16",
    attributes: ["position", "uv"],
    offsets: { position: 0, uv: 36, indices: 60 },
    boundingSphere: { center: [1, 1, 0], radius: 1.5 },
  };

  /** The minimal manifest with its box replaced by the asset mesh above. */
  function withAssetMesh(edit: (json: Json, scene: Json & { entities: Json[] }) => void = () => undefined): MtekManifest {
    return manifestWith((json, scene) => {
      json["assets"] = [{ url: BIN, sha256: "0".repeat(64), bytes: 68, kind: "mesh-data", primitives: [structuredClone(PRIMITIVE)], preprocessing: [], span: 3 }];
      json["meshes"] = [{ id: "mesh:0", kind: "asset", asset: BIN, primitive: 0 }];
      edit(json, scene);
    });
  }

  it("resolves an asset mesh with its layout", () => {
    const result = resolveStructure(withAssetMesh());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.structure.entities[0]?.mesh?.descriptor).toEqual({ kind: "asset", asset: BIN, primitive: 0, layout: PRIMITIVE });
  });

  it("reports an asset mesh that does not match the assets table as E8006", () => {
    expect(problems(withAssetMesh((json) => (json["assets"] = [])))).toEqual(["MTEK-E8006 field: meshes[0].asset"]);
    expect(problems(withAssetMesh((json) => ((json["meshes"] as Json[])[0] ??= {})["primitive"] = 1))).toEqual(["MTEK-E8006 field: meshes[0].primitive"]);
    // The id names an image, not mesh data.
    expect(
      problems(
        withAssetMesh((json) => {
          json["assets"] = [{ url: BIN, sha256: "0".repeat(64), bytes: 68, kind: "image", colorSpace: "srgb", preprocessing: [], span: 3 }];
        }),
      ),
    ).toEqual(["MTEK-E8006 field: meshes[0].asset"]);
  });

  it("reports primitive regions that do not fit the file as E8006, naming the region", () => {
    const shortFile = withAssetMesh((json) => (((json["assets"] as Json[])[0] ?? {})["bytes"] = 64));
    const result = resolveStructure(shortFile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.message).toContain("the index data (bytes 60 to 66) lies outside the 64-byte file");
    const misaligned = withAssetMesh((json) => (((((json["assets"] as Json[])[0] ?? {})["primitives"] as Json[])[0] ?? {})["offsets"] = { position: 0, uv: 38, indices: 60 }));
    const bad = resolveStructure(misaligned);
    if (!bad.ok) expect(bad.diagnostics[0]?.message).toContain("the uv data starts at byte 38, which is not a multiple of 4");
    else throw new Error("expected a failure");
  });

  it("reports an asset mesh that lacks an attribute its material reads as E8006", () => {
    const missing = withAssetMesh((json) => {
      ((json["shaders"] as Json[])[0] ?? {})["vertexAttributes"] = ["position", "normal"];
    });
    const result = resolveStructure(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((d) => `${d.code} ${d.notes[0] ?? ""}`)).toEqual(["MTEK-E8006 field: scene.entities[0]"]);
      expect(result.diagnostics[0]?.message).toContain("reads 'normal'");
    }
    // A primitive shape has every attribute, whatever the material reads.
    const box = manifestWith((json) => {
      ((json["shaders"] as Json[])[0] ?? {})["vertexAttributes"] = ["position", "normal", "uv"];
    });
    expect(resolveStructure(box).ok).toBe(true);
  });
});

describe("resolveStructure: textures and samplers", () => {
  /** The minimal manifest's material with a texture at binding 1 and a sampler at binding 2. */
  function textured(edit: (material: Json, instance: Json) => void = () => undefined): MtekManifest {
    return manifestWith((json, scene) => {
      const material = (json["materials"] as Json[])[0] ?? {};
      const instance = scene.materialInstances[0] ?? {};
      material["resources"] = [
        { name: "map", kind: "texture", binding: 1 },
        { name: "filter", kind: "sampler", binding: 2 },
      ];
      (material["params"] as Json[]).push({ name: "map", type: "texture", span: 3 }, { name: "filter", type: "sampler", span: 3 });
      (instance["params"] as Json[]).push(
        { name: "map", class: "resource", value: { kind: "builtin", name: "texture.black" } },
        { name: "filter", class: "resource", value: { kind: "builtin", name: "sampler.nearest_clamp" } },
      );
      edit(material, instance);
    });
  }

  it("resolves the resources of a material and of its instances, in declaration order", () => {
    const result = resolveStructure(textured());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.structure.materials[0]?.resources).toEqual([
      { name: "map", kind: "texture", binding: 1 },
      { name: "filter", kind: "sampler", binding: 2 },
    ]);
    expect(result.structure.instances[0]?.resources).toEqual([
      { name: "map", kind: "texture", binding: 1, value: "texture.black" },
      { name: "filter", kind: "sampler", binding: 2, value: "sampler.nearest_clamp" },
    ]);
  });

  it("reports resources that do not match the params as E8006", () => {
    // A binding out of order, a kind that differs from the param's type, and an instance without a value.
    expect(problems(textured((material) => ((material["resources"] as Json[])[0] ??= {})["binding"] = 2))).toEqual(["MTEK-E8006 field: materials[0].resources"]);
    expect(problems(textured((material) => ((material["resources"] as Json[])[1] ??= {})["kind"] = "texture"))).toEqual(["MTEK-E8006 field: materials[0].resources"]);
    expect(problems(textured((_, instance) => ((instance["params"] as Json[]).length = 1)))).toEqual(["MTEK-E8006 field: scene.materialInstances[0].params"]);
    expect(problems(textured((_, instance) => ((instance["params"] as Json[])[1] = { name: "filter", class: "resource", value: { kind: "builtin", name: "texture.white" } })))).toEqual([
      "MTEK-E8006 field: scene.materialInstances[0].params",
    ]);
  });

  const IMAGE = { url: "assets/0123456789abcdef.png", sha256: "1".repeat(64), bytes: 76, kind: "image", colorSpace: "linear", preprocessing: [], span: 3 };
  function fromAsset(assets: Json[]): MtekManifest {
    return manifestWith((json, scene) => {
      const material = (json["materials"] as Json[])[0] ?? {};
      const instance = scene.materialInstances[0] ?? {};
      material["resources"] = [
        { name: "map", kind: "texture", binding: 1 },
        { name: "filter", kind: "sampler", binding: 2 },
      ];
      (material["params"] as Json[]).push({ name: "map", type: "texture", span: 3 }, { name: "filter", type: "sampler", span: 3 });
      (instance["params"] as Json[]).push(
        { name: "map", class: "resource", value: { kind: "asset", asset: IMAGE.url } },
        { name: "filter", class: "resource", value: { kind: "builtin", name: "sampler.nearest_clamp" } },
      );
      json["assets"] = assets;
    });
  }

  it("resolves a texture from an image file with its colour space", () => {
    const result = resolveStructure(fromAsset([IMAGE]));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const [map, filter] = result.structure.instances[0]?.resources ?? [];
    expect(map).toEqual({ name: "map", kind: "texture", binding: 1, value: IMAGE.url, asset: IMAGE });
    expect(filter).toEqual({ name: "filter", kind: "sampler", binding: 2, value: "sampler.nearest_clamp" });
  });

  it("reports a texture that names no image file as E8006", () => {
    expect(problems(fromAsset([]))).toEqual(["MTEK-E8006 field: scene.materialInstances[0].params"]);
    const meshData = { url: IMAGE.url, sha256: IMAGE.sha256, bytes: 8, kind: "mesh-data", primitives: [], preprocessing: [], span: 3 };
    expect(problems(fromAsset([meshData]))).toEqual(["MTEK-E8006 field: scene.materialInstances[0].params"]);
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
