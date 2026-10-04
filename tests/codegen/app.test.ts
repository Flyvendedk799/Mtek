// Execution test of the generated program module (spec/runtime-abi.md sections 3 and 4,
// spec/testing.md section 4.1, decision 0030): every codegen fixture's golden `app.js`
// (tests/codegen/<fixture>/expected/) is imported in Node with a test module standing in for the
// runtime bundle, and
//  - its export surface is exactly the ABI-1 surface, with module-private writers;
//  - `writers` covers every layout of the manifest and agrees with the independent encoder;
//  - `scenes.<entry>.init(ctx)` makes exactly the setter calls the typed IR golden
//    (tests/codegen/ir/<fixture>.ir.json) implies, with bit-exact binary32 values.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { firstDifference } from "./support/bytes.js";
import type { CpuValue } from "./support/cpu-value.js";
import { encodeBlock } from "./support/encoder.js";
import { type SetterCall, createFakeContext } from "./support/fake-ctx.js";
import { type Views, codegenDir, makeViews, outDir } from "./support/fixtures.js";
import { parseLayoutRecord } from "./support/layout.js";

interface ManifestLayout {
  readonly id: string;
  readonly wgslStruct: string;
  readonly root: { readonly members: readonly { readonly name: string }[] };
}

interface Manifest {
  readonly entryScene: string;
  readonly layouts: readonly ManifestLayout[];
  readonly materials: readonly { readonly id: string; readonly layout: string | null }[];
  readonly scene: {
    readonly entities: readonly {
      readonly index: number;
      readonly material: { readonly id: string; readonly instance: number } | null;
    }[];
  };
}

type IrValue = Readonly<Record<string, unknown>>;

interface IrField {
  readonly source: { readonly const: IrValue };
}

interface IrSpan {
  readonly start: number;
}

interface IrCamera {
  readonly active: boolean;
  readonly span: IrSpan;
  readonly position: IrField;
  readonly target: IrField | null;
  readonly rotation: IrField;
  readonly projection: { readonly desc: Readonly<Record<string, string | number>> };
}

interface IrEntity {
  readonly index: number;
  readonly span: IrSpan;
  readonly position: IrField;
  readonly rotation: IrField;
  readonly scale: IrField;
  readonly visible: IrField;
  readonly material: {
    readonly params: readonly { readonly name: string; readonly source: { readonly const: IrValue } }[];
  } | null;
}

interface IrScene {
  readonly kind: string;
  readonly symbol: string;
  readonly cameras: readonly IrCamera[];
  readonly entities: readonly IrEntity[];
}

interface IrProgram {
  readonly entryScene: string;
  readonly modules: readonly { readonly items: readonly IrScene[] }[];
}

type Writer = (m: Views, base: number, v: unknown) => void;

interface LoadedProgram {
  readonly module: Readonly<Record<string, unknown>>;
  readonly appUrl: string;
  readonly manifest: Manifest;
  readonly ir: IrProgram;
}

/** The codegen fixtures: directories under tests/codegen with an mtek.toml. */
const fixtures = readdirSync(codegenDir)
  .filter((name) => existsSync(resolve(codegenDir, name, "mtek.toml")))
  .sort();

const RUNTIME_LINE = /^export \{ mountMtek \} from "\.\/(runtime\.[0-9a-f]{16}\.js)";$/m;

function record(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Copies the golden dist/ and adds a stand-in for the runtime bundle, then imports app.js. */
async function load(name: string): Promise<LoadedProgram> {
  const target = resolve(outDir, "programs", name);
  rmSync(target, { recursive: true, force: true });
  cpSync(resolve(codegenDir, name, "expected"), target, { recursive: true });
  // app.js.map names the project-relative sources (decision 0030); put them where it says.
  cpSync(resolve(codegenDir, name, "src"), resolve(target, "src"), { recursive: true });
  const appFile = resolve(target, "app.js");
  const runtime = RUNTIME_LINE.exec(readFileSync(appFile, "utf8"))?.[1];
  if (runtime === undefined) throw new Error(`${name}: app.js has no runtime re-export line`);
  writeFileSync(
    resolve(target, runtime),
    'export function mountMtek() { throw new Error("test stand-in for the runtime"); }\n',
  );
  const appUrl = pathToFileURL(appFile).href;
  const module = record(await import(/* @vite-ignore */ appUrl), name);
  const manifest = JSON.parse(readFileSync(resolve(target, "program.manifest.json"), "utf8")) as Manifest;
  const ir = JSON.parse(
    readFileSync(resolve(codegenDir, "ir", `${name}.ir.json`), "utf8"),
  ) as IrProgram;
  return { module, appUrl, manifest, ir };
}

/** The CPU representation (spec/runtime-abi.md section 4.1) of a typed IR constant. */
function cpuValue(value: IrValue): unknown {
  const [tag, raw] = Object.entries(value)[0] ?? [];
  const components = (names: readonly string[]): Record<string, number> => {
    const list = raw as readonly number[];
    return Object.fromEntries(names.map((n, i) => [n, Math.fround(list[i] ?? Number.NaN)]));
  };
  switch (tag) {
    case "bool":
      return raw;
    case "f32":
      return Math.fround(raw as number);
    case "vec3":
      return components(["x", "y", "z"]);
    case "quat":
      return components(["x", "y", "z", "w"]);
    case "color":
      return components(["r", "g", "b", "a"]);
    default:
      throw new Error(`no CPU shape for the IR value ${JSON.stringify(value)}`);
  }
}

/** The setter calls the initialisation order of spec/scenes.md section 11 implies. */
function expectedCalls(ir: IrProgram): SetterCall[] {
  const scene = ir.modules
    .flatMap((m) => m.items)
    .find((item) => item.kind === "scene" && item.symbol === ir.entryScene);
  if (scene === undefined) throw new Error("the IR has no entry scene");
  const calls: SetterCall[] = [];
  const declarations: ({ camera: IrCamera } | { entity: IrEntity })[] = [
    ...scene.cameras.filter((c) => c.active).map((camera) => ({ camera })),
    ...scene.entities.map((entity) => ({ entity })),
  ];
  const start = (d: { camera: IrCamera } | { entity: IrEntity }): number =>
    "camera" in d ? d.camera.span.start : d.entity.span.start;
  declarations.sort((a, b) => start(a) - start(b));
  for (const declaration of declarations) {
    if ("camera" in declaration) {
      const camera = declaration.camera;
      const set = (field: string, value: unknown): void => {
        calls.push({ method: "setCamera", entity: -1, field, value });
      };
      set("position", cpuValue(camera.position.source.const));
      if (camera.target === null) set("rotation", cpuValue(camera.rotation.source.const));
      else set("target", cpuValue(camera.target.source.const));
      const desc = camera.projection.desc;
      const fields =
        desc["kind"] === "perspective"
          ? [["projection.fov_y", "fovY"], ["projection.near", "near"], ["projection.far", "far"]]
          : [["projection.height", "height"], ["projection.near", "near"], ["projection.far", "far"]];
      for (const [field, key] of fields) {
        set(field ?? "", Math.fround(desc[key ?? ""] as number));
      }
      continue;
    }
    const entity = declaration.entity;
    for (const field of ["position", "rotation", "scale"] as const) {
      calls.push({
        method: "setTransform",
        entity: entity.index,
        field,
        value: cpuValue(entity[field].source.const),
      });
    }
    calls.push({
      method: "setVisible",
      entity: entity.index,
      field: "visible",
      value: cpuValue(entity.visible.source.const),
    });
    for (const param of entity.material?.params ?? []) {
      calls.push({
        method: "setParam",
        entity: entity.index,
        field: param.name,
        value: cpuValue(param.source.const),
      });
    }
  }
  return calls;
}

describe("the generated program module", () => {
  it("covers the two M1 scene fixtures", () => {
    expect(fixtures).toEqual(["scene_a_target_camera_box", "scene_b_orthographic_nested"]);
  });

  for (const name of fixtures) {
    describe(name, () => {
      it("has exactly the ABI-1 export surface", async () => {
        const { module, appUrl, manifest } = await load(name);
        expect(Object.keys(module).sort()).toEqual([
          "abi",
          "baseUrl",
          "default",
          "functions",
          "manifestUrl",
          "mountMtek",
          "prefabs",
          "scenes",
          "writers",
        ]);
        expect(module["abi"]).toBe(1);
        expect(String(module["baseUrl"])).toBe(new URL("./", appUrl).href);
        expect(String(module["manifestUrl"])).toBe(new URL("./program.manifest.json", appUrl).href);
        expect(typeof module["mountMtek"]).toBe("function");
        const program = record(module["default"], "default export");
        expect(Object.keys(program)).toEqual([
          "abi",
          "baseUrl",
          "manifestUrl",
          "writers",
          "functions",
          "scenes",
          "prefabs",
        ]);
        for (const key of Object.keys(program)) expect(program[key]).toBe(module[key]);
        expect(module["functions"]).toEqual({});
        expect(module["prefabs"]).toEqual({});

        const scenes = record(module["scenes"], "scenes");
        expect(Object.keys(scenes)).toEqual([manifest.entryScene]);
        const scene = record(scenes[manifest.entryScene], "scene");
        expect(Object.keys(scene)).toEqual([
          "init",
          "update",
          "fixedUpdate",
          "entityUpdate",
          "entityFixedUpdate",
          "events",
          "bindings",
        ]);
        expect(typeof scene["init"]).toBe("function");
        expect(scene["update"]).toBeNull();
        expect(scene["fixedUpdate"]).toBeNull();
        const nulls = manifest.scene.entities.map(() => null);
        expect(scene["entityUpdate"]).toEqual(nulls);
        expect(scene["entityFixedUpdate"]).toEqual(nulls);
        expect(scene["events"]).toEqual({});
        expect(scene["bindings"]).toEqual([]);
      });

      it("init sets every camera, transform, visibility and param value through ctx", async () => {
        const { module, manifest, ir } = await load(name);
        const scene = record(record(module["scenes"], "scenes")[manifest.entryScene], "scene");
        const init = scene["init"] as (ctx: unknown) => void;
        const { ctx, calls } = createFakeContext(manifest.scene.entities.length);
        init(ctx);
        const expected = expectedCalls(ir);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls).toStrictEqual(expected);
      });

      it("has a writer for every layout, agreeing with the independent encoder", async () => {
        const { module, manifest, ir } = await load(name);
        const writers = record(module["writers"], "writers");
        expect(Object.keys(writers)).toEqual(manifest.layouts.map((l) => l.id));
        for (const layout of manifest.layouts) {
          const entry = record(writers[layout.id], layout.id);
          expect(typeof entry["all"]).toBe("function");
          const fields = record(entry["fields"], `${layout.id}.fields`);
          expect(Object.keys(fields)).toEqual(layout.root.members.map((m) => m.name));
        }
        // Each entity's material params, written by the material's whole-block writer, give the
        // bytes the independent encoder computes from the layout record alone.
        const calls = expectedCalls(ir);
        for (const entity of manifest.scene.entities) {
          if (entity.material === null) continue;
          const materialId = entity.material.id;
          const layoutId = manifest.materials.find((m) => m.id === materialId)?.layout;
          const layout = manifest.layouts.find((l) => l.id === layoutId);
          if (layout === undefined) throw new Error(`${name}: no layout for ${materialId}`);
          const value = Object.fromEntries(
            calls
              .filter((c) => c.method === "setParam" && c.entity === entity.index)
              .map((c) => [c.field, c.value]),
          );
          const parsed = parseLayoutRecord(
            JSON.stringify({ ...layout, root: { name: layout.wgslStruct, ...layout.root } }),
          );
          const expectedBytes = encodeBlock(parsed, value as CpuValue);
          const buffer = new ArrayBuffer(parsed.size);
          const all = record(writers[layout.id], layout.id)["all"] as Writer;
          all(makeViews(buffer), 0, value);
          expect(firstDifference(expectedBytes, new Uint8Array(buffer))).toBeNull();
        }
      });
    });
  }
});
