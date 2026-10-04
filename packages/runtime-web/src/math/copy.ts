/**
 * Value copies for assignable places (`spec/language.md` 7.2, decision 0045).
 *
 * Generated code writes struct fields and array elements of a `var` in place. A variable written
 * that way owns its storage: whatever is stored into it is a value nothing else refers to, and an
 * array or struct read out of it is copied before it goes anywhere else, so the in-place writes
 * never reach another variable, a parameter, a constant or a caller.
 */

/**
 * A copy of the Mtek value `value` in the CPU representation of `spec/runtime-abi.md` 4.1 whose
 * arrays (JavaScript arrays) and structs (plain objects) are all new, at every depth. Scalars,
 * strings and `mat4` values (`Float32Array`, never written in place) are shared; vectors,
 * quaternions and colours are plain objects and so are copied too, which is harmless. Types nest at
 * most 256 levels (`E3032`), so the recursion is bounded.
 */
export function copy<T>(value: T): T {
  if (Array.isArray(value)) {
    const items = value as readonly unknown[];
    const out: unknown[] = new Array<unknown>(items.length);
    for (let i = 0; i < items.length; i++) out[i] = copy(items[i]);
    return out as T;
  }
  if (typeof value === "object" && value !== null && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) out[key] = copy(field);
    return out as T;
  }
  return value;
}
