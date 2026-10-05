/**
 * Evaluating `bind(..)` (`spec/scenes.md` sections 8.4, 10 and 11, `spec/runtime-abi.md` sections 3 and
 * 5.2, decision 0051). Every binding is a generated `(ctx) => value` function; the manifest says what it
 * writes and in which order (`order`: topological, ties by declaration order). The v0.1 policy is
 * conservative: **every** binding is evaluated every frame (phase 5) and once after `init`; the value
 * is applied through the same validated setters generated code uses, so a value that did not change
 * costs no upload (the object, parameter and frame arenas upload only changed bytes).
 */
import type { MtekBinding, MtekManifest } from "../abi/manifest-types.js";
import { RuntimeInternalError, type World } from "./world.js";

/** The setters of `ctx` a binding is applied through. */
interface BindingContext {
  setTransform(entity: unknown, field: string, value: unknown): void;
  setVisible(entity: unknown, value: boolean): void;
  setParam(entity: unknown, name: string, value: unknown): void;
  setCamera(field: string, value: unknown): void;
}

type Apply = (value: unknown) => void;

export class Bindings {
  /** In evaluation order: the function that computes the value and the one that applies it. */
  private readonly steps: { readonly id: number; readonly compute: (ctx: object) => unknown; readonly apply: Apply }[];

  constructor(
    manifest: MtekManifest,
    functions: readonly ((ctx: object) => unknown)[],
    private readonly world: World,
  ) {
    const ctx = world.ctx as unknown as BindingContext;
    const byOrder = [...manifest.scene.bindings].sort((a, b) => a.order - b.order || a.id - b.id);
    this.steps = byOrder.map((binding) => {
      const compute = functions[binding.id];
      if (compute === undefined) throw new RuntimeInternalError(`binding ${String(binding.id)} has no function in the program module.`);
      return { id: binding.id, compute, apply: this.applier(binding, manifest, ctx) };
    });
  }

  /** The number of bindings. */
  get count(): number {
    return this.steps.length;
  }

  /** Evaluates every binding in order and applies its value. */
  evaluate(): void {
    for (const step of this.steps) step.apply(step.compute(this.world.ctx));
  }

  private applier(binding: MtekBinding, manifest: MtekManifest, ctx: BindingContext): Apply {
    const target = binding.target;
    const entity = (index: number): unknown => {
      const record = this.world.entities[index];
      if (record === undefined) throw new RuntimeInternalError(`binding ${String(binding.id)} targets entity ${String(index)}, which the scene does not have.`);
      return record;
    };
    switch (target.kind) {
      case "transform": {
        const record = entity(target.entity);
        return (value) => {
          ctx.setTransform(record, target.field, value);
        };
      }
      case "visible": {
        const record = entity(target.entity);
        return (value) => {
          ctx.setVisible(record, value as boolean);
        };
      }
      case "param": {
        const instance = manifest.scene.materialInstances[target.instance];
        if (instance === undefined) throw new RuntimeInternalError(`binding ${String(binding.id)} targets material instance ${String(target.instance)}, which the scene does not have.`);
        const record = entity(instance.entity);
        return (value) => {
          ctx.setParam(record, target.name, value);
        };
      }
      case "camera":
        return (value) => {
          ctx.setCamera(target.field, value);
        };
      case "light":
        throw new RuntimeInternalError("light bindings arrive with lights (M4).");
    }
  }
}
