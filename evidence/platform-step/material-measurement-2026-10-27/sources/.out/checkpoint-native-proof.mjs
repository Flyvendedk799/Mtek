import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import {startServer} from '../benchmarks/material-lighting/server.mjs';
import {prepareMaterials} from '../benchmarks/material-lighting/prepare.mjs';
import {materialLaunchArgs} from '../benchmarks/material-lighting/launch.mjs';
import {browserChannel} from '../tests/browser/support/launch-args.ts';
import {nativeConsistency,presentedData} from '../benchmarks/material-lighting/measurement-data.mjs';
import {createWindowsMonitor,calibrateClock} from '../benchmarks/material-lighting/windows-monitor.mjs';
import {ensurePresentMon,startPresentMon} from '../benchmarks/material-lighting/presentmon.mjs';
const {PNG}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const out=resolve(process.argv[2]??'.out/material-native-checkpoint-proof');await mkdir(out,{recursive:true});
const build=await prepareMaterials({siteDirectory:join(out,'site'),projectDirectory:join(out,'projects')});
const server=await startServer(join(out,'site'));
const launch={channel:browserChannel(),args:materialLaunchArgs('hardware')},offscreen=await chromium.launch({...launch,headless:true}),visible=await chromium.launch({...launch,headless:false});
const report={performanceEligible:false,build,purpose:'Native output and RAF-only negative-control correctness; host-load qualification is not attempted',cases:[]};let monitor;
try{
 for(const implementation of ['three','mtek']){
  const refContext=await offscreen.newContext(),context=await visible.newContext({viewport:{width:640,height:360}}),reference=await refContext.newPage(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));reference.on('pageerror',e=>errors.push(e.message));
  try{
   for(const p of [reference,page]){await p.goto(server.url);await p.waitForFunction(()=>window.materialSuite);}
   const refSetup=await reference.evaluate(i=>window.materialSuite.setup(i,'product','low'),implementation);await reference.evaluate(()=>window.materialSuite.advance(46));const pixels=await reference.evaluate(()=>window.materialSuite.pixels());const referencePng=PNG.sync.write({width:pixels.width,height:pixels.height,data:Buffer.from(pixels.data,'base64')});await writeFile(join(out,`${implementation}-offscreen.png`),referencePng);
   const setup=await page.evaluate(i=>window.materialSuite.setup(i,'product','low','presented'),implementation);await page.bringToFront();await page.evaluate(()=>window.materialSuite.advance(30));await page.evaluate(()=>window.materialSuite.samples(16));const nativePng=await page.locator('canvas').screenshot({path:join(out,`${implementation}-native.png`)}),a=PNG.sync.read(nativePng),b=PNG.sync.read(referencePng),comparison=nativeConsistency(a.data,b.data,a.width,a.height);
   const row={implementation,setup,refSetup,comparison};report.cases.push(row);assert(comparison.passed,`Native/offscreen mismatch: ${implementation}`);
   if(implementation==='mtek'){
    monitor=await createWindowsMonitor();const tool=await ensurePresentMon(monitor),cdp=await visible.newBrowserCDPSession(),processes=await cdp.send('SystemInfo.getProcessInfo'),gpu=processes.processInfo.filter(p=>p.type.toLowerCase()==='gpu');assert.equal(gpu.length,1);await cdp.detach();
    const qpc=await calibrateClock(async()=>{const r=await monitor.request('clock');return r.qpc/monitor.metadata.frequency*1000;}),clock=await calibrateClock(()=>page.evaluate(()=>performance.now()));
    const directory=join(out,'raf-only');await mkdir(directory,{recursive:true});const capture=await startPresentMon(tool,gpu[0].id,directory,`MtekCheckpointControl-${process.pid}`);const sample=await page.evaluate(()=>window.materialSuite.samples(120,{draw:false})),etw=await capture.stop();let csv='';try{csv=await readFile(join(directory,'presentmon.csv'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    assert.throws(()=>presentedData(csv,{pid:gpu[0].id,frequency:monitor.metadata.frequency,qpcClock:qpc,browserClock:clock,presentation:sample.presentation,captureLog:etw.stdout}),/No displayed stream/);
    row.rafOnly={status:'passed',sample,etw,qpc,clock,os:monitor.metadata,tool};
   }
   row.disposed=await page.evaluate(()=>window.materialSuite.dispose());row.referenceDisposed=await reference.evaluate(()=>window.materialSuite.dispose());assert.deepEqual(errors,[]);assert(row.disposed.allDevicesDestroyed&&row.referenceDisposed.allDevicesDestroyed);assert.deepEqual(row.disposed.validation,[]);assert.deepEqual(row.referenceDisposed.validation,[]);
  }finally{await context.close();await refContext.close();}
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await visible.close();await offscreen.close();await monitor?.close();await server.close();await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases.map(r=>({implementation:r.implementation,comparison:r.comparison,negativeControl:r.rafOnly?.status}))}));}
