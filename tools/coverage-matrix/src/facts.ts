// What a compiled program uses, read off its typed IR (`mtek inspect --ir --format json`, decision 0028)
// and its program manifest (`program.manifest.json`, `spec/runtime-abi.md` section 3). Nothing here
// reads source text: every fact is a node, a discriminator or a name the compiler wrote.
//
// A fact is a string. Two vocabularies share the namespace:
//  - the registry ids of `mtek context` (`supported.features`): `function:sin`, `schema:Box`,
//    `event:key_down`, `body-command:apply_impulse`, `type:vec3`, `scene-objects`, ...
//  - the form ids of `forms.ts` (`stmt/let`, `expr/swizzle`, `op/binary:+`, `module/cross-file-prefab`,
//    `project/host-inputs`, ...), the constructs of the language reference that the registry has no
//    row for.
//
// What the IR cannot show (decision 0093): it holds folded values, so a constant call (`color.srgb(…)`,
// `vec3(0.0, 1.0, 0.0)`, `asset.glb("…").mesh("Seat")`) leaves its result and no call; `self` in the body
// of a named entity is the entity's own index, like its own name; and an `import`/`export` leaves no
// node (the module list and the cross-file symbols are its trace). `uses.ts` adds what the compiler's
// resolver records for those: the standard-library item every name in the source denotes.
import { arr, asArray, isObject, obj, str, type Json, type JsonObject } from "./json.ts";

export type FactSet = Set<string>;

/** Type names that occur in a type string: `array<vec3, 4>` has `array` and `vec3`. */
function typeTokens(type: string): string[] {
  return type.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
}

const MESH_SCHEMAS: Record<string, string> = { box: "Box", sphere: "Sphere", plane: "Plane" };
const PROJECTION_SCHEMAS: Record<string, string> = { perspective: "Perspective", orthographic: "Orthographic" };
const LIGHT_SCHEMAS: Record<string, string> = { directional: "DirectionalLight", point: "PointLight" };
const BODY_SCHEMAS: Record<string, string> = { static: "Static", dynamic: "Dynamic", kinematic: "Kinematic" };
const COLLIDER_SCHEMAS: Record<string, string> = { box: "BoxCollider", sphere: "SphereCollider" };

interface Context {
  facts: FactSet;
  /** The module being walked (`src/main.mtek`). */
  module: string;
  /** What kind of item the walk is inside: `material`, `prefab`, `scene`, `function`, or `""`. */
  item: string;
}

function add(ctx: Context, ...ids: string[]): void {
  for (const id of ids) ctx.facts.add(id);
}

function modulePathOfSymbol(symbol: string): string {
  const at = symbol.indexOf("::");
  return at < 0 ? symbol : symbol.slice(0, at);
}

function typeFact(ctx: Context, type: unknown): void {
  if (typeof type !== "string") return;
  for (const token of typeTokens(type)) add(ctx, `type:${token}`);
  if (type.startsWith("array<")) add(ctx, "arrays");
  if (type === "string") add(ctx, "strings");
}

function valueFact(ctx: Context, value: unknown): void {
  if (!isObject(value)) return;
  for (const [tag, inner] of Object.entries(value)) {
    switch (tag) {
      case "texture":
      case "sampler":
        if (typeof inner === "string") {
          add(ctx, `function:${inner}`, `namespace:${inner.split(".")[0] ?? tag}`);
        }
        break;
      case "string":
        add(ctx, "strings", "type:string");
        break;
      case "array":
        add(ctx, "arrays");
        for (const element of asArray(inner)) valueFact(ctx, element);
        break;
      case "struct":
        add(ctx, "structs");
        break;
      default:
        break;
    }
  }
}

function exprFact(ctx: Context, node: JsonObject): void {
  const kind = str(node, "kind");
  typeFact(ctx, node["type"]);
  switch (kind) {
    case "const":
      valueFact(ctx, node["value"]);
      break;
    case "unary": {
      const op = str(node, "op") ?? "?";
      add(ctx, `op/unary:${op}`, op === "-" ? "negation" : "logical");
      break;
    }
    case "binary": {
      const op = str(node, "op") ?? "?";
      add(ctx, `op/binary:${op}`);
      if (["+", "-", "*", "/"].includes(op)) add(ctx, "arithmetic");
      else if (op === "%") add(ctx, "remainder");
      else if (["<", "<=", ">", ">="].includes(op)) add(ctx, "comparison");
      else if (["==", "!="].includes(op)) add(ctx, "equality");
      else if (["&&", "||"].includes(op)) add(ctx, "logical");
      break;
    }
    case "call": {
      add(ctx, "expr/call");
      const symbol = str(node, "function") ?? "";
      if (modulePathOfSymbol(symbol) !== ctx.module) add(ctx, "module/cross-file-call");
      break;
    }
    case "builtin": {
      const name = str(node, "function") ?? "?";
      add(ctx, `function:${name}`, "expr/builtin-call");
      const dot = name.indexOf(".");
      if (dot > 0) add(ctx, `namespace:${name.slice(0, dot)}`);
      break;
    }
    case "construct":
      add(ctx, "expr/vector-construct");
      break;
    case "convert":
      add(ctx, "expr/convert");
      break;
    case "components":
      add(ctx, arr(node, "components").length > 1 ? "expr/swizzle" : "expr/component");
      break;
    case "field":
      add(ctx, "expr/struct-field");
      break;
    case "index":
      add(ctx, "indexing", "expr/index");
      break;
    case "array":
      add(ctx, "arrays", "expr/array-literal");
      break;
    case "struct":
      add(ctx, "structs", "expr/struct-literal");
      break;
    case "descriptor": {
      add(ctx, "descriptors", "expr/descriptor");
      const schema = str(node, "schema");
      if (schema !== undefined) add(ctx, `schema:${schema}`);
      break;
    }
    case "state": {
      const owner = str(obj(node, "owner"), "kind") ?? "scene";
      add(ctx, "expr/state-read", `expr/state-read:${owner}`);
      break;
    }
    case "entityField":
      add(ctx, "expr/entity-field-read");
      break;
    case "cameraField":
      add(ctx, "expr/camera-field-read");
      break;
    case "instanceParam":
      add(ctx, "expr/instance-param-read");
      break;
    case "lightField":
      add(ctx, "expr/light-field-read");
      break;
    case "bodyCommand": {
      const command = str(node, "command");
      if (command !== undefined) add(ctx, `body-command:${command}`);
      add(ctx, `expr/body-target:${str(obj(node, "target"), "kind") ?? "entity"}`);
      break;
    }
    case "bodyProperty": {
      const property = str(node, "property");
      if (property !== undefined) add(ctx, `body-property:${property}`);
      add(ctx, `expr/body-target:${str(obj(node, "target"), "kind") ?? "entity"}`);
      break;
    }
    case "frame": {
      const member = str(node, "member");
      add(ctx, "namespace:frame");
      if (member !== undefined) add(ctx, `value:frame.${member}`);
      break;
    }
    case "enumMember": {
      const enumeration = str(node, "enumeration");
      if (enumeration !== undefined) add(ctx, `enum:${enumeration}`);
      break;
    }
    case "param":
      add(ctx, ctx.item === "prefab" ? "expr/prefab-param-read" : "expr/material-param-read");
      break;
    case "material": {
      add(ctx, "expr/material-literal");
      break;
    }
    case "prefabLiteral": {
      add(ctx, "expr/prefab-literal");
      if (modulePathOfSymbol(str(node, "prefab") ?? "") !== ctx.module) add(ctx, "module/cross-file-spawn");
      break;
    }
    case "entityRef":
      add(ctx, "expr/entity-ref");
      break;
    default:
      break;
  }
}

function placeRootFact(ctx: Context, root: JsonObject): void {
  const kind = str(root, "kind") ?? "?";
  add(ctx, `place/root:${kind}`);
  if (kind === "state") add(ctx, `place/root:state:${str(obj(root, "owner"), "kind") ?? "scene"}`);
  typeFact(ctx, root["type"]);
}

function stmtFact(ctx: Context, node: JsonObject): void {
  const kind = str(node, "kind");
  if (kind === undefined) return;
  add(ctx, `stmt/${kind}`);
  switch (kind) {
    case "assign": {
      const op = str(node, "op") ?? "=";
      add(ctx, `stmt/assign:${op}`);
      const target = obj(node, "target");
      const root = obj(target, "root");
      if (root !== undefined) placeRootFact(ctx, root);
      if (arr(target, "steps").length > 0) add(ctx, "place/steps");
      break;
    }
    case "if": {
      if (arr(node, "branches").length > 1) add(ctx, "stmt/else-if");
      if (isObject(node["else"])) add(ctx, "stmt/else");
      break;
    }
    case "return":
      add(ctx, node["value"] === null || node["value"] === undefined ? "stmt/return:unit" : "stmt/return:value");
      break;
    case "const":
      add(ctx, "body-constants");
      break;
    default:
      break;
  }
}

function meshFact(ctx: Context, mesh: JsonObject): void {
  const desc = obj(mesh, "desc");
  const kind = str(desc, "kind");
  if (kind === undefined) return;
  add(ctx, "descriptors", "type:mesh");
  const schema = MESH_SCHEMAS[kind];
  if (schema !== undefined) add(ctx, `schema:${schema}`);
  if (kind === "asset") {
    // `asset.glb("…").mesh("…")` folds to the primitive of the packaged file.
    add(ctx, "function:asset.glb", "namespace:asset", "type:glb_asset", "method:glb_asset.mesh");
    if (desc !== undefined && desc["primitive"] !== undefined) add(ctx, "method:glb_asset.primitive");
  }
}

function materialInstanceFact(ctx: Context, material: JsonObject): void {
  const symbol = str(material, "material");
  if (symbol === undefined) return;
  add(ctx, "type:material", "descriptors");
  if (symbol.startsWith("std/materials.mtek::")) {
    add(ctx, `schema:${symbol.slice("std/materials.mtek::".length)}`, "form/builtin-material");
  } else {
    add(ctx, "form/user-material-instance");
    if (modulePathOfSymbol(symbol) !== ctx.module) add(ctx, "module/cross-file-material");
  }
  for (const param of arr(material, "params")) {
    const update = str(param, "update");
    if (update !== undefined) add(ctx, `param-update/${update}`);
    typeFact(ctx, obj(param, "type") ?? (isObject(param) ? param["type"] : undefined));
    if (isObject(param)) valueFact(ctx, obj(param, "source")?.["const"]);
  }
}

function entityFact(ctx: Context, entity: JsonObject): void {
  add(ctx, "entities", "schema:Entity", "scene-objects");
  if (entity["parent"] !== null && entity["parent"] !== undefined) add(ctx, "entity/nested");
  const written = ["position", "rotation", "scale", "visible", "mesh", "material", "light", "body", "collider"].filter((key) => {
    const field = obj(entity, key);
    return field !== undefined && str(field, "origin") === "written";
  });
  if (written.length > 0) add(ctx, "entity-fields");
  for (const name of written) add(ctx, `entity-field/${name}`);
  const mesh = obj(entity, "mesh");
  if (mesh !== undefined) meshFact(ctx, mesh);
  const material = obj(entity, "material");
  if (material !== undefined) materialInstanceFact(ctx, material);
  const light = obj(entity, "light");
  if (light !== undefined) {
    const kind = str(obj(light, "kind"), "kind");
    const schema = kind === undefined ? undefined : LIGHT_SCHEMAS[kind];
    if (schema !== undefined) add(ctx, `schema:${schema}`);
    add(ctx, "entity/light");
  }
  const body = obj(entity, "body");
  if (body !== undefined) {
    const kind = str(obj(body, "desc"), "kind");
    const schema = kind === undefined ? undefined : BODY_SCHEMAS[kind];
    if (schema !== undefined) add(ctx, `schema:${schema}`);
    add(ctx, "entity/body");
  }
  const collider = obj(entity, "collider");
  if (collider !== undefined) {
    const desc = obj(collider, "desc");
    const kind = str(desc, "kind");
    const schema = kind === undefined ? undefined : COLLIDER_SCHEMAS[kind];
    if (schema !== undefined) add(ctx, `schema:${schema}`);
    if (desc !== undefined && desc["sensor"] === true) add(ctx, "entity/sensor-collider");
    add(ctx, "entity/collider");
  }
  const prefab = obj(entity, "prefab");
  if (prefab !== undefined) {
    add(ctx, "prefab-instances", "entity/prefab-instance");
    if (modulePathOfSymbol(str(prefab, "prefab") ?? "") !== ctx.module) add(ctx, "module/cross-file-prefab");
  }
}

function behaviorFact(ctx: Context, behavior: JsonObject): void {
  const kind = obj(behavior, "kind");
  const name = str(kind, "kind");
  if (name === undefined) return;
  add(ctx, `behavior/${name}`);
  if (name === "event") {
    add(ctx, "handlers");
    const event = str(kind, "event");
    if (event !== undefined) add(ctx, `event:${event}`);
    if (kind !== undefined && typeof kind["filter"] === "string") add(ctx, "behavior/event-filter");
  } else {
    add(ctx, "lifecycle-functions");
  }
  add(ctx, `behavior/owner:${ctx.item === "prefab" ? "prefab" : (str(obj(behavior, "owner"), "kind") ?? "scene")}`);
}

function bindingFact(ctx: Context, binding: JsonObject): void {
  add(ctx, "bind", `binding/target:${str(obj(binding, "target"), "kind") ?? "?"}`);
  for (const dep of arr(binding, "deps")) add(ctx, `binding/dep:${str(dep, "kind") ?? "?"}`);
}

/** Visit every object of the IR, telling each the name of the property (or array property) that holds it. */
function visit(ctx: Context, node: Json, slot: string): void {
  if (Array.isArray(node)) {
    for (const element of node) visit(ctx, element, slot);
    return;
  }
  if (!isObject(node)) return;
  const kind = str(node, "kind");

  switch (slot) {
    case "modules":
      ctx.module = str(node, "path") ?? ctx.module;
      break;
    case "items": {
      ctx.item = kind ?? "";
      if (kind !== undefined) add(ctx, `item/${kind}`);
      switch (kind) {
        case "const":
          add(ctx, "constants");
          typeFact(ctx, node["type"]);
          break;
        case "scene":
          add(ctx, "scenes");
          if (arr(node, "constants").length > 0) add(ctx, "body-constants");
          break;
        case "struct":
          add(ctx, "structs");
          break;
        case "function":
          add(ctx, str(node, "effect") === "cpu" ? "cpu-functions" : "functions");
          if (node["gpuReachable"] === true) add(ctx, "fn/gpu-reachable");
          if (node["cpuReachable"] === true) add(ctx, "fn/cpu-reachable");
          typeFact(ctx, node["result"]);
          break;
        case "material":
          add(ctx, "materials");
          break;
        case "prefab":
          add(ctx, "prefabs");
          if (arr(node, "params").length > 0) add(ctx, "prefab/params");
          if (arr(node, "constants").length > 0) add(ctx, "body-constants");
          break;
        default:
          break;
      }
      break;
    }
    case "stmts":
      stmtFact(ctx, node);
      break;
    case "steps":
      if (kind !== undefined) add(ctx, `place/step:${kind}`);
      if (kind === "index") add(ctx, "indexing");
      typeFact(ctx, node["type"]);
      break;
    case "locals":
      if (kind !== undefined) add(ctx, `local/${kind}`);
      typeFact(ctx, node["type"]);
      break;
    case "cameras":
      add(ctx, "scene-object:camera", "schema:Camera", "scene-objects");
      {
        const projection = str(obj(obj(node, "projection"), "desc"), "kind");
        const schema = projection === undefined ? undefined : PROJECTION_SCHEMAS[projection];
        if (schema !== undefined) add(ctx, `schema:${schema}`);
        if (str(obj(node, "projection"), "origin") === "written") add(ctx, "camera/projection-written");
        if (obj(node, "target") !== undefined && str(obj(node, "target"), "origin") === "written") add(ctx, "camera/look-at");
      }
      break;
    case "entities":
      entityFact(ctx, node);
      break;
    case "behaviors":
      behaviorFact(ctx, node);
      break;
    case "bindings":
      bindingFact(ctx, node);
      break;
    case "state":
      if (typeof node["name"] === "string") {
        add(ctx, "state", `state/owner:${ctx.item === "prefab" ? "prefab" : (str(obj(node, "owner"), "kind") ?? "scene")}`);
        typeFact(ctx, node["type"]);
      }
      break;
    case "fields":
      // The written fields of a scene.
      if (isObject(node)) {
        for (const field of Object.values(node)) {
          if (str(field, "origin") === "written") {
            add(ctx, "scene-fields");
            break;
          }
        }
      }
      break;
    case "params":
      typeFact(ctx, node["type"]);
      break;
    default:
      break;
  }

  // Expressions carry a `type` and one of the expression kinds; places, steps, locals and statements
  // were handled above by their slot, and declarations of scenes and prefabs have no `type`.
  if (
    typeof node["type"] === "string" &&
    kind !== undefined &&
    !["stmts", "root", "steps", "locals", "state", "params"].includes(slot) &&
    EXPR_KINDS.has(kind)
  ) {
    exprFact(ctx, node);
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === "span" || key === "file") continue;
    visit(ctx, child, key);
  }
}

const EXPR_KINDS = new Set([
  "const",
  "local",
  "unary",
  "binary",
  "call",
  "builtin",
  "construct",
  "convert",
  "components",
  "field",
  "index",
  "array",
  "struct",
  "descriptor",
  "state",
  "entityField",
  "cameraField",
  "instanceParam",
  "lightField",
  "bodyCommand",
  "bodyProperty",
  "frame",
  "enumMember",
  "param",
  "material",
  "prefabLiteral",
  "entityRef",
]);

/** The facts of one program's typed IR. */
export function irFacts(ir: Json): FactSet {
  const facts: FactSet = new Set();
  const ctx: Context = { facts, module: "", item: "" };
  const modules = arr(ir, "modules");
  if (modules.length > 1) add(ctx, "imports", "exports", "module/multi-file");
  visit(ctx, modules, "modules");
  return facts;
}

/** The facts of one program's manifest (`program.manifest.json`). */
export function manifestFacts(manifest: Json): FactSet {
  const facts: FactSet = new Set();
  const ctx: Context = { facts, module: "", item: "" };
  const scene = obj(manifest, "scene");
  const inputs = arr(scene, "hostInputs");
  if (inputs.length > 0) {
    add(ctx, "project/host-inputs");
    for (const input of inputs) {
      const codec = str(input, "codec");
      if (codec !== undefined) add(ctx, `project/host-input-codec:${codec}`);
    }
  }
  if (obj(manifest, "subsystems")?.["physics"] === true) add(ctx, "project/physics-subsystem");
  for (const asset of arr(manifest, "assets")) {
    const kind = str(asset, "kind");
    if (kind !== undefined) add(ctx, `project/asset:${kind}`);
  }
  if (arr(scene, "lights").length > 0) add(ctx, "project/lights");
  const materials = arr(manifest, "materials").length;
  if (materials > 0) add(ctx, "project/user-material-shaders");
  return facts;
}
