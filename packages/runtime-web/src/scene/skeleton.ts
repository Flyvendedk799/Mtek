import type { MtekSkin } from "../abi/manifest-types.js";
import { identity, multiplyInto, fromRotationTranslationScaleInto, normalMatrixInto } from "../math/mat4.js";
import { ClipPlayers, sampleChannelInto, type PlayableChannel, type PlayableClip } from "./clips.js";
import { PoseLayers } from "./pose-layers.js";
import { PoseIK } from "./ik.js";
import { LocomotionBlend } from "./locomotion.js";
import { PoseSchedule, type AnimationUpdateBand } from "./pose-schedule.js";
import type { AnimationInspection } from "./animation-inspection.js";

/** Shared file data, independently evaluated by every entity instance. */
export function skinProblem(skin: MtekSkin, vertices: number): string | undefined {
  const n = skin.nodes.length;
  if(n>256||skin.joints.length>128)return "skin exceeds the 256-node or 128-joint profile";
  const index=(i: number,max: number): boolean => Number.isInteger(i)&&i>=0&&i<max;
  const finite=(values: readonly number[],length: number): boolean => values.length===length&&values.every(Number.isFinite);
  if (!index(skin.meshNode,n) || skin.joints.length===0 || skin.joints.some(j => !index(j,n)) || skin.inverseBind.length !== skin.joints.length
    || skin.inverseBind.some(m=>!finite(m,16))) return "skin node or inverse-bind count is invalid";
  if (skin.indices.length !== vertices || skin.weights.length !== vertices) return "skin influences do not match the vertex count";
  for (let i = 0; i < n; i++) {
    const node = skin.nodes[i]!;
    if ((node.parent!==-1&&!index(node.parent,n)) || !finite(node.translation,3) || !finite(node.rotation,4) || !finite(node.scale,3) || node.scale.some(v => v <= 0) || Math.hypot(...node.rotation) < 1e-8) return "invalid skeletal bind transform";
    let parent = i;
    for (let depth = 0; parent >= 0; depth++) {
      if(!index(parent,n))return "invalid skeletal bind transform";
      if (depth >= n) return "cyclic skeletal hierarchy";
      parent = skin.nodes[parent]!.parent;
    }
  }
  for (let i = 0; i < vertices; i++) {
    const weights = skin.weights[i]!;
    if (skin.indices[i]!.length!==4 || skin.indices[i]!.some(j => !index(j,skin.joints.length)) || !finite(weights,4) || weights.some(w => w < 0) || Math.abs(weights.reduce((a,b) => a+b,0)-1) > 0.001) return "invalid vertex joint indices or weights";
  }
  const names = new Set<string>();
  for (const clip of skin.clips) {
    if (names.has(clip.name)) return "duplicate skeletal clip name";
    if(!Number.isFinite(clip.duration)||clip.duration<0) return "invalid skeletal clip duration";
    names.add(clip.name);
    const channels = new Set<string>();
    for (const c of clip.channels) {
      const key = String(c.node) + c.path;
      if (!index(c.node,n) || channels.has(key) || c.times.length===0 || c.values.length !== c.times.length * (c.path === "rotation" ? 4 : 3) || c.values.some(v=>!Number.isFinite(v))
        || c.times.some((t,i) => !Number.isFinite(t) || t < 0 || t > clip.duration || (i > 0 && t <= c.times[i-1]!))
        || (c.path === "scale" && c.values.some(v => v <= 0))) return "invalid skeletal clip channel";
      if (c.path === "rotation") {
        for (let k=0;k<c.values.length;k+=4) if (Math.hypot(...c.values.slice(k,k+4)) < 1e-8) return "invalid skeletal rotation";
      }
      channels.add(key);
    }
  }
  return undefined;
}

function slerp(out: Float64Array, at: number, a: Float64Array, b: Float64Array, t: number): void {
  let dot = 0;
  for (let i=0;i<4;i++) dot += a[at+i]! * b[at+i]!;
  const sign = dot < 0 ? -1 : 1, angle = Math.acos(Math.min(1,Math.abs(dot))), sin = Math.sin(angle);
  const wa = sin > 1e-6 ? Math.sin((1-t)*angle)/sin : 1-t, wb = sin > 1e-6 ? Math.sin(t*angle)/sin : t;
  for (let i=0;i<4;i++) out[at+i] = a[at+i]! * wa + b[at+i]! * wb * sign;
  const norm = Math.hypot(out[at]!,out[at+1]!,out[at+2]!,out[at+3]!);
  for (let i=0;i<4;i++) out[at+i] = out[at+i]! / norm;
}

export class SkeletonPlayer {
  readonly layers: PoseLayers;
  readonly ik: PoseIK;
  readonly locomotion: LocomotionBlend;
  private readonly schedule = new PoseSchedule();
  private evaluatedLocomotion = -1;
  /** Camera-distance bands; omit to evaluate on every update. Clocks and root motion are never throttled. */
  setUpdatePolicy(bands: readonly AnimationUpdateBand[] | undefined): void { this.schedule.set(bands); }
  private rootNode = -1;
  private readonly rootDelta = new Float64Array(3);
  private readonly rootSample = new Float64Array(4);
  /** Host ownership extracts base-clip translation; the displayed root stays at bind translation. */
  setRootMotion(node: string | undefined): void {
    const index=node===undefined?-1:this.skin.nodes.findIndex(n=>n.name===node);
    if(node!==undefined&&index<0) throw new RangeError(`Unknown root-motion node: ${node}`);
    this.rootNode=index;this.rootDelta.fill(0);this.evaluatedTime=NaN;
  }
  consumeRootMotion(): {x: number;y: number;z: number} {
    const result={x:this.rootDelta[0]!,y:this.rootDelta[1]!,z:this.rootDelta[2]!};this.rootDelta.fill(0);return result;
  }
  /** Final local-pose adjustment, after layers and before world matrices/sockets. */
  private override: ((pose: Float64Array) => void) | undefined;
  private evaluatedLayers = -1;
  private evaluatedIK = -1;
  setProceduralOverride(override: ((pose: Float64Array) => void) | undefined): void {
    this.override = override; this.evaluatedTime = NaN;
  }
  clock = new ClipPlayers();
  private outgoing: { name: string; clock: ClipPlayers } | undefined;
  private held = false;
  readonly palette: Float32Array;
  readonly pose: Float64Array;
  private readonly bind: Float64Array;
  /** Incoming sample during evaluation; unlayered displayed pose between evaluations. */
  private readonly sample: Float64Array;
  private readonly from: Float64Array;
  private readonly locals: Float32Array[];
  private readonly globals: Float32Array[];
  private readonly inverseBind: Float32Array[];
  private readonly paletteEntries: Float32Array[];
  private readonly order: number[] = [];
  private readonly scratch = identity();
  private readonly inverseMesh = identity();
  private readonly product = identity();
  private readonly value = new Float64Array(4);
  private name = "";
  private blendTime = 0;
  private blendDuration = 0;
  private revisionValue = 0;
  private evaluatedTime = NaN;
  private evaluatedBlend = NaN;
  private evaluatedWeight = NaN;
  get revision(): number { return this.revisionValue; }
  /** Copies current evaluated diagnostics. Never advances clocks, consumes root motion or evaluates a pose. */
  inspect(): AnimationInspection {
    const progress = this.blendDuration === 0 ? 1 : Math.min(1, this.blendTime / this.blendDuration);
    return { mode: this.held ? "held" : this.locomotion.active ? "locomotion" : this.name === "" ? "bind" : "clip", clip: this.name || null,
      transition: { elapsed: this.blendTime, duration: this.blendDuration, progress, outgoingClip: this.outgoing?.name ?? null, fromSnapshot: progress < 1 && this.outgoing === undefined },
      rootMotionNode: this.rootNode < 0 ? null : this.rootNode, proceduralOverride: this.override !== undefined,
      nodes: this.skin.nodes.map((node, index) => {
        multiplyInto(this.product, this.inverseMesh, this.globals[index]!);
        return { index, name: node.name, parent: node.parent, joint: this.skin.joints.includes(index),
          position: { x: Math.fround(this.product[12]!), y: Math.fround(this.product[13]!), z: Math.fround(this.product[14]!) } };
      }), layers: this.layers.inspect(), ik: this.ik.inspect(), locomotion: this.locomotion.inspect(),
    };
  }
  jointPosition(name: string): { x: number; y: number; z: number } {
    const i=this.skin.nodes.findIndex(n=>n.name===name);
    if(i<0) return {x:0,y:0,z:0};
    multiplyInto(this.product,this.inverseMesh,this.globals[i]!);
    return {x:Math.fround(this.product[12]!),y:Math.fround(this.product[13]!),z:Math.fround(this.product[14]!)};
  }
  jointRotation(name: string): { x: number; y: number; z: number; w: number } {
    const i=this.skin.nodes.findIndex(n=>n.name===name);
    if(i<0) return {x:0,y:0,z:0,w:1};
    multiplyInto(this.product,this.inverseMesh,this.globals[i]!);
    const m=this.product;
    const sx=Math.hypot(m[0]!,m[1]!,m[2]!),sy=Math.hypot(m[4]!,m[5]!,m[6]!),sz=Math.hypot(m[8]!,m[9]!,m[10]!);
    const a=m[0]!/sx,b=m[4]!/sy,c=m[8]!/sz,d=m[1]!/sx,e=m[5]!/sy,f=m[9]!/sz,g=m[2]!/sx,h=m[6]!/sy,j=m[10]!/sz;
    let x: number,y: number,z: number,w: number;
    const trace=a+e+j;
    if(trace>0){const s=Math.sqrt(trace+1)*2;w=s/4;x=(h-f)/s;y=(c-g)/s;z=(d-b)/s;}
    else if(a>e&&a>j){const s=Math.sqrt(1+a-e-j)*2;w=(h-f)/s;x=s/4;y=(b+d)/s;z=(c+g)/s;}
    else if(e>j){const s=Math.sqrt(1+e-a-j)*2;w=(c-g)/s;x=(b+d)/s;y=s/4;z=(f+h)/s;}
    else {const s=Math.sqrt(1+j-a-e)*2;w=(d-b)/s;x=(c+g)/s;y=(f+h)/s;z=s/4;}
    const n=Math.hypot(x,y,z);
    const length=Math.hypot(n,w);
    return {x:Math.fround(x/length),y:Math.fround(y/length),z:Math.fround(z/length),w:Math.fround(w/length)};
  }

  constructor(readonly skin: MtekSkin, initial?: string) {
    this.layers = new PoseLayers(skin);
    this.ik = new PoseIK(skin);
    this.locomotion = new LocomotionBlend(skin);
    this.bind = new Float64Array(skin.nodes.length*10);
    skin.nodes.forEach((node,i) => {
      this.bind.set(node.translation,i*10);
      const q = node.rotation, norm = Math.hypot(...q);
      this.bind.set(q.map(v=>v/norm),i*10+3);
      this.bind.set(node.scale,i*10+7);
    });
    this.pose = this.bind.slice(); this.sample = this.bind.slice(); this.from = this.bind.slice();
    this.locals = skin.nodes.map(()=>identity()); this.globals = skin.nodes.map(()=>identity());
    this.inverseBind = skin.inverseBind.map(m=>new Float32Array(m));
    this.palette = new Float32Array(skin.joints.length*16);
    this.paletteEntries = skin.joints.map((_, joint) => this.palette.subarray(joint*16,joint*16+16));
    const visited = new Set<number>();
    const visit = (i: number): void => { if (visited.has(i)) return; const parent=skin.nodes[i]!.parent; if(parent>=0) visit(parent); visited.add(i); this.order.push(i); };
    skin.nodes.forEach((_,i)=>visit(i));
    if (initial === undefined || !this.transition(initial,0,true,1)) { this.clock.add({slot:0,duration:0,channels:[]}); this.clock.pause(0); this.evaluate(); }
  }

  transition(name: string, seconds: number, looping: boolean, speed: number): boolean {
    const clip = this.skin.clips.find(c=>c.name===name);
    if (clip === undefined || !Number.isFinite(seconds) || seconds<0 || !Number.isFinite(speed) || speed<0) return false;
    if (this.locomotion.active) { this.locomotion.set(undefined); this.name = ""; }
    if (name === this.name) return true; // declarative state selection doesn't restart every update
    this.outgoing = this.name !== "" && !this.held && this.blendTime >= this.blendDuration
      ? { name: this.name, clock: this.clock } : undefined;
    this.from.set(this.sample);
    this.held = false;
    this.clock = new ClipPlayers();
    this.name = name;
    this.evaluatedTime = NaN;
    this.blendTime=0; this.blendDuration=seconds;
    this.clock.add({slot:0,duration:clip.duration,channels:[]});
    this.clock.play(0,looping,speed);
    this.evaluate();
    return true;
  }
  /** Snapshot only: the destination owns its pose and never follows source lifetime. */
  copyPose(source: SkeletonPlayer): boolean {
    if (this.skin.meshNode !== source.skin.meshNode || this.skin.nodes.length !== source.skin.nodes.length
      || this.skin.nodes.some((n,i) => {
        const other=source.skin.nodes[i]!;
        return n.name !== other.name || n.parent !== other.parent
          || n.translation.some((v,k)=>v!==other.translation[k])
          || n.rotation.some((v,k)=>v!==other.rotation[k]) || n.scale.some((v,k)=>v!==other.scale[k]);
      })) return false;
    this.locomotion.set(undefined);
    this.from.set(source.pose); this.pose.set(source.pose);
    this.held=true; this.name=""; this.outgoing=undefined;
    this.blendDuration=0; this.blendTime=0; this.evaluatedTime=NaN;
    this.clock=new ClipPlayers(); this.clock.add({slot:0,duration:0,channels:[]}); this.clock.pause(0);
    this.evaluate(); return true;
  }
  private samplePose(name: string, time: number, out: Float64Array): void {
    out.set(this.bind);
    const clip=this.skin.clips.find(c=>c.name===name);
    for(const channel of clip?.channels ?? []) {
      sampleChannelInto(channel,time,this.value);
      const offset=channel.node*10+(channel.path==="translation"?0:channel.path==="rotation"?3:7);
      out.set(this.value.subarray(0,channel.path==="rotation"?4:3),offset);
    }
  }
  play(looping: boolean, speed: number): boolean {
    if (this.locomotion.active) {
      const ok = this.locomotion.play(looping,speed); if (ok) this.evaluate(); return ok;
    }
    const ok = this.clock.play(0,looping,speed);
    if (ok) { this.from.set(this.sample); this.blendTime=0; this.evaluate(); }
    return ok;
  }
  advance(dt: number, evaluate = true, distance = 0): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    const previous=this.clock.time(0), outgoingTime=this.outgoing?.clock.time(0)??0, oldBlend=this.blendTime;
    this.clock.advance(dt,()=>undefined);
    this.outgoing?.clock.advance(dt,()=>undefined);
    this.layers.advance(dt);
    this.locomotion.advance(dt);
    this.blendTime=Math.min(this.blendDuration,this.blendTime+dt);
    if(this.rootNode>=0 && this.locomotion.active) {
      this.rootSample.fill(0); this.locomotion.rootDelta(this.rootNode,this.rootSample);
      for (let c=0;c<3;c++) this.rootDelta[c]=this.rootDelta[c]!+this.rootSample[c]!*this.clock.weight(0);
    }
    else if(this.rootNode>=0) {
      // Mean smoothstep transition weight over this update; constant root velocities
      // integrate independently of render cadence, including an interval past the fade.
      const integral=(t: number): number => t*t*t-.5*t*t*t*t;
      const duration=this.blendDuration;
      let blend=1;
      if(duration>0 && dt>0 && oldBlend<duration) {
        const end=Math.min(duration,oldBlend+dt),area=duration*(integral(end/duration)-integral(oldBlend/duration));
        blend=(area+Math.max(0,oldBlend+dt-duration))/dt;
      }
      this.extractRoot(this.name,this.clock,previous,blend*this.clock.weight(0));
      if(this.outgoing!==undefined) this.extractRoot(this.outgoing.name,this.outgoing.clock,outgoingTime,(1-blend)*this.outgoing.clock.weight(0));
    }
    if (this.blendTime >= this.blendDuration) this.outgoing=undefined;
    if (evaluate && this.schedule.due(dt,distance)) this.evaluate();
  }
  private extractRoot(name: string, clock: ClipPlayers, previous: number, weight: number): void {
    if(weight===0 || this.held) return;
    const clip=this.skin.clips.find(c=>c.name===name),channel=clip?.channels.find(c=>c.node===this.rootNode&&c.path==="translation");
    if(channel===undefined || clip===undefined) return;
    sampleChannelInto(channel,previous,this.rootSample);
    for(let c=0;c<3;c++) this.rootDelta[c]=this.rootDelta[c]!-this.rootSample[c]!*weight;
    sampleChannelInto(channel,clock.time(0),this.rootSample);
    for(let c=0;c<3;c++) this.rootDelta[c]=this.rootDelta[c]!+this.rootSample[c]!*weight;
    const wraps=clock.wraps(0);
    if(wraps>0) {
      sampleChannelInto(channel,0,this.rootSample);
      for(let c=0;c<3;c++) this.rootDelta[c]=this.rootDelta[c]!-this.rootSample[c]!*weight*wraps;
      sampleChannelInto(channel,clip.duration,this.rootSample);
      for(let c=0;c<3;c++) this.rootDelta[c]=this.rootDelta[c]!+this.rootSample[c]!*weight*wraps;
    }
  }
  evaluate(): void {
    const time = this.clock.time(0), weight = this.clock.weight(0);
    if (this.override === undefined && time === this.evaluatedTime && this.blendTime === this.evaluatedBlend && weight === this.evaluatedWeight && this.evaluatedLayers === this.layers.revision && this.evaluatedIK === this.ik.revision && this.evaluatedLocomotion === this.locomotion.revision) return;
    this.evaluatedTime = time; this.evaluatedBlend = this.blendTime; this.evaluatedWeight = weight;
    this.evaluatedLayers = this.layers.revision;
    this.evaluatedIK = this.ik.revision;
    this.evaluatedLocomotion = this.locomotion.revision;
    if (this.held) this.sample.set(this.from);
    else this.samplePose(this.name,time,this.sample);
    if (this.outgoing !== undefined) {
      this.samplePose(this.outgoing.name,this.outgoing.clock.time(0),this.from);
      const oldWeight=this.outgoing.clock.weight(0);
      for(let i=0;i<this.skin.nodes.length;i++) {
        const at=i*10;
        for(const c of [0,1,2,7,8,9]) this.from[at+c]=this.bind[at+c]!+(this.from[at+c]!-this.bind[at+c]!)*oldWeight;
        slerp(this.from,at+3,this.bind,this.from,oldWeight);
      }
    }
    const t=this.blendDuration>0?Math.min(1,this.blendTime/this.blendDuration):1;
    const blend=t*t*(3-2*t);
    for(let i=0;i<this.skin.nodes.length;i++) {
      const at=i*10;
      for(let c=0;c<10;c++) this.pose[at+c]=this.from[at+c]!+(this.sample[at+c]!-this.from[at+c]!)*blend;
      slerp(this.pose,at+3,this.from,this.sample,blend);
      for(const c of [0,1,2,7,8,9]) this.pose[at+c]=this.bind[at+c]!+(this.pose[at+c]!-this.bind[at+c]!)*weight;
      slerp(this.pose,at+3,this.bind,this.pose,weight);
    }
    if (this.locomotion.active) {
      this.locomotion.apply(this.pose,this.bind);
      for(let at=0;at<this.pose.length;at+=10) {
        for(const c of [0,1,2,7,8,9]) this.pose[at+c]=this.bind[at+c]!+(this.pose[at+c]!-this.bind[at+c]!)*weight;
        slerp(this.pose,at+3,this.bind,this.pose,weight);
      }
    }
    // Interruption/restart snapshots must precede composition, otherwise an additive
    // or weighted layer would be applied again to an already composed snapshot.
    this.sample.set(this.pose);
    this.layers.apply(this.pose,this.bind);
    this.override?.(this.pose);
    if(this.rootNode>=0) for(let c=0;c<3;c++) this.pose[this.rootNode*10+c]=this.bind[this.rootNode*10+c]!;
    for (let i=0;i<this.pose.length;i++) {
      if (!Number.isFinite(this.pose[i]) || (i%10>=7 && this.pose[i]!<=0)) throw new RangeError("Procedural pose contains an invalid transform");
    }
    for (let at=3;at<this.pose.length;at+=10) {
      const length=Math.hypot(this.pose[at]!,this.pose[at+1]!,this.pose[at+2]!,this.pose[at+3]!);
      if(length<1e-8) throw new RangeError("Procedural pose contains a zero quaternion");
      for(let c=0;c<4;c++) this.pose[at+c]=this.pose[at+c]!/length;
    }
    this.ik.apply(this.pose);
    for(const i of this.order) {
      const a=i*10,p=this.pose;
      fromRotationTranslationScaleInto(this.locals[i]!,this.scratch,
        {x:p[a+3]!,y:p[a+4]!,z:p[a+5]!,w:p[a+6]!},
        {x:p[a]!,y:p[a+1]!,z:p[a+2]!},{x:p[a+7]!,y:p[a+8]!,z:p[a+9]!});
      const parent=this.skin.nodes[i]!.parent;
      if(parent<0) this.globals[i]!.set(this.locals[i]!);
      else multiplyInto(this.globals[i]!,this.globals[parent]!,this.locals[i]!);
    }
    // Inverse affine mesh-node transform: transpose its normal matrix, then inverse translation.
    const mesh=this.globals[this.skin.meshNode]!;
    normalMatrixInto(this.scratch,0,mesh);
    // The affine last row stays at its constructor identity values; every other
    // element is overwritten below, without allocating an identity each pose.
    for(let r=0;r<3;r++) for(let c=0;c<3;c++) this.inverseMesh[c*4+r]=this.scratch[r*4+c]!;
    for(let r=0;r<3;r++) this.inverseMesh[12+r]=-(this.inverseMesh[r]!*mesh[12]!+this.inverseMesh[4+r]!*mesh[13]!+this.inverseMesh[8+r]!*mesh[14]!);
    for(let j=0;j<this.skin.joints.length;j++) {
      multiplyInto(this.product,this.globals[this.skin.joints[j]!]!,this.inverseBind[j]!);
      multiplyInto(this.paletteEntries[j]!,this.inverseMesh,this.product);
    }
    this.revisionValue++;
  }
}

type Apply = (slot: number, channel: PlayableChannel, value: ArrayLike<number>) => void;
/** The same Mtek control API for rigid-node and skeletal animation. */
export class AnimationPlayers {
  private readonly nodes = new ClipPlayers();
  private readonly rigs = new Map<number,SkeletonPlayer>();
  private readonly groups = new Map<SkeletonPlayer,number>();
  skin(slot: number): SkeletonPlayer | undefined { return this.rigs.get(slot); }
  /** Explicit pose cohorts: all members intentionally share clocks, layers, IK and a palette. */
  share(source: number, targets: readonly number[]): boolean {
    const player = this.rigs.get(source);
    if (player === undefined) throw new RangeError("Animation sharing needs a skinned source");
    for (const target of targets) {
      const other = this.rigs.get(target);
      if (other === undefined || (other !== player && other.skin !== player.skin && JSON.stringify(other.skin) !== JSON.stringify(player.skin)))
        throw new RangeError("Animation sharing needs identical skeletal assets");
    }
    let changed = false;
    for (const target of targets) if (this.rigs.get(target) !== player) { this.rigs.set(target,player); changed = true; }
    return changed;
  }
  detach(slot: number): SkeletonPlayer {
    const source = this.rigs.get(slot);
    if (source === undefined) throw new RangeError("Animation detaching needs a skinned entity");
    const player = new SkeletonPlayer(source.skin);
    player.copyPose(source); this.rigs.set(slot,player); return player;
  }
  add(clip: PlayableClip): void { this.nodes.add(clip); }
  addSkin(slot: number, skin: MtekSkin, clip?: string): void { this.rigs.set(slot,new SkeletonPlayer(skin,clip)); }
  remove(slot: number): void { this.nodes.remove(slot); this.rigs.delete(slot); }
  copyPose(target: number,source: number): boolean {
    const a=this.rigs.get(target),b=this.rigs.get(source);
    return a!==undefined && b!==undefined && a.copyPose(b);
  }
  transition(slot: number,name: string,seconds: number,looping: boolean,speed: number): boolean { return this.rigs.get(slot)?.transition(name,seconds,looping,speed) ?? false; }
  play(slot: number,looping: boolean,speed: number): boolean { const r=this.rigs.get(slot); return r===undefined?this.nodes.play(slot,looping,speed):r.play(looping,speed); }
  private clock(slot: number): [ClipPlayers,number] { const r=this.rigs.get(slot); return r===undefined?[this.nodes,slot]:[r.clock,0]; }
  pause(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.pause(); const [c,s]=this.clock(slot); return c.pause(s); }
  resume(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.resume(); const [c,s]=this.clock(slot); return c.resume(s); }
  seek(slot: number,time: number): boolean {
    const blend=this.rigs.get(slot)?.locomotion;
    if(blend?.active===true) {
      if(!Number.isFinite(time)||time<0||time>blend.duration)return false;
      blend.seek(time/blend.duration); return true;
    }
    const [c,s]=this.clock(slot); return c.seek(s,time);
  }
  fade(slot: number,weight: number,duration: number): boolean { const [c,s]=this.clock(slot); return c.fade(s,weight,duration); }
  time(slot: number): number { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.phase*blend.duration; const [c,s]=this.clock(slot); return c.time(s); }
  duration(slot: number): number { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.duration; const [c,s]=this.clock(slot); return c.duration(s); }
  weight(slot: number): number { const [c,s]=this.clock(slot); return c.weight(s); }
  playing(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.playing; const [c,s]=this.clock(slot); return c.playing(s); }
  finished(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.finished; const [c,s]=this.clock(slot); return c.finished(s); }
  crossed(slot: number,marker: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.crossedPhase(marker/blend.duration); const [c,s]=this.clock(slot); return c.crossed(s,marker); }
  advance(dt: number,apply: Apply,distance?: (slot: number)=>number): void {
    this.nodes.advance(dt,apply);
    this.groups.clear();
    for (const [slot,player] of this.rigs) this.groups.set(player,Math.min(this.groups.get(player)??Infinity,distance?.(slot)??0));
    for (const [player,nearest] of this.groups) player.advance(dt,true,nearest);
    this.groups.clear();
  }
  pose(apply: Apply,time?: number): void { this.nodes.pose(apply,time); for(const r of this.rigs.values()) r.evaluate(); }
  poseSlot(slot: number,apply: Apply): void { this.nodes.poseSlot(slot,apply); this.rigs.get(slot)?.evaluate(); }
}
