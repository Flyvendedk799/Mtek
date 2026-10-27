const CAPACITY=128,QUERY_RESOLVE=512,COPY_SRC=4,COPY_DST=8,MAP_READ=1;
export function summarizePasses(ticks,passes){
  if(ticks.length!==passes.length*2||passes.length===0)throw new Error("Incomplete GPU query coverage");
  let total=0n;const result=passes.map((pass,i)=>{const begin=BigInt(ticks[i*2]),end=BigInt(ticks[i*2+1]);if(end<begin)throw new Error("GPU timestamp went backwards");total+=end-begin;return {...pass,beginNanoseconds:String(begin),endNanoseconds:String(end),milliseconds:Number(end-begin)/1e6};});
  if(total===0n)throw new Error("GPU queries returned no measured work");return {milliseconds:Number(total)/1e6,passes:result,encoders:new Set(passes.map(p=>p.encoder)).size};
}
/** Times every pass in every frame encoder. Query resolve/readback is outside the measured passes. */
export class AllPassTimer {
  constructor(device,prototype=globalThis.GPUCommandEncoder.prototype){
    if(!device.features.has("timestamp-query"))throw new Error("timestamp-query unavailable");
    this.device=device;this.prototype=prototype;this.active=false;this.pending=false;this.passes=[];this.encoders=new Map();this.restorers=[];
    this.queries=device.createQuerySet({type:"timestamp",count:CAPACITY*2});
    this.resolve=device.createBuffer({size:CAPACITY*16,usage:QUERY_RESOLVE|COPY_SRC});this.read=device.createBuffer({size:CAPACITY*16,usage:MAP_READ|COPY_DST});
    for(const [method,kind] of [["beginRenderPass","render"],["beginComputePass","compute"]]){
      const descriptor=Object.getOwnPropertyDescriptor(prototype,method),original=prototype[method],timer=this;
      const wrapped=function(settings,...args){
        let value=settings;
        if(timer.active){
          if(settings?.timestampWrites)throw new Error("Application already owns pass timestamps");
          if(timer.passes.length>=CAPACITY)throw new Error("GPU pass query capacity exceeded");
          if(!timer.encoders.has(this))timer.encoders.set(this,timer.encoders.size);
          const index=timer.passes.length;timer.passes.push({kind,label:settings?.label??null,encoder:timer.encoders.get(this)});
          value={...settings,timestampWrites:{querySet:timer.queries,beginningOfPassWriteIndex:index*2,endOfPassWriteIndex:index*2+1}};
        }
        return original.call(this,value,...args);
      };
      Object.defineProperty(prototype,method,{...descriptor,value:wrapped});this.restorers.push(()=>{if(prototype[method]!==wrapped)throw new Error("GPU instrumentation changed before disposal");Object.defineProperty(prototype,method,descriptor);});
    }
  }
  begin(){if(this.active||this.pending)throw new Error("Previous GPU frame is unfinished");this.active=true;this.passes.length=0;this.encoders.clear();}
  async end(){
    if(!this.active)throw new Error("No GPU frame started");this.active=false;this.pending=true;
    try{
      const bytes=this.passes.length*16;if(!bytes)throw new Error("No GPU passes observed");
      const encoder=this.device.createCommandEncoder({label:"benchmark-query-readback"});encoder.resolveQuerySet(this.queries,0,this.passes.length*2,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,this.read,0,bytes);this.device.queue.submit([encoder.finish()]);
      await this.read.mapAsync(MAP_READ,0,bytes);let ticks;
      try{ticks=new BigUint64Array(this.read.getMappedRange(0,bytes)).slice();}finally{this.read.unmap();}
      return summarizePasses(ticks,this.passes);
    }finally{this.pending=false;}
  }
  dispose(){if(this.active||this.pending)throw new Error("Cannot dispose a running GPU query");for(const restore of this.restorers.reverse())restore();this.queries.destroy();this.resolve.destroy();this.read.destroy();}
}
