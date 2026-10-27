import {chromium,expect} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {startSandbox} from "../../../examples/scene-inspector/serve.mjs";

const root=resolve(import.meta.dirname,"../../.."),out=resolve(process.env.MTEK_INSPECTOR_EVIDENCE_DIR??join(root,".out/inspector-ui"));mkdirSync(out,{recursive:true});
const server=await startSandbox(0),browser=await chromium.launch({headless:true,args:["--disable-gpu","--disable-webgpu","--disable-background-networking"]});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  await page.addInitScript(()=>{window.__gpuRequests=0;Object.defineProperty(navigator,"gpu",{value:{requestAdapter(){window.__gpuRequests++;throw new Error("UI verification must not request a GPU");}},configurable:true});});
  await page.goto(server.url);
  const panel=page.locator("[data-mtek-inspector]"),step=page.getByRole("button",{name:"Step scene · 0.1 s",exact:true});
  const x=panel.getByRole("spinbutton",{name:"position x",exact:true});
  await expect(panel.getByText("Metrics unavailable",{exact:true})).toBeHidden();
  await expect(panel.getByRole("heading",{name:"Animation",exact:true})).toBeHidden();
  await expect(x).toHaveValue("0");await x.fill("3");await panel.getByRole("button",{name:"Apply edits",exact:true}).click();
  await expect(page.locator("#records tr").first()).toContainText("0.00, 0.00, 0.00");await step.click();await expect(x).toHaveValue("3");
  await panel.getByRole("button",{name:"Undo",exact:true}).click();await step.click();await expect(x).toHaveValue("0");
  await panel.getByRole("button",{name:"Redo",exact:true}).click();await step.click();await expect(x).toHaveValue("3");
  const y=panel.getByRole("spinbutton",{name:"position y",exact:true});await y.fill("7");await step.click();await expect(y).toHaveValue("7");
  await panel.getByRole("button",{name:"Reset fields",exact:true}).click();await expect(y).toHaveValue("0");
  await panel.getByRole("spinbutton",{name:"scale x",exact:true}).fill("0");await panel.getByRole("button",{name:"Apply edits",exact:true}).click();await expect(panel.getByRole("alert")).toContainText("Invalid scale");
  await panel.getByRole("button",{name:"Reset fields",exact:true}).click();
  await panel.getByRole("searchbox",{name:"Filter entities"}).fill("Rig");await panel.getByRole("listbox",{name:"Scene entities"}).selectOption({label:"Rig"});
  await panel.getByRole("button",{name:"Pause base clip",exact:true}).click();await step.click();
  await panel.getByRole("slider",{name:"Animation time"}).evaluate(element=>{element.value="1";element.dispatchEvent(new Event("change",{bubbles:true}));});await step.click();
  await expect(panel.getByText("clip · paused · 1.000 / 2.000 s",{exact:true})).toBeVisible();
  await panel.locator("summary").filter({hasText:/^Skeleton ·/}).click();await expect(panel.getByRole("cell",{name:"Hand",exact:true})).toBeVisible();
  await panel.locator("summary").filter({hasText:/^Transitions, layers/}).click();
  await expect(panel.getByText("clip · Reach · no active transition",{exact:true})).toBeVisible();
  await panel.getByText("World transforms, draw bounds and contacts",{exact:true}).click();
  await expect(panel.getByText("Spatial data unavailable from this runtime/provider.",{exact:true})).toBeVisible();
  await page.screenshot({path:join(out,"sandbox.png"),fullPage:true});
  await page.getByRole("button",{name:"Replace scene",exact:true}).click();await expect(panel.getByText("No entity selected",{exact:true})).toBeVisible();await expect(panel.getByRole("button",{name:"Undo",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Disconnect inspector",exact:true}).click();await expect(panel.getByText("Detached",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Replace scene",exact:true}).click();await page.getByRole("button",{name:"Connect inspector",exact:true}).click();await expect(panel.getByText("Connected",{exact:true})).toBeVisible();
  await panel.getByRole("searchbox",{name:"Filter entities"}).fill("");await page.evaluate(()=>window.__inspectorSandbox.rename('<img src=x onerror="window.__injected=true">'));
  await expect(page.locator("img")).toHaveCount(0);await expect(panel.getByRole("option",{name:'<img src=x onerror="window.__injected=true">',exact:true})).toHaveCount(1);
  const result=await page.evaluate(()=>{
    const host=document.querySelector("[data-mtek-inspector]"),list=host.shadowRoot.querySelector('select[aria-label="Scene entities"]'),identity=host.shadowRoot.querySelector("code"),before=identity.textContent;
    window.__inspectorSandbox.disposePanel();list.value=list.options[1].value;list.dispatchEvent(new Event("change",{bubbles:true}));
    const detachedListenerInactive=window.__inspectorSandbox.inspector.snapshot().selectedId===null;
    window.__inspectorSandbox.inspector.select(window.__inspectorSandbox.records()[0].id);
    return {gpuRequests:window.__gpuRequests,injected:window.__injected??false,errors:window.__inspectorSandbox.errors,pending:window.__inspectorSandbox.inspector.snapshot().pending,detachedListenerInactive,detachedSubscriptionInactive:identity.textContent===before};
  });
  expect(result).toEqual({gpuRequests:0,injected:false,errors:[],pending:0,detachedListenerInactive:true,detachedSubscriptionInactive:true});expect(errors).toEqual([]);await expect(panel).toHaveCount(0);
  writeFileSync(join(out,"ui-verification.json"),JSON.stringify({recordedAt:new Date().toISOString(),status:"passed",browser:browser.version(),gpuDisabled:true,gpuRequests:0,pageErrors:errors,checks:["queued edit","undo/redo","dirty fields survive snapshots","invalid scale rejected","filter/selection","real public animation pause and seek","joint table","scene replacement","disconnect/remount","untrusted labels stay text","panel disposal removes listeners"]},null,2)+"\n");
  console.log("DOM-only inspector verification passed; GPU disabled, zero adapter requests.");
}finally{await browser.close();await server.close();}
