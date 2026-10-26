import type { MtekSkin } from "../abi/manifest-types.js";
import {
  fromRotationTranslationScaleInto,
  identity,
  multiplyInto,
  normalMatrixInto,
} from "../math/mat4.js";
import { blendQuat, multiplyQuat } from "./pose-layers.js";

export interface IKHingeLimit {
  /** Hinge axis in the node's bind-local frame. Other rotational degrees of freedom are locked. */
  readonly axis: readonly [number, number, number];
  /** Signed bind-relative radians in [-pi,pi]. */
  readonly min: number;
  readonly max: number;
}

export interface IKConstraint {
  /** Contiguous parent-to-child chain, including the end effector. */
  readonly chain: readonly string[];
  /** Target in mesh-local space, the same space as SkeletonPlayer.jointPosition. */
  readonly target: readonly [number, number, number];
  readonly weight?: number;
  readonly iterations?: number;
  readonly tolerance?: number;
  /** End-effector orientation in mesh-local space. Requires uniform positive ancestor scales. */
  readonly rotation?: readonly [number, number, number, number];
  readonly rotationWeight?: number;
  readonly limits?: Readonly<Record<string, IKHingeLimit>>;
}

/** Bounded CCD positional IK; evaluated in insertion order after procedural overrides. */
export class PoseIK {
  private readonly constraints = new Map<
    string,
    { indices: number[]; options: IKConstraint; limits: ReadonlyMap<number, IKHingeLimit> }
  >();
  private readonly globals: Float32Array[];
  private readonly local = identity();
  private readonly scratch = identity();
  private readonly inverse = identity();
  private readonly delta = new Float64Array(4);
  private readonly order: number[] = [];
  private readonly orientation = new Float64Array(4);
  private readonly parentRotation = new Float64Array(4);
  private readonly bindRotation = new Float64Array(4);
  private readonly relative = new Float64Array(4);
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
      (options.tolerance ?? 0.001) <= 0 ||
      !Number.isFinite(options.rotationWeight ?? 1) || (options.rotationWeight ?? 1) < 0 || (options.rotationWeight ?? 1) > 1
    )
      throw new RangeError(
        "Invalid IK target, weight, iterations or tolerance",
      );
    const limits = new Map<number, IKHingeLimit>();
    for (const [name, limit] of Object.entries(options.limits ?? {})) {
      const node = this.skin.nodes.findIndex(node => node.name === name);
      const length = Math.hypot(...limit.axis);
      if (!indices.includes(node) || limit.axis.length !== 3 || !limit.axis.every(Number.isFinite)
        || !Number.isFinite(length) || length < 1e-8 || !Number.isFinite(limit.min) || !Number.isFinite(limit.max)
        || limit.min < -Math.PI || limit.max > Math.PI || limit.min > limit.max)
        throw new RangeError(`Invalid IK hinge limit: ${name}`);
      limits.set(node, { axis: limit.axis.map(value => value / length) as [number, number, number], min: limit.min, max: limit.max });
    }
    let rotation: [number, number, number, number] | undefined;
    if (options.rotation !== undefined) {
      const length = Math.hypot(...options.rotation);
      if (options.rotation.length !== 4 || !options.rotation.every(Number.isFinite) || !Number.isFinite(length) || length < 1e-8)
        throw new RangeError("Invalid IK orientation quaternion");
      rotation = options.rotation.map(value => value / length) as [number, number, number, number];
      for (let node = this.skin.meshNode; node >= 0; node = this.skin.nodes[node]!.parent)
        if (node === indices.at(-1)) throw new RangeError("IK orientation mesh frame cannot descend from the end effector");
    }
    this.constraints.set(id, {
      indices,
      limits,
      options: {
        ...options,
        ...(rotation === undefined ? {} : { rotation }),
        target: [...options.target],
        chain: [...options.chain],
      },
    });
    this.revision++;
  }
  private constrain(pose: Float64Array, node: number, limit: IKHingeLimit): void {
    const at = node * 10 + 3, bind = this.skin.nodes[node]!.rotation, length = Math.hypot(...bind);
    for (let c = 0; c < 4; c++) this.bindRotation[c] = bind[c]! / length;
    for (let c = 0; c < 4; c++) this.relative[c] = this.bindRotation[c]! * (c < 3 ? -1 : 1);
    multiplyQuat(this.relative, 0, this.relative, 0, pose, at);
    const axis = limit.axis;
    const projection = this.relative[0]! * axis[0] + this.relative[1]! * axis[1] + this.relative[2]! * axis[2];
    let angle = Math.hypot(projection, this.relative[3]!) < 1e-10 ? 0 : 2 * Math.atan2(projection, this.relative[3]!);
    if (angle > Math.PI) angle -= 2 * Math.PI;
    if (angle < -Math.PI) angle += 2 * Math.PI;
    angle = Math.max(limit.min, Math.min(limit.max, angle));
    const sine = Math.sin(angle / 2);
    this.relative.set([axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle / 2)]);
    multiplyQuat(pose, at, this.bindRotation, 0, this.relative, 0);
  }
  private worldRotation(pose: Float64Array, node: number, out: Float64Array): void {
    out.set([0, 0, 0, 1]);
    for (let i = node; i >= 0; i = this.skin.nodes[i]!.parent) {
      const at = i * 10;
      if (Math.abs(pose[at + 7]! / pose[at + 8]! - 1) > 1e-6 || Math.abs(pose[at + 7]! / pose[at + 9]! - 1) > 1e-6)
        throw new RangeError("IK orientation requires uniform ancestor scales");
      multiplyQuat(out, 0, pose, at + 3, out, 0);
    }
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
    for (const { indices, options, limits } of this.constraints.values()) {
      const weight = options.weight ?? 1;
      if (weight === 0) continue;
      for (const [node, limit] of limits) this.constrain(pose,node,limit);
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
          const limit = limits.get(i);
          if (limit !== undefined) this.constrain(pose,i,limit);
          this.matrices(pose);
        }
      }
      if (options.rotation !== undefined) {
        const node = indices.at(-1)!;
        this.worldRotation(pose,this.skin.meshNode,this.orientation);
        multiplyQuat(this.orientation,0,this.orientation,0,options.rotation,0);
        this.worldRotation(pose,this.skin.nodes[node]!.parent,this.parentRotation);
        for (let c = 0; c < 3; c++) this.parentRotation[c] = -this.parentRotation[c]!;
        multiplyQuat(this.orientation,0,this.parentRotation,0,this.orientation,0);
        blendQuat(pose,node * 10 + 3,this.orientation,0,weight * (options.rotationWeight ?? 1));
        const limit = limits.get(node);
        if (limit !== undefined) this.constrain(pose,node,limit);
      }
    }
  }
}
