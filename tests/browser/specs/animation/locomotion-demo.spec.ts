import { expect, test } from "../../support/fixtures.ts";
import { writeRecord } from "../m4/configurator-support.ts";

type Demo = { snapshot(): Array<{ phase:number; parameter:number; hand:{x:number;y:number;z:number}; handRotation:{x:number;y:number;z:number;w:number}; revision:number }> };

test("the Three.js integration blends locomotion and maintains oriented grips on both rigs", async ({page}) => {
  const errors: string[] = [];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/animation-demo/index.html");
  await page.waitForFunction(()=>"__mtekAnimationDemo" in window);
  await page.locator("#pause").check();
  const before = await page.evaluate(()=>(window as unknown as {__mtekAnimationDemo:Demo}).__mtekAnimationDemo.snapshot());
  await page.locator("#speed").fill("1");
  await page.locator("#grip").check();
  await page.waitForFunction(()=>(window as unknown as {__mtekAnimationDemo:Demo}).__mtekAnimationDemo.snapshot().every(actor=>actor.parameter===1 && Math.abs(actor.handRotation.w)>0.999));
  const after = await page.evaluate(()=>(window as unknown as {__mtekAnimationDemo:Demo}).__mtekAnimationDemo.snapshot());
  for (let i=0;i<after.length;i++) {
    const actor=after[i]!,scale=i===0?1:1.25;
    expect(actor.phase).toBeCloseTo(before[i]!.phase,7);
    expect(Math.hypot(actor.hand.x+0.3*scale,actor.hand.y-2.5*scale,actor.hand.z-0.8*scale)).toBeLessThan(0.03);
    expect(Math.abs(actor.handRotation.w)).toBeCloseTo(1,4);
  }
  await page.locator("#throttle").check();
  await page.locator("#pause").uncheck();
  await page.waitForFunction(phase=>(window as unknown as {__mtekAnimationDemo:Demo}).__mtekAnimationDemo.snapshot()[0]!.phase!==phase,after[0]!.phase);
  expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath("locomotion-demo.png")});
  writeRecord(`locomotion-demo-${test.info().project.name}.json`,{before,after,errors});
});
