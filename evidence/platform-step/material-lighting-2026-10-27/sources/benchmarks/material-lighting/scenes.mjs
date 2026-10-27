import protocol from "./protocol.json" with {type:"json"};
export {protocol};
export const materials=[
  {name:"Mapped",color:[.7,.8,.9,1],metallic:.25,roughness:.6,mapped:true},
  {name:"Copper",color:[.72,.31,.12,1],metallic:.9,roughness:.32},
  {name:"Ceramic",color:[.72,.76,.81,1],metallic:0,roughness:.5},
  {name:"Ground",color:[.17,.21,.27,1],metallic:0,roughness:.9},
  {name:"Wall",color:[.55,.48,.39,1],metallic:0,roughness:.8},
  {name:"Glass",color:[.08,.38,.6,.35],metallic:0,roughness:.35},
];
export function describeScene(name,quality){
  if(!protocol.scenes.includes(name)||!protocol.profiles[quality])throw new Error("Unknown material workload/profile");
  const profile=protocol.profiles[quality],objects=[],emitters=[];
  const add=(id,shape,position,scale,material,rotation=[0,0,0],inspect=false)=>objects.push({id,shape,position,scale,material,rotation,inspect});
  add("Floor","Box",[0,-.15,0],[16,.3,14],"Ground");
  if(name==="product"||name==="indoor"){
    for(const [i,material] of ["Mapped","Copper","Ceramic"].entries()){
      const x=(i-1)*2.6;add(`Plinth${i}`,"Box",[x,.25,0],[2,.5,2],"Wall");
      add(`Product${i}`,i===0?"Box":"Sphere",[x,1.45,0],[1.7,1.7,1.7],material,[0,.25*(i+1),0],true);
    }
  }
  if(name==="indoor"){
    add("BackLeft","Box",[-3.75,2.5,-4],[2.5,5,.2],"Wall");add("BackRight","Box",[3.75,2.5,-4],[2.5,5,.2],"Wall");
    add("WindowSill","Box",[0,.65,-4],[5,1.3,.2],"Wall");add("WindowLintel","Box",[0,4.5,-4],[5,1,.2],"Wall");
    add("LeftWall","Box",[-5,2.5,0],[.2,5,8],"Wall");
  }
  if(name==="outdoor")for(let z=0;z<4;z++)for(let x=0;x<4;x++)add(`Sculpture${x}_${z}`,(x+z)%2?"Sphere":"Box",[(x-1.5)*2.2,.7,(z-1.5)*2],[1.2,1.4,1.2],["Mapped","Copper","Ceramic"][(x+z)%3],[0,(x-z)*.23,0],x===1&&z===2);
  if(name==="transparency"){
    add("BehindGlass","Sphere",[0,1.4,-1],[2.2,2.2,2.2],"Mapped",[0,.3,0],true);
    for(let i=0;i<4;i++)add(`Pane${i}`,"Box",[(i-1.5)*.75,1.5,1.5-i*.45],[2,2.6,.06],"Glass",[0,.12*(i-1.5),0],true);
    add("SideCopper","Sphere",[-3,1,0],[1.6,1.6,1.6],"Copper");
  }
  if(name==="particles"){
    add("Obstacle","Box",[0,.5,-1],[4,1,1],"Mapped");
    for(let i=0;i<profile.emitters;i++){
      const x=(i-(profile.emitters-1)/2)*1.5,color=i%2?[.1,.65,.95,.45]:[1,.3,.05,.45];
      emitters.push({id:`Emitter${i}`,position:[x,.2,0],color});
    }
  }
  return {name,quality,profile,objects,emitters,sun:{rotation:[-.9,.6,0],color:"#fff2dc",intensity:name==="indoor"?.6:2.5},point:name==="indoor"?{position:[1.5,3,2],color:"#b5d6ff",intensity:50,range:12}:null};
}
export function panorama(quality){
  const {environmentWidth:width,environmentHeight:height}=protocol.profiles[quality],data=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const theta=(y+.5)/height*Math.PI,phi=((x+.5)/width-.5)*2*Math.PI,up=Math.cos(theta),east=Math.sin(theta)*Math.cos(phi),lobe=Math.max(0,.3*east+.9*up)**8;
    const at=(y*width+x)*4;data[at]=.12+.12*Math.max(0,up)+2*lobe;data[at+1]=.15+.2*Math.max(0,up)+1.7*lobe;data[at+2]=.18+.35*Math.max(0,up)+1.3*lobe;data[at+3]=1;
  }
  return {width,height,data};
}
export function mtekSource(scene,{control=false}={}){
  const v=a=>`vec3(${a.map(n=>Number.isInteger(n)?`${n}.0`:String(n)).join(", ")})`,p=protocol.camera,lines=[`const MODEL = asset.glb("../models/content.glb");`,`scene Workload {`,`    clear_color: ${protocol.clearColorSrgb};`,`    ambient_intensity: 0.0;`,`    camera Main { position: ${v(p.position)}; target: ${v(p.target)}; projection: Perspective { fov_y: ${p.fovY}; near: ${p.near}; far: ${p.far}.0 }; exposure: -0.2630344; }`,`    entity Sun { rotation: quat.euler(${scene.sun.rotation.join(", ")}); light: DirectionalLight { color: ${scene.sun.color}; intensity: ${scene.sun.intensity} }; }`];
  if(scene.point)lines.push(`    entity Fill { position: ${v(scene.point.position)}; light: PointLight { color: ${scene.point.color}; intensity: ${scene.point.intensity}.0; range: ${scene.point.range}.0 }; }`);
  for(const o of scene.objects){
    const m=materials.find(m=>m.name===o.material),material=o.material==="Glass"?`Pbr { base_color: color.linear(${v(m.color.slice(0,3))}, ${m.color[3]}); metallic: ${m.metallic}.0; roughness: ${m.roughness} }`:`MODEL.material("${o.material}")`;
    lines.push(`    entity ${o.id} { position: ${v(o.position)}; rotation: quat.euler(${o.rotation.map(n=>Number.isInteger(n)?`${n}.0`:n).join(", ")}); scale: ${v(o.scale)}; mesh: MODEL.mesh("${o.shape==="Sphere"?"Sphere_"+scene.quality:o.shape}"); material: ${material}; }`);
  }
  for(const e of scene.emitters){const s=protocol.particles;lines.push(`    entity ${e.id} { position: ${v(e.position)}; mesh: MODEL.mesh("Quad"); material: Unlit { color: color.linear(${v(e.color.slice(0,3))}, ${e.color[3]}) }; ${control?"":`particles: Emitter { rate: ${scene.profile.particleRate}.0; lifetime: ${s.lifetime}; speed: ${s.speed}.0; size: ${s.size}; gravity: ${s.gravity}.0 };`} }`);}
  lines.push("}");return lines.join("\n")+"\n";
}
