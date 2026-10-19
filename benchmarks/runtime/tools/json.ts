// JSON output for the raw results: indented like the rest of the repository's evidence, but with arrays of numbers on one
// line (a timing pass stores thousands of samples), and numbers rounded to the precision the timers have.

const NUMBER_ARRAY = /\[\s*(?:-?\d[\d.eE+-]*|null)(?:\s*,\s*(?:-?\d[\d.eE+-]*|null))*\s*\]/g;

export function stringifyCompact(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(NUMBER_ARRAY, (array) => array.replace(/\s+/g, ""))}\n`;
}

/** Rounds `value` to `digits` decimals (for storing timings: the timers resolve microseconds at best). */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Rounds every number inside arrays under keys that end in `Ms` (recursively) to microseconds. */
export function roundTimings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(roundTimings);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = key.endsWith("Ms") ? roundMs(child) : roundTimings(child);
    }
    return out;
  }
  return value;
}

function roundMs(value: unknown): unknown {
  if (typeof value === "number") return roundTo(value, 3);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? roundTo(v, 3) : v));
  return roundTimings(value);
}
