/**
 * Packing the scene's lights into `MtekFrame.lights` (`spec/gpu-layout.md` section 6.1,
 * `spec/materials.md` section 7, decision 0053). The result is the CPU value the generated `lights` field
 * writer of `builtin:frame` accepts: an array of `MtekLight` objects, exactly as long as the layout's array.
 * Slots beyond the scene's lights stay all zero. The runtime never computes an offset: the writer does.
 *
 * Per light, every frame:
 *  - `color` = the light's linear RGB colour multiplied by its intensity (alpha is ignored),
 *  - `kind` = 0 for a directional light, 1 for a point light,
 *  - `position` = the translation of the entity's world matrix,
 *  - `range` = the construction-time range (0 = unlimited; 0 for a directional light),
 *  - `direction` = the unit vector of the entity's world -Z axis, i.e. where a directional light travels.
 *
 * `position`, `range` and `direction` are written for both kinds; the shaders read `direction` of a
 * directional light and `position` and `range` of a point light only.
 */
import type { Mat4 } from "../math/mat4.js";
import type { ResolvedLight } from "../scene/structure.js";
import type { LightRecord } from "../scene/world.js";

/** `MtekLight.kind`. */
export const LIGHT_KIND = { directional: 0, point: 1 } as const;

interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** One `MtekLight` as the generated writer reads it. */
export interface PackedLight {
  readonly color: MutableVec3;
  kind: number;
  readonly position: MutableVec3;
  range: number;
  readonly direction: MutableVec3;
  reserved: number;
}

/** Where the lights' inputs come from: the world (`scene/world.ts`) in the renderer, plain data in tests. */
export interface LightSource {
  /** The light component of static entity `entity`. */
  light(entity: number): LightRecord;
  /** The world matrix (column-major) of static entity `entity` after transform propagation. */
  worldMatrix(entity: number): Mat4;
}

/** `capacity` zeroed lights: the value of `MtekFrame.lights` before any light is packed. */
export function emptyPackedLights(capacity: number): PackedLight[] {
  return Array.from({ length: capacity }, () => ({
    color: { x: 0, y: 0, z: 0 },
    kind: 0,
    position: { x: 0, y: 0, z: 0 },
    range: 0,
    direction: { x: 0, y: 0, z: 0 },
    reserved: 0,
  }));
}

/**
 * Fills the first `lights.length` slots of `out` from `source` and returns the number of lights
 * (`MtekFrame.light_count`). `out` comes from {@link emptyPackedLights} and is reused every frame.
 */
export function packLights(lights: readonly ResolvedLight[], source: LightSource, out: readonly PackedLight[]): number {
  lights.forEach((declared, slot) => {
    const packed = out[slot];
    if (packed === undefined) throw new RangeError(`light ${String(slot)} does not fit the ${String(out.length)} slots of the frame block`);
    const record = source.light(declared.entity);
    const world = source.worldMatrix(declared.entity);
    packed.color.x = record.color.r * record.intensity;
    packed.color.y = record.color.g * record.intensity;
    packed.color.z = record.color.b * record.intensity;
    packed.kind = declared.kind === "point" ? LIGHT_KIND.point : LIGHT_KIND.directional;
    packed.position.x = world[12] ?? 0;
    packed.position.y = world[13] ?? 0;
    packed.position.z = world[14] ?? 0;
    packed.range = declared.range;
    // The entity's local -Z axis in world space: minus the third column, normalised (scale does not
    // change where the entity points).
    const zx = world[8] ?? 0;
    const zy = world[9] ?? 0;
    const zz = world[10] ?? 0;
    const length = Math.hypot(zx, zy, zz);
    if (length > 0) {
      packed.direction.x = -zx / length;
      packed.direction.y = -zy / length;
      packed.direction.z = -zz / length;
    } else {
      packed.direction.x = 0;
      packed.direction.y = 0;
      packed.direction.z = -1;
    }
  });
  return lights.length;
}
