import type {AnimationVector as Vector} from "@mtek/runtime-web";
import type {InspectorController} from "./controller.js";
import type {InspectorSpatialSnapshot} from "./types.js";

export interface InspectorOverlayOptions {
  readonly bounds?: boolean;
  readonly skeleton?: boolean;
  readonly ik?: boolean;
  readonly colliders?: boolean;
  readonly contacts?: boolean;
  readonly selectedOnly?: boolean;
  readonly markerSize?: number;
  readonly maxSegments?: number;
  readonly zIndex?: number;
}
export type InspectorOverlayKind = "bounds" | "skeleton" | "ik" | "collider" | "contact";
export interface InspectorOverlayLine {
  readonly kind: InspectorOverlayKind;
  readonly entityId: string;
  readonly start: {readonly x: number; readonly y: number};
  readonly end: {readonly x: number; readonly y: number};
  readonly color: string;
  readonly dashed: boolean;
}
export interface InspectorOverlayGeometry {
  readonly available: boolean;
  readonly truncated: boolean;
  readonly lines: readonly InspectorOverlayLine[];
}
const colors = {bounds:"#e4c36f", skeleton:"#67dfec", ik:"#ff8876", collider:"#a5e889", contact:"#f3a5f0"} as const;
const at = (m: readonly number[], p: Vector): readonly number[] => [0,1,2,3].map(row => m[row]! * p.x + m[4 + row]! * p.y + m[8 + row]! * p.z + m[12 + row]!);
const world = (m: readonly number[], p: Vector): Vector => {const v = at(m,p); return {x:v[0]!, y:v[1]!, z:v[2]!};};
const add = (a: Vector, b: Vector): Vector => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
function rotated(p: Vector, q: {x:number;y:number;z:number;w:number}): Vector {
  const tx = 2*(q.y*p.z-q.z*p.y), ty = 2*(q.z*p.x-q.x*p.z), tz = 2*(q.x*p.y-q.y*p.x);
  return {x:p.x+q.w*tx+q.y*tz-q.z*ty,y:p.y+q.w*ty+q.z*tx-q.x*tz,z:p.z+q.w*tz+q.x*ty-q.y*tx};
}
/** Homogeneous clipping includes the WebGPU near plane and rejects points behind the eye. */
export function projectOverlaySegment(matrix: readonly number[], a: Vector, b: Vector): readonly [Vector, Vector] | undefined {
  if (matrix.length !== 16) return undefined;
  const first = at(matrix,a), last = at(matrix,b);
  if (![...first,...last].every(Number.isFinite)) return undefined;
  const planes = (p: readonly number[]): readonly number[] => [p[3]!+p[0]!,p[3]!-p[0]!,p[3]!+p[1]!,p[3]!-p[1]!,p[2]!,p[3]!-p[2]!,p[3]!-1e-8];
  const start = planes(first), end = planes(last); let low = 0, high = 1;
  for (let i=0;i<start.length;i++) {
    const x = start[i]!, y = end[i]!;
    if (x < 0 && y < 0) return undefined;
    if (x < 0) low = Math.max(low,x/(x-y));
    if (y < 0) high = Math.min(high,x/(x-y));
    if (low > high) return undefined;
  }
  const point = (t: number): Vector => {
    const p = first.map((v,i) => v+(last[i]!-v)*t);
    return {x:p[0]!/p[3]!,y:p[1]!/p[3]!,z:p[2]!/p[3]!};
  };
  return [point(low),point(high)];
}
function options(value: InspectorOverlayOptions): Required<InspectorOverlayOptions> {
  const result = {bounds:true,skeleton:true,ik:true,colliders:true,contacts:true,selectedOnly:true,markerSize:0.08,maxSegments:4096,zIndex:10,...value};
  if (!Number.isFinite(result.markerSize) || result.markerSize <= 0 || !Number.isInteger(result.maxSegments) || result.maxSegments < 1 || result.maxSegments > 16384 || !Number.isInteger(result.zIndex) || result.zIndex < 0 || result.zIndex > 2147483647) throw new RangeError("Invalid inspector overlay size/segment limit/z-index");
  return result;
}
/** Renderer-independent NDC geometry. World matrices include ancestors and node animation. */
export function buildInspectorOverlay(snapshot: InspectorSpatialSnapshot, settings: InspectorOverlayOptions = {}): InspectorOverlayGeometry {
  const config = options(settings), scene = snapshot.scene, lines: InspectorOverlayLine[] = [];
  const result = {available:snapshot.status === "ready" && scene?.renderable === true,truncated:false,lines};
  if (!result.available || scene === null) return result;
  const selected = (id: string): boolean => !config.selectedOnly || id === snapshot.selectedId;
  const full = (): boolean => result.truncated;
  const line = (kind: InspectorOverlayKind, id: string, a: Vector, b: Vector, dashed = false, color: string = colors[kind]): void => {
    if (full()) return;
    const projected = projectOverlaySegment(scene.viewProjection,a,b);
    if (projected !== undefined) {
      if (lines.length >= config.maxSegments) {result.truncated = true; return;}
      lines.push({kind,entityId:id,start:projected[0],end:projected[1],color,dashed});
    }
  };
  const cross = (kind: InspectorOverlayKind, id: string, p: Vector): void => {
    for (const axis of ["x","y","z"] as const) line(kind,id,{...p,[axis]:p[axis]-config.markerSize},{...p,[axis]:p[axis]+config.markerSize});
  };
  const sphere = (kind: InspectorOverlayKind, id: string, center: Vector, radius: number, dashed: boolean): void => {
    for (let axis=0;axis<3;axis++) for (let i=0;i<32;i++) {
      if (full()) return;
      const p = (angle: number): Vector => {const v = [0,0,0]; v[(axis+1)%3] = Math.cos(angle)*radius; v[(axis+2)%3] = Math.sin(angle)*radius; return {x:center.x+v[0]!,y:center.y+v[1]!,z:center.z+v[2]!};};
      line(kind,id,p(i*Math.PI/16),p((i+1)*Math.PI/16),dashed);
    }
  };
  if (config.bounds) for (const entity of scene.entities) {
    if (full()) return result;
    if (selected(entity.id) && entity.bounds?.sphere != null) sphere("bounds",entity.id,entity.bounds.sphere.center,entity.bounds.sphere.radius,entity.bounds.culled);
  }
  const entity = scene.entities.find(e => e.id === snapshot.selectedId), animation = snapshot.animation;
  if (entity !== undefined && animation !== null) {
    const nodes = new Map(animation.nodes.map(node => [node.index,node]));
    const position = (index: number): Vector | undefined => {const node = nodes.get(index); return node === undefined ? undefined : world(entity.worldMatrix,node.position);};
    if (config.skeleton) for (const node of animation.nodes) {
      if (full()) return result;
      const parent = position(node.parent), end = position(node.index);
      if (parent !== undefined && end !== undefined) line("skeleton",entity.id,parent,end);
    }
    if (config.ik) for (const ik of animation.ik) {
      if (full()) return result;
      const target = world(entity.worldMatrix,ik.target), end = position(ik.chain.at(-1)!);
      cross("ik",entity.id,target);
      if (end !== undefined) line("ik",entity.id,end,target,true);
      for (let i=1;i<ik.chain.length;i++) {
        const a = position(ik.chain[i-1]!), b = position(ik.chain[i]!);
        if (a !== undefined && b !== undefined) line("ik",entity.id,a,b);
      }
      if (ik.rotation !== undefined) for (let axis=0;axis<3;axis++) {
        const v = {x:0,y:0,z:0}; v[["x","y","z"][axis] as "x"|"y"|"z"] = config.markerSize*3;
        line("ik",entity.id,target,world(entity.worldMatrix,add(ik.target,rotated(v,ik.rotation))),false,["#ff8070","#8be8a1","#8eb8ff"][axis]);
      }
    }
  }
  for (const body of scene.bodies) {
    if (full()) return result;
    if (!selected(body.entityId)) continue;
    const shape = body.collider.shape, dashed = body.collider.sensor || !body.active;
    if (config.colliders) {
      if (shape.kind === "sphere") sphere("collider",body.entityId,body.position,shape.radius,dashed);
      else {
        const corners = Array.from({length:8},(_,i) => add(body.position,rotated({x:(i&1?1:-1)*shape.size.x/2,y:(i&2?1:-1)*shape.size.y/2,z:(i&4?1:-1)*shape.size.z/2},body.rotation)));
        for (let i=0;i<8;i++) for (const bit of [1,2,4]) if ((i&bit) === 0) line("collider",body.entityId,corners[i]!,corners[i|bit]!,dashed);
      }
    }
    if (config.contacts) for (const contact of body.contacts ?? []) {
      if (full()) return result;
      cross("contact",body.entityId,contact.point);
      line("contact",body.entityId,contact.point,add(contact.point,{x:contact.normal.x*config.markerSize*3,y:contact.normal.y*config.markerSize*3,z:contact.normal.z*config.markerSize*3}));
    }
  }
  return result;
}

export interface InspectorOverlay {
  setOptions(options: InspectorOverlayOptions): void;
  geometry(): InspectorOverlayGeometry;
  dispose(): void;
}
/** A pointer-transparent Canvas2D overlay; the Mtek renderer and GPU own no overlay resources. */
export function mountInspectorOverlay(controller: InspectorController, target: HTMLCanvasElement, initial: InspectorOverlayOptions = {}): InspectorOverlay {
  const document = target.ownerDocument, view = document.defaultView;
  if (view === null) throw new Error("Inspector overlay requires a window");
  let config = options(initial), disposed = false, latest = controller.spatialSnapshot(), geometry: InspectorOverlayGeometry = {available:false,truncated:false,lines:[]};
  const host = document.createElement("mtek-inspector-overlay"), shadow = host.attachShadow({mode:"open"}), canvas = document.createElement("canvas"), status = document.createElement("output"), events = new view.AbortController();
  host.dataset["mtekInspectorOverlay"] = ""; canvas.setAttribute("aria-hidden","true"); status.setAttribute("aria-label","Inspector overlay status");
  host.style.cssText = "all:initial;display:block;position:fixed;pointer-events:none;margin:0;padding:0;border:0;";
  canvas.style.cssText = "display:block;position:absolute;left:0;top:0;pointer-events:none;margin:0;padding:0;border:0;background:transparent;";
  status.style.cssText = "position:absolute;left:8px;top:8px;pointer-events:none;padding:3px 7px;background:#14232be6;color:#dce8ed;font:11px system-ui;border-radius:4px;";
  const context = canvas.getContext("2d"); if (context === null) throw new Error("Canvas2D inspector overlays are unavailable");
  shadow.append(canvas,status); document.body.append(host);
  const draw = (): void => {
    if (disposed) return;
    geometry = buildInspectorOverlay(latest,config);
    const rect = target.getBoundingClientRect(), style = view.getComputedStyle(target);
    const number = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0;
    const borderX = number("border-left-width")+number("border-right-width"), borderY = number("border-top-width")+number("border-bottom-width"), paddingX = number("padding-left")+number("padding-right"), paddingY = number("padding-top")+number("padding-bottom");
    const cssWidth = number("width")+(style.boxSizing === "border-box" ? 0 : borderX+paddingX), cssHeight = number("height")+(style.boxSizing === "border-box" ? 0 : borderY+paddingY);
    const sx = cssWidth > 0 ? rect.width/cssWidth : 0, sy = cssHeight > 0 ? rect.height/cssHeight : 0;
    const width = Math.max(0,(cssWidth-borderX-paddingX)*sx), height = Math.max(0,(cssHeight-borderY-paddingY)*sy);
    const left = rect.left+(number("border-left-width")+number("padding-left"))*sx, top = rect.top+(number("border-top-width")+number("padding-top"))*sy;
    let unsupported = false;
    for (let element: Element | null = target; element !== null; element = element.parentElement) {
      const computed = view.getComputedStyle(element);
      if (computed.transform !== "none") {const matrix = new view.DOMMatrixReadOnly(computed.transform); if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0) unsupported = true;}
      if (computed.rotate !== "none" && computed.rotate !== "0deg") unsupported = true;
      if (computed.perspective !== "none" || (computed.scale !== "none" && computed.scale.split(" ").some(v => Number(v) <= 0))) unsupported = true;
    }
    const visible = latest.status === "ready" && width > 0 && height > 0;
    host.hidden = !visible;
    host.style.display = visible ? "block" : "none";
    host.style.zIndex = String(config.zIndex);
    host.style.left = `${left}px`; host.style.top = `${top}px`; host.style.width = `${width}px`; host.style.height = `${height}px`;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ratio = Math.min(3,view.devicePixelRatio || 1,8192/Math.max(1,width),8192/Math.max(1,height),Math.sqrt(16_777_216/Math.max(1,width*height))), pixelWidth = visible ? Math.floor(width*ratio) : 0, pixelHeight = visible ? Math.floor(height*ratio) : 0;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {canvas.width = pixelWidth; canvas.height = pixelHeight;}
    context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,width,height);
    const message = latest.error ?? (unsupported ? "Overlays require an unrotated canvas and ancestors" : !geometry.available ? "Spatial data unavailable for this frame" : config.selectedOnly && latest.selectedId === null ? "Select an entity for world overlays" : geometry.truncated ? `Overlay segment limit reached (${config.maxSegments})` : (["bounds","skeleton","ik","colliders","contacts"] as const).filter(key => config[key]).join(" · "));
    if (status.textContent !== message) status.textContent = message;
    host.dataset["segments"] = String(unsupported ? 0 : geometry.lines.length);
    if (!geometry.available || unsupported) return;
    context.lineWidth = 1.5;
    for (const line of geometry.lines) {
      context.strokeStyle = line.color; context.setLineDash(line.dashed ? [4,3] : []); context.beginPath();
      context.moveTo((line.start.x+1)*width/2,(1-line.start.y)*height/2);
      context.lineTo((line.end.x+1)*width/2,(1-line.end.y)*height/2); context.stroke();
    }
  };
  let remove = (): void => {}, resize: ResizeObserver | undefined;
  const cleanup = (): void => {if (disposed) return; disposed = true; remove(); remove = () => {}; resize?.disconnect(); events.abort(); canvas.width = canvas.height = 0; host.remove(); latest = {status:"disposed",selectedId:null,scene:null,animation:null,error:null}; geometry = {available:false,truncated:false,lines:[]};};
  try {
    resize = new view.ResizeObserver(draw); resize.observe(target);
    view.addEventListener("resize",draw,{signal:events.signal}); view.addEventListener("scroll",draw,{capture:true,signal:events.signal});
    remove = controller.subscribeSpatial(snapshot => {latest = snapshot; draw();});
  } catch (error) {cleanup(); throw error;}
  return {setOptions: value => {if (disposed) throw new Error("Inspector overlay is disposed"); config = options({...config,...value}); draw();},geometry: () => geometry,
    dispose: cleanup};
}
