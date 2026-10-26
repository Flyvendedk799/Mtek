import type {SceneTransform} from "@mtek/runtime-web";

export interface InspectorMetrics {
  readonly liveBuffers?: number;
  readonly liveTextures?: number;
  readonly liveEntities?: number;
  readonly drawCalls?: number;
  readonly culledObjects?: number;
  readonly frameTimeMs?: number;
  readonly cpuUpdateMs?: number;
  readonly renderPrepMs?: number;
}
export interface InspectorMetricsSource {read(): InspectorMetrics}
export const INSPECTOR_METRICS_SERVICE = "mtek.inspector.metrics";
export interface InspectedAnimation {
  readonly mode: "clip" | "locomotion";
  readonly clips: readonly {readonly name: string; readonly duration: number}[];
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly revision: number;
  readonly jointCount: number;
  readonly joints: readonly {
    readonly name: string;
    readonly parent: string | null;
    readonly position: {readonly x: number; readonly y: number; readonly z: number};
  }[];
}
export interface InspectorSnapshot {
  readonly status: "detached" | "ready" | "disposed";
  readonly entities: readonly SceneTransform[];
  readonly selectedId: string | null;
  readonly animation: InspectedAnimation | null;
  readonly metrics: InspectorMetrics | null;
  readonly pending: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly error: string | null;
}
export interface InspectorOptions {
  readonly id?: string;
  /** Seconds between snapshots. No independent timer or render loop is created. */
  readonly interval?: number;
  readonly historyLimit?: number;
  readonly maxJoints?: number;
  readonly onError?: (error: unknown) => void;
}
