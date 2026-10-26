import {createAnimationController, type AnimationController, type ExtensionContext, type MtekSkin, type SceneTransform} from "@mtek/runtime-web";
import {InspectorController, mountInspectorPanel, INSPECTOR_METRICS_SERVICE, type InspectorMetricsSource} from "@mtek/inspector";

const matrix = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const skin: MtekSkin = {meshNode:0,nodes:[
  {name:"Root",parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},
  {name:"Hand",parent:0,translation:[0,1,0],rotation:[0,0,0,1],scale:[1,1,1]},
],joints:[0,1],inverseBind:[matrix,matrix],indices:[[0,1,0,0]],weights:[[1,0,0,0]],clips:[
  {name:"Reach",duration:2,channels:[{node:1,path:"translation",interpolation:"linear",times:[0,1,2],values:[0,1,0,1,1.5,0,0,1,0]}]},
]};
let epoch = 0, records: readonly SceneTransform[] = [], cleanup: (() => void) | undefined;
const players = new Map<string,AnimationController>(), errors: string[] = [];
const inspector = new InspectorController({interval:0,onError:error=>errors.push(String(error))});
const panelCleanup = mountInspectorPanel(inspector,document.querySelector<HTMLElement>("#inspector")!);
function reset(): void {
  for(const player of new Set(players.values()))player.dispose(); players.clear();epoch++;
  records=["Crate","Crate","Rig"].map((name,i)=>({id:`scene:${epoch}:${name}${i}`,name,position:{x:i*2,y:0,z:0},rotation:{x:0,y:0,z:0,w:1},scale:{x:1,y:1,z:1},visible:true}));
  players.set(records[2]!.id,createAnimationController(skin,{clip:"Reach"}));
}
const context: ExtensionContext = {
  apiVersion:1,readTransforms:()=>records.map(row=>structuredClone(row)),
  writeTransforms(updates){
    for(const update of updates)if(!records.some(row=>row.id===update.id))throw new RangeError("Stale sandbox entity");
    records=records.map(row=>{const update=updates.find(update=>update.id===row.id);if(update===undefined)return row;
      const q=update.rotation,length=q===undefined?1:Math.hypot(q.x,q.y,q.z,q.w);
      return {...row,...structuredClone(update),rotation:q===undefined?row.rotation:{x:q.x/length,y:q.y/length,z:q.z/length,w:q.w/length}};});
  },
  animation(id){if(!records.some(row=>row.id===id))throw new RangeError("Stale sandbox entity");return players.get(id)?.player;},
  shareAnimation(source,targets){const player=players.get(source);if(player===undefined)throw new RangeError("No animation");for(const target of targets)players.set(target,player);},
  detachAnimation(id){
    const previous=players.get(id);if(previous===undefined)throw new RangeError("No animation");
    const next=createAnimationController(skin,{clip:"Reach"});next.player.clock.seek(0,previous.player.clock.time(0));next.player.clock.pause(0);next.player.evaluate();players.set(id,next);
    if(![...players.values()].includes(previous))previous.dispose();return next.player;
  },
  service<T>(name:string):T|undefined {const source:InspectorMetricsSource={read:()=>({liveEntities:records.length})};return name===INSPECTOR_METRICS_SERVICE?source as T:undefined;},
};
const state=document.querySelector<HTMLOutputElement>("#state")!,body=document.querySelector<HTMLTableSectionElement>("#records")!;
function render():void {
  body.replaceChildren(...records.map(record=>{const row=document.createElement("tr");for(const text of [record.name,`${record.position.x.toFixed(2)}, ${record.position.y.toFixed(2)}, ${record.position.z.toFixed(2)}`,`${record.scale.x.toFixed(2)}, ${record.scale.y.toFixed(2)}, ${record.scale.z.toFixed(2)}`]){const cell=document.createElement("td");cell.textContent=text;row.append(cell);}row.dataset["entity"]=record.id;return row;}));
  state.textContent=`Scene generation ${epoch} · ${records.length} entities · ${inspector.snapshot().pending} queued command(s)\nNo renderer or automatic frame loop is running.`;
}
function connect():void {const result=inspector.extension.setup(context);cleanup=typeof result==="function"?result:undefined;}
function refresh():void {if(inspector.snapshot().status==="ready")inspector.refresh();}
function step(dt=.1):void {inspector.extension.beforeFrame?.(context,dt);for(const player of new Set(players.values()))player.update(dt);inspector.extension.afterFrame?.(context,dt);render();}
reset();connect();inspector.select(records[0]!.id);inspector.subscribe(render);
document.querySelector("#step")!.addEventListener("click",()=>step());
document.querySelector("#replace")!.addEventListener("click",()=>{reset();refresh();render();});
document.querySelector("#remove")!.addEventListener("click",()=>{const id=inspector.snapshot().selectedId;records=records.filter(row=>row.id!==id);const player=id===null?undefined:players.get(id);if(id!==null)players.delete(id);if(player!==undefined&&![...players.values()].includes(player))player.dispose();refresh();render();});
document.querySelector("#connection")!.addEventListener("click",event=>{const button=event.currentTarget as HTMLButtonElement;if(inspector.snapshot().status==="ready"){cleanup?.();cleanup=undefined;button.textContent="Connect inspector";}else{connect();button.textContent="Disconnect inspector";}render();});
Object.assign(window,{__inspectorSandbox:{inspector,step,records:()=>records,errors,disposePanel:panelCleanup,rename:(name:string)=>{records=records.map((record,i)=>i===0?{...record,name}:record);refresh();render();}}});
addEventListener("pagehide",()=>{cleanup?.();panelCleanup();inspector.dispose();for(const player of new Set(players.values()))player.dispose();});
render();
