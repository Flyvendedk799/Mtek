// Page-side driver and Node-side helpers of the M4-10 configurator specs: mount a built program with the manual clock, set host
// inputs, run frames, read the offscreen target back after each step, and compare the readback with the CPU model of
// support/configurator-scene.ts.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "../../support/fixtures.ts";
import { compareImage, type Comparison, type ExpectedImage, type HostValues } from "../../support/configurator-scene.ts";

/** Tolerance in bytes per channel against the f64 oracle (the PBR acceptance criterion, decision 0057). */
export const TOLERANCE = 3;

export interface DiagnosticLike {
  code: string;
  severity: string;
  phase: string;
  message: string;
  notes: string[];
}

export interface InputResult {
  name: string;
  ok: boolean;
  code: string | null;
}

export interface Snapshot {
  state: Record<string, unknown>;
  entities: Array<{ name: string; position: unknown; rotation: unknown }>;
}

export interface Shot {
  label: string;
  counters: Record<string, number>;
  width: number;
  height: number;
  /** RGBA, top row first. */
  data: Uint8Array;
  inputs: InputResult[];
}

export interface PlanStep {
  label: string;
  /** `setInput` calls made before the frames, in order. */
  inputs?: ReadonlyArray<readonly [string, unknown]>;
  /** Frames to run (default 1) at 1/60 s each. */
  frames?: number;
}

export interface PlanResult {
  shots: Shot[];
  reported: DiagnosticLike[];
  state: string;
  assets: Array<{ url: string; kind: string; state: string; bytes: number }>;
  assetEvents: Array<{ url: string; kind: string; state: string }>;
  /** Scene snapshot and counters right after mount, before any frame. */
  mounted: { scene: Snapshot; counters: Record<string, number> };
}

interface AppLike {
  state: string;
  setInput(name: string, value: unknown): { ok: boolean; error?: { code: string } };
  dispose(): void;
  debug: {
    step(frames: number, dtSeconds: number): void;
    readPixels(): Promise<{ width: number; height: number; data: Uint8Array }>;
    counters(): Record<string, number>;
    scene(): Snapshot;
    assets(): Array<{ url: string; kind: string; state: string; bytes: number }>;
  };
}

interface RawShot {
  label: string;
  counters: Record<string, number>;
  width: number;
  height: number;
  pixels: string;
  inputs: InputResult[];
}

/**
 * Opens `url` (a test-mode build), mounts it with `test` options and runs `plan`: for every step the inputs are set, the frames
 * run and the target is read back. The mount's diagnostics and asset states are collected on the way. Disposes the application.
 */
export async function runPlan(page: Page, url: string, test: Record<string, unknown>, plan: readonly PlanStep[]): Promise<PlanResult> {
  await page.goto(url);
  const raw = await page.evaluate(
    async ({ testOptions, steps }) => {
      const w = window as unknown as { __mtekMount(options: Record<string, unknown>): Promise<AppLike> };
      const reported: DiagnosticLike[] = [];
      const assetEvents: Array<{ url: string; kind: string; state: string }> = [];
      const app = await w.__mtekMount({
        test: { manualClock: true, ...testOptions, onAssetState: (e: { url: string; kind: string; state: string }) => assetEvents.push({ url: e.url, kind: e.kind, state: e.state }) },
        onDiagnostic: (d: DiagnosticLike) => reported.push(d),
      });
      const toBase64 = (bytes: Uint8Array): string => {
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      };
      const mounted = { scene: app.debug.scene(), counters: { ...app.debug.counters() } };
      const shots: RawShot[] = [];
      for (const step of steps) {
        const inputs: InputResult[] = [];
        for (const [name, value] of step.inputs ?? []) {
          const result = app.setInput(name, value);
          inputs.push({ name, ok: result.ok, code: result.ok ? null : (result.error?.code ?? "?") });
        }
        app.debug.step(step.frames ?? 1, 1 / 60);
        const frame = await app.debug.readPixels();
        shots.push({ label: step.label, counters: { ...app.debug.counters() }, width: frame.width, height: frame.height, pixels: toBase64(frame.data), inputs });
      }
      const assets = app.debug.assets();
      const state = app.state;
      app.dispose();
      return { shots, reported, state, assets, assetEvents, mounted };
    },
    { testOptions: test, steps: plan.map((step) => ({ label: step.label, inputs: step.inputs?.map(([n, v]) => [n, v]) ?? [], frames: step.frames ?? 1 })) },
  );
  return {
    ...raw,
    shots: raw.shots.map((shot) => ({
      label: shot.label,
      counters: shot.counters,
      width: shot.width,
      height: shot.height,
      data: new Uint8Array(Buffer.from(shot.pixels, "base64")),
      inputs: shot.inputs,
    })),
  };
}

/** `[name, value]` pairs of a `HostValues` object, in declaration order. */
export function inputsOf(values: HostValues): Array<readonly [string, unknown]> {
  return Object.entries(values);
}

export function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Compares a shot with the expected image; fails with the pixel, channel and both values when a pixel is outside the tolerance. */
export function expectMatches(shot: Shot, expected: ExpectedImage, minPerEntity: Readonly<Record<string, number>> = {}): Comparison {
  expect([shot.width, shot.height], `${shot.label}: the target has the size of the expected image`).toEqual([expected.width, expected.height]);
  const comparison = compareImage(expected, shot.data, TOLERANCE);
  expect(comparison.outside, `${shot.label}: ${String(comparison.outside)} of ${String(comparison.compared)} compared pixels are off by more than ${String(TOLERANCE)}/255; worst: ${comparison.worst}`).toBe(0);
  for (const [name, count] of Object.entries(minPerEntity)) {
    expect(comparison.perEntity[name] ?? 0, `${shot.label}: stable pixels of ${name}`).toBeGreaterThanOrEqual(count);
  }
  return comparison;
}

/** Pixels (as indices) that changed between two frames. */
export function changedPixels(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 4) if ([0, 1, 2].some((c) => a[i + c] !== b[i + c])) out.push(i / 4);
  return out;
}

/** Writes a JSON record of the run for the evidence directory (the file lands in `MTEK_RESULTS_DIR`). */
export function writeRecord(name: string, record: unknown): void {
  const dir = process.env["MTEK_RESULTS_DIR"];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(record, null, 2)}\n`);
}
