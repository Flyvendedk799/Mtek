import type {Model} from "./layout.ts";
import protocol from "./protocol.json" with {type:"json"};
export interface Configuration {model:Model;count:number;textured?:boolean;display?:boolean;culling?:boolean;cameraOffset?:number;captureJoints?:boolean}
export interface AnimationApp {
  frame(dt:number):void;
  seek(phase:number):void;
  selectClip(name:string):void;
  readonly clips:readonly string[];
  joints():number[];
  readPixels():Promise<Uint8Array>;
  dispose():Promise<void>;
  readonly canvas:HTMLCanvasElement;
  info():Record<string,unknown>;
}
export function makeCanvas():HTMLCanvasElement {
  const canvas=document.createElement("canvas");canvas.width=protocol.width;canvas.height=protocol.height;
  canvas.style.cssText=`width:${protocol.width}px;height:${protocol.height}px`;document.body.append(canvas);return canvas;
}
