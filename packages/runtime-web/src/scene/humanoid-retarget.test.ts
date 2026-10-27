import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapHumanoid, type HumanoidBone, type HumanoidMap } from "./humanoid.js";
import { retargetHumanoid } from "./humanoid-retarget.js";
import { SkeletonPlayer, skinProblem } from "./skeleton.js";
import { BOUNDS, buildEvidence, formatEvidence, retargetRows } from "../test-support/humanoid-evidence.js";
import { PROCEDURAL_CLIPS, buildHumanoid, loadRealSkins, withClips, type HumanoidSpec } from "../test-support/humanoid-fixtures.js";
import { frameOf, posesOf } from "../test-support/humanoid-metrics.js";
import type { MtekSkin } from "../abi/manifest-types.js";

const root = path.resolve(import.meta.dirname, "../../../..");
const mapOf = (skin: MtekSkin): HumanoidMap => {
  const map = mapHumanoid(skin);
  if ("error" in map) throw new Error(map.error);
  return map;
};
const EXTRAS = { props: true, twists: true, tail: true, fingers: true, face: true } as const;
const walker = (spec: HumanoidSpec) => withClips(buildHumanoid(spec), ["walk", "wave"]);
const nodeIndex = (skin: MtekSkin, name: string): number => skin.nodes.findIndex((n) => n.name === name);

describe("retargetHumanoid", () => {
  it("returns the target with the source clips, rewritten for the target's own bones", () => {
    const source = walker({ convention: "mixamo", rest: "T" }), target = buildHumanoid({ convention: "unreal", rest: "A", extras: EXTRAS });
    const result = retargetHumanoid(source.skin, target.skin);
    expect(skinProblem(result, result.indices.length)).toBeUndefined();
    expect(result.nodes).toBe(target.skin.nodes);
    expect(result.joints).toBe(target.skin.joints);
    expect(result.inverseBind).toBe(target.skin.inverseBind);
    expect(result.clips.map((c) => [c.name, c.duration])).toEqual(source.skin.clips.map((c) => [c.name, c.duration]));
    // Only mapped bones are animated (and only the hips translate); extras keep their bind pose.
    const animated = new Set(result.clips[0]!.channels.map((c) => result.nodes[c.node]!.name));
    expect(animated.has("pelvis")).toBe(true);
    for (const extra of ["tail_01", "weapon_r", "lowerarm_twist_01_l", "thigh_twist_01_r", "index_01_l", "jaw", "eye_l", "root"]) expect(animated.has(extra)).toBe(false);
    expect(result.clips[0]!.channels.filter((c) => c.path === "translation").map((c) => result.nodes[c.node]!.name)).toEqual(["pelvis"]);
    expect(result.clips[0]!.channels.every((c) => c.interpolation === "linear")).toBe(true);
  });

  it("does not animate target bones that the source lacks", () => {
    const source = walker({ convention: "plain", rest: "T" }), target = buildHumanoid({ convention: "mixamo", rest: "A" });
    const animated = new Set(retargetHumanoid(source.skin, target.skin).clips[0]!.channels.map((c) => target.skin.nodes[c.node]!.name));
    for (const missing of ["mixamorig:Spine2", "mixamorig:LeftShoulder", "mixamorig:LeftToeBase"]) expect(animated.has(missing)).toBe(false);
    expect(animated.has("mixamorig:Spine1")).toBe(true);
  });

  it("reproduces the source motion when source and target are the same rig", () => {
    const source = walker({ convention: "vrm", rest: "A", axes: "bone", frame: "zup", extras: EXTRAS }), result = retargetHumanoid(source.skin, source.skin);
    const a = posesOf(source.skin, "walk"), b = posesOf(result, "walk");
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      const p = a(t), q = b(t);
      source.skin.joints.forEach((j) => {
        p.pos[j]!.forEach((v, k) => expect(q.pos[j]![k]).toBeCloseTo(v, 9));
      });
    }
  });

  it("moves the target's limbs along the authored world-space directions of the source clip", () => {
    const source = walker({ convention: "mixamo", rest: "T" }), target = buildHumanoid({ convention: "unreal", rest: "A" });
    const result = retargetHumanoid(source.skin, target.skin), map = mapOf(target.skin), frame = frameOf(map), poses = posesOf(result, "walk");
    const parts: [string, HumanoidBone, HumanoidBone][] = [["upperArm.L", "leftUpperArm", "leftLowerArm"], ["lowerLeg.R", "rightLowerLeg", "rightFoot"], ["upperLeg.L", "leftUpperLeg", "leftLowerLeg"]];
    for (const t of [0, 6 / 30, 14 / 30, 24 / 30]) { // key times: between keys the clip interpolates the authored curve
      const authored = PROCEDURAL_CLIPS.walk.pose(source, t), pose = poses(t);
      for (const [id, a, b] of parts) {
        const d = pose.pos[nodeIndex(result, map.bones[b]!)]!.map((v, k) => v - pose.pos[nodeIndex(result, map.bones[a]!)]![k]!);
        const comps = [0, 1, 2].map((k) => d[0]! * [frame.left, frame.up, frame.forward][k]![0] + d[1]! * [frame.left, frame.up, frame.forward][k]![1] + d[2]! * [frame.left, frame.up, frame.forward][k]![2]);
        const n = Math.hypot(...comps), want = authored.dirs[id]!;
        const angle = Math.acos(Math.min(1, (comps[0]! * want[0] + comps[1]! * want[1] + comps[2]! * want[2]) / n)) * (180 / Math.PI);
        expect(angle).toBeLessThan(0.01);
      }
    }
  });

  it("scales the hips travel by the leg-length ratio, or by an explicit scale", () => {
    const source = walker({ convention: "mixamo", rest: "T" }), target = buildHumanoid({ convention: "mixamo", rest: "T", legs: 1.5 });
    const travel = (skin: MtekSkin): number => {
      const hips = nodeIndex(skin, "mixamorig:Hips"), pose = posesOf(skin, "walk");
      return pose(1).pos[hips]![2] - pose(0).pos[hips]![2];
    };
    const base = travel(source.skin);
    expect(travel(retargetHumanoid(source.skin, target.skin))).toBeCloseTo(base * 1.5, 9);
    expect(travel(retargetHumanoid(source.skin, target.skin, { translationScale: 0.25 }))).toBeCloseTo(base * 0.25, 9);
    expect(() => retargetHumanoid(source.skin, target.skin, { translationScale: 0 })).toThrow(/positive/);
    expect(() => retargetHumanoid(source.skin, target.skin, { maxKeyInterval: -1 })).toThrow(/key interval/);
  });

  it("keeps the keys of the source and fills gaps no wider than the key interval", () => {
    const rig = buildHumanoid({ convention: "mixamo" });
    const hips = rig.bones.get("hips")!.node, spine = rig.bones.get("spine")!.node;
    const sparse: MtekSkin = { ...rig.skin, clips: [{ name: "slow", duration: 2, channels: [
      { node: hips, path: "translation", interpolation: "linear", times: [0, 2], values: [...rig.skin.nodes[hips]!.translation, 0, rig.skin.nodes[hips]!.translation[1]! + 0.1, 0] },
      { node: spine, path: "rotation", interpolation: "linear", times: [0, 1, 2], values: [0, 0, 0, 1, 0, 0.2, 0, 0.98, 0, 0, 0, 1] },
    ] }] };
    const target = buildHumanoid({ convention: "unity" }), times = retargetHumanoid(sparse, target.skin).clips[0]!.channels[0]!.times;
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(2);
    for (let i = 1; i < times.length; i++) { expect(times[i]! - times[i - 1]!).toBeGreaterThan(0); expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(1 / 30 + 1e-9); }
    expect(retargetHumanoid(sparse, target.skin, { maxKeyInterval: 1 }).clips[0]!.channels[0]!.times).toEqual([0, 1, 2]);
  });

  it("produces clips that play on the runtime skeleton player", () => {
    const source = walker({ convention: "mixamo", rest: "T" }), target = buildHumanoid({ convention: "unity", rest: "A", frame: "zup", axes: "bone" });
    const result = retargetHumanoid(source.skin, target.skin), player = new SkeletonPlayer(result, "walk"), poses = posesOf(result, "walk");
    player.advance(0.5);
    expect(player.palette.every(Number.isFinite)).toBe(true);
    for (const name of ["Hips", "LeftHand", "RightFoot", "Head"]) {
      const at = player.jointPosition(name), want = poses(0.5).pos[nodeIndex(result, name)]!;
      expect([at.x, at.y, at.z]).toEqual([expect.closeTo(want[0], 4), expect.closeTo(want[1], 4), expect.closeTo(want[2], 4)]);
    }
  });

  it("uses precomputed maps and rejects what is not a humanoid", () => {
    const source = walker({ convention: "mixamo" }), target = buildHumanoid({ convention: "unreal" });
    const sourceMap = mapOf(source.skin), targetMap = mapOf(target.skin);
    expect(retargetHumanoid(source.skin, target.skin, { sourceMap, targetMap })).toEqual(retargetHumanoid(source.skin, target.skin));
    const real = loadRealSkins(root);
    expect(() => retargetHumanoid(source.skin, real.fox)).toThrow(/Humanoid mapping failed for the target: .*upright biped/);
    expect(() => retargetHumanoid(real.fox, target.skin)).toThrow(/Humanoid mapping failed for the source/);
    const skewed = { ...source.skin, nodes: source.skin.nodes.map((n, i) => (i === source.skin.joints[3] ? { ...n, scale: [1, 1.5, 1] } : n)) };
    expect(() => retargetHumanoid(skewed, target.skin)).toThrow(/uniform/);
  });

  it("handles a source clip without any rotation or translation channels", () => {
    const rig = buildHumanoid({ convention: "mixamo" }), still: MtekSkin = { ...rig.skin, clips: [{ name: "still", duration: 0, channels: [] }] };
    const result = retargetHumanoid(still, buildHumanoid({ convention: "unity", rest: "A" }).skin);
    expect(result.clips[0]!.channels.every((c) => c.times.length === 1 && c.times[0] === 0)).toBe(true);
    expect(result.clips[0]!.channels.some((c) => c.path === "translation")).toBe(false);
  });
});

describe("published humanoid retargeting measurements", () => {
  const rows = retargetRows(root);

  it("corrects the rest pose: limb directions follow the source within the bound, uncorrected transfer does not", () => {
    for (const r of rows) {
      expect(r.maxLimbErrorDeg, `${r.scenario} ${r.clip}`).toBeLessThanOrEqual(BOUNDS.limbErrorDeg);
      if (r.naiveMaxLimbErrorDeg > 0.001) expect(r.naiveMaxLimbErrorDeg, `${r.scenario} ${r.clip}`).toBeGreaterThanOrEqual(BOUNDS.naiveLimbErrorMinDeg);
    }
    expect(rows.some((r) => r.naiveMaxLimbErrorDeg >= 45)).toBe(true);
  });

  it("follows the leg-length ratio with the hips and keeps the planted feet on the ground", () => {
    for (const r of rows) {
      expect(r.stanceFrames, `${r.scenario} ${r.clip}`).toBeGreaterThan(0);
      expect(r.hipsRatioError, `${r.scenario} ${r.clip}`).toBeLessThanOrEqual(BOUNDS.hipsRatioError);
      expect(r.maxStanceHeightError, `${r.scenario} ${r.clip}`).toBeLessThanOrEqual(BOUNDS.footHeightError);
      expect(r.maxStanceSlide, `${r.scenario} ${r.clip}`).toBeLessThanOrEqual(r.real ? BOUNDS.slideReal : BOUNDS.slideSynthetic);
    }
  });

  it("covers T to A, A to T, proportion changes, units, frames, bone axes and real skins", () => {
    const names = rows.map((r) => r.scenario);
    expect(new Set(names).size).toBeGreaterThanOrEqual(8);
    expect(rows.some((r) => r.real)).toBe(true);
    expect(rows.some((r) => r.legRatio > 1.5)).toBe(true);
    expect(rows.some((r) => r.legRatio < 0.9)).toBe(true);
  });

  it("matches the committed evidence file", () => {
    const committed = readFileSync(path.join(root, "evidence/animation/humanoid-retarget.json"), "utf8").replace(/\r\n/g, "\n");
    expect(formatEvidence(buildEvidence(root))).toBe(committed);
  });
});
