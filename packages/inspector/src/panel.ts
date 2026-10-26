import type {SceneTransform} from "@mtek/runtime-web";
import {InspectorController} from "./controller.js";
import type {InspectorSnapshot} from "./types.js";

const css = `
:host{display:block;color-scheme:dark;color:#dce8ed;font:13px/1.5 system-ui,sans-serif;min-width:280px}*{box-sizing:border-box}[hidden]{display:none!important}
.panel{background:#14232b;border:1px solid #3b5260;border-radius:12px;overflow:hidden}header,section{padding:16px;border-bottom:1px solid #30454f}header{display:flex;justify-content:space-between;align-items:start;gap:12px}
h2,h3,p{margin:0}h2{font-size:17px}h3{font-size:13px;margin-bottom:10px}.muted,small{color:#a7bdc8}small{display:block;margin:8px 0}code,.mono{font-family:ui-monospace,monospace;overflow-wrap:anywhere}code{font-size:11px}
label{display:block;color:#b9ccd6}input,select,button{font:inherit;color:inherit;background:#20353f;border:1px solid #4a6472;border-radius:5px;padding:7px;min-width:0}input,select{width:100%}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #7ee0be;outline-offset:2px}
input[type=search]{margin-bottom:8px}select[size]{height:138px}button{cursor:pointer}button:disabled,input:disabled,select:disabled{opacity:.5;cursor:default}.buttons{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.primary{background:#286052;border-color:#50a88f}.status{font-size:11px;color:#8cddbc}.error{color:#ffb5a8;white-space:pre-wrap}.error:empty{display:none}
fieldset{border:0;padding:0;margin:0 0 10px}legend{color:#a7bdc8;margin-bottom:4px}.vector{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.quaternion{grid-template-columns:repeat(4,minmax(0,1fr))}.vector label{font-size:11px}.vector input{font-family:ui-monospace,monospace}.detail{margin-top:8px}summary{cursor:pointer}.time{margin-top:10px}table{width:100%;border-collapse:collapse;font-size:11px}caption{text-align:left;color:#a7bdc8;margin:8px 0}th,td{text-align:left;padding:4px 3px;border-bottom:1px solid #30454f}td:first-child{overflow-wrap:anywhere}footer{padding:12px 16px;color:#a7bdc8;font-size:11px}.metrics{display:grid;grid-template-columns:1fr auto;gap:4px 12px}.metrics dt,.metrics dd{margin:0}
`;

/** Mounts an accessible, scoped DOM panel. The host owns controller/scene lifetime. */
export function mountInspectorPanel(controller: InspectorController, container: HTMLElement): () => void {
  const document = container.ownerDocument, host = document.createElement("section"), shadow = host.attachShadow({mode: "open"}), events = new AbortController();
  host.setAttribute("data-mtek-inspector", ""); host.setAttribute("aria-label", "Mtek scene inspector");
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className !== undefined) element.className = className; return element;
  };
  const style = make("style", css), panel = make("div", undefined, "panel"), header = make("header"), heading = make("div"), status = make("span", "Detached", "status");
  heading.append(make("h2", "Scene inspector"), make("p", "Extension API 1", "muted")); header.append(heading, status); panel.append(header);
  const section = (title: string): HTMLElement => {const element = make("section"); element.append(make("h3", title)); panel.append(element); return element;};
  const entitiesSection = section("Entities"), filter = make("input"), entities = make("select"), count = make("small"), identity = make("code"), bounds = make("small");
  filter.type = "search"; filter.placeholder = "Filter by name or ID"; filter.setAttribute("aria-label", "Filter entities");
  entities.size = 6; entities.setAttribute("aria-label", "Scene entities"); entitiesSection.append(filter, entities, count, identity, bounds);
  const transformSection = section("Local transform"), form = make("form"), fields = new Map<string, HTMLInputElement>(), baseline = new Map<string, number>();
  for (const field of ["position", "rotation", "scale"] as const) {
    const group = make("fieldset"), legend = make("legend", field[0]!.toUpperCase() + field.slice(1)), vector = make("div", undefined, field === "rotation" ? "vector quaternion" : "vector"); group.append(legend, vector);
    for (const axis of field === "rotation" ? ["x", "y", "z", "w"] : ["x", "y", "z"]) {
      const label = make("label", axis.toUpperCase()), input = make("input"); input.type = "number"; input.step = "any"; input.required = true; input.setAttribute("aria-label", `${field} ${axis}`); label.append(input); vector.append(label); fields.set(`${field}.${axis}`, input);
    }
    form.append(group);
  }
  const buttons = make("div", undefined, "buttons"), apply = make("button", "Apply edits", "primary"), reset = make("button", "Reset fields"), undo = make("button", "Undo"), redo = make("button", "Redo");
  apply.type = "submit"; for (const button of [reset, undo, redo]) button.type = "button"; buttons.append(apply, reset, undo, redo); form.append(buttons);
  transformSection.append(form, make("small", "Edits apply on the next scene frame. Resume or step a paused scene to apply them. Bindings and physics can overwrite local transforms."));
  const animationSection = section("Animation"), clip = make("select"), animationStatus = make("p", undefined, "mono"), animationButtons = make("div", undefined, "buttons"), play = make("button", "Pause base clip"), detach = make("button", "Make pose independent"), timeLabel = make("label", "Animation time"), time = make("input");
  clip.setAttribute("aria-label", "Switch animation clip"); play.type = detach.type = "button"; time.type = "range"; time.min = "0"; time.step = "any"; time.className = "time"; time.setAttribute("aria-label", "Animation time"); timeLabel.append(time); animationButtons.append(play, detach);
  animationSection.append(animationStatus, clip, timeLabel, animationButtons, make("small", "Shared-pose controls can affect other actors. Make the pose independent first to edit only this actor."));
  const skeleton = make("details", undefined, "detail"), skeletonSummary = make("summary", "Skeleton"), table = make("table"), tableBody = make("tbody");
  table.append(make("caption", "Mesh-local joint positions")); const tableHead = make("thead"), headRow = make("tr"); for (const name of ["Joint", "X", "Y", "Z"]) headRow.append(make("th", name)); tableHead.append(headRow); table.append(tableHead, tableBody); skeleton.append(skeletonSummary, table); animationSection.append(skeleton);
  const metricsSection = section("Host metrics"), metrics = make("dl", undefined, "metrics"), metricEmpty = make("small", "Metrics unavailable"), footer = make("footer"), pending = make("p"), error = make("p", undefined, "error");
  metricsSection.append(metrics, metricEmpty, make("small", "Live observations, not benchmark measurements.")); error.setAttribute("role", "alert"); footer.append(pending, error); panel.append(footer); shadow.append(style, panel); container.append(host);
  let disposed = false, dirty = false, selected: string | null = null, entityKey = "", clipKey = "", jointRevision = -1, localError = "";
  const showError = (): void => {error.textContent = localError || controller.snapshot().error || "";};
  const run = (action: () => void): void => {localError = ""; try {action();} catch (caught) {localError = caught instanceof Error ? caught.message : String(caught);} showError();};
  const selectedEntity = (snapshot: InspectorSnapshot): SceneTransform | undefined => snapshot.entities.find(entity => entity.id === snapshot.selectedId);
  const resetFields = (entity: SceneTransform | undefined): void => {
    dirty = false; baseline.clear();
    for (const [key, input] of fields) {
      const [field, axis] = key.split(".") as ["position" | "rotation" | "scale", "x" | "y" | "z" | "w"];
      const value = entity === undefined ? undefined : (entity[field] as unknown as Record<string, number>)[axis]; input.value = value === undefined ? "" : String(value); if (value !== undefined) baseline.set(key, value);
    }
  };
  const render = (snapshot: InspectorSnapshot): void => {
    const ready = snapshot.status === "ready", entity = selectedEntity(snapshot), changedSelection = selected !== snapshot.selectedId;
    status.textContent = snapshot.status === "ready" ? "Connected" : snapshot.status === "disposed" ? "Disposed" : "Detached";
    if (changedSelection) {selected = snapshot.selectedId; dirty = false; localError = ""; jointRevision = -1; clipKey = "";}
    const needle = filter.value.toLocaleLowerCase(), filtered = snapshot.entities.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(needle));
    const key = JSON.stringify(filtered.map(item => [item.id, item.name, item.visible]));
    if (key !== entityKey) {
      entityKey = key; const placeholder = make("option", "Choose an entity"); placeholder.value = "";
      entities.replaceChildren(placeholder, ...filtered.map(item => {const option = make("option", `${item.name}${item.visible ? "" : " · hidden"}`); option.value = item.id; option.title = item.id; return option;}));
    }
    entities.value = filtered.some(item => item.id === selected) ? selected! : ""; entities.disabled = !ready; count.textContent = `${filtered.length} shown · ${snapshot.entities.length} total`; identity.textContent = entity?.id ?? "No entity selected";
    bounds.textContent = entity?.bounds === undefined ? "" : `Authored local bounds: center (${entity.bounds.center.x}, ${entity.bounds.center.y}, ${entity.bounds.center.z}), radius ${entity.bounds.radius}`;
    if (!dirty || changedSelection) resetFields(entity);
    for (const input of fields.values()) input.disabled = !ready || entity === undefined;
    apply.disabled = reset.disabled = !ready || entity === undefined || snapshot.pending > 0;
    undo.disabled = !ready || !snapshot.canUndo || snapshot.pending > 0; redo.disabled = !ready || !snapshot.canRedo || snapshot.pending > 0;
    const animation = snapshot.animation; animationSection.hidden = animation === null;
    if (animation !== null) {
      animationStatus.textContent = `${animation.mode} · ${animation.playing ? "playing" : "paused"} · ${animation.time.toFixed(3)} / ${animation.duration.toFixed(3)} s`;
      const nextClips = JSON.stringify(animation.clips);
      if (nextClips !== clipKey) {clipKey = nextClips; const placeholder = make("option", "Switch clip…"); placeholder.value = ""; clip.replaceChildren(placeholder, ...animation.clips.map(item => {const option = make("option", item.name); option.value = item.name; return option;}));}
      clip.disabled = snapshot.pending > 0 || animation.clips.length === 0;
      play.textContent = `${animation.playing ? "Pause" : "Resume"} ${animation.mode === "locomotion" ? "locomotion" : "base clip"}`; play.disabled = detach.disabled = snapshot.pending > 0;
      time.max = String(animation.duration); time.disabled = animation.duration === 0 || snapshot.pending > 0; if (shadow.activeElement !== time) time.value = String(animation.time);
      skeletonSummary.textContent = `Skeleton · ${animation.jointCount} joints${animation.joints.length < animation.jointCount ? ` · showing ${animation.joints.length}` : ""}`;
      if (skeleton.open && (jointRevision !== animation.revision || changedSelection)) {
        jointRevision = animation.revision; tableBody.replaceChildren(...animation.joints.map(joint => {const row = make("tr"), name = make("td", joint.name); name.title = joint.parent === null ? "Root joint" : `Parent: ${joint.parent}`; row.append(name); for (const axis of ["x", "y", "z"] as const) row.append(make("td", joint.position[axis].toFixed(3))); return row;}));
      }
    }
    metricEmpty.hidden = snapshot.metrics !== null; metrics.replaceChildren();
    for (const [key, value] of Object.entries(snapshot.metrics ?? {})) if (typeof value === "number") {metrics.append(make("dt", key), make("dd", key.endsWith("Ms") ? `${value.toFixed(3)} ms` : String(value)));}
    pending.textContent = snapshot.pending > 0 ? `${snapshot.pending} command(s) queued for the next scene frame` : "Transform history is local to this inspector session."; showError();
  };
  const listen = (target: EventTarget, type: string, action: (event: Event) => void): void => {target.addEventListener(type, action, {signal: events.signal});};
  listen(filter, "input", () => render(controller.snapshot()));
  listen(entities, "change", () => run(() => controller.select(entities.value || null)));
  listen(form, "input", () => {dirty = true;});
  listen(form, "submit", event => {
    event.preventDefault(); run(() => {
      const entity = selectedEntity(controller.snapshot()); if (entity === undefined) throw new Error("Select an entity first");
      const update: {id: string; position?: SceneTransform["position"]; rotation?: SceneTransform["rotation"]; scale?: SceneTransform["scale"]} = {id: entity.id};
      for (const field of ["position", "rotation", "scale"] as const) {
        const axes = field === "rotation" ? ["x", "y", "z", "w"] : ["x", "y", "z"], values: Record<string, number> = {};
        for (const axis of axes) {const value = fields.get(`${field}.${axis}`)!.valueAsNumber; if (!Number.isFinite(value)) throw new RangeError("Transform fields require finite numbers"); values[axis] = value;}
        if (axes.some(axis => values[axis] !== baseline.get(`${field}.${axis}`))) {
          if (field === "rotation") update.rotation = {x: values["x"]!, y: values["y"]!, z: values["z"]!, w: values["w"]!};
          else update[field] = {x: values["x"]!, y: values["y"]!, z: values["z"]!};
        }
      }
      if (Object.keys(update).length === 1) throw new RangeError("No transform fields changed");
      controller.edit([update]); dirty = false;
    });
  });
  listen(reset, "click", () => run(() => {controller.refresh(); resetFields(selectedEntity(controller.snapshot()));}));
  listen(undo, "click", () => run(() => controller.undo())); listen(redo, "click", () => run(() => controller.redo()));
  listen(clip, "change", () => run(() => {if (clip.value) controller.selectClip(clip.value);}));
  listen(play, "click", () => run(() => {if (controller.snapshot().animation?.playing) controller.pauseAnimation(); else controller.resumeAnimation();}));
  listen(detach, "click", () => run(() => controller.detachAnimation())); listen(time, "change", () => run(() => controller.seek(time.valueAsNumber)));
  listen(skeleton, "toggle", () => {jointRevision = -1; render(controller.snapshot());});
  const unsubscribe = controller.subscribe(render);
  return () => {if (disposed) return; disposed = true; unsubscribe(); events.abort(); host.remove();};
}
