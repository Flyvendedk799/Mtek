import test from "node:test";
import assert from "node:assert/strict";
import {regressions,recheckHost} from "./report.mjs";
import {schedule} from "./measurement-data.mjs";

function report(){
  const groups=schedule({passes:["cpu"],repeats:1}).map(j=>({...j,medians:{cpuP95:.1,gpuP95:.1,gpuSpanP95:.1,cadenceP95:3.3,bufferBytes:10000,textureBytes:10000,drawsP95:3,uploadBytesP95:0}}));
  return {performanceEligible:true,definition:"same-definition",protocol:"same-protocol",workload:{content:"same",product:"same",reference:"0.186.1"},environment:{os:{platform:"win32",release:"same"},cpus:{model:"same",logical:32},browser:"same",launchArgs:["same"],systemInfo:{gpu:{devices:[{deviceId:123,driverVersion:"same"}]}}},groups};
}
test("qualified baselines enforce both relative and absolute timing thresholds",()=>{
  const b=report(),c=report();assert.equal(regressions(b,c).status,"passed");
  c.groups[0].medians.cpuP95=.119;assert.equal(regressions(b,c).status,"passed");
  c.groups[0].medians.cpuP95=.121;assert.equal(regressions(b,c).failures[0].metric,"cpuP95");
  c.groups[0].medians.cpuP95=.1;c.groups[0].medians.cadenceP95=3.8;assert.equal(regressions(b,c).failures[0].metric,"cadenceP95");
});
test("memory, draw and upload budgets include zero baselines",()=>{
  const b=report(),c=report();c.groups[0].medians.bufferBytes=10101;c.groups[0].medians.drawsP95=4;c.groups[0].medians.uploadBytesP95=4;
  assert.deepEqual(regressions(b,c).failures.map(f=>f.metric),["bufferBytes","drawsP95","uploadBytesP95"]);
});
test("partial, different-asset, protocol and physical-device reports cannot establish budgets",()=>{
  for(const mutate of [r=>r.performanceEligible=false,r=>r.workload.product="different",r=>r.definition="different",r=>r.protocol="different",r=>r.environment.systemInfo.gpu.devices[0].deviceId=456,r=>r.groups.pop()]){
    const c=report();mutate(c);assert.throws(()=>regressions(report(),c));
  }
});
test("raw CPU/GPU observations must agree with reported quiet summaries",()=>{
  const raw={counterRows:1,nonzero:[]},r={browserGpu:{pid:123},hostLoad:{valid:true,observations:[{cpu:2,cpuBefore:{total:100,idle:50},cpuAfter:{total:200,idle:148},rawGpu:raw}],gpuSamples:[{raw}],cpuBefore:{total:100,idle:50},cpuAfter:{total:200,idle:130},busyBeforePercent:2,gpuBeforePercent:0,busyDuringPercent:20,externalGpuPeakPercent:0}};
  recheckHost(r);r.hostLoad.busyDuringPercent=0;assert.throws(()=>recheckHost(r));
  r.hostLoad.busyDuringPercent=20;r.hostLoad.gpuSamples[0].raw={counterRows:1,nonzero:[{name:"pid_456_luid_0x0_0x1_phys_0_eng_1_engtype_Copy",percent:20}]};assert.throws(()=>recheckHost(r));
});
