import { describe, expect, it } from "vitest";
import { animatedSkin } from "../test-support/animated-skin.js";
import { retargetSkin } from "./retarget.js";
import { SkeletonPlayer } from "./skeleton.js";

describe("explicit world-frame retargeting", () => {
  it("accepts node names that coincide with Object prototype properties", () => {
    const original=animatedSkin(),nodes=original.nodes.map(node=>({...node}));
    nodes[1]={...nodes[1]!,name:"constructor"};
    const source={...original,nodes};
    const result=retargetSkin(source,source,{constructor:"constructor",elbow:"elbow",hand:"hand"},{rotationSpace:"world"});
    const rig=new SkeletonPlayer(result,"walk");rig.advance(0.5);
    expect(rig.jointPosition("constructor").x).toBeCloseTo(1);
  });
  it("preserves world rotation deltas across differently oriented parent bind frames", () => {
    const source = animatedSkin();
    const nodes = source.nodes.map(node => ({ ...node }));
    nodes[1] = { ...nodes[1]!, rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
    const target = { ...source, nodes, clips: [] };
    const transferred = retargetSkin(source,target,{root:"root",elbow:"elbow",hand:"hand"},{rotationSpace:"world"});
    const rig = new SkeletonPlayer(transferred,"action"); rig.advance(0.5);
    // Source action at half time is Rz(pi/2). Desired target global orientation
    // is Rz(pi/2) * Ry(pi/2), with quaternion (-.5,.5,.5,.5).
    const actual = rig.jointRotation("elbow");
    const expected = [-0.5,0.5,0.5,0.5];
    const dot = actual.x*expected[0]!+actual.y*expected[1]!+actual.z*expected[2]!+actual.w*expected[3]!;
    expect(Math.abs(dot)).toBeCloseTo(1,6);
    const original = source.clips[1]!.channels[0]!.values;
    expect(original).toEqual([0,0,0,1,0,0,1,0]);
    expect(transferred.joints).toBe(target.joints);
  });
  it("permits static helper bones while preserving the mapped ancestor graph", () => {
    const source = animatedSkin();
    const nodes = source.nodes.map(node => ({ ...node }));
    nodes.push({name:"helper",parent:1,translation:[0,0,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[1,1,1]});
    nodes[2] = {...nodes[2]!,parent:4};
    const result = retargetSkin(source,{...source,nodes},{root:"root",elbow:"elbow",hand:"hand"},{rotationSpace:"world"});
    const rig = new SkeletonPlayer(result,"action"); rig.advance(0.5);
    // The helper contributes a bind quarter-turn; the source adds another quarter-turn.
    expect(Math.abs(rig.jointRotation("elbow").z)).toBeCloseTo(1);
    expect(() => retargetSkin(source,{...source,nodes},{root:"root",elbow:"elbow",hand:"hand"})).toThrow(/parent/);
  });
  it("rotates translation axes into the target parent frame and applies explicit per-node scales", () => {
    const source = animatedSkin();
    const nodes = source.nodes.map(node => ({ ...node }));
    nodes[1] = {...nodes[1]!,rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]};
    const result = retargetSkin(source,{...source,nodes},{root:"root",elbow:"elbow",hand:"hand"},{rotationSpace:"world",nodeTranslationScales:{elbow:2}});
    const rig = new SkeletonPlayer(result,"breathe"); rig.advance(0.5);
    // Source motion is +Y; the target parent's +Z quarter-turn requires local +X.
    expect(rig.pose[20]).toBeCloseTo(2);
    expect(rig.pose[21]).toBeCloseTo(0);
    expect(() => retargetSkin(source,source,{root:"root",elbow:"elbow",hand:"hand"},{nodeTranslationScales:{elbow:0}})).toThrow(/scale/);
  });
});
