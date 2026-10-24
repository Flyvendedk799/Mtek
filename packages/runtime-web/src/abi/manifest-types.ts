// TypeScript types of program.manifest.json (manifest schema 1, runtime ABI 1).
//
// `spec/manifest.schema.json` is the machine-checked definition; these types mirror it by hand. A test
// (abi.test.ts) keeps the two in step: it checks that a typed literal equals the shared minimal example and
// that the full example touches every property of the schema.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

/** An Mtek type as written in source: `f32`, `vec3`, `color`, `array<f32, 3>`, a struct name, ... */
export type MtekTypeName = string;

/** `normalised module path :: qualified declaration name`, e.g. `src/main.mtek::Demo.Cube`. */
export type SymbolId = string;

/** Index into the manifest `spans` table. */
export type SpanId = number;

export interface MtekRequiredCapabilities {
  readonly features: readonly string[];
  /** Only limits above the WebGPU defaults, name to required value. */
  readonly limits: Readonly<Record<string, number>>;
  readonly wgslLanguageFeatures: readonly string[];
}

export interface MtekRuntimeConfig {
  readonly fixedStep: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDelta: number;
  readonly maxEntities: number;
  readonly pauseWhenHidden: boolean;
}

export interface MtekSource {
  readonly id: number;
  readonly path: string;
  readonly sha256: string;
}

/** A source range (decision 0019): half-open byte offsets, and 1-based line and column (in Unicode scalar values) of both ends. */
export interface MtekSpan {
  readonly file: number;
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export type MtekSymbolKind =
  | "scene"
  | "camera"
  | "entity"
  | "state"
  | "material"
  | "param"
  | "prefab"
  | "function";

export interface MtekSymbol {
  readonly id: SymbolId;
  readonly kind: MtekSymbolKind;
  readonly span: SpanId;
}

// ---- layout records (spec/gpu-layout.md section 5) ----

export interface MtekLayoutScalarNode {
  readonly kind: "scalar";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly scalar: "f32" | "i32" | "u32" | "bool32";
}

export interface MtekLayoutVectorNode {
  readonly kind: "vector";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly scalar: "f32";
  readonly components: 2 | 3 | 4;
}

export interface MtekLayoutMatrixNode {
  readonly kind: "matrix";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly columns: 4;
  readonly rows: 4;
  readonly columnStride: 16;
}

export interface MtekLayoutMember {
  readonly name: string;
  readonly mtekType: MtekTypeName;
  readonly node: MtekLayoutNode;
}

export interface MtekLayoutStructNode {
  readonly kind: "struct";
  /** Omitted on the root of a block, present on nested struct nodes. */
  readonly name?: string;
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly members: readonly MtekLayoutMember[];
}

export interface MtekLayoutArrayNode {
  readonly kind: "array";
  readonly offset: number;
  readonly size: number;
  readonly align: number;
  readonly length: number;
  readonly stride: number;
  readonly padded: boolean;
  /** Offsets inside the element node are relative to the element start. */
  readonly element: MtekLayoutNode;
}

export type MtekLayoutNode =
  | MtekLayoutScalarNode
  | MtekLayoutVectorNode
  | MtekLayoutMatrixNode
  | MtekLayoutStructNode
  | MtekLayoutArrayNode;

export interface MtekLayoutRecord {
  /** `builtin:frame`, `builtin:object`, `material:<module path>::<Name>` or `fixture:<name>`. */
  readonly id: string;
  readonly wgslStruct: string;
  readonly size: number;
  readonly align: number;
  readonly root: MtekLayoutStructNode;
}

// ---- shaders, materials ----

export type MtekVertexAttribute = "position" | "normal" | "uv";
export type MtekSurfaceInput = "local_position" | "world_position" | "world_normal" | "uv";

export interface MtekShader {
  /** Full SHA-256 of the WGSL file. */
  readonly hash: string;
  readonly url: string;
  readonly map: string;
  readonly material: SymbolId;
  readonly vertexEntry: string;
  /** The vertex entry that reads the model and normal matrices from an instance buffer (decision 0059); absent: no instancing. */
  readonly instancedVertexEntry?: string;
  readonly fragmentEntry: string;
  readonly vertexAttributes: readonly MtekVertexAttribute[];
  readonly surfaceInputs: readonly MtekSurfaceInput[];
}

export interface MtekMaterialResource {
  readonly name: string;
  readonly kind: "texture" | "sampler";
  /** Binding number inside bind group 1 (1 or higher). */
  readonly binding: number;
}

export interface MtekMaterialParam {
  readonly name: string;
  readonly type: MtekTypeName;
  readonly span: SpanId;
}

export interface MtekMaterial {
  readonly id: SymbolId;
  /** Layout id of the parameter block; null when the material has no value params. */
  readonly layout: string | null;
  /** Hash of the material's shader. */
  readonly shader: string;
  readonly resources: readonly MtekMaterialResource[];
  readonly params: readonly MtekMaterialParam[];
}

// ---- meshes, assets ----

export interface MtekBoxMesh {
  readonly id: string;
  readonly kind: "box";
  readonly size: Vec3;
}

export interface MtekSphereMesh {
  readonly id: string;
  readonly kind: "sphere";
  readonly radius: number;
  readonly segments: number;
  readonly rings: number;
}

export interface MtekPlaneMesh {
  readonly id: string;
  readonly kind: "plane";
  readonly size: Vec2;
}

export interface MtekAssetMesh {
  readonly id: string;
  readonly kind: "asset";
  /** Url of a `mesh-data` entry of the assets table. */
  readonly asset: string;
  /** Index into that entry's `primitives`. */
  readonly primitive: number;
  readonly skin?: MtekSkin;
}

export interface MtekSkin {
  readonly meshNode: number;
  readonly nodes: readonly { readonly name: string; readonly parent: number; readonly translation: readonly number[]; readonly rotation: readonly number[]; readonly scale: readonly number[] }[];
  readonly joints: readonly number[];
  readonly inverseBind: readonly (readonly number[])[];
  readonly indices: readonly (readonly number[])[];
  readonly weights: readonly (readonly number[])[];
  readonly clips: readonly { readonly name: string; readonly duration: number; readonly channels: readonly (MtekClipChannel & { readonly node: number })[] }[];
}

export type MtekMesh = MtekBoxMesh | MtekSphereMesh | MtekPlaneMesh | MtekAssetMesh;

export interface MtekMeshPrimitive {
  readonly source: { readonly file: string; readonly mesh: string; readonly primitive: number };
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly indexFormat: "uint16" | "uint32";
  readonly attributes: readonly MtekVertexAttribute[];
  /** Byte offsets into the packaged file. */
  readonly offsets: {
    readonly position: number;
    readonly normal?: number;
    readonly uv?: number;
    readonly indices: number;
  };
  readonly boundingSphere: { readonly center: Vec3; readonly radius: number };
}

export interface MtekMeshDataAsset {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "mesh-data";
  readonly primitives: readonly MtekMeshPrimitive[];
  readonly preprocessing: readonly string[];
  readonly span: SpanId;
}

export interface MtekImageAsset {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "image";
  readonly colorSpace: "srgb" | "linear";
  readonly preprocessing: readonly string[];
  readonly span: SpanId;
  /** The author's file (decision 0082): a project path, or `<glb path>#images[N]`. Optional. */
  readonly source?: string;
}

/** A sound file declared with `asset.sound(..)`, copied byte for byte (`spec/audio.md` section 4, decision 0130). */
export interface MtekAudioAsset {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "audio";
  readonly format: "wav" | "ogg" | "mp3";
  readonly mime: "audio/wav" | "audio/ogg" | "audio/mpeg";
  /** The project path generated code names the sound by. */
  readonly source: string;
  readonly span: SpanId;
}

/** A font file of `asset.font(..)` (decision 0139). */
export interface MtekFontAsset {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: "font";
  readonly format: "ttf" | "otf" | "woff" | "woff2";
  readonly mime: "font/ttf" | "font/otf" | "font/woff" | "font/woff2";
  /** The project path generated code names the font by. */
  readonly source: string;
  readonly span: SpanId;
}

export type MtekAsset = MtekMeshDataAsset | MtekImageAsset | MtekAudioAsset | MtekFontAsset;

// ---- scene structure (spec/runtime-abi.md section 5.2) ----

export interface MtekSceneFields {
  /** Linear colour `[r, g, b, a]`. */
  readonly clearColor: Vec4;
  readonly ambientColor: Vec4;
  readonly ambientIntensity: number;
  readonly gravity: Vec3;
}

export interface MtekStateEntry {
  readonly name: string;
  readonly type: MtekTypeName;
  readonly symbol: SymbolId;
  /** `shared state` (decision 0141): carried over by `go_to` to a scene with a shared state of the same name and type. */
  readonly shared?: true;
  /** `saved state` or `setting state` (decisions 0145, 0146): kept in the browser's storage. Absent otherwise. */
  readonly persist?: "saved" | "setting";
  /** The structural description of the type (decisions 0145, 0177): what a stored value must match, and what a reload or `go_to` compares. Always present with `persist`; otherwise only when it differs from `type`. */
  readonly storedType?: string;
}

/** One scene of a multi-scene program (decision 0141): what `go_to` loads, relative to the program's `baseUrl`. */
export interface MtekGameScene {
  readonly name: string;
  /** `app.js` for the entry scene, `app.<Scene>.js` for the others. */
  readonly module: string;
  /** `program.manifest.json` for the entry scene, `program.<Scene>.manifest.json` for the others. */
  readonly manifest: string;
}

/** Game-level data (decision 0141); absent when there is none. */
export interface MtekGame {
  /** Every scene, sorted by name; absent for a single-scene program. */
  readonly scenes?: readonly MtekGameScene[];
  /** The storage name of saved state and settings (`localStorage` key `mtek.save.<storage>`); present when a scene has any (decision 0145). */
  readonly storage?: string;
  /** The storage name older builds used (the project name): a program with a save id adopts its saves once (decision 0179). */
  readonly legacyStorage?: string;
}

export interface MtekCamera {
  readonly name: string;
  readonly symbol: SymbolId;
  readonly projection: "perspective" | "orthographic";
  readonly hasTarget: boolean;
  readonly active: boolean;
  /** EV100 (decision 0081): lit materials are scaled by `1 / (1.2 * 2^exposure)`. */
  readonly exposure: number;
}

export type MtekBody =
  | { readonly kind: "static" }
  | { readonly kind: "kinematic" }
  | {
      readonly kind: "dynamic";
      readonly mass: number;
      readonly linearDamping: number;
      readonly angularDamping: number;
    };

export interface MtekBoxCollider {
  readonly kind: "box";
  readonly size: Vec3;
  readonly sensor: boolean;
  readonly friction: number;
  readonly restitution: number;
}

export interface MtekSphereCollider {
  readonly kind: "sphere";
  readonly radius: number;
  readonly sensor: boolean;
  readonly friction: number;
  readonly restitution: number;
}

export type MtekCollider = MtekBoxCollider | MtekSphereCollider;

export interface MtekEntity {
  /** Static entity index in stable instance order (depth-first pre-order). */
  readonly index: number;
  readonly name: string;
  readonly symbol: SymbolId;
  readonly parent: number | null;
  /** Id of an entry of the meshes table. */
  readonly mesh: string | null;
  readonly material: { readonly id: SymbolId; readonly instance: number } | null;
  /** Index into `scene.lights`. */
  readonly light: number | null;
  readonly body: MtekBody | null;
  readonly collider: MtekCollider | null;
  readonly state: readonly MtekStateEntry[];
  readonly update: boolean;
  readonly fixedUpdate: boolean;
  /** `tag: "name";` (decision 0150); absent when the entity has none. */
  readonly tag?: string;
  /** `particles: Emitter { .. }` (decision 0155); absent when the entity emits none. */
  readonly particles?: MtekParticles;
  /** A glTF clip that moves this entity (decision 0156); absent when it plays none. */
  readonly clip?: MtekClip;
}

export interface MtekParticles {
  readonly rate: number;
  readonly lifetime: number;
  readonly speed: number;
  readonly size: number;
  readonly gravity: number;
}

export interface MtekClipChannel {
  readonly path: "translation" | "rotation" | "scale";
  readonly interpolation: "linear" | "step";
  readonly times: readonly number[];
  readonly values: readonly number[];
}

export interface MtekClip {
  readonly name: string;
  readonly duration: number;
  readonly channels: readonly MtekClipChannel[];
}

export type MtekBuiltinResourceName =
  | "texture.white"
  | "texture.black"
  | "sampler.linear_repeat"
  | "sampler.linear_clamp"
  | "sampler.nearest_repeat"
  | "sampler.nearest_clamp";

export type MtekResourceValue =
  | { readonly kind: "builtin"; readonly name: MtekBuiltinResourceName }
  | { readonly kind: "asset"; readonly asset: string };

export type MtekInstanceParam =
  | { readonly name: string; readonly class: "initial" }
  | { readonly name: string; readonly class: "imperative" }
  | { readonly name: string; readonly class: "bound"; readonly binding: number }
  | { readonly name: string; readonly class: "resource"; readonly value: MtekResourceValue };

export interface MtekMaterialInstance {
  readonly index: number;
  readonly material: SymbolId;
  readonly entity: number;
  readonly params: readonly MtekInstanceParam[];
  readonly shareable: boolean;
}

/**
 * A prefab the program spawns (spec/runtime-abi.md section 5.6, decision 0064). In its bindings entity 0 is the
 * instance and material instance 0 is its material.
 */
export interface MtekPrefab {
  /** The key of the `prefabs` table of the program module. */
  readonly symbol: SymbolId;
  readonly name: string;
  /** The params in declaration order. */
  readonly params: readonly { readonly name: string; readonly type: MtekTypeName }[];
  /** Id of an entry of the meshes table. */
  readonly mesh: string | null;
  /** The material instance every instance starts with. */
  readonly material: {
    readonly id: SymbolId;
    readonly params: readonly MtekInstanceParam[];
    readonly shareable: boolean;
  } | null;
  readonly body: MtekBody | null;
  readonly collider: MtekCollider | null;
  readonly state: readonly MtekStateEntry[];
  readonly update: boolean;
  readonly fixedUpdate: boolean;
  readonly bindings: readonly MtekBinding[];
  readonly span: SpanId;
  /** The tag every instance carries (decision 0150); absent when the prefab has none. */
  readonly tag?: string;
  /** The emitter every instance starts with (decision 0155). */
  readonly particles?: MtekParticles;
  /** The clip every instance plays (decision 0156). */
  readonly clip?: MtekClip;
}

export type MtekBindingTarget =
  | { readonly kind: "transform"; readonly entity: number; readonly field: "position" | "rotation" | "scale" }
  | { readonly kind: "visible"; readonly entity: number }
  | { readonly kind: "param"; readonly instance: number; readonly name: string }
  | {
      readonly kind: "camera";
      /** The camera the binding writes (decision 0154). Absent on older manifests, which bound the active camera. */
      readonly camera?: string;
      readonly field:
        | "position"
        | "target"
        | "rotation"
        | "projection.fov_y"
        | "projection.height"
        | "projection.near"
        | "projection.far";
    }
  | { readonly kind: "light"; readonly entity: number; readonly field: "color" | "intensity" };

export type MtekBindingDependency =
  | { readonly kind: "state"; readonly name: string }
  | { readonly kind: "frame"; readonly name: "time" | "delta" | "index" }
  | {
      readonly kind: "entityField";
      readonly entity: number;
      readonly field: "position" | "rotation" | "scale" | "visible";
    }
  | { readonly kind: "entityState"; readonly entity: number; readonly name: string }
  | { readonly kind: "param"; readonly instance: number; readonly name: string }
  | { readonly kind: "light"; readonly entity: number; readonly field: "color" | "intensity" };

export interface MtekBinding {
  readonly id: number;
  readonly target: MtekBindingTarget;
  readonly deps: readonly MtekBindingDependency[];
  /** Position in the topological evaluation order. */
  readonly order: number;
  readonly span: SpanId;
}

export type MtekHostInputType = "f32" | "i32" | "u32" | "bool" | "vec2" | "vec3" | "vec4" | "color" | "string";
export type MtekHostInputCodec =
  | "f32"
  | "i32"
  | "u32"
  | "bool"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color-hex"
  | "color-hex-opaque"
  | "string";

/** Read-only scene-state export; colors are linear RGBA tuples at the host boundary. */
export interface MtekHostOutput {
  readonly name: string;
  readonly source: { readonly kind: "state"; readonly name: string };
  readonly type: MtekHostInputType;
}

export interface MtekHostInput {
  readonly name: string;
  readonly target: { readonly kind: "state"; readonly name: string };
  readonly type: MtekHostInputType;
  readonly codec: MtekHostInputCodec;
}

/**
 * What a hot reload does with a light field that can change at run time (decision 0067): `initial` applies the
 * source's new literal, `imperative` keeps the value the running scene holds, `bound` is evaluated every frame.
 */
export type MtekLightClass = "initial" | "imperative" | "bound";

export interface MtekLightClasses {
  readonly color: MtekLightClass;
  readonly intensity: MtekLightClass;
}

export type MtekLight =
  | { readonly index: number; readonly entity: number; readonly kind: "directional"; readonly classes: MtekLightClasses }
  | { readonly index: number; readonly entity: number; readonly kind: "point"; readonly range: number; readonly classes: MtekLightClasses };

export interface MtekScene {
  readonly name: string;
  readonly symbol: SymbolId;
  readonly fields: MtekSceneFields;
  readonly state: readonly MtekStateEntry[];
  readonly cameras: readonly MtekCamera[];
  readonly entities: readonly MtekEntity[];
  readonly materialInstances: readonly MtekMaterialInstance[];
  readonly bindings: readonly MtekBinding[];
  readonly hostInputs: readonly MtekHostInput[];
  /** Absent in programs compiled before host outputs were supported. */
  readonly hostOutputs?: readonly MtekHostOutput[];
  readonly lights: readonly MtekLight[];
}

// ---- the manifest ----

/** The `preview` object of an untrusted-preview manifest (decision 0075). */
export interface MtekPreview {
  /** Iterations of CPU loops allowed per frame (and during `init`); at least 1. */
  readonly loopBudget: number;
}

export interface MtekManifest {
  readonly manifestSchema: number;
  readonly runtimeAbi: number;
  readonly languageVersion: string;
  readonly compilerVersion: string;
  /** sha256 of the build identity (spec/runtime-abi.md section 5.3). */
  readonly buildId: string;
  readonly targetProfile: "webgpu-core-2026";
  readonly requiredCapabilities: MtekRequiredCapabilities;
  /**
   * `physicsModule` is `physics/<h16>.js`, relative to the program, and present exactly when `physics` is true
   * (decision 0066): the file name is the hash of the bundle, which the runtime cannot derive.
   */
  readonly subsystems: { readonly physics: boolean; readonly physicsModule?: string };
  readonly runtimeConfig: MtekRuntimeConfig;
  /** Game-level data: the scenes `go_to` can load (decision 0141); absent for a single-scene program. */
  readonly game?: MtekGame;
  /**
   * Present exactly in the manifest of a `--mode preview` build (decision 0075): the program was instrumented with a
   * loop budget the runtime enforces (`E8080`), and the runtime refuses every request outside `baseUrl`.
   */
  readonly preview?: MtekPreview;
  readonly entryScene: string;
  readonly sources: readonly MtekSource[];
  readonly spans: readonly MtekSpan[];
  readonly symbols: readonly MtekSymbol[];
  readonly layouts: readonly MtekLayoutRecord[];
  readonly shaders: readonly MtekShader[];
  readonly materials: readonly MtekMaterial[];
  readonly meshes: readonly MtekMesh[];
  readonly assets: readonly MtekAsset[];
  /** The prefabs the program spawns, by symbol; absent when it spawns none (decision 0064). */
  readonly prefabs?: readonly MtekPrefab[];
  readonly scene: MtekScene;
}
