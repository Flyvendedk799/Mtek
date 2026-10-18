// Shared by the physics and lifecycle specs of M5-06: the page-side shape of a mounted application, the constants
// every derivation uses and the free-flight kinematics the expected numbers come from.
import type { Page } from "@playwright/test";

export interface DiagnosticLike {
  code: string;
  severity: string;
  message: string;
}

export interface SpawnedLike {
  prefab: string;
  slot: number;
  gen: number;
  alive: boolean;
  position: { x: number; y: number; z: number };
  state: Record<string, number>;
}

export interface SceneLike {
  state: Record<string, number | number[]>;
  entities: Array<{ name: string; position: { x: number; y: number; z: number } }>;
  spawned: SpawnedLike[];
}

export interface AppLike {
  state: string;
  pause(): void;
  resume(): void;
  debug: {
    pressKey(code: string): void;
    releaseKey(code: string): void;
    step(frames: number, dtSeconds: number): void;
    counters(): Record<string, number>;
    scene(): SceneLike;
  };
  dispose(): void;
}

/** `manifest.runtimeConfig.fixedStep`: a frame of exactly this length is exactly one fixed tick (decision 0066 item 12). */
export const STEP = 0.016666668;
/** A small offscreen target: these specs read state, not pixels. */
export const TARGET = { width: 96, height: 48 } as const;
export const GRAVITY = 9.81;

/** Opens the built fixture's test page; `window.__mtekMount` mounts the program. */
export async function openFixture(page: Page, fixture: string): Promise<void> {
  await page.goto(`/m5/${fixture}/index.html`);
}

/**
 * The height after `ticks` fixed steps of free fall under gravity `g` from rest at `y0`, in the engine's substepped
 * model (four substeps per step, decision 0063 item 5): `y0 - g dt^2 (n^2 / 2 + n / 8)`.
 */
export function freeFallHeight(y0: number, ticks: number, g = GRAVITY, dt = STEP): number {
  return y0 - g * dt * dt * (ticks * ticks / 2 + ticks / 8);
}

/** The times (seconds after the throw) at which a ball thrown up at `v0` from `y0` is at `level`: ascending, zero, one or two of them. */
export function crossingTimes(y0: number, v0: number, level: number, g = GRAVITY): number[] {
  // y0 + v0 t - g t^2 / 2 = level
  const a = -g / 2;
  const discriminant = v0 * v0 - 4 * a * (y0 - level);
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-v0 - root) / (2 * a), (-v0 + root) / (2 * a)].filter((t) => t >= 0).sort((p, q) => p - q);
}

/** One thing a script does to a mounted application, in order. */
export type Action =
  | { op: "step"; frames: number; dt?: number }
  | { op: "press"; key: string }
  | { op: "release"; key: string }
  | { op: "pause" }
  | { op: "resume" }
  | { op: "snap"; label: string };

/** What a `snap` records: everything the specs read, copied out of the page. */
export interface Snapshot {
  label: string;
  state: Record<string, number | number[]>;
  counters: Record<string, number>;
  spawned: SpawnedLike[];
  /** Named entities by name. */
  at: Record<string, { x: number; y: number; z: number }>;
  appState: string;
}

export interface ScriptRun {
  snaps: Snapshot[];
  reported: DiagnosticLike[];
  finalState: string;
}

/**
 * Mounts the fixture with the manual clock and runs `actions` against it in the page; the application is disposed at
 * the end. A `step` without `dt` uses the fixed step, so one frame is one tick (decision 0066 item 12).
 */
export async function runScript(page: Page, fixture: string, actions: readonly Action[]): Promise<ScriptRun> {
  await openFixture(page, fixture);
  return page.evaluate(
    async ({ target, script, step }) => {
      const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const app = await w.__mtekMount({ test: { manualClock: true, renderTarget: target }, onDiagnostic: (d: DiagnosticLike) => reported.push(d) });
      const snaps: Snapshot[] = [];
      for (const action of script) {
        switch (action.op) {
          case "step":
            app.debug.step(action.frames, action.dt ?? step);
            break;
          case "press":
            app.debug.pressKey(action.key);
            break;
          case "release":
            app.debug.releaseKey(action.key);
            break;
          case "pause":
            app.pause();
            break;
          case "resume":
            app.resume();
            break;
          case "snap": {
            const scene = app.debug.scene();
            snaps.push({
              label: action.label,
              state: JSON.parse(JSON.stringify(scene.state)) as Snapshot["state"],
              counters: { ...app.debug.counters() },
              spawned: scene.spawned.map((entity) => ({ prefab: entity.prefab, slot: entity.slot, gen: entity.gen, alive: entity.alive, position: { ...entity.position }, state: { ...entity.state } })),
              at: Object.fromEntries(scene.entities.map((entity) => [entity.name, { ...entity.position }])),
              appState: app.state,
            });
            break;
          }
        }
      }
      const finalState = app.state;
      app.dispose();
      return { snaps, reported, finalState };
    },
    { target: TARGET, script: actions, step: STEP },
  );
}
