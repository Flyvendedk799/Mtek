import {protocol,describeScene,panorama} from "./scenes.mjs";
export async function createMtek(name,quality,{presented=false,control=false}={}){
  const definition=describeScene(name,quality),p=definition.profile,module=await import(new URL(`./programs/${name}-${quality}${control?"-control":""}/app.js`,location.href)),diagnostics=[],canvas=document.querySelector("canvas");
  canvas.width=p.width;canvas.height=p.height;canvas.style.width=`${p.width}px`;canvas.style.height=`${p.height}px`;
  const shadow=protocol.shadow,environment=panorama(quality),app=await module.mountMtek(canvas,module.default,{failureDisplay:"none",pauseWhenHidden:false,onDiagnostic:d=>diagnostics.push(d),
    rendering:{shadows:{light:"Sun",quality:quality==="low"?"low":"medium",center:shadow.center,size:shadow.size,distance:shadow.distance,near:shadow.near,far:shadow.far,bias:shadow.depthBias,normalBias:shadow.normalBias},environment:{...environment,intensity:protocol.environment.intensity,rotation:protocol.environment.rotation,quality:p.environmentQuality}},
    test:{manualClock:true,...(presented?{}:{renderTarget:{width:p.width,height:p.height}})}});
  return {definition,canvas,frame:delta=>app.debug.step(1,delta),read:async()=>app.debug.readPixels(),info:()=>({diagnostics,counters:app.debug.counters()}),dispose:async()=>{app.dispose();return {runtime:app.debug.counters(),diagnostics};}};
}
