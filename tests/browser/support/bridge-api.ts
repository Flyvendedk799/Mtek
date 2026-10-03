// The contract between the bridge page (`pages/bridge.ts`) and the bridge specs: the functions the
// page exposes as `window.__bridge`. Types only; the page is the only implementation.
import type { RegistryCounters } from "../../../packages/runtime-web/src/gpu/registry.ts";
import type { JsonValue } from "./bridge-values.ts";

/** The arena the probed instances live in. */
export interface ArenaInfo {
  /** Layout id of the arena's block. */
  readonly id: string;
  /** Distance between slots in bytes (the queried `minUniformBufferOffsetAlignment`, rounded). */
  readonly slotStride: number;
  readonly capacity: number;
  /** Number of allocated slots: every probed instance lives in this one arena. */
  readonly liveSlots: number;
}

/** What one probe run read back. */
export interface ProbeResult {
  /** The arena slot of each instance, in row order. */
  readonly slots: readonly number[];
  /** Target width in pixels, from the generator's leaf list. */
  readonly width: number;
  /** One row per instance: `width * 4` words, word `i` produced by `probe_word(i)`. */
  readonly rows: readonly (readonly number[])[];
  readonly arena: ArenaInfo;
  /** False when `updateAndRerun` wrote values identical to the slot's current bytes (nothing uploaded). */
  readonly changed: boolean;
}

/** The rendered colour target: tightly packed RGBA bytes, row by row. */
export interface ColorResult {
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
  /** RGBA of the pixel at `(width / 2, height / 2)`. */
  readonly centre: readonly [number, number, number, number];
}

export interface BridgeApi {
  /**
   * Allocates one slot per value in the fixture's arena, writes the values through the generated
   * writers, uploads, draws the probe once per slot into its own row and reads the rows back.
   * A fixture can have one session at a time; calling this again replaces it.
   */
  runProbe(fixture: string, valuesA: JsonValue, valuesB?: JsonValue): Promise<ProbeResult>;
  /** Rewrites one slot through the generated writer (only when the bytes differ), uploads and re-probes every row. */
  updateAndRerun(fixture: string, slot: number, values: JsonValue): Promise<ProbeResult>;
  /** Writes the `mixed` block, draws the colour shader into an `rgba8unorm-srgb` target and reads it back. */
  renderColor(values: JsonValue): Promise<ColorResult>;
  /** The registry's counters now (`spec/runtime-abi.md` section 10.1). */
  counters(): RegistryCounters;
  /** Uncaptured GPU errors and device loss seen so far; a healthy run has none. */
  errors(): string[];
  /** Destroys every GPU object of the page. */
  dispose(): void;
}

declare global {
  interface Window {
    __bridge?: BridgeApi;
  }
}
