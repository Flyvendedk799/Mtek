/**
 * The animation composition commands of Mtek programs (decision 0223, `spec/animation.md` section 4): layers, blend
 * spaces, limb, foot and chain goals and root motion, as `animation.*` calls reach them through `ctx`.
 *
 * Each command resolves the entity's `SkeletonPlayer`, validates names, and calls the host API of decisions 0220 to
 * 0222. Goals arrive in world space and are carried into the skeletal mesh local space the solvers use with the inverse
 * of the entity's world matrix. A command never throws: it returns false and, for a name the entity lacks (`E8111`), a
 * rig that is no humanoid (`E8112`) or an argument the animation system refuses (`E8113`), reports once per entity and
 * name. State lives with the `SkeletonPlayer`, so entities that share a pose cohort share it, and a destroyed entity or
 * a reloaded world takes it along.
 */
import type { MtekSkin } from "../abi/manifest-types.js";
import type { Mat4, Vec3 } from "../math/types.js";
import type { BlendSample } from "./blend-space.js";
import { mapHumanoid } from "./humanoid.js";
import type { LimbName } from "./limb-ik.js";
import type { SkeletonPlayer } from "./skeleton.js";

export type ScriptCode = "E8110" | "E8111" | "E8112" | "E8113";

/** What the commands need from the world. */
export interface ScriptHost {
  /** The player of the entity in `slot`, if it has a skeletal mesh. */
  player(slot: number): SkeletonPlayer | undefined;
  /** The world matrix of the entity in `slot`, with pending transforms propagated. */
  world(slot: number): Mat4 | undefined;
  /** Reports a run-time diagnostic located at the call `spanId` of the program (`-1` when unknown). */
  report(code: ScriptCode, slot: number, spanId: number, message: string): void;
}

/** The limb names of the language and the host API. */
const LIMBS: Readonly<Record<string, LimbName>> = { left_leg: "leftLeg", right_leg: "rightLeg", left_arm: "leftArm", right_arm: "rightArm" };

/** The most samples one blend space holds (decision 0220). */
const MAX_BLEND_SAMPLES = 32;

interface State {
  /** The blend space being defined: `blend_sample` appends, `blend_play` consumes. */
  pending: BlendSample[];
  /** Parameter given before `blend_play`; the first sample otherwise. */
  parameter: { x: number; y: number } | undefined;
  /** `unknown` until the first limb or foot command; `rejected` once `mapHumanoid` refused the skeleton. */
  humanoid: "unknown" | "mapped" | "rejected";
  /** Limb goals the program set, by language name. */
  limbs: Set<string>;
  foot: boolean;
  /** Chain goals the program set, by id. */
  chains: Set<string>;
  /** Diagnostics already reported: `code:name`. */
  reported: Set<string>;
}

const vec3 = (value: unknown): Vec3 | undefined => {
  const v = value as Partial<Vec3> | null;
  return typeof v === "object" && v !== null && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? (v as Vec3) : undefined;
};

/** The affine map between world space and the skeletal mesh local space of one entity. */
class Frame {
  /** The inverse of the linear part, row-major. */
  private readonly inverse = new Float64Array(9);
  private readonly linear = new Float64Array(9);
  private readonly origin: Vec3;
  readonly valid: boolean;

  constructor(world: Mat4) {
    // Column-major: element (row r, column c) is at c * 4 + r.
    const m = (r: number, c: number): number => world[c * 4 + r]!;
    this.origin = { x: m(0, 3), y: m(1, 3), z: m(2, 3) };
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.linear[r * 3 + c] = m(r, c);
    const L = this.linear;
    const cofactor = (r0: number, c0: number): number => {
      const [r1, r2] = [(r0 + 1) % 3, (r0 + 2) % 3], [c1, c2] = [(c0 + 1) % 3, (c0 + 2) % 3];
      return L[r1 * 3 + c1]! * L[r2 * 3 + c2]! - L[r1 * 3 + c2]! * L[r2 * 3 + c1]!;
    };
    const determinant = L[0]! * cofactor(0, 0) + L[1]! * cofactor(0, 1) + L[2]! * cofactor(0, 2);
    this.valid = Number.isFinite(determinant) && Math.abs(determinant) > 1e-12;
    if (this.valid) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.inverse[r * 3 + c] = cofactor(c, r) / determinant;
  }

  /** A world position in mesh-local space. */
  position(p: Vec3): [number, number, number] {
    const d = [p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z], I = this.inverse;
    return [0, 1, 2].map((r) => I[r * 3]! * d[0]! + I[r * 3 + 1]! * d[1]! + I[r * 3 + 2]! * d[2]!) as [number, number, number];
  }

  /** A world surface normal in mesh-local space (the transpose of the linear part), normalised; undefined for a zero normal. */
  normal(n: Vec3): [number, number, number] | undefined {
    const L = this.linear;
    const v = [0, 1, 2].map((c) => L[c]! * n.x + L[3 + c]! * n.y + L[6 + c]! * n.z);
    const length = Math.hypot(v[0]!, v[1]!, v[2]!);
    return length > 1e-12 && Number.isFinite(length) ? [v[0]! / length, v[1]! / length, v[2]! / length] : undefined;
  }

  /** A mesh-local displacement in world space (rotation and scale of the entity, no translation). */
  displacement(v: Vec3): Vec3 {
    const L = this.linear;
    return { x: L[0]! * v.x + L[1]! * v.y + L[2]! * v.z, y: L[3]! * v.x + L[4]! * v.y + L[5]! * v.z, z: L[6]! * v.x + L[7]! * v.y + L[8]! * v.z };
  }
}

export class AnimationScript {
  private readonly states = new WeakMap<SkeletonPlayer, State>();

  constructor(private readonly host: ScriptHost) {}

  private state(player: SkeletonPlayer): State {
    let state = this.states.get(player);
    if (state === undefined) {
      state = { pending: [], parameter: undefined, humanoid: "unknown", limbs: new Set(), foot: false, chains: new Set(), reported: new Set() };
      this.states.set(player, state);
    }
    return state;
  }

  /** Reports `code` once per entity and `key`; returns false for the caller to return. */
  private fail(player: SkeletonPlayer, slot: number, spanId: number, code: ScriptCode, key: string, message: string): false {
    const state = this.state(player);
    const id = `${code}:${key}`;
    if (!state.reported.has(id)) {
      state.reported.add(id);
      this.host.report(code, slot, spanId, message);
    }
    return false;
  }

  /** Runs a mutation of the host API; a refusal (`RangeError`) is `E8113`, once per reason. */
  private guarded(player: SkeletonPlayer, slot: number, spanId: number, what: string, run: () => void): boolean {
    try {
      run();
      return true;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return this.fail(player, slot, spanId, "E8113", error.message, `${what} was dropped: ${error.message}.`);
    }
  }

  private hasClip(skin: MtekSkin, name: string): boolean {
    return skin.clips.some((clip) => clip.name === name);
  }
  private hasJoint(skin: MtekSkin, name: string): boolean {
    return skin.nodes.some((node) => node.name === name);
  }
  private unknown(player: SkeletonPlayer, slot: number, spanId: number, kind: string, name: string, what: string): false {
    return this.fail(player, slot, spanId, "E8111", `${kind}:${name}`, `${what} was dropped: the entity has no ${kind} '${name}'.`);
  }

  /** Maps the skeleton once; false (with `E8112`, once) when it is no humanoid. */
  private ensureHumanoid(player: SkeletonPlayer, slot: number, spanId: number, what: string): boolean {
    const state = this.state(player);
    if (state.humanoid === "mapped") return true;
    if (state.humanoid === "unknown") {
      const map = mapHumanoid(player.skin);
      if ("error" in map) {
        state.humanoid = "rejected";
        this.fail(player, slot, spanId, "E8112", "humanoid", `${what} was dropped: the skeleton is not a humanoid (${map.error}).`);
        return false;
      }
      try {
        player.setHumanoid(map);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        state.humanoid = "rejected";
        this.fail(player, slot, spanId, "E8112", "humanoid", `${what} was dropped: the skeleton cannot be used as a humanoid (${error.message}).`);
        return false;
      }
      state.humanoid = "mapped";
      return true;
    }
    return false;
  }

  private frame(slot: number): Frame | undefined {
    const world = this.host.world(slot);
    const frame = world === undefined ? undefined : new Frame(world);
    return frame?.valid === true ? frame : undefined;
  }

  // ---- layers ----

  setLayer(slot: number, id: string, clip: string, weight: number, additive: boolean, mask: string, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !Number.isFinite(weight)) return false;
    const what = `animation.set_layer('${id}')`;
    if (!this.hasClip(player.skin, clip)) return this.unknown(player, slot, spanId, "clip", clip, what);
    if (mask !== "" && !this.hasJoint(player.skin, mask)) return this.unknown(player, slot, spanId, "joint", mask, what);
    return this.guarded(player, slot, spanId, what, () => {
      player.layers.set(id, { clip, weight: Math.max(0, Math.min(1, weight)), additive, ...(mask === "" ? {} : { subtree: mask }) });
    });
  }

  fadeLayer(slot: number, id: string, weight: number, seconds: number, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !Number.isFinite(weight) || !Number.isFinite(seconds) || seconds < 0) return false;
    const applied = player.layers.fade(id, Math.max(0, Math.min(1, weight)), seconds);
    return applied || this.unknown(player, slot, spanId, "layer", id, `animation.fade_layer('${id}')`);
  }

  removeLayer(slot: number, id: string): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !player.layers.inspect().some((layer) => layer.id === id)) return false;
    player.layers.remove(id);
    return true;
  }

  // ---- blend spaces ----

  blendSample(slot: number, clip: string, x: number, y: number, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const what = `animation.blend_sample('${clip}')`;
    if (!this.hasClip(player.skin, clip)) return this.unknown(player, slot, spanId, "clip", clip, what);
    const state = this.state(player);
    if (state.pending.length >= MAX_BLEND_SAMPLES) {
      return this.fail(player, slot, spanId, "E8113", "blend-size", `${what} was dropped: a blend space holds at most ${String(MAX_BLEND_SAMPLES)} samples.`);
    }
    state.pending.push({ clip, x, y });
    return true;
  }

  blendPlay(slot: number, looping: boolean, speed: number, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !Number.isFinite(speed) || speed < 0) return false;
    const state = this.state(player);
    const samples = state.pending, parameter = state.parameter;
    state.pending = [];
    state.parameter = undefined;
    if (samples.length === 0) return this.fail(player, slot, spanId, "E8111", "blend:pending", "animation.blend_play was dropped: no blend_sample came before it.");
    return this.guarded(player, slot, spanId, "animation.blend_play", () => {
      player.blend.set({ samples, looping, speed, ...(parameter === undefined ? {} : { parameter }) });
    });
  }

  blendParameter(slot: number, x: number, y: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const state = this.state(player);
    if (state.pending.length > 0) state.parameter = { x, y };
    if (player.blend.active) player.blend.setParameter(x, y);
    return player.blend.active || state.pending.length > 0;
  }

  blendClear(slot: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined) return false;
    const state = this.state(player);
    const had = player.blend.active || state.pending.length > 0;
    state.pending = [];
    state.parameter = undefined;
    if (player.blend.active) player.blend.set(undefined);
    return had;
  }

  blendPhase(slot: number): number {
    const player = this.host.player(slot);
    return player?.blend.active === true ? Math.fround(player.blend.phase) : 0;
  }

  // ---- limbs, feet and chains ----

  limbGoal(slot: number, limb: string, goal: unknown, weight: number, spanId: number): boolean {
    const player = this.host.player(slot);
    const target = vec3(goal);
    if (player === undefined || target === undefined || !Number.isFinite(weight)) return false;
    const what = `animation.limb_goal('${limb}')`;
    const name = LIMBS[limb];
    if (name === undefined) return this.unknown(player, slot, spanId, "limb", limb, what);
    if (!this.ensureHumanoid(player, slot, spanId, what)) return false;
    const frame = this.frame(slot);
    if (frame === undefined) return false;
    const applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.setLimb(`limb:${limb}`, { limb: name, target: frame.position(target), weight: Math.max(0, Math.min(1, weight)) });
    });
    if (applied) this.state(player).limbs.add(limb);
    return applied;
  }

  clearLimb(slot: number, limb: string, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined) return false;
    if (LIMBS[limb] === undefined) return this.unknown(player, slot, spanId, "limb", limb, `animation.clear_limb('${limb}')`);
    const state = this.state(player);
    if (!state.limbs.delete(limb)) return false;
    player.ik.remove(`limb:${limb}`);
    return true;
  }

  footPlacement(slot: number, left: unknown, right: unknown, leftNormal: unknown, rightNormal: unknown, leftWeight: number, rightWeight: number, spanId: number): boolean {
    const player = this.host.player(slot);
    const [l, r, ln, rn] = [vec3(left), vec3(right), vec3(leftNormal), vec3(rightNormal)];
    if (player === undefined || l === undefined || r === undefined || ln === undefined || rn === undefined || !Number.isFinite(leftWeight) || !Number.isFinite(rightWeight)) return false;
    const what = "animation.foot_placement";
    if (!this.ensureHumanoid(player, slot, spanId, what)) return false;
    const frame = this.frame(slot);
    if (frame === undefined) return false;
    const ground = (point: Vec3, normal: Vec3, weight: number) => {
      const local = frame.normal(normal);
      return { point: frame.position(point), weight: Math.max(0, Math.min(1, weight)), ...(local === undefined ? {} : { normal: local }) };
    };
    const applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.setFootPlacement({ left: ground(l, ln, leftWeight), right: ground(r, rn, rightWeight) });
    });
    if (applied) this.state(player).foot = true;
    return applied;
  }

  clearFootPlacement(slot: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined) return false;
    const state = this.state(player);
    if (!state.foot) return false;
    state.foot = false;
    player.ik.setFootPlacement(undefined);
    return true;
  }

  chainGoal(slot: number, id: string, endJoint: string, length: number, goal: unknown, weight: number, spanId: number): boolean {
    const player = this.host.player(slot);
    const target = vec3(goal);
    if (player === undefined || target === undefined || !Number.isFinite(weight) || !Number.isInteger(length)) return false;
    const what = `animation.chain_goal('${id}')`;
    const end = player.skin.nodes.findIndex((node) => node.name === endJoint);
    if (end < 0) return this.unknown(player, slot, spanId, "joint", endJoint, what);
    const chain: string[] = [];
    for (let node = end; node >= 0 && chain.length < length; node = player.skin.nodes[node]!.parent) chain.unshift(player.skin.nodes[node]!.name);
    if (length < 2 || chain.length < length) {
      return this.fail(player, slot, spanId, "E8113", `chain:${id}:${String(length)}`, `${what} was dropped: '${endJoint}' and ${String(length - 1)} ancestors do not form a chain of ${String(length)} joints.`);
    }
    const frame = this.frame(slot);
    if (frame === undefined) return false;
    const applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.set(id, { chain, target: frame.position(target), weight: Math.max(0, Math.min(1, weight)) });
    });
    if (applied) this.state(player).chains.add(id);
    return applied;
  }

  clearChain(slot: number, id: string): boolean {
    const player = this.host.player(slot);
    if (player === undefined || !this.state(player).chains.delete(id)) return false;
    player.ik.remove(id);
    return true;
  }

  // ---- root motion ----

  rootMotion(slot: number, joint: string, spanId: number): boolean {
    const player = this.host.player(slot);
    if (player === undefined) return false;
    if (joint === "") {
      player.setRootMotion(undefined);
      return true;
    }
    if (!this.hasJoint(player.skin, joint)) return this.unknown(player, slot, spanId, "joint", joint, `animation.root_motion('${joint}')`);
    player.setRootMotion(joint);
    return true;
  }

  /** The root displacement accumulated since the last call, in world space; consumed. Zero without root ownership. */
  takeRootMotion(slot: number): Vec3 {
    const zero = { x: 0, y: 0, z: 0 };
    const player = this.host.player(slot);
    if (player === undefined) return zero;
    const local = player.consumeRootMotionLocal();
    const world = this.host.world(slot);
    if (world === undefined) return zero;
    const d = new Frame(world).displacement(local);
    return { x: Math.fround(d.x), y: Math.fround(d.y), z: Math.fround(d.z) };
  }
}
