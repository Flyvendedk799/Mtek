// Time, injected so that the unit tests (and the determinism check of the Recorder) control it.

export interface Clock {
  /** Milliseconds from an arbitrary origin; only differences are meaningful. */
  nowMs(): number;
  /** The current instant as an ISO 8601 UTC string. */
  iso(): string;
}

export const systemClock: Clock = {
  nowMs: () => performance.now(),
  iso: () => new Date().toISOString(),
};

/** A clock that advances by `stepMs` each time it is read; equal runs give equal timestamps. */
export function steppingClock(stepMs = 10, startIso = "2026-01-01T00:00:00.000Z"): Clock {
  let ms = 0;
  const origin = Date.parse(startIso);
  return {
    nowMs: () => {
      ms += stepMs;
      return ms;
    },
    iso: () => new Date(origin + ms).toISOString(),
  };
}
