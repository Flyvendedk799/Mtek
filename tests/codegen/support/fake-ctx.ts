// A test implementation of the generated-code context (spec/runtime-abi.md section 4.2,
// spec/testing.md section 4.1): it records every setter call and every run-time warning so tests
// can assert what generated code does without a browser. Only the members generated code uses so
// far exist; anything else is a TypeError, which fails the test.

/** One recorded setter call. `entity` is the static index of the record passed, or -1. */
export interface SetterCall {
  readonly method: "setCamera" | "setTransform" | "setVisible" | "setParam" | "setLight";
  readonly entity: number;
  readonly field: string;
  readonly value: unknown;
}

/** One recorded `ctx.warn(code, spanId)` (index clamping reports `W8030`, decision 0037). */
export interface WarningCall {
  readonly code: string;
  readonly spanId: number;
}

/** An entity record as the fake hands it to generated code. */
export interface FakeEntityRecord {
  readonly index: number;
  /** The entity's `state` (spec/runtime-abi.md section 4.2): generated code assigns into it. */
  readonly state: Record<string, unknown>;
  /** The entity's current position, as the runtime keeps it (read by `Entity.position.y = …`). */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** The params of a prefab instance (`self.params`); empty for a static entity. */
  readonly params: Readonly<Record<string, unknown>>;
}

/** One recorded call of a body handle (`ctx.body(target).applyImpulse(v)`; spec/runtime-abi.md section 4.2). */
export interface BodyCall {
  /** The static index of the entity record passed, or the `entity_ref` of the target. */
  readonly target: number | { readonly slot: number; readonly gen: number };
  readonly method: string;
  readonly args: readonly unknown[];
  /** The span id passed to `ctx.body(target, spanId)`: the command or property in the Mtek source (decision 0066). */
  readonly span: number;
}

interface FakeVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The body handle `ctx.body(target)` returns: the commands record, the velocities are read. */
export interface FakeBodyHandle {
  applyImpulse(v: FakeVector): void;
  applyForce(v: FakeVector): void;
  setKinematicTarget(position: FakeVector, rotation: unknown): void;
  teleport(position: FakeVector, rotation: unknown, keepVelocity: boolean): void;
  setLinearVelocity(v: FakeVector): void;
  readonly linearVelocity: FakeVector;
  readonly angularVelocity: FakeVector;
}

export interface FakeContext {
  /** The scene's `state`. */
  readonly s: Record<string, unknown>;
  readonly e: readonly FakeEntityRecord[];
  setCamera(field: string, value: unknown): void;
  setTransform(entity: FakeEntityRecord, field: string, value: unknown): void;
  setVisible(entity: FakeEntityRecord, value: unknown): void;
  setParam(entity: FakeEntityRecord, name: string, value: unknown): void;
  setLight(entity: FakeEntityRecord, field: string, value: unknown): void;
  body(target: FakeEntityRecord | { readonly slot: number; readonly gen: number }, spanId: number): FakeBodyHandle;
  warn(code: string, spanId: number): void;
  /** The loop budget of a preview build (`ctx.budget`, decision 0075): iterations left; checked only by preview code. */
  readonly budget: { n: number };
}

/**
 * A context with `entityCount` entity records and the calls and warnings it records. `params`
 * gives the records of prefab instances their `self.params` (by record index).
 */
export function createFakeContext(
  entityCount: number,
  params: readonly Readonly<Record<string, unknown>>[] = [],
  budget: number = Number.MAX_SAFE_INTEGER,
): {
  ctx: FakeContext;
  calls: SetterCall[];
  warnings: WarningCall[];
  /** Every body command issued, in order. */
  bodyCalls: BodyCall[];
  /** The velocities `ctx.body(entity)` reads, by entity index (zero when absent). */
  velocities: Map<number, { linear: FakeVector; angular: FakeVector }>;
} {
  const calls: SetterCall[] = [];
  const warnings: WarningCall[] = [];
  const bodyCalls: BodyCall[] = [];
  const velocities = new Map<number, { linear: FakeVector; angular: FakeVector }>();
  const zero: FakeVector = { x: 0, y: 0, z: 0 };
  const e: FakeEntityRecord[] = Array.from({ length: entityCount }, (_, index) =>
    Object.freeze({
      index,
      state: {},
      position: { x: 0, y: 0, z: 0 },
      params: Object.freeze({ ...params[index] }),
    }),
  );
  const indexOf = (entity: FakeEntityRecord): number => {
    const index = e.indexOf(entity);
    if (index < 0) throw new Error("generated code passed something that is not an entity record");
    return index;
  };
  const ctx: FakeContext = Object.freeze({
    s: {},
    e: Object.freeze(e),
    setCamera(field: string, value: unknown): void {
      calls.push({ method: "setCamera", entity: -1, field, value });
    },
    setTransform(entity: FakeEntityRecord, field: string, value: unknown): void {
      calls.push({ method: "setTransform", entity: indexOf(entity), field, value });
    },
    setVisible(entity: FakeEntityRecord, value: unknown): void {
      calls.push({ method: "setVisible", entity: indexOf(entity), field: "visible", value });
    },
    setParam(entity: FakeEntityRecord, name: string, value: unknown): void {
      calls.push({ method: "setParam", entity: indexOf(entity), field: name, value });
    },
    setLight(entity: FakeEntityRecord, field: string, value: unknown): void {
      calls.push({ method: "setLight", entity: indexOf(entity), field, value });
    },
    body(target: FakeEntityRecord | { readonly slot: number; readonly gen: number }, spanId: number): FakeBodyHandle {
      if (typeof spanId !== "number") throw new Error("ctx.body must be given the span id of the command");
      const key = "index" in target ? indexOf(target) : target;
      const record = (method: string) => (...args: unknown[]): void => {
        bodyCalls.push({ target: key, method, args, span: spanId });
      };
      const velocity = typeof key === "number" ? velocities.get(key) : undefined;
      return {
        applyImpulse: record("applyImpulse"),
        applyForce: record("applyForce"),
        setKinematicTarget: record("setKinematicTarget"),
        teleport: record("teleport"),
        setLinearVelocity: record("setLinearVelocity"),
        linearVelocity: velocity?.linear ?? zero,
        angularVelocity: velocity?.angular ?? zero,
      };
    },
    warn(code: string, spanId: number): void {
      warnings.push({ code, spanId });
    },
    budget: { n: budget },
  });
  return { ctx, calls, warnings, bodyCalls, velocities };
}
