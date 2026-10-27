import type { MtekSkin } from "../abi/manifest-types.js";

/** Upper bound on the largest singular value, including inherited nonuniform scale/shear. */
export function skinWorldScale(matrix: ArrayLike<number>): number {
  let maximum = 0;
  for (let row = 0; row < 3; row++) {
    let sum = 0;
    for (let col = 0; col < 3; col++) {
      let dot = 0;
      for (let k = 0; k < 3; k++)
        dot += matrix[row * 4 + k]! * matrix[col * 4 + k]!;
      sum += Math.abs(dot);
    }
    maximum = Math.max(maximum, sum);
  }
  return Math.sqrt(maximum);
}

/** A bind-space box per joint, shared by all instances of a mesh. */
export class SkinBounds {
  private readonly boxes: Float64Array;
  constructor(skin: MtekSkin, positions: Float32Array) {
    this.boxes = new Float64Array(skin.joints.length * 6);
    for (let j = 0; j < skin.joints.length; j++)
      this.boxes.set(
        [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
        j * 6,
      );
    for (let v = 0; v < skin.indices.length; v++) {
      for (let k = 0; k < 4; k++) {
        if (skin.weights[v]![k]! <= 0) continue;
        const at = skin.indices[v]![k]! * 6;
        for (let c = 0; c < 3; c++) {
          const p = positions[v * 3 + c]!;
          this.boxes[at + c] = Math.min(this.boxes[at + c]!, p);
          this.boxes[at + 3 + c] = Math.max(this.boxes[at + 3 + c]!, p);
        }
      }
    }
    for (let joint = 0; joint < skin.joints.length; joint++) {
      if (!Number.isFinite(this.boxes[joint * 6])) continue;
      for (let axis = 0; axis < 3; axis++) {
        const lo = this.boxes[joint * 6 + axis]!, hi = this.boxes[joint * 6 + axis + 3]!;
        this.boxes[joint * 6 + axis] = (lo + hi) / 2;
        this.boxes[joint * 6 + axis + 3] = (hi - lo) / 2;
      }
    }
  }

  /**
   * Encloses every joint-transformed box. Nonnegative normalized skin weights make
   * each deformed vertex a convex combination of points inside this union's AABB.
   * Uses O(joints) work, including arbitrary scale/shear; no vertex deformation.
   */
  sphere(palette: Float32Array, center: [number, number, number]): number {
    let lx = Infinity,
      ly = Infinity,
      lz = Infinity,
      hx = -Infinity,
      hy = -Infinity,
      hz = -Infinity;
    for (let j = 0; j < this.boxes.length / 6; j++) {
      const at = j * 6;
      if (!Number.isFinite(this.boxes[at])) continue;
      const m = j * 16;
      const x = this.boxes[at]!, y = this.boxes[at+1]!, z = this.boxes[at+2]!;
      const ex = this.boxes[at+3]!, ey = this.boxes[at+4]!, ez = this.boxes[at+5]!;
      // An affine box has center M*c+t and exact AABB half extents |M|*e.
      // This encloses all eight corners, including reflections and shear.
      const px = palette[m]!*x + palette[m+4]!*y + palette[m+8]!*z + palette[m+12]!;
      const py = palette[m+1]!*x + palette[m+5]!*y + palette[m+9]!*z + palette[m+13]!;
      const pz = palette[m+2]!*x + palette[m+6]!*y + palette[m+10]!*z + palette[m+14]!;
      const dx = Math.abs(palette[m]!)*ex + Math.abs(palette[m+4]!)*ey + Math.abs(palette[m+8]!)*ez;
      const dy = Math.abs(palette[m+1]!)*ex + Math.abs(palette[m+5]!)*ey + Math.abs(palette[m+9]!)*ez;
      const dz = Math.abs(palette[m+2]!)*ex + Math.abs(palette[m+6]!)*ey + Math.abs(palette[m+10]!)*ez;
      lx = Math.min(lx, px-dx); ly = Math.min(ly, py-dy); lz = Math.min(lz, pz-dz);
      hx = Math.max(hx, px+dx); hy = Math.max(hy, py+dy); hz = Math.max(hz, pz+dz);
    }
    if (!Number.isFinite(lx)) {
      center.fill(0);
      return 0;
    }
    center[0] = (lx + hx) / 2;
    center[1] = (ly + hy) / 2;
    center[2] = (lz + hz) / 2;
    // Allow for f32 arithmetic on the GPU and the profile's weight-sum tolerance.
    return (
      Math.hypot(hx - lx, hy - ly, hz - lz) / 2 +
      Math.max(
        1,
        Math.abs(lx),
        Math.abs(hx),
        Math.abs(ly),
        Math.abs(hy),
        Math.abs(lz),
        Math.abs(hz),
      ) *
        0.002
    );
  }
}
