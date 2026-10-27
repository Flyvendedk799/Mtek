// Decision 0218: scripted input and frame-time patterns for the character movement acceptance.
//
// A script is a list of steps measured in fixed ticks (`hold` keys for n ticks, `tap` a key, `wait`). `plan` turns it
// into the list of frames the page steps through, for one frame-time pattern. The ticks the runtime runs depend on the
// time that has passed, never on how it was cut into frames (spec/runtime-abi.md section 7, the accumulator), so:
//
//  - pattern "tick": one frame of exactly `STEP` per tick, so a boundary after K ticks is the time K * STEP;
//  - every other pattern: frames of the nominal length (or of a pseudo-random length for "jitter"), the last one of a
//    segment shortened so that the input change lands at (K + 0.5) * STEP. Half a tick from either neighbour, the
//    number of ticks that ran before the change is K in every pattern, whatever rounding the sums have.
//
// The input change of a segment is applied before the first frame after it (the runtime delivers it at the start of
// that frame), exactly as `debug.pressKey` does.
import { STEP } from "./movement-example.ts";

export type PatternName = "tick" | "30" | "60" | "144" | "jitter";

export type Step =
  | { kind: "hold"; keys: readonly string[]; ticks: number }
  | { kind: "tap"; key: string }
  | { kind: "wait"; ticks: number };

/** A frame: the key changes made just before it and how long it lasts. `boundary` marks the last frame of a step. */
export interface Frame {
  dt: number;
  press: readonly string[];
  release: readonly string[];
  boundary: boolean;
}

export const hold = (keys: readonly string[], ticks: number): Step => ({ kind: "hold", keys, ticks });
export const tap = (key: string): Step => ({ kind: "tap", key });
export const wait = (ticks: number): Step => ({ kind: "wait", ticks });

/** mulberry32: a small seeded generator; the jitter pattern is the same on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The nominal frame length of a pattern, or null for "tick" (one frame per tick) and "jitter". */
export function nominalFrame(pattern: PatternName): number | null {
  switch (pattern) {
    case "30":
      return 1 / 30;
    case "60":
      return 1 / 60;
    case "144":
      return 1 / 144;
    default:
      return null;
  }
}

/** The longest frame of the jitter pattern: 3 ticks, inside `maxCatchUpSteps` (4) and `maxFrameDelta` (0.1 s). */
export const JITTER_MAX = 3 * STEP;
export const JITTER_MIN = 1 / 240;

/**
 * The frames for `steps` under `pattern`. Key changes are attached to the first frame of the step that makes them; the
 * keys held by one `hold` are released by the next step (a `tap` presses and releases at once, which the runtime
 * delivers as two transitions in one frame).
 */
export function plan(steps: readonly Step[], pattern: PatternName, jitterSeed = 1): Frame[] {
  const frames: Frame[] = [];
  const random = mulberry32(jitterSeed);
  let held: readonly string[] = [];
  let ticksDone = 0;
  let timeDone = 0;
  let pendingPress: readonly string[] = [];
  let pendingRelease: readonly string[] = [];

  const advance = (ticks: number): void => {
    // A segment ends at tick `ticksDone + ticks`; in the tick pattern that is the time K * STEP, otherwise (K + 0.5) * STEP.
    const target = ticksDone + ticks;
    if (ticks === 0) return;
    if (pattern === "tick") {
      for (let i = 0; i < ticks; i += 1) {
        frames.push({ dt: STEP, press: pendingPress, release: pendingRelease, boundary: i === ticks - 1 });
        pendingPress = [];
        pendingRelease = [];
      }
      ticksDone = target;
      timeDone = target * STEP;
      return;
    }
    const end = (target + 0.5) * STEP;
    const nominal = nominalFrame(pattern);
    while (timeDone < end) {
      const left = end - timeDone;
      let dt = nominal ?? JITTER_MIN + random() * (JITTER_MAX - JITTER_MIN);
      if (dt >= left) dt = left;
      timeDone += dt;
      frames.push({ dt, press: pendingPress, release: pendingRelease, boundary: timeDone >= end });
      pendingPress = [];
      pendingRelease = [];
    }
    timeDone = end;
    ticksDone = target;
  };

  for (const step of steps) {
    if (step.kind === "hold") {
      pendingRelease = held.filter((key) => !step.keys.includes(key));
      pendingPress = step.keys.filter((key) => !held.includes(key));
      held = step.keys;
      advance(step.ticks);
    } else if (step.kind === "tap") {
      pendingRelease = held;
      held = [];
      // A press and a release of the same key in one frame: the page does both before stepping.
      pendingPress = [step.key];
      pendingRelease = [...pendingRelease, step.key];
      advance(1);
    } else {
      pendingRelease = held;
      held = [];
      advance(step.ticks);
    }
  }
  return frames;
}

/** The ticks a plan runs in total. */
export function planTicks(steps: readonly Step[]): number {
  return steps.reduce((sum, step) => sum + (step.kind === "tap" ? 1 : step.ticks), 0);
}

// ---- what the page does with a plan ---------------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat extends Vec3 {
  w: number;
}
export interface Pose {
  position: Vec3;
  rotation: Quat;
}

export interface Sample {
  frame: number;
  /** `physicsSteps` of the counters: ticks run so far. */
  ticks: number;
  player: Pose;
  platforms: { Slider: Pose; Lift: Pose; Turntable: Pose };
  state: Record<string, number | boolean>;
}

export interface DriveResult {
  samples: Sample[];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  stateAfter: string;
  counters: Record<string, number>;
  disposed: Record<string, number>;
  ids: Record<string, string>;
}

export interface DriveArgs {
  frames: readonly Frame[];
  target: { width: number; height: number };
  /** Snapshot after every frame, or only after the last frame of each step of the script. */
  sample: "every" | "boundary";
  /** Entity names whose IDs to report (from an extension's `readTransforms`). */
  idNames: readonly string[];
}

/**
 * The page side: mounts the example with the manual clock, steps through the frames and samples. It runs in the page, so
 * it must not refer to anything outside its own body.
 */
export async function drive(args: DriveArgs): Promise<DriveResult> {
  interface AppLike {
    state: string;
    debug: {
      pressKey(code: string): void;
      releaseKey(code: string): void;
      step(frames: number, dt: number): void;
      counters(): Record<string, number>;
      scene(): { state: Record<string, number | boolean>; entities: Array<{ name: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }> };
    };
    dispose(): void;
  }
  const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
  const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
  let context: { readTransforms(): Array<{ id: string; name: string }> } | undefined;
  const app = await w.__mtekMount({
    test: { manualClock: true, renderTarget: args.target },
    onDiagnostic: (d: { code: string; severity: string; message: string }) => diagnostics.push({ code: d.code, severity: d.severity, message: d.message }),
    extensions: [{ id: "movement-ids", apiVersion: 1, setup(c: typeof context) { context = c; } }],
  });
  const pose = (e: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } } | undefined): { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } } => ({
    position: { x: e?.position.x ?? Number.NaN, y: e?.position.y ?? Number.NaN, z: e?.position.z ?? Number.NaN },
    rotation: { x: e?.rotation.x ?? Number.NaN, y: e?.rotation.y ?? Number.NaN, z: e?.rotation.z ?? Number.NaN, w: e?.rotation.w ?? Number.NaN },
  });
  const snapshot = (frame: number): Sample => {
    const scene = app.debug.scene();
    const find = (name: string) => scene.entities.find((e) => e.name === name);
    return {
      frame,
      ticks: app.debug.counters()["physicsSteps"] ?? Number.NaN,
      player: pose(find("Player")),
      platforms: { Slider: pose(find("Slider")), Lift: pose(find("Lift")), Turntable: pose(find("Turntable")) },
      state: { ...scene.state },
    };
  };
  const ids: Record<string, string> = {};
  for (const transform of context?.readTransforms() ?? []) {
    if (args.idNames.includes(transform.name)) ids[transform.name] = transform.id;
  }
  const samples: Sample[] = [];
  let index = 0;
  for (const frame of args.frames) {
    for (const key of frame.press) app.debug.pressKey(key);
    for (const key of frame.release) app.debug.releaseKey(key);
    app.debug.step(1, frame.dt);
    index += 1;
    if (args.sample === "every" || frame.boundary) samples.push(snapshot(index));
  }
  const counters = { ...app.debug.counters() };
  const stateAfter = app.state;
  app.dispose();
  const disposed = { ...app.debug.counters() };
  return { samples, diagnostics, stateAfter, counters, disposed, ids };
}
