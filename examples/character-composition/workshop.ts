import {InspectorController,mountInspectorPanel,mountInspectorOverlay,type InspectorOverlay} from "@mtek/inspector";
import type {MtekApp,MtekProgram,MtekMountOptions,ExtensionContext} from "@mtek/runtime-web";
import {CompositionController,defaults,type CompositionSettings,type CompositionState} from "./controller.js";
export interface ProgramModule {default:MtekProgram;mountMtek:(canvas:HTMLCanvasElement,program:MtekProgram,options:MtekMountOptions)=>Promise<MtekApp>}
export type FootProfiles=Readonly<Record<string,{left:{minimum:number};right:{minimum:number}}>>;
interface Actor {id:string;propId:string;name:string;controller:CompositionController}
export async function createWorkshop(canvas:HTMLCanvasElement,sidebar:HTMLElement,module:ProgramModule,profiles:FootProfiles,options:{test?:MtekMountOptions["test"];onFrame?:()=>void;onDiagnostic?:(code:string,message:string)=>void}={}){
  const inspector=new InspectorController(),removePanel=mountInspectorPanel(inspector,sidebar),states=new Map<string,CompositionState>(),actors=new Map<string,Actor>(),diagnostics:{code:string;message:string}[]=[],markers=new Map<string,number[]>();
  let context:ExtensionContext|undefined,app:MtekApp|undefined,overlay:InspectorOverlay|undefined,settings={...defaults},disposed=false,restartedFade=false;
  const initialize=(c:ExtensionContext):void=>{
    const records=c.readTransforms();
    for(const name of ["Original","Longer"]){
      const actor=records.find(e=>e.name===name),prop=records.find(e=>e.name===name+"Prop");if(!actor||!prop)continue;
      if(actors.get(name)?.id===actor.id)continue;
      const p=c.animation(actor.id);if(!p)throw new Error("Mapped workshop actor has no animation player");
      const profile=profiles[name]!;const controller=new CompositionController(p,actor.position,{left:profile.left.minimum,right:profile.right.minimum}),state=states.get(name);
      if(state){controller.restore(state);restartedFade||=!state.transitionComplete;}else controller.configure(settings);
      actors.set(name,{id:actor.id,propId:prop.id,name,controller});markers.set(name,markers.get(name)??[0,0]);
      if(name==="Original")inspector.select(actor.id);
    }
  };
  const capture=():void=>{for(const [name,actor] of actors)states.set(name,actor.controller.captureForRecovery());};
  try{
    app=await module.mountMtek(canvas,module.default,{test:options.test??{},rendering:{shadows:{light:"Sun",quality:"low",size:18,far:70}},
      onDiagnostic:d=>{diagnostics.push({code:d.code,message:d.message});if(d.code==="MTEK-W8060")capture();options.onDiagnostic?.(d.code,d.message);},
      hostServices:{"mtek.inspector.metrics":{read:()=>{const counters=app?.debug?.counters();return counters?{liveBuffers:counters["liveBuffers"],liveTextures:counters["liveTextures"],livePipelines:counters["livePipelines"]}:{};}}},
      extensions:[inspector.extension,{id:"production-composition",apiVersion:1,setup:c=>{context=c;},beforeFrame:(c,delta)=>{
        initialize(c);const updates=[];
        for(const actor of actors.values()){actor.controller.beforeFrame(delta);updates.push({id:actor.id,position:actor.controller.origin},{id:actor.propId,position:actor.controller.prop()});}
        if(updates.length)c.writeTransforms(updates);
      },afterFrame:()=>{
        for(const [name,actor] of actors){const p=actor.controller.player,counts=markers.get(name)!;for(const [index,phase] of [.25,.75].entries())if(p.locomotion.active?p.locomotion.crossedPhase(phase):p.clock.crossed(0,p.clock.duration(0)*phase))counts[index]=counts[index]!+1;}
        options.onFrame?.();
      }}]});
    if(disposed){app.dispose();throw new Error("Workshop disposed during mount");}
    overlay=mountInspectorOverlay(inspector,canvas,{bounds:false,colliders:false,contacts:false});
    return {
      app,inspector,get overlay(){return overlay;},get context(){return context;},get actors(){return [...actors.values()];},diagnostics,markers,get restartedFade(){return restartedFade;},
      configure(value:CompositionSettings){settings={...value};for(const actor of actors.values())actor.controller.configure(settings);},
      interrupt(clip:string){for(const actor of actors.values())actor.controller.interrupt(clip);},
      locomotion(){for(const actor of actors.values())actor.controller.useLocomotion();},
      overlays(visible:boolean){if(visible&&!overlay)overlay=mountInspectorOverlay(inspector,canvas,{bounds:false,colliders:false,contacts:false});else if(!visible){overlay?.dispose();overlay=undefined;}},
      capture,
      dispose(){if(disposed)return;disposed=true;overlay?.dispose();overlay=undefined;app?.dispose();removePanel();inspector.dispose();actors.clear();states.clear();},
    };
  }catch(error){overlay?.dispose();app?.dispose();removePanel();inspector.dispose();throw error;}
}
