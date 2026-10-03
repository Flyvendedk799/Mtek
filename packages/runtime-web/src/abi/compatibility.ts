// Compatibility checks of spec/runtime-abi.md section 5.1.
//
// The checks run in this order, and `checkManifest` (validate.ts) enforces it:
//   1. checkCompatibility reads ONLY manifestSchema, runtimeAbi and languageVersion and reports E8003 for a
//      mismatch, so an old or future program always gets the accurate "incompatible program" diagnostic;
//   2. only then is the whole manifest validated against the schema (E8006);
//   3. the device is compared with requiredCapabilities (E8002) when mounting.

import type { MtekRequiredCapabilities } from "./manifest-types.js";
import {
  SUPPORTED_LANGUAGE_VERSION,
  SUPPORTED_MANIFEST_SCHEMA,
  SUPPORTED_RUNTIME_ABI,
} from "./constants.js";

/**
 * `E8002` device below the target profile, `E8003` incompatible program, `E8006` manifest invalid
 * (`spec/diagnostics.md` section 5.8).
 */
export type AbiFailureCode = "E8002" | "E8003" | "E8006";

/** A typed failure. M1-14 turns these into `MtekDiagnostic`s. */
export interface AbiFailure {
  readonly code: AbiFailureCode;
  readonly message: string;
  /** The mismatching field: `runtimeAbi`, or a dotted path such as `scene.entities[0].name`. */
  readonly field: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Checks `manifestSchema`, `runtimeAbi` and `languageVersion` of a parsed manifest (any JSON value) and
 * returns the failures, empty when the program is compatible. It reads nothing else.
 *
 * A value that is not an integer (or, for the language version, not a string) cannot be compared and is
 * reported as `E8006`; E8003 failures are listed first because they are the accurate diagnosis.
 */
export function checkCompatibility(manifest: unknown): readonly AbiFailure[] {
  if (!isRecord(manifest)) {
    return [{ code: "E8006", field: "manifest", message: "The manifest must be a JSON object." }];
  }
  const incompatible: AbiFailure[] = [];
  const invalid: AbiFailure[] = [];

  const integerFields = [
    ["manifestSchema", SUPPORTED_MANIFEST_SCHEMA],
    ["runtimeAbi", SUPPORTED_RUNTIME_ABI],
  ] as const;
  for (const [field, supported] of integerFields) {
    const value = manifest[field];
    if (value === undefined) {
      invalid.push({ code: "E8006", field, message: `The manifest has no \`${field}\`.` });
    } else if (typeof value !== "number" || !Number.isInteger(value)) {
      invalid.push({ code: "E8006", field, message: `\`${field}\` must be an integer, found ${describe(value)}.` });
    } else if (value !== supported) {
      incompatible.push({
        code: "E8003",
        field,
        message: `Incompatible program: \`${field}\` is ${String(value)}, this runtime implements ${String(supported)}.`,
      });
    }
  }

  const languageVersion = manifest["languageVersion"];
  if (languageVersion === undefined) {
    invalid.push({ code: "E8006", field: "languageVersion", message: "The manifest has no `languageVersion`." });
  } else if (typeof languageVersion !== "string") {
    invalid.push({
      code: "E8006",
      field: "languageVersion",
      message: `\`languageVersion\` must be a string, found ${describe(languageVersion)}.`,
    });
  } else if (languageVersion !== SUPPORTED_LANGUAGE_VERSION) {
    incompatible.push({
      code: "E8003",
      field: "languageVersion",
      message: `Incompatible program: \`languageVersion\` is ${JSON.stringify(languageVersion)}, this runtime supports ${JSON.stringify(SUPPORTED_LANGUAGE_VERSION)}.`,
    });
  }

  return [...incompatible, ...invalid];
}

/** What `checkDeviceCapabilities` needs to know about the adapter/device (adapted by the mounting code). */
export interface DeviceCapabilities {
  hasFeature(name: string): boolean;
  hasWgslLanguageFeature(name: string): boolean;
  /** The device's value for a WebGPU limit, or undefined if it does not report it. */
  limit(name: string): number | undefined;
}

/**
 * Compares `requiredCapabilities` with the device and returns `E8002` failures, empty when the device
 * satisfies the profile. `max*` limits must be at least the required value, `min*` limits (alignments) at
 * most the required value.
 */
export function checkDeviceCapabilities(
  required: MtekRequiredCapabilities,
  device: DeviceCapabilities,
): readonly AbiFailure[] {
  const failures: AbiFailure[] = [];
  required.features.forEach((name, index) => {
    if (!device.hasFeature(name)) {
      failures.push({
        code: "E8002",
        field: `requiredCapabilities.features[${String(index)}]`,
        message: `The device does not support the required WebGPU feature \`${name}\`.`,
      });
    }
  });
  required.wgslLanguageFeatures.forEach((name, index) => {
    if (!device.hasWgslLanguageFeature(name)) {
      failures.push({
        code: "E8002",
        field: `requiredCapabilities.wgslLanguageFeatures[${String(index)}]`,
        message: `The device does not support the required WGSL language feature \`${name}\`.`,
      });
    }
  });
  for (const [name, needed] of Object.entries(required.limits)) {
    const field = `requiredCapabilities.limits.${name}`;
    const actual = device.limit(name);
    if (actual === undefined) {
      failures.push({ code: "E8002", field, message: `The device does not report the limit \`${name}\`.` });
    } else if (name.startsWith("min") ? actual > needed : actual < needed) {
      failures.push({
        code: "E8002",
        field,
        message: `The device limit \`${name}\` is ${String(actual)}, the program needs ${name.startsWith("min") ? "at most" : "at least"} ${String(needed)}.`,
      });
    }
  }
  return failures;
}
