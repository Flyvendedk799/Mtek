// A test implementation of the generated-code context (spec/runtime-abi.md section 4.2,
// spec/testing.md section 4.1): it records every setter call so tests can assert what generated
// code does without a browser. Only the members M1 code uses exist; anything else is a
// TypeError, which fails the test.

/** One recorded setter call. `entity` is the static index of the record passed, or -1. */
export interface SetterCall {
  readonly method: "setCamera" | "setTransform" | "setVisible" | "setParam";
  readonly entity: number;
  readonly field: string;
  readonly value: unknown;
}

/** An entity record as the fake hands it to generated code. */
export interface FakeEntityRecord {
  readonly index: number;
}

export interface FakeContext {
  readonly e: readonly FakeEntityRecord[];
  setCamera(field: string, value: unknown): void;
  setTransform(entity: FakeEntityRecord, field: string, value: unknown): void;
  setVisible(entity: FakeEntityRecord, value: unknown): void;
  setParam(entity: FakeEntityRecord, name: string, value: unknown): void;
}

/** A context with `entityCount` entity records and the calls it records. */
export function createFakeContext(entityCount: number): {
  ctx: FakeContext;
  calls: SetterCall[];
} {
  const calls: SetterCall[] = [];
  const e: FakeEntityRecord[] = Array.from({ length: entityCount }, (_, index) =>
    Object.freeze({ index }),
  );
  const indexOf = (entity: FakeEntityRecord): number => {
    const index = e.indexOf(entity);
    if (index < 0) throw new Error("generated code passed something that is not an entity record");
    return index;
  };
  const ctx: FakeContext = Object.freeze({
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
  });
  return { ctx, calls };
}
