/**
 * Compatible instancing (`spec/runtime-abi.md` section 8.4, decision 0059): which draws of the sorted,
 * culled draw list become one instanced draw, and which entities can ever be part of one.
 *
 * Draws are compatible when they have the same pipeline key, the same parameter block and the same mesh.
 * The draw list is sorted by `(pipeline key, parameter block, mesh)` (ties by instance order), so
 * compatible draws are adjacent; culling removes draws without reordering the rest, so they stay adjacent.
 * A run of two or more compatible draws is one instanced draw; a run of one is drawn individually.
 * Nothing else is ever grouped: not different meshes, not different pipelines, not different parameter
 * blocks (a block that differs in one byte is another block, `MaterialStore.blockOf`).
 */
import { meshKey } from "../mesh/cache.js";
import type { ResolvedMaterial, SceneStructure } from "../scene/structure.js";

/** The fields of a draw that decide compatibility. */
export interface InstanceKey {
  readonly pipelineKey: string;
  /** The parameter block (`MaterialStore.blockOf`). */
  readonly instance: number;
  /** Mesh upload order. */
  readonly mesh: number;
}

/** One draw call of a frame: `count` consecutive draws of the list starting at `start`. */
export interface Batch {
  /** Index of the first draw of the run in the (culled) draw list. */
  readonly start: number;
  /** Number of draws it replaces. 1: an individual draw; 2 or more: one instanced draw. */
  readonly count: number;
  /** Index of the first of its `count` records in the instance buffer; -1 for an individual draw. */
  readonly firstInstance: number;
}

/**
 * Splits the draws into draw calls. `canInstance` says whether a draw has an instanced pipeline (and the
 * instance buffer exists); a draw without one is always individual. Returns the number of instanced draws.
 * `out` is cleared first.
 */
export function batchDraws<D extends InstanceKey>(draws: readonly D[], canInstance: (draw: D) => boolean, out: Batch[]): number {
  out.length = 0;
  let instances = 0;
  let instanced = 0;
  let start = 0;
  while (start < draws.length) {
    const first = draws[start];
    if (first === undefined) break;
    let end = start + 1;
    if (canInstance(first)) {
      while (end < draws.length) {
        const next = draws[end];
        if (next === undefined || next.pipelineKey !== first.pipelineKey || next.instance !== first.instance || next.mesh !== first.mesh) break;
        end += 1;
      }
    }
    const count = end - start;
    if (count >= 2) {
      out.push({ start, count, firstInstance: instances });
      instances += count;
      instanced += 1;
    } else {
      out.push({ start, count: 1, firstInstance: -1 });
    }
    start = end;
  }
  return instanced;
}

/** What the structure of a scene allows to be instanced at all. */
export interface InstancingCandidates {
  /**
   * Ids of the materials that have at least one other entity with the same mesh and parameter block and pipeline
   * key, and of the materials of spawned prefabs (decision 0064).
   */
  readonly materials: ReadonlySet<string>;
  /** The most instance records one frame can need from the named entities: those of the groups of two or more. */
  readonly capacity: number;
}

/**
 * The entities that could ever be drawn as an instanced draw: those with a mesh and a material whose shader
 * has an instanced entry point, grouped by `(pipeline key, parameter block, mesh)`, groups of two or more.
 * Visibility, culling and failed materials only shrink a group, and a parameter block never becomes shared
 * after `MaterialStore.shareIdentical` ran, so this is an upper bound that holds for the life of the scene:
 * the pipelines and the instance buffer are created for it at startup and nothing is created later.
 */
export function instancingCandidates(
  structure: SceneStructure,
  blockOf: (instance: number) => number,
  pipelineKeyOf: (material: ResolvedMaterial) => string,
): InstancingCandidates {
  const groups = new Map<string, { readonly material: string; count: number }>();
  for (const entity of structure.entities) {
    if (entity.mesh === null || entity.instance === null) continue;
    const { material } = entity.instance;
    if (material.shader.instancedVertexEntry === undefined) continue;
    const key = JSON.stringify([pipelineKeyOf(material), blockOf(entity.instance.index), meshKey(entity.mesh.descriptor)]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { material: material.id, count: 1 });
    else group.count += 1;
  }
  const materials = new Set<string>();
  let capacity = 0;
  for (const group of groups.values()) {
    if (group.count < 2) continue;
    materials.add(group.material);
    capacity += group.count;
  }
  // Spawned entities (decision 0064): how many of a prefab exist is not known before they are spawned, so
  // its material always gets the instanced variant of its pipeline; the instance buffer grows when needed.
  for (const prefab of structure.prefabs) {
    const material = prefab.material?.material;
    if (prefab.mesh === null || material === undefined || material.shader.instancedVertexEntry === undefined) continue;
    materials.add(material.id);
  }
  return { materials, capacity };
}
