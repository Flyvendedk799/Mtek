import { describe, expect, it } from "vitest";
import type { MtekSkin } from "../abi/manifest-types.js";
import { animatedSkin } from "../test-support/animated-skin.js";
import { AnimationPlayers, SkeletonPlayer } from "./skeleton.js";
import { createAnimationController } from "../animation.js";
import { PoseSchedule } from "./pose-schedule.js";

function skin(): MtekSkin {
  const original = animatedSkin();
  return { ...original, clips: [
    ...original.clips,
    { name: "run", duration: 0.5, channels: [{ node: 1, path: "translation", interpolation: "linear", times: [0, 0.5], values: [0, 0, 0, 4, 0, 0] }] },
  ] };
}
const samples = [{ clip: "walk", threshold: 1 }, { clip: "run", threshold: 3 }];

describe("phase-synchronized locomotion", () => {
  it("routes mounted playback, pause, seek, markers, fade and non-looping completion through the blend", () => {
    const players = new AnimationPlayers(); players.addSkin(0,skin());
    const rig = players.skin(0)!;
    rig.locomotion.set({samples,parameter:2}); rig.setRootMotion("root");
    expect(players.duration(0)).toBeCloseTo(2/3);
    players.advance(0.2,()=>undefined);
    expect(players.time(0)).toBeCloseTo(0.2);
    expect(players.crossed(0,0.1)).toBe(true);
    const movement = rig.consumeRootMotion().x;
    expect(movement).toBeCloseTo(0.9);
    expect(players.pause(0)).toBe(true); players.advance(0.5,()=>undefined);
    expect(players.playing(0)).toBe(false);
    expect(rig.consumeRootMotion().x).toBe(0);
    expect(players.time(0)).toBeCloseTo(0.2);
    expect(players.seek(0,1/3)).toBe(true); rig.evaluate();
    expect(rig.locomotion.phase).toBeCloseTo(0.5);
    expect(rig.consumeRootMotion().x).toBe(0);
    expect(players.resume(0)).toBe(true);
    expect(players.play(0,false,1)).toBe(true);
    players.advance(2,()=>undefined);
    expect(players.finished(0)).toBe(true);
    expect(rig.consumeRootMotion().x).toBeCloseTo(3);
    expect(rig.locomotion.phase).toBe(1);
    expect(players.resume(0)).toBe(false);
    expect(players.play(0,true,1)).toBe(true);
    rig.setRootMotion(undefined);
    players.fade(0,0.5,0); players.advance(0.2,()=>undefined);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.45);
  });
  it("blends clips of different lengths at the same cycle and clamps outer parameters", () => {
    const rig = new SkeletonPlayer(skin());
    rig.locomotion.set({ samples, parameter: 2 });
    rig.advance(0.2);
    expect(rig.locomotion.phase).toBeCloseTo(0.3);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.9);
    expect(rig.locomotion.crossed("walk",0.2)).toBe(true);
    expect(rig.locomotion.crossed("run",0.1)).toBe(true);
    rig.locomotion.setParameter(-10); rig.evaluate();
    expect(rig.locomotion.crossed("run",0.1)).toBe(true);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.6);
    rig.locomotion.setParameter(100); rig.evaluate();
    expect(rig.jointPosition("root").x).toBeCloseTo(1.2);
    expect(rig.locomotion.phase).toBeCloseTo(0.3);
  });
  it("advances markers and root motion through hitches and throttling independently of frame partition", () => {
    const a = new SkeletonPlayer(skin()), b = new SkeletonPlayer(skin());
    for (const rig of [a, b]) {
      rig.locomotion.set({ samples, parameter: 2 }); rig.setRootMotion("root");
    }
    a.advance(2.3, false);
    for (const dt of [0.1, 0.4, 0.6, 1.2]) b.advance(dt);
    a.evaluate();
    expect(a.locomotion.phase).toBeCloseTo(b.locomotion.phase);
    expect(a.consumeRootMotion().x).toBeCloseTo(10.35);
    expect(b.consumeRootMotion().x).toBeCloseTo(10.35);
    expect(a.consumeRootMotion().x).toBe(0);
    expect(a.locomotion.crossed("walk", 0.7)).toBe(true);
    expect(a.locomotion.crossed("run", 0.35)).toBe(true);
    expect(a.jointPosition("root").x).toBe(0);
    a.locomotion.seek(0.2); a.advance(0);
    expect(a.locomotion.crossed("walk", 0.2)).toBe(false);
    expect(a.consumeRootMotion().x).toBe(0);
  });
  it("composes layers, IK and continuous interruption without applying an additive layer twice", () => {
    const rig = new SkeletonPlayer(skin());
    rig.locomotion.set({ samples, parameter: 2 });
    rig.layers.set("breathing", { clip: "breathe", weight: 0.5, additive: true });
    rig.advance(0.2);
    const before = rig.pose.slice();
    expect(rig.transition("action", 0.5, true, 1)).toBe(true);
    expect(rig.locomotion.active).toBe(false);
    for (let i = 0; i < before.length; i++) expect(rig.pose[i]).toBeCloseTo(before[i]!, 7);
  });
  it("uses bind defaults for absent channels and shortest-arc quaternion blending", () => {
    const original = skin();
    const rotations = { ...original, clips: [
      { name: "a", duration: 1, channels: [{ node: 2, path: "rotation" as const, interpolation: "step" as const, times: [0], values: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }] },
      { name: "b", duration: 1, channels: [{ node: 2, path: "rotation" as const, interpolation: "step" as const, times: [0], values: [0, 0, -Math.SQRT1_2, -Math.SQRT1_2] }] },
    ] };
    const rig = new SkeletonPlayer(rotations);
    rig.locomotion.set({ samples: [{ clip: "a", threshold: 0 }, { clip: "b", threshold: 1 }], parameter: 0.5 });
    rig.advance(0.1);
    expect(rig.jointPosition("hand").x).toBeCloseTo(1);
    expect(rig.jointPosition("hand").y).toBeCloseTo(1);
  });
  it("rejects invalid settings atomically and snapshots sample thresholds", () => {
    const rig = new SkeletonPlayer(skin());
    const mutable = samples.map(sample => ({ ...sample }));
    rig.locomotion.set({ samples: mutable, parameter: 2 });
    mutable[1]!.threshold = -2;
    expect(() => rig.locomotion.set({ samples: mutable })).toThrow(/threshold/);
    expect(() => rig.locomotion.set({ samples, phase: 1 })).toThrow(/phase/);
    expect(() => rig.locomotion.setParameter(NaN)).toThrow(/finite/);
    rig.advance(0.2);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.9);
  });
});

describe("distance-based pose updates", () => {
  it("does not double-sample at floating-point interval boundaries", () => {
    const schedule = new PoseSchedule();
    schedule.set([{distance:0,interval:0.1}]);
    let updates=0;
    for(let i=0;i<100;i++) if(schedule.due(0.01,0)) updates++;
    expect(updates).toBe(10);
  });
  it("keeps clocks, root motion and markers current while skipping poses, then refreshes on approach", () => {
    const controller = createAnimationController(skin(), { clip: "walk", updatePolicy: [{ distance: 0, interval: 0 }, { distance: 10, interval: 0.2 }] });
    controller.player.setRootMotion("root");
    const revision = controller.player.revision;
    expect(controller.update(0.05, false, 20)).toBe(false);
    expect(controller.player.revision).toBe(revision);
    expect(controller.player.clock.time(0)).toBeCloseTo(0.05);
    expect(controller.player.consumeRootMotion().x).toBeCloseTo(0.1);
    expect(controller.update(0.05, false, 5)).toBe(true);
    expect(controller.player.clock.crossed(0, 0.08)).toBe(true);
    controller.setUpdateInterval(0.5);
    expect(controller.update(0.01)).toBe(false);
    expect(controller.update(0, true)).toBe(true);
  });
  it("applies a policy directly to mounted players and copies/validates bands", () => {
    const rig = new SkeletonPlayer(skin(), "walk");
    const bands = [{ distance: 0, interval: 0 }, { distance: 10, interval: 0.2 }];
    rig.setUpdatePolicy(bands); bands[1]!.interval = 0;
    const revision = rig.revision;
    rig.advance(0.05, true, 20); expect(rig.revision).toBe(revision);
    rig.advance(0.15, true, 20); expect(rig.jointPosition("root").x).toBeCloseTo(0.4);
    expect(() => rig.setUpdatePolicy([{ distance: 1, interval: 0 }])).toThrow(/zero/);
    expect(() => rig.setUpdatePolicy([{ distance: 0, interval: -1 }])).toThrow(/interval/);
  });
});
