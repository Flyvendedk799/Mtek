import { describe, expect, it } from "vitest";
import type { MtekSkin } from "../abi/manifest-types.js";
import { identity } from "../math/mat4.js";
import { deformSkin } from "../mesh/skinning.js";
import { AnimationPlayers, SkeletonPlayer, skinProblem } from "./skeleton.js";

function fixture() {
  const node = (name: string, parent: number, x: number) => ({ name, parent,
    translation: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] });
  const inverse = Array.from(identity()); inverse[12] = -2;
  return { meshNode: 0, nodes: [node("mesh", -1, 0), node("root", -1, 1), node("hand", 1, 1)],
    joints: [2], inverseBind: [inverse], indices: [[0, 0, 0, 0]], weights: [[1, 0, 0, 0]],
    clips: [{ name: "reach", duration: 1, channels: [{ node: 1, path: "translation", interpolation: "linear", times: [0, 1], values: [1, 0, 0, 3, 0, 0] }] },
      { name: "rest", duration: 1, channels: [] }] } satisfies MtekSkin;
}

describe("skeletal animation", () => {
  it("preserves bind vertices, composes parent motion and exposes mesh-local sockets", () => {
    const skin = fixture(); expect(skinProblem(skin, 1)).toBeUndefined();
    expect(new SkeletonPlayer(skin, "missing").jointPosition("hand").x).toBe(2);
    const rig = new SkeletonPlayer(skin, "reach");
    const source = new Float32Array([2, 1, 0]), output = new Float32Array(3), normals = new Float32Array(3);
    deformSkin(skin, rig.palette, source, undefined, output, normals);
    expect([...output]).toEqual([2, 1, 0]);
    rig.advance(.5);
    deformSkin(skin, rig.palette, source, undefined, output, normals);
    expect([...output]).toEqual([3, 1, 0]);
    expect(rig.jointPosition("hand")).toEqual({ x: 3, y: 0, z: 0 });
    expect(rig.jointRotation("hand")).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect([...source]).toEqual([2, 1, 0]);
  });

  it("removes the mesh-node transform from the palette and sockets", () => {
    const skin = fixture(); skin.nodes[0]!.translation = [5, 0, 0];
    const rig = new SkeletonPlayer(skin);
    expect(rig.palette[12]).toBe(-5);
    expect(rig.jointPosition("hand").x).toBe(-3);
  });

  it("crossfades continuously, including an interrupted transition", () => {
    const rig = new SkeletonPlayer(fixture(), "reach"); rig.advance(.5);
    rig.transition("rest", .4, true, 1);
    expect(rig.jointPosition("hand").x).toBe(3);
    rig.advance(.2); expect(rig.jointPosition("hand").x).toBeCloseTo(2.7);
    rig.transition("reach", .2, false, 1);
    expect(rig.jointPosition("hand").x).toBeCloseTo(2.7);
    rig.advance(.2); expect(rig.jointPosition("hand").x).toBeCloseTo(2.4);
    rig.advance(1); expect(rig.clock.finished(0)).toBe(true);
    const revision = rig.revision; rig.advance(1); expect(rig.revision).toBe(revision);
    expect(rig.transition("missing", 0, false, 1)).toBe(false);
  });

  it("copies a displayed pose into a compatible independent rig and blends into a fall", () => {
    const source=new SkeletonPlayer(fixture(),"reach"), body=new SkeletonPlayer(fixture(),"rest");
    source.advance(.5); expect(body.copyPose(source)).toBe(true);
    expect(body.jointPosition("hand").x).toBe(3);
    source.advance(.2); body.advance(.2);
    expect(body.jointPosition("hand").x).toBe(3);
    expect(body.clock.playing(0)).toBe(false);
    body.transition("rest",.2,false,1); expect(body.jointPosition("hand").x).toBe(3);
    body.advance(.1); expect(body.jointPosition("hand").x).toBeCloseTo(2.5);
    body.advance(.1); expect(body.jointPosition("hand").x).toBe(2);
    const incompatible=fixture(); incompatible.nodes[2]!.translation[0]=2;
    expect(body.copyPose(new SkeletonPlayer(incompatible))).toBe(false);
    expect(body.jointPosition("hand").x).toBe(2);
  });

  it("retains outgoing clip weights when starting a moving crossfade", () => {
    const rig=new SkeletonPlayer(fixture(),"reach");rig.advance(.5);
    rig.clock.fade(0,.5,0);rig.evaluate();
    expect(rig.jointPosition("hand").x).toBe(2.5);
    rig.transition("rest",.4,false,1);expect(rig.jointPosition("hand").x).toBe(2.5);
    rig.advance(.2);expect(rig.jointPosition("hand").x).toBeCloseTo(2.35);
  });

  it("keeps instances independent and removes animation on slot reuse", () => {
    const players = new AnimationPlayers(), skin = fixture();
    players.addSkin(1, skin, "reach"); players.addSkin(2, skin, "reach");
    players.pause(2); players.advance(.5, () => undefined);
    expect(players.skin(1)!.jointPosition("hand").x).toBe(3);
    expect(players.skin(2)!.jointPosition("hand").x).toBe(2);
    expect(players.crossed(1, .4)).toBe(true); expect(players.crossed(2, .4)).toBe(false);
    players.remove(1); expect(players.skin(1)).toBeUndefined();
    players.addSkin(1, skin, "rest"); expect(players.time(1)).toBe(0);
  });

  it("uses inverse-transpose normals under nonuniform joint scaling", () => {
    const skin = fixture(), matrix = identity(); matrix[0] = 2;
    const out = new Float32Array(3), normal = new Float32Array(3);
    deformSkin(skin, matrix, new Float32Array([1, 1, 0]), new Float32Array([Math.SQRT1_2, Math.SQRT1_2, 0]), out, normal);
    expect([...out]).toEqual([2, 1, 0]);
    expect(normal[0]).toBeCloseTo(1 / Math.sqrt(5)); expect(normal[1]).toBeCloseTo(2 / Math.sqrt(5));
  });

  it("rejects cycles, bad influences and invalid clip channels", () => {
    const cycle = fixture(); cycle.nodes[1]!.parent = 2;
    expect(skinProblem(cycle, 1)).toMatch(/cyclic/);
    const index = fixture(); index.indices[0]![0] = 1;
    expect(skinProblem(index, 1)).toMatch(/indices/);
    const weights = fixture(); weights.weights[0]![0] = 0;
    expect(skinProblem(weights, 1)).toMatch(/weights/);
    const keys = fixture(); keys.clips[0]!.channels[0]!.times = [1, 0];
    expect(skinProblem(keys, 1)).toMatch(/channel/);
  });
});
