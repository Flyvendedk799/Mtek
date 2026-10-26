import {createHash} from "node:crypto";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
const here=import.meta.dirname;
export function definitionHash():{hash:string;files:Record<string,string>}{
  const paths=readdirSync(here).filter(file=>(file.endsWith(".ts")&&!file.endsWith(".test.ts"))||file==="protocol.json"||file.endsWith(".html"));
  paths.push("assets/provenance.json");
  const files=Object.fromEntries(paths.sort().map(file=>[file,createHash("sha256").update(readFileSync(join(here,file),"utf8").replaceAll("\r\n","\n")).digest("hex")]));
  return {hash:createHash("sha256").update(JSON.stringify(files)).digest("hex"),files};
}
export function checkFreeze():string {
  const actual=definitionHash(),expected=JSON.parse(readFileSync(join(here,"FROZEN.json"),"utf8")) as {hash:string};
  if(actual.hash!==expected.hash)throw new Error("Animation definitions changed since the freeze; parity and measurements must be rerun");
  return actual.hash;
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===join(here,"freeze.ts")){
  if(process.argv.includes("--record"))writeFileSync(join(here,"FROZEN.json"),JSON.stringify({recordedAt:new Date().toISOString(),rationale:"Matched independent-character definitions frozen after parity smoke checks, before reportable measurements.",...definitionHash()},null,2)+"\n");
  else console.log(checkFreeze());
}
