/**
 * The frame scheduler: the implementation contract of `spec/runtime-abi.md` section 7 (the frame
 * order of `spec/scenes.md` section 10).
 *
 * Each rendered frame runs seven explicit phases, supplied by the owner (`host/app.ts` for a
 * mounted application). There, until M3, phases 2 to 5 do nothing; phase 1 sets the world's frame
 * time (host inputs come later), phase 6 propagates transforms and phase 7 renders.
 * The scheduler owns time (`activeTime`, `frameIndex`, the fixed-step accumulator) but knows nothing
 * about GPUs or the DOM: the frame source is injected, which is how the manual clock of tests works.
 */

/** The seven phases of one frame, in execution order. */
export interface FramePhases {
  /** 1. Host inputs, input transitions, input handlers. */
  phase1_input(): void;
  /** 2. One fixed-step tick (called 0..maxCatchUpSteps times per frame). */
  phase2_tick(fixedStep: number): void;
  /** 3. `update(dt)` handlers, scene first, then entities in instance order. */
  phase3_update(delta: number): void;
  /** 4. Flush spawn/destroy commands. */
  phase4_flush(): void;
  /** 5. Evaluate bindings in topological order. */
  phase5_bindings(): void;
  /** 6. Propagate transforms. */
  phase6_transforms(): void;
  /** 7. Render: prepare, upload, encode, submit. */
  phase7_render(): void;
}

/**
 * A render-only phase set: phases 1 to 6 are no-ops and phase 7 calls `render`. The scheduler tests
 * use it; a mounted application uses the phases of `host/app.ts`, which also run phases 1 and 6.
 */
export function m1Phases(render: () => void): FramePhases {
  return {
    phase1_input: () => undefined,
    phase2_tick: () => undefined,
    phase3_update: () => undefined,
    phase4_flush: () => undefined,
    phase5_bindings: () => undefined,
    phase6_transforms: () => undefined,
    phase7_render: render,
  };
}

/** The constants of `manifest.runtimeConfig` the scheduler needs. */
export interface SchedulerConfig {
  readonly fixedStep: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDelta: number;
}

/** A source of animation frames (`requestAnimationFrame` in a browser). */
export interface FrameSource {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}

export type SchedulerState = "running" | "paused" | "stopped";

/**
 * Runs frames either from a {@link FrameSource} or, when constructed without one (the manual clock),
 * only through {@link Scheduler.stepManual}.
 *
 * Differences from the pseudo-code of section 7 that do not change behaviour: pausing cancels the
 * pending frame request instead of polling it, and resuming requests it again.
 */
export class Scheduler {
  private currentState: SchedulerState = "running";
  private handle: number | null = null;
  private lastMs: number | null = null;
  private accumulator = 0;
  private time = 0;
  private frames = 0;
  private discarded = 0;
  private lastDelta = 0;

  /**
   * @param onFrameError Called when a frame throws inside the animation-frame loop (the owner reports
   *   it and usually calls {@link stop}). Without it the error propagates to the caller. Frames run by
   *   {@link stepManual} always propagate their errors.
   */
  constructor(
    private readonly config: SchedulerConfig,
    private readonly phases: FramePhases,
    private readonly source: FrameSource | null,
    private readonly onFrameError?: (error: unknown) => void,
  ) {}

  get state(): SchedulerState {
    return this.currentState;
  }

  /** Active application time in seconds since mount, excluding paused time (f64). */
  get activeTime(): number {
    return this.time;
  }

  /** Number of frames completed since mount. */
  get frameIndex(): number {
    return this.frames;
  }

  /** The clamped delta of the most recent frame. */
  get delta(): number {
    return this.lastDelta;
  }

  /** Fixed steps dropped because the accumulator exceeded `maxCatchUpSteps`. */
  get discardedSteps(): number {
    return this.discarded;
  }

  /** True when a frame request is outstanding (always false with the manual clock). */
  get hasPendingFrame(): boolean {
    return this.handle !== null;
  }

  /** Starts the frame loop (a no-op with the manual clock). */
  start(): void {
    this.requestNext();
  }

  /** Stops accumulating time. The first frame after {@link resume} has delta 0. */
  pause(): void {
    if (this.currentState !== "running") return;
    this.currentState = "paused";
    this.cancelRequest();
  }

  /** Resumes after {@link pause}; the paused interval is never simulated. */
  resume(): void {
    if (this.currentState !== "paused") return;
    this.currentState = "running";
    this.lastMs = null;
    this.requestNext();
  }

  /** Stops for good (dispose, failure). Idempotent. */
  stop(): void {
    this.currentState = "stopped";
    this.cancelRequest();
  }

  /**
   * Manual clock: runs `frames` frames synchronously, each with delta `dtSeconds` (clamped to
   * `maxFrameDelta` like any other delta). Does nothing unless the scheduler is running.
   */
  stepManual(frames: number, dtSeconds: number): void {
    if (this.source !== null) throw new Error("Scheduler.stepManual requires the manual clock");
    if (!Number.isInteger(frames) || frames < 0) {
      throw new RangeError(`step: frames must be a non-negative integer, got ${String(frames)}`);
    }
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
      throw new RangeError(`step: dtSeconds must be finite and >= 0, got ${String(dtSeconds)}`);
    }
    for (let i = 0; i < frames && this.currentState === "running"; i += 1) {
      this.runFrame(Math.min(dtSeconds, this.config.maxFrameDelta));
    }
  }

  /** `onAnimationFrame` of section 7. Public so tests can drive it with exact timestamps. */
  onAnimationFrame(nowMs: number): void {
    this.handle = null;
    if (this.currentState !== "running") return;
    const rawDelta = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    try {
      this.runFrame(Math.min(Math.max(rawDelta, 0), this.config.maxFrameDelta));
    } catch (error) {
      if (this.onFrameError === undefined) throw error;
      this.onFrameError(error);
    } finally {
      // Keep the loop alive unless the frame (or its error handler) paused or stopped us.
      this.requestNext();
    }
  }

  private runFrame(delta: number): void {
    const { fixedStep, maxCatchUpSteps } = this.config;
    this.lastDelta = delta;
    this.time += delta;
    this.phases.phase1_input();
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= fixedStep && steps < maxCatchUpSteps) {
      this.phases.phase2_tick(fixedStep);
      this.accumulator -= fixedStep;
      steps += 1;
    }
    if (this.accumulator >= fixedStep) {
      this.discarded += Math.floor(this.accumulator / fixedStep);
      this.accumulator %= fixedStep;
    }
    this.phases.phase3_update(delta);
    this.phases.phase4_flush();
    this.phases.phase5_bindings();
    this.phases.phase6_transforms();
    // A handler may have disposed the application; never render after that.
    if (this.currentState !== "stopped") this.phases.phase7_render();
    this.frames += 1;
  }

  private requestNext(): void {
    if (this.source === null || this.currentState !== "running" || this.handle !== null) return;
    this.handle = this.source.request((nowMs) => {
      this.onAnimationFrame(nowMs);
    });
  }

  private cancelRequest(): void {
    if (this.source !== null && this.handle !== null) this.source.cancel(this.handle);
    this.handle = null;
  }
}
