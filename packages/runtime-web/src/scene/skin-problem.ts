/**
 * The check every skeletal asset passes before anything uses it (decisions 0156, 0191): the mount validates the skins
 * of the manifest with it, and the animation module (decision 0225) validates what retargeting produces. It stays in the
 * core runtime because the mount runs it before the animation module is needed.
 */
import type { MtekSkin } from "../abi/manifest-types.js";

/** Shared file data, independently evaluated by every entity instance. */
export function skinProblem(skin: MtekSkin, vertices: number): string | undefined {
  const n = skin.nodes.length;
  if(n>256||skin.joints.length>128)return "skin exceeds the 256-node or 128-joint profile";
  const index=(i: number,max: number): boolean => Number.isInteger(i)&&i>=0&&i<max;
  const finite=(values: readonly number[],length: number): boolean => values.length===length&&values.every(Number.isFinite);
  if (!index(skin.meshNode,n) || skin.joints.length===0 || skin.joints.some(j => !index(j,n)) || skin.inverseBind.length !== skin.joints.length
    || skin.inverseBind.some(m=>!finite(m,16))) return "skin node or inverse-bind count is invalid";
  if (skin.indices.length !== vertices || skin.weights.length !== vertices) return "skin influences do not match the vertex count";
  for (let i = 0; i < n; i++) {
    const node = skin.nodes[i]!;
    if ((node.parent!==-1&&!index(node.parent,n)) || !finite(node.translation,3) || !finite(node.rotation,4) || !finite(node.scale,3) || node.scale.some(v => v <= 0) || Math.hypot(...node.rotation) < 1e-8) return "invalid skeletal bind transform";
    let parent = i;
    for (let depth = 0; parent >= 0; depth++) {
      if(!index(parent,n))return "invalid skeletal bind transform";
      if (depth >= n) return "cyclic skeletal hierarchy";
      parent = skin.nodes[parent]!.parent;
    }
  }
  for (let i = 0; i < vertices; i++) {
    const weights = skin.weights[i]!;
    if (skin.indices[i]!.length!==4 || skin.indices[i]!.some(j => !index(j,skin.joints.length)) || !finite(weights,4) || weights.some(w => w < 0) || Math.abs(weights.reduce((a,b) => a+b,0)-1) > 0.001) return "invalid vertex joint indices or weights";
  }
  const names = new Set<string>();
  for (const clip of skin.clips) {
    if (names.has(clip.name)) return "duplicate skeletal clip name";
    if(!Number.isFinite(clip.duration)||clip.duration<0) return "invalid skeletal clip duration";
    names.add(clip.name);
    const channels = new Set<string>();
    for (const c of clip.channels) {
      const key = String(c.node) + c.path;
      if (!index(c.node,n) || channels.has(key) || c.times.length===0 || c.values.length !== c.times.length * (c.path === "rotation" ? 4 : 3) || c.values.some(v=>!Number.isFinite(v))
        || c.times.some((t,i) => !Number.isFinite(t) || t < 0 || t > clip.duration || (i > 0 && t <= c.times[i-1]!))
        || (c.path === "scale" && c.values.some(v => v <= 0))) return "invalid skeletal clip channel";
      if (c.path === "rotation") {
        for (let k=0;k<c.values.length;k+=4) if (Math.hypot(...c.values.slice(k,k+4)) < 1e-8) return "invalid skeletal rotation";
      }
      channels.add(key);
    }
  }
  return undefined;
}

