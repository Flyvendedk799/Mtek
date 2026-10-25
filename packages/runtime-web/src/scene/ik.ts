import type { MtekSkin } from "../abi/manifest-types.js";
import {
  fromRotationTranslationScaleInto,
  identity,
  multiplyInto,
  normalMatrixInto,
} from "../math/mat4.js";
import { multiplyQuat } from "./pose-layers.js";

export interface IKConstraint {
  /** Contiguous parent-to-child chain, including the end effector. */
  readonly chain: readonly string[];
  /** Target in mesh-local space, the same space as SkeletonPlayer.jointPosition. */
  readonly target: readonly [number, number, number];
  readonly weight?: number;
  readonly iterations?: number;
  readonly tolerance?: number;
}

/** Bounded CCD positional IK; evaluated in insertion order after procedural overrides. */
export class PoseIK {
  private readonly constraints = new Map<
    string,
    { indices: number[]; options: IKConstraint }
  >();
  private readonly globals: Float32Array[];
  private readonly local = identity();
  private readonly scratch = identity();
  private readonly inverse = identity();
  private readonly delta = new Float64Array(4);
  private readonly order: number[] = [];
  revision = 0;
  constructor(private readonly skin: MtekSkin) {
    this.globals = skin.nodes.map(() => identity());
    const seen = new Set<number>();
    const visit = (i: number): void => {
      if (seen.has(i)) return;
      const p = skin.nodes[i]!.parent;
      if (p >= 0) visit(p);
      seen.add(i);
      this.order.push(i);
    };
    skin.nodes.forEach((_, i) => visit(i));
  }
  set(id: string, options: IKConstraint): void {
    const indices = options.chain.map((name) =>
      this.skin.nodes.findIndex((n) => n.name === name),
    );
    if (
      id === "" ||
      indices.length < 2 ||
      indices.some(
        (i, k) =>
          i < 0 || (k > 0 && this.skin.nodes[i]!.parent !== indices[k - 1]),
      )
    )
      throw new RangeError(
        "IK needs a contiguous chain of at least two named nodes",
      );
    if (
      options.target.length !== 3 ||
      options.target.some((x) => !Number.isFinite(x)) ||
      !Number.isFinite(options.weight ?? 1) ||
      (options.weight ?? 1) < 0 ||
      (options.weight ?? 1) > 1 ||
      !Number.isInteger(options.iterations ?? 12) ||
      (options.iterations ?? 12) < 1 ||
      (options.iterations ?? 12) > 64 ||
      !Number.isFinite(options.tolerance ?? 0.001) ||
      (options.tolerance ?? 0.001) <= 0
    )
      throw new RangeError(
        "Invalid IK target, weight, iterations or tolerance",
      );
    this.constraints.set(id, {
      indices,
      options: {
        ...options,
        target: [...options.target],
        chain: [...options.chain],
      },
    });
    this.revision++;
  }
  remove(id: string): void {
    if (this.constraints.delete(id)) this.revision++;
  }
  clear(): void {
    if (this.constraints.size > 0) {
      this.constraints.clear();
      this.revision++;
    }
  }
  private matrices(pose: Float64Array): void {
    for (const i of this.order) {
      const at = i * 10,
        p = pose;
      fromRotationTranslationScaleInto(
        this.local,
        this.scratch,
        { x: p[at + 3]!, y: p[at + 4]!, z: p[at + 5]!, w: p[at + 6]! },
        { x: p[at]!, y: p[at + 1]!, z: p[at + 2]! },
        { x: p[at + 7]!, y: p[at + 8]!, z: p[at + 9]! },
      );
      const parent = this.skin.nodes[i]!.parent;
      if (parent < 0) this.globals[i]!.set(this.local);
      else multiplyInto(this.globals[i]!, this.globals[parent]!, this.local);
    }
  }
  apply(pose: Float64Array): void {
    for (const { indices, options } of this.constraints.values()) {
      const weight = options.weight ?? 1;
      if (weight === 0) continue;
      this.matrices(pose);
      const mesh = this.globals[this.skin.meshNode]!,
        t = options.target,
        end = this.globals[indices.at(-1)!]!;
      const tx =
        end[12]! +
        (mesh[0]! * t[0] +
          mesh[4]! * t[1] +
          mesh[8]! * t[2] +
          mesh[12]! -
          end[12]!) *
          weight;
      const ty =
        end[13]! +
        (mesh[1]! * t[0] +
          mesh[5]! * t[1] +
          mesh[9]! * t[2] +
          mesh[13]! -
          end[13]!) *
          weight;
      const tz =
        end[14]! +
        (mesh[2]! * t[0] +
          mesh[6]! * t[1] +
          mesh[10]! * t[2] +
          mesh[14]! -
          end[14]!) *
          weight;
      for (
        let iteration = 0;
        iteration < (options.iterations ?? 12);
        iteration++
      ) {
        if (
          Math.hypot(end[12]! - tx, end[13]! - ty, end[14]! - tz) <
          (options.tolerance ?? 0.001)
        )
          break;
        for (let k = indices.length - 2; k >= 0; k--) {
          const i = indices[k]!,
            joint = this.globals[i]!,
            parent = this.skin.nodes[i]!.parent;
          if (parent < 0) this.inverse.set(identity());
          else normalMatrixInto(this.inverse, 0, this.globals[parent]!);
          // Transpose the inverse-transpose matrix to take directions into parent space.
          const ax = end[12]! - joint[12]!,
            ay = end[13]! - joint[13]!,
            az = end[14]! - joint[14]!;
          const bx = tx - joint[12]!,
            by = ty - joint[13]!,
            bz = tz - joint[14]!;
          const m = this.inverse;
          let x = m[0]! * ax + m[1]! * ay + m[2]! * az,
            y = m[4]! * ax + m[5]! * ay + m[6]! * az,
            z = m[8]! * ax + m[9]! * ay + m[10]! * az;
          let u = m[0]! * bx + m[1]! * by + m[2]! * bz,
            v = m[4]! * bx + m[5]! * by + m[6]! * bz,
            s = m[8]! * bx + m[9]! * by + m[10]! * bz;
          const a = Math.hypot(x, y, z),
            b = Math.hypot(u, v, s);
          if (a < 1e-10 || b < 1e-10) continue;
          x /= a;
          y /= a;
          z /= a;
          u /= b;
          v /= b;
          s /= b;
          let qx = y * s - z * v,
            qy = z * u - x * s,
            qz = x * v - y * u,
            qw = 1 + Math.max(-1, Math.min(1, x * u + y * v + z * s));
          if (qw < 1e-8) {
            if (Math.abs(x) < 0.9) {
              qx = 0;
              qy = z;
              qz = -y;
            } else {
              qx = -z;
              qy = 0;
              qz = x;
            }
            qw = 0;
          }
          const length = Math.hypot(qx, qy, qz, qw);
          this.delta.set([qx / length, qy / length, qz / length, qw / length]);
          // Avoid folding an exactly straight chain onto its own root (a CCD singularity).
          if (this.delta[3]! < Math.SQRT1_2) {
            const axis = Math.hypot(
              this.delta[0]!,
              this.delta[1]!,
              this.delta[2]!,
            );
            for (let c = 0; c < 3; c++)
              this.delta[c] = (this.delta[c]! / axis) * Math.SQRT1_2;
            this.delta[3] = Math.SQRT1_2;
          }
          multiplyQuat(pose, i * 10 + 3, this.delta, 0, pose, i * 10 + 3);
          this.matrices(pose);
        }
      }
    }
  }
}
