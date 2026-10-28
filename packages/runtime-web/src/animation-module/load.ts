/**
 * Loading the animation module (`spec/runtime-abi.md` section 5.2, decision 0225), modelled on the physics module
 * (`physics/load.ts`).
 *
 * The module is `animation/<h16>.js`, a self-contained ES module whose default export is a `LoadAnimation`. It is
 * imported with a dynamic `import()` **only when the manifest says `subsystems.animation`**; a program without a
 * skinned mesh or `clips_from` never requests it. Any failure (the file is missing, the module does not parse, has no
 * default export that is a function, or its backend has the wrong shape) is `E8114`; the mount fails with the kind
 * `animation-failed`, a reload that needs the module is refused.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { SceneStructure } from "../scene/structure.js";
import type { AnimationBackend, LoadAnimation } from "./backend.js";

export type AnimationLoadResult =
  | { readonly ok: true; readonly backend: AnimationBackend; readonly url: string }
  | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

export interface AnimationLoadOptions {
  readonly manifest: MtekManifest;
  /** The directory the program (`app.js`) was loaded from: `subsystems.animationModule` is relative to it. */
  readonly baseUrl: URL;
  /** `import()`; injected so tests need no network. */
  readonly importModule: (url: string) => Promise<unknown>;
  readonly phase: MtekRuntimePhase;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : `${error.name}: ${error.message}`) : String(error);
}

function failure(phase: MtekRuntimePhase, url: string | undefined, why: string, browserMessage?: string): AnimationLoadResult {
  return {
    ok: false,
    diagnostics: [
      makeRuntimeDiagnostic("E8114", {
        phase,
        message: `The animation module could not be loaded: ${why}`,
        notes: [
          ...(url === undefined ? [] : [`module: ${url}`]),
          ...(browserMessage === undefined ? [] : [`browser message: ${browserMessage}`]),
          "help: the program has a skinned mesh or clips_from, so animation/<hash>.js must be served next to app.js (mtek build writes it)",
        ],
      }),
    ],
  };
}

/** The URL `subsystems.animationModule` names, or `undefined` for a program without skeletal animation. */
export function animationModuleUrl(manifest: MtekManifest, baseUrl: URL): string | undefined {
  const module = manifest.subsystems.animationModule;
  return manifest.subsystems.animation === true && module !== undefined ? new URL(module, baseUrl).href : undefined;
}

/**
 * Whether the scene needs skeletal animation: a skinned mesh, or an entity that plays the clips of another skeleton
 * with `clips_from`. The compiler sets `subsystems.animation` by the same rule; a manifest that disagrees is refused
 * by {@link animationMismatch}.
 */
export function needsAnimation(structure: SceneStructure): boolean {
  return (
    structure.meshes.some((mesh) => mesh.descriptor.kind === "asset" && mesh.descriptor.skin !== undefined) ||
    structure.entities.some((entity) => entity.clipsFrom !== undefined) ||
    structure.prefabs.some((prefab) => prefab.clipsFrom !== undefined)
  );
}

/** `E8114` for a manifest that has skeletal animation but does not declare the module (never produced by the compiler). */
export function animationMismatch(manifest: MtekManifest, structure: SceneStructure, phase: MtekRuntimePhase): MtekDiagnostic | undefined {
  if (manifest.subsystems.animation === true || !needsAnimation(structure)) return undefined;
  return makeRuntimeDiagnostic("E8114", {
    phase,
    message: "The animation module could not be loaded: the program has a skinned mesh or clips_from, but its manifest does not declare the module (subsystems.animation).",
    notes: ["help: rebuild the program with this version of mtek"],
  });
}

/**
 * Imports the module and creates the backend. Never rejects: a failure is returned as an `E8114` diagnostic. Call it
 * only for a program whose manifest has `subsystems.animation`.
 */
export async function loadAnimationBackend(options: AnimationLoadOptions): Promise<AnimationLoadResult> {
  const { phase } = options;
  const url = animationModuleUrl(options.manifest, options.baseUrl);
  if (url === undefined) return failure(phase, undefined, "the manifest declares animation but names no module (subsystems.animationModule).");

  let module: unknown;
  try {
    module = await options.importModule(url);
  } catch (error) {
    return failure(phase, url, "importing it failed.", errorText(error));
  }
  const load = typeof module === "object" && module !== null ? (module as { readonly default?: unknown }).default : undefined;
  if (typeof load !== "function") return failure(phase, url, "the module has no default export that is a function.");

  let backend: unknown;
  try {
    backend = await (load as LoadAnimation)();
  } catch (error) {
    return failure(phase, url, "initialising it failed.", errorText(error));
  }
  const candidate = backend as Partial<AnimationBackend> | null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.name !== "string" ||
    typeof candidate.createPlayers !== "function" ||
    typeof candidate.createCommands !== "function" ||
    typeof candidate.retargetHumanoid !== "function"
  ) {
    return failure(phase, url, "the module's default export did not resolve to an animation backend (name, createPlayers, createCommands, retargetHumanoid).");
  }
  return { ok: true, backend: candidate as AnimationBackend, url };
}
