import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname,resolve,sep} from "node:path";
import {prepareDemo} from "./prepare.mjs";
const here=import.meta.dirname;await prepareDemo();
const server=createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url??"/","http://localhost").pathname),file=resolve(here,`.${pathname==="/"?"/index.html":pathname}`);
    if(!file.startsWith(here+sep)){response.writeHead(404);response.end();return;}
    const bytes=await readFile(file);response.writeHead(200,{"content-type":({".html":"text/html",".js":"text/javascript",".json":"application/json",".png":"image/png"})[extname(file)]??"application/octet-stream","cache-control":"no-store"});response.end(bytes);
  }catch{response.writeHead(404);response.end();}
});
server.listen(5188,"127.0.0.1",()=>console.log("Authored character cohorts: http://127.0.0.1:5188/"));
process.on("SIGINT",()=>server.close());
