import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {describe,expect,it,vi} from "vitest";
import {auditEntry,compilerCheck,mtekString,parseCorpus,probeSource,readAsset,sha256,type Check,type Entry} from "../src/audit.ts";
import {inventory} from "../src/inventory.ts";
import {markdown} from "../src/report.ts";

const root=resolve(import.meta.dirname,"../../.."),workRoot=join(root,"target/asset-audit-unit");mkdirSync(workRoot,{recursive:true});
function glb(value:unknown):Buffer {
  const source=Buffer.from(JSON.stringify(value)),json=Buffer.alloc(Math.ceil(source.length/4)*4,32);source.copy(json);const header=Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([header,json]);
}
const passed=():Check=>({status:"passed",codes:[],diagnostics:[]});
const rejected=(...codes:string[]):Check=>({status:"rejected",codes,diagnostics:codes.map(code=>({code,severity:"error",message:"Unsupported fixture",notes:["help: choose a supported representation"]}))});
function setup():{directory:string;entry:Entry;bytes:Buffer}{
  const directory=mkdtempSync(join(workRoot,"case-")),bytes=glb({asset:{version:"2.0"}});writeFileSync(join(directory,"model.glb"),bytes);
  return {directory,bytes,entry:{id:"fixture",file:"model.glb",sha256:sha256(bytes),expectedImport:{status:"passed"},probes:[{id:"clip",mesh:"Tri",clip:"Walk",expected:{status:"rejected",codes:["MTEK-E5016"]}}]}};
}
describe("bounded metadata and source generation",()=>{
  it("inventories unsupported features without claiming they are validated",()=>{
    const bytes=glb({asset:{version:"2.0"},meshes:[{primitives:[{attributes:{POSITION:0},targets:[{}]}]}],accessors:[{sparse:{}}],skins:[{joints:[0,1]}],animations:[{samplers:[{interpolation:"CUBICSPLINE"}]}],buffers:[{uri:"https://example.invalid/model.bin"}],extensionsRequired:["KHR_draco_mesh_compression"]});
    expect(inventory(bytes)).toMatchObject({meshes:1,primitives:1,morphPrimitives:1,sparseAccessors:1,joints:2,externalReferences:1,interpolations:["CUBICSPLINE"]});
  });
  it("rejects malformed headers, invalid UTF-8 and oversized JSON without a large allocation",()=>{
    expect(()=>inventory(Buffer.from("bad"))).toThrow(/GLB/);
    const bytes=glb({asset:{version:"2.0"}});bytes.writeUInt32LE(16*1024*1024+4,12);expect(()=>inventory(bytes)).toThrow(/oversized/);
    const invalid=glb({asset:{version:"2.0"}});invalid[21]=255;expect(()=>inventory(invalid)).toThrow();
  });
  it("escapes Mtek names, controls and interpolation rather than using JSON escapes",()=>{
    expect(mtekString('a"\\$\u0008😀')).toBe('"a\\"\\\\\\$\\u{8}😀"');expect(()=>mtekString("\ud800")).toThrow(/surrogate/);
    const source=probeSource("model.glb",{id:"safe",mesh:'x"; } scene Inject {}',primitive:0,clip:"Walk"});
    expect(source).toContain('MODEL.primitive("x\\"; } scene Inject {}", 0)');
  });
  it("requires local bounded corpus inputs and unique IDs",()=>{
    for(const file of ["https://example.invalid/a.glb","\\\\server\\asset.glb"])expect(()=>parseCorpus({schemaVersion:1,entries:[{id:"input",file}]})).toThrow(/local/);
    expect(()=>parseCorpus({schemaVersion:1,entries:[{id:"same",file:"a"},{id:"same",file:"b"}]})).toThrow(/unique/);
    expect(()=>parseCorpus({schemaVersion:1,entries:[{id:"input",file:"a",probes:[{id:"bad",mesh:"Tri",primitive:-1}]}]})).toThrow(/Primitive/);
  });
});
describe("import/use separation and audit integrity",()=>{
  it("does not turn an unavailable or wrong compiler into an asset rejection",()=>{
    const f=setup();expect(compilerCheck(join(f.directory,"missing-compiler"),f.directory).status).toBe("not-run");
    expect(compilerCheck(process.execPath,f.directory).status).toBe("not-run");
  });
  it("retains a passed import and a rejected clip separately, without touching the source",()=>{
    const f=setup(),run=vi.fn().mockReturnValueOnce(passed()).mockReturnValueOnce(rejected("MTEK-E5016"));
    const result=auditEntry(f.entry,f.directory,workRoot,run);
    expect(result.import.status).toBe("passed");expect(result.probes[0]!.status).toBe("rejected");expect(result.expectationsMatched).toBe(true);expect(result.inputUnchanged).toBe(true);
    expect(readFileSync(join(f.directory,"model.glb"))).toEqual(f.bytes);
  });
  it("blocks use after import rejection and never accepts a blocked expected probe",()=>{
    const f=setup(),run=vi.fn(()=>rejected("MTEK-E7018"));f.entry.expectedImport={status:"rejected",codes:["MTEK-E7018"]};
    const result=auditEntry(f.entry,f.directory,workRoot,run);expect(run).toHaveBeenCalledTimes(1);expect(result.probes[0]!.status).toBe("blocked");expect(result.expectationsMatched).toBe(false);
  });
  it("fails closed on a missing compiler, checksum drift and unexpected extra diagnostic codes",()=>{
    const f=setup();let result=auditEntry(f.entry,f.directory,workRoot,()=>({status:"not-run",codes:[],diagnostics:[],reason:"missing compiler"}));expect(result.expectationsMatched).toBe(false);
    result=auditEntry({...f.entry,sha256:"0".repeat(64)},f.directory,workRoot,()=>{throw new Error("must not run");});expect(result.import.status).toBe("not-run");expect(result.import.reason).toMatch(/SHA/);
    const checks=[passed(),rejected("MTEK-E5016","MTEK-E7018")];result=auditEntry(f.entry,f.directory,workRoot,()=>checks.shift()!);expect(result.expectationsMatched).toBe(false);
  });
  it("detects a source changed during checking and labels no-probe imports incomplete",()=>{
    const f=setup();const result=auditEntry({...f.entry,probes:[]},f.directory,workRoot,()=>{writeFileSync(join(f.directory,"model.glb"),glb({asset:{version:"2.0"},nodes:[]}));return passed();});
    expect(result.inputUnchanged).toBe(false);expect(result.expectationsMatched).toBe(false);expect(result.notes.join(" ")).toMatch(/No mesh/);
    expect(()=>readAsset(f.directory)).toThrow(/local file/);
  });
  it("escapes untrusted report text and preserves compiler guidance",()=>{
    const f=setup();const result=auditEntry(f.entry,f.directory,workRoot,()=>rejected("MTEK-E7008"));result.id="name|<script>";
    const report=markdown([result],{available:true});expect(report).toContain("name\\|\\<script\\>");expect(report).toContain("choose a supported representation");expect(report).toContain("not full compatibility");
  });
  it("pins every default-corpus source without crawling directories",()=>{
    const corpus=parseCorpus(JSON.parse(readFileSync(join(root,"tools/asset-audit/corpus.json"),"utf8")) as unknown);
    expect(corpus.entries).toHaveLength(16);for(const entry of corpus.entries){expect(entry.file).not.toContain("benchmarks/results/ai");expect(sha256(readFileSync(resolve(root,"tools/asset-audit",entry.file)))).toBe(entry.sha256);}
  });
});
