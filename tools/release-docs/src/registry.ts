// The standard-library registry as data (`spec/stdlib-schema.json`, `spec/stdlib.md` section 1.2) and
// the features it implies.
//
// The compiler derives `supported.features` from this same data (crates/mtek-compiler/src/context/
// capabilities.rs). This module derives them again, independently, from the JSON file alone, so that the
// comparison with what the built compiler says (decision 0101, check `features/registry-rows`) can
// catch a registry file that is not the one the binary was built from, and a derivation rule that
// changed on one side only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Documented {
  name: string;
  since: string;
  doc: string;
}

export interface FieldDef extends Documented {
  type: string;
  default: string | null;
  required: boolean;
  writable: boolean;
  bindable: boolean;
  constructionOnly: boolean;
  range: string | null;
}

export interface SchemaDef extends Documented {
  category: string;
  fields: FieldDef[];
}

export interface MethodDef extends Documented {
  signatures?: string[];
}

export interface TypeDef extends Documented {
  kind: string;
  gpu: boolean;
  fields: { name: string; type: string }[];
  methods: MethodDef[];
}

export interface EventDef extends Documented {
  form: string;
  argumentType: string | null;
  allowedIn: string[];
  requiresCollider: boolean;
}

export interface EnumDef extends Documented {
  members: { name: string; code: string; since: string }[];
}

export interface IntrinsicDef extends Documented {
  signatures: string[];
  domain: string;
  constEligible: boolean;
  handlersOnly: boolean;
  cpuSemantics: string;
}

/** A function (with signatures) or a value (with a type) of a namespace. */
export interface NamespaceMember extends Documented {
  kind: string;
  signatures?: string[];
  type?: string;
  domain: string;
  constEligible?: boolean;
  handlersOnly?: boolean;
  cpuSemantics?: string;
}

export interface NamespaceDef extends Documented {
  members: NamespaceMember[];
}

export interface SceneObjectDef {
  keyword: string;
  schema: string;
  since: string;
  doc: string;
}

export interface BodyCommandDef extends Documented {
  params: { name: string; type: string }[];
  appliesTo: string[];
}

export interface BodyPropertyDef extends Documented {
  type: string;
  appliesTo: string[];
}

export interface StdlibSchema {
  registryVersion: number;
  languageVersion: string;
  schemas: SchemaDef[];
  events: EventDef[];
  enums: EnumDef[];
  intrinsics: IntrinsicDef[];
  namespaces: NamespaceDef[];
  types: TypeDef[];
  sceneObjects: SceneObjectDef[];
  bodyCommands: BodyCommandDef[];
  bodyProperties: BodyPropertyDef[];
  typeClasses: { name: string; members: string[] }[];
}

export const REGISTRY_FILE = "spec/stdlib-schema.json";

export function readRegistry(root: string): StdlibSchema {
  return JSON.parse(readFileSync(join(root, REGISTRY_FILE), "utf8")) as StdlibSchema;
}

/**
 * The milestone the compiler build has reached, read from the one place it is defined
 * (`CURRENT_MILESTONE` in crates/mtek-compiler/src/stdlib/). Null when the constant cannot be found.
 */
export function readCurrentMilestone(root: string): string | null {
  const dir = join(root, "crates", "mtek-compiler", "src", "stdlib");
  for (const file of ["mod.rs", "registry.rs", "model.rs"]) {
    let text: string;
    try {
      text = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    const match = /pub const CURRENT_MILESTONE:\s*Milestone\s*=\s*Milestone::(M\d+)/.exec(text);
    if (match !== null) return match[1] ?? null;
  }
  return null;
}

function reached(since: string, current: string): boolean {
  return Number(since.replace(/^M/, "")) <= Number(current.replace(/^M/, ""));
}

/**
 * The features of the registry rows the build has reached, named as `supported.features` names them
 * (`type:vec3`, `method:vec3.length`, `schema:Box`, `event:key_down`, `function:abs`, ...), sorted.
 * Schema fields and enum members are rows of the registry but are not listed as features.
 */
export function registryFeatures(registry: StdlibSchema, currentMilestone: string): string[] {
  const features: string[] = [];
  const add = (name: string, since: string, parentSince?: string): void => {
    if (parentSince !== undefined && !reached(parentSince, currentMilestone)) return;
    if (reached(since, currentMilestone)) features.push(name);
  };
  for (const def of registry.types) {
    for (const method of def.methods) add(`method:${def.name}.${method.name}`, method.since, def.since);
    add(`type:${def.name}`, def.since);
  }
  for (const schema of registry.schemas) add(`schema:${schema.name}`, schema.since);
  for (const kind of registry.sceneObjects) add(`scene-object:${kind.keyword}`, kind.since);
  for (const event of registry.events) add(`event:${event.name}`, event.since);
  for (const def of registry.enums) add(`enum:${def.name}`, def.since);
  for (const namespace of registry.namespaces) {
    for (const member of namespace.members) {
      const kind = member.kind === "function" ? "function" : "value";
      add(`${kind}:${namespace.name}.${member.name}`, member.since, namespace.since);
    }
    add(`namespace:${namespace.name}`, namespace.since);
  }
  for (const intrinsic of registry.intrinsics) add(`function:${intrinsic.name}`, intrinsic.since);
  for (const command of registry.bodyCommands) add(`body-command:${command.name}`, command.since);
  for (const property of registry.bodyProperties) add(`body-property:${property.name}`, property.since);
  return features.sort();
}

/** The rows the build has not reached: planned, hence not supported. */
export function plannedRows(registry: StdlibSchema, currentMilestone: string): string[] {
  const all = registryFeatures(registry, "M999");
  const have = new Set(registryFeatures(registry, currentMilestone));
  return all.filter((name) => !have.has(name));
}
