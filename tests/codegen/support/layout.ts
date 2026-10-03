// The layout record as the tests see it (spec/gpu-layout.md section 5), with a validating
// parser and a few helpers for walking the tree. Nothing in here knows about the generated
// writers: it only describes the data both sides of the cross-check are measured against.

export type ScalarKind = "f32" | "i32" | "u32" | "bool32";

export interface ScalarNode {
  readonly kind: "scalar";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly scalar: ScalarKind;
}

export interface VectorNode {
  readonly kind: "vector";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly scalar: ScalarKind;
  readonly components: number;
}

export interface MatrixNode {
  readonly kind: "matrix";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly columns: number;
  readonly rows: number;
  readonly columnStride: number;
}

export interface StructNode {
  readonly kind: "struct";
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly members: readonly LayoutMember[];
}

export interface ArrayNode {
  readonly kind: "array";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly length: number;
  readonly stride: number;
  readonly padded: boolean;
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
  readonly size: number;
  readonly align: number;
  readonly root: StructNode;
}

/** A half-open byte range `[start, end)`. */
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------------------------
// Parsing

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`invalid layout record at ${path}: ${message}`);
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

function bool(object: Json, key: string, path: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") return fail(`${path}.${key}`, "expected a boolean");
  return value;
}

function scalarKind(object: Json, path: string): ScalarKind {
  const value = str(object, "scalar", path);
  if (value === "f32" || value === "i32" || value === "u32" || value === "bool32") return value;
  return fail(`${path}.scalar`, `unknown scalar \`${value}\``);
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
    offset: int(object, "offset", path),
    size: int(object, "size", path),
    align: int(object, "align", path),
    members: parseMembers(object["members"], `${path}.members`),
  };
}

function parseNode(value: unknown, path: string): LayoutNode {
  const object = asObject(value, path);
  const kind = str(object, "kind", path);
  const common = {
    offset: int(object, "offset", path),
    size: int(object, "size", path),
    align: int(object, "align", path),
  };
  switch (kind) {
    case "scalar":
      return { kind, ...common, scalar: scalarKind(object, path) };
    case "vector":
      return {
        kind,
        ...common,
        scalar: scalarKind(object, path),
        components: int(object, "components", path),
      };
    case "matrix":
      return {
        kind,
        ...common,
        columns: int(object, "columns", path),
        rows: int(object, "rows", path),
        columnStride: int(object, "columnStride", path),
      };
    case "struct":
      return parseStruct(object, path);
    case "array":
      return {
        kind,
        ...common,
        length: int(object, "length", path),
        stride: int(object, "stride", path),
        padded: bool(object, "padded", path),
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
    align: int(object, "align", "$"),
    root: parseStruct(asObject(object["root"], "$.root"), "$.root"),
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers

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

/**
 * The byte ranges covered by the leaves (scalars, vector components, matrix entries) below
 * `node`, with `origin` the absolute byte address its offsets are relative to. Everything
 * outside these ranges is padding.
 */
export function leafRanges(node: LayoutNode, origin = 0): ByteRange[] {
  const at = origin + node.offset;
  switch (node.kind) {
    case "scalar":
      return [{ start: at, end: at + 4 }];
    case "vector":
      return [{ start: at, end: at + 4 * node.components }];
    case "matrix": {
      const ranges: ByteRange[] = [];
      for (let column = 0; column < node.columns; column++) {
        const start = at + column * node.columnStride;
        ranges.push({ start, end: start + 4 * node.rows });
      }
      return ranges;
    }
    case "struct":
      return node.members.flatMap((member) => leafRanges(member.node, origin));
    case "array": {
      const ranges: ByteRange[] = [];
      for (let index = 0; index < node.length; index++) {
        ranges.push(...leafRanges(node.element, at + index * node.stride));
      }
      return ranges;
    }
  }
}

/** A boolean mask over `size` bytes that is true inside any of the ranges. */
export function coverage(size: number, ranges: readonly ByteRange[]): boolean[] {
  const mask = new Array<boolean>(size).fill(false);
  for (const range of ranges) {
    for (let byte = range.start; byte < range.end; byte++) {
      if (byte >= size) throw new Error(`leaf range ${range.start}..${range.end} exceeds ${size}`);
      if (mask[byte] === true) throw new Error(`byte ${byte} is covered by two leaves`);
      mask[byte] = true;
    }
  }
  return mask;
}
