// The shape of a finding of the consistency check (decision 0101).
//
// Every comparison names both sides: where each side was read and what it says. A check that fails
// without saying which two statements disagree is not a check anyone can act on.

export interface Side {
  /** Where the statement was read: a file (with the part of it) or the program that printed it. */
  where: string;
  /** What it says, as text. */
  value: string;
}

export interface Mismatch {
  /** The comparison, e.g. `abi/runtime-abi-constant`. */
  check: string;
  left: Side;
  right: Side;
  /** One sentence naming both sides. */
  message: string;
}

export function mismatch(check: string, left: Side, right: Side, detail = ""): Mismatch {
  const tail = detail === "" ? "" : ` (${detail})`;
  return {
    check,
    left,
    right,
    message: `${check}: ${left.where} says ${left.value}, but ${right.where} says ${right.value}${tail}`,
  };
}

/** Compare two single values. */
export function compareValue(check: string, left: Side, right: Side, detail = ""): Mismatch[] {
  return left.value === right.value ? [] : [mismatch(check, left, right, detail)];
}

/**
 * Compare two sets of names, in both directions: one finding per name that only one side has.
 * `what` says what the names are ("feature", "key code").
 */
export function compareSets(
  check: string,
  what: string,
  left: { where: string; items: Iterable<string> },
  right: { where: string; items: Iterable<string> },
): Mismatch[] {
  const a = new Set(left.items);
  const b = new Set(right.items);
  const found: Mismatch[] = [];
  for (const item of [...a].sort()) {
    if (!b.has(item)) {
      found.push(mismatch(check, { where: left.where, value: `${what} ${JSON.stringify(item)}` }, { where: right.where, value: `no such ${what}` }));
    }
  }
  for (const item of [...b].sort()) {
    if (!a.has(item)) {
      found.push(mismatch(check, { where: left.where, value: `no such ${what}` }, { where: right.where, value: `${what} ${JSON.stringify(item)}` }));
    }
  }
  return found;
}

/** Items that occur more than once. */
export function duplicates(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) dup.add(item);
    seen.add(item);
  }
  return [...dup].sort();
}
