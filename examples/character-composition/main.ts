import {createWorkshop,type ProgramModule,type FootProfiles} from "./workshop.js";
import {defaults} from "./controller.js";
const element=(id:string)=>document.getElementById(id)!,input=(id:string)=>element(id) as HTMLInputElement;
const verify=new URLSearchParams(location.search).has("verify"),visible=new URLSearchParams(location.search).has("visible");
let workshop:Awaited<ReturnType<typeof createWorkshop>>|undefined,revision=0,queue=Promise.resolve(),paused=false,frames=0;
const settings=()=>({...defaults,speed:Number(input("speed").value),action:Number(input("action").value),procedural:Number(input("procedural").value),additive:input("additive").checked,feet:input("feet").checked,grip:input("grip").checked,root:input("root").checked});
function rebuild():void{
  const current=++revision;queue=queue.then(async()=>{
    if(current!==revision)return;workshop?.dispose();workshop=undefined;frames=0;element("status").textContent="Preparing…";element("errors").textContent="";
    try{
      const module=await import(new URL("./.out/scene/app.js",import.meta.url).href) as ProgramModule,profiles=await fetch("./.out/scene/foot-profiles.json").then(r=>r.json()) as FootProfiles;
      const mounted=await createWorkshop(document.querySelector("canvas")!,element("inspector"),module,profiles,{...(verify?{test:{manualClock:true,...(visible?{}:{renderTarget:{width:241,height:193}})}}:{}),onDiagnostic:(code,message)=>{if(!["MTEK-W8060","MTEK-W8061"].includes(code))element("errors").textContent+=`${code}: ${message}\n`;},onFrame:()=>{
        if(!workshop)return;frames++;if(frames%6!==0&&frames>1)return;
        const residuals=workshop.actors.flatMap(actor=>actor.controller.residuals()),maximum=Math.max(0,...residuals.map(r=>r.distance));
        element("status").textContent=`Two composed characters · maximum target error ${(maximum*1000).toFixed(2)} mm${workshop.restartedFade?" · recovery resumed at the fade target":""}`;
      }});
      if(current!==revision){mounted.dispose();return;}workshop=mounted;mounted.configure(settings());mounted.overlays(input("overlay").checked);
      if(verify)mounted.app.debug!.step(1,0);if(paused)mounted.app.pause();
      if(verify)(window as unknown as {compositionWorkshop:object}).compositionWorkshop={get workshop(){return workshop;},rebuild};
    }catch(error){workshop?.dispose();workshop=undefined;element("status").textContent="Could not start workshop";element("errors").textContent=String(error);}
  });
}
for(const id of ["speed","action","procedural","additive","feet","grip","root"])input(id).addEventListener("input",()=>workshop?.configure(settings()));
input("overlay").addEventListener("change",()=>workshop?.overlays(input("overlay").checked));
for(const [id,clip] of [["run","Run"],["idle","Idle"]])element(id!).addEventListener("click",()=>workshop?.interrupt(clip!));
element("blend").addEventListener("click",()=>workshop?.locomotion());
element("pause").addEventListener("click",()=>{paused=!paused;if(paused)workshop?.app.pause();else workshop?.app.resume();element("pause").textContent=paused?"Resume":"Pause";});
element("reset").addEventListener("click",rebuild);
window.addEventListener("pagehide",()=>{++revision;workshop?.dispose();},{once:true});rebuild();
