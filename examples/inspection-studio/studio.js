import program, {mountMtek} from "./.out/app.js";
import {InspectorController,mountInspectorPanel,mountInspectorOverlay} from "./.out/inspector.js";
const element = id => document.getElementById(id), canvas = element("canvas"), verification = new URL(location.href).searchParams.has("verify");
let app, inspector, overlay, removePanel, context, actorId, revision = 0, paused = false, commands = [], queue = Promise.resolve();
const diagnostics = [];
const runtimeDiagnostics = [];
const report = error => {const text = String(error); diagnostics.push(text); element("diagnostics").hidden = false; element("diagnostics").textContent += `${text}\n`;};
const overlayOptions = () => Object.fromEntries(["bounds","skeleton","ik","colliders","contacts"].map(key => [key,element(key).checked]).concat([["selectedOnly",!element("all").checked]]));
function updateOverlay() {overlay?.dispose(); overlay = undefined; if (inspector && element("overlays").checked) overlay = mountInspectorOverlay(inspector,canvas,overlayOptions());}
function configure(player, initialize = false) {
  if (initialize) {
    player.transition("Walk",0,true,1);
    const hand = player.jointPosition("b_RightHand_08");
    for (const axis of ["x","y","z"]) element(`target-${axis}`).value = String(Math.round(hand[axis]));
  }
  const weight = Number(element("layer").value), lift = Number(element("lift").value);
  if (weight === 0) player.layers.remove("upper-body");
  else player.layers.set("upper-body",{clip:"Run",weight,additive:element("additive").checked,mask:Object.fromEntries(player.skin.nodes.map(node => [node.name,/Spine02|Neck|Head|Arm|Hand/.test(node.name)?1:0]))});
  const neck = player.skin.nodes.findIndex(node => node.name === "b_Neck_04");
  player.setProceduralOverride(lift === 0 ? undefined : pose => {pose[neck*10+1] += lift;});
  if (!element("grip").checked) player.ik.remove("right-hand");
  else player.ik.set("right-hand",{chain:["b_RightUpperArm_06","b_RightForeArm_07","b_RightHand_08"],target:["x","y","z"].map(axis => Number(element(`target-${axis}`).value)),weight:.8});
}
function dispose() {app?.dispose(); app = undefined; overlay?.dispose(); overlay = undefined; removePanel?.(); removePanel = undefined; inspector?.dispose(); inspector = undefined; context = undefined; actorId = undefined; commands = [];}
function rebuild() {
  const requested = ++revision; element("status").textContent = "Preparing scene…";
  queue = queue.catch(() => {}).then(async () => {
    if (requested !== revision) return;
    dispose(); element("diagnostics").hidden = true; element("diagnostics").textContent = "";
    inspector = new InspectorController({interval:.1,onError:report}); removePanel = mountInspectorPanel(inspector,element("panel")); updateOverlay();
    try {
      const next = await mountMtek(canvas,program,{
        inputs:{camera_yaw:Number(element("camera").value),parent_yaw:Number(element("parent").value)},
        rendering:{shadows:{light:"Sun",quality:"low",size:14}}, physics:{continuousCollision:true},
        ...(verification ? {test:{manualClock:true,recovery:{delaysMs:[0,0,0]}}} : {}),
        extensions:[inspector.extension,{id:"inspection-studio-controls",apiVersion:1,setup(c){context = c;},beforeFrame(c){
          const actor = c.readTransforms().find(entity => entity.name === "Fox");
          if (!actor) return; const player = c.animation(actor.id); if (!player) return;
          try {if (actor.id !== actorId) {actorId = actor.id; configure(player,true);} for (const command of commands.splice(0)) command(player);} catch (error) {report(error);}
        }}],
        onDiagnostic:d => {runtimeDiagnostics.push(d.code); if (d.severity === "error") report(`${d.code}: ${d.message}`);},
      });
      if (requested !== revision) {next.dispose(); return;}
      app = next;
      // Test mode advances only through the public manual-clock debug operation.
      if (verification) app.debug.step(1,0);
      const actor = context.readTransforms().find(entity => entity.name === "Fox"); if (actor) inspector.select(actor.id);
      if (paused) app.pause(); element("status").textContent = paused ? "Paused" : "Live scene";
    } catch (error) {dispose(); report(error); element("status").textContent = "Scene could not start";}
  });
  return queue;
}
for (const [id,input] of [["camera","camera_yaw"],["parent","parent_yaw"]]) element(id).addEventListener("input",() => app?.setInput(input,Number(element(id).value)));
for (const id of ["layer","additive","lift","grip","target-x","target-y","target-z"]) element(id).addEventListener("input",() => commands.push(player => configure(player)));
element("overlays").addEventListener("change",updateOverlay);
for (const id of ["bounds","skeleton","ik","colliders","contacts","all"]) element(id).addEventListener("change",() => overlay?.setOptions(overlayOptions()));
element("pause").addEventListener("click",() => {paused = !paused; if (paused) app?.pause(); else app?.resume(); element("pause").textContent = paused ? "Resume scene" : "Pause scene"; element("status").textContent = paused ? "Paused" : "Live scene";});
element("reset").addEventListener("click",rebuild);
window.addEventListener("pagehide",() => {++revision; dispose();});
if (verification) window.__inspectionStudio = {get app(){return app;},get inspector(){return inspector;},get overlay(){return overlay;},get context(){return context;},diagnostics,runtimeDiagnostics,rebuild};
await rebuild();
