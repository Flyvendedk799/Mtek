export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const optionalObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Bounded metadata inventory only. The compiler remains the compatibility authority. */
export function inventory(bytes: Buffer): object {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds the audit's 64 MiB limit");
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("Not a GLB 2 container");
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error("GLB declared length differs from the file length");
  const length = bytes.readUInt32LE(12);
  if (length > MAX_JSON_BYTES || length % 4 !== 0 || length > bytes.length - 20 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("Invalid, oversized or missing first JSON chunk");
  const root = object(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(20,20 + length))) as unknown);
  const meshes = rows(root["meshes"]), skins = rows(root["skins"]), animations = rows(root["animations"]), accessors = rows(root["accessors"]);
  let primitives = 0, morphPrimitives = 0, sparseAccessors = 0, externalReferences = 0;
  const attributes = new Set<string>(), interpolations = new Set<string>();
  for (const mesh of meshes) for (const raw of rows(optionalObject(mesh)["primitives"])) {
    const primitive = optionalObject(raw); primitives++; if (rows(primitive["targets"]).length > 0) morphPrimitives++;
    for (const key of Object.keys(optionalObject(primitive["attributes"]))) attributes.add(key);
  }
  for (const accessor of accessors) if (optionalObject(accessor)["sparse"] !== undefined) sparseAccessors++;
  for (const animation of animations) for (const sampler of rows(optionalObject(animation)["samplers"])) {
    const value = optionalObject(sampler)["interpolation"] ?? "LINEAR"; if (typeof value === "string") interpolations.add(value);
  }
  for (const raw of [...rows(root["buffers"]),...rows(root["images"])]) if (typeof optionalObject(raw)["uri"] === "string") externalReferences++;
  return {scope:"metadata inventory, not validation or rendering evidence",meshes:meshes.length,primitives,nodes:rows(root["nodes"]).length,skins:skins.length,joints:skins.reduce<number>((sum,skin)=>sum+rows(optionalObject(skin)["joints"]).length,0),animations:animations.length,materials:rows(root["materials"]).length,images:rows(root["images"]).length,morphPrimitives,sparseAccessors,externalReferences,attributes:[...attributes].sort(),interpolations:[...interpolations].sort(),extensionsUsed:rows(root["extensionsUsed"]).filter(value=>typeof value==="string"),extensionsRequired:rows(root["extensionsRequired"]).filter(value=>typeof value==="string")};
}
