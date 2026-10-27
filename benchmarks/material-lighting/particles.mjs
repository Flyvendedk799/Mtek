import {protocol} from "./scenes.mjs";
/** Independent implementation of the declared emitter equations/seed. No runtime imports. */
export class ReferenceParticles {
  constructor(emitters,rate){this.emitters=emitters.map(e=>({...e,credit:0,points:[]}));this.rate=rate;this.seed=protocol.particles.seed;}
  random(){
    this.seed=(this.seed+0x6d2b79f5)>>>0;let value=this.seed;value=Math.imul(value^(value>>>15),value|1);value^=value+Math.imul(value^(value>>>7),value|61);return ((value^(value>>>14))>>>0)/2**32;
  }
  advance(delta){
    const {gravity,speed,lifetime,size,capacityPerEmitter}=protocol.particles;
    for(const emitter of this.emitters){
      const p=emitter.points;
      for(let i=p.length-1;i>=0;i--){const s=p[i];s.v[1]-=gravity*delta;for(let c=0;c<3;c++)s.p[c]+=s.v[c]*delta;s.age+=delta;if(s.age>=lifetime)p.splice(i,1);}
      emitter.credit+=this.rate*delta;const births=Math.floor(emitter.credit);emitter.credit-=births;
      for(let i=0;i<births&&p.length<capacityPerEmitter;i++){
        const up=this.random(),angle=this.random()*2*Math.PI,ring=Math.sqrt(Math.max(0,1-up*up));
        p.push({p:[...emitter.position],v:[ring*Math.cos(angle)*speed,up*speed,ring*Math.sin(angle)*speed],age:0,size});
      }
    }
  }
  get count(){return this.emitters.reduce((n,e)=>n+e.points.length,0);}
}
