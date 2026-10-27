// The composition commands of Mtek programs (decision 0223, spec/animation.md section 4), driven through the context
// of a mounted `World` exactly as generated code calls them: masked layers and their fades, blend spaces, limb, foot and
// chain goals in world space with a rotated and scaled entity, root motion in world space, `clips_from`, the diagnostics
// E8110 to E8113, and what a hot reload keeps. Skeletons: generated humanoids (Mixamo, Unreal naming) and the committed
// CesiumMan and Fox; the character-composition Source and LongLegs run when the example models are present.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAnimationBackend } from "../animation-module/entry.js";
import { checkManifest } from "../abi/validate.js";
import type { MtekManifest, MtekSkin } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { migrateWorld } from "../host/reload.js";
import { fromRotationTranslationScale } from "../math/mat4.js";
import type { Vec3 } from "../math/types.js";
import { minimalManifestJson } from "../test-support/fake-host.js";
import { glbSkin } from "../test-support/glb-skin-file.js";
import { buildHumanoid, expectedBones, loadRealSkins, withClips } from "../test-support/humanoid-fixtures.js";
import { humanoidRig } from "../test-support/limb-rigs.js";
import { mapHumanoid, type HumanoidMap } from "./humanoid.js";
import { retargetHumanoid } from "./humanoid-retarget.js";
import { SkeletonPlayer } from "./skeleton.js";
import { resolveStructure } from "./structure.js";
import { DEAD_REF } from "./slots.js";
import { World, type EntityRecord } from "./world.js";

type V = [number, number, number];
type Quat = [number, number, number, number];
const repo = path.resolve("../..");

// ---- a world with skeletal entities -------------------------------------------------------------------------------

interface Spec {
  readonly skin: MtekSkin;
  /** `clips_from` skeleton, and the `clip` the entity starts with. */
  readonly from?: MtekSkin;
  readonly clip?: string;
  readonly position?: V;
  readonly rotation?: Quat;
  readonly scale?: V;
}

interface Ctx {
  setTransform(entity: unknown, field: string, value: unknown): void;
  [command: string]: (...args: never[]) => unknown;
}

function skeletalWorld(...specs: readonly Spec[]): { world: World; ctx: Record<string, (...args: unknown[]) => unknown>; reported: MtekDiagnostic[]; refs: unknown[]; manifest: MtekManifest } {
  const json = minimalManifestJson();
  const scene = json["scene"] as { entities: Record<string, unknown>[]; materialInstances: Record<string, unknown>[] };
  const first = scene.entities[0]!, instance = scene.materialInstances[0]!;
  scene.entities = specs.map((_, i) => ({ ...first, index: i, name: i === 0 ? first.name : `Actor${String(i)}`, symbol: i === 0 ? first.symbol : `src/main.mtek::Demo.Actor${String(i)}`, material: { id: "std/materials.mtek::Unlit", instance: i } }));
  scene.materialInstances = specs.map((_, i) => ({ ...instance, index: i, entity: i }));
  const checked = checkManifest(json);
  if (!checked.ok) throw new Error(JSON.stringify(checked.failures));
  const manifest = checked.manifest;
  const resolved = resolveStructure(manifest);
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
  const entities = resolved.structure.entities.map((entity, i) => {
    const spec = specs[i]!;
    const mesh = { id: `mesh:skin${String(i)}`, descriptor: { kind: "asset", asset: "assets/x.bin", primitive: 0, layout: {}, skin: spec.skin } } as unknown as NonNullable<typeof entity.mesh>;
    return { ...entity, mesh, ...(spec.from === undefined ? {} : { clipsFrom: spec.from }), ...(spec.clip === undefined ? {} : { clip: { name: spec.clip, duration: 1, channels: [] } }) };
  });
  const reported: MtekDiagnostic[] = [];
  const world = new World({ manifest, structure: { ...resolved.structure, entities }, params: { writeParam: () => undefined }, report: (d) => reported.push(d), animation: createAnimationBackend() });
  const ctx = world.ctx as unknown as Ctx;
  specs.forEach((spec, i) => {
    const entity = world.entities[i];
    ctx.setTransform(entity, "position", { x: (spec.position ?? [0, 0, 0])[0], y: (spec.position ?? [0, 0, 0])[1], z: (spec.position ?? [0, 0, 0])[2] });
    const q = spec.rotation ?? [0, 0, 0, 1];
    ctx.setTransform(entity, "rotation", { x: q[0], y: q[1], z: q[2], w: q[3] });
    const s = spec.scale ?? [1, 1, 1];
    ctx.setTransform(entity, "scale", { x: s[0], y: s[1], z: s[2] });
  });
  world.propagate();
  return { world, ctx: world.ctx as unknown as Record<string, (...args: unknown[]) => unknown>, reported, refs: world.entities.map((e: EntityRecord) => e.ref), manifest };
}

const v3 = (v: V): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
const player = (world: World, slot = 0): SkeletonPlayer => world.skinPlayer(slot)!;
const pos = (p: { x: number; y: number; z: number }): V => [p.x, p.y, p.z];
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const codes = (reported: readonly MtekDiagnostic[]): string[] => reported.map((d) => d.code.replace(/^MTEK-/, ""));

// An independent world <-> mesh-local conversion for `T R S`: p = R S l + t, so l = S^-1 R^-1 (p - t).
function qrotate(q: Quat, v: V): V {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const toLocal = (spec: { position?: V; rotation?: Quat; scale?: V }, p: V): V => {
  const t = spec.position ?? [0, 0, 0], s = spec.scale ?? [1, 1, 1];
  const r = qrotate(conj(spec.rotation ?? [0, 0, 0, 1]), [p[0] - t[0], p[1] - t[1], p[2] - t[2]]);
  return [r[0] / s[0], r[1] / s[1], r[2] / s[2]];
};
const toWorld = (spec: { position?: V; rotation?: Quat; scale?: V }, l: V): V => {
  const t = spec.position ?? [0, 0, 0], s = spec.scale ?? [1, 1, 1];
  const r = qrotate(spec.rotation ?? [0, 0, 0, 1], [l[0] * s[0], l[1] * s[1], l[2] * s[2]]);
  return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
};
const unitQ = (axis: V, angle: number): Quat => {
  const n = Math.hypot(...axis), s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

// A rotated, scaled and translated placement (a turn about Y and a tilt, uniform scale 1.5), and a non-uniform one.
const PLACED = { position: [3, 0.5, -2] as V, rotation: mul(unitQ([0, 1, 0], 1.1), unitQ([1, 0, 0], 0.35)), scale: [1.5, 1.5, 1.5] as V };
const STRETCHED = { position: [-1, 2, 0.5] as V, rotation: unitQ([0, 0, 1], -0.6), scale: [1, 1.4, 2] as V };

function humanoid(convention: "mixamo" | "unreal", clips: readonly ("walk" | "wave")[] = ["walk", "wave"], extra: { legs?: number; arms?: number } = {}): { skin: MtekSkin; bones: Record<string, string> } {
  const rig = withClips(buildHumanoid({ convention, ...extra }), clips);
  return { skin: rig.skin, bones: expectedBones(rig) };
}

// ---- the matrix of the entity is the one the conversion inverts -------------------------------------------------------

describe("world to mesh-local conversion", () => {
  it("agrees with an independent T R S inverse", () => {
    for (const spec of [PLACED, STRETCHED]) {
      const m = fromRotationTranslationScale({ x: spec.rotation[0], y: spec.rotation[1], z: spec.rotation[2], w: spec.rotation[3] }, v3(spec.position), v3(spec.scale));
      const local: V = [0.3, -0.7, 1.2], world = toWorld(spec, local);
      expect(world[0]).toBeCloseTo(m[0]! * local[0] + m[4]! * local[1] + m[8]! * local[2] + m[12]!, 5);
      expect(toLocal(spec, world).map((v, i) => v - local[i]!).every((d) => Math.abs(d) < 1e-9)).toBe(true);
    }
  });
});

// ---- layers --------------------------------------------------------------------------------------------------------

describe("animation.set_layer, fade_layer and remove_layer", () => {
  const { skin, bones } = humanoid("mixamo");

  it("moves only the subtree of the mask joint, and the whole rig for an empty mask", () => {
    const a = skeletalWorld({ skin, clip: "walk" }), b = skeletalWorld({ skin, clip: "walk" }), c = skeletalWorld({ skin, clip: "walk" });
    const arm = bones["rightHand"]!, leg = bones["leftLowerLeg"]!, spine = bones["chest"]!;
    expect(a.ctx["animationSetLayer"]!(a.refs[0], "wave", "wave", 1, false, spine, 0)).toBe(true);
    expect(c.ctx["animationSetLayer"]!(c.refs[0], "wave", "wave", 1, false, "", 0)).toBe(true);
    for (const w of [a, b, c]) w.world.advanceClips(0.5);
    // Mask: exactly the chest and its descendants have weight one.
    const mask = player(a.world).layers.inspect()[0]!.mask;
    skin.nodes.forEach((node, i) => {
      let inside = false;
      for (let n = i; n >= 0; n = skin.nodes[n]!.parent) if (skin.nodes[n]!.name === spine) inside = true;
      expect(mask[i], node.name).toBe(inside ? 1 : 0);
    });
    // Pose: the arm follows the wave, the leg stays on the walk; the unmasked layer moves the leg as well.
    const at = (w: { world: World }, bone: string): V => pos(player(w.world).jointPosition(bone));
    expect(dist(at(a, arm), at(b, arm))).toBeGreaterThan(0.05);
    expect(dist(at(a, leg), at(b, leg))).toBeLessThan(1e-9);
    expect(dist(at(c, leg), at(b, leg))).toBeGreaterThan(0.01);
    expect(codes(a.reported)).toEqual([]);
  });

  it("is additive on request, keeps the phase of the same clip and clamps the weight", () => {
    const w = skeletalWorld({ skin, clip: "walk" });
    expect(w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", 7, true, "", 0)).toBe(true);
    const layer = (): { weight: number; additive: boolean; time: number } => player(w.world).layers.inspect()[0]!;
    expect(layer()).toMatchObject({ weight: 1, additive: true });
    w.world.advanceClips(0.4);
    const time = layer().time;
    expect(time).toBeCloseTo(0.4, 6);
    w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", 0.25, true, "", 0);
    expect(layer()).toMatchObject({ weight: 0.25, time });
    expect(w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", Number.NaN, true, "", 0)).toBe(false);
  });

  it("fades smoothly, continuously and without losing the phase, and removes layers", () => {
    const w = skeletalWorld({ skin, clip: "walk" });
    w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", 0, false, "", 0);
    expect(w.ctx["animationFadeLayer"]!(w.refs[0], "l", 1, 1, 0)).toBe(true);
    const layer = (): { weight: number; time: number; targetWeight: number } => player(w.world).layers.inspect()[0]!;
    w.world.advanceClips(0.5);
    expect(layer().weight).toBeCloseTo(0.5, 9); // smoothstep(0.5)
    expect(layer().targetWeight).toBe(1);
    // A new fade starts where the layer is and keeps its clock.
    w.ctx["animationFadeLayer"]!(w.refs[0], "l", 0, 0.5, 0);
    w.world.advanceClips(0.25);
    expect(layer().weight).toBeCloseTo(0.25, 9);
    expect(layer().time).toBeCloseTo(0.75, 6);
    w.world.advanceClips(5);
    expect(layer().weight).toBe(0);
    expect(player(w.world).layers.inspect()).toHaveLength(1); // a layer faded to zero stays
    expect(w.ctx["animationRemoveLayer"]!(w.refs[0], "l")).toBe(true);
    expect(player(w.world).layers.inspect()).toHaveLength(0);
    expect(w.ctx["animationRemoveLayer"]!(w.refs[0], "l")).toBe(false);
    expect(codes(w.reported)).toEqual([]);
  });

  it("reports E8111 once per entity and name for an unknown clip, joint or layer and drops the call", () => {
    const w = skeletalWorld({ skin, clip: "walk" });
    for (let i = 0; i < 3; i++) expect(w.ctx["animationSetLayer"]!(w.refs[0], "l", "nope", 1, false, "", 0)).toBe(false);
    expect(w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", 1, false, "NoSuchJoint", 0)).toBe(false);
    expect(w.ctx["animationFadeLayer"]!(w.refs[0], "ghost", 1, 1, 0)).toBe(false);
    expect(w.ctx["animationFadeLayer"]!(w.refs[0], "ghost", 1, 1, 0)).toBe(false);
    expect(player(w.world).layers.inspect()).toHaveLength(0);
    expect(codes(w.reported)).toEqual(["E8111", "E8111", "E8111"]);
    expect(w.reported[0]!.message).toContain("'nope'");
    expect(w.reported[0]!.source).not.toBeNull();
    // Another entity reports for itself.
    const two = skeletalWorld({ skin }, { skin });
    two.ctx["animationSetLayer"]!(two.refs[0], "l", "nope", 1, false, "", 0);
    two.ctx["animationSetLayer"]!(two.refs[1], "l", "nope", 1, false, "", 0);
    expect(codes(two.reported)).toEqual(["E8111", "E8111"]);
  });

  it("returns false without a diagnostic for a dead reference", () => {
    const w = skeletalWorld({ skin });
    expect(w.ctx["animationSetLayer"]!(DEAD_REF, "l", "wave", 1, false, "", 0)).toBe(false);
    expect(w.ctx["animationFadeLayer"]!(DEAD_REF, "l", 1, 1, 0)).toBe(false);
    expect(w.ctx["animationRemoveLayer"]!(DEAD_REF, "l")).toBe(false);
    expect(w.reported).toEqual([]);
  });
});

// ---- blend spaces --------------------------------------------------------------------------------------------------

describe("animation.blend_*", () => {
  const { skin, bones } = humanoid("mixamo");
  const duplicate: MtekSkin = { ...skin, clips: [...skin.clips, { ...skin.clips[0]!, name: "walk2", duration: 2 }] };
  const hand = (p: SkeletonPlayer): V => pos(p.jointPosition(bones["rightHand"]!));

  it("accumulates samples and plays them as the base pose with weights that follow the parameter", () => {
    const w = skeletalWorld({ skin: duplicate, clip: "walk" });
    const r = w.refs[0], c = w.ctx;
    expect(c["animationBlendSample"]!(r, "walk", 0, 0, 0)).toBe(true);
    expect(c["animationBlendSample"]!(r, "wave", 1, 0, 0)).toBe(true);
    expect(c["animationBlendSample"]!(r, "walk2", 0, 1, 0)).toBe(true);
    expect(player(w.world).blend.active).toBe(false); // nothing plays before blend_play
    expect(c["animationBlendParameter"]!(r, 0.25, 0.5)).toBe(true); // before play: the initial parameter
    expect(c["animationBlendPlay"]!(r, true, 1, 0)).toBe(true);
    const inspected = player(w.world).inspect().blend!;
    expect(inspected.parameter).toEqual({ x: 0.25, y: 0.5 });
    expect(inspected.samples.map((s) => s.weight).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(inspected.samples.map((s) => s.weight)).toEqual([expect.closeTo(0.25, 9), expect.closeTo(0.25, 9), expect.closeTo(0.5, 9)]);
    w.world.advanceClips(0.1);
    const phase = c["animationBlendPhase"]!(r) as number;
    expect(phase).toBeGreaterThan(0);
    // Moving the parameter changes the weights and never the phase.
    expect(c["animationBlendParameter"]!(r, 1, 0)).toBe(true);
    expect(c["animationBlendPhase"]!(r)).toBe(phase);
    expect(player(w.world).inspect().blend!.samples.map((s) => s.weight)).toEqual([0, 1, 0]);
    // Exact at a sample: the pose is the pure clip's at the shared phase.
    w.world.advanceClips(0.2);
    const reference = new SkeletonPlayer(duplicate);
    reference.blend.set({ samples: [{ clip: "wave", x: 0, y: 0 }] });
    reference.blend.seek(c["animationBlendPhase"]!(r) as number);
    reference.evaluate();
    expect(dist(hand(player(w.world)), hand(reference))).toBeLessThan(1e-6);
    expect(dist(hand(player(w.world)), hand(new SkeletonPlayer(duplicate, "walk")))).toBeGreaterThan(1e-3);
    expect(codes(w.reported)).toEqual([]);
  });

  it("consumes the pending definition on play, clears everything on blend_clear and reads zero without a blend", () => {
    const w = skeletalWorld({ skin, clip: "walk" });
    const r = w.refs[0], c = w.ctx;
    expect(c["animationBlendPhase"]!(r)).toBe(0);
    c["animationBlendSample"]!(r, "walk", 0, 0, 0);
    expect(c["animationBlendPlay"]!(r, false, 2, 0)).toBe(true);
    expect(c["animationBlendPlay"]!(r, true, 1, 0)).toBe(false); // nothing pending any more
    expect(codes(w.reported)).toEqual(["E8111"]);
    expect(player(w.world).blend.active).toBe(true);
    expect(c["animationBlendClear"]!(r)).toBe(true);
    expect(player(w.world).blend.active).toBe(false);
    expect(c["animationBlendClear"]!(r)).toBe(false);
    c["animationBlendSample"]!(r, "walk", 0, 0, 0);
    expect(c["animationBlendClear"]!(r)).toBe(true); // drops the pending samples
    expect(c["animationBlendPlay"]!(r, true, 1, 0)).toBe(false);
  });

  it("rejects an invalid blend space with E8113 and an unknown clip with E8111", () => {
    const w = skeletalWorld({ skin, clip: "walk" });
    const r = w.refs[0], c = w.ctx;
    expect(c["animationBlendSample"]!(r, "nope", 0, 0, 0)).toBe(false);
    expect(c["animationBlendSample"]!(r, "walk", Number.NaN, 0, 0)).toBe(false);
    c["animationBlendSample"]!(r, "walk", 0, 0, 0);
    c["animationBlendSample"]!(r, "wave", 0, 0, 0); // the same point
    expect(c["animationBlendPlay"]!(r, true, 1, 0)).toBe(false);
    expect(codes(w.reported)).toEqual(["E8111", "E8113"]);
    expect(w.reported[1]!.message).toContain("distinct points");
    expect(player(w.world).blend.active).toBe(false);
    for (let i = 0; i < 33; i++) c["animationBlendSample"]!(r, "walk", i, 0, 0);
    expect(codes(w.reported)).toEqual(["E8111", "E8113", "E8113"]);
    expect(c["animationBlendPlay"]!(r, true, -1, 0)).toBe(false);
  });
});

// ---- limbs, feet and chains in world space -------------------------------------------------------------------------

/** A standalone player with the same map, to compare against the world's lazily mapped one. */
function twin(skin: MtekSkin, clip: string | undefined): { player: SkeletonPlayer; map: HumanoidMap } {
  const map = mapHumanoid(skin);
  if ("error" in map) throw new Error(map.error);
  const p = new SkeletonPlayer(skin, clip);
  p.setHumanoid(map);
  return { player: p, map };
}

describe("limb, foot and chain goals", () => {
  const rigs: { name: string; skin: MtekSkin; clip: string; skip?: boolean }[] = [
    { name: "generated Mixamo humanoid", ...(() => { const h = humanoid("mixamo"); return { skin: h.skin, clip: "walk" }; })() },
    { name: "generated Unreal humanoid with long legs", ...(() => { const h = humanoid("unreal", ["walk"], { legs: 1.25 }); return { skin: h.skin, clip: "walk" }; })() },
  ];
  const real = loadRealSkins(repo);
  rigs.push({ name: "CesiumMan", skin: real.cesiumMan, clip: real.cesiumMan.clips[0]!.name });
  const composition = glbSkin(path.join(repo, "examples/character-composition/scene/models/LongLegs.glb"));
  if (composition !== undefined) rigs.push({ name: "composition LongLegs", skin: composition, clip: "Walk" });

  for (const rig of rigs) {
    for (const [placement, spec] of [["rotated and uniformly scaled", PLACED], ["rotated and non-uniformly scaled", STRETCHED]] as const) {
      describe(`${rig.name}, entity ${placement}`, () => {
        it("meets a world-space limb goal: the end joint lands on the goal in world space", () => {
          const w = skeletalWorld({ skin: rig.skin, clip: rig.clip, ...spec });
          const t = twin(rig.skin, rig.clip);
          const hand = t.map.bones.rightHand!, upper = t.map.bones.rightUpperArm!;
          // A reachable goal: the animated hand position moved 4 cm along mesh-local up.
          const rest = pos(t.player.jointPosition(hand)), shoulder = pos(t.player.jointPosition(upper));
          const up = t.map.up as V;
          const local: V = [rest[0] + 0.04 * up[0], rest[1] + 0.04 * up[1], rest[2] + 0.04 * up[2]];
          expect(dist(local, shoulder)).toBeLessThan(0.9 * dist(rest, shoulder) + 0.04); // well inside reach
          const goal = toWorld(spec, local);
          expect(w.ctx["animationLimbGoal"]!(w.refs[0], "right_arm", v3(goal), 1, 0)).toBe(true);
          w.world.advanceClips(0.05);
          const reached = player(w.world).jointPosition(hand);
          // Mesh-local result against the independent conversion, and in world space against the goal.
          expect(dist(pos(reached), local)).toBeLessThan(2e-3);
          expect(dist(toWorld(spec, pos(reached)), goal) / Math.max(...spec.scale)).toBeLessThan(2e-3);
          // The same goal given to the host API in mesh-local space gives the same pose.
          t.player.ik.setLimb("x", { limb: "rightArm", target: local, weight: 1 });
          t.player.advance(0.05);
          expect(dist(pos(t.player.jointPosition(hand)), pos(reached))).toBeLessThan(1e-4);
          // Releasing it returns the animated pose.
          expect(w.ctx["animationClearLimb"]!(w.refs[0], "right_arm", 0)).toBe(true);
          expect(w.ctx["animationClearLimb"]!(w.refs[0], "right_arm", 0)).toBe(false);
          w.world.advanceClips(0);
          expect(codes(w.reported)).toEqual([]);
        });

        it("plants both feet on world-space ground points with normals, as the host API does in mesh-local space", () => {
          const w = skeletalWorld({ skin: rig.skin, clip: rig.clip, ...spec });
          const t = twin(rig.skin, rig.clip);
          const up = t.map.up as V, leftFoot = pos(t.player.jointPosition(t.map.bones.leftFoot!)), rightFoot = pos(t.player.jointPosition(t.map.bones.rightFoot!));
          // Unequal ground: the left step 6 cm higher than the animation stands, the right 3 cm lower, both tilted a little.
          const lift = (p: V, h: number): V => [p[0] + up[0] * h, p[1] + up[1] * h, p[2] + up[2] * h];
          const groundL = lift(leftFoot, 0.06), groundR = lift(rightFoot, -0.03);
          const tilt = (n: V): V => { const m = Math.hypot(...n); return n.map((x) => x / m) as V; };
          const localNormalL = tilt([up[0] + 0.1, up[1], up[2] - 0.1]), localNormalR = tilt([up[0] - 0.05, up[1], up[2] + 0.08]);
          const worldPoint = (p: V): V => toWorld(spec, p);
          // A world normal is the mesh-local one carried by the inverse transpose; for T R S that is R S^-1 n.
          const worldNormal = (n: V): V => { const s = spec.scale; return qrotate(spec.rotation, [n[0] / s[0], n[1] / s[1], n[2] / s[2]]); };
          expect(w.ctx["animationFootPlacement"]!(w.refs[0], v3(worldPoint(groundL)), v3(worldPoint(groundR)), v3(worldNormal(localNormalL)), v3(worldNormal(localNormalR)), 1, 0)).toBe(true);
          w.world.advanceClips(2);
          t.player.ik.setFootPlacement({ left: { point: groundL, normal: localNormalL, weight: 1 }, right: { point: groundR, normal: localNormalR, weight: 1 } });
          t.player.advance(2);
          for (const bone of [t.map.bones.leftFoot!, t.map.bones.rightFoot!, t.map.bones.hips!]) {
            expect(dist(pos(player(w.world).jointPosition(bone)), pos(t.player.jointPosition(bone))), bone).toBeLessThan(1e-4);
          }
          expect(player(w.world).inspect().footPlacement).not.toBeNull();
          expect(w.ctx["animationClearFootPlacement"]!(w.refs[0])).toBe(true);
          expect(w.ctx["animationClearFootPlacement"]!(w.refs[0])).toBe(false);
          expect(player(w.world).inspect().footPlacement ?? null).toBeNull();
          expect(codes(w.reported)).toEqual([]);
        });

        it("bends a chain toward a world-space goal like the host's CCD constraint", () => {
          const w = skeletalWorld({ skin: rig.skin, clip: rig.clip, ...spec });
          const t = twin(rig.skin, rig.clip);
          const end = t.map.bones.leftHand!, upper = t.map.bones.leftUpperArm!, lower = t.map.bones.leftLowerArm!;
          const chain = [upper, lower, end];
          const rest = pos(t.player.jointPosition(end)), up = t.map.up as V;
          const local: V = [rest[0] + 0.05 * up[0], rest[1] + 0.05 * up[1], rest[2] + 0.05 * up[2]];
          expect(w.ctx["animationChainGoal"]!(w.refs[0], "reach", end, 3, v3(toWorld(spec, local)), 1, 0)).toBe(true);
          w.world.advanceClips(0.05);
          t.player.ik.set("reach", { chain, target: local });
          t.player.advance(0.05);
          expect(dist(pos(player(w.world).jointPosition(end)), pos(t.player.jointPosition(end)))).toBeLessThan(1e-5);
          expect(dist(pos(player(w.world).jointPosition(end)), local)).toBeLessThan(0.5 * dist(rest, local)); // the chain moved toward the goal
          expect(w.ctx["animationClearChain"]!(w.refs[0], "reach")).toBe(true);
          expect(w.ctx["animationClearChain"]!(w.refs[0], "reach")).toBe(false);
          expect(codes(w.reported)).toEqual([]);
        });
      });
    }
  }

  it("moves a goal with the entity: the same world goal is a different mesh-local one after the entity moves", () => {
    const { skin } = humanoid("mixamo");
    const w = skeletalWorld({ skin, clip: "walk", ...PLACED });
    const hand = mapHumanoid(skin) as HumanoidMap;
    const start = pos(player(w.world).jointPosition(hand.bones.rightHand!));
    const goal = toWorld(PLACED, [start[0], start[1] + 0.05, start[2]]);
    w.ctx["animationLimbGoal"]!(w.refs[0], "right_arm", v3(goal), 1, 0);
    const ctx = w.world.ctx as unknown as Ctx;
    const target = (): V => pos(player(w.world).ik.limbs.inspect().limbs[0]!.target);
    w.world.advanceClips(0.05);
    expect(dist(target(), toLocal(PLACED, goal))).toBeLessThan(1e-5);
    ctx.setTransform(w.world.entities[0], "position", { x: 3, y: 0.53, z: -2 }); // 3 cm up in world space
    w.ctx["animationLimbGoal"]!(w.refs[0], "right_arm", v3(goal), 1, 0);
    w.world.advanceClips(0.05);
    const moved = { ...PLACED, position: [3, 0.53, -2] as V };
    expect(dist(target(), toLocal(moved, goal))).toBeLessThan(1e-5);
    expect(dist(target(), toLocal(PLACED, goal))).toBeGreaterThan(0.015);
    expect(dist(toWorld(moved, pos(player(w.world).jointPosition(hand.bones.rightHand!))), goal)).toBeLessThan(2e-3);
  });

  it("reports E8112 once for a skeleton that is no humanoid and drops limb and foot commands", () => {
    const fox = real.fox;
    const w = skeletalWorld({ skin: fox, clip: fox.clips[0]!.name });
    expect(w.ctx["animationLimbGoal"]!(w.refs[0], "left_leg", v3([0, 0, 0]), 1, 0)).toBe(false);
    expect(w.ctx["animationLimbGoal"]!(w.refs[0], "right_arm", v3([0, 0, 0]), 1, 0)).toBe(false);
    expect(w.ctx["animationFootPlacement"]!(w.refs[0], v3([0, 0, 0]), v3([0, 0, 0]), v3([0, 1, 0]), v3([0, 1, 0]), 1, 0)).toBe(false);
    expect(codes(w.reported)).toEqual(["E8112"]);
    expect(w.reported[0]!.source).not.toBeNull();
    expect(w.ctx["animationClearLimb"]!(w.refs[0], "left_leg", 0)).toBe(false);
    expect(w.ctx["animationClearFootPlacement"]!(w.refs[0])).toBe(false);
    expect(codes(w.reported)).toEqual(["E8112"]);
    // A chain goal needs no humanoid.
    const joint = fox.nodes[fox.joints[3]!]!.name, parent = fox.nodes[fox.nodes[fox.joints[3]!]!.parent]!.name;
    expect(parent.length).toBeGreaterThan(0);
    expect(w.ctx["animationChainGoal"]!(w.refs[0], "c", joint, 2, v3([0, 0, 0]), 1, 0)).toBe(true);
  });

  it("reports E8111 for an unknown limb or joint and E8113 for a bad chain or a leg goal with foot placement", () => {
    const { skin } = humanoid("mixamo");
    const w = skeletalWorld({ skin, clip: "walk" });
    const r = w.refs[0], c = w.ctx;
    expect(c["animationLimbGoal"]!(r, "tail", v3([0, 0, 0]), 1, 0)).toBe(false);
    expect(c["animationClearLimb"]!(r, "tail", 0)).toBe(false);
    expect(c["animationChainGoal"]!(r, "c", "NoJoint", 2, v3([0, 0, 0]), 1, 0)).toBe(false);
    expect(codes(w.reported)).toEqual(["E8111", "E8111"]); // "tail" once for both calls, the joint once
    expect(c["animationChainGoal"]!(r, "c", skin.nodes[skin.joints[2]!]!.name, 1, v3([0, 0, 0]), 1, 0)).toBe(false); // length 1
    expect(c["animationChainGoal"]!(r, "c", skin.nodes[skin.joints[0]!]!.name, 90, v3([0, 0, 0]), 1, 0)).toBe(false); // longer than the skeleton
    expect(codes(w.reported)).toEqual(["E8111", "E8111", "E8113", "E8113"]);
    // Foot placement owns both legs: a leg goal next to it is refused.
    const map = mapHumanoid(skin) as HumanoidMap;
    const foot = pos(player(w.world).jointPosition(map.bones.leftFoot!));
    expect(c["animationFootPlacement"]!(r, v3(foot), v3(foot), v3([0, 1, 0]), v3([0, 1, 0]), 1, 0)).toBe(true);
    expect(c["animationLimbGoal"]!(r, "left_leg", v3(foot), 1, 0)).toBe(false);
    expect(codes(w.reported).slice(-1)).toEqual(["E8113"]);
    expect(codes(w.reported).filter((code) => code === "E8112")).toEqual([]);
  });
});

// ---- root motion ---------------------------------------------------------------------------------------------------

describe("animation.root_motion and take_root_motion", () => {
  function runner(): { skin: MtekSkin; hips: string } {
    const rig = humanoidRig({ rigRotation: unitQ([0, 1, 0], 0.7), rigScale: 0.01, meshRotation: unitQ([1, 0, 0], -Math.PI / 2) });
    const hips = rig.names.hips, node = rig.nodeIndex("hips"), bind = rig.skin.nodes[node]!.translation;
    const clip = {
      name: "run", duration: 1,
      channels: [{ node, path: "translation" as const, interpolation: "linear" as const, times: [0, 1], values: [...bind, bind[0]! + 40, bind[1]!, bind[2]! + 120] }],
    };
    return { skin: { ...rig.skin, clips: [clip] }, hips };
  }

  it("returns the displacement in world space with the rotation and the scale of the entity, and consumes it", () => {
    const { skin, hips } = runner();
    const spec = { ...PLACED, scale: [2, 2, 2] as V };
    const owned = skeletalWorld({ skin, clip: "run", ...spec }), free = skeletalWorld({ skin, clip: "run", ...spec });
    expect(owned.ctx["animationRootMotion"]!(owned.refs[0], hips, 0)).toBe(true);
    // Reference: the same clip with the host unowned moves the hips in the displayed pose; its mesh-local movement.
    const before = pos(player(free.world).jointPosition(hips));
    free.world.advanceClips(0.5);
    const delta = pos(player(free.world).jointPosition(hips)).map((v, i) => v - before[i]!) as V;
    owned.world.advanceClips(0.5);
    const taken = owned.ctx["animationTakeRootMotion"]!(owned.refs[0]) as Vec3;
    const expected = toWorld({ ...spec, position: [0, 0, 0] }, delta);
    expect(dist([taken.x, taken.y, taken.z], expected)).toBeLessThan(1e-4 * Math.hypot(...expected));
    expect(Math.hypot(...expected)).toBeGreaterThan(0.5);
    // Consumed: the next call is zero until time passes again; the displayed hips stayed at the bind pose.
    expect(owned.ctx["animationTakeRootMotion"]!(owned.refs[0])).toEqual({ x: 0, y: 0, z: 0 });
    expect(dist(pos(player(owned.world).jointPosition(hips)), before)).toBeLessThan(1e-9);
    // Two halves add up to the whole displacement (and never lose a loop wrap).
    owned.world.advanceClips(0.5);
    const second = owned.ctx["animationTakeRootMotion"]!(owned.refs[0]) as Vec3;
    owned.world.advanceClips(1);
    const wrapped = owned.ctx["animationTakeRootMotion"]!(owned.refs[0]) as Vec3;
    const whole = toWorld({ ...spec, position: [0, 0, 0] }, delta.map((v) => v * 2) as V);
    expect(dist([second.x, second.y, second.z], expected)).toBeLessThan(1e-4 * Math.hypot(...expected));
    expect(dist([wrapped.x, wrapped.y, wrapped.z], whole)).toBeLessThan(1e-4 * Math.hypot(...whole));
    // Switching it off releases the joint.
    expect(owned.ctx["animationRootMotion"]!(owned.refs[0], "", 0)).toBe(true);
    owned.world.advanceClips(0.25);
    expect(owned.ctx["animationTakeRootMotion"]!(owned.refs[0])).toEqual({ x: 0, y: 0, z: 0 });
    expect(codes(owned.reported)).toEqual([]);
  });

  it("reports E8111 for an unknown joint and reads zero for a dead reference", () => {
    const { skin } = runner();
    const w = skeletalWorld({ skin, clip: "run" });
    expect(w.ctx["animationRootMotion"]!(w.refs[0], "Nothing", 0)).toBe(false);
    expect(codes(w.reported)).toEqual(["E8111"]);
    expect(w.ctx["animationTakeRootMotion"]!(DEAD_REF)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ---- clips_from ----------------------------------------------------------------------------------------------------

describe("clips_from", () => {
  it("plays the clips of another humanoid, retargeted as retargetHumanoid does, and names them by the source", () => {
    const source = humanoid("mixamo", ["walk", "wave"]).skin, target = humanoid("unreal", [], { legs: 1.3, arms: 0.85 }).skin;
    const w = skeletalWorld({ skin: target, from: source, clip: "walk" });
    const reference = new SkeletonPlayer(retargetHumanoid(source, target), "walk");
    expect(player(w.world).skin.clips.map((c) => c.name)).toEqual(["walk", "wave"]);
    w.world.advanceClips(0.37);
    reference.advance(0.37);
    for (const node of target.nodes) expect(dist(pos(player(w.world).jointPosition(node.name)), pos(reference.jointPosition(node.name))), node.name).toBeLessThan(1e-9);
    // The commands see the source's clip names.
    expect(w.ctx["animationSetLayer"]!(w.refs[0], "l", "wave", 1, false, "", 0)).toBe(true);
    expect(codes(w.reported)).toEqual([]);
    // Entities that share the pair share one retargeted skin.
    const two = skeletalWorld({ skin: target, from: source, clip: "walk" }, { skin: target, from: source, clip: "wave" });
    expect(player(two.world, 0).skin).toBe(player(two.world, 1).skin);
  });

  it("works between the real rigs: CesiumMan clips on the long-legged variant", () => {
    const real = loadRealSkins(repo);
    const w = skeletalWorld({ skin: real.cesiumLongLegs, from: real.cesiumMan, clip: real.cesiumMan.clips[0]!.name });
    expect(codes(w.reported)).toEqual([]);
    expect(player(w.world).skin.clips[0]!.name).toBe(real.cesiumMan.clips[0]!.name);
    expect(player(w.world).skin.nodes).toEqual(real.cesiumLongLegs.nodes);
  });

  it("reports E8110 once when a skeleton is not a humanoid and keeps the entity's own clips", () => {
    const own = humanoid("unreal", ["walk"]).skin, fox = loadRealSkins(repo).fox;
    const w = skeletalWorld({ skin: own, from: fox, clip: "Run" }, { skin: own, from: fox, clip: "Run" });
    expect(codes(w.reported)).toEqual(["E8110", "E8110"]); // two declarations, one report each
    expect(w.reported[0]!.message).toContain("source");
    expect(player(w.world, 0).skin.clips.map((c) => c.name)).toEqual(["walk"]);
    // The target that is no humanoid reports too.
    const foxTarget = skeletalWorld({ skin: fox, from: humanoid("mixamo").skin, clip: "walk" });
    expect(codes(foxTarget.reported)).toEqual(["E8110"]);
    expect(foxTarget.reported[0]!.message).toContain("target");
    expect(player(foxTarget.world).skin).toBe(fox);
    expect(foxTarget.reported[0]!.source).not.toBeNull();
  });

  it("works with the character-composition rigs when the example models are present", () => {
    const source = glbSkin(path.join(repo, "examples/character-composition/scene/models/Source.glb"));
    const target = glbSkin(path.join(repo, "examples/character-composition/scene/models/LongLegs.glb"));
    if (source === undefined || target === undefined) return;
    const w = skeletalWorld({ skin: target, from: source, clip: "Walk" });
    expect(codes(w.reported)).toEqual([]);
    expect(player(w.world).skin.clips.map((c) => c.name)).toEqual(source.clips.map((c) => c.name));
  });
});

// ---- hot reload -----------------------------------------------------------------------------------------------------

describe("hot reload", () => {
  it("builds the animation state again: layers, blend spaces, goals and root ownership are not migrated", () => {
    const { skin } = humanoid("mixamo");
    const previous = skeletalWorld({ skin, clip: "walk", ...PLACED });
    const c = previous.ctx, r = previous.refs[0];
    c["animationSetLayer"]!(r, "l", "wave", 1, false, "", 0);
    c["animationBlendSample"]!(r, "walk", 0, 0, 0);
    c["animationBlendPlay"]!(r, true, 1, 0);
    c["animationLimbGoal"]!(r, "right_arm", v3([3, 1, -2]), 1, 0);
    c["animationRootMotion"]!(r, skin.nodes[skin.joints[0]!]!.name, 0);
    const next = skeletalWorld({ skin, clip: "walk" });
    migrateWorld(previous.world, previous.manifest, next.world, next.manifest);
    expect(player(previous.world).layers.inspect()).toHaveLength(1);
    expect(player(previous.world).blend.active).toBe(true);
    const fresh = player(next.world);
    expect(fresh).not.toBe(player(previous.world));
    expect(fresh.layers.inspect()).toHaveLength(0);
    expect(fresh.blend.active).toBe(false);
    expect(fresh.ik.limbs.inspect().limbs).toHaveLength(0);
    expect(fresh.inspect().rootMotionNode).toBeNull();
    // The new program's handlers set them up again; names reported before may be reported again.
    expect(next.ctx["animationSetLayer"]!(next.refs[0], "l", "nope", 1, false, "", 0)).toBe(false);
    expect(codes(next.reported)).toEqual(["E8111"]);
  });
});

// ---- the manifest side of clips_from ---------------------------------------------------------------------------------

describe("clipSources in the manifest", () => {
  const resolve = (edit: (json: Record<string, unknown>) => void): ReturnType<typeof resolveStructure> => {
    const json = minimalManifestJson();
    edit(json);
    const checked = checkManifest(json);
    if (!checked.ok) throw new Error(JSON.stringify(checked.failures));
    return resolveStructure(checked.manifest);
  };
  const source = (): MtekSkin => humanoid("mixamo").skin;
  const firstEntity = (json: Record<string, unknown>): Record<string, unknown> => (json["scene"] as { entities: Record<string, unknown>[] }).entities[0]!;

  it("resolves the skeleton an entity takes its clips from", () => {
    const result = resolve((json) => {
      json["clipSources"] = [{ ...source(), indices: [], weights: [] }];
      firstEntity(json)["clipsFrom"] = 0;
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.structure.entities[0]!.clipsFrom!.clips.map((c) => c.name)).toEqual(["walk", "wave"]);
  });

  it("validates clipsFrom on entities and prefabs and the table of sources", () => {
    const example = JSON.parse(readFileSync(path.resolve("../../tests/abi/manifests/valid/full.json"), "utf8")) as Record<string, unknown>;
    const checked = checkManifest(example);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.manifest.clipSources?.map((s) => s.clips.map((c) => c.name))).toEqual([["Spin"]]);
    expect(checked.manifest.prefabs?.map((p) => p.clipsFrom)).toContain(0);
    expect(checked.manifest.scene.entities.map((e) => e.clipsFrom)).toContain(0);
    // A negative or fractional index is a broken manifest.
    const bad = structuredClone(example);
    ((bad["scene"] as { entities: Record<string, unknown>[] }).entities.find((e) => e["clipsFrom"] !== undefined))!["clipsFrom"] = -1;
    expect(checkManifest(bad).ok).toBe(false);
  });

  it("refuses an index the manifest lacks and a skeleton that is invalid", () => {
    const missing = resolve((json) => {
      firstEntity(json)["clipsFrom"] = 3;
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(JSON.stringify(missing.diagnostics)).toContain("clipSources[3]");
    const broken = resolve((json) => {
      json["clipSources"] = [{ ...source(), joints: [200], indices: [], weights: [] }];
    });
    expect(broken.ok).toBe(false);
  });
});
