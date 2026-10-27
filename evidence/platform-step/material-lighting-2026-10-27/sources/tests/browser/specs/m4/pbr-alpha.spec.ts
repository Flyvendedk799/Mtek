import {test,expect} from "../../support/fixtures.ts";
import {linearToSrgb8} from "../../support/m1-reference.ts";
import {runPlan,writeRecord} from "./configurator-support.ts";

test("built-in and authored PBR preserve straight colour alpha through opaque/translucent changes",async({page,gpu})=>{
  expect(gpu.available).toBe(true);
  const opacities=[0,.25,.5,.75,1,0,.5],report=await runPlan(page,"/m4/pbr_alpha/index.html",{renderTarget:{width:129,height:65}},opacities.map(opacity=>({label:String(opacity),inputs:[["opacity",opacity]]})));
  expect(report.state).toBe("running");expect(report.reported.filter(d=>d.severity==="error")).toEqual([]);
  const foreground=[.7,.3,.1],background=[.08,.14,.2],samples=[];
  for(const [i,opacity] of opacities.entries()){
    const expected=foreground.map((c,n)=>linearToSrgb8(c*opacity+background[n]!*(1-opacity))),shot=report.shots[i]!;
    expect(shot.inputs.every(input=>input.ok)).toBe(true);
    for(const [panel,x] of [25,64,103].entries()){
      const at=(32*129+x)*4,actual=Array.from(shot.data.slice(at,at+4));
      for(let c=0;c<3;c++)expect(Math.abs(actual[c]!-expected[c]!),`panel ${String(panel)}, opacity ${String(opacity)}, channel ${String(c)}`).toBeLessThanOrEqual(3);
      expect(actual[3]).toBe(255);samples.push({panel,opacity,actual,expected});
    }
  }
  writeRecord(`pbr-alpha-${test.info().project.name}.json`,{samples});
});
