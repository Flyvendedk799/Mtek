// Decision 0224: what the page does with a plan for the composable-animation acceptance. The plans (`hold`, `tap`, `wait` and the
// frame-time patterns) are those of the character movement acceptance (support/movement-drive.ts); this file adds the
// page side that reads the animation state of the running program through an extension, as a host inspector would:
// it never calls a command, it only reads (`inspect()`, the pose, the palette).
import type { Frame } from "./movement-drive.ts";

export type V3 = readonly [number, number, number];

export interface BlendRead {
  phase: number;
  parameter: { x: number; y: number };
  samples: Array<{ clip: string; x: number; y: number; weight: number }>;
}
export interface LayerRead {
  id: string;
  clip: string;
  weight: number;
  targetWeight: number;
  fadeRemaining: number;
  time: number;
}
export interface LimbRead {
  id: string;
  limb: string;
  target: { x: number; y: number; z: number };
  weight: number;
  flexion: number;
  residual: number;
}
export interface FootRead {
  requiredDrop: number;
  drop: number;
  left: { flexion: number; residual: number };
  right: { flexion: number; residual: number };
}
export interface IkRead {
  id: string;
  chain: number[];
  target: { x: number; y: number; z: number };
}
export interface FigureRead {
  /** Mesh-local joint positions by node name (`inspect().nodes`, after `evaluate()`). */
  nodes: Record<string, V3>;
  blend: BlendRead | null;
  layers: LayerRead[];
  limbs: LimbRead[];
  footPlacement: FootRead | null;
  ik: IkRead[];
  mode: string;
  rootMotionNode: number | null;
}
export interface Pose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}
export interface Sample {
  frame: number;
  /** The sum of the frame times so far (the manual clock). */
  time: number;
  /** `physicsSteps` of the counters: fixed ticks run so far. */
  ticks: number;
  hero: Pose;
  orb: Pose;
  state: Record<string, number | boolean>;
  model: FigureRead;
  ghost: FigureRead;
  guest: FigureRead;
}

export interface DriveArgs {
  frames: readonly Frame[];
  target: { width: number; height: number };
  sample: "every" | "boundary";
  /** Node names to read per figure, or "all"; the first sample reads every node regardless. */
  nodes: { model: readonly string[] | "all"; ghost: readonly string[] | "all"; guest: readonly string[] | "all" };
  /** After the last frame: read the rendered image and the CPU palettes of these figures. */
  final?: { pixels: boolean; palettes: readonly ("model" | "ghost" | "guest")[] };
}

export interface DriveResult {
  samples: Sample[];
  diagnostics: Array<{ code: string; severity: string; message: string; span?: unknown }>;
  stateAfter: string;
  counters: Record<string, number>;
  disposed: Record<string, number>;
  ids: Record<string, string>;
  /** The names of the nodes of each figure, in node order. */
  names: { model: string[]; ghost: string[]; guest: string[] };
  pixels?: { width: number; height: number; data: number[] };
  palettes?: Record<string, number[]>;
}

/**
 * The page side: mounts the example with the manual clock, steps through the frames and samples. It runs in the page, so it
 * must not refer to anything outside its own body.
 */
export async function drive(args: DriveArgs): Promise<DriveResult> {
  interface P3 {
    x: number;
    y: number;
    z: number;
  }
  interface Player {
    inspect?(): {
      mode: string;
      rootMotionNode: number | null;
      nodes: Array<{ name: string; position: P3 }>;
      layers: Array<{ id: string; clip: string; weight: number; targetWeight: number; fadeRemaining: number; time: number }>;
      ik: Array<{ id: string; chain: number[]; target: P3 }>;
      blend: { phase: number; parameter: { x: number; y: number }; samples: Array<{ clip: string; x: number; y: number; weight: number }> } | null;
      limbs?: Array<{ id: string; limb: string; target: P3; weight: number; flexion: number; residual: number }>;
      footPlacement?: { requiredDrop: number; drop: number; left: { flexion: number; residual: number }; right: { flexion: number; residual: number } } | null;
    };
    evaluate(): void;
    palette: Float32Array;
  }
  interface Ctx {
    readTransforms(): Array<{ id: string; name: string }>;
    animation(id: string): Player | undefined;
  }
  interface AppLike {
    state: string;
    debug: {
      pressKey(code: string): void;
      releaseKey(code: string): void;
      step(frames: number, dt: number): void;
      counters(): Record<string, number>;
      scene(): { state: Record<string, number | boolean>; entities: Array<{ name: string; position: P3; rotation: { x: number; y: number; z: number; w: number } }> };
      readPixels(): Promise<{ data: Uint8Array; width: number; height: number }>;
    };
    dispose(): void;
  }
  const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
  const diagnostics: Array<{ code: string; severity: string; message: string; span?: unknown }> = [];
  let context: Ctx | undefined;
  const app = await w.__mtekMount({
    test: { manualClock: true, renderTarget: args.target },
    onDiagnostic: (d: { code: string; severity: string; message: string; span?: unknown }) => diagnostics.push({ code: d.code, severity: d.severity, message: d.message, span: d.span }),
    extensions: [{ id: "animation-reader", apiVersion: 1, setup(c: Ctx) { context = c; } }],
  });
  const ids: Record<string, string> = {};
  for (const transform of context?.readTransforms() ?? []) if (["Model", "Ghost", "Guest"].includes(transform.name)) ids[transform.name] = transform.id;
  const players = { model: context?.animation(ids["Model"] ?? ""), ghost: context?.animation(ids["Ghost"] ?? ""), guest: context?.animation(ids["Guest"] ?? "") };
  const pose = (e: { position: P3; rotation: { x: number; y: number; z: number; w: number } } | undefined): Pose => ({
    position: { x: e?.position.x ?? Number.NaN, y: e?.position.y ?? Number.NaN, z: e?.position.z ?? Number.NaN },
    rotation: { x: e?.rotation.x ?? Number.NaN, y: e?.rotation.y ?? Number.NaN, z: e?.rotation.z ?? Number.NaN, w: e?.rotation.w ?? Number.NaN },
  });
  const read = (player: Player | undefined, want: readonly string[] | "all"): FigureRead => {
    const empty: FigureRead = { nodes: {}, blend: null, layers: [], limbs: [], footPlacement: null, ik: [], mode: "", rootMotionNode: null };
    if (player === undefined || player.inspect === undefined) return empty;
    player.evaluate();
    const seen = player.inspect();
    const nodes: Record<string, V3> = {};
    for (const node of seen.nodes) if (want === "all" || want.includes(node.name)) nodes[node.name] = [node.position.x, node.position.y, node.position.z];
    return {
      nodes,
      blend: seen.blend === null ? null : { phase: seen.blend.phase, parameter: { ...seen.blend.parameter }, samples: seen.blend.samples.map((s) => ({ ...s })) },
      layers: seen.layers.map((l) => ({ id: l.id, clip: l.clip, weight: l.weight, targetWeight: l.targetWeight, fadeRemaining: l.fadeRemaining, time: l.time })),
      limbs: (seen.limbs ?? []).map((l) => ({ id: l.id, limb: l.limb, target: { ...l.target }, weight: l.weight, flexion: l.flexion, residual: l.residual })),
      footPlacement: seen.footPlacement === undefined || seen.footPlacement === null ? null : { requiredDrop: seen.footPlacement.requiredDrop, drop: seen.footPlacement.drop, left: { ...seen.footPlacement.left }, right: { ...seen.footPlacement.right } },
      ik: seen.ik.map((c) => ({ id: c.id, chain: [...c.chain], target: { ...c.target } })),
      mode: seen.mode,
      rootMotionNode: seen.rootMotionNode,
    };
  };
  const nodeNames = (player: Player | undefined): string[] => player?.inspect?.().nodes.map((n) => n.name) ?? [];
  type V3 = readonly [number, number, number];
  const names = { model: nodeNames(players.model), ghost: nodeNames(players.ghost), guest: nodeNames(players.guest) };
  const snapshot = (frame: number, time: number): Sample => {
    const scene = app.debug.scene();
    const find = (name: string) => scene.entities.find((e) => e.name === name);
    return {
      frame,
      time,
      ticks: app.debug.counters()["physicsSteps"] ?? Number.NaN,
      hero: pose(find("Hero")),
      orb: pose(find("Orb")),
      state: { ...scene.state },
      model: read(players.model, args.nodes.model),
      ghost: read(players.ghost, args.nodes.ghost),
      guest: read(players.guest, args.nodes.guest),
    };
  };
  const samples: Sample[] = [];
  let index = 0;
  let time = 0;
  for (const frame of args.frames) {
    for (const key of frame.press) app.debug.pressKey(key);
    for (const key of frame.release) app.debug.releaseKey(key);
    app.debug.step(1, frame.dt);
    index += 1;
    time += frame.dt;
    if (args.sample === "every" || frame.boundary) samples.push(snapshot(index, time));
  }
  const counters = { ...app.debug.counters() };
  const stateAfter = app.state;
  let pixels: DriveResult["pixels"];
  let palettes: DriveResult["palettes"];
  if (args.final !== undefined) {
    if (args.final.pixels) {
      const image = await app.debug.readPixels();
      pixels = { width: image.width, height: image.height, data: Array.from(image.data) };
    }
    palettes = {};
    for (const which of args.final.palettes) {
      const player = players[which];
      player?.evaluate();
      palettes[which] = player === undefined ? [] : Array.from(player.palette);
    }
  }
  app.dispose();
  const disposed = { ...app.debug.counters() };
  return { samples, diagnostics, stateAfter, counters, disposed, ids, names, ...(pixels === undefined ? {} : { pixels }), ...(palettes === undefined ? {} : { palettes }) };
}
