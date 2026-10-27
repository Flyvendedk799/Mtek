import type { MtekSkin } from "../abi/manifest-types.js";
import { multiplyQuat } from "./pose-layers.js";
import { skinProblem } from "./skin-problem.js";
import { numericallyUniformScale } from "./uniform-scale.js";

export interface RetargetOptions {
  readonly translationScale?: number;
  /** "local" preserves the original API. "world" preserves bind-relative global rotation axes. */
  readonly rotationSpace?: "local" | "world";
  /** Optional absolute translation multipliers keyed by source node name. */
  readonly nodeTranslationScales?: Readonly<Record<string, number>>;
}

function bindRotations(skin: MtekSkin): Float64Array[] {
  const result: Float64Array[] = [];
  const visit = (node: number): Float64Array => {
    if (result[node] !== undefined) return result[node];
    const local = skin.nodes[node]!, length = Math.hypot(...local.rotation);
    const q = new Float64Array(local.rotation.map(value => value / length));
    if (local.parent >= 0) multiplyQuat(q,0,visit(local.parent),0,q,0);
    result[node] = q; return q;
  };
  skin.nodes.forEach((_, i) => visit(i));
  return result;
}

/**
 * Transfer local bind-relative motion between compatible named hierarchies.
 * Translation scale is explicit: no guessed humanoid axes, names or body sizes.
 * Every animated source node must be mapped; target mesh/influences remain its own.
 */
export function retargetSkin(
  source: MtekSkin,
  target: MtekSkin,
  mapping: Readonly<Record<string, string>>,
  options: number | RetargetOptions = 1,
): MtekSkin {
  const translationScale = typeof options === "number" ? options : options.translationScale ?? 1;
  const worldSpace = typeof options !== "number" && options.rotationSpace === "world";
  if (typeof options !== "number" && options.rotationSpace !== undefined && options.rotationSpace !== "local" && !worldSpace)
    throw new RangeError("Unknown retarget rotation space");
  if (!Number.isFinite(translationScale) || translationScale <= 0)
    throw new RangeError("Retarget translation scale must be positive");
  for (const skin of [source, target]) {
    const problem = skinProblem(skin, skin.indices.length);
    if (problem !== undefined) throw new RangeError(problem);
  }
  for (const skin of [source, target])
    if (new Set(skin.nodes.map((n) => n.name)).size !== skin.nodes.length)
      throw new RangeError("Retargeting needs unique node names");
  const indices = new Map<number, number>(),
    used = new Set<number>();
  for (const [from, to] of Object.entries(mapping)) {
    const a = source.nodes.findIndex((n) => n.name === from),
      b = target.nodes.findIndex((n) => n.name === to);
    if (a < 0 || b < 0 || used.has(b))
      throw new RangeError(`Invalid retarget mapping: ${from} -> ${to}`);
    indices.set(a, b);
    used.add(b);
  }
  for (const [a, b] of indices) {
    if (worldSpace) {
      let from = source.nodes[a]!.parent, to = target.nodes[b]!.parent;
      while (from >= 0 && !indices.has(from)) from = source.nodes[from]!.parent;
      while (to >= 0 && !used.has(to)) to = target.nodes[to]!.parent;
      if (from < 0 ? to >= 0 : indices.get(from) !== to)
        throw new RangeError("Retarget mapping must preserve mapped ancestor relationships");
      continue;
    }
    const parent = source.nodes[a]!.parent;
    if (
      parent >= 0 &&
      (!indices.has(parent) || indices.get(parent) !== target.nodes[b]!.parent)
    )
      throw new RangeError(
        "Retarget mapping must preserve mapped parent relationships",
      );
    if (parent < 0 && target.nodes[b]!.parent >= 0)
      throw new RangeError("Retarget roots must map to roots");
  }
  const nodeScales = typeof options === "number" ? {} : { ...options.nodeTranslationScales };
  for (const [name, scale] of Object.entries(nodeScales)) {
    const node = source.nodes.findIndex(node => node.name === name);
    if (!indices.has(node) || !Number.isFinite(scale) || scale <= 0)
      throw new RangeError(`Invalid retarget translation scale: ${name}`);
  }
  if (worldSpace) {
    for (const skin of [source,target])
      if (skin.nodes.some(node => !numericallyUniformScale(node.scale[0]!, node.scale[1]!, node.scale[2]!)))
        throw new RangeError("World-space retargeting requires uniform bind scales");
    for (const clip of source.clips) for (const channel of clip.channels)
      if (channel.path === "scale" && channel.values.some((_,i,values) => i % 3 === 0 && !numericallyUniformScale(values[i]!, values[i+1]!, values[i+2]!)))
        throw new RangeError("World-space retargeting requires uniform animated scales");
  }
  const sourceRotations = worldSpace ? bindRotations(source) : [], targetRotations = worldSpace ? bindRotations(target) : [];
  const q = new Float64Array(4),
    inverse = new Float64Array(4),
    correction = new Float64Array(4), frame = new Float64Array([0,0,0,1]), inverseFrame = new Float64Array(4), targetBind = new Float64Array(4);
  const clips = source.clips.map((clip) => ({
    ...clip,
    channels: clip.channels.map((channel) => {
      const node = indices.get(channel.node);
      if (node === undefined)
        throw new RangeError(
          `Unmapped animated node: ${source.nodes[channel.node]!.name}`,
        );
      const a = source.nodes[channel.node]!,
        b = target.nodes[node]!,
        values = [...channel.values],
        width = channel.path === "rotation" ? 4 : 3;
      frame.set([0,0,0,1]);
      if (worldSpace) {
        const parent = b.parent < 0 ? [0,0,0,1] : targetRotations[b.parent]!;
        for (let k=0;k<4;k++) inverseFrame[k] = parent[k]! * (k < 3 ? -1 : 1);
        multiplyQuat(frame,0,inverseFrame,0,a.parent < 0 ? [0,0,0,1] : sourceRotations[a.parent]!,0);
        for (let k=0;k<4;k++) inverseFrame[k] = frame[k]! * (k < 3 ? -1 : 1);
      }
      if (channel.path === "rotation") {
        const al = Math.hypot(...a.rotation),
          bl = Math.hypot(...b.rotation);
        for (let k = 0; k < 4; k++) {
          inverse[k] = (a.rotation[k]! / al) * (k < 3 ? -1 : 1);
          q[k] = b.rotation[k]! / bl;
        }
        multiplyQuat(correction, 0, q, 0, inverse, 0);
        targetBind.set(q);
      }
      for (let at = 0; at < values.length; at += width) {
        if (channel.path === "rotation") {
          if (worldSpace) {
            multiplyQuat(q,0,values,at,inverse,0);
            multiplyQuat(q,0,frame,0,q,0);
            multiplyQuat(q,0,q,0,inverseFrame,0);
            multiplyQuat(q,0,q,0,targetBind,0);
          } else multiplyQuat(q, 0, correction, 0, values, at);
          const length = Math.hypot(...q);
          for (let k = 0; k < 4; k++) values[at + k] = q[k]! / length;
        } else {
          if (worldSpace && channel.path === "translation") {
            const x=values[at]!-a.translation[0]!,y=values[at+1]!-a.translation[1]!,z=values[at+2]!-a.translation[2]!;
            const tx=2*(frame[1]!*z-frame[2]!*y),ty=2*(frame[2]!*x-frame[0]!*z),tz=2*(frame[0]!*y-frame[1]!*x);
            values[at]=a.translation[0]!+x+frame[3]!*tx+frame[1]!*tz-frame[2]!*ty;
            values[at+1]=a.translation[1]!+y+frame[3]!*ty+frame[2]!*tx-frame[0]!*tz;
            values[at+2]=a.translation[2]!+z+frame[3]!*tz+frame[0]!*ty-frame[1]!*tx;
          }
          for (let k = 0; k < 3; k++)
            values[at + k] =
              channel.path === "scale"
                ? (b.scale[k]! * values[at + k]!) / a.scale[k]!
                : b.translation[k]! +
                  (values[at + k]! - a.translation[k]!) * (Object.hasOwn(nodeScales,a.name) ? nodeScales[a.name]! : translationScale);
        }
      }
      return { ...channel, node, values };
    }),
  }));
  const result = { ...target, clips },
    problem = skinProblem(result, result.indices.length);
  if (problem !== undefined) throw new RangeError(problem);
  return result;
}
