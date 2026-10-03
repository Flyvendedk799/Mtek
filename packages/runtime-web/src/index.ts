/** Version of the runtime ABI this runtime implements (`spec/runtime-abi.md`). */
export const RUNTIME_ABI = 1;

/** Version of this runtime build. */
export const RUNTIME_VERSION = "0.1.0-dev";

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
  MtekDebug,
  MtekInputResult,
  MtekMountOptions,
  MtekMountProgram,
  MtekTestOptions,
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
