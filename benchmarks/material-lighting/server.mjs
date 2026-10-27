import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,sep,extname} from "node:path";
export async function startServer(root){
  root=resolve(root);
  const server=createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url??"/","http://localhost").pathname),file=resolve(root,`.${pathname==="/"?"/index.html":pathname}`);assert(file.startsWith(root+sep));const bytes=await readFile(file);
      response.writeHead(200,{"content-type":({".js":"text/javascript",".html":"text/html",".json":"application/json",".png":"image/png"})[extname(file)]??"application/octet-stream","cache-control":"no-store","cross-origin-opener-policy":"same-origin","cross-origin-embedder-policy":"require-corp"});response.end(bytes);
    }catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(resolve=>server.close(resolve))};
}
