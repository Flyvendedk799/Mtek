/**
 * The order of collision events (`spec/physics.md` section 6, decision 0066).
 *
 * After each step the adapter reports `(a, b, started)` triples in whatever order the solver found them. The
 * runtime sorts them so that handler order does not depend on the solver: **enter events before exit events**,
 * and within each kind by `(min(slotA, slotB), max(slotA, slotB))`; the entity with the lower slot receives its
 * delivery first. The slot is the stable order of `spec/scenes.md` section 10.1 (named entities by declaration,
 * then spawned entities by the slot they were given).
 */

/** One pair the step reported, the lower slot first. */
export interface CollisionPair {
  readonly low: number;
  readonly high: number;
  /** `true` for `collision_enter`, `false` for `collision_exit`. */
  readonly started: boolean;
}

/** The pair of the two user ids (their slots) the adapter reported. */
export function collisionPair(a: number, b: number, started: boolean): CollisionPair {
  return a <= b ? { low: a, high: b, started } : { low: b, high: a, started };
}

/**
 * Sorts `pairs` in place into delivery order and returns them. Enter events come first; ties (the same
 * pair reported twice) keep the order the adapter reported them (`Array.prototype.sort` is stable).
 */
export function sortCollisions(pairs: CollisionPair[]): CollisionPair[] {
  return pairs.sort((x, y) => {
    if (x.started !== y.started) return x.started ? -1 : 1;
    return x.low - y.low || x.high - y.high;
  });
}
