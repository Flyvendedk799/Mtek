import type { MtekSkin } from "../abi/manifest-types.js";
import { multiplyQuat } from "./pose-layers.js";
import { skinProblem } from "./skeleton.js";

/**
 * Transfer local bind-relative motion between compatible named hierarchies.
 * Translation scale is explicit: no guessed humanoid axes, names or body sizes.
 * Every animated source node must be mapped; target mesh/influences remain its own.
 */
export function retargetSkin(
  source: MtekSkin,
  target: MtekSkin,
  mapping: Readonly<Record<string, string>>,
  translationScale = 1,
): MtekSkin {
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
  const q = new Float64Array(4),
    inverse = new Float64Array(4),
    correction = new Float64Array(4);
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
      if (channel.path === "rotation") {
        const al = Math.hypot(...a.rotation),
          bl = Math.hypot(...b.rotation);
        for (let k = 0; k < 4; k++) {
          inverse[k] = (a.rotation[k]! / al) * (k < 3 ? -1 : 1);
          q[k] = b.rotation[k]! / bl;
        }
        multiplyQuat(correction, 0, q, 0, inverse, 0);
      }
      for (let at = 0; at < values.length; at += width) {
        if (channel.path === "rotation") {
          multiplyQuat(q, 0, correction, 0, values, at);
          const length = Math.hypot(...q);
          for (let k = 0; k < 4; k++) values[at + k] = q[k]! / length;
        } else
          for (let k = 0; k < 3; k++)
            values[at + k] =
              channel.path === "scale"
                ? (b.scale[k]! * values[at + k]!) / a.scale[k]!
                : b.translation[k]! +
                  (values[at + k]! - a.translation[k]!) * translationScale;
      }
      return { ...channel, node, values };
    }),
  }));
  const result = { ...target, clips },
    problem = skinProblem(result, result.indices.length);
  if (problem !== undefined) throw new RangeError(problem);
  return result;
}
