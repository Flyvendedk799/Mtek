import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const dir=import.meta.dirname, bytes=readFileSync(join(dir,'WaterBottle.glb'));
const sha256=createHash('sha256').update(bytes).digest('hex');
const gitBlob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if(bytes.length!==8966700||gitBlob!=='27894ec0ce010ba689e04e4801520ebb5ccc849f')throw new Error('upstream byte identity mismatch');
if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw new Error('invalid GLB header');
const document=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
mkdirSync(join(dir,'src'),{recursive:true});
writeFileSync(join(dir,'mtek.toml'),'[project]\nname = "waterbottle-preflight"\nlanguage = "0.1"\n');
writeFileSync(join(dir,'src/main.mtek'),`const MODEL = asset.glb("../WaterBottle.glb");\nscene Product {\n    camera Main { position: vec3(0.0, 0.0, 1.0); }\n    entity Bottle { mesh: MODEL.mesh(${JSON.stringify(document.meshes[0].name)}); material: MODEL.material(${JSON.stringify(document.materials[0].name)}); }\n}\n`);
const cli=resolve('.out/material-tools/mtek.exe'),checked=spawnSync(cli,['check','--format','json',dir],{encoding:'utf8',windowsHide:true});
writeFileSync(join(dir,'compiler-stdout.json'),checked.stdout);writeFileSync(join(dir,'compiler-stderr.log'),checked.stderr);
if(checked.error)throw checked.error;
const report=JSON.parse(checked.stdout);
const record={format:'mtek-product-import-preflight/1',status:'rejected-import-not-accepted',upstreamCommit:'8f492390ddc7a2ae221a1369ef560589cf8c70fb',
  upstream:'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/WaterBottle/glTF-Binary/WaterBottle.glb',
  license:{spdx:'CC0-1.0',artist:'Microsoft',year:2017,source:'https://github.com/KhronosGroup/glTF-Sample-Assets/blob/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/WaterBottle/metadata.json'},
  bytes:bytes.length,sha256,gitBlob,cliSha256:createHash('sha256').update(readFileSync(cli)).digest('hex'),exitCode:checked.status,
  meshes:document.meshes.map(mesh=>({name:mesh.name,primitives:mesh.primitives.map(p=>({attributes:p.attributes,material:p.material}))})),
  materials:document.materials.map(m=>({name:m.name,normalTexture:m.normalTexture,alphaMode:m.alphaMode??'OPAQUE'})),diagnostics:report};
if(checked.status===0||!JSON.stringify(report).includes('E7009'))throw new Error('expected explicit tangent import rejection');
writeFileSync(join(dir,'preflight.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({sha256,gitBlob,exitCode:checked.status,attributes:Object.keys(document.meshes[0].primitives[0].attributes),status:record.status}));
