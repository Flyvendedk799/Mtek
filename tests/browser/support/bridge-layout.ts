// The layout record and the probe leaf list as the bridge tests read them (`spec/gpu-layout.md`
// section 5, and the `<name>.probe.json` the bridge_spike generator writes). Shared by the Node
// specs and the browser page, so it must stay free of Node and DOM APIs. The parser validates the
// shape it reads and nothing else; offsets are never used by the oracle (it only needs the leaf
// order), so an offset disagreement can only show up as a probe mismatch.

export type ScalarKind = "f32" | "i32" | "u32" | "bool32";

export interface ScalarNode {
  readonly kind: "scalar";
  readonly scalar: ScalarKind;
}

export interface VectorNode {
  readonly kind: "vector";
  readonly scalar: ScalarKind;
  readonly components: number;
}

export interface MatrixNode {
  readonly kind: "matrix";
  readonly columns: number;
  readonly rows: number;
}

export interface StructNode {
  readonly kind: "struct";
  readonly name: string;
  readonly members: readonly LayoutMember[];
}

export interface ArrayNode {
  readonly kind: "array";
  readonly length: number;
  readonly element: LayoutNode;
}

export type LayoutNode = ScalarNode | VectorNode | MatrixNode | StructNode | ArrayNode;

export interface LayoutMember {
  readonly name: string;
  readonly mtekType: string;
  readonly node: LayoutNode;
}

export interface LayoutRecord {
  readonly id: string;
  readonly wgslStruct: string;
  /** Block size in bytes. */
  readonly size: number;
  readonly root: StructNode;
}

/** One leaf the probe shader reads. */
export interface ProbeLeaf {
  readonly path: string;
  readonly kind: ScalarKind;
  readonly byteOffset: number;
}

/** The generator's description of a probe shader: its output words and target width. */
export interface ProbeManifest {
  readonly id: string;
  readonly leafWords: number;
  /** Target width in pixels: `ceil(leafWords / 4)`. */
  readonly width: number;
  readonly leaves: readonly ProbeLeaf[];
}

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`invalid bridge input at ${path}: ${message}`);
}

function asObject(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as Json;
}

function str(object: Json, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== "string") return fail(`${path}.${key}`, "expected a string");
  return value;
}

function int(object: Json, key: string, path: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(`${path}.${key}`, "expected a non-negative integer");
  }
  return value;
}

function scalarKind(value: unknown, path: string): ScalarKind {
  if (value === "f32" || value === "i32" || value === "u32" || value === "bool32") return value;
  return fail(path, `unknown scalar kind \`${String(value)}\``);
}

function parseMembers(value: unknown, path: string): LayoutMember[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  const list: unknown[] = value;
  return list.map((entry, index) => {
    const here = `${path}[${index}]`;
    const object = asObject(entry, here);
    return {
      name: str(object, "name", here),
      mtekType: str(object, "mtekType", here),
      node: parseNode(object["node"], `${here}.node`),
    };
  });
}

function parseStruct(object: Json, path: string): StructNode {
  return {
    kind: "struct",
    name: str(object, "name", path),
    members: parseMembers(object["members"], `${path}.members`),
  };
}

function parseNode(value: unknown, path: string): LayoutNode {
  const object = asObject(value, path);
  const kind = str(object, "kind", path);
  switch (kind) {
    case "scalar":
      return { kind, scalar: scalarKind(object["scalar"], `${path}.scalar`) };
    case "vector":
      return {
        kind,
        scalar: scalarKind(object["scalar"], `${path}.scalar`),
        components: int(object, "components", path),
      };
    case "matrix":
      return { kind, columns: int(object, "columns", path), rows: int(object, "rows", path) };
    case "struct":
      return parseStruct(object, path);
    case "array":
      return {
        kind,
        length: int(object, "length", path),
        element: parseNode(object["element"], `${path}.element`),
      };
    default:
      return fail(`${path}.kind`, `unknown node kind \`${kind}\``);
  }
}

/** Parses and validates the text of a `<name>.layout.json` file. */
export function parseLayoutRecord(text: string): LayoutRecord {
  const object = asObject(JSON.parse(text) as unknown, "$");
  return {
    id: str(object, "id", "$"),
    wgslStruct: str(object, "wgslStruct", "$"),
    size: int(object, "size", "$"),
    root: parseStruct(asObject(object["root"], "$.root"), "$.root"),
  };
}

/** Parses and validates the text of a `<name>.probe.json` file. */
export function parseProbeManifest(text: string): ProbeManifest {
  const object = asObject(JSON.parse(text) as unknown, "$");
  const id = str(object, "id", "$");
  const leafWords = int(object, "leafWords", "$");
  const width = int(object, "width", "$");
  const leaves = object["leaves"];
  if (!Array.isArray(leaves)) return fail("$.leaves", "expected an array");
  const list: unknown[] = leaves;
  return {
    id,
    leafWords,
    width,
    leaves: list.map((entry, index) => {
      const here = `$.leaves[${index}]`;
      const leaf = asObject(entry, here);
      return {
        path: str(leaf, "path", here),
        kind: scalarKind(leaf["kind"], `${here}.kind`),
        byteOffset: int(leaf, "byteOffset", here),
      };
    }),
  };
}

/**
 * The Mtek element type of an `array<T, N>` spelling (`array<array<f32, 2>, 3>` gives
 * `array<f32, 2>`); the empty string for anything that is not an array spelling.
 */
export function elementType(mtekType: string): string {
  if (!mtekType.startsWith("array<") || !mtekType.endsWith(">")) return "";
  const inner = mtekType.slice("array<".length, -1);
  const comma = inner.lastIndexOf(", ");
  return comma < 0 ? "" : inner.slice(0, comma);
}

/** The property names of a vector value of the given Mtek type (`color` is `r g b a`). */
export function componentNames(mtekType: string, components: number): string[] {
  const names = mtekType === "color" ? ["r", "g", "b", "a"] : ["x", "y", "z", "w"];
  return names.slice(0, components);
}
