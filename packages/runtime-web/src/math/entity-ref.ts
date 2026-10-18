/**
 * `entity_ref` equality (`spec/runtime-abi.md` section 4.1, `spec/scenes.md` section 8.3): a reference is
 * the pair `{ slot, gen }`, so two references are equal exactly when both numbers are. A reference to a
 * destroyed entity is therefore never equal to one to a later entity of the same slot.
 */

/** The shape of an `entity_ref` as `==` sees it. */
export interface RefLike {
  readonly slot: number;
  readonly gen: number;
}

/** `a == b` for two `entity_ref` values. */
export function refEq(a: RefLike, b: RefLike): boolean {
  return a.slot === b.slot && a.gen === b.gen;
}
