/**
 * Timers of `after(seconds) { ... }` and `every(seconds) { ... }` (decision 0142, `spec/scenes.md` section 15).
 *
 * Generated code hands the runtime a closure: `ctx.after(seconds, fn, owner, spanId)` and
 * `ctx.every(seconds, fn, owner, spanId)`. Timers run on the game clock: the world advances them at the start of
 * phase 3 of every frame in which the game is not paused (decision 0143), before the `update` functions, so a timer
 * never runs while `pause()` holds the game, and the paused interval never counts towards a timer.
 *
 * - `after` runs its block once, in the first frame whose game time reaches the due time.
 * - `every` runs its block at most once per frame. Its next due time is one period after the previous one, or one
 *   period after now when the game fell behind (a long frame), so it never runs a backlog in a burst.
 * - Timers that fall due in the same frame run in order of due time, then in the order they were started.
 * - A timer started by a spawned entity's handler belongs to that entity: it is dropped, without running, once the
 *   entity is destroyed. A scene's timers live as long as the scene. `reset()` and `go_to` start the scene afresh,
 *   with no timers.
 * - A timer started while timers run waits for the next frame, so a block that starts its own timer cannot loop.
 * - At most {@link MAX_TIMERS} timers are live. A timer started beyond that is not started and the call site is
 *   reported once (`W8205`, decision 0177): a timer started every frame would otherwise grow without bound.
 * - A negative or non-finite delay counts as 0 (the block runs in the next frame); a period that is not greater
 *   than 0 runs the block once per frame. The compiler rejects such constants (`E3211`).
 */

/** The most timers a scene can have waiting (decision 0177). */
export const MAX_TIMERS = 4096;

/** The record that owns a timer: an entity record (static or spawned), or `null` for the scene. */
export type TimerOwner = { readonly ref: unknown } | null;

interface Timer {
  due: number;
  /** 0 for `after`. */
  readonly period: number;
  readonly repeat: boolean;
  readonly fn: () => void;
  readonly owner: TimerOwner;
  /** Start order: the tie-break between timers due at the same time. */
  readonly order: number;
  readonly spanId: number;
  cancelled: boolean;
}

function delayOf(seconds: unknown): number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export class TimerList {
  private timers: Timer[] = [];
  private now = 0;
  private started = 0;
  private running = false;
  private readonly added: Timer[] = [];

  /** `onFull(spanId)` is called for a timer that is not started because {@link MAX_TIMERS} are waiting. */
  constructor(private readonly onFull: (spanId: number) => void = () => undefined) {}

  /** Game time of this scene, in seconds: the sum of the deltas of the frames in which the game was not paused. */
  get gameTime(): number {
    return this.now;
  }

  /** The number of timers waiting (both kinds). */
  get size(): number {
    return this.timers.length + this.added.length;
  }

  /** `ctx.after(seconds, fn, owner, spanId)`. */
  after(seconds: unknown, fn: unknown, owner: TimerOwner, spanId: unknown): void {
    this.add(delayOf(seconds), false, fn, owner, spanId);
  }

  /** `ctx.every(seconds, fn, owner, spanId)`. */
  every(seconds: unknown, fn: unknown, owner: TimerOwner, spanId: unknown): void {
    this.add(delayOf(seconds), true, fn, owner, spanId);
  }

  private add(delay: number, repeat: boolean, fn: unknown, owner: TimerOwner, spanId: unknown): void {
    if (typeof fn !== "function") throw new TypeError("a timer needs a function");
    if (this.size >= MAX_TIMERS) {
      this.onFull(typeof spanId === "number" ? spanId : -1);
      return;
    }
    const timer: Timer = {
      due: this.now + delay,
      period: repeat ? delay : 0,
      repeat,
      fn: fn as () => void,
      owner,
      order: this.started,
      spanId: typeof spanId === "number" ? spanId : -1,
      cancelled: false,
    };
    this.started += 1;
    if (this.running) this.added.push(timer);
    else this.timers.push(timer);
  }

  /**
   * Advances the game clock by `delta` seconds and runs the blocks that fall due. `alive` says whether a timer's
   * owner still exists; the timers of a dead owner are dropped. An exception of a block (the loop budget, `E8080`)
   * propagates after the list is left consistent: the timers that did not run yet stay queued.
   */
  advance(delta: number, alive: (owner: NonNullable<TimerOwner>) => boolean): void {
    this.now += Math.max(0, delta);
    const now = this.now;
    const due = this.timers.filter((timer) => timer.due <= now);
    if (due.length === 0) return;
    due.sort((a, b) => a.due - b.due || a.order - b.order);
    this.running = true;
    try {
      for (const timer of due) {
        if (timer.cancelled) continue;
        if (timer.owner !== null && !alive(timer.owner)) {
          timer.cancelled = true;
          continue;
        }
        if (timer.repeat) {
          timer.due += timer.period;
          // Behind (a long frame, or a period of 0): the next run is one period after now. The due list is taken
          // once per frame, so a timer runs at most once per frame whatever its period.
          if (timer.due <= now) timer.due = now + timer.period;
        } else {
          timer.cancelled = true;
        }
        timer.fn();
      }
    } finally {
      this.running = false;
      this.timers = this.timers.filter((timer) => !timer.cancelled && (timer.owner === null || alive(timer.owner)));
      this.timers.push(...this.added);
      this.added.length = 0;
    }
  }

  /** Drops every timer (the scene ends). */
  clear(): void {
    for (const timer of this.timers) timer.cancelled = true;
    this.timers = [];
    this.added.length = 0;
  }
}
