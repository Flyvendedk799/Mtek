import {create,type AnimationApp} from "./adapters.ts";
import {models,type Model} from "./layout.ts";

const model=document.querySelector<HTMLSelectElement>("#model")!,clip=document.querySelector<HTMLSelectElement>("#clip")!,pause=document.querySelector<HTMLButtonElement>("#pause")!,status=document.querySelector<HTMLOutputElement>("#status")!;
const panels=[document.querySelector<HTMLElement>("#mtek")!,document.querySelector<HTMLElement>("#three")!];
let apps:AnimationApp[]=[],paused=false,loading=false,previous=performance.now();
for(const name of models)model.add(new Option(name==="Fox"?"Fox · 24 joints":"Cesium Man · 19 joints",name));
async function load():Promise<void>{
  loading=true;model.disabled=true;clip.disabled=true;pause.disabled=true;status.textContent="Loading character…";
  try{
    await Promise.all(apps.map(app=>app.dispose()));apps=[];
    for(const engine of ["mtek","three"] as const){
      const app=await create(engine,{model:model.value as Model,count:1,textured:true,display:true});
      panels[apps.length]!.append(app.canvas);app.canvas.style.cssText="display:block;width:100%;height:auto;aspect-ratio:16/9";apps.push(app);
    }
    clip.replaceChildren(...apps[0]!.clips.map(name=>new Option(name,name)));clip.value=model.value==="Fox"?"Walk":apps[0]!.clips[0]!;
    status.textContent="Same geometry, texture and clip. Explicit unlit material on both renderers.";
    apps.forEach(app=>app.frame(0));previous=performance.now();
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);await Promise.all(apps.map(app=>app.dispose()));apps=[];}
  finally{loading=false;model.disabled=false;clip.disabled=false;pause.disabled=false;}
}
model.addEventListener("change",()=>{void load();});
clip.addEventListener("change",()=>{for(const app of apps){app.selectClip(clip.value);app.frame(0);}});
pause.addEventListener("click",()=>{paused=!paused;pause.textContent=paused?"Resume":"Pause";previous=performance.now();});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click",()=>{for(const app of apps){app.seek(0);app.frame(0);}});
function frame(now:number):void{
  const dt=Math.max(0,Math.min((now-previous)/1000,0.1));previous=now;
  if(!paused&&!loading)for(const app of apps)app.frame(dt);
  requestAnimationFrame(frame);
}
Object.assign(window,{__productionCharacters:{ready:()=>apps.length===2&&!loading,info:()=>apps.map(app=>app.info())}});
addEventListener("pagehide",()=>{paused=true;void Promise.all(apps.map(app=>app.dispose()));});
await load();requestAnimationFrame(frame);
