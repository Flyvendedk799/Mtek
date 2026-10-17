/**
 * The text of the development overlay (`spec/tooling.md` section 9), as plain lines, so it can be tested
 * without a DOM. Development builds only (decision 0055).
 */

/** The entity the panel shows details of. */
export interface PanelEntity {
  readonly name: string;
  /** `file:line` of the declaration, or `null` when the manifest has no span for it. */
  readonly source: string | null;
}

export interface PanelData {
  readonly scene: string;
  /** The selected entity and its position in the cycle (`null` for a scene without entities). */
  readonly entity: { readonly item: PanelEntity; readonly position: number; readonly count: number } | null;
  readonly frame: {
    readonly lastMs: number;
    readonly p50Ms: number | undefined;
    readonly p95Ms: number | undefined;
    readonly samples: number;
  };
  /** `null` when GPU time is not available (no `timestamp-query`, or not yet measured). */
  readonly gpuTimeMs: number | null;
  /** Whether the `timestamp-query` feature is active; decides the wording of a missing value. */
  readonly gpuTimeActive: boolean;
  readonly counters: Readonly<Record<string, number>>;
  /** The latest error diagnostics, newest last. */
  readonly errors: readonly string[];
}

/** The key help shown in the panel. */
export const PANEL_KEYS_HELP = "` hide/show   Shift+` next entity";

function ms(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

function count(counters: Readonly<Record<string, number>>, name: string): string {
  const value = counters[name];
  return value === undefined ? "?" : String(value);
}

/**
 * The panel lines. Each line is `label: value`; the labels are part of the contract the browser specs
 * read, so they are fixed here.
 */
export function panelLines(data: PanelData): string[] {
  const c = data.counters;
  const lines: string[] = [];
  lines.push(`scene: ${data.scene}`);
  if (data.entity === null) lines.push("entity: (none)");
  else {
    const { item, position, count: total } = data.entity;
    lines.push(`entity: ${item.name} (${String(position + 1)}/${String(total)}) ${item.source ?? "source unknown"}`);
  }
  lines.push(`frame time: ${ms(data.frame.lastMs)} ms  p50 ${ms(data.frame.p50Ms)}  p95 ${ms(data.frame.p95Ms)}  (last ${String(data.frame.samples)} frames)`);
  lines.push(`cpu update: ${ms(c["cpuUpdateMs"])} ms  render prep: ${ms(c["renderPrepMs"])} ms`);
  if (data.gpuTimeMs !== null) lines.push(`GPU time: ${ms(data.gpuTimeMs)} ms`);
  else lines.push(data.gpuTimeActive ? "GPU time: pending" : "GPU time unavailable");
  lines.push(`draw calls: ${count(c, "drawCalls")}  instanced draws: ${count(c, "instancedDraws")}  culled objects: ${count(c, "culledObjects")}`);
  lines.push(`uploads: ${count(c, "uploads")}  upload bytes: ${count(c, "uploadBytes")}`);
  lines.push(
    `created: pipelines ${count(c, "pipelinesCreated")}  shader modules ${count(c, "shaderModulesCreated")}  bind groups ${count(c, "bindGroupsCreated")}  buffers ${count(c, "buffersAllocated")}  textures ${count(c, "texturesAllocated")}`,
  );
  lines.push(
    `live: buffers ${count(c, "liveBuffers")}  textures ${count(c, "liveTextures")}  samplers ${count(c, "liveSamplers")}  shader modules ${count(c, "liveShaderModules")}  pipelines ${count(c, "livePipelines")}  bind groups ${count(c, "liveBindGroups")}  listeners ${count(c, "liveListeners")}  entities ${count(c, "liveEntities")}`,
  );
  lines.push(`discarded steps: ${count(c, "discardedSteps")}`);
  if (data.errors.length === 0) lines.push("errors: none");
  else {
    lines.push(`errors: ${String(data.errors.length)}`);
    for (const error of data.errors) lines.push(`  ${error}`);
  }
  lines.push(`keys: ${PANEL_KEYS_HELP}`);
  return lines;
}
