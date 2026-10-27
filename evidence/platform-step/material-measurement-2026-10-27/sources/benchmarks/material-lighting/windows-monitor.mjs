import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";

export const monotonicMs=()=>Number(process.hrtime.bigint())/1e6;

/** Read-only OS counters and QPC; keeps console startup out of measured passes. */
export async function createWindowsMonitor(){
  assert.equal(process.platform,"win32","Windows presentation/counter collection requires Windows");
  // A parent PowerShell 7 session can export module paths incompatible with the
  // built-in Windows PowerShell host. Let the child construct its own defaults.
  const environment={...process.env};delete environment.PSModulePath;
  const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",readFileSync(new URL("./windows-monitor.ps1",import.meta.url),"utf8")],{env:environment,windowsHide:true,stdio:["pipe","pipe","pipe"]});
  const pending=new Map();let sequence=0,stderr="",readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const startup=setTimeout(()=>readyReject(new Error("OS monitor startup timed out")),15000);
  child.stderr.on("data",b=>{stderr+=b.toString();});
  const lines=createInterface({input:child.stdout});
  lines.on("line",line=>{
    try{
      const value=JSON.parse(line.replace(/^\uFEFF/,""));
      if(value.event==="ready"){clearTimeout(startup);readyResolve(value);return;}
      const request=pending.get(value.id);if(!request)return;pending.delete(value.id);clearTimeout(request.timeout);
      if(value.error)request.reject(new Error(value.error));else request.resolve(value);
    }catch(error){readyReject(error);}
  });
  child.on("error",error=>{clearTimeout(startup);readyReject(error);for(const p of pending.values())p.reject(error);});
  child.on("close",code=>{clearTimeout(startup);const error=new Error(`OS monitor closed (${String(code)}): ${stderr}`);readyReject(error);for(const p of pending.values()){clearTimeout(p.timeout);p.reject(error);}pending.clear();});
  let metadata;try{metadata=await ready;}catch(error){child.stdin.end();throw error;}
  return {metadata,request(kind,extra={}){
    const id=++sequence;
    return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`OS monitor ${kind} timed out`));},15000);pending.set(id,{resolve,reject,timeout});child.stdin.write(JSON.stringify({id,kind,...extra})+"\n");});
  },async close(){child.stdin.end(JSON.stringify({kind:"stop"})+"\n");if(child.exitCode===null)await new Promise(resolve=>child.once("close",resolve));lines.close();}};
}

/** Remote milliseconds = Node monotonic milliseconds + offsetMs. */
export async function calibrateClock(readRemote,samples=12){
  const attempts=[];
  for(let i=0;i<samples;i++){const before=monotonicMs(),remote=await readRemote(),after=monotonicMs();assert(Number.isFinite(remote));attempts.push({before,after,remote,roundTripMs:after-before,offsetMs:remote-(before+after)/2});}
  const best=[...attempts].sort((a,b)=>a.roundTripMs-b.roundTripMs)[0];
  return {offsetMs:best.offsetMs,uncertaintyMs:best.roundTripMs/2,attempts};
}

/** Engine sums retain all nonzero context counters; explicit zero rows are omitted by the worker. */
export function gpuBusy(sample,excludedPids=[]){
  assert(sample.counterRows>0,"GPU counters unavailable");const excluded=new Set(excludedPids),engines=new Map(),external=new Map();
  for(const row of sample.nonzero){
    const match=/^pid_(\d+)_(luid_.+_phys_\d+_eng_\d+)_engtype_(.+)$/.exec(row.name);
    assert(match,`Unknown GPU counter name: ${row.name}`);assert(Number.isFinite(row.percent)&&row.percent>=0&&row.percent<=100);
    const key=match[2];engines.set(key,(engines.get(key)??0)+row.percent);
    if(!excluded.has(Number(match[1])))external.set(key,(external.get(key)??0)+row.percent);
  }
  return {allEnginePeakPercent:Math.min(100,Math.max(0,...engines.values())),externalEnginePeakPercent:Math.min(100,Math.max(0,...external.values()))};
}
