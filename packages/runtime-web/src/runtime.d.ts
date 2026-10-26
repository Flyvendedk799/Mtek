// Mtek runtime host API (ABI 1). Hand-maintained: the public types of spec/runtime-abi.md section 6,
// nothing else. `npm run build` copies this file to dist/runtime.d.ts; the compiler writes it into every
// program's dist/ next to app.d.ts, which imports from it. Keep it self-contained (no imports) so it
// compiles in a host project with only the DOM library.

/** A byte/line/column range in a source file: half-open byte offsets, 1-based lines and columns (columns count Unicode scalar values). */
export interface MtekSourceSpan {
  readonly file: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface MtekRelatedSpan {
  readonly message: string;
  readonly source: MtekSourceSpan;
}

export interface MtekSuggestedEdit {
  readonly description: string;
  readonly edits: readonly {
    readonly file: string;
    readonly startByte: number;
    readonly endByte: number;
    readonly replacement: string;
  }[];
}

/** One diagnostic: the JSON shape of spec/diagnostics.md section 2.1, delivered to onDiagnostic by the runtime. */
export interface MtekDiagnostic {
  readonly schemaVersion: 1;
  /** `MTEK-` + severity letter + four digits, e.g. "MTEK-E8004". */
  readonly code: string;
  readonly severity: "error" | "warning" | "note";
  readonly title: string;
  readonly message: string;
  readonly source: MtekSourceSpan | null;
  readonly expected?: string;
  readonly actual?: string;
  readonly related: readonly MtekRelatedSpan[];
  readonly notes: readonly string[];
  readonly suggestedEdits: readonly MtekSuggestedEdit[];
  readonly phase:
    | "parse"
    | "check"
    | "emit"
    | "validate"
    | "runtime:mount"
    | "runtime:input"
    | "runtime:tick"
    | "runtime:update"
    | "runtime:bindings"
    | "runtime:render"
    | "runtime:reload"
    | "runtime:device";
  readonly docs: string;
}

/** `mountMtek` rejects with this error. */
export declare class MtekMountError extends Error {
  readonly kind:
    | "webgpu-unavailable"
    | "adapter-unavailable"
    | "device-failed"
    | "incompatible-program"
    | "manifest-invalid"
    | "shader-failed"
    | "asset-failed"
    | "allocation-failed"
    | "physics-failed"
    | "budget-exceeded";
  /** Mapped to Mtek source where possible. */
  readonly diagnostics: readonly MtekDiagnostic[];
  constructor(kind: MtekMountError["kind"], diagnostics: readonly MtekDiagnostic[]);
}

/**
 * The type of the default export of app.js. The type parameters carry Inputs for setInput and
 * Outputs for onOutput; at run time inputs are always validated by the generated codecs.
 */
export interface MtekProgram<I = Record<string, unknown>, O = Record<string, unknown>> {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: unknown;
  readonly functions: unknown;
  readonly scenes: unknown;
  readonly prefabs: unknown;
  /** Phantom, never present at run time. */
  readonly __inputs?: I;
  /** Phantom, never present at run time. Map interface keys so single-generic hosts accept generated Outputs. */
  readonly __outputs?: { readonly [K in keyof O]: O[K] };
}

export type MtekInputResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }; // code: "MTEK-E8040" unknown input, "MTEK-E8041" wrong type, "MTEK-E8100" non-opaque colour

export interface MtekTestOptions {
  /** No requestAnimationFrame; frames run only through app.debug.step. */
  manualClock?: boolean;
  /** Render into an offscreen rgba8unorm-srgb texture of this size. */
  renderTarget?: { width: number; height: number };
  /** Render into an offscreen rgba8unorm-srgb texture that always has the canvas's backing size (resize, pixel ratio). */
  canvasRenderTarget?: boolean;
  /** Device recovery (spec/runtime-abi.md section 9.4). */
  recovery?: {
    /** Delays before recovery attempts 1 to 3, in milliseconds. Default [250, 1000, 4000]. */
    delaysMs?: [number, number, number];
    /** The next n device requests of a recovery attempt fail as if requestDevice had rejected. */
    failDeviceRequests?: number;
  };
  /** Draw every visible entity, as if frustum culling did not exist (lets a test compare culled and unculled frames). */
  disableCulling?: boolean;
  /** Draw every entity with its own draw call, as if instancing did not exist (lets a test compare instanced and individual frames). */
  disableInstancing?: boolean;
  /** Replace the pixels of a built-in texture (a generated texture for a test; no asset needed). */
  textures?: { "texture.white"?: MtekTestTexture; "texture.black"?: MtekTestTexture };
  /** Called for every state change of every asset file: all pending first, then ready or failed, before mountMtek settles. */
  onAssetState?: (event: MtekAssetStateEvent) => void;
}

/** One state change of one asset file: pending, then ready or failed. */
export interface MtekAssetStateEvent {
  /** The file's url in the manifest's assets table. */
  readonly url: string;
  readonly kind: "mesh-data" | "image" | "audio" | "font";
  readonly state: "pending" | "ready" | "failed";
}

/** An asset file and its state, as debug.assets() lists it. */
export interface MtekAssetStatus extends MtekAssetStateEvent {
  /** The file's byte length. */
  readonly bytes: number;
}

export interface MtekTestTexture {
  width: number;
  height: number;
  /** Tightly packed RGBA8 texels, row-major, top row first: width x height x 4 bytes. */
  data: Uint8Array;
  /** "srgb" (default): an rgba8unorm-srgb texture, sampled as linear values. "linear": rgba8unorm, as stored. */
  colorSpace?: "srgb" | "linear";
}

export interface MtekDebug {
  step(frames: number, dtSeconds: number): void;
  readPixels(): Promise<{ width: number; height: number; format: "rgba8unorm-srgb"; data: Uint8Array }>;
  counters(): Readonly<Record<string, number>>;
  pressKey(code: string): void;
  releaseKey(code: string): void;
  setParam(entityName: string, param: string, value: unknown): void;
  /** Destroys the GPU device; the runtime handles it as a device loss (spec/runtime-abi.md section 9.4). */
  loseDevice(): void;
  /** Reports an allocation failure as the out-of-memory error scope would (spec/runtime-abi.md section 9.5). */
  failAllocation(): void;
  /** Every asset file of the running program with its state; after a successful mount all are ready. */
  assets(): readonly MtekAssetStatus[];
  /**
   * The scene's state, its named entities and, in spawn order, the spawned entities that exist (decision 0064): the
   * prefab's name, the slot and generation of its `entity_ref`, whether it is alive (not pending removal), its pose,
   * visibility, state and material params.
   */
  scene(): {
    state: Record<string, unknown>;
    entities: Array<{ name: string; position: unknown; rotation: unknown }>;
    spawned: Array<{
      prefab: string;
      slot: number;
      gen: number;
      alive: boolean;
      position: unknown;
      rotation: unknown;
      scale: unknown;
      visible: boolean;
      state: Record<string, unknown>;
      mat?: { p: Record<string, unknown> };
    }>;
  };
}

export interface MtekApp<I = Record<string, unknown>, O = Record<string, unknown>> {
  /** Never throws; the value is queued and applied at the next frame start. */
  setInput<K extends keyof I & string>(name: K, value: I[K]): MtekInputResult;
  /**
   * Initial snapshot after the next settled frame, then only value changes. Returns an idempotent
   * unsubscribe. Vector/color values are frozen copies; color components are linear RGBA.
   * Throws for an undeclared name, a non-function listener, or a failed/disposed app.
   */
  onOutput<K extends keyof O & string>(name: K, listener: (value: O[K]) => void): () => void;
  pause(): void;
  resume(): void;
  /** Synchronous release. */
  dispose(): void;
  readonly state: "running" | "paused" | "recovering" | "failed" | "disposed";
  /** Present only when options.test is set. */
  readonly debug?: MtekDebug;
  /** Present only in dev builds. */
  replaceProgram?(candidate: MtekProgram<I, O>): Promise<{ ok: true } | { ok: false; diagnostics: readonly MtekDiagnostic[] }>;
}

export interface MtekMountOptions<I = Record<string, unknown>> {
  physics?:{readonly continuousCollision?:boolean};
  rendering?:MtekRenderingOptions;
  extensions?: readonly MtekExtension[];
  hostServices?: Readonly<Record<string,unknown>>;
  /** Initial host inputs (validated like setInput). */
  inputs?: Partial<I>;
  /** Every runtime diagnostic, including warnings. */
  onDiagnostic?: (d: MtekDiagnostic) => void;
  /** Default "overlay". */
  failureDisplay?: "overlay" | "none";
  /** random() seed; default derived from time. */
  seed?: number;
  /** Default from the manifest runtimeConfig. */
  pauseWhenHidden?: boolean;
  /** Default "auto". */
  devicePixelRatio?: number | "auto";
  /** Show the development overlay and measure GPU time (`timestamp-query`). Development runtime only; the release runtime ignores it. */
  devOverlay?: boolean;
  /** Where saved state and settings are kept; default localStorage (in memory when `test` is given); null: memory only. */
  storage?: MtekSaveStorage | null;
  /** Omit in production. */
  test?: MtekTestOptions;
}

/** The part of the Web Storage API that saves use (`localStorage` satisfies it). */
export interface MtekSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export declare function mountMtek<I = Record<string, unknown>, O = Record<string, unknown>>(
  canvas: HTMLCanvasElement,
  program: MtekProgram<I, O>,
  options?: MtekMountOptions<I>,
): Promise<MtekApp<I, O>>;

export declare const EXTENSION_API_VERSION = 1;
export interface PostEffect {readonly id:string;readonly wgsl:string}
export type LightingQuality = "low" | "medium" | "high";
export interface LinearEnvironment {readonly width:number;readonly height:number;readonly data:Float32Array}
export interface EnvironmentLightingOptions extends LinearEnvironment {readonly intensity?:number;readonly rotation?:number;readonly quality?:LightingQuality}
export interface DirectionalShadowOptions {
  readonly light:string;readonly quality?:LightingQuality;readonly center?:readonly [number,number,number];
  readonly size?:number;readonly distance?:number;readonly near?:number;readonly far?:number;readonly bias?:number;readonly normalBias?:number;
}
export interface MtekRenderingOptions {readonly additiveMaterials?:readonly string[];readonly postProcessing?:readonly PostEffect[];readonly shadows?:DirectionalShadowOptions;readonly environment?:EnvironmentLightingOptions}
export declare function decodeRadiance(bytes:Uint8Array):LinearEnvironment;
export interface AnimationVector { readonly x:number;readonly y:number;readonly z:number }
export interface AnimationQuaternion extends AnimationVector { readonly w:number }
export interface SceneTransform {
  /** Explicit final mesh-local sphere, when supplied by source. */
  readonly bounds?: { readonly center: AnimationVector; readonly radius: number };
  readonly id:string;readonly name:string;readonly position:AnimationVector;
  readonly rotation:AnimationQuaternion;readonly scale:AnimationVector;readonly visible:boolean;
}
export interface TransformUpdate {readonly id:string;readonly position?:AnimationVector;readonly rotation?:AnimationQuaternion;readonly scale?:AnimationVector}
export interface ExtensionContext {
  readonly apiVersion:1;
  readTransforms():readonly SceneTransform[];
  writeTransforms(updates:readonly TransformUpdate[]):void;
  animation(id:string):AnimationPlayer|undefined;
  shareAnimation(source:string,targets:readonly string[]):void;detachAnimation(id:string):AnimationPlayer;
  service<T>(name:string):T|undefined;
}
export interface MtekExtension {
  readonly id:string;readonly apiVersion:1;
  setup(context:ExtensionContext):void|(()=>void);
  beforeFrame?(context:ExtensionContext,delta:number):void;
  afterFrame?(context:ExtensionContext,delta:number):void;
}
export interface MtekSkin {
  readonly meshNode:number;
  readonly nodes:readonly {readonly name:string;readonly parent:number;readonly translation:readonly number[];readonly rotation:readonly number[];readonly scale:readonly number[]}[];
  readonly joints:readonly number[];readonly inverseBind:readonly (readonly number[])[];
  readonly indices:readonly (readonly number[])[];readonly weights:readonly (readonly number[])[];
  readonly clips:readonly {readonly name:string;readonly duration:number;readonly channels:readonly {readonly node:number;readonly path:"translation"|"rotation"|"scale";readonly interpolation:"linear"|"step";readonly times:readonly number[];readonly values:readonly number[]}[]}[];
}
export interface AnimationLayer {
  readonly clip:string;readonly weight:number;readonly mask?:Readonly<Record<string,number>>;
  readonly additive?:boolean;readonly speed?:number;readonly looping?:boolean;
}
export interface IKHingeLimit {readonly axis:readonly [number,number,number];readonly min:number;readonly max:number}
export interface IKConstraint {readonly chain:readonly string[];readonly target:readonly [number,number,number];readonly weight?:number;readonly iterations?:number;readonly tolerance?:number;readonly rotation?:readonly [number,number,number,number];readonly rotationWeight?:number;readonly limits?:Readonly<Record<string,IKHingeLimit>>}
export interface AnimationBone {
  readonly position:{set(x:number,y:number,z:number):unknown};
  readonly quaternion:{set(x:number,y:number,z:number,w:number):unknown};
  readonly scale:{set(x:number,y:number,z:number):unknown};
}
export interface AnimationUpdateBand {readonly distance:number;readonly interval:number}
export interface LocomotionSample {readonly clip:string;readonly threshold:number}
export interface LocomotionOptions {readonly samples:readonly LocomotionSample[];readonly parameter?:number;readonly phase?:number;readonly speed?:number;readonly looping?:boolean}
export interface LocomotionPlayer {
  readonly active:boolean;readonly phase:number;readonly parameter:number;readonly revision:number;readonly playing:boolean;readonly finished:boolean;readonly duration:number;
  set(options:LocomotionOptions|undefined):void;setParameter(value:number):void;seek(phase:number):void;
  crossed(clip:string,seconds:number):boolean;crossedPhase(phase:number):boolean;
  play(looping?:boolean,speed?:number):boolean;pause():boolean;resume():boolean;
}
export interface AnimationControllerOptions {readonly clip?:string;readonly bones?:Readonly<Record<string,AnimationBone>>;readonly updateInterval?:number;readonly updatePolicy?:readonly AnimationUpdateBand[]}
export interface AnimationClock {
  play(slot:number,looping:boolean,speed:number):boolean;pause(slot:number):boolean;resume(slot:number):boolean;
  seek(slot:number,time:number):boolean;fade(slot:number,weight:number,duration:number):boolean;
  time(slot:number):number;duration(slot:number):number;weight(slot:number):number;playing(slot:number):boolean;finished(slot:number):boolean;crossed(slot:number,marker:number):boolean;
}
export interface AnimationPlayer {
  readonly skin:MtekSkin;readonly palette:Float32Array;readonly pose:Float64Array;readonly revision:number;
  readonly clock:AnimationClock;
  readonly locomotion:LocomotionPlayer;
  setUpdatePolicy(bands:readonly AnimationUpdateBand[]|undefined):void;
  readonly layers:{set(id:string,options:AnimationLayer):void;remove(id:string):void;clear():void;seek(id:string,seconds:number):boolean;crossed(id:string,marker:number):boolean};
  readonly ik:{set(id:string,options:IKConstraint):void;remove(id:string):void;clear():void};
  transition(name:string,seconds:number,looping:boolean,speed:number):boolean;
  play(looping:boolean,speed:number):boolean;advance(dt:number,evaluate?:boolean,distance?:number):void;evaluate():void;
  jointPosition(name:string):AnimationVector;jointRotation(name:string):AnimationQuaternion;
  setProceduralOverride(override:((pose:Float64Array)=>void)|undefined):void;
  setRootMotion(node:string|undefined):void;consumeRootMotion():AnimationVector;
}
export declare class AnimationController {
  readonly apiVersion=1;readonly player:AnimationPlayer;
  constructor(skin:MtekSkin,options?:AnimationControllerOptions);
  setUpdateInterval(seconds:number):void;setUpdatePolicy(bands:readonly AnimationUpdateBand[]|undefined):void;
  setLocomotion(options:LocomotionOptions|undefined):void;setLocomotionParameter(value:number):void;setLayer(id:string,layer:AnimationLayer):void;setIK(id:string,constraint:IKConstraint):void;
  update(dt:number,force?:boolean,distance?:number):boolean;dispose():void;
}
export declare function createAnimationController(skin:MtekSkin,options?:AnimationControllerOptions):AnimationController;
export interface RetargetOptions {readonly translationScale?:number;readonly rotationSpace?:"local"|"world";readonly nodeTranslationScales?:Readonly<Record<string,number>>}
export declare function retargetSkin(source:MtekSkin,target:MtekSkin,mapping:Readonly<Record<string,string>>,options?:number|RetargetOptions):MtekSkin;
export declare function deformSkin(skin:MtekSkin,palette:Float32Array,positions:Float32Array,normals:Float32Array|undefined,outPositions:Float32Array,outNormals:Float32Array):void;
export interface AssetDescriptor {readonly url:string;readonly bytes?:number;readonly sha256?:string}
export interface AssetProgress {readonly loaded:number;readonly total:number|undefined}
export interface AssetLoader<T> {readonly id:string;readonly apiVersion:1;decode(bytes:Uint8Array,signal:AbortSignal):Promise<T>|T;dispose?(value:T):void}
export interface AssetLease<T> {readonly value:T;readonly bytes:number;release():void}
export interface AssetRequestOptions {readonly signal?:AbortSignal;readonly onProgress?:(progress:AssetProgress)=>void}
export interface AssetPoolOptions {readonly baseUrl:URL;readonly allowedOrigins?:readonly string[];readonly maxAssetBytes?:number;readonly fetch?:typeof fetch}
export declare class AssetPool {
  constructor(options:AssetPoolOptions);
  load<T>(asset:AssetDescriptor,loader:AssetLoader<T>,options?:AssetRequestOptions):Promise<AssetLease<T>>;
  snapshot():{resources:number;pending:number;bytes:number;leases:number};dispose():void;
}
