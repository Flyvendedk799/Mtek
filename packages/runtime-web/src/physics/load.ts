/**
 * Loading the physics module (`spec/physics.md` section 5, `spec/runtime-abi.md` sections 2 and 5.2,
 * decisions 0063 and 0066).
 *
 * The module is `physics/<h16>.js`, a self-contained ES module whose default export is a `LoadPhysics`. It is
 * imported with a dynamic `import()` **only when the manifest says `subsystems.physics`**; a program without
 * bodies never requests it. Any failure (the file is missing, the module does not parse or does not have the
 * expected default export, the engine does not initialise) is `E8102`; the mount fails with the kind
 * `physics-failed`, a reload that needs the module is refused.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { LoadPhysics, PhysicsBackend } from "./types.js";

export type PhysicsLoadResult =
  | { readonly ok: true; readonly backend: PhysicsBackend; readonly url: string }
  | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

export interface PhysicsLoadOptions {
  readonly manifest: MtekManifest;
  /** The directory the program (`app.js`) was loaded from: `subsystems.physicsModule` is relative to it. */
  readonly baseUrl: URL;
  /** `import()`; injected so tests need no network. */
  readonly importModule: (url: string) => Promise<unknown>;
  readonly phase: MtekRuntimePhase;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : `${error.name}: ${error.message}`) : String(error);
}

function failure(options: PhysicsLoadOptions, url: string | undefined, why: string, browserMessage?: string): PhysicsLoadResult {
  return {
    ok: false,
    diagnostics: [
      makeRuntimeDiagnostic("E8102", {
        phase: options.phase,
        message: `The physics module could not be loaded: ${why}`,
        notes: [
          ...(url === undefined ? [] : [`module: ${url}`]),
          ...(browserMessage === undefined ? [] : [`browser message: ${browserMessage}`]),
          "help: the program has bodies, so physics/<hash>.js must be served next to app.js (mtek build writes it)",
        ],
      }),
    ],
  };
}

/** The URL `subsystems.physicsModule` names, or `undefined` for a program without physics. */
export function physicsModuleUrl(manifest: MtekManifest, baseUrl: URL): string | undefined {
  const module = manifest.subsystems.physicsModule;
  return manifest.subsystems.physics && module !== undefined ? new URL(module, baseUrl).href : undefined;
}

/**
 * Imports the module and initialises the backend. Never rejects: a failure is returned as an `E8102`
 * diagnostic. Call it only for a program whose manifest has `subsystems.physics`.
 */
export async function loadPhysicsBackend(options: PhysicsLoadOptions): Promise<PhysicsLoadResult> {
  const url = physicsModuleUrl(options.manifest, options.baseUrl);
  if (url === undefined) return failure(options, undefined, "the manifest declares physics but names no module (subsystems.physicsModule).");

  let module: unknown;
  try {
    module = await options.importModule(url);
  } catch (error) {
    return failure(options, url, "importing it failed.", errorText(error));
  }
  const load = typeof module === "object" && module !== null ? (module as { readonly default?: unknown }).default : undefined;
  if (typeof load !== "function") return failure(options, url, "the module has no default export that is a function.");

  let backend: unknown;
  try {
    backend = await (load as LoadPhysics)();
  } catch (error) {
    return failure(options, url, "initialising the physics engine failed.", errorText(error));
  }
  const candidate = backend as Partial<PhysicsBackend> | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.createWorld !== "function" || typeof candidate.name !== "string") {
    return failure(options, url, "the module's default export did not resolve to a physics backend (name, createWorld).");
  }
  return { ok: true, backend: candidate as PhysicsBackend, url };
}
