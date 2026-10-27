import { describe, expect, it } from "vitest";
import { createAnimationController } from "../animation.js";
import { humanoidRig, qaxis, qmul, qrot } from "../test-support/limb-rigs.js";
import { withWalkClip } from "../test-support/limb-clips.js";
import { SkeletonPlayer } from "./skeleton.js";
import { DEFAULT_SOFTNESS, KNEE_MAX_FLEXION, minimumDrop, reachLimits, softReach } from "./limb-ik.js";
import { LimbHarness, LIMBS, evidenceRigs, measureBeyondReach, measureDegenerate, measureReach, quatAngle, referenceDrop, sphere } from "./limb-evidence.js";
import type { HumanoidMap } from "./humanoid-types.js";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / norm(a));
const angle = (a: V, b: V): number => Math.atan2(norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]), dot(a, b));

/** Direction of the knee/elbow offset from the line through hip and end joint. */
function bendSide(s: { hip: V; knee: V; end: V }): V {
  const axis = unit(sub(s.end, s.hip)), toKnee = sub(s.knee, s.hip);
  return unit(sub(toKnee, mul(axis, dot(toKnee, axis))));
}

describe("humanoid map and goal validation", () => {
  const rig = humanoidRig();
  it("needs a humanoid map before any limb goal or foot placement", () => {
    const player = new SkeletonPlayer(rig.skin);
    expect(() => player.ik.setLimb("a", { limb: "leftLeg", target: [0, 0, 0] })).toThrow(/humanoid map/);
    expect(() => player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 } })).toThrow(/humanoid map/);
  });
  it("rejects maps that do not fit the skin", () => {
    const player = new SkeletonPlayer(rig.skin);
    const map = (bones: HumanoidMap["bones"], rest: Partial<HumanoidMap> = {}): HumanoidMap => ({ ...rig.map, bones, ...rest });
    expect(() => player.setHumanoid(map({ ...rig.map.bones, leftFoot: "missing" }))).toThrow(/leftFoot/);
    const { hips: _hips, ...noHips } = rig.map.bones;
    expect(() => player.setHumanoid(map(noHips))).toThrow(/hips/);
    expect(() => player.setHumanoid(map({ ...rig.map.bones, leftUpperLeg: rig.names.leftLowerLeg, leftLowerLeg: rig.names.leftUpperLeg }))).toThrow(/descend/);
    expect(() => player.setHumanoid(map(rig.map.bones, { up: [0, 0, 0] }))).toThrow(/up and forward/);
    expect(() => player.setHumanoid(map(rig.map.bones, { forward: [Number.NaN, 0, 1] }))).toThrow(/up and forward/);
  });
  it("rejects invalid goals and a second goal for one limb, and replaces a goal by its ID", () => {
    const h = new LimbHarness(rig);
    const ik = h.player.ik;
    const target: V = [0, 0.5, 0];
    expect(() => ik.setLimb("", { limb: "leftLeg", target })).toThrow(/ID/);
    expect(() => ik.setLimb("a", { limb: "tail" as never, target })).toThrow(/limb name/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target: [0, Number.NaN, 0] })).toThrow(/Invalid limb/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, weight: 1.5 })).toThrow(/Invalid limb/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, rotationWeight: -1 })).toThrow(/Invalid limb/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, softness: 0.6 })).toThrow(/Invalid limb/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, flexion: { min: 0.5, max: 0.4 } })).toThrow(/flexion/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, flexion: { min: -0.1, max: 1 } })).toThrow(/flexion/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, flexion: { min: 0, max: Math.PI } })).toThrow(/flexion/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, pole: [0, 0, 0] })).toThrow(/pole/);
    expect(() => ik.setLimb("a", { limb: "leftLeg", target, rotation: [0, 0, 0, 0] })).toThrow(/orientation/);
    ik.setLimb("a", { limb: "leftLeg", target });
    expect(() => ik.setLimb("b", { limb: "leftLeg", target })).toThrow(/already driven by goal a/);
    ik.setLimb("a", { limb: "leftLeg", target: [0, 0.6, 0] });
    expect(h.player.inspect().limbs).toHaveLength(1);
    expect(h.player.inspect().limbs![0]!.target).toEqual({ x: 0, y: 0.6, z: 0 });
  });
  it("snapshots caller arrays", () => {
    const h = new LimbHarness(rig);
    const target: [number, number, number] = [0.1, 0.4, 0.2], pole: [number, number, number] = [0, 0, 1];
    h.player.ik.setLimb("a", { limb: "leftLeg", target, pole });
    target[0] = 99; pole[2] = 0;
    expect(h.player.inspect().limbs![0]!.target.x).toBe(0.1);
    expect(h.player.inspect().limbs![0]!.pole).toEqual({ x: 0, y: 0, z: 1 });
  });
  it("keeps goals and placement mutually exclusive for the legs, removes by ID, and clears", () => {
    const h = new LimbHarness(rig), ik = h.player.ik, baseline = h.player.pose.slice();
    ik.setLimb("arm", { limb: "leftArm", target: [0.4, 1.2, 0.3] });
    ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 } });
    expect(() => ik.setLimb("leg", { limb: "rightLeg", target: [0, 0.2, 0] })).toThrow(/Foot placement owns/);
    ik.setFootPlacement(undefined);
    ik.setLimb("leg", { limb: "rightLeg", target: [0, 0.4, 0] });
    expect(() => ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 } })).toThrow(/remove leg goals/);
    ik.remove("leg"); ik.remove("arm");
    h.player.evaluate();
    expect(h.player.pose).toEqual(baseline);
    ik.setLimb("arm", { limb: "leftArm", target: [0.4, 1.2, 0.3] });
    ik.setFootPlacement({ left: { height: -0.1 }, right: { height: 0 } });
    h.player.evaluate();
    ik.clear();
    h.player.evaluate();
    expect(h.player.pose).toEqual(baseline);
    expect(h.player.inspect().limbs).toEqual([]);
    expect(h.player.inspect().footPlacement).toBeNull();
    expect(h.player.ik.limbs.humanoid).toBe(rig.map); // configuration survives clear
  });
  it("drops every goal with the map and shares one ID space with CCD constraints", () => {
    const h = new LimbHarness(rig), ik = h.player.ik;
    ik.setLimb("hand", { limb: "leftArm", target: [0.4, 1.2, 0.3] });
    ik.set("hand", { chain: [rig.names.rightUpperArm, rig.names.rightLowerArm, rig.names.rightHand], target: [-0.3, 1.2, 0.3] });
    expect(h.player.inspect().limbs).toEqual([]);
    expect(h.player.inspect().ik).toHaveLength(1);
    ik.setLimb("hand", { limb: "leftArm", target: [0.4, 1.2, 0.3] });
    expect(h.player.inspect().ik).toEqual([]);
    h.player.setHumanoid(undefined);
    expect(h.player.inspect().limbs).toEqual([]);
    expect(() => ik.setLimb("hand", { limb: "leftArm", target: [0, 0, 0] })).toThrow(/humanoid map/);
  });
  it("is available through the independent animation controller and releases state on dispose", () => {
    const controller = createAnimationController(rig.skin);
    controller.setHumanoid(rig.map);
    controller.setLimb("foot", { limb: "leftLeg", target: [0.2, 0.2, 0.3] });
    controller.update(0, true);
    const foot = controller.player.jointPosition(rig.names.leftFoot);
    expect(Math.hypot(foot.x - 0.2, foot.y - 0.2, foot.z - 0.3)).toBeLessThan(1e-5);
    controller.setLimb("arm", { limb: "rightArm", target: [-0.3, 1.1, 0.2] });
    controller.dispose();
    expect(controller.player.inspect().limbs).toEqual([]);
    expect(() => controller.setLimb("x", { limb: "leftLeg", target: [0, 0, 0] })).toThrow(/disposed/);
    const placing = createAnimationController(rig.skin);
    placing.setHumanoid(rig.map);
    placing.setFootPlacement({ left: { height: 0 }, right: { height: 0 } });
    expect(placing.player.inspect().footPlacement).not.toBeNull();
    placing.setFootPlacement(undefined);
    expect(placing.player.inspect().footPlacement).toBeNull();
  });
});

describe("two-bone solve", () => {
  it("puts the end joint on reachable targets in every direction on every rig and limb", () => {
    for (const c of evidenceRigs()) for (const limb of LIMBS) {
      const r = measureReach(c, limb, 60);
      expect(r.maxRelativeError, `${c.id} ${limb}`).toBeLessThan(1e-5);
    }
  });
  it("bends knees forward and elbows backward from a straight bind pose", () => {
    const h = new LimbHarness(humanoidRig());
    const leg = h.rig.bindPosition("leftUpperLeg");
    h.set("leftLeg", add(leg, [0, -0.7, 0.05]));
    let s = h.signedFlexion("leftLeg");
    expect(s.flexion).toBeGreaterThan(0.2);
    expect(dot(bendSide(s), h.rig.forward)).toBeGreaterThan(0.99);
    const shoulder = h.rig.bindPosition("leftUpperArm");
    h.set("leftArm", add(shoulder, [0.45, 0, 0]));
    s = h.signedFlexion("leftArm");
    expect(s.flexion).toBeGreaterThan(0.2);
    expect(dot(bendSide(s), h.rig.forward)).toBeLessThan(-0.99);
  });
  it("reproduces the animated pose when the target is the animated end, for a bent bind with rolled bone frames", () => {
    // Bends deep enough to be inside the exactly-solved shell (a nearly straight limb lies in the soft zone).
    const h = new LimbHarness(humanoidRig({ kneeBind: [34, 40], elbowBind: 45, armPose: "a", boneFrames: true }));
    const before = h.player.pose.slice();
    for (const limb of LIMBS) {
      const end = h.pos(limb === "leftLeg" ? "leftFoot" : limb === "rightLeg" ? "rightFoot" : limb === "leftArm" ? "leftHand" : "rightHand");
      h.set(limb, end);
      h.player.pose.forEach((v, i) => expect(Math.abs(v - before[i]!)).toBeLessThan(1e-6));
    }
  });
  it("follows the twist of the animated upper bone: the knee points where the thigh's bend side points", () => {
    const rig = humanoidRig();
    const h = new LimbHarness(rig), twist = 0.5, node = rig.nodeIndex("leftUpperLeg") * 10 + 3;
    h.player.setProceduralOverride(pose => { pose.set(qaxis([0, 1, 0], twist), node); });
    const start = h.rig.bindPosition("leftUpperLeg");
    h.set("leftLeg", add(start, [0, -0.7, 0]));
    const s = h.signedFlexion("leftLeg");
    const bend = bendSide(s);
    // Twisting the thigh about its axis by 0.5 rad turns the bend direction from forward (+z) by 0.5 rad about up.
    const expected = qrot(qaxis([0, 1, 0], twist), [0, 0, 1]);
    expect(angle(bend, expected)).toBeLessThan(2e-3);
  });
  it("bends toward an explicit pole, ignores a pole along the limb, and keeps the range", () => {
    const h = new LimbHarness(humanoidRig());
    const hip = h.rig.bindPosition("leftUpperLeg"), target = add(hip, [0, -0.7, 0]);
    const bendOf = (): V => bendSide(h.signedFlexion("leftLeg"));
    h.set("leftLeg", target);
    const dflt = bendOf(), defaultPose = h.player.pose.slice();
    for (const pole of [[1, 0, 0], [-1, 0, 0], [0, 0, -1], [0.3, 0.2, 0.9]] as V[]) {
      h.set("leftLeg", target, { pole });
      const bend = bendOf(), perpendicular = unit(sub(pole, mul([0, -1, 0], dot(pole, [0, -1, 0]))));
      expect(dot(bend, perpendicular)).toBeGreaterThan(0.99999);
      expect(h.signedFlexion("leftLeg").flexion).toBeGreaterThanOrEqual(-1e-5);
    }
    h.set("leftLeg", target, { pole: [0, -1, 0] });
    expect(angle(bendOf(), dflt)).toBeLessThan(1e-6);
    h.player.pose.forEach((v, i) => expect(Math.abs(v - defaultPose[i]!)).toBeLessThan(1e-9));
  });
  it("blends with the animated pose by weight (spherical interpolation of the local rotations)", () => {
    const rig = humanoidRig({ boneFrames: true });
    const h = new LimbHarness(rig), node = rig.nodeIndex("leftUpperLeg") * 10 + 3;
    const animated = h.player.pose.slice(node, node + 4), target = add(h.rig.bindPosition("leftUpperLeg"), [0.2, -0.5, 0.3]);
    const rotation = (weight: number): Float64Array => { h.set("leftLeg", target, { weight }); return h.player.pose.slice(node, node + 4); };
    const dotAbs = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);
    const full = rotation(1), half = rotation(0.5), none = rotation(0);
    expect(none).toEqual(animated);
    const total = 2 * Math.acos(Math.min(1, dotAbs(animated, full)));
    expect(2 * Math.acos(Math.min(1, dotAbs(animated, half)))).toBeCloseTo(total / 2, 9);
    expect(2 * Math.acos(Math.min(1, dotAbs(half, full)))).toBeCloseTo(total / 2, 9);
    h.set("leftLeg", target, { weight: 0 });
    expect(h.player.pose.every((v, i) => v === h.player.pose[i])).toBe(true);
  });
  it("aligns the end joint with a requested orientation and scales it by the rotation weight", () => {
    const rig = humanoidRig({ boneFrames: true });
    const h = new LimbHarness(rig), q = qaxis(unit([0.3, 1, 0.2]), 0.8);
    const target = add(h.rig.bindPosition("leftUpperLeg"), [0.1, -0.7, 0.3]);
    const rotationOf = (options: object): [number, number, number, number] => { h.set("leftLeg", target, options); return h.rot("leftFoot"); };
    const diff = quatAngle;
    const free = rotationOf({}), full = rotationOf({ rotation: q }), half = rotationOf({ rotation: q, rotationWeight: 0.5 });
    expect(diff(full, q)).toBeLessThan(1e-5);
    expect(diff(half, q)).toBeCloseTo(diff(free, q) / 2, 4);
    expect(Math.hypot(...sub(h.pos("leftFoot"), target))).toBeLessThan(1e-5);
    expect(() => h.player.ik.setLimb("x", { limb: "leftLeg", target, rotation: [0, 0, 0, 0] })).toThrow();
  });
  it("approaches full extension smoothly: never past reach, monotone, exactly full reach only without softness", () => {
    const h = new LimbHarness(humanoidRig()), R = h.reach("leftLeg"), hip = h.rig.bindPosition("leftUpperLeg");
    const distance = (m: number, options: object = {}): number => { h.set("leftLeg", add(hip, [0, -m * R, 0]), options); return norm(sub(h.pos("leftFoot"), hip)); };
    let previous = 0;
    for (let m = 0.5; m <= 3; m += 0.05) {
      const d = distance(m);
      expect(d).toBeLessThanOrEqual(R + 1e-6);
      expect(d).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = d;
    }
    expect(distance(0.9)).toBeCloseTo(0.9 * R, 5);
    expect(distance(1.0)).toBeLessThan(R * 0.99);
    expect(distance(2, { softness: 0 })).toBeCloseTo(R, 5);
    expect(h.signedFlexion("leftLeg").flexion).toBeLessThan(1e-3);
    // The published softness function itself.
    const limits = reachLimits(0.45, 0.42, 0, KNEE_MAX_FLEXION, DEFAULT_SOFTNESS);
    expect(softReach(limits.softMax - 1e-3, limits)).toBeCloseTo(limits.softMax - 1e-3, 12);
    expect(softReach(limits.softMax + 1e-3, limits)).toBeLessThan(limits.softMax + 1e-3);
    expect(softReach(10, limits)).toBeCloseTo(limits.max, 9);
    expect(softReach(-1, limits)).toBeGreaterThanOrEqual(limits.min);
    expect(softReach(5, reachLimits(0.45, 0.42, 0, KNEE_MAX_FLEXION, 0))).toBeCloseTo(0.87, 12);
  });
  it("honours custom flexion ranges at both ends", () => {
    const rig = humanoidRig(), h = new LimbHarness(rig), [a, b] = rig.lengths.leftLeg, hip = rig.bindPosition("leftUpperLeg");
    h.set("leftLeg", hip, { flexion: { min: 0, max: Math.PI / 2 }, softness: 0 });
    expect(h.signedFlexion("leftLeg").flexion).toBeCloseTo(Math.PI / 2, 4);
    expect(norm(sub(h.pos("leftFoot"), hip))).toBeCloseTo(Math.hypot(a, b), 5);
    h.set("leftLeg", add(hip, [0, -2, 0]), { flexion: { min: 0.35, max: 2 }, softness: 0 });
    expect(h.signedFlexion("leftLeg").flexion).toBeCloseTo(0.35, 4);
  });
  it("supports a uniformly scaled rig and rejects genuine anisotropy, but tolerates float32 scale round-off", () => {
    const rig = humanoidRig({ rigScale: 2.5, boneFrames: true }), h = new LimbHarness(rig);
    const target = add(rig.bindPosition("leftUpperLeg"), [0.2, -0.6, 0.25]);
    h.set("leftLeg", target);
    expect(norm(sub(h.pos("leftFoot"), target))).toBeLessThan(1e-5);
    const hips = rig.nodeIndex("hips") * 10;
    h.player.setProceduralOverride(pose => { pose[hips + 8] = Math.fround(1 + 1.5e-6); pose[hips + 9] = Math.fround(1 - 1.5e-6); });
    h.set("leftLeg", target);
    expect(norm(sub(h.pos("leftFoot"), target))).toBeLessThan(1e-4);
    h.player.setProceduralOverride(pose => { pose[hips + 7] = 1.2; });
    expect(() => h.set("leftLeg", target)).toThrow(/uniform/);
    h.player.setProceduralOverride(undefined);
    h.player.setProceduralOverride(pose => { pose[3 * 0 + 8] = 2; });
    // The skeleton root is an ancestor of every limb.
    expect(() => h.set("leftLeg", target)).toThrow(/uniform/);
  });
  it("produces finite poses for degenerate targets on every rig", () => {
    for (const c of evidenceRigs()) for (const limb of LIMBS) expect(measureDegenerate(c, limb), `${c.id} ${limb}`).toMatchObject({ nonFinite: 0 });
  });
  it("is stable with a zero target distance and falls back to the current end direction", () => {
    const h = new LimbHarness(humanoidRig({ kneeBind: 25 })), hip = h.rig.bindPosition("leftUpperLeg");
    h.set("leftLeg", hip);
    expect(h.player.pose.every(Number.isFinite)).toBe(true);
    const beyond = measureBeyondReach(evidenceRigs()[0]!, "leftArm", 8);
    expect(beyond.monotoneViolations).toBe(0);
  });
  it("runs after procedural overrides and before CCD constraints, which refine the limb result", () => {
    const rig = humanoidRig(), h = new LimbHarness(rig), leg = rig.nodeIndex("leftUpperLeg") * 10 + 3;
    h.player.setProceduralOverride(pose => { pose.set(qaxis([1, 0, 0], 0.8), leg); });
    const target = add(rig.bindPosition("leftUpperLeg"), [0, -0.6, 0.2]);
    h.set("leftLeg", target);
    expect(norm(sub(h.pos("leftFoot"), target))).toBeLessThan(1e-5); // override cannot defeat the goal
    const hand = add(rig.bindPosition("leftUpperArm"), [0.1, -0.1, 0.35]), ccd = add(rig.bindPosition("leftUpperArm"), [0.05, -0.2, 0.3]);
    h.player.ik.setLimb("arm", { limb: "leftArm", target: hand });
    h.player.ik.set("grip", { chain: [rig.names.leftUpperArm, rig.names.leftLowerArm, rig.names.leftHand], target: ccd, iterations: 48, tolerance: 1e-5 });
    h.player.evaluate();
    // Same limb, two goals: the CCD constraint is evaluated last and wins.
    expect(norm(sub(h.pos("leftHand"), ccd))).toBeLessThan(1e-3);
    expect(norm(sub(h.pos("leftFoot"), target))).toBeLessThan(1e-5);
  });
  it("reports flexion and residual in the inspection", () => {
    const rig = humanoidRig(), h = new LimbHarness(rig), hip = rig.bindPosition("leftUpperLeg");
    h.player.ik.setLimb("l", { limb: "leftLeg", target: add(hip, [0, -0.5, 0.1]), pole: [0, 0, 1], softness: 0.1 });
    expect(h.player.inspect().limbs![0]!.flexion).toBeNull();
    h.player.evaluate();
    const info = h.player.inspect().limbs![0]!;
    expect(info.flexion).toBeCloseTo(h.signedFlexion("leftLeg").flexion, 4);
    expect(info.residual).toBeLessThan(1e-9);
    expect(info).toMatchObject({ id: "l", limb: "leftLeg", weight: 1, softness: 0.1, pole: { x: 0, y: 0, z: 1 }, nodes: [rig.nodeIndex("leftUpperLeg"), rig.nodeIndex("leftLowerLeg"), rig.nodeIndex("leftFoot")] });
    h.player.ik.setLimb("l", { limb: "leftLeg", target: add(hip, [0, -3, 0]) });
    h.player.evaluate();
    expect(h.player.inspect().limbs![0]!.residual).toBeGreaterThan(2);
  });
  it("is deterministic and allocation-light enough to evaluate thousands of limbs", () => {
    const h = new LimbHarness(humanoidRig({ boneFrames: true })), hip = h.rig.bindPosition("rightUpperLeg");
    const poses: Float64Array[] = [];
    for (const repeat of [0, 1]) {
      for (let i = 0; i < 300; i++) { h.set("rightLeg", add(hip, mul(unit(sphere(i, 300)), 0.6))); if (repeat === 0 && i === 299) poses.push(h.player.pose.slice()); }
      if (repeat === 1) expect(h.player.pose).toEqual(poses[0]);
    }
  });
});

describe("foot placement", () => {
  const stance = (extra = {}) => humanoidRig({ kneeBind: 34, ...extra });
  it("leaves the pose untouched when the ground is the animated ground and the legs are in reach", () => {
    const h = new LimbHarness(stance({ boneFrames: true })), before = h.player.pose.slice();
    h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, smoothing: 0 });
    h.player.evaluate();
    h.player.pose.forEach((v, i) => expect(Math.abs(v - before[i]!)).toBeLessThan(1e-9));
    expect(h.player.inspect().footPlacement).toMatchObject({ requiredDrop: 0, drop: 0 });
  });
  it("lowers the hips by the independent minimum when the ground drops away under either foot, never raises them, and puts both feet on their targets", () => {
    const rig = stance(), h = new LimbHarness(rig), up = unit(rig.up);
    const animated = h.pos("hips"), ankles: V[] = [h.pos("leftFoot"), h.pos("rightFoot")], uppers: V[] = [h.pos("leftUpperLeg"), h.pos("rightUpperLeg")];
    const reaches = (["leftLeg", "rightLeg"] as const).map(limb => { const [a, b] = rig.lengths[limb], R = a + b, min = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(KNEE_MAX_FLEXION)); return R - DEFAULT_SOFTNESS * (R - min); });
    for (const [left, right] of [[-0.1, 0], [0, -0.2], [-0.3, -0.05], [-0.15, -0.15], [0.1, 0], [0.2, 0.3]] as const) {
      h.player.ik.setFootPlacement({ left: { height: left }, right: { height: right }, smoothing: 0 });
      h.player.evaluate();
      const targets = [left, right].map((height, i) => add(ankles[i]!, mul(up, Math.max(height, height + 0.04 - dot(ankles[i]!, up))))) as V[];
      const expected = referenceDrop(uppers, targets, up, reaches), drop = dot(sub(animated, h.pos("hips")), up);
      expect(drop, `${left} ${right}`).toBeCloseTo(expected, 5);
      expect(drop).toBeGreaterThanOrEqual(-1e-7);
      if (Math.min(left, right) >= 0) expect(drop).toBeLessThan(1e-7);
      expect(norm(sub(h.pos("leftFoot"), targets[0]!))).toBeLessThan(1e-5);
      expect(norm(sub(h.pos("rightFoot"), targets[1]!))).toBeLessThan(1e-5);
    }
  });
  it("solves the closed form of the minimum drop", () => {
    expect(minimumDrop([0, -1, 0], [0, 1, 0], 0.8)).toBeCloseTo(0.2, 12);
    expect(minimumDrop([0, -0.5, 0], [0, 1, 0], 0.8)).toBe(0);
    expect(minimumDrop([0.6, -0.9, 0], [0, 1, 0], 0.8)).toBeCloseTo(0.9 - Math.sqrt(0.64 - 0.36), 12);
    expect(minimumDrop([2, 0, 0], [0, 1, 0], 0.8)).toBe(0); // no drop can reach: the least bad one
    expect(minimumDrop([0.7, 0.3, 0], [0, 1, 0], 0.8)).toBe(0); // higher target: lowering cannot help
    expect(minimumDrop([0, -1, 0], [0, 1, 0], 0.8) + minimumDrop([0, -0.4, 0], [0, 1, 0], 0.8)).toBeGreaterThan(0);
  });
  it("follows a moving animated pose: feet stay on the animated feet, the drop equals the independent minimum, and a step down adds to it", () => {
    const rig = withWalkClip(humanoidRig()), h = new LimbHarness(rig), twin = new LimbHarness(rig), up = unit(rig.up);
    h.player.transition("walk", 0, true, 1); twin.player.transition("walk", 0, true, 1);
    h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, smoothing: 0 });
    const reaches = (["leftLeg", "rightLeg"] as const).map(limb => { const [a, b] = rig.lengths[limb], R = a + b, min = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(KNEE_MAX_FLEXION)); return R - DEFAULT_SOFTNESS * (R - min); });
    let lowered = 0, kept = 0;
    for (let k = 0; k < 40; k++) {
      h.player.advance(0.025); twin.player.advance(0.025);
      const uppers: V[] = [twin.pos("leftUpperLeg"), twin.pos("rightUpperLeg")], feet: V[] = [twin.pos("leftFoot"), twin.pos("rightFoot")];
      const drop = dot(sub(twin.pos("hips"), h.pos("hips")), up), expected = referenceDrop(uppers, feet, up, reaches);
      expect(drop).toBeCloseTo(expected, 5);
      expect(norm(sub(h.pos("leftFoot"), feet[0]!))).toBeLessThan(1e-5);
      expect(norm(sub(h.pos("rightFoot"), feet[1]!))).toBeLessThan(1e-5);
      if (drop > 1e-6) lowered++; else kept++;
    }
    expect(lowered).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
    // A step down of 25 cm under the left foot lowers the hips further.
    const before = dot(sub(twin.pos("hips"), h.pos("hips")), up);
    h.player.ik.setFootPlacement({ left: { height: -0.25 }, right: { height: 0 }, smoothing: 0 });
    h.player.evaluate();
    const feet: V[] = [twin.pos("leftFoot"), twin.pos("rightFoot")], uppers: V[] = [twin.pos("leftUpperLeg"), twin.pos("rightUpperLeg")];
    const stepped = dot(sub(twin.pos("hips"), h.pos("hips")), up);
    expect(stepped).toBeGreaterThan(before);
    expect(stepped).toBeCloseTo(referenceDrop(uppers, [add(feet[0]!, [0, -0.25, 0]), feet[1]!], up, reaches), 5);
  });
  it("blends continuously and monotonically with the contact weight and ignores a foot with weight zero", () => {
    const rig = stance(), h = new LimbHarness(rig), hips = h.pos("hips");
    const drops: number[] = [];
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      h.player.ik.setFootPlacement({ left: { height: -0.2, weight: w }, right: { height: 0 }, smoothing: 0 });
      h.player.evaluate();
      drops.push(hips[1] - h.pos("hips")[1]);
    }
    expect(drops[0]).toBeLessThan(1e-7);
    for (let i = 1; i < drops.length; i++) expect(drops[i]!).toBeGreaterThan(drops[i - 1]! - 1e-9);
    expect(drops[4]!).toBeGreaterThan(0.15);
    // Weight zero on a foot leaves that leg exactly as animated.
    h.player.ik.setFootPlacement({ left: { height: -0.2, weight: 0 }, right: { height: -0.1 }, smoothing: 0 });
    h.player.evaluate();
    const baseline = new LimbHarness(rig);
    const at = rig.nodeIndex("leftUpperLeg") * 10;
    for (let c = 0; c < 10; c++) expect(h.player.pose[at + c]).toBeCloseTo(baseline.player.pose[at + c]!, 12);
  });
  it("caps the drop at maxDrop and reports the shortfall", () => {
    const h = new LimbHarness(stance());
    h.player.ik.setFootPlacement({ left: { height: -0.3 }, right: { height: -0.3 }, smoothing: 0, maxDrop: 0.05 });
    h.player.evaluate();
    const info = h.player.inspect().footPlacement!;
    expect(info.drop).toBeCloseTo(0.05, 12);
    expect(info.requiredDrop).toBeGreaterThan(0.2);
    expect(info.left.residual).toBeGreaterThan(0.1);
    expect(h.player.pose.every(Number.isFinite)).toBe(true);
    expect(() => h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, maxDrop: -1 })).toThrow(/maximum drop/);
  });
  it("smooths the drop exponentially with a time constant, even with no clock running, and initialises without lag", () => {
    const h = new LimbHarness(stance()), tau = 0.1, dt = 1 / 60;
    h.player.ik.setFootPlacement({ left: { height: -0.2 }, right: { height: -0.2 }, smoothing: tau });
    h.player.evaluate();
    const D = h.player.inspect().footPlacement!.requiredDrop;
    expect(h.player.inspect().footPlacement!.drop).toBe(D); // first evaluation: no lag
    h.player.ik.setFootPlacement({ left: { height: 0 }, right: { height: 0 }, smoothing: tau });
    h.player.evaluate();
    expect(h.player.inspect().footPlacement!.drop).toBe(D); // state survives replacement; it eases back
    h.player.evaluate(); h.player.evaluate();
    expect(h.player.inspect().footPlacement!.drop).toBe(D); // evaluation alone never advances time
    for (let k = 1; k <= 60; k++) {
      h.player.advance(dt);
      expect(h.player.inspect().footPlacement!.drop).toBeCloseTo(D * Math.exp(-(k * dt) / tau), 9);
    }
    expect(h.player.inspect().footPlacement!.requiredDrop).toBe(0);
    for (let k = 0; k < 200; k++) h.player.advance(dt);
    expect(h.player.inspect().footPlacement!.drop).toBe(0);
    const pose = h.player.pose.slice();
    h.player.advance(dt);
    expect(h.player.pose).toEqual(pose);
  });
  it("validates the placement description", () => {
    const h = new LimbHarness(stance()), place = (left: object, right: object = { height: 0 }, extra: object = {}): void => h.player.ik.setFootPlacement({ left, right, ...extra } as never);
    expect(() => place({})).toThrow(/exactly one/);
    expect(() => place({ height: 0, point: [0, 0, 0] })).toThrow(/exactly one/);
    expect(() => place({ height: Number.NaN })).toThrow(/finite/);
    expect(() => place({ point: [0, 0] })).toThrow(/three/);
    expect(() => place({ height: 0, weight: 2 })).toThrow(/weight/);
    expect(() => place({ height: 0, normal: [0, 0, 0] })).toThrow(/normal/);
    expect(() => place({ height: 0 }, { height: 0 }, { smoothing: -1 })).toThrow(/Invalid foot placement/);
    expect(() => place({ height: 0 }, { height: 0 }, { softness: 0.9 })).toThrow(/Invalid foot placement/);
    expect(() => place({ height: 0 }, { height: 0 }, { soleOffset: -0.1 })).toThrow(/Invalid foot placement/);
  });
  it("uses the sole offset and ground level: planted points sit sole-high along the normal, and the foot never sinks into the ground", () => {
    const rig = stance(), h = new LimbHarness(rig);
    const normal: V = unit([0, 1, -0.5]);
    h.player.ik.setFootPlacement({ left: { point: [0.09, 0.1, 0.1], normal }, right: { height: -0.2 }, smoothing: 0, soleOffset: 0.05 });
    h.player.evaluate();
    expect(norm(sub(h.pos("leftFoot"), add([0.09, 0.1, 0.1], mul(normal, 0.05))))).toBeLessThan(1e-5);
    // Height mode: a lower ground never lifts the foot above its animated lift; a high one lifts it to the floor.
    h.player.ik.setFootPlacement({ left: { height: 0.3 }, right: { height: 0 }, smoothing: 0, soleOffset: 0.2 });
    h.player.evaluate();
    expect(h.pos("leftFoot")[1]).toBeGreaterThanOrEqual(0.3 + 0.2 - 1e-5);
    // Height mode: the foot keeps its lift and follows the ground difference; the sole offset only sets the floor.
    const animatedHeight = h.rig.bindPosition("leftFoot")[1];
    h.player.ik.setFootPlacement({ left: { height: 0.02 }, right: { height: 0 }, smoothing: 0, soleOffset: 0.01 });
    h.player.evaluate();
    expect(h.pos("leftFoot")[1]).toBeCloseTo(animatedHeight + 0.02, 5);
    h.player.ik.setFootPlacement({ left: { height: 0.02 }, right: { height: 0 }, smoothing: 0, soleOffset: 0.06 });
    h.player.evaluate();
    expect(h.pos("leftFoot")[1]).toBeCloseTo(0.08, 5);
    // A ground level other than 0 shifts what counts as "the same ground": height 0.04 over level 0.02 is a 2 cm rise too.
    h.player.ik.setFootPlacement({ left: { height: 0.04 }, right: { height: 0 }, smoothing: 0, soleOffset: 0.01, groundLevel: 0.02 });
    h.player.evaluate();
    expect(h.pos("leftFoot")[1]).toBeCloseTo(animatedHeight + 0.02, 5);
  });
  it("keeps the lowered hips when the hips own root motion", () => {
    const rig = stance(), h = new LimbHarness(rig), hipsNode = rig.nodeIndex("hips");
    const bindHips = rig.skin.nodes[hipsNode]!.translation;
    h.player.setRootMotion(rig.names.hips);
    h.player.ik.setFootPlacement({ left: { height: -0.2 }, right: { height: -0.2 }, smoothing: 0 });
    h.player.evaluate();
    const drop = h.player.inspect().footPlacement!.drop;
    expect(drop).toBeGreaterThan(0.1);
    expect(h.player.pose[hipsNode * 10 + 1]).toBeCloseTo(bindHips[1]! - drop, 12);
    expect(h.player.pose[hipsNode * 10]).toBeCloseTo(bindHips[0]!, 12);
  });
  it("works in a scaled, rotated, Z-up rig: the drop is in mesh-local units", () => {
    const [, framed] = evidenceRigs();
    const rig = humanoidRig({ kneeBind: 34, rigScale: 2.5, rigRotation: qmul(qaxis([0, 1, 0], 0.7), qaxis([1, 0, 0], 0.2)), meshRotation: qaxis([1, 0, 0], -Math.PI / 2), boneFrames: true });
    void framed;
    const h = new LimbHarness(rig), plain = new LimbHarness(stance({ boneFrames: true }));
    for (const x of [h, plain]) { x.player.ik.setFootPlacement({ left: { height: -0.12 }, right: { height: 0 }, smoothing: 0 }); x.player.evaluate(); }
    expect(h.player.inspect().footPlacement!.drop).toBeCloseTo(plain.player.inspect().footPlacement!.drop, 6);
  });
});
