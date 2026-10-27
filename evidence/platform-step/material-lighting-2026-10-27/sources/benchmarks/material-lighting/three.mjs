import * as T from "three/webgpu";
import {Fn,float,vec2,texture,reference} from "three/tsl";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {protocol,describeScene,panorama,materials} from "./scenes.mjs";
import {ReferenceParticles} from "./particles.mjs";
const color=rgb=>new T.Color().setRGB(rgb[0],rgb[1],rgb[2],T.LinearSRGBColorSpace);
const rotation=angles=>new T.Quaternion().setFromEuler(new T.Euler(...angles,"YXZ"));
/** A public TSL shadow filter matches the protocol's discrete taps. Native Three PBR/PMREM remain. */
function shadowFilter(radius){
  return Fn(({depthTexture,shadowCoord,shadow})=>{
    const step=vec2(1).div(reference("mapSize","vec2",shadow));let sum=float(0);
    for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)sum=sum.add(texture(depthTexture,shadowCoord.xy.add(step.mul(vec2(x,y)))).compare(shadowCoord.z));
    return sum.div((radius*2+1)**2);
  });
}
export async function createThree(name,quality,{presented=false,control=false}={}){
  const definition=describeScene(name,quality),p=definition.profile,canvas=document.querySelector("canvas"),renderer=new T.WebGPURenderer({canvas,antialias:false,alpha:false,trackTimestamp:false,outputBufferType:T.UnsignedByteType});
  renderer.setPixelRatio(1);renderer.setSize(p.width,p.height,false);canvas.style.width=`${p.width}px`;canvas.style.height=`${p.height}px`;
  renderer.setClearColor(new T.Color(protocol.clearColorSrgb),1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.BasicShadowMap;renderer.info.autoReset=false;await renderer.init();
  const scene=new T.Scene(),view=protocol.camera,camera=new T.PerspectiveCamera(view.fovY*180/Math.PI,p.width/p.height,view.near,view.far);camera.position.fromArray(view.position);camera.lookAt(...view.target);camera.updateMatrixWorld();
  const target=presented?null:new T.RenderTarget(p.width,p.height,{depthBuffer:true});if(target)target.texture.colorSpace=T.SRGBColorSpace;
  const gltf=await new GLTFLoader().loadAsync(new URL("./content.glb",location.href).href),geometries=new Map();gltf.scene.traverse(o=>{if(o.isMesh)geometries.set(o.name,o.geometry);});
  const materialMap=new Map(),imported=materials.filter(m=>m.name!=="Glass");for(let i=0;i<imported.length;i++){const m=await gltf.parser.getDependency("material",i);m.shadowSide=T.FrontSide;materialMap.set(imported[i].name,m);}
  const glass=materials.find(m=>m.name==="Glass");materialMap.set("Glass",new T.MeshStandardMaterial({color:color(glass.color),opacity:glass.color[3],metalness:glass.metallic,roughness:glass.roughness,transparent:true,depthWrite:false,shadowSide:T.FrontSide}));
  const groups=new Map();for(const o of definition.objects){const key=`${o.shape}:${o.material}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);}
  for(const objects of groups.values()){
    const first=objects[0],geometry=geometries.get(first.shape==="Sphere"?"Sphere_"+quality:first.shape),material=materialMap.get(first.material);
    if(!material.transparent&&objects.length>1){
      const batch=new T.InstancedMesh(geometry,material,objects.length),matrix=new T.Matrix4();
      for(const [i,o] of objects.entries()){matrix.compose(new T.Vector3(...o.position),rotation(o.rotation),new T.Vector3(...o.scale));batch.setMatrixAt(i,matrix);}
      batch.castShadow=true;batch.receiveShadow=true;scene.add(batch);
    }else for(const o of objects){const m=new T.Mesh(geometry,material);m.name=o.id;m.position.fromArray(o.position);m.scale.fromArray(o.scale);m.quaternion.copy(rotation(o.rotation));m.castShadow=o.material!=="Glass";m.receiveShadow=true;if(material.transparent)m.renderOrder=10000;scene.add(m);}
  }
  const sun=new T.DirectionalLight(new T.Color(definition.sun.color),definition.sun.intensity),direction=new T.Vector3(0,0,-1).applyQuaternion(rotation(definition.sun.rotation)),settings=protocol.shadow;
  sun.target.position.fromArray(settings.center);sun.position.copy(sun.target.position).addScaledVector(direction,-settings.distance);sun.castShadow=true;sun.shadow.mapSize.set(p.shadowResolution,p.shadowResolution);
  Object.assign(sun.shadow.camera,{left:-settings.size/2,right:settings.size/2,top:settings.size/2,bottom:-settings.size/2,near:settings.near,far:settings.far});sun.shadow.bias=-settings.depthBias;sun.shadow.normalBias=settings.normalBias;sun.shadow.filterNode=shadowFilter(p.shadowRadius);scene.add(sun,sun.target);
  if(definition.point){const l=new T.PointLight(new T.Color(definition.point.color),definition.point.intensity,definition.point.range,2);l.position.fromArray(definition.point.position);scene.add(l);}
  const env=panorama(quality),half=Uint16Array.from(env.data,T.DataUtils.toHalfFloat),environment=new T.DataTexture(half,env.width,env.height,T.RGBAFormat,T.HalfFloatType);environment.flipY=true;environment.mapping=T.EquirectangularReflectionMapping;environment.minFilter=T.LinearFilter;environment.magFilter=T.LinearFilter;environment.needsUpdate=true;
  const generator=new T.PMREMGenerator(renderer),prefilter=generator.fromEquirectangular(environment);scene.environment=prefilter.texture;scene.environmentIntensity=protocol.environment.intensity;
  const simulation=new ReferenceParticles(definition.emitters,p.particleRate),batches=[],sparkMaterials=[];
  for(const e of definition.emitters){
    const material=new T.MeshBasicMaterial({color:color(e.color),opacity:e.color[3],transparent:true,depthWrite:false});sparkMaterials.push(material);
    const marker=new T.Mesh(geometries.get("Quad"),material);marker.position.fromArray(e.position);marker.renderOrder=10000;scene.add(marker);
    const batch=new T.InstancedMesh(geometries.get("Quad"),material,protocol.particles.capacityPerEmitter);batch.count=0;batch.frustumCulled=false;batch.instanceMatrix.setUsage(T.DynamicDrawUsage);batches.push(batch);scene.add(batch);
  }
  const matrix=new T.Matrix4(),position=new T.Vector3(),scale=new T.Vector3(),billboard=camera.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2));let frameCount=0,lastRender={};
  await renderer.compileAsync(scene,camera);
  const frame=delta=>{
    renderer.info.reset();
    if(!control)simulation.advance(delta);const ranked=[];
    for(let i=0;i<simulation.emitters.length;i++){
      const points=[...simulation.emitters[i].points].sort((a,b)=>position.fromArray(a.p).applyMatrix4(camera.matrixWorldInverse).z-position.fromArray(b.p).applyMatrix4(camera.matrixWorldInverse).z),batch=batches[i];batch.count=points.length;
      let mean=0;for(let j=0;j<points.length;j++){const s=points[j];position.fromArray(s.p);scale.setScalar(s.size);matrix.compose(position,billboard,scale);batch.setMatrixAt(j,matrix);mean+=position.applyMatrix4(camera.matrixWorldInverse).z;}
      if(points.length){batch.instanceMatrix.needsUpdate=true;ranked.push({batch,mean:mean/points.length});}
    }
    ranked.sort((a,b)=>a.mean-b.mean);for(let i=0;i<ranked.length;i++)ranked[i].batch.renderOrder=i;
    renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(null);lastRender={...renderer.info.render};frameCount++;
  };
  return {definition,canvas,frame,read:async()=>{if(!target)throw new Error("Use a native screenshot for a presented canvas");const b=await renderer.readRenderTargetPixelsAsync(target,0,0,p.width,p.height);return {width:p.width,height:p.height,data:new Uint8Array(b.buffer,b.byteOffset,b.byteLength)};},info:()=>({frames:frameCount,particles:simulation.count,render:lastRender,memory:{...renderer.info.memory},opaqueBatches:[...groups.values()].filter(g=>g[0].material!=="Glass").length}),
    dispose:async()=>{target?.dispose();prefilter.dispose();generator.dispose();environment.dispose();const textures=new Set(),images=new Set();for(const m of [...materialMap.values(),...sparkMaterials]){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();}for(const t of textures){images.add(t.source.data);t.dispose();}for(const image of images)image?.close?.();for(const g of geometries.values())g.dispose();scene.clear();gltf.scene.clear();await renderer.dispose();return {frames:frameCount,particles:simulation.count};}};
}
