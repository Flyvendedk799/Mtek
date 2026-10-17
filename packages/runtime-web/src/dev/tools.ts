/**
 * The development tools of a mounted application (decision 0055): frame statistics, the optional GPU
 * timer and the overlay, behind one object so the host has a single dev-only seam. Created by `mountMtek`
 * only when the runtime is a development build (`__MTEK_DEV__`) and the host asked for it
 * (`options.devOverlay`); a release bundle contains none of `src/dev/`.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { resolveSpan, spanOfSymbol } from "../host/failures.js";
import { FrameStats } from "./frame-stats.js";
import type { GpuTimer } from "./gpu-timer.js";
import { DevOverlay, type DevOverlayOptions } from "./overlay.js";
import type { PanelEntity } from "./panel.js";

/** At most this many error diagnostics are kept for the panel (the latest ones). */
export const MAX_PANEL_ERRORS = 4;

/** `file:line` of each entity's declaration (the start of the span of its symbol), in instance order. */
export function panelEntities(manifest: MtekManifest): PanelEntity[] {
  return manifest.scene.entities.map((entity) => {
    const span = spanOfSymbol(manifest, entity.symbol);
    const source = span === undefined ? null : resolveSpan(manifest, span);
    return { name: entity.name, source: source === null ? null : `${source.file}:${String(source.startLine)}` };
  });
}

/** One line of the panel for an error diagnostic: `CODE: first line of the message`. */
export function errorLine(diagnostic: MtekDiagnostic): string {
  const first = diagnostic.message.split("\n", 1)[0] ?? "";
  return `${diagnostic.code}: ${first.length > 120 ? `${first.slice(0, 117)}...` : first}`;
}

export interface DevToolsOptions extends DevOverlayOptions {
  readonly manifest: MtekManifest;
  /** `null` when the device has no `timestamp-query`. */
  readonly timer: GpuTimer | null;
}

export class DevTools {
  readonly overlay: DevOverlay;
  readonly stats = new FrameStats();
  private readonly timer: GpuTimer | null;
  private scene: string;
  private errors: string[] = [];

  constructor(options: DevToolsOptions) {
    this.timer = options.timer;
    this.overlay = new DevOverlay(options);
    this.scene = options.manifest.entryScene;
    this.overlay.setEntities(panelEntities(options.manifest));
  }

  /** The program changed (hot reload): refresh the scene name and the entity list. */
  setProgram(manifest: MtekManifest): void {
    this.scene = manifest.entryScene;
    this.overlay.setEntities(panelEntities(manifest));
  }

  /** Remembers an error diagnostic for the panel; only the latest `MAX_PANEL_ERRORS` are kept. */
  recordError(diagnostic: MtekDiagnostic): void {
    this.errors.push(errorLine(diagnostic));
    if (this.errors.length > MAX_PANEL_ERRORS) this.errors = this.errors.slice(-MAX_PANEL_ERRORS);
  }

  /** GPU time in ms from the latest completed measurement; `null` when unavailable or not yet measured. */
  get gpuTimeMs(): number | null {
    return this.timer?.lastMs ?? null;
  }

  /** Whether `timestamp-query` is in use. */
  get gpuTimeActive(): boolean {
    return this.timer !== null;
  }

  /** Called at the end of every frame; `counters` is only evaluated when the panel is shown. */
  afterFrame(frameTimeMs: number, counters: () => Readonly<Record<string, number>>): void {
    this.stats.push(frameTimeMs);
    if (!this.overlay.visible) return;
    this.overlay.update({
      scene: this.scene,
      entity: null,
      frame: { lastMs: frameTimeMs, p50Ms: this.stats.percentile(50), p95Ms: this.stats.percentile(95), samples: this.stats.count },
      gpuTimeMs: this.gpuTimeMs,
      gpuTimeActive: this.gpuTimeActive,
      counters: counters(),
      errors: this.errors,
    });
  }

  reposition(): void {
    this.overlay.reposition();
  }

  /** Removes the panel and stops the GPU timer. Idempotent. */
  dispose(): void {
    this.overlay.remove();
    this.timer?.dispose();
  }
}
