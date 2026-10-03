// The CPU value representation of spec/runtime-abi.md section 4.1, as a TypeScript type with
// checked accessors (used by the independent encoder and by the value generator).

/**
 * `f32`/`i32`/`u32` are numbers, `bool` a boolean, vectors/colours/quaternions objects with
 * numeric components, `mat4` a 16-element `Float32Array`, structs plain objects and arrays
 * JS arrays.
 */
export type CpuValue =
  | number
  | boolean
  | Float32Array
  | readonly CpuValue[]
  | { readonly [name: string]: CpuValue };

export function expectNumber(value: CpuValue | undefined, where: string): number {
  if (typeof value !== "number") throw new Error(`${where}: expected a number`);
  return value;
}

export function expectBoolean(value: CpuValue | undefined, where: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${where}: expected a boolean`);
  return value;
}

/** The property `name` of an object-shaped value (vector, colour, struct). */
export function property(value: CpuValue | undefined, name: string, where: string): CpuValue {
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Float32Array
  ) {
    throw new Error(`${where}: expected an object holding \`${name}\``);
  }
  const found = (value as { readonly [key: string]: CpuValue | undefined })[name];
  if (found === undefined) throw new Error(`${where}: missing \`${name}\``);
  return found;
}

/** Element `index` of an array-shaped value (JS array or `Float32Array`). */
export function element(value: CpuValue | undefined, index: number, where: string): CpuValue {
  if (value instanceof Float32Array) {
    const entry = value[index];
    if (entry === undefined) throw new Error(`${where}: index ${index} out of range`);
    return entry;
  }
  if (!Array.isArray(value)) throw new Error(`${where}: expected an array`);
  const list = value as readonly CpuValue[];
  const entry = list[index];
  if (entry === undefined) throw new Error(`${where}: index ${index} out of range`);
  return entry;
}
