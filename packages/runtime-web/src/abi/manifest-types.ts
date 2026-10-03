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
}

export type MtekAsset = MtekMeshDataAsset | MtekImageAsset;

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
}

export interface MtekCamera {
  readonly name: string;
  readonly symbol: SymbolId;
  readonly projection: "perspective" | "orthographic";
  readonly hasTarget: boolean;
  readonly active: boolean;
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

export type MtekBindingTarget =
  | { readonly kind: "transform"; readonly entity: number; readonly field: "position" | "rotation" | "scale" }
  | { readonly kind: "visible"; readonly entity: number }
  | { readonly kind: "param"; readonly instance: number; readonly name: string }
  | {
      readonly kind: "camera";
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
  | { readonly kind: "param"; readonly instance: number; readonly name: string };

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

export interface MtekHostInput {
  readonly name: string;
  readonly target: { readonly kind: "state"; readonly name: string };
  readonly type: MtekHostInputType;
  readonly codec: MtekHostInputCodec;
}

export type MtekLight =
  | { readonly index: number; readonly entity: number; readonly kind: "directional" }
  | { readonly index: number; readonly entity: number; readonly kind: "point"; readonly range: number };

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
  readonly lights: readonly MtekLight[];
}

// ---- the manifest ----

export interface MtekManifest {
  readonly manifestSchema: number;
  readonly runtimeAbi: number;
  readonly languageVersion: string;
  readonly compilerVersion: string;
  /** sha256 of the build identity (spec/runtime-abi.md section 5.3). */
  readonly buildId: string;
  readonly targetProfile: "webgpu-core-2026";
  readonly requiredCapabilities: MtekRequiredCapabilities;
  readonly subsystems: { readonly physics: boolean };
  readonly runtimeConfig: MtekRuntimeConfig;
  readonly entryScene: string;
  readonly sources: readonly MtekSource[];
  readonly spans: readonly MtekSpan[];
  readonly symbols: readonly MtekSymbol[];
  readonly layouts: readonly MtekLayoutRecord[];
  readonly shaders: readonly MtekShader[];
  readonly materials: readonly MtekMaterial[];
  readonly meshes: readonly MtekMesh[];
  readonly assets: readonly MtekAsset[];
  readonly scene: MtekScene;
}
