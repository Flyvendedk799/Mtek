/** Version of the runtime ABI this runtime implements (`spec/runtime-abi.md`). */
export const RUNTIME_ABI = 1;

/** Version of this runtime build. */
export const RUNTIME_VERSION = "0.1.0-dev";
export * from "./animation.js";
export {EXTENSION_API_VERSION} from "./host/extensions.js";
export type {MtekExtension,ExtensionContext,SceneTransform,TransformUpdate} from "./host/extensions.js";
export type {MtekRenderingOptions,PostEffect,LightingQuality,LinearEnvironment,EnvironmentLightingOptions,DirectionalShadowOptions} from "./render/options.js";
export { decodeRadiance } from "./render/environment.js";
export {AssetPool} from "./assets/pool.js";
export type {AssetDescriptor,AssetProgress,AssetLoader,AssetLease,AssetRequestOptions,AssetPoolOptions} from "./assets/pool.js";

export {
  MtekMountError,
  RUNTIME_DIAGNOSTIC_CATALOGUE,
  makeRuntimeDiagnostic,
  mountErrorKindForCode,
} from "./diagnostics/types.js";
export type {
  MtekDiagnostic,
  MtekDiagnosticPhase,
  MtekMountErrorKind,
  MtekRelatedSpan,
  MtekRuntimePhase,
  MtekSeverity,
  MtekSourceSpan,
  MtekSuggestedEdit,
  RuntimeDiagnosticCode,
} from "./diagnostics/types.js";
/** The host API (`spec/runtime-abi.md` section 6); `app.js` re-exports `mountMtek` from the runtime bundle. */
export { mountMtek } from "./host/mount.js";
export type {
  MtekApp,
  MtekAppState,
  MtekAssetStateEvent,
  MtekAssetStatus,
  MtekDebug,
  MtekInputResult,
  MtekMountOptions,
  MtekMountProgram,
  MtekTestOptions,
  MtekTestTexture,
} from "./host/types.js";
export { acquireDevice, isLittleEndianPlatform } from "./gpu/device.js";
export type { AcquireDeviceOptions, AcquiredDevice, MtekAdapterInfo } from "./gpu/device.js";
export { ResourceRegistry } from "./gpu/registry.js";
export type { RegistryCounters, RegistryOptions, ReleasableResource } from "./gpu/registry.js";
export { UniformArena, roundUp } from "./gpu/uniform-arena.js";
export type {
  ArenaViews,
  ArenaWriter,
  BufferReplacedEvent,
  UniformArenaLayout,
  UniformArenaOptions,
} from "./gpu/uniform-arena.js";
/** Program format: manifest types, validation and compatibility checks (spec/runtime-abi.md). */
export * from "./abi/index.js";
/**
 * The runtime math library `rt` (spec/runtime-abi.md section 4.1): generated code imports this module
 * as `import * as rt`, so every helper is a top-level export (decision 0037).
 */
export * from "./math/rt.js";
