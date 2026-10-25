import { describe, expect, it, vi } from "vitest";
import { createAnimationController, retargetSkin } from "./animation.js";
import { SkeletonPlayer } from "./scene/skeleton.js";
import { animatedSkin } from "./test-support/animated-skin.js";

describe("composable animation API v1", () => {
  it("does not apply persistent layers twice when interrupting a transition or restarting playback",()=>{
    const rig=new SkeletonPlayer(animatedSkin(),"walk");
    rig.layers.set("breath",{clip:"breathe",weight:.5,additive:true});
    rig.layers.set("upper",{clip:"action",weight:.4});
    rig.advance(.5);rig.transition("action",.5,true,1);rig.advance(.15);
    const before=rig.pose.slice();rig.transition("walk",.5,true,1);
    for(let i=0;i<before.length;i++)expect(rig.pose[i],`interrupted pose component ${String(i)}`).toBeCloseTo(before[i]!,8);
    rig.advance(.1);const playing=rig.pose.slice();rig.play(true,1);
    for(let i=0;i<playing.length;i++)expect(rig.pose[i],`restarted pose component ${String(i)}`).toBeCloseTo(playing[i]!,8);
  });
  it("extracts root motion once across loops, hitches and throttled evaluation", () => {
    const rig = new SkeletonPlayer(animatedSkin(), "walk");
    rig.setRootMotion("root");
    rig.advance(2.3, false);
    rig.evaluate();
    expect(rig.jointPosition("root").x).toBe(0);
    expect(rig.consumeRootMotion().x).toBeCloseTo(4.6);
    expect(rig.consumeRootMotion().x).toBe(0);
    rig.clock.pause(0);
    rig.advance(0.2);
    expect(rig.consumeRootMotion().x).toBe(0);
    rig.clock.seek(0, 0.8);
    rig.evaluate();
    expect(rig.consumeRootMotion().x).toBe(0);
    rig.setRootMotion(undefined);
    rig.evaluate();
    expect(rig.jointPosition("root").x).toBeCloseTo(1.6);
  });
  it("layers an upper-body action over locomotion, without resetting phase when weights change", () => {
    const rig = new SkeletonPlayer(animatedSkin(), "walk");
    rig.layers.set("upper", { clip: "action", weight: 1, mask: { elbow: 1 } });
    rig.advance(0.5);
    expect(rig.jointPosition("hand").x).toBeCloseTo(2);
    expect(rig.jointPosition("hand").y).toBeCloseTo(1);
    rig.layers.set("upper", {
      clip: "action",
      weight: 0.5,
      mask: { elbow: 1 },
    });
    rig.evaluate();
    expect(rig.jointPosition("hand").x).toBeCloseTo(2 + Math.SQRT1_2);
    expect(rig.layers.crossed("upper", 0.4)).toBe(true);
    rig.layers.remove("upper");
    rig.evaluate();
    expect(rig.jointPosition("hand").x).toBeCloseTo(3);
  });
  it("adds bind-relative motion and applies procedural overrides after layers", () => {
    const rig = new SkeletonPlayer(animatedSkin(), "walk");
    rig.layers.set("breath", { clip: "breathe", weight: 0.5, additive: true });
    rig.advance(0.5);
    expect(rig.jointPosition("hand")).toEqual({ x: 3, y: 0.25, z: 0 });
    rig.setProceduralOverride((p) => {
      p[2 * 10 + 1] = 0.75;
    });
    rig.evaluate();
    expect(rig.jointPosition("hand").y).toBe(0.75);
    rig.setProceduralOverride(undefined);
    rig.evaluate();
    expect(rig.jointPosition("hand").y).toBe(0.25);
  });
  it("matches layer poses and marker crossings at variable frame rates", () => {
    const a = new SkeletonPlayer(animatedSkin(), "walk"),
      b = new SkeletonPlayer(animatedSkin(), "walk");
    for (const r of [a, b])
      r.layers.set("upper", { clip: "action", weight: 0.8 });
    a.advance(0.7);
    for (const dt of [0.1, 0.03, 0.27, 0.3]) b.advance(dt);
    for (let i = 0; i < a.pose.length; i++)
      expect(a.pose[i]).toBeCloseTo(b.pose[i]!, 7);
    expect(a.layers.crossed("upper", 0.6)).toBe(true);
    expect(b.layers.crossed("upper", 0.6)).toBe(true);
  });
  it("solves a reachable target, handles antiparallel directions and bounds unreachable targets", () => {
    const rig = new SkeletonPlayer(animatedSkin());
    rig.ik.set("grip", {
      chain: ["root", "elbow", "hand"],
      target: [1, 1, 0],
      iterations: 32,
    });
    rig.evaluate();
    expect(rig.jointPosition("hand").x).toBeCloseTo(1, 2);
    expect(rig.jointPosition("hand").y).toBeCloseTo(1, 2);
    rig.ik.set("grip", {
      chain: ["root", "elbow", "hand"],
      target: [-2, 0, 0],
      iterations: 32,
    });
    rig.evaluate();
    // CCD converges slowly at full extension; iteration count bounds work, not residual error.
    expect(Math.abs(rig.jointPosition("hand").x + 2)).toBeLessThan(0.05);
    rig.ik.set("grip", {
      chain: ["root", "elbow", "hand"],
      target: [100, 0, 0],
    });
    rig.evaluate();
    expect(rig.jointPosition("hand").x).toBeCloseTo(2);
    expect(rig.pose.every(Number.isFinite)).toBe(true);
    expect(() =>
      rig.ik.set("bad", { chain: ["root", "hand"], target: [1, 1, 0] }),
    ).toThrow(/contiguous/);
  });
  it("retargets animated transforms onto a different rest proportion and rejects incompatible hierarchies", () => {
    const source = animatedSkin(),
      target = {
        ...animatedSkin(),
        nodes: animatedSkin().nodes.map((n) => ({
          ...n,
          translation: n.translation.map((v) => v * 2),
        })),
      };
    const skin = retargetSkin(
      source,
      target,
      { root: "root", elbow: "elbow", hand: "hand" },
      2,
    );
    const rig = new SkeletonPlayer(skin, "walk");
    rig.advance(0.5);
    expect(rig.jointPosition("hand").x).toBeCloseTo(6);
    expect(() =>
      retargetSkin(source, target, { root: "hand", elbow: "elbow" }),
    ).toThrow(/root|parent/);
    expect(() => retargetSkin(source, target, { root: "root" })).toThrow(
      /Unmapped/,
    );
  });
  it("adapts structural Three.js bones and throttles evaluation without losing clock/marker time", () => {
    const position = { set: vi.fn() },
      quaternion = { set: vi.fn() },
      scale = { set: vi.fn() };
    const controller = createAnimationController(animatedSkin(), {
      clip: "walk",
      updateInterval: 0.1,
      bones: { root: { position, quaternion, scale } },
    });
    expect(controller.update(0.04)).toBe(false);
    expect(controller.player.clock.time(0)).toBe(0.04);
    expect(controller.update(0.07)).toBe(true);
    expect(controller.player.clock.crossed(0, 0.1)).toBe(true);
    expect(position.set.mock.lastCall?.[0]).toBeCloseTo(0.22);
    controller.dispose();
    controller.dispose();
    expect(() => controller.update(0.1)).toThrow(/disposed/);
  });
  it("rejects bad masks, invalid procedural transforms and bad timing", () => {
    const controller = createAnimationController(animatedSkin());
    expect(() =>
      controller.setLayer("bad", {
        clip: "action",
        weight: 1,
        mask: { missing: 1 },
      }),
    ).toThrow(/mask/);
    expect(() =>
      controller.setLayer("bad", { clip: "action", weight: NaN }),
    ).toThrow(/weight/);
    expect(() => controller.update(Infinity)).toThrow(/delta/);
    controller.player.setProceduralOverride((p) => {
      p[3] = 0;
      p[4] = 0;
      p[5] = 0;
      p[6] = 0;
    });
    expect(() => controller.update(0.1)).toThrow(/quaternion/);
  });
});
