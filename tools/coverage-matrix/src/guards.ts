// The negative tests of a feature (decision 0004: "each area has a negative fixture for its nearest
// unsupported neighbour"; `spec/testing.md` section 3.2: every diagnostic code has a fail fixture).
//
// A feature has no diagnostic of its own that a tool could derive, so the matrix groups the features
// into *areas* and names the diagnostic codes that guard each area. The grouping is reviewed prose,
// kept here as data and checked three ways: every feature of the matrix belongs to an area, every code
// an area names exists in the catalogue, and every one of those codes has a fixture or a listed
// negative test (`diagnostics.ts`). The reviewer's question for each area is whether its codes are the
// ways a program can misuse the feature; the tool answers whether each of them is tested.

export interface Area {
  id: string;
  title: string;
  /** Exact feature ids, or a prefix ending in `*`. */
  features: readonly string[];
  /** Catalogue codes (`E3001`) that guard the area: the ways a program can misuse its features. */
  codes: readonly string[];
}

export const AREAS: readonly Area[] = [
  {
    id: "modules",
    title: "Modules: imports and exports",
    features: ["imports", "exports", "module/*"],
    codes: ["E2002", "E2030", "E2031", "E2032", "E2033", "E2034", "E2035", "E2036"],
  },
  {
    id: "constants",
    title: "Constants",
    features: ["constants", "body-constants"],
    codes: ["E2020", "E3040", "E3041", "E3090"],
  },
  {
    id: "functions",
    title: "Functions, effects and GPU reachability",
    features: ["functions", "cpu-functions", "expr/call", "fn/*", "local/*", "stmt/return:value", "stmt/return:unit", "expr/builtin-call"],
    codes: ["E3002", "E3080", "E4001", "E4002", "E4010", "E4011", "E4012", "E4013", "W3081", "W4003"],
  },
  {
    id: "statements",
    title: "Statements and assignment",
    features: ["stmt/*", "place/*"],
    codes: ["E1020", "E1030", "E3060", "E3061", "E3070", "E2001"],
  },
  {
    id: "operators",
    title: "Operators",
    features: ["arithmetic", "remainder", "comparison", "equality", "logical", "negation", "op/*"],
    codes: ["E1010", "E1901", "E3010", "E3011", "E3012", "E3014"],
  },
  {
    id: "descriptors",
    title: "Descriptor literals",
    features: ["descriptors"],
    codes: ["E1011", "E3102", "E5001", "E5002", "E5003"],
  },
  {
    id: "structs",
    title: "Structs",
    features: ["structs", "expr/struct-field", "expr/struct-literal"],
    codes: ["E3020", "E3021", "E3022", "E3023"],
  },
  {
    id: "enums",
    title: "Enums and match",
    features: ["enums", "match"],
    codes: ["E2002", "E3201", "E3202", "E3203", "E3204", "E3205", "E3206", "E4011"],
  },
  {
    id: "game-flow",
    title: "Scenes, timers, pause, saves and while",
    features: ["stmt/while", "stmt/timer", "stmt/timer:after", "stmt/timer:every"],
    codes: ["E3210", "E3211", "E5201", "E5202", "E5203", "E5204", "E5210", "E5211", "E5212"],
  },
  {
    id: "arrays",
    title: "Arrays and indexing",
    features: ["arrays", "indexing", "type:array"],
    codes: ["E3030", "E3031", "E3032"],
  },
  {
    id: "types",
    title: "Types, conversions and vectors",
    features: ["type:*", "expr/convert", "expr/swizzle", "expr/component", "expr/vector-construct", "strings"],
    codes: ["E3001", "E3003", "E3013", "E3014", "E3041", "W3050"],
  },
  {
    id: "math",
    title: "Math intrinsics and constructors",
    features: ["function:*", "namespace:*", "value:*", "enum:*"],
    codes: ["E3001", "E3002", "E4012", "E4013", "E3040"],
  },
  {
    id: "materials",
    title: "Materials and the fragment stage",
    features: [
      "materials",
      "schema:Unlit",
      "schema:Pbr",
      "form/*",
      "param-update/*",
      "expr/material-*",
      "project/user-material-shaders",
    ],
    codes: ["E4020", "E4021", "E4030", "E4031", "E4032", "E4040", "E5002", "E5003", "E5100", "W5101", "E6001"],
  },
  {
    id: "textures",
    title: "Textures and samplers",
    features: ["function:texture.*", "function:sampler.*", "function:sample", "namespace:texture", "namespace:sampler", "type:texture", "type:sampler"],
    codes: ["E4041", "E6002", "E5004"],
  },
  {
    id: "assets",
    title: "Static GLB assets and images",
    features: ["function:asset.*", "namespace:asset", "method:*", "type:glb_asset", "project/asset:*"],
    codes: [
      "E7001", "E7002", "E7003", "E7004", "E7005", "E7006", "E7007", "E7008", "E7009", "E7010", "E7011", "E7012", "E7013",
      "E7014", "E7015", "E7016", "E7017", "E7018", "E7019", "E7020", "E7021", "E7022", "E7023", "E7024", "E7025", "E7026",
    ],
  },
  {
    id: "scenes",
    title: "Scenes, cameras and scene objects",
    features: ["scenes", "scene-fields", "scene-objects", "scene-object:*", "schema:Scene", "schema:Camera", "schema:Perspective", "schema:Orthographic", "camera/*"],
    codes: ["E5001", "E5002", "E5003", "E5006", "E5010", "E5011", "E5012", "E5013", "E5014", "E9006"],
  },
  {
    id: "entities",
    title: "Entities, meshes and transforms",
    features: ["entities", "entity-fields", "schema:Entity", "schema:Box", "schema:Sphere", "schema:Plane", "entity/nested", "entity-field/*", "type:mesh"],
    codes: ["E5001", "E5006", "E5020", "E5081", "E5090", "E5092"],
  },
  {
    id: "state-and-events",
    title: "State, lifecycle functions and event handlers",
    features: ["state", "state/*", "handlers", "lifecycle-functions", "behavior/*", "event:*", "expr/state-read:*", "expr/entity-field-read", "expr/camera-field-read", "expr/instance-param-read", "expr/light-field-read"],
    codes: ["E5050", "E5051", "E5052", "E5060", "E5061", "E5073", "E5081"],
  },
  {
    id: "bind",
    title: "Bindings",
    features: ["bind", "binding/*"],
    codes: ["E5004", "E5005", "E5070", "E5072", "E5075"],
  },
  {
    id: "prefabs",
    title: "Prefabs, spawn and destroy",
    features: ["prefabs", "prefab-instances", "prefab/*", "self", "entity/prefab-instance", "expr/prefab-*", "expr/entity-ref", "function:spawn", "function:destroy", "function:alive", "type:entity_ref"],
    codes: ["E5030", "E5040", "E5041", "E5042", "E5074", "E5080", "E5110"],
  },
  {
    id: "tags",
    title: "Tags and tag queries",
    features: ["function:count_tagged", "function:first_tagged", "function:nearest_tagged", "function:has_tag", "function:tagged", "function:destroy_tagged"],
    codes: ["E5220", "E5221", "E5222", "E5223", "E5224"],
  },
  {
    id: "lights",
    title: "Lights",
    features: ["schema:DirectionalLight", "schema:PointLight", "entity/light", "project/lights"],
    codes: ["E5110", "E5111", "E5001"],
  },
  {
    id: "physics",
    title: "Rigid bodies, colliders and body commands",
    features: ["schema:Static", "schema:Dynamic", "schema:Kinematic", "schema:BoxCollider", "schema:SphereCollider", "body-command:*", "body-property:*", "entity/body", "entity/collider", "entity/sensor-collider", "expr/body-target:*", "project/physics-subsystem"],
    codes: ["E5062", "E5071", "E5072", "E5091", "E5120", "E5121", "E5122", "E5123"],
  },
  {
    id: "host-inputs",
    title: "Host inputs",
    features: ["project/host-*"],
    codes: ["E9020", "E9021"],
  },
];

function matches(pattern: string, id: string): boolean {
  return pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

/** The areas a feature belongs to (empty when the matrix has a feature no area accounts for). */
export function areasOf(featureId: string): Area[] {
  return AREAS.filter((area) => area.features.some((pattern) => matches(pattern, featureId)));
}
