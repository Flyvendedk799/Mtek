/** Read-only, frame-coalesced scene exports. This module has no dependency on debug or GPU readback. */
import type { MtekHostOutput, MtekManifest } from "../abi/manifest-types.js";

type Snapshot = number | boolean | string | readonly number[];
interface Subscription {
  readonly name: string;
  readonly listener: (value: unknown) => void;
  active: boolean;
  previous: Snapshot | undefined;
}

function snapshot(output: MtekHostOutput, value: unknown): Snapshot {
  switch (output.type) {
    case "vec2":
    case "vec3":
    case "vec4": {
      const v = value as { x: number; y: number; z?: number; w?: number };
      const components = [v.x, v.y];
      if (output.type !== "vec2") components.push(v.z!);
      if (output.type === "vec4") components.push(v.w!);
      return Object.freeze(components);
    }
    case "color": {
      const c = value as { r: number; g: number; b: number; a: number };
      return Object.freeze([c.r, c.g, c.b, c.a]);
    }
    default: return value as number | boolean | string;
  }
}

function equal(a: Snapshot | undefined, b: Snapshot): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return Object.is(a, b);
}

function reportListenerError(error: unknown): void {
  // Match onDiagnostic: host code cannot stop the simulation or other listeners.
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

export class HostOutputs {
  private byName = new Map<string, MtekHostOutput>();
  private readonly subscriptions = new Set<Subscription>();
  private disposed = false;
  private publishing = false;

  constructor(manifest: MtekManifest, private readonly reportError: (error: unknown) => void = reportListenerError) {
    this.replace(manifest);
  }

  /** Compatible names survive reload, with a fresh snapshot; removed or retyped names are detached. */
  replace(manifest: MtekManifest): void {
    const next = new Map((manifest.scene.hostOutputs ?? []).map((output) => [output.name, output]));
    for (const subscription of this.subscriptions) {
      const before = this.byName.get(subscription.name);
      const after = next.get(subscription.name);
      if (before === undefined || after === undefined || before.type !== after.type) {
        subscription.active = false;
        this.subscriptions.delete(subscription);
      } else subscription.previous = undefined;
    }
    this.byName = next;
  }

  subscribe(name: string, listener: (value: unknown) => void): () => void {
    if (this.disposed) throw new Error("onOutput: the application has failed or been disposed.");
    if (!this.byName.has(name)) throw new RangeError(`Unknown host output '${name}'.`);
    if (typeof listener !== "function") throw new TypeError("onOutput: listener must be a function.");
    const subscription: Subscription = { name, listener, active: true, previous: undefined };
    this.subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.subscriptions.delete(subscription);
    };
  }

  /** Capture all values and listeners before invoking any host callback. New subscriptions wait a frame. */
  publish(state: Readonly<Record<string, unknown>>): void {
    if (this.disposed || this.publishing || this.subscriptions.size === 0) return;
    this.publishing = true;
    try {
      const values = new Map<string, Snapshot>();
      const pending = [...this.subscriptions].map((subscription) => {
        let value = values.get(subscription.name);
        if (value === undefined) {
          const output = this.byName.get(subscription.name)!;
          value = snapshot(output, state[output.source.name]);
          values.set(subscription.name, value);
        }
        return { subscription, value };
      });
      for (const { subscription, value } of pending) {
        if (!subscription.active || equal(subscription.previous, value)) continue;
        subscription.previous = value;
        try { subscription.listener(value); }
        catch (error) { this.reportError(error); }
      }
    } finally { this.publishing = false; }
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.active = false;
    this.subscriptions.clear();
    this.byName.clear();
  }
}
