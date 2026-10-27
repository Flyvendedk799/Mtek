import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join} from "node:path";
import pin from "./presentmon.json" with {type:"json"};
import {protocol} from "./scenes.mjs";

export async function ensurePresentMon(monitor){
  const directory=new URL("./.out/tools/",import.meta.url);await mkdir(directory,{recursive:true});
  const path=process.env.MTEK_PRESENTMON_BIN??new URL(`PresentMon-${pin.version}-x64.exe`,directory);
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code!=="ENOENT"||process.env.MTEK_PRESENTMON_BIN)throw error;const response=await fetch(pin.url,{signal:AbortSignal.timeout(30000)});assert(response.ok,`PresentMon download: ${String(response.status)}`);bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash("sha256").update(bytes).digest("hex"),pin.sha256);await writeFile(path,bytes,{flag:"wx"});}
  assert.equal(bytes.length,pin.bytes);assert.equal(createHash("sha256").update(bytes).digest("hex"),pin.sha256,"PresentMon differs from the pinned official release");
  const executable=path instanceof URL?(await import("node:url")).fileURLToPath(path):path;
  const signature=await monitor.request("signature",{path:executable});assert.equal(signature.status,"Valid");assert.match(signature.subject,/CN=Intel Corporation(?:,|$)/);
  return {path:executable,version:pin.version,sha256:pin.sha256,signature:{status:signature.status,subject:signature.subject},source:pin.source};
}

function launch(executable,args){
  const child=spawn(executable,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";
  child.stdout.on("data",b=>{stdout+=b.toString();});child.stderr.on("data",b=>{stderr+=b.toString();});
  const done=new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",code=>resolve({code,stdout,stderr}));});
  return {child,done,output:()=>({stdout,stderr})};
}

export async function startPresentMon(tool,pid,directory,sessionName){
  assert(Number.isSafeInteger(pid)&&pid>0);const csv=join(directory,"presentmon.csv");
  const args=["--process_id",String(pid),"--session_name",sessionName,"--output_file",csv,"--v2_metrics","--qpc_time","--write_display_time","--write_frame_id","--write_display_metadata","--track_etw_status","--no_track_gpu","--no_track_input","--no_console_stats","--timed","120","--terminate_after_timed"];
  const process=launch(tool.path,args);let ready=false,readiness;
  for(let i=0;i<100;i++){
    // PresentMon's console output is buffered when redirected. Query the exact
    // live ETW session instead of treating silence as a failed start.
    if(process.child.exitCode!==null)break;
    readiness=await launch("logman.exe",["query",sessionName,"-ets"]).done;
    if(readiness.code===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready){if(process.child.exitCode===null)await launch(tool.path,["--session_name",sessionName,"--terminate_existing_session"]).done;const result=await process.done;throw new Error(`PresentMon did not start: ${JSON.stringify(result)}`);}
  let stopped=false;
  return {csv,args,pid,sessionName,readiness,async stop(){
    assert(!stopped,"Presentation capture already stopped");stopped=true;
    // ETW loss counters are emitted once per second. Keep the capture alive
    // beyond the measured window so even short validation passes have a final
    // observation. This grace is outside browser sampling and host timing.
    await new Promise(resolve=>setTimeout(resolve,protocol.measurement.etwLossObservationGraceMs));
    const stop=await launch(tool.path,["--session_name",sessionName,"--terminate_existing_session"]).done;
    const result=await process.done;await writeFile(join(directory,"presentmon-process.json"),JSON.stringify({args,pid,sessionName,readiness,...result,stop},null,2)+"\n");
    assert.equal(result.code,0,`PresentMon failed: ${result.stderr}`);assert.equal(stop.code,0,`PresentMon stop failed: ${stop.stderr}`);
    return {args,pid,sessionName,readiness,...result,stop};
  }};
}
