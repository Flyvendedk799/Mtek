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
      for (let corner = 0; corner < 8; corner++) {
        const x = this.boxes[at + (corner & 1 ? 3 : 0)]!;
        const y = this.boxes[at + (corner & 2 ? 4 : 1)]!;
        const z = this.boxes[at + (corner & 4 ? 5 : 2)]!;
        const px =
          palette[m]! * x +
          palette[m + 4]! * y +
          palette[m + 8]! * z +
          palette[m + 12]!;
        const py =
          palette[m + 1]! * x +
          palette[m + 5]! * y +
          palette[m + 9]! * z +
          palette[m + 13]!;
        const pz =
          palette[m + 2]! * x +
          palette[m + 6]! * y +
          palette[m + 10]! * z +
          palette[m + 14]!;
        lx = Math.min(lx, px);
        ly = Math.min(ly, py);
        lz = Math.min(lz, pz);
        hx = Math.max(hx, px);
        hy = Math.max(hy, py);
        hz = Math.max(hz, pz);
      }
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
