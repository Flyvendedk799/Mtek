/**
 * Host-input queue and apply (`spec/runtime-abi.md` sections 6.2–6.3 and 7): `setInput`
 * validates with the manifest codecs, queues, and phase 1 writes scene state.
 */
import type { MtekHostInput, MtekManifest } from "../abi/manifest-types.js";
import type { MtekInputResult } from "./types.js";
import { decodeHostInput } from "./codecs.js";

export interface SceneStateSink {
  /** Live scene state record (mutated only by {@link HostInputs.applyQueued}). */
  readonly state: Record<string, unknown>;
}

/** Never throws. Unknown keys are `MTEK-E8040`. */
export function unknownInputResult(name: string): Extract<MtekInputResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code: "MTEK-E8040",
      message: `Unknown host input '${name}'.`,
    },
  };
}

export class HostInputs {
  private readonly byName = new Map<string, MtekHostInput>();
  /** Last queued value per input name; applied (and cleared) in phase 1. */
  private readonly queue = new Map<string, unknown>();

  constructor(manifest: MtekManifest) {
    for (const input of manifest.scene.hostInputs) {
      this.byName.set(input.name, input);
    }
  }

  /** Declared host inputs, in manifest order. */
  get declared(): readonly MtekHostInput[] {
    return [...this.byName.values()];
  }

  /**
   * Validate and queue. Never throws and never mutates live state.
   * Invalid values leave the queue unchanged for that name.
   */
  setInput(name: string, value: unknown): MtekInputResult {
    const input = this.byName.get(name);
    if (input === undefined) return unknownInputResult(name);
    const decoded = decodeHostInput(input.codec, value);
    if (!decoded.ok) {
      return { ok: false, error: { code: decoded.code, message: decoded.message } };
    }
    this.queue.set(name, decoded.value);
    return { ok: true };
  }

  /** Apply every queued value to scene state; clear the queue. Called in phase 1. */
  applyQueued(sink: SceneStateSink): void {
    for (const [name, value] of this.queue) {
      const input = this.byName.get(name);
      if (input === undefined) continue;
      sink.state[input.target.name] = value;
    }
    this.queue.clear();
  }

  /** Whether a value is waiting to be applied (tests). */
  hasQueued(name: string): boolean {
    return this.queue.has(name);
  }
}
