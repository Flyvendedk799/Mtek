/**
 * Game flow services of generated code (decisions 0140, 0141, 0143 and 0145): `go_to`, `reset`, `pause`, `resume`,
 * `paused`, `save`, `load` and `clear_saved`, reached through `ctx.goTo`, `ctx.reset`, `ctx.pause`, `ctx.resume`,
 * `ctx.paused`, `ctx.save`, `ctx.load` and `ctx.clearSaved`.
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
  /** `save()`: write the saved state and settings of the running scene (decision 0145). */
  save(): void;
  /** `load()`: read them back; whether a stored value was applied. */
  load(): boolean;
  /** `clear_saved()`: remove every stored value of the program. */
  clearSaved(): void;
}

/** Game services for a world nothing drives: no scene changes, never paused. */
export const INERT_GAME: GameHooks = Object.freeze({
  goTo: () => undefined,
  reset: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  paused: () => false,
  save: () => undefined,
  load: () => false,
  clearSaved: () => undefined,
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

  save(): void {
    this.target.save();
  }

  load(): boolean {
    return this.target.load();
  }

  clearSaved(): void {
    this.target.clearSaved();
  }
}
