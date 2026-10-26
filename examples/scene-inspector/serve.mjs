import {build} from "esbuild";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
const here=import.meta.dirname;
export async function startSandbox(port=5186){
  const result=await build({entryPoints:[join(here,"main.ts")],bundle:true,write:false,format:"esm",target:"es2022",platform:"browser"});
  const html=await readFile(join(here,"index.html"));
  const server=createServer((request,response)=>{
    const path=new URL(request.url??"/","http://localhost").pathname;
    if(path==="/"||path==="/index.html"){response.writeHead(200,{"content-type":"text/html; charset=utf-8"});response.end(html);}
    else if(path==="/main.js"){response.writeHead(200,{"content-type":"text/javascript; charset=utf-8"});response.end(result.outputFiles[0].contents);}
    else{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(port,"127.0.0.1",resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
if(process.argv[1]&&resolve(process.argv[1])===join(here,"serve.mjs")){
  const server=await startSandbox();console.log(`CPU-only inspector sandbox: ${server.url}`);process.on("SIGINT",()=>{void server.close();});
}
