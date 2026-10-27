import {describe,expect,it} from "vitest";
import type {AnimationInspection,SceneInspection} from "@mtek/runtime-web";
import {buildInspectorOverlay,projectOverlaySegment,type InspectorSpatialSnapshot} from "../src/index.js";

const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
type Mutable<T> = {-readonly [K in keyof T]: T[K]};
const snapshot = (scene: SceneInspection, animation: AnimationInspection | null = null): InspectorSpatialSnapshot => ({status:"ready",selectedId:"actor",scene,animation,error:null});
const scene = (): Mutable<SceneInspection> => ({frame:1,renderable:true,viewport:{width:200,height:100},viewProjection:identity,
  entities:[{id:"actor",parentId:null,worldMatrix:identity}],bodies:[]});
const animation = (): Mutable<AnimationInspection> => ({mode:"clip",clip:"Idle",transition:{elapsed:0,duration:0,progress:1,outgoingClip:null,fromSnapshot:false},rootMotionNode:null,proceduralOverride:false,layers:[],ik:[],locomotion:null,
  nodes:[{index:0,name:"Same name",parent:-1,joint:true,position:{x:0,y:0,z:.5}},{index:1,name:"Same name",parent:0,joint:true,position:{x:.2,y:0,z:.5}}]});

describe("world-space diagnostic overlays", () => {
  it("clips crossing segments to WebGPU planes and rejects the far side of the camera", () => {
    expect(projectOverlaySegment(identity,{x:-2,y:0,z:.5},{x:2,y:0,z:.5})).toEqual([{x:-1,y:0,z:.5},{x:1,y:0,z:.5}]);
    expect(projectOverlaySegment(identity,{x:0,y:0,z:-1},{x:0,y:0,z:1})).toEqual([{x:0,y:0,z:0},{x:0,y:0,z:1}]);
    expect(projectOverlaySegment(identity,{x:0,y:2,z:.5},{x:0,y:3,z:.5})).toBeUndefined();
    // Independent 90-degree perspective: xclip=x, yclip=y, zclip=-2z-2, wclip=-z.
    const perspective = [1,0,0,0,0,1,0,0,0,0,-2,-1,0,0,-2,0];
    expect(projectOverlaySegment(perspective,{x:0,y:0,z:1},{x:0,y:0,z:2})).toBeUndefined();
    const crossing = projectOverlaySegment(perspective,{x:0,y:0,z:1},{x:0,y:0,z:-1.5});
    expect(crossing?.[0].z).toBeCloseTo(0); expect(crossing?.[1].z).toBeCloseTo(2/3);
    expect(projectOverlaySegment(identity,{x:NaN,y:0,z:0},{x:0,y:0,z:0})).toBeUndefined();
  });
  it("uses the complete inherited matrix and node indices, including duplicate node names", () => {
    const s = scene(), a = animation();
    // A parent scale (2,3,1), quarter turn and translation, already composed by the runtime.
    s.entities = [{id:"actor",parentId:"parent",worldMatrix:[0,2,0,0,-3,0,0,0,0,0,1,0,.1,.2,0,1]}];
    const geometry = buildInspectorOverlay(snapshot(s,a),{bounds:false,ik:false,colliders:false,contacts:false});
    expect(geometry.lines).toHaveLength(1);
    expect(geometry.lines[0]!.start.x).toBeCloseTo(.1); expect(geometry.lines[0]!.start.y).toBeCloseTo(.2);
    expect(geometry.lines[0]!.end.x).toBeCloseTo(.1); expect(geometry.lines[0]!.end.y).toBeCloseTo(.6);
  });
  it("renders actual physics poses/extents without scaling the collider with the mesh", () => {
    const s = scene(); s.entities = [{id:"actor",parentId:null,worldMatrix:[9,0,0,0,0,9,0,0,0,0,9,0,20,20,20,1]}];
    s.bodies = [{entityId:"actor",kind:"kinematic",active:true,position:{x:0,y:0,z:.5},rotation:{x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2},collider:{shape:{kind:"box",size:{x:.4,y:.8,z:.4}},sensor:true,friction:.5,restitution:0}}];
    const geometry = buildInspectorOverlay(snapshot(s),{bounds:false,skeleton:false,ik:false,contacts:false});
    expect(geometry.lines).toHaveLength(12); expect(geometry.lines.every(line => line.dashed)).toBe(true);
    const points = geometry.lines.flatMap(line => [line.start,line.end]);
    expect(Math.max(...points.map(p => p.x))).toBeCloseTo(.4); expect(Math.max(...points.map(p => p.y))).toBeCloseTo(.2);
  });
  it("combines supplied world bounds, IK targets and contacts, with a strict output limit", () => {
    const s = scene(), a = animation();
    s.entities = [{id:"actor",parentId:null,worldMatrix:identity,bounds:{source:"authored",culled:false,sphere:{center:{x:0,y:0,z:.5},radius:.2}}}];
    a.ik = [{id:"grip",chain:[0,1],target:{x:.4,y:0,z:.5},weight:1,iterations:12,tolerance:.001,rotationWeight:1,limits:[]}];
    s.bodies = [{entityId:"actor",kind:"static",active:true,position:{x:0,y:0,z:.5},rotation:{x:0,y:0,z:0,w:1},collider:{shape:{kind:"sphere",radius:.1},sensor:false,friction:0,restitution:0},contacts:[{otherId:null,point:{x:0,y:0,z:.4},normal:{x:0,y:1,z:0},distance:-.01}]}];
    const geometry = buildInspectorOverlay(snapshot(s,a));
    for (const kind of ["bounds","skeleton","ik","collider","contact"]) expect(geometry.lines.some(line => line.kind === kind)).toBe(true);
    const limited = buildInspectorOverlay(snapshot(s,a),{maxSegments:5});
    expect(limited.lines).toHaveLength(5); expect(limited.truncated).toBe(true);
    expect(buildInspectorOverlay({...snapshot(s,a),selectedId:null}).lines).toHaveLength(0);
    expect(buildInspectorOverlay({...snapshot(s,a),status:"detached"}).available).toBe(false);
  });
});
