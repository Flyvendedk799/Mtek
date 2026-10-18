/**
 * Running the generated lifecycle functions and handlers (`spec/scenes.md` sections 6, 7 and 10,
 * `spec/runtime-abi.md` sections 3 and 7).
 *
 * The order of everything here comes from arrays in stable instance order: the scene's function
 * first, then each entity's by static index, then those of the spawned entities in spawn order;
 * handlers for one event by owner (the scene, then entities by index, then the spawned entities) and,
 * within one owner, in the declaration order the program lists them. Nothing iterates the keys of an
 * object whose names a program chose.
 *
 * Spawned entities (decision 0064) are created and removed only at flush points, never while this code
 * runs, so the list it walks cannot change under it; one that was destroyed in this frame is pending
 * removal and is skipped (`spec/scenes.md` section 9), and one spawned in this frame is not in the list yet:
 * it first runs in the next phase that starts after its flush.
 */
import type { MtekEntityRecord, MtekEventHandler, MtekEventName, MtekProgramScene } from "../abi/program.js";
import type { InputTransition } from "../input/input.js";
import { INPUT_EVENTS } from "./dynamic.js";
import { RuntimeInternalError } from "./errors.js";
import type { World } from "./world.js";

/** `PointerEvent { position: vec2; button: i32 }` (`spec/scenes.md` section 7.1). */
function pointerEvent(x: number, y: number, button: number): unknown {
  return Object.freeze({ position: Object.freeze({ x, y }), button });
}

export class Behaviors {
  private readonly handlers = new Map<MtekEventName, readonly MtekEventHandler[]>();

  constructor(
    private readonly scene: MtekProgramScene,
    private readonly world: World,
  ) {
    for (const event of INPUT_EVENTS) {
      const declared = scene.events[event];
      // Array.prototype.sort is stable: handlers of one owner keep their declaration order.
      if (declared !== undefined && declared.length > 0) this.handlers.set(event, [...declared].sort((a, b) => a.owner - b.owner));
    }
  }

  /** The DOM codes that some `key_down` or `key_up` handler names, of the scene, its entities or a spawned prefab. */
  handledKeys(): ReadonlySet<string> {
    const codes = new Set<string>();
    for (const event of ["key_down", "key_up"] as const) {
      for (const handler of this.handlers.get(event) ?? []) if (handler.key !== undefined) codes.add(handler.key);
      for (const prefab of this.world.dynamic.prefabRuntimes()) {
        for (const handler of prefab.handlers.get(event) ?? []) if (handler.key !== undefined) codes.add(handler.key);
      }
    }
    return codes;
  }

  /** Phase 1: delivers `transitions` in the order given; for each, the scene's handlers, the entities', the spawned ones'. */
  dispatchInput(transitions: readonly InputTransition[]): void {
    for (const transition of transitions) {
      const list = this.handlers.get(transition.kind);
      const argument = "code" in transition ? undefined : pointerEvent(transition.x, transition.y, transition.button);
      if (list !== undefined) {
        for (const handler of list) {
          if ("code" in transition && handler.key !== transition.code) continue;
          handler.fn(this.world.ctx, this.owner(handler.owner), argument);
        }
      }
      for (const entity of this.world.dynamic.live) {
        if (entity.removing) continue;
        for (const handler of entity.prefab.handlers.get(transition.kind) ?? []) {
          if ("code" in transition && handler.key !== transition.code) continue;
          handler.fn(this.world.ctx, entity.record, argument);
        }
      }
    }
  }

  /** Phase 2 (c): `fixed_update`, the scene's then the entities', then the spawned entities'. */
  fixedUpdate(step: number): void {
    this.run(this.scene.fixedUpdate, this.scene.entityFixedUpdate, step, false);
  }

  /** Phase 3: `update(dt)`, the scene's then the entities', then the spawned entities'. */
  update(delta: number): void {
    this.run(this.scene.update, this.scene.entityUpdate, delta, true);
  }

  private run(sceneFunction: MtekProgramScene["update"], entityFunctions: MtekProgramScene["entityUpdate"], dt: number, update: boolean): void {
    const value = Math.fround(dt);
    if (sceneFunction !== null) sceneFunction(this.world.ctx, value);
    for (let index = 0; index < entityFunctions.length; index += 1) {
      const fn = entityFunctions[index];
      if (fn === null || fn === undefined) continue;
      fn(this.world.ctx, this.entity(index), value);
    }
    for (const entity of this.world.dynamic.live) {
      if (entity.removing) continue;
      const fn = update ? entity.prefab.program.update : entity.prefab.program.fixedUpdate;
      if (fn !== null) fn(this.world.ctx, entity.record, value);
    }
  }

  private owner(index: number): MtekEntityRecord | null {
    return index < 0 ? null : this.entity(index);
  }

  private entity(index: number): MtekEntityRecord {
    const record = this.world.entities[index];
    if (record === undefined) throw new RuntimeInternalError(`a handler names entity ${String(index)}, which the scene does not have.`);
    return record;
  }
}
