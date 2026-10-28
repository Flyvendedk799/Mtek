import type { MtekSkin } from "../abi/manifest-types.js";
import { identity, multiplyInto, fromRotationTranslationScaleInto, normalMatrixInto } from "../math/mat4.js";
import { ClipPlayers, sampleChannelInto } from "./clips.js";
import { AnimationPlayers, type Apply } from "./animation-players.js";
import { PoseLayers } from "./pose-layers.js";
import { PoseIK } from "./ik.js";
import { BlendSpace } from "./blend-space.js";
import { LocomotionBlend } from "./locomotion.js";
import { PoseSchedule, type AnimationUpdateBand } from "./pose-schedule.js";
import type { AnimationInspection } from "./animation-inspection.js";
import type { HumanoidMap } from "./humanoid-types.js";

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
  /** The phase-synchronized 1D/2D blend that replaces the base clip while active (decision 0220). */
  readonly blend: BlendSpace;
  /** The 1D view of `blend`: thresholds are x with y = 0 (decision 0196). */
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
  /**
   * Like `consumeRootMotion`, but the displacement is turned from the root node's parent space into the skeletal mesh
   * local space of `jointPosition` (the linear part of the parent's displayed transform relative to the mesh node), so
   * it can be carried to the world by the entity's transform alone (decision 0223).
   */
  consumeRootMotionLocal(): {x: number;y: number;z: number} {
    const delta=this.consumeRootMotion();
    if(this.rootNode<0) return delta;
    const parent=this.skin.nodes[this.rootNode]!.parent,m=this.product;
    if(parent<0) m.set(this.inverseMesh); else multiplyInto(m,this.inverseMesh,this.globals[parent]!);
    return {x:m[0]!*delta.x+m[4]!*delta.y+m[8]!*delta.z,y:m[1]!*delta.x+m[5]!*delta.y+m[9]!*delta.z,z:m[2]!*delta.x+m[6]!*delta.y+m[10]!*delta.z};
  }
  /** Final local-pose adjustment, after layers and before world matrices/sockets. */
  private override: ((pose: Float64Array) => void) | undefined;
  private evaluatedLayers = -1;
  private evaluatedIK = -1;
  /** Supplies the canonical humanoid bones that limb goals and foot placement use (decision 0222); undefined removes them. */
  setHumanoid(map: HumanoidMap | undefined): void { this.ik.setHumanoid(map); }
  setProceduralOverride(override: ((pose: Float64Array) => void) | undefined): void {
    this.override = override; this.evaluatedTime = NaN;
  }
  clock = new ClipPlayers();
  private outgoing: { name: string; clock: ClipPlayers } | undefined;
  private held = false;
  readonly palette: Float32Array;
  readonly pose: Float64Array;
  private readonly bind: Float64Array;
  /** The pose before the limb, foot and chain goals, and what `animatedJointPosition` derives from it (decision 0224). */
  private readonly animated: Float64Array;
  private readonly animatedGlobals: Float32Array[];
  private readonly animatedLocal = identity();
  private readonly animatedInverse = identity();
  private animatedStale = true;
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
    return { mode: this.held ? "held" : this.blend.active ? "locomotion" : this.name === "" ? "bind" : "clip", clip: this.name || null,
      transition: { elapsed: this.blendTime, duration: this.blendDuration, progress, outgoingClip: this.outgoing?.name ?? null, fromSnapshot: progress < 1 && this.outgoing === undefined },
      rootMotionNode: this.rootNode < 0 ? null : this.rootNode, proceduralOverride: this.override !== undefined,
      nodes: this.skin.nodes.map((node, index) => {
        multiplyInto(this.product, this.inverseMesh, this.globals[index]!);
        return { index, name: node.name, parent: node.parent, joint: this.skin.joints.includes(index),
          position: { x: Math.fround(this.product[12]!), y: Math.fround(this.product[13]!), z: Math.fround(this.product[14]!) } };
      }), layers: this.layers.inspect(), ik: this.ik.inspect(), ...this.ik.limbs.inspect(), blend: this.blend.inspect(), locomotion: this.locomotion.inspect(),
    };
  }
  /**
   * Like `jointPosition`, for the pose the animation gives before the limb, foot and chain goals (decision 0224): the base clip or
   * blend, layers, the procedural override and root ownership. With no goal set it equals `jointPosition`; with goals it is the pose
   * the program would see without them, so a program can place a foot from where the animation puts it. Computed on demand from a copy
   * of the pose taken at each evaluation; it never evaluates.
   */
  animatedJointPosition(name: string): { x: number; y: number; z: number } {
    const i=this.skin.nodes.findIndex(n=>n.name===name);
    if(i<0) return {x:0,y:0,z:0};
    if(this.animatedStale) this.forwardAnimated();
    multiplyInto(this.product,this.animatedInverse,this.animatedGlobals[i]!);
    return {x:Math.fround(this.product[12]!),y:Math.fround(this.product[13]!),z:Math.fround(this.product[14]!)};
  }
  private forwardAnimated(): void {
    const p=this.animated,local=this.animatedLocal,g=this.animatedGlobals;
    for(const i of this.order) {
      const a=i*10;
      fromRotationTranslationScaleInto(local,this.scratch,{x:p[a+3]!,y:p[a+4]!,z:p[a+5]!,w:p[a+6]!},{x:p[a]!,y:p[a+1]!,z:p[a+2]!},{x:p[a+7]!,y:p[a+8]!,z:p[a+9]!});
      const parent=this.skin.nodes[i]!.parent;
      if(parent<0) g[i]!.set(local); else multiplyInto(g[i]!,g[parent]!,local);
    }
    const mesh=g[this.skin.meshNode]!,inverse=this.animatedInverse;
    normalMatrixInto(this.scratch,0,mesh);
    for(let r=0;r<3;r++) for(let c=0;c<3;c++) inverse[c*4+r]=this.scratch[r*4+c]!;
    for(let r=0;r<3;r++) inverse[12+r]=-(inverse[r]!*mesh[12]!+inverse[4+r]!*mesh[13]!+inverse[8+r]!*mesh[14]!);
    this.animatedStale=false;
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
    this.blend = new BlendSpace(skin);
    this.locomotion = new LocomotionBlend(this.blend);
    this.bind = new Float64Array(skin.nodes.length*10);
    skin.nodes.forEach((node,i) => {
      this.bind.set(node.translation,i*10);
      const q = node.rotation, norm = Math.hypot(...q);
      this.bind.set(q.map(v=>v/norm),i*10+3);
      this.bind.set(node.scale,i*10+7);
    });
    this.pose = this.bind.slice(); this.sample = this.bind.slice(); this.from = this.bind.slice(); this.animated = this.bind.slice();
    this.animatedGlobals = skin.nodes.map(()=>identity());
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
    if (this.blend.active) { this.blend.set(undefined); this.name = ""; }
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
    this.blend.set(undefined);
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
    if (this.blend.active) {
      const ok = this.blend.play(looping,speed); if (ok) this.evaluate(); return ok;
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
    this.ik.advance(dt);
    this.blend.advance(dt);
    this.blendTime=Math.min(this.blendDuration,this.blendTime+dt);
    if(this.rootNode>=0 && this.blend.active) {
      this.rootSample.fill(0); this.blend.rootDelta(this.rootNode,this.rootSample);
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
    if (this.override === undefined && time === this.evaluatedTime && this.blendTime === this.evaluatedBlend && weight === this.evaluatedWeight && this.evaluatedLayers === this.layers.revision && this.evaluatedIK === this.ik.revision && !this.ik.animating && this.evaluatedLocomotion === this.blend.revision) return;
    this.evaluatedTime = time; this.evaluatedBlend = this.blendTime; this.evaluatedWeight = weight;
    this.evaluatedLayers = this.layers.revision;
    this.evaluatedIK = this.ik.revision;
    this.evaluatedLocomotion = this.blend.revision;
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
    if (this.blend.active) {
      this.blend.apply(this.pose,this.bind);
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
    this.animated.set(this.pose); this.animatedStale=true;
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

/**
 * The same Mtek control API for rigid-node and skeletal animation: the players of a world whose animation module is
 * loaded (decision 0225). Rigid clips are the base class's; an entity with a rig answers for itself.
 */
export class SkeletalPlayers extends AnimationPlayers {
  private readonly rigs = new Map<number,SkeletonPlayer>();
  private readonly groups = new Map<SkeletonPlayer,number>();
  override skin(slot: number): SkeletonPlayer | undefined { return this.rigs.get(slot); }
  /** Explicit pose cohorts: all members intentionally share clocks, layers, IK and a palette. */
  override share(source: number, targets: readonly number[]): boolean {
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
  override detach(slot: number): SkeletonPlayer {
    const source = this.rigs.get(slot);
    if (source === undefined) throw new RangeError("Animation detaching needs a skinned entity");
    const player = new SkeletonPlayer(source.skin);
    player.copyPose(source); this.rigs.set(slot,player); return player;
  }
  override addSkin(slot: number, skin: MtekSkin, clip?: string): void { this.rigs.set(slot,new SkeletonPlayer(skin,clip)); }
  override remove(slot: number): void { super.remove(slot); this.rigs.delete(slot); }
  override copyPose(target: number,source: number): boolean {
    const a=this.rigs.get(target),b=this.rigs.get(source);
    return a!==undefined && b!==undefined && a.copyPose(b);
  }
  override transition(slot: number,name: string,seconds: number,looping: boolean,speed: number): boolean { return this.rigs.get(slot)?.transition(name,seconds,looping,speed) ?? false; }
  override play(slot: number,looping: boolean,speed: number): boolean { const r=this.rigs.get(slot); return r===undefined?super.play(slot,looping,speed):r.play(looping,speed); }
  private clock(slot: number): [ClipPlayers,number] { const r=this.rigs.get(slot); return r===undefined?[this.nodes,slot]:[r.clock,0]; }
  override pause(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.pause(); const [c,s]=this.clock(slot); return c.pause(s); }
  override resume(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.resume(); const [c,s]=this.clock(slot); return c.resume(s); }
  override seek(slot: number,time: number): boolean {
    const blend=this.rigs.get(slot)?.locomotion;
    if(blend?.active===true) {
      if(!Number.isFinite(time)||time<0||time>blend.duration)return false;
      blend.seek(time/blend.duration); return true;
    }
    const [c,s]=this.clock(slot); return c.seek(s,time);
  }
  override fade(slot: number,weight: number,duration: number): boolean { const [c,s]=this.clock(slot); return c.fade(s,weight,duration); }
  override time(slot: number): number { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.phase*blend.duration; const [c,s]=this.clock(slot); return c.time(s); }
  override duration(slot: number): number { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.duration; const [c,s]=this.clock(slot); return c.duration(s); }
  override weight(slot: number): number { const [c,s]=this.clock(slot); return c.weight(s); }
  override playing(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.playing; const [c,s]=this.clock(slot); return c.playing(s); }
  override finished(slot: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.finished; const [c,s]=this.clock(slot); return c.finished(s); }
  override crossed(slot: number,marker: number): boolean { const blend=this.rigs.get(slot)?.locomotion; if(blend?.active===true)return blend.crossedPhase(marker/blend.duration); const [c,s]=this.clock(slot); return c.crossed(s,marker); }
  override advance(dt: number,apply: Apply,distance?: (slot: number)=>number): void {
    super.advance(dt,apply);
    this.groups.clear();
    for (const [slot,player] of this.rigs) this.groups.set(player,Math.min(this.groups.get(player)??Infinity,distance?.(slot)??0));
    for (const [player,nearest] of this.groups) player.advance(dt,true,nearest);
    this.groups.clear();
  }
  override pose(apply: Apply,time?: number): void { super.pose(apply,time); for(const r of this.rigs.values()) r.evaluate(); }
  override poseSlot(slot: number,apply: Apply): void { super.poseSlot(slot,apply); this.rigs.get(slot)?.evaluate(); }
}
