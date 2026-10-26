/** Schema annotations are documentation, not validation logic. Ajv standalone
 * output can retain entire schema objects for enum lookups; omit annotations
 * without touching property names, constant values or validation keywords. */
const ANNOTATIONS = new Set(["$comment", "description", "title"]);
const MAPS = new Set(["$defs", "definitions", "properties", "patternProperties", "dependentSchemas"]);
const SINGLE = new Set(["additionalProperties", "unevaluatedProperties", "propertyNames", "items", "additionalItems", "unevaluatedItems", "contains", "not", "if", "then", "else", "contentSchema"]);
const ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function manifestValidationSchema(schema: unknown): unknown {
  if (!object(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !ANNOTATIONS.has(key)).map(([key, value]) => {
    if (MAPS.has(key) && object(value)) return [key, Object.fromEntries(Object.entries(value).map(([name, node]) => [name, manifestValidationSchema(node)]))];
    if (SINGLE.has(key)) return [key, manifestValidationSchema(value)];
    if (ARRAYS.has(key) && Array.isArray(value)) return [key, value.map(manifestValidationSchema)];
    // In particular, enum/const are data, and property names in MAPS are data.
    return [key, value];
  }));
}
