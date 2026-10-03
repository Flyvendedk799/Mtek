// Node-side driver of the bridge page: the layout fixture list, the generated artifacts the
// `bridge_spike` example wrote into `.out/bridge/`, and a typed client for `window.__bridge`.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import type { ArenaInfo, ColorResult, ProbeResult } from "./bridge-api.ts";
import {
  type LayoutRecord,
  type ProbeManifest,
  parseLayoutRecord,
  parseProbeManifest,
} from "./bridge-layout.ts";
import type { ExpectedLeaf, JsonValue } from "./bridge-values.ts";
import type { RegistryCounters } from "../../../packages/runtime-web/src/gpu/registry.ts";

export type { ArenaInfo, ColorResult, ProbeResult, RegistryCounters };

const gpuLayoutDir = resolve(import.meta.dirname, "..", "..", "gpu-layout");
const bridgeDir = resolve(import.meta.dirname, "..", ".out", "bridge");

/** Names of the layout fixtures (`tests/gpu-layout/<name>.type.json`), sorted. */
export function fixtureNames(): string[] {
  return readdirSync(gpuLayoutDir)
    .filter((file) => file.endsWith(".type.json"))
    .map((file) => file.slice(0, -".type.json".length))
    .sort();
}

export interface FixtureData {
  readonly record: LayoutRecord;
  readonly manifest: ProbeManifest;
}

/** The layout record and probe leaf list the generator wrote for `name`. */
export function loadFixture(name: string): FixtureData {
  return {
    record: parseLayoutRecord(readFileSync(join(bridgeDir, `${name}.layout.json`), "utf8")),
    manifest: parseProbeManifest(readFileSync(join(bridgeDir, `${name}.probe.json`), "utf8")),
  };
}

const hex = (word: number | undefined): string =>
  word === undefined ? "missing" : `0x${(word >>> 0).toString(16).padStart(8, "0")}`;

/**
 * Human-readable differences between the words the GPU read and the expected leaves: one line per
 * leaf whose word differs, and one per non-zero padding word after the last leaf. Empty when the
 * row agrees bit for bit.
 */
export function wordMismatches(expected: readonly ExpectedLeaf[], actual: readonly number[]): string[] {
  const problems: string[] = [];
  expected.forEach((leaf, index) => {
    if (actual[index] !== leaf.word) {
      problems.push(`${leaf.path} (${leaf.kind}, word ${index}): read ${hex(actual[index])}, expected ${hex(leaf.word)}`);
    }
  });
  for (let index = expected.length; index < actual.length; index++) {
    if (actual[index] !== 0) problems.push(`padding word ${index}: read ${hex(actual[index])}, expected 0x00000000`);
  }
  if (actual.length < expected.length) problems.push(`only ${actual.length} words read, expected ${expected.length}`);
  return problems;
}

/** The functions of `window.__bridge`, called from the test process. */
export interface BridgeClient {
  runProbe(fixture: string, valuesA: JsonValue, valuesB?: JsonValue): Promise<ProbeResult>;
  updateAndRerun(fixture: string, slot: number, values: JsonValue): Promise<ProbeResult>;
  renderColor(values: JsonValue): Promise<ColorResult>;
  counters(): Promise<RegistryCounters>;
  errors(): Promise<string[]>;
  dispose(): Promise<void>;
}

/**
 * Loads the bridge page and returns a client for it. Values cross the boundary as JSON text
 * (JSON round-trips every finite `f32`, `i32` and `u32` exactly) and are parsed in the page.
 */
export async function openBridge(page: Page): Promise<BridgeClient> {
  await page.goto("/bridge.html");
  await page.waitForFunction(() => window.__bridge !== undefined);
  return {
    runProbe: (fixture, valuesA, valuesB) =>
      page.evaluate(
        ([name, a, b]) => {
          const bridge = window.__bridge;
          if (bridge === undefined) throw new Error("window.__bridge is missing");
          const first = JSON.parse(a) as JsonValue;
          return b === undefined
            ? bridge.runProbe(name, first)
            : bridge.runProbe(name, first, JSON.parse(b) as JsonValue);
        },
        [fixture, JSON.stringify(valuesA), valuesB === undefined ? undefined : JSON.stringify(valuesB)] as const,
      ),
    updateAndRerun: (fixture, slot, values) =>
      page.evaluate(
        ([name, at, next]) => {
          const bridge = window.__bridge;
          if (bridge === undefined) throw new Error("window.__bridge is missing");
          return bridge.updateAndRerun(name, at, JSON.parse(next) as JsonValue);
        },
        [fixture, slot, JSON.stringify(values)] as const,
      ),
    renderColor: (values) =>
      page.evaluate((next) => {
        const bridge = window.__bridge;
        if (bridge === undefined) throw new Error("window.__bridge is missing");
        return bridge.renderColor(JSON.parse(next) as JsonValue);
      }, JSON.stringify(values)),
    counters: () =>
      page.evaluate(() => {
        const bridge = window.__bridge;
        if (bridge === undefined) throw new Error("window.__bridge is missing");
        return bridge.counters();
      }),
    errors: () =>
      page.evaluate(() => {
        const bridge = window.__bridge;
        if (bridge === undefined) throw new Error("window.__bridge is missing");
        return bridge.errors();
      }),
    dispose: () =>
      page.evaluate(() => {
        window.__bridge?.dispose();
      }),
  };
}
