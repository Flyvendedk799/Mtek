// Small helpers for reading the JSON the compiler prints (`mtek inspect --ir`, `mtek context`, the
// program manifest) without a schema: every accessor answers `undefined`/`[]` for a shape that is not
// there, so a derivation rule never throws on a program that does not use the construct.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

export function str(value: unknown, key: string): string | undefined {
  if (!isObject(value)) return undefined;
  const member = value[key];
  return typeof member === "string" ? member : undefined;
}

export function obj(value: unknown, key: string): JsonObject | undefined {
  if (!isObject(value)) return undefined;
  const member = value[key];
  return isObject(member) ? member : undefined;
}

export function arr(value: unknown, key: string): Json[] {
  return isObject(value) ? asArray(value[key]) : [];
}

export function parseJson(text: string, what: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch (error) {
    throw new Error(`${what} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
