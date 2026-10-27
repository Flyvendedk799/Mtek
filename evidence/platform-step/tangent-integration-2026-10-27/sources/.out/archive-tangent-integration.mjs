import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {sanitizeReport} from '../tests/browser/support/sanitize-report.ts';
const root=process.cwd(),dest=join(root,'evidence/platform-step/tangent-integration-2026-10-27');
assert(!existsSync(join(dest,'validation.json')),'This checkpoint is frozen');
const hash=b=>createHash('sha256').update(b).digest('hex'),read=p=>readFileSync(join(root,p));
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const write=(p,b)=>{const target=join(dest,p);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b);};
const json=(p,v)=>write(p,JSON.stringify(sanitizeReport(v),null,2)+'\n');
const capture=(source,target)=>{
 const original=read(source);let bytes=original;
 if(source.endsWith('.json'))bytes=Buffer.from(JSON.stringify(sanitizeReport(JSON.parse(original.toString())),null,2)+'\n');
 else if(source.endsWith('.log')||source.endsWith('.md'))bytes=Buffer.from(sanitizeReport(original.toString()));
 const zipped=bytes.length>50000&&(source.endsWith('.json')||source.endsWith('.wgsl'));write(target+(zipped?'.gz':''),zipped?gzipSync(bytes,{level:9}):bytes);
};
const browserRuns=[['tangents/hardware','.out/tangent-integration-final-hardware',16],['tangents/software','.out/tangent-integration-final-software',16],['regression','.out/tangent-integration-regression',114],['compute','.out/tangent-integration-compute',18]];
for(const [name,path,count]of browserRuns){const report=JSON.parse(read(`${path}/test-results.json`));assert.equal(report.stats.expected,count);for(const k of ['unexpected','skipped','flaky'])assert.equal(report.stats[k],0);for(const file of walk(join(root,path)))if(/\.(json|png)$/.test(file))capture(relative(root,file),`${name}/${relative(join(root,path),file)}`);}
const samples=[],shadows=[];
for(const backend of ['hardware','software']){
 const path=`.out/tangent-integration-final-${backend}`;
 for(const file of readdirSync(join(root,path))){
  if(file.startsWith('tangent-pbr-initial-')){const r=JSON.parse(read(`${path}/${file}`));for(const s of r.samples){const error=Math.max(...s.actual.map((v,i)=>Math.abs(v-s.expected[i])));assert(error<=3);assert(s.separation>=8);samples.push({backend,kind:r.kind,x:s.x,error,separation:s.separation,actual:s.actual,expected:s.expected,counterfactual:s.counterfactual});}}
  if(file.startsWith('tangent-shadows-')){const r=JSON.parse(read(`${path}/${file}`));for(const k of ['referenceA','referenceB','culling','recovery'])assert.equal(r.comparisons[k],0);assert(r.comparisons.animation>70&&r.comparisons.shadow>70);shadows.push({backend,file,...r.comparisons});}
 }
}
assert.equal(samples.length,20);assert.equal(shadows.length,6);
const matrices=[];
for(const backend of ['hardware','software']){
 const path=`.out/tangent-material-final-${backend}`,report=JSON.parse(read(`${path}/${backend}.json`));assert.equal(report.completeMatrix,true);assert.equal(report.cases.length,10);assert.equal(report.status,backend==='hardware'?'passed':'failed');
 const failed=report.cases.filter(c=>c.status!=='passed');assert.equal(failed.length,backend==='hardware'?0:2);for(const c of failed){assert.equal(c.name,'product');assert.equal(c.implementations.mtek.status,'passed');assert.match(c.implementations.three.failure,/visible contribution/);}
 for(const c of report.cases)for(const r of Object.values(c.implementations))for(const image of [...r.images,...(r.control?[r.control.image]:[])])assert.equal(hash(read(`${path}/${image.path}`)),image.sha256);
 for(const source of report.sources)assert.equal(hash(read(source.path)),source.sha256,`Changed after matrix: ${source.path}`);
 for(const file of walk(join(root,path)))if(/\.(json|png)$/.test(file))capture(relative(root,file),`material/${backend}/${relative(join(root,path),file)}`);
 matrices.push({backend,status:report.status,passed:10-failed.length,failed:failed.map(c=>({name:c.name,quality:c.quality,normalMapChangedPixels:Object.fromEntries(Object.entries(c.implementations).map(([k,r])=>[k,r.control?.changed]))})),performanceEligible:report.performanceEligible});
 const mip=`.out/tangent-product-native-mips-${backend}/result.json`;capture(mip,`native-mips/${backend}.json`);
}
const oldRuns=['tangent-material-initial-hardware','tangent-material-initial-software','tangent-material-strong-hardware','tangent-material-strong-software','tangent-material-varying-hardware','tangent-material-varying-software','tangent-product-preflight-hardware','tangent-product-controls-hardware','tangent-material-misrouted-preflight','tangent-material-matrix-final-hardware','tangent-material-matrix-final-software','tangent-material-matrix-accepted-hardware','product-normal-diagnostic-hardware','product-normal-diagnostic-software','product-texture-diagnostic-hardware','product-texture-diagnostic-software'];
for(const name of oldRuns){const path=join(root,'.out',name);if(existsSync(path))for(const file of walk(path))if(/\.(json|png|wgsl)$/.test(file))capture(relative(root,file),`intermediate/${name}/${relative(path,file)}`);}
for(const file of walk(join(root,'.out/tangent-integration-asset-audit')))if(/\.(json|md)$/.test(file))capture(relative(root,file),`asset-audit/${relative(join(root,'.out/tangent-integration-asset-audit'),file)}`);
for(const file of walk(join(root,'.out/tangent-packages-verified')))if(/\.(wgsl|json|bin|png|jpg)$/.test(file)||file.endsWith('app.js'))capture(relative(root,file),`packages/${relative(join(root,'.out/tangent-packages-verified'),file)}`);
const productPackage=join(root,'benchmarks/material-lighting/.out/site/programs/product-standard');
for(const file of walk(productPackage))if(/\.(wgsl|json|bin)$/.test(file))capture(relative(root,file),`product-package/${relative(productPackage,file)}`);
const sourcePaths=new Set([
 'crates/mtek-compiler/src/assets/glb.rs','crates/mtek-compiler/src/assets/pack.rs','crates/mtek-compiler/src/package/manifest.rs','crates/mtek-compiler/src/diagnostics/codes.rs','crates/mtek-compiler/src/stdlib/data/namespaces.rs','crates/mtek-compiler/src/lowering/standard_stage.rs','crates/mtek-compiler/src/lowering/shader/helpers.rs','crates/mtek-compiler/src/lowering/shader/types.rs','crates/mtek-compiler/src/types/material.rs',
 'crates/mtek-compiler/tests/assets.rs','crates/mtek-compiler/tests/shader_lowering.rs','crates/mtek-compiler/tests/gpu_surface_aggregates.rs','crates/mtek-compiler/tests/stdlib_registry.rs','crates/mtek-cli/src/lsp/completion_tests.rs','crates/mtek-compiler/tests/context.rs','crates/mtek-compiler/src/context/capabilities.rs',
 'packages/runtime-web/src/abi/manifest-types.ts','packages/runtime-web/src/mesh/asset.ts','packages/runtime-web/src/mesh/asset.test.ts','packages/runtime-web/src/mesh/skinning.ts','packages/runtime-web/src/render/gpu-skinning.ts','packages/runtime-web/src/render/meshes.ts','packages/runtime-web/src/render/meshes.test.ts','packages/runtime-web/src/render/pipelines.ts','packages/runtime-web/src/render/renderer.ts','packages/runtime-web/src/render/startup.ts','packages/runtime-web/src/scene/structure.ts',
 'tests/browser/specs/m4/pbr-tangents.spec.ts','tests/browser/specs/m4/tangent-shadows.spec.ts','tests/browser/support/tangent-setup.ts','tests/browser/tangents.config.ts','tests/assets/tools/make-glb.mjs','tests/abi/manifests/valid/full.json','tests/abi/manifests/invalid/shader-unknown-attribute.json',
 'spec/assets.md','spec/materials.md','spec/runtime-abi.md','spec/compute.md','spec/diagnostics.md','spec/manifest.schema.json','spec/stdlib-schema.json','spec/decisions/0212-authored-tangent-integration.md','tools/release-docs/data/limitations.json','tools/release-docs/templates/pages/concepts/materials-and-shaders.md','tools/coverage-matrix/src/cli.ts','tools/asset-audit/corpus.json','tools/asset-audit/README.md','tools/asset-audit/test/audit.test.ts',
 'package.json','package-lock.json','crates/mtek-cli/prebuilt/PROVENANCE.json','evidence/platform-step/tangent-progress.md','evidence/platform-step/scorecard.md',
 'docs/release-notes-v0.1.md','crates/mtek-compiler/src/stdlib/std/materials.mtek','.out/archive-tangent-integration.mjs','.out/compare-tangent-packages.mjs','.out/product-normal-diagnostic.mjs','.out/product-texture-diagnostic.mjs',
]);
for(const name of readdirSync('benchmarks/material-lighting'))if(/\.(json|mjs|md)$/.test(name))sourcePaths.add(`benchmarks/material-lighting/${name}`);
for(const file of walk(join(root,'benchmarks/material-lighting/assets/WaterBottle')))if(!file.endsWith('.glb'))sourcePaths.add(relative(root,file).replaceAll('\\','/'));
for(const name of readdirSync('tests/browser/fixtures/m4').filter(n=>n.startsWith('pbr_tangent_')))for(const file of walk(join(root,'tests/browser/fixtures/m4',name)))sourcePaths.add(relative(root,file).replaceAll('\\','/'));
for(const name of ['e7027_tangent_direction','e7027_tangent_handedness','e7010_tangent_without_normal','e7025_tangent_count','e7025_tangent_nonfinite','e7007_tangent_type'])for(const file of walk(join(root,'tests/assets/fail',name)))sourcePaths.add(relative(root,file).replaceAll('\\','/'));
for(const file of walk(join(root,'tests/assets/pass/assets_tangent')))sourcePaths.add(relative(root,file).replaceAll('\\','/'));
const sources=[...sourcePaths].sort().map(path=>{const bytes=read(path);write(`sources/${path}`,bytes);return {path,bytes:bytes.length,sha256:hash(bytes),snapshot:`sources/${path}`};});
const logs=readdirSync('.out').filter(n=>/^(tangent-integration-|tangent-material-|tangent-product-|product-normal-diagnostic-|product-texture-diagnostic-)/.test(n)&&n.endsWith('.log'));
for(const name of logs)capture(`.out/${name}`,`logs/${name}`);
capture('.out/tangent-integration-budgets.json','budgets.json');
capture('.out/tangent-packages-verified/report.json','package-revalidation.json');
for(const name of readdirSync('.out/product-normal-diagnostic-hardware').filter(n=>n.endsWith('.wgsl')))assert.equal(hash(read(`.out/product-normal-diagnostic-hardware/${name}`)),hash(read(`.out/product-normal-diagnostic-software/${name}`)),`Native shader differs: ${name}`);
const rust=readFileSync(join(dest,'logs/tangent-integration-rust-complete.log'),'utf8');
assert.deepEqual([...rust.matchAll(/^test (.+) \.\.\. FAILED$/gm)].map(m=>m[1]),['types_cover_section_2']);
assert(rust.includes('error: 1 target failed:')&&rust.includes('`-p mtek-compiler --test stdlib_registry`'));
const corrected=read('.out/tangent-integration-registry-verified.log').toString();
assert(!/^error:|^test .* FAILED/m.test(corrected));assert(/Running tests\\stdlib_registry\.rs[\s\S]*?test result: ok\. 25 passed; 0 failed/.test(corrected));
assert(rust.includes('grammar adapter conformance: PASS (45034 inputs)'));assert(rust.includes('grammar adapter smoke: PASS'));
const runComplete=rust.includes('Doc-tests mtek_grammar_coverage');
const totals=[...rust.matchAll(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored/g)].reduce((r,m)=>({passed:r.passed+Number(m[1]),ignored:r.ignored+Number(m[2])}),{passed:0,ignored:0});
assert(runComplete);totals.passed+=25;
json('summary.json',{format:'mtek-tangent-integration/1',implementation:'delivered',platformRoadmapComplete:false,softwareProductComparison:'open: native Three normal-map visibility gate fails at both profiles',performanceClaim:false,browser:{tangents:32,regression:114,compute:18},samples,shadows,materialMatrices:matrices,rust:{runComplete,completedHarnessTotals:totals,singleGreenWorkspaceRun:false,correction:'The completed workspace run failed only the stale SurfaceInput registry expectation. The corrected target passes all 25 tests; original failed log and revalidation retained.',grammarInputs:45034,grammarSmoke:'passed'},unitRuntime:1672,assetAudit:{inputs:21,checks:38},budgets:11,intermediateBoundary:'Earlier calibration/reference-strength attempts and misrouted captures are retained for history; shared-directory screenshots were overwritten and are not accepted evidence.'});
const files=walk(dest).map(file=>{const bytes=readFileSync(file);return {path:relative(dest,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)};}).sort((a,b)=>a.path.localeCompare(b.path));
json('validation.json',{format:'mtek-platform-validation/1',date:'2026-10-27',scope:'Authored tangent integration and current compute/capability continuation; qualified timing and software native-product comparison remain open',sources,files,commands:[
 {command:'npx playwright test --config tests/browser/tangents.config.ts --project hardware (then software)',status:'passed',checks:32},
 {command:'npx playwright test --config tests/browser/compute.config.ts --project hardware --project software',status:'passed',checks:18},
 {command:'broader rendering/animation selection in regression/test-results.json',status:'passed',checks:114},
 {command:'npm run test:unit -w @mtek/runtime-web -- --maxWorkers=1',status:'passed',checks:1672},
 {command:'cargo test --workspace --no-fail-fast --locked -j 2 -- --test-threads=2',status:'completed with one stale registry expectation failed; corrected target passes all 25 on revalidation; no single green workspace invocation claimed'},
 {command:'cargo test -p mtek-compiler --test stdlib_registry --test stdlib_schema --test context_cold_start -j 2 -- --test-threads=2',status:'passed',checks:47},
 {command:'cargo test -p mtek-compiler --test assets --test manifest_model --test gpu_surface_aggregates -j 2 -- --test-threads=2',status:'passed',checks:29},
 {command:'cargo clippy --workspace --all-targets --locked -j 2 -- -D warnings',status:'passed'},
 {command:'node benchmarks/material-lighting/verify.mjs hardware <fresh-output> (then software)',status:'hardware passed; software failed product visibility controls',performanceEligible:false},
 {command:'node benchmarks/material-lighting/diagnose-product-mips.mjs software <fresh-output> (then hardware)',status:'diagnostic completed; no performance claim'},
 {command:'node tools/asset-audit/src/cli.ts --compiler=<isolated-cli> --corpus=tools/asset-audit/corpus.json --out=<fresh-output> --check',status:'passed expected outcomes',checks:38},
 {command:'node scripts/game-budgets.mjs size --mtek <isolated-cli> --json <report>',status:'passed',budgets:11},
 {command:'TypeScript, focused/browser/runtime/asset-audit/material/coverage lint, prebuilt consistency, fixture generation and release/coverage checks; see logs',status:'passed'},
],externalInputs:[{path:'benchmarks/material-lighting/assets/WaterBottle/WaterBottle.glb',bytes:8966700,sha256:hash(read('benchmarks/material-lighting/assets/WaterBottle/WaterBottle.glb')),gitBlob:'27894ec0ce010ba689e04e4801520ebb5ccc849f'}]});
console.log(JSON.stringify({files:files.length,sources:sources.length,rust:{runComplete,...totals},matrices}));
