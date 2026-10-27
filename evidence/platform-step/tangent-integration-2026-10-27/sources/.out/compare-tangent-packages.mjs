import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const old=JSON.parse(readFileSync('.out/tangent-integration-final-hardware/tangent-package.json')),cli=resolve('.out/tangent-integration-tools/mtek.exe');
const hashes=(directory,prefix='')=>readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?hashes(join(directory,e.name),prefix+e.name+'/'):(()=>{const bytes=readFileSync(join(directory,e.name));return [{path:prefix+e.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];})());
for(const fixture of old.fixtures){const output=resolve('.out/tangent-packages-verified',fixture.name);execFileSync(cli,['build','--mode','test','--out',output,resolve('tests/browser/fixtures/m4',fixture.name)],{windowsHide:true,stdio:'pipe'});assert.deepEqual(hashes(output),fixture.package,fixture.name);}
mkdirSync('.out/tangent-packages-verified',{recursive:true});const report={format:'mtek-tangent-package-revalidation/1',reason:'Equivalent Clippy iterator rewrite in GLB validation after GPU captures; final source emits byte-identical complete packages',previousCliSha256:old.cliSha256,currentCliSha256:createHash('sha256').update(readFileSync(cli)).digest('hex'),packages:old.fixtures.map(f=>f.name),allFilesIdentical:true};writeFileSync('.out/tangent-packages-verified/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
