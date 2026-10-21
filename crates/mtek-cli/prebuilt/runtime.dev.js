// src/diagnostics/types.ts
var RUNTIME_DIAGNOSTIC_CATALOGUE = {
  E8001: "unsupported platform endianness",
  E8002: "device below target profile",
  E8003: "incompatible program",
  E8004: "WebGPU unavailable",
  E8005: "no suitable adapter",
  E8006: "manifest invalid",
  E8011: "invalid camera value",
  W8030: "index clamped",
  E8030: "named entity cannot be destroyed",
  W8031: "command for pending entity dropped",
  W8032: "entity already destroyed",
  E8033: "entity limit reached",
  E8040: "unknown host input",
  E8041: "host input has wrong type",
  E8050: "uncaptured GPU validation error",
  E8051: "shader or pipeline creation failed",
  W8060: "GPU device lost",
  W8061: "GPU device recovered",
  E8062: "GPU device recovery failed",
  E8063: "GPU allocation failed",
  W8070: "scene restarted on reload",
  E8080: "execution budget exceeded",
  E8090: "invalid scale value",
  E8100: "non-opaque color value",
  E8101: "command not valid for the target's body kind",
  E8102: "physics module failed to load",
  E8103: "non-finite pose produced by the solver",
  E8104: "non-finite value given to a body",
  W8201: "audio value clamped",
  W8202: "sound could not be decoded",
  W8203: "too many HUD items"
}, RUNTIME_ASSET_DIAGNOSTICS = {
  E7030: "asset fetch or integrity failure",
  E7031: "image decode failure"
}, RUNTIME_TITLES = { ...RUNTIME_DIAGNOSTIC_CATALOGUE, ...RUNTIME_ASSET_DIAGNOSTICS };
function severityOf(code) {
  return code.startsWith("W") ? "warning" : "error";
}
function makeRuntimeDiagnostic(code, init) {
  let base = {
    schemaVersion: 1,
    code: `MTEK-${code}`,
    severity: severityOf(code),
    title: RUNTIME_TITLES[code],
    message: init.message,
    source: init.source ?? null
  }, optional = {};
  return init.expected !== void 0 && (optional.expected = init.expected), init.actual !== void 0 && (optional.actual = init.actual), {
    ...base,
    ...optional,
    related: init.related ?? [],
    notes: init.notes ?? [],
    suggestedEdits: [],
    phase: init.phase,
    docs: `spec/diagnostics.md#mtek-${code.toLowerCase()}`
  };
}
var MOUNT_KIND_BY_CODE = {
  E8001: "webgpu-unavailable",
  E8004: "webgpu-unavailable",
  E8005: "adapter-unavailable",
  E8002: "device-failed",
  E8003: "incompatible-program",
  E8006: "manifest-invalid",
  E8051: "shader-failed",
  E7030: "asset-failed",
  E7031: "asset-failed",
  E8063: "allocation-failed",
  E8102: "physics-failed",
  E8080: "budget-exceeded"
};
function mountErrorKindForCode(code) {
  return Object.hasOwn(MOUNT_KIND_BY_CODE, code) ? MOUNT_KIND_BY_CODE[code] : void 0;
}
var MtekMountError = class extends Error {
  kind;
  diagnostics;
  constructor(kind, diagnostics) {
    let first = diagnostics[0];
    super(first === void 0 ? `Mounting failed (${kind}).` : `${first.code}: ${first.message}`), this.name = "MtekMountError", this.kind = kind, this.diagnostics = Object.freeze([...diagnostics]);
  }
};

// src/abi/constants.ts
var SUPPORTED_MANIFEST_SCHEMA = 1, SUPPORTED_RUNTIME_ABI = 1, SUPPORTED_LANGUAGE_VERSION = "0.1";

// src/abi/compatibility.ts
function isRecord(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value);
}
function describe(value) {
  return typeof value == "string" ? JSON.stringify(value) : String(value);
}
function checkCompatibility(manifest) {
  if (!isRecord(manifest))
    return [{ code: "E8006", field: "manifest", message: "The manifest must be a JSON object." }];
  let incompatible2 = [], invalid = [], integerFields = [
    ["manifestSchema", 1],
    ["runtimeAbi", 1]
  ];
  for (let [field, supported] of integerFields) {
    let value = manifest[field];
    value === void 0 ? invalid.push({ code: "E8006", field, message: `The manifest has no \`${field}\`.` }) : typeof value != "number" || !Number.isInteger(value) ? invalid.push({ code: "E8006", field, message: `\`${field}\` must be an integer, found ${describe(value)}.` }) : value !== supported && incompatible2.push({
      code: "E8003",
      field,
      message: `Incompatible program: \`${field}\` is ${String(value)}, this runtime implements ${String(supported)}.`
    });
  }
  let languageVersion = manifest.languageVersion;
  return languageVersion === void 0 ? invalid.push({ code: "E8006", field: "languageVersion", message: "The manifest has no `languageVersion`." }) : typeof languageVersion != "string" ? invalid.push({
    code: "E8006",
    field: "languageVersion",
    message: `\`languageVersion\` must be a string, found ${describe(languageVersion)}.`
  }) : languageVersion !== "0.1" && incompatible2.push({
    code: "E8003",
    field: "languageVersion",
    message: `Incompatible program: \`languageVersion\` is ${JSON.stringify(languageVersion)}, this runtime supports ${JSON.stringify("0.1")}.`
  }), [...incompatible2, ...invalid];
}
function checkDeviceCapabilities(required, device) {
  let failures = [];
  required.features.forEach((name, index) => {
    device.hasFeature(name) || failures.push({
      code: "E8002",
      field: `requiredCapabilities.features[${String(index)}]`,
      message: `The device does not support the required WebGPU feature \`${name}\`.`
    });
  }), required.wgslLanguageFeatures.forEach((name, index) => {
    device.hasWgslLanguageFeature(name) || failures.push({
      code: "E8002",
      field: `requiredCapabilities.wgslLanguageFeatures[${String(index)}]`,
      message: `The device does not support the required WGSL language feature \`${name}\`.`
    });
  });
  for (let [name, needed] of Object.entries(required.limits)) {
    let field = `requiredCapabilities.limits.${name}`, actual = device.limit(name);
    actual === void 0 ? failures.push({ code: "E8002", field, message: `The device does not report the limit \`${name}\`.` }) : (name.startsWith("min") ? actual > needed : actual < needed) && failures.push({
      code: "E8002",
      field,
      message: `The device limit \`${name}\` is ${String(actual)}, the program needs ${name.startsWith("min") ? "at most" : "at least"} ${String(needed)}.`
    });
  }
  return failures;
}

// src/abi/generated/validate-manifest.js
var validate_manifest_default = validate20, schema31 = { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:mtek:schema:program-manifest:1", title: "Mtek program manifest (schema version 1, runtime ABI 1)", description: "Machine-checked definition of program.manifest.json (spec/runtime-abi.md section 5). Written by the compiler, validated by the runtime. manifestSchema and runtimeAbi are plain integers and languageVersion a plain string (never const) so that the compatibility check of section 5.1 can run before full validation. Objects are closed (additionalProperties false) except the open map requiredCapabilities.limits, whose keys are constrained by a name pattern and whose values by type.", type: "object", additionalProperties: !1, required: ["manifestSchema", "runtimeAbi", "languageVersion", "compilerVersion", "buildId", "targetProfile", "requiredCapabilities", "subsystems", "runtimeConfig", "entryScene", "sources", "spans", "symbols", "layouts", "shaders", "materials", "meshes", "assets", "scene"], properties: { manifestSchema: { type: "integer", description: "Schema version; this schema describes version 1." }, runtimeAbi: { type: "integer", description: "Runtime ABI version; this schema describes ABI 1." }, languageVersion: { type: "string", description: 'Mtek language version the program was compiled for ("0.1").' }, compilerVersion: { type: "string", minLength: 1 }, buildId: { $ref: "#/$defs/sha256", description: "sha256 of the build identity (section 5.3)." }, targetProfile: { type: "string", enum: ["webgpu-core-2026"] }, requiredCapabilities: { $ref: "#/$defs/requiredCapabilities" }, subsystems: { type: "object", additionalProperties: !1, required: ["physics"], properties: { physics: { type: "boolean" }, physicsModule: { type: "string", pattern: "^physics/[0-9a-f]{16}\\.js$", description: "The content-addressed physics bundle, relative to the program (decision 0066); present exactly when physics is true." } }, if: { properties: { physics: { const: !0 }, physicsModule: {} }, required: ["physics"], additionalProperties: !1 }, then: { properties: { physics: {}, physicsModule: {} }, required: ["physicsModule"], additionalProperties: !1 }, else: { properties: { physics: {}, physicsModule: !1 }, additionalProperties: !1 } }, runtimeConfig: { $ref: "#/$defs/runtimeConfig" }, preview: { type: "object", description: "Present exactly in the manifest of a `--mode preview` build (decision 0075): the runtime enforces the loop budget the program was instrumented with and refuses any request outside baseUrl.", additionalProperties: !1, required: ["loopBudget"], properties: { loopBudget: { type: "integer", minimum: 1, maximum: 4294967295, description: "Iterations of CPU loops allowed per frame (and during init)." } } }, entryScene: { type: "string", minLength: 1 }, sources: { type: "array", items: { $ref: "#/$defs/source" } }, spans: { type: "array", items: { $ref: "#/$defs/span" } }, symbols: { type: "array", items: { $ref: "#/$defs/symbol" } }, layouts: { type: "array", items: { $ref: "#/$defs/layout" } }, shaders: { type: "array", items: { $ref: "#/$defs/shader" } }, materials: { type: "array", items: { $ref: "#/$defs/material" } }, meshes: { type: "array", items: { $ref: "#/$defs/mesh" } }, assets: { type: "array", items: { $ref: "#/$defs/asset" } }, prefabs: { type: "array", description: "The prefabs the program spawns, sorted by symbol (decision 0064). Absent when it spawns none.", items: { $ref: "#/$defs/prefab" } }, scene: { $ref: "#/$defs/scene" } }, $defs: { sha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Full SHA-256, 64 lowercase hex digits." }, index: { type: "integer", minimum: 0 }, spanId: { type: "integer", minimum: 0, description: "Index into the manifest spans table." }, name: { type: "string", minLength: 1 }, wgslIdentifier: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, mtekTypeName: { type: "string", minLength: 1, description: "An Mtek type as written in source (f32, vec3, color, array<f32, 3>, a struct name, ...)." }, symbolId: { type: "string", minLength: 1, description: "normalised module path :: qualified declaration name" }, vec2: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, vec3: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }, vec4: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 }, webgpuFeatureNames: { type: "array", description: "GPUFeatureName strings (kebab-case, e.g. timestamp-query).", items: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" }, uniqueItems: !0 }, wgslLanguageFeatureNames: { type: "array", description: "WGSL language extension names (snake_case, e.g. readonly_and_readwrite_storage_textures).", items: { type: "string", pattern: "^[a-z0-9][a-z0-9_]*$" }, uniqueItems: !0 }, requiredCapabilities: { type: "object", additionalProperties: !1, required: ["features", "limits", "wgslLanguageFeatures"], properties: { features: { $ref: "#/$defs/webgpuFeatureNames", description: "Optional WebGPU features the program needs (none in v0.1)." }, limits: { type: "object", description: "Only limits above the WebGPU defaults, name -> required value ({} in profile webgpu-core-2026).", propertyNames: { pattern: "^(max|min)[A-Z][A-Za-z0-9]*$" }, additionalProperties: { type: "integer", minimum: 0 } }, wgslLanguageFeatures: { $ref: "#/$defs/wgslLanguageFeatureNames" } } }, runtimeConfig: { type: "object", additionalProperties: !1, required: ["fixedStep", "maxCatchUpSteps", "maxFrameDelta", "maxEntities", "pauseWhenHidden"], properties: { fixedStep: { type: "number", exclusiveMinimum: 0 }, maxCatchUpSteps: { type: "integer", minimum: 1 }, maxFrameDelta: { type: "number", exclusiveMinimum: 0 }, maxEntities: { type: "integer", minimum: 1 }, pauseWhenHidden: { type: "boolean" } } }, source: { type: "object", additionalProperties: !1, required: ["id", "path", "sha256"], properties: { id: { $ref: "#/$defs/index" }, path: { $ref: "#/$defs/name" }, sha256: { $ref: "#/$defs/sha256" } } }, span: { type: "object", additionalProperties: !1, description: "A source range: half-open byte offsets into the file as stored on disk, and the 1-based line and column of both ends (columns count Unicode scalar values), computed by the compiler (decision 0019).", required: ["file", "start", "end", "startLine", "startColumn", "endLine", "endColumn"], properties: { file: { $ref: "#/$defs/index", description: "Source id." }, start: { $ref: "#/$defs/index", description: "Byte offset, inclusive." }, end: { $ref: "#/$defs/index", description: "Byte offset, exclusive." }, startLine: { type: "integer", minimum: 1, description: "Line of start, 1-based." }, startColumn: { type: "integer", minimum: 1, description: "Column of start, 1-based, in Unicode scalar values." }, endLine: { type: "integer", minimum: 1, description: "Line of end, 1-based." }, endColumn: { type: "integer", minimum: 1, description: "Column of end, 1-based, in Unicode scalar values." } } }, symbol: { type: "object", additionalProperties: !1, required: ["id", "kind", "span"], properties: { id: { $ref: "#/$defs/symbolId" }, kind: { type: "string", enum: ["scene", "camera", "entity", "state", "material", "param", "prefab", "function"] }, span: { $ref: "#/$defs/spanId" } } }, layout: { type: "object", description: "Layout record of spec/gpu-layout.md section 5.", additionalProperties: !1, required: ["id", "wgslStruct", "size", "align", "root"], properties: { id: { type: "string", pattern: "^(builtin:[a-z]+|material:.+::.+|fixture:.+)$" }, wgslStruct: { $ref: "#/$defs/wgslIdentifier" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, root: { $ref: "#/$defs/layoutStructNode" } } }, layoutNode: { type: "object", oneOf: [{ $ref: "#/$defs/layoutScalarNode" }, { $ref: "#/$defs/layoutVectorNode" }, { $ref: "#/$defs/layoutMatrixNode" }, { $ref: "#/$defs/layoutStructNode" }, { $ref: "#/$defs/layoutArrayNode" }], discriminator: { propertyName: "kind" } }, layoutScalarNode: { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "scalar"], properties: { kind: { const: "scalar" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, scalar: { type: "string", enum: ["f32", "i32", "u32", "bool32"] } } }, layoutVectorNode: { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "scalar", "components"], properties: { kind: { const: "vector" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, scalar: { type: "string", enum: ["f32"] }, components: { type: "integer", minimum: 2, maximum: 4 } } }, layoutMatrixNode: { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "columns", "rows", "columnStride"], properties: { kind: { const: "matrix" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, columns: { type: "integer", enum: [4] }, rows: { type: "integer", enum: [4] }, columnStride: { type: "integer", enum: [16] } } }, layoutStructNode: { type: "object", description: "name is omitted on the root of a block and present on nested struct nodes. Member offsets are absolute within the block.", additionalProperties: !1, required: ["kind", "offset", "size", "align", "members"], properties: { kind: { const: "struct" }, name: { $ref: "#/$defs/name" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, members: { type: "array", items: { $ref: "#/$defs/layoutMember" } } } }, layoutArrayNode: { type: "object", description: "element is a node whose offsets are relative to the element start.", additionalProperties: !1, required: ["kind", "offset", "size", "align", "length", "stride", "padded", "element"], properties: { kind: { const: "array" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, length: { type: "integer", minimum: 1 }, stride: { type: "integer", minimum: 1 }, padded: { type: "boolean" }, element: { $ref: "#/$defs/layoutNode" } } }, layoutMember: { type: "object", additionalProperties: !1, required: ["name", "mtekType", "node"], properties: { name: { $ref: "#/$defs/name" }, mtekType: { $ref: "#/$defs/mtekTypeName" }, node: { $ref: "#/$defs/layoutNode" } } }, shader: { type: "object", additionalProperties: !1, required: ["hash", "url", "map", "material", "vertexEntry", "fragmentEntry", "vertexAttributes", "surfaceInputs"], properties: { hash: { $ref: "#/$defs/sha256" }, url: { type: "string", pattern: "^shaders/[0-9a-f]{16}\\.wgsl$" }, map: { type: "string", pattern: "^shaders/[0-9a-f]{16}\\.mtek-map\\.json$" }, material: { $ref: "#/$defs/symbolId", description: "Id of the material this shader was generated for." }, vertexEntry: { $ref: "#/$defs/wgslIdentifier" }, instancedVertexEntry: { $ref: "#/$defs/wgslIdentifier", description: "The vertex entry that reads the model and normal matrices from a per-instance vertex buffer (spec/runtime-abi.md section 8.4, decision 0059). Absent: the runtime draws every entity individually." }, fragmentEntry: { $ref: "#/$defs/wgslIdentifier" }, vertexAttributes: { type: "array", description: "Present vertex attributes in vertex-buffer slot order (spec/materials.md section 3.3).", items: { type: "string", enum: ["position", "normal", "uv"] }, uniqueItems: !0 }, surfaceInputs: { type: "array", description: "SurfaceInput fields the fragment stage reads.", items: { type: "string", enum: ["local_position", "world_position", "world_normal", "uv"] }, uniqueItems: !0 } } }, material: { type: "object", additionalProperties: !1, required: ["id", "layout", "shader", "resources", "params"], properties: { id: { $ref: "#/$defs/symbolId" }, layout: { type: ["string", "null"], minLength: 1, description: "Layout id of the parameter block; null when the material has no value params (bind group 1 binding 0 is then absent)." }, shader: { $ref: "#/$defs/sha256", description: "Hash of the material's shader." }, resources: { type: "array", items: { $ref: "#/$defs/materialResource" } }, params: { type: "array", items: { $ref: "#/$defs/materialParam" } } } }, materialResource: { type: "object", description: "One texture or sampler binding in bind group 1, in param declaration order.", additionalProperties: !1, required: ["name", "kind", "binding"], properties: { name: { $ref: "#/$defs/name" }, kind: { type: "string", enum: ["texture", "sampler"] }, binding: { type: "integer", minimum: 1 } } }, materialParam: { type: "object", additionalProperties: !1, required: ["name", "type", "span"], properties: { name: { $ref: "#/$defs/name" }, type: { $ref: "#/$defs/mtekTypeName" }, span: { $ref: "#/$defs/spanId" } } }, mesh: { type: "object", oneOf: [{ $ref: "#/$defs/boxMesh" }, { $ref: "#/$defs/sphereMesh" }, { $ref: "#/$defs/planeMesh" }, { $ref: "#/$defs/assetMesh" }], discriminator: { propertyName: "kind" } }, meshId: { type: "string", pattern: "^mesh:[0-9]+$" }, boxMesh: { type: "object", additionalProperties: !1, required: ["id", "kind", "size"], properties: { id: { $ref: "#/$defs/meshId" }, kind: { const: "box" }, size: { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 3, maxItems: 3 } } }, sphereMesh: { type: "object", additionalProperties: !1, required: ["id", "kind", "radius", "segments", "rings"], properties: { id: { $ref: "#/$defs/meshId" }, kind: { const: "sphere" }, radius: { type: "number", exclusiveMinimum: 0 }, segments: { type: "integer", minimum: 3, maximum: 256 }, rings: { type: "integer", minimum: 2, maximum: 256 } } }, planeMesh: { type: "object", additionalProperties: !1, required: ["id", "kind", "size"], properties: { id: { $ref: "#/$defs/meshId" }, kind: { const: "plane" }, size: { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 2, maxItems: 2 } } }, assetMesh: { type: "object", additionalProperties: !1, required: ["id", "kind", "asset", "primitive"], properties: { id: { $ref: "#/$defs/meshId" }, kind: { const: "asset" }, asset: { $ref: "#/$defs/assetUrl", description: "Url of a mesh-data entry of the assets table." }, primitive: { $ref: "#/$defs/index", description: "Index into that entry's primitives." } } }, assetUrl: { type: "string", pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, asset: { type: "object", oneOf: [{ $ref: "#/$defs/meshDataAsset" }, { $ref: "#/$defs/imageAsset" }, { $ref: "#/$defs/audioAsset" }], discriminator: { propertyName: "kind" } }, meshDataAsset: { type: "object", additionalProperties: !1, required: ["url", "sha256", "bytes", "kind", "primitives", "preprocessing", "span"], properties: { url: { $ref: "#/$defs/assetUrl" }, sha256: { $ref: "#/$defs/sha256" }, bytes: { $ref: "#/$defs/index", description: "Byte length of the file." }, kind: { const: "mesh-data" }, primitives: { type: "array", items: { $ref: "#/$defs/meshPrimitive" } }, preprocessing: { $ref: "#/$defs/preprocessing" }, span: { $ref: "#/$defs/spanId", description: "Declaring span, used to map load failures (E7030) to source." } } }, imageAsset: { type: "object", additionalProperties: !1, required: ["url", "sha256", "bytes", "kind", "colorSpace", "preprocessing", "span"], properties: { url: { $ref: "#/$defs/assetUrl" }, sha256: { $ref: "#/$defs/sha256" }, bytes: { $ref: "#/$defs/index" }, kind: { const: "image" }, colorSpace: { type: "string", enum: ["srgb", "linear"] }, preprocessing: { $ref: "#/$defs/preprocessing" }, span: { $ref: "#/$defs/spanId" }, source: { type: "string", minLength: 1, description: `The author's file (decision 0082): the project path of a standalone image, or "<glb path>#images[N]" for an image embedded in a GLB. Optional; shown by the runtime when the image fails.` } } }, audioAsset: { type: "object", description: "A sound file declared with asset.sound(..), copied byte for byte (spec/audio.md section 4, decision 0130).", additionalProperties: !1, required: ["url", "sha256", "bytes", "kind", "format", "mime", "source", "span"], properties: { url: { $ref: "#/$defs/assetUrl" }, sha256: { $ref: "#/$defs/sha256" }, bytes: { $ref: "#/$defs/index" }, kind: { const: "audio" }, format: { type: "string", enum: ["wav", "ogg", "mp3"] }, mime: { type: "string", enum: ["audio/wav", "audio/ogg", "audio/mpeg"] }, source: { type: "string", minLength: 1, description: "The project path of the declaring asset.sound(..); generated code names the sound by it." }, span: { $ref: "#/$defs/spanId" } } }, preprocessing: { type: "array", description: 'Recorded preprocessing decisions, e.g. "u8 indices widened to u16".', items: { type: "string", minLength: 1 } }, meshPrimitive: { type: "object", description: "One primitive inside a packaged .bin (spec/assets.md section 4). Offsets are byte offsets into the file.", additionalProperties: !1, required: ["source", "vertexCount", "indexCount", "indexFormat", "attributes", "offsets", "boundingSphere"], properties: { source: { type: "object", additionalProperties: !1, required: ["file", "mesh", "primitive"], properties: { file: { $ref: "#/$defs/name" }, mesh: { $ref: "#/$defs/name" }, primitive: { $ref: "#/$defs/index" } } }, vertexCount: { type: "integer", minimum: 1 }, indexCount: { type: "integer", minimum: 1 }, indexFormat: { type: "string", enum: ["uint16", "uint32"] }, attributes: { type: "array", items: { type: "string", enum: ["position", "normal", "uv"] }, uniqueItems: !0 }, offsets: { type: "object", additionalProperties: !1, required: ["position", "indices"], properties: { position: { $ref: "#/$defs/index" }, normal: { $ref: "#/$defs/index" }, uv: { $ref: "#/$defs/index" }, indices: { $ref: "#/$defs/index" } } }, boundingSphere: { type: "object", additionalProperties: !1, required: ["center", "radius"], properties: { center: { $ref: "#/$defs/vec3" }, radius: { type: "number", minimum: 0 } } } } }, scene: { type: "object", description: "Scene structure (spec/runtime-abi.md section 5.2).", additionalProperties: !1, required: ["name", "symbol", "fields", "state", "cameras", "entities", "materialInstances", "bindings", "hostInputs", "lights"], properties: { name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, fields: { type: "object", description: "Constant scene field values; linear colours as [r, g, b, a].", additionalProperties: !1, required: ["clearColor", "ambientColor", "ambientIntensity", "gravity"], properties: { clearColor: { $ref: "#/$defs/vec4" }, ambientColor: { $ref: "#/$defs/vec4" }, ambientIntensity: { type: "number", minimum: 0 }, gravity: { $ref: "#/$defs/vec3" } } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, cameras: { type: "array", items: { $ref: "#/$defs/camera" } }, entities: { type: "array", items: { $ref: "#/$defs/entity" } }, materialInstances: { type: "array", items: { $ref: "#/$defs/materialInstance" } }, bindings: { type: "array", items: { $ref: "#/$defs/binding" } }, hostInputs: { type: "array", items: { $ref: "#/$defs/hostInput" } }, hostOutputs: { type: "array", items: { $ref: "#/$defs/hostOutput" } }, lights: { type: "array", items: { $ref: "#/$defs/light" } } } }, stateEntry: { type: "object", additionalProperties: !1, required: ["name", "type", "symbol"], properties: { name: { $ref: "#/$defs/name" }, type: { $ref: "#/$defs/mtekTypeName" }, symbol: { $ref: "#/$defs/symbolId" } } }, camera: { type: "object", additionalProperties: !1, required: ["name", "symbol", "projection", "hasTarget", "active", "exposure"], properties: { name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, projection: { type: "string", enum: ["perspective", "orthographic"] }, hasTarget: { type: "boolean" }, active: { type: "boolean" }, exposure: { type: "number", description: "EV100 of the camera (decision 0081); lit materials are scaled by 1 / (1.2 * 2^exposure)." } } }, entity: { type: "object", additionalProperties: !1, required: ["index", "name", "symbol", "parent", "mesh", "material", "light", "body", "collider", "state", "update", "fixedUpdate"], properties: { index: { $ref: "#/$defs/index", description: "Static entity index in stable instance order (depth-first pre-order)." }, name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, parent: { type: ["integer", "null"], minimum: 0, description: "Index of the parent entity, or null for a root." }, mesh: { type: ["string", "null"], pattern: "^mesh:[0-9]+$", description: "Id of an entry of the meshes table, or null." }, material: { type: ["object", "null"], additionalProperties: !1, required: ["id", "instance"], properties: { id: { $ref: "#/$defs/symbolId" }, instance: { $ref: "#/$defs/index", description: "Index into scene.materialInstances." } } }, light: { type: ["integer", "null"], minimum: 0, description: "Index into scene.lights, or null." }, body: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/body" } }, collider: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/collider" } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, update: { type: "boolean", description: "The entity declares update(dt)." }, fixedUpdate: { type: "boolean", description: "The entity declares fixed_update(dt)." } } }, body: { type: "object", oneOf: [{ $ref: "#/$defs/staticBody" }, { $ref: "#/$defs/dynamicBody" }, { $ref: "#/$defs/kinematicBody" }], discriminator: { propertyName: "kind" } }, staticBody: { type: "object", additionalProperties: !1, required: ["kind"], properties: { kind: { const: "static" } } }, kinematicBody: { type: "object", additionalProperties: !1, required: ["kind"], properties: { kind: { const: "kinematic" } } }, dynamicBody: { type: "object", additionalProperties: !1, required: ["kind", "mass", "linearDamping", "angularDamping"], properties: { kind: { const: "dynamic" }, mass: { type: "number", exclusiveMinimum: 0 }, linearDamping: { type: "number", minimum: 0 }, angularDamping: { type: "number", minimum: 0 } } }, collider: { type: "object", oneOf: [{ $ref: "#/$defs/boxCollider" }, { $ref: "#/$defs/sphereCollider" }], discriminator: { propertyName: "kind" } }, boxCollider: { type: "object", additionalProperties: !1, required: ["kind", "size", "sensor", "friction", "restitution"], properties: { kind: { const: "box" }, size: { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 3, maxItems: 3 }, sensor: { type: "boolean" }, friction: { type: "number", minimum: 0 }, restitution: { type: "number", minimum: 0, maximum: 1 } } }, sphereCollider: { type: "object", additionalProperties: !1, required: ["kind", "radius", "sensor", "friction", "restitution"], properties: { kind: { const: "sphere" }, radius: { type: "number", exclusiveMinimum: 0 }, sensor: { type: "boolean" }, friction: { type: "number", minimum: 0 }, restitution: { type: "number", minimum: 0, maximum: 1 } } }, light: { type: "object", oneOf: [{ $ref: "#/$defs/directionalLight" }, { $ref: "#/$defs/pointLight" }], discriminator: { propertyName: "kind" } }, directionalLight: { type: "object", additionalProperties: !1, required: ["index", "entity", "kind", "classes"], properties: { index: { $ref: "#/$defs/index" }, entity: { $ref: "#/$defs/index" }, kind: { const: "directional" }, classes: { $ref: "#/$defs/lightClasses" } } }, pointLight: { type: "object", additionalProperties: !1, required: ["index", "entity", "kind", "range", "classes"], properties: { index: { $ref: "#/$defs/index" }, entity: { $ref: "#/$defs/index" }, kind: { const: "point" }, range: { type: "number", minimum: 0, description: "0 = unlimited." }, classes: { $ref: "#/$defs/lightClasses" } } }, lightClasses: { type: "object", description: "The update class of each light field that can change at run time (decision 0067): `initial` = a constant the source's literal sets (a reload applies the new literal), `imperative` = written by a handler (a reload keeps the value it holds), `bound` = the value of a binding (evaluated every frame).", additionalProperties: !1, required: ["color", "intensity"], properties: { color: { type: "string", enum: ["initial", "imperative", "bound"] }, intensity: { type: "string", enum: ["initial", "imperative", "bound"] } } }, prefab: { type: "object", description: "A prefab the program spawns (spec/runtime-abi.md section 5.6, decision 0064). In its bindings entity 0 is the instance and material instance 0 is its material.", additionalProperties: !1, required: ["symbol", "name", "params", "mesh", "material", "body", "collider", "state", "update", "fixedUpdate", "bindings", "span"], properties: { symbol: { $ref: "#/$defs/symbolId", description: "The key of the prefabs table of app.js." }, name: { $ref: "#/$defs/name" }, params: { type: "array", description: "The params in declaration order: the keys of the params object that spawn passes.", items: { type: "object", additionalProperties: !1, required: ["name", "type"], properties: { name: { $ref: "#/$defs/name" }, type: { $ref: "#/$defs/mtekTypeName" } } } }, mesh: { type: ["string", "null"], pattern: "^mesh:[0-9]+$", description: "Id of an entry of the meshes table, or null." }, material: { type: ["object", "null"], description: "The material instance every instance of the prefab starts with.", additionalProperties: !1, required: ["id", "params", "shareable"], properties: { id: { $ref: "#/$defs/symbolId" }, params: { type: "array", items: { $ref: "#/$defs/instanceParam" } }, shareable: { type: "boolean", description: "Every param is initial or a resource: instances with identical bytes may share one parameter block." } } }, body: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/body" } }, collider: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/collider" } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, update: { type: "boolean", description: "The prefab declares update(dt)." }, fixedUpdate: { type: "boolean", description: "The prefab declares fixed_update(dt)." }, bindings: { type: "array", items: { $ref: "#/$defs/binding" } }, span: { $ref: "#/$defs/spanId", description: "The declaration." } } }, materialInstance: { type: "object", additionalProperties: !1, required: ["index", "material", "entity", "params", "shareable"], properties: { index: { $ref: "#/$defs/index" }, material: { $ref: "#/$defs/symbolId" }, entity: { $ref: "#/$defs/index" }, params: { type: "array", items: { $ref: "#/$defs/instanceParam" } }, shareable: { type: "boolean" } } }, instanceParam: { type: "object", oneOf: [{ $ref: "#/$defs/initialParam" }, { $ref: "#/$defs/imperativeParam" }, { $ref: "#/$defs/boundParam" }, { $ref: "#/$defs/resourceParam" }], discriminator: { propertyName: "class" } }, initialParam: { type: "object", additionalProperties: !1, required: ["name", "class"], properties: { name: { $ref: "#/$defs/name" }, class: { const: "initial" } } }, imperativeParam: { type: "object", additionalProperties: !1, required: ["name", "class"], properties: { name: { $ref: "#/$defs/name" }, class: { const: "imperative" } } }, boundParam: { type: "object", additionalProperties: !1, required: ["name", "class", "binding"], properties: { name: { $ref: "#/$defs/name" }, class: { const: "bound" }, binding: { $ref: "#/$defs/index", description: "Id of the binding that writes this param." } } }, resourceParam: { type: "object", additionalProperties: !1, required: ["name", "class", "value"], properties: { name: { $ref: "#/$defs/name" }, class: { const: "resource" }, value: { $ref: "#/$defs/resourceValue" } } }, resourceValue: { type: "object", oneOf: [{ $ref: "#/$defs/builtinResourceValue" }, { $ref: "#/$defs/assetResourceValue" }], discriminator: { propertyName: "kind" } }, builtinResourceValue: { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "builtin" }, name: { type: "string", enum: ["texture.white", "texture.black", "sampler.linear_repeat", "sampler.linear_clamp", "sampler.nearest_repeat", "sampler.nearest_clamp"] } } }, assetResourceValue: { type: "object", additionalProperties: !1, required: ["kind", "asset"], properties: { kind: { const: "asset" }, asset: { $ref: "#/$defs/assetUrl", description: "Url of an image entry of the assets table." } } }, binding: { type: "object", additionalProperties: !1, required: ["id", "target", "deps", "order", "span"], properties: { id: { $ref: "#/$defs/index" }, target: { $ref: "#/$defs/bindingTarget" }, deps: { type: "array", items: { $ref: "#/$defs/bindingDep" } }, order: { $ref: "#/$defs/index", description: "Position in the topological evaluation order." }, span: { $ref: "#/$defs/spanId" } } }, bindingTarget: { type: "object", oneOf: [{ $ref: "#/$defs/transformTarget" }, { $ref: "#/$defs/visibleTarget" }, { $ref: "#/$defs/paramTarget" }, { $ref: "#/$defs/cameraTarget" }, { $ref: "#/$defs/lightTarget" }], discriminator: { propertyName: "kind" } }, transformTarget: { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "transform" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["position", "rotation", "scale"] } } }, visibleTarget: { type: "object", additionalProperties: !1, required: ["kind", "entity"], properties: { kind: { const: "visible" }, entity: { $ref: "#/$defs/index" } } }, paramTarget: { type: "object", additionalProperties: !1, required: ["kind", "instance", "name"], properties: { kind: { const: "param" }, instance: { $ref: "#/$defs/index" }, name: { $ref: "#/$defs/name" } } }, cameraTarget: { type: "object", additionalProperties: !1, required: ["kind", "field"], properties: { kind: { const: "camera" }, field: { type: "string", enum: ["position", "target", "rotation", "projection.fov_y", "projection.height", "projection.near", "projection.far"] } } }, lightTarget: { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "light" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["color", "intensity"] } } }, bindingDep: { type: "object", oneOf: [{ $ref: "#/$defs/stateDep" }, { $ref: "#/$defs/frameDep" }, { $ref: "#/$defs/entityFieldDep" }, { $ref: "#/$defs/entityStateDep" }, { $ref: "#/$defs/paramDep" }, { $ref: "#/$defs/lightDep" }], discriminator: { propertyName: "kind" } }, stateDep: { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "state" }, name: { $ref: "#/$defs/name" } } }, frameDep: { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "frame" }, name: { type: "string", enum: ["time", "delta", "index"] } } }, entityFieldDep: { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "entityField" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["position", "rotation", "scale", "visible"] } } }, entityStateDep: { type: "object", additionalProperties: !1, required: ["kind", "entity", "name"], properties: { kind: { const: "entityState" }, entity: { $ref: "#/$defs/index" }, name: { $ref: "#/$defs/name" } } }, paramDep: { type: "object", additionalProperties: !1, required: ["kind", "instance", "name"], properties: { kind: { const: "param" }, instance: { $ref: "#/$defs/index" }, name: { $ref: "#/$defs/name" } } }, lightDep: { type: "object", description: "A read of the colour or intensity of the light of an entity (decision 0067); `range` is fixed at construction and is not a dependency.", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "light" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["color", "intensity"] } } }, hostOutput: { type: "object", additionalProperties: !1, required: ["name", "source", "type"], properties: { name: { $ref: "#/$defs/name" }, source: { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "state" }, name: { $ref: "#/$defs/name" } } }, type: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color", "string"] } } }, hostInput: { type: "object", additionalProperties: !1, required: ["name", "target", "type", "codec"], properties: { name: { $ref: "#/$defs/name" }, target: { type: "object", description: "Only scene state can be exposed as a host input.", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "state" }, name: { $ref: "#/$defs/name" } } }, type: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color", "string"] }, codec: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color-hex", "color-hex-opaque", "string"] } } } } };
var func1 = Object.prototype.hasOwnProperty, pattern4 = new RegExp("^[0-9a-f]{64}$", "u"), pattern8 = new RegExp("^physics/[0-9a-f]{16}\\.js$", "u");
var pattern5 = new RegExp("^[a-z0-9][a-z0-9-]*$", "u"), pattern6 = new RegExp("^(max|min)[A-Z][A-Za-z0-9]*$", "u"), pattern7 = new RegExp("^[a-z0-9][a-z0-9_]*$", "u");
function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.features === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "features" }, message: "must have required property 'features'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.limits === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "limits" }, message: "must have required property 'limits'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.wgslLanguageFeatures === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "wgslLanguageFeatures" }, message: "must have required property 'wgslLanguageFeatures'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "features" || key0 === "limits" || key0 === "wgslLanguageFeatures")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.features !== void 0) {
      let data0 = data.features;
      if (Array.isArray(data0)) {
        let len0 = data0.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data1 = data0[i0];
          if (typeof data1 == "string") {
            if (!pattern5.test(data1)) {
              let err4 = { instancePath: instancePath + "/features/" + i0, schemaPath: "#/$defs/webgpuFeatureNames/items/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9-]*$" }, message: 'must match pattern "^[a-z0-9][a-z0-9-]*$"' };
              vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
            }
          } else {
            let err5 = { instancePath: instancePath + "/features/" + i0, schemaPath: "#/$defs/webgpuFeatureNames/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
          }
        }
        let i1 = data0.length, j0;
        if (i1 > 1) {
          let indices0 = {};
          for (; i1--; ) {
            let item0 = data0[i1];
            if (typeof item0 == "string") {
              if (typeof indices0[item0] == "number") {
                j0 = indices0[item0];
                let err6 = { instancePath: instancePath + "/features", schemaPath: "#/$defs/webgpuFeatureNames/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
                break;
              }
              indices0[item0] = i1;
            }
          }
        }
      } else {
        let err7 = { instancePath: instancePath + "/features", schemaPath: "#/$defs/webgpuFeatureNames/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.limits !== void 0) {
      let data2 = data.limits;
      if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
        for (let key1 in data2) {
          let _errs9 = errors;
          if (typeof key1 == "string" && !pattern6.test(key1)) {
            let err8 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/propertyNames/pattern", keyword: "pattern", params: { pattern: "^(max|min)[A-Z][A-Za-z0-9]*$" }, message: 'must match pattern "^(max|min)[A-Z][A-Za-z0-9]*$"', propertyName: key1 };
            vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
          }
          var valid5 = _errs9 === errors;
          if (!valid5) {
            let err9 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/propertyNames", keyword: "propertyNames", params: { propertyName: key1 }, message: "property name must be valid" };
            vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
          }
        }
        for (let key2 in data2) {
          let data3 = data2[key2];
          if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
            let err10 = { instancePath: instancePath + "/limits/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/limits/additionalProperties/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
          }
          if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
            let err11 = { instancePath: instancePath + "/limits/" + key2.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/limits/additionalProperties/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
        }
      } else {
        let err12 = { instancePath: instancePath + "/limits", schemaPath: "#/properties/limits/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.wgslLanguageFeatures !== void 0) {
      let data4 = data.wgslLanguageFeatures;
      if (Array.isArray(data4)) {
        let len1 = data4.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data5 = data4[i2];
          if (typeof data5 == "string") {
            if (!pattern7.test(data5)) {
              let err13 = { instancePath: instancePath + "/wgslLanguageFeatures/" + i2, schemaPath: "#/$defs/wgslLanguageFeatureNames/items/pattern", keyword: "pattern", params: { pattern: "^[a-z0-9][a-z0-9_]*$" }, message: 'must match pattern "^[a-z0-9][a-z0-9_]*$"' };
              vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
            }
          } else {
            let err14 = { instancePath: instancePath + "/wgslLanguageFeatures/" + i2, schemaPath: "#/$defs/wgslLanguageFeatureNames/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
          }
        }
        let i3 = data4.length, j1;
        if (i3 > 1) {
          let indices1 = {};
          for (; i3--; ) {
            let item1 = data4[i3];
            if (typeof item1 == "string") {
              if (typeof indices1[item1] == "number") {
                j1 = indices1[item1];
                let err15 = { instancePath: instancePath + "/wgslLanguageFeatures", schemaPath: "#/$defs/wgslLanguageFeatureNames/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
                vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
                break;
              }
              indices1[item1] = i3;
            }
          }
        }
      } else {
        let err16 = { instancePath: instancePath + "/wgslLanguageFeatures", schemaPath: "#/$defs/wgslLanguageFeatureNames/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
  } else {
    let err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
  }
  return validate21.errors = vErrors, errors === 0;
}
validate21.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate23.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.path === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "path" }, message: "must have required property 'path'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.sha256 === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "path" || key0 === "sha256")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err5 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.path !== void 0) {
      let data1 = data.path;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err6 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/path", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.sha256 !== void 0) {
      let data2 = data.sha256;
      if (typeof data2 == "string") {
        if (!pattern4.test(data2)) {
          let err8 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
  } else {
    let err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
  }
  return validate23.errors = vErrors, errors === 0;
}
validate23.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate25(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate25.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.file === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "file" }, message: "must have required property 'file'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.start === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "start" }, message: "must have required property 'start'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.end === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "end" }, message: "must have required property 'end'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.startLine === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "startLine" }, message: "must have required property 'startLine'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.startColumn === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "startColumn" }, message: "must have required property 'startColumn'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.endLine === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "endLine" }, message: "must have required property 'endLine'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.endColumn === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "endColumn" }, message: "must have required property 'endColumn'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "file" || key0 === "start" || key0 === "end" || key0 === "startLine" || key0 === "startColumn" || key0 === "endLine" || key0 === "endColumn")) {
        let err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    if (data.file !== void 0) {
      let data0 = data.file;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err8 = { instancePath: instancePath + "/file", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err9 = { instancePath: instancePath + "/file", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.start !== void 0) {
      let data1 = data.start;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err10 = { instancePath: instancePath + "/start", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err11 = { instancePath: instancePath + "/start", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.end !== void 0) {
      let data2 = data.end;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err12 = { instancePath: instancePath + "/end", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err13 = { instancePath: instancePath + "/end", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.startLine !== void 0) {
      let data3 = data.startLine;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err14 = { instancePath: instancePath + "/startLine", schemaPath: "#/properties/startLine/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 1 || isNaN(data3))) {
        let err15 = { instancePath: instancePath + "/startLine", schemaPath: "#/properties/startLine/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.startColumn !== void 0) {
      let data4 = data.startColumn;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err16 = { instancePath: instancePath + "/startColumn", schemaPath: "#/properties/startColumn/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4) && (data4 < 1 || isNaN(data4))) {
        let err17 = { instancePath: instancePath + "/startColumn", schemaPath: "#/properties/startColumn/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    if (data.endLine !== void 0) {
      let data5 = data.endLine;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err18 = { instancePath: instancePath + "/endLine", schemaPath: "#/properties/endLine/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
      if (typeof data5 == "number" && isFinite(data5) && (data5 < 1 || isNaN(data5))) {
        let err19 = { instancePath: instancePath + "/endLine", schemaPath: "#/properties/endLine/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    }
    if (data.endColumn !== void 0) {
      let data6 = data.endColumn;
      if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6) && isFinite(data6))) {
        let err20 = { instancePath: instancePath + "/endColumn", schemaPath: "#/properties/endColumn/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
      if (typeof data6 == "number" && isFinite(data6) && (data6 < 1 || isNaN(data6))) {
        let err21 = { instancePath: instancePath + "/endColumn", schemaPath: "#/properties/endColumn/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
  } else {
    let err22 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
  }
  return validate25.errors = vErrors, errors === 0;
}
validate25.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema45 = { type: "object", additionalProperties: !1, required: ["id", "kind", "span"], properties: { id: { $ref: "#/$defs/symbolId" }, kind: { type: "string", enum: ["scene", "camera", "entity", "state", "material", "param", "prefab", "function"] }, span: { $ref: "#/$defs/spanId" } } };
function validate27(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate27.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.span === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "kind" || key0 === "span")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data1 = data.kind;
      if (typeof data1 != "string") {
        let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
      if (!(data1 === "scene" || data1 === "camera" || data1 === "entity" || data1 === "state" || data1 === "material" || data1 === "param" || data1 === "prefab" || data1 === "function")) {
        let err7 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema45.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.span !== void 0) {
      let data2 = data.span;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err8 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err9 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
  } else {
    let err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
  }
  return validate27.errors = vErrors, errors === 0;
}
validate27.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var pattern10 = new RegExp("^(builtin:[a-z]+|material:.+::.+|fixture:.+)$", "u"), pattern11 = new RegExp("^[A-Za-z_][A-Za-z0-9_]*$", "u");
var schema61 = { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "scalar"], properties: { kind: { const: "scalar" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, scalar: { type: "string", enum: ["f32", "i32", "u32", "bool32"] } } };
function validate33(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate33.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.offset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.scalar === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scalar" }, message: "must have required property 'scalar'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "offset" || key0 === "size" || key0 === "align" || key0 === "scalar")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "scalar") {
      let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "scalar" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.offset !== void 0) {
      let data1 = data.offset;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err7 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err8 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err9 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err10 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.align !== void 0) {
      let data3 = data.align;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err11 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err12 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.scalar !== void 0) {
      let data4 = data.scalar;
      if (typeof data4 != "string") {
        let err13 = { instancePath: instancePath + "/scalar", schemaPath: "#/properties/scalar/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (!(data4 === "f32" || data4 === "i32" || data4 === "u32" || data4 === "bool32")) {
        let err14 = { instancePath: instancePath + "/scalar", schemaPath: "#/properties/scalar/enum", keyword: "enum", params: { allowedValues: schema61.properties.scalar.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
  } else {
    let err15 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
  }
  return validate33.errors = vErrors, errors === 0;
}
validate33.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema65 = { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "scalar", "components"], properties: { kind: { const: "vector" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, scalar: { type: "string", enum: ["f32"] }, components: { type: "integer", minimum: 2, maximum: 4 } } };
function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate34.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.offset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.scalar === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scalar" }, message: "must have required property 'scalar'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.components === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "components" }, message: "must have required property 'components'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "offset" || key0 === "size" || key0 === "align" || key0 === "scalar" || key0 === "components")) {
        let err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "vector") {
      let err7 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "vector" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.offset !== void 0) {
      let data1 = data.offset;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err8 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err9 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err10 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.align !== void 0) {
      let data3 = data.align;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err12 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err13 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.scalar !== void 0) {
      let data4 = data.scalar;
      if (typeof data4 != "string") {
        let err14 = { instancePath: instancePath + "/scalar", schemaPath: "#/properties/scalar/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
      if (data4 !== "f32") {
        let err15 = { instancePath: instancePath + "/scalar", schemaPath: "#/properties/scalar/enum", keyword: "enum", params: { allowedValues: schema65.properties.scalar.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.components !== void 0) {
      let data5 = data.components;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err16 = { instancePath: instancePath + "/components", schemaPath: "#/properties/components/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
      if (typeof data5 == "number" && isFinite(data5)) {
        if (data5 > 4 || isNaN(data5)) {
          let err17 = { instancePath: instancePath + "/components", schemaPath: "#/properties/components/maximum", keyword: "maximum", params: { comparison: "<=", limit: 4 }, message: "must be <= 4" };
          vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
        }
        if (data5 < 2 || isNaN(data5)) {
          let err18 = { instancePath: instancePath + "/components", schemaPath: "#/properties/components/minimum", keyword: "minimum", params: { comparison: ">=", limit: 2 }, message: "must be >= 2" };
          vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
        }
      }
    }
  } else {
    let err19 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
  }
  return validate34.errors = vErrors, errors === 0;
}
validate34.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema69 = { type: "object", additionalProperties: !1, required: ["kind", "offset", "size", "align", "columns", "rows", "columnStride"], properties: { kind: { const: "matrix" }, offset: { $ref: "#/$defs/index" }, size: { $ref: "#/$defs/index" }, align: { $ref: "#/$defs/index" }, columns: { type: "integer", enum: [4] }, rows: { type: "integer", enum: [4] }, columnStride: { type: "integer", enum: [16] } } };
function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate35.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.offset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.columns === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "columns" }, message: "must have required property 'columns'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.rows === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rows" }, message: "must have required property 'rows'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.columnStride === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "columnStride" }, message: "must have required property 'columnStride'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "offset" || key0 === "size" || key0 === "align" || key0 === "columns" || key0 === "rows" || key0 === "columnStride")) {
        let err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "matrix") {
      let err8 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "matrix" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.offset !== void 0) {
      let data1 = data.offset;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err9 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err10 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err12 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.align !== void 0) {
      let data3 = data.align;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err13 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err14 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.columns !== void 0) {
      let data4 = data.columns;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err15 = { instancePath: instancePath + "/columns", schemaPath: "#/properties/columns/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
      if (data4 !== 4) {
        let err16 = { instancePath: instancePath + "/columns", schemaPath: "#/properties/columns/enum", keyword: "enum", params: { allowedValues: schema69.properties.columns.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.rows !== void 0) {
      let data5 = data.rows;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err17 = { instancePath: instancePath + "/rows", schemaPath: "#/properties/rows/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
      if (data5 !== 4) {
        let err18 = { instancePath: instancePath + "/rows", schemaPath: "#/properties/rows/enum", keyword: "enum", params: { allowedValues: schema69.properties.rows.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.columnStride !== void 0) {
      let data6 = data.columnStride;
      if (!(typeof data6 == "number" && !(data6 % 1) && !isNaN(data6) && isFinite(data6))) {
        let err19 = { instancePath: instancePath + "/columnStride", schemaPath: "#/properties/columnStride/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
      if (data6 !== 16) {
        let err20 = { instancePath: instancePath + "/columnStride", schemaPath: "#/properties/columnStride/enum", keyword: "enum", params: { allowedValues: schema69.properties.columnStride.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
  } else {
    let err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
  }
  return validate35.errors = vErrors, errors === 0;
}
validate35.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var wrapper0 = { validate: validate32 };
function validate36(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate36.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.offset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.length === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "length" }, message: "must have required property 'length'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.stride === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "stride" }, message: "must have required property 'stride'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.padded === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "padded" }, message: "must have required property 'padded'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.element === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "element" }, message: "must have required property 'element'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "offset" || key0 === "size" || key0 === "align" || key0 === "length" || key0 === "stride" || key0 === "padded" || key0 === "element")) {
        let err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "array") {
      let err9 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "array" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.offset !== void 0) {
      let data1 = data.offset;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err10 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err11 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err12 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err13 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.align !== void 0) {
      let data3 = data.align;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err14 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err15 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.length !== void 0) {
      let data4 = data.length;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err16 = { instancePath: instancePath + "/length", schemaPath: "#/properties/length/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4) && (data4 < 1 || isNaN(data4))) {
        let err17 = { instancePath: instancePath + "/length", schemaPath: "#/properties/length/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    if (data.stride !== void 0) {
      let data5 = data.stride;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err18 = { instancePath: instancePath + "/stride", schemaPath: "#/properties/stride/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
      if (typeof data5 == "number" && isFinite(data5) && (data5 < 1 || isNaN(data5))) {
        let err19 = { instancePath: instancePath + "/stride", schemaPath: "#/properties/stride/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    }
    if (data.padded !== void 0 && typeof data.padded != "boolean") {
      let err20 = { instancePath: instancePath + "/padded", schemaPath: "#/properties/padded/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
    }
    data.element !== void 0 && (wrapper0.validate(data.element, { instancePath: instancePath + "/element", parentData: data, parentDataProperty: "element", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? wrapper0.validate.errors : vErrors.concat(wrapper0.validate.errors), errors = vErrors.length));
  } else {
    let err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
  }
  return validate36.errors = vErrors, errors === 0;
}
validate36.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var wrapper1 = { validate: validate30 };
function validate32(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate32.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "scalar") {
        validate33(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "vector")
        validate34(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "matrix")
        validate35(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "struct") {
        if (!wrapper1.validate(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }))
          vErrors = vErrors === null ? wrapper1.validate.errors : vErrors.concat(wrapper1.validate.errors), errors = vErrors.length;
        else
          var props1 = wrapper1.validate.evaluated.props, items0 = wrapper1.validate.evaluated.items;
        props0 !== !0 && props1 !== void 0 && (props1 === !0 ? props0 = !0 : (props0 = props0 || {}, Object.assign(props0, props1)));
      } else if (tag0 === "array")
        validate36(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate36.errors : vErrors.concat(validate36.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err0 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    else {
      let err1 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
  } else {
    let err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
  }
  return validate32.errors = vErrors, evaluated0.props = props0, evaluated0.items = items0, errors === 0;
}
validate32.evaluated = { dynamicProps: !0, dynamicItems: !0 };
function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate31.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.mtekType === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mtekType" }, message: "must have required property 'mtekType'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.node === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "node" }, message: "must have required property 'node'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "mtekType" || key0 === "node")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.mtekType !== void 0) {
      let data1 = data.mtekType;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err6 = { instancePath: instancePath + "/mtekType", schemaPath: "#/$defs/mtekTypeName/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/mtekType", schemaPath: "#/$defs/mtekTypeName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    data.node !== void 0 && (validate32(data.node, { instancePath: instancePath + "/node", parentData: data, parentDataProperty: "node", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate32.errors : vErrors.concat(validate32.errors), errors = vErrors.length));
  } else {
    let err8 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
  }
  return validate31.errors = vErrors, errors === 0;
}
validate31.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate30.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.offset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offset" }, message: "must have required property 'offset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.members === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "members" }, message: "must have required property 'members'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "name" || key0 === "offset" || key0 === "size" || key0 === "align" || key0 === "members")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "struct") {
      let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "struct" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err7 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.offset !== void 0) {
      let data2 = data.offset;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err9 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err10 = { instancePath: instancePath + "/offset", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.size !== void 0) {
      let data3 = data.size;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err12 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.align !== void 0) {
      let data4 = data.align;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err13 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4) && (data4 < 0 || isNaN(data4))) {
        let err14 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.members !== void 0) {
      let data5 = data.members;
      if (Array.isArray(data5)) {
        let len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate31(data5[i0], { instancePath: instancePath + "/members/" + i0, parentData: data5, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors), errors = vErrors.length);
      } else {
        let err15 = { instancePath: instancePath + "/members", schemaPath: "#/properties/members/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
  } else {
    let err16 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
  }
  return validate30.errors = vErrors, errors === 0;
}
validate30.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate29.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.wgslStruct === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "wgslStruct" }, message: "must have required property 'wgslStruct'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.align === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "align" }, message: "must have required property 'align'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.root === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "root" }, message: "must have required property 'root'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "wgslStruct" || key0 === "size" || key0 === "align" || key0 === "root")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (!pattern10.test(data0)) {
          let err6 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/pattern", keyword: "pattern", params: { pattern: "^(builtin:[a-z]+|material:.+::.+|fixture:.+)$" }, message: 'must match pattern "^(builtin:[a-z]+|material:.+::.+|fixture:.+)$"' };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.wgslStruct !== void 0) {
      let data1 = data.wgslStruct;
      if (typeof data1 == "string") {
        if (!pattern11.test(data1)) {
          let err8 = { instancePath: instancePath + "/wgslStruct", schemaPath: "#/$defs/wgslIdentifier/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, message: 'must match pattern "^[A-Za-z_][A-Za-z0-9_]*$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/wgslStruct", schemaPath: "#/$defs/wgslIdentifier/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err10 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.align !== void 0) {
      let data3 = data.align;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err12 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err13 = { instancePath: instancePath + "/align", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    data.root !== void 0 && (validate30(data.root, { instancePath: instancePath + "/root", parentData: data, parentDataProperty: "root", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors), errors = vErrors.length));
  } else {
    let err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
  }
  return validate29.errors = vErrors, errors === 0;
}
validate29.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema77 = { type: "object", additionalProperties: !1, required: ["hash", "url", "map", "material", "vertexEntry", "fragmentEntry", "vertexAttributes", "surfaceInputs"], properties: { hash: { $ref: "#/$defs/sha256" }, url: { type: "string", pattern: "^shaders/[0-9a-f]{16}\\.wgsl$" }, map: { type: "string", pattern: "^shaders/[0-9a-f]{16}\\.mtek-map\\.json$" }, material: { $ref: "#/$defs/symbolId", description: "Id of the material this shader was generated for." }, vertexEntry: { $ref: "#/$defs/wgslIdentifier" }, instancedVertexEntry: { $ref: "#/$defs/wgslIdentifier", description: "The vertex entry that reads the model and normal matrices from a per-instance vertex buffer (spec/runtime-abi.md section 8.4, decision 0059). Absent: the runtime draws every entity individually." }, fragmentEntry: { $ref: "#/$defs/wgslIdentifier" }, vertexAttributes: { type: "array", description: "Present vertex attributes in vertex-buffer slot order (spec/materials.md section 3.3).", items: { type: "string", enum: ["position", "normal", "uv"] }, uniqueItems: !0 }, surfaceInputs: { type: "array", description: "SurfaceInput fields the fragment stage reads.", items: { type: "string", enum: ["local_position", "world_position", "world_normal", "uv"] }, uniqueItems: !0 } } }, pattern13 = new RegExp("^shaders/[0-9a-f]{16}\\.wgsl$", "u"), pattern14 = new RegExp("^shaders/[0-9a-f]{16}\\.mtek-map\\.json$", "u");
function validate45(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate45.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.hash === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hash" }, message: "must have required property 'hash'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.url === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.map === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "map" }, message: "must have required property 'map'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.material === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "material" }, message: "must have required property 'material'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.vertexEntry === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "vertexEntry" }, message: "must have required property 'vertexEntry'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.fragmentEntry === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "fragmentEntry" }, message: "must have required property 'fragmentEntry'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.vertexAttributes === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "vertexAttributes" }, message: "must have required property 'vertexAttributes'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.surfaceInputs === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "surfaceInputs" }, message: "must have required property 'surfaceInputs'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    for (let key0 in data)
      if (!func1.call(schema77.properties, key0)) {
        let err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    if (data.hash !== void 0) {
      let data0 = data.hash;
      if (typeof data0 == "string") {
        if (!pattern4.test(data0)) {
          let err9 = { instancePath: instancePath + "/hash", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
      } else {
        let err10 = { instancePath: instancePath + "/hash", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.url !== void 0) {
      let data1 = data.url;
      if (typeof data1 == "string") {
        if (!pattern13.test(data1)) {
          let err11 = { instancePath: instancePath + "/url", schemaPath: "#/properties/url/pattern", keyword: "pattern", params: { pattern: "^shaders/[0-9a-f]{16}\\.wgsl$" }, message: 'must match pattern "^shaders/[0-9a-f]{16}\\.wgsl$"' };
          vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
        }
      } else {
        let err12 = { instancePath: instancePath + "/url", schemaPath: "#/properties/url/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.map !== void 0) {
      let data2 = data.map;
      if (typeof data2 == "string") {
        if (!pattern14.test(data2)) {
          let err13 = { instancePath: instancePath + "/map", schemaPath: "#/properties/map/pattern", keyword: "pattern", params: { pattern: "^shaders/[0-9a-f]{16}\\.mtek-map\\.json$" }, message: 'must match pattern "^shaders/[0-9a-f]{16}\\.mtek-map\\.json$"' };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      } else {
        let err14 = { instancePath: instancePath + "/map", schemaPath: "#/properties/map/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.material !== void 0) {
      let data3 = data.material;
      if (typeof data3 == "string") {
        if (data3.length < 1) {
          let err15 = { instancePath: instancePath + "/material", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
      } else {
        let err16 = { instancePath: instancePath + "/material", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.vertexEntry !== void 0) {
      let data4 = data.vertexEntry;
      if (typeof data4 == "string") {
        if (!pattern11.test(data4)) {
          let err17 = { instancePath: instancePath + "/vertexEntry", schemaPath: "#/$defs/wgslIdentifier/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, message: 'must match pattern "^[A-Za-z_][A-Za-z0-9_]*$"' };
          vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
        }
      } else {
        let err18 = { instancePath: instancePath + "/vertexEntry", schemaPath: "#/$defs/wgslIdentifier/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.instancedVertexEntry !== void 0) {
      let data5 = data.instancedVertexEntry;
      if (typeof data5 == "string") {
        if (!pattern11.test(data5)) {
          let err19 = { instancePath: instancePath + "/instancedVertexEntry", schemaPath: "#/$defs/wgslIdentifier/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, message: 'must match pattern "^[A-Za-z_][A-Za-z0-9_]*$"' };
          vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
        }
      } else {
        let err20 = { instancePath: instancePath + "/instancedVertexEntry", schemaPath: "#/$defs/wgslIdentifier/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
    if (data.fragmentEntry !== void 0) {
      let data6 = data.fragmentEntry;
      if (typeof data6 == "string") {
        if (!pattern11.test(data6)) {
          let err21 = { instancePath: instancePath + "/fragmentEntry", schemaPath: "#/$defs/wgslIdentifier/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }, message: 'must match pattern "^[A-Za-z_][A-Za-z0-9_]*$"' };
          vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
        }
      } else {
        let err22 = { instancePath: instancePath + "/fragmentEntry", schemaPath: "#/$defs/wgslIdentifier/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
      }
    }
    if (data.vertexAttributes !== void 0) {
      let data7 = data.vertexAttributes;
      if (Array.isArray(data7)) {
        let len0 = data7.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data8 = data7[i0];
          if (typeof data8 != "string") {
            let err23 = { instancePath: instancePath + "/vertexAttributes/" + i0, schemaPath: "#/properties/vertexAttributes/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
          }
          if (!(data8 === "position" || data8 === "normal" || data8 === "uv")) {
            let err24 = { instancePath: instancePath + "/vertexAttributes/" + i0, schemaPath: "#/properties/vertexAttributes/items/enum", keyword: "enum", params: { allowedValues: schema77.properties.vertexAttributes.items.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
          }
        }
        let i1 = data7.length, j0;
        if (i1 > 1) {
          let indices0 = {};
          for (; i1--; ) {
            let item0 = data7[i1];
            if (typeof item0 == "string") {
              if (typeof indices0[item0] == "number") {
                j0 = indices0[item0];
                let err25 = { instancePath: instancePath + "/vertexAttributes", schemaPath: "#/properties/vertexAttributes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
                break;
              }
              indices0[item0] = i1;
            }
          }
        }
      } else {
        let err26 = { instancePath: instancePath + "/vertexAttributes", schemaPath: "#/properties/vertexAttributes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
      }
    }
    if (data.surfaceInputs !== void 0) {
      let data9 = data.surfaceInputs;
      if (Array.isArray(data9)) {
        let len1 = data9.length;
        for (let i2 = 0; i2 < len1; i2++) {
          let data10 = data9[i2];
          if (typeof data10 != "string") {
            let err27 = { instancePath: instancePath + "/surfaceInputs/" + i2, schemaPath: "#/properties/surfaceInputs/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
          }
          if (!(data10 === "local_position" || data10 === "world_position" || data10 === "world_normal" || data10 === "uv")) {
            let err28 = { instancePath: instancePath + "/surfaceInputs/" + i2, schemaPath: "#/properties/surfaceInputs/items/enum", keyword: "enum", params: { allowedValues: schema77.properties.surfaceInputs.items.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
          }
        }
        let i3 = data9.length, j1;
        if (i3 > 1) {
          let indices1 = {};
          for (; i3--; ) {
            let item1 = data9[i3];
            if (typeof item1 == "string") {
              if (typeof indices1[item1] == "number") {
                j1 = indices1[item1];
                let err29 = { instancePath: instancePath + "/surfaceInputs", schemaPath: "#/properties/surfaceInputs/uniqueItems", keyword: "uniqueItems", params: { i: i3, j: j1 }, message: "must NOT have duplicate items (items ## " + j1 + " and " + i3 + " are identical)" };
                vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
                break;
              }
              indices1[item1] = i3;
            }
          }
        }
      } else {
        let err30 = { instancePath: instancePath + "/surfaceInputs", schemaPath: "#/properties/surfaceInputs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
      }
    }
  } else {
    let err31 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
  }
  return validate45.errors = vErrors, errors === 0;
}
validate45.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema83 = { type: "object", additionalProperties: !1, required: ["id", "layout", "shader", "resources", "params"], properties: { id: { $ref: "#/$defs/symbolId" }, layout: { type: ["string", "null"], minLength: 1, description: "Layout id of the parameter block; null when the material has no value params (bind group 1 binding 0 is then absent)." }, shader: { $ref: "#/$defs/sha256", description: "Hash of the material's shader." }, resources: { type: "array", items: { $ref: "#/$defs/materialResource" } }, params: { type: "array", items: { $ref: "#/$defs/materialParam" } } } }, schema86 = { type: "object", description: "One texture or sampler binding in bind group 1, in param declaration order.", additionalProperties: !1, required: ["name", "kind", "binding"], properties: { name: { $ref: "#/$defs/name" }, kind: { type: "string", enum: ["texture", "sampler"] }, binding: { type: "integer", minimum: 1 } } };
function validate48(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.binding === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "kind" || key0 === "binding")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.kind !== void 0) {
      let data1 = data.kind;
      if (typeof data1 != "string") {
        let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
      if (!(data1 === "texture" || data1 === "sampler")) {
        let err7 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema86.properties.kind.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.binding !== void 0) {
      let data2 = data.binding;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err8 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 1 || isNaN(data2))) {
        let err9 = { instancePath: instancePath + "/binding", schemaPath: "#/properties/binding/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
  } else {
    let err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
  }
  return validate48.errors = vErrors, errors === 0;
}
validate48.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate50(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate50.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.type === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.span === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "type" || key0 === "span")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.type !== void 0) {
      let data1 = data.type;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err6 = { instancePath: instancePath + "/type", schemaPath: "#/$defs/mtekTypeName/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/type", schemaPath: "#/$defs/mtekTypeName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.span !== void 0) {
      let data2 = data.span;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err8 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err9 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
  } else {
    let err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
  }
  return validate50.errors = vErrors, errors === 0;
}
validate50.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate47(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate47.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.layout === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "layout" }, message: "must have required property 'layout'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.shader === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "shader" }, message: "must have required property 'shader'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.resources === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "resources" }, message: "must have required property 'resources'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.params === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "params" }, message: "must have required property 'params'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "layout" || key0 === "shader" || key0 === "resources" || key0 === "params")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err6 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.layout !== void 0) {
      let data1 = data.layout;
      if (typeof data1 != "string" && data1 !== null) {
        let err8 = { instancePath: instancePath + "/layout", schemaPath: "#/properties/layout/type", keyword: "type", params: { type: schema83.properties.layout.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data1 == "string" && data1.length < 1) {
        let err9 = { instancePath: instancePath + "/layout", schemaPath: "#/properties/layout/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.shader !== void 0) {
      let data2 = data.shader;
      if (typeof data2 == "string") {
        if (!pattern4.test(data2)) {
          let err10 = { instancePath: instancePath + "/shader", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
      } else {
        let err11 = { instancePath: instancePath + "/shader", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.resources !== void 0) {
      let data3 = data.resources;
      if (Array.isArray(data3)) {
        let len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate48(data3[i0], { instancePath: instancePath + "/resources/" + i0, parentData: data3, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate48.errors : vErrors.concat(validate48.errors), errors = vErrors.length);
      } else {
        let err12 = { instancePath: instancePath + "/resources", schemaPath: "#/properties/resources/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.params !== void 0) {
      let data5 = data.params;
      if (Array.isArray(data5)) {
        let len1 = data5.length;
        for (let i1 = 0; i1 < len1; i1++)
          validate50(data5[i1], { instancePath: instancePath + "/params/" + i1, parentData: data5, parentDataProperty: i1, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate50.errors : vErrors.concat(validate50.errors), errors = vErrors.length);
      } else {
        let err13 = { instancePath: instancePath + "/params", schemaPath: "#/properties/params/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
  } else {
    let err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
  }
  return validate47.errors = vErrors, errors === 0;
}
validate47.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var pattern19 = new RegExp("^mesh:[0-9]+$", "u");
function validate54(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate54.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "kind" || key0 === "size")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (!pattern19.test(data0)) {
          let err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "box") {
      let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "box" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (Array.isArray(data2)) {
        if (data2.length > 3) {
          let err7 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/maxItems", keyword: "maxItems", params: { limit: 3 }, message: "must NOT have more than 3 items" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
        if (data2.length < 3) {
          let err8 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/minItems", keyword: "minItems", params: { limit: 3 }, message: "must NOT have fewer than 3 items" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
        let len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (typeof data3 == "number" && isFinite(data3)) {
            if (data3 <= 0 || isNaN(data3)) {
              let err9 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/properties/size/items/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
              vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
            }
          } else {
            let err10 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/properties/size/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
          }
        }
      } else {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
  } else {
    let err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
  }
  return validate54.errors = vErrors, errors === 0;
}
validate54.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate55(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate55.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.radius === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "radius" }, message: "must have required property 'radius'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.segments === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "segments" }, message: "must have required property 'segments'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.rings === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "rings" }, message: "must have required property 'rings'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "kind" || key0 === "radius" || key0 === "segments" || key0 === "rings")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (!pattern19.test(data0)) {
          let err6 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "sphere") {
      let err8 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "sphere" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.radius !== void 0) {
      let data2 = data.radius;
      if (typeof data2 == "number" && isFinite(data2)) {
        if (data2 <= 0 || isNaN(data2)) {
          let err9 = { instancePath: instancePath + "/radius", schemaPath: "#/properties/radius/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
      } else {
        let err10 = { instancePath: instancePath + "/radius", schemaPath: "#/properties/radius/type", keyword: "type", params: { type: "number" }, message: "must be number" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.segments !== void 0) {
      let data3 = data.segments;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err11 = { instancePath: instancePath + "/segments", schemaPath: "#/properties/segments/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3)) {
        if (data3 > 256 || isNaN(data3)) {
          let err12 = { instancePath: instancePath + "/segments", schemaPath: "#/properties/segments/maximum", keyword: "maximum", params: { comparison: "<=", limit: 256 }, message: "must be <= 256" };
          vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
        }
        if (data3 < 3 || isNaN(data3)) {
          let err13 = { instancePath: instancePath + "/segments", schemaPath: "#/properties/segments/minimum", keyword: "minimum", params: { comparison: ">=", limit: 3 }, message: "must be >= 3" };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      }
    }
    if (data.rings !== void 0) {
      let data4 = data.rings;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err14 = { instancePath: instancePath + "/rings", schemaPath: "#/properties/rings/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4)) {
        if (data4 > 256 || isNaN(data4)) {
          let err15 = { instancePath: instancePath + "/rings", schemaPath: "#/properties/rings/maximum", keyword: "maximum", params: { comparison: "<=", limit: 256 }, message: "must be <= 256" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
        if (data4 < 2 || isNaN(data4)) {
          let err16 = { instancePath: instancePath + "/rings", schemaPath: "#/properties/rings/minimum", keyword: "minimum", params: { comparison: ">=", limit: 2 }, message: "must be >= 2" };
          vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
        }
      }
    }
  } else {
    let err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
  }
  return validate55.errors = vErrors, errors === 0;
}
validate55.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate56(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate56.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.size === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "kind" || key0 === "size")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (!pattern19.test(data0)) {
          let err4 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "plane") {
      let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "plane" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.size !== void 0) {
      let data2 = data.size;
      if (Array.isArray(data2)) {
        if (data2.length > 2) {
          let err7 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/maxItems", keyword: "maxItems", params: { limit: 2 }, message: "must NOT have more than 2 items" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
        if (data2.length < 2) {
          let err8 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/minItems", keyword: "minItems", params: { limit: 2 }, message: "must NOT have fewer than 2 items" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
        let len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (typeof data3 == "number" && isFinite(data3)) {
            if (data3 <= 0 || isNaN(data3)) {
              let err9 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/properties/size/items/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
              vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
            }
          } else {
            let err10 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/properties/size/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
          }
        }
      } else {
        let err11 = { instancePath: instancePath + "/size", schemaPath: "#/properties/size/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
  } else {
    let err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
  }
  return validate56.errors = vErrors, errors === 0;
}
validate56.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var pattern23 = new RegExp("^assets/[0-9a-f]{16}\\.[a-z0-9]+$", "u");
function validate57(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate57.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.kind === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.asset === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "asset" }, message: "must have required property 'asset'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.primitive === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "primitive" }, message: "must have required property 'primitive'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "kind" || key0 === "asset" || key0 === "primitive")) {
        let err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (typeof data0 == "string") {
        if (!pattern19.test(data0)) {
          let err5 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
          vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
        }
      } else {
        let err6 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/meshId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "asset") {
      let err7 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "asset" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.asset !== void 0) {
      let data2 = data.asset;
      if (typeof data2 == "string") {
        if (!pattern23.test(data2)) {
          let err8 = { instancePath: instancePath + "/asset", schemaPath: "#/$defs/assetUrl/pattern", keyword: "pattern", params: { pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, message: 'must match pattern "^assets/[0-9a-f]{16}\\.[a-z0-9]+$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/asset", schemaPath: "#/$defs/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.primitive !== void 0) {
      let data3 = data.primitive;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
        let err10 = { instancePath: instancePath + "/primitive", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err11 = { instancePath: instancePath + "/primitive", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
  } else {
    let err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
  }
  return validate57.errors = vErrors, errors === 0;
}
validate57.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate53(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate53.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "box") {
        validate54(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "sphere")
        validate55(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "plane")
        validate56(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "asset")
        validate57(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate57.errors : vErrors.concat(validate57.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err0 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    else {
      let err1 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
  } else {
    let err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
  }
  return validate53.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate53.evaluated = { dynamicProps: !0, dynamicItems: !1 };
var schema108 = { type: "object", description: "One primitive inside a packaged .bin (spec/assets.md section 4). Offsets are byte offsets into the file.", additionalProperties: !1, required: ["source", "vertexCount", "indexCount", "indexFormat", "attributes", "offsets", "boundingSphere"], properties: { source: { type: "object", additionalProperties: !1, required: ["file", "mesh", "primitive"], properties: { file: { $ref: "#/$defs/name" }, mesh: { $ref: "#/$defs/name" }, primitive: { $ref: "#/$defs/index" } } }, vertexCount: { type: "integer", minimum: 1 }, indexCount: { type: "integer", minimum: 1 }, indexFormat: { type: "string", enum: ["uint16", "uint32"] }, attributes: { type: "array", items: { type: "string", enum: ["position", "normal", "uv"] }, uniqueItems: !0 }, offsets: { type: "object", additionalProperties: !1, required: ["position", "indices"], properties: { position: { $ref: "#/$defs/index" }, normal: { $ref: "#/$defs/index" }, uv: { $ref: "#/$defs/index" }, indices: { $ref: "#/$defs/index" } } }, boundingSphere: { type: "object", additionalProperties: !1, required: ["center", "radius"], properties: { center: { $ref: "#/$defs/vec3" }, radius: { type: "number", minimum: 0 } } } } };
function validate65(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.source === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.vertexCount === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "vertexCount" }, message: "must have required property 'vertexCount'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.indexCount === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "indexCount" }, message: "must have required property 'indexCount'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.indexFormat === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "indexFormat" }, message: "must have required property 'indexFormat'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.attributes === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "attributes" }, message: "must have required property 'attributes'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.offsets === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "offsets" }, message: "must have required property 'offsets'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.boundingSphere === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "boundingSphere" }, message: "must have required property 'boundingSphere'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "source" || key0 === "vertexCount" || key0 === "indexCount" || key0 === "indexFormat" || key0 === "attributes" || key0 === "offsets" || key0 === "boundingSphere")) {
        let err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    if (data.source !== void 0) {
      let data0 = data.source;
      if (data0 && typeof data0 == "object" && !Array.isArray(data0)) {
        if (data0.file === void 0) {
          let err8 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/required", keyword: "required", params: { missingProperty: "file" }, message: "must have required property 'file'" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
        if (data0.mesh === void 0) {
          let err9 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/required", keyword: "required", params: { missingProperty: "mesh" }, message: "must have required property 'mesh'" };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
        if (data0.primitive === void 0) {
          let err10 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/required", keyword: "required", params: { missingProperty: "primitive" }, message: "must have required property 'primitive'" };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
        for (let key1 in data0)
          if (!(key1 === "file" || key1 === "mesh" || key1 === "primitive")) {
            let err11 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
        if (data0.file !== void 0) {
          let data1 = data0.file;
          if (typeof data1 == "string") {
            if (data1.length < 1) {
              let err12 = { instancePath: instancePath + "/source/file", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
            }
          } else {
            let err13 = { instancePath: instancePath + "/source/file", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
          }
        }
        if (data0.mesh !== void 0) {
          let data2 = data0.mesh;
          if (typeof data2 == "string") {
            if (data2.length < 1) {
              let err14 = { instancePath: instancePath + "/source/mesh", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
            }
          } else {
            let err15 = { instancePath: instancePath + "/source/mesh", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
          }
        }
        if (data0.primitive !== void 0) {
          let data3 = data0.primitive;
          if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3))) {
            let err16 = { instancePath: instancePath + "/source/primitive", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
          }
          if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
            let err17 = { instancePath: instancePath + "/source/primitive", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
        }
      } else {
        let err18 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.vertexCount !== void 0) {
      let data4 = data.vertexCount;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err19 = { instancePath: instancePath + "/vertexCount", schemaPath: "#/properties/vertexCount/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4) && (data4 < 1 || isNaN(data4))) {
        let err20 = { instancePath: instancePath + "/vertexCount", schemaPath: "#/properties/vertexCount/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
    if (data.indexCount !== void 0) {
      let data5 = data.indexCount;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err21 = { instancePath: instancePath + "/indexCount", schemaPath: "#/properties/indexCount/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
      if (typeof data5 == "number" && isFinite(data5) && (data5 < 1 || isNaN(data5))) {
        let err22 = { instancePath: instancePath + "/indexCount", schemaPath: "#/properties/indexCount/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
        vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
      }
    }
    if (data.indexFormat !== void 0) {
      let data6 = data.indexFormat;
      if (typeof data6 != "string") {
        let err23 = { instancePath: instancePath + "/indexFormat", schemaPath: "#/properties/indexFormat/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
      }
      if (!(data6 === "uint16" || data6 === "uint32")) {
        let err24 = { instancePath: instancePath + "/indexFormat", schemaPath: "#/properties/indexFormat/enum", keyword: "enum", params: { allowedValues: schema108.properties.indexFormat.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
      }
    }
    if (data.attributes !== void 0) {
      let data7 = data.attributes;
      if (Array.isArray(data7)) {
        let len0 = data7.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data8 = data7[i0];
          if (typeof data8 != "string") {
            let err25 = { instancePath: instancePath + "/attributes/" + i0, schemaPath: "#/properties/attributes/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
          }
          if (!(data8 === "position" || data8 === "normal" || data8 === "uv")) {
            let err26 = { instancePath: instancePath + "/attributes/" + i0, schemaPath: "#/properties/attributes/items/enum", keyword: "enum", params: { allowedValues: schema108.properties.attributes.items.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
          }
        }
        let i1 = data7.length, j0;
        if (i1 > 1) {
          let indices0 = {};
          for (; i1--; ) {
            let item0 = data7[i1];
            if (typeof item0 == "string") {
              if (typeof indices0[item0] == "number") {
                j0 = indices0[item0];
                let err27 = { instancePath: instancePath + "/attributes", schemaPath: "#/properties/attributes/uniqueItems", keyword: "uniqueItems", params: { i: i1, j: j0 }, message: "must NOT have duplicate items (items ## " + j0 + " and " + i1 + " are identical)" };
                vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
                break;
              }
              indices0[item0] = i1;
            }
          }
        }
      } else {
        let err28 = { instancePath: instancePath + "/attributes", schemaPath: "#/properties/attributes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
      }
    }
    if (data.offsets !== void 0) {
      let data9 = data.offsets;
      if (data9 && typeof data9 == "object" && !Array.isArray(data9)) {
        if (data9.position === void 0) {
          let err29 = { instancePath: instancePath + "/offsets", schemaPath: "#/properties/offsets/required", keyword: "required", params: { missingProperty: "position" }, message: "must have required property 'position'" };
          vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
        }
        if (data9.indices === void 0) {
          let err30 = { instancePath: instancePath + "/offsets", schemaPath: "#/properties/offsets/required", keyword: "required", params: { missingProperty: "indices" }, message: "must have required property 'indices'" };
          vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
        }
        for (let key2 in data9)
          if (!(key2 === "position" || key2 === "normal" || key2 === "uv" || key2 === "indices")) {
            let err31 = { instancePath: instancePath + "/offsets", schemaPath: "#/properties/offsets/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
          }
        if (data9.position !== void 0) {
          let data10 = data9.position;
          if (!(typeof data10 == "number" && !(data10 % 1) && !isNaN(data10) && isFinite(data10))) {
            let err32 = { instancePath: instancePath + "/offsets/position", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
          }
          if (typeof data10 == "number" && isFinite(data10) && (data10 < 0 || isNaN(data10))) {
            let err33 = { instancePath: instancePath + "/offsets/position", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
          }
        }
        if (data9.normal !== void 0) {
          let data11 = data9.normal;
          if (!(typeof data11 == "number" && !(data11 % 1) && !isNaN(data11) && isFinite(data11))) {
            let err34 = { instancePath: instancePath + "/offsets/normal", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
          }
          if (typeof data11 == "number" && isFinite(data11) && (data11 < 0 || isNaN(data11))) {
            let err35 = { instancePath: instancePath + "/offsets/normal", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
          }
        }
        if (data9.uv !== void 0) {
          let data12 = data9.uv;
          if (!(typeof data12 == "number" && !(data12 % 1) && !isNaN(data12) && isFinite(data12))) {
            let err36 = { instancePath: instancePath + "/offsets/uv", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
          }
          if (typeof data12 == "number" && isFinite(data12) && (data12 < 0 || isNaN(data12))) {
            let err37 = { instancePath: instancePath + "/offsets/uv", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
          }
        }
        if (data9.indices !== void 0) {
          let data13 = data9.indices;
          if (!(typeof data13 == "number" && !(data13 % 1) && !isNaN(data13) && isFinite(data13))) {
            let err38 = { instancePath: instancePath + "/offsets/indices", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
          }
          if (typeof data13 == "number" && isFinite(data13) && (data13 < 0 || isNaN(data13))) {
            let err39 = { instancePath: instancePath + "/offsets/indices", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
          }
        }
      } else {
        let err40 = { instancePath: instancePath + "/offsets", schemaPath: "#/properties/offsets/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
      }
    }
    if (data.boundingSphere !== void 0) {
      let data14 = data.boundingSphere;
      if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
        if (data14.center === void 0) {
          let err41 = { instancePath: instancePath + "/boundingSphere", schemaPath: "#/properties/boundingSphere/required", keyword: "required", params: { missingProperty: "center" }, message: "must have required property 'center'" };
          vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
        }
        if (data14.radius === void 0) {
          let err42 = { instancePath: instancePath + "/boundingSphere", schemaPath: "#/properties/boundingSphere/required", keyword: "required", params: { missingProperty: "radius" }, message: "must have required property 'radius'" };
          vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
        }
        for (let key3 in data14)
          if (!(key3 === "center" || key3 === "radius")) {
            let err43 = { instancePath: instancePath + "/boundingSphere", schemaPath: "#/properties/boundingSphere/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
          }
        if (data14.center !== void 0) {
          let data15 = data14.center;
          if (Array.isArray(data15)) {
            if (data15.length > 3) {
              let err44 = { instancePath: instancePath + "/boundingSphere/center", schemaPath: "#/$defs/vec3/maxItems", keyword: "maxItems", params: { limit: 3 }, message: "must NOT have more than 3 items" };
              vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
            }
            if (data15.length < 3) {
              let err45 = { instancePath: instancePath + "/boundingSphere/center", schemaPath: "#/$defs/vec3/minItems", keyword: "minItems", params: { limit: 3 }, message: "must NOT have fewer than 3 items" };
              vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
            }
            let len1 = data15.length;
            for (let i2 = 0; i2 < len1; i2++) {
              let data16 = data15[i2];
              if (!(typeof data16 == "number" && isFinite(data16))) {
                let err46 = { instancePath: instancePath + "/boundingSphere/center/" + i2, schemaPath: "#/$defs/vec3/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                vErrors === null ? vErrors = [err46] : vErrors.push(err46), errors++;
              }
            }
          } else {
            let err47 = { instancePath: instancePath + "/boundingSphere/center", schemaPath: "#/$defs/vec3/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err47] : vErrors.push(err47), errors++;
          }
        }
        if (data14.radius !== void 0) {
          let data17 = data14.radius;
          if (typeof data17 == "number" && isFinite(data17)) {
            if (data17 < 0 || isNaN(data17)) {
              let err48 = { instancePath: instancePath + "/boundingSphere/radius", schemaPath: "#/properties/boundingSphere/properties/radius/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              vErrors === null ? vErrors = [err48] : vErrors.push(err48), errors++;
            }
          } else {
            let err49 = { instancePath: instancePath + "/boundingSphere/radius", schemaPath: "#/properties/boundingSphere/properties/radius/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err49] : vErrors.push(err49), errors++;
          }
        }
      } else {
        let err50 = { instancePath: instancePath + "/boundingSphere", schemaPath: "#/properties/boundingSphere/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err50] : vErrors.push(err50), errors++;
      }
    }
  } else {
    let err51 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err51] : vErrors.push(err51), errors++;
  }
  return validate65.errors = vErrors, errors === 0;
}
validate65.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate64(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate64.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.url === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.sha256 === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.bytes === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.kind === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.primitives === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "primitives" }, message: "must have required property 'primitives'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.preprocessing === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "preprocessing" }, message: "must have required property 'preprocessing'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.span === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "url" || key0 === "sha256" || key0 === "bytes" || key0 === "kind" || key0 === "primitives" || key0 === "preprocessing" || key0 === "span")) {
        let err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    if (data.url !== void 0) {
      let data0 = data.url;
      if (typeof data0 == "string") {
        if (!pattern23.test(data0)) {
          let err8 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/pattern", keyword: "pattern", params: { pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, message: 'must match pattern "^assets/[0-9a-f]{16}\\.[a-z0-9]+$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.sha256 !== void 0) {
      let data1 = data.sha256;
      if (typeof data1 == "string") {
        if (!pattern4.test(data1)) {
          let err10 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
      } else {
        let err11 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.bytes !== void 0) {
      let data2 = data.bytes;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err12 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err13 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "mesh-data") {
      let err14 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "mesh-data" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
    }
    if (data.primitives !== void 0) {
      let data4 = data.primitives;
      if (Array.isArray(data4)) {
        let len0 = data4.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate65(data4[i0], { instancePath: instancePath + "/primitives/" + i0, parentData: data4, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate65.errors : vErrors.concat(validate65.errors), errors = vErrors.length);
      } else {
        let err15 = { instancePath: instancePath + "/primitives", schemaPath: "#/properties/primitives/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.preprocessing !== void 0) {
      let data6 = data.preprocessing;
      if (Array.isArray(data6)) {
        let len1 = data6.length;
        for (let i1 = 0; i1 < len1; i1++) {
          let data7 = data6[i1];
          if (typeof data7 == "string") {
            if (data7.length < 1) {
              let err16 = { instancePath: instancePath + "/preprocessing/" + i1, schemaPath: "#/$defs/preprocessing/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
            }
          } else {
            let err17 = { instancePath: instancePath + "/preprocessing/" + i1, schemaPath: "#/$defs/preprocessing/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
        }
      } else {
        let err18 = { instancePath: instancePath + "/preprocessing", schemaPath: "#/$defs/preprocessing/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.span !== void 0) {
      let data8 = data.span;
      if (!(typeof data8 == "number" && !(data8 % 1) && !isNaN(data8) && isFinite(data8))) {
        let err19 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
      if (typeof data8 == "number" && isFinite(data8) && (data8 < 0 || isNaN(data8))) {
        let err20 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
  } else {
    let err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
  }
  return validate64.errors = vErrors, errors === 0;
}
validate64.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema119 = { type: "object", additionalProperties: !1, required: ["url", "sha256", "bytes", "kind", "colorSpace", "preprocessing", "span"], properties: { url: { $ref: "#/$defs/assetUrl" }, sha256: { $ref: "#/$defs/sha256" }, bytes: { $ref: "#/$defs/index" }, kind: { const: "image" }, colorSpace: { type: "string", enum: ["srgb", "linear"] }, preprocessing: { $ref: "#/$defs/preprocessing" }, span: { $ref: "#/$defs/spanId" }, source: { type: "string", minLength: 1, description: `The author's file (decision 0082): the project path of a standalone image, or "<glb path>#images[N]" for an image embedded in a GLB. Optional; shown by the runtime when the image fails.` } } };
function validate67(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate67.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.url === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.sha256 === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.bytes === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.kind === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.colorSpace === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "colorSpace" }, message: "must have required property 'colorSpace'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.preprocessing === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "preprocessing" }, message: "must have required property 'preprocessing'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.span === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "url" || key0 === "sha256" || key0 === "bytes" || key0 === "kind" || key0 === "colorSpace" || key0 === "preprocessing" || key0 === "span" || key0 === "source")) {
        let err7 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    if (data.url !== void 0) {
      let data0 = data.url;
      if (typeof data0 == "string") {
        if (!pattern23.test(data0)) {
          let err8 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/pattern", keyword: "pattern", params: { pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, message: 'must match pattern "^assets/[0-9a-f]{16}\\.[a-z0-9]+$"' };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.sha256 !== void 0) {
      let data1 = data.sha256;
      if (typeof data1 == "string") {
        if (!pattern4.test(data1)) {
          let err10 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
      } else {
        let err11 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.bytes !== void 0) {
      let data2 = data.bytes;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err12 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err13 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "image") {
      let err14 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "image" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
    }
    if (data.colorSpace !== void 0) {
      let data4 = data.colorSpace;
      if (typeof data4 != "string") {
        let err15 = { instancePath: instancePath + "/colorSpace", schemaPath: "#/properties/colorSpace/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
      if (!(data4 === "srgb" || data4 === "linear")) {
        let err16 = { instancePath: instancePath + "/colorSpace", schemaPath: "#/properties/colorSpace/enum", keyword: "enum", params: { allowedValues: schema119.properties.colorSpace.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.preprocessing !== void 0) {
      let data5 = data.preprocessing;
      if (Array.isArray(data5)) {
        let len0 = data5.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data6 = data5[i0];
          if (typeof data6 == "string") {
            if (data6.length < 1) {
              let err17 = { instancePath: instancePath + "/preprocessing/" + i0, schemaPath: "#/$defs/preprocessing/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
            }
          } else {
            let err18 = { instancePath: instancePath + "/preprocessing/" + i0, schemaPath: "#/$defs/preprocessing/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
          }
        }
      } else {
        let err19 = { instancePath: instancePath + "/preprocessing", schemaPath: "#/$defs/preprocessing/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    }
    if (data.span !== void 0) {
      let data7 = data.span;
      if (!(typeof data7 == "number" && !(data7 % 1) && !isNaN(data7) && isFinite(data7))) {
        let err20 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
      if (typeof data7 == "number" && isFinite(data7) && (data7 < 0 || isNaN(data7))) {
        let err21 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
    if (data.source !== void 0) {
      let data8 = data.source;
      if (typeof data8 == "string") {
        if (data8.length < 1) {
          let err22 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
        }
      } else {
        let err23 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
      }
    }
  } else {
    let err24 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
  }
  return validate67.errors = vErrors, errors === 0;
}
validate67.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema125 = { type: "object", description: "A sound file declared with asset.sound(..), copied byte for byte (spec/audio.md section 4, decision 0130).", additionalProperties: !1, required: ["url", "sha256", "bytes", "kind", "format", "mime", "source", "span"], properties: { url: { $ref: "#/$defs/assetUrl" }, sha256: { $ref: "#/$defs/sha256" }, bytes: { $ref: "#/$defs/index" }, kind: { const: "audio" }, format: { type: "string", enum: ["wav", "ogg", "mp3"] }, mime: { type: "string", enum: ["audio/wav", "audio/ogg", "audio/mpeg"] }, source: { type: "string", minLength: 1, description: "The project path of the declaring asset.sound(..); generated code names the sound by it." }, span: { $ref: "#/$defs/spanId" } } };
function validate68(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate68.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.url === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "url" }, message: "must have required property 'url'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.sha256 === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sha256" }, message: "must have required property 'sha256'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.bytes === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bytes" }, message: "must have required property 'bytes'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.kind === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.format === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "format" }, message: "must have required property 'format'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.mime === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mime" }, message: "must have required property 'mime'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.source === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.span === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "url" || key0 === "sha256" || key0 === "bytes" || key0 === "kind" || key0 === "format" || key0 === "mime" || key0 === "source" || key0 === "span")) {
        let err8 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    if (data.url !== void 0) {
      let data0 = data.url;
      if (typeof data0 == "string") {
        if (!pattern23.test(data0)) {
          let err9 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/pattern", keyword: "pattern", params: { pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, message: 'must match pattern "^assets/[0-9a-f]{16}\\.[a-z0-9]+$"' };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
      } else {
        let err10 = { instancePath: instancePath + "/url", schemaPath: "#/$defs/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.sha256 !== void 0) {
      let data1 = data.sha256;
      if (typeof data1 == "string") {
        if (!pattern4.test(data1)) {
          let err11 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
        }
      } else {
        let err12 = { instancePath: instancePath + "/sha256", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.bytes !== void 0) {
      let data2 = data.bytes;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err13 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err14 = { instancePath: instancePath + "/bytes", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "audio") {
      let err15 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "audio" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
    }
    if (data.format !== void 0) {
      let data4 = data.format;
      if (typeof data4 != "string") {
        let err16 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
      if (!(data4 === "wav" || data4 === "ogg" || data4 === "mp3")) {
        let err17 = { instancePath: instancePath + "/format", schemaPath: "#/properties/format/enum", keyword: "enum", params: { allowedValues: schema125.properties.format.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
    if (data.mime !== void 0) {
      let data5 = data.mime;
      if (typeof data5 != "string") {
        let err18 = { instancePath: instancePath + "/mime", schemaPath: "#/properties/mime/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
      if (!(data5 === "audio/wav" || data5 === "audio/ogg" || data5 === "audio/mpeg")) {
        let err19 = { instancePath: instancePath + "/mime", schemaPath: "#/properties/mime/enum", keyword: "enum", params: { allowedValues: schema125.properties.mime.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    }
    if (data.source !== void 0) {
      let data6 = data.source;
      if (typeof data6 == "string") {
        if (data6.length < 1) {
          let err20 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
        }
      } else {
        let err21 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
    if (data.span !== void 0) {
      let data7 = data.span;
      if (!(typeof data7 == "number" && !(data7 % 1) && !isNaN(data7) && isFinite(data7))) {
        let err22 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
      }
      if (typeof data7 == "number" && isFinite(data7) && (data7 < 0 || isNaN(data7))) {
        let err23 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
      }
    }
  } else {
    let err24 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
  }
  return validate68.errors = vErrors, errors === 0;
}
validate68.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate63(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate63.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "mesh-data") {
        validate64(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate64.errors : vErrors.concat(validate64.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "image")
        validate67(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate67.errors : vErrors.concat(validate67.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "audio")
        validate68(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err0 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    else {
      let err1 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
  } else {
    let err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
  }
  return validate63.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate63.evaluated = { dynamicProps: !0, dynamicItems: !1 };
var schema130 = { type: "object", description: "A prefab the program spawns (spec/runtime-abi.md section 5.6, decision 0064). In its bindings entity 0 is the instance and material instance 0 is its material.", additionalProperties: !1, required: ["symbol", "name", "params", "mesh", "material", "body", "collider", "state", "update", "fixedUpdate", "bindings", "span"], properties: { symbol: { $ref: "#/$defs/symbolId", description: "The key of the prefabs table of app.js." }, name: { $ref: "#/$defs/name" }, params: { type: "array", description: "The params in declaration order: the keys of the params object that spawn passes.", items: { type: "object", additionalProperties: !1, required: ["name", "type"], properties: { name: { $ref: "#/$defs/name" }, type: { $ref: "#/$defs/mtekTypeName" } } } }, mesh: { type: ["string", "null"], pattern: "^mesh:[0-9]+$", description: "Id of an entry of the meshes table, or null." }, material: { type: ["object", "null"], description: "The material instance every instance of the prefab starts with.", additionalProperties: !1, required: ["id", "params", "shareable"], properties: { id: { $ref: "#/$defs/symbolId" }, params: { type: "array", items: { $ref: "#/$defs/instanceParam" } }, shareable: { type: "boolean", description: "Every param is initial or a resource: instances with identical bytes may share one parameter block." } } }, body: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/body" } }, collider: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/collider" } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, update: { type: "boolean", description: "The prefab declares update(dt)." }, fixedUpdate: { type: "boolean", description: "The prefab declares fixed_update(dt)." }, bindings: { type: "array", items: { $ref: "#/$defs/binding" } }, span: { $ref: "#/$defs/spanId", description: "The declaration." } } };
function validate75(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate75.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.class === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "class" }, message: "must have required property 'class'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "class")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err3 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
        }
      } else {
        let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    }
    if (data.class !== void 0 && data.class !== "initial") {
      let err5 = { instancePath: instancePath + "/class", schemaPath: "#/properties/class/const", keyword: "const", params: { allowedValue: "initial" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate75.errors = vErrors, errors === 0;
}
validate75.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate76(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate76.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.class === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "class" }, message: "must have required property 'class'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "class")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err3 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
        }
      } else {
        let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    }
    if (data.class !== void 0 && data.class !== "imperative") {
      let err5 = { instancePath: instancePath + "/class", schemaPath: "#/properties/class/const", keyword: "const", params: { allowedValue: "imperative" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate76.errors = vErrors, errors === 0;
}
validate76.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate77(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate77.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.class === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "class" }, message: "must have required property 'class'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.binding === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "binding" }, message: "must have required property 'binding'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "class" || key0 === "binding")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.class !== void 0 && data.class !== "bound") {
      let err6 = { instancePath: instancePath + "/class", schemaPath: "#/properties/class/const", keyword: "const", params: { allowedValue: "bound" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.binding !== void 0) {
      let data2 = data.binding;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err7 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err8 = { instancePath: instancePath + "/binding", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate77.errors = vErrors, errors === 0;
}
validate77.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema149 = { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "builtin" }, name: { type: "string", enum: ["texture.white", "texture.black", "sampler.linear_repeat", "sampler.linear_clamp", "sampler.nearest_repeat", "sampler.nearest_clamp"] } } };
function validate80(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate80.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.asset === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "asset" }, message: "must have required property 'asset'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "asset")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "asset") {
      let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "asset" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.asset !== void 0) {
      let data1 = data.asset;
      if (typeof data1 == "string") {
        if (!pattern23.test(data1)) {
          let err4 = { instancePath: instancePath + "/asset", schemaPath: "#/$defs/assetUrl/pattern", keyword: "pattern", params: { pattern: "^assets/[0-9a-f]{16}\\.[a-z0-9]+$" }, message: 'must match pattern "^assets/[0-9a-f]{16}\\.[a-z0-9]+$"' };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/asset", schemaPath: "#/$defs/assetUrl/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate80.errors = vErrors, errors === 0;
}
validate80.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate79(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate79.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "builtin") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err0 = { instancePath, schemaPath: "#/$defs/builtinResourceValue/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
          }
          if (data.name === void 0) {
            let err1 = { instancePath, schemaPath: "#/$defs/builtinResourceValue/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
            vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
          }
          for (let key0 in data)
            if (!(key0 === "kind" || key0 === "name")) {
              let err2 = { instancePath, schemaPath: "#/$defs/builtinResourceValue/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "builtin") {
            let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/builtinResourceValue/properties/kind/const", keyword: "const", params: { allowedValue: "builtin" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          if (data.name !== void 0) {
            let data1 = data.name;
            if (typeof data1 != "string") {
              let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/builtinResourceValue/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
            }
            if (!(data1 === "texture.white" || data1 === "texture.black" || data1 === "sampler.linear_repeat" || data1 === "sampler.linear_clamp" || data1 === "sampler.nearest_repeat" || data1 === "sampler.nearest_clamp")) {
              let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/builtinResourceValue/properties/name/enum", keyword: "enum", params: { allowedValues: schema149.properties.name.enum }, message: "must be equal to one of the allowed values" };
              vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
            }
          }
        } else {
          let err6 = { instancePath, schemaPath: "#/$defs/builtinResourceValue/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
        var props0 = !0;
      } else if (tag0 === "asset")
        validate80(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err7 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    else {
      let err8 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate79.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate79.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate78(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate78.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.class === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "class" }, message: "must have required property 'class'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.value === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "class" || key0 === "value")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.class !== void 0 && data.class !== "resource") {
      let err6 = { instancePath: instancePath + "/class", schemaPath: "#/properties/class/const", keyword: "const", params: { allowedValue: "resource" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    data.value !== void 0 && (validate79(data.value, { instancePath: instancePath + "/value", parentData: data, parentDataProperty: "value", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate79.errors : vErrors.concat(validate79.errors), errors = vErrors.length));
  } else {
    let err7 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
  }
  return validate78.errors = vErrors, errors === 0;
}
validate78.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate74(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate74.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.class;
    if (typeof tag0 == "string")
      if (tag0 === "initial") {
        validate75(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate75.errors : vErrors.concat(validate75.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "imperative")
        validate76(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "bound")
        validate77(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate77.errors : vErrors.concat(validate77.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "resource")
        validate78(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate78.errors : vErrors.concat(validate78.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err0 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "class", tagValue: tag0 }, message: 'value of tag "class" must be in oneOf' };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    else {
      let err1 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "class", tagValue: tag0 }, message: 'tag "class" must be string' };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
  } else {
    let err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
  }
  return validate74.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate74.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate88(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate88.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "static") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err0 = { instancePath, schemaPath: "#/$defs/staticBody/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
          }
          for (let key0 in data)
            if (key0 !== "kind") {
              let err1 = { instancePath, schemaPath: "#/$defs/staticBody/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "static") {
            let err2 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/staticBody/properties/kind/const", keyword: "const", params: { allowedValue: "static" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
          }
        } else {
          let err3 = { instancePath, schemaPath: "#/$defs/staticBody/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
        }
        var props0 = !0;
      } else if (tag0 === "dynamic") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err4 = { instancePath, schemaPath: "#/$defs/dynamicBody/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
          }
          if (data.mass === void 0) {
            let err5 = { instancePath, schemaPath: "#/$defs/dynamicBody/required", keyword: "required", params: { missingProperty: "mass" }, message: "must have required property 'mass'" };
            vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
          }
          if (data.linearDamping === void 0) {
            let err6 = { instancePath, schemaPath: "#/$defs/dynamicBody/required", keyword: "required", params: { missingProperty: "linearDamping" }, message: "must have required property 'linearDamping'" };
            vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
          }
          if (data.angularDamping === void 0) {
            let err7 = { instancePath, schemaPath: "#/$defs/dynamicBody/required", keyword: "required", params: { missingProperty: "angularDamping" }, message: "must have required property 'angularDamping'" };
            vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
          }
          for (let key1 in data)
            if (!(key1 === "kind" || key1 === "mass" || key1 === "linearDamping" || key1 === "angularDamping")) {
              let err8 = { instancePath, schemaPath: "#/$defs/dynamicBody/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "dynamic") {
            let err9 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/dynamicBody/properties/kind/const", keyword: "const", params: { allowedValue: "dynamic" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
          }
          if (data.mass !== void 0) {
            let data2 = data.mass;
            if (typeof data2 == "number" && isFinite(data2)) {
              if (data2 <= 0 || isNaN(data2)) {
                let err10 = { instancePath: instancePath + "/mass", schemaPath: "#/$defs/dynamicBody/properties/mass/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
                vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
              }
            } else {
              let err11 = { instancePath: instancePath + "/mass", schemaPath: "#/$defs/dynamicBody/properties/mass/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
            }
          }
          if (data.linearDamping !== void 0) {
            let data3 = data.linearDamping;
            if (typeof data3 == "number" && isFinite(data3)) {
              if (data3 < 0 || isNaN(data3)) {
                let err12 = { instancePath: instancePath + "/linearDamping", schemaPath: "#/$defs/dynamicBody/properties/linearDamping/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
              }
            } else {
              let err13 = { instancePath: instancePath + "/linearDamping", schemaPath: "#/$defs/dynamicBody/properties/linearDamping/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
            }
          }
          if (data.angularDamping !== void 0) {
            let data4 = data.angularDamping;
            if (typeof data4 == "number" && isFinite(data4)) {
              if (data4 < 0 || isNaN(data4)) {
                let err14 = { instancePath: instancePath + "/angularDamping", schemaPath: "#/$defs/dynamicBody/properties/angularDamping/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
              }
            } else {
              let err15 = { instancePath: instancePath + "/angularDamping", schemaPath: "#/$defs/dynamicBody/properties/angularDamping/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
            }
          }
        } else {
          let err16 = { instancePath, schemaPath: "#/$defs/dynamicBody/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
        }
        props0 !== !0 && (props0 = !0);
      } else if (tag0 === "kinematic") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err17 = { instancePath, schemaPath: "#/$defs/kinematicBody/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
          for (let key2 in data)
            if (key2 !== "kind") {
              let err18 = { instancePath, schemaPath: "#/$defs/kinematicBody/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "kinematic") {
            let err19 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/kinematicBody/properties/kind/const", keyword: "const", params: { allowedValue: "kinematic" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
          }
        } else {
          let err20 = { instancePath, schemaPath: "#/$defs/kinematicBody/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
        }
        props0 !== !0 && (props0 = !0);
      } else {
        let err21 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    else {
      let err22 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
    }
  } else {
    let err23 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
  }
  return validate88.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate88.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate90(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate90.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "box") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err0 = { instancePath, schemaPath: "#/$defs/boxCollider/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
          }
          if (data.size === void 0) {
            let err1 = { instancePath, schemaPath: "#/$defs/boxCollider/required", keyword: "required", params: { missingProperty: "size" }, message: "must have required property 'size'" };
            vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
          }
          if (data.sensor === void 0) {
            let err2 = { instancePath, schemaPath: "#/$defs/boxCollider/required", keyword: "required", params: { missingProperty: "sensor" }, message: "must have required property 'sensor'" };
            vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
          }
          if (data.friction === void 0) {
            let err3 = { instancePath, schemaPath: "#/$defs/boxCollider/required", keyword: "required", params: { missingProperty: "friction" }, message: "must have required property 'friction'" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          if (data.restitution === void 0) {
            let err4 = { instancePath, schemaPath: "#/$defs/boxCollider/required", keyword: "required", params: { missingProperty: "restitution" }, message: "must have required property 'restitution'" };
            vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
          }
          for (let key0 in data)
            if (!(key0 === "kind" || key0 === "size" || key0 === "sensor" || key0 === "friction" || key0 === "restitution")) {
              let err5 = { instancePath, schemaPath: "#/$defs/boxCollider/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "box") {
            let err6 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/boxCollider/properties/kind/const", keyword: "const", params: { allowedValue: "box" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
          }
          if (data.size !== void 0) {
            let data1 = data.size;
            if (Array.isArray(data1)) {
              if (data1.length > 3) {
                let err7 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/boxCollider/properties/size/maxItems", keyword: "maxItems", params: { limit: 3 }, message: "must NOT have more than 3 items" };
                vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
              }
              if (data1.length < 3) {
                let err8 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/boxCollider/properties/size/minItems", keyword: "minItems", params: { limit: 3 }, message: "must NOT have fewer than 3 items" };
                vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
              }
              let len0 = data1.length;
              for (let i0 = 0; i0 < len0; i0++) {
                let data2 = data1[i0];
                if (typeof data2 == "number" && isFinite(data2)) {
                  if (data2 <= 0 || isNaN(data2)) {
                    let err9 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/$defs/boxCollider/properties/size/items/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
                    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
                  }
                } else {
                  let err10 = { instancePath: instancePath + "/size/" + i0, schemaPath: "#/$defs/boxCollider/properties/size/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                  vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
                }
              }
            } else {
              let err11 = { instancePath: instancePath + "/size", schemaPath: "#/$defs/boxCollider/properties/size/type", keyword: "type", params: { type: "array" }, message: "must be array" };
              vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
            }
          }
          if (data.sensor !== void 0 && typeof data.sensor != "boolean") {
            let err12 = { instancePath: instancePath + "/sensor", schemaPath: "#/$defs/boxCollider/properties/sensor/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
          }
          if (data.friction !== void 0) {
            let data4 = data.friction;
            if (typeof data4 == "number" && isFinite(data4)) {
              if (data4 < 0 || isNaN(data4)) {
                let err13 = { instancePath: instancePath + "/friction", schemaPath: "#/$defs/boxCollider/properties/friction/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
              }
            } else {
              let err14 = { instancePath: instancePath + "/friction", schemaPath: "#/$defs/boxCollider/properties/friction/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
            }
          }
          if (data.restitution !== void 0) {
            let data5 = data.restitution;
            if (typeof data5 == "number" && isFinite(data5)) {
              if (data5 > 1 || isNaN(data5)) {
                let err15 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/boxCollider/properties/restitution/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" };
                vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
              }
              if (data5 < 0 || isNaN(data5)) {
                let err16 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/boxCollider/properties/restitution/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
              }
            } else {
              let err17 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/boxCollider/properties/restitution/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
            }
          }
        } else {
          let err18 = { instancePath, schemaPath: "#/$defs/boxCollider/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
        }
        var props0 = !0;
      } else if (tag0 === "sphere") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err19 = { instancePath, schemaPath: "#/$defs/sphereCollider/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
          }
          if (data.radius === void 0) {
            let err20 = { instancePath, schemaPath: "#/$defs/sphereCollider/required", keyword: "required", params: { missingProperty: "radius" }, message: "must have required property 'radius'" };
            vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
          }
          if (data.sensor === void 0) {
            let err21 = { instancePath, schemaPath: "#/$defs/sphereCollider/required", keyword: "required", params: { missingProperty: "sensor" }, message: "must have required property 'sensor'" };
            vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
          }
          if (data.friction === void 0) {
            let err22 = { instancePath, schemaPath: "#/$defs/sphereCollider/required", keyword: "required", params: { missingProperty: "friction" }, message: "must have required property 'friction'" };
            vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
          }
          if (data.restitution === void 0) {
            let err23 = { instancePath, schemaPath: "#/$defs/sphereCollider/required", keyword: "required", params: { missingProperty: "restitution" }, message: "must have required property 'restitution'" };
            vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
          }
          for (let key1 in data)
            if (!(key1 === "kind" || key1 === "radius" || key1 === "sensor" || key1 === "friction" || key1 === "restitution")) {
              let err24 = { instancePath, schemaPath: "#/$defs/sphereCollider/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "sphere") {
            let err25 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/sphereCollider/properties/kind/const", keyword: "const", params: { allowedValue: "sphere" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
          }
          if (data.radius !== void 0) {
            let data7 = data.radius;
            if (typeof data7 == "number" && isFinite(data7)) {
              if (data7 <= 0 || isNaN(data7)) {
                let err26 = { instancePath: instancePath + "/radius", schemaPath: "#/$defs/sphereCollider/properties/radius/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
                vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
              }
            } else {
              let err27 = { instancePath: instancePath + "/radius", schemaPath: "#/$defs/sphereCollider/properties/radius/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
            }
          }
          if (data.sensor !== void 0 && typeof data.sensor != "boolean") {
            let err28 = { instancePath: instancePath + "/sensor", schemaPath: "#/$defs/sphereCollider/properties/sensor/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
          }
          if (data.friction !== void 0) {
            let data9 = data.friction;
            if (typeof data9 == "number" && isFinite(data9)) {
              if (data9 < 0 || isNaN(data9)) {
                let err29 = { instancePath: instancePath + "/friction", schemaPath: "#/$defs/sphereCollider/properties/friction/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
              }
            } else {
              let err30 = { instancePath: instancePath + "/friction", schemaPath: "#/$defs/sphereCollider/properties/friction/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
            }
          }
          if (data.restitution !== void 0) {
            let data10 = data.restitution;
            if (typeof data10 == "number" && isFinite(data10)) {
              if (data10 > 1 || isNaN(data10)) {
                let err31 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/sphereCollider/properties/restitution/maximum", keyword: "maximum", params: { comparison: "<=", limit: 1 }, message: "must be <= 1" };
                vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
              }
              if (data10 < 0 || isNaN(data10)) {
                let err32 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/sphereCollider/properties/restitution/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
              }
            } else {
              let err33 = { instancePath: instancePath + "/restitution", schemaPath: "#/$defs/sphereCollider/properties/restitution/type", keyword: "type", params: { type: "number" }, message: "must be number" };
              vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
            }
          }
        } else {
          let err34 = { instancePath, schemaPath: "#/$defs/sphereCollider/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
        }
        props0 !== !0 && (props0 = !0);
      } else {
        let err35 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
      }
    else {
      let err36 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
    }
  } else {
    let err37 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
  }
  return validate90.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate90.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate92(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate92.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.type === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.symbol === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbol" }, message: "must have required property 'symbol'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "type" || key0 === "symbol")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.type !== void 0) {
      let data1 = data.type;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err6 = { instancePath: instancePath + "/type", schemaPath: "#/$defs/mtekTypeName/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
      } else {
        let err7 = { instancePath: instancePath + "/type", schemaPath: "#/$defs/mtekTypeName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.symbol !== void 0) {
      let data2 = data.symbol;
      if (typeof data2 == "string") {
        if (data2.length < 1) {
          let err8 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
  } else {
    let err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
  }
  return validate92.errors = vErrors, errors === 0;
}
validate92.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema173 = { type: "object", additionalProperties: !1, required: ["kind", "field"], properties: { kind: { const: "camera" }, field: { type: "string", enum: ["position", "target", "rotation", "projection.fov_y", "projection.height", "projection.near", "projection.far"] } } }, schema164 = { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "transform" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["position", "rotation", "scale"] } } };
function validate96(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate96.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.field === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "field" }, message: "must have required property 'field'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity" || key0 === "field")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "transform") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "transform" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.field !== void 0) {
      let data2 = data.field;
      if (typeof data2 != "string") {
        let err7 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (!(data2 === "position" || data2 === "rotation" || data2 === "scale")) {
        let err8 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/enum", keyword: "enum", params: { allowedValues: schema164.properties.field.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate96.errors = vErrors, errors === 0;
}
validate96.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate97(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate97.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "visible") {
      let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "visible" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err4 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate97.errors = vErrors, errors === 0;
}
validate97.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate98(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate98.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.instance === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "instance" }, message: "must have required property 'instance'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.name === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "instance" || key0 === "name")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "param") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "param" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.instance !== void 0) {
      let data1 = data.instance;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/instance", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/instance", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.name !== void 0) {
      let data2 = data.name;
      if (typeof data2 == "string") {
        if (data2.length < 1) {
          let err7 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate98.errors = vErrors, errors === 0;
}
validate98.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema171 = { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "light" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["color", "intensity"] } } };
function validate99(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate99.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.field === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "field" }, message: "must have required property 'field'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity" || key0 === "field")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "light") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "light" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.field !== void 0) {
      let data2 = data.field;
      if (typeof data2 != "string") {
        let err7 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (!(data2 === "color" || data2 === "intensity")) {
        let err8 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/enum", keyword: "enum", params: { allowedValues: schema171.properties.field.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate99.errors = vErrors, errors === 0;
}
validate99.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate95(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate95.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "transform") {
        validate96(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate96.errors : vErrors.concat(validate96.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "visible")
        validate97(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "param")
        validate98(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate98.errors : vErrors.concat(validate98.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "camera") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err0 = { instancePath, schemaPath: "#/$defs/cameraTarget/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
          }
          if (data.field === void 0) {
            let err1 = { instancePath, schemaPath: "#/$defs/cameraTarget/required", keyword: "required", params: { missingProperty: "field" }, message: "must have required property 'field'" };
            vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
          }
          for (let key0 in data)
            if (!(key0 === "kind" || key0 === "field")) {
              let err2 = { instancePath, schemaPath: "#/$defs/cameraTarget/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "camera") {
            let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/cameraTarget/properties/kind/const", keyword: "const", params: { allowedValue: "camera" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          if (data.field !== void 0) {
            let data1 = data.field;
            if (typeof data1 != "string") {
              let err4 = { instancePath: instancePath + "/field", schemaPath: "#/$defs/cameraTarget/properties/field/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
            }
            if (!(data1 === "position" || data1 === "target" || data1 === "rotation" || data1 === "projection.fov_y" || data1 === "projection.height" || data1 === "projection.near" || data1 === "projection.far")) {
              let err5 = { instancePath: instancePath + "/field", schemaPath: "#/$defs/cameraTarget/properties/field/enum", keyword: "enum", params: { allowedValues: schema173.properties.field.enum }, message: "must be equal to one of the allowed values" };
              vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
            }
          }
        } else {
          let err6 = { instancePath, schemaPath: "#/$defs/cameraTarget/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
        props0 !== !0 && (props0 = !0);
      } else if (tag0 === "light")
        validate99(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate99.errors : vErrors.concat(validate99.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err7 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    else {
      let err8 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate95.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate95.evaluated = { dynamicProps: !0, dynamicItems: !1 };
var schema187 = { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "frame" }, name: { type: "string", enum: ["time", "delta", "index"] } } };
function validate106(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate106.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.name === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "name")) {
        let err2 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "state") {
      let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "state" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
  } else {
    let err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
  }
  return validate106.errors = vErrors, errors === 0;
}
validate106.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema177 = { type: "object", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "entityField" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["position", "rotation", "scale", "visible"] } } };
function validate107(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate107.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.field === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "field" }, message: "must have required property 'field'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity" || key0 === "field")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "entityField") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "entityField" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.field !== void 0) {
      let data2 = data.field;
      if (typeof data2 != "string") {
        let err7 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (!(data2 === "position" || data2 === "rotation" || data2 === "scale" || data2 === "visible")) {
        let err8 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/enum", keyword: "enum", params: { allowedValues: schema177.properties.field.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate107.errors = vErrors, errors === 0;
}
validate107.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate108(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate108.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.name === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity" || key0 === "name")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "entityState") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "entityState" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.name !== void 0) {
      let data2 = data.name;
      if (typeof data2 == "string") {
        if (data2.length < 1) {
          let err7 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate108.errors = vErrors, errors === 0;
}
validate108.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate109(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate109.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.instance === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "instance" }, message: "must have required property 'instance'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.name === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "instance" || key0 === "name")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "param") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "param" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.instance !== void 0) {
      let data1 = data.instance;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/instance", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/instance", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.name !== void 0) {
      let data2 = data.name;
      if (typeof data2 == "string") {
        if (data2.length < 1) {
          let err7 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate109.errors = vErrors, errors === 0;
}
validate109.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema185 = { type: "object", description: "A read of the colour or intensity of the light of an entity (decision 0067); `range` is fixed at construction and is not a dependency.", additionalProperties: !1, required: ["kind", "entity", "field"], properties: { kind: { const: "light" }, entity: { $ref: "#/$defs/index" }, field: { type: "string", enum: ["color", "intensity"] } } };
function validate110(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate110.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.kind === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.field === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "field" }, message: "must have required property 'field'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "kind" || key0 === "entity" || key0 === "field")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.kind !== void 0 && data.kind !== "light") {
      let err4 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "light" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err5 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err6 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.field !== void 0) {
      let data2 = data.field;
      if (typeof data2 != "string") {
        let err7 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (!(data2 === "color" || data2 === "intensity")) {
        let err8 = { instancePath: instancePath + "/field", schemaPath: "#/properties/field/enum", keyword: "enum", params: { allowedValues: schema185.properties.field.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate110.errors = vErrors, errors === 0;
}
validate110.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate105(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate105.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "state") {
        validate106(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate106.errors : vErrors.concat(validate106.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "frame") {
        if (data && typeof data == "object" && !Array.isArray(data)) {
          if (data.kind === void 0) {
            let err0 = { instancePath, schemaPath: "#/$defs/frameDep/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
            vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
          }
          if (data.name === void 0) {
            let err1 = { instancePath, schemaPath: "#/$defs/frameDep/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
            vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
          }
          for (let key0 in data)
            if (!(key0 === "kind" || key0 === "name")) {
              let err2 = { instancePath, schemaPath: "#/$defs/frameDep/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
            }
          if (data.kind !== void 0 && data.kind !== "frame") {
            let err3 = { instancePath: instancePath + "/kind", schemaPath: "#/$defs/frameDep/properties/kind/const", keyword: "const", params: { allowedValue: "frame" }, message: "must be equal to constant" };
            vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
          }
          if (data.name !== void 0) {
            let data1 = data.name;
            if (typeof data1 != "string") {
              let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/frameDep/properties/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
              vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
            }
            if (!(data1 === "time" || data1 === "delta" || data1 === "index")) {
              let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/frameDep/properties/name/enum", keyword: "enum", params: { allowedValues: schema187.properties.name.enum }, message: "must be equal to one of the allowed values" };
              vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
            }
          }
        } else {
          let err6 = { instancePath, schemaPath: "#/$defs/frameDep/type", keyword: "type", params: { type: "object" }, message: "must be object" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
        props0 !== !0 && (props0 = !0);
      } else if (tag0 === "entityField")
        validate107(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate107.errors : vErrors.concat(validate107.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "entityState")
        validate108(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate108.errors : vErrors.concat(validate108.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "param")
        validate109(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate109.errors : vErrors.concat(validate109.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else if (tag0 === "light")
        validate110(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate110.errors : vErrors.concat(validate110.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err7 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    else {
      let err8 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
  } else {
    let err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
  }
  return validate105.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate105.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate94(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate94.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.id === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.target === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.deps === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "deps" }, message: "must have required property 'deps'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.order === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "order" }, message: "must have required property 'order'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.span === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "id" || key0 === "target" || key0 === "deps" || key0 === "order" || key0 === "span")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.id !== void 0) {
      let data0 = data.id;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err6 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err7 = { instancePath: instancePath + "/id", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.target !== void 0 && (validate95(data.target, { instancePath: instancePath + "/target", parentData: data, parentDataProperty: "target", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate95.errors : vErrors.concat(validate95.errors), errors = vErrors.length)), data.deps !== void 0) {
      let data2 = data.deps;
      if (Array.isArray(data2)) {
        let len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate105(data2[i0], { instancePath: instancePath + "/deps/" + i0, parentData: data2, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate105.errors : vErrors.concat(validate105.errors), errors = vErrors.length);
      } else {
        let err8 = { instancePath: instancePath + "/deps", schemaPath: "#/properties/deps/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.order !== void 0) {
      let data4 = data.order;
      if (!(typeof data4 == "number" && !(data4 % 1) && !isNaN(data4) && isFinite(data4))) {
        let err9 = { instancePath: instancePath + "/order", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
      if (typeof data4 == "number" && isFinite(data4) && (data4 < 0 || isNaN(data4))) {
        let err10 = { instancePath: instancePath + "/order", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.span !== void 0) {
      let data5 = data.span;
      if (!(typeof data5 == "number" && !(data5 % 1) && !isNaN(data5) && isFinite(data5))) {
        let err11 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (typeof data5 == "number" && isFinite(data5) && (data5 < 0 || isNaN(data5))) {
        let err12 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
  } else {
    let err13 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
  }
  return validate94.errors = vErrors, errors === 0;
}
validate94.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate73(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate73.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.symbol === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbol" }, message: "must have required property 'symbol'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.name === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.params === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "params" }, message: "must have required property 'params'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.mesh === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mesh" }, message: "must have required property 'mesh'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.material === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "material" }, message: "must have required property 'material'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.body === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.collider === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "collider" }, message: "must have required property 'collider'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.state === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.update === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "update" }, message: "must have required property 'update'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.fixedUpdate === void 0) {
      let err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "fixedUpdate" }, message: "must have required property 'fixedUpdate'" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.bindings === void 0) {
      let err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bindings" }, message: "must have required property 'bindings'" };
      vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
    }
    if (data.span === void 0) {
      let err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "span" }, message: "must have required property 'span'" };
      vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
    }
    for (let key0 in data)
      if (!func1.call(schema130.properties, key0)) {
        let err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    if (data.symbol !== void 0) {
      let data0 = data.symbol;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err13 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      } else {
        let err14 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err15 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
      } else {
        let err16 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.params !== void 0) {
      let data2 = data.params;
      if (Array.isArray(data2)) {
        let len0 = data2.length;
        for (let i0 = 0; i0 < len0; i0++) {
          let data3 = data2[i0];
          if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
            if (data3.name === void 0) {
              let err17 = { instancePath: instancePath + "/params/" + i0, schemaPath: "#/properties/params/items/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
              vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
            }
            if (data3.type === void 0) {
              let err18 = { instancePath: instancePath + "/params/" + i0, schemaPath: "#/properties/params/items/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
              vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
            }
            for (let key1 in data3)
              if (!(key1 === "name" || key1 === "type")) {
                let err19 = { instancePath: instancePath + "/params/" + i0, schemaPath: "#/properties/params/items/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
              }
            if (data3.name !== void 0) {
              let data4 = data3.name;
              if (typeof data4 == "string") {
                if (data4.length < 1) {
                  let err20 = { instancePath: instancePath + "/params/" + i0 + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
                }
              } else {
                let err21 = { instancePath: instancePath + "/params/" + i0 + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
              }
            }
            if (data3.type !== void 0) {
              let data5 = data3.type;
              if (typeof data5 == "string") {
                if (data5.length < 1) {
                  let err22 = { instancePath: instancePath + "/params/" + i0 + "/type", schemaPath: "#/$defs/mtekTypeName/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
                }
              } else {
                let err23 = { instancePath: instancePath + "/params/" + i0 + "/type", schemaPath: "#/$defs/mtekTypeName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
              }
            }
          } else {
            let err24 = { instancePath: instancePath + "/params/" + i0, schemaPath: "#/properties/params/items/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
          }
        }
      } else {
        let err25 = { instancePath: instancePath + "/params", schemaPath: "#/properties/params/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
      }
    }
    if (data.mesh !== void 0) {
      let data6 = data.mesh;
      if (typeof data6 != "string" && data6 !== null) {
        let err26 = { instancePath: instancePath + "/mesh", schemaPath: "#/properties/mesh/type", keyword: "type", params: { type: schema130.properties.mesh.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
      }
      if (typeof data6 == "string" && !pattern19.test(data6)) {
        let err27 = { instancePath: instancePath + "/mesh", schemaPath: "#/properties/mesh/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
        vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
      }
    }
    if (data.material !== void 0) {
      let data7 = data.material;
      if (!(data7 && typeof data7 == "object" && !Array.isArray(data7)) && data7 !== null) {
        let err28 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/type", keyword: "type", params: { type: schema130.properties.material.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
      }
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        if (data7.id === void 0) {
          let err29 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
        }
        if (data7.params === void 0) {
          let err30 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/required", keyword: "required", params: { missingProperty: "params" }, message: "must have required property 'params'" };
          vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
        }
        if (data7.shareable === void 0) {
          let err31 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/required", keyword: "required", params: { missingProperty: "shareable" }, message: "must have required property 'shareable'" };
          vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
        }
        for (let key2 in data7)
          if (!(key2 === "id" || key2 === "params" || key2 === "shareable")) {
            let err32 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
          }
        if (data7.id !== void 0) {
          let data8 = data7.id;
          if (typeof data8 == "string") {
            if (data8.length < 1) {
              let err33 = { instancePath: instancePath + "/material/id", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
            }
          } else {
            let err34 = { instancePath: instancePath + "/material/id", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
          }
        }
        if (data7.params !== void 0) {
          let data9 = data7.params;
          if (Array.isArray(data9)) {
            let len1 = data9.length;
            for (let i1 = 0; i1 < len1; i1++)
              validate74(data9[i1], { instancePath: instancePath + "/material/params/" + i1, parentData: data9, parentDataProperty: i1, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors), errors = vErrors.length);
          } else {
            let err35 = { instancePath: instancePath + "/material/params", schemaPath: "#/properties/material/properties/params/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
          }
        }
        if (data7.shareable !== void 0 && typeof data7.shareable != "boolean") {
          let err36 = { instancePath: instancePath + "/material/shareable", schemaPath: "#/properties/material/properties/shareable/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
          vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
        }
      }
    }
    if (data.body !== void 0) {
      let data12 = data.body;
      if (!(data12 && typeof data12 == "object" && !Array.isArray(data12)) && data12 !== null) {
        let err37 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/type", keyword: "type", params: { type: schema130.properties.body.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
      }
      let _errs34 = errors, valid12 = !0, _errs35 = errors;
      if (!(data12 && typeof data12 == "object" && !Array.isArray(data12))) {
        let err38 = {};
        vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
      }
      var _valid0 = _errs35 === errors;
      if (errors = _errs34, vErrors !== null && (_errs34 ? vErrors.length = _errs34 : vErrors = null), _valid0) {
        let _errs37 = errors;
        validate88(data12, { instancePath: instancePath + "/body", parentData: data, parentDataProperty: "body", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors), errors = vErrors.length);
        var _valid0 = _errs37 === errors;
        valid12 = _valid0;
      }
      if (!valid12) {
        let err39 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
        vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
      }
    }
    if (data.collider !== void 0) {
      let data13 = data.collider;
      if (!(data13 && typeof data13 == "object" && !Array.isArray(data13)) && data13 !== null) {
        let err40 = { instancePath: instancePath + "/collider", schemaPath: "#/properties/collider/type", keyword: "type", params: { type: schema130.properties.collider.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
      }
      let _errs40 = errors, valid13 = !0, _errs41 = errors;
      if (!(data13 && typeof data13 == "object" && !Array.isArray(data13))) {
        let err41 = {};
        vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
      }
      var _valid1 = _errs41 === errors;
      if (errors = _errs40, vErrors !== null && (_errs40 ? vErrors.length = _errs40 : vErrors = null), _valid1) {
        let _errs43 = errors;
        validate90(data13, { instancePath: instancePath + "/collider", parentData: data, parentDataProperty: "collider", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate90.errors : vErrors.concat(validate90.errors), errors = vErrors.length);
        var _valid1 = _errs43 === errors;
        valid13 = _valid1;
      }
      if (!valid13) {
        let err42 = { instancePath: instancePath + "/collider", schemaPath: "#/properties/collider/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
        vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
      }
    }
    if (data.state !== void 0) {
      let data14 = data.state;
      if (Array.isArray(data14)) {
        let len2 = data14.length;
        for (let i2 = 0; i2 < len2; i2++)
          validate92(data14[i2], { instancePath: instancePath + "/state/" + i2, parentData: data14, parentDataProperty: i2, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate92.errors : vErrors.concat(validate92.errors), errors = vErrors.length);
      } else {
        let err43 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
      }
    }
    if (data.update !== void 0 && typeof data.update != "boolean") {
      let err44 = { instancePath: instancePath + "/update", schemaPath: "#/properties/update/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
    }
    if (data.fixedUpdate !== void 0 && typeof data.fixedUpdate != "boolean") {
      let err45 = { instancePath: instancePath + "/fixedUpdate", schemaPath: "#/properties/fixedUpdate/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
    }
    if (data.bindings !== void 0) {
      let data18 = data.bindings;
      if (Array.isArray(data18)) {
        let len3 = data18.length;
        for (let i3 = 0; i3 < len3; i3++)
          validate94(data18[i3], { instancePath: instancePath + "/bindings/" + i3, parentData: data18, parentDataProperty: i3, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate94.errors : vErrors.concat(validate94.errors), errors = vErrors.length);
      } else {
        let err46 = { instancePath: instancePath + "/bindings", schemaPath: "#/properties/bindings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err46] : vErrors.push(err46), errors++;
      }
    }
    if (data.span !== void 0) {
      let data20 = data.span;
      if (!(typeof data20 == "number" && !(data20 % 1) && !isNaN(data20) && isFinite(data20))) {
        let err47 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err47] : vErrors.push(err47), errors++;
      }
      if (typeof data20 == "number" && isFinite(data20) && (data20 < 0 || isNaN(data20))) {
        let err48 = { instancePath: instancePath + "/span", schemaPath: "#/$defs/spanId/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err48] : vErrors.push(err48), errors++;
      }
    }
  } else {
    let err49 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err49] : vErrors.push(err49), errors++;
  }
  return validate73.errors = vErrors, errors === 0;
}
validate73.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema191 = { type: "object", description: "Scene structure (spec/runtime-abi.md section 5.2).", additionalProperties: !1, required: ["name", "symbol", "fields", "state", "cameras", "entities", "materialInstances", "bindings", "hostInputs", "lights"], properties: { name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, fields: { type: "object", description: "Constant scene field values; linear colours as [r, g, b, a].", additionalProperties: !1, required: ["clearColor", "ambientColor", "ambientIntensity", "gravity"], properties: { clearColor: { $ref: "#/$defs/vec4" }, ambientColor: { $ref: "#/$defs/vec4" }, ambientIntensity: { type: "number", minimum: 0 }, gravity: { $ref: "#/$defs/vec3" } } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, cameras: { type: "array", items: { $ref: "#/$defs/camera" } }, entities: { type: "array", items: { $ref: "#/$defs/entity" } }, materialInstances: { type: "array", items: { $ref: "#/$defs/materialInstance" } }, bindings: { type: "array", items: { $ref: "#/$defs/binding" } }, hostInputs: { type: "array", items: { $ref: "#/$defs/hostInput" } }, hostOutputs: { type: "array", items: { $ref: "#/$defs/hostOutput" } }, lights: { type: "array", items: { $ref: "#/$defs/light" } } } };
var schema197 = { type: "object", additionalProperties: !1, required: ["name", "symbol", "projection", "hasTarget", "active", "exposure"], properties: { name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, projection: { type: "string", enum: ["perspective", "orthographic"] }, hasTarget: { type: "boolean" }, active: { type: "boolean" }, exposure: { type: "number", description: "EV100 of the camera (decision 0081); lit materials are scaled by 1 / (1.2 * 2^exposure)." } } };
function validate121(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate121.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.symbol === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbol" }, message: "must have required property 'symbol'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.projection === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "projection" }, message: "must have required property 'projection'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.hasTarget === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hasTarget" }, message: "must have required property 'hasTarget'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.active === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "active" }, message: "must have required property 'active'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.exposure === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "exposure" }, message: "must have required property 'exposure'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "symbol" || key0 === "projection" || key0 === "hasTarget" || key0 === "active" || key0 === "exposure")) {
        let err6 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err7 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
      } else {
        let err8 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.symbol !== void 0) {
      let data1 = data.symbol;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err9 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
      } else {
        let err10 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    }
    if (data.projection !== void 0) {
      let data2 = data.projection;
      if (typeof data2 != "string") {
        let err11 = { instancePath: instancePath + "/projection", schemaPath: "#/properties/projection/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
      if (!(data2 === "perspective" || data2 === "orthographic")) {
        let err12 = { instancePath: instancePath + "/projection", schemaPath: "#/properties/projection/enum", keyword: "enum", params: { allowedValues: schema197.properties.projection.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.hasTarget !== void 0 && typeof data.hasTarget != "boolean") {
      let err13 = { instancePath: instancePath + "/hasTarget", schemaPath: "#/properties/hasTarget/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
    }
    if (data.active !== void 0 && typeof data.active != "boolean") {
      let err14 = { instancePath: instancePath + "/active", schemaPath: "#/properties/active/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
    }
    if (data.exposure !== void 0) {
      let data5 = data.exposure;
      if (!(typeof data5 == "number" && isFinite(data5))) {
        let err15 = { instancePath: instancePath + "/exposure", schemaPath: "#/properties/exposure/type", keyword: "type", params: { type: "number" }, message: "must be number" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
  } else {
    let err16 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
  }
  return validate121.errors = vErrors, errors === 0;
}
validate121.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema200 = { type: "object", additionalProperties: !1, required: ["index", "name", "symbol", "parent", "mesh", "material", "light", "body", "collider", "state", "update", "fixedUpdate"], properties: { index: { $ref: "#/$defs/index", description: "Static entity index in stable instance order (depth-first pre-order)." }, name: { $ref: "#/$defs/name" }, symbol: { $ref: "#/$defs/symbolId" }, parent: { type: ["integer", "null"], minimum: 0, description: "Index of the parent entity, or null for a root." }, mesh: { type: ["string", "null"], pattern: "^mesh:[0-9]+$", description: "Id of an entry of the meshes table, or null." }, material: { type: ["object", "null"], additionalProperties: !1, required: ["id", "instance"], properties: { id: { $ref: "#/$defs/symbolId" }, instance: { $ref: "#/$defs/index", description: "Index into scene.materialInstances." } } }, light: { type: ["integer", "null"], minimum: 0, description: "Index into scene.lights, or null." }, body: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/body" } }, collider: { type: ["object", "null"], if: { type: "object" }, then: { $ref: "#/$defs/collider" } }, state: { type: "array", items: { $ref: "#/$defs/stateEntry" } }, update: { type: "boolean", description: "The entity declares update(dt)." }, fixedUpdate: { type: "boolean", description: "The entity declares fixed_update(dt)." } } };
function validate123(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate123.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.index === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.name === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.symbol === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbol" }, message: "must have required property 'symbol'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.parent === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "parent" }, message: "must have required property 'parent'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.mesh === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "mesh" }, message: "must have required property 'mesh'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.material === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "material" }, message: "must have required property 'material'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.light === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "light" }, message: "must have required property 'light'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.body === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "body" }, message: "must have required property 'body'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.collider === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "collider" }, message: "must have required property 'collider'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.state === void 0) {
      let err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.update === void 0) {
      let err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "update" }, message: "must have required property 'update'" };
      vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
    }
    if (data.fixedUpdate === void 0) {
      let err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "fixedUpdate" }, message: "must have required property 'fixedUpdate'" };
      vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
    }
    for (let key0 in data)
      if (!func1.call(schema200.properties, key0)) {
        let err12 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    if (data.index !== void 0) {
      let data0 = data.index;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err13 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err14 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.name !== void 0) {
      let data1 = data.name;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err15 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
      } else {
        let err16 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
    }
    if (data.symbol !== void 0) {
      let data2 = data.symbol;
      if (typeof data2 == "string") {
        if (data2.length < 1) {
          let err17 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
        }
      } else {
        let err18 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
      }
    }
    if (data.parent !== void 0) {
      let data3 = data.parent;
      if (!(typeof data3 == "number" && !(data3 % 1) && !isNaN(data3) && isFinite(data3)) && data3 !== null) {
        let err19 = { instancePath: instancePath + "/parent", schemaPath: "#/properties/parent/type", keyword: "type", params: { type: schema200.properties.parent.type }, message: "must be integer,null" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
      if (typeof data3 == "number" && isFinite(data3) && (data3 < 0 || isNaN(data3))) {
        let err20 = { instancePath: instancePath + "/parent", schemaPath: "#/properties/parent/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
    if (data.mesh !== void 0) {
      let data4 = data.mesh;
      if (typeof data4 != "string" && data4 !== null) {
        let err21 = { instancePath: instancePath + "/mesh", schemaPath: "#/properties/mesh/type", keyword: "type", params: { type: schema200.properties.mesh.type }, message: "must be string,null" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
      if (typeof data4 == "string" && !pattern19.test(data4)) {
        let err22 = { instancePath: instancePath + "/mesh", schemaPath: "#/properties/mesh/pattern", keyword: "pattern", params: { pattern: "^mesh:[0-9]+$" }, message: 'must match pattern "^mesh:[0-9]+$"' };
        vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
      }
    }
    if (data.material !== void 0) {
      let data5 = data.material;
      if (!(data5 && typeof data5 == "object" && !Array.isArray(data5)) && data5 !== null) {
        let err23 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/type", keyword: "type", params: { type: schema200.properties.material.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
      }
      if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
        if (data5.id === void 0) {
          let err24 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
        }
        if (data5.instance === void 0) {
          let err25 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/required", keyword: "required", params: { missingProperty: "instance" }, message: "must have required property 'instance'" };
          vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
        }
        for (let key1 in data5)
          if (!(key1 === "id" || key1 === "instance")) {
            let err26 = { instancePath: instancePath + "/material", schemaPath: "#/properties/material/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
          }
        if (data5.id !== void 0) {
          let data6 = data5.id;
          if (typeof data6 == "string") {
            if (data6.length < 1) {
              let err27 = { instancePath: instancePath + "/material/id", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
            }
          } else {
            let err28 = { instancePath: instancePath + "/material/id", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
          }
        }
        if (data5.instance !== void 0) {
          let data7 = data5.instance;
          if (!(typeof data7 == "number" && !(data7 % 1) && !isNaN(data7) && isFinite(data7))) {
            let err29 = { instancePath: instancePath + "/material/instance", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
          }
          if (typeof data7 == "number" && isFinite(data7) && (data7 < 0 || isNaN(data7))) {
            let err30 = { instancePath: instancePath + "/material/instance", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
            vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
          }
        }
      }
    }
    if (data.light !== void 0) {
      let data8 = data.light;
      if (!(typeof data8 == "number" && !(data8 % 1) && !isNaN(data8) && isFinite(data8)) && data8 !== null) {
        let err31 = { instancePath: instancePath + "/light", schemaPath: "#/properties/light/type", keyword: "type", params: { type: schema200.properties.light.type }, message: "must be integer,null" };
        vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
      }
      if (typeof data8 == "number" && isFinite(data8) && (data8 < 0 || isNaN(data8))) {
        let err32 = { instancePath: instancePath + "/light", schemaPath: "#/properties/light/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
      }
    }
    if (data.body !== void 0) {
      let data9 = data.body;
      if (!(data9 && typeof data9 == "object" && !Array.isArray(data9)) && data9 !== null) {
        let err33 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/type", keyword: "type", params: { type: schema200.properties.body.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
      }
      let _errs28 = errors, valid7 = !0, _errs29 = errors;
      if (!(data9 && typeof data9 == "object" && !Array.isArray(data9))) {
        let err34 = {};
        vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
      }
      var _valid0 = _errs29 === errors;
      if (errors = _errs28, vErrors !== null && (_errs28 ? vErrors.length = _errs28 : vErrors = null), _valid0) {
        let _errs31 = errors;
        validate88(data9, { instancePath: instancePath + "/body", parentData: data, parentDataProperty: "body", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate88.errors : vErrors.concat(validate88.errors), errors = vErrors.length);
        var _valid0 = _errs31 === errors;
        valid7 = _valid0;
      }
      if (!valid7) {
        let err35 = { instancePath: instancePath + "/body", schemaPath: "#/properties/body/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
        vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
      }
    }
    if (data.collider !== void 0) {
      let data10 = data.collider;
      if (!(data10 && typeof data10 == "object" && !Array.isArray(data10)) && data10 !== null) {
        let err36 = { instancePath: instancePath + "/collider", schemaPath: "#/properties/collider/type", keyword: "type", params: { type: schema200.properties.collider.type }, message: "must be object,null" };
        vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
      }
      let _errs34 = errors, valid8 = !0, _errs35 = errors;
      if (!(data10 && typeof data10 == "object" && !Array.isArray(data10))) {
        let err37 = {};
        vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
      }
      var _valid1 = _errs35 === errors;
      if (errors = _errs34, vErrors !== null && (_errs34 ? vErrors.length = _errs34 : vErrors = null), _valid1) {
        let _errs37 = errors;
        validate90(data10, { instancePath: instancePath + "/collider", parentData: data, parentDataProperty: "collider", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate90.errors : vErrors.concat(validate90.errors), errors = vErrors.length);
        var _valid1 = _errs37 === errors;
        valid8 = _valid1;
      }
      if (!valid8) {
        let err38 = { instancePath: instancePath + "/collider", schemaPath: "#/properties/collider/if", keyword: "if", params: { failingKeyword: "then" }, message: 'must match "then" schema' };
        vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
      }
    }
    if (data.state !== void 0) {
      let data11 = data.state;
      if (Array.isArray(data11)) {
        let len0 = data11.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate92(data11[i0], { instancePath: instancePath + "/state/" + i0, parentData: data11, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate92.errors : vErrors.concat(validate92.errors), errors = vErrors.length);
      } else {
        let err39 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
      }
    }
    if (data.update !== void 0 && typeof data.update != "boolean") {
      let err40 = { instancePath: instancePath + "/update", schemaPath: "#/properties/update/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
    }
    if (data.fixedUpdate !== void 0 && typeof data.fixedUpdate != "boolean") {
      let err41 = { instancePath: instancePath + "/fixedUpdate", schemaPath: "#/properties/fixedUpdate/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
    }
  } else {
    let err42 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
  }
  return validate123.errors = vErrors, errors === 0;
}
validate123.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate128(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate128.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.index === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.material === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "material" }, message: "must have required property 'material'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.entity === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.params === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "params" }, message: "must have required property 'params'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.shareable === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "shareable" }, message: "must have required property 'shareable'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "index" || key0 === "material" || key0 === "entity" || key0 === "params" || key0 === "shareable")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.index !== void 0) {
      let data0 = data.index;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err6 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err7 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.material !== void 0) {
      let data1 = data.material;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err8 = { instancePath: instancePath + "/material", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
      } else {
        let err9 = { instancePath: instancePath + "/material", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.entity !== void 0) {
      let data2 = data.entity;
      if (!(typeof data2 == "number" && !(data2 % 1) && !isNaN(data2) && isFinite(data2))) {
        let err10 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
      if (typeof data2 == "number" && isFinite(data2) && (data2 < 0 || isNaN(data2))) {
        let err11 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
      }
    }
    if (data.params !== void 0) {
      let data3 = data.params;
      if (Array.isArray(data3)) {
        let len0 = data3.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate74(data3[i0], { instancePath: instancePath + "/params/" + i0, parentData: data3, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors), errors = vErrors.length);
      } else {
        let err12 = { instancePath: instancePath + "/params", schemaPath: "#/properties/params/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.shareable !== void 0 && typeof data.shareable != "boolean") {
      let err13 = { instancePath: instancePath + "/shareable", schemaPath: "#/properties/shareable/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
      vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
    }
  } else {
    let err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
  }
  return validate128.errors = vErrors, errors === 0;
}
validate128.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema210 = { type: "object", additionalProperties: !1, required: ["name", "target", "type", "codec"], properties: { name: { $ref: "#/$defs/name" }, target: { type: "object", description: "Only scene state can be exposed as a host input.", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "state" }, name: { $ref: "#/$defs/name" } } }, type: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color", "string"] }, codec: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color-hex", "color-hex-opaque", "string"] } } };
function validate132(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate132.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.target === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "target" }, message: "must have required property 'target'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.type === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.codec === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "codec" }, message: "must have required property 'codec'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "target" || key0 === "type" || key0 === "codec")) {
        let err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
        }
      } else {
        let err6 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.target !== void 0) {
      let data1 = data.target;
      if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
        if (data1.kind === void 0) {
          let err7 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
        if (data1.name === void 0) {
          let err8 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
        }
        for (let key1 in data1)
          if (!(key1 === "kind" || key1 === "name")) {
            let err9 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
          }
        if (data1.kind !== void 0 && data1.kind !== "state") {
          let err10 = { instancePath: instancePath + "/target/kind", schemaPath: "#/properties/target/properties/kind/const", keyword: "const", params: { allowedValue: "state" }, message: "must be equal to constant" };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
        if (data1.name !== void 0) {
          let data3 = data1.name;
          if (typeof data3 == "string") {
            if (data3.length < 1) {
              let err11 = { instancePath: instancePath + "/target/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
            }
          } else {
            let err12 = { instancePath: instancePath + "/target/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
          }
        }
      } else {
        let err13 = { instancePath: instancePath + "/target", schemaPath: "#/properties/target/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
    }
    if (data.type !== void 0) {
      let data4 = data.type;
      if (typeof data4 != "string") {
        let err14 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
      if (!(data4 === "f32" || data4 === "i32" || data4 === "u32" || data4 === "bool" || data4 === "vec2" || data4 === "vec3" || data4 === "vec4" || data4 === "color" || data4 === "string")) {
        let err15 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema210.properties.type.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
      }
    }
    if (data.codec !== void 0) {
      let data5 = data.codec;
      if (typeof data5 != "string") {
        let err16 = { instancePath: instancePath + "/codec", schemaPath: "#/properties/codec/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
      }
      if (!(data5 === "f32" || data5 === "i32" || data5 === "u32" || data5 === "bool" || data5 === "vec2" || data5 === "vec3" || data5 === "vec4" || data5 === "color-hex" || data5 === "color-hex-opaque" || data5 === "string")) {
        let err17 = { instancePath: instancePath + "/codec", schemaPath: "#/properties/codec/enum", keyword: "enum", params: { allowedValues: schema210.properties.codec.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
  } else {
    let err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
  }
  return validate132.errors = vErrors, errors === 0;
}
validate132.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema213 = { type: "object", additionalProperties: !1, required: ["name", "source", "type"], properties: { name: { $ref: "#/$defs/name" }, source: { type: "object", additionalProperties: !1, required: ["kind", "name"], properties: { kind: { const: "state" }, name: { $ref: "#/$defs/name" } } }, type: { type: "string", enum: ["f32", "i32", "u32", "bool", "vec2", "vec3", "vec4", "color", "string"] } } };
function validate134(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate134.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.source === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "source" }, message: "must have required property 'source'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.type === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "name" || key0 === "source" || key0 === "type")) {
        let err3 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err4 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
        }
      } else {
        let err5 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    }
    if (data.source !== void 0) {
      let data1 = data.source;
      if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
        if (data1.kind === void 0) {
          let err6 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
        }
        if (data1.name === void 0) {
          let err7 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
          vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
        }
        for (let key1 in data1)
          if (!(key1 === "kind" || key1 === "name")) {
            let err8 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
          }
        if (data1.kind !== void 0 && data1.kind !== "state") {
          let err9 = { instancePath: instancePath + "/source/kind", schemaPath: "#/properties/source/properties/kind/const", keyword: "const", params: { allowedValue: "state" }, message: "must be equal to constant" };
          vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
        }
        if (data1.name !== void 0) {
          let data3 = data1.name;
          if (typeof data3 == "string") {
            if (data3.length < 1) {
              let err10 = { instancePath: instancePath + "/source/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
            }
          } else {
            let err11 = { instancePath: instancePath + "/source/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
          }
        }
      } else {
        let err12 = { instancePath: instancePath + "/source", schemaPath: "#/properties/source/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.type !== void 0) {
      let data4 = data.type;
      if (typeof data4 != "string") {
        let err13 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
      }
      if (!(data4 === "f32" || data4 === "i32" || data4 === "u32" || data4 === "bool" || data4 === "vec2" || data4 === "vec3" || data4 === "vec4" || data4 === "color" || data4 === "string")) {
        let err14 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/enum", keyword: "enum", params: { allowedValues: schema213.properties.type.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
  } else {
    let err15 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
  }
  return validate134.errors = vErrors, errors === 0;
}
validate134.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
var schema220 = { type: "object", description: "The update class of each light field that can change at run time (decision 0067): `initial` = a constant the source's literal sets (a reload applies the new literal), `imperative` = written by a handler (a reload keeps the value it holds), `bound` = the value of a binding (evaluated every frame).", additionalProperties: !1, required: ["color", "intensity"], properties: { color: { type: "string", enum: ["initial", "imperative", "bound"] }, intensity: { type: "string", enum: ["initial", "imperative", "bound"] } } };
function validate137(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate137.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.index === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.kind === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.classes === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "classes" }, message: "must have required property 'classes'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "index" || key0 === "entity" || key0 === "kind" || key0 === "classes")) {
        let err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
      }
    if (data.index !== void 0) {
      let data0 = data.index;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err5 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err6 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err7 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err8 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "directional") {
      let err9 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "directional" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.classes !== void 0) {
      let data3 = data.classes;
      if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
        if (data3.color === void 0) {
          let err10 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/required", keyword: "required", params: { missingProperty: "color" }, message: "must have required property 'color'" };
          vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
        }
        if (data3.intensity === void 0) {
          let err11 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/required", keyword: "required", params: { missingProperty: "intensity" }, message: "must have required property 'intensity'" };
          vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
        }
        for (let key1 in data3)
          if (!(key1 === "color" || key1 === "intensity")) {
            let err12 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
          }
        if (data3.color !== void 0) {
          let data4 = data3.color;
          if (typeof data4 != "string") {
            let err13 = { instancePath: instancePath + "/classes/color", schemaPath: "#/$defs/lightClasses/properties/color/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
          }
          if (!(data4 === "initial" || data4 === "imperative" || data4 === "bound")) {
            let err14 = { instancePath: instancePath + "/classes/color", schemaPath: "#/$defs/lightClasses/properties/color/enum", keyword: "enum", params: { allowedValues: schema220.properties.color.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
          }
        }
        if (data3.intensity !== void 0) {
          let data5 = data3.intensity;
          if (typeof data5 != "string") {
            let err15 = { instancePath: instancePath + "/classes/intensity", schemaPath: "#/$defs/lightClasses/properties/intensity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
          }
          if (!(data5 === "initial" || data5 === "imperative" || data5 === "bound")) {
            let err16 = { instancePath: instancePath + "/classes/intensity", schemaPath: "#/$defs/lightClasses/properties/intensity/enum", keyword: "enum", params: { allowedValues: schema220.properties.intensity.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
          }
        }
      } else {
        let err17 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
      }
    }
  } else {
    let err18 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
  }
  return validate137.errors = vErrors, errors === 0;
}
validate137.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate138(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate138.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.index === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.entity === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entity" }, message: "must have required property 'entity'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.kind === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.range === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "range" }, message: "must have required property 'range'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.classes === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "classes" }, message: "must have required property 'classes'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    for (let key0 in data)
      if (!(key0 === "index" || key0 === "entity" || key0 === "kind" || key0 === "range" || key0 === "classes")) {
        let err5 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
      }
    if (data.index !== void 0) {
      let data0 = data.index;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err6 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
      }
      if (typeof data0 == "number" && isFinite(data0) && (data0 < 0 || isNaN(data0))) {
        let err7 = { instancePath: instancePath + "/index", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
      }
    }
    if (data.entity !== void 0) {
      let data1 = data.entity;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err8 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
      }
      if (typeof data1 == "number" && isFinite(data1) && (data1 < 0 || isNaN(data1))) {
        let err9 = { instancePath: instancePath + "/entity", schemaPath: "#/$defs/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
        vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
      }
    }
    if (data.kind !== void 0 && data.kind !== "point") {
      let err10 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/const", keyword: "const", params: { allowedValue: "point" }, message: "must be equal to constant" };
      vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
    }
    if (data.range !== void 0) {
      let data3 = data.range;
      if (typeof data3 == "number" && isFinite(data3)) {
        if (data3 < 0 || isNaN(data3)) {
          let err11 = { instancePath: instancePath + "/range", schemaPath: "#/properties/range/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
          vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
        }
      } else {
        let err12 = { instancePath: instancePath + "/range", schemaPath: "#/properties/range/type", keyword: "type", params: { type: "number" }, message: "must be number" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.classes !== void 0) {
      let data4 = data.classes;
      if (data4 && typeof data4 == "object" && !Array.isArray(data4)) {
        if (data4.color === void 0) {
          let err13 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/required", keyword: "required", params: { missingProperty: "color" }, message: "must have required property 'color'" };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
        if (data4.intensity === void 0) {
          let err14 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/required", keyword: "required", params: { missingProperty: "intensity" }, message: "must have required property 'intensity'" };
          vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
        }
        for (let key1 in data4)
          if (!(key1 === "color" || key1 === "intensity")) {
            let err15 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
          }
        if (data4.color !== void 0) {
          let data5 = data4.color;
          if (typeof data5 != "string") {
            let err16 = { instancePath: instancePath + "/classes/color", schemaPath: "#/$defs/lightClasses/properties/color/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
          }
          if (!(data5 === "initial" || data5 === "imperative" || data5 === "bound")) {
            let err17 = { instancePath: instancePath + "/classes/color", schemaPath: "#/$defs/lightClasses/properties/color/enum", keyword: "enum", params: { allowedValues: schema220.properties.color.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
          }
        }
        if (data4.intensity !== void 0) {
          let data6 = data4.intensity;
          if (typeof data6 != "string") {
            let err18 = { instancePath: instancePath + "/classes/intensity", schemaPath: "#/$defs/lightClasses/properties/intensity/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
          }
          if (!(data6 === "initial" || data6 === "imperative" || data6 === "bound")) {
            let err19 = { instancePath: instancePath + "/classes/intensity", schemaPath: "#/$defs/lightClasses/properties/intensity/enum", keyword: "enum", params: { allowedValues: schema220.properties.intensity.enum }, message: "must be equal to one of the allowed values" };
            vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
          }
        }
      } else {
        let err20 = { instancePath: instancePath + "/classes", schemaPath: "#/$defs/lightClasses/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
  } else {
    let err21 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
  }
  return validate138.errors = vErrors, errors === 0;
}
validate138.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate136(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate136.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    let tag0 = data.kind;
    if (typeof tag0 == "string")
      if (tag0 === "directional") {
        validate137(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate137.errors : vErrors.concat(validate137.errors), errors = vErrors.length);
        var props0 = !0;
      } else if (tag0 === "point")
        validate138(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate138.errors : vErrors.concat(validate138.errors), errors = vErrors.length), props0 !== !0 && (props0 = !0);
      else {
        let err0 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "mapping", tag: "kind", tagValue: tag0 }, message: 'value of tag "kind" must be in oneOf' };
        vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
      }
    else {
      let err1 = { instancePath, schemaPath: "#/discriminator", keyword: "discriminator", params: { error: "tag", tag: "kind", tagValue: tag0 }, message: 'tag "kind" must be string' };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
  } else {
    let err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
  }
  return validate136.errors = vErrors, evaluated0.props = props0, errors === 0;
}
validate136.evaluated = { dynamicProps: !0, dynamicItems: !1 };
function validate119(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate119.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.name === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "name" }, message: "must have required property 'name'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.symbol === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbol" }, message: "must have required property 'symbol'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.fields === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "fields" }, message: "must have required property 'fields'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.state === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "state" }, message: "must have required property 'state'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.cameras === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "cameras" }, message: "must have required property 'cameras'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.entities === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entities" }, message: "must have required property 'entities'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.materialInstances === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "materialInstances" }, message: "must have required property 'materialInstances'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.bindings === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bindings" }, message: "must have required property 'bindings'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.hostInputs === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "hostInputs" }, message: "must have required property 'hostInputs'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.lights === void 0) {
      let err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "lights" }, message: "must have required property 'lights'" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    for (let key0 in data)
      if (!func1.call(schema191.properties, key0)) {
        let err10 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
      }
    if (data.name !== void 0) {
      let data0 = data.name;
      if (typeof data0 == "string") {
        if (data0.length < 1) {
          let err11 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
        }
      } else {
        let err12 = { instancePath: instancePath + "/name", schemaPath: "#/$defs/name/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
      }
    }
    if (data.symbol !== void 0) {
      let data1 = data.symbol;
      if (typeof data1 == "string") {
        if (data1.length < 1) {
          let err13 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
        }
      } else {
        let err14 = { instancePath: instancePath + "/symbol", schemaPath: "#/$defs/symbolId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
      }
    }
    if (data.fields !== void 0) {
      let data2 = data.fields;
      if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
        if (data2.clearColor === void 0) {
          let err15 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/required", keyword: "required", params: { missingProperty: "clearColor" }, message: "must have required property 'clearColor'" };
          vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
        }
        if (data2.ambientColor === void 0) {
          let err16 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/required", keyword: "required", params: { missingProperty: "ambientColor" }, message: "must have required property 'ambientColor'" };
          vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
        }
        if (data2.ambientIntensity === void 0) {
          let err17 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/required", keyword: "required", params: { missingProperty: "ambientIntensity" }, message: "must have required property 'ambientIntensity'" };
          vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
        }
        if (data2.gravity === void 0) {
          let err18 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/required", keyword: "required", params: { missingProperty: "gravity" }, message: "must have required property 'gravity'" };
          vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
        }
        for (let key1 in data2)
          if (!(key1 === "clearColor" || key1 === "ambientColor" || key1 === "ambientIntensity" || key1 === "gravity")) {
            let err19 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
          }
        if (data2.clearColor !== void 0) {
          let data3 = data2.clearColor;
          if (Array.isArray(data3)) {
            if (data3.length > 4) {
              let err20 = { instancePath: instancePath + "/fields/clearColor", schemaPath: "#/$defs/vec4/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
              vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
            }
            if (data3.length < 4) {
              let err21 = { instancePath: instancePath + "/fields/clearColor", schemaPath: "#/$defs/vec4/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
              vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
            }
            let len0 = data3.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data4 = data3[i0];
              if (!(typeof data4 == "number" && isFinite(data4))) {
                let err22 = { instancePath: instancePath + "/fields/clearColor/" + i0, schemaPath: "#/$defs/vec4/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
              }
            }
          } else {
            let err23 = { instancePath: instancePath + "/fields/clearColor", schemaPath: "#/$defs/vec4/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
          }
        }
        if (data2.ambientColor !== void 0) {
          let data5 = data2.ambientColor;
          if (Array.isArray(data5)) {
            if (data5.length > 4) {
              let err24 = { instancePath: instancePath + "/fields/ambientColor", schemaPath: "#/$defs/vec4/maxItems", keyword: "maxItems", params: { limit: 4 }, message: "must NOT have more than 4 items" };
              vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
            }
            if (data5.length < 4) {
              let err25 = { instancePath: instancePath + "/fields/ambientColor", schemaPath: "#/$defs/vec4/minItems", keyword: "minItems", params: { limit: 4 }, message: "must NOT have fewer than 4 items" };
              vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
            }
            let len1 = data5.length;
            for (let i1 = 0; i1 < len1; i1++) {
              let data6 = data5[i1];
              if (!(typeof data6 == "number" && isFinite(data6))) {
                let err26 = { instancePath: instancePath + "/fields/ambientColor/" + i1, schemaPath: "#/$defs/vec4/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
              }
            }
          } else {
            let err27 = { instancePath: instancePath + "/fields/ambientColor", schemaPath: "#/$defs/vec4/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
          }
        }
        if (data2.ambientIntensity !== void 0) {
          let data7 = data2.ambientIntensity;
          if (typeof data7 == "number" && isFinite(data7)) {
            if (data7 < 0 || isNaN(data7)) {
              let err28 = { instancePath: instancePath + "/fields/ambientIntensity", schemaPath: "#/properties/fields/properties/ambientIntensity/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
            }
          } else {
            let err29 = { instancePath: instancePath + "/fields/ambientIntensity", schemaPath: "#/properties/fields/properties/ambientIntensity/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
          }
        }
        if (data2.gravity !== void 0) {
          let data8 = data2.gravity;
          if (Array.isArray(data8)) {
            if (data8.length > 3) {
              let err30 = { instancePath: instancePath + "/fields/gravity", schemaPath: "#/$defs/vec3/maxItems", keyword: "maxItems", params: { limit: 3 }, message: "must NOT have more than 3 items" };
              vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
            }
            if (data8.length < 3) {
              let err31 = { instancePath: instancePath + "/fields/gravity", schemaPath: "#/$defs/vec3/minItems", keyword: "minItems", params: { limit: 3 }, message: "must NOT have fewer than 3 items" };
              vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
            }
            let len2 = data8.length;
            for (let i2 = 0; i2 < len2; i2++) {
              let data9 = data8[i2];
              if (!(typeof data9 == "number" && isFinite(data9))) {
                let err32 = { instancePath: instancePath + "/fields/gravity/" + i2, schemaPath: "#/$defs/vec3/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
              }
            }
          } else {
            let err33 = { instancePath: instancePath + "/fields/gravity", schemaPath: "#/$defs/vec3/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
          }
        }
      } else {
        let err34 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
      }
    }
    if (data.state !== void 0) {
      let data10 = data.state;
      if (Array.isArray(data10)) {
        let len3 = data10.length;
        for (let i3 = 0; i3 < len3; i3++)
          validate92(data10[i3], { instancePath: instancePath + "/state/" + i3, parentData: data10, parentDataProperty: i3, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate92.errors : vErrors.concat(validate92.errors), errors = vErrors.length);
      } else {
        let err35 = { instancePath: instancePath + "/state", schemaPath: "#/properties/state/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
      }
    }
    if (data.cameras !== void 0) {
      let data12 = data.cameras;
      if (Array.isArray(data12)) {
        let len4 = data12.length;
        for (let i4 = 0; i4 < len4; i4++)
          validate121(data12[i4], { instancePath: instancePath + "/cameras/" + i4, parentData: data12, parentDataProperty: i4, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate121.errors : vErrors.concat(validate121.errors), errors = vErrors.length);
      } else {
        let err36 = { instancePath: instancePath + "/cameras", schemaPath: "#/properties/cameras/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
      }
    }
    if (data.entities !== void 0) {
      let data14 = data.entities;
      if (Array.isArray(data14)) {
        let len5 = data14.length;
        for (let i5 = 0; i5 < len5; i5++)
          validate123(data14[i5], { instancePath: instancePath + "/entities/" + i5, parentData: data14, parentDataProperty: i5, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate123.errors : vErrors.concat(validate123.errors), errors = vErrors.length);
      } else {
        let err37 = { instancePath: instancePath + "/entities", schemaPath: "#/properties/entities/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
      }
    }
    if (data.materialInstances !== void 0) {
      let data16 = data.materialInstances;
      if (Array.isArray(data16)) {
        let len6 = data16.length;
        for (let i6 = 0; i6 < len6; i6++)
          validate128(data16[i6], { instancePath: instancePath + "/materialInstances/" + i6, parentData: data16, parentDataProperty: i6, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate128.errors : vErrors.concat(validate128.errors), errors = vErrors.length);
      } else {
        let err38 = { instancePath: instancePath + "/materialInstances", schemaPath: "#/properties/materialInstances/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
      }
    }
    if (data.bindings !== void 0) {
      let data18 = data.bindings;
      if (Array.isArray(data18)) {
        let len7 = data18.length;
        for (let i7 = 0; i7 < len7; i7++)
          validate94(data18[i7], { instancePath: instancePath + "/bindings/" + i7, parentData: data18, parentDataProperty: i7, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate94.errors : vErrors.concat(validate94.errors), errors = vErrors.length);
      } else {
        let err39 = { instancePath: instancePath + "/bindings", schemaPath: "#/properties/bindings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
      }
    }
    if (data.hostInputs !== void 0) {
      let data20 = data.hostInputs;
      if (Array.isArray(data20)) {
        let len8 = data20.length;
        for (let i8 = 0; i8 < len8; i8++)
          validate132(data20[i8], { instancePath: instancePath + "/hostInputs/" + i8, parentData: data20, parentDataProperty: i8, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate132.errors : vErrors.concat(validate132.errors), errors = vErrors.length);
      } else {
        let err40 = { instancePath: instancePath + "/hostInputs", schemaPath: "#/properties/hostInputs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
      }
    }
    if (data.hostOutputs !== void 0) {
      let data22 = data.hostOutputs;
      if (Array.isArray(data22)) {
        let len9 = data22.length;
        for (let i9 = 0; i9 < len9; i9++)
          validate134(data22[i9], { instancePath: instancePath + "/hostOutputs/" + i9, parentData: data22, parentDataProperty: i9, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate134.errors : vErrors.concat(validate134.errors), errors = vErrors.length);
      } else {
        let err41 = { instancePath: instancePath + "/hostOutputs", schemaPath: "#/properties/hostOutputs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
      }
    }
    if (data.lights !== void 0) {
      let data24 = data.lights;
      if (Array.isArray(data24)) {
        let len10 = data24.length;
        for (let i10 = 0; i10 < len10; i10++)
          validate136(data24[i10], { instancePath: instancePath + "/lights/" + i10, parentData: data24, parentDataProperty: i10, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate136.errors : vErrors.concat(validate136.errors), errors = vErrors.length);
      } else {
        let err42 = { instancePath: instancePath + "/lights", schemaPath: "#/properties/lights/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
      }
    }
  } else {
    let err43 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
  }
  return validate119.errors = vErrors, errors === 0;
}
validate119.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };
function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}) {
  let vErrors = null, errors = 0, evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps && (evaluated0.props = void 0), evaluated0.dynamicItems && (evaluated0.items = void 0), data && typeof data == "object" && !Array.isArray(data)) {
    if (data.manifestSchema === void 0) {
      let err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "manifestSchema" }, message: "must have required property 'manifestSchema'" };
      vErrors === null ? vErrors = [err0] : vErrors.push(err0), errors++;
    }
    if (data.runtimeAbi === void 0) {
      let err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtimeAbi" }, message: "must have required property 'runtimeAbi'" };
      vErrors === null ? vErrors = [err1] : vErrors.push(err1), errors++;
    }
    if (data.languageVersion === void 0) {
      let err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "languageVersion" }, message: "must have required property 'languageVersion'" };
      vErrors === null ? vErrors = [err2] : vErrors.push(err2), errors++;
    }
    if (data.compilerVersion === void 0) {
      let err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "compilerVersion" }, message: "must have required property 'compilerVersion'" };
      vErrors === null ? vErrors = [err3] : vErrors.push(err3), errors++;
    }
    if (data.buildId === void 0) {
      let err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "buildId" }, message: "must have required property 'buildId'" };
      vErrors === null ? vErrors = [err4] : vErrors.push(err4), errors++;
    }
    if (data.targetProfile === void 0) {
      let err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "targetProfile" }, message: "must have required property 'targetProfile'" };
      vErrors === null ? vErrors = [err5] : vErrors.push(err5), errors++;
    }
    if (data.requiredCapabilities === void 0) {
      let err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requiredCapabilities" }, message: "must have required property 'requiredCapabilities'" };
      vErrors === null ? vErrors = [err6] : vErrors.push(err6), errors++;
    }
    if (data.subsystems === void 0) {
      let err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "subsystems" }, message: "must have required property 'subsystems'" };
      vErrors === null ? vErrors = [err7] : vErrors.push(err7), errors++;
    }
    if (data.runtimeConfig === void 0) {
      let err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "runtimeConfig" }, message: "must have required property 'runtimeConfig'" };
      vErrors === null ? vErrors = [err8] : vErrors.push(err8), errors++;
    }
    if (data.entryScene === void 0) {
      let err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "entryScene" }, message: "must have required property 'entryScene'" };
      vErrors === null ? vErrors = [err9] : vErrors.push(err9), errors++;
    }
    if (data.sources === void 0) {
      let err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sources" }, message: "must have required property 'sources'" };
      vErrors === null ? vErrors = [err10] : vErrors.push(err10), errors++;
    }
    if (data.spans === void 0) {
      let err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "spans" }, message: "must have required property 'spans'" };
      vErrors === null ? vErrors = [err11] : vErrors.push(err11), errors++;
    }
    if (data.symbols === void 0) {
      let err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "symbols" }, message: "must have required property 'symbols'" };
      vErrors === null ? vErrors = [err12] : vErrors.push(err12), errors++;
    }
    if (data.layouts === void 0) {
      let err13 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "layouts" }, message: "must have required property 'layouts'" };
      vErrors === null ? vErrors = [err13] : vErrors.push(err13), errors++;
    }
    if (data.shaders === void 0) {
      let err14 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "shaders" }, message: "must have required property 'shaders'" };
      vErrors === null ? vErrors = [err14] : vErrors.push(err14), errors++;
    }
    if (data.materials === void 0) {
      let err15 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "materials" }, message: "must have required property 'materials'" };
      vErrors === null ? vErrors = [err15] : vErrors.push(err15), errors++;
    }
    if (data.meshes === void 0) {
      let err16 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "meshes" }, message: "must have required property 'meshes'" };
      vErrors === null ? vErrors = [err16] : vErrors.push(err16), errors++;
    }
    if (data.assets === void 0) {
      let err17 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "assets" }, message: "must have required property 'assets'" };
      vErrors === null ? vErrors = [err17] : vErrors.push(err17), errors++;
    }
    if (data.scene === void 0) {
      let err18 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "scene" }, message: "must have required property 'scene'" };
      vErrors === null ? vErrors = [err18] : vErrors.push(err18), errors++;
    }
    for (let key0 in data)
      if (!func1.call(schema31.properties, key0)) {
        let err19 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
        vErrors === null ? vErrors = [err19] : vErrors.push(err19), errors++;
      }
    if (data.manifestSchema !== void 0) {
      let data0 = data.manifestSchema;
      if (!(typeof data0 == "number" && !(data0 % 1) && !isNaN(data0) && isFinite(data0))) {
        let err20 = { instancePath: instancePath + "/manifestSchema", schemaPath: "#/properties/manifestSchema/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err20] : vErrors.push(err20), errors++;
      }
    }
    if (data.runtimeAbi !== void 0) {
      let data1 = data.runtimeAbi;
      if (!(typeof data1 == "number" && !(data1 % 1) && !isNaN(data1) && isFinite(data1))) {
        let err21 = { instancePath: instancePath + "/runtimeAbi", schemaPath: "#/properties/runtimeAbi/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
        vErrors === null ? vErrors = [err21] : vErrors.push(err21), errors++;
      }
    }
    if (data.languageVersion !== void 0 && typeof data.languageVersion != "string") {
      let err22 = { instancePath: instancePath + "/languageVersion", schemaPath: "#/properties/languageVersion/type", keyword: "type", params: { type: "string" }, message: "must be string" };
      vErrors === null ? vErrors = [err22] : vErrors.push(err22), errors++;
    }
    if (data.compilerVersion !== void 0) {
      let data3 = data.compilerVersion;
      if (typeof data3 == "string") {
        if (data3.length < 1) {
          let err23 = { instancePath: instancePath + "/compilerVersion", schemaPath: "#/properties/compilerVersion/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err23] : vErrors.push(err23), errors++;
        }
      } else {
        let err24 = { instancePath: instancePath + "/compilerVersion", schemaPath: "#/properties/compilerVersion/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err24] : vErrors.push(err24), errors++;
      }
    }
    if (data.buildId !== void 0) {
      let data4 = data.buildId;
      if (typeof data4 == "string") {
        if (!pattern4.test(data4)) {
          let err25 = { instancePath: instancePath + "/buildId", schemaPath: "#/$defs/sha256/pattern", keyword: "pattern", params: { pattern: "^[0-9a-f]{64}$" }, message: 'must match pattern "^[0-9a-f]{64}$"' };
          vErrors === null ? vErrors = [err25] : vErrors.push(err25), errors++;
        }
      } else {
        let err26 = { instancePath: instancePath + "/buildId", schemaPath: "#/$defs/sha256/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err26] : vErrors.push(err26), errors++;
      }
    }
    if (data.targetProfile !== void 0) {
      let data5 = data.targetProfile;
      if (typeof data5 != "string") {
        let err27 = { instancePath: instancePath + "/targetProfile", schemaPath: "#/properties/targetProfile/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err27] : vErrors.push(err27), errors++;
      }
      if (data5 !== "webgpu-core-2026") {
        let err28 = { instancePath: instancePath + "/targetProfile", schemaPath: "#/properties/targetProfile/enum", keyword: "enum", params: { allowedValues: schema31.properties.targetProfile.enum }, message: "must be equal to one of the allowed values" };
        vErrors === null ? vErrors = [err28] : vErrors.push(err28), errors++;
      }
    }
    if (data.requiredCapabilities !== void 0 && (validate21(data.requiredCapabilities, { instancePath: instancePath + "/requiredCapabilities", parentData: data, parentDataProperty: "requiredCapabilities", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors), errors = vErrors.length)), data.subsystems !== void 0) {
      let data7 = data.subsystems, _errs18 = errors, valid2 = !0, _errs19 = errors;
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        let missing0;
        if (data7.physics === void 0 && (missing0 = "physics")) {
          let err29 = {};
          vErrors === null ? vErrors = [err29] : vErrors.push(err29), errors++;
        } else {
          let _errs20 = errors;
          for (let key1 in data7)
            if (!(key1 === "physics" || key1 === "physicsModule")) {
              let err30 = {};
              vErrors === null ? vErrors = [err30] : vErrors.push(err30), errors++;
              break;
            }
          if (_errs20 === errors && data7.physics !== void 0 && data7.physics !== !0) {
            let err31 = {};
            vErrors === null ? vErrors = [err31] : vErrors.push(err31), errors++;
          }
        }
      }
      var _valid0 = _errs19 === errors;
      errors = _errs18, vErrors !== null && (_errs18 ? vErrors.length = _errs18 : vErrors = null);
      let ifClause0;
      if (_valid0) {
        let _errs22 = errors;
        if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
          if (data7.physicsModule === void 0) {
            let err32 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/then/required", keyword: "required", params: { missingProperty: "physicsModule" }, message: "must have required property 'physicsModule'" };
            vErrors === null ? vErrors = [err32] : vErrors.push(err32), errors++;
          }
          for (let key2 in data7)
            if (!(key2 === "physics" || key2 === "physicsModule")) {
              let err33 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/then/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err33] : vErrors.push(err33), errors++;
            }
        }
        var _valid0 = _errs22 === errors;
        valid2 = _valid0, ifClause0 = "then";
      } else {
        let _errs24 = errors;
        if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
          for (let key3 in data7)
            if (!(key3 === "physics" || key3 === "physicsModule")) {
              let err34 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/else/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key3 }, message: "must NOT have additional properties" };
              vErrors === null ? vErrors = [err34] : vErrors.push(err34), errors++;
            }
          if (data7.physicsModule !== void 0) {
            let err35 = { instancePath: instancePath + "/subsystems/physicsModule", schemaPath: "#/properties/subsystems/else/properties/physicsModule/false schema", keyword: "false schema", params: {}, message: "boolean schema is false" };
            vErrors === null ? vErrors = [err35] : vErrors.push(err35), errors++;
          }
        }
        var _valid0 = _errs24 === errors;
        valid2 = _valid0, ifClause0 = "else";
      }
      if (!valid2) {
        let err36 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/if", keyword: "if", params: { failingKeyword: ifClause0 }, message: 'must match "' + ifClause0 + '" schema' };
        vErrors === null ? vErrors = [err36] : vErrors.push(err36), errors++;
      }
      if (data7 && typeof data7 == "object" && !Array.isArray(data7)) {
        if (data7.physics === void 0) {
          let err37 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/required", keyword: "required", params: { missingProperty: "physics" }, message: "must have required property 'physics'" };
          vErrors === null ? vErrors = [err37] : vErrors.push(err37), errors++;
        }
        for (let key4 in data7)
          if (!(key4 === "physics" || key4 === "physicsModule")) {
            let err38 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key4 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err38] : vErrors.push(err38), errors++;
          }
        if (data7.physics !== void 0 && typeof data7.physics != "boolean") {
          let err39 = { instancePath: instancePath + "/subsystems/physics", schemaPath: "#/properties/subsystems/properties/physics/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
          vErrors === null ? vErrors = [err39] : vErrors.push(err39), errors++;
        }
        if (data7.physicsModule !== void 0) {
          let data11 = data7.physicsModule;
          if (typeof data11 == "string") {
            if (!pattern8.test(data11)) {
              let err40 = { instancePath: instancePath + "/subsystems/physicsModule", schemaPath: "#/properties/subsystems/properties/physicsModule/pattern", keyword: "pattern", params: { pattern: "^physics/[0-9a-f]{16}\\.js$" }, message: 'must match pattern "^physics/[0-9a-f]{16}\\.js$"' };
              vErrors === null ? vErrors = [err40] : vErrors.push(err40), errors++;
            }
          } else {
            let err41 = { instancePath: instancePath + "/subsystems/physicsModule", schemaPath: "#/properties/subsystems/properties/physicsModule/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            vErrors === null ? vErrors = [err41] : vErrors.push(err41), errors++;
          }
        }
      } else {
        let err42 = { instancePath: instancePath + "/subsystems", schemaPath: "#/properties/subsystems/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err42] : vErrors.push(err42), errors++;
      }
    }
    if (data.runtimeConfig !== void 0) {
      let data12 = data.runtimeConfig;
      if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
        if (data12.fixedStep === void 0) {
          let err43 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/required", keyword: "required", params: { missingProperty: "fixedStep" }, message: "must have required property 'fixedStep'" };
          vErrors === null ? vErrors = [err43] : vErrors.push(err43), errors++;
        }
        if (data12.maxCatchUpSteps === void 0) {
          let err44 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/required", keyword: "required", params: { missingProperty: "maxCatchUpSteps" }, message: "must have required property 'maxCatchUpSteps'" };
          vErrors === null ? vErrors = [err44] : vErrors.push(err44), errors++;
        }
        if (data12.maxFrameDelta === void 0) {
          let err45 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/required", keyword: "required", params: { missingProperty: "maxFrameDelta" }, message: "must have required property 'maxFrameDelta'" };
          vErrors === null ? vErrors = [err45] : vErrors.push(err45), errors++;
        }
        if (data12.maxEntities === void 0) {
          let err46 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/required", keyword: "required", params: { missingProperty: "maxEntities" }, message: "must have required property 'maxEntities'" };
          vErrors === null ? vErrors = [err46] : vErrors.push(err46), errors++;
        }
        if (data12.pauseWhenHidden === void 0) {
          let err47 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/required", keyword: "required", params: { missingProperty: "pauseWhenHidden" }, message: "must have required property 'pauseWhenHidden'" };
          vErrors === null ? vErrors = [err47] : vErrors.push(err47), errors++;
        }
        for (let key5 in data12)
          if (!(key5 === "fixedStep" || key5 === "maxCatchUpSteps" || key5 === "maxFrameDelta" || key5 === "maxEntities" || key5 === "pauseWhenHidden")) {
            let err48 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key5 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err48] : vErrors.push(err48), errors++;
          }
        if (data12.fixedStep !== void 0) {
          let data13 = data12.fixedStep;
          if (typeof data13 == "number" && isFinite(data13)) {
            if (data13 <= 0 || isNaN(data13)) {
              let err49 = { instancePath: instancePath + "/runtimeConfig/fixedStep", schemaPath: "#/$defs/runtimeConfig/properties/fixedStep/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
              vErrors === null ? vErrors = [err49] : vErrors.push(err49), errors++;
            }
          } else {
            let err50 = { instancePath: instancePath + "/runtimeConfig/fixedStep", schemaPath: "#/$defs/runtimeConfig/properties/fixedStep/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err50] : vErrors.push(err50), errors++;
          }
        }
        if (data12.maxCatchUpSteps !== void 0) {
          let data14 = data12.maxCatchUpSteps;
          if (!(typeof data14 == "number" && !(data14 % 1) && !isNaN(data14) && isFinite(data14))) {
            let err51 = { instancePath: instancePath + "/runtimeConfig/maxCatchUpSteps", schemaPath: "#/$defs/runtimeConfig/properties/maxCatchUpSteps/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err51] : vErrors.push(err51), errors++;
          }
          if (typeof data14 == "number" && isFinite(data14) && (data14 < 1 || isNaN(data14))) {
            let err52 = { instancePath: instancePath + "/runtimeConfig/maxCatchUpSteps", schemaPath: "#/$defs/runtimeConfig/properties/maxCatchUpSteps/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
            vErrors === null ? vErrors = [err52] : vErrors.push(err52), errors++;
          }
        }
        if (data12.maxFrameDelta !== void 0) {
          let data15 = data12.maxFrameDelta;
          if (typeof data15 == "number" && isFinite(data15)) {
            if (data15 <= 0 || isNaN(data15)) {
              let err53 = { instancePath: instancePath + "/runtimeConfig/maxFrameDelta", schemaPath: "#/$defs/runtimeConfig/properties/maxFrameDelta/exclusiveMinimum", keyword: "exclusiveMinimum", params: { comparison: ">", limit: 0 }, message: "must be > 0" };
              vErrors === null ? vErrors = [err53] : vErrors.push(err53), errors++;
            }
          } else {
            let err54 = { instancePath: instancePath + "/runtimeConfig/maxFrameDelta", schemaPath: "#/$defs/runtimeConfig/properties/maxFrameDelta/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            vErrors === null ? vErrors = [err54] : vErrors.push(err54), errors++;
          }
        }
        if (data12.maxEntities !== void 0) {
          let data16 = data12.maxEntities;
          if (!(typeof data16 == "number" && !(data16 % 1) && !isNaN(data16) && isFinite(data16))) {
            let err55 = { instancePath: instancePath + "/runtimeConfig/maxEntities", schemaPath: "#/$defs/runtimeConfig/properties/maxEntities/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err55] : vErrors.push(err55), errors++;
          }
          if (typeof data16 == "number" && isFinite(data16) && (data16 < 1 || isNaN(data16))) {
            let err56 = { instancePath: instancePath + "/runtimeConfig/maxEntities", schemaPath: "#/$defs/runtimeConfig/properties/maxEntities/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
            vErrors === null ? vErrors = [err56] : vErrors.push(err56), errors++;
          }
        }
        if (data12.pauseWhenHidden !== void 0 && typeof data12.pauseWhenHidden != "boolean") {
          let err57 = { instancePath: instancePath + "/runtimeConfig/pauseWhenHidden", schemaPath: "#/$defs/runtimeConfig/properties/pauseWhenHidden/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
          vErrors === null ? vErrors = [err57] : vErrors.push(err57), errors++;
        }
      } else {
        let err58 = { instancePath: instancePath + "/runtimeConfig", schemaPath: "#/$defs/runtimeConfig/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err58] : vErrors.push(err58), errors++;
      }
    }
    if (data.preview !== void 0) {
      let data18 = data.preview;
      if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
        if (data18.loopBudget === void 0) {
          let err59 = { instancePath: instancePath + "/preview", schemaPath: "#/properties/preview/required", keyword: "required", params: { missingProperty: "loopBudget" }, message: "must have required property 'loopBudget'" };
          vErrors === null ? vErrors = [err59] : vErrors.push(err59), errors++;
        }
        for (let key6 in data18)
          if (key6 !== "loopBudget") {
            let err60 = { instancePath: instancePath + "/preview", schemaPath: "#/properties/preview/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key6 }, message: "must NOT have additional properties" };
            vErrors === null ? vErrors = [err60] : vErrors.push(err60), errors++;
          }
        if (data18.loopBudget !== void 0) {
          let data19 = data18.loopBudget;
          if (!(typeof data19 == "number" && !(data19 % 1) && !isNaN(data19) && isFinite(data19))) {
            let err61 = { instancePath: instancePath + "/preview/loopBudget", schemaPath: "#/properties/preview/properties/loopBudget/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            vErrors === null ? vErrors = [err61] : vErrors.push(err61), errors++;
          }
          if (typeof data19 == "number" && isFinite(data19)) {
            if (data19 > 4294967295 || isNaN(data19)) {
              let err62 = { instancePath: instancePath + "/preview/loopBudget", schemaPath: "#/properties/preview/properties/loopBudget/maximum", keyword: "maximum", params: { comparison: "<=", limit: 4294967295 }, message: "must be <= 4294967295" };
              vErrors === null ? vErrors = [err62] : vErrors.push(err62), errors++;
            }
            if (data19 < 1 || isNaN(data19)) {
              let err63 = { instancePath: instancePath + "/preview/loopBudget", schemaPath: "#/properties/preview/properties/loopBudget/minimum", keyword: "minimum", params: { comparison: ">=", limit: 1 }, message: "must be >= 1" };
              vErrors === null ? vErrors = [err63] : vErrors.push(err63), errors++;
            }
          }
        }
      } else {
        let err64 = { instancePath: instancePath + "/preview", schemaPath: "#/properties/preview/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        vErrors === null ? vErrors = [err64] : vErrors.push(err64), errors++;
      }
    }
    if (data.entryScene !== void 0) {
      let data20 = data.entryScene;
      if (typeof data20 == "string") {
        if (data20.length < 1) {
          let err65 = { instancePath: instancePath + "/entryScene", schemaPath: "#/properties/entryScene/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          vErrors === null ? vErrors = [err65] : vErrors.push(err65), errors++;
        }
      } else {
        let err66 = { instancePath: instancePath + "/entryScene", schemaPath: "#/properties/entryScene/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        vErrors === null ? vErrors = [err66] : vErrors.push(err66), errors++;
      }
    }
    if (data.sources !== void 0) {
      let data21 = data.sources;
      if (Array.isArray(data21)) {
        let len0 = data21.length;
        for (let i0 = 0; i0 < len0; i0++)
          validate23(data21[i0], { instancePath: instancePath + "/sources/" + i0, parentData: data21, parentDataProperty: i0, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors), errors = vErrors.length);
      } else {
        let err67 = { instancePath: instancePath + "/sources", schemaPath: "#/properties/sources/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err67] : vErrors.push(err67), errors++;
      }
    }
    if (data.spans !== void 0) {
      let data23 = data.spans;
      if (Array.isArray(data23)) {
        let len1 = data23.length;
        for (let i1 = 0; i1 < len1; i1++)
          validate25(data23[i1], { instancePath: instancePath + "/spans/" + i1, parentData: data23, parentDataProperty: i1, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors), errors = vErrors.length);
      } else {
        let err68 = { instancePath: instancePath + "/spans", schemaPath: "#/properties/spans/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err68] : vErrors.push(err68), errors++;
      }
    }
    if (data.symbols !== void 0) {
      let data25 = data.symbols;
      if (Array.isArray(data25)) {
        let len2 = data25.length;
        for (let i2 = 0; i2 < len2; i2++)
          validate27(data25[i2], { instancePath: instancePath + "/symbols/" + i2, parentData: data25, parentDataProperty: i2, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors), errors = vErrors.length);
      } else {
        let err69 = { instancePath: instancePath + "/symbols", schemaPath: "#/properties/symbols/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err69] : vErrors.push(err69), errors++;
      }
    }
    if (data.layouts !== void 0) {
      let data27 = data.layouts;
      if (Array.isArray(data27)) {
        let len3 = data27.length;
        for (let i3 = 0; i3 < len3; i3++)
          validate29(data27[i3], { instancePath: instancePath + "/layouts/" + i3, parentData: data27, parentDataProperty: i3, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate29.errors : vErrors.concat(validate29.errors), errors = vErrors.length);
      } else {
        let err70 = { instancePath: instancePath + "/layouts", schemaPath: "#/properties/layouts/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err70] : vErrors.push(err70), errors++;
      }
    }
    if (data.shaders !== void 0) {
      let data29 = data.shaders;
      if (Array.isArray(data29)) {
        let len4 = data29.length;
        for (let i4 = 0; i4 < len4; i4++)
          validate45(data29[i4], { instancePath: instancePath + "/shaders/" + i4, parentData: data29, parentDataProperty: i4, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate45.errors : vErrors.concat(validate45.errors), errors = vErrors.length);
      } else {
        let err71 = { instancePath: instancePath + "/shaders", schemaPath: "#/properties/shaders/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err71] : vErrors.push(err71), errors++;
      }
    }
    if (data.materials !== void 0) {
      let data31 = data.materials;
      if (Array.isArray(data31)) {
        let len5 = data31.length;
        for (let i5 = 0; i5 < len5; i5++)
          validate47(data31[i5], { instancePath: instancePath + "/materials/" + i5, parentData: data31, parentDataProperty: i5, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate47.errors : vErrors.concat(validate47.errors), errors = vErrors.length);
      } else {
        let err72 = { instancePath: instancePath + "/materials", schemaPath: "#/properties/materials/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err72] : vErrors.push(err72), errors++;
      }
    }
    if (data.meshes !== void 0) {
      let data33 = data.meshes;
      if (Array.isArray(data33)) {
        let len6 = data33.length;
        for (let i6 = 0; i6 < len6; i6++)
          validate53(data33[i6], { instancePath: instancePath + "/meshes/" + i6, parentData: data33, parentDataProperty: i6, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors), errors = vErrors.length);
      } else {
        let err73 = { instancePath: instancePath + "/meshes", schemaPath: "#/properties/meshes/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err73] : vErrors.push(err73), errors++;
      }
    }
    if (data.assets !== void 0) {
      let data35 = data.assets;
      if (Array.isArray(data35)) {
        let len7 = data35.length;
        for (let i7 = 0; i7 < len7; i7++)
          validate63(data35[i7], { instancePath: instancePath + "/assets/" + i7, parentData: data35, parentDataProperty: i7, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors), errors = vErrors.length);
      } else {
        let err74 = { instancePath: instancePath + "/assets", schemaPath: "#/properties/assets/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err74] : vErrors.push(err74), errors++;
      }
    }
    if (data.prefabs !== void 0) {
      let data37 = data.prefabs;
      if (Array.isArray(data37)) {
        let len8 = data37.length;
        for (let i8 = 0; i8 < len8; i8++)
          validate73(data37[i8], { instancePath: instancePath + "/prefabs/" + i8, parentData: data37, parentDataProperty: i8, rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate73.errors : vErrors.concat(validate73.errors), errors = vErrors.length);
      } else {
        let err75 = { instancePath: instancePath + "/prefabs", schemaPath: "#/properties/prefabs/type", keyword: "type", params: { type: "array" }, message: "must be array" };
        vErrors === null ? vErrors = [err75] : vErrors.push(err75), errors++;
      }
    }
    data.scene !== void 0 && (validate119(data.scene, { instancePath: instancePath + "/scene", parentData: data, parentDataProperty: "scene", rootData, dynamicAnchors }) || (vErrors = vErrors === null ? validate119.errors : vErrors.concat(validate119.errors), errors = vErrors.length));
  } else {
    let err76 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
    vErrors === null ? vErrors = [err76] : vErrors.push(err76), errors++;
  }
  return validate20.errors = vErrors, errors === 0;
}
validate20.evaluated = { props: !0, dynamicProps: !1, dynamicItems: !1 };

// src/abi/validate.ts
var MAX_SCHEMA_FAILURES = 100;
function pointerToField(pointer, extra) {
  let segments = pointer === "" ? [] : pointer.slice(1).split("/");
  extra !== void 0 && segments.push(extra);
  let field = "";
  for (let raw of segments) {
    let segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    field += /^[0-9]+$/.test(segment) ? `[${segment}]` : field === "" ? segment : `.${segment}`;
  }
  return field === "" ? "manifest" : field;
}
function fieldOf(error) {
  let params = error.params;
  switch (error.keyword) {
    case "required":
      return pointerToField(error.instancePath, String(params.missingProperty));
    case "additionalProperties":
      return pointerToField(error.instancePath, String(params.additionalProperty));
    case "discriminator":
      return pointerToField(error.instancePath, String(params.tag));
    default:
      return pointerToField(error.instancePath, error.propertyName);
  }
}
var SUMMARY_KEYWORDS = /* @__PURE__ */ new Set(["if", "propertyNames"]);
function toFailures(errors) {
  let failures = [];
  for (let error of errors) {
    if (SUMMARY_KEYWORDS.has(error.keyword)) continue;
    let field = fieldOf(error);
    if (failures.push({
      code: "E8006",
      field,
      message: `Invalid manifest at \`${field}\`: ${error.message ?? `failed \`${error.keyword}\``}.`
    }), failures.length >= MAX_SCHEMA_FAILURES) break;
  }
  return failures;
}
function validateManifest(value) {
  if (validate_manifest_default(value))
    return { ok: !0, manifest: value };
  let failures = toFailures(validate_manifest_default.errors ?? []);
  return failures.length === 0 ? {
    ok: !1,
    failures: [{ code: "E8006", field: "manifest", message: "Invalid manifest: schema validation failed." }]
  } : { ok: !1, failures };
}
function checkManifest(value) {
  let incompatible2 = checkCompatibility(value);
  return incompatible2.length > 0 ? { ok: !1, failures: incompatible2 } : validateManifest(value);
}

// src/host/failures.ts
function abiFailureToDiagnostic(failure2, phase = "runtime:mount") {
  return makeRuntimeDiagnostic(failure2.code, {
    phase,
    message: failure2.message,
    notes: [`field: ${failure2.field}`]
  });
}
function resolveSpan(manifest, spanId) {
  let span = manifest.spans[spanId];
  if (span === void 0) return null;
  let source = manifest.sources.find((candidate) => candidate.id === span.file);
  return source === void 0 ? null : {
    file: source.path,
    startByte: span.start,
    endByte: span.end,
    startLine: span.startLine,
    startColumn: span.startColumn,
    endLine: span.endLine,
    endColumn: span.endColumn
  };
}
function spanOfSymbol(manifest, symbol) {
  return manifest.symbols.find((candidate) => candidate.id === symbol)?.span;
}
function mountError(diagnostics) {
  for (let diagnostic2 of diagnostics) {
    let kind = mountErrorKindForCode(diagnostic2.code.replace(/^MTEK-/, ""));
    if (kind !== void 0) return new MtekMountError(kind, diagnostics);
  }
  throw new Error(
    `internal error: no mount error kind for diagnostics ${diagnostics.map((d) => d.code).join(", ") || "(none)"}`
  );
}
function sourceKey(d) {
  return d.source === null ? "-" : `${d.source.file}:${String(d.source.startByte)}:${String(d.source.endByte)}`;
}
var DiagnosticSink = class {
  constructor(onDiagnostic) {
    this.onDiagnostic = onDiagnostic;
  }
  onDiagnostic;
  seen = /* @__PURE__ */ new Set();
  delivered = [];
  /** Every diagnostic delivered so far, in order. */
  get all() {
    return this.delivered;
  }
  /** Returns false (and delivers nothing) when the diagnostic is a duplicate. */
  report(diagnostic2) {
    let key = `${diagnostic2.code}|${sourceKey(diagnostic2)}|${diagnostic2.source === null ? diagnostic2.message : ""}`;
    if (this.seen.has(key)) return !1;
    if (this.seen.add(key), this.delivered.push(diagnostic2), this.onDiagnostic !== void 0)
      try {
        this.onDiagnostic(diagnostic2);
      } catch (error) {
        typeof reportError == "function" ? reportError(error) : console.error(error);
      }
    return !0;
  }
};

// src/assets/loader.ts
function closeImages(images) {
  for (let bitmap of images.values()) bitmap.close();
}
var LoadedAssets = class {
  files;
  constructor(files = /* @__PURE__ */ new Map()) {
    this.files = files;
  }
  get size() {
    return this.files.size;
  }
  has(url) {
    return this.files.has(url);
  }
  /** The verified bytes of `url`. */
  bytes(url) {
    let file = this.files.get(url);
    if (file === void 0) throw new Error(`internal error: asset '${url}' was not loaded`);
    return file.bytes;
  }
  /** The bytes of an earlier load of this exact file (same url, hash and length), if there are any. */
  reusable(asset) {
    let file = this.files.get(asset.url);
    return file !== void 0 && file.asset.sha256 === asset.sha256 && file.asset.bytes === asset.bytes ? file.bytes : void 0;
  }
  /** Every file with its state: loaded files are `ready`. */
  statuses() {
    return [...this.files.values()].map(({ asset }) => ({ url: asset.url, kind: asset.kind, state: "ready", bytes: asset.bytes }));
  }
};
function errorText(error) {
  return error instanceof Error ? error.message === "" ? error.name : error.message : String(error);
}
function quoted(text) {
  return `'${text}'`;
}
function describe2(asset) {
  return asset.kind === "image" ? asset.source === void 0 ? "image" : `image ${quoted(asset.source)}` : asset.kind === "audio" ? `sound ${quoted(asset.source)}` : `mesh data of ${[...new Set(asset.primitives.map((primitive) => primitive.source.file))].map(quoted).join(", ")}`;
}
function diagnostic(options, code, asset, message, extra = {}) {
  return makeRuntimeDiagnostic(code, {
    phase: options.phase ?? "runtime:mount",
    message,
    source: resolveSpan(options.manifest, asset.span),
    ...extra.expected === void 0 ? {} : { expected: extra.expected },
    ...extra.actual === void 0 ? {} : { actual: extra.actual },
    notes: [
      `asset file: ${asset.url}`,
      ...asset.kind === "image" && asset.source !== void 0 ? [`source file: ${asset.source}`] : [],
      ...extra.notes ?? []
    ]
  });
}
async function fetchVerified(options, asset) {
  let reused = options.previous?.reusable(asset);
  if (reused !== void 0) return { ok: !0, bytes: reused };
  let name = `Asset ${quoted(asset.url)} (${describe2(asset)})`, fail = (message, extra) => ({
    ok: !1,
    diagnostic: diagnostic(options, "E7030", asset, `${name} ${message}`, extra)
  }), url = new URL(asset.url, options.baseUrl).href, buffer;
  try {
    let response = await options.environment.fetchBytes(url);
    if (!response.ok) return fail(`could not be loaded: the server answered HTTP ${String(response.status)} for ${url}.`);
    buffer = await response.arrayBuffer();
  } catch (error) {
    return fail(`could not be loaded from ${url}: ${errorText(error)}`);
  }
  let bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== asset.bytes)
    return fail(`has ${String(bytes.byteLength)} bytes, but the build recorded ${String(asset.bytes)}.`, {
      expected: `${String(asset.bytes)} bytes`,
      actual: `${String(bytes.byteLength)} bytes`
    });
  let { sha256 } = options.environment;
  if (sha256 !== void 0) {
    let digest;
    try {
      digest = await sha256(bytes);
    } catch (error) {
      return fail(`could not be verified: computing its SHA-256 failed: ${errorText(error)}`);
    }
    if (digest !== asset.sha256.toLowerCase())
      return fail("does not match the SHA-256 recorded by the build; it was changed after the build or served from a stale cache.", {
        expected: asset.sha256,
        actual: digest
      });
  }
  return { ok: !0, bytes };
}
async function decodeVerified(options, asset, bytes) {
  let bitmap;
  try {
    bitmap = await options.environment.decodeImage(bytes);
  } catch (error) {
    return {
      ok: !1,
      diagnostic: diagnostic(options, "E7031", asset, `The browser could not decode the image ${quoted(asset.url)}${asset.source === void 0 ? "" : ` (from ${quoted(asset.source)})`}: ${errorText(error)}`, {
        notes: ["help: the file is not a valid PNG or JPEG, although its header was accepted at build time"]
      })
    };
  }
  let limit = options.maxTextureDimension2D;
  if (bitmap.width > limit || bitmap.height > limit) {
    let size = `${String(bitmap.width)} x ${String(bitmap.height)}`;
    return bitmap.close(), {
      ok: !1,
      diagnostic: diagnostic(
        options,
        "E8002",
        asset,
        `The image ${quoted(asset.url)} is ${size} pixels, larger than this device's maxTextureDimension2D (${String(limit)}).`,
        { notes: ["help: use a smaller image or lower [assets] max_texture_dimension in mtek.toml"] }
      )
    };
  }
  return { ok: !0, bitmap };
}
async function loadAssets(options) {
  let { manifest, onState } = options, list = manifest.assets, event = (asset, state) => {
    try {
      onState?.({ url: asset.url, kind: asset.kind, state });
    } catch (error) {
      typeof reportError == "function" ? reportError(error) : console.error(error);
    }
  };
  for (let asset of list) event(asset, "pending");
  let results = await Promise.all(
    list.map(async (asset) => {
      let fetched = await fetchVerified(options, asset);
      if (!fetched.ok)
        return event(asset, "failed"), { asset, fetched, decoded: void 0 };
      let decoded = asset.kind === "image" ? await decodeVerified(options, asset, fetched.bytes) : void 0;
      return event(asset, decoded?.ok === !1 ? "failed" : "ready"), { asset, fetched, decoded };
    })
  ), files = /* @__PURE__ */ new Map(), images = /* @__PURE__ */ new Map(), diagnostics = [];
  for (let { asset, fetched, decoded } of results) {
    if (!fetched.ok) {
      diagnostics.push(fetched.diagnostic);
      continue;
    }
    if (decoded?.ok === !1) {
      diagnostics.push(decoded.diagnostic);
      continue;
    }
    files.set(asset.url, { asset, bytes: fetched.bytes }), decoded !== void 0 && images.set(asset.url, decoded.bitmap);
  }
  return diagnostics.length > 0 && (closeImages(images), images.clear()), { assets: new LoadedAssets(files), images, diagnostics };
}
async function decodeImages(options) {
  let results = await Promise.all(
    options.manifest.assets.map(async (asset) => asset.kind === "image" ? { asset, decoded: await decodeVerified(options, asset, options.assets.bytes(asset.url)) } : void 0)
  ), images = /* @__PURE__ */ new Map(), diagnostics = [];
  for (let result of results)
    result !== void 0 && (result.decoded.ok ? images.set(result.asset.url, result.decoded.bitmap) : diagnostics.push(result.decoded.diagnostic));
  return diagnostics.length > 0 && (closeImages(images), images.clear()), { images, diagnostics };
}

// src/gpu/device.ts
var ALIGNMENT_LIMITS = /* @__PURE__ */ new Set(["minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment"]);
function isLittleEndianPlatform() {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
}
function mountFailure(diagnostics, kind) {
  return new MtekMountError(kind, diagnostics);
}
function errorText2(e) {
  return e instanceof Error ? e.message === "" ? e.name : e.message : String(e);
}
function navigatorGpu() {
  return typeof navigator > "u" ? void 0 : navigator.gpu;
}
function readAdapterInfo(adapter) {
  let info = adapter.info;
  return info === void 0 ? { vendor: "", architecture: "", device: "", description: "", isFallbackAdapter: null } : {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
    isFallbackAdapter: typeof info.isFallbackAdapter == "boolean" ? info.isFallbackAdapter : null
  };
}
function unmetRequirements(adapter, opts) {
  let out = [];
  for (let feature of opts.requiredFeatures)
    adapter.features.has(feature) || out.push(
      makeRuntimeDiagnostic("E8002", {
        phase: "runtime:mount",
        message: `The GPU adapter does not support the required WebGPU feature '${feature}'.`,
        expected: feature,
        actual: "unsupported"
      })
    );
  let supported = adapter.limits;
  for (let [name, required] of Object.entries(opts.requiredLimits)) {
    let actual = supported[name];
    if (typeof actual != "number") {
      out.push(
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: `The GPU adapter does not report the required limit '${name}'.`,
          expected: String(required),
          actual: "unknown limit"
        })
      );
      continue;
    }
    (ALIGNMENT_LIMITS.has(name) ? actual <= required : actual >= required) || out.push(
      makeRuntimeDiagnostic("E8002", {
        phase: "runtime:mount",
        message: `The GPU adapter's limit '${name}' is ${String(actual)}, but the program requires ${ALIGNMENT_LIMITS.has(name) ? "at most" : "at least"} ${String(required)}.`,
        expected: String(required),
        actual: String(actual)
      })
    );
  }
  return out;
}
async function acquireDevice(opts) {
  let env = opts.environment ?? {};
  if (!(env.littleEndian ?? isLittleEndianPlatform()))
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8001", {
          phase: "runtime:mount",
          message: "This platform is big-endian; WebGPU buffer contents are little-endian, so Mtek cannot run here."
        })
      ],
      "webgpu-unavailable"
    );
  let gpu = env.gpu === void 0 ? navigatorGpu() : env.gpu;
  if (gpu == null)
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8004", {
          phase: "runtime:mount",
          message: "WebGPU is not available: navigator.gpu is missing.",
          notes: ["help: use a browser with WebGPU enabled, served from a secure context (https or localhost)"]
        })
      ],
      "webgpu-unavailable"
    );
  let adapter;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch (e) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8005", {
          phase: "runtime:mount",
          message: "Requesting a GPU adapter failed.",
          notes: [`browser message: ${errorText2(e)}`]
        })
      ],
      "adapter-unavailable"
    );
  }
  if (adapter === null)
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8005", {
          phase: "runtime:mount",
          message: "No suitable GPU adapter was found (requestAdapter() returned null)."
        })
      ],
      "adapter-unavailable"
    );
  let unmet = unmetRequirements(adapter, opts);
  if (unmet.length > 0) throw mountFailure(unmet, "device-failed");
  let optional = (opts.optionalFeatures ?? []).filter((feature) => adapter.features.has(feature) && !opts.requiredFeatures.includes(feature)), device;
  try {
    device = await adapter.requestDevice({
      requiredFeatures: [...opts.requiredFeatures, ...optional],
      requiredLimits: opts.requiredLimits
    });
  } catch (e) {
    throw mountFailure(
      [
        makeRuntimeDiagnostic("E8002", {
          phase: "runtime:mount",
          message: "The GPU device could not be created with the program's required features and limits.",
          notes: [`browser message: ${errorText2(e)}`]
        })
      ],
      "device-failed"
    );
  }
  let { onDeviceLost, onUncapturedError } = opts;
  return onDeviceLost !== void 0 && device.lost.then(onDeviceLost), onUncapturedError !== void 0 && (device.onuncapturederror = onUncapturedError), { adapter, device, adapterInfo: readAdapterInfo(adapter) };
}

// src/gpu/registry.ts
function isMultipleOfFour(n) {
  return Number.isInteger(n) && n >= 0 && n % 4 === 0;
}
function describeLabel(label) {
  return label === void 0 || label === "" ? "(unlabelled)" : `'${label}'`;
}
var ResourceRegistry = class {
  constructor(device, options = {}) {
    this.device = device;
    this.onAllocationFailure = options.onAllocationFailure, this.phase = options.phase ?? "runtime:mount";
  }
  device;
  /** Changes whenever all resources are retired, including on disposal. */
  currentGeneration = 0;
  get generation() {
    return this.currentGeneration;
  }
  /** Phase recorded in allocation diagnostics. */
  phase;
  buffers = /* @__PURE__ */ new Set();
  textures = /* @__PURE__ */ new Set();
  samplers = /* @__PURE__ */ new Set();
  shaderModules = /* @__PURE__ */ new Set();
  pipelines = /* @__PURE__ */ new Set();
  bindGroups = /* @__PURE__ */ new Set();
  listeners = /* @__PURE__ */ new Set();
  buffersAllocated = 0;
  texturesAllocated = 0;
  pipelinesCreated = 0;
  shaderModulesCreated = 0;
  bindGroupsCreated = 0;
  uploads = 0;
  uploadBytes = 0;
  onAllocationFailure;
  /** A copy of the current counters. */
  snapshot() {
    return {
      buffersAllocated: this.buffersAllocated,
      texturesAllocated: this.texturesAllocated,
      pipelinesCreated: this.pipelinesCreated,
      shaderModulesCreated: this.shaderModulesCreated,
      bindGroupsCreated: this.bindGroupsCreated,
      uploads: this.uploads,
      uploadBytes: this.uploadBytes,
      liveBuffers: this.buffers.size,
      liveTextures: this.textures.size,
      liveSamplers: this.samplers.size,
      liveShaderModules: this.shaderModules.size,
      livePipelines: this.pipelines.size,
      liveBindGroups: this.bindGroups.size,
      liveListeners: this.listeners.size
    };
  }
  /** Delivers an `E8063` diagnostic (also used for failures the registry cannot observe itself, e.g. a size above `maxBufferSize`). */
  reportAllocationFailure(message, notes = []) {
    this.onAllocationFailure?.(makeRuntimeDiagnostic("E8063", { phase: this.phase, message, notes }));
  }
  /**
   * Runs `create` inside an `out-of-memory` error scope. The scope is popped synchronously (so scopes
   * stay balanced); its result arrives asynchronously and is reported as `E8063`.
   */
  withOomScope(what, create) {
    this.device.pushErrorScope("out-of-memory");
    let result;
    try {
      result = create();
    } catch (e) {
      throw this.settleScope(what, !1), e instanceof RangeError && this.reportAllocationFailure(`Allocating the GPU ${what} failed: ${e.message}`), e;
    }
    return this.settleScope(what, !0), result;
  }
  settleScope(what, report) {
    this.device.popErrorScope().then(
      (error) => {
        error !== null && report && this.reportAllocationFailure(`Allocating the GPU ${what} failed: out of memory.`, [
          `browser message: ${error.message}`
        ]);
      },
      () => {
      }
    );
  }
  createBuffer(descriptor) {
    let what = `buffer ${describeLabel(descriptor.label)} (${String(descriptor.size)} bytes)`, buffer = this.withOomScope(what, () => this.device.createBuffer(descriptor));
    return this.buffers.add(buffer), this.buffersAllocated += 1, buffer;
  }
  createTexture(descriptor) {
    let what = `texture ${describeLabel(descriptor.label)}`, texture = this.withOomScope(what, () => this.device.createTexture(descriptor));
    return this.textures.add(texture), this.texturesAllocated += 1, texture;
  }
  createSampler(descriptor) {
    let sampler = this.device.createSampler(descriptor);
    return this.samplers.add(sampler), sampler;
  }
  createShaderModule(descriptor) {
    let module = this.device.createShaderModule(descriptor);
    return this.shaderModules.add(module), this.shaderModulesCreated += 1, module;
  }
  createRenderPipeline(descriptor) {
    let pipeline = this.device.createRenderPipeline(descriptor);
    return this.pipelines.add(pipeline), this.pipelinesCreated += 1, pipeline;
  }
  /** Counted when the pipeline is ready; a rejected creation is not counted. */
  async createRenderPipelineAsync(descriptor) {
    let generation = this.currentGeneration, pipeline = await this.device.createRenderPipelineAsync(descriptor);
    if (generation !== this.currentGeneration) throw new Error("The pipeline's device resources were retired while it was being created.");
    return this.pipelines.add(pipeline), this.pipelinesCreated += 1, pipeline;
  }
  createBindGroup(descriptor) {
    let group = this.device.createBindGroup(descriptor);
    return this.bindGroups.add(group), this.bindGroupsCreated += 1, group;
  }
  /** Layouts are cheap, immutable and uncounted (`spec/runtime-abi.md` section 10.1 has no counter for them). */
  createBindGroupLayout(descriptor) {
    return this.device.createBindGroupLayout(descriptor);
  }
  createPipelineLayout(descriptor) {
    return this.device.createPipelineLayout(descriptor);
  }
  /**
   * `queue.writeBuffer` with the counters of `spec/runtime-abi.md` section 10.1. `dataOffset` and
   * `size` are in bytes (the data is an `ArrayBuffer`). `bufferOffset` and `size` must be multiples of
   * 4, as WebGPU requires.
   */
  writeBuffer(queue, buffer, bufferOffset, data, dataOffset, size) {
    if (!isMultipleOfFour(bufferOffset)) throw new RangeError(`writeBuffer: bufferOffset ${String(bufferOffset)} is not a multiple of 4`);
    if (!isMultipleOfFour(size)) throw new RangeError(`writeBuffer: size ${String(size)} is not a multiple of 4`);
    if (!Number.isInteger(dataOffset) || dataOffset < 0 || dataOffset + size > data.byteLength)
      throw new RangeError("writeBuffer: the data range exceeds the source");
    queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size), this.uploads += 1, this.uploadBytes += size;
  }
  /**
   * `queue.writeTexture` of tightly packed rows into the whole of `texture` (mip level 0), with the
   * counters of `spec/runtime-abi.md` section 10.1. `data` holds `bytesPerRow x height` bytes.
   */
  writeTexture(queue, texture, data, bytesPerRow, width, height) {
    if (!Number.isInteger(bytesPerRow) || bytesPerRow <= 0 || data.byteLength !== bytesPerRow * height)
      throw new RangeError("writeTexture: the data is not bytesPerRow x height bytes");
    queue.writeTexture({ texture }, data, { bytesPerRow, rowsPerImage: height }, { width, height }), this.uploads += 1, this.uploadBytes += data.byteLength;
  }
  /**
   * `queue.copyExternalImageToTexture` of a decoded image into mip level 0 of `texture` (which needs `COPY_DST`
   * and `RENDER_ATTACHMENT`), counted as one upload of `width x height x 4` bytes. The bitmap was decoded
   * without colour conversion or premultiplication, so the texel bytes arrive as stored: an `-srgb` format
   * reads them as sRGB-encoded, a plain format as data (`spec/assets.md` section 5).
   */
  copyExternalImage(queue, bitmap, texture) {
    let size = { width: bitmap.width, height: bitmap.height };
    queue.copyExternalImageToTexture({ source: bitmap, flipY: !1 }, { texture, colorSpace: "srgb", premultipliedAlpha: !1 }, size), this.uploads += 1, this.uploadBytes += size.width * size.height * 4;
  }
  /** Adds a DOM listener; the returned function removes it (once). `destroyAll` removes any that remain. */
  addEventListener(target, type, listener, options) {
    let record = { target, type, listener, options };
    return target.addEventListener(type, listener, options), this.listeners.add(record), () => {
      this.listeners.delete(record) && target.removeEventListener(type, listener, options);
    };
  }
  /** Releases one resource: buffers and textures are destroyed, the rest are dropped from the live counts. */
  release(resource) {
    if (this.buffers.delete(resource))
      resource.destroy();
    else if (this.textures.delete(resource))
      resource.destroy();
    else if (!this.samplers.delete(resource) && !this.shaderModules.delete(resource) && !this.pipelines.delete(resource) && !this.bindGroups.delete(resource))
      throw new Error("ResourceRegistry.release: the resource is not registered or was already released");
  }
  /**
   * Device recovery (`spec/runtime-abi.md` section 9.4): every GPU object belongs to the lost device, so
   * the buffers and textures are destroyed (a no-op on a lost device) and everything is dropped; creation
   * now goes to `device`. DOM listeners and the cumulative counters stay, so the live counts describe the
   * rebuilt scene and the totals describe the whole session.
   */
  recycle(device) {
    this.currentGeneration += 1;
    for (let buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
    for (let texture of this.textures) texture.destroy();
    this.textures.clear(), this.samplers.clear(), this.shaderModules.clear(), this.pipelines.clear(), this.bindGroups.clear(), this.device = device;
  }
  /** Destroys every buffer and texture, drops everything else and removes every listener. Cumulative counters are kept. */
  destroyAll() {
    this.currentGeneration += 1;
    for (let record of this.listeners) record.target.removeEventListener(record.type, record.listener, record.options);
    this.listeners.clear();
    for (let buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
    for (let texture of this.textures) texture.destroy();
    this.textures.clear(), this.samplers.clear(), this.shaderModules.clear(), this.pipelines.clear(), this.bindGroups.clear();
  }
};

// src/input/keys.ts
var LETTERS = Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`), DIGITS = Array.from({ length: 10 }, (_, i) => `Digit${String(i)}`), MAPPED_KEY_CODES = Object.freeze([
  ...LETTERS,
  ...DIGITS,
  "Space",
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight"
]), MAPPED = new Set(MAPPED_KEY_CODES);
function isMappedKeyCode(code) {
  return typeof code == "string" && MAPPED.has(code);
}

// src/input/dom.ts
function pointerPosition(canvas, clientX, clientY) {
  let rect = canvas.getBoundingClientRect(), width = rect.width > 0 ? rect.width : 1, height = rect.height > 0 ? rect.height : 1, clamp3 = (v) => Math.fround(Math.min(1, Math.max(-1, v)));
  return { x: clamp3((clientX - rect.left) / width * 2 - 1), y: clamp3(1 - (clientY - rect.top) / height * 2) };
}
function attachInputListeners(input, targets) {
  let { canvas, registry, handledKeys } = targets;
  targets.document !== void 0 && (registry.addEventListener(targets.document, "keydown", (event) => {
    let key = event;
    isMappedKeyCode(key.code) && (handledKeys.has(key.code) && key.preventDefault(), input.keyDown(key.code, key.repeat));
  }), registry.addEventListener(targets.document, "keyup", (event) => {
    let key = event;
    isMappedKeyCode(key.code) && (handledKeys.has(key.code) && key.preventDefault(), input.keyUp(key.code));
  })), targets.window !== void 0 && registry.addEventListener(targets.window, "blur", () => {
    input.focusLost();
  });
  let at3 = (event) => {
    let pointer = event;
    return { ...pointerPosition(canvas, pointer.clientX, pointer.clientY), button: pointer.button };
  };
  registry.addEventListener(canvas, "pointerdown", (event) => {
    let pointer = event;
    if (!pointer.isPrimary) return;
    let where = at3(event);
    if (input.pointerDown(where.x, where.y, where.button))
      try {
        canvas.setPointerCapture?.(pointer.pointerId);
      } catch {
      }
  }), registry.addEventListener(canvas, "pointerup", (event) => {
    if (!event.isPrimary) return;
    let where = at3(event);
    input.pointerUp(where.x, where.y, where.button);
  }), registry.addEventListener(canvas, "pointercancel", () => {
    input.pointerCancelled();
  }), registry.addEventListener(canvas, "pointermove", (event) => {
    if (!event.isPrimary) return;
    let where = at3(event);
    input.pointerMove(where.x, where.y);
  });
}

// src/physics/load.ts
function errorText3(error) {
  return error instanceof Error ? error.message === "" ? error.name : `${error.name}: ${error.message}` : String(error);
}
function failure(options, url, why, browserMessage) {
  return {
    ok: !1,
    diagnostics: [
      makeRuntimeDiagnostic("E8102", {
        phase: options.phase,
        message: `The physics module could not be loaded: ${why}`,
        notes: [
          ...url === void 0 ? [] : [`module: ${url}`],
          ...browserMessage === void 0 ? [] : [`browser message: ${browserMessage}`],
          "help: the program has bodies, so physics/<hash>.js must be served next to app.js (mtek build writes it)"
        ]
      })
    ]
  };
}
function physicsModuleUrl(manifest, baseUrl) {
  let module = manifest.subsystems.physicsModule;
  return manifest.subsystems.physics && module !== void 0 ? new URL(module, baseUrl).href : void 0;
}
async function loadPhysicsBackend(options) {
  let url = physicsModuleUrl(options.manifest, options.baseUrl);
  if (url === void 0) return failure(options, void 0, "the manifest declares physics but names no module (subsystems.physicsModule).");
  let module;
  try {
    module = await options.importModule(url);
  } catch (error) {
    return failure(options, url, "importing it failed.", errorText3(error));
  }
  let load = typeof module == "object" && module !== null ? module.default : void 0;
  if (typeof load != "function") return failure(options, url, "the module has no default export that is a function.");
  let backend;
  try {
    backend = await load();
  } catch (error) {
    return failure(options, url, "initialising the physics engine failed.", errorText3(error));
  }
  let candidate = backend;
  return typeof candidate != "object" || candidate === null || typeof candidate.createWorld != "function" || typeof candidate.name != "string" ? failure(options, url, "the module's default export did not resolve to a physics backend (name, createWorld).") : { ok: !0, backend: candidate, url };
}

// src/scene/errors.ts
var RuntimeInternalError = class extends Error {
  constructor(message) {
    super(`internal error: ${message}`), this.name = "RuntimeInternalError";
  }
};

// src/scene/values.ts
function hasNumbers(value, keys) {
  if (typeof value != "object" || value === null) return !1;
  let record = value;
  return keys.every((key) => typeof record[key] == "number");
}
function isVec3(value) {
  if (typeof value != "object" || value === null) return !1;
  let record = value;
  return typeof record.x == "number" && typeof record.y == "number" && typeof record.z == "number";
}
function isQuat(value) {
  if (typeof value != "object" || value === null) return !1;
  let record = value;
  return typeof record.x == "number" && typeof record.y == "number" && typeof record.z == "number" && typeof record.w == "number";
}
function isColor(value) {
  if (typeof value != "object" || value === null) return !1;
  let record = value;
  return typeof record.r == "number" && typeof record.g == "number" && typeof record.b == "number" && typeof record.a == "number";
}
function isFiniteVec3(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}
function isFiniteQuat(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) && Number.isFinite(value.w);
}
var VECTOR_KEYS = {
  vec2: ["x", "y"],
  vec3: ["x", "y", "z"],
  vec4: ["x", "y", "z", "w"],
  quat: ["x", "y", "z", "w"],
  color: ["r", "g", "b", "a"]
};
function paramValueProblem(type, value) {
  switch (type) {
    case "f32":
      return typeof value == "number" && Number.isFinite(value) ? void 0 : "expected a finite number";
    case "i32":
      return typeof value == "number" && Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31 ? void 0 : "expected an integer in the i32 range";
    case "u32":
      return typeof value == "number" && Number.isInteger(value) && value >= 0 && value < 2 ** 32 ? void 0 : "expected an integer in the u32 range";
    case "bool":
      return typeof value == "boolean" ? void 0 : "expected a boolean";
    case "mat4":
      return value instanceof Float32Array && value.length === 16 ? void 0 : "expected a Float32Array of 16 numbers";
    default: {
      let keys = VECTOR_KEYS[type];
      return keys === void 0 ? typeof value == "object" && value !== null ? void 0 : `expected an object or array for the ${type} param` : hasNumbers(value, keys) && keys.every((key) => Number.isFinite(value[key])) ? void 0 : `expected {${keys.join(", ")}} with finite numbers`;
    }
  }
}
function describeValue(value) {
  return isColor(value) ? `(r ${String(value.r)}, g ${String(value.g)}, b ${String(value.b)}, a ${String(value.a)})` : isQuat(value) ? `(${String(value.x)}, ${String(value.y)}, ${String(value.z)}, ${String(value.w)})` : isVec3(value) ? `(${String(value.x)}, ${String(value.y)}, ${String(value.z)})` : typeof value == "number" || typeof value == "boolean" ? String(value) : typeof value == "string" ? JSON.stringify(value) : Object.prototype.toString.call(value);
}

// src/physics/commands.ts
var COMMAND_CATEGORIES = ["teleport", "linearVelocity", "kinematicTarget", "impulse", "force"], CommandQueue = class {
  lanes = {
    teleport: [],
    linearVelocity: [],
    kinematicTarget: [],
    impulse: [],
    force: []
  };
  count = 0;
  /** The number of commands waiting. */
  get size() {
    return this.count;
  }
  push(command) {
    this.lanes[command.category].push(command), this.count += 1;
  }
  /**
   * Removes every queued command and returns them in application order: by category, each category in the
   * order its commands were pushed. Commands pushed after this call belong to the next batch.
   */
  take() {
    let batch = [];
    for (let category of COMMAND_CATEGORIES) {
      let lane = this.lanes[category];
      for (let command of lane) batch.push(command);
      lane.length = 0;
    }
    return this.count = 0, batch;
  }
  /** Drops everything that is queued (the world was disposed or rebuilt). */
  clear() {
    for (let category of COMMAND_CATEGORIES) this.lanes[category].length = 0;
    this.count = 0;
  }
};

// src/physics/events.ts
function collisionPair(a, b, started) {
  return a <= b ? { low: a, high: b, started } : { low: b, high: a, started };
}
function sortCollisions(pairs) {
  return pairs.sort((x, y) => x.started !== y.started ? x.started ? -1 : 1 : x.low - y.low || x.high - y.high);
}

// src/physics/system.ts
var ZERO = Object.freeze({ x: 0, y: 0, z: 0 }), f32 = Math.fround, MIN_ROTATION_LENGTH_SQUARED = 1e-20;
function bodyDesc(body) {
  return body.kind === "dynamic" ? { kind: "dynamic", mass: body.mass, linearDamping: body.linearDamping, angularDamping: body.angularDamping } : { kind: body.kind };
}
function colliderDesc(collider) {
  return { shape: collider.kind === "box" ? { kind: "box", size: { x: collider.size[0], y: collider.size[1], z: collider.size[2] } } : { kind: "sphere", radius: collider.radius }, sensor: collider.sensor, friction: collider.friction, restitution: collider.restitution };
}
function finiteRotation(rotation2) {
  return isFiniteQuat(rotation2) && rotation2.x * rotation2.x + rotation2.y * rotation2.y + rotation2.z * rotation2.z + rotation2.w * rotation2.w >= MIN_ROTATION_LENGTH_SQUARED;
}
function frozenVec3(x, y, z) {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z) });
}
var SUPPORTED = {
  apply_impulse: ["dynamic"],
  apply_force: ["dynamic"],
  set_linear_velocity: ["dynamic"],
  set_kinematic_target: ["kinematic"],
  teleport: ["dynamic", "kinematic"],
  linear_velocity: ["dynamic", "kinematic"],
  angular_velocity: ["dynamic", "kinematic"]
}, PhysicsSystem = class {
  /**
   * Creates the backend world (gravity from `manifest.scene.fields`, the manifest's fixed step) and starts to
   * follow the spawned entities of `world`. Bodies of the named entities are made by {@link createNamedBodies},
   * once the scene is initialised. Throws what the backend throws; the caller reports it as `E8102`.
   */
  constructor(options) {
    this.options = options;
    let [x, y, z] = options.manifest.scene.fields.gravity;
    this.physics = options.backend.createWorld({ x, y, z }, options.manifest.runtimeConfig.fixedStep);
    let listener = {
      created: (entity) => {
        this.entityCreated(entity);
      },
      removed: (entity) => {
        this.entityRemoved(entity);
      }
    };
    this.stopListening = options.world.dynamic.addListener(listener);
  }
  options;
  physics;
  /** By slot. */
  bodies = [];
  queue = new CommandQueue();
  stopListening;
  stepCount = 0;
  frozenCount = 0;
  disposed = !1;
  // ---- bodies ----
  /**
   * Creates the bodies of the named entities from the manifest, at their poses after `init`, the bindings and the
   * propagation of transforms (`spec/scenes.md` section 11, step 5).
   */
  createNamedBodies() {
    let { world, manifest } = this.options;
    manifest.scene.entities.forEach((entity, index) => {
      let record = world.entities[index];
      entity.body === null || entity.collider === null || record === void 0 || this.addBody(record.ref, record, entity.body, entity.collider, entity.name);
    });
  }
  entityCreated(entity) {
    let body = entity.prefab.resolved.body, collider = entity.prefab.resolved.collider;
    body === null || collider === null || this.addBody(entity.ref, entity.record, body, collider, entity.prefab.resolved.name);
  }
  entityRemoved(entity) {
    let entry = this.bodies[entity.ref.slot];
    entry === void 0 || entry.ref.gen !== entity.ref.gen || (this.bodies[entity.ref.slot] = void 0, entry.handle !== void 0 && this.physics.removeBody(entry.handle));
  }
  addBody(ref, record, body, collider, name) {
    let entry = { ref, kind: body.kind, name, handle: void 0, linear: ZERO, angular: ZERO };
    this.bodies[ref.slot] = entry;
    let pose = { position: record.position, rotation: record.rotation };
    if (!isFiniteVec3(pose.position) || !finiteRotation(pose.rotation)) {
      this.report("E8104", ref.slot, `The body of '${name}' was not created: its pose ${describeValue(pose.position)} / ${describeValue(pose.rotation)} is not finite. The entity keeps its pose and does not take part in the simulation.`);
      return;
    }
    entry.handle = this.physics.addBody(bodyDesc(body), colliderDesc(collider), pose, ref.slot);
  }
  // ---- ctx.body ----
  /** `ctx.body(target, spanId)` (`spec/runtime-abi.md` section 4.2). */
  handle(target, spanId) {
    if (this.disposed) throw new RuntimeInternalError("ctx.body was used after the physics subsystem was disposed.");
    let ref = this.refOf(target);
    return new BodyHandleImpl(this, ref, typeof spanId == "number" && Number.isInteger(spanId) ? spanId : -1);
  }
  refOf(target) {
    if (typeof target == "object" && target !== null) {
      let candidate = target;
      if (typeof candidate.slot == "number" && typeof candidate.gen == "number") return target;
      let ref = candidate.ref;
      if (typeof ref?.slot == "number" && typeof ref.gen == "number") return ref;
    }
    throw new RuntimeInternalError(`ctx.body got ${describeValue(target)}; expected an entity record or an entity_ref.`);
  }
  /**
   * The entry a command of `command` (`snake_case`, as in the language) aimed at `ref` applies to, or `undefined`
   * when the command is dropped: for a pending or dead target with `W8031` (decided by `DynamicEntities`), for an
   * entity whose body kind does not support it with `E8101`, silently for a frozen body (already reported).
   * @internal Used by the handle only.
   */
  entryFor(ref, spanId, command) {
    let { dynamic } = this.options.world;
    if (!(dynamic.status(ref) !== "static" && dynamic.commandTarget(ref, spanId, command) === void 0))
      return this.supported(ref, spanId, command, "command");
  }
  /**
   * As {@link entryFor} for a read of a readable property: a target that does not exist reads as zero without a
   * diagnostic, one whose kind has no such property is `E8101`. @internal Used by the handle only.
   */
  entryForRead(ref, spanId, property) {
    let status = this.options.world.dynamic.status(ref);
    if (!(status !== "static" && status !== "alive"))
      return this.supported(ref, spanId, property, "read");
  }
  /** The entry for `command` (a command or a readable property), or `undefined` with `E8101` / silently when frozen. */
  supported(ref, spanId, command, what) {
    let entry = this.bodies[ref.slot], resolved = this.options.world.resolvedAt(ref.slot), outcome = what === "command" ? `The command ${command} was dropped` : `The read of ${command} gave zero`;
    if (entry === void 0 || entry.ref.gen !== ref.gen) {
      this.reportAt("E8101", spanId, `${outcome}: '${resolved?.name ?? String(ref.slot)}' has no body.`, []);
      return;
    }
    let kinds = SUPPORTED[command] ?? [];
    if (!kinds.includes(entry.kind)) {
      this.reportAt("E8101", spanId, `${outcome}: '${entry.name}' has a ${entry.kind} body, which does not support it.`, [
        `${command} applies to ${kinds.join(" and ")} bodies`
      ]);
      return;
    }
    return entry.handle === void 0 ? void 0 : entry;
  }
  /**
   * Queues `command` after checking the vectors and rotations among its arguments (`checked`); a value that is not
   * finite drops the command with `E8104`. @internal Used by the handle only.
   */
  enqueue(entry, spanId, name, command, checked) {
    for (let value of checked) {
      let rotation2 = isQuat(value);
      if (!(rotation2 ? finiteRotation(value) : isFiniteVec3(value))) {
        this.reportAt(
          "E8104",
          spanId,
          `The command ${name} on '${entry.name}' was dropped: its argument ${describeValue(value)} is not finite${rotation2 ? " (or is a rotation of zero length)" : ""}.`,
          []
        );
        return;
      }
    }
    this.queue.push(command);
  }
  // ---- the tick ----
  /** Step 2 of the tick: the queued commands, once, by category and issue order (`./commands.ts`). */
  applyCommands() {
    for (let command of this.queue.take()) {
      let entry = this.bodies[command.target.slot];
      if (entry === void 0 || entry.handle === void 0 || entry.ref.gen !== command.target.gen) continue;
      let handle = entry.handle;
      switch (command.category) {
        case "teleport":
          this.physics.teleport(handle, command.pose, command.keepVelocity);
          break;
        case "linearVelocity":
          this.physics.setLinearVelocity(handle, command.vector);
          break;
        case "kinematicTarget":
          this.physics.setKinematicTarget(handle, command.pose);
          break;
        case "impulse":
          this.physics.applyImpulse(handle, command.vector);
          break;
        case "force":
          this.physics.addForceForNextStep(handle, command.vector);
          break;
      }
    }
  }
  /** Steps 4 to 6 of the tick: `step`, the write-back and the velocities, then the collision events. */
  stepAndDeliver() {
    this.physics.step(), this.stepCount += 1, this.writeBack(), this.deliverCollisions();
  }
  /** Step 5: the poses of dynamic and kinematic bodies go into the entity records (world = local for root bodies). */
  writeBack() {
    let { world } = this.options, setter = world.ctx;
    for (let entry of this.bodies) {
      if (entry === void 0 || entry.kind === "static" || entry.handle === void 0) continue;
      let pose = this.physics.readPose(entry.handle);
      if (!isFiniteVec3(pose.position) || !isFiniteQuat(pose.rotation)) {
        this.freeze(entry, pose);
        continue;
      }
      let record = world.recordAt(entry.ref.slot);
      if (record === void 0) continue;
      setter.setTransform(record, "position", frozenVec3(pose.position.x, pose.position.y, pose.position.z)), setter.setTransform(record, "rotation", Object.freeze({ x: f32(pose.rotation.x), y: f32(pose.rotation.y), z: f32(pose.rotation.z), w: f32(pose.rotation.w) }));
      let velocities = this.physics.readVelocities(entry.handle);
      entry.linear = frozenVec3(velocities.linear.x, velocities.linear.y, velocities.linear.z), entry.angular = frozenVec3(velocities.angular.x, velocities.angular.y, velocities.angular.z);
    }
  }
  /**
   * `E8103`: the solver produced a pose that is not finite. The body is taken out of the simulation (a NaN body
   * would poison its contacts), the entity keeps its last finite pose, reads zero velocities and ignores
   * commands, and the loop goes on. Reported once per body.
   */
  freeze(entry, pose) {
    entry.handle !== void 0 && (this.physics.removeBody(entry.handle), entry.handle = void 0, entry.linear = ZERO, entry.angular = ZERO, this.frozenCount += 1, this.report(
      "E8103",
      entry.ref.slot,
      `The solver produced a pose that is not finite for '${entry.name}': position ${describeValue(pose.position)}, rotation ${describeValue(pose.rotation)}. The body is frozen: the entity keeps its last pose and no longer takes part in the simulation.`
    ));
  }
  /** Step 6: drain, sort (`spec/physics.md` section 6) and deliver. */
  deliverCollisions() {
    let pairs = [];
    if (this.physics.drainCollisions((a, b, started) => {
      pairs.push(collisionPair(a, b, started));
    }), pairs.length === 0) return;
    let { world } = this.options, live = (ref) => {
      if (ref === void 0) return !1;
      let status = world.dynamic.status(ref);
      return status === "static" || status === "alive";
    };
    for (let pair of sortCollisions(pairs)) {
      let kind = pair.started ? "collision_enter" : "collision_exit", low = world.recordAt(pair.low)?.ref, high = world.recordAt(pair.high)?.ref;
      live(low) && live(high) && this.options.deliver(kind, pair.low, high), live(low) && live(high) && this.options.deliver(kind, pair.high, low);
    }
  }
  // ---- introspection and lifetime ----
  /** Bodies and colliders in the backend's world (both 0 after {@link dispose}). */
  counts() {
    return this.disposed ? { bodies: 0, colliders: 0 } : this.physics.counts();
  }
  /** Steps taken so far. */
  get steps() {
    return this.stepCount;
  }
  /** Bodies taken out of the simulation by `E8103`. */
  get frozenBodies() {
    return this.frozenCount;
  }
  /** The commands waiting for the next tick. */
  get pendingCommands() {
    return this.queue.size;
  }
  /** Frees the world, every body and collider and the event queue (`spec/physics.md` section 4). Idempotent. */
  dispose() {
    this.disposed || (this.disposed = !0, this.stopListening(), this.queue.clear(), this.bodies.length = 0, this.physics.dispose());
  }
  // ---- diagnostics ----
  phase() {
    return this.options.world.phase;
  }
  /** A diagnostic located at the declaration of the entity in `slot`. */
  report(code, slot, message) {
    let symbol = this.options.world.resolvedAt(slot)?.symbol, span = symbol === void 0 ? void 0 : spanOfSymbol(this.options.manifest, symbol);
    this.options.report(
      makeRuntimeDiagnostic(code, {
        phase: code === "E8103" ? "runtime:tick" : this.phase(),
        message,
        source: span === void 0 ? null : resolveSpan(this.options.manifest, span)
      })
    );
  }
  /** A diagnostic located at the command or property of the program that caused it (`spanId` of `ctx.body`). */
  reportAt(code, spanId, message, notes) {
    this.options.report(makeRuntimeDiagnostic(code, { phase: this.phase(), message, notes, source: resolveSpan(this.options.manifest, spanId) }));
  }
}, BodyHandleImpl = class {
  constructor(system, ref, span) {
    this.system = system;
    this.ref = ref;
    this.span = span;
  }
  system;
  ref;
  span;
  applyImpulse(impulse) {
    let entry = this.system.entryFor(this.ref, this.span, "apply_impulse");
    if (entry === void 0) return;
    let vector = this.vec3(impulse, "apply_impulse");
    this.system.enqueue(entry, this.span, "apply_impulse", { category: "impulse", target: entry.ref, vector }, [vector]);
  }
  applyForce(force) {
    let entry = this.system.entryFor(this.ref, this.span, "apply_force");
    if (entry === void 0) return;
    let vector = this.vec3(force, "apply_force");
    this.system.enqueue(entry, this.span, "apply_force", { category: "force", target: entry.ref, vector }, [vector]);
  }
  setLinearVelocity(velocity) {
    let entry = this.system.entryFor(this.ref, this.span, "set_linear_velocity");
    if (entry === void 0) return;
    let vector = this.vec3(velocity, "set_linear_velocity");
    this.system.enqueue(entry, this.span, "set_linear_velocity", { category: "linearVelocity", target: entry.ref, vector }, [vector]);
  }
  setKinematicTarget(position, rotation2) {
    let entry = this.system.entryFor(this.ref, this.span, "set_kinematic_target");
    if (entry === void 0) return;
    let pose = this.pose(position, rotation2, "set_kinematic_target");
    this.system.enqueue(entry, this.span, "set_kinematic_target", { category: "kinematicTarget", target: entry.ref, pose }, [pose.position, pose.rotation]);
  }
  teleport(position, rotation2, keepVelocity) {
    let entry = this.system.entryFor(this.ref, this.span, "teleport");
    if (entry === void 0) return;
    if (typeof keepVelocity != "boolean") throw new RuntimeInternalError(`ctx.body(..).teleport got ${describeValue(keepVelocity)} for keep_velocity; expected a bool.`);
    let pose = this.pose(position, rotation2, "teleport");
    this.system.enqueue(entry, this.span, "teleport", { category: "teleport", target: entry.ref, pose, keepVelocity }, [pose.position, pose.rotation]);
  }
  get linearVelocity() {
    return this.system.entryForRead(this.ref, this.span, "linear_velocity")?.linear ?? ZERO;
  }
  get angularVelocity() {
    return this.system.entryForRead(this.ref, this.span, "angular_velocity")?.angular ?? ZERO;
  }
  vec3(value, command) {
    if (!isVec3(value)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(value)}; expected a vec3.`);
    return value;
  }
  pose(position, rotation2, command) {
    if (!isVec3(position)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(position)} for the position; expected a vec3.`);
    if (!isQuat(rotation2)) throw new RuntimeInternalError(`ctx.body(..) ${command} got ${describeValue(rotation2)} for the rotation; expected a quat.`);
    return { position, rotation: rotation2 };
  }
};

// src/input/input.ts
function isKnownButton(button) {
  return button === 0 || button === 1 || button === 2;
}
var InputState = class {
  queue = [];
  pendingMove = null;
  arrivalKeys = /* @__PURE__ */ new Set();
  deliveredKeys = /* @__PURE__ */ new Set();
  arrivalButtons = /* @__PURE__ */ new Map();
  deliveredButtons = /* @__PURE__ */ new Map();
  paused = !1;
  /** `is_key_down(code)`: the delivered state, as of the end of phase 1 of the current frame. */
  isKeyDown(code) {
    return this.deliveredKeys.has(code);
  }
  /** The number of transitions waiting for the next phase 1. */
  get pending() {
    return this.queue.length + (this.pendingMove === null ? 0 : 1);
  }
  /** A `keydown`. Returns whether it is a transition: unmapped codes, repeats and held keys are not. */
  keyDown(code, repeat = !1) {
    return this.paused || repeat || !isMappedKeyCode(code) || this.arrivalKeys.has(code) ? !1 : (this.arrivalKeys.add(code), this.queue.push({ kind: "key_down", code }), !0);
  }
  /** A `keyup`. Returns whether it is a transition: only a key that arrived as down can be released. */
  keyUp(code) {
    return this.paused || !isMappedKeyCode(code) || !this.arrivalKeys.delete(code) ? !1 : (this.queue.push({ kind: "key_up", code }), !0);
  }
  pointerDown(x, y, button) {
    return this.paused || !isKnownButton(button) || this.arrivalButtons.has(button) ? !1 : (this.arrivalButtons.set(button, { x, y }), this.queue.push({ kind: "pointer_down", x, y, button }), !0);
  }
  pointerUp(x, y, button) {
    return this.paused || !this.arrivalButtons.delete(button) ? !1 : (this.queue.push({ kind: "pointer_up", x, y, button }), !0);
  }
  /** Coalesced: only the latest position of the frame is kept. */
  pointerMove(x, y) {
    return this.paused ? !1 : (this.pendingMove = { x, y }, !0);
  }
  /** The document lost focus or became hidden: everything held is released at the next frame. */
  focusLost() {
    if (!this.paused) {
      for (let code of this.arrivalKeys) this.queue.push({ kind: "key_up", code });
      this.arrivalKeys.clear(), this.pointerCancelled();
    }
  }
  /** The browser cancelled the pointer (`pointercancel`): held buttons are released at the next frame. */
  pointerCancelled() {
    if (!this.paused) {
      for (let [button, at3] of this.arrivalButtons) this.queue.push({ kind: "pointer_up", x: at3.x, y: at3.y, button });
      this.arrivalButtons.clear();
    }
  }
  /** Stops accepting transitions and drops the ones not yet delivered. */
  pause() {
    this.paused = !0, this.queue = [], this.pendingMove = null;
  }
  /**
   * Accepts transitions again. What generated code believes is held is released at the next frame,
   * because the key-up events of the paused interval were never seen.
   */
  resume() {
    if (this.paused) {
      this.paused = !1, this.arrivalKeys.clear();
      for (let code of this.deliveredKeys) this.queue.push({ kind: "key_up", code });
      this.arrivalButtons.clear();
      for (let [button, at3] of this.deliveredButtons) this.queue.push({ kind: "pointer_up", x: at3.x, y: at3.y, button });
    }
  }
  /**
   * Phase 1: takes the queued transitions, updates the delivered state with them and returns them in
   * delivery order.
   */
  deliver() {
    let out = this.queue;
    this.queue = [], this.pendingMove !== null && (out.push({ kind: "pointer_move", x: this.pendingMove.x, y: this.pendingMove.y, button: 0 }), this.pendingMove = null);
    for (let transition of out)
      switch (transition.kind) {
        case "key_down":
          this.deliveredKeys.add(transition.code);
          break;
        case "key_up":
          this.deliveredKeys.delete(transition.code);
          break;
        case "pointer_down":
          this.deliveredButtons.set(transition.button, { x: transition.x, y: transition.y });
          break;
        case "pointer_up":
          this.deliveredButtons.delete(transition.button);
          break;
        case "pointer_move":
          break;
      }
    return out;
  }
};

// src/audio/audio.ts
var VOLUME_RANGE = [0, 4], PITCH_RANGE = [0.0625, 16];
function browserAudioBackend() {
  let scope = globalThis, Ctor = scope.AudioContext ?? scope.webkitAudioContext, Offline = scope.OfflineAudioContext;
  if (Ctor === void 0 || Offline === void 0) return;
  let decoder;
  return {
    createContext: () => new Ctor(),
    decode: (bytes) => (decoder ??= new Offline(1, 1, 44100), decoder.decodeAudioData(bytes.slice().buffer))
  };
}
var SILENT_AUDIO = Object.freeze({
  play: () => {
  },
  playAt: () => {
  },
  playMusic: () => {
  },
  stopMusic: () => {
  },
  setVolume: () => {
  },
  setMuted: () => {
  },
  isMuted: () => !1
});
function finite(value) {
  return typeof value == "number" && Number.isFinite(value) ? value : void 0;
}
var AudioSystem = class {
  constructor(options) {
    this.options = options;
    let pending = [];
    for (let asset of options.manifest.assets) {
      if (asset.kind !== "audio") continue;
      let sound = { url: asset.url, span: asset.span, buffer: void 0, state: "pending" };
      this.sounds.set(asset.source, sound), pending.push(this.decodeOne(sound));
    }
    this.decoded = Promise.all(pending).then(() => {
    });
  }
  options;
  sounds = /* @__PURE__ */ new Map();
  context;
  master;
  volume = 1;
  muted = !1;
  music;
  active = /* @__PURE__ */ new Set();
  disposed = !1;
  /** Resolves when every sound is decoded or failed (for tests). */
  decoded;
  /** Whether the program declares any sound. */
  get hasSounds() {
    return this.sounds.size > 0;
  }
  /** The state of every sound by source path (for `debug` and tests). */
  states() {
    return Object.fromEntries([...this.sounds].map(([source, sound]) => [source, sound.state]));
  }
  /** Whether the first gesture created the playing context. */
  get unlocked() {
    return this.context !== void 0;
  }
  async decodeOne(sound) {
    let backend = this.options.backend;
    if (backend === void 0) {
      sound.state = "failed";
      return;
    }
    let bytes = this.options.bytes(sound.url);
    try {
      if (bytes === void 0) throw new Error("its bytes were not loaded");
      sound.buffer = await backend.decode(bytes), sound.state = "ready";
    } catch (error) {
      sound.state = "failed", this.options.report(
        makeRuntimeDiagnostic("W8202", {
          phase: "runtime:mount",
          message: `The browser could not decode the sound '${sound.url}': ${error instanceof Error ? error.message : String(error)}. Playing it does nothing.`,
          source: resolveSpan(this.options.manifest, sound.span),
          notes: ["help: convert the sound to 16-bit PCM WAV, which every browser decodes"]
        })
      );
    }
  }
  /**
   * The first key press, click or touch: creates (or resumes) the playing context, inside the gesture as browsers
   * require. Idempotent; the host calls it from capturing `pointerdown`, `keydown` and `touchend` listeners.
   */
  unlock() {
    if (!this.disposed) {
      if (this.context === void 0) {
        let context = this.options.backend?.createContext();
        if (context === void 0) return;
        this.context = context, this.master = context.createGain(), this.master.connect(context.destination), this.applyMaster();
        let wanted = this.music;
        wanted !== void 0 && wanted.node === void 0 && this.startMusic(wanted.source, wanted.volume);
      }
      this.context.state === "suspended" && this.context.resume().catch(() => {
      });
    }
  }
  applyMaster() {
    this.master !== void 0 && (this.master.gain.value = this.muted ? 0 : this.volume);
  }
  clamp(spanId, value, fallback, range, what) {
    if (value === void 0) return fallback;
    let number = finite(value), [lo, hi] = range;
    if (number !== void 0 && number >= lo && number <= hi) return number;
    let used = number === void 0 ? fallback : Math.min(hi, Math.max(lo, number));
    return this.options.report(
      makeRuntimeDiagnostic("W8201", {
        phase: "runtime:update",
        message: `The ${what} ${describe3(value)} is outside ${String(lo)} to ${String(hi)}; ${String(used)} is used.`,
        source: typeof spanId == "number" ? resolveSpan(this.options.manifest, spanId) : null,
        expected: `${String(lo)} to ${String(hi)}`,
        actual: describe3(value)
      })
    ), used;
  }
  ready(sound) {
    if (typeof sound != "string") return;
    let found = this.sounds.get(sound);
    return found?.state === "ready" ? found : void 0;
  }
  source(sound, volume, pitch, loop, last) {
    let context = this.context;
    if (context === void 0 || this.master === void 0) return;
    let node = context.createBufferSource();
    node.buffer = sound.buffer, node.loop = loop, node.playbackRate.value = pitch;
    let gain = context.createGain();
    return gain.gain.value = volume, node.connect(gain), last === void 0 ? gain.connect(this.master) : (gain.connect(last), last.connect(this.master)), loop || (this.active.add(node), node.onended = () => {
      this.active.delete(node), node.disconnect(), gain.disconnect(), last?.disconnect();
    }), node.start(), { node, gain };
  }
  play(spanId, sound, volume, pitch) {
    let v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume"), p = this.clamp(spanId, pitch, 1, PITCH_RANGE, "pitch"), found = this.ready(sound);
    found !== void 0 && this.source(found, v, p, !1);
  }
  playAt(spanId, sound, position, volume) {
    let v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume"), found = this.ready(sound), context = this.context;
    if (found === void 0 || context === void 0) return;
    let panner = context.createPanner();
    panner.panningModel = "equalpower", panner.distanceModel = "inverse", panner.refDistance = 1;
    let [x, y, z] = relativeToListener(position, this.options.listener?.());
    panner.setPosition(x, y, z), this.source(found, v, 1, !1, panner);
  }
  playMusic(spanId, sound, volume) {
    let v = this.clamp(spanId, volume, 1, VOLUME_RANGE, "volume");
    typeof sound == "string" && (this.stopMusic(), this.music = { source: sound, volume: v }, this.context !== void 0 && this.startMusic(sound, v));
  }
  startMusic(source, volume) {
    let found = this.ready(source);
    if (found === void 0 || this.music === void 0) return;
    let started = this.source(found, volume, 1, !0);
    started !== void 0 && (this.music.node = started.node, this.music.gain = started.gain);
  }
  stopMusic() {
    let music = this.music;
    this.music = void 0, music?.node !== void 0 && (music.node.stop(), music.node.disconnect(), music.gain?.disconnect());
  }
  setVolume(spanId, volume) {
    this.volume = this.clamp(spanId, volume, this.volume, VOLUME_RANGE, "volume"), this.applyMaster();
  }
  setMuted(_spanId, muted) {
    this.muted = muted === !0, this.applyMaster();
  }
  isMuted() {
    return this.muted;
  }
  adopt(manifest, bytes) {
    for (let asset of manifest.assets) {
      if (asset.kind !== "audio") continue;
      let known = this.sounds.get(asset.source);
      if (known !== void 0 && known.url === asset.url) continue;
      let sound = { url: asset.url, span: asset.span, buffer: void 0, state: "pending" };
      this.sounds.set(asset.source, sound);
      let backend = this.options.backend;
      if (backend === void 0) {
        sound.state = "failed";
        continue;
      }
      let data = bytes(asset.url);
      if (data === void 0) {
        sound.state = "failed";
        continue;
      }
      backend.decode(data).then(
        (buffer) => {
          sound.buffer = buffer, sound.state = "ready";
        },
        () => {
          sound.state = "failed";
        }
      );
    }
  }
  /** Stops every sound and closes the context (`dispose()`). Idempotent. */
  dispose() {
    if (!this.disposed) {
      this.disposed = !0, this.stopMusic();
      for (let node of this.active)
        try {
          node.stop();
        } catch {
        }
      this.active.clear(), this.context?.close().catch(() => {
      }), this.context = void 0;
    }
  }
};
function relativeToListener(position, pose) {
  let p = position, px = finite(p?.x) ?? 0, py = finite(p?.y) ?? 0, pz = finite(p?.z) ?? 0;
  if (pose === void 0) return [px, py, pz];
  let d = [px - pose.position.x, py - pose.position.y, pz - pose.position.z], { x, y, z, w } = pose.rotation, right = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], forward = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
  if (pose.target !== null) {
    let f = normalize([pose.target.x - pose.position.x, pose.target.y - pose.position.y, pose.target.z - pose.position.z]);
    f !== void 0 && (forward = f, right = normalize(cross(f, [0, 1, 0])) ?? [1, 0, 0], up = cross(right, f));
  }
  let dot = (a, b) => (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  return [dot(d, right), dot(d, up), -dot(d, forward)];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) {
  let length2 = Math.hypot(v[0], v[1], v[2]);
  return length2 > 1e-12 ? [v[0] / length2, v[1] / length2, v[2] / length2] : void 0;
}
function describe3(value) {
  return typeof value == "number" || typeof value == "boolean" || typeof value == "bigint" ? String(value) : typeof value == "string" ? JSON.stringify(value) : typeof value;
}

// src/hud/hud.ts
var TEXT_SIZE_RANGE = [1, 512], RECT_SIZE_RANGE = [0, 8192], MAX_HUD_ITEMS = 512, DEFAULT_SIZE = 24, NO_HUD = Object.freeze({
  text: () => {
  },
  rect: () => {
  },
  button: () => !1
}), TEXT_STYLE = "position:absolute;white-space:pre;line-height:1.2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.65);user-select:none;pointer-events:none", RECT_STYLE = "position:absolute;pointer-events:none", BUTTON_STYLE = "position:absolute;white-space:pre;line-height:1.2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:.3em .9em;border:1px solid rgba(255,255,255,.5);border-radius:.4em;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;user-select:none;pointer-events:auto;transform:translate(-50%,-50%)";
function finite2(value) {
  return typeof value == "number" && Number.isFinite(value) ? value : void 0;
}
function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
function linearToSrgb(c) {
  let v = clamp(c, 0, 1);
  return v <= 31308e-7 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}
function cssColor(value) {
  if (typeof value != "object" || value === null) return "rgba(255,255,255,1)";
  let c = value, channel = (x) => String(Math.round(linearToSrgb(finite2(x) ?? 1) * 255)), alpha = clamp(finite2(c.a) ?? 1, 0, 1);
  return `rgba(${channel(c.r)},${channel(c.g)},${channel(c.b)},${String(Math.round(alpha * 1e3) / 1e3)})`;
}
function point(value) {
  if (typeof value != "object" || value === null) return { x: 0, y: 0 };
  let v = value;
  return { x: finite2(v.x) ?? 0, y: finite2(v.y) ?? 0 };
}
function placement(x, y) {
  return {
    left: `${String((x + 1) / 2 * 100)}%`,
    top: `${String((1 - y) / 2 * 100)}%`
  };
}
var HudSystem = class {
  constructor(options) {
    this.options = options;
  }
  options;
  items = [];
  shown = [];
  layer = null;
  geometry = { left: -1, top: -1, width: -1, height: -1 };
  pendingClicks = /* @__PURE__ */ new Set();
  buttonKeys = /* @__PURE__ */ new WeakMap();
  labelCounts = /* @__PURE__ */ new Map();
  warnedSpans = /* @__PURE__ */ new Set();
  disposed = !1;
  /** Phase 1: a new frame draws a new list. */
  beginFrame() {
    this.items = [], this.labelCounts.clear();
  }
  text(spanId, content, at3, size, tint, align) {
    let { x, y } = point(at3);
    this.push(spanId, {
      kind: "text",
      content: typeof content == "string" ? content : "",
      x,
      y,
      size: clamp(finite2(size) ?? DEFAULT_SIZE, ...TEXT_SIZE_RANGE),
      tint: cssColor(tint),
      align: clamp(finite2(align) ?? 0.5, 0, 1)
    });
  }
  rect(spanId, at3, size, tint, align) {
    let { x, y } = point(at3), extent = point(size);
    this.push(spanId, {
      kind: "rect",
      x,
      y,
      width: clamp(extent.x, ...RECT_SIZE_RANGE),
      height: clamp(extent.y, ...RECT_SIZE_RANGE),
      tint: cssColor(tint),
      align: clamp(finite2(align) ?? 0.5, 0, 1)
    });
  }
  button(spanId, label, at3, size) {
    let content = typeof label == "string" ? label : "", index = this.labelCounts.get(content) ?? 0;
    this.labelCounts.set(content, index + 1);
    let key = `${String(index)}:${content}`, { x, y } = point(at3);
    return this.push(spanId, {
      kind: "button",
      content,
      x,
      y,
      size: clamp(finite2(size) ?? DEFAULT_SIZE, ...TEXT_SIZE_RANGE),
      key
    }), this.pendingClicks.delete(key);
  }
  /** After the frame's updates: the DOM shows this frame's list. Clicks no call claimed are dropped. */
  present() {
    if (this.disposed || (this.pendingClicks.clear(), this.items.length === 0 && this.layer === null)) return;
    let layer = this.ensureLayer();
    this.placeLayer(layer);
    for (let i = 0; i < this.items.length; i++) {
      let item = this.items[i];
      if (item === void 0) continue;
      let shown = this.shown[i];
      if (shown?.kind !== item.kind) {
        shown?.element.remove(), shown = this.create(item.kind);
        let next = this.shown[i + 1]?.element ?? null;
        layer.insertBefore(shown.element, next), this.shown[i] = shown;
      }
      this.update(shown, item);
    }
    for (let extra of this.shown.splice(this.items.length))
      extra.element.remove();
  }
  /** Removes the layer; later calls draw nothing. Idempotent. */
  dispose() {
    this.disposed = !0, this.layer?.remove(), this.layer = null, this.shown = [], this.items = [], this.pendingClicks.clear();
  }
  push(spanId, item) {
    if (!this.disposed) {
      if (this.items.length >= MAX_HUD_ITEMS) {
        let span = typeof spanId == "number" ? spanId : -1;
        this.warnedSpans.has(span) || (this.warnedSpans.add(span), this.options.report(
          makeRuntimeDiagnostic("W8203", {
            phase: "runtime:update",
            message: `This frame drew more than ${String(MAX_HUD_ITEMS)} HUD items; the rest are not shown.`,
            source: span >= 0 ? resolveSpan(this.options.manifest, span) : null,
            expected: `at most ${String(MAX_HUD_ITEMS)} items per frame`
          })
        ));
        return;
      }
      this.items.push(item);
    }
  }
  ensureLayer() {
    if (this.layer !== null) return this.layer;
    let { canvas, document: document2 } = this.options, layer = document2.createElement("div");
    return layer.setAttribute("data-mtek-hud", ""), layer.setAttribute("aria-live", "off"), set(
      layer.style,
      "cssText",
      "position:absolute;overflow:hidden;pointer-events:none;z-index:1"
    ), (canvas.parentElement ?? document2.body).insertBefore(
      layer,
      canvas.parentElement === null ? null : canvas.nextSibling
    ), this.layer = layer, layer;
  }
  placeLayer(layer) {
    let { canvas } = this.options, g = this.geometry;
    g.left === canvas.offsetLeft && g.top === canvas.offsetTop && g.width === canvas.offsetWidth && g.height === canvas.offsetHeight || (g.left = canvas.offsetLeft, g.top = canvas.offsetTop, g.width = canvas.offsetWidth, g.height = canvas.offsetHeight, set(layer.style, "left", `${String(g.left)}px`), set(layer.style, "top", `${String(g.top)}px`), set(layer.style, "width", `${String(g.width)}px`), set(layer.style, "height", `${String(g.height)}px`));
  }
  create(kind) {
    let element = this.options.document.createElement(
      kind === "button" ? "button" : "div"
    );
    return element.setAttribute(`data-mtek-hud-${kind}`, ""), kind === "button" ? (element.setAttribute("type", "button"), set(element.style, "cssText", BUTTON_STYLE), element.addEventListener(
      "mousedown",
      (event) => event.preventDefault?.()
    ), element.addEventListener(
      "pointerdown",
      (event) => event.stopPropagation?.()
    ), element.addEventListener("click", (event) => {
      event.stopPropagation?.();
      let key = this.buttonKeys.get(element);
      key !== void 0 && this.pendingClicks.add(key);
    })) : set(element.style, "cssText", kind === "text" ? TEXT_STYLE : RECT_STYLE), { kind, element, written: /* @__PURE__ */ new Map() };
  }
  update(shown, item) {
    let write = (name, value) => {
      shown.written.get(name) !== value && (shown.written.set(name, value), name === "#text" ? shown.element.textContent = value : set(shown.element.style, name, value));
    }, { left, top } = placement(item.x, item.y);
    switch (write("left", left), write("top", top), item.kind) {
      case "text":
        write("#text", item.content), write("fontSize", `${String(item.size)}px`), write("color", item.tint), write("transform", `translate(${String(-item.align * 100)}%,-50%)`);
        break;
      case "rect":
        write("width", `${String(item.width)}px`), write("height", `${String(item.height)}px`), write("background", item.tint), write("transform", `translate(${String(-item.align * 100)}%,-50%)`);
        break;
      case "button":
        write("#text", item.content), write("fontSize", `${String(item.size)}px`), this.buttonKeys.set(shown.element, item.key);
        break;
    }
  }
};
function set(style, name, value) {
  style[name] = value;
}

// src/math/mat4.ts
function at(a, i) {
  let value = a[i];
  if (value === void 0) throw new RangeError(`matrix index ${i} out of range`);
  return value;
}
function identity() {
  let m = new Float32Array(16);
  return m[0] = 1, m[5] = 1, m[10] = 1, m[15] = 1, m;
}
function translation(v) {
  let m = identity();
  return m[12] = v.x, m[13] = v.y, m[14] = v.z, m;
}
function scaling(v) {
  let m = new Float32Array(16);
  return m[0] = v.x, m[5] = v.y, m[10] = v.z, m[15] = 1, m;
}
function transpose(m) {
  let out = new Float32Array(16);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) out[row * 4 + col] = at(m, col * 4 + row);
  return out;
}
function multiply(a, b) {
  return multiplyInto(new Float32Array(16), a, b);
}
function multiplyInto(out, a, b) {
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}
function rotation(q) {
  return rotationInto(new Float32Array(16), q);
}
function rotationInto(m, q) {
  let { x, y, z, w } = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return m[0] = 1 - 2 * (yy + zz), m[1] = 2 * (xy + wz), m[2] = 2 * (xz - wy), m[3] = 0, m[4] = 2 * (xy - wz), m[5] = 1 - 2 * (xx + zz), m[6] = 2 * (yz + wx), m[7] = 0, m[8] = 2 * (xz + wy), m[9] = 2 * (yz - wx), m[10] = 1 - 2 * (xx + yy), m[11] = 0, m[12] = 0, m[13] = 0, m[14] = 0, m[15] = 1, m;
}
function fromRotationTranslationScaleInto(out, scratch, rotationQuat, translationVec, scale) {
  let r = rotationInto(scratch, rotationQuat), sx = scale.x, sy = scale.y, sz = scale.z;
  return out[0] = r[0] * sx, out[1] = r[1] * sx, out[2] = r[2] * sx, out[3] = 0, out[4] = r[4] * sy, out[5] = r[5] * sy, out[6] = r[6] * sy, out[7] = 0, out[8] = r[8] * sz, out[9] = r[9] * sz, out[10] = r[10] * sz, out[11] = 0, out[12] = translationVec.x, out[13] = translationVec.y, out[14] = translationVec.z, out[15] = 1, out;
}
function perspective(fovY, aspect, near, far) {
  let f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
  return m[0] = f / aspect, m[5] = f, m[10] = far / (near - far), m[11] = -1, m[14] = near * far / (near - far), m;
}
function orthographic(height, aspect, near, far) {
  let width = height * aspect, m = new Float32Array(16);
  return m[0] = 2 / width, m[5] = 2 / height, m[10] = 1 / (near - far), m[14] = near / (near - far), m[15] = 1, m;
}
function lookAtRotation(position, target) {
  let fx = target.x - position.x, fy = target.y - position.y, fz = target.z - position.z, fLength = Math.hypot(fx, fy, fz);
  if (!(fLength > 0) || !Number.isFinite(fLength))
    throw new RangeError("look-at needs distinct, finite position and target");
  fx /= fLength, fy /= fLength, fz /= fLength;
  let upIsMinusZ = Math.abs(fy) > 1 - 1e-6, ux0 = 0, uy0 = upIsMinusZ ? 0 : 1, uz0 = upIsMinusZ ? -1 : 0, rx = fy * uz0 - fz * uy0, ry = fz * ux0 - fx * uz0, rz = fx * uy0 - fy * ux0, rLength = Math.hypot(rx, ry, rz);
  rx /= rLength, ry /= rLength, rz /= rLength;
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx, m = new Float32Array(16);
  return m[0] = rx, m[1] = ry, m[2] = rz, m[4] = ux, m[5] = uy, m[6] = uz, m[8] = -fx, m[9] = -fy, m[10] = -fz, m[15] = 1, m;
}
function viewFromRotation(position, r) {
  return multiply(transpose(r), translation({ x: -position.x, y: -position.y, z: -position.z }));
}
function viewMatrix(position, orientation) {
  let r = "target" in orientation ? lookAtRotation(position, orientation.target) : rotation(orientation.rotation);
  return viewFromRotation(position, r);
}
function normalMatrixInto(out, offset, model) {
  let a = at(model, 0), b = at(model, 4), c = at(model, 8), d = at(model, 1), e = at(model, 5), f = at(model, 9), g = at(model, 2), h = at(model, 6), i = at(model, 10), c00 = e * i - f * h, c01 = f * g - d * i, c02 = d * h - e * g, c10 = c * h - b * i, c11 = a * i - c * g, c12 = b * g - a * h, c20 = b * f - c * e, c21 = c * d - a * f, c22 = a * e - b * d, det = a * c00 + b * c01 + c * c02;
  if (det === 0 || !Number.isFinite(det))
    throw new RangeError("normal matrix of a singular transform is undefined");
  let inv = 1 / det;
  return out[offset] = c00 * inv, out[offset + 1] = c10 * inv, out[offset + 2] = c20 * inv, out[offset + 3] = 0, out[offset + 4] = c01 * inv, out[offset + 5] = c11 * inv, out[offset + 6] = c21 * inv, out[offset + 7] = 0, out[offset + 8] = c02 * inv, out[offset + 9] = c12 * inv, out[offset + 10] = c22 * inv, out[offset + 11] = 0, out[offset + 12] = 0, out[offset + 13] = 0, out[offset + 14] = 0, out[offset + 15] = 1, out;
}

// src/scene/slots.ts
var DEAD_REF = Object.freeze({ slot: -1, gen: 0 });
function makeRef(slot, gen) {
  return Object.freeze({ slot, gen });
}
var FREE = 0, RESERVED = 1, ALIVE = 2, REMOVING = 3, CANCELLED = 4, EntitySlots = class _EntitySlots {
  staticCount;
  maxEntities;
  /** Generation per slot: the generation the slot's current (or, when free, next) entity has. */
  gens = [];
  states = [];
  /** Freed slots, the most recently freed last (reused first). */
  free = [];
  spawnQueue = [];
  removeQueue = [];
  /** Spawned slots that are not free. */
  dynamicInUse = 0;
  dynamicAlive = 0;
  constructor(staticCount, maxEntities) {
    if (!Number.isInteger(staticCount) || staticCount < 0) throw new RangeError(`EntitySlots: staticCount must be a non-negative integer, got ${String(staticCount)}`);
    if (!Number.isInteger(maxEntities) || maxEntities < 1) throw new RangeError(`EntitySlots: maxEntities must be a positive integer, got ${String(maxEntities)}`);
    this.staticCount = staticCount, this.maxEntities = maxEntities;
    for (let slot = 0; slot < staticCount; slot += 1)
      this.gens.push(0), this.states.push(ALIVE);
  }
  /**
   * The table that follows `previous` after a hot reload (decision 0064): the same generations, so references
   * the program kept in its state stay stale, and the spawned entities that were alive stay alive in the same
   * slots (the caller creates their records again), except those `keep` rejects. Anything queued or pending
   * removal, and what `keep` rejects, is dropped: its slot is free again, one generation later.
   */
  static successor(previous, staticCount, maxEntities, keep = () => !0) {
    let table = new _EntitySlots(staticCount, maxEntities);
    for (let slot = staticCount; slot < previous.gens.length; slot += 1) {
      let state = previous.states[slot] ?? FREE, gen = previous.gens[slot] ?? 0, alive = state === ALIVE && keep(slot);
      table.gens.push(alive || state === FREE ? gen : gen + 1), table.states.push(alive ? ALIVE : FREE), alive ? (table.dynamicInUse += 1, table.dynamicAlive += 1) : table.free.push(slot);
    }
    return table;
  }
  /** The number of slots the table has (static plus every spawned slot ever used). */
  get capacity() {
    return this.gens.length;
  }
  /** Entities that count against the limit: named, alive, pending spawn and pending removal. */
  get inUse() {
    return this.staticCount + this.dynamicInUse;
  }
  /** Entities for which `alive` is true: the named ones and the spawned ones that are created and not pending removal. */
  get aliveCount() {
    return this.staticCount + this.dynamicAlive;
  }
  get pendingSpawns() {
    return this.spawnQueue.length;
  }
  get pendingRemovals() {
    return this.removeQueue.length;
  }
  /** The generation `slot` has now, or `undefined` outside the table. */
  generation(slot) {
    return this.gens[slot];
  }
  /**
   * Reserves a slot for a spawn queued with `payload` and returns its reference, or `undefined` when the limit
   * (`maxEntities`) is reached. The entity does not exist until the next `flush`.
   */
  spawn(payload) {
    if (this.inUse >= this.maxEntities) return;
    let slot = this.free.pop();
    return slot === void 0 && (slot = this.gens.length, this.gens.push(0), this.states.push(FREE)), this.states[slot] = RESERVED, this.dynamicInUse += 1, this.spawnQueue.push({ slot, payload }), makeRef(slot, this.gens[slot] ?? 0);
  }
  status(ref) {
    let slot = ref.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.gens.length || this.gens[slot] !== ref.gen) return "dead";
    if (slot < this.staticCount) return "static";
    switch (this.states[slot]) {
      case RESERVED:
        return "pending-spawn";
      case ALIVE:
        return "alive";
      case REMOVING:
      case CANCELLED:
        return "pending-removal";
      default:
        return "dead";
    }
  }
  /** `alive(ref)`: true for a named entity and for a spawned one that exists and is not pending removal. */
  isAlive(ref) {
    let status = this.status(ref);
    return status === "static" || status === "alive";
  }
  /** `destroy(ref)`: the entity is pending removal from now on; the flush removes it. */
  destroy(ref) {
    switch (this.status(ref)) {
      case "static":
        return "static";
      case "dead":
        return "dead";
      case "pending-removal":
        return "pending";
      case "pending-spawn":
        return this.states[ref.slot] = CANCELLED, "cancelled";
      case "alive":
        return this.states[ref.slot] = REMOVING, this.dynamicAlive -= 1, this.removeQueue.push(ref.slot), "queued";
    }
  }
  /**
   * A flush point (`spec/scenes.md` section 10): the removals first, each slot freed with a new generation, then
   * the spawns in the order of the calls. Returns what the owner has to release and create.
   */
  flush() {
    let removed = [];
    for (let slot of this.removeQueue)
      removed.push(makeRef(slot, this.gens[slot] ?? 0)), this.release(slot);
    this.removeQueue = [];
    let spawned = [], cancelled = 0;
    for (let { slot, payload } of this.spawnQueue) {
      if (this.states[slot] === CANCELLED) {
        cancelled += 1, this.release(slot);
        continue;
      }
      this.states[slot] = ALIVE, this.dynamicAlive += 1, spawned.push({ ref: makeRef(slot, this.gens[slot] ?? 0), payload });
    }
    return this.spawnQueue = [], { removed, spawned, cancelled };
  }
  /** Frees `slot` under the next generation. */
  release(slot) {
    this.gens[slot] = (this.gens[slot] ?? 0) + 1, this.states[slot] = FREE, this.dynamicInUse -= 1, this.free.push(slot);
  }
};

// src/scene/dynamic.ts
var INPUT_EVENTS = ["key_down", "key_up", "pointer_down", "pointer_up", "pointer_move"], COLLISION_EVENTS = ["collision_enter", "collision_exit"];
function buildPrefabRuntimes(prefabs, code) {
  let runtimes = /* @__PURE__ */ new Map();
  for (let resolved of prefabs) {
    let program = code.get(resolved.symbol);
    if (program === void 0) throw new RuntimeInternalError(`the program module has no code for the prefab '${resolved.symbol}'.`);
    let steps = [...resolved.bindings].sort((a, b) => a.order - b.order || a.id - b.id).map((binding) => {
      let compute = program.bindings[binding.id];
      if (compute === void 0) throw new RuntimeInternalError(`binding ${String(binding.id)} of prefab '${resolved.symbol}' has no function in the program module.`);
      return { binding, compute };
    }), handlers = /* @__PURE__ */ new Map();
    for (let event of [...INPUT_EVENTS, ...COLLISION_EVENTS]) {
      let declared = program.events[event];
      declared !== void 0 && declared.length > 0 && handlers.set(event, declared);
    }
    runtimes.set(resolved.symbol, { resolved, program, steps, handlers });
  }
  return runtimes;
}
function isRefLike(value) {
  return typeof value == "object" && value !== null && typeof value.slot == "number" && typeof value.gen == "number";
}
var DynamicEntities = class {
  constructor(options) {
    this.options = options;
    this.slots = new EntitySlots(options.staticCount, options.maxEntities), this.nextInstance = options.firstInstance;
  }
  options;
  slots;
  /** The entities that exist, in spawn order (`spec/scenes.md` section 10.1). Replaced by a flush, never edited. */
  liveList = [];
  /** By slot. */
  bySlot = [];
  listeners = /* @__PURE__ */ new Set();
  render;
  materials;
  nextOrder = 0;
  nextInstance;
  freeInstances = [];
  spawnedTotal = 0;
  destroyedTotal = 0;
  versionCounter = 0;
  /** The spawned entities that exist, in spawn order; includes those pending removal (`removing`). */
  get live() {
    return this.liveList;
  }
  /** Increases whenever an entity was created or removed: the draw list depends on it. */
  get version() {
    return this.versionCounter;
  }
  /** Entities for which `alive` is true: the named ones and the spawned ones that are not pending removal. */
  get aliveCount() {
    return this.slots.aliveCount;
  }
  /** The number of slots of the entity table. */
  get slotCapacity() {
    return this.slots.capacity;
  }
  get pendingSpawns() {
    return this.slots.pendingSpawns;
  }
  get pendingRemovals() {
    return this.slots.pendingRemovals;
  }
  /** Entities created since the scene started. */
  get spawned() {
    return this.spawnedTotal;
  }
  /** Entities removed since the scene started. */
  get destroyed() {
    return this.destroyedTotal;
  }
  /** The prefab `symbol`, if the program spawns it. */
  prefab(symbol) {
    return this.options.prefabs.get(symbol);
  }
  /** Every prefab the program spawns, in manifest order. */
  prefabRuntimes() {
    return this.options.prefabs.values();
  }
  /** The spawned entity in `slot`, if one exists there. */
  entityAt(slot) {
    return this.bySlot[slot];
  }
  /** What `ref` stands for right now. */
  status(ref) {
    return this.slots.status(ref);
  }
  addListener(listener) {
    return this.listeners.add(listener), () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Connects the render side and the material side: spawned entities are created and removed through them.
   * Called when the scene starts and again after a device loss, with the rebuilt stores.
   */
  attach(render, materials) {
    this.render = render, this.materials = materials;
  }
  // ---- the intrinsics of the context ----
  /** `ctx.spawn(prefabId, params, spanId)` (`spec/scenes.md` section 9). */
  spawn(prefabId, params, spanId) {
    let prefab = typeof prefabId == "string" ? this.options.prefabs.get(prefabId) : void 0;
    if (prefab === void 0)
      throw new RuntimeInternalError(`generated code spawned ${describeValue(prefabId)}, which is not a prefab of the manifest (prefabs: ${[...this.options.prefabs.keys()].join(", ")}).`);
    if (typeof params != "object" || params === null)
      throw new RuntimeInternalError(`ctx.spawn("${prefab.resolved.symbol}", ${describeValue(params)}) expects the object of the prefab's params.`);
    for (let param of prefab.resolved.params)
      if (!Object.hasOwn(params, param.name))
        throw new RuntimeInternalError(`ctx.spawn("${prefab.resolved.symbol}", \u2026) gives no value for the param '${param.name}'.`);
    let frozen = Object.freeze({ ...params }), ref = this.slots.spawn({ prefab, params: frozen });
    return ref === void 0 ? (this.warn("E8033", spanId, `The entity limit of ${String(this.options.maxEntities)} is reached: spawn(${prefab.resolved.name} { .. }) returns a dead reference and creates nothing.`, [
      "the limit is [runtime] max_entities in mtek.toml; entities pending removal still count until the next flush"
    ]), DEAD_REF) : ref;
  }
  /** `ctx.destroy(ref, spanId)` (`spec/scenes.md` sections 4.5 and 9). */
  destroy(ref, spanId) {
    if (!isRefLike(ref)) throw new RuntimeInternalError(`ctx.destroy got ${describeValue(ref)}; expected an entity_ref.`);
    switch (this.slots.destroy(ref)) {
      case "queued": {
        let entity = this.bySlot[ref.slot];
        entity !== void 0 && (entity.removing = !0);
        return;
      }
      case "cancelled":
        return;
      case "static":
        this.warn("E8030", spanId, "A named entity cannot be destroyed: it lives as long as the scene. The call does nothing.", ["hide it with `visible: false`"]);
        return;
      case "pending":
        this.warn("W8032", spanId, "This entity is already pending removal: destroying it again does nothing.");
        return;
      case "dead":
        this.warn("W8032", spanId, "This entity is already destroyed (or the reference is dead): destroying it again does nothing.");
        return;
    }
  }
  /** `ctx.alive(ref)`. */
  alive(ref) {
    if (!isRefLike(ref)) throw new RuntimeInternalError(`ctx.alive got ${describeValue(ref)}; expected an entity_ref.`);
    return this.slots.isAlive(ref);
  }
  /**
   * For a command aimed at an entity through a reference (body commands, `spec/physics.md` section 3): the
   * spawned entity `ref` names if it can take the command now. A command for an entity that is pending removal
   * is dropped with `W8031`, one for a pending spawn (nothing exists yet) or a dead reference likewise; named
   * entities are not spawned entities and give `undefined` silently (the caller finds them by index).
   */
  commandTarget(ref, spanId, command) {
    let status = this.slots.status(ref);
    if (status === "alive") return this.bySlot[ref.slot];
    if (status === "static") return;
    let why = status === "pending-removal" ? "pending removal" : status === "pending-spawn" ? "not created yet" : "destroyed or dead";
    this.warn("W8031", spanId, `The command ${command} was dropped: its entity is ${why}.`);
  }
  // ---- flush points ----
  /**
   * A lifecycle flush point (`spec/scenes.md` section 10): removes the entities pending removal, then creates
   * the queued spawns in the order of the calls. An entity created here first runs in the next phase that starts
   * after the flush.
   */
  flush() {
    if (this.slots.pendingRemovals === 0 && this.slots.pendingSpawns === 0) return;
    let { removed, spawned } = this.slots.flush();
    if (removed.length > 0) {
      for (let ref of removed) this.remove(ref);
      this.liveList = this.liveList.filter((entity) => this.bySlot[entity.ref.slot] === entity);
    }
    if (spawned.length > 0) {
      let created = [];
      for (let request of spawned) created.push(this.create(request.ref, request.payload));
      this.liveList = [...this.liveList, ...created];
      for (let entity of created) this.announce(entity);
    }
    this.versionCounter += 1;
  }
  /** Evaluates the bindings of every spawned entity that is not pending removal, each prefab's in order. */
  evaluateBindings() {
    for (let entity of this.liveList)
      entity.removing || this.bind(entity);
  }
  // ---- device recovery and hot reload ----
  /**
   * After a device loss (`spec/runtime-abi.md` section 9.4): the stores were rebuilt, so every entity that
   * exists gets its material instance and its place in the renderer again, under the same instance index, and
   * its mirrored material param values are written to the new store. The entities, slots and queues are kept.
   */
  rebuild(render, materials) {
    this.attach(render, materials);
    for (let entity of this.liveList) {
      let instance = entity.resolved.instance;
      if (instance !== null) {
        materials.createInstance(instance);
        let mirror = entity.record.mat?.p ?? {};
        for (let param of instance.material.params)
          instance.material.resources.some((resource) => resource.name === param.name) || materials.writeParam(instance.index, param.name, mirror[param.name]);
        materials.shareInstance(instance.index);
      }
      render.addEntity(entity.resolved);
    }
  }
  /**
   * After a hot reload that did not restart the scene (decision 0064): this table takes over the generations of
   * `previous` and every spawned entity that exists there is created again under the same slot, generation and
   * params, by the new program's `init`; `carry` then moves what the program kept (transform, visibility, state,
   * imperative material params) from the old record to the new one. An entity whose prefab no longer exists is
   * dropped, and its references stay dead. Call it on an empty table, before the first frame.
   */
  restoreFrom(previous, carry) {
    if (this.slots.capacity > this.options.staticCount || this.liveList.length > 0)
      throw new RuntimeInternalError("a hot reload restored spawned entities into a table that already has some.");
    let keep = previous.liveList.filter((entity) => !entity.removing && this.options.prefabs.has(entity.prefab.resolved.symbol)), kept = new Set(keep.map((entity) => entity.ref.slot));
    this.slots = EntitySlots.successor(previous.slots, this.options.staticCount, this.options.maxEntities, (slot) => kept.has(slot)), this.nextOrder = 0;
    let created = [];
    for (let old of keep) {
      let prefab = this.options.prefabs.get(old.prefab.resolved.symbol);
      if (prefab === void 0) continue;
      let entity = this.create(old.ref, { prefab, params: old.record.params });
      carry(old, entity), created.push(entity);
    }
    this.liveList = created, this.spawnedTotal = previous.spawnedTotal, this.destroyedTotal = previous.destroyedTotal;
    for (let entity of created) this.announce(entity);
    this.versionCounter += 1;
  }
  // ---- internals ----
  /** Creates the entity of `ref` (its slot is alive already): record, GPU state, `init`, bindings. */
  create(ref, request) {
    let { render, materials } = this.attached(), { prefab, params } = request, slot = ref.slot, instance = null, material = prefab.resolved.material;
    material !== null && (instance = {
      index: this.takeInstance(),
      material: material.material,
      entity: slot,
      shareable: material.shareable,
      resources: material.resources
    });
    let resolved = {
      index: slot,
      name: prefab.resolved.name,
      symbol: prefab.resolved.symbol,
      parent: null,
      mesh: prefab.resolved.mesh,
      instance
    }, host = this.options.host, record = host.makeRecord(ref, resolved, prefab, params), entity = { record, resolved, ref, prefab, order: this.nextOrder++, removing: !1, attachments: /* @__PURE__ */ new Map() };
    return this.bySlot[slot] = entity, host.register(slot, record, resolved), instance !== null && materials.createInstance(instance), render.addEntity(resolved), prefab.program.init(host.ctx, record, params), this.bind(entity), instance !== null && instance.shareable && materials.shareInstance(instance.index), this.spawnedTotal += 1, entity;
  }
  announce(entity) {
    for (let listener of this.listeners) listener.created?.(entity);
  }
  /** Releases everything the removed entity `ref` owns. */
  remove(ref) {
    let { render, materials } = this.attached(), entity = this.bySlot[ref.slot];
    if (entity === void 0) return;
    for (let listener of this.listeners) listener.removed?.(entity);
    entity.attachments.clear(), render.removeEntity(entity.resolved);
    let instance = entity.resolved.instance;
    instance !== null && (materials.removeInstance(instance.index), this.freeInstances.push(instance.index)), this.options.host.unregister(ref.slot, entity.record), this.bySlot[ref.slot] = void 0, this.destroyedTotal += 1;
  }
  takeInstance() {
    return this.freeInstances.pop() ?? this.nextInstance++;
  }
  /** Evaluates the bindings of one instance in order and applies each value through the context's setters. */
  bind(entity) {
    let steps = entity.prefab.steps;
    if (steps.length === 0) return;
    let ctx = this.options.host.ctx, record = entity.record;
    for (let step2 of steps) {
      let value = step2.compute(this.options.host.ctx, record), target = step2.binding.target;
      switch (target.kind) {
        case "transform":
          ctx.setTransform(record, target.field, value);
          break;
        case "visible":
          ctx.setVisible(record, value);
          break;
        case "param":
          ctx.setParam(record, target.name, value);
          break;
        default:
          throw new RuntimeInternalError(`binding ${String(step2.binding.id)} of prefab '${entity.prefab.resolved.name}' targets a ${target.kind}, which a prefab cannot bind.`);
      }
    }
  }
  attached() {
    if (this.render === void 0 || this.materials === void 0)
      throw new RuntimeInternalError("a spawned entity was created before the scene's renderer and materials existed (spawn is not allowed during initialisation).");
    return { render: this.render, materials: this.materials };
  }
  warn(code, spanId, message, notes = []) {
    this.options.host.report(
      makeRuntimeDiagnostic(code, {
        phase: this.options.host.phase,
        message,
        notes,
        source: typeof spanId == "number" && Number.isInteger(spanId) ? this.options.host.source(spanId) : null
      })
    );
  }
};

// src/scene/world.ts
var CONTEXT_MEMBERS = [
  "s",
  "e",
  "cam",
  "frame",
  "setTransform",
  "setVisible",
  "setParam",
  "setCamera",
  "setLight",
  "spawn",
  "destroy",
  "alive",
  "body",
  "budget",
  "warn",
  "random",
  "isKeyDown",
  "print",
  "audio",
  "hud"
], INERT_SERVICES = Object.freeze({
  random: () => 0,
  isKeyDown: () => !1,
  print: () => {
  }
}), CAMERA_FIELDS = [
  "position",
  "target",
  "rotation",
  "projection.fov_y",
  "projection.height",
  "projection.near",
  "projection.far"
], TRANSFORM_FIELDS = ["position", "rotation", "scale"], f322 = Math.fround, ORIGIN = Object.freeze({ x: 0, y: 0, z: 0 }), UNIT_SCALE = Object.freeze({ x: 1, y: 1, z: 1 }), IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 }), CAMERA_POSITION = Object.freeze({ x: 0, y: 0, z: 5 }), DEFAULT_FOV_Y = f322(0.9), DEFAULT_HEIGHT = 10, DEFAULT_NEAR = f322(0.1), DEFAULT_FAR = 1e3, WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 }), LIGHT_FIELDS = ["color", "intensity"];
function zeroValue(type) {
  switch (type) {
    case "f32":
    case "i32":
    case "u32":
      return 0;
    case "bool":
      return !1;
    case "string":
      return "";
    case "vec2":
      return Object.freeze({ x: 0, y: 0 });
    case "vec3":
      return ORIGIN;
    case "vec4":
      return Object.freeze({ x: 0, y: 0, z: 0, w: 0 });
    case "quat":
      return IDENTITY;
    case "color":
      return Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
    case "mat4":
      return new Float32Array(16);
    default:
      return null;
  }
}
function sameQuat(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}
function sameVec3(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
function isWarningCode(code) {
  return code.startsWith("W") && Object.hasOwn(RUNTIME_DIAGNOSTIC_CATALOGUE, code);
}
function stateObject(entries) {
  let state = /* @__PURE__ */ Object.create(null);
  for (let entry of entries) state[entry.name] = zeroValue(entry.type);
  return state;
}
function guarded(members, name) {
  let known = new Set(Reflect.ownKeys(members));
  return new Proxy(members, {
    get(target, property, receiver) {
      if (typeof property == "symbol") return Reflect.get(target, property, receiver);
      if (known.has(property)) return target[property];
      throw new RuntimeInternalError(
        `generated code read ${name}.${property}, which this runtime build does not provide (the context has ${CONTEXT_MEMBERS.join(", ")}).`
      );
    },
    set(_target, property) {
      throw new RuntimeInternalError(`generated code assigned ${name}.${String(property)}; the context is read-only.`);
    },
    defineProperty(_target, property) {
      throw new RuntimeInternalError(`generated code defined ${name}.${String(property)}; the context is read-only.`);
    },
    deleteProperty(_target, property) {
      throw new RuntimeInternalError(`generated code deleted ${name}.${String(property)}; the context is read-only.`);
    }
  });
}
var World = class {
  /** The generated-code context. */
  ctx;
  /** Entity records of the named entities by static index (`ctx.e`). Spawned entities: {@link World.dynamic}. */
  entities;
  camera;
  /** The scene state (`ctx.s`). */
  sceneState;
  /** The spawned entities: queues, flush points, records (decision 0064). */
  dynamic;
  /** Phase recorded in diagnostics. `runtime:mount` during initialisation. */
  phase = "runtime:mount";
  /** The physics subsystem, once it is mounted (`ctx.body`); `undefined` for a program without bodies. */
  bodies;
  manifest;
  structure;
  params;
  report;
  /** The slot of every record: the static index, or the slot of a spawned entity. */
  indexByRecord = /* @__PURE__ */ new Map();
  /** The records by slot: the named entities, then the spawned ones that exist. */
  records = [];
  /** What the setters know of each slot (name, symbol, material instance). */
  resolvedBySlot = [];
  worlds;
  transformDirty;
  /** Whether some entity's `transformDirty` flag is set: `propagate` does nothing otherwise (decision 0120). */
  transformsPending = !0;
  /** Slots whose world matrix was recomputed since `takeWorldChanges`; `worldChanged` is the membership flag, `changedList` the slots in order. */
  worldChanged;
  changedList = [];
  takenList = [];
  /** Scratch of `propagate`: the named entities recomputed in this pass. */
  recomputed;
  rotationScratch = new Float32Array(16);
  localScratch = new Float32Array(16);
  frameValues = Object.freeze({ time: 0, delta: 0, index: 0 });
  initialising = !1;
  visibility = 0;
  /** `ctx.budget` (decision 0075): the iterations of CPU loops left in this frame. Only a preview build checks it. */
  loopBudget = { n: 0 };
  /** `manifest.preview.loopBudget`: what {@link resetBudget} refills the counter with; `undefined` outside a preview. */
  loopBudgetLimit;
  materialParamTypes;
  constructor(options) {
    this.manifest = options.manifest, this.structure = options.structure, this.params = options.params, this.report = options.report, this.loopBudgetLimit = options.manifest.preview?.loopBudget;
    let materialParams = new Map(this.structure.materials.map((material) => [material.id, material.params]));
    this.materialParamTypes = materialParams;
    let lightOf = new Map(this.structure.lights.map((light) => [light.entity, light]));
    this.entities = Object.freeze(
      this.structure.entities.map((entity) => {
        let params = entity.instance === null ? void 0 : materialParams.get(entity.instance.material.id), light = lightOf.get(entity.index), record = {
          position: ORIGIN,
          rotation: IDENTITY,
          scale: UNIT_SCALE,
          visible: !0,
          state: stateObject(this.manifest.scene.entities[entity.index]?.state ?? []),
          params: Object.freeze({}),
          mat: params === void 0 ? null : { p: Object.fromEntries(params.map((param) => [param.name, zeroValue(param.type)])) },
          // The registry defaults (`spec/stdlib.md` section 3.6); `init` sets every unbound field.
          light: light === void 0 ? null : { color: WHITE, intensity: 1, range: light.range },
          ref: makeRef(entity.index, 0)
        };
        return this.indexByRecord.set(record, entity.index), this.records[entity.index] = record, this.resolvedBySlot[entity.index] = entity, record;
      })
    );
    let count2 = this.entities.length;
    this.worlds = Array.from({ length: count2 }, () => new Float32Array(16)), this.transformDirty = new Uint8Array(count2).fill(1), this.worldChanged = new Uint8Array(count2), this.recomputed = new Uint8Array(count2);
    let host = {
      get ctx() {
        if (holder.ctx === void 0) throw new RuntimeInternalError("the context was used before the world was built.");
        return holder.ctx;
      },
      get phase() {
        return currentPhase();
      },
      makeRecord: (ref, resolved, prefab, params) => this.makeDynamicRecord(ref, resolved, prefab, params),
      register: (slot, record, resolved) => {
        this.registerDynamic(slot, record, resolved);
      },
      unregister: (slot, record) => {
        this.unregisterDynamic(slot, record);
      },
      source: (spanId) => resolveSpan(this.manifest, spanId),
      report: (diagnostic2) => {
        this.report(diagnostic2);
      }
    }, holder = {}, currentPhase = () => this.phase;
    this.dynamic = new DynamicEntities({
      prefabs: options.prefabs ?? /* @__PURE__ */ new Map(),
      staticCount: count2,
      maxEntities: this.manifest.runtimeConfig.maxEntities,
      firstInstance: this.structure.instances.length,
      host
    });
    let camera = this.structure.camera;
    this.camera = {
      position: CAMERA_POSITION,
      target: null,
      rotation: IDENTITY,
      projection: camera.projection === "perspective" ? { kind: "perspective", fov_y: DEFAULT_FOV_Y, near: DEFAULT_NEAR, far: DEFAULT_FAR } : { kind: "orthographic", height: DEFAULT_HEIGHT, near: DEFAULT_NEAR, far: DEFAULT_FAR }
    }, this.sceneState = stateObject(this.manifest.scene.state);
    let services = options.services ?? INERT_SERVICES, members = {
      s: this.sceneState,
      e: this.entities,
      cam: this.camera,
      setTransform: (entity, field, value) => {
        this.setTransform(entity, field, value);
      },
      setVisible: (entity, value) => {
        this.setVisible(entity, value);
      },
      setParam: (entity, name, value) => {
        this.setParam(entity, name, value);
      },
      setCamera: (field, value) => {
        this.setCamera(field, value);
      },
      setLight: (entity, field, value) => {
        this.setLight(entity, field, value);
      },
      spawn: (prefab, params, spanId) => this.dynamic.spawn(prefab, params, spanId),
      destroy: (ref, spanId) => {
        this.dynamic.destroy(ref, spanId);
      },
      alive: (ref) => this.dynamic.alive(ref),
      body: (target, spanId) => {
        if (this.bodies === void 0)
          throw new RuntimeInternalError("generated code called ctx.body, but the physics subsystem is not mounted (the manifest says subsystems.physics is false, or the scene is still initialising).");
        return this.bodies.handle(target, spanId);
      },
      budget: this.loopBudget,
      warn: (code, spanId) => {
        this.warn(code, spanId);
      },
      random: () => services.random(),
      isKeyDown: (code) => {
        if (typeof code != "string") throw new RuntimeInternalError(`ctx.isKeyDown got ${describeValue(code)}; expected a DOM key code.`);
        return services.isKeyDown(code);
      },
      print: (message, spanId) => {
        services.print(typeof message == "string" ? message : describeValue(message), typeof spanId == "number" ? spanId : -1);
      },
      audio: services.audio ?? SILENT_AUDIO,
      hud: services.hud ?? NO_HUD
    };
    Object.defineProperty(members, "frame", { enumerable: !0, get: () => this.frameValues }), this.ctx = guarded(members, "ctx"), holder.ctx = this.ctx;
  }
  /**
   * Refills `ctx.budget` for a new frame (and for `init`): `manifest.preview.loopBudget` iterations. Without a
   * `preview` object in the manifest the counter stays at 0, so an instrumented `app.js` mounted against a
   * manifest that does not say so fails at its first loop instead of running without a bound (decision 0075).
   */
  resetBudget() {
    this.loopBudgetLimit !== void 0 && (this.loopBudget.n = this.loopBudgetLimit);
  }
  /** `ctx.frame` as generated code sees it. */
  get frame() {
    return this.frameValues;
  }
  /** Incremented by every `setVisible` that changed a value: the draw list depends on it. */
  get visibilityVersion() {
    return this.visibility;
  }
  /**
   * Runs `init(ctx)` (`spec/runtime-abi.md` section 4.3), then checks the camera as a whole (the
   * relations between fields are checked on later writes; during initialisation the compiler has
   * already checked them, `E5010`/`E5011`) and propagates transforms. Errors thrown by `init` propagate.
   */
  initialise(init, afterInit) {
    this.resetBudget(), this.initialising = !0;
    try {
      init(this.ctx), afterInit?.();
    } finally {
      this.initialising = !1;
    }
    let problem = this.cameraProblem(this.camera);
    problem !== void 0 && this.reportCamera(`after initialisation ${problem}.`), this.propagate();
  }
  /**
   * Device recovery (`spec/runtime-abi.md` section 9.4): the records are the retained CPU state, so the world
   * survives a lost device. This points it at the rebuilt parameter store, writes every mirrored param value
   * into it through the generated writers (the bytes the lost device held), and marks every world matrix as
   * changed so the rebuilt object arena is filled by the next frame.
   */
  rebindParams(sink) {
    this.params = sink;
    for (let entity of this.structure.entities) {
      let record = this.entities[entity.index];
      if (entity.instance === null || record?.mat == null) continue;
      let { params, resources } = entity.instance.material;
      for (let param of params)
        resources.some((resource) => resource.name === param.name) || sink.writeParam(entity.instance.index, param.name, record.mat.p[param.name]);
    }
    for (let slot = 0; slot < this.worldChanged.length; slot++) this.markChanged(slot);
  }
  /**
   * Forgets what the change tracking knows: every transform is marked dirty, so the next `propagate` recomputes every
   * world matrix and lists it as changed. For the tests that compare a tracked frame with a full recompute; nothing
   * in the runtime needs it, because every state it holds is rebuilt with the world.
   */
  markAllTransformsDirty() {
    this.transformDirty.fill(1), this.transformsPending = !0;
  }
  /** Records that the world matrix of `slot` was recomputed (once per `takeWorldChanges` period). */
  markChanged(slot) {
    this.worldChanged[slot] !== 1 && (this.worldChanged[slot] = 1, this.changedList.push(slot));
  }
  /** Sets `ctx.frame` for the frame about to run. */
  setFrame(time, delta, index) {
    this.frameValues = Object.freeze({ time: f322(time), delta: f322(delta), index: index >>> 0 });
  }
  /**
   * Propagates local transforms to world matrices, parents before children (`spec/scenes.md` section 12:
   * `L = T * R * S`, `W = W_parent * L`). Only entities whose transform or parent changed are recomputed.
   * The named entities come first; a spawned entity is a root. Returns the number of world matrices recomputed.
   */
  propagate() {
    if (!this.transformsPending) return 0;
    let recomputed = this.recomputed;
    recomputed.fill(0);
    let count2 = 0;
    for (let entity of this.structure.entities) {
      let i = entity.index, parent = entity.parent;
      if (this.transformDirty[i] !== 1 && (parent === null || recomputed[parent] !== 1)) continue;
      let record = this.entities[i];
      if (record === void 0) continue;
      let world = this.worlds[i], parentWorld = parent === null ? void 0 : this.worlds[parent];
      parentWorld === void 0 ? fromRotationTranslationScaleInto(world, this.rotationScratch, record.rotation, record.position, record.scale) : (fromRotationTranslationScaleInto(this.localScratch, this.rotationScratch, record.rotation, record.position, record.scale), multiplyInto(world, parentWorld, this.localScratch)), this.transformDirty[i] = 0, this.markChanged(i), recomputed[i] = 1, count2 += 1;
    }
    for (let entity of this.dynamic.live) {
      let i = entity.ref.slot;
      if (this.transformDirty[i] !== 1) continue;
      let record = entity.record;
      fromRotationTranslationScaleInto(this.worlds[i], this.rotationScratch, record.rotation, record.position, record.scale), this.transformDirty[i] = 0, this.markChanged(i), count2 += 1;
    }
    return this.transformsPending = !1, count2;
  }
  /** The world matrix of the entity in slot `index` as of the last `propagate()`. */
  worldMatrix(index) {
    let matrix = this.worlds[index];
    if (matrix === void 0) throw new RangeError(`no entity ${String(index)}`);
    return matrix;
  }
  /**
   * Returns the slots whose world matrix was recomputed since the last call, in the order `propagate` recomputed them
   * (each once), and forgets them. The array is reused: it is valid until the next call.
   */
  takeWorldChanges() {
    let list = this.changedList, flags = this.worldChanged, kept = 0;
    for (let k = 0; k < list.length; k++) {
      let slot = list[k];
      flags[slot] === 1 && (flags[slot] = 0, list[kept] = slot, kept += 1);
    }
    return list.length = kept, this.changedList = this.takenList, this.changedList.length = 0, this.takenList = list, list;
  }
  /** The record in slot `slot`: a named entity or a spawned one that exists. */
  recordAt(slot) {
    return this.records[slot];
  }
  /** What the world knows of the entity in slot `slot` (name, symbol, mesh, material instance). */
  resolvedAt(slot) {
    return this.resolvedBySlot[slot];
  }
  // ---- the spawned entities' side of the world ----
  /** A new record for a spawned entity at the registry defaults (decision 0064). */
  makeDynamicRecord(ref, resolved, prefab, params) {
    let material = resolved.instance === null ? void 0 : this.materialParamTypes.get(resolved.instance.material.id);
    return {
      position: ORIGIN,
      rotation: IDENTITY,
      scale: UNIT_SCALE,
      visible: !0,
      state: stateObject(prefab.resolved.state),
      params,
      mat: material === void 0 ? null : { p: Object.fromEntries(material.map((param) => [param.name, zeroValue(param.type)])) },
      light: null,
      ref
    };
  }
  /** Grows the per-slot arrays to hold `slots` slots. */
  ensureSlots(slots) {
    if (slots <= this.transformDirty.length) return;
    let capacity = Math.max(slots, this.transformDirty.length * 2), dirty = new Uint8Array(capacity);
    dirty.set(this.transformDirty);
    let changed = new Uint8Array(capacity);
    changed.set(this.worldChanged), this.transformDirty = dirty, this.worldChanged = changed;
  }
  registerDynamic(slot, record, resolved) {
    this.ensureSlots(slot + 1), this.records[slot] = record, this.resolvedBySlot[slot] = resolved, this.indexByRecord.set(record, slot), this.worlds[slot] = new Float32Array(16), this.transformDirty[slot] = 1, this.transformsPending = !0, this.worldChanged[slot] = 0;
  }
  unregisterDynamic(slot, record) {
    this.indexByRecord.delete(record), this.records[slot] = void 0, this.resolvedBySlot[slot] = void 0, this.worlds[slot] = void 0, this.transformDirty[slot] = 0, this.worldChanged[slot] = 0;
  }
  // ---- the setters of the context ----
  indexOf(entity, setter) {
    let index = typeof entity == "object" && entity !== null ? this.indexByRecord.get(entity) : void 0;
    if (index === void 0) throw new RuntimeInternalError(`generated code passed ${describeValue(entity)} to ctx.${setter}, which is not an entity record.`);
    return index;
  }
  entitySource(index) {
    let symbol = this.resolvedBySlot[index]?.symbol, span = symbol === void 0 ? void 0 : spanOfSymbol(this.manifest, symbol);
    return span === void 0 ? null : resolveSpan(this.manifest, span);
  }
  setTransform(entity, field, value) {
    let index = this.indexOf(entity, "setTransform"), record = this.records[index];
    if (record !== void 0) {
      if (!TRANSFORM_FIELDS.includes(field))
        throw new RuntimeInternalError(`ctx.setTransform got the field ${describeValue(field)}; expected position, rotation or scale.`);
      this.applyTransform(index, record, field, value);
    }
  }
  /**
   * A function that does what `ctx.setTransform(entity, field, value)` does for `value`, with the entity and the field
   * resolved once (the bindings call it every frame). An argument `setTransform` would reject gets a function that
   * calls `setTransform`, so the error is the same and happens at the same time.
   */
  transformSetter(entity, field) {
    let index = typeof entity == "object" && entity !== null ? this.indexByRecord.get(entity) : void 0;
    if (index === void 0 || !TRANSFORM_FIELDS.includes(field))
      return (value) => {
        this.setTransform(entity, field, value);
      };
    let name = field;
    return (value) => {
      let record = this.records[index];
      record !== void 0 && this.applyTransform(index, record, name, value);
    };
  }
  applyTransform(index, record, name, value) {
    if (name === "rotation") {
      if (!isQuat(value)) throw new RuntimeInternalError(`ctx.setTransform(\u2026, "rotation", ${describeValue(value)}) expects a quat.`);
      if (sameQuat(record.rotation, value)) return;
      record.rotation = value;
    } else {
      if (!isVec3(value)) throw new RuntimeInternalError(`ctx.setTransform(\u2026, "${name}", ${describeValue(value)}) expects a vec3.`);
      if (name === "scale" && !(isFiniteVec3(value) && value.x > 0 && value.y > 0 && value.z > 0)) {
        this.report(
          makeRuntimeDiagnostic("E8090", {
            phase: this.phase,
            message: `The scale ${describeValue(value)} written to entity '${this.resolvedBySlot[index]?.name ?? String(index)}' is invalid: every component must be finite and greater than 0. The write is ignored.`,
            source: this.entitySource(index)
          })
        );
        return;
      }
      if (sameVec3(name === "position" ? record.position : record.scale, value)) return;
      name === "position" ? record.position = value : record.scale = value;
    }
    this.transformDirty[index] = 1, this.transformsPending = !0;
  }
  setVisible(entity, value) {
    let index = this.indexOf(entity, "setVisible"), record = this.records[index];
    if (record !== void 0) {
      if (typeof value != "boolean") throw new RuntimeInternalError(`ctx.setVisible got ${describeValue(value)}; expected a bool.`);
      record.visible !== value && (record.visible = value, this.visibility += 1);
    }
  }
  /**
   * `app.debug.setParam` (`spec/runtime-abi.md` section 10.2): writes a material param of the entity called
   * `entityName` (its name, or its qualified symbol when several entities share the name) through the same
   * path as `ctx.setParam`, so the generated field writer, the mirror and the opaque-colour rule
   * (`E8100`) apply. Mistakes of the caller throw plain errors naming what exists; they are not diagnostics.
   */
  setParamByName(entityName, param, value) {
    let matches = this.structure.entities.filter((entity2) => entity2.name === entityName || entity2.symbol === entityName);
    if (matches.length === 0)
      throw new RangeError(`debug.setParam: no entity named '${entityName}' (entities: ${this.structure.entities.map((entity2) => entity2.name).join(", ")}).`);
    if (matches.length > 1)
      throw new RangeError(`debug.setParam: '${entityName}' names ${String(matches.length)} entities; use one of ${matches.map((entity2) => `'${entity2.symbol}'`).join(", ")}.`);
    let entity = matches[0], record = entity === void 0 ? void 0 : this.entities[entity.index];
    if (entity === void 0 || record === void 0) return;
    if (entity.instance === null) throw new RangeError(`debug.setParam: entity '${entityName}' has no material.`);
    let declared = entity.instance.material.params.find((candidate) => candidate.name === param);
    if (declared === void 0) {
      let names = entity.instance.material.params.map((candidate) => candidate.name).join(", ");
      throw new RangeError(`debug.setParam: material '${entity.instance.material.id}' declares no param '${param}' (params: ${names === "" ? "none" : names}).`);
    }
    let problem = paramValueProblem(declared.type, value);
    if (problem !== void 0)
      throw new TypeError(`debug.setParam: param '${param}' of '${entityName}' is a ${declared.type}; got ${describeValue(value)}: ${problem}.`);
    this.setParam(record, param, value);
  }
  setParam(entity, name, value) {
    let index = this.indexOf(entity, "setParam"), record = this.records[index], instance = this.resolvedBySlot[index]?.instance;
    if (record === void 0 || record.mat === null || instance === null || instance === void 0)
      throw new RuntimeInternalError(`ctx.setParam was called for entity ${String(index)}, which has no material.`);
    let param = typeof name == "string" ? instance.material.params.find((candidate) => candidate.name === name) : void 0;
    if (param === void 0)
      throw new RuntimeInternalError(`ctx.setParam got the param ${describeValue(name)}, which material '${instance.material.id}' does not declare.`);
    this.applyParam(index, record.mat, instance, param, value);
  }
  /**
   * A function that does what `ctx.setParam(entity, name, value)` does for `value`, with the entity, its material
   * instance and the param resolved once (the bindings call it every frame). An argument `setParam` would reject gets
   * a function that calls `setParam`, so the error is the same and happens at the same time.
   */
  paramSetter(entity, name) {
    let index = typeof entity == "object" && entity !== null ? this.indexByRecord.get(entity) : void 0, instance = index === void 0 ? void 0 : this.resolvedBySlot[index]?.instance, param = instance?.material.params.find((candidate) => candidate.name === name);
    return index === void 0 || instance === null || instance === void 0 || param === void 0 ? (value) => {
      this.setParam(entity, name, value);
    } : (value) => {
      let record = this.records[index];
      if (record === void 0 || record.mat === null) {
        this.setParam(entity, name, value);
        return;
      }
      this.applyParam(index, record.mat, instance, param, value);
    };
  }
  applyParam(index, mat, instance, param, value) {
    if (param.type === "color") {
      if (!isColor(value)) throw new RuntimeInternalError(`ctx.setParam(\u2026, "${param.name}", ${describeValue(value)}) expects a color.`);
      if (value.a !== 1) {
        this.report(
          makeRuntimeDiagnostic("E8100", {
            phase: this.phase,
            message: `The colour ${describeValue(value)} for param '${param.name}' of entity '${this.resolvedBySlot[index]?.name ?? String(index)}' is not opaque: material colours must have alpha 1.0 in v0.1. The previous value stays.`,
            source: this.entitySource(index)
          })
        );
        return;
      }
    }
    this.params.writeParam(instance.index, param.name, value), mat.p[param.name] = value;
  }
  /** `ctx.setLight(e, "color" | "intensity", value)`; `range` is construction-only and never written. */
  setLight(entity, field, value) {
    let index = this.indexOf(entity, "setLight"), light = this.records[index]?.light;
    if (light == null)
      throw new RuntimeInternalError(`ctx.setLight was called for entity ${String(index)}, which has no light.`);
    if (!LIGHT_FIELDS.includes(field))
      throw new RuntimeInternalError(`ctx.setLight got the field ${describeValue(field)}; expected color or intensity.`);
    if (field === "color") {
      if (!isColor(value)) throw new RuntimeInternalError(`ctx.setLight(\u2026, "color", ${describeValue(value)}) expects a color.`);
      light.color = value;
    } else {
      if (typeof value != "number") throw new RuntimeInternalError(`ctx.setLight(\u2026, "intensity", ${describeValue(value)}) expects an f32.`);
      light.intensity = value;
    }
  }
  setCamera(field, value) {
    if (!CAMERA_FIELDS.includes(field))
      throw new RuntimeInternalError(`ctx.setCamera got the field ${describeValue(field)}; expected one of ${CAMERA_FIELDS.join(", ")}.`);
    let name = field, camera = this.camera, projection = camera.projection;
    switch (name) {
      case "position":
      case "target": {
        if (!isVec3(value)) throw new RuntimeInternalError(`ctx.setCamera("${name}", ${describeValue(value)}) expects a vec3.`);
        if (name === "target" && !this.structure.camera.hasTarget)
          throw new RuntimeInternalError(`ctx.setCamera("target", \u2026) was called for camera '${this.structure.camera.name}', which declares no target.`);
        let next = { ...camera, [name]: value };
        if (!this.acceptCamera(next, name, value)) return;
        name === "position" ? camera.position = value : camera.target = value;
        return;
      }
      case "rotation":
        if (!isQuat(value)) throw new RuntimeInternalError(`ctx.setCamera("rotation", ${describeValue(value)}) expects a quat.`);
        if (!isFiniteQuat(value)) {
          this.reportCamera(`writing ${describeValue(value)} to rotation is invalid: the rotation is not finite. The write is ignored.`);
          return;
        }
        camera.rotation = value;
        return;
      default: {
        if (typeof value != "number") throw new RuntimeInternalError(`ctx.setCamera("${name}", ${describeValue(value)}) expects an f32.`);
        let key = name.slice(11);
        if (!(key in projection))
          throw new RuntimeInternalError(`ctx.setCamera("${name}", \u2026) does not apply to a ${projection.kind} camera.`);
        let nextProjection = { ...projection, [key]: value };
        if (!this.acceptCamera({ ...camera, projection: nextProjection }, name, value)) return;
        projection[key] = value;
        return;
      }
    }
  }
  /** Checks a candidate camera; reports `E8011` and returns false when the write must be ignored. */
  acceptCamera(candidate, field, value) {
    let problem = this.cameraProblem(candidate, field);
    return problem === void 0 ? !0 : (this.reportCamera(`writing ${describeValue(value)} to ${field} is invalid: ${problem}. The write is ignored.`), !1);
  }
  /**
   * Why a camera is invalid (`spec/scenes.md` section 3), or undefined. Each field's own range is always
   * checked; relations between fields (position versus target, near versus far) only outside
   * initialisation or when `only` is undefined (the check after `init`).
   */
  cameraProblem(camera, only) {
    let relations = only === void 0 || !this.initialising, projection = camera.projection, check = (field) => only === void 0 || only === field;
    if (check("position") && !isFiniteVec3(camera.position)) return "the position is not finite";
    if (check("target") && camera.target !== null && !isFiniteVec3(camera.target)) return "the target is not finite";
    if (relations && (check("position") || check("target")) && camera.target !== null && sameVec3(camera.position, camera.target))
      return "the position equals the target, so the view direction is undefined";
    if (projection.kind === "perspective" && check("projection.fov_y") && !(projection.fov_y > 0 && projection.fov_y < Math.PI))
      return "fov_y is outside the open range (0, \u03C0)";
    if (projection.kind === "orthographic" && check("projection.height") && !(projection.height > 0 && Number.isFinite(projection.height)))
      return "the orthographic height is not greater than 0";
    if (check("projection.near") && !(projection.near > 0 && Number.isFinite(projection.near))) return "near is not greater than 0";
    if (check("projection.far") && !Number.isFinite(projection.far)) return "far is not finite";
    if (relations && (check("projection.near") || check("projection.far")) && !(projection.far > projection.near))
      return "far is not greater than near";
  }
  reportCamera(message) {
    let symbol = this.structure.camera.symbol, span = spanOfSymbol(this.manifest, symbol);
    this.report(
      makeRuntimeDiagnostic("E8011", {
        phase: this.phase,
        message: `Invalid value for camera '${this.structure.camera.name}': ${message}`,
        source: span === void 0 ? null : resolveSpan(this.manifest, span)
      })
    );
  }
  warn(code, spanId) {
    if (typeof code != "string" || !isWarningCode(code))
      throw new RuntimeInternalError(`ctx.warn got the code ${describeValue(code)}, which is not a runtime warning code.`);
    if (typeof spanId != "number" || !Number.isInteger(spanId))
      throw new RuntimeInternalError(`ctx.warn got the span id ${describeValue(spanId)}; expected an index into the manifest spans table.`);
    let title = RUNTIME_DIAGNOSTIC_CATALOGUE[code];
    this.report(
      makeRuntimeDiagnostic(code, {
        phase: this.phase,
        message: `${title.charAt(0).toUpperCase()}${title.slice(1)}.`,
        source: resolveSpan(this.manifest, spanId)
      })
    );
  }
};

// src/scene/bindings.ts
var Bindings = class {
  constructor(manifest, functions, world) {
    this.world = world;
    let ctx = world.ctx, byOrder = [...manifest.scene.bindings].sort((a, b) => a.order - b.order || a.id - b.id);
    this.steps = byOrder.map((binding) => {
      let compute = functions[binding.id];
      if (compute === void 0) throw new RuntimeInternalError(`binding ${String(binding.id)} has no function in the program module.`);
      return { id: binding.id, compute, apply: this.applier(binding, manifest, ctx) };
    });
  }
  world;
  /** In evaluation order: the function that computes the value and the one that applies it. */
  steps;
  /** The number of bindings. */
  get count() {
    return this.steps.length;
  }
  /** Evaluates every binding in order and applies its value. */
  evaluate() {
    for (let step2 of this.steps) step2.apply(step2.compute(this.world.ctx));
  }
  applier(binding, manifest, ctx) {
    let target = binding.target, entity = (index) => {
      let record = this.world.entities[index];
      if (record === void 0) throw new RuntimeInternalError(`binding ${String(binding.id)} targets entity ${String(index)}, which the scene does not have.`);
      return record;
    };
    switch (target.kind) {
      case "transform":
        return this.world.transformSetter(entity(target.entity), target.field);
      case "visible": {
        let record = entity(target.entity);
        return (value) => {
          ctx.setVisible(record, value);
        };
      }
      case "param": {
        let instance = manifest.scene.materialInstances[target.instance];
        if (instance === void 0) throw new RuntimeInternalError(`binding ${String(binding.id)} targets material instance ${String(target.instance)}, which the scene does not have.`);
        return this.world.paramSetter(entity(instance.entity), target.name);
      }
      case "camera":
        return (value) => {
          ctx.setCamera(target.field, value);
        };
      case "light": {
        let record = entity(target.entity);
        return (value) => {
          ctx.setLight(record, target.field, value);
        };
      }
    }
  }
};

// src/gpu/uniform-arena.ts
function roundUp(alignment, value) {
  if (!Number.isInteger(alignment) || alignment <= 0)
    throw new RangeError(`roundUp: alignment must be a positive integer, got ${String(alignment)}`);
  return Math.ceil(value / alignment) * alignment;
}
var USAGE_COPY_DST = 8, USAGE_UNIFORM = 64, DEFAULT_INITIAL_CAPACITY = 16, COALESCE_MIN_GAP_BYTES = 128;
function ascending(a, b) {
  return a - b;
}
function makeViews(buffer) {
  return { f32: new Float32Array(buffer), u32: new Uint32Array(buffer), i32: new Int32Array(buffer) };
}
var UniformArena = class {
  id;
  /** Block size in bytes. */
  size;
  /** Distance between slots: block size rounded up to 16 and to the device's `minUniformBufferOffsetAlignment`. */
  slotStride;
  dynamicOffset;
  device;
  registry;
  binding;
  maxBufferSize;
  gpuBuffer;
  mirror;
  mirrorViews;
  slotCapacity;
  used;
  dirty;
  dirtySlots = [];
  nextFree = 0;
  liveSlotCount = 0;
  disposed = !1;
  scratch;
  /** Whether the last `stage` found the scratch block different from the mirror. */
  stagedChanged = !1;
  staticGroups = /* @__PURE__ */ new Map();
  dynamicGroups = /* @__PURE__ */ new Map();
  replacedListeners = /* @__PURE__ */ new Set();
  constructor(device, registry, layout, options = {}) {
    let { size } = layout;
    if (!Number.isInteger(size) || size <= 0 || size % 4 !== 0)
      throw new RangeError(`UniformArena '${layout.id}': block size must be a positive multiple of 4, got ${String(size)}`);
    let maxBinding = device.limits.maxUniformBufferBindingSize;
    if (size > maxBinding)
      throw new RangeError(
        `UniformArena '${layout.id}': block size ${String(size)} exceeds the device limit maxUniformBufferBindingSize (${String(maxBinding)})`
      );
    let capacity = options.initialCapacity ?? DEFAULT_INITIAL_CAPACITY;
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new RangeError(`UniformArena '${layout.id}': initialCapacity must be a positive integer, got ${String(capacity)}`);
    this.id = layout.id, this.size = size, this.device = device, this.registry = registry, this.dynamicOffset = options.dynamicOffset ?? !1, this.binding = options.binding ?? 0, this.maxBufferSize = device.limits.maxBufferSize, this.slotStride = roundUp(device.limits.minUniformBufferOffsetAlignment, roundUp(16, size)), this.slotCapacity = capacity, this.checkBufferSize(capacity), this.gpuBuffer = this.createGpuBuffer(capacity), this.mirror = new ArrayBuffer(capacity * this.slotStride), this.mirrorViews = makeViews(this.mirror), this.used = new Uint8Array(capacity), this.dirty = new Uint8Array(capacity);
    let scratchBuffer = new ArrayBuffer(size);
    this.scratch = makeViews(scratchBuffer);
  }
  /** Current capacity in slots. */
  get capacity() {
    return this.slotCapacity;
  }
  /** The current GPU buffer. Changes on growth: do not cache it across `onBufferReplaced`. */
  get buffer() {
    return this.gpuBuffer;
  }
  /**
   * Typed views over the CPU mirror. The object (and its `ArrayBuffer`) is replaced on growth, so read
   * `views` again after every `allocate()` instead of caching it.
   */
  get views() {
    return this.mirrorViews;
  }
  /** Number of allocated slots. */
  get liveSlots() {
    return this.liveSlotCount;
  }
  get dirtySlotCount() {
    return this.dirtySlots.length;
  }
  isDirty(slot) {
    return this.checkRange(slot), this.dirty[slot] === 1;
  }
  /** Byte offset of a slot in the buffer and in the mirror; also the dynamic offset in dynamic-offset mode. */
  slotOffset(slot) {
    return this.checkRange(slot), slot * this.slotStride;
  }
  /**
   * Returns the lowest free slot index, growing the arena first if every slot is taken. The slot's
   * mirror bytes are zero; it is marked dirty so the GPU copy of a recycled slot is overwritten too.
   */
  allocate() {
    this.checkLive();
    let slot = this.nextFree;
    for (; slot < this.slotCapacity && this.used[slot] === 1; ) slot += 1;
    return slot >= this.slotCapacity && (this.grow(), slot = this.slotCapacity / 2), this.used[slot] = 1, this.liveSlotCount += 1, this.nextFree = slot + 1, this.markDirty(slot), slot;
  }
  /** Frees a slot: zero-fills its mirror bytes (padding stays zero for deterministic comparison) and drops its cached bind groups. */
  release(slot) {
    if (this.checkLive(), this.checkRange(slot), this.used[slot] !== 1) throw new Error(`UniformArena '${this.id}': slot ${String(slot)} is not allocated`);
    if (new Uint8Array(this.mirror, slot * this.slotStride, this.slotStride).fill(0), this.used[slot] = 0, this.liveSlotCount -= 1, slot < this.nextFree && (this.nextFree = slot), this.dirty[slot] === 1) {
      this.dirty[slot] = 0;
      let index = this.dirtySlots.indexOf(slot);
      index >= 0 && this.dirtySlots.splice(index, 1);
    }
    for (let bySlot of this.staticGroups.values()) {
      let group = bySlot.get(slot);
      group !== void 0 && (bySlot.delete(slot), this.registry.release(group));
    }
  }
  /** Marks an allocated slot for upload at the next `flush`. */
  markDirty(slot) {
    this.checkLive(), this.checkAllocated(slot), this.dirty[slot] === 0 && (this.dirty[slot] = 1, this.dirtySlots.push(slot));
  }
  /**
   * Runs `write` against a scratch block holding a copy of the slot's current bytes (`views` over the
   * scratch, `base` 0), compares the result bit for bit and only if it differs copies it into the mirror
   * and marks the slot dirty (`spec/gpu-layout.md` section 8.2). Returns whether the slot changed. If
   * `write` throws, the mirror is untouched.
   */
  writeIfChanged(slot, write) {
    return this.stage(slot, write, void 0, void 0), this.commitStaged(slot);
  }
  /**
   * {@link UniformArena.writeIfChanged} for a generated field writer and its value: `writer(views, base, value)`
   * without a closure per call (the per-frame path of material params).
   */
  writeFieldIfChanged(slot, writer, value) {
    return this.stage(slot, void 0, writer, value), this.commitStaged(slot);
  }
  /** Copies the staged scratch block into the mirror and marks the slot dirty when `stage` found a difference. */
  commitStaged(slot) {
    if (!this.stagedChanged) return !1;
    let mirror = this.mirrorViews.u32, scratch = this.scratch.u32, base = slot * this.slotStride / 4;
    for (let i = 0; i < scratch.length; i++) mirror[base + i] = scratch[i];
    return this.markDirty(slot), !0;
  }
  /** Whether `write` would change the slot's bytes: `writeIfChanged` without the write. */
  wouldChange(slot, write) {
    return this.stage(slot, write, void 0, void 0), this.stagedChanged;
  }
  /**
   * The block's bytes as `size / 4` words, a view into the CPU mirror: for hashing and comparing blocks
   * (`spec/gpu-layout.md` section 8.2). Replaced on growth (read it again after `allocate()`), never written through.
   */
  slotWords(slot) {
    return this.checkAllocated(slot), new Uint32Array(this.mirror, slot * this.slotStride, this.size >>> 2);
  }
  /**
   * Runs the writer (`write`, or `writer` with `value`) on the scratch block holding the slot's bytes and sets
   * `stagedChanged` to whether the result differs from the mirror. Allocates nothing.
   */
  stage(slot, write, writer, value) {
    this.checkLive(), this.checkAllocated(slot);
    let mirror = this.mirrorViews.u32, scratch = this.scratch.u32, base = slot * this.slotStride / 4, words = scratch.length;
    this.stagedChanged = !1;
    for (let i = 0; i < words; i++) scratch[i] = mirror[base + i];
    write !== void 0 ? write(this.scratch, 0) : writer !== void 0 && writer(this.scratch, 0, value);
    for (let i = 0; i < words; i++)
      if (scratch[i] !== mirror[base + i]) {
        this.stagedChanged = !0;
        return;
      }
  }
  /**
   * Uploads the dirty slots and clears the dirty flags (decision 0119). Dirty slots are visited in ascending
   * order; a slot whose `[slot x stride, + size)` range starts at most `max(COALESCE_MIN_GAP_BYTES, size)` bytes
   * after the end of the previous dirty slot's range joins the previous `writeBuffer`, so a run of nearby dirty
   * slots is one upload that also carries the padding between them. Those bytes come from the CPU mirror, which
   * equals the GPU copy for every slot that is not dirty (a released slot's mirror is zero while its GPU copy
   * is stale; nothing reads a free slot), so the GPU buffer holds what the mirror holds, as after uploading
   * the slots one by one. Returns the number of dirty slots uploaded (not the number of `writeBuffer` calls: the
   * registry's `uploads` counts those).
   */
  flush(queue) {
    this.checkLive();
    let slots = this.dirtySlots, count2 = slots.length;
    if (count2 === 0) return 0;
    count2 > 1 && slots.sort(ascending);
    let { slotStride, size, mirror, gpuBuffer, dirty } = this, start = slots[0] * slotStride, end = start + size, maxGap = size > COALESCE_MIN_GAP_BYTES ? size : COALESCE_MIN_GAP_BYTES;
    dirty[slots[0]] = 0;
    for (let i = 1; i < count2; i++) {
      let slot = slots[i], offset = slot * slotStride;
      dirty[slot] = 0, offset - end > maxGap && (this.registry.writeBuffer(queue, gpuBuffer, start, mirror, start, end - start), start = offset), end = offset + size;
    }
    return this.registry.writeBuffer(queue, gpuBuffer, start, mirror, start, end - start), slots.length = 0, count2;
  }
  /**
   * Registers a listener called after growth replaced the buffer and before the old buffer is destroyed,
   * so bind groups can be rebuilt. Returns a function that unsubscribes it.
   */
  onBufferReplaced(listener) {
    return this.replacedListeners.add(listener), () => {
      this.replacedListeners.delete(listener);
    };
  }
  /**
   * Static-offset bind group of one slot: `{ buffer, offset: slot x stride, size }` at this arena's binding
   * (`spec/gpu-layout.md` section 8.1). Cached per (layout, slot) until the slot is released or the arena grows.
   * `layout` must declare the binding without `hasDynamicOffset`. `extra` are further entries of the same
   * bind group (the textures and samplers of a material instance); they belong to the slot, so the group
   * cached for (layout, slot) keeps the entries it was created with.
   */
  bindGroupForSlot(slot, layout, extra = []) {
    if (this.checkLive(), this.dynamicOffset)
      throw new Error(`UniformArena '${this.id}' is in dynamic-offset mode; use bindGroupDynamic()`);
    this.checkAllocated(slot);
    let bySlot = this.staticGroups.get(layout);
    bySlot === void 0 && (bySlot = /* @__PURE__ */ new Map(), this.staticGroups.set(layout, bySlot));
    let group = bySlot.get(slot);
    return group === void 0 && (group = this.registry.createBindGroup({
      label: `${this.id}#${String(slot)}`,
      layout,
      entries: [{ binding: this.binding, resource: { buffer: this.gpuBuffer, offset: slot * this.slotStride, size: this.size } }, ...extra]
    }), bySlot.set(slot, group)), group;
  }
  /**
   * Dynamic-offset bind group: the whole arena at offset 0 with `size` = block size; the caller passes
   * `slotOffset(slot)` as the dynamic offset in `setBindGroup`. Cached per layout until the arena grows.
   * `layout` must declare the binding with `hasDynamicOffset: true`.
   */
  bindGroupDynamic(layout) {
    if (this.checkLive(), !this.dynamicOffset)
      throw new Error(`UniformArena '${this.id}' is in static-offset mode; use bindGroupForSlot()`);
    let group = this.dynamicGroups.get(layout);
    return group === void 0 && (group = this.registry.createBindGroup({
      label: `${this.id}:dynamic`,
      layout,
      entries: [{ binding: this.binding, resource: { buffer: this.gpuBuffer, offset: 0, size: this.size } }]
    }), this.dynamicGroups.set(layout, group)), group;
  }
  /** Releases the buffer and every cached bind group. The arena cannot be used afterwards. */
  dispose() {
    this.disposed || (this.disposed = !0, this.dropBindGroups(), this.replacedListeners.clear(), this.registry.release(this.gpuBuffer));
  }
  checkLive() {
    if (this.disposed) throw new Error(`UniformArena '${this.id}' is disposed`);
  }
  checkRange(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCapacity)
      throw new RangeError(`UniformArena '${this.id}': slot ${String(slot)} is outside 0..${String(this.slotCapacity - 1)}`);
  }
  checkAllocated(slot) {
    if (this.checkRange(slot), this.used[slot] !== 1) throw new Error(`UniformArena '${this.id}': slot ${String(slot)} is not allocated`);
  }
  checkBufferSize(capacity) {
    let bytes = capacity * this.slotStride;
    if (bytes > this.maxBufferSize) {
      let message = `The uniform arena '${this.id}' needs a ${String(bytes)}-byte buffer for ${String(capacity)} slots, above the device limit maxBufferSize (${String(this.maxBufferSize)}).`;
      throw this.registry.reportAllocationFailure(message), new RangeError(message);
    }
  }
  createGpuBuffer(capacity) {
    return this.registry.createBuffer({
      label: `mtek:uniform-arena:${this.id}`,
      size: capacity * this.slotStride,
      usage: USAGE_UNIFORM | USAGE_COPY_DST
    });
  }
  dropBindGroups() {
    for (let bySlot of this.staticGroups.values())
      for (let group of bySlot.values()) this.registry.release(group);
    this.staticGroups.clear();
    for (let group of this.dynamicGroups.values()) this.registry.release(group);
    this.dynamicGroups.clear();
  }
  /**
   * Doubles the capacity: new buffer, whole-mirror upload (so nothing is dirty afterwards), cached bind
   * groups invalidated, `onBufferReplaced` listeners notified, and only then the old buffer destroyed
   * (`spec/gpu-layout.md` section 8.1). Growth happens before the frame's encoding begins, so no
   * command references the old buffer.
   */
  grow() {
    let newCapacity = this.slotCapacity * 2;
    this.checkBufferSize(newCapacity);
    let newMirror = new ArrayBuffer(newCapacity * this.slotStride);
    new Uint8Array(newMirror).set(new Uint8Array(this.mirror));
    let newBuffer = this.createGpuBuffer(newCapacity);
    this.registry.writeBuffer(this.device.queue, newBuffer, 0, newMirror, 0, newMirror.byteLength);
    let oldBuffer = this.gpuBuffer;
    this.gpuBuffer = newBuffer, this.mirror = newMirror, this.mirrorViews = makeViews(newMirror);
    let used = new Uint8Array(newCapacity);
    used.set(this.used), this.used = used, this.dirty = new Uint8Array(newCapacity), this.dirtySlots = [], this.slotCapacity = newCapacity, this.dropBindGroups();
    try {
      let event = { oldBuffer, newBuffer, capacity: newCapacity };
      for (let listener of [...this.replacedListeners]) listener(event);
    } finally {
      this.registry.release(oldBuffer);
    }
  }
};

// src/render/resources.ts
var TEXTURE_FORMATS = { srgb: "rgba8unorm-srgb", linear: "rgba8unorm" }, SAMPLER_PRESETS = {
  "sampler.linear_repeat": { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" },
  "sampler.linear_clamp": { magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
  "sampler.nearest_repeat": { magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", addressModeU: "repeat", addressModeV: "repeat" },
  "sampler.nearest_clamp": { magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }
}, BUILTIN_TEXELS = {
  "texture.white": [255, 255, 255, 255],
  "texture.black": [0, 0, 0, 255]
};
function checkedPixels(name, texture) {
  let { width, height, data, colorSpace = "srgb" } = texture;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new RangeError(`test.textures['${name}']: width and height must be positive integers, got ${String(width)} x ${String(height)}`);
  if (colorSpace !== "srgb" && colorSpace !== "linear")
    throw new TypeError(`test.textures['${name}']: colorSpace must be "srgb" or "linear", got ${String(colorSpace)}`);
  if (!(data instanceof Uint8Array) || data.byteLength !== width * height * 4)
    throw new RangeError(`test.textures['${name}']: data must be a Uint8Array of width x height x 4 = ${String(width * height * 4)} bytes`);
  return { width, height, data, colorSpace };
}
function checkTestTextures(overrides) {
  let checked = /* @__PURE__ */ new Map();
  for (let [name, texture] of Object.entries(overrides)) {
    if (!(name in BUILTIN_TEXELS)) throw new RangeError(`test.textures: '${name}' is not a built-in texture`);
    checked.set(name, checkedPixels(name, texture));
  }
  return checked;
}
var AssetTextures = class {
  constructor(registry, queue, images) {
    this.registry = registry;
    this.queue = queue;
    this.images = images;
  }
  registry;
  queue;
  images;
  textures = /* @__PURE__ */ new Map();
  /** The view of the texture of image file `asset`, created and filled on first use. */
  textureView(asset) {
    let found = this.textures.get(asset.url);
    if (found === void 0) {
      let bitmap = this.images.get(asset.url);
      if (bitmap === void 0) throw new Error(`internal error: the image '${asset.url}' was not decoded`);
      let texture = this.registry.createTexture({
        label: `mtek asset ${asset.url}`,
        size: [bitmap.width, bitmap.height],
        format: TEXTURE_FORMATS[asset.colorSpace],
        usage: 22
      });
      this.registry.copyExternalImage(this.queue, bitmap, texture), found = { texture, view: texture.createView() }, this.textures.set(asset.url, found);
    }
    return found.view;
  }
  /** Releases every texture this scene created. */
  dispose() {
    for (let { texture } of this.textures.values()) this.registry.release(texture);
    this.textures.clear();
  }
}, BuiltinResources = class {
  constructor(registry, queue, overrides = {}) {
    this.registry = registry;
    this.queue = queue;
    this.overrides = checkTestTextures(overrides);
  }
  registry;
  queue;
  textures = /* @__PURE__ */ new Map();
  samplers = /* @__PURE__ */ new Map();
  overrides;
  /** The view of the built-in texture `name` (`texture.white`, `texture.black`), created on first use. */
  textureView(name) {
    let found = this.textures.get(name);
    if (found === void 0) {
      let texel = BUILTIN_TEXELS[name];
      if (texel === void 0) throw new RangeError(`'${name}' is not a built-in texture`);
      let pixels = this.overrides.get(name) ?? { width: 1, height: 1, data: Uint8Array.from(texel), colorSpace: "srgb" }, texture = this.registry.createTexture({
        label: `mtek ${name}`,
        size: [pixels.width, pixels.height],
        format: TEXTURE_FORMATS[pixels.colorSpace],
        usage: 6
      });
      this.registry.writeTexture(this.queue, texture, pixels.data, pixels.width * 4, pixels.width, pixels.height), found = { texture, view: texture.createView() }, this.textures.set(name, found);
    }
    return found.view;
  }
  /** The built-in sampler `name` (`sampler.linear_repeat`, ...), created on first use. */
  sampler(name) {
    let found = this.samplers.get(name);
    if (found === void 0) {
      let preset = SAMPLER_PRESETS[name];
      if (preset === void 0) throw new RangeError(`'${name}' is not a built-in sampler`);
      found = this.registry.createSampler({ label: `mtek ${name}`, ...preset }), this.samplers.set(name, found);
    }
    return found;
  }
  /** Releases every texture and sampler this scene created. */
  dispose() {
    for (let { texture } of this.textures.values()) this.registry.release(texture);
    for (let sampler of this.samplers.values()) this.registry.release(sampler);
    this.textures.clear(), this.samplers.clear();
  }
};

// src/render/materials.ts
var SPAWNED_ARENA_CAPACITY = 16;
function hashWords(words) {
  let hash = 2166136261;
  for (let word of words) hash = Math.imul(hash ^ word, 16777619) >>> 0;
  return hash;
}
function sameWords(a, b) {
  if (a.length !== b.length) return !1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return !1;
  return !0;
}
function resourceSignature(instance) {
  return instance.resources.map((resource) => `${String(resource.binding)}=${resource.value}`).join(",");
}
var MaterialStore = class {
  /** `images`: the decoded image files that instances' texture params may name (`spec/assets.md` section 5). */
  constructor(device, registry, plan, structure, writers, textures, images = /* @__PURE__ */ new Map()) {
    this.device = device;
    this.registry = registry;
    this.plan = plan;
    this.writers = writers;
    this.builtins = new BuiltinResources(registry, device.queue, textures), this.assetTextures = new AssetTextures(registry, device.queue, images);
    let counts = /* @__PURE__ */ new Map();
    for (let instance of structure.instances) {
      let layout = instance.material.layout;
      layout !== null && counts.set(layout.id, (counts.get(layout.id) ?? 0) + 1);
    }
    for (let instance of structure.instances)
      this.add(instance, counts.get(instance.material.layout?.id ?? "") ?? 1);
  }
  device;
  registry;
  plan;
  writers;
  arenas = /* @__PURE__ */ new Map();
  /** The live instances by index (the scene's, then the spawned ones). */
  instances = /* @__PURE__ */ new Map();
  /** By material instance index: the block it uses. Instances that share a block hold the same object. */
  blocks = [];
  /** Blocks that were offered for sharing, by `(material, hash of the bytes, resources)`. */
  buckets = /* @__PURE__ */ new Map();
  blockChanges = 0;
  /** Textures and samplers by instance index; absent for instances without resources. */
  resources = /* @__PURE__ */ new Map();
  builtins;
  assetTextures;
  /** Parameter blocks used by exactly one instance. */
  get ownedParamBlocks() {
    return this.countBlocks(1, 1);
  }
  /** Parameter blocks shared by several identical immutable instances (`spec/gpu-layout.md` section 8.2). */
  get sharedParamBlocks() {
    return this.countBlocks(2, 1 / 0);
  }
  /** Counts the distinct blocks with a slot that are used by `min` to `max` instances. */
  countBlocks(min2, max2) {
    let count2 = 0;
    for (let block of new Set(this.blocks))
      block !== void 0 && block.storage !== null && block.members.size >= min2 && block.members.size <= max2 && (count2 += 1);
    return count2;
  }
  /**
   * The parameter block of an instance, named by the lowest instance index that uses it: two instances have
   * "the same parameter block" (`spec/runtime-abi.md` section 8.4) exactly when this is equal.
   */
  blockOf(instance) {
    let block = this.blocks[instance];
    if (block === void 0) throw new Error(`internal error: no material instance ${String(instance)}`);
    return block.name;
  }
  /** Increases whenever `blockOf` changes for some instance (`shareIdentical`, copy on write, an instance added or removed). */
  get blockVersion() {
    return this.blockChanges;
  }
  /** The number of live material instances. */
  get instanceCount() {
    return this.instances.size;
  }
  /** Gives `instance` a block of its own, and its texture and sampler bindings. `capacity`: arena slots to start with. */
  add(instance, capacity) {
    if (this.instances.has(instance.index)) throw new Error(`internal error: material instance ${String(instance.index)} exists already`);
    let layout = instance.material.layout, kinds = instance.material.resources;
    instance.resources.length > 0 && this.resources.set(instance.index, {
      layout: this.plan.material(layout, kinds),
      entries: instance.resources.map((resource) => ({
        binding: resource.binding,
        resource: "asset" in resource ? this.assetTextures.textureView(resource.asset) : resource.kind === "texture" ? this.builtins.textureView(resource.value) : this.builtins.sampler(resource.value)
      }))
    });
    let storage = null;
    if (layout !== null) {
      let arena = this.arenas.get(layout.id);
      arena === void 0 && (arena = new UniformArena(this.device, this.registry, layout, { initialCapacity: capacity }), this.arenas.set(layout.id, arena));
      let layoutWriters = this.writers.get(layout.id);
      if (layoutWriters === void 0) throw new Error(`internal error: no writers for the layout '${layout.id}'`);
      storage = { arena, slot: arena.allocate(), writers: layoutWriters, layout: this.plan.material(layout, kinds) };
    }
    this.instances.set(instance.index, instance), this.blocks[instance.index] = { storage, members: /* @__PURE__ */ new Set([instance.index]), name: instance.index, resourceGroup: void 0, key: void 0 };
  }
  /**
   * A spawned entity's material instance (decision 0064): `instance.index` is chosen by the caller, above the
   * scene's, and free. The instance starts with a block of its own at zero bytes; the entity's `init` writes the
   * values, then {@link MaterialStore.shareInstance} may let it join an identical block.
   */
  createInstance(instance) {
    this.add(instance, SPAWNED_ARENA_CAPACITY), this.blockChanges += 1;
  }
  /** Removes a spawned entity's instance: leaves its block, releasing the slot and the bind groups with the last user. */
  removeInstance(index) {
    if (!this.instances.has(index)) throw new Error(`internal error: no material instance ${String(index)}`);
    this.leave(index), this.instances.delete(index), this.blocks[index] = void 0, this.resources.delete(index), this.blockChanges += 1;
  }
  /** Takes `index` out of its block; frees the block when it was the last user, renames it when it was the lowest. */
  leave(index) {
    let block = this.blocks[index];
    if (block !== void 0) {
      if (block.members.delete(index), block.members.size === 0) {
        this.free(block);
        return;
      }
      block.name === index && (block.name = Math.min(...block.members));
    }
  }
  /** Releases a block nobody uses. */
  free(block) {
    if (block.storage !== null && block.storage.arena.release(block.storage.slot), block.resourceGroup !== void 0 && (this.registry.release(block.resourceGroup), block.resourceGroup = void 0), block.key !== void 0) {
      let bucket = this.buckets.get(block.key);
      if (bucket !== void 0) {
        let at3 = bucket.indexOf(block);
        at3 >= 0 && bucket.splice(at3, 1), bucket.length === 0 && this.buckets.delete(block.key);
      }
      block.key = void 0;
    }
  }
  /**
   * Lets identical `shareable` instances share their block, once every instance holds its initial values
   * (after `init`, or after the world refilled the store on device recovery). Candidates are bucketed by
   * `(material, hash of the block bytes, resources)`; a hash hit is confirmed word by word, so a collision
   * never shares different blocks. The lowest-indexed instance keeps its slot; the others release theirs.
   */
  shareIdentical() {
    for (let index of [...this.instances.keys()].sort((a, b) => a - b)) this.shareInstance(index);
  }
  /** {@link MaterialStore.shareIdentical} for one instance, which joins the first identical block offered before it. */
  shareInstance(index) {
    let instance = this.instances.get(index), block = this.blocks[index];
    if (instance === void 0 || block === void 0 || !instance.shareable || block.members.size !== 1 || block.key !== void 0) return;
    let hash = block.storage === null ? 0 : hashWords(block.storage.arena.slotWords(block.storage.slot)), key = `${instance.material.id}\0${String(hash)}\0${resourceSignature(instance)}`, candidates = this.buckets.get(key);
    if (candidates === void 0) {
      this.buckets.set(key, [block]), block.key = key;
      return;
    }
    let match = candidates.find((candidate) => candidate !== block && this.identical(candidate, block));
    if (match === void 0) {
      candidates.push(block), block.key = key;
      return;
    }
    this.join(index, block, match);
  }
  /** Same bytes (when the material has a block). Both blocks belong to `shareable` instances of one material and resources. */
  identical(a, b) {
    return a.storage === null || b.storage === null ? a.storage === b.storage : a.storage.arena === b.storage.arena && sameWords(a.storage.arena.slotWords(a.storage.slot), b.storage.arena.slotWords(b.storage.slot));
  }
  /** Makes instance `index`, the only user of `own`, use `target`. */
  join(index, own2, target) {
    own2.members.delete(index), this.free(own2), target.members.add(index), index < target.name && (target.name = index), this.blocks[index] = target, this.blockChanges += 1;
  }
  /**
   * Writes `value` through the generated field writer of `name` into the instance's slot. The slot is
   * marked dirty only when its bytes change (`spec/gpu-layout.md` section 8.2). An instance that shares
   * its block gets a block of its own first when the write would change the bytes.
   */
  writeParam(instance, name, value) {
    let block = this.blockOfInstance(instance), storage = block.storage;
    if (storage === null) throw new Error(`internal error: material instance ${String(instance)} has no value params`);
    let writer = storage.writers.fields.get(name);
    if (writer === void 0) throw new Error(`internal error: the layout '${storage.arena.id}' has no field '${name}'`);
    if (block.members.size > 1) {
      let write = (views, base) => {
        writer(views, base, value);
      };
      if (!storage.arena.wouldChange(storage.slot, write)) return;
      if (block = this.detach(instance, block, storage), storage = block.storage, storage === null) throw new Error(`internal error: material instance ${String(instance)} lost its block`);
    }
    storage.arena.writeFieldIfChanged(storage.slot, writer, value);
  }
  /** Copy on write: a new block holding the bytes of `shared`, used by `instance` alone. */
  detach(instance, shared, storage) {
    let { arena } = storage, slot = arena.allocate(), source = arena.slotWords(storage.slot);
    arena.writeIfChanged(slot, (views, base) => {
      views.u32.set(source, base >>> 2);
    });
    let own2 = {
      storage: { arena, slot, writers: storage.writers, layout: storage.layout },
      members: /* @__PURE__ */ new Set([instance]),
      name: instance,
      resourceGroup: void 0,
      key: void 0
    };
    return shared.members.delete(instance), shared.name === instance && (shared.name = Math.min(...shared.members)), this.blocks[instance] = own2, this.blockChanges += 1, own2;
  }
  /** The group-1 bind group of an instance (cached by its arena, or by its block when it has no slot). */
  bindGroup(instance) {
    let block = this.blockOfInstance(instance), resources = this.resources.get(instance);
    return block.storage !== null ? block.storage.arena.bindGroupForSlot(block.storage.slot, block.storage.layout, resources?.entries) : resources === void 0 ? this.plan.emptyMaterialGroup() : (block.resourceGroup ??= this.registry.createBindGroup({
      label: `mtek material instance ${String(block.name)} resources`,
      layout: resources.layout,
      entries: [...resources.entries]
    }), block.resourceGroup);
  }
  /** Uploads every dirty slot; returns the number of uploads. */
  flush(queue) {
    let uploads = 0;
    for (let arena of this.arenas.values()) uploads += arena.flush(queue);
    return uploads;
  }
  /** Releases every arena (hot reload: discard a retired scene). */
  dispose() {
    for (let arena of this.arenas.values()) arena.dispose();
    this.arenas.clear();
    for (let block of new Set(this.blocks))
      block?.resourceGroup !== void 0 && this.registry.release(block.resourceGroup);
    this.blocks.length = 0, this.instances.clear(), this.buckets.clear(), this.resources.clear(), this.builtins.dispose(), this.assetTextures.dispose();
  }
  blockOfInstance(instance) {
    let block = this.blocks[instance];
    if (block === void 0) throw new Error(`internal error: no material instance ${String(instance)}`);
    return block;
  }
};

// src/mesh/asset.ts
var ATTRIBUTE_BYTES = { position: 12, normal: 12, uv: 8 };
function meshRegions(primitive) {
  let regions = [];
  for (let name of ["position", "normal", "uv"]) {
    let offset = primitive.offsets[name];
    primitive.attributes.includes(name) && offset !== void 0 && regions.push({ name, offset, byteLength: primitive.vertexCount * ATTRIBUTE_BYTES[name] });
  }
  return regions.push({ name: "index", offset: primitive.offsets.indices, byteLength: primitive.indexCount * (primitive.indexFormat === "uint16" ? 2 : 4) }), regions;
}
function regionProblem(primitive, fileBytes) {
  if (!primitive.attributes.includes("position")) return "it has no position attribute";
  for (let name of primitive.attributes)
    if (primitive.offsets[name] === void 0) return `the attribute '${name}' has no offset`;
  if (!Number.isInteger(primitive.vertexCount) || primitive.vertexCount < 1) return `its vertex count is ${String(primitive.vertexCount)}`;
  if (!Number.isInteger(primitive.indexCount) || primitive.indexCount < 1) return `its index count is ${String(primitive.indexCount)}`;
  for (let region of meshRegions(primitive)) {
    if (!Number.isInteger(region.offset) || region.offset < 0 || region.offset % 4 !== 0)
      return `the ${region.name} data starts at byte ${String(region.offset)}, which is not a multiple of 4`;
    if (region.offset + region.byteLength > fileBytes)
      return `the ${region.name} data (bytes ${String(region.offset)} to ${String(region.offset + region.byteLength)}) lies outside the ${String(fileBytes)}-byte file`;
  }
  let { center, radius } = primitive.boundingSphere;
  if (!center.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0) return "its bounding sphere is not finite";
}

// src/mesh/primitives.ts
var BOX_FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], uAxis: 2, vAxis: 1 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], uAxis: 2, vAxis: 1 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], uAxis: 0, vAxis: 2 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], uAxis: 0, vAxis: 2 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], uAxis: 0, vAxis: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], uAxis: 0, vAxis: 1 }
], FACE_CORNERS = [
  { sa: -1, sb: -1, uv: [0, 1] },
  { sa: 1, sb: -1, uv: [1, 1] },
  { sa: 1, sb: 1, uv: [1, 0] },
  { sa: -1, sb: 1, uv: [0, 0] }
], QUAD_INDICES = [0, 1, 2, 0, 2, 3];
function component(v, axis) {
  return v[axis];
}
function requirePositiveFinite(value, what) {
  if (!(value > 0) || !Number.isFinite(value))
    throw new RangeError(`${what} must be finite and greater than 0 (got ${value})`);
}
function requireIntegerInRange(value, min2, max2, what) {
  if (!Number.isInteger(value) || value < min2 || value > max2)
    throw new RangeError(`${what} must be an integer in ${min2}..${max2} (got ${value})`);
}
function allocateIndices(vertexCount, indexCount) {
  return vertexCount <= 65535 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
}
function writeFace(face, centre, halfU, halfV, vertexOffset, buffers) {
  for (let k = 0; k < 4; k++) {
    let corner = FACE_CORNERS[k];
    if (corner === void 0) throw new Error("unreachable: quad corner");
    let a = corner.sa * halfU, b = corner.sb * halfV, vertex = vertexOffset + k;
    for (let axis = 0; axis < 3; axis++) {
      let i = axis;
      buffers.positions[vertex * 3 + axis] = component(centre, i) + a * component(face.u, i) + b * component(face.v, i) + 0, buffers.normals[vertex * 3 + axis] = component(face.n, i);
    }
    buffers.uvs[vertex * 2] = corner.uv[0], buffers.uvs[vertex * 2 + 1] = corner.uv[1];
  }
}
function generateBox(size) {
  let [sx, sy, sz] = size;
  requirePositiveFinite(sx, "box size x"), requirePositiveFinite(sy, "box size y"), requirePositiveFinite(sz, "box size z");
  let h = [sx / 2, sy / 2, sz / 2], positions = new Float32Array(72), normals = new Float32Array(72), uvs = new Float32Array(48), indices = allocateIndices(24, 36);
  return BOX_FACES.forEach((face, f) => {
    let centre = [face.n[0] * h[0], face.n[1] * h[1], face.n[2] * h[2]];
    writeFace(face, centre, component(h, face.uAxis), component(h, face.vAxis), f * 4, { positions, normals, uvs }), QUAD_INDICES.forEach((offset, k) => {
      indices[f * 6 + k] = f * 4 + offset;
    });
  }), { positions, normals, uvs, indices, boundingRadius: Math.hypot(h[0], h[1], h[2]) };
}
function generatePlane(size) {
  let [sx, sz] = size;
  requirePositiveFinite(sx, "plane size x"), requirePositiveFinite(sz, "plane size z");
  let top = BOX_FACES[2];
  if (top === void 0) throw new Error("unreachable: +Y face");
  let positions = new Float32Array(12), normals = new Float32Array(12), uvs = new Float32Array(8), indices = allocateIndices(4, 6);
  return writeFace(top, [0, 0, 0], sx / 2, sz / 2, 0, { positions, normals, uvs }), QUAD_INDICES.forEach((offset, k) => {
    indices[k] = offset;
  }), { positions, normals, uvs, indices, boundingRadius: Math.hypot(sx, sz) / 2 };
}
function generateSphere(radius, segments, rings) {
  requirePositiveFinite(radius, "sphere radius"), requireIntegerInRange(segments, 3, 256, "sphere segments"), requireIntegerInRange(rings, 2, 256, "sphere rings");
  let columns = segments + 1, vertexCount = (rings + 1) * columns, positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i <= rings; i++) {
    let theta = Math.PI * i / rings, sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
    for (let j = 0; j <= segments; j++) {
      let phi = 2 * Math.PI * j / segments, dx = sinTheta * Math.sin(phi), dy = cosTheta, dz = sinTheta * Math.cos(phi), k = i * columns + j;
      positions[k * 3] = radius * dx, positions[k * 3 + 1] = radius * dy, positions[k * 3 + 2] = radius * dz, normals[k * 3] = dx, normals[k * 3 + 1] = dy, normals[k * 3 + 2] = dz, uvs[k * 2] = j / segments, uvs[k * 2 + 1] = i / rings;
    }
  }
  let indices = allocateIndices(vertexCount, segments * (2 * rings - 2) * 3), w = 0;
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      let a = i * columns + j, b = (i + 1) * columns + j, c = (i + 1) * columns + j + 1, d = i * columns + j + 1;
      i !== rings - 1 && (indices[w++] = a, indices[w++] = b, indices[w++] = c), i !== 0 && (indices[w++] = a, indices[w++] = c, indices[w++] = d);
    }
  return { positions, normals, uvs, indices, boundingRadius: radius };
}

// src/mesh/cache.ts
function canonicalNumber(value) {
  return Object.is(value, -0) ? "0" : String(value);
}
function meshKey(descriptor) {
  switch (descriptor.kind) {
    case "asset":
      return `asset:${descriptor.asset}#${String(descriptor.primitive)}`;
    case "box":
      return `box:${descriptor.size.map(canonicalNumber).join(",")}`;
    case "plane":
      return `plane:${descriptor.size.map(canonicalNumber).join(",")}`;
    case "sphere":
      return `sphere:${[descriptor.radius, descriptor.segments, descriptor.rings].map(canonicalNumber).join(",")}`;
  }
}
function generate(descriptor) {
  switch (descriptor.kind) {
    case "box":
      return generateBox(descriptor.size);
    case "plane":
      return generatePlane(descriptor.size);
    case "sphere":
      return generateSphere(descriptor.radius, descriptor.segments, descriptor.rings);
  }
}
var MeshCache = class {
  meshes = /* @__PURE__ */ new Map();
  generatedCount = 0;
  /** Number of distinct meshes currently held. */
  get size() {
    return this.meshes.size;
  }
  /** Number of meshes generated over the lifetime of this cache (cache misses). */
  get generated() {
    return this.generatedCount;
  }
  /** Returns the shared mesh for `descriptor`, generating it on first use. */
  get(descriptor) {
    let key = meshKey(descriptor), cached = this.meshes.get(key);
    if (cached !== void 0) return cached;
    let mesh = Object.freeze(generate(descriptor));
    return this.meshes.set(key, mesh), this.generatedCount++, mesh;
  }
  /** Drops every mesh (the `generated` counter keeps counting). */
  clear() {
    this.meshes.clear();
  }
};

// src/render/meshes.ts
var BUFFER_USAGE_COPY_DST = 8, BUFFER_USAGE_INDEX = 16, BUFFER_USAGE_VERTEX = 32, ORIGIN2 = [0, 0, 0];
function vertexBufferOf(mesh, attribute) {
  let buffer = mesh.vertexBuffers[attribute];
  if (buffer === void 0) throw new Error(`internal error: the mesh '${mesh.key}' has no '${attribute}' attribute`);
  return buffer;
}
function uploadBuffer(registry, queue, label, usage, data) {
  let size = roundUp(4, data.byteLength), buffer = registry.createBuffer({ label, size, usage: usage | BUFFER_USAGE_COPY_DST }), source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (size !== data.byteLength) {
    let padded = new Uint8Array(size);
    padded.set(source), source = padded;
  }
  let bytes = source.byteOffset === 0 && source.byteLength === source.buffer.byteLength ? source.buffer : source.slice().buffer;
  return registry.writeBuffer(queue, buffer, 0, bytes, 0, size), buffer;
}
var MeshStore = class {
  constructor(registry, queue, cache = new MeshCache(), maxBufferSize = 1 / 0) {
    this.registry = registry;
    this.queue = queue;
    this.cache = cache;
    this.maxBufferSize = maxBufferSize;
  }
  registry;
  queue;
  cache;
  maxBufferSize;
  byKey = /* @__PURE__ */ new Map();
  byId = /* @__PURE__ */ new Map();
  /** Number of distinct meshes on the GPU. */
  get size() {
    return this.byKey.size;
  }
  /**
   * Generates (primitive shapes) or reads from `assets` (asset meshes) and uploads every mesh not uploaded yet;
   * descriptors with equal values share one upload.
   */
  upload(meshes, assets) {
    for (let mesh of meshes) {
      let key = meshKey(mesh.descriptor), gpu = this.byKey.get(key);
      gpu === void 0 && (gpu = mesh.descriptor.kind === "asset" ? this.uploadAsset(key, mesh.descriptor, assets) : this.uploadPrimitive(key, mesh), this.byKey.set(key, gpu)), this.byId.set(mesh.id, gpu);
    }
  }
  uploadPrimitive(key, mesh) {
    if (mesh.descriptor.kind === "asset") throw new Error("internal error: uploadPrimitive of an asset mesh");
    let data = this.cache.get(mesh.descriptor), label = `mtek mesh ${key}`;
    return {
      key,
      order: this.byKey.size,
      vertexBuffers: {
        position: uploadBuffer(this.registry, this.queue, `${label} position`, BUFFER_USAGE_VERTEX, data.positions),
        normal: uploadBuffer(this.registry, this.queue, `${label} normal`, BUFFER_USAGE_VERTEX, data.normals),
        uv: uploadBuffer(this.registry, this.queue, `${label} uv`, BUFFER_USAGE_VERTEX, data.uvs)
      },
      indexBuffer: uploadBuffer(this.registry, this.queue, `${label} index`, BUFFER_USAGE_INDEX, data.indices),
      indexFormat: data.indices instanceof Uint16Array ? "uint16" : "uint32",
      indexCount: data.indices.length,
      vertexCount: data.positions.length / 3,
      boundingCenter: ORIGIN2,
      boundingRadius: data.boundingRadius
    };
  }
  /** One buffer per region of the primitive in its file: the vertex attributes it has, then the indices. */
  uploadAsset(key, source, assets) {
    if (assets === void 0) throw new Error(`internal error: the mesh '${key}' comes from an asset, but no assets were loaded`);
    let bytes = assets.bytes(source.asset), { layout } = source, label = `mtek mesh ${key}`, regions = meshRegions(layout);
    for (let region of regions) {
      let size = roundUp(4, region.byteLength);
      if (size > this.maxBufferSize) {
        let message = `Allocating the GPU buffer '${label} ${region.name}' (${String(size)} bytes) failed: it exceeds the device's maxBufferSize (${String(this.maxBufferSize)}).`;
        throw this.registry.reportAllocationFailure(message), new RangeError(message);
      }
    }
    let vertexBuffers = {}, indexBuffer;
    for (let region of regions) {
      let data = bytes.subarray(region.offset, region.offset + region.byteLength);
      region.name === "index" ? indexBuffer = uploadBuffer(this.registry, this.queue, `${label} index`, BUFFER_USAGE_INDEX, data) : vertexBuffers[region.name] = uploadBuffer(this.registry, this.queue, `${label} ${region.name}`, BUFFER_USAGE_VERTEX, data);
    }
    if (indexBuffer === void 0) throw new Error("internal error: meshRegions returned no index region");
    return {
      key,
      order: this.byKey.size,
      vertexBuffers,
      indexBuffer,
      indexFormat: layout.indexFormat,
      indexCount: layout.indexCount,
      vertexCount: layout.vertexCount,
      boundingCenter: layout.boundingSphere.center,
      boundingRadius: layout.boundingSphere.radius
    };
  }
  /** The uploaded mesh of a manifest mesh id. */
  get(id) {
    let mesh = this.byId.get(id);
    if (mesh === void 0) throw new Error(`internal error: mesh '${id}' was not uploaded`);
    return mesh;
  }
  /** Releases every uploaded buffer (hot reload: discard a retired scene). */
  dispose() {
    for (let gpu of this.byKey.values()) {
      for (let buffer of Object.values(gpu.vertexBuffers)) this.registry.release(buffer);
      this.registry.release(gpu.indexBuffer);
    }
    this.byKey.clear(), this.byId.clear();
  }
};

// src/render/instancing.ts
function batchDraws(draws, canInstance, out) {
  let used = 0, instances = 0, instanced = 0, start = 0;
  for (; start < draws.length; ) {
    let first = draws[start];
    if (first === void 0) break;
    let end = start + 1;
    if (canInstance(first))
      for (; end < draws.length; ) {
        let next = draws[end];
        if (next === void 0 || next.pipelineKey !== first.pipelineKey || next.instance !== first.instance || next.mesh !== first.mesh) break;
        end += 1;
      }
    let count2 = end - start;
    count2 >= 2 ? (putBatch(out, used, start, count2, instances), instances += count2, instanced += 1) : putBatch(out, used, start, 1, -1), used += 1, start = end;
  }
  return out.length = used, instanced;
}
function putBatch(out, index, start, count2, firstInstance) {
  let existing = out[index];
  existing === void 0 ? out.push({ start, count: count2, firstInstance }) : (existing.start = start, existing.count = count2, existing.firstInstance = firstInstance);
}
function instancingCandidates(structure, blockOf, pipelineKeyOf) {
  let groups = /* @__PURE__ */ new Map();
  for (let entity of structure.entities) {
    if (entity.mesh === null || entity.instance === null) continue;
    let { material } = entity.instance;
    if (material.shader.instancedVertexEntry === void 0) continue;
    let key = JSON.stringify([pipelineKeyOf(material), blockOf(entity.instance.index), meshKey(entity.mesh.descriptor)]), group = groups.get(key);
    group === void 0 ? groups.set(key, { material: material.id, count: 1 }) : group.count += 1;
  }
  let materials = /* @__PURE__ */ new Set(), capacity = 0;
  for (let group of groups.values())
    group.count < 2 || (materials.add(group.material), capacity += group.count);
  for (let prefab of structure.prefabs) {
    let material = prefab.material?.material;
    prefab.mesh === null || material === void 0 || material.shader.instancedVertexEntry === void 0 || materials.add(material.id);
  }
  return { materials, capacity };
}

// src/host/surface.ts
var OFFSCREEN_FORMAT = "rgba8unorm-srgb", DEPTH_FORMAT = "depth24plus";
function srgbViewFormat(format) {
  if (format === "bgra8unorm") return "bgra8unorm-srgb";
  if (format === "rgba8unorm") return "rgba8unorm-srgb";
}
function backingSize(clientWidth, clientHeight, devicePixelRatio2, maxDimension) {
  let scale = (client) => Math.min(Math.max(Math.round(client * devicePixelRatio2), 0), maxDimension);
  return { width: scale(clientWidth), height: scale(clientHeight) };
}
function paddedBytesPerRow(width) {
  return Math.ceil(width * 4 / 256) * 256;
}
var Surface = class {
  constructor(options) {
    this.options = options;
    let view = srgbViewFormat(options.format);
    if (view === void 0) throw new Error(`Surface: no sRGB view format for ${options.format}`);
    this.viewFormat = view, this.device = options.device;
  }
  options;
  get timer() {
    return this.timerDropped ? void 0 : this.options.timer;
  }
  viewFormat;
  widthPx = 0;
  heightPx = 0;
  depth = null;
  /** The GPU timer belongs to the device it was created on; a recovered device has none (decision 0055, 0056). */
  timerDropped = !1;
  depthWidth = 0;
  depthHeight = 0;
  offscreen = null;
  offscreenWidth = 0;
  offscreenHeight = 0;
  /** Replaced by `recover`. */
  device;
  rendered = 0;
  skipped = 0;
  configured = !1;
  /** Unconfigured because the canvas has no pixels; configured again when it has (decision 0132). */
  parked = !1;
  /** Frames that were drawn / skipped because the canvas has no pixels. */
  get framesRendered() {
    return this.rendered;
  }
  get framesSkipped() {
    return this.skipped;
  }
  /** The current backing (or render target) size in pixels. */
  get size() {
    return { width: this.widthPx, height: this.heightPx };
  }
  /** The format of the colour attachment: the offscreen target's, or the canvas's sRGB view format. */
  get colorFormat() {
    return this.drawsOffscreen ? OFFSCREEN_FORMAT : this.viewFormat;
  }
  get drawsOffscreen() {
    return this.options.renderTarget !== void 0 || this.options.canvasRenderTarget === !0;
  }
  /** True when a frame can be drawn: the target has at least one pixel. */
  get renderable() {
    return this.widthPx > 0 && this.heightPx > 0;
  }
  /**
   * `context.configure` with the preferred format, its sRGB view format and opaque alpha, so the hardware
   * encodes linear to sRGB (`spec/runtime-abi.md` section 8.2). Throws what the browser throws.
   */
  configure() {
    let { context, format } = this.options, { device } = this;
    context.configure({ device, format, viewFormats: [this.viewFormat], alphaMode: "opaque" }), this.configured = !0;
  }
  /**
   * Computes the size, applies it to the canvas and creates the depth texture (and the offscreen target
   * with `test.renderTarget`). Throws the registry's error when an allocation fails.
   */
  allocate() {
    let { renderTarget } = this.options;
    if (renderTarget !== void 0) {
      this.widthPx = renderTarget.width, this.heightPx = renderTarget.height, this.ensureOffscreen(), this.ensureDepth();
      return;
    }
    this.applyCanvasSize();
  }
  /**
   * Recomputes the backing size after a `ResizeObserver` callback. Returns true when the size changed. In
   * render-target mode the size is fixed and nothing changes.
   */
  resize() {
    return this.options.renderTarget !== void 0 ? !1 : this.applyCanvasSize();
  }
  applyCanvasSize() {
    let { canvas, devicePixelRatio: devicePixelRatio2 } = this.options, max2 = this.device.limits.maxTextureDimension2D, { width, height } = backingSize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio2(), max2), changed = width !== this.widthPx || height !== this.heightPx;
    this.widthPx = width, this.heightPx = height;
    let empty = width === 0 || height === 0;
    return empty && this.configured && (this.options.context.unconfigure(), this.configured = !1, this.parked = !0), canvas.width !== width && (canvas.width = width), canvas.height !== height && (canvas.height = height), !empty && this.parked && (this.parked = !1, this.configure()), this.options.canvasRenderTarget === !0 && this.ensureOffscreen(), this.ensureDepth(), changed;
  }
  /**
   * Creates the offscreen target for the current size unless one of that size exists; the old texture is
   * released after the new one is in place (section 9.2). A zero-sized target keeps the old texture: nothing
   * is drawn while `renderable` is false.
   */
  ensureOffscreen() {
    if (!this.renderable || this.offscreen !== null && this.offscreenWidth === this.widthPx && this.offscreenHeight === this.heightPx) return;
    let next = this.options.registry.createTexture({
      label: "mtek render target",
      size: [this.widthPx, this.heightPx],
      format: OFFSCREEN_FORMAT,
      usage: 17
    }), previous = this.offscreen;
    this.offscreen = next, this.offscreenWidth = this.widthPx, this.offscreenHeight = this.heightPx, previous !== null && this.options.registry.release(previous);
  }
  /**
   * Device recovery: forgets every texture of the lost device, configures the canvas for `device` and
   * allocates the depth texture (and the offscreen target) again at the canvas's current size. Throws what
   * the browser or the registry throws; the caller treats that as a failed recovery attempt.
   */
  recover(device) {
    this.device = device, this.timerDropped = !0, this.depth = null, this.depthWidth = 0, this.depthHeight = 0, this.offscreen = null, this.offscreenWidth = 0, this.offscreenHeight = 0, this.widthPx = 0, this.heightPx = 0, this.configured = !1, this.parked = !1, this.configure(), this.allocate();
  }
  /** Creates the depth texture for the current size; the old one is released only after the new one exists. */
  ensureDepth() {
    if (!this.renderable || this.depth !== null && this.depthWidth === this.widthPx && this.depthHeight === this.heightPx) return;
    let next = this.options.registry.createTexture({
      label: "mtek depth",
      size: [this.widthPx, this.heightPx],
      format: DEPTH_FORMAT,
      usage: 16
    }), previous = this.depth;
    this.depth = next, this.depthWidth = this.widthPx, this.depthHeight = this.heightPx, previous !== null && this.options.registry.release(previous);
  }
  /**
   * Draws one frame: one render pass that clears to the RGB of `clearColor` (linear, encoded by the sRGB
   * view; alpha 1, the canvas is opaque) and depth 1.0, then runs `encode` to record the draws, and
   * submits. Returns false and draws nothing when the canvas has no pixels (a zero-sized canvas is not an
   * error).
   */
  render(clearColor, encode) {
    if (!this.renderable || this.depth === null)
      return this.skipped += 1, !1;
    let { context } = this.options, { device } = this, target = this.offscreen ?? context.getCurrentTexture(), encoder = device.createCommandEncoder({ label: "mtek frame" }), timestampWrites = this.timer?.passTimestampWrites(), pass = encoder.beginRenderPass({
      ...timestampWrites === void 0 ? {} : { timestampWrites },
      colorAttachments: [
        {
          view: target.createView({ format: this.offscreen !== null ? OFFSCREEN_FORMAT : this.viewFormat }),
          clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: 1 },
          loadOp: "clear",
          storeOp: "store"
        }
      ],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store"
      }
    });
    return encode?.(pass), pass.end(), timestampWrites !== void 0 && this.timer?.resolve(encoder), device.queue.submit([encoder.finish()]), timestampWrites !== void 0 && this.timer?.submitted(), this.rendered += 1, !0;
  }
  /**
   * Copies the offscreen target to a mappable buffer (`bytesPerRow` padded to 256), maps it and returns
   * tightly packed rows (`spec/runtime-abi.md` section 10.2). The staging buffer is released either way.
   */
  async readPixels() {
    let { registry } = this.options, { device } = this, offscreen = this.offscreen;
    if (offscreen === null || !this.renderable)
      throw new Error(
        this.drawsOffscreen ? "readPixels: the canvas has no pixels" : "readPixels requires mountMtek options test.renderTarget or test.canvasRenderTarget"
      );
    let width = this.offscreenWidth, height = this.offscreenHeight, bytesPerRow = paddedBytesPerRow(width), staging = registry.createBuffer({
      label: "mtek readback",
      size: bytesPerRow * height,
      usage: 9
    });
    try {
      let encoder = device.createCommandEncoder({ label: "mtek readback" });
      encoder.copyTextureToBuffer({ texture: offscreen }, { buffer: staging, bytesPerRow }, [width, height]), device.queue.submit([encoder.finish()]), await staging.mapAsync(1);
      let mapped = new Uint8Array(staging.getMappedRange()), data = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row += 1)
        data.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
      return staging.unmap(), { width, height, format: OFFSCREEN_FORMAT, data };
    } finally {
      try {
        registry.release(staging);
      } catch {
      }
    }
  }
  /** Unconfigures the canvas. The textures are released by the registry's `destroyAll`. */
  dispose() {
    this.parked = !1, this.configured && (this.configured = !1, this.options.context.unconfigure()), this.depth = null, this.offscreen = null;
  }
};

// src/render/pipelines.ts
var STAGE_VERTEX = 1, STAGE_FRAGMENT = 2, CULL_MODE = "back", FRONT_FACE = "ccw", TOPOLOGY = "triangle-list", DEPTH_COMPARE = "less", INSTANCE_MATRICES = "instance_matrices", INSTANCE_MODEL_LOCATION = 3, INSTANCE_NORMAL_LOCATION = 7, INSTANCE_STRIDE = 128, INSTANCE_FLOATS = INSTANCE_STRIDE / 4;
function pipelineKey(parts) {
  return JSON.stringify([parts.shaderHash, parts.vertexAttributes, parts.colorFormat, parts.depthFormat, parts.cullMode, parts.topology]);
}
var VERTEX_FORMATS = {
  position: { location: 0, format: "float32x3", stride: 12 },
  normal: { location: 1, format: "float32x3", stride: 12 },
  uv: { location: 2, format: "float32x2", stride: 8 }
};
function vertexBufferLayouts(attributes) {
  return attributes.map((attribute) => {
    let { location, format, stride } = VERTEX_FORMATS[attribute];
    return { arrayStride: stride, stepMode: "vertex", attributes: [{ shaderLocation: location, offset: 0, format }] };
  });
}
function instanceBufferLayout() {
  let attributes = [];
  for (let column = 0; column < 4; column++) attributes.push({ shaderLocation: INSTANCE_MODEL_LOCATION + column, offset: column * 16, format: "float32x4" });
  for (let column = 0; column < 4; column++) attributes.push({ shaderLocation: INSTANCE_NORMAL_LOCATION + column, offset: 64 + column * 16, format: "float32x4" });
  return { arrayStride: INSTANCE_STRIDE, stepMode: "instance", attributes };
}
function uniformEntry(size, visibility, hasDynamicOffset) {
  return { binding: 0, visibility, buffer: { type: "uniform", hasDynamicOffset, minBindingSize: size } };
}
function materialLayoutKey(size, resources) {
  let kinds = resources.map((resource) => `${String(resource.binding)}${resource.kind === "texture" ? "t" : "s"}`);
  return [`${String(size)} bytes`, ...kinds].join(" ");
}
var BindingPlan = class {
  constructor(registry, frameLayout, objectLayout) {
    this.registry = registry;
    this.frame = registry.createBindGroupLayout({ label: "mtek group 0 (MtekFrame)", entries: [uniformEntry(frameLayout.size, STAGE_VERTEX | STAGE_FRAGMENT, !1)] }), this.object = registry.createBindGroupLayout({ label: "mtek group 2 (MtekObject)", entries: [uniformEntry(objectLayout.size, STAGE_VERTEX, !0)] });
  }
  registry;
  frame;
  object;
  materialLayouts = /* @__PURE__ */ new Map();
  pipelineLayouts = /* @__PURE__ */ new Map();
  emptyGroup;
  /**
   * Group 1 of a material: its parameter block at binding 0 (fragment stage; absent without value
   * params), then one binding per texture or sampler (`spec/gpu-layout.md` section 6). The layout
   * depends only on the block size and the kinds of the resources, so materials with the same shape
   * share it.
   */
  material(layout, resources = []) {
    let size = layout?.size ?? 0, key = materialLayoutKey(size, resources), found = this.materialLayouts.get(key);
    if (found === void 0) {
      let entries = size === 0 ? [] : [uniformEntry(size, STAGE_FRAGMENT, !1)];
      for (let resource of resources)
        entries.push(
          resource.kind === "texture" ? { binding: resource.binding, visibility: STAGE_FRAGMENT, texture: { sampleType: "float", viewDimension: "2d", multisampled: !1 } } : { binding: resource.binding, visibility: STAGE_FRAGMENT, sampler: { type: "filtering" } }
        );
      found = this.registry.createBindGroupLayout({
        label: size === 0 && resources.length === 0 ? "mtek group 1 (no params)" : `mtek group 1 (${key})`,
        entries
      }), this.materialLayouts.set(key, found);
    }
    return found;
  }
  /** The bind group of the empty group-1 layout, shared by every material without value params or resources. */
  emptyMaterialGroup() {
    return this.emptyGroup ??= this.registry.createBindGroup({ label: "mtek group 1 (no params)", layout: this.material(null), entries: [] }), this.emptyGroup;
  }
  pipelineLayout(layout, resources = []) {
    let key = materialLayoutKey(layout?.size ?? 0, resources), found = this.pipelineLayouts.get(key);
    return found === void 0 && (found = this.registry.createPipelineLayout({
      label: `mtek pipeline layout (${key})`,
      bindGroupLayouts: [this.frame, this.material(layout, resources), this.object]
    }), this.pipelineLayouts.set(key, found)), found;
  }
};
function materialPipelineKey(material, colorFormat, instanced = !1) {
  return pipelineKey({
    shaderHash: material.shader.hash,
    vertexAttributes: instanced ? [...material.shader.vertexAttributes, INSTANCE_MATRICES] : material.shader.vertexAttributes,
    colorFormat,
    depthFormat: DEPTH_FORMAT,
    cullMode: CULL_MODE,
    topology: TOPOLOGY
  });
}
function pipelineDescriptor(plan, request) {
  let { material, module, colorFormat } = request, buffers = vertexBufferLayouts(material.shader.vertexAttributes), entryPoint = material.shader.vertexEntry;
  if (request.instanced === !0) {
    let instancedEntry = material.shader.instancedVertexEntry;
    if (instancedEntry === void 0) throw new Error(`internal error: the shader of '${material.id}' has no instanced vertex entry`);
    entryPoint = instancedEntry, buffers.push(instanceBufferLayout());
  }
  return {
    label: request.instanced === !0 ? `mtek pipeline ${material.id} (instanced)` : `mtek pipeline ${material.id}`,
    layout: plan.pipelineLayout(material.layout, material.resources),
    vertex: { module, entryPoint, buffers },
    fragment: { module, entryPoint: material.shader.fragmentEntry, targets: [{ format: colorFormat }] },
    primitive: { topology: TOPOLOGY, cullMode: CULL_MODE, frontFace: FRONT_FACE },
    depthStencil: { format: DEPTH_FORMAT, depthCompare: DEPTH_COMPARE, depthWriteEnabled: !0 }
  };
}
function errorText4(error) {
  return error instanceof Error ? error.message === "" ? error.name : error.message : String(error);
}
var PipelineCache = class {
  constructor(device, registry, plan, manifest) {
    this.device = device;
    this.registry = registry;
    this.plan = plan;
    this.manifest = manifest;
  }
  device;
  registry;
  plan;
  manifest;
  pipelines = /* @__PURE__ */ new Map();
  get size() {
    return this.pipelines.size;
  }
  get(key) {
    return this.pipelines.get(key);
  }
  /**
   * Seeds the cache with pipelines from a previous program so unchanged shader hashes reuse them
   * (`spec/runtime-abi.md` section 11.3 — a colour edit creates no pipeline).
   */
  adopt(key, pipeline) {
    this.pipelines.has(key) || this.pipelines.set(key, pipeline);
  }
  /** Copies every entry of `other` into this cache (for hot reload reuse). */
  adoptAll(other) {
    for (let [key, pipeline] of other.pipelines) this.adopt(key, pipeline);
  }
  /** Returns the cached pipeline of the request's key, or creates it inside a validation error scope. */
  async obtain(request) {
    let key = materialPipelineKey(request.material, request.colorFormat, request.instanced === !0), cached = this.pipelines.get(key);
    if (cached !== void 0) return { ok: !0, key, pipeline: cached };
    let descriptor = pipelineDescriptor(this.plan, request);
    this.device.pushErrorScope("validation");
    let creation = this.registry.createRenderPipelineAsync(descriptor).then(
      (pipeline) => ({ pipeline, error: void 0 }),
      (error) => ({ pipeline: void 0, error: errorText4(error) })
    ), scope = this.device.popErrorScope().then(
      (error) => error === null ? void 0 : error.message,
      // popErrorScope rejects when the device is lost; the loss is reported through device.lost.
      () => {
      }
    ), [created, scopeError] = await Promise.all([creation, scope]), message = created.error ?? scopeError;
    return created.pipeline === void 0 || message !== void 0 ? (created.pipeline !== void 0 && this.registry.release(created.pipeline), { ok: !1, diagnostic: this.failure(request, message ?? "the pipeline was not created") }) : (this.pipelines.set(key, created.pipeline), { ok: !0, key, pipeline: created.pipeline });
  }
  failure(request, message) {
    let spanId = spanOfSymbol(this.manifest, request.material.id);
    return makeRuntimeDiagnostic("E8051", {
      phase: request.phase ?? "runtime:mount",
      message: `The render pipeline for material '${request.material.id}' could not be created: ${message}`,
      source: spanId === void 0 ? null : resolveSpan(this.manifest, spanId),
      notes: [`pipeline key: ${materialPipelineKey(request.material, request.colorFormat, request.instanced === !0)}`]
    });
  }
};

// src/render/lights.ts
var LIGHT_KIND = { directional: 0, point: 1 };
function emptyPackedLights(capacity) {
  return Array.from({ length: capacity }, () => ({
    color: { x: 0, y: 0, z: 0 },
    kind: 0,
    position: { x: 0, y: 0, z: 0 },
    range: 0,
    direction: { x: 0, y: 0, z: 0 },
    reserved: 0
  }));
}
function packLights(lights, source, out) {
  for (let slot = 0; slot < lights.length; slot++) {
    let declared = lights[slot], packed = out[slot];
    if (packed === void 0) throw new RangeError(`light ${String(slot)} does not fit the ${String(out.length)} slots of the frame block`);
    let record = source.light(declared.entity), world = source.worldMatrix(declared.entity);
    packed.color.x = record.color.r * record.intensity, packed.color.y = record.color.g * record.intensity, packed.color.z = record.color.b * record.intensity, packed.kind = declared.kind === "point" ? LIGHT_KIND.point : LIGHT_KIND.directional, packed.position.x = world[12] ?? 0, packed.position.y = world[13] ?? 0, packed.position.z = world[14] ?? 0, packed.range = declared.range;
    let zx = world[8] ?? 0, zy = world[9] ?? 0, zz = world[10] ?? 0, length2 = Math.hypot(zx, zy, zz);
    length2 > 0 ? (packed.direction.x = -zx / length2, packed.direction.y = -zy / length2, packed.direction.z = -zz / length2) : (packed.direction.x = 0, packed.direction.y = 0, packed.direction.z = -1);
  }
  return lights.length;
}

// src/render/frustum.ts
function extractFrustumPlanes(viewProj, out = new Float64Array(24)) {
  let plane = (index, r1, s1, r2, s2) => {
    let coefficient = (column) => s1 * (viewProj[column * 4 + r1] ?? 0) + s2 * (viewProj[column * 4 + r2] ?? 0), a = coefficient(0), b = coefficient(1), c = coefficient(2), d = coefficient(3), length2 = Math.hypot(a, b, c), scale = length2 > 0 ? 1 / length2 : 0;
    out[index * 4] = a * scale, out[index * 4 + 1] = b * scale, out[index * 4 + 2] = c * scale, out[index * 4 + 3] = d * scale;
  };
  return plane(0, 3, 1, 0, 1), plane(1, 3, 1, 0, -1), plane(2, 3, 1, 1, 1), plane(3, 3, 1, 1, -1), plane(4, 2, 1, 2, 0), plane(5, 3, 1, 2, -1), out;
}
function sphereIntersectsFrustum(planes, cx, cy, cz, radius) {
  for (let base = 0; base < 24; base += 4)
    if ((planes[base] ?? 0) * cx + (planes[base + 1] ?? 0) * cy + (planes[base + 2] ?? 0) * cz + (planes[base + 3] ?? 0) < -radius) return !1;
  return !0;
}
function worldBoundingSphere(world, meshRadius, out = { x: 0, y: 0, z: 0, radius: 0 }, center) {
  let m0 = world[0] ?? 0, m1 = world[1] ?? 0, m2 = world[2] ?? 0, m4 = world[4] ?? 0, m5 = world[5] ?? 0, m6 = world[6] ?? 0, m8 = world[8] ?? 0, m9 = world[9] ?? 0, m10 = world[10] ?? 0, m12 = world[12] ?? 0, m13 = world[13] ?? 0, m14 = world[14] ?? 0;
  if (center === void 0)
    out.x = m12, out.y = m13, out.z = m14;
  else {
    let [cx, cy, cz] = center;
    out.x = m0 * cx + m4 * cy + m8 * cz + m12, out.y = m1 * cx + m5 * cy + m9 * cz + m13, out.z = m2 * cx + m6 * cy + m10 * cz + m14;
  }
  let c0 = m0 * m0 + m1 * m1 + m2 * m2, c1 = m4 * m4 + m5 * m5 + m6 * m6, c2 = m8 * m8 + m9 * m9 + m10 * m10;
  return out.radius = meshRadius * Math.sqrt(Math.max(c0, c1, c2)), out;
}

// src/render/renderer.ts
function compareDraws(a, b) {
  return a.pipelineKey !== b.pipelineKey ? a.pipelineKey < b.pipelineKey ? -1 : 1 : a.instance - b.instance || a.mesh - b.mesh || a.order - b.order;
}
var BUFFER_USAGE_COPY_DST2 = 8, BUFFER_USAGE_VERTEX2 = 32, VIEW_KEY_LENGTH = 13;
function fieldWriter(writers, name, layoutId) {
  let writer = writers.fields.get(name);
  if (writer === void 0) throw new Error(`internal error: the layout '${layoutId}' has no writer for '${name}'`);
  return writer;
}
var Renderer = class {
  options;
  frameArena;
  frameSlot;
  objectArena;
  /** By static entity index; `undefined` for entities without a mesh. */
  objectSlots = [];
  writeViewProj;
  writeCameraPosition;
  writeLightCount;
  writeAmbient;
  writeExposure;
  /** `exposureScale` of the active camera's EV100 (construction-only, decision 0081). */
  exposure;
  writeLights;
  /** The value of `MtekFrame.lights`, refilled every frame. */
  packedLights;
  lightSource;
  writeModel;
  writeNormalMatrix;
  ambient;
  lastView = identity();
  /** `P * V` of the last frame, and the camera numbers it was computed from (`viewKey`): reused while they are equal. */
  lastViewProj = identity();
  viewKey = new Float64Array(VIEW_KEY_LENGTH);
  nextViewKey = new Float64Array(VIEW_KEY_LENGTH);
  viewKeyValid = !1;
  draws = [];
  drawsVersion = -1;
  drawsBlockVersion = -1;
  drawsPopulation = -1;
  drawCallsLastFrame = 0;
  instancedLastFrame = 0;
  culledLastFrame = 0;
  drawCallsTotal = 0;
  instancedTotal = 0;
  culledTotal = 0;
  /** The draws that survived culling this frame (reused between frames). */
  drawn = [];
  planes = new Float64Array(24);
  /** Per static entity index, from its last object-block write: world-space sphere centre (x, y, z) and largest world scale. */
  sphereCentres;
  sphereScales;
  /** Per static entity index: the local-space centre of its mesh's bounding sphere; `undefined` at the mesh origin (every primitive shape). */
  localCentres = [];
  sphere = { x: 0, y: 0, z: 0, radius: 0 };
  cullingEnabled = !0;
  /** The instance vertex buffer (`INSTANCE_STRIDE` bytes per record); absent when no draw can ever be instanced. */
  instanceBuffer;
  /** How many instance records `instanceBuffer` holds. */
  instanceRecords = 0;
  /** Whether draws can be instanced at all: instancing is on and some entity or prefab has a material with an instanced entry point. */
  instancingPossible;
  /**
   * Per entity slot: its model matrix, then its normal matrix (`INSTANCE_FLOATS` f32), as of the last frame in which its
   * world matrix changed. The object block and the instance record of the entity are copies of these 32 words; the
   * object block only when a draw reads it (`objectStale`).
   */
  entityMatrices;
  entityWords;
  /** Per entity slot, 1 when the entity's object block does not hold `entityMatrices` (it is written when the entity is drawn individually). */
  objectStale;
  /** The entity slots whose world matrix changed in this frame's `applyWorldChanges` and that have a drawable slot. */
  changedEntities = new Int32Array(0);
  changedCount = 0;
  /** What the GPU instance buffer holds, by record (to upload only what changed), and the words of it that changed this frame. */
  instanceMirror;
  instanceMirrorWords;
  instanceLow = 0;
  instanceHigh = -1;
  /** Per entity slot: the record it occupies in the instance buffer in the current batching, or -1. */
  recordOf;
  /** The draw calls of this frame (reused between frames); valid for `batchedDraws`. */
  batches = [];
  batchedDraws;
  instancedBatches = 0;
  /** What the cull and the batching of the last frame were computed for. */
  cullListed;
  cullViewProj;
  cullDirty = !0;
  /** Whether the last `cull` produced the same draws as the frame before. */
  drawnUnchanged = !1;
  /** The one dynamic offset of every `setBindGroup(2, …)` of `encode` (the browser reads it during the call). */
  dynamicOffset = [0];
  modelScratch = new Float32Array(16);
  normalScratch = new Float32Array(16);
  /** Materials that failed after mount (`failMaterial`): never drawn. */
  failedMaterials = /* @__PURE__ */ new Set();
  constructor(options) {
    this.options = options;
    let { device, registry, structure, writers, manifest } = options, frameWriters = writers.get(structure.frameLayout.id), objectWriters = writers.get(structure.objectLayout.id);
    if (frameWriters === void 0 || objectWriters === void 0) throw new Error("internal error: no writers for the built-in blocks");
    this.writeViewProj = fieldWriter(frameWriters, "view_proj", structure.frameLayout.id), this.writeCameraPosition = fieldWriter(frameWriters, "camera_position", structure.frameLayout.id), this.writeLightCount = fieldWriter(frameWriters, "light_count", structure.frameLayout.id), this.writeAmbient = fieldWriter(frameWriters, "ambient", structure.frameLayout.id), this.writeExposure = fieldWriter(frameWriters, "exposure", structure.frameLayout.id), this.exposure = exposureScale(structure.camera.exposure), this.writeLights = fieldWriter(frameWriters, "lights", structure.frameLayout.id), this.packedLights = emptyPackedLights(structure.lightCapacity), this.lightSource = {
      light: (entity) => {
        let light = options.world.entities[entity]?.light;
        if (light == null) throw new Error(`internal error: entity ${String(entity)} has no light record`);
        return light;
      },
      worldMatrix: (entity) => options.world.worldMatrix(entity)
    }, this.writeModel = fieldWriter(objectWriters, "model", structure.objectLayout.id), this.writeNormalMatrix = fieldWriter(objectWriters, "normal_matrix", structure.objectLayout.id);
    let { ambientColor, ambientIntensity } = manifest.scene.fields;
    this.ambient = Object.freeze({ x: ambientColor[0] * ambientIntensity, y: ambientColor[1] * ambientIntensity, z: ambientColor[2] * ambientIntensity }), this.frameArena = new UniformArena(device, registry, structure.frameLayout, { initialCapacity: 1 }), this.frameSlot = this.frameArena.allocate();
    let drawable = structure.entities.filter((entity) => entity.mesh !== null);
    this.objectArena = new UniformArena(device, registry, structure.objectLayout, { dynamicOffset: !0, initialCapacity: Math.max(1, drawable.length) });
    for (let entity of drawable) {
      this.objectSlots[entity.index] = this.objectArena.allocate();
      let centre = entity.mesh === null ? void 0 : options.meshes.get(entity.mesh.id).boundingCenter;
      centre !== void 0 && (centre[0] !== 0 || centre[1] !== 0 || centre[2] !== 0) && (this.localCentres[entity.index] = centre);
    }
    this.sphereCentres = new Float64Array(structure.entities.length * 3), this.sphereScales = new Float64Array(structure.entities.length), this.entityMatrices = new Float32Array(structure.entities.length * INSTANCE_FLOATS), this.entityWords = new Uint32Array(this.entityMatrices.buffer), this.objectStale = new Uint8Array(structure.entities.length).fill(1), this.recordOf = new Int32Array(structure.entities.length).fill(-1);
    let candidates = options.instancing === !1 ? void 0 : instancingCandidates(
      structure,
      (instance) => options.materials.blockOf(instance),
      (material) => options.pipelines.get(material.id)?.key ?? ""
    ), capacity = candidates?.capacity ?? 0;
    this.instancingPossible = candidates !== void 0 && (capacity > 0 || candidates.materials.size > 0), this.instanceMirror = new Float32Array(0), this.instanceMirrorWords = new Uint32Array(0), capacity > 0 && this.allocateInstances(capacity);
  }
  /** Makes the instance buffer hold `records` records (a new buffer, zeroed, with the old one released). */
  allocateInstances(records) {
    let { registry } = this.options, old = this.instanceBuffer;
    this.instanceBuffer = registry.createBuffer({ label: "mtek instance matrices", size: records * INSTANCE_STRIDE, usage: BUFFER_USAGE_VERTEX2 | BUFFER_USAGE_COPY_DST2 }), this.instanceRecords = records, this.instanceMirror = new Float32Array(records * INSTANCE_FLOATS), this.instanceMirrorWords = new Uint32Array(this.instanceMirror.buffer), this.batchedDraws = void 0, old !== void 0 && registry.release(old);
  }
  /** Grows the instance buffer to hold at least `records` records. Called before the frame's commands are encoded. */
  ensureInstances(records) {
    records <= this.instanceRecords || this.allocateInstances(Math.max(records, this.instanceRecords * 2));
  }
  /** Grows the per-entity render state to `slots` entity slots. */
  ensureEntitySlots(slots) {
    if (slots * 3 > this.sphereCentres.length) {
      let capacity = Math.max(slots, this.sphereScales.length * 2), centres = new Float64Array(capacity * 3);
      centres.set(this.sphereCentres);
      let scales = new Float64Array(capacity);
      scales.set(this.sphereScales), this.sphereCentres = centres, this.sphereScales = scales;
    }
    if (slots * INSTANCE_FLOATS > this.entityMatrices.length) {
      let capacity = Math.max(slots, this.entityMatrices.length / INSTANCE_FLOATS * 2), matrices = new Float32Array(capacity * INSTANCE_FLOATS);
      matrices.set(this.entityMatrices), this.entityMatrices = matrices, this.entityWords = new Uint32Array(matrices.buffer);
      let stale = new Uint8Array(capacity).fill(1);
      stale.set(this.objectStale), this.objectStale = stale;
      let records = new Int32Array(capacity).fill(-1);
      records.set(this.recordOf), this.recordOf = records;
    }
  }
  /**
   * A spawned entity exists (decision 0064): it gets an object block when it has a mesh, and the draw list is
   * rebuilt to include it. Its material instance was created in the material store by the caller.
   */
  addEntity(entity) {
    if (this.ensureEntitySlots(entity.index + 1), this.forgetEntity(entity.index), entity.mesh !== null) {
      this.objectSlots[entity.index] = this.objectArena.allocate();
      let centre = this.options.meshes.get(entity.mesh.id).boundingCenter;
      this.localCentres[entity.index] = centre !== void 0 && (centre[0] !== 0 || centre[1] !== 0 || centre[2] !== 0) ? centre : void 0;
    }
    this.drawsVersion = -1;
  }
  /** A spawned entity was removed: its object block is released and the draw list forgets it. */
  removeEntity(entity) {
    let slot = this.objectSlots[entity.index];
    slot !== void 0 && this.objectArena.release(slot), this.objectSlots[entity.index] = void 0, this.localCentres[entity.index] = void 0, this.sphereScales[entity.index] = 0, this.forgetEntity(entity.index), this.drawsVersion = -1;
  }
  /**
   * Makes the render state of an entity slot that is being given up or taken (a spawned entity) differ from any pose a
   * successor can have: the matrices are zero (a model matrix never is, so the first world change of the next entity
   * in the slot is seen as a change), its object block is stale and it holds no instance record.
   */
  forgetEntity(index) {
    this.entityMatrices.fill(0, index * INSTANCE_FLOATS, (index + 1) * INSTANCE_FLOATS), this.objectStale[index] = 1, this.recordOf[index] = -1;
  }
  /** Draw calls encoded by the last rendered frame. */
  get drawCalls() {
    return this.drawCallsLastFrame;
  }
  /** Drawable entities (visible, with a mesh) outside the frustum in the last rendered frame; 0 when no frame was drawn. */
  get culledObjects() {
    return this.culledLastFrame;
  }
  /** Instanced draws (draw calls that draw two or more entities) encoded by the last rendered frame; 0 when no frame was drawn. */
  get instancedDraws() {
    return this.instancedLastFrame;
  }
  /** Instanced draws encoded since the scene started. */
  get instancedDrawsCumulative() {
    return this.instancedTotal;
  }
  /** Draw calls encoded since the scene started. */
  get drawCallsCumulative() {
    return this.drawCallsTotal;
  }
  /** Entity culls since the scene started (an entity culled in ten frames counts ten times). */
  get culledObjectsCumulative() {
    return this.culledTotal;
  }
  /** Turns frustum culling on (the default) or off. Off exists for tests that compare culled and unculled frames. */
  setFrustumCulling(enabled) {
    enabled !== this.cullingEnabled && (this.cullDirty = !0), this.cullingEnabled = enabled;
  }
  /** Number of materials taken out of the draw list by `failMaterial`. */
  get failedMaterialCount() {
    return this.failedMaterials.size;
  }
  /**
   * A material whose shader or pipeline failed after mount (`spec/runtime-abi.md` section 12): reports
   * `diagnostic` and stops drawing every entity that uses it. The rest of the scene keeps running; the
   * entities stay in the world and their params stay writable. Idempotent.
   */
  /**
   * Forgets everything the change tracking has cached, so the next frame recomputes the culling, the batching, the
   * instance records and the object blocks from the world's matrices as a first frame would (the GPU copies are kept
   * and compared, so a recompute that finds the same bytes uploads nothing). For the tests that compare a tracked
   * frame with a full recompute (`render/change-tracking.test.ts`); nothing in the runtime calls it.
   */
  invalidate() {
    this.entityMatrices.fill(0), this.objectStale.fill(1), this.recordOf.fill(-1), this.batchedDraws = void 0, this.cullListed = void 0, this.cullViewProj = void 0, this.cullDirty = !0, this.viewKeyValid = !1;
  }
  /** Releases frame and object arenas (hot reload: discard a retired scene). */
  dispose() {
    this.frameArena.dispose(), this.objectArena.dispose(), this.instanceBuffer !== void 0 && this.options.registry.release(this.instanceBuffer);
  }
  failMaterial(materialId, diagnostic2) {
    this.failedMaterials.has(materialId) || (this.failedMaterials.add(materialId), this.drawsVersion = -1, this.options.report(diagnostic2));
  }
  /** The current draw list (rebuilt when visibility or the set of failed materials changed). */
  drawList() {
    let { world, structure, pipelines, meshes, materials } = this.options;
    if (this.drawsVersion === world.visibilityVersion && this.drawsBlockVersion === materials.blockVersion && this.drawsPopulation === world.dynamic.version)
      return this.draws;
    let items = [], list = (entity, visible, order) => {
      let objectSlot = this.objectSlots[entity.index];
      if (visible !== !0 || entity.mesh === null || entity.instance === null || objectSlot === void 0 || this.failedMaterials.has(entity.instance.material.id)) return;
      let pipeline = pipelines.get(entity.instance.material.id);
      if (pipeline === void 0) throw new Error(`internal error: no pipeline for material '${entity.instance.material.id}'`);
      let gpuMesh = meshes.get(entity.mesh.id);
      items.push({
        pipelineKey: pipeline.key,
        instance: materials.blockOf(entity.instance.index),
        mesh: gpuMesh.order,
        entity: entity.index,
        order,
        pipeline: pipeline.pipeline,
        instancedPipeline: pipeline.instanced,
        attributes: entity.instance.material.shader.vertexAttributes,
        gpuMesh,
        objectSlot
      });
    };
    for (let entity of structure.entities) list(entity, world.entities[entity.index]?.visible, entity.index);
    for (let spawned of world.dynamic.live) list(spawned.resolved, spawned.record.visible, structure.entities.length + spawned.order);
    return this.draws = items.sort(compareDraws), this.drawsVersion = world.visibilityVersion, this.drawsBlockVersion = materials.blockVersion, this.drawsPopulation = world.dynamic.version, this.draws;
  }
  /** Renders one frame (phase 7). Returns false when the target has no pixels (nothing is drawn or uploaded). */
  frame() {
    let { surface, manifest, device, materials } = this.options, clearColor = manifest.scene.fields.clearColor;
    if (!surface.renderable)
      return this.drawCallsLastFrame = 0, this.instancedLastFrame = 0, this.culledLastFrame = 0, surface.render(clearColor);
    let viewProj = this.writeFrameBlock();
    this.applyWorldChanges(), this.frameArena.flush(device.queue), materials.flush(device.queue);
    let listed = this.drawList(), draws = this.cull(listed, viewProj), instanced = this.groupDraws(draws);
    this.writeIndividualObjectBlocks(draws), this.objectArena.flush(device.queue);
    let rendered = surface.render(clearColor, (pass) => {
      this.encode(pass, draws);
    });
    return this.drawCallsLastFrame = rendered ? this.batches.length : 0, this.instancedLastFrame = rendered ? instanced : 0, this.culledLastFrame = rendered ? listed.length - draws.length : 0, this.drawCallsTotal += this.drawCallsLastFrame, this.instancedTotal += this.instancedLastFrame, this.culledTotal += this.culledLastFrame, rendered;
  }
  /**
   * The draws whose world-space bounding sphere is not entirely outside one of the six planes of `viewProj`, in
   * draw-list order. The result is `this.drawn`, updated in place; `this.drawnUnchanged` says whether it holds the
   * same draws as after the previous frame, in which case the loop is skipped altogether when nothing it reads
   * changed: the draw list, the view-projection matrix (the same object while the camera is unchanged), the
   * spheres (only `applyWorldChanges` writes them) and whether culling is on.
   */
  cull(draws, viewProj) {
    if (!this.cullingEnabled)
      return this.drawnUnchanged = !this.cullDirty && this.cullListed === draws, this.cullListed = draws, this.cullViewProj = void 0, this.cullDirty = !1, draws;
    let { planes, drawn, sphereCentres, sphereScales } = this;
    if (!this.cullDirty && this.cullListed === draws && this.cullViewProj === viewProj && this.changedCount === 0)
      return this.drawnUnchanged = !0, drawn;
    extractFrustumPlanes(viewProj, planes);
    let unchanged = !this.cullDirty && this.cullListed === draws, count2 = 0;
    for (let i = 0; i < draws.length; i++) {
      let draw = draws[i], e = draw.entity, radius = draw.gpuMesh.boundingRadius * (sphereScales[e] ?? 0);
      sphereIntersectsFrustum(planes, sphereCentres[e * 3] ?? 0, sphereCentres[e * 3 + 1] ?? 0, sphereCentres[e * 3 + 2] ?? 0, radius) && (drawn[count2] !== draw && (unchanged = !1, drawn[count2] = draw), count2 += 1);
    }
    return drawn.length !== count2 && (unchanged = !1, drawn.length = count2), this.drawnUnchanged = unchanged, this.cullListed = draws, this.cullViewProj = viewProj, this.cullDirty = !1, drawn;
  }
  /**
   * Splits the culled draws into this frame's draw calls (`this.batches`) and, for the instanced ones, brings the
   * instance records up to date with the matrices of their entities (`entityMatrices`), uploading only the words
   * that differ from what the GPU buffer holds. When the culled draw list is the one the batches were made for, only
   * the records of the entities whose world matrix changed this frame are visited; otherwise every record is.
   * Returns the number of instanced draws.
   */
  groupDraws(draws) {
    let possible = this.instancingPossible;
    if (this.batchedDraws === draws && this.drawnUnchanged) {
      if (this.instancedBatches === 0 || this.changedCount === 0) return this.instancedBatches;
      let { instanceBuffer: instanceBuffer2, recordOf, changedEntities } = this;
      if (instanceBuffer2 === void 0) return 0;
      this.instanceLow = Number.MAX_SAFE_INTEGER, this.instanceHigh = -1;
      for (let i = 0; i < this.changedCount; i++) {
        let entity = changedEntities[i], record = recordOf[entity];
        record >= 0 && this.updateRecord(record, entity);
      }
      return this.uploadInstances(instanceBuffer2), this.instancedBatches;
    }
    let instanced = batchDraws(draws, (draw) => possible && draw.instancedPipeline !== void 0, this.batches);
    this.instancedBatches = instanced, this.recordOf.fill(-1);
    let records = 0;
    for (let b = 0; b < this.batches.length; b++) {
      let batch = this.batches[b];
      batch.firstInstance >= 0 && (records = batch.firstInstance + batch.count);
    }
    if (instanced === 0)
      return this.batchedDraws = draws, 0;
    this.ensureInstances(records);
    let { instanceBuffer } = this;
    if (instanceBuffer === void 0) return 0;
    this.instanceLow = Number.MAX_SAFE_INTEGER, this.instanceHigh = -1;
    for (let b = 0; b < this.batches.length; b++) {
      let batch = this.batches[b];
      if (!(batch.firstInstance < 0))
        for (let k = 0; k < batch.count; k++) {
          let entity = draws[batch.start + k].entity;
          this.recordOf[entity] = batch.firstInstance + k, this.updateRecord(batch.firstInstance + k, entity);
        }
    }
    return this.uploadInstances(instanceBuffer), this.batchedDraws = draws, instanced;
  }
  /** Copies the 32 words of `entity`'s matrices into instance record `record` where they differ, widening the changed word range. */
  updateRecord(record, entity) {
    let source = entity * INSTANCE_FLOATS, target = record * INSTANCE_FLOATS, { entityWords, instanceMirrorWords } = this;
    for (let k = 0; k < INSTANCE_FLOATS; k++) {
      let word = entityWords[source + k];
      word !== instanceMirrorWords[target + k] && (instanceMirrorWords[target + k] = word, target + k < this.instanceLow && (this.instanceLow = target + k), target + k > this.instanceHigh && (this.instanceHigh = target + k));
    }
  }
  /** Uploads the words that `updateRecord` changed, from the first to the last of them, in one `writeBuffer`. */
  uploadInstances(buffer) {
    if (this.instanceHigh < this.instanceLow) return;
    let first = this.instanceLow;
    this.options.registry.writeBuffer(this.options.device.queue, buffer, first * 4, this.instanceMirror.buffer, first * 4, (this.instanceHigh + 1 - first) * 4);
  }
  /**
   * `P * V` of the active camera for the target's aspect ratio. The matrix is a function of the camera's position,
   * target or rotation, its projection and the aspect ratio; when those numbers equal the previous frame's the
   * previous matrix (the same object) is returned.
   */
  viewProjection(aspect) {
    let { camera } = this.options.world, key = this.nextViewKey, projection = camera.projection, { position, target, rotation: rotation2 } = camera;
    if (key[0] = aspect, key[1] = projection.kind === "perspective" ? 0 : 1, key[2] = projection.kind === "perspective" ? projection.fov_y : projection.height, key[3] = projection.near, key[4] = projection.far, key[5] = position.x, key[6] = position.y, key[7] = position.z, target !== null ? (key[8] = 1, key[9] = target.x, key[10] = target.y, key[11] = target.z, key[12] = 0) : (key[8] = 0, key[9] = rotation2.x, key[10] = rotation2.y, key[11] = rotation2.z, key[12] = rotation2.w), this.viewKeyValid) {
      let same = !0;
      for (let i = 0; i < VIEW_KEY_LENGTH; i++)
        if (key[i] !== this.viewKey[i]) {
          same = !1;
          break;
        }
      if (same) return this.lastViewProj;
    }
    this.viewKeyValid = !1;
    try {
      this.lastView = viewMatrix(position, target !== null ? { target } : { rotation: rotation2 }), this.viewKeyValid = !0;
    } catch (error) {
      this.reportCamera(error instanceof Error ? error.message : String(error));
    }
    let p = projection.kind === "perspective" ? perspective(projection.fov_y, aspect, projection.near, projection.far) : orthographic(projection.height, aspect, projection.near, projection.far);
    return this.lastViewProj = multiply(p, this.lastView), this.viewKeyValid && this.viewKey.set(key), this.lastViewProj;
  }
  reportCamera(message) {
    let { manifest, structure, report } = this.options, span = spanOfSymbol(manifest, structure.camera.symbol);
    report(
      makeRuntimeDiagnostic("E8011", {
        phase: "runtime:render",
        message: `Invalid value for camera '${structure.camera.name}': ${message}; the previous view is kept.`,
        source: span === void 0 ? null : resolveSpan(manifest, span)
      })
    );
  }
  /** Writes `MtekFrame` and returns the `view_proj` it holds. */
  writeFrameBlock() {
    let { width, height } = this.options.surface.size, viewProj = this.viewProjection(width / height), position = this.options.world.camera.position, lightCount = packLights(this.options.structure.lights, this.lightSource, this.packedLights);
    return this.frameArena.writeIfChanged(this.frameSlot, (memory, base) => {
      this.writeViewProj(memory, base, viewProj), this.writeCameraPosition(memory, base, position), this.writeLightCount(memory, base, lightCount), this.writeAmbient(memory, base, this.ambient), this.writeExposure(memory, base, this.exposure), this.writeLights(memory, base, this.packedLights);
    }), viewProj;
  }
  /**
   * Brings the per-entity render state up to date with the world: for every entity whose world matrix was recomputed
   * since the last frame (and that has an object block) whose model matrix differs from the one held here, the bounding
   * sphere and the model and normal matrices (`entityMatrices`) are refreshed and the entity's object block is marked
   * stale. The block itself is written only when a draw reads it (`writeIndividualObjectBlocks`). Entities whose
   * world matrix was recomputed to the same bytes cost one comparison.
   */
  applyWorldChanges() {
    let { world } = this.options, changed = world.takeWorldChanges();
    this.changedEntities.length < changed.length && (this.changedEntities = new Int32Array(Math.max(changed.length, this.changedEntities.length * 2)));
    let { objectSlots, entityMatrices, objectStale, changedEntities } = this, count2 = 0;
    for (let c = 0; c < changed.length; c++) {
      let index = changed[c];
      if (objectSlots[index] === void 0) continue;
      let model = world.worldMatrix(index), base = index * INSTANCE_FLOATS, same = !0;
      for (let k = 0; k < 16; k++)
        if (!Object.is(entityMatrices[base + k], model[k])) {
          same = !1;
          break;
        }
      if (!same) {
        worldBoundingSphere(model, 1, this.sphere, this.localCentres[index]), this.sphereCentres[index * 3] = this.sphere.x, this.sphereCentres[index * 3 + 1] = this.sphere.y, this.sphereCentres[index * 3 + 2] = this.sphere.z, this.sphereScales[index] = this.sphere.radius, normalMatrixInto(entityMatrices, base + 16, model);
        for (let k = 0; k < 16; k++) entityMatrices[base + k] = model[k];
        objectStale[index] = 1, changedEntities[count2] = index, count2 += 1;
      }
    }
    this.changedCount = count2;
  }
  /** Writes the object block of every individually drawn entity whose block is stale (`applyWorldChanges`). */
  writeIndividualObjectBlocks(draws) {
    let { batches, objectStale } = this;
    for (let b = 0; b < batches.length; b++) {
      let batch = batches[b];
      if (batch.firstInstance >= 0) continue;
      let draw = draws[batch.start];
      objectStale[draw.entity] === 1 && this.writeObjectBlock(draw.entity, draw.objectSlot);
    }
  }
  /** `MtekObject` (model, normal matrix) of `entity` into its slot, through the `builtin:object` writers. */
  writeObjectBlock(entity, slot) {
    let { entityMatrices, modelScratch, normalScratch } = this, base = entity * INSTANCE_FLOATS;
    for (let k = 0; k < 16; k++)
      modelScratch[k] = entityMatrices[base + k], normalScratch[k] = entityMatrices[base + 16 + k];
    this.objectArena.writeIfChanged(slot, (memory, offset) => {
      this.writeModel(memory, offset, modelScratch), this.writeNormalMatrix(memory, offset, normalScratch);
    }), this.objectStale[entity] = 0;
  }
  encode(pass, draws) {
    if (draws.length === 0) return;
    let { plan, materials } = this.options;
    pass.setBindGroup(0, this.frameArena.bindGroupForSlot(this.frameSlot, plan.frame));
    let objectGroup = this.objectArena.bindGroupDynamic(plan.object), dynamicOffset = this.dynamicOffset, objectBound = !1, pipeline, instance = -1, mesh;
    for (let batch of this.batches) {
      let draw = draws[batch.start];
      if (draw === void 0) continue;
      let instanced = batch.firstInstance >= 0, wanted = instanced ? draw.instancedPipeline : draw.pipeline;
      if (wanted === void 0) throw new Error("internal error: an instanced draw without an instanced pipeline");
      if (wanted !== pipeline && (pass.setPipeline(wanted), pipeline = wanted, mesh = void 0, instanced && this.instanceBuffer !== void 0 && pass.setVertexBuffer(draw.attributes.length, this.instanceBuffer)), draw.instance !== instance && (pass.setBindGroup(1, materials.bindGroup(draw.instance)), instance = draw.instance), draw.gpuMesh !== mesh) {
        for (let slot = 0; slot < draw.attributes.length; slot++)
          pass.setVertexBuffer(slot, vertexBufferOf(draw.gpuMesh, draw.attributes[slot]));
        pass.setIndexBuffer(draw.gpuMesh.indexBuffer, draw.gpuMesh.indexFormat), mesh = draw.gpuMesh;
      }
      instanced ? (objectBound || (dynamicOffset[0] = 0, pass.setBindGroup(2, objectGroup, dynamicOffset), objectBound = !0), pass.drawIndexed(draw.gpuMesh.indexCount, batch.count, 0, 0, batch.firstInstance)) : (dynamicOffset[0] = this.objectArena.slotOffset(draw.objectSlot), pass.setBindGroup(2, objectGroup, dynamicOffset), objectBound = !0, pass.drawIndexed(draw.gpuMesh.indexCount));
    }
  }
};
function exposureScale(ev100) {
  return 1 / (1.2 * 2 ** ev100);
}

// src/render/startup.ts
function missingModule(material, phase) {
  return {
    ok: !1,
    diagnostic: makeRuntimeDiagnostic("E8051", {
      phase: phase ?? "runtime:mount",
      message: `The shader of material '${material.id}' could not be loaded after the GPU device was recreated.`
    })
  };
}
async function startScene(options) {
  let { manifest, structure, program, device, registry, surface, modules, report, services } = options;
  options.assertActive?.();
  let generation = registry.generation, plan = options.bindingPlan ?? new BindingPlan(registry, structure.frameLayout, structure.objectLayout), materials = new MaterialStore(device, registry, plan, structure, program.writers, options.textures, options.assets?.images), meshes, renderer, committed = !1;
  try {
    let { recover } = options, world, bindings;
    if (recover === void 0) {
      let fresh = new World({
        manifest,
        structure,
        params: materials,
        report,
        prefabs: buildPrefabRuntimes(structure.prefabs, program.prefabs),
        ...services === void 0 ? {} : { services }
      }), freshBindings = new Bindings(manifest, program.scene.bindings, fresh);
      fresh.initialise(program.scene.init, () => {
        freshBindings.evaluate();
      }), world = fresh, bindings = freshBindings;
    } else
      ({ world, bindings } = recover), world.rebindParams(materials);
    options.assertActive?.(), materials.shareIdentical(), meshes = new MeshStore(registry, device.queue, void 0, device.limits.maxBufferSize), meshes.upload(structure.meshes, options.assets?.files);
    let pipelines = options.pipelineCache ?? new PipelineCache(device, registry, plan, manifest), phase = recover === void 0 ? void 0 : "runtime:device", instanced = options.instancing === !1 ? /* @__PURE__ */ new Set() : instancingCandidates(
      structure,
      (instance) => materials.blockOf(instance),
      (material) => materialPipelineKey(material, surface.colorFormat)
    ).materials, results = await Promise.all(
      structure.materials.map(async (material) => {
        let module = modules.get(material.shader.hash);
        if (module === void 0) {
          if (recover !== void 0) return missingModule(material, phase);
          throw new Error(`internal error: no shader module for '${material.id}'`);
        }
        let request = { material, module, colorFormat: surface.colorFormat, ...phase === void 0 ? {} : { phase } }, [plain, variant] = await Promise.all([pipelines.obtain(request), instanced.has(material.id) ? pipelines.obtain({ ...request, instanced: !0 }) : void 0]);
        return !plain.ok || variant === void 0 ? plain : variant.ok ? { ...plain, instancedPipeline: variant.pipeline } : variant;
      })
    ), diagnostics = [];
    options.assertActive?.();
    let failed = [], byMaterial = /* @__PURE__ */ new Map();
    if (results.forEach((result, index) => {
      let material = structure.materials[index];
      material !== void 0 && (result.ok ? byMaterial.set(material.id, { key: result.key, pipeline: result.pipeline, ...result.instancedPipeline === void 0 ? {} : { instanced: result.instancedPipeline } }) : recover === void 0 ? diagnostics.push(result.diagnostic) : failed.push({ id: material.id, diagnostic: result.diagnostic }));
    }), diagnostics.length > 0)
      return { ok: !1, diagnostics };
    world.phase = "runtime:update", renderer = new Renderer({
      device,
      registry,
      surface,
      manifest,
      structure,
      world,
      writers: program.writers,
      plan,
      materials,
      meshes,
      pipelines: byMaterial,
      report,
      ...options.instancing === void 0 ? {} : { instancing: options.instancing }
    });
    for (let { id, diagnostic: diagnostic2 } of failed) renderer.failMaterial(id, diagnostic2);
    return recover === void 0 ? world.dynamic.attach(renderer, materials) : world.dynamic.rebuild(renderer, materials), committed = !0, { ok: !0, scene: { world, bindings, materials, meshes, plan, pipelines, renderer } };
  } finally {
    !committed && registry.generation === generation && (renderer?.dispose(), meshes?.dispose(), materials.dispose());
  }
}

// src/scene/behavior.ts
function pointerEvent(x, y, button) {
  return Object.freeze({ position: Object.freeze({ x, y }), button });
}
var Behaviors = class {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    for (let event of INPUT_EVENTS) {
      let declared = scene.events[event];
      declared !== void 0 && declared.length > 0 && this.handlers.set(event, [...declared].sort((a, b) => a.owner - b.owner));
    }
    for (let event of COLLISION_EVENTS) {
      let byOwner = /* @__PURE__ */ new Map();
      for (let handler of scene.events[event] ?? []) {
        let list = byOwner.get(handler.owner);
        list === void 0 ? byOwner.set(handler.owner, [handler]) : list.push(handler);
      }
      byOwner.size > 0 && this.collisionHandlers.set(event, byOwner);
    }
  }
  scene;
  world;
  handlers = /* @__PURE__ */ new Map();
  /** The collision handlers of the named entities: by event, then by static index, each list in declaration order. */
  collisionHandlers = /* @__PURE__ */ new Map();
  /**
   * Delivers a collision event to the entity in `slot` (`spec/physics.md` section 6): its `collision_enter` or
   * `collision_exit` handlers in declaration order, each called with the other entity's reference. A named entity
   * (a slot below the number of static entities) uses the scene's handler table, a spawned one its prefab's; an
   * entity that declares none is a no-op. The physics subsystem decides the order of calls and whether the entity
   * may still receive one (it is not pending removal).
   */
  collision(kind, slot, other) {
    if (slot < this.world.entities.length) {
      let record = this.entity(slot);
      for (let handler of this.collisionHandlers.get(kind)?.get(slot) ?? []) handler.fn(this.world.ctx, record, other);
      return;
    }
    let entity = this.world.dynamic.entityAt(slot);
    if (entity !== void 0)
      for (let handler of entity.prefab.handlers.get(kind) ?? []) handler.fn(this.world.ctx, entity.record, other);
  }
  /** The DOM codes that some `key_down` or `key_up` handler names, of the scene, its entities or a spawned prefab. */
  handledKeys() {
    let codes = /* @__PURE__ */ new Set();
    for (let event of ["key_down", "key_up"]) {
      for (let handler of this.handlers.get(event) ?? []) handler.key !== void 0 && codes.add(handler.key);
      for (let prefab of this.world.dynamic.prefabRuntimes())
        for (let handler of prefab.handlers.get(event) ?? []) handler.key !== void 0 && codes.add(handler.key);
    }
    return codes;
  }
  /** Phase 1: delivers `transitions` in the order given; for each, the scene's handlers, the entities', the spawned ones'. */
  dispatchInput(transitions) {
    for (let transition of transitions) {
      let list = this.handlers.get(transition.kind), argument = "code" in transition ? void 0 : pointerEvent(transition.x, transition.y, transition.button);
      if (list !== void 0)
        for (let handler of list)
          "code" in transition && handler.key !== transition.code || handler.fn(this.world.ctx, this.owner(handler.owner), argument);
      for (let entity of this.world.dynamic.live)
        if (!entity.removing)
          for (let handler of entity.prefab.handlers.get(transition.kind) ?? [])
            "code" in transition && handler.key !== transition.code || handler.fn(this.world.ctx, entity.record, argument);
    }
  }
  /** Phase 2 (c): `fixed_update`, the scene's then the entities', then the spawned entities'. */
  fixedUpdate(step2) {
    this.run(this.scene.fixedUpdate, this.scene.entityFixedUpdate, step2, !1);
  }
  /** Phase 3: `update(dt)`, the scene's then the entities', then the spawned entities'. */
  update(delta) {
    this.run(this.scene.update, this.scene.entityUpdate, delta, !0);
  }
  run(sceneFunction, entityFunctions, dt, update) {
    let value = Math.fround(dt);
    sceneFunction !== null && sceneFunction(this.world.ctx, value);
    for (let index = 0; index < entityFunctions.length; index += 1) {
      let fn = entityFunctions[index];
      fn?.(this.world.ctx, this.entity(index), value);
    }
    for (let entity of this.world.dynamic.live) {
      if (entity.removing) continue;
      let fn = update ? entity.prefab.program.update : entity.prefab.program.fixedUpdate;
      fn !== null && fn(this.world.ctx, entity.record, value);
    }
  }
  owner(index) {
    return index < 0 ? null : this.entity(index);
  }
  entity(index) {
    let record = this.world.entities[index];
    if (record === void 0) throw new RuntimeInternalError(`a handler names entity ${String(index)}, which the scene does not have.`);
    return record;
  }
};

// src/scene/budget.ts
var ExecutionBudgetExceeded = class extends Error {
  /** The manifest span of the loop that spent the last iteration. */
  spanId;
  constructor(spanId) {
    super("execution budget exceeded"), this.name = "ExecutionBudgetExceeded", this.spanId = spanId;
  }
};
function budgetExceeded(spanId) {
  throw new ExecutionBudgetExceeded(spanId);
}

// src/schedule/scheduler.ts
var Scheduler = class {
  /**
   * @param onFrameError Called when a frame throws inside the animation-frame loop (the owner reports
   *   it and usually calls {@link stop}). Without it the error propagates to the caller. Frames run by
   *   {@link stepManual} always propagate their errors.
   */
  constructor(config, phases, source, onFrameError) {
    this.config = config;
    this.phases = phases;
    this.source = source;
    this.onFrameError = onFrameError;
  }
  config;
  phases;
  source;
  onFrameError;
  currentState = "running";
  handle = null;
  lastMs = null;
  accumulator = 0;
  time = 0;
  frames = 0;
  discarded = 0;
  lastDelta = 0;
  get state() {
    return this.currentState;
  }
  /** Active application time in seconds since mount, excluding paused time (f64). */
  get activeTime() {
    return this.time;
  }
  /** Number of frames completed since mount. */
  get frameIndex() {
    return this.frames;
  }
  /** The clamped delta of the most recent frame. */
  get delta() {
    return this.lastDelta;
  }
  /** Fixed steps dropped because the accumulator exceeded `maxCatchUpSteps`. */
  get discardedSteps() {
    return this.discarded;
  }
  /** True when a frame request is outstanding (always false with the manual clock). */
  get hasPendingFrame() {
    return this.handle !== null;
  }
  /** Starts the frame loop (a no-op with the manual clock). */
  start() {
    this.requestNext();
  }
  /** Stops accumulating time. The first frame after {@link resume} has delta 0. */
  pause() {
    this.currentState === "running" && (this.currentState = "paused", this.cancelRequest());
  }
  /** Resumes after {@link pause}; the paused interval is never simulated. */
  resume() {
    this.currentState === "paused" && (this.currentState = "running", this.lastMs = null, this.requestNext());
  }
  /** Stops for good (dispose, failure). Idempotent. */
  stop() {
    this.currentState = "stopped", this.cancelRequest();
  }
  /**
   * Manual clock: runs `frames` frames synchronously, each with delta `dtSeconds` (clamped to
   * `maxFrameDelta` like any other delta). Does nothing unless the scheduler is running.
   */
  stepManual(frames, dtSeconds) {
    if (this.source !== null) throw new Error("Scheduler.stepManual requires the manual clock");
    if (!Number.isInteger(frames) || frames < 0)
      throw new RangeError(`step: frames must be a non-negative integer, got ${String(frames)}`);
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0)
      throw new RangeError(`step: dtSeconds must be finite and >= 0, got ${String(dtSeconds)}`);
    for (let i = 0; i < frames && this.currentState === "running"; i += 1)
      this.runFrame(Math.min(dtSeconds, this.config.maxFrameDelta));
  }
  /** `onAnimationFrame` of section 7. Public so tests can drive it with exact timestamps. */
  onAnimationFrame(nowMs) {
    if (this.handle = null, this.currentState !== "running") return;
    let rawDelta = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1e3;
    this.lastMs = nowMs;
    try {
      this.runFrame(Math.min(Math.max(rawDelta, 0), this.config.maxFrameDelta));
    } catch (error) {
      if (this.onFrameError === void 0) throw error;
      this.onFrameError(error);
    } finally {
      this.requestNext();
    }
  }
  runFrame(delta) {
    let { fixedStep, maxCatchUpSteps } = this.config;
    this.lastDelta = delta, this.time += delta, this.phases.phase1_input(), this.accumulator += delta;
    let steps = 0;
    for (; this.accumulator >= fixedStep && steps < maxCatchUpSteps; )
      this.phases.phase2_tick(fixedStep), this.accumulator -= fixedStep, steps += 1;
    this.accumulator >= fixedStep && (this.discarded += Math.floor(this.accumulator / fixedStep), this.accumulator %= fixedStep), this.phases.phase3_update(delta), this.phases.phase4_flush(), this.phases.phase5_bindings(), this.phases.phase6_transforms(), this.currentState !== "stopped" && this.phases.phase7_render(), this.frames += 1;
  }
  requestNext() {
    this.source === null || this.currentState !== "running" || this.handle !== null || (this.handle = this.source.request((nowMs) => {
      this.onAnimationFrame(nowMs);
    }));
  }
  cancelRequest() {
    this.source !== null && this.handle !== null && this.source.cancel(this.handle), this.handle = null;
  }
};

// src/scene/program.ts
function isRecord2(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value);
}
function own(record, key) {
  return Object.hasOwn(record, key) ? record[key] : void 0;
}
function incompatible(field, message) {
  return makeRuntimeDiagnostic("E8003", {
    phase: "runtime:mount",
    message: `Incompatible program: ${message}`,
    notes: [`field: ${field}`, "help: app.js and program.manifest.json must come from the same build"]
  });
}
function checkWriters(layout, entry, diagnostics) {
  let field = `writers["${layout.id}"]`;
  if (!isRecord2(entry)) {
    diagnostics.push(incompatible(field, `the program module has no writers for the layout '${layout.id}'.`));
    return;
  }
  let all = own(entry, "all"), fields = own(entry, "fields");
  if (typeof all != "function" || !isRecord2(fields)) {
    diagnostics.push(incompatible(field, `the writers of the layout '${layout.id}' lack the \`all\` function or the \`fields\` table.`));
    return;
  }
  let byName = /* @__PURE__ */ new Map();
  for (let member of layout.root.members) {
    let writer = own(fields, member.name);
    if (typeof writer != "function") {
      diagnostics.push(incompatible(`${field}.fields.${member.name}`, `the layout '${layout.id}' has the member '${member.name}' but the program module has no writer for it.`));
      return;
    }
    byName.set(member.name, writer);
  }
  return { all: all, fields: byName };
}
var EVENT_NAMES = ["key_down", "key_up", "pointer_down", "pointer_up", "pointer_move", "collision_enter", "collision_exit"];
function functionOrNull(value) {
  return value === null || typeof value == "function";
}
function sceneShapeProblem(scene, entityCount, bindingCount) {
  for (let name of ["update", "fixedUpdate"])
    if (!functionOrNull(own(scene, name))) return { field: name, problem: `has a \`${name}\` that is neither a function nor null` };
  for (let name of ["entityUpdate", "entityFixedUpdate"]) {
    let list = own(scene, name);
    if (!Array.isArray(list) || list.length !== entityCount || !list.every(functionOrNull))
      return { field: name, problem: `needs \`${name}\` to be an array of ${String(entityCount)} functions or nulls (one per static entity)` };
  }
  let bindings = own(scene, "bindings");
  if (!Array.isArray(bindings) || bindings.length !== bindingCount || !bindings.every((fn) => typeof fn == "function"))
    return { field: "bindings", problem: `needs 'bindings' to be an array of ${String(bindingCount)} functions (one per binding of the manifest)` };
  let events = own(scene, "events");
  if (!isRecord2(events)) return { field: "events", problem: "has no `events` table" };
  for (let name of EVENT_NAMES) {
    let list = own(events, name);
    if (list === void 0) continue;
    let keyed = name === "key_down" || name === "key_up";
    if (!(Array.isArray(list) && list.every((handler) => {
      if (!isRecord2(handler)) return !1;
      let key = own(handler, "key"), owner = own(handler, "owner");
      return typeof own(handler, "fn") == "function" && typeof owner == "number" && Number.isInteger(owner) && owner >= -1 && owner < entityCount && (keyed ? typeof key == "string" : key === void 0);
    }))) return { field: `events.${name}`, problem: `has a malformed \`${name}\` handler list` };
  }
}
function prefabShapeProblem(entry, bindingCount) {
  if (typeof own(entry, "init") != "function") return { field: "init", problem: "has no `init` function" };
  for (let name of ["update", "fixedUpdate"])
    if (!functionOrNull(own(entry, name))) return { field: name, problem: `has a \`${name}\` that is neither a function nor null` };
  let bindings = own(entry, "bindings");
  if (!Array.isArray(bindings) || bindings.length !== bindingCount || !bindings.every((fn) => typeof fn == "function"))
    return { field: "bindings", problem: `needs 'bindings' to be an array of ${String(bindingCount)} functions (one per binding of the manifest's prefab)` };
  let events = own(entry, "events");
  if (!isRecord2(events)) return { field: "events", problem: "has no `events` table" };
  for (let name of EVENT_NAMES) {
    let list = own(events, name);
    if (list === void 0) continue;
    let keyed = name === "key_down" || name === "key_up";
    if (!(Array.isArray(list) && list.every((handler) => {
      if (!isRecord2(handler)) return !1;
      let key = own(handler, "key");
      return typeof own(handler, "fn") == "function" && own(handler, "owner") === "self" && (keyed ? typeof key == "string" : key === void 0);
    }))) return { field: `events.${name}`, problem: `has a malformed \`${name}\` handler list (every owner must be "self")` };
  }
}
function checkProgram(program, manifest) {
  let diagnostics = [], entry = manifest.entryScene, scene, scenes = program.scenes, candidate = isRecord2(scenes) ? own(scenes, entry) : void 0;
  if (!isRecord2(candidate) || typeof own(candidate, "init") != "function")
    diagnostics.push(incompatible(`scenes.${entry}`, `the program module has no scene '${entry}' with an \`init\` function.`));
  else {
    let shape = sceneShapeProblem(candidate, manifest.scene.entities.length, manifest.scene.bindings.length);
    shape === void 0 ? scene = candidate : diagnostics.push(incompatible(`scenes.${entry}.${shape.field}`, `the scene '${entry}' ${shape.problem}.`));
  }
  let prefabs = /* @__PURE__ */ new Map(), listed = manifest.prefabs ?? [];
  listed.length > 0 && !isRecord2(program.prefabs) && diagnostics.push(incompatible("prefabs", "the program module has no `prefabs` table, but the manifest lists prefabs."));
  for (let prefab of listed) {
    let entry2 = isRecord2(program.prefabs) ? own(program.prefabs, prefab.symbol) : void 0, field = `prefabs["${prefab.symbol}"]`;
    if (!isRecord2(entry2)) {
      isRecord2(program.prefabs) && diagnostics.push(incompatible(field, `the program module has no prefab '${prefab.symbol}'.`));
      continue;
    }
    let shape = prefabShapeProblem(entry2, prefab.bindings.length);
    shape === void 0 ? prefabs.set(prefab.symbol, entry2) : diagnostics.push(incompatible(`${field}.${shape.field}`, `the prefab '${prefab.symbol}' ${shape.problem}.`));
  }
  let writers = /* @__PURE__ */ new Map(), table = isRecord2(program.writers) ? program.writers : void 0;
  if (table === void 0)
    diagnostics.push(incompatible("writers", "the program module has no `writers` table."));
  else
    for (let layout of manifest.layouts) {
      let checked = checkWriters(layout, own(table, layout.id), diagnostics);
      checked !== void 0 && writers.set(layout.id, checked);
    }
  return diagnostics.length > 0 || scene === void 0 ? { ok: !1, diagnostics } : { ok: !0, program: { scene, prefabs, writers } };
}

// src/scene/structure.ts
var FRAME_LAYOUT_ID = "builtin:frame", OBJECT_LAYOUT_ID = "builtin:object", FRAME_MEMBERS = ["view_proj", "camera_position", "light_count", "ambient", "lights"], OBJECT_MEMBERS = ["model", "normal_matrix"], VERTEX_ATTRIBUTE_ORDER = ["position", "normal", "uv"];
function broken(field, message) {
  return makeRuntimeDiagnostic("E8006", { phase: "runtime:mount", message: `Invalid manifest: ${message}`, notes: [`field: ${field}`] });
}
function inSlotOrder(attributes) {
  let next = 0;
  for (let attribute of attributes) {
    let at3 = VERTEX_ATTRIBUTE_ORDER.indexOf(attribute, next);
    if (at3 < 0) return !1;
    next = at3 + 1;
  }
  return attributes[0] === "position";
}
function resolveStructure(manifest) {
  let diagnostics = [], outputNames = /* @__PURE__ */ new Set();
  for (let [index, output] of (manifest.scene.hostOutputs ?? []).entries()) {
    let field = `scene.hostOutputs[${String(index)}]`;
    outputNames.has(output.name) && diagnostics.push(broken(`${field}.name`, `host output '${output.name}' is listed twice.`)), outputNames.add(output.name);
    let state = manifest.scene.state.find((entry) => entry.name === output.source.name);
    (state === void 0 || state.type !== output.type) && diagnostics.push(broken(`${field}.source`, `host output '${output.name}' must name scene state of type '${output.type}'.`));
  }
  let { scene } = manifest;
  manifest.entryScene !== scene.name && diagnostics.push(broken("entryScene", `the entry scene '${manifest.entryScene}' is not the manifest's scene '${scene.name}'.`));
  let layouts = new Map(manifest.layouts.map((layout) => [layout.id, layout])), frameLayout = layouts.get(FRAME_LAYOUT_ID), objectLayout = layouts.get(OBJECT_LAYOUT_ID);
  frameLayout === void 0 && diagnostics.push(broken("layouts", `the built-in layout '${FRAME_LAYOUT_ID}' is missing.`)), objectLayout === void 0 && diagnostics.push(broken("layouts", `the built-in layout '${OBJECT_LAYOUT_ID}' is missing.`));
  for (let [layout, members] of [
    [frameLayout, FRAME_MEMBERS],
    [objectLayout, OBJECT_MEMBERS]
  ])
    if (layout !== void 0)
      for (let member of members)
        layout.root.members.some((candidate) => candidate.name === member) || diagnostics.push(broken("layouts", `the built-in layout '${layout.id}' lacks the member '${member}'.`));
  let active = scene.cameras.filter((camera2) => camera2.active), camera = active[0];
  (active.length !== 1 || camera === void 0) && diagnostics.push(broken("scene.cameras", `a scene needs exactly one active camera, found ${String(active.length)}.`));
  let shaders = new Map(manifest.shaders.map((shader) => [shader.hash, shader])), materials = [];
  manifest.materials.forEach((material, index) => {
    let field = `materials[${String(index)}]`, shader = shaders.get(material.shader);
    if (shader === void 0) {
      diagnostics.push(broken(`${field}.shader`, `material '${material.id}' names the shader ${material.shader}, which the shaders table lacks.`));
      return;
    }
    if (!inSlotOrder(shader.vertexAttributes)) {
      diagnostics.push(
        broken("shaders.vertexAttributes", `the shader of '${material.id}' lists vertex attributes [${shader.vertexAttributes.join(", ")}], not position[, normal][, uv].`)
      );
      return;
    }
    let layout = null;
    if (material.layout !== null) {
      let found = layouts.get(material.layout);
      if (found === void 0) {
        diagnostics.push(broken(`${field}.layout`, `material '${material.id}' names the layout '${material.layout}', which the layouts table lacks.`));
        return;
      }
      layout = found;
      let missing = material.params.find(
        (param) => !material.resources.some((resource) => resource.name === param.name) && !found.root.members.some((member) => member.name === param.name)
      );
      if (missing !== void 0) {
        diagnostics.push(broken(`${field}.params`, `material '${material.id}' has the param '${missing.name}', which its layout '${found.id}' lacks.`));
        return;
      }
    }
    let badResource = material.resources.find(
      (resource, position) => resource.binding !== position + 1 || material.params.find((param) => param.name === resource.name)?.type !== resource.kind
    );
    if (badResource !== void 0) {
      diagnostics.push(
        broken(
          `${field}.resources`,
          `material '${material.id}' lists the ${badResource.kind} '${badResource.name}' at binding ${String(badResource.binding)}, which is not a ${badResource.kind} param bound in declaration order from binding 1.`
        )
      );
      return;
    }
    materials.push({ id: material.id, index, layout, shader, params: material.params, resources: material.resources });
  });
  let materialById = new Map(materials.map((material) => [material.id, material])), assetsByUrl = new Map(manifest.assets.map((asset) => [asset.url, asset]));
  function resolveResources(field, owner, material, params) {
    let resources = [];
    for (let resource of material.resources) {
      let param = params.find((candidate) => candidate.name === resource.name);
      if (param?.class !== "resource") {
        diagnostics.push(broken(field, `${owner} gives the ${resource.kind} param '${resource.name}' no resource value.`));
        return;
      }
      if (param.value.kind === "asset") {
        let image = assetsByUrl.get(param.value.asset);
        if (resource.kind !== "texture" || image?.kind !== "image") {
          diagnostics.push(
            broken(field, `the ${resource.kind} param '${resource.name}' of ${owner} names '${param.value.asset}', which is not an image of the assets table.`)
          );
          return;
        }
        resources.push({ name: resource.name, kind: "texture", binding: resource.binding, value: image.url, asset: image });
        continue;
      }
      if (!param.value.name.startsWith(`${resource.kind}.`)) {
        diagnostics.push(broken(field, `the ${resource.kind} param '${resource.name}' of ${owner} holds '${param.value.name}'.`));
        return;
      }
      resources.push({ name: resource.name, kind: resource.kind, binding: resource.binding, value: param.value.name });
    }
    return resources;
  }
  let meshes = [];
  manifest.meshes.forEach((mesh, index) => {
    if (mesh.kind === "asset") {
      let field = `meshes[${String(index)}]`, file = assetsByUrl.get(mesh.asset);
      if (file?.kind !== "mesh-data") {
        diagnostics.push(broken(`${field}.asset`, `mesh '${mesh.id}' names '${mesh.asset}', which the assets table lacks or which is not mesh data.`));
        return;
      }
      let layout = file.primitives[mesh.primitive];
      if (layout === void 0) {
        diagnostics.push(broken(`${field}.primitive`, `mesh '${mesh.id}' names primitive ${String(mesh.primitive)} of '${mesh.asset}', which has ${String(file.primitives.length)}.`));
        return;
      }
      let problem = regionProblem(layout, file.bytes);
      if (problem !== void 0) {
        diagnostics.push(broken(`${field}`, `mesh '${mesh.id}' (primitive ${String(mesh.primitive)} of '${mesh.asset}') cannot be read: ${problem}.`));
        return;
      }
      meshes.push({ id: mesh.id, descriptor: { kind: "asset", asset: mesh.asset, primitive: mesh.primitive, layout } });
      return;
    }
    meshes.push({ id: mesh.id, descriptor: mesh });
  });
  let meshById = new Map(meshes.map((mesh) => [mesh.id, mesh])), instances = [];
  scene.materialInstances.forEach((instance, index) => {
    let field = `scene.materialInstances[${String(index)}]`;
    if (instance.index !== index) {
      diagnostics.push(broken(`${field}.index`, `material instance ${String(index)} carries index ${String(instance.index)}.`));
      return;
    }
    let material = materialById.get(instance.material);
    if (material === void 0) {
      manifest.materials.some((candidate) => candidate.id === instance.material) || diagnostics.push(broken(`${field}.material`, `material instance ${String(index)} names the unknown material '${instance.material}'.`));
      return;
    }
    let resources = resolveResources(`${field}.params`, `material instance ${String(index)}`, material, instance.params);
    resources !== void 0 && (instances[index] = { index, material, entity: instance.entity, shareable: instance.shareable, resources });
  });
  let entities = [];
  scene.entities.forEach((entity, index) => {
    let field = `scene.entities[${String(index)}]`;
    if (entity.index !== index) {
      diagnostics.push(broken(`${field}.index`, `entity ${String(index)} ('${entity.name}') carries index ${String(entity.index)}.`));
      return;
    }
    if (entity.parent !== null && entity.parent >= index) {
      diagnostics.push(
        broken(`${field}.parent`, `entity '${entity.name}' has parent ${String(entity.parent)}; parents precede their children (depth-first pre-order).`)
      );
      return;
    }
    let mesh = null;
    if (entity.mesh !== null) {
      let found = meshById.get(entity.mesh);
      if (found === void 0) {
        manifest.meshes.some((candidate) => candidate.id === entity.mesh) || diagnostics.push(broken(`${field}.mesh`, `entity '${entity.name}' names the unknown mesh '${entity.mesh}'.`));
        return;
      }
      mesh = found;
    }
    let instance = null;
    if (entity.material !== null) {
      let found = instances[entity.material.instance];
      if (found === void 0 && scene.materialInstances[entity.material.instance] !== void 0) return;
      if (found?.index !== entity.material.instance || found.entity !== index || found.material.id !== entity.material.id) {
        diagnostics.push(
          broken(
            `${field}.material`,
            `entity '${entity.name}' names material instance ${String(entity.material.instance)} of '${entity.material.id}', which does not belong to it.`
          )
        );
        return;
      }
      instance = found;
    }
    if (mesh === null != (instance === null)) {
      diagnostics.push(broken(field, `entity '${entity.name}' has a mesh without a material or a material without a mesh.`));
      return;
    }
    let source = mesh?.descriptor;
    if (source?.kind === "asset" && instance !== null) {
      let missing = instance.material.shader.vertexAttributes.find((attribute) => !source.layout.attributes.includes(attribute));
      if (missing !== void 0) {
        diagnostics.push(
          broken(
            field,
            `entity '${entity.name}' draws the mesh '${mesh?.id ?? ""}' with material '${instance.material.id}', which reads '${missing}'; primitive ${String(source.primitive)} of '${source.asset}' has [${source.layout.attributes.join(", ")}].`
          )
        );
        return;
      }
    }
    entities.push({ index, name: entity.name, symbol: entity.symbol, parent: entity.parent, mesh, instance });
  });
  let lightsNode = frameLayout?.root.members.find((member) => member.name === "lights")?.node, lightCapacity = lightsNode?.kind === "array" ? lightsNode.length : 0;
  frameLayout !== void 0 && lightsNode?.kind !== "array" && diagnostics.push(broken("layouts", `the member 'lights' of the built-in layout '${FRAME_LAYOUT_ID}' is not an array.`));
  let lights = [];
  scene.lights.length > lightCapacity ? diagnostics.push(
    broken("scene.lights", `the scene declares ${String(scene.lights.length)} lights, but the frame block holds ${String(lightCapacity)}.`)
  ) : (scene.lights.forEach((light, index) => {
    let field = `scene.lights[${String(index)}]`;
    if (light.index !== index) {
      diagnostics.push(broken(`${field}.index`, `light ${String(index)} carries index ${String(light.index)}.`));
      return;
    }
    if (scene.entities[light.entity]?.light !== index) {
      diagnostics.push(broken(`${field}.entity`, `light ${String(index)} names entity ${String(light.entity)}, which does not carry it.`));
      return;
    }
    lights.push({ index, entity: light.entity, kind: light.kind, range: light.kind === "point" ? light.range : 0 });
  }), scene.entities.forEach((entity, index) => {
    entity.light !== null && scene.lights[entity.light]?.entity !== index && diagnostics.push(
      broken(`scene.entities[${String(index)}].light`, `entity '${entity.name}' names light ${String(entity.light)}, which another entity carries.`)
    );
  }));
  let prefabs = [], prefabSymbols = /* @__PURE__ */ new Set();
  return (manifest.prefabs ?? []).forEach((prefab, index) => {
    let field = `prefabs[${String(index)}]`;
    if (prefabSymbols.has(prefab.symbol)) {
      diagnostics.push(broken(`${field}.symbol`, `the prefab '${prefab.symbol}' is listed twice.`));
      return;
    }
    prefabSymbols.add(prefab.symbol);
    let mesh = null;
    if (prefab.mesh !== null) {
      let found = meshById.get(prefab.mesh);
      if (found === void 0) {
        manifest.meshes.some((candidate) => candidate.id === prefab.mesh) || diagnostics.push(broken(`${field}.mesh`, `prefab '${prefab.name}' names the unknown mesh '${prefab.mesh}'.`));
        return;
      }
      mesh = found;
    }
    let material = null;
    if (prefab.material !== null) {
      let resolved = materialById.get(prefab.material.id);
      if (resolved === void 0) {
        manifest.materials.some((candidate) => candidate.id === prefab.material?.id) || diagnostics.push(broken(`${field}.material`, `prefab '${prefab.name}' names the unknown material '${prefab.material.id}'.`));
        return;
      }
      let declared = new Set(resolved.params.map((param) => param.name)), given = prefab.material.params.map((param) => param.name);
      if (given.length !== declared.size || given.some((name) => !declared.has(name))) {
        diagnostics.push(
          broken(`${field}.material.params`, `prefab '${prefab.name}' lists the material params [${given.join(", ")}], not those of '${resolved.id}'.`)
        );
        return;
      }
      let resources = resolveResources(`${field}.material.params`, `prefab '${prefab.name}'`, resolved, prefab.material.params);
      if (resources === void 0) return;
      material = { material: resolved, params: prefab.material.params, shareable: prefab.material.shareable, resources };
    }
    if (mesh === null != (material === null)) {
      diagnostics.push(broken(field, `prefab '${prefab.name}' has a mesh without a material or a material without a mesh.`));
      return;
    }
    let source = mesh?.descriptor;
    if (source?.kind === "asset" && material !== null) {
      let missing = material.material.shader.vertexAttributes.find((attribute) => !source.layout.attributes.includes(attribute));
      if (missing !== void 0) {
        diagnostics.push(
          broken(field, `prefab '${prefab.name}' draws the mesh '${mesh?.id ?? ""}' with material '${material.material.id}', which reads '${missing}'; primitive ${String(source.primitive)} of '${source.asset}' has [${source.layout.attributes.join(", ")}].`)
        );
        return;
      }
    }
    for (let [position, binding] of prefab.bindings.entries()) {
      let at3 = `${field}.bindings[${String(position)}]`, target = binding.target, problem = binding.id !== position ? `carries id ${String(binding.id)}` : (target.kind === "transform" || target.kind === "visible") && target.entity !== 0 ? `targets entity ${String(target.entity)}, but a prefab binds only its instance (entity 0)` : target.kind === "param" && (target.instance !== 0 || material === null) ? "targets a material instance the prefab does not have" : target.kind === "camera" || target.kind === "light" ? `targets a ${target.kind}, which a prefab cannot bind` : void 0;
      problem !== void 0 && diagnostics.push(broken(at3, `binding ${String(position)} of prefab '${prefab.name}' ${problem}.`));
    }
    for (let param of prefab.material?.params ?? [])
      param.class === "bound" && prefab.bindings[param.binding] === void 0 && diagnostics.push(broken(`${field}.material.params`, `the param '${param.name}' of prefab '${prefab.name}' names the missing binding ${String(param.binding)}.`));
    prefabs.push({
      symbol: prefab.symbol,
      name: prefab.name,
      index,
      params: prefab.params,
      mesh,
      material,
      body: prefab.body,
      collider: prefab.collider,
      state: prefab.state,
      update: prefab.update,
      fixedUpdate: prefab.fixedUpdate,
      bindings: prefab.bindings,
      span: prefab.span
    });
  }), diagnostics.length > 0 || frameLayout === void 0 || objectLayout === void 0 || camera === void 0 ? { ok: !1, diagnostics } : {
    ok: !0,
    structure: { frameLayout, objectLayout, camera, entities, materials, instances, meshes, lights, lightCapacity, prefabs }
  };
}

// src/host/outputs.ts
function snapshot(output, value) {
  switch (output.type) {
    case "vec2":
    case "vec3":
    case "vec4": {
      let v = value, components = [v.x, v.y];
      return output.type !== "vec2" && components.push(v.z), output.type === "vec4" && components.push(v.w), Object.freeze(components);
    }
    case "color": {
      let c = value;
      return Object.freeze([c.r, c.g, c.b, c.a]);
    }
    default:
      return value;
  }
}
function equal(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, i) => Object.is(value, b[i])) : Object.is(a, b);
}
function reportListenerError(error) {
  typeof reportError == "function" ? reportError(error) : console.error(error);
}
var HostOutputs = class {
  constructor(manifest, reportError2 = reportListenerError) {
    this.reportError = reportError2;
    this.replace(manifest);
  }
  reportError;
  byName = /* @__PURE__ */ new Map();
  subscriptions = /* @__PURE__ */ new Set();
  disposed = !1;
  publishing = !1;
  /** Compatible names survive reload, with a fresh snapshot; removed or retyped names are detached. */
  replace(manifest) {
    let next = new Map((manifest.scene.hostOutputs ?? []).map((output) => [output.name, output]));
    for (let subscription of this.subscriptions) {
      let before = this.byName.get(subscription.name), after = next.get(subscription.name);
      before === void 0 || after === void 0 || before.type !== after.type ? (subscription.active = !1, this.subscriptions.delete(subscription)) : subscription.previous = void 0;
    }
    this.byName = next;
  }
  subscribe(name, listener) {
    if (this.disposed) throw new Error("onOutput: the application has failed or been disposed.");
    if (!this.byName.has(name)) throw new RangeError(`Unknown host output '${name}'.`);
    if (typeof listener != "function") throw new TypeError("onOutput: listener must be a function.");
    let subscription = { name, listener, active: !0, previous: void 0 };
    return this.subscriptions.add(subscription), () => {
      subscription.active = !1, this.subscriptions.delete(subscription);
    };
  }
  /** Capture all values and listeners before invoking any host callback. New subscriptions wait a frame. */
  publish(state) {
    if (!(this.disposed || this.publishing || this.subscriptions.size === 0)) {
      this.publishing = !0;
      try {
        let values = /* @__PURE__ */ new Map(), pending = [...this.subscriptions].map((subscription) => {
          let value = values.get(subscription.name);
          if (value === void 0) {
            let output = this.byName.get(subscription.name);
            value = snapshot(output, state[output.source.name]), values.set(subscription.name, value);
          }
          return { subscription, value };
        });
        for (let { subscription, value } of pending)
          if (!(!subscription.active || equal(subscription.previous, value))) {
            subscription.previous = value;
            try {
              subscription.listener(value);
            } catch (error) {
              this.reportError(error);
            }
          }
      } finally {
        this.publishing = !1;
      }
    }
  }
  dispose() {
    this.disposed = !0;
    for (let subscription of this.subscriptions) subscription.active = !1;
    this.subscriptions.clear(), this.byName.clear();
  }
};

// src/host/codecs.ts
var fr = Math.fround;
function wrongType(codec, expected, value) {
  return {
    ok: !1,
    code: "MTEK-E8041",
    message: `Host input codec '${codec}' expected ${expected}, got ${describe4(value)}.`
  };
}
function describe4(value) {
  return value === null ? "null" : typeof value == "string" ? `string ${JSON.stringify(value)}` : typeof value == "number" ? Number.isFinite(value) ? `number ${value}` : `number ${String(value)}` : typeof value == "boolean" ? `boolean ${value}` : Array.isArray(value) ? `array of length ${value.length}` : typeof value == "object" ? "object" : typeof value;
}
function decodeF32(value) {
  return typeof value != "number" || !Number.isFinite(value) ? wrongType("f32", "a finite number", value) : { ok: !0, value: fr(value) };
}
function decodeI32(value) {
  return typeof value != "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647 ? wrongType("i32", "an integer number in i32 range", value) : { ok: !0, value };
}
function decodeU32(value) {
  return typeof value != "number" || !Number.isInteger(value) || value < 0 || value > 4294967295 ? wrongType("u32", "an integer number in u32 range", value) : { ok: !0, value };
}
function decodeBool(value) {
  return typeof value != "boolean" ? wrongType("bool", "a boolean", value) : { ok: !0, value };
}
function decodeVec(codec, n, value) {
  if (!Array.isArray(value) || value.length !== n || !value.every((c) => typeof c == "number" && Number.isFinite(c)))
    return wrongType(codec, `a number[] of length ${n} with finite components`, value);
  let comps = value.map((c) => fr(c));
  return n === 2 ? { ok: !0, value: { x: comps[0], y: comps[1] } } : n === 3 ? { ok: !0, value: { x: comps[0], y: comps[1], z: comps[2] } } : { ok: !0, value: { x: comps[0], y: comps[1], z: comps[2], w: comps[3] } };
}
function decodeString(value) {
  return typeof value != "string" ? wrongType("string", "a string", value) : new TextEncoder().encode(value).length > 65536 ? {
    ok: !1,
    code: "MTEK-E8041",
    message: "Host input codec 'string' rejects strings longer than 65536 bytes."
  } : { ok: !0, value };
}
function srgb8ToLinear(channel) {
  let c = channel / 255, linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return fr(linear);
}
var HEX = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/;
function decodeColorHex(value, opaque) {
  let codec = opaque ? "color-hex-opaque" : "color-hex";
  if (typeof value != "string") return wrongType(codec, "a hex colour string (#rrggbb or #rrggbbaa)", value);
  let match = HEX.exec(value);
  if (match === null)
    return {
      ok: !1,
      code: "MTEK-E8041",
      message: `Host input codec '${codec}' expected "#rrggbb" or "#rrggbbaa", got ${JSON.stringify(value)}.`
    };
  let rgb = match[1], alphaHex = match[2];
  if (opaque && alphaHex !== void 0 && alphaHex.toLowerCase() !== "ff")
    return {
      ok: !1,
      code: "MTEK-E8100",
      message: `Host input codec 'color-hex-opaque' rejects non-opaque colour ${JSON.stringify(value)}: alpha must be ff or omitted.`
    };
  let r8 = Number.parseInt(rgb.slice(0, 2), 16), g8 = Number.parseInt(rgb.slice(2, 4), 16), b8 = Number.parseInt(rgb.slice(4, 6), 16), a8 = alphaHex === void 0 ? 255 : Number.parseInt(alphaHex, 16);
  return { ok: !0, value: {
    r: srgb8ToLinear(r8),
    g: srgb8ToLinear(g8),
    b: srgb8ToLinear(b8),
    a: fr(a8 / 255)
  } };
}
function decodeHostInput(codec, value) {
  switch (codec) {
    case "f32":
      return decodeF32(value);
    case "i32":
      return decodeI32(value);
    case "u32":
      return decodeU32(value);
    case "bool":
      return decodeBool(value);
    case "vec2":
      return decodeVec("vec2", 2, value);
    case "vec3":
      return decodeVec("vec3", 3, value);
    case "vec4":
      return decodeVec("vec4", 4, value);
    case "string":
      return decodeString(value);
    case "color-hex":
      return decodeColorHex(value, !1);
    case "color-hex-opaque":
      return decodeColorHex(value, !0);
  }
}

// src/host/inputs.ts
function unknownInputResult(name) {
  return {
    ok: !1,
    error: {
      code: "MTEK-E8040",
      message: `Unknown host input '${name}'.`
    }
  };
}
var HostInputs = class {
  byName = /* @__PURE__ */ new Map();
  /** Last queued value per input name; applied (and cleared) in phase 1. */
  queue = /* @__PURE__ */ new Map();
  constructor(manifest) {
    for (let input of manifest.scene.hostInputs)
      this.byName.set(input.name, input);
  }
  /** Declared host inputs, in manifest order. */
  get declared() {
    return [...this.byName.values()];
  }
  /**
   * Validate and queue. Never throws and never mutates live state.
   * Invalid values leave the queue unchanged for that name.
   */
  setInput(name, value) {
    let input = this.byName.get(name);
    if (input === void 0) return unknownInputResult(name);
    let decoded = decodeHostInput(input.codec, value);
    return decoded.ok ? (this.queue.set(name, decoded.value), { ok: !0 }) : { ok: !1, error: { code: decoded.code, message: decoded.message } };
  }
  /** Apply every queued value to scene state; clear the queue. Called in phase 1. */
  applyQueued(sink) {
    for (let [name, value] of this.queue) {
      let input = this.byName.get(name);
      input !== void 0 && (sink.state[input.target.name] = value);
    }
    this.queue.clear();
  }
  /** Whether a value is waiting to be applied (tests). */
  hasQueued(name) {
    return this.queue.has(name);
  }
};

// src/host/reload.ts
function bodyKey(body) {
  return body === null ? "none" : body.kind === "dynamic" ? `dynamic:${String(body.mass)}` : body.kind;
}
function parentSymbol(entities, parent) {
  return parent === null ? null : entities[parent]?.symbol ?? `index:${String(parent)}`;
}
function paramSignature(prefab) {
  return prefab.params.map((param) => `${param.name}: ${param.type}`).join(", ");
}
function findStructuralChange(previous, next, previousPrefabs, nextPrefabs, previousSpawned = [], nextSpawned = []) {
  for (let name of nextPrefabs)
    if (!previousPrefabs.has(name))
      return { symbol: name, reason: `prefab '${name}' was added` };
  for (let name of previousPrefabs)
    if (!nextPrefabs.has(name))
      return { symbol: name, reason: `prefab '${name}' was removed` };
  let previousSpawnedBySymbol = new Map(previousSpawned.map((prefab) => [prefab.symbol, prefab]));
  for (let prefab of nextSpawned) {
    let before = previousSpawnedBySymbol.get(prefab.symbol);
    if (before !== void 0 && paramSignature(before) !== paramSignature(prefab))
      return { symbol: prefab.symbol, reason: `the params of prefab '${prefab.name}' changed (${paramSignature(before)} became ${paramSignature(prefab)})` };
  }
  let previousBySymbol = new Map(previous.entities.map((entity) => [entity.symbol, entity])), nextBySymbol = new Map(next.entities.map((entity) => [entity.symbol, entity]));
  for (let entity of next.entities)
    if (previousBySymbol.get(entity.symbol) === void 0)
      return { symbol: entity.symbol, reason: `entity '${entity.name}' was added` };
  for (let entity of previous.entities)
    if (!nextBySymbol.has(entity.symbol))
      return { symbol: entity.symbol, reason: `entity '${entity.name}' was removed` };
  for (let entity of next.entities) {
    let before = previousBySymbol.get(entity.symbol);
    if (before === void 0) continue;
    let beforeParent = parentSymbol(previous.entities, before.parent), nextParent = parentSymbol(next.entities, entity.parent);
    if (beforeParent !== nextParent)
      return { symbol: entity.symbol, reason: `entity '${entity.name}' changed parent` };
    if (bodyKey(before.body) !== bodyKey(entity.body))
      return { symbol: entity.symbol, reason: `entity '${entity.name}' changed body` };
  }
}
function copyValue(value) {
  if (value === null || typeof value == "boolean" || typeof value == "number" || typeof value == "string") return value;
  if (value instanceof Float32Array) return new Float32Array(value);
  if (isQuat(value)) return { x: value.x, y: value.y, z: value.z, w: value.w };
  if (isVec3(value)) return { x: value.x, y: value.y, z: value.z };
  if (isColor(value)) return { r: value.r, g: value.g, b: value.b, a: value.a };
  if (typeof value == "object" && value !== null) {
    let record = value;
    if (typeof record.x == "number" && typeof record.y == "number" && record.z === void 0)
      return { x: record.x, y: record.y };
    if (typeof record.x == "number" && typeof record.y == "number" && typeof record.z == "number" && typeof record.w == "number" && record.r === void 0)
      return { x: record.x, y: record.y, z: record.z, w: record.w };
  }
  return value;
}
function stateTypeMap(entries) {
  return new Map(entries.map((entry) => [entry.symbol, entry.type]));
}
function stateBySymbol(entries, values) {
  let out = /* @__PURE__ */ new Map();
  for (let entry of entries)
    Object.hasOwn(values, entry.name) && out.set(entry.symbol, { type: entry.type, value: values[entry.name] });
  return out;
}
function carryEntity(before, beforeState, after, afterState, kept, setParam) {
  after.position = copyValue(before.position), after.rotation = copyValue(before.rotation), after.scale = copyValue(before.scale), after.visible = before.visible;
  for (let entry of afterState)
    beforeState.get(entry.symbol) === entry.type && Object.hasOwn(before.state, entry.name) && (after.state[entry.name] = copyValue(before.state[entry.name]));
  if (after.mat !== null && before.mat !== null)
    for (let name of kept)
      Object.hasOwn(before.mat.p, name) && setParam(after, name, copyValue(before.mat.p[name]));
}
function sceneInstanceClasses(manifest, index) {
  let instance = index === void 0 ? void 0 : manifest.scene.materialInstances[index];
  if (instance === void 0) return;
  let material = manifest.materials.find((candidate) => candidate.id === instance.material);
  return { material: instance.material, types: new Map((material?.params ?? []).map((param) => [param.name, param.type])), params: instance.params };
}
function prefabInstanceClasses(material) {
  if (material !== null)
    return { material: material.material.id, types: new Map(material.material.params.map((param) => [param.name, param.type])), params: material.params };
}
function keptParams(before, after) {
  if (before === void 0 || after === void 0 || before.material !== after.material) return [];
  let previous = new Map(before.params.map((param) => [param.name, param.class]));
  return after.params.filter((param) => param.class === "imperative" && previous.get(param.name) === "imperative").filter((param) => before.types.get(param.name) !== void 0 && before.types.get(param.name) === after.types.get(param.name)).map((param) => param.name);
}
var LIGHT_FIELDS2 = ["color", "intensity"];
function carryLight(before, previous, after, next, setLight) {
  if (!(before.light === null || after.light === null || previous === void 0 || next === void 0 || previous.kind !== next.kind))
    for (let field of LIGHT_FIELDS2)
      previous.classes[field] !== "imperative" || next.classes[field] !== "imperative" || setLight(after, field, copyValue(before.light[field]));
}
function migrateWorld(previous, previousManifest, next, nextManifest) {
  let previousSceneState = stateBySymbol(previousManifest.scene.state, previous.sceneState);
  for (let entry of nextManifest.scene.state) {
    let before = previousSceneState.get(entry.symbol);
    before !== void 0 && before.type === entry.type && (next.sceneState[entry.name] = copyValue(before.value));
  }
  let previousEntities = /* @__PURE__ */ new Map();
  previousManifest.scene.entities.forEach((entity, index) => {
    let record = previous.entities[index];
    record !== void 0 && previousEntities.set(entity.symbol, record);
  });
  let previousEntityStateTypes = new Map(
    previousManifest.scene.entities.map((entity) => [entity.symbol, stateTypeMap(entity.state)])
  ), previousLights = new Map(
    previousManifest.scene.entities.map((entity) => [entity.symbol, entity.light === null ? void 0 : previousManifest.scene.lights[entity.light]])
  ), previousInstances = new Map(previousManifest.scene.entities.map((entity) => [entity.symbol, sceneInstanceClasses(previousManifest, entity.material?.instance)])), { setParam, setLight } = next.ctx;
  nextManifest.scene.entities.forEach((entity, index) => {
    let nextRecord = next.entities[index], before = previousEntities.get(entity.symbol);
    nextRecord === void 0 || before === void 0 || (carryLight(before, previousLights.get(entity.symbol), nextRecord, entity.light === null ? void 0 : nextManifest.scene.lights[entity.light], setLight), carryEntity(
      before,
      previousEntityStateTypes.get(entity.symbol) ?? /* @__PURE__ */ new Map(),
      nextRecord,
      entity.state,
      keptParams(previousInstances.get(entity.symbol), sceneInstanceClasses(nextManifest, entity.material?.instance)),
      setParam
    ));
  }), next.dynamic.restoreFrom(previous.dynamic, (before, after) => {
    carryEntity(
      before.record,
      new Map(before.prefab.resolved.state.map((entry) => [entry.symbol, entry.type])),
      after.record,
      after.prefab.resolved.state,
      keptParams(prefabInstanceClasses(before.prefab.resolved.material), prefabInstanceClasses(after.prefab.resolved.material)),
      setParam
    );
  });
  let previousCamera = previousManifest.scene.cameras.find((camera) => camera.active), nextCamera = nextManifest.scene.cameras.find((camera) => camera.active);
  previousCamera !== void 0 && nextCamera !== void 0 && previousCamera.symbol === nextCamera.symbol && previousCamera.projection === nextCamera.projection && (next.camera.position = copyValue(previous.camera.position), next.camera.rotation = copyValue(previous.camera.rotation), next.camera.target = previous.camera.target === null ? null : copyValue(previous.camera.target), next.camera.projection.kind === "perspective" && previous.camera.projection.kind === "perspective" ? (next.camera.projection.fov_y = previous.camera.projection.fov_y, next.camera.projection.near = previous.camera.projection.near, next.camera.projection.far = previous.camera.projection.far) : next.camera.projection.kind === "orthographic" && previous.camera.projection.kind === "orthographic" && (next.camera.projection.height = previous.camera.projection.height, next.camera.projection.near = previous.camera.projection.near, next.camera.projection.far = previous.camera.projection.far)), next.markAllTransformsDirty(), next.propagate();
}
function restartDiagnostic(manifest, change) {
  let spanId = spanOfSymbol(manifest, change.symbol);
  return makeRuntimeDiagnostic("W8070", {
    phase: "runtime:reload",
    message: `The scene was restarted on reload because ${change.reason}.`,
    source: spanId === void 0 ? null : resolveSpan(manifest, spanId),
    notes: [`declaration: ${change.symbol}`]
  });
}
function prefabNames(prefabs) {
  return typeof prefabs != "object" || prefabs === null || Array.isArray(prefabs) ? /* @__PURE__ */ new Set() : new Set(Object.keys(prefabs));
}

// src/host/shaders.ts
function isRecord3(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value);
}
function isFiniteInteger(value) {
  return typeof value == "number" && Number.isInteger(value);
}
function parseSpanMap(text, shaderHash) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return `not valid JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  if (!isRecord3(value) || !Array.isArray(value.entries)) return "missing the `entries` array";
  if (value.shader !== shaderHash) return "its `shader` hash does not match the manifest";
  let entries = [];
  for (let raw of value.entries) {
    if (!isRecord3(raw)) return "an entry is not an object";
    let wgsl = raw.wgsl;
    if (!isRecord3(wgsl) || !isFiniteInteger(wgsl.line) || !isFiniteInteger(wgsl.colStart) || !isFiniteInteger(wgsl.colEnd))
      return "an entry has no valid `wgsl` location";
    if (!isFiniteInteger(raw.span)) return "an entry has no valid `span`";
    let entry = {
      wgsl: { line: wgsl.line, colStart: wgsl.colStart, colEnd: wgsl.colEnd },
      span: raw.span,
      ...typeof raw.symbol == "string" ? { symbol: raw.symbol } : {}
    };
    entries.push(entry);
  }
  return { entries };
}
function findSpanMapEntry(entries, line, column) {
  let best;
  for (let entry of entries)
    entry.wgsl.line !== line || column < entry.wgsl.colStart || column >= entry.wgsl.colEnd || (best === void 0 || entry.wgsl.colEnd - entry.wgsl.colStart < best.wgsl.colEnd - best.wgsl.colStart) && (best = entry);
  return best;
}
async function fetchText(options, relative) {
  let url = new URL(relative, options.baseUrl).href;
  try {
    let response = await options.fetch(url);
    return response.ok ? { ok: !0, text: await response.text() } : { ok: !1, reason: `HTTP ${String(response.status)} for ${url}` };
  } catch (error) {
    return { ok: !1, reason: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
function describeFailure(manifest, phase, shader, message, notes) {
  let spanId = spanOfSymbol(manifest, shader.material);
  return makeRuntimeDiagnostic("E8051", {
    phase,
    message: `Shader for material '${shader.material}' failed: ${message}`,
    source: spanId === void 0 ? null : resolveSpan(manifest, spanId),
    notes
  });
}
async function loadStartupShaders(options) {
  let { manifest, device, registry } = options, phase = options.phase ?? "runtime:mount", list = options.shaders ?? manifest.shaders, modules = /* @__PURE__ */ new Map(), diagnostics = [], fetched = await Promise.all(
    list.map(async (shader) => ({
      wgsl: await fetchText(options, shader.url),
      map: await fetchText(options, shader.map)
    }))
  );
  for (let [index, shader] of list.entries()) {
    let files = fetched[index];
    if (files === void 0) continue;
    if (!files.wgsl.ok) {
      diagnostics.push(describeFailure(manifest, phase, shader, `the WGSL file could not be loaded (${files.wgsl.reason}).`, []));
      continue;
    }
    let mapEntries, mapProblem;
    if (files.map.ok) {
      let parsed = parseSpanMap(files.map.text, shader.hash);
      typeof parsed == "string" ? mapProblem = `the span map ${shader.map} is unusable: ${parsed}` : mapEntries = parsed.entries;
    } else
      mapProblem = `the span map could not be loaded (${files.map.reason})`;
    device.pushErrorScope("validation");
    let module, compileErrors = [], thrown;
    try {
      module = registry.createShaderModule({ label: `mtek shader ${shader.hash.slice(0, 16)}`, code: files.wgsl.text }), compileErrors = (await module.getCompilationInfo()).messages.filter((message) => message.type === "error");
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    let scopeError;
    try {
      let error = await device.popErrorScope();
      error !== null && (scopeError = error.message);
    } catch {
    }
    module !== void 0 && modules.set(shader.hash, module);
    for (let message of compileErrors) {
      let notes = [], spanId = spanOfSymbol(manifest, shader.material);
      if (message.lineNum > 0 && (notes.push(`WGSL location: ${shader.url}:${String(message.lineNum)}:${String(message.linePos)}`), mapEntries !== void 0)) {
        let entry = findSpanMapEntry(mapEntries, message.lineNum, message.linePos);
        entry === void 0 ? notes.push("no Mtek source span maps to this WGSL location; showing the material declaration") : (spanId = entry.span, entry.symbol !== void 0 && notes.push(`generated from ${entry.symbol}`));
      }
      mapProblem !== void 0 && notes.push(`${mapProblem}; showing the material declaration`), diagnostics.push(
        makeRuntimeDiagnostic("E8051", {
          phase,
          message: `Shader for material '${shader.material}' failed to compile: ${message.message}`,
          source: spanId === void 0 ? null : resolveSpan(manifest, spanId),
          notes
        })
      );
    }
    compileErrors.length === 0 && (thrown !== void 0 || scopeError !== void 0) && diagnostics.push(describeFailure(manifest, phase, shader, thrown ?? scopeError ?? "validation error", []));
  }
  return { modules, diagnostics };
}
async function loadCandidateShaders(options, existing = /* @__PURE__ */ new Map()) {
  let { manifest, device, registry } = options, phase = options.phase ?? "runtime:reload", list = options.shaders ?? manifest.shaders, modules = new Map(existing), created = [], diagnostics = [], generation = registry.generation;
  try {
    let needed = list.filter((shader) => !modules.has(shader.hash)), fetched = await Promise.all(
      needed.map(async (shader) => ({
        shader,
        wgsl: await fetchText(options, shader.url),
        map: await fetchText(options, shader.map)
      }))
    );
    for (let files of fetched) {
      options.assertActive?.();
      let shader = files.shader;
      if (!files.wgsl.ok) {
        diagnostics.push(describeFailure(manifest, phase, shader, `the WGSL file could not be loaded (${files.wgsl.reason}).`, []));
        continue;
      }
      let mapEntries, mapProblem;
      if (files.map.ok) {
        let parsed = parseSpanMap(files.map.text, shader.hash);
        typeof parsed == "string" ? mapProblem = `the span map ${shader.map} is unusable: ${parsed}` : mapEntries = parsed.entries;
      } else
        mapProblem = `the span map could not be loaded (${files.map.reason})`;
      device.pushErrorScope("validation");
      let module, compileErrors = [], thrown;
      try {
        module = registry.createShaderModule({ label: `mtek shader ${shader.hash.slice(0, 16)}`, code: files.wgsl.text }), compileErrors = (await module.getCompilationInfo()).messages.filter((message) => message.type === "error");
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      let scopeError;
      try {
        let error = await device.popErrorScope();
        error !== null && (scopeError = error.message);
      } catch {
      }
      module !== void 0 && (modules.set(shader.hash, module), created.push(module)), options.assertActive?.();
      for (let message of compileErrors) {
        let notes = [], spanId = spanOfSymbol(manifest, shader.material);
        if (message.lineNum > 0 && (notes.push(`WGSL location: ${shader.url}:${String(message.lineNum)}:${String(message.linePos)}`), mapEntries !== void 0)) {
          let entry = findSpanMapEntry(mapEntries, message.lineNum, message.linePos);
          entry === void 0 ? notes.push("no Mtek source span maps to this WGSL location; showing the material declaration") : (spanId = entry.span, entry.symbol !== void 0 && notes.push(`generated from ${entry.symbol}`));
        }
        mapProblem !== void 0 && notes.push(`${mapProblem}; showing the material declaration`), diagnostics.push(
          makeRuntimeDiagnostic("E8051", {
            phase,
            message: `Shader for material '${shader.material}' failed to compile: ${message.message}`,
            source: spanId === void 0 ? null : resolveSpan(manifest, spanId),
            notes
          })
        );
      }
      compileErrors.length === 0 && (thrown !== void 0 || scopeError !== void 0) && diagnostics.push(describeFailure(manifest, phase, shader, thrown ?? scopeError ?? "validation error", []));
    }
    return { modules, diagnostics, created };
  } catch (error) {
    if (registry.generation === generation) for (let module of created) registry.release(module);
    throw error;
  }
}

// src/host/app.ts
var RECOVERY_ATTEMPTS = 3, DEFAULT_RECOVERY_DELAYS_MS = [250, 1e3, 4e3], RecoveryAbandoned = class extends Error {
};
function errorText5(error) {
  return error instanceof Error ? error.message === "" ? error.name : error.message : String(error);
}
function attemptFailureText(error) {
  return error instanceof MtekMountError ? error.diagnostics.map((diagnostic2) => [diagnostic2.message, ...diagnostic2.notes].join(" ")).join(" ") : errorText5(error);
}
var MountedApp = class {
  constructor(deps) {
    this.deps = deps;
    let { manifest, environment, registry, test } = deps;
    this.seed = deps.seed, this.injectedDeviceFailures = test?.recovery?.failDeviceRequests ?? 0, this.recoveryDelaysMs = test?.recovery?.delaysMs ?? DEFAULT_RECOVERY_DELAYS_MS, this.input = deps.input, this.behaviors = new Behaviors(deps.sceneFunctions, deps.scene.world), this.hostInputs = new HostInputs(manifest), this.hostOutputs = new HostOutputs(manifest);
    for (let shader of manifest.shaders)
      this.shaderSources.has(shader.hash) || this.shaderSources.set(shader.hash, new URL(shader.url, deps.program.baseUrl).href);
    registry.phase = "runtime:render", test?.disableCulling === !0 && deps.scene.renderer.setFrustumCulling(!1);
    let manual = test?.manualClock === !0;
    this.scheduler = new Scheduler(
      manifest.runtimeConfig,
      this.createPhases(),
      manual ? null : { request: (cb) => environment.requestAnimationFrame(cb), cancel: (h) => {
        environment.cancelAnimationFrame(h);
      } },
      (error) => {
        if (error instanceof ExecutionBudgetExceeded) {
          this.failBudget(error);
          return;
        }
        this.fail(
          makeRuntimeDiagnostic("E8050", {
            phase: "runtime:render",
            message: `The frame loop stopped because a frame threw: ${errorText5(error)}`
          })
        );
      }
    );
    let ResizeObserverCtor = environment.ResizeObserver;
    ResizeObserverCtor !== void 0 && (this.resizeObserver = new ResizeObserverCtor(() => {
      this.onResize();
    }), this.resizeObserver.observe(deps.canvas)), deps.watchPixelRatio && this.watchPixelRatio(), attachInputListeners(this.input, {
      canvas: deps.canvas,
      document: environment.document,
      window: environment.window,
      registry,
      handledKeys: this.behaviors.handledKeys()
    }), environment.document !== void 0 && (registry.addEventListener(environment.document, "visibilitychange", () => {
      this.onVisibilityChange();
    }), deps.pauseWhenHidden && environment.document.visibilityState === "hidden" && (this.current = "paused", this.pausedByVisibility = !0, this.input.pause(), this.scheduler.pause())), test !== void 0 && (this.debug = this.createDebug(manual)), this.scheduler.start();
  }
  deps;
  debug;
  seed;
  current = "running";
  pausedByVisibility = !1;
  scheduler;
  input;
  behaviors;
  resizeObserver;
  frameStartMs = 0;
  /** The scheduler phase that is running (or ran last): the `phase` of an `E8080`. */
  framePhase = "runtime:input";
  renderStartMs = 0;
  frameTimeMs = 0;
  cpuUpdateMs = 0;
  renderPrepMs = 0;
  hostInputs;
  hostOutputs;
  /** Retained modules can outlive the current manifest; recovery needs their cached WGSL provenance. */
  shaderSources = /* @__PURE__ */ new Map();
  /** Validated candidate waiting to become the live scene at the next frame start. */
  pendingSwap;
  /** Identifies the current device: a `lost` event of an older one is stale (decision 0056). */
  deviceEpoch = 0;
  /** The epoch whose `destroyed` loss was requested by `debug.loseDevice` and is therefore a loss to recover from. */
  simulatedLossEpoch = -1;
  losses = 0;
  recoveries = 0;
  recoveryAttemptsMade = 0;
  recoveryTimer;
  /** Why the running attempt must fail although nothing threw: the new device was lost, an allocation failed. */
  attemptProblem;
  /** What the application was doing when the device was lost, to restore it afterwards. */
  beforeLoss = { paused: !1, byVisibility: !1 };
  injectedDeviceFailures;
  recoveryDelaysMs;
  get state() {
    return this.current;
  }
  /** Time since mount excluding paused time, in seconds (`frame.time` before conversion to f32). */
  get activeTime() {
    return this.scheduler.activeTime;
  }
  /** Never throws. Valid values are queued and applied in phase 1 of the next frame. */
  setInput(name, value) {
    return this.hostInputs.setInput(name, value);
  }
  onOutput(name, listener) {
    return this.hostOutputs.subscribe(name, listener);
  }
  /**
   * Candidate-based hot reload (`spec/runtime-abi.md` section 11): validate the candidate fully;
   * on failure discard it and keep the running program; on success queue an atomic swap for the
   * next frame start.
   */
  async replaceProgram(candidate) {
    if (this.current === "disposed" || this.current === "failed" || this.current === "recovering") {
      let diagnostic2 = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram was called while the application is ${this.current}.`
      });
      return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
    }
    let { environment, device, registry, surface, services } = this.deps, epoch = this.deviceEpoch, generation = registry.generation, assertActive = () => {
      if (this.deviceEpoch !== epoch || registry.generation !== generation || this.current !== "running" && this.current !== "paused")
        throw new Error(`The candidate was discarded because its application or GPU device is no longer current (application ${this.current}).`);
    }, createdModules = [], preparedScene;
    try {
      if (candidate.abi !== 1) {
        let diagnostic2 = makeRuntimeDiagnostic("E8003", {
          phase: "runtime:reload",
          message: `Incompatible program: the program module's \`abi\` is ${String(candidate.abi)}, this runtime implements 1.`,
          notes: ["field: abi"]
        });
        return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
      }
      let text;
      try {
        let response = await environment.fetch(candidate.manifestUrl.href);
        if (!response.ok) {
          let diagnostic2 = makeRuntimeDiagnostic("E8006", {
            phase: "runtime:reload",
            message: `The candidate manifest could not be loaded: HTTP ${String(response.status)} for ${candidate.manifestUrl.href}.`,
            notes: ["field: manifestUrl"]
          });
          return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
        }
        text = await response.text();
      } catch (error) {
        let diagnostic2 = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest could not be loaded from ${candidate.manifestUrl.href}: ${errorText5(error)}`,
          notes: ["field: manifestUrl"]
        });
        return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
      }
      assertActive();
      let json;
      try {
        json = JSON.parse(text);
      } catch (error) {
        let diagnostic2 = makeRuntimeDiagnostic("E8006", {
          phase: "runtime:reload",
          message: `The candidate manifest is not valid JSON: ${errorText5(error)}`,
          notes: ["field: manifest"]
        });
        return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
      }
      let checkedManifest = checkManifest(json);
      if (!checkedManifest.ok) {
        let diagnostics = checkedManifest.failures.map(
          (failure2) => makeRuntimeDiagnostic(failure2.code, {
            phase: "runtime:reload",
            message: failure2.message,
            notes: [`field: ${failure2.field}`]
          })
        );
        for (let diagnostic2 of diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics };
      }
      let manifest = checkedManifest.manifest, structure = resolveStructure(manifest);
      if (!structure.ok) {
        for (let diagnostic2 of structure.diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics: structure.diagnostics };
      }
      let checked = checkProgram(candidate, manifest);
      if (!checked.ok) {
        for (let diagnostic2 of checked.diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics: checked.diagnostics };
      }
      for (let shader of manifest.shaders) {
        let source = this.shaderSources.get(shader.hash);
        if (source === void 0) continue;
        let target = new URL(shader.url, candidate.baseUrl).href;
        if (source !== target) {
          await this.deps.fetchShaderFile(target, source), assertActive();
          let mapUrl = new URL(shader.map, candidate.baseUrl).href;
          try {
            await this.deps.fetchShaderFile(mapUrl);
          } catch {
          }
          assertActive();
        }
      }
      let shaders = await loadCandidateShaders(
        {
          manifest,
          baseUrl: candidate.baseUrl,
          device,
          registry,
          fetch: this.deps.fetchShaderFile,
          phase: "runtime:reload",
          assertActive
        },
        this.deps.modules
      );
      if (createdModules.push(...shaders.created), assertActive(), shaders.diagnostics.length > 0) {
        for (let module of shaders.created) registry.release(module);
        for (let diagnostic2 of shaders.diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics: shaders.diagnostics };
      }
      for (let shader of manifest.shaders) this.shaderSources.set(shader.hash, new URL(shader.url, candidate.baseUrl).href);
      let restart = findStructuralChange(
        this.deps.manifest.scene,
        manifest.scene,
        prefabNames(this.deps.program.prefabs),
        prefabNames(candidate.prefabs),
        this.deps.manifest.prefabs ?? [],
        manifest.prefabs ?? []
      ), loaded = await loadAssets({
        manifest,
        baseUrl: candidate.baseUrl,
        environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        phase: "runtime:reload",
        previous: this.deps.assets
      });
      if (loaded.diagnostics.length > 0) {
        for (let module of shaders.created) registry.release(module);
        for (let diagnostic2 of loaded.diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics: loaded.diagnostics };
      }
      services.audio?.adopt?.(manifest, (url) => loaded.assets.has(url) ? loaded.assets.bytes(url) : void 0);
      let started, physicsModule = this.deps.physicsModule;
      try {
        if (assertActive(), !manifest.subsystems.physics)
          physicsModule = void 0;
        else if (physicsModule === void 0 || physicsModule.url !== physicsModuleUrl(manifest, candidate.baseUrl)) {
          let loadedPhysics = await loadPhysicsBackend({
            manifest,
            baseUrl: candidate.baseUrl,
            importModule: (url) => environment.importModule(url),
            phase: "runtime:reload"
          });
          if (!loadedPhysics.ok) {
            for (let module of shaders.created) registry.release(module);
            for (let diagnostic2 of loadedPhysics.diagnostics) this.report(diagnostic2);
            return { ok: !1, diagnostics: loadedPhysics.diagnostics };
          }
          physicsModule = { url: loadedPhysics.url, backend: loadedPhysics.backend };
        }
        assertActive(), started = await startScene({
          assertActive,
          manifest,
          structure: structure.structure,
          program: checked.program,
          device,
          registry,
          surface,
          modules: shaders.modules,
          services,
          report: (diagnostic2) => {
            this.report(diagnostic2);
          },
          pipelineCache: this.deps.scene.pipelines,
          bindingPlan: this.deps.scene.plan,
          assets: { files: loaded.assets, images: loaded.images },
          ...this.deps.test?.textures === void 0 ? {} : { textures: this.deps.test.textures },
          ...this.deps.test?.disableInstancing === !0 ? { instancing: !1 } : {}
        });
      } finally {
        closeImages(loaded.images);
      }
      if (!started.ok) {
        for (let module of shaders.created) registry.release(module);
        for (let diagnostic2 of started.diagnostics) this.report(diagnostic2);
        return { ok: !1, diagnostics: started.diagnostics };
      }
      return preparedScene = started.scene, assertActive(), this.pendingSwap !== void 0 && (this.pendingSwap.scene.materials.dispose(), this.pendingSwap.scene.meshes.dispose(), this.pendingSwap.scene.renderer.dispose()), this.pendingSwap = {
        scene: started.scene,
        manifest,
        program: candidate,
        modules: new Map(shaders.modules),
        assets: loaded.assets,
        sceneFunctions: checked.program.scene,
        restart,
        physicsModule
      }, preparedScene = void 0, { ok: !0 };
    } catch (error) {
      if (registry.generation === generation) {
        preparedScene?.materials.dispose(), preparedScene?.meshes.dispose(), preparedScene?.renderer.dispose();
        for (let module of createdModules)
          try {
            registry.release(module);
          } catch {
          }
      }
      let diagnostic2 = makeRuntimeDiagnostic("E8050", {
        phase: "runtime:reload",
        message: `replaceProgram failed: ${errorText5(error)}`
      });
      return this.report(diagnostic2), { ok: !1, diagnostics: [diagnostic2] };
    }
  }
  pause() {
    this.current === "running" && (this.current = "paused", this.pausedByVisibility = !1, this.input.pause(), this.scheduler.pause());
  }
  resume() {
    this.current === "paused" && (this.current = "running", this.pausedByVisibility = !1, this.input.resume(), this.scheduler.resume());
  }
  /**
   * Synchronous release (`spec/runtime-abi.md` section 9.3): stops the frame loop, removes every listener
   * and observer, destroys every buffer and texture, removes the overlay, unconfigures the canvas and
   * destroys the device. Idempotent.
   */
  dispose() {
    if (this.current === "disposed") return;
    this.current = "disposed", this.hostOutputs.dispose(), this.pendingSwap !== void 0 && (this.pendingSwap.scene.materials.dispose(), this.pendingSwap.scene.meshes.dispose(), this.pendingSwap.scene.renderer.dispose(), this.pendingSwap = void 0);
    let { device, registry, surface, overlay } = this.deps;
    this.deps.physics?.dispose(), this.deps.services.audio?.dispose?.(), this.deps.services.hud?.dispose?.(), this.scheduler.stop(), this.clearRecoveryTimer(), this.resizeObserver?.disconnect(), surface.dispose(), overlay?.remove(), this.deps.devTools?.dispose(), registry.destroyAll(), device.onuncapturederror = null, device.destroy();
  }
  /**
   * Called when `device.lost` resolves (`spec/runtime-abi.md` section 9.4, decision 0056). `epoch` names the
   * device the event belongs to; the first device is epoch 0. A loss caused by `dispose()` or by the runtime
   * discarding a failed attempt's device (reason `destroyed`) is ignored; so is the loss of a device that was
   * already replaced. Otherwise the frame loop pauses, `W8060` is reported and a bounded rebuild starts.
   */
  handleDeviceLost(info, epoch = 0) {
    if (!(this.current === "disposed" || this.current === "failed") && !(info.reason === "destroyed" && epoch !== this.simulatedLossEpoch) && epoch === this.deviceEpoch) {
      if (this.current === "recovering") {
        this.attemptProblem ??= `the new device was lost (${info.reason}): ${info.message}`;
        return;
      }
      this.beginRecovery(info);
    }
  }
  /** Called for validation errors no error scope captured. */
  handleUncapturedError(error) {
    this.current !== "disposed" && this.report(
      makeRuntimeDiagnostic("E8050", {
        phase: "runtime:render",
        message: `A GPU validation error was not captured by an error scope: ${error.message}`
      })
    );
  }
  /**
   * Called when a registry allocation fails after mount (`E8063`): the scene stops rather than render stale
   * data. During a device recovery the failure is the attempt's: it fails and the next one may succeed.
   */
  handleAllocationFailure(diagnostic2) {
    if (this.current !== "disposed") {
      if (this.current === "recovering") {
        this.attemptProblem ??= diagnostic2.message;
        return;
      }
      this.fail(diagnostic2);
    }
  }
  /**
   * A material whose shader or pipeline failed after mount (hot reload, device recovery): the diagnostic
   * is reported and the material is no longer drawn; the scene keeps running (`spec/runtime-abi.md` section 12).
   * Mount-time failures never get here: they reject `mountMtek` with `shader-failed`.
   */
  handleMaterialFailure(materialId, diagnostic2) {
    this.current !== "disposed" && this.deps.scene.renderer.failMaterial(materialId, diagnostic2);
  }
  /** Called by the physics subsystem, in the order of `spec/physics.md` section 6: runs one entity's collision handlers. */
  deliverCollision(kind, slot, other) {
    this.behaviors.collision(kind, slot, other);
  }
  /** Delivers a diagnostic to the host; errors also appear in the overlay. */
  report(diagnostic2) {
    this.deps.sink.report(diagnostic2) && diagnostic2.severity === "error" && (this.deps.overlay?.add(diagnostic2), this.deps.devTools?.recordError(diagnostic2));
  }
  /** Reports the cause, stops the frame loop and shows the overlay (whatever the severity of the cause). */
  fail(cause) {
    this.current === "disposed" || this.current === "failed" || (this.current = "failed", this.hostOutputs.dispose(), this.scheduler.stop(), this.clearRecoveryTimer(), this.deps.sink.report(cause), this.deps.overlay?.add(cause), this.deps.devTools?.recordError(cause));
  }
  /**
   * `E8080` (decision 0075): a loop spent the last iteration of the frame's budget. The handler, the tick and the
   * frame were abandoned where they stood, which leaves the scene half updated, so the scene stops (the overlay
   * names the loop) instead of running on from a state no program produced.
   */
  failBudget(error) {
    let limit = this.deps.manifest.preview?.loopBudget;
    this.fail(
      makeRuntimeDiagnostic("E8080", {
        phase: this.framePhase,
        message: limit === void 0 ? "A loop ran past the execution budget of this preview, so the frame was abandoned and the scene stopped." : `A loop ran past the execution budget of ${String(limit)} iterations per frame, so the frame was abandoned and the scene stopped.`,
        source: resolveSpan(this.deps.manifest, error.spanId),
        notes: [
          "the budget counts the iterations of every loop of every handler, lifecycle function and binding that runs in one frame",
          "help: bound the loop, or build the preview with a larger --loop-budget if the program really needs the iterations"
        ]
      })
    );
  }
  stateNow() {
    return this.current;
  }
  /** A device was lost: pause, report `W8060`, and schedule attempt 1 (`spec/runtime-abi.md` section 9.4). */
  beginRecovery(info) {
    this.losses += 1;
    let notes = [
      `Recovery: up to ${String(RECOVERY_ATTEMPTS)} attempts, after ${this.recoveryDelaysMs.map((delay) => `${String(delay)} ms`).join(", ")}; the application is paused until one succeeds.`
    ];
    this.pendingSwap !== void 0 && (this.pendingSwap = void 0, notes.push("A hot-reload candidate that was waiting for the next frame was discarded.")), this.beforeLoss = { paused: this.current === "paused", byVisibility: this.pausedByVisibility }, this.current === "running" && (this.input.pause(), this.scheduler.pause()), this.current = "recovering", this.deps.device.onuncapturederror = null, this.deps.registry.phase = "runtime:device";
    let nth = this.losses === 1 ? "" : ` (device loss ${String(this.losses)})`;
    this.report(
      makeRuntimeDiagnostic("W8060", {
        phase: "runtime:device",
        message: `The GPU device was lost (${info.reason}): ${info.message}${nth}`,
        notes
      })
    ), this.scheduleAttempt(1, []);
  }
  scheduleAttempt(attempt, failures) {
    let delay = this.recoveryDelaysMs[attempt - 1] ?? 0;
    this.recoveryTimer = this.deps.environment.setTimeout(() => {
      this.recoveryTimer = void 0, this.runAttempt(attempt, failures, delay);
    }, delay);
  }
  clearRecoveryTimer() {
    this.recoveryTimer !== void 0 && (this.deps.environment.clearTimeout(this.recoveryTimer), this.recoveryTimer = void 0);
  }
  /** One rebuild attempt. A failure schedules the next attempt, or ends in `E8062` after the last. */
  async runAttempt(attempt, failures, delay) {
    this.recoveryAttemptsMade += 1;
    try {
      await this.rebuild();
    } catch (error) {
      if (error instanceof RecoveryAbandoned) {
        this.stateNow() === "disposed" && this.deps.registry.destroyAll();
        return;
      }
      this.retryOrFail(attempt, failures, delay, attemptFailureText(error));
      return;
    }
    this.finishRecovery(attempt);
  }
  retryOrFail(attempt, failures, delay, problem) {
    let all = [...failures, `attempt ${String(attempt)} (after ${String(delay)} ms) failed: ${problem}`];
    if (attempt < RECOVERY_ATTEMPTS) {
      this.scheduleAttempt(attempt + 1, all);
      return;
    }
    this.deps.registry.phase = "runtime:render", this.fail(
      makeRuntimeDiagnostic("E8062", {
        phase: "runtime:device",
        message: `The GPU device could not be recovered after ${String(RECOVERY_ATTEMPTS)} attempts; the application has stopped.`,
        notes: [...all, "help: reload the page to start again"]
      })
    );
  }
  ensureRecovering() {
    if (this.current !== "recovering") throw new RecoveryAbandoned();
  }
  /**
   * Requests a new device and rebuilds every GPU resource on it from the manifest and the retained CPU state
   * (the world with its entity records, mirrors and scene state, the bindings, the scheduler's time): the
   * registry forgets the lost device's objects, the surface is configured again, the shaders are created from
   * the remembered WGSL, and `startScene` runs in recover mode. Nothing of the application changes until the
   * whole rebuild succeeded; on any failure the new device is destroyed and the error propagates.
   */
  async rebuild() {
    let { registry, surface, services } = this.deps;
    if (this.injectedDeviceFailures > 0)
      throw this.injectedDeviceFailures -= 1, new Error("requesting a GPU device failed (injected by test.recovery.failDeviceRequests)");
    this.attemptProblem = void 0;
    let epoch = ++this.deviceEpoch, acquired = await this.deps.acquireDevice({
      onDeviceLost: (info) => {
        this.handleDeviceLost(info, epoch);
      },
      onUncapturedError: (event) => {
        this.handleUncapturedError(event.error);
      }
    }), { device } = acquired, committed = !1;
    try {
      this.ensureRecovering(), registry.recycle(device), surface.recover(device);
      let manifest = this.deps.manifest, structure = resolveStructure(manifest);
      if (!structure.ok) throw new Error(structure.diagnostics.map((diagnostic2) => diagnostic2.message).join(" "));
      let checked = checkProgram(this.deps.program, manifest);
      if (!checked.ok) throw new Error(checked.diagnostics.map((diagnostic2) => diagnostic2.message).join(" "));
      let shaders = await loadStartupShaders({
        manifest,
        baseUrl: this.deps.program.baseUrl,
        device,
        registry,
        fetch: this.deps.fetchShaderFile,
        phase: "runtime:device"
      });
      this.ensureRecovering();
      for (let diagnostic2 of shaders.diagnostics) this.report(diagnostic2);
      let decoded = await decodeImages({
        manifest,
        baseUrl: this.deps.program.baseUrl,
        environment: this.deps.environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        phase: "runtime:device",
        assets: this.deps.assets
      }), scene;
      try {
        if (decoded.diagnostics.length > 0) throw new Error(decoded.diagnostics.map((diagnostic2) => diagnostic2.message).join(" "));
        this.ensureRecovering();
        let { world, bindings } = this.deps.scene, started = await startScene({
          manifest,
          structure: structure.structure,
          program: checked.program,
          device,
          registry,
          surface,
          modules: shaders.modules,
          services,
          report: (diagnostic2) => {
            this.report(diagnostic2);
          },
          recover: { world, bindings },
          assets: { files: this.deps.assets, images: decoded.images },
          ...this.deps.test?.textures === void 0 ? {} : { textures: this.deps.test.textures },
          ...this.deps.test?.disableInstancing === !0 ? { instancing: !1 } : {}
        });
        if (!started.ok) throw new Error(started.diagnostics.map((diagnostic2) => diagnostic2.message).join(" "));
        scene = started.scene;
      } finally {
        closeImages(decoded.images);
      }
      if (this.ensureRecovering(), await device.queue.onSubmittedWorkDone(), this.ensureRecovering(), this.attemptProblem !== void 0) throw new Error(this.attemptProblem);
      let lost = this.deps.device;
      if (this.deps.device = device, this.deps.modules = new Map(shaders.modules), scene === void 0) throw new Error("internal error: the rebuild produced no scene");
      this.deps.scene = scene, committed = !0, lost.onuncapturederror = null, lost.destroy();
    } finally {
      committed || (device.onuncapturederror = null, device.destroy());
    }
  }
  /** The rebuilt scene is live: restore what the application was doing and report `W8061`. */
  finishRecovery(attempts) {
    let { registry, environment } = this.deps;
    registry.phase = "runtime:render", this.recoveries += 1, this.deps.devTools?.deviceRecovered();
    let hidden = this.deps.pauseWhenHidden && environment.document?.visibilityState === "hidden", heldByHost = this.beforeLoss.paused && !this.beforeLoss.byVisibility;
    if (this.current = "paused", this.pausedByVisibility = !heldByHost && hidden === !0, !heldByHost && hidden !== !0 && this.resume(), this.onResize(), this.stateNow() === "failed") return;
    let nth = this.recoveries === 1 ? "" : ` (recovery ${String(this.recoveries)})`;
    this.report(
      makeRuntimeDiagnostic("W8061", {
        phase: "runtime:device",
        message: `The GPU device was recovered on attempt ${String(attempts)} of ${String(RECOVERY_ATTEMPTS)}; every GPU resource was recreated from the manifest and the retained scene state.${nth}`
      })
    );
  }
  /**
   * Watches the resolution media query of the current pixel ratio: when it stops matching the ratio changed
   * (the window moved to another display, the page zoom changed) and the backing store is recomputed. The
   * query names the ratio, so it is renewed after every change.
   */
  watchPixelRatio() {
    let { environment, registry } = this.deps, query = environment.matchMedia?.(`(resolution: ${String(environment.devicePixelRatio())}dppx)`);
    if (query === void 0) return;
    let remove = registry.addEventListener(query, "change", () => {
      remove(), this.current !== "disposed" && (this.onResize(), this.watchPixelRatio());
    });
  }
  onResize() {
    if (!(this.current === "disposed" || this.current === "failed" || this.current === "recovering"))
      try {
        this.deps.surface.resize(), this.deps.overlay?.reposition(), this.deps.devTools?.reposition();
      } catch (error) {
        this.state !== "failed" && this.fail(
          makeRuntimeDiagnostic("E8050", {
            phase: "runtime:render",
            message: `Resizing the canvas failed: ${errorText5(error)}`
          })
        );
      }
  }
  onVisibilityChange() {
    let document2 = this.deps.environment.document;
    if (document2 !== void 0)
      if (document2.visibilityState === "hidden")
        this.input.focusLost(), this.current === "running" && this.deps.pauseWhenHidden && (this.current = "paused", this.pausedByVisibility = !0, this.input.pause(), this.scheduler.pause());
      else if (this.deps.pauseWhenHidden)
        this.pausedByVisibility && this.current === "paused" && this.resume();
      else return;
  }
  createPhases() {
    let now = () => this.deps.environment.now();
    return {
      phase1_input: () => {
        this.applyPendingSwap(), this.framePhase = "runtime:input", this.frameStartMs = now();
        let { world } = this.deps.scene;
        world.resetBudget(), world.setFrame(this.scheduler.activeTime, this.scheduler.delta, this.scheduler.frameIndex), this.hostInputs.applyQueued({ state: world.sceneState }), this.deps.services.hud?.beginFrame?.(), this.behaviors.dispatchInput(this.input.deliver());
      },
      phase2_tick: (step2) => {
        this.framePhase = "runtime:tick", this.deps.scene.world.dynamic.flush();
        let physics = this.deps.physics;
        physics?.applyCommands(), this.behaviors.fixedUpdate(step2), physics?.stepAndDeliver();
      },
      phase3_update: (delta) => {
        this.framePhase = "runtime:update", this.behaviors.update(delta);
      },
      phase4_flush: () => {
        this.deps.scene.world.dynamic.flush();
      },
      phase5_bindings: () => {
        this.framePhase = "runtime:bindings", this.deps.scene.bindings.evaluate(), this.deps.scene.world.dynamic.evaluateBindings();
      },
      phase6_transforms: () => {
        this.deps.scene.world.propagate();
      },
      phase7_render: () => {
        this.renderStartMs = now(), this.deps.scene.renderer.frame(), this.deps.services.hud?.present?.();
        let end = now();
        this.cpuUpdateMs = this.renderStartMs - this.frameStartMs, this.renderPrepMs = end - this.renderStartMs, this.frameTimeMs = end - this.frameStartMs, this.deps.devTools?.afterFrame(this.frameTimeMs, () => this.counters()), this.hostOutputs.publish(this.deps.scene.world.sceneState);
      }
    };
  }
  /** Applies a queued candidate at the start of the next frame, before phase 1 work. */
  applyPendingSwap() {
    let pending = this.pendingSwap;
    if (pending === void 0) return;
    this.pendingSwap = void 0;
    let previous = this.deps.scene, previousManifest = this.deps.manifest, physics;
    if (pending.physicsModule !== void 0) {
      try {
        physics = new PhysicsSystem({
          backend: pending.physicsModule.backend,
          manifest: pending.manifest,
          world: pending.scene.world,
          report: (diagnostic2) => {
            this.report(diagnostic2);
          },
          deliver: (kind, slot, other) => {
            this.deliverCollision(kind, slot, other);
          }
        });
      } catch (error) {
        pending.scene.materials.dispose(), pending.scene.meshes.dispose(), pending.scene.renderer.dispose(), this.report(
          makeRuntimeDiagnostic("E8102", {
            phase: "runtime:reload",
            message: `The candidate was discarded: creating its physics world failed (${errorText5(error)}).`,
            notes: [`module: ${pending.physicsModule.url}`]
          })
        );
        return;
      }
      pending.scene.world.bodies = physics;
    }
    if (pending.restart === void 0)
      migrateWorld(previous.world, previousManifest, pending.scene.world, pending.manifest);
    else {
      let diagnostic2 = restartDiagnostic(pending.manifest, pending.restart);
      this.deps.sink.report(diagnostic2), this.deps.overlay?.add(diagnostic2), this.deps.devTools?.recordError(diagnostic2);
    }
    this.deps.test?.disableCulling === !0 && pending.scene.renderer.setFrustumCulling(!1), this.deps.devTools?.setProgram(pending.manifest), physics?.createNamedBodies(), this.deps.physics?.dispose(), this.deps.physics = physics, this.deps.physicsModule = pending.physicsModule, this.deps.scene = pending.scene, this.deps.manifest = pending.manifest, this.deps.program = pending.program, this.deps.modules = pending.modules, this.deps.assets = pending.assets, this.deps.sceneFunctions = pending.sceneFunctions, this.behaviors = new Behaviors(pending.sceneFunctions, pending.scene.world), this.hostInputs = new HostInputs(pending.manifest), this.hostOutputs.replace(pending.manifest), previous.materials.dispose(), previous.renderer.dispose(), previous.meshes.dispose();
  }
  createDebug(manual) {
    return {
      step: (frames, dtSeconds) => {
        if (!manual) throw new Error("debug.step requires mountMtek options test.manualClock");
        try {
          this.scheduler.stepManual(frames, dtSeconds);
        } catch (error) {
          if (!(error instanceof ExecutionBudgetExceeded)) throw error;
          this.failBudget(error);
        }
      },
      readPixels: () => this.current === "disposed" ? Promise.reject(new Error("readPixels: the application is disposed")) : this.deps.surface.readPixels(),
      counters: () => this.counters(),
      pressKey: (code) => {
        if (!isMappedKeyCode(code)) throw new RangeError(`debug.pressKey: '${String(code)}' is not the DOM code of a Key member`);
        this.input.keyDown(code);
      },
      releaseKey: (code) => {
        if (!isMappedKeyCode(code)) throw new RangeError(`debug.releaseKey: '${String(code)}' is not the DOM code of a Key member`);
        this.input.keyUp(code);
      },
      setParam: (entityName, param, value) => {
        if (this.current === "disposed" || this.current === "failed")
          throw new Error(`debug.setParam: the application is ${this.current}`);
        this.deps.scene.world.setParamByName(entityName, param, value);
      },
      loseDevice: () => {
        if (this.current !== "running" && this.current !== "paused") throw new Error(`debug.loseDevice: the application is ${this.current}`);
        this.simulatedLossEpoch = this.deviceEpoch, this.deps.device.destroy();
      },
      assets: () => this.deps.assets.statuses(),
      failAllocation: () => {
        if (this.current === "disposed" || this.current === "failed") throw new Error(`debug.failAllocation: the application is ${this.current}`);
        this.deps.registry.reportAllocationFailure("Allocating the GPU buffer 'debug.failAllocation' failed: out of memory (simulated).", [
          "injected by debug.failAllocation"
        ]);
      },
      scene: () => ({
        state: { ...this.deps.scene.world.sceneState },
        entities: this.deps.scene.world.entities.map((record, index) => ({
          name: this.deps.manifest.scene.entities[index]?.name ?? String(index),
          position: record.position,
          rotation: record.rotation,
          ...record.mat === null ? {} : { mat: { p: { ...record.mat.p } } }
        })),
        spawned: this.deps.scene.world.dynamic.live.map((entity) => ({
          prefab: entity.prefab.resolved.name,
          slot: entity.ref.slot,
          gen: entity.ref.gen,
          alive: !entity.removing,
          position: entity.record.position,
          rotation: entity.record.rotation,
          scale: entity.record.scale,
          visible: entity.record.visible,
          state: { ...entity.record.state },
          ...entity.record.mat === null ? {} : { mat: { p: { ...entity.record.mat.p } } }
        }))
      })
    };
  }
  counters() {
    let registry = this.deps.registry.snapshot(), { renderer, materials, world } = this.deps.scene, physics = this.deps.physics?.counts() ?? { bodies: 0, colliders: 0 }, gpuTimeMs = this.deps.devTools?.gpuTimeMs ?? null;
    return {
      ...registry,
      frameTimeMs: this.frameTimeMs,
      cpuUpdateMs: this.cpuUpdateMs,
      renderPrepMs: this.renderPrepMs,
      ...gpuTimeMs === null ? {} : { gpuTimeMs },
      gpuTimeAvailable: gpuTimeMs === null ? 0 : 1,
      drawCalls: renderer.drawCalls,
      drawCallsTotal: renderer.drawCallsCumulative,
      failedMaterials: renderer.failedMaterialCount,
      instancedDraws: renderer.instancedDraws,
      instancedDrawsTotal: renderer.instancedDrawsCumulative,
      culledObjects: renderer.culledObjects,
      culledObjectsTotal: renderer.culledObjectsCumulative,
      sharedParamBlocks: materials.sharedParamBlocks,
      ownedParamBlocks: materials.ownedParamBlocks,
      discardedSteps: this.scheduler.discardedSteps,
      liveEntities: world.dynamic.aliveCount,
      pendingSpawns: world.dynamic.pendingSpawns,
      pendingRemovals: world.dynamic.pendingRemovals,
      entitySlots: world.dynamic.slotCapacity,
      entitiesSpawned: world.dynamic.spawned,
      entitiesDestroyed: world.dynamic.destroyed,
      physicsBodies: physics.bodies,
      physicsColliders: physics.colliders,
      physicsSteps: this.deps.physics?.steps ?? 0,
      physicsFrozenBodies: this.deps.physics?.frozenBodies ?? 0,
      framesRendered: this.deps.surface.framesRendered,
      framesSkipped: this.deps.surface.framesSkipped,
      deviceLosses: this.losses,
      deviceRecoveries: this.recoveries,
      recoveryAttempts: this.recoveryAttemptsMade
    };
  }
};

// src/host/environment.ts
function browserSha256() {
  let subtle = typeof crypto > "u" ? void 0 : crypto.subtle;
  if (subtle !== void 0)
    return async (bytes) => {
      let digest = await subtle.digest("SHA-256", bytes.slice()), hex = "";
      for (let byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
      return hex;
    };
}
function browserDecodeImage(bytes) {
  return createImageBitmap(new Blob([bytes.slice()]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}
function defaultEnvironment() {
  return {
    gpu: (typeof navigator > "u" ? void 0 : navigator)?.gpu ?? null,
    fetch: (url) => fetch(url),
    fetchBytes: (url) => fetch(url),
    // A computed specifier: the bundler keeps this a real `import()` of the file the manifest names.
    importModule: (url) => import(
      /* @vite-ignore */
      url
    ),
    sha256: browserSha256(),
    decodeImage: browserDecodeImage,
    document: typeof document > "u" ? void 0 : document,
    ResizeObserver: typeof ResizeObserver > "u" ? void 0 : ResizeObserver,
    window: typeof window > "u" ? void 0 : window,
    log: (message) => {
      console.log(message);
    },
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => {
      cancelAnimationFrame(handle);
    },
    devicePixelRatio: () => typeof devicePixelRatio == "number" ? devicePixelRatio : 1,
    ...typeof matchMedia == "function" ? { matchMedia: (query) => matchMedia(query) } : {},
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      clearTimeout(handle);
    }
  };
}
var NetworkRefusedError = class extends Error {
  url;
  constructor(url, base) {
    super(`refused ${url}: a preview may only request files below its own directory (${base.href})`), this.name = "NetworkRefusedError", this.url = url;
  }
};
function isWithinBase(url, base) {
  let parsed;
  try {
    parsed = new URL(url, base);
  } catch {
    return !1;
  }
  if (parsed.protocol !== base.protocol || parsed.host !== base.host || parsed.username !== "" || parsed.password !== "") return !1;
  let directory = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return parsed.pathname.startsWith(directory) ? !/%2e|%2f|%5c/i.test(parsed.pathname.slice(directory.length)) : !1;
}
function restrictToBase(environment, base) {
  let guarded2 = (url, request) => isWithinBase(url, base) ? request() : Promise.reject(new NetworkRefusedError(url, base));
  return {
    ...environment,
    fetch: (url) => guarded2(url, () => environment.fetch(url)),
    fetchBytes: (url) => guarded2(url, () => environment.fetchBytes(url)),
    importModule: (url) => guarded2(url, () => environment.importModule(url))
  };
}

// src/host/browser-support.ts
var UNSUPPORTED_BROWSER_CODES = ["MTEK-E8004", "MTEK-E8005"];
function major(match) {
  let text = match?.[1];
  if (text === void 0) return;
  let value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : void 0;
}
function guessBrowser(userAgent) {
  let ua = userAgent, platform = "other";
  return /iPhone|iPad|iPod/.test(ua) ? platform = "ios" : /Android/.test(ua) ? platform = "android" : /CrOS/.test(ua) ? platform = "chromeos" : /Windows/.test(ua) ? platform = "windows" : /Mac OS X|Macintosh/.test(ua) ? platform = "macos" : /Linux|X11/.test(ua) && (platform = "linux"), /Edg(?:e|A|iOS)?\/(\d+)/.test(ua) ? { family: "edge", version: major(/Edg(?:e|A|iOS)?\/(\d+)/.exec(ua)), platform } : /Firefox\/(\d+)/.test(ua) || /FxiOS\/(\d+)/.test(ua) ? { family: "firefox", version: major(/Firefox\/(\d+)/.exec(ua) ?? /FxiOS\/(\d+)/.exec(ua)), platform } : /(?:Chrome|CriOS|Chromium)\/(\d+)/.test(ua) ? { family: "chrome", version: major(/(?:Chrome|CriOS|Chromium)\/(\d+)/.exec(ua)), platform } : /Safari\//.test(ua) && /Version\/(\d+)/.test(ua) ? { family: "safari", version: major(/Version\/(\d+)/.exec(ua)), platform } : { family: "other", version: void 0, platform };
}
var SUPPORTED2 = "WebGPU works in current Chrome and Edge (Windows, macOS, ChromeOS, Android), Safari 26 or newer (macOS, iPhone, iPad), and Firefox on Windows and Apple-silicon Macs.";
function unsupportedAdvice(guess, code, secureContext) {
  let steps = [];
  secureContext || steps.push("Open this page over https (or from localhost): browsers offer WebGPU only to secure pages.");
  let noAdapter = code === "MTEK-E8005";
  switch (noAdapter && steps.push("Your browser has WebGPU, but it found no usable graphics adapter. Update your graphics driver, make sure hardware acceleration is on in the browser's settings, and restart the browser."), guess.family) {
    case "chrome":
    case "edge": {
      let name = guess.family === "edge" ? "Edge" : "Chrome";
      guess.version !== void 0 && guess.version < 113 && steps.push(`Update ${name}: WebGPU needs version 113 or newer (this is ${String(guess.version)}).`), guess.platform === "linux" ? steps.push(`On Linux, ${name} enables WebGPU only for some graphics cards. Open ${guess.family === "edge" ? "edge" : "chrome"}://flags, enable "Unsafe WebGPU Support" and "Vulkan", and restart.`) : guess.platform === "android" ? steps.push(`On Android, WebGPU needs ${name} 121 or newer and Android 12 or newer.`) : noAdapter || steps.push(`Make sure "Use graphics acceleration when available" is on in ${name}'s settings, then restart ${name}.`);
      break;
    }
    case "firefox":
      guess.platform === "windows" || guess.platform === "macos" ? (steps.push("Update Firefox: WebGPU is on by default from Firefox 141 on Windows and Firefox 147 on Macs with Apple silicon."), guess.platform === "macos" && steps.push("On an Intel Mac, Firefox does not turn WebGPU on yet; use Safari 26 or Chrome.")) : steps.push('Firefox does not turn WebGPU on by default here yet. Type about:config in the address bar, set "dom.webgpu.enabled" to true and restart Firefox, or use Chrome.');
      break;
    case "safari":
      guess.version !== void 0 && guess.version < 26 ? steps.push(`Update to Safari 26 or newer (macOS 26, iOS 26 or iPadOS 26), where WebGPU is on by default (this is Safari ${String(guess.version)}). On an older Safari you can try Develop > Feature Flags > WebGPU.`) : noAdapter || steps.push("Check that WebGPU is not switched off: Develop > Feature Flags > WebGPU on a Mac, or Settings > Apps > Safari > Advanced > Feature Flags on an iPhone or iPad.");
      break;
    case "other":
      steps.push("Try a current Chrome, Edge or Safari.");
      break;
  }
  return {
    title: "This browser cannot show this game",
    summary: noAdapter ? "The game draws with WebGPU, and the browser could not find a graphics adapter for it." : "The game draws with WebGPU, which this browser does not offer here.",
    steps,
    supported: SUPPORTED2
  };
}

// src/host/overlay.ts
var MAX_OVERLAY_DIAGNOSTICS = 20, overlays = /* @__PURE__ */ new WeakMap();
function formatLocation(source) {
  return `${source.file}:${String(source.startLine)}:${String(source.startColumn)}`;
}
var FailureOverlay = class _FailureOverlay {
  /** Creates the overlay for `canvas`; any earlier overlay for the same canvas is removed first. */
  constructor(canvas) {
    this.canvas = canvas;
    _FailureOverlay.removeFor(canvas), overlays.set(canvas, this);
  }
  canvas;
  root = null;
  diagnostics = [];
  /** Removes the overlay a previous mount left on `canvas`, if any. */
  static removeFor(canvas) {
    overlays.get(canvas)?.remove();
  }
  /** The overlay element, or `null` when nothing is shown. */
  get element() {
    return this.root;
  }
  /** Replaces the listed diagnostics. */
  show(diagnostics) {
    this.diagnostics = [...diagnostics], this.render();
  }
  /** Appends one diagnostic to the list. */
  add(diagnostic2) {
    this.diagnostics.push(diagnostic2), this.render();
  }
  /** Re-aligns the panel with the canvas (call after the canvas moved or was resized). */
  reposition() {
    this.root !== null && this.applyGeometry(this.root);
  }
  /** Removes the panel from the DOM. Idempotent. */
  remove() {
    this.root?.remove(), this.root = null, this.diagnostics = [], overlays.get(this.canvas) === this && overlays.delete(this.canvas);
  }
  render() {
    let doc = this.canvas.ownerDocument, root = this.root ?? this.createRoot();
    root.replaceChildren();
    let unsupported = this.diagnostics.find((d) => UNSUPPORTED_BROWSER_CODES.includes(d.code));
    unsupported !== void 0 && root.append(this.renderUnsupported(unsupported.code));
    let heading = doc.createElement(unsupported === void 0 ? "h1" : "h2");
    heading.textContent = "Mtek could not run this program", heading.style.cssText = "margin:0 0 12px;font-size:16px;font-weight:700", root.append(heading);
    for (let diagnostic2 of this.diagnostics.slice(0, MAX_OVERLAY_DIAGNOSTICS))
      root.append(this.renderDiagnostic(diagnostic2));
    let hidden = this.diagnostics.length - MAX_OVERLAY_DIAGNOSTICS;
    if (hidden > 0) {
      let more = doc.createElement("p");
      more.textContent = `... and ${String(hidden)} more diagnostics`, root.append(more);
    }
  }
  /** The "unsupported browser" panel: what happened and what to do, for the browser in use. */
  renderUnsupported(code) {
    let doc = this.canvas.ownerDocument, view = doc.defaultView, advice = unsupportedAdvice(guessBrowser(view?.navigator.userAgent ?? ""), code, view?.isSecureContext !== !1), panel = doc.createElement("section");
    panel.setAttribute("data-mtek-unsupported-browser", code), panel.style.cssText = "margin:0 0 16px;padding:0 0 12px;border-bottom:1px solid rgba(255,255,255,.4);font:15px/1.5 system-ui,sans-serif";
    let title = doc.createElement("h1");
    title.textContent = advice.title, title.style.cssText = "margin:0 0 8px;font-size:20px;font-weight:700";
    let summary = doc.createElement("p");
    if (summary.textContent = advice.summary, summary.style.cssText = "margin:0 0 8px", panel.append(title, summary), advice.steps.length > 0) {
      let list = doc.createElement("ul");
      list.style.cssText = "margin:0 0 8px;padding-left:20px";
      for (let step2 of advice.steps) {
        let item = doc.createElement("li");
        item.textContent = step2, list.append(item);
      }
      panel.append(list);
    }
    let supported = doc.createElement("p");
    return supported.textContent = advice.supported, supported.style.cssText = "margin:0;opacity:.85", panel.append(supported), panel;
  }
  renderDiagnostic(diagnostic2) {
    let doc = this.canvas.ownerDocument, section = doc.createElement("section");
    section.setAttribute("data-mtek-diagnostic", diagnostic2.code), section.style.cssText = "margin:0 0 12px;padding:0 0 8px;border-bottom:1px solid rgba(255,255,255,.25)";
    let title = doc.createElement("h2");
    title.textContent = `${diagnostic2.code}: ${diagnostic2.title}`, title.style.cssText = "margin:0 0 4px;font-size:14px;font-weight:700", section.append(title);
    let message = doc.createElement("p");
    if (message.textContent = diagnostic2.message, message.style.cssText = "margin:0 0 4px;white-space:pre-wrap", section.append(message), diagnostic2.source !== null) {
      let location = doc.createElement("p");
      location.setAttribute("data-mtek-location", ""), location.textContent = formatLocation(diagnostic2.source), location.style.cssText = "margin:0 0 4px;opacity:.8", section.append(location);
    }
    for (let note of diagnostic2.notes) {
      let line = doc.createElement("p");
      line.textContent = note, line.style.cssText = "margin:0 0 2px;opacity:.8;white-space:pre-wrap", section.append(line);
    }
    return section;
  }
  createRoot() {
    let doc = this.canvas.ownerDocument, root = doc.createElement("div");
    return root.setAttribute("role", "alert"), root.setAttribute("aria-live", "assertive"), root.setAttribute("data-mtek-overlay", ""), root.style.cssText = "position:absolute;box-sizing:border-box;overflow:auto;z-index:2147483647;padding:16px;background:rgba(32,0,0,.92);color:#fff;font:13px/1.4 ui-monospace,Consolas,monospace", this.applyGeometry(root), (this.canvas.parentElement ?? doc.body).insertBefore(root, this.canvas.parentElement === null ? null : this.canvas.nextSibling), this.root = root, root;
  }
  /** Same box as the canvas, in the coordinate space of its offset parent. */
  applyGeometry(root) {
    let canvas = this.canvas;
    root.style.left = `${String(canvas.offsetLeft)}px`, root.style.top = `${String(canvas.offsetTop)}px`, root.style.width = `${String(canvas.offsetWidth)}px`, root.style.height = `${String(canvas.offsetHeight)}px`;
  }
};

// src/dev/gpu-timer.ts
var TIMESTAMP_FEATURE = "timestamp-query";
function hasTimestampQuery(device) {
  return device.features.has(TIMESTAMP_FEATURE);
}
var GpuTimer = class {
  querySet;
  resolveBuffer;
  readBuffer;
  armed = !1;
  inFlight = !1;
  disposed = !1;
  last = null;
  completed = 0;
  /** Throws when the device lacks `timestamp-query` (check `hasTimestampQuery` first). */
  constructor(device, registry) {
    if (!hasTimestampQuery(device)) throw new Error("GpuTimer: the device was created without timestamp-query");
    this.querySet = device.createQuerySet({ label: "mtek gpu timer", type: "timestamp", count: 2 }), this.resolveBuffer = registry.createBuffer({
      label: "mtek gpu timer resolve",
      size: 16,
      usage: 516
    }), this.readBuffer = registry.createBuffer({
      label: "mtek gpu timer read",
      size: 16,
      usage: 9
    });
  }
  /** GPU time of the render pass in milliseconds from the latest completed measurement; `null` before the first one. */
  get lastMs() {
    return this.last;
  }
  /** Measurements completed so far. */
  get measurements() {
    return this.completed;
  }
  passTimestampWrites() {
    if (!(this.disposed || this.inFlight))
      return this.armed = !0, { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }
  resolve(encoder) {
    this.armed && (encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0), encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16));
  }
  submitted() {
    this.armed && (this.armed = !1, this.inFlight = !0, this.readBuffer.mapAsync(1).then(
      () => {
        if (this.disposed) return;
        let [begin, end] = new BigUint64Array(this.readBuffer.getMappedRange().slice(0, 16));
        this.readBuffer.unmap(), this.inFlight = !1, begin !== void 0 && end !== void 0 && end >= begin && (this.last = Number(end - begin) / 1e6, this.completed += 1);
      },
      () => {
        this.inFlight = !1;
      }
    ));
  }
  /** Stops measuring and destroys the query set. The buffers belong to the registry. Idempotent. */
  dispose() {
    this.disposed || (this.disposed = !0, this.querySet.destroy());
  }
};

// src/dev/frame-stats.ts
function nearestRank(sortedAscending, percent) {
  let n = sortedAscending.length;
  if (n === 0) return;
  let rank = Math.min(n, Math.max(1, Math.ceil(percent / 100 * n)));
  return sortedAscending[rank - 1];
}
var FrameStats = class {
  times = [];
  next = 0;
  /** Records one frame time in milliseconds; non-finite values are ignored. */
  push(ms2) {
    Number.isFinite(ms2) && (this.times.length < 120 ? this.times.push(ms2) : this.times[this.next] = ms2, this.next = (this.next + 1) % 120);
  }
  /** Frames currently in the window (at most `FRAME_WINDOW`). */
  get count() {
    return this.times.length;
  }
  /** The nearest-rank percentile of the window; `undefined` before the first frame. */
  percentile(percent) {
    return nearestRank([...this.times].sort((a, b) => a - b), percent);
  }
};

// src/dev/panel.ts
var PANEL_KEYS_HELP = "` hide/show   Shift+` next entity";
function ms(value) {
  return value === void 0 ? "-" : value.toFixed(2);
}
function count(counters, name) {
  let value = counters[name];
  return value === void 0 ? "?" : String(value);
}
function panelLines(data) {
  let c = data.counters, lines = [];
  if (lines.push(`scene: ${data.scene}`), data.entity === null) lines.push("entity: (none)");
  else {
    let { item, position, count: total } = data.entity;
    lines.push(`entity: ${item.name} (${String(position + 1)}/${String(total)}) ${item.source ?? "source unknown"}`);
  }
  if (lines.push(`frame time: ${ms(data.frame.lastMs)} ms  p50 ${ms(data.frame.p50Ms)}  p95 ${ms(data.frame.p95Ms)}  (last ${String(data.frame.samples)} frames)`), lines.push(`cpu update: ${ms(c.cpuUpdateMs)} ms  render prep: ${ms(c.renderPrepMs)} ms`), data.gpuTimeMs !== null ? lines.push(`GPU time: ${ms(data.gpuTimeMs)} ms`) : lines.push(data.gpuTimeActive ? "GPU time: pending" : "GPU time unavailable"), lines.push(`draw calls: ${count(c, "drawCalls")}  instanced draws: ${count(c, "instancedDraws")}  culled objects: ${count(c, "culledObjects")}`), lines.push(`uploads: ${count(c, "uploads")}  upload bytes: ${count(c, "uploadBytes")}`), lines.push(
    `created: pipelines ${count(c, "pipelinesCreated")}  shader modules ${count(c, "shaderModulesCreated")}  bind groups ${count(c, "bindGroupsCreated")}  buffers ${count(c, "buffersAllocated")}  textures ${count(c, "texturesAllocated")}`
  ), lines.push(
    `live: buffers ${count(c, "liveBuffers")}  textures ${count(c, "liveTextures")}  samplers ${count(c, "liveSamplers")}  shader modules ${count(c, "liveShaderModules")}  pipelines ${count(c, "livePipelines")}  bind groups ${count(c, "liveBindGroups")}  listeners ${count(c, "liveListeners")}  entities ${count(c, "liveEntities")}`
  ), lines.push(`discarded steps: ${count(c, "discardedSteps")}`), data.errors.length === 0) lines.push("errors: none");
  else {
    lines.push(`errors: ${String(data.errors.length)}`);
    for (let error of data.errors) lines.push(`  ${error}`);
  }
  return lines.push(`keys: ${PANEL_KEYS_HELP}`), lines;
}

// src/dev/overlay.ts
var DEV_OVERLAY_ATTRIBUTE = "data-mtek-dev-overlay", DevOverlay = class {
  constructor(options) {
    this.options = options;
    let { keyTarget, listen } = options;
    keyTarget !== void 0 && listen(keyTarget, "keydown", (event) => {
      this.onKey(event);
    });
  }
  options;
  root = null;
  shown = !0;
  selected = 0;
  entities = [];
  last = null;
  /** The panel element; `null` before the first update and after `remove`. */
  get element() {
    return this.root;
  }
  /** Whether the panel is currently shown (it starts shown). */
  get visible() {
    return this.shown;
  }
  /** Index of the selected entity in the list last given to `setEntities`. */
  get selectedIndex() {
    return this.selected;
  }
  /** The entities the panel can cycle through (the scene's, in instance order). The selection is kept when it still exists. */
  setEntities(entities) {
    this.entities = entities, this.selected >= entities.length && (this.selected = 0);
  }
  /** The currently selected entity, with its position in the cycle. */
  selection() {
    let item = this.entities[this.selected];
    return item === void 0 ? null : { item, position: this.selected, count: this.entities.length };
  }
  toggle() {
    this.shown = !this.shown, this.root !== null && (this.root.style.display = this.shown ? "block" : "none"), this.shown && this.last !== null && this.render(this.last);
  }
  selectNext() {
    this.entities.length !== 0 && (this.selected = (this.selected + 1) % this.entities.length, this.shown && this.last !== null && this.render({ ...this.last, entity: this.selection() }));
  }
  /** Shows `data` (the `entity` field is replaced by the overlay's own selection). While hidden only the data is remembered. */
  update(data) {
    this.last = { ...data, entity: this.selection() }, this.shown && this.render(this.last);
  }
  /** Re-aligns the panel with the canvas (call after the canvas moved or was resized). */
  reposition() {
    this.root !== null && this.applyGeometry(this.root);
  }
  /** Removes the panel from the DOM. Idempotent. Key listeners belong to the registry. */
  remove() {
    this.root?.remove(), this.root = null, this.last = null;
  }
  onKey(event) {
    event.code !== "Backquote" || event.ctrlKey || event.altKey || event.metaKey || (event.shiftKey ? this.shown && this.selectNext() : this.toggle());
  }
  render(data) {
    let root = this.root ?? this.createRoot();
    root.textContent = panelLines(data).join(`
`);
  }
  createRoot() {
    let canvas = this.options.canvas, doc = canvas.ownerDocument, root = doc.createElement("pre");
    return root.setAttribute(DEV_OVERLAY_ATTRIBUTE, ""), root.setAttribute("aria-hidden", "true"), root.style.cssText = "position:absolute;box-sizing:border-box;margin:0;padding:8px 10px;max-width:90%;overflow:hidden;pointer-events:none;z-index:2147483646;white-space:pre-wrap;background:rgba(0,0,0,.72);color:#e8f4e8;font:11px/1.35 ui-monospace,Consolas,monospace", this.applyGeometry(root), root.style.display = this.shown ? "block" : "none", (canvas.parentElement ?? doc.body).insertBefore(root, canvas.parentElement === null ? null : canvas.nextSibling), this.root = root, root;
  }
  /** The top-left corner of the canvas, in the coordinate space of its offset parent. */
  applyGeometry(root) {
    root.style.left = `${String(this.options.canvas.offsetLeft + 8)}px`, root.style.top = `${String(this.options.canvas.offsetTop + 8)}px`;
  }
};

// src/dev/tools.ts
var MAX_PANEL_ERRORS = 4;
function panelEntities(manifest) {
  return manifest.scene.entities.map((entity) => {
    let span = spanOfSymbol(manifest, entity.symbol), source = span === void 0 ? null : resolveSpan(manifest, span);
    return { name: entity.name, source: source === null ? null : `${source.file}:${String(source.startLine)}` };
  });
}
function errorLine(diagnostic2) {
  let first = diagnostic2.message.split(`
`, 1)[0] ?? "";
  return `${diagnostic2.code}: ${first.length > 120 ? `${first.slice(0, 117)}...` : first}`;
}
var DevTools = class {
  overlay;
  stats = new FrameStats();
  timer;
  scene;
  errors = [];
  constructor(options) {
    this.timer = options.timer, this.overlay = new DevOverlay(options), this.scene = options.manifest.entryScene, this.overlay.setEntities(panelEntities(options.manifest));
  }
  /** The program changed (hot reload): refresh the scene name and the entity list. */
  setProgram(manifest) {
    this.scene = manifest.entryScene, this.overlay.setEntities(panelEntities(manifest));
  }
  /** Remembers an error diagnostic for the panel; only the latest `MAX_PANEL_ERRORS` are kept. */
  recordError(diagnostic2) {
    this.errors.push(errorLine(diagnostic2)), this.errors.length > MAX_PANEL_ERRORS && (this.errors = this.errors.slice(-MAX_PANEL_ERRORS));
  }
  /** GPU time in ms from the latest completed measurement; `null` when unavailable or not yet measured. */
  get gpuTimeMs() {
    return this.timer?.lastMs ?? null;
  }
  /** Whether `timestamp-query` is in use. */
  get gpuTimeActive() {
    return this.timer !== null;
  }
  /** Called at the end of every frame; `counters` is only evaluated when the panel is shown. */
  afterFrame(frameTimeMs, counters) {
    this.stats.push(frameTimeMs), this.overlay.visible && this.overlay.update({
      scene: this.scene,
      entity: null,
      frame: { lastMs: frameTimeMs, p50Ms: this.stats.percentile(50), p95Ms: this.stats.percentile(95), samples: this.stats.count },
      gpuTimeMs: this.gpuTimeMs,
      gpuTimeActive: this.gpuTimeActive,
      counters: counters(),
      errors: this.errors
    });
  }
  reposition() {
    this.overlay.reposition();
  }
  /**
   * The device was lost and replaced (decision 0056): the timer's query set and buffers belonged to the lost
   * device and were released with it, so GPU time is unavailable from here on instead of reading a dead timer.
   */
  deviceRecovered() {
    this.timer = null;
  }
  /** Removes the panel and stops the GPU timer. Idempotent. */
  dispose() {
    this.overlay.remove(), this.timer?.dispose();
  }
};

// src/random/xoshiro.ts
var Xoshiro128 = class {
  s0;
  s1;
  s2;
  s3;
  constructor(seed) {
    let x = seed >>> 0, next = () => {
      x = x + 2654435769 >>> 0;
      let z = x;
      return z = Math.imul(z ^ z >>> 16, 2246822507) >>> 0, z = Math.imul(z ^ z >>> 13, 3266489909) >>> 0, (z ^ z >>> 16) >>> 0;
    };
    this.s0 = next(), this.s1 = next(), this.s2 = next(), this.s3 = next();
  }
  /** The next 32 random bits. */
  nextU32() {
    let rotl = (v, k) => (v << k | v >>> 32 - k) >>> 0, result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0, t = this.s1 << 9 >>> 0;
    return this.s2 = (this.s2 ^ this.s0) >>> 0, this.s3 = (this.s3 ^ this.s1) >>> 0, this.s1 = (this.s1 ^ this.s2) >>> 0, this.s0 = (this.s0 ^ this.s3) >>> 0, this.s2 = (this.s2 ^ t) >>> 0, this.s3 = rotl(this.s3, 11), result;
  }
  /** `random()`: an f32 in `[0, 1)`; the top 24 bits, so every value is exactly representable. */
  nextF32() {
    return (this.nextU32() >>> 8) / 16777216;
  }
};

// src/host/mount.ts
function errorText6(error) {
  return error instanceof Error ? error.message === "" ? error.name : error.message : String(error);
}
function mountDiagnostic(code, message, notes = []) {
  return makeRuntimeDiagnostic(code, { phase: "runtime:mount", message, notes });
}
function budgetDiagnostic(manifest, error) {
  let limit = manifest.preview?.loopBudget;
  return makeRuntimeDiagnostic("E8080", {
    phase: "runtime:mount",
    message: limit === void 0 ? "A loop ran past the execution budget of this preview while the scene was initialised." : `A loop ran past the execution budget of ${String(limit)} iterations while the scene was initialised.`,
    source: resolveSpan(manifest, error.spanId),
    notes: ["help: bound the loop, or build the preview with a larger --loop-budget if the program really needs the iterations"]
  });
}
function validateOptions(options) {
  let { failureDisplay, devicePixelRatio: devicePixelRatio2, seed, test } = options;
  if (failureDisplay !== void 0 && failureDisplay !== "overlay" && failureDisplay !== "none")
    throw new TypeError(`mountMtek: failureDisplay must be "overlay" or "none", got ${String(failureDisplay)}`);
  if (devicePixelRatio2 !== void 0 && devicePixelRatio2 !== "auto" && !(Number.isFinite(devicePixelRatio2) && devicePixelRatio2 > 0))
    throw new RangeError(`mountMtek: devicePixelRatio must be "auto" or a positive finite number, got ${String(devicePixelRatio2)}`);
  if (seed !== void 0 && !Number.isFinite(seed))
    throw new RangeError(`mountMtek: seed must be a finite number, got ${String(seed)}`);
  if (test?.textures !== void 0 && checkTestTextures(test.textures), test?.onAssetState !== void 0 && typeof test.onAssetState != "function")
    throw new TypeError("mountMtek: test.onAssetState must be a function");
  let target = test?.renderTarget;
  if (target !== void 0) {
    for (let [name, value] of [["width", target.width], ["height", target.height]])
      if (!Number.isInteger(value) || value < 1)
        throw new RangeError(`mountMtek: test.renderTarget.${name} must be a positive integer, got ${String(value)}`);
  }
  if (test?.canvasRenderTarget === !0 && target !== void 0)
    throw new TypeError("mountMtek: test.canvasRenderTarget and test.renderTarget exclude each other");
  let recovery = test?.recovery;
  if (recovery?.delaysMs !== void 0) {
    let delays = recovery.delaysMs;
    if (delays.length !== RECOVERY_ATTEMPTS || !delays.every((delay) => typeof delay == "number" && Number.isFinite(delay) && delay >= 0))
      throw new RangeError(
        `mountMtek: test.recovery.delaysMs must be ${String(RECOVERY_ATTEMPTS)} non-negative finite numbers, got ${JSON.stringify(recovery.delaysMs)}`
      );
  }
  let injected = recovery?.failDeviceRequests;
  if (injected !== void 0 && !(Number.isInteger(injected) && injected >= 0))
    throw new RangeError(`mountMtek: test.recovery.failDeviceRequests must be a non-negative integer, got ${String(injected)}`);
}
function rememberingFetch(environment) {
  let bodies = /* @__PURE__ */ new Map();
  return async (url, reuseFrom) => {
    let known = bodies.get(url) ?? (reuseFrom === void 0 ? void 0 : bodies.get(reuseFrom));
    if (known !== void 0)
      return bodies.set(url, known), { ok: !0, status: 200, text: () => Promise.resolve(known) };
    let response = await environment.fetch(url);
    if (!response.ok) return response;
    let text = await response.text();
    return bodies.set(url, text), { ok: !0, status: response.status, text: () => Promise.resolve(text) };
  };
}
async function loadManifest(environment, url) {
  let text;
  try {
    let response = await environment.fetch(url.href);
    if (!response.ok)
      throw mountError([
        mountDiagnostic("E8006", `The manifest could not be loaded: HTTP ${String(response.status)} for ${url.href}.`, ["field: manifestUrl"])
      ]);
    text = await response.text();
  } catch (error) {
    throw error instanceof MtekMountError ? error : mountError([
      mountDiagnostic("E8006", `The manifest could not be loaded from ${url.href}: ${errorText6(error)}`, ["field: manifestUrl"])
    ]);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw mountError([mountDiagnostic("E8006", `The manifest is not valid JSON: ${errorText6(error)}`, ["field: manifest"])]);
  }
  let result = checkManifest(json);
  if (!result.ok) throw mountError(result.failures.map((failure2) => abiFailureToDiagnostic(failure2)));
  return result.manifest;
}
function deviceCapabilities(acquired, gpu) {
  let limits = acquired.adapter.limits;
  return {
    hasFeature: (name) => acquired.adapter.features.has(name),
    hasWgslLanguageFeature: (name) => gpu.wgslLanguageFeatures.has(name),
    limit: (name) => {
      let value = limits[name];
      return typeof value == "number" ? value : void 0;
    }
  };
}
function mountMtek(canvas, program, options) {
  return mountMtekWith(defaultEnvironment(), canvas, program, options);
}
async function mountMtekWith(environment, canvas, program, options = {}) {
  validateOptions(options), FailureOverlay.removeFor(canvas);
  let sink = new DiagnosticSink(options.onDiagnostic), overlay = options.failureDisplay === "none" ? null : new FailureOverlay(canvas), acquired, registry, surface, app, images, physics, audio, hud, early = {}, allocationFailures = [], earlyReports = [];
  try {
    if (program.abi !== 1)
      throw mountError([
        mountDiagnostic(
          "E8003",
          `Incompatible program: the program module's \`abi\` is ${String(program.abi)}, this runtime implements 1.`,
          ["field: abi"]
        )
      ]);
    let manifest = await loadManifest(environment, program.manifestUrl);
    if (manifest.preview !== void 0) {
      if (!isWithinBase(program.manifestUrl.href, program.baseUrl))
        throw mountError([
          mountDiagnostic("E8006", `The manifest of a preview was fetched from ${program.manifestUrl.href}, outside baseUrl ${program.baseUrl.href}.`, [
            "field: manifestUrl"
          ])
        ]);
      environment = restrictToBase(environment, program.baseUrl);
    }
    let structure = resolveStructure(manifest);
    if (!structure.ok) throw mountError(structure.diagnostics);
    let checked = checkProgram(program, manifest);
    if (!checked.ok) throw mountError(checked.diagnostics);
    let physicsLoad = manifest.subsystems.physics ? loadPhysicsBackend({ manifest, baseUrl: program.baseUrl, importModule: (url) => environment.importModule(url), phase: "runtime:mount" }) : void 0, required = manifest.requiredCapabilities;
    acquired = await acquireDevice({
      requiredFeatures: [...required.features],
      requiredLimits: { ...required.limits },
      optionalFeatures: [TIMESTAMP_FEATURE],
      onDeviceLost: (info) => {
        app !== void 0 ? app.handleDeviceLost(info) : info.reason !== "destroyed" && (early.lost = info);
      },
      onUncapturedError: (event) => {
        app !== void 0 ? app.handleUncapturedError(event.error) : sink.report(mountDiagnostic("E8050", `A GPU validation error was not captured by an error scope: ${event.error.message}`));
      },
      environment: {
        gpu: environment.gpu,
        ...environment.littleEndian === void 0 ? {} : { littleEndian: environment.littleEndian }
      }
    });
    let { device } = acquired, gpu = environment.gpu;
    if (gpu === null) throw new Error("internal error: a device was acquired without WebGPU");
    let unmet = checkDeviceCapabilities(required, deviceCapabilities(acquired, gpu));
    if (unmet.length > 0) throw mountError(unmet.map((failure2) => abiFailureToDiagnostic(failure2)));
    registry = new ResourceRegistry(device, {
      phase: "runtime:mount",
      onAllocationFailure: (diagnostic2) => {
        app !== void 0 ? app.handleAllocationFailure(diagnostic2) : allocationFailures.push(diagnostic2);
      }
    });
    let context = canvas.getContext("webgpu");
    if (context === null)
      throw mountError([
        mountDiagnostic("E8004", "The canvas could not provide a WebGPU context.", [
          "help: the canvas may already have a different context type (2d, webgl)"
        ])
      ]);
    let format = gpu.getPreferredCanvasFormat();
    if (srgbViewFormat(format) === void 0)
      throw mountError([
        mountDiagnostic("E8002", `The preferred canvas format '${format}' has no sRGB view format; Mtek needs bgra8unorm or rgba8unorm.`)
      ]);
    let dprOption = options.devicePixelRatio ?? "auto", timer = options.devOverlay === !0 && hasTimestampQuery(device) ? new GpuTimer(device, registry) : null;
    surface = new Surface({
      timer: timer ?? void 0,
      canvas,
      context,
      device,
      registry,
      format,
      renderTarget: options.test?.renderTarget,
      canvasRenderTarget: options.test?.canvasRenderTarget === !0,
      devicePixelRatio: typeof dprOption == "number" ? () => dprOption : () => environment.devicePixelRatio()
    });
    let maxDimension = device.limits.maxTextureDimension2D, target = options.test?.renderTarget;
    if (target !== void 0 && (target.width > maxDimension || target.height > maxDimension))
      throw new RangeError(`mountMtek: test.renderTarget exceeds the device limit maxTextureDimension2D (${String(maxDimension)})`);
    try {
      surface.configure();
    } catch (error) {
      throw mountError([mountDiagnostic("E8002", "Configuring the canvas for WebGPU failed.", [`browser message: ${errorText6(error)}`])]);
    }
    try {
      surface.allocate();
    } catch (error) {
      throw allocationFailures.length === 0 ? error : mountError(allocationFailures);
    }
    let fetchShaderFile = rememberingFetch(environment), [shaders, loadedAssets, loadedPhysics] = await Promise.all([
      loadStartupShaders({
        manifest,
        baseUrl: program.baseUrl,
        device,
        registry,
        fetch: fetchShaderFile
      }),
      loadAssets({
        manifest,
        baseUrl: program.baseUrl,
        environment,
        maxTextureDimension2D: device.limits.maxTextureDimension2D,
        ...options.test?.onAssetState === void 0 ? {} : { onState: options.test.onAssetState }
      }),
      physicsLoad ?? Promise.resolve(void 0)
    ]);
    images = loadedAssets.images;
    let startupFailures = [...shaders.diagnostics, ...loadedAssets.diagnostics, ...loadedPhysics?.ok === !1 ? loadedPhysics.diagnostics : []];
    if (startupFailures.length > 0) throw mountError(startupFailures);
    let assets = loadedAssets.assets, seed = options.seed === void 0 ? (Math.floor(environment.now() * 1e3) ^ Date.now()) >>> 0 : Math.trunc(options.seed) >>> 0, generator = new Xoshiro128(seed), input = new InputState(), listening = {};
    audio = new AudioSystem({
      manifest,
      bytes: (url) => assets.has(url) ? assets.bytes(url) : void 0,
      backend: environment.audio === void 0 ? browserAudioBackend() : environment.audio ?? void 0,
      report: (diagnostic2) => {
        app !== void 0 ? app.report(diagnostic2) : earlyReports.push(diagnostic2);
      },
      listener: () => listening.world?.camera
    }), hud = environment.document === void 0 ? void 0 : new HudSystem({
      canvas,
      document: environment.document,
      manifest,
      report: (diagnostic2) => {
        app !== void 0 ? app.report(diagnostic2) : earlyReports.push(diagnostic2);
      }
    });
    let services = {
      random: () => generator.nextF32(),
      isKeyDown: (code) => input.isKeyDown(code),
      print: (message) => {
        environment.log?.(message);
      },
      audio,
      ...hud === void 0 ? {} : { hud }
    }, started;
    try {
      started = await startScene({
        manifest,
        structure: structure.structure,
        program: checked.program,
        device,
        registry,
        surface,
        modules: shaders.modules,
        services,
        report: (diagnostic2) => {
          app !== void 0 ? app.report(diagnostic2) : earlyReports.push(diagnostic2);
        },
        assets: { files: assets, images },
        ...options.test?.textures === void 0 ? {} : { textures: options.test.textures },
        ...options.test?.disableInstancing === !0 ? { instancing: !1 } : {}
      });
    } catch (error) {
      throw allocationFailures.length > 0 ? mountError(allocationFailures) : error instanceof ExecutionBudgetExceeded ? mountError([budgetDiagnostic(manifest, error)]) : error;
    }
    if (closeImages(images), !started.ok) throw mountError(started.diagnostics);
    if (listening.world = started.scene.world, audio.hasSounds) {
      let unlocking = audio, unlock = () => {
        unlocking.unlock();
      };
      for (let type of ["pointerdown", "touchend", "mousedown"]) registry.addEventListener(canvas, type, unlock, { capture: !0 });
      environment.document !== void 0 && registry.addEventListener(environment.document, "keydown", unlock, { capture: !0 });
    }
    if (loadedPhysics?.ok === !0)
      try {
        physics = new PhysicsSystem({
          backend: loadedPhysics.backend,
          manifest,
          world: started.scene.world,
          report: (diagnostic2) => {
            app !== void 0 ? app.report(diagnostic2) : earlyReports.push(diagnostic2);
          },
          deliver: (kind, slot, other) => {
            app?.deliverCollision(kind, slot, other);
          }
        }), started.scene.world.bodies = physics, physics.createNamedBodies();
      } catch (error) {
        throw mountError([
          makeRuntimeDiagnostic("E8102", {
            phase: "runtime:mount",
            message: `The physics module could not be loaded: creating the physics world and its bodies failed (${errorText6(error)}).`,
            notes: [`module: ${loadedPhysics.url}`]
          })
        ]);
      }
    if (await device.queue.onSubmittedWorkDone(), allocationFailures.length > 0) throw mountError(allocationFailures);
    if (early.lost !== void 0)
      throw mountError([
        mountDiagnostic("E8002", `The GPU device was lost while mounting (${early.lost.reason}): ${early.lost.message}`)
      ]);
    let live = registry, devTools = options.devOverlay === !0 && environment.document !== void 0 ? new DevTools({
      canvas,
      keyTarget: environment.document,
      listen: (target2, type, listener) => {
        live.addEventListener(target2, type, listener);
      },
      manifest,
      timer
    }) : null;
    app = new MountedApp({
      devTools,
      manifest,
      device,
      registry,
      surface,
      sink,
      overlay,
      environment,
      canvas,
      pauseWhenHidden: options.pauseWhenHidden ?? manifest.runtimeConfig.pauseWhenHidden,
      test: options.test,
      watchPixelRatio: dprOption === "auto",
      fetchShaderFile,
      assets,
      acquireDevice: (handlers) => acquireDevice({
        requiredFeatures: [...required.features],
        requiredLimits: { ...required.limits },
        onDeviceLost: handlers.onDeviceLost,
        onUncapturedError: handlers.onUncapturedError,
        environment: {
          gpu: environment.gpu,
          ...environment.littleEndian === void 0 ? {} : { littleEndian: environment.littleEndian }
        }
      }),
      seed,
      input,
      services,
      sceneFunctions: checked.program.scene,
      scene: started.scene,
      physics,
      physicsModule: loadedPhysics?.ok === !0 ? { url: loadedPhysics.url, backend: loadedPhysics.backend } : void 0,
      modules: new Map(shaders.modules),
      program
    });
    for (let name of Object.keys(options.inputs ?? {}).sort()) {
      let value = options.inputs[name], result = app.setInput(name, value);
      result.ok || sink.report(
        makeRuntimeDiagnostic(result.error.code === "MTEK-E8100" ? "E8100" : result.error.code === "MTEK-E8041" ? "E8041" : "E8040", {
          phase: "runtime:input",
          message: result.error.message
        })
      );
    }
    for (let diagnostic2 of earlyReports) app.report(diagnostic2);
    return app;
  } catch (error) {
    if (images !== void 0 && closeImages(images), audio?.dispose(), hud?.dispose(), physics?.dispose(), surface?.dispose(), registry?.destroyAll(), acquired !== void 0 && (acquired.device.onuncapturederror = null, acquired.device.destroy()), error instanceof MtekMountError) {
      for (let diagnostic2 of error.diagnostics) sink.report(diagnostic2);
      overlay?.show(error.diagnostics);
    }
    throw error;
  }
}

// src/math/scalar.ts
var fr2 = Math.fround;
function fadd(a, b) {
  return fr2(a + b);
}
function fsub(a, b) {
  return fr2(a - b);
}
function fmul(a, b) {
  return fr2(a * b);
}
function fdiv(a, b) {
  return fr2(a / b);
}
function frem(a, b) {
  return fr2(a % b);
}
function fneg(a) {
  return -a;
}
function abs(x) {
  return Math.abs(x);
}
function min(a, b) {
  return b < a || a !== a ? b : a;
}
function max(a, b) {
  return b > a || a !== a ? b : a;
}
function clamp2(x, lo, hi) {
  return min(max(x, lo), hi);
}
function saturate(x) {
  return min(max(x, 0), 1);
}
function mix(a, b, t) {
  return fr2(fr2(a * fr2(1 - t)) + fr2(b * t));
}
function step(edge, x) {
  return x >= edge ? 1 : 0;
}
function smoothstep(e0, e1, x) {
  let t = clamp2(fr2(fr2(x - e0) / fr2(e1 - e0)), 0, 1);
  return fr2(fr2(t * t) * fr2(3 - fr2(2 * t)));
}
function sqrt(x) {
  return fr2(Math.sqrt(x));
}
function inverseSqrt(x) {
  return fr2(1 / Math.sqrt(x));
}
function pow(base, exponent) {
  return base === 1 || base === -1 && (exponent === 1 / 0 || exponent === -1 / 0) ? 1 : fr2(Math.pow(base, exponent));
}
function exp(x) {
  return fr2(Math.exp(x));
}
function exp2(x) {
  return fr2(Math.pow(2, x));
}
function log(x) {
  return fr2(Math.log(x));
}
function log2(x) {
  return fr2(Math.log2(x));
}
function sin(x) {
  return fr2(Math.sin(x));
}
function cos(x) {
  return fr2(Math.cos(x));
}
function tan(x) {
  return fr2(Math.tan(x));
}
function asin(x) {
  return fr2(Math.asin(x));
}
function acos(x) {
  return fr2(Math.acos(x));
}
function atan(x) {
  return fr2(Math.atan(x));
}
function atan2(y, x) {
  return fr2(Math.atan2(y, x));
}
function floor(x) {
  return Math.floor(x);
}
function ceil(x) {
  return Math.ceil(x);
}
function trunc(x) {
  return Math.trunc(x);
}
function fract(x) {
  return fr2(x - Math.floor(x));
}
function sign(x) {
  return x > 0 ? 1 : x < 0 ? -1 : x === 0 ? 0 : x;
}
var INTEGRAL_THRESHOLD = 8388608;
function round(x) {
  if (!(Math.abs(x) < INTEGRAL_THRESHOLD)) return x;
  let down = Math.floor(x), diff = x - down, result;
  return diff < 0.5 ? result = down : diff > 0.5 ? result = down + 1 : result = down % 2 === 0 ? down : down + 1, result === 0 && (x < 0 || Object.is(x, -0)) ? -0 : result;
}
var RADIANS_PER_DEGREE = fr2(Math.PI / 180), DEGREES_PER_RADIAN = fr2(180 / Math.PI);
function radians(x) {
  return fr2(x * RADIANS_PER_DEGREE);
}
function degrees(x) {
  return fr2(x * DEGREES_PER_RADIAN);
}
function length(x) {
  return Math.abs(x);
}
function distance(a, b) {
  return Math.abs(fr2(a - b));
}

// src/math/integer.ts
var I32_MIN = -2147483648, I32_MAX = 2147483647, U32_MAX = 4294967295;
function iadd(a, b) {
  return a + b | 0;
}
function isub(a, b) {
  return a - b | 0;
}
function imul(a, b) {
  return Math.imul(a, b);
}
function ineg(a) {
  return -a | 0;
}
function idiv(a, b) {
  return b === 0 ? a : a / b | 0;
}
function irem(a, b) {
  return b === 0 ? 0 : a % b | 0;
}
function uadd(a, b) {
  return a + b >>> 0;
}
function usub(a, b) {
  return a - b >>> 0;
}
function umul(a, b) {
  return Math.imul(a, b) >>> 0;
}
function udiv(a, b) {
  return b === 0 ? a : a / b >>> 0;
}
function urem(a, b) {
  return b === 0 ? 0 : a % b >>> 0;
}
function iabs(x) {
  return x < 0 ? -x | 0 : x;
}
function uabs(x) {
  return x;
}
function imin(a, b) {
  return b < a ? b : a;
}
function imax(a, b) {
  return b > a ? b : a;
}
function iclamp(x, lo, hi) {
  return imin(imax(x, lo), hi);
}
var umin = imin, umax = imax, uclamp = iclamp, I32_MAX_F32 = 2147483520, U32_MAX_F32 = 4294967040;
function f2i(x) {
  return x !== x ? 0 : x >= I32_MAX_F32 ? I32_MAX_F32 : x <= -2147483648 ? -2147483648 : x | 0;
}
function f2u(x) {
  return x !== x ? 0 : x >= U32_MAX_F32 ? U32_MAX_F32 : x <= 0 ? 0 : x >>> 0;
}
function i2f(x) {
  return Math.fround(x);
}
var u2f = i2f;
function i2u(x) {
  return x >>> 0;
}
function u2i(x) {
  return x | 0;
}
var reportedIndexSpans = /* @__PURE__ */ new WeakMap();
function clampIndex(i, n, spanId, ctx) {
  if (i >= 0 && i < n) return i;
  let spans = reportedIndexSpans.get(ctx);
  return spans === void 0 && (spans = /* @__PURE__ */ new Set(), reportedIndexSpans.set(ctx, spans)), spans.has(spanId) || (spans.add(spanId), ctx.warn("W8030", spanId)), i < 0 ? 0 : n - 1;
}

// src/math/vector.ts
var fr3 = Math.fround;
function v2(x, y) {
  return { x: fr3(x), y: fr3(y) };
}
function v3(x, y, z) {
  return { x: fr3(x), y: fr3(y), z: fr3(z) };
}
function v4(x, y, z, w) {
  return { x: fr3(x), y: fr3(y), z: fr3(z), w: fr3(w) };
}
function v2splat(value) {
  let c = fr3(value);
  return { x: c, y: c };
}
function v3splat(value) {
  let c = fr3(value);
  return { x: c, y: c, z: c };
}
function v4splat(value) {
  let c = fr3(value);
  return { x: c, y: c, z: c, w: c };
}
function v3fromV2(xy, z) {
  return { x: xy.x, y: xy.y, z: fr3(z) };
}
function v4fromV3(xyz, w) {
  return { x: xyz.x, y: xyz.y, z: xyz.z, w: fr3(w) };
}
function v4fromV2(xy, z, w) {
  return { x: xy.x, y: xy.y, z: fr3(z), w: fr3(w) };
}
function component2(v, key) {
  return v[key] ?? Number.NaN;
}
function swizzle2(v, a, b) {
  return { x: component2(v, a), y: component2(v, b) };
}
function swizzle3(v, a, b, c) {
  return { x: component2(v, a), y: component2(v, b), z: component2(v, c) };
}
function swizzle4(v, a, b, c, d) {
  return { x: component2(v, a), y: component2(v, b), z: component2(v, c), w: component2(v, d) };
}
function v2with(v, key, value) {
  return key === "x" ? { x: fr3(value), y: v.y } : { x: v.x, y: fr3(value) };
}
function v3with(v, key, value) {
  let out = { x: v.x, y: v.y, z: v.z };
  return out[key] = fr3(value), out;
}
function v4with(v, key, value) {
  let out = { x: v.x, y: v.y, z: v.z, w: v.w };
  return out[key] = fr3(value), out;
}
function map2(f) {
  return (v) => ({ x: f(v.x), y: f(v.y) });
}
function map3(f) {
  return (v) => ({ x: f(v.x), y: f(v.y), z: f(v.z) });
}
function map4(f) {
  return (v) => ({ x: f(v.x), y: f(v.y), z: f(v.z), w: f(v.w) });
}
function zip2(f) {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y) });
}
function zip3(f) {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z) });
}
function zip4(f) {
  return (a, b) => ({ x: f(a.x, b.x), y: f(a.y, b.y), z: f(a.z, b.z), w: f(a.w, b.w) });
}
function zip2s(f) {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b) });
}
function zip3s(f) {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b), z: f(a.z, b) });
}
function zip4s(f) {
  return (a, b) => ({ x: f(a.x, b), y: f(a.y, b), z: f(a.z, b), w: f(a.w, b) });
}
function tri2(f) {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y) });
}
function tri3(f) {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z) });
}
function tri4(f) {
  return (a, b, c) => ({ x: f(a.x, b.x, c.x), y: f(a.y, b.y, c.y), z: f(a.z, b.z, c.z), w: f(a.w, b.w, c.w) });
}
function tri2s(f) {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t) });
}
function tri3s(f) {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t), z: f(a.z, b.z, t) });
}
function tri4s(f) {
  return (a, b, t) => ({ x: f(a.x, b.x, t), y: f(a.y, b.y, t), z: f(a.z, b.z, t), w: f(a.w, b.w, t) });
}
var v2add = zip2(fadd), v2sub = zip2(fsub), v2mul = zip2(fmul), v2div = zip2(fdiv), v2scale = zip2s(fmul);
function v2smul(scale, v) {
  return v2scale(v, scale);
}
var v2divs = zip2s(fdiv), v2neg = map2(fneg), v3add = zip3(fadd), v3sub = zip3(fsub), v3mul = zip3(fmul), v3div = zip3(fdiv), v3scale = zip3s(fmul);
function v3smul(scale, v) {
  return v3scale(v, scale);
}
var v3divs = zip3s(fdiv), v3neg = map3(fneg), v4add = zip4(fadd), v4sub = zip4(fsub), v4mul = zip4(fmul), v4div = zip4(fdiv), v4scale = zip4s(fmul);
function v4smul(scale, v) {
  return v4scale(v, scale);
}
var v4divs = zip4s(fdiv), v4neg = map4(fneg), v2abs = map2(abs), v3abs = map3(abs), v4abs = map4(abs), v2min = zip2(min), v3min = zip3(min), v4min = zip4(min), v2max = zip2(max), v3max = zip3(max), v4max = zip4(max), v2clamp = tri2(clamp2), v3clamp = tri3(clamp2), v4clamp = tri4(clamp2), v2saturate = map2(saturate), v3saturate = map3(saturate), v4saturate = map4(saturate), v2mix = tri2(mix), v3mix = tri3(mix), v4mix = tri4(mix), v2mixs = tri2s(mix), v3mixs = tri3s(mix), v4mixs = tri4s(mix), v2step = zip2(step), v3step = zip3(step), v4step = zip4(step), v2smoothstep = tri2(smoothstep), v3smoothstep = tri3(smoothstep), v4smoothstep = tri4(smoothstep), v2sqrt = map2(sqrt), v3sqrt = map3(sqrt), v4sqrt = map4(sqrt), v2inverseSqrt = map2(inverseSqrt), v3inverseSqrt = map3(inverseSqrt), v4inverseSqrt = map4(inverseSqrt), v2pow = zip2(pow), v3pow = zip3(pow), v4pow = zip4(pow), v2exp = map2(exp), v3exp = map3(exp), v4exp = map4(exp), v2exp2 = map2(exp2), v3exp2 = map3(exp2), v4exp2 = map4(exp2), v2log = map2(log), v3log = map3(log), v4log = map4(log), v2log2 = map2(log2), v3log2 = map3(log2), v4log2 = map4(log2), v2sin = map2(sin), v3sin = map3(sin), v4sin = map4(sin), v2cos = map2(cos), v3cos = map3(cos), v4cos = map4(cos), v2tan = map2(tan), v3tan = map3(tan), v4tan = map4(tan), v2asin = map2(asin), v3asin = map3(asin), v4asin = map4(asin), v2acos = map2(acos), v3acos = map3(acos), v4acos = map4(acos), v2atan = map2(atan), v3atan = map3(atan), v4atan = map4(atan), v2atan2 = zip2(atan2), v3atan2 = zip3(atan2), v4atan2 = zip4(atan2), v2floor = map2(floor), v3floor = map3(floor), v4floor = map4(floor), v2ceil = map2(ceil), v3ceil = map3(ceil), v4ceil = map4(ceil), v2trunc = map2(trunc), v3trunc = map3(trunc), v4trunc = map4(trunc), v2fract = map2(fract), v3fract = map3(fract), v4fract = map4(fract), v2sign = map2(sign), v3sign = map3(sign), v4sign = map4(sign), v2round = map2(round), v3round = map3(round), v4round = map4(round), v2radians = map2(radians), v3radians = map3(radians), v4radians = map4(radians), v2degrees = map2(degrees), v3degrees = map3(degrees), v4degrees = map4(degrees);
function v2dot(a, b) {
  return fr3(fr3(a.x * b.x) + fr3(a.y * b.y));
}
function v3dot(a, b) {
  return fr3(fr3(fr3(a.x * b.x) + fr3(a.y * b.y)) + fr3(a.z * b.z));
}
function v4dot(a, b) {
  return fr3(fr3(fr3(fr3(a.x * b.x) + fr3(a.y * b.y)) + fr3(a.z * b.z)) + fr3(a.w * b.w));
}
function v2length(v) {
  return fr3(Math.sqrt(v2dot(v, v)));
}
function v3length(v) {
  return fr3(Math.sqrt(v3dot(v, v)));
}
function v4length(v) {
  return fr3(Math.sqrt(v4dot(v, v)));
}
function v2distance(a, b) {
  return v2length(v2sub(a, b));
}
function v3distance(a, b) {
  return v3length(v3sub(a, b));
}
function v4distance(a, b) {
  return v4length(v4sub(a, b));
}
function v3cross(a, b) {
  return {
    x: fr3(fr3(a.y * b.z) - fr3(a.z * b.y)),
    y: fr3(fr3(a.z * b.x) - fr3(a.x * b.z)),
    z: fr3(fr3(a.x * b.y) - fr3(a.y * b.x))
  };
}
function v2normalize(v) {
  let len = v2length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: fr3(v.x / len), y: fr3(v.y / len) };
}
function v3normalize(v) {
  let len = v3length(v);
  return len === 0 ? { x: 0, y: 0, z: 0 } : { x: fr3(v.x / len), y: fr3(v.y / len), z: fr3(v.z / len) };
}
function v4normalize(v) {
  let len = v4length(v);
  return len === 0 ? { x: 0, y: 0, z: 0, w: 0 } : { x: fr3(v.x / len), y: fr3(v.y / len), z: fr3(v.z / len), w: fr3(v.w / len) };
}
function v2reflect(i, n) {
  let t = fr3(2 * v2dot(n, i));
  return { x: fr3(i.x - fr3(t * n.x)), y: fr3(i.y - fr3(t * n.y)) };
}
function v3reflect(i, n) {
  let t = fr3(2 * v3dot(n, i));
  return { x: fr3(i.x - fr3(t * n.x)), y: fr3(i.y - fr3(t * n.y)), z: fr3(i.z - fr3(t * n.z)) };
}
function v4reflect(i, n) {
  let t = fr3(2 * v4dot(n, i));
  return {
    x: fr3(i.x - fr3(t * n.x)),
    y: fr3(i.y - fr3(t * n.y)),
    z: fr3(i.z - fr3(t * n.z)),
    w: fr3(i.w - fr3(t * n.w))
  };
}

// src/math/quat.ts
var fr4 = Math.fround;
function quat(x, y, z, w) {
  return { x: fr4(x), y: fr4(y), z: fr4(z), w: fr4(w) };
}
function qidentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}
function qmul(a, b) {
  let { x: ax, y: ay, z: az, w: aw } = a, { x: bx, y: by, z: bz, w: bw } = b;
  return {
    x: fr4(fr4(fr4(fr4(aw * bx) + fr4(ax * bw)) + fr4(ay * bz)) - fr4(az * by)),
    y: fr4(fr4(fr4(fr4(aw * by) - fr4(ax * bz)) + fr4(ay * bw)) + fr4(az * bx)),
    z: fr4(fr4(fr4(fr4(aw * bz) + fr4(ax * by)) - fr4(ay * bx)) + fr4(az * bw)),
    w: fr4(fr4(fr4(fr4(aw * bw) - fr4(ax * bx)) - fr4(ay * by)) - fr4(az * bz))
  };
}
function qrotate(q, v) {
  let { x: qx, y: qy, z: qz, w } = q, tx = fr4(2 * fr4(fr4(qy * v.z) - fr4(qz * v.y))), ty = fr4(2 * fr4(fr4(qz * v.x) - fr4(qx * v.z))), tz = fr4(2 * fr4(fr4(qx * v.y) - fr4(qy * v.x))), cx = fr4(fr4(qy * tz) - fr4(qz * ty)), cy = fr4(fr4(qz * tx) - fr4(qx * tz)), cz = fr4(fr4(qx * ty) - fr4(qy * tx));
  return {
    x: fr4(fr4(v.x + fr4(w * tx)) + cx),
    y: fr4(fr4(v.y + fr4(w * ty)) + cy),
    z: fr4(fr4(v.z + fr4(w * tz)) + cz)
  };
}
function qaxisAngle(axis, angle) {
  let largest = 0, ax = Math.abs(axis.x);
  ax > largest && (largest = ax);
  let ay = Math.abs(axis.y);
  ay > largest && (largest = ay);
  let az = Math.abs(axis.z);
  if (az > largest && (largest = az), largest === 0) return qidentity();
  let sx = fr4(axis.x / largest), sy = fr4(axis.y / largest), sz = fr4(axis.z / largest), len = fr4(Math.sqrt(fr4(fr4(fr4(sx * sx) + fr4(sy * sy)) + fr4(sz * sz)))), nx = fr4(sx / len), ny = fr4(sy / len), nz = fr4(sz / len), half = fr4(angle * 0.5), sinHalf = fr4(Math.sin(half)), cosHalf = fr4(Math.cos(half));
  return { x: fr4(nx * sinHalf), y: fr4(ny * sinHalf), z: fr4(nz * sinHalf), w: cosHalf };
}
var AXIS_X = { x: 1, y: 0, z: 0 }, AXIS_Y = { x: 0, y: 1, z: 0 }, AXIS_Z = { x: 0, y: 0, z: 1 };
function qeuler(x, y, z) {
  return qmul(qmul(qaxisAngle(AXIS_Y, y), qaxisAngle(AXIS_X, x)), qaxisAngle(AXIS_Z, z));
}

// src/math/color.ts
var fr5 = Math.fround;
function color(r, g, b, a) {
  return { r: fr5(r), g: fr5(g), b: fr5(b), a: fr5(a) };
}
function clinear(rgb, a) {
  return { r: rgb.x, g: rgb.y, b: rgb.z, a: fr5(a) };
}
var SRGB_THRESHOLD = fr5(0.04045), SRGB_LINEAR_SCALE = fr5(12.92), SRGB_OFFSET = fr5(0.055), SRGB_SCALE = fr5(1.055), SRGB_GAMMA = fr5(2.4);
function srgbChannelToLinear(c) {
  return c <= SRGB_THRESHOLD ? fr5(c / SRGB_LINEAR_SCALE) : fr5(Math.pow(fr5(fr5(c + SRGB_OFFSET) / SRGB_SCALE), SRGB_GAMMA));
}
function csrgb(rgb, a) {
  return { r: srgbChannelToLinear(rgb.x), g: srgbChannelToLinear(rgb.y), b: srgbChannelToLinear(rgb.z), a: fr5(a) };
}
function crgb(c) {
  return { x: c.r, y: c.g, z: c.b };
}

// src/math/matrix.ts
var fr6 = Math.fround;
function at2(m, i) {
  return m[i];
}
function m4identity() {
  return identity();
}
function m4translation(v) {
  return translation(v);
}
function m4scale(v) {
  return scaling(v);
}
function m4columns(c0, c1, c2, c3) {
  return new Float32Array([c0.x, c0.y, c0.z, c0.w, c1.x, c1.y, c1.z, c1.w, c2.x, c2.y, c2.z, c2.w, c3.x, c3.y, c3.z, c3.w]);
}
function m4rotation(q) {
  let { x, y, z, w } = q, xx = fr6(x * x), yy = fr6(y * y), zz = fr6(z * z), xy = fr6(x * y), xz = fr6(x * z), yz = fr6(y * z), wx = fr6(w * x), wy = fr6(w * y), wz = fr6(w * z), m = new Float32Array(16);
  return m[0] = fr6(1 - fr6(2 * fr6(yy + zz))), m[1] = fr6(2 * fr6(xy + wz)), m[2] = fr6(2 * fr6(xz - wy)), m[4] = fr6(2 * fr6(xy - wz)), m[5] = fr6(1 - fr6(2 * fr6(xx + zz))), m[6] = fr6(2 * fr6(yz + wx)), m[8] = fr6(2 * fr6(xz + wy)), m[9] = fr6(2 * fr6(yz - wx)), m[10] = fr6(1 - fr6(2 * fr6(xx + yy))), m[15] = 1, m;
}
function m4col(m, i) {
  let base = i * 4;
  return { x: at2(m, base), y: at2(m, base + 1), z: at2(m, base + 2), w: at2(m, base + 3) };
}
function rowTimes(m, row, v0, v1, v22, v32) {
  return fr6(fr6(fr6(fr6(at2(m, row) * v0) + fr6(at2(m, 4 + row) * v1)) + fr6(at2(m, 8 + row) * v22)) + fr6(at2(m, 12 + row) * v32));
}
function m4mul(a, b) {
  let out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    let base = col * 4, b0 = at2(b, base), b1 = at2(b, base + 1), b2 = at2(b, base + 2), b3 = at2(b, base + 3);
    for (let row = 0; row < 4; row++) out[base + row] = rowTimes(a, row, b0, b1, b2, b3);
  }
  return out;
}
function m4mulv(m, v) {
  return {
    x: rowTimes(m, 0, v.x, v.y, v.z, v.w),
    y: rowTimes(m, 1, v.x, v.y, v.z, v.w),
    z: rowTimes(m, 2, v.x, v.y, v.z, v.w),
    w: rowTimes(m, 3, v.x, v.y, v.z, v.w)
  };
}
function m4transpose(m) {
  return transpose(m);
}

// src/math/copy.ts
function copy(value) {
  if (Array.isArray(value)) {
    let items = value, out = new Array(items.length);
    for (let i = 0; i < items.length; i++) out[i] = copy(items[i]);
    return out;
  }
  if (typeof value == "object" && value !== null && !ArrayBuffer.isView(value)) {
    let out = {};
    for (let [key, field] of Object.entries(value)) out[key] = copy(field);
    return out;
  }
  return value;
}

// src/math/entity-ref.ts
function refEq(a, b) {
  return a.slot === b.slot && a.gen === b.gen;
}

// src/math/ease.ts
var ELASTIC_C4 = 2 * Math.PI / 3;
function clamp01(t) {
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
}
function bounce(x) {
  return x < 1 / 2.75 ? 7.5625 * x * x : x < 2 / 2.75 ? 7.5625 * (x - 1.5 / 2.75) ** 2 + 0.75 : x < 2.5 / 2.75 ? 7.5625 * (x - 2.25 / 2.75) ** 2 + 0.9375 : 7.5625 * (x - 2.625 / 2.75) ** 2 + 0.984375;
}
function easeInQuad(t) {
  let x = clamp01(t);
  return Math.fround(x * x);
}
function easeOutQuad(t) {
  let x = clamp01(t);
  return Math.fround(1 - (1 - x) * (1 - x));
}
function easeInOutQuad(t) {
  let x = clamp01(t);
  return Math.fround(x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
}
function easeInCubic(t) {
  let x = clamp01(t);
  return Math.fround(x * x * x);
}
function easeOutCubic(t) {
  let x = clamp01(t);
  return Math.fround(1 - (1 - x) ** 3);
}
function easeInOutCubic(t) {
  let x = clamp01(t);
  return Math.fround(x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
}
function easeInOutSine(t) {
  let x = clamp01(t);
  return Math.fround((1 - Math.cos(Math.PI * x)) / 2);
}
function easeOutBack(t) {
  let x = clamp01(t);
  return Math.fround(1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2);
}
function easeOutElastic(t) {
  let x = clamp01(t);
  return Math.fround(x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ELASTIC_C4) + 1);
}
function easeOutBounce(t) {
  let x = clamp01(t);
  return Math.fround(bounce(x));
}

// src/math/format.ts
function formatF32(value) {
  if (Number.isNaN(value)) return "NaN";
  if (value === 1 / 0) return "inf";
  if (value === -1 / 0) return "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  let text = String(value);
  for (let digits = 1; digits <= 9; digits++) {
    let candidate = value.toPrecision(digits);
    if (Math.fround(Number(candidate)) === value) {
      text = String(Number(candidate));
      break;
    }
  }
  return /[.eEn]/.test(text) ? text : `${text}.0`;
}
function formatFloat(value, precision) {
  return precision < 0 || !Number.isFinite(value) ? formatF32(value) : value.toFixed(precision);
}
function fmt(value, type, precision) {
  switch (type) {
    case "string":
      return typeof value == "string" ? value : "";
    case "bool":
      return value === !0 ? "true" : "false";
    case "i32":
    case "u32":
      return typeof value == "number" ? String(value) : "0";
    case "f32":
      return typeof value == "number" ? formatFloat(value, precision) : "NaN";
    case "vec2": {
      let v = value;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)})`;
    }
    case "vec3": {
      let v = value;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)}, ${formatFloat(v.z, precision)})`;
    }
    case "vec4": {
      let v = value;
      return `(${formatFloat(v.x, precision)}, ${formatFloat(v.y, precision)}, ${formatFloat(v.z, precision)}, ${formatFloat(v.w, precision)})`;
    }
    default:
      return typeof value == "string" ? value : "";
  }
}

// src/index.ts
var RUNTIME_ABI = 1, RUNTIME_VERSION = "0.1.0-dev";
export {
  I32_MAX,
  I32_MIN,
  MAX_SCHEMA_FAILURES,
  MtekMountError,
  RUNTIME_ABI,
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  RUNTIME_VERSION,
  ResourceRegistry,
  SUPPORTED_LANGUAGE_VERSION,
  SUPPORTED_MANIFEST_SCHEMA,
  SUPPORTED_RUNTIME_ABI,
  U32_MAX,
  UniformArena,
  abs,
  acos,
  acquireDevice,
  asin,
  atan,
  atan2,
  budgetExceeded,
  ceil,
  checkCompatibility,
  checkDeviceCapabilities,
  checkManifest,
  clamp2 as clamp,
  clampIndex,
  clinear,
  color,
  copy,
  cos,
  crgb,
  csrgb,
  degrees,
  distance,
  easeInCubic,
  easeInOutCubic,
  easeInOutQuad,
  easeInOutSine,
  easeInQuad,
  easeOutBack,
  easeOutBounce,
  easeOutCubic,
  easeOutElastic,
  easeOutQuad,
  exp,
  exp2,
  f2i,
  f2u,
  fadd,
  fdiv,
  floor,
  fmt,
  fmul,
  fneg,
  fract,
  frem,
  fsub,
  i2f,
  i2u,
  iabs,
  iadd,
  iclamp,
  idiv,
  imax,
  imin,
  imul,
  ineg,
  inverseSqrt,
  irem,
  isLittleEndianPlatform,
  isub,
  length,
  log,
  log2,
  m4col,
  m4columns,
  m4identity,
  m4mul,
  m4mulv,
  m4rotation,
  m4scale,
  m4translation,
  m4transpose,
  makeRuntimeDiagnostic,
  max,
  min,
  mix,
  mountErrorKindForCode,
  mountMtek,
  pow,
  qaxisAngle,
  qeuler,
  qidentity,
  qmul,
  qrotate,
  quat,
  radians,
  refEq,
  round,
  roundUp,
  saturate,
  sign,
  sin,
  smoothstep,
  sqrt,
  srgbChannelToLinear,
  step,
  swizzle2,
  swizzle3,
  swizzle4,
  tan,
  trunc,
  u2f,
  u2i,
  uabs,
  uadd,
  uclamp,
  udiv,
  umax,
  umin,
  umul,
  urem,
  usub,
  v2,
  v2abs,
  v2acos,
  v2add,
  v2asin,
  v2atan,
  v2atan2,
  v2ceil,
  v2clamp,
  v2cos,
  v2degrees,
  v2distance,
  v2div,
  v2divs,
  v2dot,
  v2exp,
  v2exp2,
  v2floor,
  v2fract,
  v2inverseSqrt,
  v2length,
  v2log,
  v2log2,
  v2max,
  v2min,
  v2mix,
  v2mixs,
  v2mul,
  v2neg,
  v2normalize,
  v2pow,
  v2radians,
  v2reflect,
  v2round,
  v2saturate,
  v2scale,
  v2sign,
  v2sin,
  v2smoothstep,
  v2smul,
  v2splat,
  v2sqrt,
  v2step,
  v2sub,
  v2tan,
  v2trunc,
  v2with,
  v3,
  v3abs,
  v3acos,
  v3add,
  v3asin,
  v3atan,
  v3atan2,
  v3ceil,
  v3clamp,
  v3cos,
  v3cross,
  v3degrees,
  v3distance,
  v3div,
  v3divs,
  v3dot,
  v3exp,
  v3exp2,
  v3floor,
  v3fract,
  v3fromV2,
  v3inverseSqrt,
  v3length,
  v3log,
  v3log2,
  v3max,
  v3min,
  v3mix,
  v3mixs,
  v3mul,
  v3neg,
  v3normalize,
  v3pow,
  v3radians,
  v3reflect,
  v3round,
  v3saturate,
  v3scale,
  v3sign,
  v3sin,
  v3smoothstep,
  v3smul,
  v3splat,
  v3sqrt,
  v3step,
  v3sub,
  v3tan,
  v3trunc,
  v3with,
  v4,
  v4abs,
  v4acos,
  v4add,
  v4asin,
  v4atan,
  v4atan2,
  v4ceil,
  v4clamp,
  v4cos,
  v4degrees,
  v4distance,
  v4div,
  v4divs,
  v4dot,
  v4exp,
  v4exp2,
  v4floor,
  v4fract,
  v4fromV2,
  v4fromV3,
  v4inverseSqrt,
  v4length,
  v4log,
  v4log2,
  v4max,
  v4min,
  v4mix,
  v4mixs,
  v4mul,
  v4neg,
  v4normalize,
  v4pow,
  v4radians,
  v4reflect,
  v4round,
  v4saturate,
  v4scale,
  v4sign,
  v4sin,
  v4smoothstep,
  v4smul,
  v4splat,
  v4sqrt,
  v4step,
  v4sub,
  v4tan,
  v4trunc,
  v4with,
  validateManifest
};
//# sourceMappingURL=runtime.dev.js.map
