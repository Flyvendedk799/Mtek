export type Model = "Fox" | "CesiumMan";
export type Engine = "mtek" | "three";
export const models: readonly Model[] = ["Fox","CesiumMan"];
export const settings = {
  Fox: { mesh:"fox1",clip:"Walk",scale:0.01,rotationX:0,rotationZ:0,vertices:1728,joints:24 },
  CesiumMan: { mesh:"Cesium_Man",clip:"animation_0",scale:1,rotationX:-Math.PI/2,rotationZ:-Math.PI/2,vertices:3273,joints:19 },
} as const;
export function actorPosition(index:number,count:number):readonly [number,number,number] {
  const columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns);
  return [(index%columns-(columns-1)/2)*2.3,0,(Math.floor(index/columns)-(rows-1)/2)*2.3];
}
export function camera(count:number,textured=false):{height:number;position:readonly [number,number,number];target:readonly [number,number,number]} {
  if(textured)return {height:2,position:[3,1.6,2.8],target:[0,0.6,0]};
  const height=count===1?3:count===10?9:22;
  return {height,position:[0,height*0.8,height*1.25],target:[0,0.7,0]};
}
export function phase(index:number,count:number):number { return index/count; }
export function edgeCameraOffset(count:number):number {
  const columns=Math.ceil(Math.sqrt(count));
  return camera(count).height*(protocol.width/protocol.height)/2+(columns-1)*2.3/2-protocol.cullingEdgeInsetMetres;
}
import protocol from "./protocol.json" with {type:"json"};
