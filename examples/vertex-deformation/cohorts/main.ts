import type {MtekApp,MtekProgram,MtekMountOptions,ExtensionContext} from "@mtek/runtime-web";
import {cohortActors,sampleCohorts} from "../cohort-controls.js";
const element=(id:string)=>document.getElementById(id)!;
const value=(id:string)=>(element(id) as HTMLSelectElement).value;
let app:MtekApp|undefined,paused=false,revision=0,queue=Promise.resolve();
function rebuild():void{
  const current=++revision;
  queue=queue.then(async()=>{
    if(current!==revision)return;
    app?.dispose();app=undefined;element("errors").textContent="";element("status").textContent="Preparing…";
    try{
      const module=await import(new URL("./.out/app.js",import.meta.url).href) as {default:MtekProgram;mountMtek:(canvas:HTMLCanvasElement,program:MtekProgram,options:MtekMountOptions)=>Promise<MtekApp>},count=Number(value("count")),groups=Math.min(count,Number(value("groups"))),shared=value("sharing")==="shared";
      (element("groups") as HTMLSelectElement).value=String(groups);
      let epoch="",context:ExtensionContext|undefined;
      app=await module.mountMtek(document.querySelector("canvas")!,module.default,{inputs:{count,character:Number(value("character")),reference:value("reference")==="reference",shape:value("shape")==="stretch"?[.75,1.25,.5]:[1,1,1]},test:{},
        ...(value("shadows")==="off"?{}:{rendering:{shadows:{light:"Sun",quality:value("shadows") as "low"|"medium"|"high",size:38,far:100}}}),
        onDiagnostic:(diagnostic:{code:string;message:string})=>{if(!/^MTEK-W806[01]$/.test(diagnostic.code))element("errors").textContent+=`${diagnostic.code}: ${diagnostic.message}\n`;},
        extensions:[{id:"authored-cohort-demo",apiVersion:1,setup:(c:ExtensionContext)=>{context=c;},beforeFrame:(c:ExtensionContext)=>{
          const actors=cohortActors(c);
          if(actors.length!==count||actors[0]!.id===epoch)return;
          epoch=actors[0]!.id;sampleCohorts(c,groups,shared);
          for(const actor of actors)c.animation(actor.id)!.clock.resume(0);
        },afterFrame:()=>{
          if(epoch==="")return;
          const counters=app?.debug?.counters();if(counters){const text=`${count} actors · ${groups} pose groups · ${shared?"shared":"independent"} · ${counters["drawCalls"]} colour + shadow draws · ${counters["instancedDraws"]} colour instance groups`;if(element("status").textContent!==text)element("status").textContent=text;}
          if(paused)app?.pause();
        }}]});
      if(current!==revision){app?.dispose();app=undefined;return;}
      if(new URLSearchParams(location.search).has("verify"))(window as unknown as {cohortDemo:object}).cohortDemo={get app(){return app;},get context(){return context;}};
    }catch(error){app?.dispose();app=undefined;element("status").textContent="Could not start scene";element("errors").textContent=String(error);}
  });
}
for(const control of document.querySelectorAll("select"))control.addEventListener("change",rebuild);
element("pause").addEventListener("click",()=>{paused=!paused;if(paused)app?.pause();else app?.resume();element("pause").textContent=paused?"Resume animation":"Pause animation";});
window.addEventListener("pagehide",()=>{++revision;app?.dispose();},{once:true});
rebuild();
