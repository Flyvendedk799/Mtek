export type PassKind="compute"|"render";
export function sumPassDurations(values:BigUint64Array,kinds:readonly PassKind[]):{computeMs:number;renderMs:number;totalMs:number;passes:number;computePasses:number;renderPasses:number}{
  let compute=0n,render=0n;
  if(values.length<kinds.length*2)throw new Error("Missing GPU timestamps");
  for(let i=0;i<kinds.length;i++){
    const begin=values[i*2]!,end=values[i*2+1]!;
    if(end<begin)throw new Error("Non-monotonic GPU pass timestamps");
    if(kinds[i]==="compute")compute+=end-begin;else render+=end-begin;
  }
  return {computeMs:Number(compute)/1e6,renderMs:Number(render)/1e6,totalMs:Number(compute+render)/1e6,passes:kinds.length,computePasses:kinds.filter(kind=>kind==="compute").length,renderPasses:kinds.filter(kind=>kind==="render").length};
}

/** All compute/render passes, including skinning in a separate submitted encoder. */
export class AnimationGpuTimer {
  private readonly queries:GPUQuerySet;
  private readonly resolve:GPUBuffer;
  private readonly read:GPUBuffer;
  private active=false;
  private kinds:PassKind[]=[];
  private readonly restore:Array<()=>void>=[];
  constructor(private readonly device:GPUDevice){
    this.queries=device.createQuerySet({type:"timestamp",count:128});
    this.resolve=device.createBuffer({size:1024,usage:0x204});this.read=device.createBuffer({size:1024,usage:0x09});
    const decorate=<T extends GPURenderPassDescriptor|GPUComputePassDescriptor>(kind:PassKind,descriptor:T)=>this.decorate(kind,descriptor);
    const renderDescriptor=Object.getOwnPropertyDescriptor(GPUCommandEncoder.prototype,"beginRenderPass")!,computeDescriptor=Object.getOwnPropertyDescriptor(GPUCommandEncoder.prototype,"beginComputePass")!;
    const render=renderDescriptor.value as GPUCommandEncoder["beginRenderPass"],compute=computeDescriptor.value as GPUCommandEncoder["beginComputePass"];
    GPUCommandEncoder.prototype.beginRenderPass=function(descriptor){return render.call(this,decorate("render",descriptor));};
    GPUCommandEncoder.prototype.beginComputePass=function(descriptor={}){return compute.call(this,decorate("compute",descriptor));};
    this.restore.push(()=>{Object.defineProperty(GPUCommandEncoder.prototype,"beginRenderPass",renderDescriptor);Object.defineProperty(GPUCommandEncoder.prototype,"beginComputePass",computeDescriptor);});
  }
  private decorate<T extends GPURenderPassDescriptor|GPUComputePassDescriptor>(kind:PassKind,descriptor:T):T{
    if(!this.active)return descriptor;
    if(descriptor.timestampWrites!==undefined)throw new Error("Benchmark GPU timer conflicts with an application's pass timestamps");
    if(this.kinds.length>=64)throw new Error("Benchmark GPU timer pass capacity exceeded");
    const slot=this.kinds.length;this.kinds.push(kind);
    return {...descriptor,timestampWrites:{querySet:this.queries,beginningOfPassWriteIndex:2*slot,endOfPassWriteIndex:2*slot+1}};
  }
  begin():void{if(this.active)throw new Error("Previous GPU frame was not read");this.kinds=[];this.active=true;}
  async finish():Promise<ReturnType<typeof sumPassDurations>>{
    this.active=false;
    if(this.kinds.length===0)throw new Error("No GPU passes were measured");
    const encoder=this.device.createCommandEncoder();encoder.resolveQuerySet(this.queries,0,this.kinds.length*2,this.resolve,0);
    encoder.copyBufferToBuffer(this.resolve,0,this.read,0,this.kinds.length*16);this.device.queue.submit([encoder.finish()]);
    await this.read.mapAsync(1);
    const values=new BigUint64Array(this.read.getMappedRange().slice(0,this.kinds.length*16));this.read.unmap();
    return sumPassDurations(values,this.kinds);
  }
  dispose():void{for(const restore of this.restore.reverse())restore();this.queries.destroy();this.resolve.destroy();this.read.destroy();}
}
