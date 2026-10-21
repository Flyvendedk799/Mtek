// The names the standard library registry defines, as far as highlighting uses them. They are
// not in `spec/grammar.ebnf` (they are data of the registry, `spec/stdlib.md`), so this table is
// the one place the highlighter keeps by hand. It cannot drift unseen: `builtins.test.ts` runs
// `mtek context` and fails, naming the difference, when a row of the registry is added, removed
// or renamed and this table is not.

export interface Builtins {
  /** Types written in type position and used as constructors (`vec3(...)`, `f32`). */
  readonly types: readonly string[];
  /** Schemas of descriptor literals (`Box { ... }`, `Pbr { ... }`). */
  readonly schemas: readonly string[];
  /** Enums whose members are written `Key.Space`. */
  readonly enums: readonly string[];
  /** Namespaces whose members are written `quat.identity()`, `frame.time`. */
  readonly namespaces: readonly string[];
  /** Global intrinsic functions (`sin`, `spawn`), called without a namespace. */
  readonly functions: readonly string[];
  /** Namespace members that are functions: `quat.axis_angle`. */
  readonly namespaceFunctions: readonly { readonly namespace: string; readonly name: string }[];
  /** Namespace members that are values: `frame.time`. */
  readonly namespaceValues: readonly { readonly namespace: string; readonly name: string }[];
  /** Event names written after `on`. */
  readonly events: readonly string[];
  /** Scene-object kinds that begin a scene member (`camera Main { ... }`). */
  readonly sceneObjects: readonly string[];
}

export const BUILTINS: Builtins = {
  types: [
    "PointerEvent",
    "SurfaceInput",
    "array",
    "bool",
    "color",
    "entity_ref",
    "f32",
    "glb_asset",
    "i32",
    "mat4",
    "material",
    "mesh",
    "quat",
    "sampler",
    "string",
    "texture",
    "u32",
    "vec2",
    "vec3",
    "vec4",
  ],
  schemas: [
    "Box",
    "BoxCollider",
    "Camera",
    "DirectionalLight",
    "Dynamic",
    "Entity",
    "Kinematic",
    "Orthographic",
    "Pbr",
    "Perspective",
    "Plane",
    "PointLight",
    "Scene",
    "Sphere",
    "SphereCollider",
    "Static",
    "Unlit",
  ],
  enums: ["Key"],
  namespaces: ["asset", "color", "frame", "lighting", "mat4", "quat", "sampler", "texture"],
  functions: [
    "abs",
    "acos",
    "alive",
    "asin",
    "atan",
    "atan2",
    "ceil",
    "chance",
    "clamp",
    "clear_saved",
    "cos",
    "cross",
    "degrees",
    "destroy",
    "distance",
    "dot",
    "exp",
    "exp2",
    "floor",
    "fract",
    "go_to",
    "inverse_sqrt",
    "is_key_down",
    "length",
    "load",
    "log",
    "log2",
    "max",
    "min",
    "mix",
    "normalize",
    "pause",
    "paused",
    "pow",
    "print",
    "radians",
    "random",
    "random_int",
    "random_range",
    "reflect",
    "reset",
    "resume",
    "round",
    "sample",
    "saturate",
    "save",
    "sign",
    "sin",
    "smoothstep",
    "spawn",
    "sqrt",
    "step",
    "tan",
    "transpose",
    "trunc",
  ],
  namespaceFunctions: [
    { namespace: "asset", name: "glb" },
    { namespace: "asset", name: "linear_texture" },
    { namespace: "asset", name: "texture" },
    { namespace: "color", name: "linear" },
    { namespace: "color", name: "srgb" },
    { namespace: "lighting", name: "pbr" },
    { namespace: "mat4", name: "columns" },
    { namespace: "mat4", name: "identity" },
    { namespace: "mat4", name: "rotation" },
    { namespace: "mat4", name: "scale" },
    { namespace: "mat4", name: "translation" },
    { namespace: "quat", name: "axis_angle" },
    { namespace: "quat", name: "euler" },
    { namespace: "quat", name: "identity" },
    { namespace: "sampler", name: "linear_clamp" },
    { namespace: "sampler", name: "linear_repeat" },
    { namespace: "sampler", name: "nearest_clamp" },
    { namespace: "sampler", name: "nearest_repeat" },
    { namespace: "texture", name: "black" },
    { namespace: "texture", name: "white" },
  ],
  namespaceValues: [
    { namespace: "frame", name: "delta" },
    { namespace: "frame", name: "index" },
    { namespace: "frame", name: "time" },
  ],
  events: [
    "collision_enter",
    "collision_exit",
    "key_down",
    "key_up",
    "pointer_down",
    "pointer_move",
    "pointer_up",
  ],
  sceneObjects: ["camera"],
};
