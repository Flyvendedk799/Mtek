import type {Result} from "./audit.ts";
const escape=(value:string):string=>value.replace(/[\r\n]/g," ").replace(/[\\`*_[\]<>|]/g,"\\$&");
export function markdown(results:readonly Result[],compiler:object,summary?:{mode:string;status:string;compilerUnchanged:boolean}):string {
  const lines=["# Asset import and usage audit","","This report uses an existing compiler binary. It does not build the compiler, convert source assets, fetch remote resources or render a scene. Inventory is descriptive metadata; compiler diagnostics determine each requested check.","","A passed declaration import is not full compatibility: unsupported clips can be ignored until used. Named mesh/material/clip probes are reported separately. No-probe entries leave usage untested. Build-time packed totals, runtime/device limits and visual quality remain untested.","","| Asset | Declaration import | Usage probes | Input unchanged |","|---|---|---|---|"];
  if(summary!==undefined)lines.splice(2,0,`Audit outcome: **${escape(summary.status)}** (${escape(summary.mode)}). Compiler unchanged: ${String(summary.compilerUnchanged)}. Corpus-expectation success includes expected rejections; it is not a claim that every asset is supported.`,"");
  for(const result of results){const probes=result.probes.length===0?"not requested":result.probes.map(probe=>`${escape(probe.id)}: ${probe.status}`).join("; ");lines.push(`| ${escape(result.id)} | ${result.import.status}${result.import.codes.length?` (${result.import.codes.join(", ")})`:""} | ${probes} | ${String(result.inputUnchanged)} |`);}
  for(const result of results){
    lines.push("",`## ${escape(result.id)}`,"",`Source: ${escape(result.file)}. SHA-256: ${result.sha256??"unavailable"}.`);
    if(result.provenance!==null)lines.push(`Provenance: ${escape(result.provenance)}.`);
    if(result.inventoryError!==null)lines.push(`Metadata inventory unavailable: ${escape(result.inventoryError)}. Compiler results remain separate.`);
    if(result.inventory!==null){
      const meta=result.inventory as Record<string,unknown>;
      lines.push("Metadata: "+["meshes","primitives","skins","joints","animations","materials","images","morphPrimitives","sparseAccessors","externalReferences"].filter(key=>typeof meta[key]==="number").map(key=>`${key}=${String(meta[key])}`).join(", ")+".");
      for(const key of ["attributes","interpolations","extensionsUsed","extensionsRequired"]){const value=meta[key];if(Array.isArray(value)&&value.length)lines.push(`${key}: ${value.filter(item=>typeof item==="string").map(item=>escape(String(item))).join(", ")}.`);}
    }
    if(result.import.reason)lines.push(`Import not run: ${escape(result.import.reason)}.`);
    for(const [label,check] of [["declaration",result.import],...result.probes.filter(probe=>probe.check!==undefined).map(probe=>[probe.id,probe.check!] as const)] as const){
      for(const raw of check.diagnostics){if(raw===null||typeof raw!=="object")continue;const diagnostic=raw as Record<string,unknown>;
        lines.push(`- ${escape(label)} · ${escape(String(diagnostic["code"]))}: ${escape(String(diagnostic["message"]))}`);
        if(Array.isArray(diagnostic["notes"]))for(const note of diagnostic["notes"])if(typeof note==="string")lines.push(`  - ${escape(note)}`);
      }
    }
    for(const note of result.notes)lines.push(`- ${escape(note)}`);
  }
  lines.push("","Compiler identity and complete diagnostics are retained in report.json. Existing-binary identity:","","```json",JSON.stringify(compiler,null,2),"```","");
  return lines.join("\n");
}
