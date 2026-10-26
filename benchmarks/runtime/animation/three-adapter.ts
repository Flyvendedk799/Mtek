import {AnimationMixer,Color,LinearFilter,MeshBasicMaterial,NoToneMapping,Object3D,OrthographicCamera,RenderTarget,RepeatWrapping,Scene,SkinnedMesh,SRGBColorSpace,TextureLoader,Vector3,WebGPURenderer} from "three/webgpu";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {clone} from "three/addons/utils/SkeletonUtils.js";
import {actorPosition,camera,phase,settings} from "./layout.ts";
import protocol from "./protocol.json" with {type:"json"};
import {makeCanvas,type AnimationApp,type Configuration} from "./types.ts";
export const engine="three";
export async function createThree(configuration:Configuration):Promise<AnimationApp>{
  const {model,count,textured=false,display=false}=configuration;
  const canvas=makeCanvas(),renderer=new WebGPURenderer({canvas,antialias:false,trackTimestamp:false});
  renderer.setPixelRatio(1);renderer.setSize(protocol.width,protocol.height,false);
  renderer.setClearColor(new Color(protocol.clearColor),1);renderer.toneMapping=NoToneMapping;renderer.outputColorSpace=SRGBColorSpace;
  await renderer.init();
  const target=new RenderTarget(protocol.width,protocol.height,{depthBuffer:true});target.texture.colorSpace=SRGBColorSpace;
  const view=camera(count,textured),half=view.height/2,aspect=protocol.width/protocol.height;
  const cameraObject=new OrthographicCamera(-half*aspect,half*aspect,half,-half,0.1,200);cameraObject.position.fromArray(view.position);cameraObject.lookAt(new Vector3().fromArray(view.target));cameraObject.updateMatrixWorld();
  const offset=configuration.cameraOffset??0;if(offset!==0){cameraObject.position.x+=offset;cameraObject.lookAt(view.target[0]+offset,view.target[1],view.target[2]);cameraObject.updateMatrixWorld();}
  const scene=new Scene(),gltf=await new GLTFLoader().loadAsync(`./assets/${model}.glb`);
  if(configuration.captureJoints===true)gltf.scene.traverse(object=>{const association=gltf.parser.associations.get(object);if(association?.nodes!==undefined)object.userData["sourceNode"]=association.nodes;});
  const metadata=gltf.parser.json as {nodes:unknown[];skins:Array<{joints:number[]}>};
  const jointIndices=metadata.skins[0]!.joints;
  let clip=gltf.animations.find(clip=>clip.name===settings[model].clip)??gltf.animations[0]!;
  const material=new MeshBasicMaterial({color:textured?0xffffff:new Color(protocol.color)});
  if(textured){const texture=await new TextureLoader().loadAsync(`./assets/${model}.${model==="Fox"?"png":"jpg"}`);texture.colorSpace=SRGBColorSpace;texture.flipY=false;texture.wrapS=RepeatWrapping;texture.wrapT=RepeatWrapping;texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;texture.generateMipmaps=false;material.map=texture;}
  const mixers:AnimationMixer[]=[],actions:NonNullable<ReturnType<AnimationMixer["clipAction"]>>[]=[],roots:Object3D[]=[],skins:SkinnedMesh[]=[];
  const actorNodes:Array<Map<number,Object3D>>=[];
  for(let i=0;i<count;i++){
    const root=clone(gltf.scene),wrapper=new Object3D();wrapper.position.fromArray(actorPosition(i,count));wrapper.scale.setScalar(settings[model].scale);wrapper.add(root);scene.add(wrapper);roots.push(root);
    root.traverse(object=>{if(object instanceof SkinnedMesh){const mesh=object as SkinnedMesh;mesh.material=material;mesh.frustumCulled=false;skins.push(mesh);}});
    if(configuration.captureJoints===true){const nodes=new Map<number,Object3D>();root.traverse(object=>{const index=object.userData["sourceNode"] as number|undefined;if(index!==undefined)nodes.set(index,object);});actorNodes.push(nodes);}
    const mixer=new AnimationMixer(root),action=mixer.clipAction(clip);if(action===null)throw new Error("Three.js could not bind the original animation clip");action.play();action.time=phase(i,count)*clip.duration;mixers.push(mixer);actions.push(action);mixer.update(0);
  }
  const position=new Vector3();scene.updateMatrixWorld(true);
  return {canvas,clips:gltf.animations.map(clip=>clip.name),
    frame(dt){for(const mixer of mixers)mixer.update(dt);renderer.setRenderTarget(display?null:target);renderer.render(scene,cameraObject);},
    seek(at){actions.forEach((action,i)=>{action.time=((at+phase(i,count))%1)*clip.duration;mixers[i]!.update(0);});scene.updateMatrixWorld(true);},
    selectClip(name){const selected=gltf.animations.find(clip=>clip.name===name);if(selected===undefined)throw new Error(`Unknown clip: ${name}`);clip=selected;mixers.forEach((mixer,i)=>{mixer.stopAllAction();const action=mixer.clipAction(clip);if(action===null)throw new Error("Could not select clip");action.reset().play();actions[i]=action;mixer.update(0);});},
    joints(){scene.updateMatrixWorld(true);const result:number[]=[];for(const nodes of actorNodes)for(const index of jointIndices){const node=nodes.get(index);if(node===undefined)throw new Error(`Missing original joint index ${index}`);node.getWorldPosition(position);result.push(position.x,position.y,position.z);}return result;},
    async readPixels(){const bytes=await renderer.readRenderTargetPixelsAsync(target,0,0,protocol.width,protocol.height);return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength).slice();},
    async dispose(){for(const mixer of mixers){mixer.stopAllAction();mixer.uncacheRoot(mixer.getRoot());}for(const mesh of skins)mesh.skeleton.dispose();gltf.scene.traverse(object=>{if(object instanceof SkinnedMesh)(object as SkinnedMesh).geometry.dispose();});material.map?.dispose();material.dispose();target.dispose();await renderer.dispose();canvas.remove();},
    info(){return {engine:"three",version:protocol.threeVersion,skinNodes:metadata.nodes.length,joints:jointIndices.length,vertices:settings[model].vertices,actors:roots.length,render:renderer.info.render};},
  };
}

export {createThree as create};
