// Manifest validation: the generated Ajv-standalone validator wrapped into typed results.
//
// `./generated/validate-manifest.js` is produced at build time by scripts/gen-manifest-validator.mjs from
// spec/manifest.schema.json and is bundled into the runtime; Ajv itself is not (decision 0007).

import { checkCompatibility, type AbiFailure } from "./compatibility.js";
import type { MtekManifest } from "./manifest-types.js";
import validate, { type ManifestValidationError } from "./generated/validate-manifest.js";

export type ManifestResult =
  | { readonly ok: true; readonly manifest: MtekManifest }
  | { readonly ok: false; readonly failures: readonly AbiFailure[] };

/** At most this many schema failures are reported for one manifest (a broken array can have thousands). */
export const MAX_SCHEMA_FAILURES = 100;

/** `/scene/entities/0/name` becomes `scene.entities[0].name`; the empty pointer becomes `manifest`. */
function pointerToField(pointer: string, extra?: string): string {
  const segments = pointer === "" ? [] : pointer.slice(1).split("/");
  if (extra !== undefined) segments.push(extra);
  let field = "";
  for (const raw of segments) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    field += /^[0-9]+$/.test(segment) ? `[${segment}]` : field === "" ? segment : `.${segment}`;
  }
  return field === "" ? "manifest" : field;
}

function fieldOf(error: ManifestValidationError): string {
  const params = error.params;
  switch (error.keyword) {
    case "required":
      return pointerToField(error.instancePath, String(params["missingProperty"]));
    case "additionalProperties":
      return pointerToField(error.instancePath, String(params["additionalProperty"]));
    case "discriminator":
      // The error is reported on the object; the offending member is the tag property.
      return pointerToField(error.instancePath, String(params["tag"]));
    default:
      return pointerToField(error.instancePath, error.propertyName);
  }
}

// Summary errors that only repeat the underlying failure.
const SUMMARY_KEYWORDS: ReadonlySet<string> = new Set(["if", "propertyNames"]);

function toFailures(errors: readonly ManifestValidationError[]): readonly AbiFailure[] {
  const failures: AbiFailure[] = [];
  for (const error of errors) {
    if (SUMMARY_KEYWORDS.has(error.keyword)) continue;
    const field = fieldOf(error);
    failures.push({
      code: "E8006",
      field,
      message: `Invalid manifest at \`${field}\`: ${error.message ?? `failed \`${error.keyword}\``}.`,
    });
    if (failures.length >= MAX_SCHEMA_FAILURES) break;
  }
  return failures;
}

/**
 * Validates a parsed manifest against `spec/manifest.schema.json` only (`E8006` on failure). Does not
 * check compatibility; use `checkManifest` for the order required by spec/runtime-abi.md section 5.1.
 */
export function validateManifest(value: unknown): ManifestResult {
  if (validate(value)) {
    return { ok: true, manifest: value as MtekManifest };
  }
  const failures = toFailures(validate.errors ?? []);
  if (failures.length === 0) {
    return {
      ok: false,
      failures: [{ code: "E8006", field: "manifest", message: "Invalid manifest: schema validation failed." }],
    };
  }
  return { ok: false, failures };
}

/**
 * The full acceptance check of spec/runtime-abi.md section 5.1: compatibility first (`E8003`, reading only
 * `manifestSchema`, `runtimeAbi` and `languageVersion`), then the whole schema (`E8006`). An old or future
 * program therefore always gets the accurate "incompatible program" failure, never a schema error.
 */
export function checkManifest(value: unknown): ManifestResult {
  const incompatible = checkCompatibility(value);
  if (incompatible.length > 0) {
    return { ok: false, failures: incompatible };
  }
  return validateManifest(value);
}
