import type {AnimationPlayer, ExtensionContext, MtekExtension, SceneTransform, TransformUpdate} from "@mtek/runtime-web";
import {INSPECTOR_METRICS_SERVICE, type InspectedAnimation, type InspectorMetrics, type InspectorMetricsSource, type InspectorOptions, type InspectorSnapshot, type InspectorSpatialSnapshot} from "./types.js";

type Edit = {readonly before: readonly TransformUpdate[]; readonly after: readonly TransformUpdate[]};
type Command = {kind: "edit"; updates: readonly TransformUpdate[]} | {kind: "undo"} | {kind: "redo"} |
  {kind: "clip"; name: string; seconds: number} | {kind: "seek"; seconds: number} |
  {kind: "pause"} | {kind: "resume"} | {kind: "detach"};
const empty = (status: InspectorSnapshot["status"]): InspectorSnapshot => Object.freeze({status, entities: Object.freeze([]), selectedId: null, animation: null, metrics: null, pending: 0, canUndo: false, canRedo: false, error: null});
const emptySpatial = (status: InspectorSpatialSnapshot["status"]): InspectorSpatialSnapshot => Object.freeze({status, selectedId: null, scene: null, animation: null, error: null});
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function copied(entity: SceneTransform): SceneTransform {
  return Object.freeze({...entity, position: Object.freeze({...entity.position}), rotation: Object.freeze({...entity.rotation}), scale: Object.freeze({...entity.scale}), ...(entity.bounds === undefined ? {} : {bounds: Object.freeze({center: Object.freeze({...entity.bounds.center}), radius: entity.bounds.radius})})});
}
function updatesCopy(updates: readonly TransformUpdate[]): readonly TransformUpdate[] {
  const seen = new Set<string>();
  if (updates.length === 0) throw new RangeError("An edit must contain at least one transform");
  return Object.freeze(updates.map(update => {
    if (!update.id || seen.has(update.id)) throw new RangeError("Each edit needs unique entity IDs");
    seen.add(update.id);
    const result: {id: string; position?: SceneTransform["position"]; rotation?: SceneTransform["rotation"]; scale?: SceneTransform["scale"]} = {id: update.id};
    for (const field of ["position", "rotation", "scale"] as const) {
      const value = update[field]; if (value === undefined) continue;
      if (![value.x, value.y, value.z].every(Number.isFinite) || (field === "scale" && Math.min(value.x, value.y, value.z) <= 0)) throw new RangeError(`Invalid ${field}`);
      if (field === "rotation") {
        const q = update.rotation!;
        if (!Number.isFinite(q.w) || Math.hypot(q.x, q.y, q.z, q.w) < 1e-8) throw new RangeError("Invalid rotation");
        result.rotation = Object.freeze({...q});
      } else result[field] = Object.freeze({...value});
    }
    if (Object.keys(result).length === 1) throw new RangeError("An edit needs a transform field");
    return Object.freeze(result);
  }));
}
function previous(context: ExtensionContext, updates: readonly TransformUpdate[]): readonly TransformUpdate[] {
  const entities = new Map(context.readTransforms().map(entity => [entity.id, entity]));
  return updatesCopy(updates.map(update => {
    const entity = entities.get(update.id); if (entity === undefined) throw new RangeError(`Unknown or stale entity ID: ${update.id}`);
    return {id: update.id, ...(update.position === undefined ? {} : {position: entity.position}), ...(update.rotation === undefined ? {} : {rotation: entity.rotation}), ...(update.scale === undefined ? {} : {scale: entity.scale})};
  }));
}

/** An optional extension consumer. Imports no runtime implementation or GPU code. */
export class InspectorController {
  readonly extension: MtekExtension;
  private context: ExtensionContext | undefined;
  private state = empty("detached");
  private readonly listeners = new Set<(snapshot: InspectorSnapshot) => void>();
  private readonly spatialListeners = new Set<(snapshot: InspectorSpatialSnapshot) => void>();
  private spatial = emptySpatial("detached");
  private notifyingSpatial = false;
  private readonly pending: Array<{command: Command; selectedId: string | null}> = [];
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];
  private readonly interval: number;
  private readonly historyLimit: number;
  private readonly maxJoints: number;
  private elapsed = 0;
  private changed = false;
  private notifying = false;

  constructor(private readonly options: InspectorOptions = {}) {
    this.interval = options.interval ?? 0.25; this.historyLimit = options.historyLimit ?? 100; this.maxJoints = options.maxJoints ?? 256;
    if (!Number.isFinite(this.interval) || this.interval < 0 || !Number.isInteger(this.historyLimit) || this.historyLimit < 1 || this.historyLimit > 1000 || !Number.isInteger(this.maxJoints) || this.maxJoints < 1 || this.maxJoints > 4096) throw new RangeError("Invalid inspector interval/history/joint limit");
    if (options.id === "") throw new RangeError("Inspector extension ID cannot be empty");
    this.extension = {
      id: options.id ?? "mtek.inspector", apiVersion: 1,
      setup: context => {
        if (this.state.status === "disposed") throw new Error("Inspector is disposed");
        if (context.apiVersion !== 1) throw new RangeError("Inspector requires extension API 1");
        if (this.context !== undefined) throw new Error("Inspector is already mounted; create one per application");
        this.context = context;
        try {this.capture(); this.captureSpatial();} catch (error) {this.context = undefined; throw error;}
        return () => {if (this.context !== context) return; this.context = undefined; this.clear(); this.publish(empty("detached")); this.publishSpatial(emptySpatial("detached"));};
      },
      beforeFrame: () => this.flush(),
      afterFrame: (_context, delta) => {
        if (this.context === undefined) return;
        this.captureSpatial();
        if (Number.isFinite(delta) && delta >= 0) this.elapsed += delta;
        if (this.changed || this.elapsed >= this.interval) {this.elapsed = 0; this.changed = false; this.capture();}
      },
    };
  }
  snapshot(): InspectorSnapshot {return this.state;}
  spatialSnapshot(): InspectorSpatialSnapshot {return this.spatial;}
  /** Enables render-aligned sampling only while spatial observers are attached. Panel polling stays throttled. */
  subscribeSpatial(listener: (snapshot: InspectorSpatialSnapshot) => void): () => void {
    if (this.state.status === "disposed") throw new Error("Inspector is disposed");
    this.spatialListeners.add(listener);
    if (this.context === undefined) this.deliverSpatial(listener); else this.captureSpatial();
    return () => {this.spatialListeners.delete(listener);};
  }
  subscribe(listener: (snapshot: InspectorSnapshot) => void): () => void {
    if (this.state.status === "disposed") throw new Error("Inspector is disposed");
    this.listeners.add(listener); this.deliver(listener);
    return () => {this.listeners.delete(listener);};
  }
  select(id: string | null): void {
    this.active();
    if (id !== null && !this.context!.readTransforms().some(entity => entity.id === id)) throw new RangeError(`Unknown or stale entity ID: ${id}`);
    this.publish({...this.state, selectedId: id}); this.capture(); this.captureSpatial();
  }
  edit(updates: readonly TransformUpdate[]): void {this.enqueue({kind: "edit", updates: updatesCopy(updates)});}
  undo(): void {this.enqueue({kind: "undo"});}
  redo(): void {this.enqueue({kind: "redo"});}
  selectClip(name: string, seconds = 0.2): void {
    if (!name || !Number.isFinite(seconds) || seconds < 0) throw new RangeError("Invalid clip or transition duration");
    this.enqueue({kind: "clip", name, seconds});
  }
  seek(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("Animation time must be finite and nonnegative");
    this.enqueue({kind: "seek", seconds});
  }
  pauseAnimation(): void {this.enqueue({kind: "pause"});}
  resumeAnimation(): void {this.enqueue({kind: "resume"});}
  detachAnimation(): void {this.enqueue({kind: "detach"});}
  refresh(): void {this.active(); this.capture(); this.captureSpatial();}
  dispose(): void {if (this.state.status === "disposed") return; this.context = undefined; this.clear(); this.publish(empty("disposed")); this.publishSpatial(emptySpatial("disposed")); this.listeners.clear(); this.spatialListeners.clear();}
  private active(): void {if (this.context === undefined) throw new Error(`Inspector is ${this.state.status}`);}
  private enqueue(command: Command): void {
    this.active(); if (this.pending.length >= 128) throw new RangeError("Inspector command queue is full; advance the scene first");
    this.pending.push({command, selectedId: this.state.selectedId}); this.publish({...this.state, pending: this.pending.length, error: null});
  }
  private clear(): void {this.pending.length = this.undoStack.length = this.redoStack.length = 0; this.elapsed = 0; this.changed = false;}
  private report(error: unknown): void {try {this.options.onError?.(error);} catch { /* Host error handlers must not break scene lifetime. */ }}
  private deliver(listener: (snapshot: InspectorSnapshot) => void): void {try {listener(this.state);} catch (error) {this.report(error);}}
  private deliverSpatial(listener: (snapshot: InspectorSpatialSnapshot) => void): void {try {listener(this.spatial);} catch (error) {this.report(error);}}
  private publishSpatial(snapshot: InspectorSpatialSnapshot): void {
    this.spatial = Object.freeze(snapshot); if (this.notifyingSpatial) return;
    this.notifyingSpatial = true;
    try {for (const listener of [...this.spatialListeners]) this.deliverSpatial(listener);} finally {this.notifyingSpatial = false;}
  }
  private captureSpatial(): void {
    const context = this.context;
    if (context === undefined || this.spatialListeners.size === 0) return;
    try {
      const scene = context.inspectScene?.();
      const selectedId = scene?.entities.some(e => e.id === this.state.selectedId) === true ? this.state.selectedId : null;
      const animation = selectedId === null ? undefined : context.animation(selectedId)?.inspect?.();
      if (this.context !== context) return;
      this.publishSpatial(frozen(structuredClone({status: "ready" as const, selectedId, scene: scene ?? null, animation: animation ?? null, error: null})));
    } catch (error) {
      if (this.context !== context) return;
      this.report(error); this.publishSpatial({...emptySpatial("ready"), error: error instanceof Error ? error.message : String(error)});
    }
  }
  private publish(state: InspectorSnapshot): void {
    this.state = Object.freeze(state); if (this.notifying) return;
    this.notifying = true; try {for (const listener of [...this.listeners]) this.deliver(listener);} finally {this.notifying = false;}
  }
  private flush(): void {
    const context = this.context; if (context === undefined) return;
    if (this.pending.length === 0) return;
    for (const {command, selectedId} of this.pending.splice(0)) {
      if (this.context !== context) break;
      try {
        if (command.kind === "edit") {
          const before = previous(context, command.updates); context.writeTransforms(command.updates);
          const after = previous(context, command.updates); this.undoStack.push({before, after});
          if (this.undoStack.length > this.historyLimit) this.undoStack.shift(); this.redoStack.length = 0;
        } else if (command.kind === "undo" || command.kind === "redo") {
          const source = command.kind === "undo" ? this.undoStack : this.redoStack, target = command.kind === "undo" ? this.redoStack : this.undoStack, edit = source.at(-1);
          if (edit === undefined) throw new RangeError(`Nothing to ${command.kind}`);
          const updates = command.kind === "undo" ? edit.before : edit.after; previous(context, updates); context.writeTransforms(updates); source.pop(); target.push(edit);
        } else {
          if (selectedId === null) throw new RangeError("Select an animated entity first");
          const player = command.kind === "detach" ? context.detachAnimation(selectedId) : context.animation(selectedId);
          if (player === undefined) throw new RangeError("The selected entity has no skeletal animation");
          this.animate(player, command);
        }
        this.publish({...this.state, error: null});
      } catch (error) {this.publish({...this.state, error: error instanceof Error ? error.message : String(error)}); this.report(error);}
      this.changed = true;
    }
    this.publish({...this.state, pending: this.pending.length, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0});
  }
  private animate(player: AnimationPlayer, command: Exclude<Command, {kind: "edit"} | {kind: "undo" | "redo"}>): void {
    if (command.kind === "clip") {
      if (!player.transition(command.name, command.seconds, true, 1)) throw new RangeError(`Unknown clip: ${command.name}`);
    } else if (command.kind === "seek") {
      const duration = player.locomotion.active ? player.locomotion.duration : player.clock.duration(0);
      if (command.seconds > duration) throw new RangeError("Time exceeds the selected animation duration");
      if (player.locomotion.active) player.locomotion.seek(duration === 0 ? 0 : command.seconds / duration);
      else if (!player.clock.seek(0, command.seconds)) throw new Error("Animation seek failed");
      player.evaluate();
    } else if (command.kind === "pause" || command.kind === "resume") {
      const ok = player.locomotion.active ? player.locomotion[command.kind]() : player.clock[command.kind](0);
      if (!ok) throw new Error(`Animation ${command.kind} failed`);
    }
  }
  private animation(player: AnimationPlayer): InspectedAnimation {
    const blend = player.locomotion, mode = blend.active ? "locomotion" : "clip";
    return Object.freeze({mode, diagnostics: frozen(structuredClone(player.inspect?.() ?? null)), clips: Object.freeze(player.skin.clips.map(clip => Object.freeze({name: clip.name, duration: clip.duration}))),
      time: blend.active ? blend.phase * blend.duration : player.clock.time(0), duration: blend.active ? blend.duration : player.clock.duration(0), playing: blend.active ? blend.playing : player.clock.playing(0), revision: player.revision, jointCount: player.skin.joints.length,
      joints: Object.freeze(player.skin.joints.slice(0, this.maxJoints).map(index => {
        const node = player.skin.nodes[index]!;
        return Object.freeze({name: node.name, parent: player.skin.nodes[node.parent]?.name ?? null, position: Object.freeze({...player.jointPosition(node.name)})});
      }))});
  }
  private capture(): void {
    const context = this.context; if (context === undefined) return;
    const entities = Object.freeze(context.readTransforms().map(copied));
    const selectedId = entities.some(entity => entity.id === this.state.selectedId) ? this.state.selectedId : null;
    const ids = new Set(entities.map(entity => entity.id));
    for (const stack of [this.undoStack, this.redoStack]) if (stack.some(edit => edit.before.some(update => !ids.has(update.id)))) stack.length = 0;
    const player = selectedId === null ? undefined : context.animation(selectedId);
    let metrics: InspectorMetrics | null = null;
    try {
      const source = context.service<InspectorMetricsSource>(INSPECTOR_METRICS_SERVICE);
      if (source !== undefined) {
        const raw = source.read(), result: Record<string, number> = {};
        for (const key of ["liveBuffers", "liveTextures", "liveEntities", "drawCalls", "culledObjects", "frameTimeMs", "cpuUpdateMs", "renderPrepMs"] as const) {
          const value = raw[key]; if (value === undefined) continue;
          if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid inspector metric: ${key}`); result[key] = value;
        }
        metrics = Object.keys(result).length === 0 ? null : Object.freeze(result);
      }
    } catch (error) {this.report(error);}
    this.publish({...this.state, status: "ready", entities, selectedId, animation: player === undefined ? null : this.animation(player), metrics, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0});
  }
}
