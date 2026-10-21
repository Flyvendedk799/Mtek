/**
 * Game flow services of generated code (decisions 0140, 0141 and 0143): `go_to`, `reset`, `pause`, `resume` and
 * `paused`, reached through `ctx.goTo`, `ctx.reset`, `ctx.pause`, `ctx.resume` and `ctx.paused`.
 *
 * The world only forwards the calls; the mounted application (`host/app.ts`) implements them, because a scene change
 * replaces the world itself. The mount creates a {@link GameLink} before the application exists (the scene's `init`
 * runs first, and may read `paused()`), and the application connects itself to it.
 */

/** What generated code can ask of the game. */
export interface GameHooks {
  /** `go_to(Scene)`: switch to the scene `scene` at the start of a later frame (decision 0141). */
  goTo(scene: string, spanId: number): void;
  /** `reset()`: restart the current scene from its starting values (decision 0140). */
  reset(): void;
  /** `pause()`: stop the game clock (decision 0143). */
  pause(): void;
  /** `resume()`: start the game clock again. */
  resume(): void;
  /** `paused()`: whether the game clock is stopped by `pause()`. */
  paused(): boolean;
}

/** Game services for a world nothing drives: no scene changes, never paused. */
export const INERT_GAME: GameHooks = Object.freeze({
  goTo: () => undefined,
  reset: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  paused: () => false,
});

/** Forwards to the hooks the application connects; before that (and after `dispose`) it behaves like {@link INERT_GAME}. */
export class GameLink implements GameHooks {
  target: GameHooks = INERT_GAME;

  goTo(scene: string, spanId: number): void {
    this.target.goTo(scene, spanId);
  }

  reset(): void {
    this.target.reset();
  }

  pause(): void {
    this.target.pause();
  }

  resume(): void {
    this.target.resume();
  }

  paused(): boolean {
    return this.target.paused();
  }
}
