import {Vector3,Quaternion,Euler,Matrix4,PerspectiveCamera} from "three";
import {protocol} from "./scenes.mjs";
import {ReferenceParticles} from "./particles.mjs";
/** Project common source geometry bounds, not either renderer's reported bounds. */
export function regionsFor(scene,frame=1){
  const p=scene.profile,v=scene.camera,camera=new PerspectiveCamera(v.fovY*180/Math.PI,p.width/p.height,v.near,v.far);
  camera.position.fromArray(v.position);camera.lookAt(...v.target);camera.updateMatrixWorld();
  const result=[{id:"foreground",x:0,y:0,width:p.width,height:p.height}];
  for(const o of scene.objects.filter(o=>o.inspect)){
    const q=new Quaternion().setFromEuler(new Euler(...o.rotation,"YXZ"));if(o.assetRotation)q.multiply(new Quaternion(...o.assetRotation));
    const m=new Matrix4().compose(new Vector3(...o.position),q,new Vector3(...o.scale)),points=[];
    const bounds=o.sourceBounds??{min:[-.5,-.5,-.5],max:[.5,.5,.5]};
    for(const x of [bounds.min[0],bounds.max[0]])for(const y of [bounds.min[1],bounds.max[1]])for(const z of [bounds.min[2],bounds.max[2]])points.push(new Vector3(x,y,z).applyMatrix4(m).project(camera));
    const x=Math.max(0,Math.floor(Math.min(...points.map(p=>(p.x+1)*.5*scene.profile.width)))),y=Math.max(0,Math.floor(Math.min(...points.map(p=>(1-p.y)*.5*scene.profile.height))));
    const right=Math.min(p.width,Math.ceil(Math.max(...points.map(p=>(p.x+1)*.5*scene.profile.width)))),bottom=Math.min(p.height,Math.ceil(Math.max(...points.map(p=>(1-p.y)*.5*scene.profile.height))));
    if(right<=x||bottom<=y)throw new Error("Representative object outside the camera");result.push({id:o.id,x,y,width:right-x,height:bottom-y});
  }
  if(scene.emitters.length){
    const simulation=new ReferenceParticles(scene.emitters,scene.profile.particleRate);for(let i=0;i<frame;i++)simulation.advance(protocol.particles.dt);
    const right=new Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new Vector3(0,1,0).applyQuaternion(camera.quaternion),mask=new Set();
    for(const emitter of simulation.emitters)for(const spark of emitter.points){
      const points=[];for(const x of [-.5,.5])for(const y of [-.5,.5])points.push(new Vector3(...spark.p).addScaledVector(right,x*spark.size).addScaledVector(up,y*spark.size).project(camera));
      const minX=Math.max(0,Math.floor(Math.min(...points.map(v=>(v.x+1)*p.width/2)))-1),maxX=Math.min(p.width-1,Math.ceil(Math.max(...points.map(v=>(v.x+1)*p.width/2)))+1),minY=Math.max(0,Math.floor(Math.min(...points.map(v=>(1-v.y)*p.height/2)))-1),maxY=Math.min(p.height-1,Math.ceil(Math.max(...points.map(v=>(1-v.y)*p.height/2)))+1);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)mask.add(y*p.width+x);
    }
    if(mask.size)result.push({id:"ParticlePixels",x:0,y:0,width:p.width,height:p.height,mask:[...mask]});
  }
  return result;
}
export function compareImages(actual,reference,width,height,regions=[{id:"foreground",x:0,y:0,width,height}]){
  if(actual.length!==width*height*4||reference.length!==actual.length)throw new RangeError("Image dimensions differ");
  const background=protocol.clearColorSrgb.match(/\w\w/g).map(v=>parseInt(v,16)),gate=protocol.visualGate;
  const records=regions.map(rect=>{
    let intersection=0,union=0,sum=0,over24=0;const maxima=[],mask=rect.mask?new Set(rect.mask):null;
    for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
      if(mask&&!mask.has(y*width+x))continue;
      const at=(y*width+x)*4;let a=false,b=false,max=0;
      for(let c=0;c<3;c++){a||=Math.abs(actual[at+c]-background[c])>6;b||=Math.abs(reference[at+c]-background[c])>6;max=Math.max(max,Math.abs(actual[at+c]-reference[at+c]));}
      if(!a&&!b)continue;union++;if(a&&b)intersection++;
      for(let c=0;c<3;c++)sum+=Math.abs(actual[at+c]-reference[at+c]);maxima.push(max);if(max>24)over24++;
    }
    maxima.sort((a,b)=>a-b);const meanAbsoluteRgb8=union?sum/(3*union):Infinity,p95MaximumChannelError8=maxima[Math.max(0,Math.ceil(maxima.length*.95)-1)]??Infinity,fractionOver24=union?over24/union:1,silhouetteIoU=union?intersection/union:0;
    const passed=meanAbsoluteRgb8<=gate.meanAbsoluteRgb8&&p95MaximumChannelError8<=gate.p95MaximumChannelError8&&fractionOver24<=gate.fractionOver24&&silhouetteIoU>=gate.silhouetteIoU&&(rect.id!=="foreground"||union>=gate.minimumForegroundPixels);
    const {mask:sampleMask,...bounds}=rect;return {...bounds,projectedSamples:sampleMask?.length??null,pixels:union,meanAbsoluteRgb8,p95MaximumChannelError8,fractionOver24,silhouetteIoU,passed};
  });
  return {passed:records.every(r=>r.passed),regions:records};
}
