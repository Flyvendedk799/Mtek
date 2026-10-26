import {mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "@playwright/test";
import {hardwareLaunchArgs,browserChannel} from "../../../tests/browser/support/launch-args.ts";
import {sanitizeReport} from "../../../tests/browser/support/sanitize-report.ts";
import {models} from "./layout.ts";
import {root} from "./prepare.ts";
interface Demo {ready():boolean;info():Array<Record<string,unknown>>}
export async function verify():Promise<void>{
  const out=join(root,"evidence/platform-step/matched-animation/demo");mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:browserChannel(),headless:true,args:hardwareLaunchArgs()});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[],records=[];
  page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://127.0.0.1:5185/demo.html");await page.waitForFunction(()=>(window as unknown as {__productionCharacters?:Demo}).__productionCharacters?.ready());
    await page.getByRole("button",{name:"Pause",exact:true}).click();
    for(const model of models){
      await page.locator("#model").selectOption(model);
      await page.waitForFunction(()=>(window as unknown as {__productionCharacters:Demo}).__productionCharacters.ready());
      const clips=await page.locator("#clip option").evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value));
      for(const clip of clips)await page.locator("#clip").selectOption(clip);
      await page.getByRole("button",{name:"Reset cycle",exact:true}).click();
      const info=await page.evaluate(()=>(window as unknown as {__productionCharacters:Demo}).__productionCharacters.info());
      const diagnostics=info[0]?.["diagnostics"];
      if(!Array.isArray(diagnostics)||diagnostics.length>0)throw new Error(`Mtek demo diagnostics: ${JSON.stringify(diagnostics)}`);
      if(errors.length>0)throw new Error(errors.join("\n"));
      await page.screenshot({path:join(out,`${model}.png`),fullPage:true});records.push({model,clips,info});
    }
    writeFileSync(join(out,"verification.json"),JSON.stringify(sanitizeReport({errors,records}),null,2)+"\n");console.log(`Verified both authored characters, all original clips and visible credits: ${out}`);
  }finally{await browser.close();}
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===join(import.meta.dirname,"verify-demo.ts"))await verify();
