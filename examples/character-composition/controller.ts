import {Matrix4,Quaternion,Vector3} from "three";
import type {AnimationPlayer,AnimationQuaternion} from "@mtek/runtime-web";
type V={x:number;y:number;z:number};
const ROOT="MotionRoot",PELVIS="Skeleton_torso_joint_1";
const chains={
  leftFoot:["leg_joint_L_1","leg_joint_L_2","leg_joint_L_3"],rightFoot:["leg_joint_R_1","leg_joint_R_2","leg_joint_R_3"],
  leftGrip:["Skeleton_arm_joint_L__4_","Skeleton_arm_joint_L__3_","Skeleton_arm_joint_L__2_"],rightGrip:["Skeleton_arm_joint_R","Skeleton_arm_joint_R__2_","Skeleton_arm_joint_R__3_"],
} as const;
export interface CompositionSettings {speed:number;action:number;additive:boolean;feet:boolean;grip:boolean;procedural:number;root:boolean}
export const defaults:CompositionSettings={speed:.55,action:.7,additive:false,feet:true,grip:true,procedural:.5,root:false};
export interface Goal {name:keyof typeof chains;node:string;world:V;local:readonly [number,number,number]}
interface FootPlan {anchor:V;start:V;end:V;swing:boolean}
export interface CompositionState {
  readonly settings:CompositionSettings;readonly origin:V;readonly time:number;readonly gait:number;readonly mode:"locomotion"|"clip";
  readonly extracted:V;readonly pendingRoot:V;readonly anchors:readonly [string,FootPlan][];
  readonly clip:string|null;readonly clockTime:number;readonly playing:boolean;readonly phase:number;readonly layerTimes:readonly [string,number][];
  readonly transitionComplete:boolean;
}
/** Public player controls; Three supplies independent matrix math, no renderer or runtime internals. */
export class CompositionController {
  readonly bind=new Map<string,{position:V;rotation:AnimationQuaternion}>();
  readonly origin:V;
  settings:CompositionSettings={...defaults};
  goals:readonly Goal[]=[];
  extracted={x:0,y:0,z:0};
  pelvisAdjustment=0;
  time=0;
  private gait=0;
  private pendingRoot:V={x:0,y:0,z:0};
  private mode:"locomotion"|"clip"="locomotion";
  private readonly upperMask:Readonly<Record<string,number>>;
  private readonly neck:number;
  private readonly anchors=new Map<string,FootPlan>();
  constructor(readonly player:AnimationPlayer,readonly initial:V,readonly footMinima:Readonly<{left:number;right:number}>){
    this.origin={...initial};const globals:Matrix4[]=[],nodes=player.skin.nodes;
    const get=(i:number):Matrix4=>{if(globals[i])return globals[i];const n=nodes[i]!,local=new Matrix4().compose(new Vector3().fromArray(n.translation),new Quaternion().fromArray(n.rotation).normalize(),new Vector3().fromArray(n.scale));return globals[i]=n.parent<0?local:get(n.parent).clone().multiply(local);};
    nodes.forEach((_,i)=>get(i));const inverse=globals[player.skin.meshNode]!.clone().invert();
    for(let i=0;i<nodes.length;i++){const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();inverse.clone().multiply(globals[i]!).decompose(position,rotation,scale);this.bind.set(nodes[i]!.name,{position:{x:position.x,y:position.y,z:position.z},rotation:{x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w}});}
    const upper=nodes.findIndex(n=>n.name==="torso_joint_3");this.neck=nodes.findIndex(n=>n.name==="Skeleton_neck_joint_2");
    if(upper<0||this.neck<0||Object.values(chains).flat().some(n=>!this.bind.has(n)))throw new Error("The workshop needs the explicitly mapped CesiumMan hierarchy");
    this.upperMask=Object.fromEntries(nodes.map((n,i)=>{let index=i;while(index>=0&&index!==upper)index=nodes[index]!.parent;return [n.name,Number(index===upper)];}));
    const root=nodes.findIndex(n=>n.name===PELVIS);
    const knees=["leg_joint_L_2","leg_joint_R_2"].map(name=>{const index=nodes.findIndex(n=>n.name===name),rotation=new Quaternion().fromArray(nodes[index]!.rotation).normalize().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4));return {index,rotation:rotation.toArray()};});
    const toes=["leg_joint_L_5","leg_joint_R_5"].map(name=>{const index=nodes.findIndex(n=>n.name===name);if(index<0)throw new Error("Missing mapped toe node");return {index,node:nodes[index]!};});
    const locals=nodes.map(()=>new Matrix4()),currentGlobals=nodes.map(()=>new Matrix4()),seen=new Uint8Array(nodes.length),translation=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),meshInverse=new Matrix4();
    const point=(name:string):Vector3=>new Vector3().setFromMatrixPosition(currentGlobals[nodes.findIndex(n=>n.name===name)]!).applyMatrix4(meshInverse);
    player.setProceduralOverride(pose=>{
      pose[this.neck*10]=pose[this.neck*10]!+this.settings.procedural*.008*Math.sin(this.time*2);
      this.pelvisAdjustment=0;
      if(this.settings.feet){
        // Seed positive knee flexion before CCD; preserve the base hip/gait motion.
        // This avoids the alternate-bend/straight-chain branch on this explicit rig.
        for(const knee of knees)pose.set(knee.rotation,knee.index*10+3);
        // Feet are rigid effectors while planting/lifting. Preserve original toe
        // animation when foot control is disabled; do not let toe roll pierce a step.
        for(const toe of toes){pose.set(toe.node.translation,toe.index*10);pose.set(toe.node.rotation,toe.index*10+3);pose.set(toe.node.scale,toe.index*10+7);}
        seen.fill(0);
        const matrix=(i:number):Matrix4=>{
          if(seen[i])return currentGlobals[i]!;const at=i*10,n=nodes[i]!;
          translation.fromArray(pose,at);if(this.settings.root&&n.name===ROOT)translation.fromArray(n.translation);
          locals[i]!.compose(translation,rotation.fromArray(pose,at+3).normalize(),scale.fromArray(pose,at+7));
          if(n.parent<0)currentGlobals[i]!.copy(locals[i]!);else currentGlobals[i]!.multiplyMatrices(matrix(n.parent),locals[i]!);seen[i]=1;return currentGlobals[i]!;
        };
        nodes.forEach((_,i)=>matrix(i));meshInverse.copy(currentGlobals[player.skin.meshNode]!).invert();
        let crouch=.02;
        for(const goal of this.goals.filter(g=>g.name.endsWith("Foot"))){
          const chain=chains[goal.name],hip=point(chain[0]),knee=point(chain[1]),ankle=point(chain[2]),reach=(hip.distanceTo(knee)+knee.distanceTo(ankle))*.95-.02;
          const horizontal=(hip.x-goal.local[0])**2+(hip.y-goal.local[1])**2;
          crouch=Math.max(crouch,hip.z-goal.local[2]-Math.sqrt(Math.max(0,reach*reach-horizontal))+.005);
        }
        // Explicit rig-specific pelvis adaptation, bounded to 18 cm in model space.
        // Goals and residuals remain unchanged; unreachable targets still report error.
        this.pelvisAdjustment=Math.min(.18,crouch);pose[root*10+2]=pose[root*10+2]!-this.pelvisAdjustment;
      }
    });
    this.useLocomotion();this.configure(defaults);
  }
  configure(settings:CompositionSettings):void{
    if(Object.values(settings).some(value=>typeof value==="number"&&!Number.isFinite(value))||settings.speed<0||settings.speed>1||settings.action<0||settings.action>1||settings.procedural<0||settings.procedural>1)throw new RangeError("Invalid composition controls");
    const rootChanged=settings.root!==this.settings.root;this.settings={...settings};
    this.player.layers.set("upper",{clip:"UpperAction",weight:settings.action,additive:settings.additive,mask:this.upperMask});
    this.player.layers.set("nod",{clip:"Nod",weight:.4,additive:true,mask:{Skeleton_neck_joint_1:1,Skeleton_neck_joint_2:1}});
    if(rootChanged){this.anchors.clear();this.player.setRootMotion(settings.root?ROOT:undefined);if(settings.root){this.mode="clip";this.player.transition("Travel",.2,true,1);}else this.useLocomotion();}
    if(this.player.locomotion.active)this.player.locomotion.setParameter(settings.speed);
    this.updateGoals();
  }
  useLocomotion():void{
    this.mode="locomotion";this.player.locomotion.set({samples:[{clip:"Idle",threshold:0},{clip:"Walk",threshold:.5},{clip:"Run",threshold:1}],parameter:this.settings.speed});
  }
  interrupt(clip:string,seconds=.25):void{if(!this.player.transition(clip,seconds,true,1))throw new RangeError("Unknown workshop clip");this.mode="clip";}
  /** The affine authored stage is known, so targets are converted through its inverse too. */
  toWorld(p:V):V{return {x:this.origin.x+2*1.03*p.x,y:this.origin.y+2*p.z,z:this.origin.z-2*p.y};}
  toLocal(p:V):readonly [number,number,number]{return [(p.x-this.origin.x)/(2*1.03),-(p.z-this.origin.z)/2,(p.y-this.origin.y)/2];}
  prop():V{
    const shoulder=this.bind.get(chains.leftGrip[0])!.position;
    return {x:this.origin.x+.55,y:this.origin.y+shoulder.z*2-.25,z:this.origin.z};
  }
  beforeFrame(delta:number):void{
    const motion={...this.player.consumeRootMotion()};motion.x+=this.pendingRoot.x;motion.y+=this.pendingRoot.y;motion.z+=this.pendingRoot.z;this.pendingRoot={x:0,y:0,z:0};
    this.extracted.x+=motion.x;this.extracted.y+=motion.y;this.extracted.z+=motion.z;
    if(this.settings.root){this.origin.x+=2*1.03*motion.x;this.origin.z-=2*motion.y;}
    this.time+=delta;const duration=this.player.locomotion.active?this.player.locomotion.duration:this.player.clock.duration(0);this.gait=(this.gait+delta/Math.max(.1,duration))%1;this.updateGoals();
  }
  /** Owner capture: moves unconsumed root deltas into this controller's pending state. */
  captureForRecovery():CompositionState{
    const diagnostics=this.player.inspect?.();if(!diagnostics)throw new Error("Recovery capture needs optional animation diagnostics");
    const pending=this.player.consumeRootMotion();this.pendingRoot.x+=pending.x;this.pendingRoot.y+=pending.y;this.pendingRoot.z+=pending.z;
    return structuredClone({settings:this.settings,origin:this.origin,time:this.time,gait:this.gait,mode:this.mode,extracted:this.extracted,pendingRoot:this.pendingRoot,anchors:[...this.anchors],clip:diagnostics.clip,
      clockTime:this.player.clock.time(0),playing:this.player.locomotion.active?this.player.locomotion.playing:this.player.clock.playing(0),phase:this.player.locomotion.phase,
      layerTimes:diagnostics.layers.map(l=>[l.id,l.time] as [string,number]),transitionComplete:diagnostics.transition.progress>=1});
  }
  /** Steady modes restore exactly. An unfinished crossfade restarts at its target clip/time. */
  restore(state:CompositionState):void{
    this.configure({...state.settings,root:false});this.settings={...state.settings};this.player.setRootMotion(state.settings.root?ROOT:undefined);
    Object.assign(this.origin,state.origin);this.time=state.time;this.gait=state.gait;this.mode=state.mode;
    Object.assign(this.extracted,state.extracted);this.pendingRoot={...state.pendingRoot};this.anchors.clear();for(const [name,plan] of state.anchors)this.anchors.set(name,structuredClone(plan));
    if(state.mode==="locomotion"){this.useLocomotion();this.player.locomotion.seek(state.phase);if(!state.playing)this.player.locomotion.pause();}
    else{this.useLocomotion();this.player.transition(state.clip??"Walk",0,true,1);this.mode="clip";this.player.clock.seek(0,state.clockTime);if(!state.playing)this.player.clock.pause(0);}
    for(const [id,time] of state.layerTimes)this.player.layers.seek(id,time);this.updateGoals();
  }
  private updateGoals():void{
    const goals:Goal[]=[],phase=this.gait;
    for(const name of Object.keys(chains) as (keyof typeof chains)[]){
      const foot=name.endsWith("Foot"),enabled=foot?this.settings.feet:this.settings.grip;
      if(!enabled){this.player.ik.remove(name);continue;}
      const chain=chains[name],node=chain[2],bind=this.bind.get(node)!,left=name.startsWith("left");let world:V;
      if(foot){
        const nominal=this.toWorld(bind.position),height=left?.15:0;
        // A planted phase keeps the world target fixed. Swing carries it to the new
        // body-relative anchor; the small lift is visible and measured independently.
        const cycle=(phase+(left?0:.5))%1,stance=cycle<.6,lead=this.settings.root?.2:0;
        if(!this.anchors.has(name)){const anchor={...nominal,x:nominal.x+lead};this.anchors.set(name,{anchor,start:{...anchor},end:{...anchor},swing:false});}
        const state=this.anchors.get(name)!;
        if(!stance&&!state.swing){
          state.start={...state.anchor};
          const duration=this.player.locomotion.active?this.player.locomotion.duration:this.player.clock.duration(0);
          state.end={...nominal,x:nominal.x+lead+(this.settings.root?.618*duration*(1-cycle):0)};state.swing=true;
        }else if(stance&&state.swing){state.anchor={...state.end};state.swing=false;}
        const t=stance?0:(cycle-.6)/.4,smooth=t*t*(3-2*t),anchor=stance?state.anchor:{x:state.start.x+(state.end.x-state.start.x)*smooth,y:nominal.y,z:state.start.z+(state.end.z-state.start.z)*smooth};
        const minimum=left?this.footMinima.left:this.footMinima.right;
        world={x:anchor.x,y:this.origin.y+(bind.position.z-minimum)*2+height+(stance?0:.12*Math.sin(t*Math.PI)),z:anchor.z};
      }else{
        const prop=this.prop();world={x:prop.x,y:prop.y,z:prop.z+(left?-.325:.325)};
      }
      const local=this.toLocal(world),rotation=bind.rotation;
      this.player.ik.set(name,{chain,target:local,iterations:48,tolerance:.0005,rotation:[rotation.x,rotation.y,rotation.z,rotation.w],...(foot?{limits:{[chain[1]]:{axis:[0,1,0] as const,min:0,max:2.4}}}:{})});
      goals.push({name,node,world,local});
    }
    this.goals=goals;
  }
  residuals():readonly {name:string;distance:number;orientationError:number;target:V;actual:V}[]{
    return this.goals.map(goal=>{
      const actual=this.toWorld(this.player.jointPosition(goal.node)),a=this.player.jointRotation(goal.node),b=this.bind.get(goal.node)!.rotation;
      const dot=Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(Math.hypot(a.x,a.y,a.z,a.w)*Math.hypot(b.x,b.y,b.z,b.w));
      return {name:goal.name,distance:Math.hypot(actual.x-goal.world.x,actual.y-goal.world.y,actual.z-goal.world.z),orientationError:2*Math.acos(Math.min(1,dot)),target:goal.world,actual};
    });
  }
}
