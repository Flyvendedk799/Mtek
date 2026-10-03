/** Version of the runtime ABI this runtime implements (`spec/runtime-abi.md`). */
export const RUNTIME_ABI = 1;

/** Version of this runtime build. */
export const RUNTIME_VERSION = "0.1.0-dev";

/** Program format: manifest types, validation and compatibility checks (spec/runtime-abi.md). */
export * from "./abi/index.js";
