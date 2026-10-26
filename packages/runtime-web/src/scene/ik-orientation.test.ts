import { describe, expect, it } from "vitest";
import { animatedSkin } from "../test-support/animated-skin.js";
import { SkeletonPlayer } from "./skeleton.js";

describe("orientation and hinge-constrained IK", () => {
  it("keeps the end effector at its position while aligning its mesh-space orientation", () => {
    const rig = new SkeletonPlayer(animatedSkin());
    rig.ik.set("grip", { chain: ["root", "elbow", "hand"], target: [1, 1, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], iterations: 32 });
    rig.evaluate();
    expect(rig.jointPosition("hand").x).toBeCloseTo(1, 2);
    expect(rig.jointPosition("hand").y).toBeCloseTo(1, 2);
    const q = rig.jointRotation("hand");
    expect(Math.abs(q.z)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.abs(q.w)).toBeCloseTo(Math.SQRT1_2);
  });
  it("converts orientation from a rotated mesh frame and supports partial orientation weights", () => {
    const source = animatedSkin();
    const nodes = source.nodes.map(node => ({ ...node }));
    nodes[0] = { ...nodes[0]!, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
    const rig = new SkeletonPlayer({ ...source, nodes });
    rig.ik.set("grip", { chain: ["root", "elbow", "hand"], target: [0, 0, 2], rotation: [0, 0, 0, 1] });
    rig.evaluate();
    const q = rig.jointRotation("hand");
    expect(Math.abs(q.w)).toBeCloseTo(1);
    expect(Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z)).toBeLessThan(1e-5);
    const partial = new SkeletonPlayer(animatedSkin());
    partial.ik.set("grip", { chain: ["root", "elbow", "hand"], target: [2, 0, 0], rotation: [0, 0, 1, 0], rotationWeight: 0.5 });
    partial.evaluate();
    expect(Math.abs(partial.jointRotation("hand").z)).toBeCloseTo(Math.SQRT1_2);
  });
  it("bounds an unreachable target with bind-relative hinges and snapshots caller limits", () => {
    const rig = new SkeletonPlayer(animatedSkin());
    const axis: [number, number, number] = [0, 0, 2];
    const root = { axis, min: -0.2, max: 0.2 }, elbow = { axis, min: 0, max: 0.5 };
    rig.ik.set("limited", { chain: ["root", "elbow", "hand"], target: [-2, 1, 0], iterations: 32, limits: { root, elbow } });
    root.max = 3; axis[2] = 0;
    rig.evaluate();
    const angle = (node: number): number => 2 * Math.atan2(rig.pose[node * 10 + 5]!, rig.pose[node * 10 + 6]!);
    expect(angle(1)).toBeLessThanOrEqual(0.2 + 1e-8);
    expect(angle(1)).toBeGreaterThanOrEqual(-0.2 - 1e-8);
    expect(angle(2)).toBeGreaterThanOrEqual(0);
    expect(angle(2)).toBeLessThanOrEqual(0.5 + 1e-8);
    expect(rig.pose.every(Number.isFinite)).toBe(true);
  });
  it("clamps end orientation to its hinge and rejects ambiguous scale or invalid input", () => {
    const rig = new SkeletonPlayer(animatedSkin());
    const options = { chain: ["root", "elbow", "hand"], target: [2, 0, 0] as const };
    rig.ik.set("limited", { ...options, rotation: [0, 0, 1, 0], limits: { hand: { axis: [0, 0, 1], min: 0, max: 0.4 } } });
    rig.evaluate();
    expect(2 * Math.atan2(rig.pose[35]!, rig.pose[36]!)).toBeCloseTo(0.4);
    expect(() => rig.ik.set("bad", { ...options, rotation: [0, 0, 0, 0] })).toThrow(/orientation/);
    expect(() => rig.ik.set("bad", { ...options, limits: { missing: { axis: [0, 0, 1], min: 0, max: 1 } } })).toThrow(/hinge/);
    rig.setProceduralOverride(pose => { pose[17] = 2; });
    expect(() => rig.evaluate()).toThrow(/uniform/);
  });
});
