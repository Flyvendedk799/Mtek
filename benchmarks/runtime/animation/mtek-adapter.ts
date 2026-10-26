import type {MtekApp,MtekMountOptions} from "../../../packages/runtime-web/src/host/types.js";
import type {ExtensionContext} from "../../../packages/runtime-web/src/host/extensions.js";
import type {SkeletonPlayer} from "../../../packages/runtime-web/src/scene/skeleton.js";
import {actorPosition,camera,phase,settings} from "./layout.ts";
import protocol from "./protocol.json" with {type:"json"};
import {makeCanvas,type AnimationApp,type Configuration} from "./types.ts";
export const engine="mtek";
interface ProgramModule {default:unknown;mountMtek(canvas:HTMLCanvasElement,program:unknown,options:MtekMountOptions):Promise<MtekApp>}
export async function createMtek(configuration:Configuration):Promise<AnimationApp>{
  const {model,count,textured=false,display=false,culling=false}=configuration;
  const key=`${model}-${count}${textured?"-textured":""}`,base=`./mtek/${key}/`;
  const module=await import(/* @vite-ignore */ new URL(base+"app.js",location.href).href) as ProgramModule;
  const canvas=makeCanvas(),view=camera(count,textured),diagnostics:string[]=[];
  let context:ExtensionContext|undefined;
  const test:MtekMountOptions["test"]={manualClock:true,disableCulling:!culling,...(display?{}:{renderTarget:{width:protocol.width,height:protocol.height}})};
  const app=await module.mountMtek(canvas,module.default,{failureDisplay:"none",pauseWhenHidden:false,devOverlay:false,inputs:{camera_x:configuration.cameraOffset??0},test,onDiagnostic:d=>diagnostics.push(`${d.code}: ${d.message}`),extensions:[{
    id:"matched-independent-animation",apiVersion:1,setup(c){context=c;
      const actors=c.readTransforms().filter(actor=>actor.name.startsWith("Actor")).sort((a,b)=>a.name.localeCompare(b.name));
      actors.forEach((actor,i)=>{const player=c.animation(actor.id)!;player.clock.seek(0,phase(i,count)*player.clock.duration(0));player.evaluate();});
    },
  }]});
  const actors=context!.readTransforms().filter(actor=>actor.name.startsWith("Actor")).sort((a,b)=>a.name.localeCompare(b.name));
  const players=actors.map(actor=>context!.animation(actor.id) as SkeletonPlayer);
  const skin=players[0]!.skin;
  const config=settings[model];
  const world=(p:{x:number;y:number;z:number},index:number):number[]=>{
    const origin=actorPosition(index,count);
    const x=Math.cos(config.rotationZ)*p.x-Math.sin(config.rotationZ)*p.y;
    const y=Math.sin(config.rotationZ)*p.x+Math.cos(config.rotationZ)*p.y;
    return [origin[0]+x*config.scale,origin[1]+(Math.cos(config.rotationX)*y-Math.sin(config.rotationX)*p.z)*config.scale,origin[2]+(Math.sin(config.rotationX)*y+Math.cos(config.rotationX)*p.z)*config.scale];
  };
  return {
    canvas,clips:skin.clips.map(clip=>clip.name),
    frame(dt){app.debug!.step(1,dt);},
    seek(at){players.forEach((player,i)=>{player.clock.seek(0,((at+phase(i,count))%1)*player.clock.duration(0));player.evaluate();});},
    selectClip(name){for(const player of players)if(!player.transition(name,0,true,1))throw new Error(`Unknown clip: ${name}`);},
    joints(){const result:number[]=[];players.forEach((player,actor)=>{for(const index of skin.joints){const p=player.jointPosition(skin.nodes[index]!.name);result.push(...world(p,actor));}});return result;},
    async readPixels(){return (await app.debug!.readPixels()).data;},
    dispose(){app.dispose();canvas.remove();return Promise.resolve();},
    info(){return {engine:"mtek",skinNodes:skin.nodes.length,joints:skin.joints.length,vertices:settings[model].vertices,diagnostics,state:app.state,counters:app.debug!.counters(),view};},
  };
}


export {createMtek as create};
