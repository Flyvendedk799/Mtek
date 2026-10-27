import { describe, expect, it } from "vitest";
import { irFacts, manifestFacts } from "../src/facts.ts";
import type { Json } from "../src/json.ts";

const span = { file: 0, start: 0, end: 1 };
const f32 = (value: number): Json => ({ kind: "const", value: { f32: value }, type: "f32", span });
const local = (name: string): Json => ({ kind: "local", local: 0, name, type: "f32", span });

function program(modules: Json[]): Json {
  return { entryScene: "src/main.mtek::Demo", modules };
}

function fn(name: string, effect: string, stmts: Json[]): Json {
  return {
    kind: "function",
    name,
    symbol: `src/main.mtek::${name}`,
    effect,
    gpuReachable: effect === "pure",
    cpuReachable: false,
    result: "f32",
    locals: [{ index: 0, name: "x", type: "f32", kind: "param", span }],
    body: { stmts, span },
    span,
  };
}

describe("irFacts", () => {
  it("reads statements, assignment operators and branches", () => {
    const ir = program([
      {
        path: "src/main.mtek",
        items: [
          fn("f", "pure", [
            { kind: "let", local: 1, value: f32(1), span },
            {
              kind: "assign",
              target: { root: { kind: "local", local: 1, name: "v", type: "f32", span }, steps: [{ kind: "index", index: f32(0), type: "f32", span }], type: "f32", span },
              op: "+=",
              value: f32(2),
              span,
            },
            {
              kind: "if",
              branches: [
                { cond: { kind: "binary", op: "<", lhs: local("x"), rhs: f32(1), type: "bool", span }, body: { stmts: [], span } },
                { cond: { kind: "binary", op: "&&", lhs: local("x"), rhs: f32(1), type: "bool", span }, body: { stmts: [], span } },
              ],
              else: { stmts: [], span },
              span,
            },
            { kind: "forRange", local: 2, start: f32(0), end: f32(3), body: { stmts: [{ kind: "break", span }], span }, span },
            { kind: "return", value: { kind: "unary", op: "-", operand: local("x"), type: "f32", span }, span },
          ]),
        ],
      },
    ]);
    const facts = irFacts(ir);
    for (const id of [
      "functions",
      "fn/gpu-reachable",
      "stmt/let",
      "stmt/assign:+=",
      "place/root:local",
      "place/step:index",
      "indexing",
      "stmt/if",
      "stmt/else-if",
      "stmt/else",
      "op/binary:<",
      "comparison",
      "op/binary:&&",
      "logical",
      "stmt/forRange",
      "stmt/break",
      "stmt/return:value",
      "op/unary:-",
      "negation",
      "local/param",
      "type:f32",
    ]) {
      expect(facts, id).toContain(id);
    }
    expect(facts).not.toContain("cpu-functions");
    expect(facts).not.toContain("stmt/forEach");
  });

  it("tells a cpu fn from a fn and a unit return from a value return", () => {
    const facts = irFacts(
      program([{ path: "src/main.mtek", items: [fn("g", "cpu", [{ kind: "return", value: null, span }])] }]),
    );
    expect(facts).toContain("cpu-functions");
    expect(facts).not.toContain("functions");
    expect(facts).toContain("stmt/return:unit");
  });

  it("derives the registry rows of a builtin call, a namespace function and an enum member", () => {
    const body = [
      { kind: "expr", expr: { kind: "builtin", function: "quat.axis_angle", args: [], type: "quat", span }, span },
      { kind: "expr", expr: { kind: "builtin", function: "sin", args: [], type: "f32", span }, span },
      { kind: "expr", expr: { kind: "enumMember", enumeration: "Key", member: "Space", code: "Space", type: "Key", span }, span },
      { kind: "expr", expr: { kind: "frame", member: "delta", type: "f32", span }, span },
    ];
    const facts = irFacts(program([{ path: "src/main.mtek", items: [fn("h", "cpu", body)] }]));
    for (const id of ["function:quat.axis_angle", "namespace:quat", "function:sin", "enum:Key", "namespace:frame", "value:frame.delta", "type:quat"]) {
      expect(facts, id).toContain(id);
    }
  });

  it("derives descriptor schemas, bodies, colliders and host-visible entity facets", () => {
    const entity = {
      index: 0,
      name: "Crate",
      parent: null,
      position: { source: { const: { vec3: [0, 0, 0] } }, origin: "written" },
      mesh: { desc: { kind: "box", size: [1, 1, 1] }, origin: "written" },
      material: { material: "std/materials.mtek::Pbr", params: [{ name: "metallic", type: "f32", source: { const: { f32: 0 } }, update: "initial" }], origin: "written" },
      body: { desc: { kind: "dynamic", mass: 1 }, origin: "written" },
      collider: { desc: { kind: "sphere", sensor: true }, origin: "written" },
    };
    const scene = { kind: "scene", name: "Demo", fields: { clearColor: { source: { const: { color: [0, 0, 0, 1] } }, origin: "written" } }, constants: [], cameras: [], entities: [entity], state: [], behaviors: [], bindings: [] };
    const facts = irFacts(program([{ path: "src/main.mtek", items: [scene] }]));
    for (const id of [
      "scenes",
      "scene-fields",
      "schema:Scene",
      "entities",
      "schema:Entity",
      "entity-fields",
      "entity-field/position",
      "schema:Box",
      "schema:Pbr",
      "form/builtin-material",
      "param-update/initial",
      "schema:Dynamic",
      "entity/body",
      "schema:SphereCollider",
      "entity/sensor-collider",
    ]) {
      expect(facts, id).toContain(id);
    }
  });

  it("treats a prefab's entity 0 as self and a call into another module as cross-file", () => {
    const prefab = {
      kind: "prefab",
      name: "Crate",
      symbol: "src/props.mtek::Crate",
      params: [{ name: "height", type: "f32", default: { f32: 1 } }],
      constants: [],
      entity: { index: 0, name: "Crate", parent: null },
      state: [],
      behaviors: [
        {
          kind: { kind: "update" },
          owner: { kind: "entity", index: 0 },
          symbol: "src/props.mtek::Crate.update",
          locals: [],
          body: {
            stmts: [
              { kind: "expr", expr: { kind: "call", function: "src/theme.mtek::half", args: [], type: "f32", span }, span },
              { kind: "assign", target: { root: { kind: "entityField", entity: 0, field: "position", type: "vec3", span }, steps: [], type: "vec3", span }, op: "=", value: f32(1), span },
            ],
            span,
          },
        },
      ],
      bindings: [],
    };
    const facts = irFacts(program([{ path: "src/main.mtek", items: [] }, { path: "src/props.mtek", items: [prefab] }]));
    for (const id of ["imports", "exports", "module/multi-file", "prefabs", "prefab/params", "self", "module/cross-file-call", "behavior/owner:prefab", "lifecycle-functions"]) {
      expect(facts, id).toContain(id);
    }
  });

  it("derives images of the texture functions and the GLB accessor from the value, not from a call", () => {
    const image = (source: Json, space: string): Json => ({ kind: "const", name: "T", symbol: "src/main.mtek::T", type: "texture", value: { image: { source, space, mipmapped: false } }, span });
    const facts = irFacts(
      program([
        {
          path: "src/main.mtek",
          items: [
            image({ file: "a.png" }, "srgb"),
            image({ file: "b.png" }, "linear"),
            image({ embedded: { glb: "m.glb", image: 0 } }, "srgb"),
          ],
        },
      ]),
    );
    for (const id of ["function:asset.texture", "function:asset.linear_texture", "method:glb_asset.material_texture", "constants", "type:texture"]) {
      expect(facts, id).toContain(id);
    }
  });

  it("is empty for something that is not a program", () => {
    expect(irFacts(null).size).toBe(0);
    expect(irFacts({ modules: "x" }).size).toBe(0);
  });
});

describe("manifestFacts", () => {
  it("reads host inputs with their codecs, the physics subsystem, assets and lights", () => {
    const facts = manifestFacts({
      subsystems: { physics: true },
      assets: [{ kind: "mesh-data" }, { kind: "image" }],
      materials: [{ id: "m" }],
      scene: { hostInputs: [{ name: "a", codec: "f32" }, { name: "b", codec: "color-hex-opaque" }], lights: [{}] },
    });
    for (const id of [
      "project/host-inputs",
      "project/host-input-codec:f32",
      "project/host-input-codec:color-hex-opaque",
      "project/physics-subsystem",
      "project/asset:mesh-data",
      "project/asset:image",
      "project/lights",
      "project/user-material-shaders",
    ]) {
      expect(facts, id).toContain(id);
    }
  });

  it("derives nothing for a program that exposes nothing", () => {
    expect(manifestFacts({ subsystems: { physics: false }, assets: [], materials: [], scene: { hostInputs: [], lights: [] } }).size).toBe(0);
  });
});


describe("host output manifest facts", () => {
  it("counts declared outputs and preserves old manifests", () => {
    expect(manifestFacts({ scene: {} }).has("project/host-outputs")).toBe(false);
    expect(manifestFacts({ scene: { hostOutputs: [] } }).has("project/host-outputs")).toBe(false);
    expect(manifestFacts({ scene: { hostOutputs: [{ name: "total", source: { kind: "state", name: "total" }, type: "f32" }] } }).has("project/host-outputs")).toBe(true);
  });
});

describe("compute facts", () => {
  it("distinguishes compute storage/uniform reads from material parameters", () => {
    const ir = program([{path:"src/main.mtek",items:[{kind:"compute",params:[],kernel:{body:{stmts:[{kind:"return",value:{kind:"storageRead",type:"f32",input:0,index:f32(0)}},{kind:"return",value:{kind:"param",type:"f32",name:"gain"}}]}}}]}]);
    const facts = irFacts(ir);
    expect(facts.has("compute-programs")).toBe(true);
    expect(facts.has("compute/storage-read")).toBe(true);
    expect(facts.has("compute/param-read")).toBe(true);
    expect(facts.has("expr/material-param-read")).toBe(false);
  });
});
